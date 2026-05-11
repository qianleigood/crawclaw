pub mod desktop {
    pub const SSE_EVENTS: &[&str] = &[
        "runtimeChanged",
        "sessionStarted",
        "messageDelta",
        "toolCall",
        "toolResult",
        "messageFinal",
        "permissionRequested",
        "operationFailed",
        "stateChanged",
        "session.message",
        "sessions.changed",
        "channel.lifecycle",
        "chat",
        "channel.send",
        "talk.mode",
        "voicewake.changed",
        "main-session-wake",
        "cron",
    ];
}

use std::collections::{BTreeMap, BTreeSet};
use std::convert::Infallible;
use std::env;
use std::io::Write;
use std::net::{IpAddr, Ipv4Addr, SocketAddr};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Arc;
use std::time::{Instant, SystemTime, UNIX_EPOCH};

use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::{Query, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::sse::{Event, KeepAlive, Sse};
use axum::response::IntoResponse;
use axum::routing::{get, post};
use axum::{Json, Router};
use base64::engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD};
use base64::Engine as _;
use crawclaw_runtime::{
    cron::{CronService, CronServiceOptions},
    memory::RustMemoryRuntime,
    special_agents::{special_agent_definitions, SpecialAgentRunRequest, SpecialAgentRunner},
    AgentRuntime, DesktopSessionStore,
};
use futures_util::{stream, Sink, SinkExt, StreamExt};
use ring::signature::KeyPair;
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};
use tokio::net::TcpListener;
use tokio::sync::broadcast;

const GATEWAY_TOKEN_HEADER: &str = "x-crawclaw-gateway-token";

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
    wizard_sessions: Arc<std::sync::Mutex<BTreeMap<String, WizardSessionRecord>>>,
    last_main_session_wake: Arc<std::sync::Mutex<Option<Value>>>,
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

#[derive(Clone, Debug)]
struct WizardSessionRecord {
    session_id: String,
    status: String,
    error: Option<String>,
    step: Option<Value>,
    created_at_ms: u64,
    updated_at_ms: u64,
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
    bootstrap_token: Option<String>,
    #[serde(default)]
    device_token: Option<String>,
    #[serde(default)]
    password: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct GatewayEventsQuery {
    token: Option<String>,
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
        .route("/api/desktop/bootstrap", get(desktop_bootstrap))
        .route("/api/desktop/state", get(desktop_state))
        .route("/api/desktop/runtime", get(runtime_status))
        .route("/api/gateway/events", get(events))
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
            wizard_sessions: Arc::new(std::sync::Mutex::new(BTreeMap::new())),
            last_main_session_wake: Arc::new(std::sync::Mutex::new(None)),
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

async fn ws(ws: WebSocketUpgrade, State(state): State<GatewayState>) -> impl IntoResponse {
    ws.on_upgrade(move |socket| handle_ws(socket, state))
}

async fn handle_ws(socket: WebSocket, state: GatewayState) {
    let nonce = format!("rust-{}", now_millis());
    let (mut sender, mut receiver) = socket.split();
    let _ = sender
        .send(Message::Text(
            json!({
                "type": "event",
                "event": "connect.challenge",
                "payload": { "nonce": nonce }
            })
            .to_string()
            .into(),
        ))
        .await;

    let mut connected = false;
    let mut gateway_events = state.events.subscribe();
    let mut session_events_subscribed = false;
    let mut session_message_subscriptions = BTreeSet::<String>::new();
    loop {
        tokio::select! {
            message = receiver.next() => {
                let Some(message) = message else {
                    break;
                };
                let Ok(message) = message else {
                    break;
                };
                let Message::Text(raw) = message else {
                    continue;
                };
                let request = match serde_json::from_str::<GatewayWsRequest>(&raw) {
                    Ok(request) if request.frame_type == "req" => request,
                    Ok(request) => {
                        let _ = send_ws_error(
                            &mut sender,
                            &request.id,
                            "INVALID_REQUEST",
                            "unsupported gateway frame type",
                        )
                        .await;
                        continue;
                    }
                    Err(error) => {
                        let _ = send_ws_event(
                            &mut sender,
                            "operationFailed",
                            json!({ "message": format!("invalid gateway frame: {error}") }),
                        )
                        .await;
                        continue;
                    }
                };

                if request.method == "connect" {
                    match authorize_connect(&state, &request.params) {
                        Ok(()) => {
                            connected = true;
                            let hello = hello_ok(&state);
                            let _ = send_ws_ok(&mut sender, &request.id, hello).await;
                        }
                        Err(message) => {
                            let _ = send_ws_error(&mut sender, &request.id, "UNAUTHORIZED", &message).await;
                        }
                    }
                    continue;
                }

                if !connected {
                    let _ = send_ws_error(
                        &mut sender,
                        &request.id,
                        "UNAUTHORIZED",
                        "gateway connect is required before requests",
                    )
                    .await;
                    continue;
                }

                let method = request.method.clone();
                match handle_gateway_method(&state, &method, request.params).await {
                    Ok(payload) => {
                        apply_ws_subscription_state(
                            &method,
                            &payload,
                            &mut session_events_subscribed,
                            &mut session_message_subscriptions,
                        );
                        let _ = send_ws_ok(&mut sender, &request.id, payload).await;
                    }
                    Err(message) => {
                        let _ = send_ws_error(&mut sender, &request.id, "UNAVAILABLE", &message).await;
                    }
                }
            }
            event = gateway_events.recv(), if connected => {
                let Ok(event) = event else {
                    continue;
                };
                if !should_forward_ws_event(&event, session_events_subscribed, &session_message_subscriptions) {
                    continue;
                }
                let event_type = event.get("type").and_then(Value::as_str).unwrap_or("event");
                let payload = event.get("payload").cloned().unwrap_or(Value::Null);
                if send_ws_event(&mut sender, event_type, payload).await.is_err() {
                    break;
                }
            }
        }
    }
}

async fn send_ws_ok<S>(socket: &mut S, id: &str, payload: Value) -> Result<(), axum::Error>
where
    S: Sink<Message, Error = axum::Error> + Unpin,
{
    socket
        .send(Message::Text(
            json!({
                "type": "res",
                "id": id,
                "ok": true,
                "payload": payload
            })
            .to_string()
            .into(),
        ))
        .await
}

async fn send_ws_error<S>(
    socket: &mut S,
    id: &str,
    code: &str,
    message: &str,
) -> Result<(), axum::Error>
where
    S: Sink<Message, Error = axum::Error> + Unpin,
{
    socket
        .send(Message::Text(
            json!({
                "type": "res",
                "id": id,
                "ok": false,
                "error": {
                    "code": code,
                    "message": message
                }
            })
            .to_string()
            .into(),
        ))
        .await
}

async fn send_ws_event<S>(socket: &mut S, event: &str, payload: Value) -> Result<(), axum::Error>
where
    S: Sink<Message, Error = axum::Error> + Unpin,
{
    socket
        .send(Message::Text(
            json!({
                "type": "event",
                "event": event,
                "payload": payload
            })
            .to_string()
            .into(),
        ))
        .await
}

fn apply_ws_subscription_state(
    method: &str,
    payload: &Value,
    session_events_subscribed: &mut bool,
    session_message_subscriptions: &mut BTreeSet<String>,
) {
    match method {
        "sessions.subscribe" => *session_events_subscribed = true,
        "sessions.unsubscribe" => *session_events_subscribed = false,
        "sessions.messages.subscribe" => {
            if let Some(key) = payload.get("key").and_then(Value::as_str) {
                session_message_subscriptions.insert(key.to_string());
            }
        }
        "sessions.messages.unsubscribe" => {
            if let Some(key) = payload.get("key").and_then(Value::as_str) {
                session_message_subscriptions.remove(key);
            }
        }
        _ => {}
    }
}

fn should_forward_ws_event(
    event: &Value,
    session_events_subscribed: bool,
    session_message_subscriptions: &BTreeSet<String>,
) -> bool {
    match event
        .get("type")
        .and_then(Value::as_str)
        .unwrap_or_default()
    {
        "session.message" => event
            .get("payload")
            .and_then(|payload| payload.get("sessionKey"))
            .and_then(Value::as_str)
            .map(|session_key| session_message_subscriptions.contains(session_key))
            .unwrap_or(false),
        "sessions.changed" => session_events_subscribed,
        _ => true,
    }
}

async fn runtime_status(State(state): State<GatewayState>) -> Json<Value> {
    Json(runtime_status_value(&state))
}

async fn desktop_bootstrap(State(state): State<GatewayState>) -> Json<Value> {
    Json(json!({
        "app": {
            "name": "CrawClaw",
            "version": env!("CARGO_PKG_VERSION")
        },
        "api": {
            "eventsUrl": "/api/gateway/events",
            "rpcUrl": "/api/gateway/rpc"
        },
        "runtime": runtime_status_value(&state),
        "desktopState": desktop_state_value(&state)
    }))
}

async fn desktop_state(State(state): State<GatewayState>) -> Json<Value> {
    Json(desktop_state_value(&state))
}

async fn events(
    State(state): State<GatewayState>,
    Query(query): Query<GatewayEventsQuery>,
) -> Result<Sse<impl futures_util::Stream<Item = Result<Event, Infallible>>>, StatusCode> {
    authorize_token(query.token.as_deref(), &state)?;
    let initial_data =
        serde_json::to_string(&runtime_status_value(&state)).unwrap_or_else(|_| "{}".to_string());
    let initial_stream =
        stream::once(
            async move { Ok(Event::default().event("runtimeChanged").data(initial_data)) },
        );
    let receiver = state.events.subscribe();
    let updates = stream::unfold(receiver, |mut receiver| async move {
        loop {
            match receiver.recv().await {
                Ok(event) => return Some((Ok(json_event_to_sse(event)), receiver)),
                Err(broadcast::error::RecvError::Lagged(_)) => continue,
                Err(broadcast::error::RecvError::Closed) => return None,
            }
        }
    });
    Ok(Sse::new(initial_stream.chain(updates)).keep_alive(KeepAlive::default()))
}

async fn rpc(
    State(state): State<GatewayState>,
    headers: HeaderMap,
    Json(request): Json<GatewayRpcRequest>,
) -> Result<Json<GatewayRpcResponse>, StatusCode> {
    authorize_headers(&headers, &state)?;
    let id = request.id.clone();
    match handle_gateway_method(&state, &request.method, request.params).await {
        Ok(result) => Ok(Json(GatewayRpcResponse {
            ok: true,
            id,
            result: Some(result),
            error: None,
        })),
        Err(error) => Ok(Json(GatewayRpcResponse {
            ok: false,
            id,
            result: None,
            error: Some(error),
        })),
    }
}

async fn handle_gateway_method(
    state: &GatewayState,
    method: &str,
    params: Value,
) -> Result<Value, String> {
    match method {
        "health" | "status" | "system.status" | "system.health" => Ok(json!({
            "runtime": "rust",
            "status": "ok",
            "implementation": "rust-native",
            "gatewayMethods": gateway_methods()
        })),
        "config.get" => config_get(state, params),
        "config.set" => config_set(state, params),
        "config.apply" => config_apply(state, params),
        "config.patch" => config_patch(state, params),
        "config.schema" => config_schema(),
        "config.schema.lookup" => config_schema_lookup(params),
        "secrets.reload" => secrets_reload(state),
        "secrets.resolve" => secrets_resolve(state, params),
        "tools.catalog" => Ok(tools_catalog(params)),
        "tools.effective" => Ok(tools_effective(params)),
        "models.list" => Ok(models_list()),
        "agents.list" => Ok(agents_list(state)),
        "logs.tail" => Ok(logs_tail()),
        "usage.status" => Ok(usage_status(state)),
        "usage.cost" => usage_cost(state, params),
        "doctor.memory.status" => doctor_memory_status(state),
        "agentRuntime.summary" => agent_runtime_summary(state, params),
        "agentRuntime.list" => agent_runtime_list(state, params),
        "agentRuntime.get" => agent_runtime_get(state, params),
        "agentRuntime.cancel" => agent_runtime_cancel(state, params),
        "agent.identity.get" => Ok(agent_identity(state)),
        "agent.inspect" => agent_inspect(state, params),
        "agent.observations.list" => agent_observations_list(state, params),
        "agent.wait" => agent_wait(state, params),
        "agents.create" => agents_create(state, params),
        "agents.update" => agents_update(state, params),
        "agents.delete" => agents_delete(state, params),
        "agents.files.list" => agents_files_list(state, params),
        "agents.files.get" => agents_files_get(state, params),
        "agents.files.set" => agents_files_set(state, params),
        "skills.status" => Ok(skills_status(state, params)),
        "skills.bins" => Ok(skills_bins(state)),
        "skills.install" => skills_install(state, params),
        "skills.update" => skills_update(state, params),
        "wizard.start" => wizard_start(state, params),
        "wizard.next" => wizard_next(state, params),
        "wizard.cancel" => wizard_cancel(state, params),
        "wizard.status" => wizard_status(state, params),
        "plugins.list" => plugins_list(state),
        "plugins.enable" => plugins_set_enabled(state, params, true),
        "plugins.disable" => plugins_set_enabled(state, params, false),
        "plugins.install" => plugins_install(state, params),
        "plugins.update" => plugins_update(state, params),
        "plugins.uninstall" => plugins_uninstall(state, params),
        "exec.approvals.get" => approvals_snapshot(state, "exec"),
        "exec.approvals.set" => approvals_set(state, params, "exec"),
        "exec.approval.request" => approval_request(state, params, "exec.approval"),
        "exec.approval.waitDecision" => approval_wait_decision(state, params),
        "exec.approval.resolve" => approval_resolve(state, params, "exec.approval"),
        "plugin.approval.request" => approval_request(state, params, "plugin.approval"),
        "plugin.approval.waitDecision" => approval_wait_decision(state, params),
        "plugin.approval.resolve" => approval_resolve(state, params, "plugin.approval"),
        "channels.status" => channels_status(state),
        "channels.setup.surface" => channels_setup_surface(state, params),
        "channels.config.get" => channels_config_get(state, params),
        "channels.config.schema" => Ok(channels_config_schema()),
        "channels.config.patch" => channels_config_patch(state, params),
        "channels.config.apply" => channels_config_apply(state, params),
        "channels.logout"
        | "channels.account.logout"
        | "channels.account.reconnect"
        | "channels.account.verify"
        | "channels.account.login.start"
        | "channels.account.login.wait"
        | "channels.login.start"
        | "channels.login.wait" => channel_action(state, method, params),
        "tts.status" => Ok(tts_status(state)),
        "tts.providers" => Ok(tts_providers(state)),
        "tts.enable" => tts_set_enabled(state, true),
        "tts.disable" => tts_set_enabled(state, false),
        "tts.setProvider" => tts_set_provider(state, params),
        "tts.convert" => tts_convert(state, params),
        "talk.config" => talk_config(state),
        "talk.mode" => talk_mode(state, params),
        "talk.speak" => talk_speak(state, params),
        "voice.getOverview" => Ok(voice_overview(state)),
        "voice.qwen3Tts.preview" | "voice.qwen3Tts.uploadReferenceAudio" => {
            voice_qwen3_tts(state, method, params)
        }
        "voicewake.get" => Ok(voicewake_get(state)),
        "voicewake.set" => voicewake_set(state, params),
        "update.run" => update_run(state, params),
        "last-main-session-wake" | "system.mainSessionWake.last" => main_session_wake_last(state),
        "gateway.identity.get" => gateway_identity_get(state),
        "system-presence" => system_presence(state),
        "system-event" => system_event(state, params),
        "send" => channel_send(state, params),
        "device.pair.list" => device_pair_list(state),
        "device.pair.approve" => device_pair_approve(state, params),
        "device.pair.reject" => device_pair_reject(state, params),
        "device.pair.remove" => device_pair_remove(state, params),
        "device.token.rotate" => device_token_rotate(state, params),
        "device.token.revoke" => device_token_revoke(state, params),
        "esp32.status.get" => esp32_status_get(state),
        "esp32.pairing.start" => esp32_pairing_start(state, params),
        "esp32.pairing.requests.list" => esp32_pairing_requests_list(state),
        "esp32.pairing.request.approve" => esp32_pairing_request_approve(state, params),
        "esp32.pairing.request.reject" => esp32_pairing_request_reject(state, params),
        "esp32.pairing.session.revoke" => esp32_pairing_session_revoke(state, params),
        "esp32.devices.list" => esp32_devices_list(state),
        "esp32.devices.get" => esp32_device_get(state, params),
        "esp32.devices.revoke" => esp32_devices_revoke(state, params),
        "esp32.devices.command.send" => esp32_device_command_send(state, params),
        "workflow.list" => workflow_list(state, params),
        "workflow.match" => workflow_match(state, params),
        "workflow.runs" => workflow_runs(state, params),
        "workflow.get" | "workflow.n8n.get" => workflow_get(state, params),
        "workflow.enable" | "workflow.disable" | "workflow.archive" | "workflow.unarchive"
        | "workflow.delete" | "workflow.deploy" => workflow_mutation(state, method, params),
        "workflow.run" => workflow_run(state, params),
        "workflow.status" | "workflow.cancel" | "workflow.resume" => {
            workflow_execution_action(state, method, params)
        }
        "workflow.agent.run" => workflow_agent_run(state, params),
        "chat.history" => chat_history(state, params),
        "chat.inject" => chat_inject(state, params),
        "chat.abort" => chat_abort(params),
        "chat.send" => chat_send(state, params).await,
        "wake" | "cron.status" | "cron.list" | "cron.add" | "cron.update" | "cron.remove"
        | "cron.run" | "cron.runs" => {
            let wake_text = if method == "wake" {
                Some(
                    string_param(&params, &["text", "message"])
                        .unwrap_or_else(|| "cron wake".to_string()),
                )
            } else {
                None
            };
            let result = state.cron.handle_method(method, params).await?;
            if let Some(text) = wake_text {
                record_main_session_wake_event(state, &text, &result)?;
            }
            emit(state, "cron", result.clone());
            Ok(result)
        }
        "agent" => run_agent(state, params).await,
        "special_agents.list" | "special_agents_list" => Ok(json!({
            "status": "ok",
            "agents": special_agent_definitions()
        })),
        "special_agents.run" | "special_agents_run" => {
            let request = serde_json::from_value::<SpecialAgentRunRequest>(params)
                .map_err(|error| format!("invalid special_agents.run params: {error}"))?;
            let response = SpecialAgentRunner::new(state.runtime_root.clone()).run(request)?;
            Ok(json!(response))
        }
        "review_task" => {
            let task = required_param(&params, &["task", "message"])?;
            let quality = string_param(&params, &["stage", "kind"])
                .map(|stage| stage != "spec")
                .unwrap_or(true);
            SpecialAgentRunner::new(state.runtime_root.clone()).run_review_task(&task, quality)
        }
        "memory.status" | "memory_status" => memory_runtime(state).status(),
        "memory.refresh" | "memory_refresh" => Ok(json!({
            "status": "ok",
            "provider": memory_runtime(state).refresh_notebooklm()?
        })),
        "memory.login" | "memory_login" => Ok(json!({
            "status": "ok",
            "provider": memory_runtime(state).login_notebooklm()?
        })),
        "memory.sync"
        | "memory_sync"
        | "memory.experience.sync.flush"
        | "memory_experience_sync_flush" => memory_runtime(state).sync_experience_outbox(),
        "memory.admin.overview" | "memory_admin_overview" => {
            let runtime = memory_runtime(state);
            Ok(json!({
                "status": "ok",
                "implementation": "rust-native",
                "runtime": runtime.info(),
                "memory": runtime.status()?,
                "dream": runtime.dream_store().status()?,
                "experience": {
                    "entries": runtime.experience_store().list()?
                }
            }))
        }
        "memory.durable.index.list" | "memory_durable_index_list" => {
            let scope =
                string_param(&params, &["scope", "agentId"]).unwrap_or_else(|| "main".to_string());
            let limit = params
                .get("limit")
                .and_then(Value::as_u64)
                .unwrap_or(50)
                .min(500) as usize;
            memory_runtime(state).durable_index_list(&scope, limit)
        }
        "memory.durable.index.get" | "memory_durable_index_get" => {
            let scope =
                string_param(&params, &["scope", "agentId"]).unwrap_or_else(|| "main".to_string());
            let id = required_param(&params, &["id", "notePath", "path"])?;
            memory_runtime(state).durable_index_get(&scope, &id)
        }
        "memory.dream.status" | "memory_dream_status" => {
            memory_runtime(state).dream_store().status()
        }
        "memory.dream.history" | "memory_dream_history" => Ok(json!({
            "status": "ok",
            "history": memory_runtime(state).dream_store().history()?
        })),
        "memory.dream.run" | "memory_dream_run" => {
            let scope =
                string_param(&params, &["scope", "agentId"]).unwrap_or_else(|| "main".to_string());
            let task = string_param(&params, &["task", "message"]).unwrap_or_default();
            let result = memory_runtime(state).dream_store().run(&scope, &task)?;
            emit(
                state,
                "specialAgent.result",
                json!({ "kind": "dream", "result": result }),
            );
            Ok(json!({
                "status": "completed",
                "kind": "dream",
                "result": result
            }))
        }
        "memory.session_summary.status"
        | "memory_session_summary_status"
        | "memory.sessionSummary.status" => {
            let scope = string_param(&params, &["scope", "agentId", "sessionKey"])
                .or_else(|| string_param(&params, &["sessionId"]))
                .unwrap_or_else(|| "main".to_string());
            memory_runtime(state).session_summary_store().status(&scope)
        }
        "memory.session_summary.refresh"
        | "memory_session_summary_refresh"
        | "memory.sessionSummary.refresh" => {
            let scope = string_param(&params, &["scope", "agentId", "sessionKey"])
                .or_else(|| string_param(&params, &["sessionId"]))
                .unwrap_or_else(|| "main".to_string());
            let content =
                string_param(&params, &["content", "summary", "message"]).unwrap_or_default();
            let result = memory_runtime(state)
                .session_summary_store()
                .refresh(&scope, &content)?;
            emit(
                state,
                "specialAgent.result",
                json!({ "kind": "session-summary", "result": result }),
            );
            Ok(json!({
                "status": "completed",
                "kind": "session-summary",
                "result": result
            }))
        }
        "memory.experience.outbox.list" | "memory_experience_outbox_list" => Ok(json!({
            "status": "ok",
            "entries": memory_runtime(state).experience_store().list()?
        })),
        "memory.experience.outbox.updateStatus" | "memory_experience_outbox_update_status" => {
            let entry_id = required_param(&params, &["id", "entryId"])?;
            let status = required_param(&params, &["status"])?;
            memory_runtime(state)
                .experience_store()
                .update_status(&entry_id, &status)
        }
        "memory.experience.outbox.prune" | "memory_experience_outbox_prune" => {
            memory_runtime(state).experience_store().prune()
        }
        "memory.promptJournal.summary" | "memory_prompt_journal_summary" => {
            memory_prompt_journal_summary(state, params)
        }
        "memory.bootstrap" | "memory_bootstrap" => {
            let session_id = required_param(&params, &["sessionId"])?;
            let session_key = string_param(&params, &["sessionKey"]);
            memory_runtime(state).bootstrap(&session_id, session_key.as_deref())
        }
        "memory.ingestBatch" | "memory_ingest_batch" => {
            let session_id = required_param(&params, &["sessionId"])?;
            let session_key = string_param(&params, &["sessionKey"]);
            let messages = params
                .get("messages")
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default();
            memory_runtime(state).ingest_batch(&session_id, session_key.as_deref(), &messages)
        }
        "memory.assemble" | "memory_assemble" => {
            let session_id = required_param(&params, &["sessionId"])?;
            let messages = params
                .get("messages")
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default();
            let prompt = string_param(&params, &["prompt"]);
            memory_runtime(state).assemble(&session_id, messages, prompt.as_deref())
        }
        "memory.compact" | "memory_compact" => {
            let session_id = required_param(&params, &["sessionId"])?;
            let force = params
                .get("force")
                .and_then(Value::as_bool)
                .unwrap_or(false);
            memory_runtime(state).compact(&session_id, force)
        }
        "sessions.list" | "sessions_list" => sessions_list(state),
        "sessions.create" => sessions_create(state, params),
        "sessions.preview" => sessions_preview(state, params),
        "sessions.resolve" => sessions_resolve(state, params),
        "sessions.patch" => sessions_patch(state, params),
        "sessions.reset" => sessions_reset(state, params),
        "sessions.delete" => sessions_delete(state, params),
        "sessions.compact" => sessions_compact(state, params),
        "sessions.abort" => chat_abort(params),
        "sessions.status" | "session_status" => {
            let session_key =
                string_param(&params, &["sessionKey", "key"]).unwrap_or_else(|| "main".to_string());
            Ok(json!({
                "session": state.session_store.session_status(&session_key).map_err(|error| error.to_string())?
            }))
        }
        "sessions.get" | "sessions.history" | "sessions_history" => {
            let session_key = required_param(&params, &["sessionKey", "key"])?;
            Ok(json!({
                "sessionKey": session_key,
                "messages": state.session_store.session_history(&session_key).map_err(|error| error.to_string())?
            }))
        }
        "sessions.send" | "sessions_send" => {
            let session_key = required_param(&params, &["sessionKey", "key"])?;
            let message = required_param(&params, &["message", "text"])?;
            let session = state
                .session_store
                .send_to_session(&session_key, &message)
                .map_err(|error| error.to_string())?;
            emit(
                state,
                "session.message",
                json!({
                    "sessionKey": session_key,
                    "role": "user",
                    "content": message
                }),
            );
            emit(state, "sessions.changed", json!({ "session": session }));
            Ok(json!({ "status": "sent", "session": session }))
        }
        "sessions.spawn" | "sessions_spawn" => {
            let task = required_param(&params, &["task", "message"])?;
            let parent = string_param(&params, &["parentSessionKey", "parent", "spawnedBy"]);
            let label = string_param(&params, &["label"]);
            let session = state
                .session_store
                .spawn_session(parent.as_deref(), label.as_deref(), &task)
                .map_err(|error| error.to_string())?;
            emit(state, "sessionStarted", json!({ "session": session }));
            emit(state, "sessions.changed", json!({ "session": session }));
            Ok(json!({ "status": "spawned", "session": session }))
        }
        "sessions.yield" | "sessions_yield" => {
            let session_key =
                string_param(&params, &["sessionKey", "key"]).unwrap_or_else(|| "main".to_string());
            let session = state
                .session_store
                .mark_session_yielded(&session_key)
                .map_err(|error| error.to_string())?;
            emit(state, "sessions.changed", json!({ "session": session }));
            Ok(json!({ "status": "yielded", "session": session }))
        }
        "sessions.subscribe" => Ok(json!({ "subscribed": true })),
        "sessions.unsubscribe" => Ok(json!({ "subscribed": false })),
        "sessions.messages.subscribe" => sessions_messages_subscription(state, params, true),
        "sessions.messages.unsubscribe" => sessions_messages_subscription(state, params, false),
        "subagents" | "subagents.list" => {
            let parent = string_param(&params, &["parentSessionKey", "parent", "spawnedBy"]);
            Ok(json!({
                "subagents": state.session_store.list_subagents(parent.as_deref()).map_err(|error| error.to_string())?
            }))
        }
        other => Err(format!("Unsupported Rust Gateway method: {other}")),
    }
}

fn config_path(state: &GatewayState) -> PathBuf {
    if let Some(value) = env::var_os("CRAWCLAW_CONFIG_PATH").filter(|value| !value.is_empty()) {
        return PathBuf::from(value);
    }
    state.state_dir.join("crawclaw.json")
}

fn config_get(state: &GatewayState, params: Value) -> Result<Value, String> {
    let path = config_path(state);
    let exists = path.exists();
    let config = read_config_value(&path)?;
    if let Some(key) = string_param(&params, &["key", "path"]) {
        return Ok(json!({
            "exists": exists,
            "path": path.to_string_lossy(),
            "key": key,
            "value": get_json_path(&config, &key).cloned()
        }));
    }
    Ok(json!({
        "exists": exists,
        "path": path.to_string_lossy(),
        "config": config
    }))
}

fn config_set(state: &GatewayState, params: Value) -> Result<Value, String> {
    let key = required_param(&params, &["key", "path"])?;
    let value = params.get("value").cloned().unwrap_or(Value::Null);
    let path = config_path(state);
    let mut config = read_config_value(&path)?;
    set_json_path(&mut config, &key, value)?;
    write_config_value(&path, &config)?;
    Ok(json!({ "ok": true, "path": path.to_string_lossy(), "config": config }))
}

fn config_apply(state: &GatewayState, params: Value) -> Result<Value, String> {
    let config = params
        .get("config")
        .or_else(|| params.get("value"))
        .cloned()
        .unwrap_or(params);
    if !config.is_object() {
        return Err("config.apply requires an object config".to_string());
    }
    let path = config_path(state);
    write_config_value(&path, &config)?;
    Ok(json!({ "ok": true, "path": path.to_string_lossy(), "config": config }))
}

fn config_patch(state: &GatewayState, params: Value) -> Result<Value, String> {
    let patch = if let Some(raw) = string_param(&params, &["raw"]) {
        serde_json::from_str::<Value>(&raw)
            .map_err(|error| format!("invalid config.patch raw JSON: {error}"))?
    } else {
        params.get("patch").cloned().unwrap_or(params)
    };
    if !patch.is_object() {
        return Err("config.patch requires an object patch".to_string());
    }
    let path = config_path(state);
    let mut config = read_config_value(&path)?;
    merge_json(&mut config, patch);
    write_config_value(&path, &config)?;
    Ok(json!({ "ok": true, "path": path.to_string_lossy(), "config": config }))
}

fn config_schema() -> Result<Value, String> {
    Ok(json!({
        "version": "rust-baseline-v1",
        "schema": {
            "type": "object",
            "properties": {
                "gateway": {
                    "type": "object",
                    "properties": {
                        "port": { "type": "integer" },
                        "bind": { "type": "string" }
                    }
                },
                "tools": {
                    "type": "object",
                    "properties": {
                        "deny": { "type": "array", "items": { "type": "string" } }
                    }
                }
            }
        },
        "uiHints": {
            "gateway": { "label": "Gateway" },
            "gateway.port": { "label": "Port" },
            "tools": { "label": "Tools" }
        }
    }))
}

fn config_schema_lookup(params: Value) -> Result<Value, String> {
    let path = string_param(&params, &["path"]).unwrap_or_default();
    let children = match path.as_str() {
        "" => vec![
            json!({ "key": "gateway", "path": "gateway", "label": "Gateway" }),
            json!({ "key": "tools", "path": "tools", "label": "Tools" }),
        ],
        "gateway" => vec![
            json!({ "key": "port", "path": "gateway.port", "label": "Port" }),
            json!({ "key": "bind", "path": "gateway.bind", "label": "Bind" }),
        ],
        "tools" => vec![json!({ "key": "deny", "path": "tools.deny", "label": "Deny" })],
        _ => Vec::new(),
    };
    Ok(json!({ "path": path, "children": children }))
}

fn secrets_reload(state: &GatewayState) -> Result<Value, String> {
    let config = read_config_value(&config_path(state))?;
    let mut refs = Vec::<(String, Value)>::new();
    collect_config_secret_refs(&config, "", &mut refs);
    let mut diagnostics = Vec::new();
    let mut inactive_ref_paths = Vec::new();
    for (path, value) in &refs {
        match resolve_secret_value(state, path, value) {
            Ok(Some(_)) => {}
            Ok(None) => inactive_ref_paths.push(path.clone()),
            Err(message) => {
                inactive_ref_paths.push(path.clone());
                diagnostics.push(message);
            }
        }
    }
    Ok(json!({
        "ok": true,
        "warningCount": diagnostics.len(),
        "checkedRefCount": refs.len(),
        "diagnostics": diagnostics,
        "inactiveRefPaths": inactive_ref_paths
    }))
}

fn secrets_resolve(state: &GatewayState, params: Value) -> Result<Value, String> {
    let target_ids = params
        .get("targetIds")
        .and_then(Value::as_array)
        .ok_or_else(|| "secrets.resolve requires targetIds".to_string())?;
    let config = read_config_value(&config_path(state))?;
    let mut assignments = Vec::new();
    let mut diagnostics = Vec::new();
    let mut inactive_ref_paths = Vec::new();

    for target_id in target_ids {
        let Some(target_id) = target_id.as_str().filter(|value| !value.trim().is_empty()) else {
            return Err("secrets.resolve targetIds must be non-empty strings".to_string());
        };
        let path_segments = target_id
            .split('.')
            .filter(|segment| !segment.trim().is_empty())
            .collect::<Vec<_>>();
        if path_segments.is_empty() {
            return Err("secrets.resolve targetId cannot be empty".to_string());
        }
        let Some(value) = get_json_path(&config, target_id) else {
            inactive_ref_paths.push(target_id.to_string());
            diagnostics.push(format!("No configured secret value found at {target_id}."));
            continue;
        };

        match resolve_secret_value(state, target_id, value) {
            Ok(Some(secret_value)) => assignments.push(json!({
                "path": target_id,
                "pathSegments": path_segments,
                "value": secret_value
            })),
            Ok(None) => {
                inactive_ref_paths.push(target_id.to_string());
            }
            Err(message) => {
                inactive_ref_paths.push(target_id.to_string());
                diagnostics.push(message);
            }
        }
    }

    Ok(json!({
        "ok": true,
        "assignments": assignments,
        "diagnostics": diagnostics,
        "inactiveRefPaths": inactive_ref_paths
    }))
}

fn collect_config_secret_refs(value: &Value, path: &str, refs: &mut Vec<(String, Value)>) {
    match value {
        Value::Object(object) => {
            if is_secret_ref_object(object) {
                refs.push((path.to_string(), value.clone()));
                return;
            }
            for (key, child) in object {
                let child_path = if path.is_empty() {
                    key.to_string()
                } else {
                    format!("{path}.{key}")
                };
                collect_config_secret_refs(child, &child_path, refs);
            }
        }
        Value::Array(items) => {
            for (index, child) in items.iter().enumerate() {
                let child_path = if path.is_empty() {
                    format!("[{index}]")
                } else {
                    format!("{path}[{index}]")
                };
                collect_config_secret_refs(child, &child_path, refs);
            }
        }
        _ => {}
    }
}

fn is_secret_ref_object(object: &Map<String, Value>) -> bool {
    let source = object
        .get("source")
        .or_else(|| object.get("type"))
        .and_then(Value::as_str)
        .unwrap_or_default();
    matches!(source, "env" | "file" | "exec")
        && object
            .get("id")
            .or_else(|| object.get("name"))
            .or_else(|| object.get("path"))
            .and_then(Value::as_str)
            .map(|value| !value.trim().is_empty())
            .unwrap_or(false)
}

fn resolve_secret_value(
    state: &GatewayState,
    target_id: &str,
    value: &Value,
) -> Result<Option<Value>, String> {
    if let Some(raw) = value.as_str() {
        return Ok(Some(Value::String(raw.to_string())));
    }
    let Some(object) = value.as_object() else {
        return Ok(Some(value.clone()));
    };
    let source = object
        .get("source")
        .or_else(|| object.get("type"))
        .or_else(|| object.get("provider"))
        .and_then(Value::as_str)
        .unwrap_or_default();
    let id = object
        .get("id")
        .or_else(|| object.get("name"))
        .or_else(|| object.get("path"))
        .and_then(Value::as_str)
        .unwrap_or_default();

    match source {
        "env" => match env::var(id) {
            Ok(secret) => Ok(Some(Value::String(secret))),
            Err(_) => Err(format!(
                "Environment variable {id} for {target_id} is not set."
            )),
        },
        "file" => {
            let path = expand_user_path(id);
            let path = if path.is_absolute() {
                path
            } else {
                state.state_dir.join(path)
            };
            match std::fs::read_to_string(&path) {
                Ok(secret) => Ok(Some(Value::String(secret.trim_end().to_string()))),
                Err(error) => Err(format!(
                    "Failed to read file secret {} for {target_id}: {error}",
                    path.display()
                )),
            }
        }
        "exec" => Err(format!(
            "Exec SecretRef resolution for {target_id} is not enabled in the Rust Gateway."
        )),
        "" => Ok(Some(value.clone())),
        other => Err(format!(
            "Unsupported SecretRef source {other} for {target_id}."
        )),
    }
}

fn tools_catalog(params: Value) -> Value {
    let agent_id = string_param(&params, &["agentId"]).unwrap_or_else(|| "main".to_string());
    json!({
        "agentId": agent_id,
        "profiles": tool_profiles(),
        "groups": [{
            "id": "core",
            "label": "Core tools",
            "source": "core",
            "tools": crawclaw_runtime::rust_core_tool_definitions()
                .iter()
                .map(tool_catalog_entry)
                .collect::<Vec<_>>()
        }]
    })
}

fn tools_effective(params: Value) -> Value {
    let agent_id = string_param(&params, &["agentId"]).unwrap_or_else(|| "main".to_string());
    let profile = if params.get("sessionKey").is_some() {
        "coding"
    } else {
        "full"
    };
    json!({
        "agentId": agent_id,
        "profile": profile,
        "groups": [{
            "id": "core",
            "label": "Core tools",
            "source": "core",
            "tools": crawclaw_runtime::rust_core_tool_definitions()
                .iter()
                .filter(|definition| definition.default_enabled)
                .map(tool_effective_entry)
                .collect::<Vec<_>>()
        }],
        "unavailableTools": [],
        "diagnostics": []
    })
}

fn tool_profiles() -> Vec<Value> {
    vec![
        json!({ "id": "minimal", "label": "Minimal" }),
        json!({ "id": "coding", "label": "Coding" }),
        json!({ "id": "messaging", "label": "Messaging" }),
        json!({ "id": "full", "label": "Full" }),
    ]
}

fn tool_catalog_entry(definition: &crawclaw_runtime::RustCoreToolDefinition) -> Value {
    json!({
        "id": definition.id,
        "label": tool_label(definition.id),
        "description": tool_description(definition.id),
        "source": "core",
        "optional": !definition.default_enabled,
        "defaultProfiles": tool_default_profiles(definition.id)
    })
}

fn tool_effective_entry(definition: &crawclaw_runtime::RustCoreToolDefinition) -> Value {
    let description = tool_description(definition.id);
    json!({
        "id": definition.id,
        "label": tool_label(definition.id),
        "description": description,
        "rawDescription": description,
        "source": "core"
    })
}

fn tool_default_profiles(tool_id: &str) -> Vec<&'static str> {
    match tool_id {
        "read" | "grep" | "find" | "ls" => vec!["minimal", "coding", "full"],
        "write" | "edit" | "apply_patch" | "bash" | "process" => vec!["coding", "full"],
        "sessions_send" | "sessions_spawn" | "sessions_yield" | "subagents" => {
            vec!["coding", "full"]
        }
        "session_status" | "sessions_list" | "sessions_history" => {
            vec!["minimal", "coding", "full"]
        }
        "web_search" | "web_fetch" => vec!["coding", "full"],
        "cron" => vec!["full"],
        _ => vec!["full"],
    }
}

fn tool_label(tool_id: &str) -> String {
    tool_id.replace('_', " ")
}

fn tool_description(tool_id: &str) -> &'static str {
    match tool_id {
        "read" => "Read a file from the local workspace.",
        "write" => "Write a file in the local workspace.",
        "edit" => "Edit an existing local file.",
        "apply_patch" => "Apply a unified patch to local files.",
        "bash" => "Run a shell command through the Rust runtime.",
        "process" => "Inspect or control background processes managed by the Rust runtime.",
        "grep" => "Search file contents in the local workspace.",
        "find" => "Find files and directories in the local workspace.",
        "ls" => "List local files and directories.",
        "web_search" => "Search the web through the Rust open-websearch provider.",
        "web_fetch" => "Fetch static HTTP content through the Rust runtime.",
        "cron" => "Manage scheduled jobs in the Rust cron service.",
        "review_task" => "Run a local Rust review task.",
        "session_status" => "Inspect the current session status.",
        "sessions_list" => "List local agent sessions.",
        "sessions_history" => "Read local session history.",
        "sessions_send" => "Send a message into a local session.",
        "sessions_spawn" => "Spawn a local sub-session.",
        "sessions_yield" => "Mark a local session as yielded.",
        "subagents" => "List sub-sessions for a parent session.",
        "write_experience_note" => "Write an experience note through the Rust memory store.",
        _ => "Rust-native CrawClaw tool.",
    }
}

fn models_list() -> Value {
    json!({
        "models": crawclaw_providers::default_model_options()
            .into_iter()
            .map(|model| {
                json!({
                    "id": model.clone(),
                    "name": model.clone(),
                    "provider": model_provider(&model),
                    "reasoning": model_has_reasoning(&model)
                })
            })
            .collect::<Vec<_>>()
    })
}

fn model_provider(model: &str) -> &'static str {
    if model.starts_with("gpt-") {
        "openai"
    } else if model.starts_with("sonnet-") {
        "anthropic"
    } else if model.starts_with("ollama/") {
        "ollama"
    } else {
        "openai-compatible"
    }
}

fn model_has_reasoning(model: &str) -> bool {
    model.starts_with("gpt-") || model.starts_with("sonnet-")
}

fn agents_list(state: &GatewayState) -> Value {
    let default_model = crawclaw_providers::default_model_options()
        .into_iter()
        .next()
        .unwrap_or_else(|| "gpt-5.4".to_string());
    json!({
        "defaultId": "main",
        "mainKey": "agent:main:main",
        "scope": "global",
        "agents": [{
            "id": "main",
            "name": "Main",
            "workspace": state.runtime_root.to_string_lossy(),
            "model": {
                "primary": default_model,
                "fallbacks": []
            }
        }]
    })
}

fn logs_tail() -> Value {
    json!({
        "file": "rust-gateway",
        "cursor": 0,
        "size": 0,
        "lines": []
    })
}

fn usage_status(state: &GatewayState) -> Value {
    let config = read_config_value(&config_path(state)).unwrap_or_else(|_| json!({}));
    json!({
        "updatedAt": now_millis(),
        "providers": usage_provider_snapshots(state, &config)
    })
}

fn usage_provider_snapshots(state: &GatewayState, config: &Value) -> Vec<Value> {
    [
        (
            "anthropic",
            "Claude",
            "anthropic",
            &["anthropic", "claude"][..],
            &[][..],
        ),
        (
            "github-copilot",
            "Copilot",
            "github-copilot",
            &["github-copilot"][..],
            &["GITHUB_COPILOT_TOKEN", "GH_COPILOT_TOKEN"][..],
        ),
        (
            "google-gemini-cli",
            "Gemini",
            "google",
            &["google-gemini-cli", "gemini", "google-gemini", "google"][..],
            &[][..],
        ),
        (
            "minimax",
            "MiniMax",
            "minimax",
            &["minimax"][..],
            &["MINIMAX_CODE_PLAN_KEY"][..],
        ),
        (
            "openai-codex",
            "Codex",
            "openai",
            &["openai-codex", "openai"][..],
            &["OPENAI_CODEX_TOKEN"][..],
        ),
        ("xiaomi", "Xiaomi", "xiaomi", &["xiaomi"][..], &[][..]),
        ("zai", "z.ai", "zai", &["zai", "z-ai"][..], &[][..]),
    ]
    .into_iter()
    .filter(|(provider, _, auth_provider, aliases, extra_env_keys)| {
        usage_provider_configured(
            state,
            config,
            provider,
            auth_provider,
            aliases,
            extra_env_keys,
        )
    })
    .map(|(provider, display_name, _, _, _)| {
        json!({
            "provider": provider,
            "displayName": display_name,
            "windows": [],
            "plan": "configured"
        })
    })
    .collect()
}

fn usage_provider_configured(
    state: &GatewayState,
    config: &Value,
    provider: &str,
    auth_provider: &str,
    aliases: &[&str],
    extra_env_keys: &[&'static str],
) -> bool {
    let env_keys = usage_provider_env_keys(auth_provider, extra_env_keys);
    if env_keys.iter().any(|key| env_secret_present(key)) {
        return true;
    }
    if aliases
        .iter()
        .any(|alias| config_provider_has_api_key(config, alias))
    {
        return true;
    }
    auth_profiles_has_provider(&state.state_dir.join("agents/main/agent"), aliases)
        || auth_profiles_has_provider(&state.state_dir.join("agent"), aliases)
        || config_provider_has_api_key(config, provider)
}

fn usage_provider_env_keys(
    auth_provider: &str,
    extra_env_keys: &[&'static str],
) -> Vec<&'static str> {
    let mut keys = crawclaw_providers::bundled_provider_auth_env_vars_for(auth_provider)
        .map(|keys| keys.to_vec())
        .unwrap_or_default();
    for key in extra_env_keys {
        if !keys.contains(key) {
            keys.push(*key);
        }
    }
    keys
}

fn env_secret_present(key: &str) -> bool {
    env::var(key)
        .ok()
        .map(|value| !value.trim().is_empty())
        .unwrap_or(false)
}

fn config_provider_has_api_key(config: &Value, provider: &str) -> bool {
    let path = format!("models.providers.{provider}.apiKey");
    get_json_path(config, &path)
        .map(|value| match value {
            Value::String(raw) => !raw.trim().is_empty(),
            Value::Object(object) => !object.is_empty(),
            _ => false,
        })
        .unwrap_or(false)
}

fn auth_profiles_has_provider(agent_dir: &std::path::Path, aliases: &[&str]) -> bool {
    let path = agent_dir.join("auth-profiles.json");
    let Ok(store) = read_config_value(&path) else {
        return false;
    };
    let Some(profiles) = store.get("profiles").and_then(Value::as_object) else {
        return false;
    };
    profiles.values().any(|profile| {
        let Some(provider) = profile
            .get("provider")
            .and_then(Value::as_str)
            .map(|value| value.trim().to_lowercase())
        else {
            return false;
        };
        aliases.iter().any(|alias| provider == *alias)
            && ["key", "apiKey", "token", "accessToken", "refreshToken"]
                .iter()
                .any(|field| {
                    profile
                        .get(*field)
                        .and_then(Value::as_str)
                        .map(|value| !value.trim().is_empty())
                        .unwrap_or(false)
                })
    })
}

fn agent_observations_list(state: &GatewayState, params: Value) -> Result<Value, String> {
    if !params.is_object() {
        return Err("invalid agent.observations.list params".to_string());
    }
    if let Some(status) = string_param(&params, &["status"]) {
        if !["running", "ok", "error", "timeout", "archived", "unknown"].contains(&status.as_str())
        {
            return Err("invalid agent.observations.list params: invalid status".to_string());
        }
    }
    if let Some(source) = string_param(&params, &["source"]) {
        if ![
            "lifecycle",
            "diagnostic",
            "action",
            "archive",
            "trajectory",
            "log",
            "otel",
        ]
        .contains(&source.as_str())
        {
            return Err("invalid agent.observations.list params: invalid source".to_string());
        }
    }
    for field in ["limit", "from", "to"] {
        if params.get(field).is_some() && !params.get(field).and_then(Value::as_u64).is_some() {
            return Err(format!(
                "invalid agent.observations.list params: {field} must be a positive integer"
            ));
        }
    }
    let limit = params
        .get("limit")
        .and_then(Value::as_u64)
        .map(|value| value.clamp(1, 200))
        .unwrap_or(50);
    let Some(db_path) = observation_runtime_store_path(state) else {
        return Ok(empty_observation_list(limit));
    };
    let Ok(connection) = rusqlite::Connection::open(db_path) else {
        return Ok(empty_observation_list(limit));
    };
    if !sqlite_table_exists(&connection, "gm_observation_runs") {
        return Ok(empty_observation_list(limit));
    }
    let (items, next_cursor) = query_observation_runs(&connection, &params, limit as usize)?;
    let mut response = json!({
        "items": items,
        "generatedAt": now_millis()
    });
    if let Some(next_cursor) = next_cursor {
        response["nextCursor"] = Value::String(next_cursor);
    }
    Ok(response)
}

fn empty_observation_list(_limit: u64) -> Value {
    json!({
        "items": Vec::<Value>::new(),
        "generatedAt": now_millis()
    })
}

fn observation_runtime_store_path(state: &GatewayState) -> Option<PathBuf> {
    if let Some(path) = env::var("RUNTIME_DB_PATH")
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
    {
        return Some(expand_user_path(&path));
    }
    let config = read_config_value(&config_path(state)).ok()?;
    let path = get_json_path(&config, "memory.runtimeStore.dbPath")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("~/.crawclaw/memory-runtime.db");
    Some(expand_user_path(path))
}

fn sqlite_table_exists(connection: &rusqlite::Connection, table: &str) -> bool {
    connection
        .query_row(
            "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?1 LIMIT 1",
            [table],
            |_| Ok(()),
        )
        .is_ok()
}

fn query_observation_runs(
    connection: &rusqlite::Connection,
    params: &Value,
    limit: usize,
) -> Result<(Vec<Value>, Option<String>), String> {
    let mut conditions = Vec::<String>::new();
    let mut args = Vec::<rusqlite::types::Value>::new();
    if let Some(query) = string_param(params, &["query"]) {
        let like = format!("%{query}%");
        conditions.push(
            "(trace_id LIKE ? OR run_id LIKE ? OR task_id LIKE ? OR session_id LIKE ? OR session_key LIKE ? OR agent_id LIKE ?)"
                .to_string(),
        );
        for _ in 0..6 {
            args.push(rusqlite::types::Value::Text(like.clone()));
        }
    }
    if let Some(status) = string_param(params, &["status"]) {
        conditions.push("status = ?".to_string());
        args.push(rusqlite::types::Value::Text(status));
    }
    if let Some(source) = string_param(params, &["source"]) {
        conditions.push("sources_json LIKE ?".to_string());
        args.push(rusqlite::types::Value::Text(format!("%\"{source}\"%")));
    }
    if let Some(from) = params.get("from").and_then(Value::as_u64) {
        conditions.push("COALESCE(last_event_at, started_at, created_at, 0) >= ?".to_string());
        args.push(rusqlite::types::Value::Integer(from as i64));
    }
    if let Some(to) = params.get("to").and_then(Value::as_u64) {
        conditions.push("COALESCE(last_event_at, started_at, created_at, 0) <= ?".to_string());
        args.push(rusqlite::types::Value::Integer(to as i64));
    }
    if let Some((last_event_at, trace_id)) =
        string_param(params, &["cursor"]).and_then(|cursor| decode_observation_cursor(&cursor))
    {
        conditions.push(
            "(COALESCE(last_event_at, started_at, created_at, 0) < ? OR (COALESCE(last_event_at, started_at, created_at, 0) = ? AND trace_id < ?))"
                .to_string(),
        );
        args.push(rusqlite::types::Value::Integer(last_event_at as i64));
        args.push(rusqlite::types::Value::Integer(last_event_at as i64));
        args.push(rusqlite::types::Value::Text(trace_id));
    }
    let where_clause = if conditions.is_empty() {
        String::new()
    } else {
        format!("WHERE {}", conditions.join(" AND "))
    };
    let sql = format!(
        "SELECT * FROM gm_observation_runs {where_clause}
         ORDER BY COALESCE(last_event_at, started_at, created_at, 0) DESC, trace_id DESC
         LIMIT ?"
    );
    args.push(rusqlite::types::Value::Integer((limit + 1) as i64));
    let mut statement = connection
        .prepare(&sql)
        .map_err(|error| format!("failed to query observation runs: {error}"))?;
    let rows = statement
        .query_map(
            rusqlite::params_from_iter(args.iter()),
            observation_run_summary_from_row,
        )
        .map_err(|error| format!("failed to query observation runs: {error}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("failed to map observation runs: {error}"))?;
    let mut items = rows;
    let next_cursor = if items.len() > limit {
        let cursor = items
            .get(limit.saturating_sub(1))
            .and_then(encode_observation_cursor);
        items.truncate(limit);
        cursor
    } else {
        None
    };
    Ok((items, next_cursor))
}

fn observation_run_summary_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<Value> {
    let trace_id: String = row.get("trace_id")?;
    let run_id: Option<String> = row.get("run_id")?;
    let task_id: Option<String> = row.get("task_id")?;
    let session_id: Option<String> = row.get("session_id")?;
    let session_key: Option<String> = row.get("session_key")?;
    let agent_id: Option<String> = row.get("agent_id")?;
    let status: String = row.get("status")?;
    let started_at: Option<i64> = row.get("started_at")?;
    let ended_at: Option<i64> = row.get("ended_at")?;
    let last_event_at: Option<i64> = row.get("last_event_at")?;
    let event_count: i64 = row.get("event_count")?;
    let error_count: i64 = row.get("error_count")?;
    let sources_json: String = row.get("sources_json")?;
    let summary: String = row.get("summary")?;
    let mut object = Map::new();
    insert_optional_string(&mut object, "runId", run_id);
    insert_optional_string(&mut object, "taskId", task_id);
    object.insert("traceId".to_string(), Value::String(trace_id));
    insert_optional_string(&mut object, "sessionId", session_id);
    insert_optional_string(&mut object, "sessionKey", session_key);
    insert_optional_string(&mut object, "agentId", agent_id);
    object.insert("status".to_string(), Value::String(status));
    insert_optional_i64(&mut object, "startedAt", started_at);
    insert_optional_i64(&mut object, "endedAt", ended_at);
    insert_optional_i64(&mut object, "lastEventAt", last_event_at);
    object.insert("eventCount".to_string(), json!(event_count));
    object.insert("errorCount".to_string(), json!(error_count));
    object.insert(
        "sources".to_string(),
        parse_observation_sources(&sources_json),
    );
    object.insert("summary".to_string(), Value::String(summary));
    Ok(Value::Object(object))
}

fn insert_optional_string(object: &mut Map<String, Value>, key: &str, value: Option<String>) {
    if let Some(value) = value.filter(|value| !value.trim().is_empty()) {
        object.insert(key.to_string(), Value::String(value));
    }
}

fn insert_optional_i64(object: &mut Map<String, Value>, key: &str, value: Option<i64>) {
    if let Some(value) = value {
        object.insert(key.to_string(), json!(value));
    }
}

fn parse_observation_sources(raw: &str) -> Value {
    serde_json::from_str::<Value>(raw)
        .ok()
        .and_then(|value| {
            let values = value
                .as_array()?
                .iter()
                .filter_map(Value::as_str)
                .map(ToOwned::to_owned)
                .collect::<Vec<_>>();
            Some(json!(values))
        })
        .unwrap_or_else(|| json!([]))
}

fn encode_observation_cursor(item: &Value) -> Option<String> {
    let last_event_at = item.get("lastEventAt").and_then(Value::as_i64).unwrap_or(0);
    let trace_id = item.get("traceId").and_then(Value::as_str)?;
    Some(base64url_encode(
        serde_json::to_string(&json!({
            "lastEventAt": last_event_at,
            "traceId": trace_id
        }))
        .ok()?
        .as_bytes(),
    ))
}

fn decode_observation_cursor(cursor: &str) -> Option<(u64, String)> {
    let bytes = URL_SAFE_NO_PAD.decode(cursor).ok()?;
    let value = serde_json::from_slice::<Value>(&bytes).ok()?;
    let last_event_at = value.get("lastEventAt").and_then(Value::as_u64)?;
    let trace_id = value
        .get("traceId")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())?
        .to_string();
    Some((last_event_at, trace_id))
}

fn usage_cost(state: &GatewayState, params: Value) -> Result<Value, String> {
    let range = usage_date_range(&params)?;
    let mut totals = UsageCostTotals::default();
    let mut daily = BTreeMap::<String, UsageCostTotals>::new();
    for path in usage_session_transcript_files(&state.runtime_root.join("sessions"))? {
        scan_usage_transcript(&path, &range, &mut totals, &mut daily)?;
    }
    let daily = daily
        .into_iter()
        .map(|(date, bucket)| {
            let mut value = bucket.to_value();
            if let Some(object) = value.as_object_mut() {
                object.insert("date".to_string(), Value::String(date));
            }
            value
        })
        .collect::<Vec<_>>();
    Ok(json!({
        "updatedAt": now_millis(),
        "days": range.days,
        "daily": daily,
        "totals": totals.to_value()
    }))
}

#[derive(Clone, Debug)]
struct UsageDateRange {
    start_ms: i64,
    end_ms: i64,
    days: u64,
}

#[derive(Clone, Debug, Default)]
struct UsageTokenCounts {
    input: u64,
    output: u64,
    cache_read: u64,
    cache_write: u64,
    total: u64,
}

#[derive(Clone, Debug, Default)]
struct UsageCostTotals {
    input: u64,
    output: u64,
    cache_read: u64,
    cache_write: u64,
    total_tokens: u64,
    total_cost: f64,
    input_cost: f64,
    output_cost: f64,
    cache_read_cost: f64,
    cache_write_cost: f64,
    missing_cost_entries: u64,
}

impl UsageCostTotals {
    fn apply(&mut self, usage: &UsageTokenCounts, cost: Option<UsageCostBreakdown>) {
        self.input = self.input.saturating_add(usage.input);
        self.output = self.output.saturating_add(usage.output);
        self.cache_read = self.cache_read.saturating_add(usage.cache_read);
        self.cache_write = self.cache_write.saturating_add(usage.cache_write);
        self.total_tokens = self.total_tokens.saturating_add(usage.total);
        if let Some(cost) = cost {
            self.total_cost += cost.total;
            self.input_cost += cost.input;
            self.output_cost += cost.output;
            self.cache_read_cost += cost.cache_read;
            self.cache_write_cost += cost.cache_write;
        } else {
            self.missing_cost_entries = self.missing_cost_entries.saturating_add(1);
        }
    }

    fn to_value(&self) -> Value {
        json!({
            "input": self.input,
            "output": self.output,
            "cacheRead": self.cache_read,
            "cacheWrite": self.cache_write,
            "totalTokens": self.total_tokens,
            "totalCost": self.total_cost,
            "inputCost": self.input_cost,
            "outputCost": self.output_cost,
            "cacheReadCost": self.cache_read_cost,
            "cacheWriteCost": self.cache_write_cost,
            "missingCostEntries": self.missing_cost_entries
        })
    }
}

#[derive(Clone, Copy, Debug)]
struct UsageCostBreakdown {
    total: f64,
    input: f64,
    output: f64,
    cache_read: f64,
    cache_write: f64,
}

fn usage_date_range(params: &Value) -> Result<UsageDateRange, String> {
    const DAY_MS: i64 = 24 * 60 * 60 * 1000;
    let today = chrono::Utc::now()
        .date_naive()
        .and_hms_opt(0, 0, 0)
        .ok_or_else(|| "failed to resolve current UTC day".to_string())?
        .and_utc()
        .timestamp_millis();
    let today_end = today + DAY_MS - 1;
    let start =
        string_param(params, &["startDate"]).and_then(|date| usage_date_start_ms(&date).ok());
    let end = string_param(params, &["endDate"]).and_then(|date| usage_date_start_ms(&date).ok());
    if let (Some(start_ms), Some(end_ms)) = (start, end) {
        let end_ms = end_ms + DAY_MS - 1;
        let days = ((end_ms - start_ms).max(0) / DAY_MS + 1) as u64;
        return Ok(UsageDateRange {
            start_ms,
            end_ms,
            days,
        });
    }
    let days = usage_days_param(params).unwrap_or(30).max(1);
    let start_ms = today - (days.saturating_sub(1) as i64 * DAY_MS);
    Ok(UsageDateRange {
        start_ms,
        end_ms: today_end,
        days,
    })
}

fn usage_date_start_ms(raw: &str) -> Result<i64, String> {
    let timestamp_ms = chrono::NaiveDate::parse_from_str(raw, "%Y-%m-%d")
        .map_err(|error| format!("invalid usage date {raw}: {error}"))?
        .and_hms_opt(0, 0, 0)
        .ok_or_else(|| format!("invalid usage date {raw}"))?
        .and_utc()
        .timestamp_millis();
    Ok(timestamp_ms)
}

fn usage_days_param(params: &Value) -> Option<u64> {
    let value = params.get("days")?;
    value.as_u64().or_else(|| {
        value
            .as_str()
            .and_then(|raw| raw.trim().parse::<u64>().ok())
    })
}

fn usage_session_transcript_files(sessions_dir: &Path) -> Result<Vec<PathBuf>, String> {
    let entries = match std::fs::read_dir(sessions_dir) {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(error) => {
            return Err(format!(
                "failed to read usage sessions directory {}: {error}",
                sessions_dir.display()
            ));
        }
    };
    let mut files = Vec::new();
    for entry in entries {
        let entry = entry.map_err(|error| {
            format!(
                "failed to read usage sessions directory {}: {error}",
                sessions_dir.display()
            )
        })?;
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let name = path
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("");
        if is_usage_counted_session_transcript_name(name) {
            files.push(path);
        }
    }
    files.sort();
    Ok(files)
}

fn is_usage_counted_session_transcript_name(name: &str) -> bool {
    if name == "sessions.json" {
        return false;
    }
    name.ends_with(".jsonl") || name.contains(".jsonl.reset.") || name.contains(".jsonl.deleted.")
}

fn scan_usage_transcript(
    path: &Path,
    range: &UsageDateRange,
    totals: &mut UsageCostTotals,
    daily: &mut BTreeMap<String, UsageCostTotals>,
) -> Result<(), String> {
    let raw = std::fs::read_to_string(path).map_err(|error| {
        format!(
            "failed to read usage transcript {}: {error}",
            path.display()
        )
    })?;
    for line in raw.lines().map(str::trim).filter(|line| !line.is_empty()) {
        let Ok(entry) = serde_json::from_str::<Value>(line) else {
            continue;
        };
        let Some(parsed) = parse_usage_transcript_entry(&entry) else {
            continue;
        };
        if parsed.timestamp_ms < range.start_ms || parsed.timestamp_ms > range.end_ms {
            continue;
        }
        let Some(day) = usage_day_key(parsed.timestamp_ms) else {
            continue;
        };
        totals.apply(&parsed.usage, parsed.cost);
        daily
            .entry(day)
            .or_default()
            .apply(&parsed.usage, parsed.cost);
    }
    Ok(())
}

struct ParsedUsageTranscriptEntry {
    timestamp_ms: i64,
    usage: UsageTokenCounts,
    cost: Option<UsageCostBreakdown>,
}

fn parse_usage_transcript_entry(entry: &Value) -> Option<ParsedUsageTranscriptEntry> {
    let message = entry.get("message")?.as_object()?;
    let role = message.get("role")?.as_str()?;
    if role != "user" && role != "assistant" {
        return None;
    }
    let usage_raw = message.get("usage").or_else(|| entry.get("usage"))?;
    let usage = normalize_usage_tokens(usage_raw)?;
    let timestamp_ms = usage_timestamp_ms(entry)?;
    let cost = usage_cost_breakdown(usage_raw);
    Some(ParsedUsageTranscriptEntry {
        timestamp_ms,
        usage,
        cost,
    })
}

fn normalize_usage_tokens(usage: &Value) -> Option<UsageTokenCounts> {
    let input = usage_token_number(
        usage,
        &[
            "input",
            "inputTokens",
            "input_tokens",
            "promptTokens",
            "prompt_tokens",
        ],
    );
    let output = usage_token_number(
        usage,
        &[
            "output",
            "outputTokens",
            "output_tokens",
            "completionTokens",
            "completion_tokens",
        ],
    );
    let cache_read = usage_token_number(
        usage,
        &[
            "cacheRead",
            "cache_read",
            "cache_read_input_tokens",
            "cached_tokens",
        ],
    )
    .or_else(|| {
        usage
            .get("prompt_tokens_details")
            .and_then(|details| usage_token_number(details, &["cached_tokens"]))
    });
    let cache_write = usage_token_number(
        usage,
        &["cacheWrite", "cache_write", "cache_creation_input_tokens"],
    );
    let total = usage_token_number(usage, &["total", "totalTokens", "total_tokens"]);
    if input.is_none()
        && output.is_none()
        && cache_read.is_none()
        && cache_write.is_none()
        && total.is_none()
    {
        return None;
    }
    let input = input.unwrap_or(0);
    let output = output.unwrap_or(0);
    let cache_read = cache_read.unwrap_or(0);
    let cache_write = cache_write.unwrap_or(0);
    let total = total.unwrap_or_else(|| {
        input
            .saturating_add(output)
            .saturating_add(cache_read)
            .saturating_add(cache_write)
    });
    Some(UsageTokenCounts {
        input,
        output,
        cache_read,
        cache_write,
        total,
    })
}

fn usage_token_number(value: &Value, keys: &[&str]) -> Option<u64> {
    keys.iter().find_map(|key| {
        value.get(*key).and_then(|value| {
            value
                .as_u64()
                .or_else(|| {
                    value
                        .as_i64()
                        .filter(|value| *value >= 0)
                        .map(|value| value as u64)
                })
                .or_else(|| {
                    value
                        .as_f64()
                        .filter(|value| value.is_finite() && *value >= 0.0)
                        .map(|value| value.floor() as u64)
                })
        })
    })
}

fn usage_timestamp_ms(entry: &Value) -> Option<i64> {
    if let Some(raw) = entry.get("timestamp").and_then(Value::as_str) {
        if let Ok(timestamp) = chrono::DateTime::parse_from_rfc3339(raw) {
            return Some(timestamp.timestamp_millis());
        }
    }
    entry
        .get("message")
        .and_then(|message| message.get("timestamp"))
        .and_then(json_millis_value)
}

fn json_millis_value(value: &Value) -> Option<i64> {
    value.as_i64().or_else(|| {
        value
            .as_f64()
            .filter(|value| value.is_finite())
            .map(|value| value as i64)
    })
}

fn usage_day_key(timestamp_ms: i64) -> Option<String> {
    chrono::DateTime::<chrono::Utc>::from_timestamp_millis(timestamp_ms)
        .map(|timestamp| timestamp.date_naive().format("%Y-%m-%d").to_string())
}

fn usage_cost_breakdown(usage: &Value) -> Option<UsageCostBreakdown> {
    let cost = usage.get("cost")?;
    let total = usage_cost_number(cost, "total")?;
    if total < 0.0 {
        return None;
    }
    Some(UsageCostBreakdown {
        total,
        input: usage_cost_number(cost, "input").unwrap_or(0.0),
        output: usage_cost_number(cost, "output").unwrap_or(0.0),
        cache_read: usage_cost_number(cost, "cacheRead").unwrap_or(0.0),
        cache_write: usage_cost_number(cost, "cacheWrite").unwrap_or(0.0),
    })
}

fn usage_cost_number(value: &Value, key: &str) -> Option<f64> {
    value.get(key)?.as_f64().filter(|value| value.is_finite())
}

fn doctor_memory_status(state: &GatewayState) -> Result<Value, String> {
    Ok(json!({
        "ok": true,
        "implementation": "rust-native",
        "memory": memory_runtime(state).status()?
    }))
}

fn agent_runtime_summary(state: &GatewayState, params: Value) -> Result<Value, String> {
    let sessions = agent_runtime_filtered_sessions(state, &params)?;
    Ok(agent_runtime_summary_value(&sessions))
}

fn agent_runtime_summary_value(sessions: &[crawclaw_runtime::DesktopSessionSummary]) -> Value {
    let mut by_category = Map::new();
    for category in ["memory", "review", "subagents", "acp", "cron", "cli"] {
        by_category.insert(category.to_string(), json!(0));
    }
    let mut running = 0;
    let mut failed = 0;
    let mut waiting = 0;
    let mut completed = 0;
    for session in sessions {
        let category = agent_runtime_category(session);
        let count = by_category
            .get(&category)
            .and_then(Value::as_u64)
            .unwrap_or(0)
            + 1;
        by_category.insert(category, json!(count));
        match agent_runtime_status_bucket(&session.status) {
            "running" => running += 1,
            "waiting" => waiting += 1,
            "failed" => failed += 1,
            _ => completed += 1,
        }
    }
    json!({
        "running": running,
        "failed": failed,
        "waiting": waiting,
        "completed": completed,
        "lastCompletedAt": Value::Null,
        "byCategory": Value::Object(by_category)
    })
}

fn agent_runtime_list(state: &GatewayState, params: Value) -> Result<Value, String> {
    let sessions = agent_runtime_filtered_sessions(state, &params)?;
    let limit = params
        .get("limit")
        .and_then(Value::as_u64)
        .map(|value| value.max(1) as usize)
        .unwrap_or(40);
    let runs = sessions
        .iter()
        .take(limit)
        .map(|session| agent_runtime_run_value(state, session))
        .collect::<Result<Vec<_>, _>>()?;
    Ok(json!({
        "summary": agent_runtime_summary_value(&sessions),
        "count": runs.len(),
        "runs": runs
    }))
}

fn agent_runtime_cancel(_state: &GatewayState, params: Value) -> Result<Value, String> {
    Ok(json!({
        "ok": true,
        "cancelled": false,
        "taskId": string_param(&params, &["taskId", "runId", "sessionKey", "key"])
    }))
}

fn agent_runtime_get(state: &GatewayState, params: Value) -> Result<Value, String> {
    let task_id = required_param(&params, &["taskId", "runId", "sessionKey", "key"])?;
    let Some(session) = resolve_agent_runtime_session(state, &task_id)? else {
        return Err(format!("Task not found: {task_id}"));
    };
    let run = agent_runtime_run_value(
        state,
        &crawclaw_runtime::DesktopSessionSummary {
            key: session.key.clone(),
            title: session.title.clone(),
            pinned: session.pinned,
            status: session.status.clone(),
            message_count: session.message_count,
            spawned_by: session.spawned_by.clone(),
            yielded: session.yielded,
        },
    )?;
    Ok(json!({
        "run": run,
        "contract": {
            "definitionId": Value::Null,
            "definitionLabel": Value::Null,
            "spawnSource": run.get("spawnSource").cloned().unwrap_or(Value::Null),
            "executionMode": Value::Null,
            "transcriptPolicy": Value::Null,
            "cleanup": Value::Null,
            "defaultRunTimeoutSeconds": Value::Null,
            "toolAllowlistCount": Value::Null
        },
        "metadata": {
            "mode": "desktop-session",
            "runtimeStateRef": Value::Null,
            "transcriptRef": session.key,
            "trajectoryRef": Value::Null,
            "capabilitySnapshotRef": Value::Null
        },
        "availableActions": {
            "openSession": true,
            "cancel": agent_runtime_can_cancel(&session.status)
        }
    }))
}

fn agent_inspect(state: &GatewayState, params: Value) -> Result<Value, String> {
    let target = string_param(
        &params,
        &["runId", "taskId", "traceId", "sessionKey", "key"],
    )
    .ok_or_else(|| "agent.inspect requires runId, taskId, or traceId".to_string())?;
    let Some(session) = resolve_agent_runtime_session(state, &target)? else {
        return Err("agent inspection target not found".to_string());
    };
    let summary = crawclaw_runtime::DesktopSessionSummary {
        key: session.key.clone(),
        title: session.title.clone(),
        pinned: session.pinned,
        status: session.status.clone(),
        message_count: session.message_count,
        spawned_by: session.spawned_by.clone(),
        yielded: session.yielded,
    };
    let run = agent_runtime_run_value(state, &summary)?;
    Ok(json!({
        "lookup": {
            "runId": target,
            "sessionKey": session.key
        },
        "runId": session.key,
        "taskId": run.get("taskId").cloned().unwrap_or(Value::Null),
        "sessionKey": run.get("sessionKey").cloned().unwrap_or(Value::Null),
        "sessionId": run.get("taskId").cloned().unwrap_or(Value::Null),
        "agentId": "main",
        "status": session.status,
        "run": run,
        "warnings": [],
        "refs": {
            "transcriptRef": session.key
        },
        "implementation": "rust-native"
    }))
}

fn agent_wait(state: &GatewayState, params: Value) -> Result<Value, String> {
    let run_id = required_param(&params, &["runId", "taskId", "sessionKey", "key"])?;
    let Some(session) = resolve_agent_runtime_session(state, &run_id)? else {
        return Ok(json!({
            "runId": run_id,
            "status": "timeout"
        }));
    };
    let updated_at = session_updated_at_ms(state, &session.key) as u64;
    let status_bucket = agent_runtime_status_bucket(&session.status);
    Ok(json!({
        "runId": session.key,
        "status": match status_bucket {
            "waiting" => "running",
            "failed" => "failed",
            "completed" => "completed",
            _ => "running"
        },
        "startedAt": if matches!(status_bucket, "running" | "waiting") { json!(updated_at) } else { Value::Null },
        "endedAt": if matches!(status_bucket, "completed" | "failed") { json!(updated_at) } else { Value::Null },
        "error": Value::Null
    }))
}

fn agent_runtime_filtered_sessions(
    state: &GatewayState,
    params: &Value,
) -> Result<Vec<crawclaw_runtime::DesktopSessionSummary>, String> {
    let category = string_param(params, &["category"]).unwrap_or_else(|| "all".to_string());
    let status = string_param(params, &["status"]).unwrap_or_else(|| "all".to_string());
    let agent = string_param(params, &["agent"]);
    let session_key = string_param(params, &["sessionKey", "key"]);
    let task_id = string_param(params, &["taskId"]);
    let run_id = string_param(params, &["runId"]);
    let mut sessions = state
        .session_store
        .list_summaries()
        .map_err(|error| error.to_string())?
        .into_iter()
        .filter(|session| category == "all" || agent_runtime_category(session) == category)
        .filter(|session| status == "all" || agent_runtime_status_bucket(&session.status) == status)
        .filter(|_session| match agent.as_deref() {
            Some(agent) => agent == "main",
            None => true,
        })
        .filter(|session| {
            session_key
                .as_deref()
                .map(|query| agent_runtime_session_matches_key(session, query))
                .unwrap_or(true)
        })
        .filter(|session| {
            task_id
                .as_deref()
                .map(|query| agent_runtime_session_matches_key(session, query))
                .unwrap_or(true)
        })
        .filter(|session| {
            run_id
                .as_deref()
                .map(|query| agent_runtime_session_matches_key(session, query))
                .unwrap_or(true)
        })
        .collect::<Vec<_>>();
    sessions.sort_by(|left, right| right.key.cmp(&left.key));
    Ok(sessions)
}

fn agent_runtime_session_matches_key(
    session: &crawclaw_runtime::DesktopSessionSummary,
    query: &str,
) -> bool {
    let query = query.trim();
    if query.is_empty() {
        return true;
    }
    if session.key == query || session.key.contains(query) {
        return true;
    }
    normalize_session_key(query)
        .map(|normalized| session.key == normalized || session.key.contains(&normalized))
        .unwrap_or(false)
}

fn resolve_agent_runtime_session(
    state: &GatewayState,
    task_id: &str,
) -> Result<Option<crawclaw_runtime::DesktopSessionStatus>, String> {
    if let Some(session) = state
        .session_store
        .session_status(task_id)
        .map_err(|error| error.to_string())?
    {
        return Ok(Some(session));
    }
    let normalized = normalize_session_key(task_id)?;
    if normalized == task_id {
        return Ok(None);
    }
    state
        .session_store
        .session_status(&normalized)
        .map_err(|error| error.to_string())
}

fn agent_runtime_category(session: &crawclaw_runtime::DesktopSessionSummary) -> String {
    if session.spawned_by.is_some() {
        return "subagents".to_string();
    }
    let searchable = format!("{} {}", session.key, session.title).to_lowercase();
    if searchable.contains("memory")
        || searchable.contains("dream")
        || searchable.contains("session-summary")
        || searchable.contains("durable")
    {
        return "memory".to_string();
    }
    if searchable.contains("review") {
        return "review".to_string();
    }
    if searchable.contains("acp") {
        return "acp".to_string();
    }
    if searchable.contains("cron") || searchable.contains("schedule") {
        return "cron".to_string();
    }
    "cli".to_string()
}

fn agent_runtime_status_bucket(status: &str) -> &'static str {
    match status.trim() {
        "queued" | "pending" | "spawned" | "waiting" => "waiting",
        "running" | "active" | "processing" => "running",
        "failed" | "error" | "timed_out" | "lost" => "failed",
        _ => "completed",
    }
}

fn agent_runtime_can_cancel(status: &str) -> bool {
    matches!(agent_runtime_status_bucket(status), "running" | "waiting")
}

fn agent_runtime_run_value(
    state: &GatewayState,
    session: &crawclaw_runtime::DesktopSessionSummary,
) -> Result<Value, String> {
    let updated_at = session_updated_at_ms(state, &session.key);
    let status_bucket = agent_runtime_status_bucket(&session.status);
    Ok(json!({
        "taskId": session.key,
        "category": agent_runtime_category(session),
        "runtime": "desktop-session",
        "status": session.status,
        "title": session.title,
        "summary": if session.message_count > 0 {
            Value::String(format!("{} message{}", session.message_count, if session.message_count == 1 { "" } else { "s" }))
        } else {
            Value::Null
        },
        "sessionKey": session.spawned_by.clone().unwrap_or_else(|| session.key.clone()),
        "ownerKey": session.spawned_by.clone().unwrap_or_else(|| session.key.clone()),
        "scopeKind": "session",
        "childSessionKey": if session.spawned_by.is_some() { Value::String(session.key.clone()) } else { Value::Null },
        "agentId": "main",
        "runId": Value::Null,
        "parentTaskId": Value::Null,
        "sourceId": session.spawned_by,
        "spawnSource": if session.spawned_by.is_some() { Value::String("sessions.spawn".to_string()) } else { Value::Null },
        "progressSummary": Value::Null,
        "terminalSummary": Value::Null,
        "error": Value::Null,
        "createdAt": updated_at,
        "updatedAt": updated_at,
        "startedAt": if matches!(status_bucket, "running" | "waiting") { json!(updated_at) } else { Value::Null },
        "endedAt": if status_bucket == "completed" || status_bucket == "failed" { json!(updated_at) } else { Value::Null }
    }))
}

fn session_updated_at_ms(state: &GatewayState, key: &str) -> u128 {
    state
        .session_store
        .session_transcript_path(key)
        .ok()
        .and_then(|path| std::fs::metadata(path).ok())
        .and_then(|metadata| metadata.modified().ok())
        .and_then(|modified| modified.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis())
        .unwrap_or_else(now_millis)
}

fn agent_identity(state: &GatewayState) -> Value {
    json!({
        "agentId": "main",
        "identity": {
            "name": "Main",
            "theme": "default"
        },
        "workspace": state.runtime_root.to_string_lossy()
    })
}

fn agents_create(state: &GatewayState, params: Value) -> Result<Value, String> {
    let name = required_param(&params, &["name"])?;
    let workspace = required_param(&params, &["workspace"])?;
    let agent_id = slugify_agent_id(&name);
    let path = config_path(state);
    let mut config = read_config_value(&path)?;
    set_json_path(
        &mut config,
        &format!("agents.entries.{agent_id}.name"),
        Value::String(name.clone()),
    )?;
    set_json_path(
        &mut config,
        &format!("agents.entries.{agent_id}.workspace"),
        Value::String(workspace.clone()),
    )?;
    if let Some(emoji) = string_param(&params, &["emoji"]) {
        set_json_path(
            &mut config,
            &format!("agents.entries.{agent_id}.identity.emoji"),
            Value::String(emoji),
        )?;
    }
    write_config_value(&path, &config)?;
    Ok(json!({
        "ok": true,
        "agentId": agent_id,
        "name": name,
        "workspace": workspace
    }))
}

fn agents_update(state: &GatewayState, params: Value) -> Result<Value, String> {
    let agent_id = required_param(&params, &["agentId", "id"])?;
    if agent_id.contains('.') {
        return Err("agent id cannot contain dots".to_string());
    }
    let path = config_path(state);
    let mut config = read_config_value(&path)?;
    for (field, config_key) in [
        ("name", "name"),
        ("workspace", "workspace"),
        ("model", "model.primary"),
        ("avatar", "identity.avatar"),
    ] {
        if let Some(value) = string_param(&params, &[field]) {
            set_json_path(
                &mut config,
                &format!("agents.entries.{agent_id}.{config_key}"),
                Value::String(value),
            )?;
        }
    }
    write_config_value(&path, &config)?;
    Ok(json!({ "ok": true, "agentId": agent_id }))
}

fn agents_delete(state: &GatewayState, params: Value) -> Result<Value, String> {
    let agent_id = required_param(&params, &["agentId", "id"])?;
    if agent_id == "main" {
        return Ok(json!({ "ok": true, "agentId": agent_id, "removedBindings": 0 }));
    }
    let path = config_path(state);
    let mut config = read_config_value(&path)?;
    let removed = delete_json_path(&mut config, &format!("agents.entries.{agent_id}"));
    write_config_value(&path, &config)?;
    Ok(json!({
        "ok": true,
        "agentId": agent_id,
        "removedBindings": if removed { 1 } else { 0 }
    }))
}

fn agents_files_list(state: &GatewayState, params: Value) -> Result<Value, String> {
    let agent_id = required_param(&params, &["agentId", "id"])?;
    let workspace = agent_workspace(state, &agent_id)?;
    let mut files = Vec::new();
    if let Ok(entries) = std::fs::read_dir(&workspace) {
        for entry in entries.flatten() {
            let Ok(metadata) = entry.metadata() else {
                continue;
            };
            if !metadata.is_file() {
                continue;
            }
            let name = entry.file_name().to_string_lossy().to_string();
            files.push(json!({
                "name": name,
                "path": entry.path().to_string_lossy(),
                "missing": false,
                "size": metadata.len()
            }));
        }
    }
    Ok(json!({
        "agentId": agent_id,
        "workspace": workspace.to_string_lossy(),
        "files": files
    }))
}

fn agents_files_get(state: &GatewayState, params: Value) -> Result<Value, String> {
    let agent_id = required_param(&params, &["agentId", "id"])?;
    let name = required_param(&params, &["name"])?;
    let workspace = agent_workspace(state, &agent_id)?;
    let path = safe_agent_file_path(&workspace, &name)?;
    let content = match std::fs::read_to_string(&path) {
        Ok(content) => Some(content),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
        Err(error) => {
            return Err(format!(
                "failed to read agent file {}: {error}",
                path.display()
            ))
        }
    };
    Ok(json!({
        "agentId": agent_id,
        "workspace": workspace.to_string_lossy(),
        "file": {
            "name": name,
            "path": path.to_string_lossy(),
            "missing": content.is_none(),
            "content": content
        }
    }))
}

fn agents_files_set(state: &GatewayState, params: Value) -> Result<Value, String> {
    let agent_id = required_param(&params, &["agentId", "id"])?;
    let name = required_param(&params, &["name"])?;
    let content = string_param(&params, &["content"]).unwrap_or_default();
    let workspace = agent_workspace(state, &agent_id)?;
    std::fs::create_dir_all(&workspace)
        .map_err(|error| format!("failed to create agent workspace: {error}"))?;
    let path = safe_agent_file_path(&workspace, &name)?;
    std::fs::write(&path, &content)
        .map_err(|error| format!("failed to write agent file {}: {error}", path.display()))?;
    Ok(json!({
        "ok": true,
        "agentId": agent_id,
        "workspace": workspace.to_string_lossy(),
        "file": {
            "name": name,
            "path": path.to_string_lossy(),
            "missing": false,
            "size": content.len(),
            "content": content
        }
    }))
}

fn agent_workspace(state: &GatewayState, agent_id: &str) -> Result<PathBuf, String> {
    let config = read_config_value(&config_path(state))?;
    let workspace = get_json_path(&config, &format!("agents.entries.{agent_id}.workspace"))
        .and_then(Value::as_str)
        .map(expand_user_path)
        .unwrap_or_else(|| state.runtime_root.clone());
    Ok(if workspace.is_absolute() {
        workspace
    } else {
        state.runtime_root.join(workspace)
    })
}

fn safe_agent_file_path(workspace: &std::path::Path, name: &str) -> Result<PathBuf, String> {
    if name.is_empty() || name.contains('/') || name.contains('\\') || name == "." || name == ".." {
        return Err("agent file name must be a direct file name".to_string());
    }
    Ok(workspace.join(name))
}

fn slugify_agent_id(name: &str) -> String {
    let slug = name
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() {
                ch.to_ascii_lowercase()
            } else {
                '-'
            }
        })
        .collect::<String>()
        .split('-')
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join("-");
    if slug.is_empty() {
        format!("agent-{}", now_millis())
    } else {
        slug
    }
}

fn skills_status(state: &GatewayState, params: Value) -> Value {
    let agent_id = string_param(&params, &["agentId"]).unwrap_or_else(|| "main".to_string());
    let skills_root = state.runtime_root.join("skills");
    let config =
        read_config_value(&config_path(state)).unwrap_or_else(|_| Value::Object(Map::new()));
    let mut seen = std::collections::BTreeSet::new();
    let mut skills = Vec::new();

    if let Some(entries) = get_json_path(&config, "skills.entries").and_then(Value::as_object) {
        for (skill_key, entry) in entries {
            seen.insert(skill_key.clone());
            skills.push(json!({
                "skillKey": skill_key,
                "enabled": entry.get("enabled").and_then(Value::as_bool).unwrap_or(true),
                "source": entry.get("source").and_then(Value::as_str).unwrap_or("config"),
                "path": skills_root.join(skill_key).join("SKILL.md").to_string_lossy()
            }));
        }
    }
    if let Ok(entries) = std::fs::read_dir(&skills_root) {
        for entry in entries.flatten() {
            let path = entry.path();
            if !path.is_dir() || !path.join("SKILL.md").exists() {
                continue;
            }
            let Some(skill_key) = path.file_name().and_then(|name| name.to_str()) else {
                continue;
            };
            if !seen.insert(skill_key.to_string()) {
                continue;
            }
            skills.push(json!({
                "skillKey": skill_key,
                "enabled": true,
                "source": "rust-local",
                "path": path.join("SKILL.md").to_string_lossy()
            }));
        }
    }
    json!({
        "agentId": agent_id,
        "skillsRoot": skills_root.to_string_lossy(),
        "skills": skills,
        "implementation": "rust-native"
    })
}

fn skills_bins(state: &GatewayState) -> Value {
    let bins = [
        state.runtime_root.join("skills"),
        resolve_home_dir().join(".codex").join("skills"),
    ]
    .into_iter()
    .map(|path| path.to_string_lossy().to_string())
    .collect::<Vec<_>>();
    json!({ "bins": bins })
}

fn skills_update(state: &GatewayState, params: Value) -> Result<Value, String> {
    let skill_key = required_param(&params, &["skillKey", "name", "slug"])?;
    let path = config_path(state);
    let mut config = read_config_value(&path)?;
    if let Some(enabled) = params.get("enabled").and_then(Value::as_bool) {
        set_json_path(
            &mut config,
            &format!("skills.entries.{skill_key}.enabled"),
            Value::Bool(enabled),
        )?;
    }
    write_config_value(&path, &config)?;
    Ok(json!({ "ok": true, "skillKey": skill_key }))
}

fn skills_install(state: &GatewayState, params: Value) -> Result<Value, String> {
    let skill_key = safe_runtime_component_id(
        &required_param(&params, &["skillKey", "name", "slug"])?,
        "skill key",
    )?;
    let skill_dir = state.runtime_root.join("skills").join(&skill_key);
    let skill_path = skill_dir.join("SKILL.md");
    let content = params
        .get("content")
        .or_else(|| params.get("body"))
        .and_then(Value::as_str)
        .map(ToOwned::to_owned)
        .unwrap_or_else(|| {
            format!(
                "---\nname: {skill_key}\ndescription: Local Rust Gateway installed skill.\n---\n\n# {skill_key}\n"
            )
        });
    std::fs::create_dir_all(&skill_dir)
        .map_err(|error| format!("failed to create skill directory: {error}"))?;
    std::fs::write(&skill_path, content)
        .map_err(|error| format!("failed to write skill {}: {error}", skill_path.display()))?;

    let path = config_path(state);
    let mut config = read_config_value(&path)?;
    set_json_path(
        &mut config,
        &format!("skills.entries.{skill_key}.enabled"),
        Value::Bool(true),
    )?;
    set_json_path(
        &mut config,
        &format!("skills.entries.{skill_key}.source"),
        Value::String("rust-local".to_string()),
    )?;
    write_config_value(&path, &config)?;
    Ok(json!({
        "ok": true,
        "skillKey": skill_key,
        "path": skill_path.to_string_lossy(),
        "implementation": "rust-native"
    }))
}

fn wizard_start(state: &GatewayState, params: Value) -> Result<Value, String> {
    let mut sessions = state
        .wizard_sessions
        .lock()
        .map_err(|_| "wizard session store lock poisoned".to_string())?;
    if sessions.values().any(|session| session.status == "running") {
        return Err("wizard already running".to_string());
    }
    let now = now_millis() as u64;
    let session_id = format!("rust-wizard-{now}");
    let step = json!({
        "id": format!("{session_id}-intro"),
        "type": "note",
        "title": "CrawClaw Rust Gateway",
        "message": wizard_intro_message(&params),
        "executor": "client"
    });
    sessions.insert(
        session_id.clone(),
        WizardSessionRecord {
            session_id: session_id.clone(),
            status: "running".to_string(),
            error: None,
            step: Some(step.clone()),
            created_at_ms: now,
            updated_at_ms: now,
        },
    );
    Ok(json!({
        "sessionId": session_id,
        "done": false,
        "status": "running",
        "step": step
    }))
}

fn wizard_next(state: &GatewayState, params: Value) -> Result<Value, String> {
    let session_id = required_param(&params, &["sessionId"])?;
    let mut sessions = state
        .wizard_sessions
        .lock()
        .map_err(|_| "wizard session store lock poisoned".to_string())?;
    let session = sessions
        .get_mut(&session_id)
        .ok_or_else(|| "wizard not found".to_string())?;
    if session.status != "running" {
        return Err("wizard not running".to_string());
    }
    if let Some(answer) = params.get("answer") {
        let expected_step = session
            .step
            .as_ref()
            .and_then(|step| step.get("id"))
            .and_then(Value::as_str)
            .unwrap_or_default();
        let answered_step = answer
            .get("stepId")
            .and_then(Value::as_str)
            .unwrap_or_default();
        if expected_step.is_empty() || answered_step != expected_step {
            return Err("wizard: no pending step".to_string());
        }
        session.status = "done".to_string();
        session.step = None;
        session.updated_at_ms = now_millis() as u64;
        let response = wizard_terminal_response(session, true);
        sessions.remove(&session_id);
        return Ok(response);
    }
    Ok(wizard_next_response(session))
}

fn wizard_cancel(state: &GatewayState, params: Value) -> Result<Value, String> {
    let session_id = required_param(&params, &["sessionId"])?;
    let mut sessions = state
        .wizard_sessions
        .lock()
        .map_err(|_| "wizard session store lock poisoned".to_string())?;
    let mut session = sessions
        .remove(&session_id)
        .ok_or_else(|| "wizard not found".to_string())?;
    session.status = "cancelled".to_string();
    session.error = Some("cancelled".to_string());
    session.step = None;
    session.updated_at_ms = now_millis() as u64;
    Ok(wizard_status_response(&session))
}

fn wizard_status(state: &GatewayState, params: Value) -> Result<Value, String> {
    let session_id = required_param(&params, &["sessionId"])?;
    let sessions = state
        .wizard_sessions
        .lock()
        .map_err(|_| "wizard session store lock poisoned".to_string())?;
    let session = sessions
        .get(&session_id)
        .ok_or_else(|| "wizard not found".to_string())?;
    Ok(wizard_status_response(session))
}

fn wizard_intro_message(params: &Value) -> String {
    let mode = string_param(params, &["mode"]).unwrap_or_else(|| "local".to_string());
    format!("Rust Gateway setup session is active for {mode} mode.")
}

fn wizard_next_response(session: &WizardSessionRecord) -> Value {
    if session.status != "running" || session.step.is_none() {
        return wizard_terminal_response(session, true);
    }
    json!({
        "sessionId": session.session_id,
        "done": false,
        "status": session.status,
        "step": session.step,
        "createdAtMs": session.created_at_ms,
        "updatedAtMs": session.updated_at_ms
    })
}

fn wizard_terminal_response(session: &WizardSessionRecord, done: bool) -> Value {
    json!({
        "sessionId": session.session_id,
        "done": done,
        "status": session.status,
        "error": session.error,
        "createdAtMs": session.created_at_ms,
        "updatedAtMs": session.updated_at_ms
    })
}

fn wizard_status_response(session: &WizardSessionRecord) -> Value {
    json!({
        "sessionId": session.session_id,
        "status": session.status,
        "error": session.error,
        "createdAtMs": session.created_at_ms,
        "updatedAtMs": session.updated_at_ms
    })
}

fn approvals_snapshot(state: &GatewayState, kind: &str) -> Result<Value, String> {
    let path = approvals_file_path(state, kind);
    let Some((raw, file)) = read_approvals_file(&path)? else {
        return Ok(json!({
            "path": path.to_string_lossy(),
            "exists": false,
            "hash": stable_text_hash(""),
            "file": default_approvals_file()
        }));
    };
    Ok(json!({
        "path": path.to_string_lossy(),
        "exists": true,
        "hash": stable_text_hash(&raw),
        "file": redact_approvals_file(file)
    }))
}

fn approvals_set(state: &GatewayState, params: Value, kind: &str) -> Result<Value, String> {
    let path = approvals_file_path(state, kind);
    let current = read_approvals_file(&path)?;
    if let Some((raw, _)) = current.as_ref() {
        let base_hash = string_param(&params, &["baseHash", "base_hash", "hash"])
            .ok_or_else(|| format!("{kind} approvals base hash required; re-run get and retry"))?;
        if base_hash != stable_text_hash(raw) {
            return Err(format!(
                "{kind} approvals changed since last load; re-run get and retry"
            ));
        }
    }
    let mut file = params
        .get("file")
        .cloned()
        .filter(Value::is_object)
        .ok_or_else(|| format!("{kind} approvals file is required"))?;
    normalize_approvals_file(&mut file);
    preserve_approval_socket_token(current.as_ref().map(|(_, file)| file), &mut file);
    write_json_file(&path, &file)?;
    approvals_snapshot(state, kind)
}

fn approvals_file_path(state: &GatewayState, kind: &str) -> PathBuf {
    state.state_dir.join(format!("{kind}-approvals.json"))
}

fn read_approvals_file(path: &Path) -> Result<Option<(String, Value)>, String> {
    let raw = match std::fs::read_to_string(path) {
        Ok(raw) => raw,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => {
            return Err(format!(
                "failed to read approvals file {}: {error}",
                path.display()
            ));
        }
    };
    let file = serde_json::from_str(&raw)
        .map_err(|error| format!("invalid approvals file {}: {error}", path.display()))?;
    Ok(Some((raw, file)))
}

fn default_approvals_file() -> Value {
    json!({
        "version": 1,
        "defaults": {},
        "agents": {}
    })
}

fn normalize_approvals_file(file: &mut Value) {
    if file.get("version").is_none() {
        file["version"] = json!(1);
    }
    if !file.get("defaults").map(Value::is_object).unwrap_or(false) {
        file["defaults"] = json!({});
    }
    if !file.get("agents").map(Value::is_object).unwrap_or(false) {
        file["agents"] = json!({});
    }
}

fn preserve_approval_socket_token(current: Option<&Value>, next: &mut Value) {
    let Some(current_token) = current
        .and_then(|file| file.get("socket"))
        .and_then(|socket| socket.get("token"))
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
    else {
        return;
    };
    let Some(next_socket) = next.get_mut("socket").and_then(Value::as_object_mut) else {
        return;
    };
    if next_socket
        .get("token")
        .and_then(Value::as_str)
        .map(|value| value.trim().is_empty())
        .unwrap_or(true)
    {
        next_socket.insert(
            "token".to_string(),
            Value::String(current_token.to_string()),
        );
    }
}

fn redact_approvals_file(mut file: Value) -> Value {
    if let Some(socket) = file.get_mut("socket").and_then(Value::as_object_mut) {
        socket.remove("token");
        if socket
            .get("path")
            .and_then(Value::as_str)
            .map(|value| value.trim().is_empty())
            .unwrap_or(true)
        {
            file.as_object_mut().map(|object| object.remove("socket"));
        }
    }
    file
}

fn stable_text_hash(raw: &str) -> String {
    format!("{:x}", Sha256::digest(raw.as_bytes()))
}

fn approval_request(state: &GatewayState, params: Value, kind: &str) -> Result<Value, String> {
    validate_approval_request(&params, kind)?;
    let id = approval_request_id(&params, kind);
    let now = now_millis() as u64;
    let timeout_ms = params
        .get("timeoutMs")
        .and_then(Value::as_u64)
        .unwrap_or(1_800_000)
        .max(1);
    let created_at_ms = now;
    let expires_at_ms = now.saturating_add(timeout_ms);
    let record = ApprovalRecord {
        id: id.clone(),
        kind: kind.to_string(),
        request: params.clone(),
        created_at_ms,
        expires_at_ms,
        decision: None,
        resolved_by: None,
        resolved_at_ms: None,
    };
    {
        let mut approvals = state
            .approvals
            .lock()
            .map_err(|_| "approval store lock poisoned".to_string())?;
        if approvals.contains_key(&id) {
            return Err("approval id already pending".to_string());
        }
        approvals.insert(id.clone(), record);
    }
    let event = json!({
        "id": id,
        "request": params,
        "createdAtMs": created_at_ms,
        "expiresAtMs": expires_at_ms
    });
    emit(state, &format!("{kind}.requested"), event);
    if bool_param(&params, &["twoPhase"]).unwrap_or(false) {
        return Ok(json!({
            "status": "accepted",
            "id": id,
            "createdAtMs": created_at_ms,
            "expiresAtMs": expires_at_ms
        }));
    }
    Ok(json!({
        "id": id,
        "decision": Value::Null,
        "createdAtMs": created_at_ms,
        "expiresAtMs": expires_at_ms
    }))
}

fn approval_wait_decision(state: &GatewayState, params: Value) -> Result<Value, String> {
    let id = required_param(&params, &["id"])?;
    let approvals = state
        .approvals
        .lock()
        .map_err(|_| "approval store lock poisoned".to_string())?;
    let Some(record) = approvals.get(&id) else {
        return Err("approval expired or not found".to_string());
    };
    Ok(approval_wait_response(record))
}

fn approval_resolve(state: &GatewayState, params: Value, kind: &str) -> Result<Value, String> {
    let raw_id = required_param(&params, &["id"])?;
    let decision = required_param(&params, &["decision"])?;
    if !["allow-once", "allow-always", "deny"].contains(&decision.as_str()) {
        return Err("invalid decision".to_string());
    }
    let resolved_by = string_param(&params, &["resolvedBy"]);
    let now = now_millis() as u64;
    let (id, event) = {
        let mut approvals = state
            .approvals
            .lock()
            .map_err(|_| "approval store lock poisoned".to_string())?;
        let id = resolve_pending_approval_id(&approvals, &raw_id, kind)?;
        let record = approvals
            .get_mut(&id)
            .ok_or_else(|| "unknown or expired approval id".to_string())?;
        if record.decision.is_some() {
            return Err("unknown or expired approval id".to_string());
        }
        record.decision = Some(decision.clone());
        record.resolved_by = resolved_by.clone();
        record.resolved_at_ms = Some(now);
        let event = json!({
            "id": id,
            "decision": decision,
            "resolvedBy": resolved_by,
            "ts": now,
            "request": record.request
        });
        (record.id.clone(), event)
    };
    emit(state, &format!("{kind}.resolved"), event);
    Ok(json!({ "ok": true, "id": id }))
}

fn validate_approval_request(params: &Value, kind: &str) -> Result<(), String> {
    if kind == "exec.approval" && string_param(params, &["command"]).is_none() {
        return Err("command is required".to_string());
    }
    if kind == "plugin.approval" {
        if string_param(params, &["title"]).is_none() {
            return Err("title is required".to_string());
        }
        if string_param(params, &["description"]).is_none() {
            return Err("description is required".to_string());
        }
    }
    Ok(())
}

fn approval_request_id(params: &Value, kind: &str) -> String {
    if kind == "plugin.approval" {
        return format!("plugin:rust-{}", now_millis());
    }
    string_param(params, &["id"]).unwrap_or_else(|| format!("approval-{}", now_millis()))
}

fn resolve_pending_approval_id(
    approvals: &BTreeMap<String, ApprovalRecord>,
    raw_id: &str,
    kind: &str,
) -> Result<String, String> {
    let raw_id = raw_id.trim();
    if approvals
        .get(raw_id)
        .map(|record| record.kind == kind && record.decision.is_none())
        .unwrap_or(false)
    {
        return Ok(raw_id.to_string());
    }
    let matches = approvals
        .values()
        .filter(|record| record.kind == kind && record.decision.is_none())
        .filter(|record| record.id.starts_with(raw_id))
        .map(|record| record.id.clone())
        .collect::<Vec<_>>();
    match matches.as_slice() {
        [id] => Ok(id.clone()),
        [] => Err("unknown or expired approval id".to_string()),
        _ => Err(format!(
            "ambiguous approval id prefix; matches: {}. Use the full id.",
            matches.into_iter().take(3).collect::<Vec<_>>().join(", ")
        )),
    }
}

fn approval_wait_response(record: &ApprovalRecord) -> Value {
    json!({
        "id": record.id,
        "decision": record
            .decision
            .as_ref()
            .map(|decision| Value::String(decision.clone()))
            .unwrap_or(Value::Null),
        "createdAtMs": record.created_at_ms,
        "expiresAtMs": record.expires_at_ms,
        "resolvedBy": record.resolved_by,
        "resolvedAtMs": record.resolved_at_ms,
        "request": record.request
    })
}

fn plugins_list(state: &GatewayState) -> Result<Value, String> {
    let config = read_config_value(&config_path(state))?;
    let entry_ids = get_json_path(&config, "plugins.entries")
        .and_then(Value::as_object)
        .map(|entries| entries.keys().cloned().collect::<Vec<_>>())
        .unwrap_or_default();
    let install_ids = get_json_path(&config, "plugins.installs")
        .and_then(Value::as_object)
        .map(|installs| installs.keys().cloned().collect::<Vec<_>>())
        .unwrap_or_default();
    let plugin_ids = entry_ids
        .into_iter()
        .chain(install_ids)
        .collect::<BTreeSet<_>>();
    let plugins = plugin_ids
        .into_iter()
        .map(|id| {
            let entry = get_json_path(&config, &format!("plugins.entries.{id}"));
            let install = get_json_path(&config, &format!("plugins.installs.{id}"));
            plugin_list_entry(state, &id, entry, install)
        })
        .collect::<Vec<_>>();
    Ok(json!({
        "workspaceDir": state.runtime_root.join("plugins").to_string_lossy(),
        "plugins": plugins,
        "diagnostics": []
    }))
}

fn plugin_list_entry(
    state: &GatewayState,
    id: &str,
    entry: Option<&Value>,
    install: Option<&Value>,
) -> Value {
    let install_path = install
        .and_then(|record| record.get("installPath").and_then(Value::as_str))
        .map(|value| normalize_plugin_filesystem_path(state, value))
        .unwrap_or_else(|| plugin_install_dir(state, id));
    let manifest_path = install_path.join("crawclaw.plugin.json");
    let manifest = if manifest_path.exists() {
        read_json_file(&manifest_path).ok()
    } else {
        None
    };
    let name = manifest
        .as_ref()
        .and_then(|manifest| manifest.get("name").and_then(Value::as_str))
        .unwrap_or(id);
    let version = manifest
        .as_ref()
        .and_then(plugin_manifest_version)
        .or_else(|| {
            install
                .and_then(|record| record.get("version").and_then(Value::as_str))
                .map(ToOwned::to_owned)
        });
    let enabled = entry
        .and_then(|entry| entry.get("enabled").and_then(Value::as_bool))
        .unwrap_or(false);
    let config = entry
        .and_then(|entry| entry.get("config").cloned())
        .unwrap_or(Value::Null);
    let source_path = install.and_then(|record| record.get("sourcePath").and_then(Value::as_str));
    let mut snapshot = Map::new();
    snapshot.insert("id".to_string(), Value::String(id.to_string()));
    snapshot.insert("name".to_string(), Value::String(name.to_string()));
    snapshot.insert("enabled".to_string(), Value::Bool(enabled));
    snapshot.insert("configured".to_string(), Value::Bool(!config.is_null()));
    snapshot.insert("config".to_string(), config);
    snapshot.insert(
        "status".to_string(),
        Value::String(
            if install.is_some() {
                if manifest_path.exists() {
                    "installed"
                } else {
                    "missing"
                }
            } else {
                "configured"
            }
            .to_string(),
        ),
    );
    snapshot.insert(
        "origin".to_string(),
        Value::String(if install.is_some() { "local" } else { "config" }.to_string()),
    );
    snapshot.insert(
        "source".to_string(),
        Value::String(source_path.unwrap_or("config").to_string()),
    );
    if let Some(version) = version {
        snapshot.insert("version".to_string(), Value::String(version));
    }
    if let Some(record) = install {
        snapshot.insert(
            "installSource".to_string(),
            Value::String(
                record
                    .get("source")
                    .and_then(Value::as_str)
                    .unwrap_or("unknown")
                    .to_string(),
            ),
        );
        if let Some(source_path) = source_path {
            snapshot.insert(
                "sourcePath".to_string(),
                Value::String(source_path.to_string()),
            );
        }
        snapshot.insert(
            "installPath".to_string(),
            Value::String(install_path.to_string_lossy().to_string()),
        );
        snapshot.insert(
            "manifestPath".to_string(),
            Value::String(manifest_path.to_string_lossy().to_string()),
        );
    }
    Value::Object(snapshot)
}

fn plugins_set_enabled(
    state: &GatewayState,
    params: Value,
    enabled: bool,
) -> Result<Value, String> {
    let id = required_param(&params, &["id", "pluginId"])?;
    if id.contains('.') {
        return Err("plugin id cannot contain dots".to_string());
    }
    let path = config_path(state);
    let mut config = read_config_value(&path)?;
    set_json_path(
        &mut config,
        &format!("plugins.entries.{id}.enabled"),
        Value::Bool(enabled),
    )?;
    write_config_value(&path, &config)?;
    Ok(json!({
        "ok": true,
        "id": id,
        "enabled": enabled,
        "config": config
    }))
}

fn plugins_install(state: &GatewayState, params: Value) -> Result<Value, String> {
    let mut source = plugin_install_source(state, &params, "install")?;
    let id = resolve_plugin_install_id(&params, &source.manifest)?;
    normalize_plugin_manifest(&mut source.manifest, &id)?;
    let link = bool_param(&params, &["link"]).unwrap_or(false);
    let plugin_dir = if link {
        source
            .source_root
            .clone()
            .ok_or_else(|| "plugins.install link requires a local plugin directory".to_string())?
    } else {
        plugin_install_dir(state, &id)
    };
    let manifest_path = if link {
        plugin_dir.join("crawclaw.plugin.json")
    } else {
        install_plugin_source(&source, &plugin_dir, false)?
    };

    let path = config_path(state);
    let mut config = read_config_value(&path)?;
    set_json_path(
        &mut config,
        &format!("plugins.entries.{id}.enabled"),
        Value::Bool(true),
    )?;
    delete_json_path(&mut config, &format!("plugins.entries.{id}.source"));
    if link {
        add_string_to_json_array(
            &mut config,
            "plugins.load.paths",
            &plugin_dir.to_string_lossy(),
        )?;
    }
    let mut install_record = plugin_install_record(&source, &plugin_dir);
    if bool_param(&params, &["pin"]).unwrap_or(false) && source.install_source == "npm" {
        if let Some(resolved_spec) = install_record
            .get("resolvedSpec")
            .and_then(Value::as_str)
            .map(ToOwned::to_owned)
        {
            if let Some(record) = install_record.as_object_mut() {
                record.insert("spec".to_string(), Value::String(resolved_spec));
            }
        }
    }
    set_json_path(
        &mut config,
        &format!("plugins.installs.{id}"),
        install_record,
    )?;
    write_config_value(&path, &config)?;
    cleanup_plugin_temp_dir(&source);
    Ok(json!({
        "ok": true,
        "pluginId": id,
        "id": id,
        "installSource": source.install_source,
        "requiresRestart": true,
        "warnings": [],
        "manifestPath": manifest_path.to_string_lossy(),
        "manifest": source.manifest,
        "implementation": "rust-native"
    }))
}

fn plugins_update(state: &GatewayState, params: Value) -> Result<Value, String> {
    let path = config_path(state);
    let mut config = read_config_value(&path)?;
    let dry_run = bool_param(&params, &["dryRun", "dry_run"]).unwrap_or(false);
    let force = bool_param(&params, &["force"]).unwrap_or(false);
    let target_ids = resolve_plugin_update_targets(&config, &params)?;
    let mut changed = false;
    let mut outcomes = Vec::new();

    for id in target_ids {
        let Some(record) = get_json_path(&config, &format!("plugins.installs.{id}")).cloned()
        else {
            outcomes.push(json!({
                "pluginId": id,
                "status": "skipped",
                "message": format!("No install record for \"{id}\".")
            }));
            continue;
        };
        let source = record
            .get("source")
            .and_then(Value::as_str)
            .unwrap_or_default();
        if !matches!(
            source,
            "path" | "bundled" | "archive" | "npm" | "clawhub" | "marketplace"
        ) {
            outcomes.push(json!({
                "pluginId": id,
                "status": "skipped",
                "message": format!("Skipping \"{id}\" (source: {source}).")
            }));
            continue;
        }
        let install_path = record
            .get("installPath")
            .and_then(Value::as_str)
            .map(|value| normalize_plugin_filesystem_path(state, value))
            .unwrap_or_else(|| plugin_install_dir(state, &id));
        let source_params = match plugin_update_source_params(state, &id, &record, &params) {
            Ok(params) => params,
            Err(message) => {
                outcomes.push(json!({
                    "pluginId": id,
                    "status": "skipped",
                    "message": message
                }));
                continue;
            }
        };
        let mut source = match plugin_install_source(state, &source_params, "update") {
            Ok(source) => source,
            Err(message) => {
                outcomes.push(json!({
                    "pluginId": id,
                    "status": "error",
                    "message": message
                }));
                continue;
            }
        };
        normalize_plugin_manifest(&mut source.manifest, &id)?;
        if source.install_source == "npm" {
            let expected_integrity = record.get("integrity").and_then(Value::as_str).filter(|_| {
                record.get("spec").and_then(Value::as_str)
                    == source.record_fields.get("spec").and_then(Value::as_str)
            });
            let actual_integrity = source
                .record_fields
                .get("integrity")
                .and_then(Value::as_str);
            if expected_integrity.is_some()
                && actual_integrity.is_some()
                && expected_integrity != actual_integrity
                && !force
            {
                cleanup_plugin_temp_dir(&source);
                outcomes.push(json!({
                    "pluginId": id,
                    "status": "error",
                    "message": format!(
                        "Integrity drift detected for \"{id}\"; pass force=true to update."
                    ),
                    "expectedIntegrity": expected_integrity,
                    "actualIntegrity": actual_integrity
                }));
                continue;
            }
        }
        let next_manifest = source.manifest.clone();
        let next_id = match resolve_plugin_manifest_id(&next_manifest) {
            Ok(next_id) => next_id,
            Err(message) => {
                cleanup_plugin_temp_dir(&source);
                outcomes.push(json!({
                    "pluginId": id,
                    "status": "error",
                    "message": message
                }));
                continue;
            }
        };
        if next_id != id {
            cleanup_plugin_temp_dir(&source);
            outcomes.push(json!({
                "pluginId": id,
                "status": "error",
                "message": format!("Source manifest id \"{next_id}\" does not match installed plugin \"{id}\".")
            }));
            continue;
        }

        let installed_manifest_path = install_path.join("crawclaw.plugin.json");
        let current_manifest = if installed_manifest_path.exists() {
            read_json_file(&installed_manifest_path).ok()
        } else {
            None
        };
        let current_version = current_manifest
            .as_ref()
            .and_then(plugin_manifest_version)
            .or_else(|| {
                record
                    .get("version")
                    .and_then(Value::as_str)
                    .map(ToOwned::to_owned)
            });
        let next_version = plugin_manifest_version(&next_manifest);
        let should_update = force || current_manifest.is_none() || current_version != next_version;

        if should_update && !dry_run {
            let mut next_record = record.as_object().cloned().unwrap_or_default();
            install_plugin_source(&source, &install_path, false)?;
            merge_plugin_install_record(
                &mut next_record,
                plugin_install_record(&source, &install_path),
            );
            set_json_path(
                &mut config,
                &format!("plugins.installs.{id}"),
                Value::Object(next_record),
            )?;
            changed = true;
        }

        outcomes.push(json!({
            "pluginId": id,
            "status": if should_update { "updated" } else { "unchanged" },
            "message": if should_update {
                format!("Updated \"{id}\" from local path.")
            } else {
                format!("\"{id}\" is already up to date.")
            },
            "currentVersion": current_version,
            "nextVersion": next_version
        }));
        cleanup_plugin_temp_dir(&source);
    }

    if changed && !dry_run {
        write_config_value(&path, &config)?;
    }
    Ok(json!({
        "ok": true,
        "changed": changed,
        "dryRun": dry_run,
        "requiresRestart": changed && !dry_run,
        "outcomes": outcomes,
        "implementation": "rust-native"
    }))
}

fn plugins_uninstall(state: &GatewayState, params: Value) -> Result<Value, String> {
    let id = safe_plugin_id(&required_param(&params, &["id", "pluginId"])?)?;
    let keep_files = bool_param(&params, &["keepFiles", "keep_files"]).unwrap_or(false);
    let path = config_path(state);
    let mut config = read_config_value(&path)?;
    let install_record = get_json_path(&config, &format!("plugins.installs.{id}")).cloned();
    let has_entry = get_json_path(&config, &format!("plugins.entries.{id}")).is_some();
    let has_install = install_record.is_some();
    let install_dir = plugin_install_dir(state, &id);

    if !has_entry && !has_install && !install_dir.exists() {
        return Err(format!("Plugin not found: {id}"));
    }

    let mut actions = Map::new();
    actions.insert(
        "entry".to_string(),
        Value::Bool(delete_json_path(
            &mut config,
            &format!("plugins.entries.{id}"),
        )),
    );
    actions.insert(
        "install".to_string(),
        Value::Bool(delete_json_path(
            &mut config,
            &format!("plugins.installs.{id}"),
        )),
    );
    actions.insert(
        "allowlist".to_string(),
        Value::Bool(remove_string_from_json_array(
            &mut config,
            "plugins.allow",
            &id,
        )),
    );
    let removed_load_path = install_record
        .as_ref()
        .and_then(|record| record.get("sourcePath").and_then(Value::as_str))
        .map(|source_path| {
            remove_string_from_json_array(&mut config, "plugins.load.paths", source_path)
        })
        .unwrap_or(false);
    actions.insert("loadPath".to_string(), Value::Bool(removed_load_path));
    let memory_slot = get_json_path(&config, "plugins.slots.memory")
        .and_then(Value::as_str)
        .map(|slot| slot == id)
        .unwrap_or(false);
    if memory_slot {
        set_json_path(
            &mut config,
            "plugins.slots.memory",
            Value::String("none".to_string()),
        )?;
    }
    actions.insert("memorySlot".to_string(), Value::Bool(memory_slot));
    actions.insert(
        "channelConfig".to_string(),
        Value::Bool(if has_install {
            delete_json_path(&mut config, &format!("channels.{id}"))
        } else {
            false
        }),
    );

    let mut warnings = Vec::new();
    let mut directory_removed = false;
    if !keep_files {
        if install_dir.exists() {
            match std::fs::remove_dir_all(&install_dir) {
                Ok(()) => directory_removed = true,
                Err(error) => warnings.push(format!(
                    "Failed to remove plugin directory {}: {error}",
                    install_dir.display()
                )),
            }
        }
    }
    actions.insert("directory".to_string(), Value::Bool(directory_removed));

    write_config_value(&path, &config)?;
    Ok(json!({
        "ok": true,
        "pluginId": id,
        "id": id,
        "requiresRestart": true,
        "warnings": warnings,
        "actions": Value::Object(actions),
        "implementation": "rust-native"
    }))
}

#[derive(Debug)]
struct PluginInstallSource {
    manifest: Value,
    source_root: Option<PathBuf>,
    source_path: Option<PathBuf>,
    install_source: String,
    record_fields: Map<String, Value>,
    package_dependencies: bool,
    cleanup_roots: Vec<PathBuf>,
}

fn plugin_install_source(
    _state: &GatewayState,
    params: &Value,
    mode: &str,
) -> Result<PluginInstallSource, String> {
    if let Some(raw) = string_param(params, &["raw", "source", "path"]) {
        let source = expand_user_path(&raw);
        if source.exists() {
            return plugin_install_source_from_path(&source, "path", Some(source.clone()), None);
        }
        if raw.trim().starts_with("clawhub:") {
            return plugin_install_source_from_clawhub(&raw);
        }
        return plugin_install_source_from_npm_spec(&raw, mode);
    }
    if let Some(manifest) = params.get("manifest") {
        return Ok(PluginInstallSource {
            manifest: manifest.clone(),
            source_root: None,
            source_path: None,
            install_source: "manifest".to_string(),
            record_fields: Map::new(),
            package_dependencies: false,
            cleanup_roots: Vec::new(),
        });
    }
    if let Some(spec) = string_param(params, &["npmSpec", "spec"]) {
        return plugin_install_source_from_npm_spec(&spec, mode);
    }
    if let Some(spec) = string_param(params, &["clawhubSpec"]) {
        return plugin_install_source_from_clawhub(&spec);
    }
    if let Some(marketplace) = string_param(params, &["marketplace", "marketplaceSource"]) {
        let plugin = required_param(params, &["plugin", "marketplacePlugin", "pluginId", "id"])?;
        return plugin_install_source_from_marketplace(&marketplace, &plugin);
    }
    let id = required_param(params, &["pluginId", "id", "name"])?;
    let safe_id = safe_plugin_id(&id)?;
    if let Some((source_root, manifest_path)) = bundled_plugin_manifest_path(&safe_id) {
        return Ok(PluginInstallSource {
            manifest: read_json_file(&manifest_path)?,
            source_root: Some(source_root.clone()),
            source_path: Some(source_root),
            install_source: "bundled".to_string(),
            record_fields: Map::new(),
            package_dependencies: false,
            cleanup_roots: Vec::new(),
        });
    }
    plugin_install_source_from_npm_spec(&id, mode).or_else(|_| {
        Ok(PluginInstallSource {
            manifest: json!({
                "id": id,
                "name": id,
                "version": "0.0.0",
                "runtime": "rust-local"
            }),
            source_root: None,
            source_path: None,
            install_source: "generated".to_string(),
            record_fields: Map::new(),
            package_dependencies: false,
            cleanup_roots: Vec::new(),
        })
    })
}

fn resolve_plugin_install_id(params: &Value, manifest: &Value) -> Result<String, String> {
    let requested = string_param(params, &["pluginId", "id", "name"]);
    let manifest_id = manifest
        .get("id")
        .and_then(Value::as_str)
        .map(ToOwned::to_owned);
    let raw = requested
        .clone()
        .or_else(|| manifest_id.clone())
        .ok_or_else(|| "plugins.install requires pluginId or manifest.id".to_string())?;
    let id = safe_plugin_id(&raw)?;
    if let (Some(requested), Some(manifest_id)) = (requested, manifest_id) {
        let requested = safe_plugin_id(&requested)?;
        let manifest_id = safe_plugin_id(&manifest_id)?;
        if requested != manifest_id {
            return Err(format!(
                "plugins.install pluginId \"{requested}\" does not match manifest id \"{manifest_id}\""
            ));
        }
    }
    Ok(id)
}

fn resolve_plugin_manifest_id(manifest: &Value) -> Result<String, String> {
    let id = manifest
        .get("id")
        .and_then(Value::as_str)
        .ok_or_else(|| "plugin manifest requires id".to_string())?;
    safe_plugin_id(id)
}

fn normalize_plugin_manifest(manifest: &mut Value, id: &str) -> Result<(), String> {
    let Some(object) = manifest.as_object_mut() else {
        return Err("plugins.install manifest must be an object".to_string());
    };
    object
        .entry("id".to_string())
        .or_insert_with(|| Value::String(id.to_string()));
    object
        .entry("name".to_string())
        .or_insert_with(|| Value::String(id.to_string()));
    object
        .entry("version".to_string())
        .or_insert_with(|| Value::String("0.0.0".to_string()));
    Ok(())
}

fn plugin_install_record(source: &PluginInstallSource, install_path: &std::path::Path) -> Value {
    let mut record = source.record_fields.clone();
    record.insert(
        "source".to_string(),
        Value::String(source.install_source.to_string()),
    );
    if let Some(source_path) = &source.source_path {
        record.insert(
            "sourcePath".to_string(),
            Value::String(source_path.to_string_lossy().to_string()),
        );
    }
    record.insert(
        "installPath".to_string(),
        Value::String(install_path.to_string_lossy().to_string()),
    );
    if let Some(version) = plugin_manifest_version(&source.manifest) {
        record.insert("version".to_string(), Value::String(version));
    }
    record.insert(
        "installedAt".to_string(),
        Value::String(now_timestamp_string()),
    );
    Value::Object(record)
}

fn merge_plugin_install_record(record: &mut Map<String, Value>, next: Value) {
    if let Some(next) = next.as_object() {
        for field in [
            "source",
            "spec",
            "sourcePath",
            "installPath",
            "version",
            "resolvedName",
            "resolvedVersion",
            "resolvedSpec",
            "integrity",
            "shasum",
            "resolvedAt",
            "installedAt",
            "marketplaceName",
            "marketplaceSource",
            "marketplacePlugin",
            "clawhubUrl",
            "clawhubPackage",
            "clawhubFamily",
            "clawhubChannel",
        ] {
            if let Some(value) = next.get(field) {
                record.insert(field.to_string(), value.clone());
            } else {
                record.remove(field);
            }
        }
    }
}

fn resolve_plugin_update_targets(config: &Value, params: &Value) -> Result<Vec<String>, String> {
    if let Some(id) = string_param(params, &["id", "pluginId"]) {
        return Ok(vec![safe_plugin_id(&id)?]);
    }
    if bool_param(params, &["all"]).unwrap_or(false) {
        let ids = get_json_path(config, "plugins.installs")
            .and_then(Value::as_object)
            .map(|installs| installs.keys().cloned().collect::<Vec<_>>())
            .unwrap_or_default();
        return Ok(ids);
    }
    Err("Provide a plugin id or set all=true.".to_string())
}

fn plugin_manifest_path_from_source(
    source: &std::path::Path,
) -> Result<(PathBuf, PathBuf), String> {
    if source.is_dir() {
        let manifest_path = source.join("crawclaw.plugin.json");
        if manifest_path.exists() {
            return Ok((source.to_path_buf(), manifest_path));
        }
    }
    if source.is_file()
        && source
            .file_name()
            .and_then(|name| name.to_str())
            .map(|name| name == "crawclaw.plugin.json")
            .unwrap_or(false)
    {
        let Some(parent) = source.parent() else {
            return Err(format!(
                "Plugin manifest {} has no parent directory.",
                source.display()
            ));
        };
        return Ok((parent.to_path_buf(), source.to_path_buf()));
    }
    Err(format!(
        "Rust plugins.install supports local plugin directories or crawclaw.plugin.json files; not found: {}",
        source.display()
    ))
}

fn plugin_install_source_from_path(
    source: &std::path::Path,
    install_source: &str,
    source_path: Option<PathBuf>,
    cleanup_root: Option<PathBuf>,
) -> Result<PluginInstallSource, String> {
    if source.is_file() && resolve_archive_kind(source).is_some() {
        let extract = extract_plugin_archive(source)?;
        let root = resolve_extracted_plugin_root(&extract)?;
        let archive_install_source = if install_source == "path" {
            "archive"
        } else {
            install_source
        };
        let mut source = plugin_install_source_from_path(
            &root,
            archive_install_source,
            source_path.or_else(|| Some(source.to_path_buf())),
            Some(extract),
        )?;
        if let Some(cleanup_root) = cleanup_root {
            source.cleanup_roots.push(cleanup_root);
        }
        return Ok(source);
    }
    let (source_root, manifest_path) = match plugin_manifest_path_from_source(source) {
        Ok(value) => value,
        Err(_) => {
            return plugin_install_source_from_package_dir(
                source,
                install_source,
                source_path,
                cleanup_root,
            )
        }
    };
    Ok(PluginInstallSource {
        manifest: read_json_file(&manifest_path)?,
        source_root: Some(source_root),
        source_path,
        install_source: install_source.to_string(),
        record_fields: Map::new(),
        package_dependencies: false,
        cleanup_roots: cleanup_root.into_iter().collect(),
    })
}

fn plugin_install_source_from_package_dir(
    source: &std::path::Path,
    install_source: &str,
    source_path: Option<PathBuf>,
    cleanup_root: Option<PathBuf>,
) -> Result<PluginInstallSource, String> {
    if !source.is_dir() {
        return Err(format!(
            "plugin source is not a directory: {}",
            source.display()
        ));
    }
    let package_path = source.join("package.json");
    if !package_path.exists() {
        return Err(format!(
            "Rust plugins.install supports plugin directories, archives, npm specs, marketplace specs, or ClawHub specs; not found: {}",
            source.display()
        ));
    }
    let package = read_json_file(&package_path)?;
    let extensions = package_crawclaw_extensions(&package)?;
    let package_name = package
        .get("name")
        .and_then(Value::as_str)
        .unwrap_or("plugin")
        .trim()
        .to_string();
    let manifest_id = source
        .join("crawclaw.plugin.json")
        .exists()
        .then(|| read_json_file(&source.join("crawclaw.plugin.json")))
        .transpose()?
        .and_then(|manifest| {
            manifest
                .get("id")
                .and_then(Value::as_str)
                .map(ToOwned::to_owned)
        });
    let plugin_id = manifest_id.unwrap_or_else(|| package_name.clone());
    safe_plugin_id(&plugin_id)?;
    let version = package
        .get("version")
        .and_then(Value::as_str)
        .unwrap_or("0.0.0")
        .to_string();
    let mut manifest = json!({
        "id": plugin_id,
        "name": package_name,
        "version": version,
        "main": extensions.first().cloned().unwrap_or_else(|| "index.js".to_string()),
        "extensions": extensions
    });
    if let Some(auth_env_vars) = package
        .get("crawclaw")
        .and_then(|value| value.get("providerAuthEnvVars"))
        .cloned()
    {
        manifest["providerAuthEnvVars"] = auth_env_vars;
    }
    Ok(PluginInstallSource {
        manifest,
        source_root: Some(source.to_path_buf()),
        source_path,
        install_source: install_source.to_string(),
        record_fields: Map::new(),
        package_dependencies: package
            .get("dependencies")
            .and_then(Value::as_object)
            .map(|deps| !deps.is_empty())
            .unwrap_or(false),
        cleanup_roots: cleanup_root.into_iter().collect(),
    })
}

fn plugin_install_source_from_npm_spec(
    spec: &str,
    _mode: &str,
) -> Result<PluginInstallSource, String> {
    let packed = pack_npm_spec_to_archive(spec)?;
    let mut source = plugin_install_source_from_path(
        &packed.archive_path,
        "npm",
        None,
        Some(packed.temp_root.clone()),
    )?;
    source
        .record_fields
        .insert("spec".to_string(), Value::String(spec.to_string()));
    if let Some(name) = packed.metadata.get("name").and_then(Value::as_str) {
        source
            .record_fields
            .insert("resolvedName".to_string(), Value::String(name.to_string()));
    }
    if let Some(version) = packed.metadata.get("version").and_then(Value::as_str) {
        source.record_fields.insert(
            "resolvedVersion".to_string(),
            Value::String(version.to_string()),
        );
    }
    if let Some(resolved_spec) = packed.metadata.get("resolvedSpec").and_then(Value::as_str) {
        source.record_fields.insert(
            "resolvedSpec".to_string(),
            Value::String(resolved_spec.to_string()),
        );
    }
    if let Some(integrity) = packed.metadata.get("integrity").and_then(Value::as_str) {
        source.record_fields.insert(
            "integrity".to_string(),
            Value::String(integrity.to_string()),
        );
    }
    if let Some(shasum) = packed.metadata.get("shasum").and_then(Value::as_str) {
        source
            .record_fields
            .insert("shasum".to_string(), Value::String(shasum.to_string()));
    }
    source.record_fields.insert(
        "resolvedAt".to_string(),
        Value::String(now_timestamp_string()),
    );
    Ok(source)
}

fn plugin_install_source_from_clawhub(spec: &str) -> Result<PluginInstallSource, String> {
    let parsed = parse_clawhub_spec(spec)?;
    let base_url =
        env::var("CRAWCLAW_CLAWHUB_URL").unwrap_or_else(|_| "https://clawhub.ai".to_string());
    let version = parsed
        .version
        .clone()
        .unwrap_or_else(|| "latest".to_string());
    let tmp_root = create_plugin_temp_dir("crawclaw-clawhub-package")?;
    let archive_path = tmp_root.join(format!("{}.zip", safe_filename(&parsed.name)));
    let download_url = if version == "latest" {
        format!(
            "{}/api/v1/packages/{}/download",
            base_url.trim_end_matches('/'),
            percent_encode_path_segment(&parsed.name)
        )
    } else {
        format!(
            "{}/api/v1/packages/{}/download?version={}",
            base_url.trim_end_matches('/'),
            percent_encode_path_segment(&parsed.name),
            percent_encode_path_segment(&version)
        )
    };
    download_url_to_file(&download_url, &archive_path)?;
    let integrity = file_sha256_integrity(&archive_path)?;
    let mut source =
        plugin_install_source_from_path(&archive_path, "clawhub", None, Some(tmp_root.clone()))?;
    source
        .record_fields
        .insert("spec".to_string(), Value::String(spec.to_string()));
    source
        .record_fields
        .insert("integrity".to_string(), Value::String(integrity));
    source.record_fields.insert(
        "resolvedAt".to_string(),
        Value::String(now_timestamp_string()),
    );
    source.record_fields.insert(
        "clawhubUrl".to_string(),
        Value::String(base_url.trim_end_matches('/').to_string()),
    );
    source.record_fields.insert(
        "clawhubPackage".to_string(),
        Value::String(parsed.name.clone()),
    );
    source.record_fields.insert(
        "clawhubFamily".to_string(),
        Value::String("code-plugin".to_string()),
    );
    if let Some(version) = parsed.version {
        source
            .record_fields
            .insert("version".to_string(), Value::String(version));
    }
    Ok(source)
}

fn plugin_install_source_from_marketplace(
    marketplace: &str,
    plugin: &str,
) -> Result<PluginInstallSource, String> {
    let loaded = load_marketplace(marketplace)?;
    let entries = loaded
        .manifest
        .get("plugins")
        .and_then(Value::as_array)
        .ok_or_else(|| format!("invalid marketplace JSON at {marketplace}: missing plugins[]"))?;
    let entry = entries
        .iter()
        .find(|entry| entry.get("name").and_then(Value::as_str) == Some(plugin))
        .ok_or_else(|| format!("plugin \"{plugin}\" not found in marketplace {marketplace}"))?;
    let source_value = entry
        .get("source")
        .ok_or_else(|| format!("marketplace plugin \"{plugin}\" missing source"))?;
    let resolved = resolve_marketplace_plugin_source(source_value, &loaded.root_dir)?;
    let cleanup_root = resolved
        .cleanup_root
        .clone()
        .or_else(|| loaded.cleanup_root.clone());
    let mut source =
        plugin_install_source_from_path(&resolved.source_path, "marketplace", None, cleanup_root)?;
    source.record_fields.insert(
        "marketplaceSource".to_string(),
        Value::String(marketplace.to_string()),
    );
    source.record_fields.insert(
        "marketplacePlugin".to_string(),
        Value::String(plugin.to_string()),
    );
    if let Some(name) = loaded.manifest.get("name").and_then(Value::as_str) {
        source.record_fields.insert(
            "marketplaceName".to_string(),
            Value::String(name.to_string()),
        );
    }
    if let Some(version) = entry.get("version").and_then(Value::as_str) {
        source
            .record_fields
            .insert("version".to_string(), Value::String(version.to_string()));
    }
    Ok(source)
}

fn bundled_plugin_manifest_path(id: &str) -> Option<(PathBuf, PathBuf)> {
    let repo_root = env::var_os("CRAWCLAW_REPO_ROOT")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../.."));
    let source_root = repo_root.join("extensions").join(id);
    let manifest_path = source_root.join("crawclaw.plugin.json");
    manifest_path
        .exists()
        .then_some((source_root, manifest_path))
}

#[derive(Debug)]
struct PackedNpmArchive {
    archive_path: PathBuf,
    metadata: Value,
    temp_root: PathBuf,
}

#[derive(Debug)]
struct ParsedClawHubSpec {
    name: String,
    version: Option<String>,
}

#[derive(Debug)]
struct LoadedMarketplace {
    manifest: Value,
    root_dir: PathBuf,
    cleanup_root: Option<PathBuf>,
}

#[derive(Debug)]
struct MarketplacePluginSource {
    source_path: PathBuf,
    cleanup_root: Option<PathBuf>,
}

fn plugin_install_dir(state: &GatewayState, id: &str) -> PathBuf {
    state
        .runtime_root
        .join("plugins")
        .join(encode_plugin_install_dir_name(id))
}

fn normalize_plugin_filesystem_path(state: &GatewayState, raw: &str) -> PathBuf {
    let path = expand_user_path(raw);
    if path.is_absolute() {
        path
    } else {
        state.runtime_root.join(path)
    }
}

fn plugin_manifest_version(manifest: &Value) -> Option<String> {
    manifest
        .get("version")
        .and_then(Value::as_str)
        .map(ToOwned::to_owned)
}

fn safe_plugin_id(raw: &str) -> Result<String, String> {
    let value = raw.trim();
    if value.is_empty()
        || value == "."
        || value == ".."
        || value.contains('\\')
        || value.contains("..")
    {
        return Err("plugin id must be a safe local identifier".to_string());
    }
    if value.contains('.') {
        return Err("plugin id cannot contain dots".to_string());
    }
    let segments = value.split('/').collect::<Vec<_>>();
    match segments.as_slice() {
        [single] if !single.starts_with('@') && !single.is_empty() => Ok(value.to_string()),
        [scope, name]
            if scope.starts_with('@')
                && scope.len() > 1
                && !name.is_empty()
                && *name != "."
                && *name != ".." =>
        {
            Ok(value.to_string())
        }
        _ => Err("invalid plugin id: scoped ids must use @scope/name format".to_string()),
    }
}

fn safe_filename(raw: &str) -> String {
    let mut result = raw
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' || ch == '.' {
                ch
            } else {
                '-'
            }
        })
        .collect::<String>();
    if result.is_empty() || result == "." || result == ".." {
        result = "plugin".to_string();
    }
    result
}

fn encode_plugin_install_dir_name(id: &str) -> String {
    if !id.contains('/') {
        return safe_filename(id);
    }
    let hash = Sha256::digest(id.as_bytes())
        .iter()
        .take(5)
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>();
    format!("@{}-{hash}", safe_filename(&id.replace('/', "-")))
}

fn package_crawclaw_extensions(package: &Value) -> Result<Vec<String>, String> {
    let Some(entries) = package
        .get("crawclaw")
        .and_then(|value| value.get("extensions"))
        .and_then(Value::as_array)
    else {
        return Err(
            "package.json missing crawclaw.extensions; update the plugin package to include crawclaw.extensions".to_string(),
        );
    };
    let values = entries
        .iter()
        .filter_map(Value::as_str)
        .map(str::trim)
        .filter(|entry| !entry.is_empty())
        .map(ToOwned::to_owned)
        .collect::<Vec<_>>();
    if values.is_empty() {
        return Err("package.json crawclaw.extensions is empty".to_string());
    }
    Ok(values)
}

fn install_plugin_source(
    source: &PluginInstallSource,
    plugin_dir: &Path,
    dry_run: bool,
) -> Result<PathBuf, String> {
    let manifest_path = plugin_dir.join("crawclaw.plugin.json");
    if dry_run {
        return Ok(manifest_path);
    }
    if let Some(source_root) = &source.source_root {
        if !same_filesystem_path(source_root, plugin_dir) {
            copy_plugin_directory(source_root, plugin_dir)?;
        } else {
            std::fs::create_dir_all(plugin_dir).map_err(|error| {
                format!(
                    "failed to create plugin directory {}: {error}",
                    plugin_dir.display()
                )
            })?;
        }
    } else {
        std::fs::create_dir_all(plugin_dir)
            .map_err(|error| format!("failed to create plugin directory: {error}"))?;
    }
    write_json_file(&manifest_path, &source.manifest)?;
    if source.package_dependencies {
        install_plugin_package_dependencies(plugin_dir)?;
    }
    Ok(manifest_path)
}

fn cleanup_plugin_temp_dir(source: &PluginInstallSource) {
    for path in &source.cleanup_roots {
        let _ = std::fs::remove_dir_all(path);
    }
}

fn install_plugin_package_dependencies(plugin_dir: &Path) -> Result<(), String> {
    if !plugin_dir.join("package.json").exists() {
        return Ok(());
    }
    let output = Command::new("npm")
        .args(["install", "--omit=dev", "--ignore-scripts"])
        .current_dir(plugin_dir)
        .env("COREPACK_ENABLE_DOWNLOAD_PROMPT", "0")
        .env("NPM_CONFIG_IGNORE_SCRIPTS", "true")
        .output()
        .map_err(|error| format!("failed to run npm install: {error}"))?;
    if output.status.success() {
        return Ok(());
    }
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    Err(format!(
        "npm install failed: {}",
        if stderr.is_empty() { stdout } else { stderr }
    ))
}

fn resolve_archive_kind(path: &Path) -> Option<&'static str> {
    let name = path.file_name()?.to_str()?.to_ascii_lowercase();
    if name.ends_with(".tar.gz") || name.ends_with(".tgz") {
        return Some("tgz");
    }
    if name.ends_with(".tar") {
        return Some("tar");
    }
    if name.ends_with(".zip") {
        return Some("zip");
    }
    None
}

fn create_plugin_temp_dir(prefix: &str) -> Result<PathBuf, String> {
    let root = env::temp_dir().join(format!("{prefix}-{}", now_millis()));
    std::fs::create_dir_all(&root).map_err(|error| {
        format!(
            "failed to create temp directory {}: {error}",
            root.display()
        )
    })?;
    Ok(root)
}

fn extract_plugin_archive(archive_path: &Path) -> Result<PathBuf, String> {
    let kind = resolve_archive_kind(archive_path)
        .ok_or_else(|| format!("unsupported archive: {}", archive_path.display()))?;
    let extract_root = create_plugin_temp_dir("crawclaw-plugin-archive")?;
    let mut command = if kind == "zip" {
        let mut command = Command::new("unzip");
        command
            .arg("-q")
            .arg(archive_path)
            .arg("-d")
            .arg(&extract_root);
        command
    } else {
        let mut command = Command::new("tar");
        if kind == "tgz" {
            command.arg("-xzf");
        } else {
            command.arg("-xf");
        }
        command.arg(archive_path).arg("-C").arg(&extract_root);
        command
    };
    let output = command
        .output()
        .map_err(|error| format!("failed to extract archive: {error}"))?;
    if output.status.success() {
        return Ok(extract_root);
    }
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let _ = std::fs::remove_dir_all(&extract_root);
    Err(format!(
        "failed to extract archive: {}",
        if stderr.is_empty() { stdout } else { stderr }
    ))
}

fn has_plugin_root_marker(path: &Path) -> bool {
    path.join("package.json").exists()
        || path.join("crawclaw.plugin.json").exists()
        || path.join(".codex-plugin/plugin.json").exists()
        || path.join(".claude-plugin/plugin.json").exists()
        || path.join(".cursor-plugin/plugin.json").exists()
}

fn resolve_extracted_plugin_root(extract_root: &Path) -> Result<PathBuf, String> {
    if has_plugin_root_marker(extract_root) {
        return Ok(extract_root.to_path_buf());
    }
    let mut candidates = Vec::new();
    for entry in std::fs::read_dir(extract_root)
        .map_err(|error| format!("failed to read extracted archive root: {error}"))?
    {
        let entry = entry.map_err(|error| format!("failed to inspect extracted entry: {error}"))?;
        if entry
            .file_type()
            .map_err(|error| format!("failed to inspect extracted file type: {error}"))?
            .is_dir()
            && has_plugin_root_marker(&entry.path())
        {
            candidates.push(entry.path());
        }
    }
    match candidates.len() {
        1 => Ok(candidates.remove(0)),
        0 => Err("archive did not contain a plugin package root".to_string()),
        _ => Err("archive contained multiple plugin package roots".to_string()),
    }
}

fn run_command_capture(program: &str, args: &[&str], cwd: Option<&Path>) -> Result<String, String> {
    let mut command = Command::new(program);
    command.args(args);
    if let Some(cwd) = cwd {
        command.current_dir(cwd);
    }
    let output = command
        .env("COREPACK_ENABLE_DOWNLOAD_PROMPT", "0")
        .env("NPM_CONFIG_IGNORE_SCRIPTS", "true")
        .output()
        .map_err(|error| format!("failed to run {program}: {error}"))?;
    if output.status.success() {
        return Ok(String::from_utf8_lossy(&output.stdout).to_string());
    }
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    Err(format!(
        "{program} failed: {}",
        if stderr.is_empty() { stdout } else { stderr }
    ))
}

fn parse_npm_pack_json_output(raw: &str) -> Option<(String, Value)> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return None;
    }
    let candidates = if let Some(start) = trimmed.find('[') {
        vec![trimmed, &trimmed[start..]]
    } else {
        vec![trimmed]
    };
    for candidate in candidates {
        let parsed = serde_json::from_str::<Value>(candidate).ok()?;
        let entries = if let Some(array) = parsed.as_array() {
            array.clone()
        } else {
            vec![parsed]
        };
        for entry in entries.into_iter().rev() {
            let Some(filename) = entry.get("filename").and_then(Value::as_str) else {
                continue;
            };
            let name = entry.get("name").and_then(Value::as_str);
            let version = entry.get("version").and_then(Value::as_str);
            let resolved_spec = name
                .zip(version)
                .map(|(name, version)| format!("{name}@{version}"));
            let metadata = json!({
                "name": name,
                "version": version,
                "resolvedSpec": resolved_spec,
                "integrity": entry.get("integrity").and_then(Value::as_str),
                "shasum": entry.get("shasum").and_then(Value::as_str)
            });
            return Some((filename.to_string(), metadata));
        }
    }
    None
}

fn pack_npm_spec_to_archive(spec: &str) -> Result<PackedNpmArchive, String> {
    let tmp_root = create_plugin_temp_dir("crawclaw-npm-pack")?;
    let stdout = match run_command_capture(
        "npm",
        &["pack", spec, "--ignore-scripts", "--json"],
        Some(&tmp_root),
    ) {
        Ok(stdout) => stdout,
        Err(error) => {
            let _ = std::fs::remove_dir_all(&tmp_root);
            if error.contains("E404") || error.contains("not in this registry") {
                return Err(format!("Package not found on npm: {spec}."));
            }
            return Err(error);
        }
    };
    let (filename, metadata) = parse_npm_pack_json_output(&stdout)
        .ok_or_else(|| "npm pack produced no archive".to_string())?;
    let archive_path = if Path::new(&filename).is_absolute() {
        PathBuf::from(&filename)
    } else {
        tmp_root.join(&filename)
    };
    if !archive_path.exists() {
        let _ = std::fs::remove_dir_all(&tmp_root);
        return Err("npm pack produced no archive".to_string());
    }
    Ok(PackedNpmArchive {
        archive_path,
        metadata,
        temp_root: tmp_root,
    })
}

fn parse_clawhub_spec(raw: &str) -> Result<ParsedClawHubSpec, String> {
    let spec = raw
        .trim()
        .strip_prefix("clawhub:")
        .ok_or_else(|| format!("invalid ClawHub plugin spec: {raw}"))?
        .trim();
    if spec.is_empty() {
        return Err(format!("invalid ClawHub plugin spec: {raw}"));
    }
    if let Some(index) = spec
        .rfind('@')
        .filter(|index| *index > 0 && *index < spec.len() - 1)
    {
        return Ok(ParsedClawHubSpec {
            name: spec[..index].trim().to_string(),
            version: Some(spec[index + 1..].trim().to_string()),
        });
    }
    Ok(ParsedClawHubSpec {
        name: spec.to_string(),
        version: None,
    })
}

fn percent_encode_path_segment(raw: &str) -> String {
    raw.bytes()
        .flat_map(|byte| {
            let keep = byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.' | b'~');
            if keep {
                vec![byte as char]
            } else {
                format!("%{byte:02X}").chars().collect::<Vec<_>>()
            }
        })
        .collect()
}

fn download_url_to_file(url: &str, target: &Path) -> Result<(), String> {
    let output = Command::new("curl")
        .args(["-fsSL", url, "-o"])
        .arg(target)
        .output()
        .map_err(|error| format!("failed to run curl: {error}"))?;
    if output.status.success() {
        return Ok(());
    }
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    Err(format!("failed to download {url}: {stderr}"))
}

fn file_sha256_integrity(path: &Path) -> Result<String, String> {
    let bytes = std::fs::read(path)
        .map_err(|error| format!("failed to read {}: {error}", path.display()))?;
    Ok(format!(
        "sha256-{}",
        STANDARD.encode(Sha256::digest(&bytes))
    ))
}

fn load_marketplace(source: &str) -> Result<LoadedMarketplace, String> {
    let path = expand_user_path(source);
    if path.exists() {
        return load_marketplace_from_path(&path, None);
    }
    let tmp_root = create_plugin_temp_dir("crawclaw-marketplace")?;
    let repo_dir = tmp_root.join("repo");
    let repo = if source.starts_with("http://")
        || source.starts_with("https://")
        || source.starts_with("git@")
        || source.starts_with("ssh://")
    {
        source.to_string()
    } else if source.split('/').count() == 2 {
        format!("https://github.com/{source}.git")
    } else {
        let _ = std::fs::remove_dir_all(&tmp_root);
        return Err(format!("unsupported marketplace source: {source}"));
    };
    if let Err(error) = run_command_capture(
        "git",
        &[
            "clone",
            "--depth",
            "1",
            &repo,
            repo_dir.to_string_lossy().as_ref(),
        ],
        None,
    ) {
        let _ = std::fs::remove_dir_all(&tmp_root);
        return Err(error);
    }
    load_marketplace_from_path(&repo_dir, Some(tmp_root))
}

fn load_marketplace_from_path(
    path: &Path,
    cleanup_root: Option<PathBuf>,
) -> Result<LoadedMarketplace, String> {
    let root = if path.is_file() {
        path.parent()
            .map(Path::to_path_buf)
            .ok_or_else(|| format!("marketplace manifest {} has no parent", path.display()))?
    } else if path.file_name().and_then(|name| name.to_str()) == Some(".claude-plugin") {
        path.parent()
            .map(Path::to_path_buf)
            .ok_or_else(|| format!("marketplace path {} has no parent", path.display()))?
    } else {
        path.to_path_buf()
    };
    let manifest_path = if path.is_file() {
        path.to_path_buf()
    } else {
        [
            root.join(".claude-plugin/marketplace.json"),
            root.join("marketplace.json"),
        ]
        .into_iter()
        .find(|candidate| candidate.exists())
        .ok_or_else(|| format!("marketplace manifest not found under {}", root.display()))?
    };
    Ok(LoadedMarketplace {
        manifest: read_json_file(&manifest_path)?,
        root_dir: root,
        cleanup_root,
    })
}

fn resolve_marketplace_plugin_source(
    raw: &Value,
    marketplace_root: &Path,
) -> Result<MarketplacePluginSource, String> {
    if let Some(source) = raw.as_str() {
        return resolve_marketplace_source_string(source, marketplace_root);
    }
    let Some(object) = raw.as_object() else {
        return Err("marketplace plugin source must be a string or object".to_string());
    };
    let kind = object
        .get("type")
        .or_else(|| object.get("source"))
        .and_then(Value::as_str)
        .unwrap_or("path");
    match kind {
        "path" => resolve_marketplace_source_string(
            object
                .get("path")
                .and_then(Value::as_str)
                .ok_or_else(|| "path source missing path".to_string())?,
            marketplace_root,
        ),
        "url" => resolve_marketplace_source_string(
            object
                .get("url")
                .and_then(Value::as_str)
                .ok_or_else(|| "url source missing url".to_string())?,
            marketplace_root,
        ),
        other => Err(format!(
            "unsupported marketplace plugin source kind: {other}"
        )),
    }
}

fn resolve_marketplace_source_string(
    source: &str,
    marketplace_root: &Path,
) -> Result<MarketplacePluginSource, String> {
    if source.starts_with("http://") || source.starts_with("https://") {
        if resolve_archive_kind(Path::new(source)).is_none() {
            return Err(format!("unsupported remote plugin path source: {source}"));
        }
        let tmp_root = create_plugin_temp_dir("crawclaw-marketplace-download")?;
        let target = tmp_root.join(
            Path::new(source)
                .file_name()
                .and_then(|name| name.to_str())
                .map(safe_filename)
                .unwrap_or_else(|| "plugin.tgz".to_string()),
        );
        download_url_to_file(source, &target)?;
        return Ok(MarketplacePluginSource {
            source_path: target,
            cleanup_root: Some(tmp_root),
        });
    }
    let resolved = if Path::new(source).is_absolute() {
        PathBuf::from(source)
    } else {
        marketplace_root.join(source)
    };
    let canonical_source = resolved.canonicalize().map_err(|error| {
        format!(
            "failed to resolve marketplace source {}: {error}",
            resolved.display()
        )
    })?;
    if !Path::new(source).is_absolute() {
        let canonical_root = marketplace_root
            .canonicalize()
            .map_err(|error| format!("failed to resolve marketplace root: {error}"))?;
        if !canonical_source.starts_with(canonical_root) {
            return Err(format!("plugin source escapes marketplace root: {source}"));
        }
    }
    Ok(MarketplacePluginSource {
        source_path: canonical_source,
        cleanup_root: None,
    })
}

fn plugin_update_source_params(
    state: &GatewayState,
    id: &str,
    record: &Value,
    params: &Value,
) -> Result<Value, String> {
    let source = record
        .get("source")
        .and_then(Value::as_str)
        .unwrap_or_default();
    match source {
        "path" | "bundled" | "archive" => {
            let Some(source_path_raw) = record.get("sourcePath").and_then(Value::as_str) else {
                return Err(format!("Skipping \"{id}\" (missing sourcePath)."));
            };
            Ok(json!({
                "raw": normalize_plugin_filesystem_path(state, source_path_raw).to_string_lossy(),
                "pluginId": id
            }))
        }
        "npm" => {
            let spec = params
                .get("specOverrides")
                .and_then(|value| value.get(id))
                .and_then(Value::as_str)
                .or_else(|| record.get("spec").and_then(Value::as_str))
                .ok_or_else(|| format!("Skipping \"{id}\" (missing npm spec)."))?;
            Ok(json!({ "npmSpec": spec, "pluginId": id }))
        }
        "clawhub" => {
            let spec = record
                .get("spec")
                .and_then(Value::as_str)
                .or_else(|| record.get("clawhubPackage").and_then(Value::as_str))
                .map(|value| {
                    if value.starts_with("clawhub:") {
                        value.to_string()
                    } else {
                        format!("clawhub:{value}")
                    }
                })
                .ok_or_else(|| format!("Skipping \"{id}\" (missing ClawHub package metadata)."))?;
            Ok(json!({ "clawhubSpec": spec, "pluginId": id }))
        }
        "marketplace" => {
            let marketplace = record
                .get("marketplaceSource")
                .and_then(Value::as_str)
                .ok_or_else(|| {
                    format!("Skipping \"{id}\" (missing marketplace source metadata).")
                })?;
            let plugin = record
                .get("marketplacePlugin")
                .and_then(Value::as_str)
                .ok_or_else(|| {
                    format!("Skipping \"{id}\" (missing marketplace plugin metadata).")
                })?;
            Ok(json!({
                "marketplaceSource": marketplace,
                "marketplacePlugin": plugin,
                "pluginId": id
            }))
        }
        _ => Err(format!("Skipping \"{id}\" (source: {source}).")),
    }
}

fn same_filesystem_path(left: &std::path::Path, right: &std::path::Path) -> bool {
    if left == right {
        return true;
    }
    match (left.canonicalize(), right.canonicalize()) {
        (Ok(left), Ok(right)) => left == right,
        _ => false,
    }
}

fn copy_plugin_directory(source: &std::path::Path, target: &std::path::Path) -> Result<(), String> {
    if !source.is_dir() {
        return Err(format!(
            "plugin source is not a directory: {}",
            source.display()
        ));
    }
    if target.exists() {
        std::fs::remove_dir_all(target).map_err(|error| {
            format!(
                "failed to replace plugin directory {}: {error}",
                target.display()
            )
        })?;
    }
    std::fs::create_dir_all(target).map_err(|error| {
        format!(
            "failed to create plugin directory {}: {error}",
            target.display()
        )
    })?;
    copy_plugin_directory_contents(source, target)
}

fn copy_plugin_directory_contents(
    source: &std::path::Path,
    target: &std::path::Path,
) -> Result<(), String> {
    for entry in std::fs::read_dir(source)
        .map_err(|error| format!("failed to read plugin source {}: {error}", source.display()))?
    {
        let entry =
            entry.map_err(|error| format!("failed to read plugin source entry: {error}"))?;
        let name = entry.file_name();
        let name_str = name.to_string_lossy();
        if name_str == ".git" || name_str == "node_modules" {
            continue;
        }
        let file_type = entry
            .file_type()
            .map_err(|error| format!("failed to inspect plugin source entry: {error}"))?;
        let target_path = target.join(&name);
        if file_type.is_dir() {
            std::fs::create_dir_all(&target_path).map_err(|error| {
                format!(
                    "failed to create plugin directory {}: {error}",
                    target_path.display()
                )
            })?;
            copy_plugin_directory_contents(&entry.path(), &target_path)?;
        } else if file_type.is_file() {
            std::fs::copy(entry.path(), &target_path).map_err(|error| {
                format!(
                    "failed to copy plugin file {}: {error}",
                    target_path.display()
                )
            })?;
        }
    }
    Ok(())
}

fn channels_status(state: &GatewayState) -> Result<Value, String> {
    let config = read_config_value(&config_path(state))?;
    let runtime_state = read_channel_runtime_state(state)?;
    let mut channel_ids = configured_channel_ids(&config);
    channel_ids.extend(channel_runtime_channel_ids(&runtime_state));
    channel_ids.sort();
    channel_ids.dedup();
    let mut labels = Map::new();
    let mut detail_labels = Map::new();
    let mut channels = Map::new();
    let mut accounts = Map::new();
    let mut defaults = Map::new();
    let mut controls = Map::new();

    for channel_id in &channel_ids {
        let label = channel_label(channel_id);
        labels.insert(channel_id.clone(), Value::String(label.clone()));
        detail_labels.insert(
            channel_id.clone(),
            Value::String(format!("{label} channel")),
        );
        let channel_config = get_json_path(&config, &format!("channels.{channel_id}"))
            .cloned()
            .unwrap_or_else(|| Value::Object(Map::new()));
        let enabled = channel_config
            .get("enabled")
            .and_then(Value::as_bool)
            .unwrap_or(false);
        let configured = channel_config
            .as_object()
            .is_some_and(|object| !object.is_empty());
        let default_account_id = channel_runtime_default_account(&runtime_state, channel_id)
            .unwrap_or_else(|| "default".to_string());
        defaults.insert(
            channel_id.clone(),
            Value::String(default_account_id.clone()),
        );
        let account_runtime =
            channel_runtime_account(&runtime_state, channel_id, &default_account_id);
        let linked = account_runtime
            .and_then(|account| account.get("linked"))
            .and_then(Value::as_bool)
            .unwrap_or(configured);
        let running = account_runtime
            .and_then(|account| account.get("running"))
            .and_then(Value::as_bool)
            .unwrap_or(false);
        let connected = account_runtime
            .and_then(|account| account.get("connected"))
            .and_then(Value::as_bool)
            .unwrap_or(false);
        let health_state = account_runtime
            .and_then(|account| account.get("healthState"))
            .and_then(Value::as_str)
            .unwrap_or(if configured {
                "stopped"
            } else {
                "unconfigured"
            });
        channels.insert(
            channel_id.clone(),
            json!({
                "enabled": enabled,
                "configured": configured,
                "running": running,
                "connected": connected,
                "healthState": health_state,
                "implementation": "rust-native"
            }),
        );
        accounts.insert(
            channel_id.clone(),
            json!([{
                "accountId": default_account_id,
                "enabled": enabled,
                "configured": configured,
                "linked": linked,
                "running": running,
                "connected": connected,
                "healthState": health_state
            }]),
        );
        controls.insert(
            channel_id.clone(),
            json!({
                "loginMode": if is_local_delivery_channel(channel_id) { "native" } else if configured { "transport" } else { "none" },
                "actions": if is_local_delivery_channel(channel_id) || linked { json!(["verify", "reconnect", "logout"]) } else { json!([]) },
                "canReconnect": is_local_delivery_channel(channel_id) || linked,
                "canVerify": is_local_delivery_channel(channel_id) || linked,
                "canLogout": linked,
                "canEdit": true,
                "canSetup": true,
                "multiAccount": false
            }),
        );
    }

    Ok(json!({
        "ts": now_millis(),
        "channelOrder": channel_ids,
        "channelLabels": labels,
        "channelDetailLabels": detail_labels,
        "channels": channels,
        "channelControls": controls,
        "channelAccounts": accounts,
        "channelDefaultAccountId": defaults
    }))
}

fn configured_channel_ids(config: &Value) -> Vec<String> {
    let mut ids = get_json_path(config, "channels")
        .and_then(Value::as_object)
        .map(|channels| channels.keys().cloned().collect::<Vec<_>>())
        .unwrap_or_default();
    ids.sort();
    ids
}

struct ChannelRuntimeUpdate<'a> {
    enabled: bool,
    configured: bool,
    linked: bool,
    running: bool,
    connected: bool,
    health_state: &'a str,
    last_action: &'a str,
}

fn channel_runtime_state_path(state: &GatewayState) -> PathBuf {
    state
        .runtime_root
        .join("channels")
        .join("runtime-state.json")
}

fn read_channel_runtime_state(state: &GatewayState) -> Result<Value, String> {
    read_config_value(&channel_runtime_state_path(state))
}

fn channel_runtime_channel_ids(runtime_state: &Value) -> Vec<String> {
    runtime_state
        .get("channels")
        .and_then(Value::as_object)
        .map(|channels| channels.keys().cloned().collect::<Vec<_>>())
        .unwrap_or_default()
}

fn channel_runtime_default_account(runtime_state: &Value, channel: &str) -> Option<String> {
    runtime_state
        .get("channels")?
        .get(channel)?
        .get("defaultAccountId")?
        .as_str()
        .map(ToOwned::to_owned)
}

fn channel_runtime_account<'a>(
    runtime_state: &'a Value,
    channel: &str,
    account_id: &str,
) -> Option<&'a Value> {
    runtime_state
        .get("channels")?
        .get(channel)?
        .get("accounts")?
        .get(account_id)
}

fn channel_is_configured(config: &Value, channel: &str) -> bool {
    get_json_path(config, &format!("channels.{channel}"))
        .and_then(Value::as_object)
        .is_some_and(|object| !object.is_empty())
}

fn channel_is_enabled(config: &Value, channel: &str) -> bool {
    get_json_path(config, &format!("channels.{channel}"))
        .and_then(|channel| channel.get("enabled"))
        .and_then(Value::as_bool)
        .unwrap_or(false)
}

fn is_local_delivery_channel(channel: &str) -> bool {
    channel == "desktop"
}

fn upsert_channel_runtime_account(
    state: &GatewayState,
    channel: &str,
    account_id: &str,
    update: ChannelRuntimeUpdate<'_>,
) -> Result<Value, String> {
    let mut runtime_state = read_channel_runtime_state(state)?;
    let updated_at_ms = now_millis();
    let entry = json!({
        "channel": channel,
        "accountId": account_id,
        "enabled": update.enabled,
        "configured": update.configured,
        "linked": update.linked,
        "running": update.running,
        "connected": update.connected,
        "healthState": update.health_state,
        "lastAction": update.last_action,
        "transport": if is_local_delivery_channel(channel) { "local" } else { "external" },
        "updatedAtMs": updated_at_ms,
        "implementation": "rust-native"
    });

    let root = ensure_json_object(&mut runtime_state);
    let channels_value = root
        .entry("channels".to_string())
        .or_insert_with(|| Value::Object(Map::new()));
    let channels = ensure_json_object(channels_value);
    let channel_value = channels
        .entry(channel.to_string())
        .or_insert_with(|| Value::Object(Map::new()));
    let channel_object = ensure_json_object(channel_value);
    channel_object.insert("channel".to_string(), Value::String(channel.to_string()));
    channel_object.insert(
        "defaultAccountId".to_string(),
        Value::String(account_id.to_string()),
    );
    channel_object.insert("running".to_string(), Value::Bool(update.running));
    channel_object.insert("connected".to_string(), Value::Bool(update.connected));
    channel_object.insert(
        "healthState".to_string(),
        Value::String(update.health_state.to_string()),
    );
    channel_object.insert("updatedAtMs".to_string(), json!(updated_at_ms));
    let accounts_value = channel_object
        .entry("accounts".to_string())
        .or_insert_with(|| Value::Object(Map::new()));
    ensure_json_object(accounts_value).insert(account_id.to_string(), entry.clone());

    write_json_file(&channel_runtime_state_path(state), &runtime_state)?;
    Ok(entry)
}

fn channel_label(channel_id: &str) -> String {
    channel_id
        .split(['-', '_'])
        .filter(|part| !part.is_empty())
        .map(|part| {
            let mut chars = part.chars();
            match chars.next() {
                Some(first) => format!("{}{}", first.to_uppercase(), chars.as_str()),
                None => String::new(),
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

fn channels_setup_surface(state: &GatewayState, params: Value) -> Result<Value, String> {
    let channel = required_param(&params, &["channel"])?;
    let config = read_config_value(&config_path(state))?;
    let configured = get_json_path(&config, &format!("channels.{channel}"))
        .and_then(Value::as_object)
        .is_some_and(|object| !object.is_empty());
    let label = channel_label(&channel);
    Ok(json!({
        "channel": channel,
        "label": label,
        "detailLabel": format!("{label} channel"),
        "configured": configured,
        "mode": "config",
        "statusLines": [],
        "accountIds": ["default"],
        "defaultAccountId": "default",
        "canSetup": true,
        "canEdit": true,
        "multiAccount": false,
        "loginMode": "none",
        "commands": []
    }))
}

fn channels_config_get(state: &GatewayState, params: Value) -> Result<Value, String> {
    let config = read_config_value(&config_path(state))?;
    if let Some(channel) = string_param(&params, &["channel"]) {
        return Ok(json!({
            "channel": channel,
            "config": get_json_path(&config, &format!("channels.{channel}")).cloned().unwrap_or(Value::Null)
        }));
    }
    Ok(json!({
        "config": get_json_path(&config, "channels").cloned().unwrap_or_else(|| Value::Object(Map::new()))
    }))
}

fn channels_config_schema() -> Value {
    json!({
        "schema": {
            "type": "object",
            "additionalProperties": true
        },
        "uiHints": {},
        "version": "rust-channels-config-v1"
    })
}

fn channels_config_patch(state: &GatewayState, params: Value) -> Result<Value, String> {
    let channel = required_param(&params, &["channel"])?;
    let patch = config_patch_value(&params)?;
    let path = config_path(state);
    let mut config = read_config_value(&path)?;
    let target_path = format!("channels.{channel}");
    let mut current = get_json_path(&config, &target_path)
        .cloned()
        .unwrap_or_else(|| Value::Object(Map::new()));
    merge_json(&mut current, patch);
    set_json_path(&mut config, &target_path, current.clone())?;
    write_config_value(&path, &config)?;
    Ok(json!({
        "ok": true,
        "channel": channel,
        "config": current
    }))
}

fn channels_config_apply(state: &GatewayState, params: Value) -> Result<Value, String> {
    let channel = required_param(&params, &["channel"])?;
    let next = config_patch_value(&params)?;
    if !next.is_object() {
        return Err("channels.config.apply requires an object config".to_string());
    }
    let path = config_path(state);
    let mut config = read_config_value(&path)?;
    set_json_path(&mut config, &format!("channels.{channel}"), next.clone())?;
    write_config_value(&path, &config)?;
    Ok(json!({
        "ok": true,
        "channel": channel,
        "config": next
    }))
}

fn config_patch_value(params: &Value) -> Result<Value, String> {
    if let Some(raw) = string_param(params, &["raw"]) {
        serde_json::from_str::<Value>(&raw).map_err(|error| format!("invalid raw JSON: {error}"))
    } else {
        Ok(params
            .get("patch")
            .or_else(|| params.get("config"))
            .cloned()
            .unwrap_or_else(|| Value::Object(Map::new())))
    }
}

fn channel_action(state: &GatewayState, method: &str, params: Value) -> Result<Value, String> {
    let channel = safe_config_component_id(
        &string_param(&params, &["channel"]).unwrap_or_else(|| "web".to_string()),
        "channel",
    )?;
    let account_id = safe_runtime_component_id(
        &string_param(&params, &["accountId"]).unwrap_or_else(|| "default".to_string()),
        "account id",
    )?;
    let config = read_config_value(&config_path(state))?;
    let configured = channel_is_configured(&config, &channel);
    let enabled = channel_is_enabled(&config, &channel);
    let can_run_native = is_local_delivery_channel(&channel);

    let entry = if method.ends_with(".logout") || method == "channels.logout" {
        upsert_channel_runtime_account(
            state,
            &channel,
            &account_id,
            ChannelRuntimeUpdate {
                enabled,
                configured,
                linked: false,
                running: false,
                connected: false,
                health_state: "logged_out",
                last_action: method,
            },
        )?
    } else if method.ends_with(".verify") {
        let runtime_state = read_channel_runtime_state(state)?;
        let current = channel_runtime_account(&runtime_state, &channel, &account_id);
        let connected = current
            .and_then(|account| account.get("connected"))
            .and_then(Value::as_bool)
            .unwrap_or(false);
        let linked = current
            .and_then(|account| account.get("linked"))
            .and_then(Value::as_bool)
            .unwrap_or(false);
        upsert_channel_runtime_account(
            state,
            &channel,
            &account_id,
            ChannelRuntimeUpdate {
                enabled,
                configured,
                linked,
                running: connected,
                connected,
                health_state: if connected {
                    "connected"
                } else {
                    "needs_login"
                },
                last_action: method,
            },
        )?
    } else if can_run_native {
        upsert_channel_runtime_account(
            state,
            &channel,
            &account_id,
            ChannelRuntimeUpdate {
                enabled,
                configured,
                linked: true,
                running: true,
                connected: true,
                health_state: "connected",
                last_action: method,
            },
        )?
    } else {
        upsert_channel_runtime_account(
            state,
            &channel,
            &account_id,
            ChannelRuntimeUpdate {
                enabled,
                configured,
                linked: false,
                running: false,
                connected: false,
                health_state: if configured {
                    "needs_channel_transport"
                } else {
                    "unconfigured"
                },
                last_action: method,
            },
        )?
    };
    let connected = entry
        .get("connected")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let linked = entry
        .get("linked")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    emit(state, "channel.lifecycle", entry.clone());
    Ok(json!({
        "ok": connected || linked || method.ends_with(".logout") || method == "channels.logout",
        "method": method,
        "channel": channel,
        "accountId": account_id,
        "linked": linked,
        "running": entry.get("running").cloned().unwrap_or(Value::Bool(false)),
        "connected": connected,
        "healthState": entry.get("healthState").cloned().unwrap_or_else(|| Value::String("unknown".to_string())),
        "snapshot": channels_status(state)?
    }))
}

fn channel_send(state: &GatewayState, params: Value) -> Result<Value, String> {
    let channel = safe_config_component_id(
        &string_param(&params, &["channel"]).unwrap_or_else(|| "desktop".to_string()),
        "channel",
    )?;
    let account_id = string_param(&params, &["accountId"]).unwrap_or_else(|| "default".to_string());
    let to = required_param(&params, &["to", "target", "recipient"])?;
    let text = required_param(&params, &["text", "message", "body"])?;
    let runtime_state = read_channel_runtime_state(state)?;
    let account_runtime = channel_runtime_account(&runtime_state, &channel, &account_id);
    let connected = account_runtime
        .and_then(|account| account.get("connected"))
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let local_delivery = is_local_delivery_channel(&channel);
    let now = now_millis();
    let message_id = format!("rust-send-{now}");
    let (sent, delivery_status, error_code, delivered_at_ms) = if local_delivery && connected {
        (true, "delivered", Value::Null, json!(now))
    } else if local_delivery {
        (
            false,
            "blocked",
            Value::String("needs_channel_login".to_string()),
            Value::Null,
        )
    } else {
        (
            false,
            "blocked",
            Value::String("needs_channel_transport".to_string()),
            Value::Null,
        )
    };
    let entry = json!({
        "ok": sent,
        "messageId": message_id,
        "channel": channel,
        "accountId": account_id,
        "to": to,
        "text": text,
        "sent": sent,
        "deliveryStatus": delivery_status,
        "status": delivery_status,
        "errorCode": error_code,
        "queuedAtMs": if sent { Value::Null } else { json!(now) },
        "deliveredAtMs": delivered_at_ms,
        "implementation": "rust-native"
    });
    let delivery_file = if sent {
        state.runtime_root.join("channels").join("deliveries.jsonl")
    } else {
        state.runtime_root.join("channels").join("outbox.jsonl")
    };
    append_jsonl(&delivery_file, &entry)?;
    emit(state, "channel.send", entry.clone());
    Ok(entry)
}

const QWEN3_TTS_PROVIDER_ID: &str = "qwen3-tts";
const QWEN3_TTS_PROVIDER_LABEL: &str = "Qwen3-TTS (local)";
const QWEN3_TTS_MODELS: &[&str] = &[
    "Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice",
    "Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice",
    "Qwen/Qwen3-TTS-12Hz-0.6B-Base",
    "Qwen/Qwen3-TTS-12Hz-1.7B-Base",
    "Qwen/Qwen3-TTS-12Hz-1.7B-VoiceDesign",
];
const QWEN3_TTS_VOICES: &[&str] = &[
    "serena", "vivian", "uncle_fu", "ryan", "aiden", "ono_anna", "sohee", "eric", "dylan",
];

fn tts_status(state: &GatewayState) -> Value {
    let config = read_config_value(&config_path(state)).unwrap_or(Value::Object(Map::new()));
    let auto = tts_auto_mode(&config);
    let enabled = auto != "off";
    let provider = active_tts_provider(&config);
    let provider_states = tts_provider_catalog(&config)
        .into_iter()
        .map(|provider| {
            json!({
                "id": provider["id"].clone(),
                "label": provider["name"].clone(),
                "configured": provider["configured"].clone()
            })
        })
        .collect::<Vec<_>>();
    json!({
        "enabled": enabled,
        "auto": auto,
        "provider": provider,
        "fallbackProvider": Value::Null,
        "fallbackProviders": [],
        "providerStates": provider_states,
        "implementation": "rust-native"
    })
}

fn tts_providers(state: &GatewayState) -> Value {
    let config = read_config_value(&config_path(state)).unwrap_or(Value::Object(Map::new()));
    json!({
        "providers": tts_provider_catalog(&config),
        "active": active_tts_provider(&config),
        "implementation": "rust-native"
    })
}

fn tts_set_enabled(state: &GatewayState, enabled: bool) -> Result<Value, String> {
    let path = config_path(state);
    let mut config = read_config_value(&path)?;
    set_json_path(&mut config, "messages.tts.enabled", Value::Bool(enabled))?;
    write_config_value(&path, &config)?;
    Ok(json!({ "ok": true, "enabled": enabled, "config": config }))
}

fn tts_set_provider(state: &GatewayState, params: Value) -> Result<Value, String> {
    let requested = required_param(&params, &["provider", "id"])?;
    let provider = canonical_native_tts_provider(&requested)
        .ok_or_else(|| "Invalid provider. Use a registered TTS provider id.".to_string())?
        .to_string();
    let path = config_path(state);
    let mut config = read_config_value(&path)?;
    set_json_path(
        &mut config,
        "messages.tts.provider",
        Value::String(provider.clone()),
    )?;
    write_config_value(&path, &config)?;
    Ok(json!({ "ok": true, "provider": provider, "config": config }))
}

fn canonical_native_tts_provider(provider: &str) -> Option<&'static str> {
    match provider.trim().to_lowercase().as_str() {
        "qwen3-tts" | "qwen3tts" => Some(QWEN3_TTS_PROVIDER_ID),
        _ => None,
    }
}

fn tts_auto_mode(config: &Value) -> &'static str {
    let Some(tts) = get_json_path(config, "messages.tts").and_then(Value::as_object) else {
        return "off";
    };
    match tts.get("auto").and_then(Value::as_str) {
        Some("off") => "off",
        Some("always") => "always",
        Some("inbound") => "inbound",
        Some("tagged") => "tagged",
        _ if tts.get("enabled").and_then(Value::as_bool).unwrap_or(false) => "always",
        _ => "off",
    }
}

fn active_tts_provider(config: &Value) -> String {
    if let Some(provider) = get_json_path(config, "messages.tts.provider")
        .and_then(Value::as_str)
        .and_then(canonical_native_tts_provider)
    {
        return provider.to_string();
    }
    tts_provider_catalog(config)
        .into_iter()
        .find(|provider| provider["configured"].as_bool().unwrap_or(false))
        .and_then(|provider| provider["id"].as_str().map(ToOwned::to_owned))
        .unwrap_or_default()
}

fn tts_provider_catalog(config: &Value) -> Vec<Value> {
    vec![json!({
        "id": QWEN3_TTS_PROVIDER_ID,
        "name": QWEN3_TTS_PROVIDER_LABEL,
        "configured": qwen3_tts_configured(config),
        "models": QWEN3_TTS_MODELS,
        "voices": QWEN3_TTS_VOICES,
        "runtime": qwen3_tts_runtime(config),
        "baseUrl": qwen3_tts_base_url(config),
        "supported": qwen3_tts_supported(config)
    })]
}

fn qwen3_tts_config(config: &Value) -> Option<&Map<String, Value>> {
    get_json_path(config, "messages.tts.providers.qwen3-tts").and_then(Value::as_object)
}

fn qwen3_tts_enabled(config: &Value) -> bool {
    qwen3_tts_config(config)
        .and_then(|config| config.get("enabled"))
        .and_then(Value::as_bool)
        .unwrap_or(false)
}

fn qwen3_tts_configured(config: &Value) -> bool {
    qwen3_tts_enabled(config) && qwen3_tts_supported(config)
}

fn qwen3_tts_runtime(config: &Value) -> &'static str {
    qwen3_tts_runtime_defaults(qwen3_tts_raw_runtime(config)).0
}

fn qwen3_tts_base_url(config: &Value) -> String {
    qwen3_tts_config(config)
        .and_then(|config| config.get("baseUrl"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| value.trim_end_matches('/').to_string())
        .unwrap_or_else(|| {
            qwen3_tts_runtime_defaults(qwen3_tts_raw_runtime(config))
                .1
                .to_string()
        })
}

fn qwen3_tts_supported(config: &Value) -> bool {
    let experimental = qwen3_tts_config(config)
        .and_then(|config| config.get("experimental"))
        .and_then(Value::as_bool)
        .unwrap_or(false);
    qwen3_tts_runtime_defaults(qwen3_tts_raw_runtime(config)).2 || experimental
}

fn qwen3_tts_raw_runtime(config: &Value) -> &str {
    qwen3_tts_config(config)
        .and_then(|config| config.get("runtime"))
        .and_then(Value::as_str)
        .unwrap_or("auto")
}

fn qwen3_tts_runtime_defaults(raw_runtime: &str) -> (&'static str, &'static str, bool) {
    match raw_runtime {
        "mlx-audio" => (
            "mlx-audio",
            "http://127.0.0.1:8011",
            cfg!(target_os = "macos") && cfg!(target_arch = "aarch64"),
        ),
        "vllm-omni" => (
            "vllm-omni",
            "http://127.0.0.1:8010",
            cfg!(target_os = "linux"),
        ),
        "qwen3-tts.cpp" => ("qwen3-tts.cpp", "http://127.0.0.1:8012", false),
        "qwen-tts" => (
            "qwen-tts",
            "http://127.0.0.1:8013",
            qwen3_tts_platform_supported(),
        ),
        "cpu" => (
            "cpu",
            "http://127.0.0.1:8013",
            qwen3_tts_platform_supported(),
        ),
        _ if cfg!(target_os = "macos") && cfg!(target_arch = "aarch64") => {
            ("mlx-audio", "http://127.0.0.1:8011", true)
        }
        _ if cfg!(target_os = "linux") || cfg!(target_os = "windows") => {
            ("qwen-tts", "http://127.0.0.1:8013", true)
        }
        _ => (
            "qwen-tts",
            "http://127.0.0.1:8013",
            qwen3_tts_platform_supported(),
        ),
    }
}

fn qwen3_tts_platform_supported() -> bool {
    cfg!(target_os = "macos") || cfg!(target_os = "linux") || cfg!(target_os = "windows")
}

fn tts_convert(state: &GatewayState, params: Value) -> Result<Value, String> {
    let text = required_param(&params, &["text", "message"])?;
    let config = read_config_value(&config_path(state)).unwrap_or(Value::Object(Map::new()));
    let provider = string_param(&params, &["provider"])
        .or_else(|| {
            get_json_path(&config, "messages.tts.provider")
                .and_then(Value::as_str)
                .map(ToOwned::to_owned)
        })
        .unwrap_or_else(|| "qwen3-tts".to_string());
    let voice = string_param(&params, &["voice", "voiceId"]).or_else(|| {
        get_json_path(
            &config,
            &format!("messages.tts.providers.{provider}.voiceId"),
        )
        .and_then(Value::as_str)
        .map(ToOwned::to_owned)
    });
    let result = json!({
        "ok": true,
        "status": "prepared",
        "provider": provider,
        "voice": voice,
        "text": text,
        "audio": Value::Null,
        "artifact": Value::Null,
        "implementation": "rust-native",
        "message": "Rust Gateway prepared the TTS request locally; provider synthesis is handled by native plugin tools when configured."
    });
    append_jsonl(
        &state.runtime_root.join("tts").join("requests.jsonl"),
        &result,
    )?;
    Ok(result)
}

fn talk_config(state: &GatewayState) -> Result<Value, String> {
    let config = read_config_value(&config_path(state))?;
    Ok(json!({
        "config": {
            "talk": get_json_path(&config, "talk").cloned(),
            "session": {
                "mainKey": "agent:main:main"
            },
            "ui": get_json_path(&config, "ui").cloned()
        }
    }))
}

fn talk_mode(state: &GatewayState, params: Value) -> Result<Value, String> {
    let enabled = params
        .get("enabled")
        .and_then(Value::as_bool)
        .ok_or_else(|| "talk.mode requires enabled".to_string())?;
    let path = config_path(state);
    let mut config = read_config_value(&path)?;
    set_json_path(&mut config, "talk.enabled", Value::Bool(enabled))?;
    write_config_value(&path, &config)?;
    emit(state, "talk.mode", json!({ "enabled": enabled }));
    Ok(json!({ "ok": true, "enabled": enabled }))
}

fn talk_speak(state: &GatewayState, params: Value) -> Result<Value, String> {
    let speech = tts_convert(state, params.clone())?;
    let payload = json!({
        "ok": true,
        "status": speech.get("status").cloned().unwrap_or_else(|| Value::String("prepared".to_string())),
        "speech": speech,
        "implementation": "rust-native"
    });
    emit(state, "talk.speak", payload.clone());
    Ok(payload)
}

fn voice_qwen3_tts(state: &GatewayState, method: &str, params: Value) -> Result<Value, String> {
    let operation = method.rsplit('.').next().unwrap_or("preview").to_string();
    let text = string_param(&params, &["text", "message"]).unwrap_or_default();
    let reference = string_param(&params, &["path", "referenceAudioPath", "referenceAudio"]);
    let result = json!({
        "ok": true,
        "status": "prepared",
        "provider": "qwen3-tts",
        "operation": operation,
        "text": text,
        "referenceAudio": reference,
        "implementation": "rust-native"
    });
    append_jsonl(
        &state.runtime_root.join("tts").join("qwen3-tts.jsonl"),
        &result,
    )?;
    Ok(result)
}

fn voice_overview(state: &GatewayState) -> Value {
    json!({
        "tts": tts_status(state),
        "voicewake": voicewake_get(state),
        "implementation": "rust-native"
    })
}

fn voicewake_get(state: &GatewayState) -> Value {
    let config = read_config_value(&config_path(state)).unwrap_or(Value::Object(Map::new()));
    json!({
        "config": get_json_path(&config, "voicewake").cloned().unwrap_or(Value::Null),
        "implementation": "rust-native"
    })
}

fn voicewake_set(state: &GatewayState, params: Value) -> Result<Value, String> {
    let patch = config_patch_value(&params)?;
    let path = config_path(state);
    let mut config = read_config_value(&path)?;
    let mut current = get_json_path(&config, "voicewake")
        .cloned()
        .unwrap_or_else(|| Value::Object(Map::new()));
    merge_json(&mut current, patch);
    set_json_path(&mut config, "voicewake", current.clone())?;
    write_config_value(&path, &config)?;
    emit(state, "voicewake.changed", json!({ "config": current }));
    Ok(json!({ "ok": true, "config": current }))
}

fn update_run(state: &GatewayState, _params: Value) -> Result<Value, String> {
    let started = Instant::now();
    let Some(root) = resolve_update_git_root(state) else {
        let result = json!({
            "status": "error",
            "mode": "unknown",
            "reason": "no-git-root",
            "steps": [],
            "durationMs": started.elapsed().as_millis()
        });
        return Ok(json!({
            "ok": false,
            "status": "error",
            "result": result,
            "restart": Value::Null,
            "implementation": "rust-native"
        }));
    };

    let before_sha =
        update_command_stdout(&root, &["git", "-C", path_str(&root), "rev-parse", "HEAD"])
            .unwrap_or_default()
            .trim()
            .to_string();
    let mut steps = Vec::new();

    let clean_check = run_update_step(
        "clean check",
        &["git", "-C", path_str(&root), "status", "--porcelain"],
        &root,
    );
    let dirty = clean_check
        .get("stdoutTail")
        .and_then(Value::as_str)
        .map(|value| !value.trim().is_empty())
        .unwrap_or(false);
    steps.push(clean_check);
    if dirty {
        let result = update_result(
            "skipped",
            "git",
            &root,
            Some("dirty"),
            &before_sha,
            None,
            steps,
            started.elapsed().as_millis(),
        );
        return Ok(update_run_response(result));
    }

    let upstream_check = run_update_step(
        "upstream check",
        &[
            "git",
            "-C",
            path_str(&root),
            "rev-parse",
            "--abbrev-ref",
            "--symbolic-full-name",
            "@{upstream}",
        ],
        &root,
    );
    let has_upstream = update_step_success(&upstream_check);
    steps.push(upstream_check);
    if !has_upstream {
        let result = update_result(
            "skipped",
            "git",
            &root,
            Some("no-upstream"),
            &before_sha,
            None,
            steps,
            started.elapsed().as_millis(),
        );
        return Ok(update_run_response(result));
    }

    let fetch = run_update_step(
        "git fetch",
        &[
            "git",
            "-C",
            path_str(&root),
            "fetch",
            "--all",
            "--prune",
            "--tags",
        ],
        &root,
    );
    let fetch_ok = update_step_success(&fetch);
    steps.push(fetch);
    if !fetch_ok {
        let result = update_result(
            "error",
            "git",
            &root,
            Some("fetch-failed"),
            &before_sha,
            None,
            steps,
            started.elapsed().as_millis(),
        );
        return Ok(update_run_response(result));
    }

    let upstream_sha_step = run_update_step(
        "git rev-parse @{upstream}",
        &["git", "-C", path_str(&root), "rev-parse", "@{upstream}"],
        &root,
    );
    let upstream_sha = upstream_sha_step
        .get("stdoutTail")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned);
    let upstream_ok = update_step_success(&upstream_sha_step);
    steps.push(upstream_sha_step);
    let Some(upstream_sha) = upstream_sha.filter(|_| upstream_ok) else {
        let result = update_result(
            "error",
            "git",
            &root,
            Some("no-upstream-sha"),
            &before_sha,
            None,
            steps,
            started.elapsed().as_millis(),
        );
        return Ok(update_run_response(result));
    };

    if upstream_sha == before_sha {
        let result = update_result(
            "skipped",
            "git",
            &root,
            Some("up-to-date"),
            &before_sha,
            Some(&before_sha),
            steps,
            started.elapsed().as_millis(),
        );
        return Ok(update_run_response(result));
    }

    let result = update_result(
        "skipped",
        "git",
        &root,
        Some("update-available"),
        &before_sha,
        Some(&upstream_sha),
        steps,
        started.elapsed().as_millis(),
    );
    Ok(update_run_response(result))
}

fn resolve_update_git_root(state: &GatewayState) -> Option<PathBuf> {
    let mut candidates = vec![state.runtime_root.clone()];
    if let Ok(cwd) = env::current_dir() {
        candidates.push(cwd);
    }
    for candidate in candidates {
        let Ok(output) = std::process::Command::new("git")
            .args(["-C", path_str(&candidate), "rev-parse", "--show-toplevel"])
            .output()
        else {
            continue;
        };
        if output.status.success() {
            let root = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if !root.is_empty() {
                return Some(PathBuf::from(root));
            }
        }
    }
    None
}

fn run_update_step(name: &str, argv: &[&str], cwd: &std::path::Path) -> Value {
    let started = Instant::now();
    let output = std::process::Command::new(argv[0])
        .args(&argv[1..])
        .current_dir(cwd)
        .output();
    let duration_ms = started.elapsed().as_millis();
    match output {
        Ok(output) => json!({
            "name": name,
            "command": argv.join(" "),
            "cwd": cwd.to_string_lossy(),
            "durationMs": duration_ms,
            "exitCode": output.status.code(),
            "stdoutTail": trim_update_log_tail(&String::from_utf8_lossy(&output.stdout)),
            "stderrTail": trim_update_log_tail(&String::from_utf8_lossy(&output.stderr))
        }),
        Err(error) => json!({
            "name": name,
            "command": argv.join(" "),
            "cwd": cwd.to_string_lossy(),
            "durationMs": duration_ms,
            "exitCode": Value::Null,
            "stdoutTail": Value::Null,
            "stderrTail": error.to_string()
        }),
    }
}

fn update_step_success(step: &Value) -> bool {
    step.get("exitCode")
        .and_then(Value::as_i64)
        .map(|code| code == 0)
        .unwrap_or(false)
}

fn update_command_stdout(cwd: &std::path::Path, argv: &[&str]) -> Option<String> {
    let output = std::process::Command::new(argv[0])
        .args(&argv[1..])
        .current_dir(cwd)
        .output()
        .ok()?;
    if output.status.success() {
        Some(String::from_utf8_lossy(&output.stdout).to_string())
    } else {
        None
    }
}

fn update_result(
    status: &str,
    mode: &str,
    root: &std::path::Path,
    reason: Option<&str>,
    before_sha: &str,
    after_sha: Option<&str>,
    steps: Vec<Value>,
    duration_ms: u128,
) -> Value {
    json!({
        "status": status,
        "mode": mode,
        "root": root.to_string_lossy(),
        "reason": reason,
        "before": {
            "sha": if before_sha.is_empty() { Value::Null } else { Value::String(before_sha.to_string()) }
        },
        "after": after_sha.map(|sha| json!({ "sha": sha })),
        "steps": steps,
        "durationMs": duration_ms
    })
}

fn update_run_response(result: Value) -> Value {
    let status = result
        .get("status")
        .and_then(Value::as_str)
        .unwrap_or("error")
        .to_string();
    json!({
        "ok": status != "error",
        "status": status,
        "result": result,
        "restart": Value::Null,
        "implementation": "rust-native"
    })
}

fn trim_update_log_tail(raw: &str) -> Value {
    const MAX_LOG_CHARS: usize = 8000;
    if raw.is_empty() {
        return Value::Null;
    }
    let chars = raw.chars().collect::<Vec<_>>();
    let start = chars.len().saturating_sub(MAX_LOG_CHARS);
    Value::String(chars[start..].iter().collect())
}

fn path_str(path: &std::path::Path) -> &str {
    path.to_str().unwrap_or("")
}

fn chat_history(state: &GatewayState, params: Value) -> Result<Value, String> {
    let session_key = normalize_session_key(&required_param(&params, &["sessionKey", "key"])?)?;
    let mut messages = state
        .session_store
        .session_history(&session_key)
        .map_err(|error| error.to_string())?;
    let limit = params
        .get("limit")
        .and_then(Value::as_u64)
        .unwrap_or(200)
        .min(1000) as usize;
    if messages.len() > limit {
        messages = messages.split_off(messages.len() - limit);
    }
    Ok(json!({
        "sessionKey": session_key,
        "sessionId": session_key,
        "messages": messages,
        "thinkingLevel": "medium",
        "fastMode": false
    }))
}

fn chat_inject(state: &GatewayState, params: Value) -> Result<Value, String> {
    let session_key = normalize_session_key(&required_param(&params, &["sessionKey", "key"])?)?;
    let message = required_param(&params, &["message"])?;
    state
        .session_store
        .append_message(&session_key, "assistant", &message, Some("chat_inject"))
        .map_err(|error| error.to_string())?;
    let run_id = format!("inject-{}", now_millis());
    let payload = json!({
        "runId": run_id.clone(),
        "sessionKey": session_key,
        "seq": 0,
        "state": "final",
        "message": {
            "role": "assistant",
            "content": message
        }
    });
    emit(state, "chat", payload.clone());
    Ok(json!({
        "ok": true,
        "messageId": run_id,
        "event": payload
    }))
}

fn chat_abort(params: Value) -> Result<Value, String> {
    let session_key = normalize_session_key(&required_param(&params, &["sessionKey", "key"])?)?;
    let run_ids = string_param(&params, &["runId"])
        .map(|run_id| vec![run_id])
        .unwrap_or_default();
    Ok(json!({
        "ok": true,
        "sessionKey": session_key,
        "aborted": false,
        "runIds": run_ids
    }))
}

async fn chat_send(state: &GatewayState, params: Value) -> Result<Value, String> {
    let session_key = normalize_session_key(&required_param(&params, &["sessionKey", "key"])?)?;
    let message = required_param(&params, &["message", "text"])?;
    let run_id = string_param(&params, &["idempotencyKey", "runId"])
        .unwrap_or_else(|| format!("rust-chat-{}", now_millis()));
    let result = match state
        .agent_runtime
        .send_message(session_key.clone(), message)
        .await
    {
        Ok(result) => result,
        Err(error) => {
            let payload = json!({
            "runId": run_id,
            "sessionKey": session_key,
            "seq": 0,
                    "state": "error",
                    "errorMessage": error.message()
                });
            emit(state, "chat", payload);
            return Err(error.message().to_string());
        }
    };
    let assistant_text = result.assistant_text;
    let thread_id = result.thread_id;
    let payload = json!({
        "runId": run_id.clone(),
        "sessionKey": thread_id.clone(),
        "seq": 0,
        "state": "final",
        "message": {
            "role": "assistant",
            "content": assistant_text
        },
        "stopReason": "end_turn"
    });
    emit(state, "chat", payload.clone());
    Ok(json!({
        "ok": true,
        "status": "completed",
        "runId": run_id,
        "sessionKey": thread_id,
        "message": payload.get("message").cloned().unwrap_or(Value::Null)
    }))
}

fn read_config_value(path: &PathBuf) -> Result<Value, String> {
    match std::fs::read_to_string(path) {
        Ok(raw) => serde_json::from_str(&raw)
            .map_err(|error| format!("invalid config {}: {error}", path.display())),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(Value::Object(Map::new())),
        Err(error) => Err(format!("failed to read config {}: {error}", path.display())),
    }
}

fn write_config_value(path: &PathBuf, value: &Value) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|error| format!("failed to create config directory: {error}"))?;
    }
    let tmp = path.with_extension("json.tmp");
    let raw = serde_json::to_string_pretty(value)
        .map_err(|error| format!("failed to serialize config: {error}"))?;
    std::fs::write(&tmp, format!("{raw}\n"))
        .map_err(|error| format!("failed to write temp config {}: {error}", tmp.display()))?;
    std::fs::rename(&tmp, path)
        .map_err(|error| format!("failed to replace config {}: {error}", path.display()))
}

fn read_json_file(path: &std::path::Path) -> Result<Value, String> {
    let raw = std::fs::read_to_string(path)
        .map_err(|error| format!("failed to read {}: {error}", path.display()))?;
    serde_json::from_str(&raw).map_err(|error| format!("invalid JSON {}: {error}", path.display()))
}

fn write_json_file(path: &std::path::Path, value: &Value) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|error| format!("failed to create directory {}: {error}", parent.display()))?;
    }
    let raw = serde_json::to_string_pretty(value)
        .map_err(|error| format!("failed to serialize JSON: {error}"))?;
    std::fs::write(path, format!("{raw}\n"))
        .map_err(|error| format!("failed to write {}: {error}", path.display()))
}

fn append_jsonl(path: &std::path::Path, value: &Value) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|error| format!("failed to create directory {}: {error}", parent.display()))?;
    }
    let mut file = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
        .map_err(|error| format!("failed to open {}: {error}", path.display()))?;
    let raw = serde_json::to_string(value)
        .map_err(|error| format!("failed to serialize JSONL entry: {error}"))?;
    writeln!(file, "{raw}").map_err(|error| format!("failed to append {}: {error}", path.display()))
}

fn safe_runtime_component_id(raw: &str, label: &str) -> Result<String, String> {
    let value = raw.trim();
    if value.is_empty()
        || value == "."
        || value == ".."
        || value.contains('/')
        || value.contains('\\')
        || value.contains("..")
    {
        return Err(format!("{label} must be a safe local identifier"));
    }
    Ok(value.to_string())
}

fn safe_config_component_id(raw: &str, label: &str) -> Result<String, String> {
    let value = safe_runtime_component_id(raw, label)?;
    if value.contains('.') {
        return Err(format!("{label} cannot contain dots"));
    }
    Ok(value)
}

fn merge_json(target: &mut Value, patch: Value) {
    match (target, patch) {
        (Value::Object(target), Value::Object(patch)) => {
            for (key, value) in patch {
                merge_json(target.entry(key).or_insert(Value::Null), value);
            }
        }
        (target, patch) => *target = patch,
    }
}

fn ensure_json_object(value: &mut Value) -> &mut Map<String, Value> {
    if !value.is_object() {
        *value = Value::Object(Map::new());
    }
    value.as_object_mut().expect("object initialized")
}

fn get_json_path<'a>(value: &'a Value, path: &str) -> Option<&'a Value> {
    let mut current = value;
    for segment in path.split('.').filter(|segment| !segment.is_empty()) {
        current = current.get(segment)?;
    }
    Some(current)
}

fn set_json_path(value: &mut Value, path: &str, next: Value) -> Result<(), String> {
    let segments = path
        .split('.')
        .filter(|segment| !segment.trim().is_empty())
        .collect::<Vec<_>>();
    if segments.is_empty() {
        return Err("config path cannot be empty".to_string());
    }
    let mut current = value;
    for segment in &segments[..segments.len() - 1] {
        if !current.is_object() {
            *current = Value::Object(Map::new());
        }
        current = current
            .as_object_mut()
            .expect("object initialized")
            .entry((*segment).to_string())
            .or_insert_with(|| Value::Object(Map::new()));
    }
    if !current.is_object() {
        *current = Value::Object(Map::new());
    }
    current
        .as_object_mut()
        .expect("object initialized")
        .insert(segments[segments.len() - 1].to_string(), next);
    Ok(())
}

fn delete_json_path(value: &mut Value, path: &str) -> bool {
    let segments = path
        .split('.')
        .filter(|segment| !segment.trim().is_empty())
        .collect::<Vec<_>>();
    if segments.is_empty() {
        return false;
    }
    let mut current = value;
    for segment in &segments[..segments.len() - 1] {
        let Some(next) = current.get_mut(*segment) else {
            return false;
        };
        current = next;
    }
    current
        .as_object_mut()
        .and_then(|object| object.remove(segments[segments.len() - 1]))
        .is_some()
}

fn remove_string_from_json_array(value: &mut Value, path: &str, needle: &str) -> bool {
    let Some(array) = get_json_path(value, path).and_then(Value::as_array) else {
        return false;
    };
    if !array
        .iter()
        .any(|entry| entry.as_str().map(|entry| entry == needle).unwrap_or(false))
    {
        return false;
    }
    let next = array
        .iter()
        .filter(|entry| entry.as_str().map(|entry| entry != needle).unwrap_or(true))
        .cloned()
        .collect::<Vec<_>>();
    if next.is_empty() {
        delete_json_path(value, path)
    } else {
        set_json_path(value, path, Value::Array(next)).is_ok()
    }
}

fn add_string_to_json_array(value: &mut Value, path: &str, entry: &str) -> Result<(), String> {
    let mut next = get_json_path(value, path)
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    if next
        .iter()
        .any(|value| value.as_str().map(|value| value == entry).unwrap_or(false))
    {
        return Ok(());
    }
    next.push(Value::String(entry.to_string()));
    set_json_path(value, path, Value::Array(next))
}

fn workflow_store_root(state: &GatewayState, params: &Value) -> PathBuf {
    if let Some(workspace_dir) = string_param(params, &["workspaceDir"]) {
        return PathBuf::from(workspace_dir)
            .join(".crawclaw")
            .join("workflows");
    }
    if let Some(agent_dir) = string_param(params, &["agentDir"]) {
        return PathBuf::from(agent_dir).join("workflows");
    }
    state.runtime_root.join("workflows")
}

fn workflow_agent_id(params: &Value) -> String {
    string_param(params, &["agentId"]).unwrap_or_else(|| "main".to_string())
}

fn workflow_registry_path(root: &std::path::Path) -> PathBuf {
    root.join("registry.json")
}

fn workflow_executions_path(root: &std::path::Path) -> PathBuf {
    root.join("executions.json")
}

fn workflow_spec_path(root: &std::path::Path, workflow_id: &str) -> PathBuf {
    root.join("specs").join(format!("{workflow_id}.json"))
}

fn read_workflow_registry(root: &std::path::Path) -> Result<Value, String> {
    let mut registry = read_config_value(&workflow_registry_path(root))?;
    if !registry.is_object() {
        registry = json!({});
    }
    if !registry
        .get("workflows")
        .map(Value::is_array)
        .unwrap_or(false)
    {
        registry["workflows"] = json!([]);
    }
    if registry.get("version").is_none() {
        registry["version"] = json!(1);
    }
    Ok(registry)
}

fn write_workflow_registry(root: &std::path::Path, registry: &Value) -> Result<(), String> {
    write_json_file(&workflow_registry_path(root), registry)
}

fn read_workflow_executions_store(root: &std::path::Path) -> Result<Value, String> {
    let mut store = read_config_value(&workflow_executions_path(root))?;
    if !store.is_object() {
        store = json!({});
    }
    if !store
        .get("executions")
        .map(Value::is_array)
        .unwrap_or(false)
    {
        store["executions"] = json!([]);
    }
    if store.get("version").is_none() {
        store["version"] = json!(1);
    }
    Ok(store)
}

fn write_workflow_executions_store(root: &std::path::Path, store: &Value) -> Result<(), String> {
    write_json_file(&workflow_executions_path(root), store)
}

fn workflow_entries(registry: &Value) -> Vec<Value> {
    registry
        .get("workflows")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default()
}

fn workflow_executions(store: &Value) -> Vec<Value> {
    store
        .get("executions")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default()
}

fn workflow_id(entry: &Value) -> String {
    entry
        .get("workflowId")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string()
}

fn workflow_name(entry: &Value) -> String {
    entry
        .get("name")
        .and_then(Value::as_str)
        .unwrap_or_else(|| {
            entry
                .get("workflowId")
                .and_then(Value::as_str)
                .unwrap_or_default()
        })
        .to_string()
}

fn workflow_matches_ref(entry: &Value, workflow_ref: &str) -> bool {
    let needle = workflow_ref.trim().to_lowercase();
    if needle.is_empty() {
        return false;
    }
    entry
        .get("workflowId")
        .and_then(Value::as_str)
        .map(|value| value.trim().eq_ignore_ascii_case(&needle))
        .unwrap_or(false)
        || entry
            .get("name")
            .and_then(Value::as_str)
            .map(|value| value.trim().eq_ignore_ascii_case(&needle))
            .unwrap_or(false)
}

fn find_workflow_entry(entries: &[Value], workflow_ref: &str) -> Option<Value> {
    entries
        .iter()
        .find(|entry| workflow_matches_ref(entry, workflow_ref))
        .cloned()
}

fn workflow_invocation(entry: &Value) -> Value {
    if entry.get("archivedAt").is_some() {
        return json!({
            "canRun": false,
            "autoRunnable": false,
            "recommendedAction": "skip",
            "reason": "Workflow is archived."
        });
    }
    if !entry
        .get("enabled")
        .and_then(Value::as_bool)
        .unwrap_or(false)
    {
        return json!({
            "canRun": false,
            "autoRunnable": false,
            "recommendedAction": "skip",
            "reason": "Workflow is disabled."
        });
    }
    if entry
        .get("deploymentState")
        .and_then(Value::as_str)
        .unwrap_or("draft")
        != "deployed"
    {
        return json!({
            "canRun": false,
            "autoRunnable": false,
            "recommendedAction": "skip",
            "reason": "Workflow is still draft and must be deployed first."
        });
    }
    if entry
        .get("requiresApproval")
        .and_then(Value::as_bool)
        .unwrap_or(false)
    {
        return json!({
            "canRun": true,
            "autoRunnable": false,
            "recommendedAction": "ask",
            "reason": "Workflow requires explicit operator approval before running."
        });
    }
    if entry
        .get("safeForAutoRun")
        .and_then(Value::as_bool)
        .unwrap_or(false)
    {
        return json!({
            "canRun": true,
            "autoRunnable": true,
            "recommendedAction": "run",
            "reason": "Workflow is deployed, enabled, and marked safe for auto-run."
        });
    }
    json!({
        "canRun": true,
        "autoRunnable": false,
        "recommendedAction": "ask",
        "reason": "Workflow is runnable, but not marked safe for autonomous execution."
    })
}

fn workflow_require_n8n_base_url(state: &GatewayState) -> Result<String, String> {
    let config = read_config_value(&config_path(state))?;
    let base_url = workflow_n8n_config_string(&config, "baseUrl")
        .or_else(|| env::var("CRAWCLAW_N8N_BASE_URL").ok())
        .map(|value| value.trim().trim_end_matches('/').to_string())
        .filter(|value| !value.is_empty());
    let api_key = workflow_n8n_config_string(&config, "apiKey")
        .or_else(|| env::var("CRAWCLAW_N8N_API_KEY").ok())
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    match (base_url, api_key) {
        (Some(base_url), Some(_)) => Ok(base_url),
        _ => Err(
            "n8n is not configured. Set workflow.n8n.baseUrl/apiKey or CRAWCLAW_N8N_BASE_URL and CRAWCLAW_N8N_API_KEY."
                .to_string(),
        ),
    }
}

fn workflow_n8n_config_string(config: &Value, key: &str) -> Option<String> {
    get_json_path(config, &format!("workflow.n8n.{key}"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
}

fn workflow_with_invocation(entry: Value) -> Value {
    let mut object = entry.as_object().cloned().unwrap_or_default();
    object.insert(
        "invocation".to_string(),
        workflow_invocation(&Value::Object(object.clone())),
    );
    Value::Object(object)
}

fn workflow_execution_updated_at(execution: &Value) -> u64 {
    execution
        .get("updatedAt")
        .or_else(|| execution.get("startedAt"))
        .and_then(Value::as_u64)
        .unwrap_or(0)
}

fn workflow_execution_view(execution: Value) -> Value {
    let mut object = execution.as_object().cloned().unwrap_or_default();
    if let Some(execution_id) = object.get("executionId").cloned() {
        object.insert("localExecutionId".to_string(), execution_id);
    }
    if object.get("updatedAt").is_none() {
        object.insert("updatedAt".to_string(), json!(now_millis() as u64));
    }
    let source = if object.get("n8nExecutionId").is_some() || object.get("remote").is_some() {
        "local+n8n"
    } else {
        "local"
    };
    object.insert("source".to_string(), Value::String(source.to_string()));
    Value::Object(object)
}

fn workflow_recent_execution_views(
    executions: &[Value],
    workflow_id: &str,
    limit: usize,
) -> Vec<Value> {
    let mut matches = executions
        .iter()
        .filter(|execution| {
            execution.get("workflowId").and_then(Value::as_str) == Some(workflow_id)
        })
        .cloned()
        .collect::<Vec<_>>();
    matches.sort_by(|left, right| {
        workflow_execution_updated_at(right).cmp(&workflow_execution_updated_at(left))
    });
    matches
        .into_iter()
        .take(limit)
        .map(workflow_execution_view)
        .collect()
}

fn workflow_list(state: &GatewayState, params: Value) -> Result<Value, String> {
    let root = workflow_store_root(state, &params);
    let registry = read_workflow_registry(&root)?;
    let executions = workflow_executions(&read_workflow_executions_store(&root)?);
    let include_disabled = params
        .get("includeDisabled")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let limit = params
        .get("limit")
        .and_then(Value::as_u64)
        .map(|value| value as usize);
    let mut workflows = workflow_entries(&registry)
        .into_iter()
        .filter(|workflow| {
            include_disabled
                || workflow
                    .get("enabled")
                    .and_then(Value::as_bool)
                    .unwrap_or(false)
        })
        .collect::<Vec<_>>();
    workflows.sort_by(|left, right| {
        right
            .get("updatedAt")
            .and_then(Value::as_u64)
            .unwrap_or(0)
            .cmp(&left.get("updatedAt").and_then(Value::as_u64).unwrap_or(0))
    });
    let count = workflows.len();
    let workflows = workflows
        .into_iter()
        .take(limit.unwrap_or(usize::MAX))
        .map(|workflow| {
            let workflow_id = workflow_id(&workflow);
            let run_count = executions
                .iter()
                .filter(|execution| {
                    execution.get("workflowId").and_then(Value::as_str)
                        == Some(workflow_id.as_str())
                })
                .count();
            let recent_execution = workflow_recent_execution_views(&executions, &workflow_id, 1)
                .into_iter()
                .next()
                .unwrap_or(Value::Null);
            let mut object = workflow_with_invocation(workflow)
                .as_object()
                .cloned()
                .unwrap_or_default();
            object.insert("runCount".to_string(), json!(run_count));
            object.insert("recentExecution".to_string(), recent_execution);
            Value::Object(object)
        })
        .collect::<Vec<_>>();
    Ok(json!({
        "agentId": workflow_agent_id(&params),
        "count": count,
        "workflows": workflows
    }))
}

fn workflow_get(state: &GatewayState, params: Value) -> Result<Value, String> {
    let workflow = required_param(&params, &["workflow", "workflowId"])?;
    let root = workflow_store_root(state, &params);
    let registry = read_workflow_registry(&root)?;
    let entries = workflow_entries(&registry);
    let Some(entry) = find_workflow_entry(&entries, &workflow) else {
        return Err(format!("Workflow \"{workflow}\" not found."));
    };
    let workflow_id = workflow_id(&entry);
    let spec_path = workflow_spec_path(&root, &workflow_id);
    let spec = if spec_path.exists() {
        read_config_value(&spec_path)?
    } else {
        Value::Null
    };
    let recent_limit = params
        .get("recentRunsLimit")
        .and_then(Value::as_u64)
        .unwrap_or(5) as usize;
    let executions = workflow_executions(&read_workflow_executions_store(&root)?);
    Ok(json!({
        "agentId": workflow_agent_id(&params),
        "workflow": workflow_with_invocation(entry),
        "spec": spec,
        "specPath": spec_path.to_string_lossy(),
        "storeRoot": root.to_string_lossy(),
        "recentExecutions": workflow_recent_execution_views(&executions, &workflow_id, recent_limit),
        "implementation": "rust-native"
    }))
}

fn workflow_match(state: &GatewayState, params: Value) -> Result<Value, String> {
    let query = required_param(&params, &["query"])?;
    let root = workflow_store_root(state, &params);
    let registry = read_workflow_registry(&root)?;
    let enabled_only = params
        .get("enabledOnly")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let deployed_only = params
        .get("deployedOnly")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let auto_only = params
        .get("autoRunnableOnly")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let limit = params.get("limit").and_then(Value::as_u64).unwrap_or(5) as usize;
    let mut matches = workflow_entries(&registry)
        .into_iter()
        .filter_map(|entry| {
            let score = workflow_match_score(&entry, &query);
            if score == 0 {
                return None;
            }
            let invocation = workflow_invocation(&entry);
            if enabled_only
                && !entry
                    .get("enabled")
                    .and_then(Value::as_bool)
                    .unwrap_or(false)
            {
                return None;
            }
            if deployed_only
                && entry
                    .get("deploymentState")
                    .and_then(Value::as_str)
                    .unwrap_or("draft")
                    != "deployed"
            {
                return None;
            }
            if auto_only
                && !invocation
                    .get("autoRunnable")
                    .and_then(Value::as_bool)
                    .unwrap_or(false)
            {
                return None;
            }
            let mut object = workflow_with_invocation(entry)
                .as_object()
                .cloned()
                .unwrap_or_default();
            object.insert("matchScore".to_string(), json!(score));
            Some(Value::Object(object))
        })
        .collect::<Vec<_>>();
    matches.sort_by(|left, right| {
        right
            .get("matchScore")
            .and_then(Value::as_u64)
            .unwrap_or(0)
            .cmp(&left.get("matchScore").and_then(Value::as_u64).unwrap_or(0))
            .then_with(|| {
                right
                    .get("updatedAt")
                    .and_then(Value::as_u64)
                    .unwrap_or(0)
                    .cmp(&left.get("updatedAt").and_then(Value::as_u64).unwrap_or(0))
            })
    });
    let count = matches.len();
    Ok(json!({
        "agentId": workflow_agent_id(&params),
        "query": query,
        "count": count,
        "matches": matches.into_iter().take(limit).collect::<Vec<_>>()
    }))
}

fn workflow_match_score(entry: &Value, query: &str) -> u64 {
    let q = query.trim().to_lowercase();
    if q.is_empty() {
        return 0;
    }
    let name = workflow_name(entry).to_lowercase();
    let description = entry
        .get("description")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_lowercase();
    let tags = string_array_param(entry, "tags")
        .unwrap_or_default()
        .into_iter()
        .map(|tag| tag.to_lowercase())
        .collect::<Vec<_>>();
    let mut score = 0;
    if name == q {
        score += 100;
    }
    if name.contains(&q) {
        score += 50;
    }
    if description.contains(&q) {
        score += 20;
    }
    for tag in &tags {
        if tag == &q {
            score += 20;
        } else if tag.contains(&q) {
            score += 10;
        }
    }
    for term in q.split_whitespace() {
        if name.contains(term) {
            score += 8;
        }
        if description.contains(term) {
            score += 4;
        }
        if tags.iter().any(|tag| tag.contains(term)) {
            score += 2;
        }
    }
    score
}

fn workflow_runs(state: &GatewayState, params: Value) -> Result<Value, String> {
    let root = workflow_store_root(state, &params);
    let registry = read_workflow_registry(&root)?;
    let workflow_ref = string_param(&params, &["workflow"]);
    let workflow_id = workflow_ref.as_ref().map(|workflow_ref| {
        find_workflow_entry(&workflow_entries(&registry), workflow_ref)
            .map(|entry| workflow_id(&entry))
            .unwrap_or_else(|| workflow_ref.to_string())
    });
    let limit = params.get("limit").and_then(Value::as_u64).unwrap_or(50) as usize;
    let mut executions = workflow_executions(&read_workflow_executions_store(&root)?)
        .into_iter()
        .filter(|execution| {
            workflow_id
                .as_ref()
                .map(|workflow_id| {
                    execution.get("workflowId").and_then(Value::as_str)
                        == Some(workflow_id.as_str())
                })
                .unwrap_or(true)
        })
        .collect::<Vec<_>>();
    executions.sort_by(|left, right| {
        workflow_execution_updated_at(right).cmp(&workflow_execution_updated_at(left))
    });
    let count = executions.len();
    Ok(json!({
        "agentId": workflow_agent_id(&params),
        "count": count,
        "executions": executions
            .into_iter()
            .take(limit)
            .map(workflow_execution_view)
            .collect::<Vec<_>>()
    }))
}

fn workflow_mutation(state: &GatewayState, method: &str, params: Value) -> Result<Value, String> {
    let workflow = required_param(&params, &["workflow"])?;
    let root = workflow_store_root(state, &params);
    let mut registry = read_workflow_registry(&root)?;
    let Some(index) = registry
        .get("workflows")
        .and_then(Value::as_array)
        .ok_or_else(|| "invalid workflow registry".to_string())?
        .iter()
        .position(|entry| workflow_matches_ref(entry, &workflow))
    else {
        return Err(format!("Workflow \"{workflow}\" not found."));
    };

    let now = now_millis() as u64;
    if method == "workflow.delete" {
        let removed = registry
            .get_mut("workflows")
            .and_then(Value::as_array_mut)
            .ok_or_else(|| "invalid workflow registry".to_string())?
            .remove(index);
        let workflow_id = workflow_id(&removed);
        registry["updatedAt"] = json!(now);
        write_workflow_registry(&root, &registry)?;
        let mut execution_store = read_workflow_executions_store(&root)?;
        let mut removed_executions = 0;
        if let Some(executions) = execution_store
            .get_mut("executions")
            .and_then(Value::as_array_mut)
        {
            let before = executions.len();
            executions.retain(|execution| {
                execution.get("workflowId").and_then(Value::as_str) != Some(workflow_id.as_str())
            });
            removed_executions = before.saturating_sub(executions.len());
        }
        if removed_executions > 0 {
            execution_store["updatedAt"] = json!(now);
            write_workflow_executions_store(&root, &execution_store)?;
        }
        return Ok(json!({
            "agentId": workflow_agent_id(&params),
            "deleted": true,
            "workflowId": workflow_id,
            "removedExecutions": removed_executions
        }));
    }

    let workflow = {
        let workflows = registry
            .get_mut("workflows")
            .and_then(Value::as_array_mut)
            .ok_or_else(|| "invalid workflow registry".to_string())?;
        let entry = workflows
            .get_mut(index)
            .ok_or_else(|| "workflow entry disappeared".to_string())?;
        match method {
            "workflow.enable" => {
                entry["enabled"] = json!(true);
            }
            "workflow.disable" => {
                entry["enabled"] = json!(false);
            }
            "workflow.archive" => {
                entry["enabled"] = json!(false);
                entry["archivedAt"] = json!(now);
            }
            "workflow.unarchive" => {
                if let Some(object) = entry.as_object_mut() {
                    object.remove("archivedAt");
                }
            }
            "workflow.deploy" => {
                let _ = workflow_require_n8n_base_url(state)?;
                entry["deploymentState"] = json!("deployed");
                let next_version = entry
                    .get("deploymentVersion")
                    .and_then(Value::as_u64)
                    .unwrap_or(0)
                    + 1;
                entry["deploymentVersion"] = json!(next_version);
                let n8n_id = string_param(&params, &["n8nWorkflowId", "remoteWorkflowId"])
                    .or_else(|| {
                        entry
                            .get("n8nWorkflowId")
                            .and_then(Value::as_str)
                            .map(ToOwned::to_owned)
                    })
                    .unwrap_or_else(|| format!("rust-{}", workflow_id(entry)));
                entry["n8nWorkflowId"] = Value::String(n8n_id);
            }
            _ => {}
        }
        entry["updatedAt"] = json!(now);
        entry.clone()
    };
    registry["updatedAt"] = json!(now);
    write_workflow_registry(&root, &registry)?;
    Ok(json!({
        "agentId": workflow_agent_id(&params),
        "workflow": workflow_with_invocation(workflow)
    }))
}

fn workflow_run(state: &GatewayState, params: Value) -> Result<Value, String> {
    let workflow = required_param(&params, &["workflow"])?;
    let n8n_base_url = workflow_require_n8n_base_url(state)?;
    let root = workflow_store_root(state, &params);
    let mut registry = read_workflow_registry(&root)?;
    let Some(entry) = find_workflow_entry(&workflow_entries(&registry), &workflow) else {
        return Err(format!("Workflow \"{workflow}\" not found."));
    };
    workflow_ensure_runnable(&root, &entry, &workflow, &params)?;
    let workflow_id = workflow_id(&entry);
    let workflow_name = workflow_name(&entry);
    let n8n_workflow_id = entry
        .get("n8nWorkflowId")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    let now = now_millis() as u64;
    let execution_id = format!("rust-workflow-{now}");
    let execution = json!({
        "executionId": execution_id,
        "workflowId": workflow_id,
        "workflowName": workflow_name,
        "n8nWorkflowId": n8n_workflow_id,
        "n8nBaseUrl": n8n_base_url,
        "status": "running",
        "currentExecutor": "n8n",
        "startedAt": now,
        "updatedAt": now,
        "inputs": params.get("inputs").cloned().unwrap_or(Value::Null),
        "originSessionKey": string_param(&params, &["sessionKey", "originSessionKey"]),
        "originAgentId": workflow_agent_id(&params)
    });
    let mut execution_store = read_workflow_executions_store(&root)?;
    execution_store["updatedAt"] = json!(now);
    execution_store
        .get_mut("executions")
        .and_then(Value::as_array_mut)
        .ok_or_else(|| "invalid workflow execution store".to_string())?
        .push(execution.clone());
    write_workflow_executions_store(&root, &execution_store)?;

    if let Some(workflows) = registry.get_mut("workflows").and_then(Value::as_array_mut) {
        if let Some(workflow_entry) = workflows
            .iter_mut()
            .find(|entry| workflow_matches_ref(entry, &workflow_id))
        {
            workflow_entry["lastRunAt"] = json!(now);
            workflow_entry["updatedAt"] = json!(now);
            registry["updatedAt"] = json!(now);
            write_workflow_registry(&root, &registry)?;
        }
    }

    let execution_view = workflow_execution_view(execution.clone());
    let result = json!({
        "agentId": workflow_agent_id(&params),
        "workflow": workflow_with_invocation(entry),
        "execution": execution_view,
        "localExecution": execution
    });
    emit(state, "workflow.run", result.clone());
    Ok(result)
}

fn workflow_ensure_runnable(
    root: &std::path::Path,
    entry: &Value,
    workflow_ref: &str,
    params: &Value,
) -> Result<(), String> {
    if entry.get("archivedAt").is_some() {
        return Err(format!(
            "Workflow \"{workflow_ref}\" is archived and cannot run."
        ));
    }
    if !entry
        .get("enabled")
        .and_then(Value::as_bool)
        .unwrap_or(false)
    {
        return Err(format!(
            "Workflow \"{workflow_ref}\" is disabled and cannot run."
        ));
    }
    if entry
        .get("deploymentState")
        .and_then(Value::as_str)
        .unwrap_or("draft")
        != "deployed"
    {
        return Err(format!(
            "Workflow \"{workflow_ref}\" is not currently deployed. Run workflow.deploy or workflow.republish first."
        ));
    }
    if entry
        .get("n8nWorkflowId")
        .and_then(Value::as_str)
        .map(|value| !value.trim().is_empty())
        .unwrap_or(false)
        == false
    {
        return Err(format!(
            "Workflow \"{workflow_ref}\" is missing its n8n workflow id. Run workflow.republish before running it."
        ));
    }
    let workflow_id = workflow_id(entry);
    let spec_path = workflow_spec_path(root, &workflow_id);
    if !spec_path.exists() {
        return Err(format!(
            "Workflow \"{workflow_ref}\" is missing its workflow spec and cannot run."
        ));
    }
    let spec = read_json_file(&spec_path)?;
    if !spec.is_object()
        || spec
            .as_object()
            .map(|object| object.is_empty())
            .unwrap_or(true)
    {
        return Err(format!(
            "Workflow \"{workflow_ref}\" is missing its workflow spec and cannot run."
        ));
    }
    if entry
        .get("requiresApproval")
        .and_then(Value::as_bool)
        .unwrap_or(false)
        && params.get("approved").and_then(Value::as_bool) != Some(true)
    {
        return Err(format!(
            "Workflow \"{workflow_ref}\" requires explicit approval before running."
        ));
    }
    let invocation = workflow_invocation(entry);
    if !invocation
        .get("canRun")
        .and_then(Value::as_bool)
        .unwrap_or(false)
    {
        let reason = invocation
            .get("reason")
            .and_then(Value::as_str)
            .unwrap_or("not runnable");
        return Err(format!("Workflow \"{workflow_ref}\" cannot run: {reason}."));
    }
    Ok(())
}

fn workflow_agent_run(state: &GatewayState, params: Value) -> Result<Value, String> {
    let workflow = required_param(&params, &["workflow", "workflowId"])?;
    let execution_id = required_param(&params, &["executionId"])?;
    let step_id = required_param(&params, &["stepId"])?;
    let goal = required_param(&params, &["goal", "message", "task"])?;
    let root = workflow_store_root(state, &params);
    let registry = read_workflow_registry(&root)?;
    let entry = find_workflow_entry(&workflow_entries(&registry), &workflow)
        .ok_or_else(|| format!("workflow not found: {workflow}"))?;

    let mut store = read_workflow_executions_store(&root)?;
    let execution_index = store
        .get("executions")
        .and_then(Value::as_array)
        .and_then(|executions| {
            executions
                .iter()
                .position(|execution| workflow_execution_matches_ref(execution, &execution_id))
        })
        .ok_or_else(|| format!("workflow execution not found: {execution_id}"))?;

    let parent = string_param(&params, &["parentSessionKey", "sessionKey", "key"])
        .unwrap_or_else(|| "main".to_string());
    let label = format!("Workflow: {} / {step_id}", workflow_name(&entry));
    let session = state
        .session_store
        .spawn_session(Some(&parent), Some(&label), &goal)
        .map_err(|error| error.to_string())?;
    let session_key = session.key.clone();
    let now = now_millis() as u64;
    let execution = {
        let executions = store
            .get_mut("executions")
            .and_then(Value::as_array_mut)
            .ok_or_else(|| "invalid workflow execution store".to_string())?;
        let execution = executions
            .get_mut(execution_index)
            .ok_or_else(|| "workflow execution disappeared".to_string())?;
        workflow_update_agent_step(execution, &step_id, &goal, &session_key, now)?;
        workflow_execution_view(execution.clone())
    };
    store["updatedAt"] = json!(now);
    write_workflow_executions_store(&root, &store)?;

    let result = json!({
        "status": "running",
        "summary": format!("Workflow step \"{step_id}\" is running in Rust Gateway session {session_key}."),
        "sessionKey": session_key
    });
    let payload = json!({
        "ok": true,
        "status": "running",
        "result": result,
        "workflow": workflow_with_invocation(entry),
        "execution": execution,
        "session": session,
        "implementation": "rust-native"
    });
    emit(state, "workflow.agent.run", payload.clone());
    Ok(payload)
}

fn workflow_execution_matches_ref(execution: &Value, execution_ref: &str) -> bool {
    [
        execution.get("executionId"),
        execution.get("localExecutionId"),
        execution.get("n8nExecutionId"),
        execution.get("remoteExecutionId"),
        execution
            .get("remote")
            .and_then(|remote| remote.get("executionId")),
    ]
    .into_iter()
    .flatten()
    .any(|value| value.as_str() == Some(execution_ref))
}

fn workflow_update_agent_step(
    execution: &mut Value,
    step_id: &str,
    goal: &str,
    session_key: &str,
    now: u64,
) -> Result<(), String> {
    let execution_object = execution
        .as_object_mut()
        .ok_or_else(|| "invalid workflow execution record".to_string())?;
    execution_object.insert("status".to_string(), Value::String("running".to_string()));
    execution_object.insert(
        "currentStepId".to_string(),
        Value::String(step_id.to_string()),
    );
    execution_object.insert(
        "currentExecutor".to_string(),
        Value::String("crawclaw_agent".to_string()),
    );
    execution_object.insert("updatedAt".to_string(), json!(now));
    execution_object.remove("endedAt");
    execution_object.remove("finishedAt");
    if !execution_object
        .get("steps")
        .map(Value::is_array)
        .unwrap_or(false)
    {
        execution_object.insert("steps".to_string(), Value::Array(Vec::new()));
    }
    let steps = execution_object
        .get_mut("steps")
        .and_then(Value::as_array_mut)
        .ok_or_else(|| "invalid workflow execution steps".to_string())?;
    let step_index = steps
        .iter()
        .position(|step| step.get("stepId").and_then(Value::as_str) == Some(step_id));
    let step = if let Some(index) = step_index {
        steps
            .get_mut(index)
            .ok_or_else(|| "workflow step disappeared".to_string())?
    } else {
        steps.push(json!({ "stepId": step_id, "title": goal }));
        steps
            .last_mut()
            .ok_or_else(|| "workflow step was not created".to_string())?
    };
    let step_object = step
        .as_object_mut()
        .ok_or_else(|| "invalid workflow execution step".to_string())?;
    if step_object.get("title").is_none() {
        step_object.insert("title".to_string(), Value::String(goal.to_string()));
    }
    if step_object.get("startedAt").is_none() {
        step_object.insert("startedAt".to_string(), json!(now));
    }
    step_object.insert("status".to_string(), Value::String("running".to_string()));
    step_object.insert(
        "executor".to_string(),
        Value::String("crawclaw_agent".to_string()),
    );
    step_object.insert(
        "sessionKey".to_string(),
        Value::String(session_key.to_string()),
    );
    step_object.insert("runId".to_string(), Value::String(session_key.to_string()));
    step_object.insert("updatedAt".to_string(), json!(now));
    Ok(())
}

fn workflow_execution_action(
    state: &GatewayState,
    method: &str,
    params: Value,
) -> Result<Value, String> {
    let execution_id = required_param(&params, &["executionId"])?;
    let n8n_base_url = workflow_require_n8n_base_url(state)?;
    let root = workflow_store_root(state, &params);
    let mut store = read_workflow_executions_store(&root)?;
    let now = now_millis() as u64;
    let mut found = Value::Null;
    let mut changed = false;

    if let Some(executions) = store.get_mut("executions").and_then(Value::as_array_mut) {
        if let Some(execution) = executions.iter_mut().find(|execution| {
            execution.get("executionId").and_then(Value::as_str) == Some(execution_id.as_str())
                || execution.get("n8nExecutionId").and_then(Value::as_str)
                    == Some(execution_id.as_str())
        }) {
            match method {
                "workflow.cancel" => {
                    execution["status"] = json!("cancelled");
                    execution["endedAt"] = json!(now);
                    execution["updatedAt"] = json!(now);
                    changed = true;
                }
                "workflow.resume" => {
                    execution["status"] = json!("running");
                    execution["updatedAt"] = json!(now);
                    changed = true;
                }
                _ => {}
            }
            found = workflow_execution_view(execution.clone());
            if let Some(object) = found.as_object_mut() {
                object.insert(
                    "n8nBaseUrl".to_string(),
                    Value::String(n8n_base_url.clone()),
                );
            }
        }
    }

    if changed {
        store["updatedAt"] = json!(now);
        write_workflow_executions_store(&root, &store)?;
    }

    if !found.is_null() {
        let mut result = json!({
            "agentId": workflow_agent_id(&params),
            "execution": found
        });
        if method == "workflow.resume" {
            result["resumeAccepted"] = json!(true);
        }
        return Ok(result);
    }

    Ok(json!({
        "agentId": workflow_agent_id(&params),
        "execution": {
            "executionId": execution_id,
            "status": "not_found",
            "startedAt": Value::Null,
            "finishedAt": Value::Null
        }
    }))
}

const DEVICE_PENDING_TTL_MS: u64 = 5 * 60 * 1000;

fn device_pairing_pending_path(state: &GatewayState) -> PathBuf {
    state.state_dir.join("devices").join("pending.json")
}

fn device_pairing_paired_path(state: &GatewayState) -> PathBuf {
    state.state_dir.join("devices").join("paired.json")
}

fn read_json_object_file(path: PathBuf) -> Result<Map<String, Value>, String> {
    match read_config_value(&path)? {
        Value::Object(object) => Ok(object),
        _ => Err(format!("expected JSON object in {}", path.display())),
    }
}

fn read_device_pairing_state(
    state: &GatewayState,
) -> Result<(Map<String, Value>, Map<String, Value>), String> {
    let mut pending = read_json_object_file(device_pairing_pending_path(state))?;
    prune_expired_device_pairing(&mut pending);
    let paired = read_json_object_file(device_pairing_paired_path(state))?;
    Ok((pending, paired))
}

fn prune_expired_device_pairing(pending: &mut Map<String, Value>) {
    let now = now_millis() as u64;
    pending.retain(|_, request| {
        request
            .get("ts")
            .and_then(Value::as_u64)
            .map(|ts| now.saturating_sub(ts) <= DEVICE_PENDING_TTL_MS)
            .unwrap_or(true)
    });
}

fn device_pair_list(state: &GatewayState) -> Result<Value, String> {
    let (pending, paired) = read_device_pairing_state(state)?;
    let mut pending = pending.into_values().collect::<Vec<_>>();
    pending.sort_by(|left, right| {
        let left_ts = left.get("ts").and_then(Value::as_u64).unwrap_or(0);
        let right_ts = right.get("ts").and_then(Value::as_u64).unwrap_or(0);
        right_ts.cmp(&left_ts)
    });
    let mut paired = paired
        .into_values()
        .map(redact_paired_device)
        .collect::<Vec<_>>();
    paired.sort_by(|left, right| {
        let left_ts = left
            .get("approvedAtMs")
            .and_then(Value::as_u64)
            .unwrap_or(0);
        let right_ts = right
            .get("approvedAtMs")
            .and_then(Value::as_u64)
            .unwrap_or(0);
        right_ts.cmp(&left_ts)
    });
    Ok(json!({ "pending": pending, "paired": paired }))
}

fn device_pair_approve(state: &GatewayState, params: Value) -> Result<Value, String> {
    let request_id = required_param(&params, &["requestId", "id"])?;
    let (mut pending, mut paired) = read_device_pairing_state(state)?;
    let request = pending
        .remove(&request_id)
        .ok_or_else(|| "unknown requestId".to_string())?;
    validate_device_pair_approval_scope(&request, &params)?;
    let device = build_paired_device_from_request(&request);
    let device_id = device
        .get("deviceId")
        .and_then(Value::as_str)
        .ok_or_else(|| "device pairing request missing deviceId".to_string())?
        .to_string();
    paired.insert(device_id, device.clone());
    write_json_file(&device_pairing_pending_path(state), &Value::Object(pending))?;
    write_json_file(&device_pairing_paired_path(state), &Value::Object(paired))?;
    Ok(json!({
        "requestId": request_id,
        "device": redact_paired_device(device)
    }))
}

fn device_pair_reject(state: &GatewayState, params: Value) -> Result<Value, String> {
    let request_id = required_param(&params, &["requestId", "id"])?;
    let (mut pending, _) = read_device_pairing_state(state)?;
    let request = pending
        .remove(&request_id)
        .ok_or_else(|| "unknown requestId".to_string())?;
    write_json_file(&device_pairing_pending_path(state), &Value::Object(pending))?;
    Ok(json!({
        "requestId": request_id,
        "deviceId": request.get("deviceId").cloned().unwrap_or(Value::Null)
    }))
}

fn device_pair_remove(state: &GatewayState, params: Value) -> Result<Value, String> {
    let device_id = required_param(&params, &["deviceId", "id"])?;
    let (_, mut paired) = read_device_pairing_state(state)?;
    if paired.remove(&device_id).is_none() {
        return Err("unknown deviceId".to_string());
    }
    write_json_file(&device_pairing_paired_path(state), &Value::Object(paired))?;
    Ok(json!({ "deviceId": device_id }))
}

fn validate_device_pair_approval_scope(request: &Value, params: &Value) -> Result<(), String> {
    let requested_scopes = request
        .get("scopes")
        .and_then(Value::as_array)
        .map(|scopes| {
            scopes
                .iter()
                .filter_map(Value::as_str)
                .map(str::trim)
                .filter(|scope| scope.starts_with("operator."))
                .map(ToOwned::to_owned)
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    if requested_scopes.is_empty() {
        return Ok(());
    }
    let caller_scopes = string_array_param(params, "callerScopes").unwrap_or_default();
    for scope in requested_scopes {
        if !caller_scopes
            .iter()
            .any(|caller_scope| caller_scope == &scope)
        {
            return Err(format!("missing scope: {scope}"));
        }
    }
    Ok(())
}

fn build_paired_device_from_request(request: &Value) -> Value {
    let now = now_millis() as u64;
    let role = request.get("role").and_then(Value::as_str).map(str::trim);
    let scopes = request
        .get("scopes")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let roles = request
        .get("roles")
        .cloned()
        .or_else(|| role.map(|role| json!([role])))
        .unwrap_or_else(|| json!([]));
    let mut device = Map::new();
    for field in [
        "deviceId",
        "publicKey",
        "displayName",
        "platform",
        "deviceFamily",
        "clientId",
        "clientMode",
        "role",
        "remoteIp",
    ] {
        if let Some(value) = request.get(field) {
            device.insert(field.to_string(), value.clone());
        }
    }
    device.insert("roles".to_string(), roles);
    device.insert("scopes".to_string(), Value::Array(scopes.clone()));
    device.insert("approvedScopes".to_string(), Value::Array(scopes.clone()));
    device.insert("createdAtMs".to_string(), json!(now));
    device.insert("approvedAtMs".to_string(), json!(now));
    if let Some(role) = role.filter(|role| !role.is_empty()) {
        device.insert(
            "tokens".to_string(),
            json!({
                role: {
                    "token": format!("rust-device-token-{role}-{now}"),
                    "role": role,
                    "scopes": scopes,
                    "createdAtMs": now
                }
            }),
        );
    } else {
        device.insert("tokens".to_string(), json!({}));
    }
    Value::Object(device)
}

fn redact_paired_device(device: Value) -> Value {
    let mut object = device.as_object().cloned().unwrap_or_default();
    object.remove("approvedScopes");
    let summaries = object.remove("tokens").and_then(|tokens| {
        let mut summaries = tokens
            .as_object()?
            .values()
            .filter_map(device_token_summary)
            .collect::<Vec<_>>();
        summaries.sort_by(|left, right| {
            let left_role = left.get("role").and_then(Value::as_str).unwrap_or_default();
            let right_role = right
                .get("role")
                .and_then(Value::as_str)
                .unwrap_or_default();
            left_role.cmp(right_role)
        });
        if summaries.is_empty() {
            None
        } else {
            Some(Value::Array(summaries))
        }
    });
    if let Some(summaries) = summaries {
        object.insert("tokens".to_string(), summaries);
    }
    Value::Object(object)
}

fn device_token_summary(token: &Value) -> Option<Value> {
    let token = token.as_object()?;
    let mut summary = Map::new();
    for field in [
        "role",
        "scopes",
        "createdAtMs",
        "rotatedAtMs",
        "revokedAtMs",
        "lastUsedAtMs",
    ] {
        if let Some(value) = token.get(field) {
            summary.insert(field.to_string(), value.clone());
        }
    }
    Some(Value::Object(summary))
}

fn device_token_rotate(state: &GatewayState, params: Value) -> Result<Value, String> {
    let device_id =
        safe_config_component_id(&required_param(&params, &["deviceId", "id"])?, "device id")?;
    let Some(role) = string_param(&params, &["role"]) else {
        return device_token_rotate_legacy_config(state, device_id);
    };
    let role = role.trim().to_string();
    if role.is_empty() {
        return Err("role required".to_string());
    }
    let (_, mut paired) = read_device_pairing_state(state)?;
    let device = paired
        .get_mut(&device_id)
        .ok_or_else(|| "unknown deviceId/role".to_string())?;
    let now = now_millis() as u64;
    let requested_scopes = requested_device_token_scopes(device, &role, &params);
    if !scopes_within_device_baseline(device, &requested_scopes) {
        return Err("device token rotation denied".to_string());
    }
    let existing = device
        .get("tokens")
        .and_then(Value::as_object)
        .and_then(|tokens| tokens.get(&role))
        .cloned();
    let created_at_ms = existing
        .as_ref()
        .and_then(|token| token.get("createdAtMs"))
        .and_then(Value::as_u64)
        .unwrap_or(now);
    let last_used_at_ms = existing
        .as_ref()
        .and_then(|token| token.get("lastUsedAtMs"))
        .cloned();
    let token = format!("rust-device-token-{role}-{now}");
    let mut next = Map::new();
    next.insert("token".to_string(), Value::String(token.clone()));
    next.insert("role".to_string(), Value::String(role.clone()));
    next.insert("scopes".to_string(), json!(requested_scopes));
    next.insert("createdAtMs".to_string(), json!(created_at_ms));
    next.insert("rotatedAtMs".to_string(), json!(now));
    if let Some(last_used_at_ms) = last_used_at_ms {
        next.insert("lastUsedAtMs".to_string(), last_used_at_ms);
    }
    let tokens = device
        .as_object_mut()
        .ok_or_else(|| "paired device entry must be an object".to_string())?
        .entry("tokens".to_string())
        .or_insert_with(|| json!({}));
    if !tokens.is_object() {
        *tokens = json!({});
    }
    tokens
        .as_object_mut()
        .ok_or_else(|| "paired device tokens must be an object".to_string())?
        .insert(role.clone(), Value::Object(next));
    write_json_file(&device_pairing_paired_path(state), &Value::Object(paired))?;
    Ok(json!({
        "deviceId": device_id,
        "role": role,
        "token": token,
        "scopes": requested_scopes,
        "rotatedAtMs": now,
        "implementation": "rust-native"
    }))
}

fn device_token_rotate_legacy_config(
    state: &GatewayState,
    device_id: String,
) -> Result<Value, String> {
    let device_token = format!("rust-device-{device_id}-{}", now_millis());
    let path = config_path(state);
    let mut config = read_config_value(&path)?;
    set_json_path(
        &mut config,
        &format!("devices.tokens.{device_id}.token"),
        Value::String(device_token.clone()),
    )?;
    set_json_path(
        &mut config,
        &format!("devices.tokens.{device_id}.rotatedAtMs"),
        json!(now_millis()),
    )?;
    write_config_value(&path, &config)?;
    Ok(json!({
        "ok": true,
        "deviceId": device_id,
        "deviceToken": device_token,
        "rotatedAtMs": now_millis(),
        "implementation": "rust-native"
    }))
}

fn device_token_revoke(state: &GatewayState, params: Value) -> Result<Value, String> {
    let device_id =
        safe_config_component_id(&required_param(&params, &["deviceId", "id"])?, "device id")?;
    let role = required_param(&params, &["role"])?;
    let role = role.trim().to_string();
    if role.is_empty() {
        return Err("role required".to_string());
    }
    let (_, mut paired) = read_device_pairing_state(state)?;
    let device = paired
        .get_mut(&device_id)
        .ok_or_else(|| "unknown deviceId/role".to_string())?;
    let Some(token) = device
        .get_mut("tokens")
        .and_then(Value::as_object_mut)
        .and_then(|tokens| tokens.get_mut(&role))
    else {
        return Err("unknown deviceId/role".to_string());
    };
    let revoked_at_ms = now_millis() as u64;
    token
        .as_object_mut()
        .ok_or_else(|| "device token must be an object".to_string())?
        .insert("revokedAtMs".to_string(), json!(revoked_at_ms));
    write_json_file(&device_pairing_paired_path(state), &Value::Object(paired))?;
    Ok(json!({
        "deviceId": device_id,
        "role": role,
        "revokedAtMs": revoked_at_ms,
        "implementation": "rust-native"
    }))
}

fn requested_device_token_scopes(device: &Value, role: &str, params: &Value) -> Vec<String> {
    string_array_param(params, "scopes")
        .or_else(|| {
            device
                .get("tokens")
                .and_then(Value::as_object)
                .and_then(|tokens| tokens.get(role))
                .and_then(|token| string_array_param(token, "scopes"))
        })
        .or_else(|| string_array_param(device, "scopes"))
        .unwrap_or_default()
}

fn scopes_within_device_baseline(device: &Value, requested_scopes: &[String]) -> bool {
    let baseline = string_array_param(device, "approvedScopes")
        .or_else(|| string_array_param(device, "scopes"));
    let Some(baseline) = baseline else {
        return false;
    };
    requested_scopes
        .iter()
        .all(|scope| baseline.iter().any(|allowed| allowed == scope))
}

const ESP32_DEVICE_ROLE: &str = "esp32";
const ESP32_HARDWARE_TARGET: &str = "ESP32-S3-BOX-3";

fn esp32_config_from_crawclaw_config(config: &Value) -> Value {
    let raw = get_json_path(config, "plugins.entries.esp32.config")
        .cloned()
        .unwrap_or_else(|| json!({}));

    let mut broker = Map::new();
    broker.insert(
        "mode".to_string(),
        Value::String(esp32_config_string(&raw, "broker.mode", "managed")),
    );
    broker.insert(
        "bindHost".to_string(),
        Value::String(esp32_config_string(&raw, "broker.bindHost", "0.0.0.0")),
    );
    broker.insert(
        "port".to_string(),
        json!(esp32_config_u64(&raw, "broker.port", 1883)),
    );
    if let Some(value) = esp32_optional_config_string(&raw, "broker.advertisedHost") {
        broker.insert("advertisedHost".to_string(), Value::String(value));
    }

    let mut udp = Map::new();
    udp.insert(
        "bindHost".to_string(),
        Value::String(esp32_config_string(&raw, "udp.bindHost", "0.0.0.0")),
    );
    udp.insert(
        "port".to_string(),
        json!(esp32_config_u64(&raw, "udp.port", 1884)),
    );
    if let Some(value) = esp32_optional_config_string(&raw, "udp.advertisedHost") {
        udp.insert("advertisedHost".to_string(), Value::String(value));
    }

    let mut renderer = Map::new();
    if let Some(value) = esp32_optional_config_string(&raw, "renderer.model") {
        renderer.insert("model".to_string(), Value::String(value));
    }
    renderer.insert(
        "timeoutMs".to_string(),
        json!(esp32_config_u64(&raw, "renderer.timeoutMs", 8000)),
    );
    renderer.insert(
        "maxSpokenChars".to_string(),
        json!(esp32_config_u64(&raw, "renderer.maxSpokenChars", 40)),
    );
    renderer.insert(
        "maxDisplayChars".to_string(),
        json!(esp32_config_u64(&raw, "renderer.maxDisplayChars", 72)),
    );

    let tools_allowlist = get_json_path(&raw, "tools.allowlist")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(|value| Value::String(value.to_string()))
                .collect::<Vec<_>>()
        })
        .filter(|items| !items.is_empty())
        .unwrap_or_else(|| {
            [
                "display.*",
                "led.*",
                "audio.*",
                "volume.*",
                "mute.*",
                "sensor.*",
            ]
            .into_iter()
            .map(|value| Value::String(value.to_string()))
            .collect()
        });

    json!({
        "broker": Value::Object(broker),
        "udp": Value::Object(udp),
        "renderer": Value::Object(renderer),
        "tts": {
            "provider": esp32_config_string(&raw, "tts.provider", "qwen3-tts"),
            "target": esp32_config_string(&raw, "tts.target", "voice-note")
        },
        "tools": {
            "allowlist": tools_allowlist,
            "highRiskRequiresApproval": get_json_path(&raw, "tools.highRiskRequiresApproval")
                .and_then(Value::as_bool)
                .unwrap_or(true)
        }
    })
}

fn esp32_config_string(raw: &Value, path: &str, default: &str) -> String {
    esp32_optional_config_string(raw, path).unwrap_or_else(|| default.to_string())
}

fn esp32_optional_config_string(raw: &Value, path: &str) -> Option<String> {
    get_json_path(raw, path)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
}

fn esp32_config_u64(raw: &Value, path: &str, default: u64) -> u64 {
    get_json_path(raw, path)
        .and_then(Value::as_u64)
        .unwrap_or(default)
}

fn esp32_plugin_enabled(config: &Value) -> bool {
    get_json_path(config, "plugins.entries.esp32.enabled")
        .and_then(Value::as_bool)
        .unwrap_or(true)
}

fn esp32_pairing_sessions_path(state: &GatewayState) -> PathBuf {
    state.state_dir.join("esp32").join("pairing-sessions.json")
}

fn read_esp32_pairing_session_state(state: &GatewayState) -> Result<Map<String, Value>, String> {
    let mut sessions = read_json_object_file(esp32_pairing_sessions_path(state))?;
    let now = now_millis() as u64;
    sessions.retain(|_, session| {
        session
            .get("expiresAtMs")
            .and_then(Value::as_u64)
            .map(|expires| expires > now)
            .unwrap_or(true)
    });
    Ok(sessions)
}

fn esp32_pairing_sessions(state: &GatewayState) -> Result<Vec<Value>, String> {
    let sessions = read_esp32_pairing_session_state(state)?;
    write_json_file(
        &esp32_pairing_sessions_path(state),
        &Value::Object(sessions.clone()),
    )?;
    let mut sessions = sessions
        .into_values()
        .map(|session| {
            let mut object = session.as_object().cloned().unwrap_or_default();
            if let Some(pair_id) = object.get("pairId").and_then(Value::as_str) {
                object.insert(
                    "username".to_string(),
                    Value::String(format!("pair:{pair_id}")),
                );
            }
            object.remove("password");
            Value::Object(object)
        })
        .collect::<Vec<_>>();
    sessions.sort_by(|left, right| {
        let left_ts = left.get("issuedAtMs").and_then(Value::as_u64).unwrap_or(0);
        let right_ts = right.get("issuedAtMs").and_then(Value::as_u64).unwrap_or(0);
        right_ts.cmp(&left_ts)
    });
    Ok(sessions)
}

fn read_esp32_stored_devices(state: &GatewayState) -> Result<Map<String, Value>, String> {
    let store = read_config_value(&state.state_dir.join("esp32").join("devices.json"))?;
    Ok(store
        .get("devices")
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default())
}

fn esp32_pending_request(request: &Value) -> bool {
    string_array_param(request, "roles")
        .unwrap_or_default()
        .into_iter()
        .chain(
            request
                .get("role")
                .and_then(Value::as_str)
                .map(|role| role.to_string()),
        )
        .any(|role| role == ESP32_DEVICE_ROLE)
        || request.get("deviceFamily").and_then(Value::as_str) == Some(ESP32_HARDWARE_TARGET)
        || request.get("clientMode").and_then(Value::as_str) == Some("mqtt-udp")
}

fn esp32_paired_device(device: &Value) -> bool {
    esp32_effective_roles(device)
        .iter()
        .any(|role| role == ESP32_DEVICE_ROLE)
        || device.get("deviceFamily").and_then(Value::as_str) == Some(ESP32_HARDWARE_TARGET)
        || device.get("clientMode").and_then(Value::as_str) == Some("mqtt-udp")
}

fn esp32_effective_roles(device: &Value) -> Vec<String> {
    if let Some(tokens) = device.get("tokens").and_then(Value::as_object) {
        let active_roles = tokens
            .values()
            .filter(|token| token.get("revokedAtMs").is_none())
            .filter_map(|token| token.get("role").and_then(Value::as_str))
            .map(str::trim)
            .filter(|role| !role.is_empty())
            .map(ToOwned::to_owned)
            .collect::<Vec<_>>();
        if !active_roles.is_empty() {
            return active_roles;
        }
        if !tokens.is_empty() {
            return Vec::new();
        }
    }

    let mut roles = string_array_param(device, "roles").unwrap_or_default();
    if let Some(role) = device
        .get("role")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|role| !role.is_empty())
    {
        roles.push(role.to_string());
    }
    roles.sort();
    roles.dedup();
    roles
}

fn esp32_device_summary(device: Value, stored: Option<&Value>) -> Value {
    let device_id = device.get("deviceId").cloned().unwrap_or(Value::Null);
    let name = device
        .get("displayName")
        .cloned()
        .or_else(|| stored.and_then(|stored| stored.get("name").cloned()))
        .unwrap_or(Value::Null);
    let fingerprint = device
        .get("publicKey")
        .cloned()
        .or_else(|| stored.and_then(|stored| stored.get("fingerprint").cloned()))
        .unwrap_or(Value::Null);
    let capabilities = stored
        .and_then(|stored| stored.get("capabilities").cloned())
        .unwrap_or_else(|| json!({}));
    let last_seen_at_ms = stored
        .and_then(|stored| stored.get("lastSeenAtMs").cloned())
        .unwrap_or(Value::Null);
    json!({
        "deviceId": device_id,
        "name": name,
        "fingerprint": fingerprint,
        "hardwareTarget": device
            .get("deviceFamily")
            .cloned()
            .or_else(|| get_json_path(stored.unwrap_or(&Value::Null), "capabilities.hardwareTarget").cloned())
            .unwrap_or_else(|| Value::String(ESP32_HARDWARE_TARGET.to_string())),
        "clientMode": device
            .get("clientMode")
            .cloned()
            .unwrap_or_else(|| Value::String("mqtt-udp".to_string())),
        "online": false,
        "lastSeenAtMs": last_seen_at_ms,
        "approvedAtMs": device.get("approvedAtMs").cloned().unwrap_or(Value::Null),
        "capabilities": capabilities
    })
}

fn esp32_pending_summary(request: Value, stored: Option<&Value>) -> Value {
    json!({
        "requestId": request.get("requestId").cloned().unwrap_or(Value::Null),
        "deviceId": request.get("deviceId").cloned().unwrap_or(Value::Null),
        "name": request
            .get("displayName")
            .cloned()
            .or_else(|| stored.and_then(|stored| stored.get("name").cloned()))
            .unwrap_or(Value::Null),
        "fingerprint": request
            .get("publicKey")
            .cloned()
            .or_else(|| stored.and_then(|stored| stored.get("fingerprint").cloned()))
            .unwrap_or(Value::Null),
        "hardwareTarget": request
            .get("deviceFamily")
            .cloned()
            .or_else(|| get_json_path(stored.unwrap_or(&Value::Null), "capabilities.hardwareTarget").cloned())
            .unwrap_or_else(|| Value::String(ESP32_HARDWARE_TARGET.to_string())),
        "clientMode": request
            .get("clientMode")
            .cloned()
            .unwrap_or_else(|| Value::String("mqtt-udp".to_string())),
        "requestedAtMs": request.get("ts").cloned().unwrap_or(Value::Null),
        "capabilities": stored
            .and_then(|stored| stored.get("capabilities").cloned())
            .unwrap_or_else(|| json!({}))
    })
}

fn esp32_overview(state: &GatewayState) -> Result<(Vec<Value>, Vec<Value>), String> {
    let (pending, paired) = read_device_pairing_state(state)?;
    let stored = read_esp32_stored_devices(state)?;
    let mut pending = pending
        .into_values()
        .filter(esp32_pending_request)
        .map(|request| {
            let device_id = request
                .get("deviceId")
                .and_then(Value::as_str)
                .map(ToOwned::to_owned);
            esp32_pending_summary(request, device_id.as_deref().and_then(|id| stored.get(id)))
        })
        .collect::<Vec<_>>();
    pending.sort_by(|left, right| {
        let left_ts = left
            .get("requestedAtMs")
            .and_then(Value::as_u64)
            .unwrap_or(0);
        let right_ts = right
            .get("requestedAtMs")
            .and_then(Value::as_u64)
            .unwrap_or(0);
        right_ts.cmp(&left_ts)
    });

    let mut paired = paired
        .into_values()
        .filter(esp32_paired_device)
        .map(|device| {
            let device_id = device
                .get("deviceId")
                .and_then(Value::as_str)
                .map(ToOwned::to_owned);
            esp32_device_summary(device, device_id.as_deref().and_then(|id| stored.get(id)))
        })
        .collect::<Vec<_>>();
    paired.sort_by(|left, right| {
        let left_id = left
            .get("deviceId")
            .and_then(Value::as_str)
            .unwrap_or_default();
        let right_id = right
            .get("deviceId")
            .and_then(Value::as_str)
            .unwrap_or_default();
        left_id.cmp(right_id)
    });
    Ok((pending, paired))
}

fn esp32_status_get(state: &GatewayState) -> Result<Value, String> {
    let config = read_config_value(&config_path(state))?;
    let esp32_config = esp32_config_from_crawclaw_config(&config);
    let sessions = esp32_pairing_sessions(state)?;
    let (pending, paired) = esp32_overview(state)?;
    Ok(json!({
        "enabled": esp32_plugin_enabled(&config),
        "serviceRunning": false,
        "broker": esp32_config["broker"].clone(),
        "udp": esp32_config["udp"].clone(),
        "renderer": esp32_config["renderer"].clone(),
        "tts": esp32_config["tts"].clone(),
        "tools": esp32_config["tools"].clone(),
        "counts": {
            "activePairingSessions": sessions.len(),
            "pendingRequests": pending.len(),
            "pairedDevices": paired.len(),
            "onlineDevices": paired
                .iter()
                .filter(|device| device.get("online").and_then(Value::as_bool).unwrap_or(false))
                .count()
        },
        "activePairingSessions": sessions
    }))
}

fn esp32_pairing_start(state: &GatewayState, params: Value) -> Result<Value, String> {
    let config = read_config_value(&config_path(state))?;
    if !esp32_plugin_enabled(&config) {
        return Err("ESP32 plugin is disabled".to_string());
    }
    let esp32_config = esp32_config_from_crawclaw_config(&config);
    let now = now_millis() as u64;
    let ttl_ms = params
        .get("ttlMs")
        .and_then(Value::as_u64)
        .unwrap_or(5 * 60 * 1000);
    let pair_id = format!("rust-esp32-{now}");
    let password = format!("rust-pair-code-{now}");
    let name = string_param(&params, &["name"]);
    let mut sessions = read_esp32_pairing_session_state(state)?;
    let mut record = Map::new();
    record.insert("pairId".to_string(), Value::String(pair_id.clone()));
    record.insert("password".to_string(), Value::String(password.clone()));
    if let Some(name) = name.clone() {
        record.insert("name".to_string(), Value::String(name));
    }
    record.insert(
        "hardwareTarget".to_string(),
        Value::String(ESP32_HARDWARE_TARGET.to_string()),
    );
    record.insert("issuedAtMs".to_string(), json!(now));
    record.insert("expiresAtMs".to_string(), json!(now.saturating_add(ttl_ms)));
    sessions.insert(pair_id.clone(), Value::Object(record));
    write_json_file(
        &esp32_pairing_sessions_path(state),
        &Value::Object(sessions),
    )?;

    let broker = &esp32_config["broker"];
    let udp = &esp32_config["udp"];
    Ok(json!({
        "pairId": pair_id,
        "username": format!("pair:{pair_id}"),
        "pairCode": password,
        "name": name,
        "hardwareTarget": ESP32_HARDWARE_TARGET,
        "issuedAtMs": now,
        "expiresAtMs": now.saturating_add(ttl_ms),
        "broker": {
            "host": broker
                .get("advertisedHost")
                .or_else(|| broker.get("bindHost"))
                .cloned()
                .unwrap_or_else(|| Value::String("0.0.0.0".to_string())),
            "port": broker.get("port").cloned().unwrap_or_else(|| json!(1883))
        },
        "udp": {
            "host": udp
                .get("advertisedHost")
                .or_else(|| udp.get("bindHost"))
                .cloned()
                .unwrap_or_else(|| Value::String("0.0.0.0".to_string())),
            "port": udp.get("port").cloned().unwrap_or_else(|| json!(1884))
        },
        "profile": {
            "hardwareTarget": ESP32_HARDWARE_TARGET,
            "audio": { "input": "i2s", "output": "i2s", "codec": "opus" },
            "display": { "width": 320, "height": 240, "color": true }
        }
    }))
}

fn esp32_pairing_requests_list(state: &GatewayState) -> Result<Value, String> {
    let (pending, _) = esp32_overview(state)?;
    Ok(json!({ "items": pending }))
}

fn esp32_pairing_request_approve(state: &GatewayState, params: Value) -> Result<Value, String> {
    let approved = device_pair_approve(state, params)?;
    Ok(json!({
        "requestId": approved["requestId"].clone(),
        "deviceId": approved["device"]["deviceId"].clone()
    }))
}

fn esp32_pairing_request_reject(state: &GatewayState, params: Value) -> Result<Value, String> {
    device_pair_reject(state, params)
}

fn esp32_pairing_session_revoke(state: &GatewayState, params: Value) -> Result<Value, String> {
    let pair_id = required_param(&params, &["pairId", "id"])?;
    let mut sessions = read_esp32_pairing_session_state(state)?;
    if sessions.remove(&pair_id).is_none() {
        return Err("unknown pairId".to_string());
    }
    write_json_file(
        &esp32_pairing_sessions_path(state),
        &Value::Object(sessions),
    )?;
    Ok(json!({ "pairId": pair_id }))
}

fn esp32_devices_list(state: &GatewayState) -> Result<Value, String> {
    let (_, paired) = esp32_overview(state)?;
    Ok(json!({ "items": paired }))
}

fn esp32_device_get(state: &GatewayState, params: Value) -> Result<Value, String> {
    let device_id =
        safe_config_component_id(&required_param(&params, &["deviceId", "id"])?, "device id")?;
    let (_, paired) = read_device_pairing_state(state)?;
    let stored = read_esp32_stored_devices(state)?;
    let device = paired.get(&device_id).cloned().filter(esp32_paired_device);
    let summary = device
        .clone()
        .map(|device| esp32_device_summary(device.clone(), stored.get(&device_id)));
    Ok(json!({
        "ok": device.is_some(),
        "status": if device.is_some() { "found" } else { "not_found" },
        "deviceId": device_id,
        "device": summary.clone().unwrap_or(Value::Null),
        "paired": device.map(redact_paired_device).unwrap_or(Value::Null),
        "implementation": "rust-native"
    }))
}

fn esp32_devices_revoke(state: &GatewayState, params: Value) -> Result<Value, String> {
    device_pair_remove(state, params)
}

fn esp32_device_command_send(state: &GatewayState, params: Value) -> Result<Value, String> {
    let device_id =
        safe_runtime_component_id(&required_param(&params, &["deviceId", "id"])?, "device id")?;
    let command = required_param(&params, &["command", "action"])?;
    let command_id = format!("rust-esp32-command-{}", now_millis());
    let entry = json!({
        "ok": true,
        "status": "queued",
        "commandId": command_id,
        "deviceId": device_id,
        "command": command,
        "params": params.get("params").cloned().unwrap_or(Value::Null),
        "queuedAtMs": now_millis(),
        "implementation": "rust-native"
    });
    append_jsonl(
        &state.runtime_root.join("esp32").join("commands.jsonl"),
        &entry,
    )?;
    emit(state, "esp32.command", entry.clone());
    Ok(entry)
}

fn sessions_list(state: &GatewayState) -> Result<Value, String> {
    let sessions = state
        .session_store
        .list_summaries()
        .map_err(|error| error.to_string())?
        .into_iter()
        .map(|session| {
            json!({
                "key": session.key,
                "label": session.title,
                "title": session.title,
                "status": session.status,
                "messageCount": session.message_count,
                "spawnedBy": session.spawned_by,
                "yielded": session.yielded,
                "pinned": session.pinned
            })
        })
        .collect::<Vec<_>>();
    Ok(json!({ "count": sessions.len(), "sessions": sessions }))
}

fn sessions_create(state: &GatewayState, params: Value) -> Result<Value, String> {
    let key = normalize_session_key(
        &string_param(&params, &["key", "sessionKey"]).unwrap_or_else(|| "main".to_string()),
    )?;
    let label = string_param(&params, &["label", "title"]);
    let model = string_param(&params, &["model"]);
    let status = state
        .session_store
        .create_session(&key, label.as_deref(), model.as_deref())
        .map_err(|error| error.to_string())?;
    let session_file = state
        .session_store
        .session_transcript_path(&key)
        .map_err(|error| error.to_string())?;
    Ok(json!({
        "ok": true,
        "key": key,
        "sessionId": format!("rust-session-{}", now_millis()),
        "runStarted": false,
        "entry": {
            "key": status.key,
            "sessionFile": session_file.to_string_lossy(),
            "label": label.unwrap_or(status.title.clone()),
            "title": status.title,
            "model": model,
            "status": status.status
        }
    }))
}

fn sessions_preview(state: &GatewayState, params: Value) -> Result<Value, String> {
    let keys = params
        .get("keys")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let previews = keys
        .into_iter()
        .filter_map(|value| value.as_str().map(ToOwned::to_owned))
        .map(|key| {
            let normalized = normalize_session_key(&key)?;
            let messages = state
                .session_store
                .session_history(&normalized)
                .map_err(|error| error.to_string())?;
            let items = messages
                .into_iter()
                .take(20)
                .map(|message| {
                    json!({
                        "role": message.role,
                        "text": message.content
                    })
                })
                .collect::<Vec<_>>();
            Ok(json!({ "key": normalized, "status": "ok", "items": items }))
        })
        .collect::<Result<Vec<_>, String>>()?;
    Ok(json!({ "previews": previews }))
}

fn sessions_resolve(state: &GatewayState, params: Value) -> Result<Value, String> {
    let label = required_param(&params, &["label", "key", "sessionKey"])?;
    if let Some(key) = state
        .session_store
        .resolve_session_by_label(&label)
        .map_err(|error| error.to_string())?
    {
        return Ok(json!({ "ok": true, "key": key }));
    }
    let normalized = normalize_session_key(&label)?;
    Ok(json!({ "ok": false, "key": normalized }))
}

fn sessions_patch(state: &GatewayState, params: Value) -> Result<Value, String> {
    let key = normalize_session_key(&required_param(&params, &["key", "sessionKey"])?)?;
    let label = string_param(&params, &["label", "title"]);
    let model = string_param(&params, &["model"]);
    let pinned = params.get("pinned").and_then(Value::as_bool);
    let status_value = string_param(&params, &["status"]);
    let status = state
        .session_store
        .patch_session(
            &key,
            label.as_deref(),
            model.as_deref(),
            pinned,
            status_value.as_deref(),
        )
        .map_err(|error| error.to_string())?;
    Ok(json!({
        "ok": true,
        "key": key,
        "entry": {
            "key": status.key,
            "label": label.unwrap_or(status.title.clone()),
            "title": status.title,
            "model": model,
            "status": status.status,
            "pinned": status.pinned
        }
    }))
}

fn sessions_reset(state: &GatewayState, params: Value) -> Result<Value, String> {
    let key = normalize_session_key(&required_param(&params, &["key", "sessionKey"])?)?;
    let status = state
        .session_store
        .reset_session(&key)
        .map_err(|error| error.to_string())?;
    Ok(json!({
        "ok": true,
        "key": key,
        "entry": {
            "key": status.key,
            "sessionId": format!("rust-session-{}", now_millis()),
            "label": status.title,
            "title": status.title,
            "status": status.status
        }
    }))
}

fn sessions_delete(state: &GatewayState, params: Value) -> Result<Value, String> {
    let key = normalize_session_key(&required_param(&params, &["key", "sessionKey"])?)?;
    let deleted = state
        .session_store
        .delete_session(&key)
        .map_err(|error| error.to_string())?;
    Ok(json!({ "ok": true, "key": key, "deleted": deleted }))
}

fn sessions_compact(state: &GatewayState, params: Value) -> Result<Value, String> {
    let key = normalize_session_key(&required_param(&params, &["key", "sessionKey"])?)?;
    let max_lines = params
        .get("maxLines")
        .and_then(Value::as_u64)
        .unwrap_or(200) as usize;
    let (compacted, kept) = state
        .session_store
        .compact_session(&key, max_lines)
        .map_err(|error| error.to_string())?;
    Ok(json!({ "ok": true, "key": key, "compacted": compacted, "kept": kept }))
}

fn sessions_messages_subscription(
    state: &GatewayState,
    params: Value,
    subscribed: bool,
) -> Result<Value, String> {
    let key = string_param(&params, &["key", "sessionKey"])
        .ok_or_else(|| "session key required".to_string())?;
    let normalized = normalize_session_key(&key)?;
    state
        .session_store
        .session_status(&normalized)
        .map_err(|error| error.to_string())?;
    Ok(json!({ "subscribed": subscribed, "key": normalized }))
}

fn normalize_session_key(input: &str) -> Result<String, String> {
    let value = input.trim();
    if value.is_empty() {
        return Err("session key cannot be empty".to_string());
    }
    if value.contains('/') || value.contains('\\') || value == "." || value == ".." {
        return Err(format!("invalid session key: {input}"));
    }
    if value.starts_with("agent:") {
        Ok(value.to_string())
    } else {
        Ok(format!("agent:main:{value}"))
    }
}

async fn run_agent(state: &GatewayState, params: Value) -> Result<Value, String> {
    let session_key =
        string_param(&params, &["sessionKey", "key"]).unwrap_or_else(|| "main".to_string());
    let message = required_param(&params, &["message", "text", "input"])?;
    let result = state
        .agent_runtime
        .send_message(session_key.clone(), message)
        .await
        .map_err(|error| error.message().to_string())?;
    emit(
        state,
        "session.message",
        json!({
            "sessionKey": session_key,
            "role": "assistant",
            "content": result.assistant_text
        }),
    );
    emit(
        state,
        "sessions.changed",
        json!({ "sessionKey": result.thread_id }),
    );
    Ok(json!({
        "runId": format!("rust-run-{}", now_millis()),
        "sessionKey": result.thread_id,
        "assistantText": result.assistant_text
    }))
}

fn runtime_status_value(state: &GatewayState) -> Value {
    json!({
        "ok": true,
        "runtime": "ready",
        "implementation": "rust-native",
        "authMode": auth_mode(state),
        "stateDir": state.state_dir.to_string_lossy(),
        "runtimeRoot": state.runtime_root.to_string_lossy(),
        "jsPluginRuntime": "pi-quickjs",
        "providerPlugins": crawclaw_providers::bundled_provider_plugin_metadata(),
        "gatewayMethods": gateway_methods(),
        "coreTools": crawclaw_runtime::pi_agent_rust_tool_names()
    })
}

fn gateway_methods() -> Vec<&'static str> {
    vec![
        "health",
        "status",
        "system.status",
        "system.health",
        "config.get",
        "config.set",
        "config.apply",
        "config.patch",
        "config.schema",
        "config.schema.lookup",
        "secrets.reload",
        "secrets.resolve",
        "tools.catalog",
        "tools.effective",
        "models.list",
        "agents.list",
        "logs.tail",
        "usage.status",
        "usage.cost",
        "doctor.memory.status",
        "agentRuntime.summary",
        "agentRuntime.list",
        "agentRuntime.get",
        "agentRuntime.cancel",
        "agent.identity.get",
        "agent.inspect",
        "agent.observations.list",
        "agent.wait",
        "agents.create",
        "agents.update",
        "agents.delete",
        "agents.files.list",
        "agents.files.get",
        "agents.files.set",
        "skills.status",
        "skills.bins",
        "skills.install",
        "skills.update",
        "wizard.start",
        "wizard.next",
        "wizard.cancel",
        "wizard.status",
        "plugins.list",
        "plugins.enable",
        "plugins.disable",
        "plugins.install",
        "plugins.update",
        "plugins.uninstall",
        "exec.approvals.get",
        "exec.approvals.set",
        "exec.approval.request",
        "exec.approval.waitDecision",
        "exec.approval.resolve",
        "plugin.approval.request",
        "plugin.approval.waitDecision",
        "plugin.approval.resolve",
        "channels.status",
        "channels.setup.surface",
        "channels.config.get",
        "channels.config.schema",
        "channels.config.patch",
        "channels.config.apply",
        "channels.logout",
        "channels.account.logout",
        "channels.account.reconnect",
        "channels.account.verify",
        "channels.account.login.start",
        "channels.account.login.wait",
        "channels.login.start",
        "channels.login.wait",
        "tts.status",
        "tts.providers",
        "tts.enable",
        "tts.disable",
        "tts.setProvider",
        "tts.convert",
        "talk.config",
        "talk.mode",
        "talk.speak",
        "voice.getOverview",
        "voice.qwen3Tts.preview",
        "voice.qwen3Tts.uploadReferenceAudio",
        "voicewake.get",
        "voicewake.set",
        "update.run",
        "last-main-session-wake",
        "system.mainSessionWake.last",
        "gateway.identity.get",
        "system-presence",
        "system-event",
        "send",
        "device.pair.list",
        "device.pair.approve",
        "device.pair.reject",
        "device.pair.remove",
        "device.token.rotate",
        "device.token.revoke",
        "esp32.status.get",
        "esp32.pairing.start",
        "esp32.pairing.requests.list",
        "esp32.pairing.request.approve",
        "esp32.pairing.request.reject",
        "esp32.pairing.session.revoke",
        "esp32.devices.list",
        "esp32.devices.get",
        "esp32.devices.revoke",
        "esp32.devices.command.send",
        "workflow.list",
        "workflow.get",
        "workflow.n8n.get",
        "workflow.match",
        "workflow.runs",
        "workflow.enable",
        "workflow.disable",
        "workflow.archive",
        "workflow.unarchive",
        "workflow.delete",
        "workflow.deploy",
        "workflow.run",
        "workflow.status",
        "workflow.cancel",
        "workflow.resume",
        "workflow.agent.run",
        "chat.history",
        "chat.send",
        "chat.abort",
        "chat.inject",
        "agent",
        "sessions.list",
        "sessions.create",
        "sessions.subscribe",
        "sessions.unsubscribe",
        "sessions.messages.subscribe",
        "sessions.messages.unsubscribe",
        "sessions.preview",
        "sessions.resolve",
        "sessions.patch",
        "sessions.reset",
        "sessions.delete",
        "sessions.compact",
        "sessions.abort",
        "sessions.status",
        "sessions.get",
        "sessions.send",
        "sessions.spawn",
        "sessions.yield",
        "subagents",
        "wake",
        "cron.status",
        "cron.list",
        "cron.add",
        "cron.update",
        "cron.remove",
        "cron.run",
        "cron.runs",
        "special_agents.list",
        "special_agents.run",
        "review_task",
        "memory.status",
        "memory.refresh",
        "memory.login",
        "memory.sync",
        "memory.admin.overview",
        "memory.durable.index.list",
        "memory.durable.index.get",
        "memory.dream.status",
        "memory.dream.history",
        "memory.dream.run",
        "memory.session_summary.status",
        "memory.session_summary.refresh",
        "memory.sessionSummary.status",
        "memory.sessionSummary.refresh",
        "memory.experience.outbox.list",
        "memory.experience.outbox.updateStatus",
        "memory.experience.outbox.prune",
        "memory.experience.sync.flush",
        "memory.promptJournal.summary",
        "memory.bootstrap",
        "memory.ingestBatch",
        "memory.assemble",
        "memory.compact",
    ]
}

fn hello_ok(state: &GatewayState) -> Value {
    json!({
        "type": "hello-ok",
        "protocol": 3,
        "server": {
            "version": env!("CARGO_PKG_VERSION"),
            "connId": format!("rust-conn-{}", now_millis())
        },
        "features": {
            "methods": gateway_methods(),
            "events": desktop::SSE_EVENTS
        },
        "snapshot": {
            "presence": system_presence(state).unwrap_or_else(|_| Value::Array(Vec::new())),
            "health": runtime_status_value(state),
            "stateVersion": { "presence": 0, "health": 0 },
            "uptimeMs": now_millis().saturating_sub(state.started_at_ms) as u64,
            "configPath": config_path(state).to_string_lossy(),
            "stateDir": state.state_dir.to_string_lossy(),
            "sessionDefaults": {
                "defaultAgentId": "main",
                "mainKey": "main",
                "mainSessionKey": "agent:main:main"
            },
            "authMode": auth_mode(state)
        },
        "policy": {
            "maxPayload": 26214400,
            "maxBufferedBytes": 26214400,
            "tickIntervalMs": 30000
        }
    })
}

fn memory_runtime(state: &GatewayState) -> RustMemoryRuntime {
    RustMemoryRuntime::new(state.runtime_root.clone())
}

fn memory_prompt_journal_summary(state: &GatewayState, params: Value) -> Result<Value, String> {
    let files = prompt_journal_candidate_files(state, &params);
    let mut events = Vec::new();
    for file in &files {
        events.extend(read_prompt_journal_events(file));
    }

    let mut stage_counts = BTreeMap::<String, u64>::new();
    let mut decision_counts = BTreeMap::<String, u64>::new();
    let mut skip_reason_counts = BTreeMap::<String, u64>::new();
    let mut top_reason_counts = BTreeMap::<String, u64>::new();
    let mut experience_extract_status_counts = BTreeMap::<String, u64>::new();
    let mut experience_extract_decision_counts = BTreeMap::<String, u64>::new();
    let mut experience_status_counts = BTreeMap::<String, u64>::new();
    let mut experience_action_counts = BTreeMap::<String, u64>::new();
    let mut experience_title_counts = BTreeMap::<String, u64>::new();
    let mut sessions = BTreeSet::<String>::new();
    let mut date_buckets = BTreeSet::<String>::new();
    let mut prompt_estimated_tokens = Vec::<f64>::new();
    let mut prompt_chars = Vec::<f64>::new();
    let mut prompt_assembly_count = 0_u64;
    let mut durable_count = 0_u64;
    let mut durable_notes_saved_total = 0_i64;
    let mut durable_non_zero_save_count = 0_u64;
    let mut durable_zero_save_count = 0_u64;
    let mut experience_extract_written_count = 0_i64;
    let mut experience_extract_updated_count = 0_i64;
    let mut experience_extract_deleted_count = 0_i64;

    for event in &events {
        let stage = string_param(event, &["stage"]);
        increment_counter(&mut stage_counts, stage.as_deref());
        if let Some(session) = string_param(event, &["sessionKey", "sessionId"]) {
            sessions.insert(session);
        }
        if let Some(date_bucket) = string_param(event, &["dateBucket"]) {
            date_buckets.insert(date_bucket);
        }
        let payload = event.get("payload").unwrap_or(&Value::Null);

        match stage.as_deref() {
            Some("prompt_assembly") => {
                prompt_assembly_count += 1;
                if let Some(value) = payload.get("estimatedTokens").and_then(Value::as_f64) {
                    prompt_estimated_tokens.push(value);
                }
                if let Some(text) = payload.get("systemContextText").and_then(Value::as_str) {
                    prompt_chars.push(text.chars().count() as f64);
                }
            }
            Some("after_turn_decision") => {
                increment_counter(
                    &mut decision_counts,
                    payload.get("decision").and_then(Value::as_str),
                );
                increment_counter(
                    &mut skip_reason_counts,
                    payload.get("skipReason").and_then(Value::as_str),
                );
            }
            Some("durable_extraction") => {
                durable_count += 1;
                let notes_saved = payload
                    .get("notesSaved")
                    .and_then(Value::as_i64)
                    .unwrap_or(0);
                durable_notes_saved_total += notes_saved;
                if notes_saved == 0 {
                    durable_zero_save_count += 1;
                } else {
                    durable_non_zero_save_count += 1;
                }
                increment_counter(
                    &mut top_reason_counts,
                    payload.get("reason").and_then(Value::as_str),
                );
            }
            Some("experience_extract") => {
                increment_counter(
                    &mut experience_extract_status_counts,
                    payload.get("status").and_then(Value::as_str),
                );
                increment_counter(
                    &mut experience_extract_decision_counts,
                    payload.get("decision").and_then(Value::as_str),
                );
                experience_extract_written_count += payload
                    .get("writtenCount")
                    .and_then(Value::as_i64)
                    .unwrap_or(0);
                experience_extract_updated_count += payload
                    .get("updatedCount")
                    .and_then(Value::as_i64)
                    .unwrap_or(0);
                experience_extract_deleted_count += payload
                    .get("deletedCount")
                    .and_then(Value::as_i64)
                    .unwrap_or(0);
            }
            Some("experience_write") => {
                increment_counter(
                    &mut experience_status_counts,
                    payload.get("status").and_then(Value::as_str),
                );
                increment_counter(
                    &mut experience_action_counts,
                    payload.get("action").and_then(Value::as_str),
                );
                increment_counter(
                    &mut experience_title_counts,
                    payload.get("title").and_then(Value::as_str),
                );
            }
            _ => {}
        }
    }

    Ok(json!({
        "files": files
            .iter()
            .map(|path| path.to_string_lossy().to_string())
            .collect::<Vec<_>>(),
        "dateBuckets": date_buckets.into_iter().collect::<Vec<_>>(),
        "totalEvents": events.len(),
        "stageCounts": stage_counts,
        "uniqueSessions": sessions.len(),
        "promptAssembly": {
            "count": prompt_assembly_count,
            "avgEstimatedTokens": average_number(&prompt_estimated_tokens, 2),
            "avgSystemPromptChars": average_number(&prompt_chars, 2)
        },
        "afterTurn": {
            "decisionCounts": decision_counts,
            "skipReasonCounts": skip_reason_counts
        },
        "durableExtraction": {
            "count": durable_count,
            "notesSavedTotal": durable_notes_saved_total,
            "nonZeroSaveCount": durable_non_zero_save_count,
            "zeroSaveCount": durable_zero_save_count,
            "saveRate": if durable_count > 0 {
                json!(round_to(durable_non_zero_save_count as f64 / durable_count as f64, 4))
            } else {
                Value::Null
            },
            "topReasons": sorted_counter_entries(top_reason_counts, "reason")
                .into_iter()
                .take(10)
                .collect::<Vec<_>>()
        },
        "experienceExtraction": {
            "statusCounts": experience_extract_status_counts,
            "decisionCounts": experience_extract_decision_counts,
            "writtenCount": experience_extract_written_count,
            "updatedCount": experience_extract_updated_count,
            "deletedCount": experience_extract_deleted_count
        },
        "experienceWrite": {
            "statusCounts": experience_status_counts,
            "actionCounts": experience_action_counts,
            "titles": sorted_counter_entries(experience_title_counts, "title")
                .into_iter()
                .take(10)
                .collect::<Vec<_>>()
        }
    }))
}

fn prompt_journal_candidate_files(state: &GatewayState, params: &Value) -> Vec<PathBuf> {
    if let Some(file) = string_param(params, &["file"]) {
        return vec![expand_user_path(&file)];
    }

    let dir = string_param(params, &["dir"])
        .map(|dir| expand_user_path(&dir))
        .unwrap_or_else(|| state.state_dir.join("logs").join("memory-prompt-journal"));
    let mut files = std::fs::read_dir(&dir)
        .ok()
        .into_iter()
        .flatten()
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| path.extension().and_then(|value| value.to_str()) == Some("jsonl"))
        .collect::<Vec<_>>();
    files.sort();

    if let Some(date) = string_param(params, &["date"]) {
        let target = format!("{date}.jsonl");
        return files
            .into_iter()
            .filter(|path| {
                path.file_name().and_then(|value| value.to_str()) == Some(target.as_str())
            })
            .collect();
    }

    let days = params
        .get("days")
        .and_then(Value::as_u64)
        .unwrap_or(1)
        .max(1) as usize;
    files
        .into_iter()
        .rev()
        .take(days)
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect()
}

fn read_prompt_journal_events(path: &Path) -> Vec<Value> {
    let Ok(raw) = std::fs::read_to_string(path) else {
        return Vec::new();
    };
    raw.lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .filter_map(|line| serde_json::from_str::<Value>(line).ok())
        .collect()
}

fn increment_counter(target: &mut BTreeMap<String, u64>, key: Option<&str>) {
    let Some(key) = key.map(str::trim).filter(|value| !value.is_empty()) else {
        return;
    };
    *target.entry(key.to_string()).or_insert(0) += 1;
}

fn average_number(values: &[f64], digits: u32) -> Value {
    if values.is_empty() {
        return Value::Null;
    }
    let total = values.iter().sum::<f64>();
    json!(round_to(total / values.len() as f64, digits))
}

fn round_to(value: f64, digits: u32) -> f64 {
    let factor = 10_f64.powi(digits as i32);
    (value * factor).round() / factor
}

fn sorted_counter_entries(counts: BTreeMap<String, u64>, key_name: &str) -> Vec<Value> {
    let mut entries = counts.into_iter().collect::<Vec<_>>();
    entries.sort_by(|left, right| right.1.cmp(&left.1).then_with(|| left.0.cmp(&right.0)));
    entries
        .into_iter()
        .map(|(key, count)| json!({ key_name: key, "count": count }))
        .collect()
}

fn desktop_state_value(state: &GatewayState) -> Value {
    let sessions = state.session_store.list_summaries().unwrap_or_default();
    json!({
        "sessions": sessions,
        "runtime": {
            "implementation": "rust-native",
            "jsPluginRuntime": "pi-quickjs"
        }
    })
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
    match state.auth_token.as_deref() {
        None if state.auth_password.is_none() => Ok(()),
        None => Err(StatusCode::UNAUTHORIZED),
        Some(expected) if token == Some(expected) => Ok(()),
        Some(_) => Err(StatusCode::UNAUTHORIZED),
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
        let supplied = auth
            .and_then(|auth| auth.token.as_deref())
            .or_else(|| auth.and_then(|auth| auth.bootstrap_token.as_deref()))
            .or_else(|| auth.and_then(|auth| auth.device_token.as_deref()));
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

fn json_event_to_sse(event: Value) -> Event {
    let event_type = event
        .get("type")
        .and_then(Value::as_str)
        .unwrap_or("stateChanged")
        .to_string();
    let data = serde_json::to_string(event.get("payload").unwrap_or(&Value::Null))
        .unwrap_or_else(|_| "null".to_string());
    Event::default().event(event_type).data(data)
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
mod tests {
    use super::*;
    use std::collections::BTreeSet;
    use std::sync::{Mutex, OnceLock};

    fn env_lock() -> &'static Mutex<()> {
        static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
        LOCK.get_or_init(|| Mutex::new(()))
    }

    #[test]
    fn rust_gateway_method_table_covers_ts_core_gateway_methods() {
        let ts_methods = ts_core_gateway_methods();
        let rust_methods = gateway_methods().into_iter().collect::<BTreeSet<_>>();
        let missing = ts_methods
            .iter()
            .filter(|method| !rust_methods.contains(method.as_str()))
            .cloned()
            .collect::<Vec<_>>();

        assert!(
            missing.is_empty(),
            "Rust Gateway is missing TS core Gateway methods: {missing:?}"
        );
    }

    #[tokio::test]
    async fn rust_gateway_rpc_manages_sessions_and_subagents() {
        let _guard = env_lock().lock().expect("env lock");
        let runtime_root = unique_test_runtime_root("gateway-rpc-sessions");
        let state = GatewayState::new(GatewayRunConfig {
            runtime_root: Some(runtime_root.clone()),
            ..GatewayRunConfig::default()
        });

        let spawned = handle_gateway_method(
            &state,
            "sessions.spawn",
            json!({
                "task": "inspect gateway",
                "label": "gateway worker",
                "parentSessionKey": "main"
            }),
        )
        .await
        .expect("spawn");
        let child_key = spawned["session"]["key"]
            .as_str()
            .expect("child key")
            .to_string();

        handle_gateway_method(
            &state,
            "sessions.send",
            json!({
                "sessionKey": child_key.clone(),
                "message": "follow up"
            }),
        )
        .await
        .expect("send");
        let yielded = handle_gateway_method(
            &state,
            "sessions.yield",
            json!({
                "sessionKey": child_key.clone()
            }),
        )
        .await
        .expect("yield");

        assert_eq!(yielded["session"]["yielded"], true);
        let history = handle_gateway_method(
            &state,
            "sessions.history",
            json!({
                "sessionKey": child_key.clone()
            }),
        )
        .await
        .expect("history");
        assert!(history["messages"]
            .as_array()
            .expect("messages")
            .iter()
            .any(|message| message["content"] == "follow up"));
        let subscribed = handle_gateway_method(&state, "sessions.subscribe", json!({}))
            .await
            .expect("sessions subscribe");
        assert_eq!(subscribed["subscribed"], true);
        let message_subscribed = handle_gateway_method(
            &state,
            "sessions.messages.subscribe",
            json!({ "key": child_key.clone() }),
        )
        .await
        .expect("session messages subscribe");
        assert_eq!(message_subscribed["subscribed"], true);
        assert_eq!(
            message_subscribed["key"],
            normalize_session_key(&child_key).expect("normalized child key")
        );
        let missing_message_key =
            handle_gateway_method(&state, "sessions.messages.subscribe", json!({})).await;
        assert!(missing_message_key
            .expect_err("message subscribe requires key")
            .contains("session key required"));
        let subagents = handle_gateway_method(
            &state,
            "subagents",
            json!({
                "parentSessionKey": "main"
            }),
        )
        .await
        .expect("subagents");
        assert_eq!(subagents["subagents"][0]["title"], "gateway worker");

        let _ = std::fs::remove_dir_all(runtime_root);
    }

    #[tokio::test]
    async fn rust_gateway_rpc_manages_cron_jobs() {
        let _guard = env_lock().lock().expect("env lock");
        let previous_state_dir = env::var_os("CRAWCLAW_STATE_DIR");
        let runtime_root = unique_test_runtime_root("gateway-rpc-cron-runtime");
        let state_dir = unique_test_runtime_root("gateway-rpc-cron-state");
        env::set_var("CRAWCLAW_STATE_DIR", &state_dir);

        let state = GatewayState::new(GatewayRunConfig {
            runtime_root: Some(runtime_root.clone()),
            ..GatewayRunConfig::default()
        });

        let status = runtime_status_value(&state);
        assert!(status["gatewayMethods"]
            .as_array()
            .expect("gateway methods")
            .iter()
            .any(|method| method == "cron.add"));
        assert!(status["coreTools"]
            .as_array()
            .expect("core tools")
            .iter()
            .any(|tool| tool == "cron"));

        let added = handle_gateway_method(
            &state,
            "cron.add",
            json!({
                "id": "gateway-job",
                "name": "Gateway reminder",
                "schedule": { "kind": "at", "at": "2999-01-01T00:00:00Z" },
                "sessionTarget": "main",
                "payload": { "kind": "systemEvent", "text": "gateway wake" }
            }),
        )
        .await
        .expect("add cron job");
        assert_eq!(added["id"], "gateway-job");
        assert!(added["state"]["nextRunAtMs"].is_number());

        let listed = handle_gateway_method(
            &state,
            "cron.list",
            json!({
                "includeDisabled": true
            }),
        )
        .await
        .expect("list cron jobs");
        assert_eq!(listed["jobs"][0]["id"], "gateway-job");

        let run = handle_gateway_method(
            &state,
            "cron.run",
            json!({
                "id": "gateway-job",
                "mode": "force"
            }),
        )
        .await
        .expect("run cron job");
        assert_eq!(run["ok"], true);
        assert_eq!(run["enqueued"], true);

        for _ in 0..20 {
            let history = state
                .session_store
                .session_history("main")
                .expect("main history");
            if history
                .iter()
                .any(|message| message.role == "system" && message.content == "gateway wake")
            {
                break;
            }
            tokio::time::sleep(std::time::Duration::from_millis(25)).await;
        }
        let history = state
            .session_store
            .session_history("main")
            .expect("main history");
        assert!(history
            .iter()
            .any(|message| message.role == "system" && message.content == "gateway wake"));

        match previous_state_dir {
            Some(value) => env::set_var("CRAWCLAW_STATE_DIR", value),
            None => env::remove_var("CRAWCLAW_STATE_DIR"),
        }
        let _ = std::fs::remove_dir_all(runtime_root);
        let _ = std::fs::remove_dir_all(state_dir);
    }

    #[tokio::test]
    async fn rust_gateway_main_session_wake_tracks_last_event() {
        let _guard = env_lock().lock().expect("env lock");
        let runtime_root = unique_test_runtime_root("gateway-main-session-wake");
        let state = GatewayState::new(GatewayRunConfig {
            runtime_root: Some(runtime_root.clone()),
            ..GatewayRunConfig::default()
        });

        let initial = handle_gateway_method(&state, "system.mainSessionWake.last", json!({}))
            .await
            .expect("initial wake");
        assert!(initial.is_null());

        let wake = handle_gateway_method(&state, "wake", json!({ "text": "wake main" }))
            .await
            .expect("wake");
        assert_eq!(wake["status"], "ok");

        let last = handle_gateway_method(&state, "last-main-session-wake", json!({}))
            .await
            .expect("last wake");
        assert_eq!(last["status"], "sent");
        assert_eq!(last["preview"], "wake main");
        assert_eq!(last["reason"], "manual");
        assert_eq!(last["channel"], "local");
        assert_eq!(last["silent"], false);
        assert!(last["ts"].as_u64().is_some());

        let _ = std::fs::remove_dir_all(runtime_root);
    }

    #[tokio::test]
    async fn rust_gateway_rpc_manages_special_agents_and_memory() {
        let _guard = env_lock().lock().expect("env lock");
        let runtime_root = unique_test_runtime_root("gateway-rpc-special-agents");
        let state = GatewayState::new(GatewayRunConfig {
            runtime_root: Some(runtime_root.clone()),
            ..GatewayRunConfig::default()
        });

        let listed = handle_gateway_method(&state, "special_agents.list", json!({}))
            .await
            .expect("list special agents");
        assert_eq!(listed["status"], "ok");
        assert_eq!(listed["agents"].as_array().expect("agents").len(), 6);

        let run = handle_gateway_method(
            &state,
            "special_agents.run",
            json!({
                "kind": "durable-memory",
                "scope": "main",
                "task": "inspect memory"
            }),
        )
        .await
        .expect("run special agent");
        assert_eq!(run["status"], "completed");
        assert_eq!(run["kind"], "durable-memory");

        let dream = handle_gateway_method(
            &state,
            "memory.dream.run",
            json!({
                "scope": "main",
                "task": "compact notes"
            }),
        )
        .await
        .expect("run dream");
        assert_eq!(dream["status"], "completed");

        let history = handle_gateway_method(&state, "memory.dream.history", json!({}))
            .await
            .expect("dream history");
        assert_eq!(history["history"].as_array().expect("history").len(), 1);

        let _ = std::fs::remove_dir_all(runtime_root);
    }

    #[tokio::test]
    async fn rust_gateway_memory_prompt_journal_summary_reads_jsonl() {
        let _guard = env_lock().lock().expect("env lock");
        let runtime_root = unique_test_runtime_root("gateway-prompt-journal-summary");
        let journal_dir = runtime_root.join("journal");
        std::fs::create_dir_all(&journal_dir).expect("create journal dir");
        std::fs::write(
            journal_dir.join("2026-05-10.jsonl"),
            [
                serde_json::to_string(&json!({
                    "stage": "prompt_assembly",
                    "sessionKey": "s1",
                    "dateBucket": "2026-05-10",
                    "payload": {
                        "estimatedTokens": 100,
                        "systemContextText": "abcd"
                    }
                }))
                .expect("prompt assembly"),
                serde_json::to_string(&json!({
                    "stage": "after_turn_decision",
                    "sessionId": "s2",
                    "dateBucket": "2026-05-10",
                    "payload": {
                        "decision": "save",
                        "skipReason": "none"
                    }
                }))
                .expect("after turn"),
                serde_json::to_string(&json!({
                    "stage": "durable_extraction",
                    "sessionKey": "s1",
                    "dateBucket": "2026-05-10",
                    "payload": {
                        "notesSaved": 2,
                        "reason": "important"
                    }
                }))
                .expect("durable saved"),
                serde_json::to_string(&json!({
                    "stage": "durable_extraction",
                    "sessionKey": "s3",
                    "dateBucket": "2026-05-10",
                    "payload": {
                        "notesSaved": 0,
                        "reason": "low-signal"
                    }
                }))
                .expect("durable skipped"),
                serde_json::to_string(&json!({
                    "stage": "experience_extract",
                    "sessionKey": "s4",
                    "dateBucket": "2026-05-10",
                    "payload": {
                        "status": "ok",
                        "decision": "write",
                        "writtenCount": 1,
                        "updatedCount": 2,
                        "deletedCount": 1
                    }
                }))
                .expect("experience extract"),
                serde_json::to_string(&json!({
                    "stage": "experience_write",
                    "sessionKey": "s5",
                    "dateBucket": "2026-05-10",
                    "payload": {
                        "status": "ok",
                        "action": "updated",
                        "title": "Useful note"
                    }
                }))
                .expect("experience write"),
                String::new(),
            ]
            .join("\n"),
        )
        .expect("write journal");
        std::fs::write(
            journal_dir.join("2026-05-09.jsonl"),
            format!(
                "{}\n",
                serde_json::to_string(&json!({
                    "stage": "prompt_assembly",
                    "sessionKey": "old",
                    "dateBucket": "2026-05-09",
                    "payload": { "estimatedTokens": 999 }
                }))
                .expect("old journal")
            ),
        )
        .expect("write old journal");

        let state = GatewayState::new(GatewayRunConfig {
            runtime_root: Some(runtime_root.clone()),
            ..GatewayRunConfig::default()
        });
        let summary = handle_gateway_method(
            &state,
            "memory.promptJournal.summary",
            json!({ "dir": journal_dir.to_string_lossy(), "days": 1 }),
        )
        .await
        .expect("prompt journal summary");

        assert_eq!(summary["files"].as_array().expect("files").len(), 1);
        assert_eq!(summary["dateBuckets"], json!(["2026-05-10"]));
        assert_eq!(summary["totalEvents"], 6);
        assert_eq!(summary["stageCounts"]["prompt_assembly"], 1);
        assert_eq!(summary["uniqueSessions"], 5);
        assert_eq!(summary["promptAssembly"]["count"], 1);
        assert_eq!(summary["promptAssembly"]["avgEstimatedTokens"], 100.0);
        assert_eq!(summary["promptAssembly"]["avgSystemPromptChars"], 4.0);
        assert_eq!(summary["afterTurn"]["decisionCounts"]["save"], 1);
        assert_eq!(summary["afterTurn"]["skipReasonCounts"]["none"], 1);
        assert_eq!(summary["durableExtraction"]["count"], 2);
        assert_eq!(summary["durableExtraction"]["notesSavedTotal"], 2);
        assert_eq!(summary["durableExtraction"]["nonZeroSaveCount"], 1);
        assert_eq!(summary["durableExtraction"]["zeroSaveCount"], 1);
        assert_eq!(summary["durableExtraction"]["saveRate"], 0.5);
        assert_eq!(
            summary["durableExtraction"]["topReasons"][0],
            json!({ "reason": "important", "count": 1 })
        );
        assert_eq!(summary["experienceExtraction"]["statusCounts"]["ok"], 1);
        assert_eq!(
            summary["experienceExtraction"]["decisionCounts"]["write"],
            1
        );
        assert_eq!(summary["experienceExtraction"]["writtenCount"], 1);
        assert_eq!(summary["experienceExtraction"]["updatedCount"], 2);
        assert_eq!(summary["experienceExtraction"]["deletedCount"], 1);
        assert_eq!(summary["experienceWrite"]["statusCounts"]["ok"], 1);
        assert_eq!(summary["experienceWrite"]["actionCounts"]["updated"], 1);
        assert_eq!(
            summary["experienceWrite"]["titles"][0],
            json!({ "title": "Useful note", "count": 1 })
        );

        let _ = std::fs::remove_dir_all(runtime_root);
    }

    #[test]
    fn runtime_status_advertises_rust_core_gateway_methods() {
        let _guard = env_lock().lock().expect("env lock");
        let runtime_root = unique_test_runtime_root("gateway-runtime-status");
        let state = GatewayState::new(GatewayRunConfig {
            runtime_root: Some(runtime_root.clone()),
            ..GatewayRunConfig::default()
        });
        let status = runtime_status_value(&state);

        assert_eq!(status["implementation"], "rust-native");
        assert_eq!(status["jsPluginRuntime"], "pi-quickjs");
        assert!(status["gatewayMethods"]
            .as_array()
            .expect("gateway methods")
            .iter()
            .any(|method| method == "sessions.spawn"));
        assert!(status["gatewayMethods"]
            .as_array()
            .expect("gateway methods")
            .iter()
            .any(|method| method == "special_agents.run"));
        assert!(status["gatewayMethods"]
            .as_array()
            .expect("gateway methods")
            .iter()
            .any(|method| method == "plugins.update"));
        assert!(status["gatewayMethods"]
            .as_array()
            .expect("gateway methods")
            .iter()
            .any(|method| method == "plugins.uninstall"));
        assert!(status["coreTools"]
            .as_array()
            .expect("core tools")
            .iter()
            .any(|tool| tool == "sessions_spawn"));
        assert!(status["coreTools"]
            .as_array()
            .expect("core tools")
            .iter()
            .any(|tool| tool == "review_task"));

        let _ = std::fs::remove_dir_all(runtime_root);
    }

    #[tokio::test]
    async fn rust_gateway_plugins_install_update_uninstall_local_path() {
        let _guard = env_lock().lock().expect("env lock");
        let runtime_root = unique_test_runtime_root("gateway-plugin-lifecycle-runtime");
        let source_root = unique_test_runtime_root("gateway-plugin-lifecycle-source");
        let state = GatewayState::new(GatewayRunConfig {
            runtime_root: Some(runtime_root.clone()),
            ..GatewayRunConfig::default()
        });
        std::fs::create_dir_all(&source_root).expect("create plugin source");
        write_json_file(
            &source_root.join("crawclaw.plugin.json"),
            &json!({
                "id": "quickjs-demo",
                "name": "QuickJS Demo",
                "version": "1.0.0",
                "main": "index.mjs"
            }),
        )
        .expect("write source manifest");
        std::fs::write(source_root.join("index.mjs"), "export default {};\n")
            .expect("write source entrypoint");

        let installed = handle_gateway_method(
            &state,
            "plugins.install",
            json!({ "raw": source_root.to_string_lossy() }),
        )
        .await
        .expect("install local plugin");
        assert_eq!(installed["ok"], true);
        assert_eq!(installed["pluginId"], "quickjs-demo");
        assert_eq!(installed["installSource"], "path");
        assert_eq!(installed["requiresRestart"], true);
        let installed_root = runtime_root.join("plugins/quickjs-demo");
        assert!(installed_root.join("crawclaw.plugin.json").exists());
        assert!(installed_root.join("index.mjs").exists());

        let config = read_config_value(&config_path(&state)).expect("read config");
        assert_eq!(
            get_json_path(&config, "plugins.entries.quickjs-demo.enabled"),
            Some(&Value::Bool(true))
        );
        assert!(get_json_path(&config, "plugins.entries.quickjs-demo.source").is_none());
        assert_eq!(
            get_json_path(&config, "plugins.installs.quickjs-demo.source").and_then(Value::as_str),
            Some("path")
        );
        assert_eq!(
            get_json_path(&config, "plugins.installs.quickjs-demo.sourcePath")
                .and_then(Value::as_str),
            Some(source_root.to_string_lossy().as_ref())
        );
        let listed = handle_gateway_method(&state, "plugins.list", json!({}))
            .await
            .expect("list plugins");
        let listed_plugin = listed["plugins"]
            .as_array()
            .expect("plugins")
            .iter()
            .find(|plugin| plugin["id"] == "quickjs-demo")
            .expect("installed plugin in list");
        assert_eq!(listed_plugin["name"], "QuickJS Demo");
        assert_eq!(listed_plugin["version"], "1.0.0");
        assert_eq!(listed_plugin["status"], "installed");
        assert_eq!(listed_plugin["origin"], "local");
        assert_eq!(listed_plugin["installSource"], "path");
        assert_eq!(
            listed_plugin["sourcePath"],
            source_root.to_string_lossy().as_ref()
        );
        assert_eq!(
            listed_plugin["manifestPath"],
            installed_root
                .join("crawclaw.plugin.json")
                .to_string_lossy()
                .as_ref()
        );

        write_json_file(
            &source_root.join("crawclaw.plugin.json"),
            &json!({
                "id": "quickjs-demo",
                "name": "QuickJS Demo",
                "version": "1.1.0",
                "main": "index.mjs"
            }),
        )
        .expect("update source manifest");
        let updated =
            handle_gateway_method(&state, "plugins.update", json!({ "id": "quickjs-demo" }))
                .await
                .expect("update local plugin");
        assert_eq!(updated["ok"], true);
        assert_eq!(updated["changed"], true);
        assert_eq!(updated["requiresRestart"], true);
        assert_eq!(updated["outcomes"][0]["status"], "updated");
        assert_eq!(updated["outcomes"][0]["currentVersion"], "1.0.0");
        assert_eq!(updated["outcomes"][0]["nextVersion"], "1.1.0");
        let installed_manifest =
            read_json_file(&installed_root.join("crawclaw.plugin.json")).expect("manifest");
        assert_eq!(installed_manifest["version"], "1.1.0");

        let uninstalled =
            handle_gateway_method(&state, "plugins.uninstall", json!({ "id": "quickjs-demo" }))
                .await
                .expect("uninstall local plugin");
        assert_eq!(uninstalled["ok"], true);
        assert_eq!(uninstalled["pluginId"], "quickjs-demo");
        assert!(!installed_root.exists());
        let config = read_config_value(&config_path(&state)).expect("read config");
        assert!(get_json_path(&config, "plugins.entries.quickjs-demo").is_none());
        assert!(get_json_path(&config, "plugins.installs.quickjs-demo").is_none());

        let _ = std::fs::remove_dir_all(runtime_root);
        let _ = std::fs::remove_dir_all(source_root);
    }

    #[tokio::test]
    async fn rust_gateway_plugins_install_resolves_bundled_plugin_id() {
        let _guard = env_lock().lock().expect("env lock");
        let runtime_root = unique_test_runtime_root("gateway-plugin-bundled-install-runtime");
        let state = GatewayState::new(GatewayRunConfig {
            runtime_root: Some(runtime_root.clone()),
            ..GatewayRunConfig::default()
        });

        let installed =
            handle_gateway_method(&state, "plugins.install", json!({ "pluginId": "fal" }))
                .await
                .expect("install bundled plugin");
        assert_eq!(installed["ok"], true);
        assert_eq!(installed["pluginId"], "fal");
        assert_eq!(installed["installSource"], "bundled");
        assert_eq!(
            installed["manifest"]["providerAuthEnvVars"]["fal"],
            json!(["FAL_KEY"])
        );
        assert!(runtime_root.join("plugins/fal/index.ts").exists());

        let config = read_config_value(&config_path(&state)).expect("read config");
        assert_eq!(
            get_json_path(&config, "plugins.installs.fal.source").and_then(Value::as_str),
            Some("bundled")
        );
        assert!(get_json_path(&config, "plugins.installs.fal.sourcePath")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .ends_with("extensions/fal"));

        let _ = std::fs::remove_dir_all(runtime_root);
    }

    #[tokio::test]
    async fn rust_gateway_plugins_install_update_npm_file_spec() {
        let _guard = env_lock().lock().expect("env lock");
        if Command::new("npm").arg("--version").output().is_err() {
            return;
        }
        let runtime_root = unique_test_runtime_root("gateway-plugin-npm-runtime");
        let source_root = unique_test_runtime_root("gateway-plugin-npm-source");
        let state = GatewayState::new(GatewayRunConfig {
            runtime_root: Some(runtime_root.clone()),
            ..GatewayRunConfig::default()
        });
        std::fs::create_dir_all(&source_root).expect("create npm package source");
        write_json_file(
            &source_root.join("package.json"),
            &json!({
                "name": "npm-demo",
                "version": "1.0.0",
                "crawclaw": {
                    "extensions": ["index.mjs"]
                }
            }),
        )
        .expect("write package");
        std::fs::write(source_root.join("index.mjs"), "export default {};\n")
            .expect("write source entrypoint");
        let spec = format!("file:{}", source_root.to_string_lossy());

        let installed = handle_gateway_method(&state, "plugins.install", json!({ "raw": spec }))
            .await
            .expect("install npm file spec");
        assert_eq!(installed["ok"], true);
        assert_eq!(installed["pluginId"], "npm-demo");
        assert_eq!(installed["installSource"], "npm");
        let installed_root = runtime_root.join("plugins/npm-demo");
        assert!(installed_root.join("package.json").exists());
        assert!(installed_root.join("crawclaw.plugin.json").exists());

        let config = read_config_value(&config_path(&state)).expect("read config");
        assert_eq!(
            get_json_path(&config, "plugins.installs.npm-demo.source").and_then(Value::as_str),
            Some("npm")
        );
        assert_eq!(
            get_json_path(&config, "plugins.installs.npm-demo.resolvedName")
                .and_then(Value::as_str),
            Some("npm-demo")
        );
        assert!(get_json_path(&config, "plugins.installs.npm-demo.integrity").is_some());

        write_json_file(
            &source_root.join("package.json"),
            &json!({
                "name": "npm-demo",
                "version": "1.1.0",
                "crawclaw": {
                    "extensions": ["index.mjs"]
                }
            }),
        )
        .expect("update package");
        let updated = handle_gateway_method(
            &state,
            "plugins.update",
            json!({ "id": "npm-demo", "force": true }),
        )
        .await
        .expect("update npm file spec");
        assert_eq!(updated["ok"], true);
        assert_eq!(updated["changed"], true);
        assert_eq!(updated["outcomes"][0]["status"], "updated");
        assert_eq!(updated["outcomes"][0]["currentVersion"], "1.0.0");
        assert_eq!(updated["outcomes"][0]["nextVersion"], "1.1.0");
        let installed_manifest =
            read_json_file(&installed_root.join("crawclaw.plugin.json")).expect("manifest");
        assert_eq!(installed_manifest["version"], "1.1.0");

        let _ = std::fs::remove_dir_all(runtime_root);
        let _ = std::fs::remove_dir_all(source_root);
    }

    #[tokio::test]
    async fn rust_gateway_plugins_install_local_marketplace() {
        let _guard = env_lock().lock().expect("env lock");
        let runtime_root = unique_test_runtime_root("gateway-plugin-marketplace-runtime");
        let marketplace_root = unique_test_runtime_root("gateway-plugin-marketplace-source");
        let plugin_root = marketplace_root.join("plugins/market-demo");
        let state = GatewayState::new(GatewayRunConfig {
            runtime_root: Some(runtime_root.clone()),
            ..GatewayRunConfig::default()
        });
        std::fs::create_dir_all(&plugin_root).expect("create marketplace plugin");
        write_json_file(
            &marketplace_root.join("marketplace.json"),
            &json!({
                "name": "Local Marketplace",
                "plugins": [
                    {
                        "name": "market-demo",
                        "version": "2.0.0",
                        "source": "plugins/market-demo"
                    }
                ]
            }),
        )
        .expect("write marketplace");
        write_json_file(
            &plugin_root.join("crawclaw.plugin.json"),
            &json!({
                "id": "market-demo",
                "name": "Market Demo",
                "version": "2.0.0"
            }),
        )
        .expect("write plugin manifest");

        let installed = handle_gateway_method(
            &state,
            "plugins.install",
            json!({
                "marketplaceSource": marketplace_root.to_string_lossy(),
                "marketplacePlugin": "market-demo"
            }),
        )
        .await
        .expect("install marketplace plugin");
        assert_eq!(installed["ok"], true);
        assert_eq!(installed["pluginId"], "market-demo");
        assert_eq!(installed["installSource"], "marketplace");

        let config = read_config_value(&config_path(&state)).expect("read config");
        assert_eq!(
            get_json_path(&config, "plugins.installs.market-demo.source").and_then(Value::as_str),
            Some("marketplace")
        );
        assert_eq!(
            get_json_path(&config, "plugins.installs.market-demo.marketplacePlugin")
                .and_then(Value::as_str),
            Some("market-demo")
        );

        let _ = std::fs::remove_dir_all(runtime_root);
        let _ = std::fs::remove_dir_all(marketplace_root);
    }

    #[tokio::test]
    async fn rust_gateway_approval_methods_track_pending_decisions() {
        let _guard = env_lock().lock().expect("env lock");
        let runtime_root = unique_test_runtime_root("gateway-approvals");
        let state = GatewayState::new(GatewayRunConfig {
            runtime_root: Some(runtime_root.clone()),
            ..GatewayRunConfig::default()
        });

        let requested = handle_gateway_method(
            &state,
            "exec.approval.request",
            json!({
                "id": "approval-1",
                "command": "pnpm test",
                "twoPhase": true
            }),
        )
        .await
        .expect("exec approval request");
        assert_eq!(requested["status"], "accepted");
        assert_eq!(requested["id"], "approval-1");
        assert!(requested["createdAtMs"].as_u64().is_some());
        assert!(requested["expiresAtMs"].as_u64().is_some());

        let resolved = handle_gateway_method(
            &state,
            "exec.approval.resolve",
            json!({ "id": "approval-1", "decision": "allow-once" }),
        )
        .await
        .expect("exec approval resolve");
        assert_eq!(resolved["ok"], true);

        let waited = handle_gateway_method(
            &state,
            "exec.approval.waitDecision",
            json!({ "id": "approval-1" }),
        )
        .await
        .expect("exec approval wait");
        assert_eq!(waited["id"], "approval-1");
        assert_eq!(waited["decision"], "allow-once");
        assert!(waited["createdAtMs"].as_u64().is_some());
        assert!(waited["expiresAtMs"].as_u64().is_some());

        let plugin_requested = handle_gateway_method(
            &state,
            "plugin.approval.request",
            json!({
                "pluginId": "local-plugin",
                "title": "Run plugin tool",
                "description": "Plugin wants to call a write tool.",
                "twoPhase": true
            }),
        )
        .await
        .expect("plugin approval request");
        assert_eq!(plugin_requested["status"], "accepted");
        let plugin_id = plugin_requested["id"]
            .as_str()
            .expect("plugin approval id")
            .to_string();
        assert!(plugin_id.starts_with("plugin:"));

        handle_gateway_method(
            &state,
            "plugin.approval.resolve",
            json!({ "id": plugin_id, "decision": "deny" }),
        )
        .await
        .expect("plugin approval resolve");
        let plugin_waited = handle_gateway_method(
            &state,
            "plugin.approval.waitDecision",
            json!({ "id": plugin_requested["id"] }),
        )
        .await
        .expect("plugin approval wait");
        assert_eq!(plugin_waited["decision"], "deny");

        let missing = handle_gateway_method(
            &state,
            "exec.approval.waitDecision",
            json!({ "id": "missing-approval" }),
        )
        .await;
        assert!(missing
            .expect_err("missing approval should fail")
            .contains("approval expired or not found"));

        let _ = std::fs::remove_dir_all(runtime_root);
    }

    #[tokio::test]
    async fn rust_gateway_identity_get_reads_and_repairs_device_identity() {
        let _guard = env_lock().lock().expect("env lock");
        let previous_state_dir = env::var_os("CRAWCLAW_STATE_DIR");
        let runtime_root = unique_test_runtime_root("gateway-identity-runtime");
        let state_dir = unique_test_runtime_root("gateway-identity-state");
        env::set_var("CRAWCLAW_STATE_DIR", &state_dir);
        std::fs::create_dir_all(state_dir.join("identity")).expect("create identity dir");
        let public_key_pem = [
            "-----BEGIN PUBLIC KEY-----",
            "MCowBQYDK2VwAyEAAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE=",
            "-----END PUBLIC KEY-----",
            "",
        ]
        .join("\n");
        write_json_file(
            &state_dir.join("identity/device.json"),
            &json!({
                "version": 1,
                "deviceId": "stale-device-id",
                "publicKeyPem": public_key_pem,
                "privateKeyPem": "test-private-key",
                "createdAtMs": 1
            }),
        )
        .expect("write identity");
        let state = GatewayState::new(GatewayRunConfig {
            runtime_root: Some(runtime_root.clone()),
            ..GatewayRunConfig::default()
        });

        let identity = handle_gateway_method(&state, "gateway.identity.get", json!({}))
            .await
            .expect("gateway identity");

        assert_eq!(
            identity["deviceId"],
            "72cd6e8422c407fb6d098690f1130b7ded7ec2f7f5e1d30bd9d521f015363793"
        );
        assert_eq!(
            identity["publicKey"],
            "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE"
        );
        let stored =
            read_config_value(&state_dir.join("identity/device.json")).expect("read identity");
        assert_eq!(stored["deviceId"], identity["deviceId"]);

        match previous_state_dir {
            Some(value) => env::set_var("CRAWCLAW_STATE_DIR", value),
            None => env::remove_var("CRAWCLAW_STATE_DIR"),
        }
        let _ = std::fs::remove_dir_all(runtime_root);
        let _ = std::fs::remove_dir_all(state_dir);
    }

    #[tokio::test]
    async fn rust_gateway_wizard_methods_track_session_state() {
        let _guard = env_lock().lock().expect("env lock");
        let runtime_root = unique_test_runtime_root("gateway-wizard");
        let state = GatewayState::new(GatewayRunConfig {
            runtime_root: Some(runtime_root.clone()),
            ..GatewayRunConfig::default()
        });

        let started = handle_gateway_method(&state, "wizard.start", json!({ "mode": "local" }))
            .await
            .expect("wizard start");
        assert_eq!(started["status"], "running");
        assert_eq!(started["done"], false);
        assert_eq!(started["step"]["type"], "note");
        let session_id = started["sessionId"].as_str().expect("session id");
        let step_id = started["step"]["id"].as_str().expect("step id");

        let status =
            handle_gateway_method(&state, "wizard.status", json!({ "sessionId": session_id }))
                .await
                .expect("wizard status");
        assert_eq!(status["status"], "running");
        assert!(status["error"].is_null());

        let completed = handle_gateway_method(
            &state,
            "wizard.next",
            json!({
                "sessionId": session_id,
                "answer": { "stepId": step_id, "value": true }
            }),
        )
        .await
        .expect("wizard next");
        assert_eq!(completed["done"], true);
        assert_eq!(completed["status"], "done");

        let missing =
            handle_gateway_method(&state, "wizard.status", json!({ "sessionId": session_id }))
                .await;
        assert!(missing
            .expect_err("completed wizard should be purged")
            .contains("wizard not found"));

        let cancel_started =
            handle_gateway_method(&state, "wizard.start", json!({ "mode": "local" }))
                .await
                .expect("wizard start for cancel");
        let cancel_session_id = cancel_started["sessionId"].as_str().expect("session id");
        let cancelled = handle_gateway_method(
            &state,
            "wizard.cancel",
            json!({ "sessionId": cancel_session_id }),
        )
        .await
        .expect("wizard cancel");
        assert_eq!(cancelled["status"], "cancelled");
        assert_eq!(cancelled["error"], "cancelled");

        let _ = std::fs::remove_dir_all(runtime_root);
    }

    #[tokio::test]
    async fn rust_gateway_agent_runtime_reports_session_store_state() {
        let _guard = env_lock().lock().expect("env lock");
        let runtime_root = unique_test_runtime_root("gateway-agent-runtime-state");
        let state = GatewayState::new(GatewayRunConfig {
            runtime_root: Some(runtime_root.clone()),
            ..GatewayRunConfig::default()
        });

        handle_gateway_method(
            &state,
            "sessions.create",
            json!({ "key": "main", "label": "Main Agent" }),
        )
        .await
        .expect("create main session");
        handle_gateway_method(
            &state,
            "sessions.patch",
            json!({ "key": "agent:main:main", "status": "running" }),
        )
        .await
        .expect("mark main running");
        let spawned = handle_gateway_method(
            &state,
            "sessions.spawn",
            json!({
                "parentSessionKey": "agent:main:main",
                "label": "Review worker",
                "task": "review the gateway state"
            }),
        )
        .await
        .expect("spawn subagent session");
        let spawned_key = spawned["session"]["key"].as_str().expect("spawned key");

        let summary = handle_gateway_method(&state, "agentRuntime.summary", json!({}))
            .await
            .expect("runtime summary");
        assert_eq!(summary["running"], 1);
        assert_eq!(summary["waiting"], 1);
        assert_eq!(summary["completed"], 0);
        assert_eq!(summary["byCategory"]["cli"], 1);
        assert_eq!(summary["byCategory"]["subagents"], 1);

        let list = handle_gateway_method(&state, "agentRuntime.list", json!({ "limit": 10 }))
            .await
            .expect("runtime list");
        assert_eq!(list["count"], 2);
        assert!(list["runs"]
            .as_array()
            .expect("runs")
            .iter()
            .any(|run| run["taskId"] == spawned_key && run["category"] == "subagents"));

        let detail =
            handle_gateway_method(&state, "agentRuntime.get", json!({ "taskId": spawned_key }))
                .await
                .expect("runtime get");
        assert_eq!(detail["run"]["taskId"], spawned_key);
        assert_eq!(detail["run"]["status"], "spawned");
        assert_eq!(detail["availableActions"]["openSession"], true);
        assert_eq!(detail["availableActions"]["cancel"], true);

        let inspection =
            handle_gateway_method(&state, "agent.inspect", json!({ "runId": spawned_key }))
                .await
                .expect("agent inspect");
        assert_eq!(inspection["runId"], spawned_key);
        assert_eq!(inspection["taskId"], spawned_key);
        assert_eq!(inspection["run"]["category"], "subagents");
        assert_eq!(inspection["refs"]["transcriptRef"], spawned_key);

        let waited = handle_gateway_method(&state, "agent.wait", json!({ "runId": spawned_key }))
            .await
            .expect("agent wait");
        assert_eq!(waited["runId"], spawned_key);
        assert_eq!(waited["status"], "running");

        let missing = handle_gateway_method(
            &state,
            "agentRuntime.get",
            json!({ "taskId": "missing-runtime-task" }),
        )
        .await;
        assert!(missing
            .expect_err("missing runtime task should fail")
            .contains("Task not found: missing-runtime-task"));

        let _ = std::fs::remove_dir_all(runtime_root);
    }

    #[tokio::test]
    async fn rust_gateway_update_run_reports_git_state_instead_of_noop() {
        let _guard = env_lock().lock().expect("env lock");
        let runtime_root = unique_test_runtime_root("gateway-update-run-state");
        std::fs::create_dir_all(&runtime_root).expect("create update root");
        run_git_test_command(&runtime_root, &["init", "-q"]);
        run_git_test_command(&runtime_root, &["config", "user.email", "test@example.com"]);
        run_git_test_command(&runtime_root, &["config", "user.name", "Test User"]);
        std::fs::write(
            runtime_root.join("package.json"),
            "{\"name\":\"crawclaw\",\"version\":\"0.0.0\"}\n",
        )
        .expect("write package");
        run_git_test_command(&runtime_root, &["add", "package.json"]);
        run_git_test_command(&runtime_root, &["commit", "-q", "-m", "init"]);

        let state = GatewayState::new(GatewayRunConfig {
            runtime_root: Some(runtime_root.clone()),
            ..GatewayRunConfig::default()
        });
        let update = handle_gateway_method(&state, "update.run", json!({}))
            .await
            .expect("update run");

        assert_eq!(update["ok"], true);
        assert_ne!(update["status"], "noop");
        assert_eq!(update["result"]["status"], "skipped");
        assert_eq!(update["result"]["mode"], "git");
        assert_eq!(update["result"]["reason"], "no-upstream");
        assert!(update["result"]["steps"]
            .as_array()
            .expect("steps")
            .iter()
            .any(|step| step["name"] == "clean check"));

        let _ = std::fs::remove_dir_all(runtime_root);
    }

    #[tokio::test]
    async fn rust_gateway_replaces_high_priority_placeholders_with_local_results() {
        let _guard = env_lock().lock().expect("env lock");
        let runtime_root = unique_test_runtime_root("gateway-high-priority-placeholders");
        let state = GatewayState::new(GatewayRunConfig {
            runtime_root: Some(runtime_root.clone()),
            ..GatewayRunConfig::default()
        });

        handle_gateway_method(
            &state,
            "sessions.create",
            json!({ "key": "main", "label": "Rust Main" }),
        )
        .await
        .expect("create runtime session");
        let runtime_task =
            handle_gateway_method(&state, "agentRuntime.get", json!({ "taskId": "main" }))
                .await
                .expect("agent runtime get");
        assert_eq!(runtime_task["run"]["taskId"], "agent:main:main");
        assert_eq!(runtime_task["run"]["runtime"], "desktop-session");
        assert_eq!(runtime_task["availableActions"]["openSession"], true);

        let installed_skill = handle_gateway_method(
            &state,
            "skills.install",
            json!({
                "skillKey": "local-skill",
                "content": "---\nname: local-skill\n---\n# Local Skill\n"
            }),
        )
        .await
        .expect("install skill");
        assert_eq!(installed_skill["ok"], true);
        assert!(runtime_root.join("skills/local-skill/SKILL.md").exists());
        let skills = handle_gateway_method(&state, "skills.status", json!({}))
            .await
            .expect("skills status");
        assert!(skills["skills"]
            .as_array()
            .expect("skills")
            .iter()
            .any(|skill| skill["skillKey"] == "local-skill"));

        let installed_plugin = handle_gateway_method(
            &state,
            "plugins.install",
            json!({
                "pluginId": "local-plugin",
                "manifest": {
                    "id": "local-plugin",
                    "name": "Local Plugin",
                    "version": "0.0.0"
                }
            }),
        )
        .await
        .expect("install plugin");
        assert_eq!(installed_plugin["ok"], true);
        assert!(runtime_root
            .join("plugins/local-plugin/crawclaw.plugin.json")
            .exists());

        let tts = handle_gateway_method(&state, "tts.convert", json!({ "text": "hello" }))
            .await
            .expect("tts convert");
        assert_eq!(tts["status"], "prepared");

        let talk = handle_gateway_method(&state, "talk.speak", json!({ "text": "hello" }))
            .await
            .expect("talk speak");
        assert_eq!(talk["ok"], true);

        let send = handle_gateway_method(
            &state,
            "send",
            json!({ "channel": "weixin", "to": "filehelper", "text": "hello" }),
        )
        .await
        .expect("send");
        assert_eq!(send["deliveryStatus"], "blocked");
        assert_eq!(send["sent"], false);

        let rotated = handle_gateway_method(
            &state,
            "device.token.rotate",
            json!({ "deviceId": "device-1" }),
        )
        .await
        .expect("rotate token");
        assert_eq!(rotated["ok"], true);
        assert!(rotated["deviceToken"]
            .as_str()
            .unwrap_or_default()
            .starts_with("rust-device-"));

        let esp32 = handle_gateway_method(
            &state,
            "esp32.devices.get",
            json!({ "deviceId": "esp32-1" }),
        )
        .await
        .expect("esp32 get");
        assert_eq!(esp32["status"], "not_found");

        let esp32_command = handle_gateway_method(
            &state,
            "esp32.devices.command.send",
            json!({ "deviceId": "esp32-1", "command": "ping" }),
        )
        .await
        .expect("esp32 command");
        assert_eq!(esp32_command["status"], "queued");

        let workflow_root = runtime_root.join("workflows");
        std::fs::create_dir_all(workflow_root.join("specs")).expect("create workflow root");
        write_json_file(
            &workflow_root.join("registry.json"),
            &json!({
                "version": 1,
                "workflows": [{
                    "workflowId": "daily-check",
                    "name": "Daily Check",
                    "enabled": true,
                    "deploymentState": "deployed",
                    "safeForAutoRun": true,
                    "createdAt": 1,
                    "updatedAt": 1
                }]
            }),
        )
        .expect("write workflow registry");
        write_json_file(
            &workflow_root.join("specs/daily-check.json"),
            &json!({
                "workflowId": "daily-check",
                "name": "Daily Check",
                "goal": "summarize local state",
                "steps": [{"id": "draft", "kind": "crawclaw_agent"}]
            }),
        )
        .expect("write workflow spec");
        write_json_file(
            &workflow_root.join("executions.json"),
            &json!({
                "version": 1,
                "executions": [{
                    "executionId": "exec-daily-check",
                    "workflowId": "daily-check",
                    "workflowName": "Daily Check",
                    "status": "running",
                    "steps": [{
                        "stepId": "draft",
                        "status": "running",
                        "executor": "crawclaw_agent"
                    }]
                }]
            }),
        )
        .expect("write workflow executions");

        let workflow =
            handle_gateway_method(&state, "workflow.get", json!({ "workflow": "daily-check" }))
                .await
                .expect("workflow get");
        assert_eq!(workflow["workflow"]["workflowId"], "daily-check");

        let workflow_agent = handle_gateway_method(
            &state,
            "workflow.agent.run",
            json!({
                "workflow": "daily-check",
                "executionId": "exec-daily-check",
                "stepId": "draft",
                "goal": "summarize local state"
            }),
        )
        .await
        .expect("workflow agent run");
        assert_eq!(workflow_agent["status"], "running");
        assert!(workflow_agent["session"]["key"].is_string());

        let _ = std::fs::remove_dir_all(runtime_root);
    }

    #[tokio::test]
    async fn rust_gateway_tts_methods_report_native_provider_catalog() {
        let _guard = env_lock().lock().expect("env lock");
        let runtime_root = unique_test_runtime_root("gateway-tts-provider-catalog");
        let state = GatewayState::new(GatewayRunConfig {
            runtime_root: Some(runtime_root.clone()),
            ..GatewayRunConfig::default()
        });

        handle_gateway_method(
            &state,
            "config.patch",
            json!({
                "patch": {
                    "messages": {
                        "tts": {
                            "providers": {
                                "qwen3-tts": { "enabled": true }
                            }
                        }
                    }
                }
            }),
        )
        .await
        .expect("enable qwen3 tts");

        let providers = handle_gateway_method(&state, "tts.providers", json!({}))
            .await
            .expect("tts providers");
        let qwen = providers["providers"]
            .as_array()
            .expect("providers")
            .iter()
            .find(|provider| provider["id"] == "qwen3-tts")
            .expect("qwen3 provider");
        assert_eq!(qwen["name"], "Qwen3-TTS (local)");
        assert_eq!(qwen["configured"], true);
        assert!(qwen["models"]
            .as_array()
            .expect("models")
            .iter()
            .any(|model| model == "Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice"));
        assert!(qwen["voices"]
            .as_array()
            .expect("voices")
            .iter()
            .any(|voice| voice == "serena"));

        let invalid = handle_gateway_method(
            &state,
            "tts.setProvider",
            json!({ "provider": "missing-provider" }),
        )
        .await;
        assert!(invalid
            .expect_err("invalid provider should fail")
            .contains("Invalid provider"));

        let selected = handle_gateway_method(
            &state,
            "tts.setProvider",
            json!({ "provider": "qwen3-tts" }),
        )
        .await
        .expect("set provider");
        assert_eq!(selected["provider"], "qwen3-tts");

        let status = handle_gateway_method(&state, "tts.status", json!({}))
            .await
            .expect("tts status");
        assert_eq!(status["provider"], "qwen3-tts");
        assert!(status["providerStates"]
            .as_array()
            .expect("provider states")
            .iter()
            .any(|provider| provider["id"] == "qwen3-tts" && provider["configured"] == true));

        let _ = std::fs::remove_dir_all(runtime_root);
    }

    #[tokio::test]
    async fn rust_gateway_system_event_updates_presence_snapshot() {
        let _guard = env_lock().lock().expect("env lock");
        let runtime_root = unique_test_runtime_root("gateway-system-presence");
        let state = GatewayState::new(GatewayRunConfig {
            runtime_root: Some(runtime_root.clone()),
            ..GatewayRunConfig::default()
        });

        let initial_presence = handle_gateway_method(&state, "system-presence", json!({}))
            .await
            .expect("initial system presence");
        assert!(initial_presence
            .as_array()
            .expect("initial presence array")
            .iter()
            .any(|entry| entry["mode"] == "gateway" && entry["reason"] == "self"));
        assert!(hello_ok(&state)["snapshot"]["presence"]
            .as_array()
            .expect("hello presence array")
            .iter()
            .any(|entry| entry["mode"] == "gateway" && entry["reason"] == "self"));

        let missing = handle_gateway_method(&state, "system-event", json!({})).await;
        assert!(missing
            .expect_err("empty system-event should fail")
            .contains("text required"));

        let event = handle_gateway_method(
            &state,
            "system-event",
            json!({
                "text": "desktop awake",
                "deviceId": "device-1",
                "host": "macbook",
                "ip": "100.64.0.2",
                "version": "2026.5.3",
                "mode": "desktop",
                "reason": "active",
                "lastInputSeconds": 4,
                "roles": ["desktop"],
                "scopes": ["operator.admin"]
            }),
        )
        .await
        .expect("system event");
        assert_eq!(event["ok"], true);

        let presence = handle_gateway_method(&state, "system-presence", json!({}))
            .await
            .expect("system presence");
        let entries = presence.as_array().expect("presence array");
        let entry = entries
            .iter()
            .find(|entry| entry["deviceId"] == "device-1")
            .expect("device presence");
        assert_eq!(entry["host"], "macbook");
        assert_eq!(entry["ip"], "100.64.0.2");
        assert_eq!(entry["mode"], "desktop");
        assert_eq!(entry["lastInputSeconds"], 4);
        assert_eq!(entry["roles"][0], "desktop");

        let _ = std::fs::remove_dir_all(runtime_root);
    }

    #[tokio::test]
    async fn rust_gateway_device_pairing_tracks_local_state_files() {
        let _guard = env_lock().lock().expect("env lock");
        let previous_state_dir = env::var_os("CRAWCLAW_STATE_DIR");
        let runtime_root = unique_test_runtime_root("gateway-device-pairing-runtime");
        let state_dir = unique_test_runtime_root("gateway-device-pairing-state");
        env::set_var("CRAWCLAW_STATE_DIR", &state_dir);
        std::fs::create_dir_all(state_dir.join("devices")).expect("create devices dir");
        let now = now_millis() as u64;
        write_json_file(
            &state_dir.join("devices/pending.json"),
            &json!({
                "req-1": {
                    "requestId": "req-1",
                    "deviceId": "device-1",
                    "publicKey": "public-key",
                    "displayName": "Phone",
                    "role": "operator",
                    "roles": ["operator"],
                    "scopes": ["operator.read"],
                    "ts": now
                }
            }),
        )
        .expect("write pending");
        write_json_file(
            &state_dir.join("devices/paired.json"),
            &json!({
                "device-2": {
                    "deviceId": "device-2",
                    "publicKey": "paired-key",
                    "displayName": "Tablet",
                    "role": "operator",
                    "roles": ["operator"],
                    "scopes": ["operator.read"],
                    "approvedScopes": ["operator.read"],
                    "tokens": {
                        "operator": {
                            "token": "secret-token",
                            "role": "operator",
                            "scopes": ["operator.read"],
                            "createdAtMs": 123
                        }
                    },
                    "createdAtMs": now - 2,
                    "approvedAtMs": now - 1
                }
            }),
        )
        .expect("write paired");

        let state = GatewayState::new(GatewayRunConfig {
            runtime_root: Some(runtime_root.clone()),
            ..GatewayRunConfig::default()
        });

        let listed = handle_gateway_method(&state, "device.pair.list", json!({}))
            .await
            .expect("list pairings");
        assert_eq!(listed["pending"][0]["requestId"], "req-1");
        assert_eq!(listed["paired"][0]["deviceId"], "device-2");
        assert!(listed["paired"][0].get("approvedScopes").is_none());
        assert_eq!(listed["paired"][0]["tokens"][0]["role"], "operator");
        assert!(listed["paired"][0]["tokens"][0].get("token").is_none());

        let approved = handle_gateway_method(
            &state,
            "device.pair.approve",
            json!({ "requestId": "req-1", "callerScopes": ["operator.read"] }),
        )
        .await
        .expect("approve pairing");
        assert_eq!(approved["requestId"], "req-1");
        assert_eq!(approved["device"]["deviceId"], "device-1");
        assert_eq!(approved["device"]["tokens"][0]["role"], "operator");
        assert!(approved["device"]["tokens"][0].get("token").is_none());

        let listed = handle_gateway_method(&state, "device.pair.list", json!({}))
            .await
            .expect("list after approve");
        assert!(listed["pending"].as_array().expect("pending").is_empty());
        assert!(listed["paired"]
            .as_array()
            .expect("paired")
            .iter()
            .any(|device| device["deviceId"] == "device-1"));

        let rotated = handle_gateway_method(
            &state,
            "device.token.rotate",
            json!({ "deviceId": "device-2", "role": "operator", "scopes": ["operator.read"] }),
        )
        .await
        .expect("rotate paired device token");
        assert_eq!(rotated["deviceId"], "device-2");
        assert_eq!(rotated["role"], "operator");
        assert_eq!(rotated["scopes"][0], "operator.read");
        assert!(rotated["token"]
            .as_str()
            .unwrap_or_default()
            .starts_with("rust-device-token-operator-"));

        let revoked = handle_gateway_method(
            &state,
            "device.token.revoke",
            json!({ "deviceId": "device-2", "role": "operator" }),
        )
        .await
        .expect("revoke paired device token");
        assert_eq!(revoked["deviceId"], "device-2");
        assert_eq!(revoked["role"], "operator");
        assert!(revoked["revokedAtMs"].as_u64().unwrap_or_default() >= now);

        let listed = handle_gateway_method(&state, "device.pair.list", json!({}))
            .await
            .expect("list after token revoke");
        let revoked_device = listed["paired"]
            .as_array()
            .expect("paired")
            .iter()
            .find(|device| device["deviceId"] == "device-2")
            .expect("revoked device");
        assert!(revoked_device["tokens"][0].get("token").is_none());
        assert!(
            revoked_device["tokens"][0]["revokedAtMs"]
                .as_u64()
                .unwrap_or_default()
                >= now
        );

        write_json_file(
            &state_dir.join("devices/pending.json"),
            &json!({
                "req-2": {
                    "requestId": "req-2",
                    "deviceId": "device-3",
                    "publicKey": "public-key-3",
                    "ts": now
                }
            }),
        )
        .expect("write reject pending");
        let rejected = handle_gateway_method(
            &state,
            "device.pair.reject",
            json!({ "requestId": "req-2" }),
        )
        .await
        .expect("reject pairing");
        assert_eq!(rejected["requestId"], "req-2");
        assert_eq!(rejected["deviceId"], "device-3");

        let removed = handle_gateway_method(
            &state,
            "device.pair.remove",
            json!({ "deviceId": "device-2" }),
        )
        .await
        .expect("remove paired device");
        assert_eq!(removed["deviceId"], "device-2");

        match previous_state_dir {
            Some(value) => env::set_var("CRAWCLAW_STATE_DIR", value),
            None => env::remove_var("CRAWCLAW_STATE_DIR"),
        }
        let _ = std::fs::remove_dir_all(runtime_root);
        let _ = std::fs::remove_dir_all(state_dir);
    }

    #[tokio::test]
    async fn rust_gateway_esp32_methods_track_local_state_files() {
        let _guard = env_lock().lock().expect("env lock");
        let previous_state_dir = env::var_os("CRAWCLAW_STATE_DIR");
        let runtime_root = unique_test_runtime_root("gateway-esp32-runtime");
        let state_dir = unique_test_runtime_root("gateway-esp32-state");
        env::set_var("CRAWCLAW_STATE_DIR", &state_dir);
        std::fs::create_dir_all(state_dir.join("devices")).expect("create devices dir");
        std::fs::create_dir_all(state_dir.join("esp32")).expect("create esp32 dir");
        let now = now_millis() as u64;
        write_json_file(
            &state_dir.join("crawclaw.json"),
            &json!({
                "plugins": {
                    "entries": {
                        "esp32": {
                            "enabled": true,
                            "config": {
                                "broker": {
                                    "bindHost": "0.0.0.0",
                                    "port": 1883,
                                    "advertisedHost": "127.0.0.1"
                                },
                                "udp": {
                                    "bindHost": "0.0.0.0",
                                    "port": 1884,
                                    "advertisedHost": "127.0.0.1"
                                },
                                "renderer": { "model": "openai/gpt-5.4-mini" },
                                "tools": { "allowlist": ["display.*"] }
                            }
                        }
                    }
                }
            }),
        )
        .expect("write config");
        write_json_file(
            &state_dir.join("devices/pending.json"),
            &json!({
                "req-esp32": {
                    "requestId": "req-esp32",
                    "deviceId": "esp32-2",
                    "publicKey": "fingerprint-2",
                    "displayName": "Desk Pending",
                    "role": "esp32",
                    "roles": ["esp32"],
                    "scopes": ["device.esp32"],
                    "deviceFamily": "ESP32-S3-BOX-3",
                    "clientMode": "mqtt-udp",
                    "ts": now
                },
                "req-other": {
                    "requestId": "req-other",
                    "deviceId": "other-1",
                    "publicKey": "other-key",
                    "deviceFamily": "other",
                    "clientMode": "other",
                    "ts": now - 1
                }
            }),
        )
        .expect("write pending");
        write_json_file(
            &state_dir.join("devices/paired.json"),
            &json!({
                "esp32-1": {
                    "deviceId": "esp32-1",
                    "publicKey": "fingerprint-1",
                    "displayName": "Desk",
                    "role": "esp32",
                    "roles": ["esp32"],
                    "scopes": ["device.esp32"],
                    "approvedScopes": ["device.esp32"],
                    "tokens": {
                        "esp32": {
                            "token": "secret-token",
                            "role": "esp32",
                            "scopes": ["device.esp32"],
                            "createdAtMs": 123
                        }
                    },
                    "deviceFamily": "ESP32-S3-BOX-3",
                    "clientMode": "mqtt-udp",
                    "createdAtMs": now - 2,
                    "approvedAtMs": now - 1
                }
            }),
        )
        .expect("write paired");
        write_json_file(
            &state_dir.join("esp32/devices.json"),
            &json!({
                "devices": {
                    "esp32-1": {
                        "deviceId": "esp32-1",
                        "name": "Stored Desk",
                        "fingerprint": "stored-fingerprint",
                        "capabilities": {
                            "hardwareTarget": "ESP32-S3-BOX-3",
                            "display": { "width": 320, "height": 240, "color": true }
                        },
                        "lastSeenAtMs": 300
                    }
                }
            }),
        )
        .expect("write esp32 devices");
        write_json_file(
            &state_dir.join("esp32/pairing-sessions.json"),
            &json!({
                "pair-1": {
                    "pairId": "pair-1",
                    "password": "secret-pair-code",
                    "name": "desk",
                    "hardwareTarget": "ESP32-S3-BOX-3",
                    "issuedAtMs": now - 10,
                    "expiresAtMs": now + 60_000
                },
                "expired": {
                    "pairId": "expired",
                    "password": "expired-code",
                    "hardwareTarget": "ESP32-S3-BOX-3",
                    "issuedAtMs": now - 20,
                    "expiresAtMs": now - 1
                }
            }),
        )
        .expect("write sessions");

        let state = GatewayState::new(GatewayRunConfig {
            runtime_root: Some(runtime_root.clone()),
            ..GatewayRunConfig::default()
        });

        let status = handle_gateway_method(&state, "esp32.status.get", json!({}))
            .await
            .expect("esp32 status");
        assert_eq!(status["enabled"], true);
        assert_eq!(status["serviceRunning"], false);
        assert_eq!(status["broker"]["advertisedHost"], "127.0.0.1");
        assert_eq!(status["counts"]["activePairingSessions"], 1);
        assert_eq!(status["counts"]["pendingRequests"], 1);
        assert_eq!(status["counts"]["pairedDevices"], 1);
        assert_eq!(
            status["activePairingSessions"][0]["username"],
            "pair:pair-1"
        );
        assert!(status["activePairingSessions"][0].get("password").is_none());

        let requests = handle_gateway_method(&state, "esp32.pairing.requests.list", json!({}))
            .await
            .expect("esp32 requests");
        assert_eq!(requests["items"].as_array().expect("items").len(), 1);
        assert_eq!(requests["items"][0]["requestId"], "req-esp32");

        let devices = handle_gateway_method(&state, "esp32.devices.list", json!({}))
            .await
            .expect("esp32 devices");
        assert_eq!(devices["items"].as_array().expect("items").len(), 1);
        assert_eq!(devices["items"][0]["deviceId"], "esp32-1");
        assert_eq!(devices["items"][0]["lastSeenAtMs"], 300);

        let device = handle_gateway_method(
            &state,
            "esp32.devices.get",
            json!({ "deviceId": "esp32-1" }),
        )
        .await
        .expect("esp32 get");
        assert_eq!(device["status"], "found");
        assert_eq!(device["paired"]["deviceId"], "esp32-1");
        assert!(device["paired"]["tokens"][0].get("token").is_none());

        let started = handle_gateway_method(
            &state,
            "esp32.pairing.start",
            json!({ "name": "new desk", "ttlMs": 60000 }),
        )
        .await
        .expect("start pairing");
        assert_eq!(
            started["username"],
            format!("pair:{}", started["pairId"].as_str().unwrap())
        );
        assert!(started["pairCode"]
            .as_str()
            .unwrap_or_default()
            .starts_with("rust-pair-code-"));
        assert_eq!(started["broker"]["host"], "127.0.0.1");
        let pair_id = started["pairId"].as_str().expect("pair id").to_string();

        let revoked = handle_gateway_method(
            &state,
            "esp32.pairing.session.revoke",
            json!({ "pairId": pair_id }),
        )
        .await
        .expect("revoke pairing session");
        assert_eq!(revoked["pairId"], started["pairId"]);

        let approved = handle_gateway_method(
            &state,
            "esp32.pairing.request.approve",
            json!({ "requestId": "req-esp32" }),
        )
        .await
        .expect("approve esp32 request");
        assert_eq!(approved["deviceId"], "esp32-2");

        let rejected = handle_gateway_method(
            &state,
            "esp32.pairing.request.reject",
            json!({ "requestId": "req-other" }),
        )
        .await
        .expect("reject non-esp32 request");
        assert_eq!(rejected["requestId"], "req-other");

        let removed = handle_gateway_method(
            &state,
            "esp32.devices.revoke",
            json!({ "deviceId": "esp32-1" }),
        )
        .await
        .expect("revoke esp32 device");
        assert_eq!(removed["deviceId"], "esp32-1");

        match previous_state_dir {
            Some(value) => env::set_var("CRAWCLAW_STATE_DIR", value),
            None => env::remove_var("CRAWCLAW_STATE_DIR"),
        }
        let _ = std::fs::remove_dir_all(runtime_root);
        let _ = std::fs::remove_dir_all(state_dir);
    }

    #[tokio::test]
    async fn rust_gateway_workflow_methods_track_local_registry() {
        let _guard = env_lock().lock().expect("env lock");
        let previous_state_dir = env::var_os("CRAWCLAW_STATE_DIR");
        let previous_n8n_base_url = env::var_os("CRAWCLAW_N8N_BASE_URL");
        let previous_n8n_api_key = env::var_os("CRAWCLAW_N8N_API_KEY");
        let runtime_root = unique_test_runtime_root("gateway-workflow-runtime");
        let workspace_dir = unique_test_runtime_root("gateway-workflow-workspace");
        let state_dir = unique_test_runtime_root("gateway-workflow-state");
        env::set_var("CRAWCLAW_STATE_DIR", &state_dir);
        env::remove_var("CRAWCLAW_N8N_BASE_URL");
        env::remove_var("CRAWCLAW_N8N_API_KEY");
        let root = workspace_dir.join(".crawclaw/workflows");
        std::fs::create_dir_all(root.join("specs")).expect("create workflow store");
        write_json_file(
            &root.join("registry.json"),
            &json!({
                "version": 1,
                "updatedAt": 200,
                "workflows": [
                    {
                        "workflowId": "daily-check",
                        "name": "Daily Check",
                        "description": "Daily ops check",
                        "scope": "workspace",
                        "target": "n8n",
                        "enabled": true,
                        "safeForAutoRun": true,
                        "requiresApproval": false,
                        "tags": ["ops"],
                        "specVersion": 1,
                        "deploymentVersion": 1,
                        "deploymentState": "deployed",
                        "n8nWorkflowId": "wf_remote",
                        "createdAt": 100,
                        "updatedAt": 200
                    },
                    {
                        "workflowId": "disabled-check",
                        "name": "Disabled Check",
                        "scope": "workspace",
                        "target": "n8n",
                        "enabled": false,
                        "safeForAutoRun": false,
                        "requiresApproval": false,
                        "tags": [],
                        "specVersion": 1,
                        "deploymentVersion": 0,
                        "deploymentState": "draft",
                        "createdAt": 100,
                        "updatedAt": 150
                    }
                ]
            }),
        )
        .expect("write registry");
        write_json_file(
            &root.join("specs/daily-check.json"),
            &json!({
                "workflowId": "daily-check",
                "name": "Daily Check",
                "goal": "Check daily ops",
                "steps": []
            }),
        )
        .expect("write spec");
        write_json_file(
            &root.join("executions.json"),
            &json!({
                "version": 1,
                "updatedAt": 300,
                "executions": [
                    {
                        "executionId": "exec-1",
                        "workflowId": "daily-check",
                        "workflowName": "Daily Check",
                        "status": "running",
                        "currentStepId": "draft",
                        "currentExecutor": "crawclaw_agent",
                        "steps": [
                            {
                                "stepId": "draft",
                                "title": "Draft content",
                                "status": "running",
                                "executor": "crawclaw_agent",
                                "startedAt": 250,
                                "updatedAt": 250
                            },
                            {
                                "stepId": "publish",
                                "title": "Publish",
                                "status": "pending",
                                "executor": "n8n",
                                "updatedAt": 250
                            }
                        ],
                        "startedAt": 250,
                        "updatedAt": 300
                    }
                ]
            }),
        )
        .expect("write executions");

        let state = GatewayState::new(GatewayRunConfig {
            runtime_root: Some(runtime_root.clone()),
            ..GatewayRunConfig::default()
        });
        let workspace = workspace_dir.to_string_lossy().to_string();

        let listed = handle_gateway_method(
            &state,
            "workflow.list",
            json!({ "workspaceDir": workspace }),
        )
        .await
        .expect("workflow list");
        assert_eq!(listed["count"], 1);
        assert_eq!(listed["workflows"][0]["workflowId"], "daily-check");
        assert_eq!(listed["workflows"][0]["runCount"], 1);
        assert_eq!(
            listed["workflows"][0]["invocation"]["recommendedAction"],
            "run"
        );

        let listed_all = handle_gateway_method(
            &state,
            "workflow.list",
            json!({ "workspaceDir": workspace, "includeDisabled": true }),
        )
        .await
        .expect("workflow list all");
        assert_eq!(listed_all["count"], 2);

        let details = handle_gateway_method(
            &state,
            "workflow.get",
            json!({ "workspaceDir": workspace, "workflow": "Daily Check" }),
        )
        .await
        .expect("workflow get");
        assert_eq!(details["workflow"]["workflowId"], "daily-check");
        assert_eq!(details["spec"]["goal"], "Check daily ops");
        assert_eq!(details["recentExecutions"][0]["executionId"], "exec-1");

        let missing_runtime = handle_gateway_method(
            &state,
            "workflow.run",
            json!({ "workspaceDir": workspace, "workflow": "daily-check" }),
        )
        .await;
        assert!(missing_runtime
            .expect_err("workflow.run should require n8n config")
            .contains("n8n is not configured"));

        env::set_var("CRAWCLAW_N8N_BASE_URL", "https://n8n.example.com/");
        env::set_var("CRAWCLAW_N8N_API_KEY", "test-n8n-key");

        for method in [
            "workflow.get",
            "workflow.run",
            "workflow.enable",
            "workflow.archive",
            "workflow.delete",
        ] {
            let missing = handle_gateway_method(
                &state,
                method,
                json!({ "workspaceDir": workspace, "workflow": "missing-workflow" }),
            )
            .await;
            assert!(missing
                .expect_err("missing workflow should fail")
                .contains("Workflow \"missing-workflow\" not found."));
        }

        let matched = handle_gateway_method(
            &state,
            "workflow.match",
            json!({ "workspaceDir": workspace, "query": "daily" }),
        )
        .await
        .expect("workflow match");
        assert_eq!(matched["count"], 1);
        assert_eq!(matched["matches"][0]["workflowId"], "daily-check");

        let disabled_run = handle_gateway_method(
            &state,
            "workflow.run",
            json!({ "workspaceDir": workspace, "workflow": "disabled-check" }),
        )
        .await;
        assert!(disabled_run
            .expect_err("disabled workflow should not run")
            .contains("disabled and cannot run"));

        let run = handle_gateway_method(
            &state,
            "workflow.run",
            json!({ "workspaceDir": workspace, "workflow": "daily-check" }),
        )
        .await
        .expect("workflow run");
        assert_eq!(run["execution"]["status"], "running");
        assert_eq!(run["execution"]["n8nWorkflowId"], "wf_remote");
        assert_eq!(run["execution"]["n8nBaseUrl"], "https://n8n.example.com");
        let execution_id = run["execution"]["executionId"]
            .as_str()
            .expect("execution id")
            .to_string();

        let status = handle_gateway_method(
            &state,
            "workflow.status",
            json!({ "workspaceDir": workspace, "executionId": execution_id }),
        )
        .await
        .expect("workflow status");
        assert_eq!(status["execution"]["status"], "running");
        assert_eq!(status["execution"]["n8nWorkflowId"], "wf_remote");

        let agent_run = handle_gateway_method(
            &state,
            "workflow.agent.run",
            json!({
                "workspaceDir": workspace,
                "workflowId": "daily-check",
                "executionId": "exec-1",
                "stepId": "draft",
                "goal": "Draft content"
            }),
        )
        .await
        .expect("workflow agent run");
        assert_eq!(agent_run["ok"], true);
        assert_eq!(agent_run["status"], "running");
        assert_eq!(agent_run["workflow"]["workflowId"], "daily-check");
        assert_eq!(agent_run["execution"]["executionId"], "exec-1");
        assert_eq!(agent_run["execution"]["steps"][0]["stepId"], "draft");
        assert_eq!(agent_run["execution"]["steps"][0]["status"], "running");
        assert_eq!(
            agent_run["execution"]["steps"][0]["sessionKey"],
            agent_run["session"]["key"]
        );

        let cancelled = handle_gateway_method(
            &state,
            "workflow.cancel",
            json!({ "workspaceDir": workspace, "executionId": execution_id }),
        )
        .await
        .expect("workflow cancel");
        assert_eq!(cancelled["execution"]["status"], "cancelled");
        assert_eq!(
            cancelled["execution"]["n8nBaseUrl"],
            "https://n8n.example.com"
        );

        let disabled = handle_gateway_method(
            &state,
            "workflow.disable",
            json!({ "workspaceDir": workspace, "workflow": "daily-check" }),
        )
        .await
        .expect("workflow disable");
        assert_eq!(disabled["workflow"]["enabled"], false);

        let archived = handle_gateway_method(
            &state,
            "workflow.archive",
            json!({ "workspaceDir": workspace, "workflow": "daily-check" }),
        )
        .await
        .expect("workflow archive");
        assert!(archived["workflow"].get("archivedAt").is_some());

        let removed = handle_gateway_method(
            &state,
            "workflow.delete",
            json!({ "workspaceDir": workspace, "workflow": "daily-check" }),
        )
        .await
        .expect("workflow delete");
        assert_eq!(removed["deleted"], true);
        assert_eq!(removed["workflowId"], "daily-check");
        assert_eq!(removed["removedExecutions"], 2);

        match previous_n8n_base_url {
            Some(value) => env::set_var("CRAWCLAW_N8N_BASE_URL", value),
            None => env::remove_var("CRAWCLAW_N8N_BASE_URL"),
        }
        match previous_n8n_api_key {
            Some(value) => env::set_var("CRAWCLAW_N8N_API_KEY", value),
            None => env::remove_var("CRAWCLAW_N8N_API_KEY"),
        }
        match previous_state_dir {
            Some(value) => env::set_var("CRAWCLAW_STATE_DIR", value),
            None => env::remove_var("CRAWCLAW_STATE_DIR"),
        }
        let _ = std::fs::remove_dir_all(runtime_root);
        let _ = std::fs::remove_dir_all(workspace_dir);
        let _ = std::fs::remove_dir_all(state_dir);
    }

    #[tokio::test]
    async fn rust_gateway_usage_and_observation_methods_use_protocol_shapes() {
        let _guard = env_lock().lock().expect("env lock");
        let previous_state_dir = env::var_os("CRAWCLAW_STATE_DIR");
        let previous_minimax = env::var_os("MINIMAX_API_KEY");
        let runtime_root = unique_test_runtime_root("gateway-usage-runtime");
        let state_dir = unique_test_runtime_root("gateway-usage-state");
        env::set_var("CRAWCLAW_STATE_DIR", &state_dir);
        env::set_var("MINIMAX_API_KEY", "test-minimax-key");
        let db_path = state_dir.join("memory-runtime.sqlite");
        write_json_file(
            &state_dir.join("crawclaw.json"),
            &json!({
                "memory": {
                    "runtimeStore": {
                        "type": "sqlite",
                        "dbPath": db_path.to_string_lossy()
                    }
                }
            }),
        )
        .expect("write memory config");
        let db = rusqlite::Connection::open(&db_path).expect("open observation db");
        db.execute_batch(
            r#"
            CREATE TABLE gm_observation_runs (
              trace_id TEXT PRIMARY KEY,
              root_span_id TEXT,
              run_id TEXT,
              task_id TEXT,
              session_id TEXT,
              session_key TEXT,
              agent_id TEXT,
              parent_agent_id TEXT,
              workflow_run_id TEXT,
              status TEXT NOT NULL DEFAULT 'unknown',
              started_at INTEGER,
              ended_at INTEGER,
              last_event_at INTEGER,
              event_count INTEGER NOT NULL DEFAULT 0,
              error_count INTEGER NOT NULL DEFAULT 0,
              sources_json TEXT NOT NULL DEFAULT '[]',
              refs_json TEXT,
              summary TEXT NOT NULL DEFAULT '',
              created_at INTEGER NOT NULL,
              updated_at INTEGER NOT NULL
            );
            INSERT INTO gm_observation_runs
              (trace_id, root_span_id, run_id, task_id, session_id, session_key, agent_id, status, started_at, last_event_at, event_count, error_count, sources_json, summary, created_at, updated_at)
            VALUES
              ('trace-a', 'span-a', 'run-a', 'task-a', 'session-a', 'agent:main:main', 'main', 'running', 100, 120, 1, 0, '["lifecycle"]', 'running main observation', 100, 120),
              ('trace-b', 'span-b', 'run-b', 'task-b', 'session-b', 'agent:worker:main', 'worker', 'error', 200, 240, 2, 1, '["lifecycle","trajectory"]', 'failed worker observation', 200, 240);
            "#,
        )
        .expect("seed observation db");
        drop(db);
        let state = GatewayState::new(GatewayRunConfig {
            runtime_root: Some(runtime_root.clone()),
            ..GatewayRunConfig::default()
        });

        let usage = handle_gateway_method(&state, "usage.status", json!({}))
            .await
            .expect("usage status");
        assert!(usage["providers"]
            .as_array()
            .expect("providers")
            .iter()
            .any(|provider| {
                provider["provider"] == "minimax"
                    && provider["displayName"] == "MiniMax"
                    && provider["windows"].as_array().is_some()
            }));

        let observations = handle_gateway_method(
            &state,
            "agent.observations.list",
            json!({ "query": "task-a", "status": "running", "source": "lifecycle", "limit": 500 }),
        )
        .await
        .expect("observation list");
        assert_eq!(observations["items"][0]["traceId"], "trace-a");
        assert_eq!(observations["items"][0]["runId"], "run-a");
        assert_eq!(observations["items"][0]["taskId"], "task-a");
        assert_eq!(observations["items"][0]["eventCount"], 1);
        assert_eq!(observations["items"][0]["errorCount"], 0);
        assert_eq!(observations["items"][0]["sources"], json!(["lifecycle"]));
        assert_eq!(
            observations["items"][0]["summary"],
            "running main observation"
        );
        assert!(observations["generatedAt"].as_u64().is_some());
        assert!(observations.get("observations").is_none());
        assert!(observations.get("limit").is_none());
        assert!(observations.get("implementation").is_none());

        let invalid = handle_gateway_method(
            &state,
            "agent.observations.list",
            json!({ "status": "done" }),
        )
        .await;
        assert!(invalid
            .expect_err("invalid status")
            .contains("invalid status"));

        match previous_minimax {
            Some(value) => env::set_var("MINIMAX_API_KEY", value),
            None => env::remove_var("MINIMAX_API_KEY"),
        }
        match previous_state_dir {
            Some(value) => env::set_var("CRAWCLAW_STATE_DIR", value),
            None => env::remove_var("CRAWCLAW_STATE_DIR"),
        }
        let _ = std::fs::remove_dir_all(runtime_root);
        let _ = std::fs::remove_dir_all(state_dir);
    }

    #[tokio::test]
    async fn rust_gateway_usage_status_reads_provider_auth_env_catalog() {
        let _guard = env_lock().lock().expect("env lock");
        let previous_state_dir = env::var_os("CRAWCLAW_STATE_DIR");
        let previous_anthropic_oauth = env::var_os("ANTHROPIC_OAUTH_TOKEN");
        let previous_copilot = env::var_os("GH_COPILOT_TOKEN");
        let runtime_root = unique_test_runtime_root("gateway-usage-provider-auth-catalog");
        let state_dir = unique_test_runtime_root("gateway-usage-provider-auth-state");
        env::set_var("CRAWCLAW_STATE_DIR", &state_dir);
        env::set_var("ANTHROPIC_OAUTH_TOKEN", "test-anthropic-oauth");
        env::set_var("GH_COPILOT_TOKEN", "test-copilot-token");

        let state = GatewayState::new(GatewayRunConfig {
            runtime_root: Some(runtime_root.clone()),
            ..GatewayRunConfig::default()
        });
        let usage = handle_gateway_method(&state, "usage.status", json!({}))
            .await
            .expect("usage status");

        assert!(usage["providers"]
            .as_array()
            .expect("providers")
            .iter()
            .any(|provider| provider["provider"] == "anthropic"));
        assert!(usage["providers"]
            .as_array()
            .expect("providers")
            .iter()
            .any(|provider| provider["provider"] == "github-copilot"));

        match previous_anthropic_oauth {
            Some(value) => env::set_var("ANTHROPIC_OAUTH_TOKEN", value),
            None => env::remove_var("ANTHROPIC_OAUTH_TOKEN"),
        }
        match previous_copilot {
            Some(value) => env::set_var("GH_COPILOT_TOKEN", value),
            None => env::remove_var("GH_COPILOT_TOKEN"),
        }
        match previous_state_dir {
            Some(value) => env::set_var("CRAWCLAW_STATE_DIR", value),
            None => env::remove_var("CRAWCLAW_STATE_DIR"),
        }
        let _ = std::fs::remove_dir_all(runtime_root);
        let _ = std::fs::remove_dir_all(state_dir);
    }

    #[tokio::test]
    async fn rust_gateway_secrets_reload_reports_unresolved_secret_refs() {
        let _guard = env_lock().lock().expect("env lock");
        let previous_state_dir = env::var_os("CRAWCLAW_STATE_DIR");
        let previous_secret = env::var_os("CRAWCLAW_SECRET_OK");
        let runtime_root = unique_test_runtime_root("gateway-secrets-runtime");
        let state_dir = unique_test_runtime_root("gateway-secrets-state");
        env::set_var("CRAWCLAW_STATE_DIR", &state_dir);
        env::set_var("CRAWCLAW_SECRET_OK", "secret-value");
        let state = GatewayState::new(GatewayRunConfig {
            runtime_root: Some(runtime_root.clone()),
            ..GatewayRunConfig::default()
        });
        write_json_file(
            &state_dir.join("crawclaw.json"),
            &json!({
                "gateway": {
                    "auth": {
                        "token": { "source": "env", "id": "CRAWCLAW_SECRET_OK" },
                        "password": { "source": "file", "id": "missing-secret.txt" }
                    }
                }
            }),
        )
        .expect("write config");

        let reloaded = handle_gateway_method(&state, "secrets.reload", json!({}))
            .await
            .expect("secrets reload");
        assert_eq!(reloaded["ok"], true);
        assert_eq!(reloaded["checkedRefCount"], 2);
        assert_eq!(reloaded["warningCount"], 1);
        assert!(reloaded["diagnostics"][0]
            .as_str()
            .unwrap_or_default()
            .contains("missing-secret.txt"));

        match previous_secret {
            Some(value) => env::set_var("CRAWCLAW_SECRET_OK", value),
            None => env::remove_var("CRAWCLAW_SECRET_OK"),
        }
        match previous_state_dir {
            Some(value) => env::set_var("CRAWCLAW_STATE_DIR", value),
            None => env::remove_var("CRAWCLAW_STATE_DIR"),
        }
        let _ = std::fs::remove_dir_all(runtime_root);
        let _ = std::fs::remove_dir_all(state_dir);
    }

    #[tokio::test]
    async fn rust_gateway_usage_cost_aggregates_local_session_transcripts() {
        let _guard = env_lock().lock().expect("env lock");
        let previous_state_dir = env::var_os("CRAWCLAW_STATE_DIR");
        let runtime_root = unique_test_runtime_root("gateway-usage-cost-runtime");
        let state_dir = unique_test_runtime_root("gateway-usage-cost-state");
        env::set_var("CRAWCLAW_STATE_DIR", &state_dir);
        let state = GatewayState::new(GatewayRunConfig {
            runtime_root: Some(runtime_root.clone()),
            ..GatewayRunConfig::default()
        });
        let key = "usage-cost";
        let transcript_path = state
            .session_store
            .session_transcript_path(key)
            .expect("transcript path");
        append_jsonl(
            &transcript_path,
            &json!({
                "timestamp": "2026-05-11T00:00:00.000Z",
                "message": {
                    "role": "assistant",
                    "usage": {
                        "input": 10,
                        "output": 5,
                        "cacheRead": 2,
                        "cacheWrite": 1,
                        "totalTokens": 18,
                        "cost": {
                            "total": 0.018,
                            "input": 0.010,
                            "output": 0.005,
                            "cacheRead": 0.002,
                            "cacheWrite": 0.001
                        }
                    }
                }
            }),
        )
        .expect("append transcript entry");
        append_jsonl(
            &transcript_path,
            &json!({
                "timestamp": "2026-05-11T01:00:00.000Z",
                "message": {
                    "role": "assistant",
                    "usage": {
                        "input": 3,
                        "output": 4,
                        "total": 7
                    }
                }
            }),
        )
        .expect("append transcript entry");

        let cost = handle_gateway_method(&state, "usage.cost", json!({ "days": 30 }))
            .await
            .expect("usage cost");
        assert_eq!(cost["days"], 30);
        assert_eq!(cost["daily"].as_array().expect("daily").len(), 1);
        assert_eq!(cost["daily"][0]["date"], "2026-05-11");
        assert_eq!(cost["totals"]["input"], 13);
        assert_eq!(cost["totals"]["output"], 9);
        assert_eq!(cost["totals"]["cacheRead"], 2);
        assert_eq!(cost["totals"]["cacheWrite"], 1);
        assert_eq!(cost["totals"]["totalTokens"], 25);
        assert_eq!(cost["totals"]["totalCost"], 0.018);
        assert_eq!(cost["totals"]["inputCost"], 0.01);
        assert_eq!(cost["totals"]["outputCost"], 0.005);
        assert_eq!(cost["totals"]["cacheReadCost"], 0.002);
        assert_eq!(cost["totals"]["cacheWriteCost"], 0.001);
        assert_eq!(cost["totals"]["missingCostEntries"], 1);
        assert_eq!(cost["daily"][0]["totalTokens"], 25);
        assert_eq!(cost["daily"][0]["missingCostEntries"], 1);

        match previous_state_dir {
            Some(value) => env::set_var("CRAWCLAW_STATE_DIR", value),
            None => env::remove_var("CRAWCLAW_STATE_DIR"),
        }
        let _ = std::fs::remove_dir_all(runtime_root);
        let _ = std::fs::remove_dir_all(state_dir);
    }

    #[tokio::test]
    async fn rust_gateway_exec_approvals_set_persists_local_file() {
        let _guard = env_lock().lock().expect("env lock");
        let previous_state_dir = env::var_os("CRAWCLAW_STATE_DIR");
        let runtime_root = unique_test_runtime_root("gateway-exec-approvals-runtime");
        let state_dir = unique_test_runtime_root("gateway-exec-approvals-state");
        env::set_var("CRAWCLAW_STATE_DIR", &state_dir);
        let state = GatewayState::new(GatewayRunConfig {
            runtime_root: Some(runtime_root.clone()),
            ..GatewayRunConfig::default()
        });

        let before = handle_gateway_method(&state, "exec.approvals.get", json!({}))
            .await
            .expect("exec approvals get");
        assert_eq!(before["exists"], false);

        let updated = handle_gateway_method(
            &state,
            "exec.approvals.set",
            json!({
                "file": {
                    "version": 1,
                    "defaults": { "security": "full", "ask": "off" },
                    "agents": {
                        "main": {
                            "ask": "on-request"
                        }
                    }
                }
            }),
        )
        .await
        .expect("exec approvals set");
        assert_eq!(updated["exists"], true);
        assert_eq!(updated["file"]["defaults"]["security"], "full");
        assert_eq!(updated["file"]["agents"]["main"]["ask"], "on-request");
        assert!(state_dir.join("exec-approvals.json").exists());

        let changed = handle_gateway_method(
            &state,
            "exec.approvals.set",
            json!({
                "baseHash": updated["hash"],
                "file": {
                    "version": 1,
                    "defaults": { "security": "restricted" },
                    "agents": {}
                }
            }),
        )
        .await
        .expect("exec approvals set with base hash");
        assert_eq!(changed["file"]["defaults"]["security"], "restricted");

        let stale = handle_gateway_method(
            &state,
            "exec.approvals.set",
            json!({
                "baseHash": updated["hash"],
                "file": {
                    "version": 1,
                    "defaults": {},
                    "agents": {}
                }
            }),
        )
        .await;
        assert!(stale
            .expect_err("stale base hash should fail")
            .contains("exec approvals changed since last load"));

        match previous_state_dir {
            Some(value) => env::set_var("CRAWCLAW_STATE_DIR", value),
            None => env::remove_var("CRAWCLAW_STATE_DIR"),
        }
        let _ = std::fs::remove_dir_all(runtime_root);
        let _ = std::fs::remove_dir_all(state_dir);
    }

    #[tokio::test]
    async fn rust_gateway_channel_lifecycle_tracks_native_local_delivery() {
        let _guard = env_lock().lock().expect("env lock");
        let runtime_root = unique_test_runtime_root("gateway-channel-lifecycle");
        let state = GatewayState::new(GatewayRunConfig {
            runtime_root: Some(runtime_root.clone()),
            ..GatewayRunConfig::default()
        });

        handle_gateway_method(
            &state,
            "channels.config.apply",
            json!({
                "channel": "desktop",
                "config": { "enabled": true }
            }),
        )
        .await
        .expect("apply desktop config");

        let login = handle_gateway_method(
            &state,
            "channels.account.login.start",
            json!({
                "channel": "desktop",
                "accountId": "local"
            }),
        )
        .await
        .expect("desktop login");
        assert_eq!(login["connected"], true);
        assert_eq!(login["linked"], true);
        assert_eq!(login["healthState"], "connected");

        let verify = handle_gateway_method(
            &state,
            "channels.account.verify",
            json!({
                "channel": "desktop",
                "accountId": "local"
            }),
        )
        .await
        .expect("desktop verify");
        assert_eq!(verify["connected"], true);
        assert_eq!(verify["linked"], true);

        let local_send = handle_gateway_method(
            &state,
            "send",
            json!({
                "channel": "desktop",
                "accountId": "local",
                "to": "agent:main",
                "text": "hello local"
            }),
        )
        .await
        .expect("desktop send");
        assert_eq!(local_send["sent"], true);
        assert_eq!(local_send["deliveryStatus"], "delivered");
        assert!(local_send["deliveredAtMs"].is_number());

        let blocked_external = handle_gateway_method(
            &state,
            "send",
            json!({
                "channel": "weixin",
                "to": "filehelper",
                "text": "hello external"
            }),
        )
        .await
        .expect("weixin send");
        assert_eq!(blocked_external["sent"], false);
        assert_eq!(blocked_external["deliveryStatus"], "blocked");
        assert_eq!(blocked_external["errorCode"], "needs_channel_transport");

        let status = handle_gateway_method(&state, "channels.status", json!({}))
            .await
            .expect("channels status");
        assert_eq!(status["channels"]["desktop"]["connected"], true);
        assert_eq!(status["channels"]["desktop"]["running"], true);
        assert_eq!(
            status["channelAccounts"]["desktop"][0]["healthState"],
            "connected"
        );

        let _ = std::fs::remove_dir_all(runtime_root);
    }

    fn unique_test_runtime_root(name: &str) -> PathBuf {
        env::temp_dir().join(format!("{name}-{}", now_millis()))
    }

    fn ts_core_gateway_methods() -> Vec<String> {
        let source = include_str!("../../../src/gateway/server-methods-list.ts");
        let start = source
            .find("const BASE_METHODS = [")
            .expect("BASE_METHODS start");
        let rest = &source[start..];
        let end = rest.find("];").expect("BASE_METHODS end");
        rest[..end]
            .lines()
            .filter_map(|line| {
                let trimmed = line.trim();
                let value = trimmed.strip_prefix('"')?.split('"').next()?;
                if value.is_empty() {
                    None
                } else {
                    Some(value.to_string())
                }
            })
            .collect()
    }

    fn run_git_test_command(cwd: &std::path::Path, args: &[&str]) {
        let output = std::process::Command::new("git")
            .args(args)
            .current_dir(cwd)
            .output()
            .expect("run git");
        assert!(
            output.status.success(),
            "git {:?} failed\nstdout: {}\nstderr: {}",
            args,
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );
    }
}
