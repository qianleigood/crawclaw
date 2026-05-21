#![recursion_limit = "256"]

mod protocol_contract;
pub use protocol_contract::{
    gateway_protocol_schema_json, gateway_protocol_schema_value, GATEWAY_PROTOCOL_EVENTS,
    GATEWAY_PROTOCOL_METHODS, GATEWAY_PROTOCOL_VERSION,
};

mod gateway_agents;
mod gateway_approvals;
mod gateway_channels;
mod gateway_chat;
mod gateway_config;
mod gateway_esp32;
mod gateway_openai_compat;
mod gateway_plugin_install;
mod gateway_plugins;
mod gateway_rpc;
mod gateway_runtime_memory;
mod gateway_sessions;
mod gateway_summary_routes;
mod gateway_tools;
mod gateway_update;
mod gateway_usage;
mod gateway_voice;
mod gateway_workflow_mutations;
mod gateway_workflows;
mod gateway_ws;

use self::gateway_agents::*;
use self::gateway_approvals::*;
use self::gateway_channels::*;
use self::gateway_chat::*;
use self::gateway_config::*;
use self::gateway_esp32::*;
use self::gateway_openai_compat::*;
use self::gateway_plugin_install::*;
use self::gateway_plugins::*;
use self::gateway_rpc::*;
use self::gateway_runtime_memory::*;
use self::gateway_sessions::*;
use self::gateway_tools::*;
use self::gateway_update::*;
use self::gateway_usage::*;
use self::gateway_voice::*;
use self::gateway_workflow_mutations::*;
use self::gateway_workflows::*;
use self::gateway_ws::*;

pub mod desktop {
    pub use crate::protocol_contract::GATEWAY_PROTOCOL_EVENTS as SSE_EVENTS;
}

use std::collections::{BTreeMap, BTreeSet};
use std::env;
use std::io::Write;
use std::net::{IpAddr, Ipv4Addr, SocketAddr};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Arc;
use std::time::{Instant, SystemTime, UNIX_EPOCH};

use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::{Path as AxumPath, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use base64::engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD};
use base64::Engine as _;
use crawclaw_runtime::{
    channel_contract_version,
    cron::{CronService, CronServiceOptions},
    dispatch_native_channel_outbound, find_native_channel_descriptor,
    is_local_native_delivery_channel, list_native_channel_descriptors,
    lookup_native_channel_directory,
    memory::RustMemoryRuntime,
    resolve_native_channel_lifecycle_update,
    special_agents::{
        find_special_agent, special_agent_definitions, SpecialAgentDefinition,
        SpecialAgentRunRequest,
    },
    AgentModelSelection, AgentRunEvent, AgentRunRequest, AgentRunResult, AgentRuntime,
    ChannelCapabilityDescriptor, ChannelChatType, ChannelDirectoryLookupRequest,
    ChannelInboundEnvelope, ChannelOutboundAction, ChannelOutboundRequest, DesktopSessionStore,
    NativeChannelDispatchContext, NativeChannelLifecycleInput,
};
use futures_util::{Sink, SinkExt, StreamExt};
use ring::signature::KeyPair;
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};
use tokio::net::TcpListener;
use tokio::sync::broadcast;

use self::gateway_summary_routes::{events, gateway_bootstrap, gateway_state, runtime_status};

