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
        "cron",
    ];
}

use std::convert::Infallible;
use std::env;
use std::io::Write;
use std::net::{IpAddr, Ipv4Addr, SocketAddr};
use std::path::PathBuf;
use std::sync::Arc;
use std::time::{Instant, SystemTime, UNIX_EPOCH};

use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::{Query, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::sse::{Event, KeepAlive, Sse};
use axum::response::IntoResponse;
use axum::routing::{get, post};
use axum::{Json, Router};
use crawclaw_runtime::{
    cron::{CronService, CronServiceOptions},
    memory::RustMemoryRuntime,
    special_agents::{special_agent_definitions, SpecialAgentRunRequest, SpecialAgentRunner},
    AgentRuntime, DesktopSessionStore,
};
use futures_util::{stream, StreamExt};
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
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

async fn handle_ws(mut socket: WebSocket, state: GatewayState) {
    let nonce = format!("rust-{}", now_millis());
    let _ = socket
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
    while let Some(message) = socket.recv().await {
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
                    &mut socket,
                    &request.id,
                    "INVALID_REQUEST",
                    "unsupported gateway frame type",
                )
                .await;
                continue;
            }
            Err(error) => {
                let _ = socket
                    .send(Message::Text(
                        json!({
                            "type": "event",
                            "event": "operationFailed",
                            "payload": { "message": format!("invalid gateway frame: {error}") }
                        })
                        .to_string()
                        .into(),
                    ))
                    .await;
                continue;
            }
        };

        if request.method == "connect" {
            match authorize_connect(&state, &request.params) {
                Ok(()) => {
                    connected = true;
                    let hello = hello_ok(&state);
                    let _ = send_ws_ok(&mut socket, &request.id, hello).await;
                }
                Err(message) => {
                    let _ = send_ws_error(&mut socket, &request.id, "UNAUTHORIZED", &message).await;
                }
            }
            continue;
        }

        if !connected {
            let _ = send_ws_error(
                &mut socket,
                &request.id,
                "UNAUTHORIZED",
                "gateway connect is required before requests",
            )
            .await;
            continue;
        }

        match handle_gateway_method(&state, &request.method, request.params).await {
            Ok(payload) => {
                let _ = send_ws_ok(&mut socket, &request.id, payload).await;
            }
            Err(message) => {
                let _ = send_ws_error(&mut socket, &request.id, "UNAVAILABLE", &message).await;
            }
        }
    }
}

async fn send_ws_ok(socket: &mut WebSocket, id: &str, payload: Value) -> Result<(), axum::Error> {
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

async fn send_ws_error(
    socket: &mut WebSocket,
    id: &str,
    code: &str,
    message: &str,
) -> Result<(), axum::Error> {
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
        "secrets.reload" => Ok(json!({ "ok": true, "warningCount": 0 })),
        "secrets.resolve" => secrets_resolve(state, params),
        "tools.catalog" => Ok(tools_catalog(params)),
        "tools.effective" => Ok(tools_effective(params)),
        "models.list" => Ok(models_list()),
        "agents.list" => Ok(agents_list(state)),
        "logs.tail" => Ok(logs_tail()),
        "usage.status" => Ok(usage_status()),
        "usage.cost" => Ok(usage_cost()),
        "doctor.memory.status" => doctor_memory_status(state),
        "agentRuntime.summary" => agent_runtime_summary(state, params),
        "agentRuntime.list" => agent_runtime_list(state, params),
        "agentRuntime.get" => agent_runtime_get(state, params),
        "agentRuntime.cancel" => agent_runtime_cancel(state, params),
        "agent.identity.get" => Ok(agent_identity(state)),
        "agent.inspect" => Ok(runtime_status_value(state)),
        "agent.observations.list" => Ok(json!({ "observations": [] })),
        "agent.wait" => Ok(json!({ "status": "completed", "runId": Value::Null })),
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
        "wizard.start" => Ok(wizard_start()),
        "wizard.next" => Ok(wizard_done("done")),
        "wizard.cancel" => Ok(wizard_done("cancelled")),
        "wizard.status" => Ok(json!({ "status": "done" })),
        "plugins.list" => plugins_list(state),
        "plugins.enable" => plugins_set_enabled(state, params, true),
        "plugins.disable" => plugins_set_enabled(state, params, false),
        "plugins.install" => plugins_install(state, params),
        "plugins.update" => plugins_update(state, params),
        "plugins.uninstall" => plugins_uninstall(state, params),
        "exec.approvals.get" => Ok(approvals_snapshot(state, "exec")),
        "exec.approvals.set" => Ok(json!({ "ok": true, "kind": "exec" })),
        "exec.approval.request" => approval_request(state, params, "exec.approval"),
        "exec.approval.waitDecision" => approval_wait_decision(params),
        "exec.approval.resolve" => approval_resolve(state, params, "exec.approval"),
        "plugin.approval.request" => approval_request(state, params, "plugin.approval"),
        "plugin.approval.waitDecision" => approval_wait_decision(params),
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
        "tts.providers" => Ok(tts_providers()),
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
        "last-main-session-wake" | "system.mainSessionWake.last" => Ok(json!({
            "ok": true,
            "lastWake": Value::Null
        })),
        "gateway.identity.get" => Ok(json!({
            "id": "rust-gateway",
            "name": "CrawClaw Rust Gateway",
            "implementation": "rust-native"
        })),
        "system-presence" => Ok(json!({ "presence": [] })),
        "system-event" => Ok(json!({ "ok": true })),
        "send" => channel_send(state, params),
        "device.pair.list" => Ok(json!({ "requests": [], "devices": [] })),
        "device.pair.approve" | "device.pair.reject" | "device.pair.remove" => {
            Ok(json!({ "ok": true }))
        }
        "device.token.rotate" => device_token_rotate(state, params),
        "device.token.revoke" => Ok(json!({ "ok": true })),
        "esp32.status.get" => Ok(json!({ "ok": true, "devices": [], "pairing": [] })),
        "esp32.pairing.start" => Ok(json!({
            "ok": true,
            "pairId": format!("rust-esp32-{}", now_millis()),
            "expiresAtMs": now_millis() + 300000_u128
        })),
        "esp32.pairing.requests.list" => Ok(json!({ "requests": [] })),
        "esp32.pairing.request.approve"
        | "esp32.pairing.request.reject"
        | "esp32.pairing.session.revoke"
        | "esp32.devices.revoke" => Ok(json!({ "ok": true })),
        "esp32.devices.list" => Ok(json!({ "devices": [] })),
        "esp32.devices.get" => esp32_device_get(state, params),
        "esp32.devices.command.send" => esp32_device_command_send(state, params),
        "workflow.list" | "workflow.match" => Ok(json!({ "count": 0, "workflows": [] })),
        "workflow.runs" => Ok(json!({ "count": 0, "executions": [] })),
        "workflow.get" | "workflow.n8n.get" => workflow_get(params),
        "workflow.enable" | "workflow.disable" | "workflow.archive" | "workflow.unarchive"
        | "workflow.delete" | "workflow.deploy" => workflow_mutation(params),
        "workflow.run" => workflow_run(params),
        "workflow.status" | "workflow.cancel" | "workflow.resume" => {
            workflow_execution_action(params)
        }
        "workflow.agent.run" => workflow_agent_run(state, params),
        "chat.history" => chat_history(state, params),
        "chat.inject" => chat_inject(state, params),
        "chat.abort" => chat_abort(params),
        "chat.send" => chat_send(state, params).await,
        "wake" | "cron.status" | "cron.list" | "cron.add" | "cron.update" | "cron.remove"
        | "cron.run" | "cron.runs" => {
            let result = state.cron.handle_method(method, params).await?;
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
        "memory.promptJournal.summary" | "memory_prompt_journal_summary" => Ok(json!({
            "status": "ok",
            "implementation": "rust-native",
            "summary": "Rust memory prompt journal is stored through runtime SQLite and structured stores."
        })),
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
        "sessions.messages.subscribe"
        | "sessions.messages.unsubscribe"
        | "sessions.subscribe"
        | "sessions.unsubscribe" => Ok(json!({ "status": "ok", "events": "sse" })),
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

fn usage_status() -> Value {
    json!({
        "updatedAt": now_millis(),
        "providers": []
    })
}

fn usage_cost() -> Value {
    json!({
        "updatedAt": now_millis(),
        "days": 0,
        "daily": [],
        "totals": zero_cost_totals()
    })
}

fn zero_cost_totals() -> Value {
    json!({
        "input": 0,
        "output": 0,
        "cacheRead": 0,
        "cacheWrite": 0,
        "totalTokens": 0,
        "totalCost": 0,
        "inputCost": 0,
        "outputCost": 0,
        "cacheReadCost": 0,
        "cacheWriteCost": 0,
        "missingCostEntries": 0
    })
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

fn wizard_start() -> Value {
    json!({
        "sessionId": format!("rust-wizard-{}", now_millis()),
        "done": true,
        "status": "done"
    })
}

fn wizard_done(status: &str) -> Value {
    json!({
        "done": true,
        "status": status
    })
}

fn approvals_snapshot(state: &GatewayState, kind: &str) -> Value {
    json!({
        "path": state.state_dir.join(format!("{kind}-approvals.json")).to_string_lossy(),
        "exists": false,
        "hash": "rust-empty",
        "file": {
            "version": 1,
            "defaults": {},
            "agents": {}
        }
    })
}

fn approval_request(state: &GatewayState, params: Value, kind: &str) -> Result<Value, String> {
    let id = string_param(&params, &["id"]).unwrap_or_else(|| format!("{kind}-{}", now_millis()));
    let payload = json!({
        "id": id,
        "kind": kind,
        "status": "pending",
        "request": params
    });
    emit(state, &format!("{kind}.requested"), payload.clone());
    Ok(payload)
}

fn approval_wait_decision(params: Value) -> Result<Value, String> {
    let id = required_param(&params, &["id"])?;
    Ok(json!({
        "id": id,
        "decision": "denied",
        "reason": "No Rust Gateway approval decision is available."
    }))
}

fn approval_resolve(state: &GatewayState, params: Value, kind: &str) -> Result<Value, String> {
    let id = required_param(&params, &["id"])?;
    let decision = required_param(&params, &["decision"])?;
    let payload = json!({
        "id": id,
        "kind": kind,
        "decision": decision
    });
    emit(state, &format!("{kind}.resolved"), payload.clone());
    Ok(json!({ "ok": true, "result": payload }))
}

fn plugins_list(state: &GatewayState) -> Result<Value, String> {
    let config = read_config_value(&config_path(state))?;
    let plugins = get_json_path(&config, "plugins.entries")
        .and_then(Value::as_object)
        .map(|entries| {
            entries
                .iter()
                .map(|(id, entry)| {
                    json!({
                        "id": id,
                        "enabled": entry.get("enabled").and_then(Value::as_bool).unwrap_or(false),
                        "configured": entry.get("config").is_some(),
                        "source": "config",
                        "config": entry.get("config").cloned().unwrap_or(Value::Null)
                    })
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    Ok(json!({
        "workspaceDir": state.runtime_root.join("plugins").to_string_lossy(),
        "plugins": plugins,
        "diagnostics": []
    }))
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
    let (mut manifest, source_root) = plugin_install_manifest(&params)?;
    let id = resolve_plugin_install_id(&params, &manifest)?;
    normalize_plugin_manifest(&mut manifest, &id)?;
    let plugin_dir = plugin_install_dir(state, &id);
    let manifest_path = plugin_dir.join("crawclaw.plugin.json");
    let source_path = source_root.unwrap_or_else(|| plugin_dir.clone());

    if !same_filesystem_path(&source_path, &plugin_dir) {
        copy_plugin_directory(&source_path, &plugin_dir)?;
    } else {
        std::fs::create_dir_all(&plugin_dir)
            .map_err(|error| format!("failed to create plugin directory: {error}"))?;
    }
    write_json_file(&manifest_path, &manifest)?;

    let path = config_path(state);
    let mut config = read_config_value(&path)?;
    set_json_path(
        &mut config,
        &format!("plugins.entries.{id}.enabled"),
        Value::Bool(true),
    )?;
    delete_json_path(&mut config, &format!("plugins.entries.{id}.source"));
    set_json_path(
        &mut config,
        &format!("plugins.installs.{id}"),
        plugin_install_record(&source_path, &plugin_dir, &manifest),
    )?;
    write_config_value(&path, &config)?;
    Ok(json!({
        "ok": true,
        "pluginId": id,
        "id": id,
        "installSource": "path",
        "requiresRestart": true,
        "warnings": [],
        "manifestPath": manifest_path.to_string_lossy(),
        "manifest": manifest,
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
        if source != "path" {
            outcomes.push(json!({
                "pluginId": id,
                "status": "skipped",
                "message": format!("Skipping \"{id}\" (source: {source}).")
            }));
            continue;
        }
        let Some(source_path_raw) = record.get("sourcePath").and_then(Value::as_str) else {
            outcomes.push(json!({
                "pluginId": id,
                "status": "skipped",
                "message": format!("Skipping \"{id}\" (missing sourcePath).")
            }));
            continue;
        };
        let source_path = normalize_plugin_filesystem_path(state, source_path_raw);
        let install_path = record
            .get("installPath")
            .and_then(Value::as_str)
            .map(|value| normalize_plugin_filesystem_path(state, value))
            .unwrap_or_else(|| plugin_install_dir(state, &id));
        let source_manifest_path = match plugin_manifest_path_from_source(&source_path) {
            Ok((_, manifest_path)) => manifest_path,
            Err(message) => {
                outcomes.push(json!({
                    "pluginId": id,
                    "status": "error",
                    "message": message
                }));
                continue;
            }
        };
        let next_manifest = match read_json_file(&source_manifest_path) {
            Ok(manifest) => manifest,
            Err(message) => {
                outcomes.push(json!({
                    "pluginId": id,
                    "status": "error",
                    "message": message
                }));
                continue;
            }
        };
        let next_id = match resolve_plugin_manifest_id(&next_manifest) {
            Ok(next_id) => next_id,
            Err(message) => {
                outcomes.push(json!({
                    "pluginId": id,
                    "status": "error",
                    "message": message
                }));
                continue;
            }
        };
        if next_id != id {
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
            if !same_filesystem_path(&source_path, &install_path) {
                copy_plugin_directory(&source_path, &install_path)?;
            } else {
                std::fs::create_dir_all(&install_path).map_err(|error| {
                    format!(
                        "failed to create plugin directory {}: {error}",
                        install_path.display()
                    )
                })?;
            }
            write_json_file(&installed_manifest_path, &next_manifest)?;
            let mut next_record = record.as_object().cloned().unwrap_or_default();
            next_record.insert("source".to_string(), Value::String("path".to_string()));
            next_record.insert(
                "sourcePath".to_string(),
                Value::String(source_path.to_string_lossy().to_string()),
            );
            next_record.insert(
                "installPath".to_string(),
                Value::String(install_path.to_string_lossy().to_string()),
            );
            if let Some(version) = next_version.clone() {
                next_record.insert("version".to_string(), Value::String(version));
            } else {
                next_record.remove("version");
            }
            next_record.insert(
                "installedAt".to_string(),
                Value::String(now_timestamp_string()),
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
    let id = safe_config_component_id(&required_param(&params, &["id", "pluginId"])?, "plugin id")?;
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

fn plugin_install_manifest(params: &Value) -> Result<(Value, Option<PathBuf>), String> {
    if let Some(raw) = string_param(params, &["raw", "source", "path"]) {
        let source = expand_user_path(&raw);
        let (source_root, manifest_path) = plugin_manifest_path_from_source(&source)?;
        return Ok((read_json_file(&manifest_path)?, Some(source_root)));
    }
    if let Some(manifest) = params.get("manifest") {
        return Ok((manifest.clone(), None));
    }
    let id = required_param(params, &["pluginId", "id", "name"])?;
    Ok((
        json!({
            "id": id,
            "name": id,
            "version": "0.0.0",
            "runtime": "rust-local"
        }),
        None,
    ))
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
    let id = safe_config_component_id(&raw, "plugin id")?;
    if let (Some(requested), Some(manifest_id)) = (requested, manifest_id) {
        let requested = safe_config_component_id(&requested, "plugin id")?;
        let manifest_id = safe_config_component_id(&manifest_id, "plugin id")?;
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
    safe_config_component_id(id, "plugin id")
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

fn plugin_install_record(
    source_path: &std::path::Path,
    install_path: &std::path::Path,
    manifest: &Value,
) -> Value {
    let mut record = Map::new();
    record.insert("source".to_string(), Value::String("path".to_string()));
    record.insert(
        "sourcePath".to_string(),
        Value::String(source_path.to_string_lossy().to_string()),
    );
    record.insert(
        "installPath".to_string(),
        Value::String(install_path.to_string_lossy().to_string()),
    );
    if let Some(version) = plugin_manifest_version(manifest) {
        record.insert("version".to_string(), Value::String(version));
    }
    record.insert(
        "installedAt".to_string(),
        Value::String(now_timestamp_string()),
    );
    Value::Object(record)
}

fn resolve_plugin_update_targets(config: &Value, params: &Value) -> Result<Vec<String>, String> {
    if let Some(id) = string_param(params, &["id", "pluginId"]) {
        return Ok(vec![safe_config_component_id(&id, "plugin id")?]);
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

fn plugin_install_dir(state: &GatewayState, id: &str) -> PathBuf {
    state.runtime_root.join("plugins").join(id)
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

fn tts_status(state: &GatewayState) -> Value {
    let config = read_config_value(&config_path(state)).unwrap_or(Value::Object(Map::new()));
    let enabled = get_json_path(&config, "messages.tts.enabled")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let provider = get_json_path(&config, "messages.tts.provider")
        .and_then(Value::as_str)
        .unwrap_or("none");
    json!({
        "enabled": enabled,
        "provider": provider,
        "implementation": "rust-native"
    })
}

fn tts_providers() -> Value {
    json!({
        "providers": [],
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
    let provider = required_param(&params, &["provider", "id"])?;
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

fn workflow_mutation(params: Value) -> Result<Value, String> {
    let workflow = required_param(&params, &["workflow"])?;
    Ok(json!({
        "agentId": string_param(&params, &["agentId"]),
        "workflow": workflow_stub(&workflow)
    }))
}

fn workflow_run(params: Value) -> Result<Value, String> {
    let workflow = required_param(&params, &["workflow"])?;
    Ok(json!({
        "agentId": string_param(&params, &["agentId"]),
        "workflow": workflow_stub(&workflow),
        "execution": workflow_execution_stub(&workflow, "queued")
    }))
}

fn workflow_get(params: Value) -> Result<Value, String> {
    let workflow = required_param(&params, &["workflow", "workflowId"])?;
    Ok(json!({
        "agentId": string_param(&params, &["agentId"]),
        "workflow": workflow_stub(&workflow),
        "executions": [],
        "implementation": "rust-native"
    }))
}

fn workflow_agent_run(state: &GatewayState, params: Value) -> Result<Value, String> {
    let workflow = required_param(&params, &["workflow", "workflowId"])?;
    let goal = required_param(&params, &["goal", "message", "task"])?;
    let parent = string_param(&params, &["parentSessionKey", "sessionKey", "key"])
        .unwrap_or_else(|| "main".to_string());
    let label = format!("Workflow: {workflow}");
    let session = state
        .session_store
        .spawn_session(Some(&parent), Some(&label), &goal)
        .map_err(|error| error.to_string())?;
    let execution = workflow_execution_stub(&workflow, "queued");
    let payload = json!({
        "ok": true,
        "status": "queued",
        "workflow": workflow_stub(&workflow),
        "execution": execution,
        "session": session,
        "implementation": "rust-native"
    });
    emit(state, "workflow.agent.run", payload.clone());
    Ok(payload)
}

fn workflow_execution_action(params: Value) -> Result<Value, String> {
    let execution_id = required_param(&params, &["executionId"])?;
    Ok(json!({
        "agentId": string_param(&params, &["agentId"]),
        "execution": {
            "executionId": execution_id,
            "status": "not_found",
            "startedAt": Value::Null,
            "finishedAt": Value::Null
        }
    }))
}

fn workflow_stub(workflow: &str) -> Value {
    json!({
        "workflowId": workflow,
        "name": workflow,
        "enabled": false,
        "archived": false,
        "deployed": false
    })
}

fn workflow_execution_stub(workflow: &str, status: &str) -> Value {
    json!({
        "executionId": format!("rust-workflow-{}", now_millis()),
        "workflowId": workflow,
        "status": status,
        "startedAt": Value::Null,
        "finishedAt": Value::Null
    })
}

fn device_token_rotate(state: &GatewayState, params: Value) -> Result<Value, String> {
    let device_id =
        safe_config_component_id(&required_param(&params, &["deviceId", "id"])?, "device id")?;
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

fn esp32_device_get(state: &GatewayState, params: Value) -> Result<Value, String> {
    let device_id =
        safe_config_component_id(&required_param(&params, &["deviceId", "id"])?, "device id")?;
    let config = read_config_value(&config_path(state))?;
    let device = get_json_path(&config, &format!("esp32.devices.{device_id}")).cloned();
    Ok(json!({
        "ok": device.is_some(),
        "status": if device.is_some() { "found" } else { "not_found" },
        "deviceId": device_id,
        "device": device.unwrap_or(Value::Null),
        "implementation": "rust-native"
    }))
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
            "presence": [],
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

fn emit(state: &GatewayState, event_type: &str, payload: Value) {
    let _ = state.events.send(json!({
        "type": event_type,
        "payload": payload
    }));
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
    use std::sync::{Mutex, OnceLock};

    fn env_lock() -> &'static Mutex<()> {
        static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
        LOCK.get_or_init(|| Mutex::new(()))
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
                "goal": "summarize local state"
            }),
        )
        .await
        .expect("workflow agent run");
        assert_eq!(workflow_agent["status"], "queued");
        assert!(workflow_agent["session"]["key"].is_string());

        let _ = std::fs::remove_dir_all(runtime_root);
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