const GATEWAY_TOKEN_HEADER: &str = "x-crawclaw-gateway-token";
const OPENAI_COMPAT_AGENT_ID_HEADER: &str = "x-crawclaw-agent-id";
const OPENAI_COMPAT_SESSION_KEY_HEADER: &str = "x-crawclaw-session-key";
const OPENAI_COMPAT_MESSAGE_CHANNEL_HEADER: &str = "x-crawclaw-message-channel";

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum GatewayBind {
    Loopback,
    Lan,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct GatewayRunConfig {
    pub bind: GatewayBind,
    pub port: u16,
    pub runtime_root: Option<PathBuf>,
    pub auth_token: Option<String>,
    pub auth_password: Option<String>,
}

impl Default for GatewayRunConfig {
    fn default() -> Self {
        Self {
            bind: GatewayBind::Loopback,
            port: 18789,
            runtime_root: None,
            auth_token: env::var("CRAWCLAW_GATEWAY_TOKEN")
                .ok()
                .map(|value| value.trim().to_string())
                .filter(|value| !value.is_empty()),
            auth_password: env::var("CRAWCLAW_GATEWAY_PASSWORD")
                .ok()
                .map(|value| value.trim().to_string())
                .filter(|value| !value.is_empty()),
        }
    }
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GatewayHealth {
    pub ok: bool,
    pub runtime: String,
    pub implementation: String,
}

#[derive(Clone)]
struct GatewayState {
    state_dir: PathBuf,
    runtime_root: PathBuf,
    agent_runtime: AgentRuntime,
    session_store: DesktopSessionStore,
    cron: CronService,
    auth_token: Option<Arc<str>>,
    auth_password: Option<Arc<str>>,
    started_at_ms: u128,
    events: broadcast::Sender<Value>,
    presence: Arc<std::sync::Mutex<BTreeMap<String, Value>>>,
    approvals: Arc<std::sync::Mutex<BTreeMap<String, ApprovalRecord>>>,
    last_main_session_wake: Arc<std::sync::Mutex<Option<Value>>>,
    agent_run_events: Arc<std::sync::Mutex<BTreeMap<String, Vec<Value>>>>,
}

#[derive(Clone, Debug)]
struct ApprovalRecord {
    id: String,
    kind: String,
    request: Value,
    created_at_ms: u64,
    expires_at_ms: u64,
    decision: Option<String>,
    resolved_by: Option<String>,
    resolved_at_ms: Option<u64>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct GatewayRpcRequest {
    method: String,
    #[serde(default)]
    params: Value,
    #[serde(default)]
    id: Option<Value>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct GatewayRpcResponse {
    ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    id: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    result: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct GatewayWsRequest {
    #[serde(rename = "type")]
    frame_type: String,
    id: String,
    method: String,
    #[serde(default)]
    params: Value,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ConnectParams {
    #[serde(default)]
    auth: Option<ConnectAuth>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ConnectAuth {
    #[serde(default)]
    token: Option<String>,
    #[serde(default)]
    password: Option<String>,
}

pub async fn run_gateway(config: GatewayRunConfig) -> Result<(), String> {
    let listener = TcpListener::bind(socket_addr(&config))
        .await
        .map_err(|error| format!("failed to bind Rust Gateway: {error}"))?;
    let state = GatewayState::new(config);
    let app = Router::new()
        .route("/", get(ws))
        .route("/healthz", get(health))
        .route("/health", get(health))
        .route("/readyz", get(ready))
        .route("/ready", get(ready))
        .route("/v1/models", get(openai_models))
        .route("/v1/models/{model}", get(openai_model))
        .route("/v1/chat/completions", post(openai_chat_completions))
        .route("/v1/responses", post(openresponses))
        .route("/api/gateway/bootstrap", get(gateway_bootstrap))
        .route("/api/gateway/state", get(gateway_state))
        .route("/api/gateway/runtime", get(runtime_status))
        .route("/api/gateway/events", get(events))
        .route("/api/esp32/ota", get(esp32_ota).post(esp32_ota))
        .route("/api/gateway/rpc", post(rpc))
        .route("/rpc", post(rpc))
        .with_state(state);
    axum::serve(listener, app)
        .await
        .map_err(|error| format!("Rust Gateway exited: {error}"))
}

pub async fn call_local_gateway_method(method: &str, params: Value) -> Result<Value, String> {
    let state = GatewayState::new(GatewayRunConfig::default());
    handle_gateway_method(&state, method, params).await
}

impl GatewayState {
    fn new(config: GatewayRunConfig) -> Self {
        let state_dir = resolve_gateway_state_dir();
        let runtime_root = config.runtime_root.unwrap_or_else(|| {
            env::var_os("CRAWCLAW_RUNTIME_ROOT")
                .filter(|value| !value.is_empty())
                .map(PathBuf::from)
                .unwrap_or_else(|| state_dir.join("runtime").join("crawclaw"))
        });
        let (events, _) = broadcast::channel(64);
        let cron_events = events.clone();
        let cron = CronService::new(CronServiceOptions {
            runtime_root: runtime_root.clone(),
            start_scheduler: true,
            on_event: Some(Arc::new(move |payload| {
                let _ = cron_events.send(json!({
                    "type": "cron",
                    "payload": payload
                }));
            })),
            ..CronServiceOptions::default()
        })
        .expect("create Rust cron service");
        Self {
            state_dir,
            agent_runtime: AgentRuntime::new(runtime_root.clone()),
            session_store: DesktopSessionStore::new(runtime_root.clone()),
            cron,
            runtime_root,
            auth_token: config.auth_token.map(Arc::from),
            auth_password: config.auth_password.map(Arc::from),
            started_at_ms: now_millis(),
            events,
            presence: Arc::new(std::sync::Mutex::new(initial_system_presence())),
            approvals: Arc::new(std::sync::Mutex::new(BTreeMap::new())),
            last_main_session_wake: Arc::new(std::sync::Mutex::new(None)),
            agent_run_events: Arc::new(std::sync::Mutex::new(BTreeMap::new())),
        }
    }
}

fn socket_addr(config: &GatewayRunConfig) -> SocketAddr {
    let ip = match config.bind {
        GatewayBind::Loopback => IpAddr::V4(Ipv4Addr::LOCALHOST),
        GatewayBind::Lan => IpAddr::V4(Ipv4Addr::UNSPECIFIED),
    };
    SocketAddr::new(ip, config.port)
}

fn resolve_gateway_state_dir() -> PathBuf {
    env::var_os("CRAWCLAW_STATE_DIR")
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(|| resolve_home_dir().join(".crawclaw"))
}

fn resolve_home_dir() -> PathBuf {
    env::var_os("HOME")
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."))
}

fn expand_user_path(path: &str) -> PathBuf {
    if path == "~" {
        return resolve_home_dir();
    }
    if let Some(stripped) = path.strip_prefix("~/") {
        return resolve_home_dir().join(stripped);
    }
    PathBuf::from(path)
}

async fn health() -> Json<GatewayHealth> {
    Json(GatewayHealth {
        ok: true,
        runtime: "ready".to_string(),
        implementation: "rust-native".to_string(),
    })
}

async fn ready() -> Json<GatewayHealth> {
    health().await
}

fn authorize_headers(headers: &HeaderMap, state: &GatewayState) -> Result<(), StatusCode> {
    if state.auth_token.is_none() && state.auth_password.is_none() {
        return Ok(());
    }
    let token = headers
        .get(GATEWAY_TOKEN_HEADER)
        .and_then(|value| value.to_str().ok())
        .or_else(|| bearer_token(headers));
    authorize_token(token, state)
}

fn authorize_token(token: Option<&str>, state: &GatewayState) -> Result<(), StatusCode> {
    if state.auth_token.is_none() && state.auth_password.is_none() {
        return Ok(());
    }
    let Some(token) = token else {
        return Err(StatusCode::UNAUTHORIZED);
    };
    if state.auth_token.as_deref() == Some(token) || state.auth_password.as_deref() == Some(token) {
        Ok(())
    } else {
        Err(StatusCode::UNAUTHORIZED)
    }
}

fn authorize_connect(state: &GatewayState, params: &Value) -> Result<(), String> {
    if state.auth_token.is_none() && state.auth_password.is_none() {
        return Ok(());
    }
    let connect = serde_json::from_value::<ConnectParams>(params.clone())
        .map_err(|error| format!("invalid connect params: {error}"))?;
    let auth = connect.auth.as_ref();
    if let Some(expected) = state.auth_token.as_deref() {
        let supplied = auth.and_then(|auth| auth.token.as_deref());
        return match supplied {
            Some(value) if value == expected => Ok(()),
            Some(_) => Err("gateway token mismatch".to_string()),
            None => Err("gateway token is required".to_string()),
        };
    }
    if let Some(expected) = state.auth_password.as_deref() {
        let supplied = auth.and_then(|auth| auth.password.as_deref());
        return match supplied {
            Some(value) if value == expected => Ok(()),
            Some(_) => Err("gateway password mismatch".to_string()),
            None => Err("gateway password is required".to_string()),
        };
    }
    Ok(())
}

fn auth_mode(state: &GatewayState) -> &'static str {
    if state.auth_token.is_some() {
        "token"
    } else if state.auth_password.is_some() {
        "password"
    } else {
        "none"
    }
}

fn bearer_token(headers: &HeaderMap) -> Option<&str> {
    let value = headers.get("authorization")?.to_str().ok()?.trim();
    value.strip_prefix("Bearer ").map(str::trim)
}

const ED25519_SPKI_PREFIX: &[u8] = &[
    0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x03, 0x21, 0x00,
];

fn gateway_identity_get(state: &GatewayState) -> Result<Value, String> {
    let path = state.state_dir.join("identity").join("device.json");
    let identity = load_or_create_device_identity(&path)?;
    Ok(json!({
        "deviceId": identity.device_id,
        "publicKey": base64url_encode(&identity.public_key_raw)
    }))
}

struct DeviceIdentity {
    device_id: String,
    public_key_raw: Vec<u8>,
}

fn load_or_create_device_identity(path: &Path) -> Result<DeviceIdentity, String> {
    if let Some(identity) = load_stored_device_identity(path)? {
        return Ok(identity);
    }
    generate_device_identity(path)
}

fn load_stored_device_identity(path: &Path) -> Result<Option<DeviceIdentity>, String> {
    let Ok(raw) = std::fs::read_to_string(path) else {
        return Ok(None);
    };
    let Ok(parsed) = serde_json::from_str::<Value>(&raw) else {
        return Ok(None);
    };
    if parsed.get("version").and_then(Value::as_u64) != Some(1) {
        return Ok(None);
    }
    let Some(public_key_pem) = parsed.get("publicKeyPem").and_then(Value::as_str) else {
        return Ok(None);
    };
    if parsed
        .get("privateKeyPem")
        .and_then(Value::as_str)
        .is_none()
    {
        return Ok(None);
    }
    let Some(public_key_raw) = public_key_raw_from_pem(public_key_pem) else {
        return Ok(None);
    };
    let device_id = sha256_hex(&public_key_raw);
    if parsed.get("deviceId").and_then(Value::as_str) != Some(device_id.as_str()) {
        let mut repaired = parsed;
        repaired["deviceId"] = Value::String(device_id.clone());
        write_identity_file(path, &repaired)?;
    }
    Ok(Some(DeviceIdentity {
        device_id,
        public_key_raw,
    }))
}

fn generate_device_identity(path: &Path) -> Result<DeviceIdentity, String> {
    let rng = ring::rand::SystemRandom::new();
    let pkcs8 = ring::signature::Ed25519KeyPair::generate_pkcs8(&rng)
        .map_err(|_| "failed to generate device identity".to_string())?;
    let key_pair = ring::signature::Ed25519KeyPair::from_pkcs8(pkcs8.as_ref())
        .map_err(|_| "failed to load generated device identity".to_string())?;
    let public_key_raw = key_pair.public_key().as_ref().to_vec();
    let device_id = sha256_hex(&public_key_raw);
    let public_key_der = ed25519_spki_der(&public_key_raw);
    let identity = json!({
        "version": 1,
        "deviceId": device_id,
        "publicKeyPem": pem_encode("PUBLIC KEY", &public_key_der),
        "privateKeyPem": pem_encode("PRIVATE KEY", pkcs8.as_ref()),
        "createdAtMs": now_millis() as u64
    });
    write_identity_file(path, &identity)?;
    Ok(DeviceIdentity {
        device_id,
        public_key_raw,
    })
}

fn public_key_raw_from_pem(public_key_pem: &str) -> Option<Vec<u8>> {
    let der = pem_decode(public_key_pem)?;
    if der.starts_with(ED25519_SPKI_PREFIX) && der.len() == ED25519_SPKI_PREFIX.len() + 32 {
        return Some(der[ED25519_SPKI_PREFIX.len()..].to_vec());
    }
    Some(der)
}

fn pem_decode(pem: &str) -> Option<Vec<u8>> {
    let body = pem
        .lines()
        .map(str::trim)
        .filter(|line| !line.starts_with("-----BEGIN ") && !line.starts_with("-----END "))
        .collect::<String>();
    STANDARD.decode(body).ok()
}

fn pem_encode(label: &str, der: &[u8]) -> String {
    let encoded = STANDARD.encode(der);
    let mut out = format!("-----BEGIN {label}-----\n");
    for chunk in encoded.as_bytes().chunks(64) {
        out.push_str(&String::from_utf8_lossy(chunk));
        out.push('\n');
    }
    out.push_str(&format!("-----END {label}-----\n"));
    out
}

fn ed25519_spki_der(public_key_raw: &[u8]) -> Vec<u8> {
    let mut der = Vec::with_capacity(ED25519_SPKI_PREFIX.len() + public_key_raw.len());
    der.extend_from_slice(ED25519_SPKI_PREFIX);
    der.extend_from_slice(public_key_raw);
    der
}

fn write_identity_file(path: &Path, value: &Value) -> Result<(), String> {
    write_json_file(path, value)?;
    set_owner_private_permissions(path);
    Ok(())
}

fn set_owner_private_permissions(path: &Path) {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600));
    }
    #[cfg(not(unix))]
    {
        let _ = path;
    }
}

fn base64url_encode(bytes: &[u8]) -> String {
    URL_SAFE_NO_PAD.encode(bytes)
}

fn sha256_hex(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    digest.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn emit(state: &GatewayState, event_type: &str, payload: Value) {
    let _ = state.events.send(json!({
        "type": event_type,
        "payload": payload
    }));
}

fn initial_system_presence() -> BTreeMap<String, Value> {
    let host = env::var("HOSTNAME")
        .or_else(|_| env::var("COMPUTERNAME"))
        .map(|value| value.trim().to_string())
        .ok()
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "localhost".to_string());
    let entry = json!({
        "host": host.clone(),
        "version": env!("CARGO_PKG_VERSION"),
        "mode": "gateway",
        "reason": "self",
        "text": format!("Gateway: {host} app {} mode gateway reason self", env!("CARGO_PKG_VERSION")),
        "ts": now_millis() as u64
    });
    let mut entries = BTreeMap::new();
    entries.insert(host.to_lowercase(), entry);
    entries
}

fn system_presence(state: &GatewayState) -> Result<Value, String> {
    let entries = state
        .presence
        .lock()
        .map_err(|_| "system presence lock poisoned".to_string())?;
    let mut values = entries.values().cloned().collect::<Vec<_>>();
    values.sort_by(|left, right| {
        let left_ts = left.get("ts").and_then(Value::as_u64).unwrap_or(0);
        let right_ts = right.get("ts").and_then(Value::as_u64).unwrap_or(0);
        right_ts.cmp(&left_ts)
    });
    Ok(Value::Array(values))
}

fn main_session_wake_last(state: &GatewayState) -> Result<Value, String> {
    let last = state
        .last_main_session_wake
        .lock()
        .map_err(|_| "main-session wake lock poisoned".to_string())?;
    Ok(last.clone().unwrap_or(Value::Null))
}

fn record_main_session_wake_event(
    state: &GatewayState,
    text: &str,
    result: &Value,
) -> Result<(), String> {
    let status = match result.get("status").and_then(Value::as_str) {
        Some("ok") => "sent",
        Some("skipped") => "skipped",
        Some("failed") | Some("error") => "failed",
        _ => "sent",
    };
    let mut event = Map::new();
    event.insert("ts".to_string(), json!(now_millis() as u64));
    event.insert("status".to_string(), Value::String(status.to_string()));
    event.insert("preview".to_string(), Value::String(text.to_string()));
    event.insert("reason".to_string(), Value::String("manual".to_string()));
    event.insert("channel".to_string(), Value::String("local".to_string()));
    event.insert("silent".to_string(), Value::Bool(false));
    event.insert("hasMedia".to_string(), Value::Bool(false));
    if status == "sent" {
        event.insert(
            "indicatorType".to_string(),
            Value::String("alert".to_string()),
        );
    }
    let event = Value::Object(event);
    let mut last = state
        .last_main_session_wake
        .lock()
        .map_err(|_| "main-session wake lock poisoned".to_string())?;
    *last = Some(event.clone());
    drop(last);
    emit(state, "main-session-wake", event);
    Ok(())
}

fn system_event(state: &GatewayState, params: Value) -> Result<Value, String> {
    let text = string_param(&params, &["text"]).ok_or_else(|| "text required".to_string())?;
    let mut entry = Map::new();
    entry.insert("text".to_string(), Value::String(text));
    entry.insert("ts".to_string(), json!(now_millis() as u64));
    for field in [
        "deviceId",
        "instanceId",
        "host",
        "ip",
        "version",
        "platform",
        "deviceFamily",
        "modelIdentifier",
        "mode",
        "reason",
    ] {
        if let Some(value) = string_param(&params, &[field]) {
            entry.insert(field.to_string(), Value::String(value));
        }
    }
    if let Some(value) = params.get("lastInputSeconds").and_then(Value::as_u64) {
        entry.insert("lastInputSeconds".to_string(), json!(value));
    }
    for field in ["roles", "scopes", "tags"] {
        if let Some(values) = string_array_param(&params, field) {
            entry.insert(field.to_string(), json!(values));
        }
    }

    let key = system_presence_key(&entry);
    let entry = Value::Object(entry);
    {
        let mut entries = state
            .presence
            .lock()
            .map_err(|_| "system presence lock poisoned".to_string())?;
        entries.insert(key, entry.clone());
    }
    emit(state, "presence", entry);
    Ok(json!({ "ok": true }))
}

fn string_array_param(input: &Value, key: &str) -> Option<Vec<String>> {
    let values = input.get(key)?.as_array()?;
    if !values.iter().all(Value::is_string) {
        return None;
    }
    let out = values
        .iter()
        .filter_map(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
        .collect::<Vec<_>>();
    if out.is_empty() {
        None
    } else {
        Some(out)
    }
}

fn media_urls_param(input: &Value) -> Vec<String> {
    let mut out = Vec::new();
    if let Some(value) = string_param(input, &["mediaUrl"]) {
        out.push(value);
    }
    if let Some(values) = string_array_param(input, "mediaUrls") {
        out.extend(values);
    }
    out
}

fn object_param(input: &Value, key: &str) -> BTreeMap<String, Value> {
    input
        .get(key)
        .and_then(Value::as_object)
        .map(|object| {
            object
                .iter()
                .map(|(field, value)| (field.clone(), value.clone()))
                .collect()
        })
        .unwrap_or_default()
}

fn system_presence_key(entry: &Map<String, Value>) -> String {
    for field in ["deviceId", "instanceId", "host", "ip"] {
        if let Some(value) = entry.get(field).and_then(Value::as_str) {
            let key = value.trim().to_lowercase();
            if !key.is_empty() {
                return key;
            }
        }
    }
    entry
        .get("text")
        .and_then(Value::as_str)
        .map(|value| value.chars().take(64).collect::<String>().to_lowercase())
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| "rust-gateway".to_string())
}

fn string_param(input: &Value, keys: &[&str]) -> Option<String> {
    keys.iter()
        .filter_map(|key| input.get(*key).and_then(Value::as_str))
        .map(str::trim)
        .find(|value| !value.is_empty())
        .map(ToOwned::to_owned)
}

fn bool_param(input: &Value, keys: &[&str]) -> Option<bool> {
    keys.iter().find_map(|key| {
        input.get(*key).and_then(|value| {
            value.as_bool().or_else(|| match value.as_str()?.trim() {
                "true" => Some(true),
                "false" => Some(false),
                _ => None,
            })
        })
    })
}

fn positive_integer_param(input: &Value, key: &str) -> Result<Option<u64>, String> {
    let Some(value) = input.get(key) else {
        return Ok(None);
    };
    if value.is_null() {
        return Ok(None);
    }
    let Some(number) = value.as_u64() else {
        return Err(format!("{key} must be a positive integer"));
    };
    if number == 0 {
        return Err(format!("{key} must be at least 1"));
    }
    Ok(Some(number))
}

fn required_param(input: &Value, keys: &[&str]) -> Result<String, String> {
    string_param(input, keys).ok_or_else(|| format!("missing required parameter: {}", keys[0]))
}

fn now_millis() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or(0)
}

fn now_timestamp_string() -> String {
    chrono::Utc::now().to_rfc3339()
}

#[cfg(test)]
mod tests;
