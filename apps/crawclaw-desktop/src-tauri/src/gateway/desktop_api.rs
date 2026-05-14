use std::convert::Infallible;
use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::Arc;

use anyhow::{bail, Context, Result};
use axum::body::Bytes;
use axum::extract::{Path, Query, State};
use axum::http::{HeaderMap, Method, StatusCode};
use axum::response::sse::{Event, KeepAlive, Sse};
use axum::routing::{get, patch, post};
use axum::{Json, Router};
use futures_util::{stream, StreamExt};
use serde::Deserialize;
use serde_json::{json, Map, Value};
use tokio::net::TcpListener;
use tokio::sync::{broadcast, RwLock};
use tower_http::cors::{Any, CorsLayer};
use uuid::Uuid;

use crawclaw_native_plugins::comfyui::handle_comfyui;
use crawclaw_native_plugins::qwen3_tts::{build_synthesis_payload, synthesize_qwen3_tts};
use crawclaw_native_plugins::web::{run_open_websearch_search, run_scrapling_fetch};
use crawclaw_plugin_host::{
    add_custom_plugin_skill, invoke_node_plugin_tool, is_desktop_or_native_channel_id,
    load_plugin_manifest, native_channel, toggle_plugin_skill_open, toggle_plugin_tool_open,
    NativeChannelDefinition, PluginHostError, PluginHostSkill, PluginHostTool,
};
use crawclaw_runtime::{
    special_agents::SpecialAgentRunner, AgentRuntime, AgentRuntimeError, DesktopAgentStore,
    DesktopAgentStoreError, DesktopMemoryRecord, DesktopMemoryStore, DesktopMemoryStoreError,
    DesktopPreferencesRecord, DesktopPreferencesStore, DesktopPreferencesStoreError,
    DesktopSessionRecord, DesktopSessionStore, DesktopSessionStoreError,
};

use crate::gateway::desktop_state::initial_desktop_state;
use crate::gateway::runtime_supervisor::RuntimeSupervisor;
use crate::models::{
    AgentAvatarProfile, AgentChannelBinding, AgentChannelConfig, AgentChannelConfigField,
    AgentEmotionProfile, AgentProfile, AgentSkill, AgentVoiceConfig, BootstrapResponse,
    DesktopApiInfo, DesktopAppInfo, DesktopEvent, DesktopPreferences, DesktopState, MemoryItem,
    PermissionStatus, PluginSkill, PluginTool, RuntimeCheck, RuntimeEvent, RuntimeStatus,
    SearchSuggestion, SidebarThread,
};
use crate::runtime_engine::RuntimeLayout;

const SESSION_HEADER: &str = "x-crawclaw-desktop-session";

#[derive(Clone)]
pub struct GatewayConfig {
    pub app_name: String,
    pub app_version: String,
    pub runtime_layout: RuntimeLayout,
    pub session_token: String,
}

pub struct GatewayServer {
    pub base_url: String,
    pub addr: SocketAddr,
}

#[derive(Clone)]
struct GatewayState {
    app: DesktopAppInfo,
    api: DesktopApiInfo,
    runtime_root: PathBuf,
    runtime_supervisor: RuntimeSupervisor,
    agent_runtime: AgentRuntime,
    agent_store: DesktopAgentStore,
    memory_store: DesktopMemoryStore,
    preferences_store: DesktopPreferencesStore,
    session_store: DesktopSessionStore,
    desktop_state: Arc<RwLock<DesktopState>>,
    events: broadcast::Sender<DesktopEvent>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct EventsQuery {
    session_token: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SearchQuery {
    q: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SelectNavRequest {
    nav_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SendMessageRequest {
    text: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SelectThreadRequest {
    thread_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PermissionDecisionRequest {
    decision: PermissionStatus,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PreferencesPatch {
    selected_model: Option<String>,
    selected_thinking: Option<String>,
    permission_mode: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct MemoryQueryPatch {
    query: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct MemoryFilterPatch {
    filter: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SessionSpawnRequest {
    task: String,
    label: Option<String>,
    parent_session_key: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SessionSendRequest {
    session_key: String,
    message: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SessionYieldRequest {
    session_key: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SubagentsQuery {
    parent_session_key: Option<String>,
}

pub fn new_gateway_session_token() -> String {
    Uuid::new_v4().simple().to_string()
}

pub fn is_loopback_addr(addr: &SocketAddr) -> bool {
    addr.ip().is_loopback()
}

pub async fn start_gateway_server(config: GatewayConfig) -> Result<GatewayServer> {
    let listener = TcpListener::bind(("127.0.0.1", 0))
        .await
        .context("failed to bind CrawClaw Desktop Gateway to loopback")?;
    let addr = listener
        .local_addr()
        .context("failed to read CrawClaw Desktop Gateway address")?;
    if !is_loopback_addr(&addr) {
        bail!("CrawClaw Desktop Gateway must bind to loopback, got {addr}");
    }

    let base_url = format!("http://{addr}");
    let state = build_state(
        config.app_name,
        config.app_version,
        base_url.clone(),
        config.session_token,
        config.runtime_layout,
    )
    .await;

    let app = router(state);
    tokio::spawn(async move {
        if let Err(error) = axum::serve(listener, app).await {
            eprintln!("[desktop-gateway] server exited: {error}");
        }
    });

    Ok(GatewayServer { base_url, addr })
}

async fn build_state(
    app_name: String,
    app_version: String,
    base_url: String,
    session_token: String,
    runtime_layout: RuntimeLayout,
) -> GatewayState {
    let runtime_supervisor = RuntimeSupervisor::probe(runtime_layout.clone()).await;
    let runtime = runtime_supervisor.status();
    let agent_store = DesktopAgentStore::new(runtime_layout.runtime_root.clone());
    let memory_store = DesktopMemoryStore::new(runtime_layout.runtime_root.clone());
    let preferences_store = DesktopPreferencesStore::new(runtime_layout.runtime_root.clone());
    let session_store = DesktopSessionStore::new(runtime_layout.runtime_root.clone());
    let mut desktop_state = initial_desktop_state(&runtime);
    merge_persisted_agents(&mut desktop_state, &agent_store);
    merge_persisted_memory_items(&mut desktop_state, &memory_store);
    merge_persisted_preferences(&mut desktop_state, &preferences_store);
    merge_persisted_sessions(&mut desktop_state, &session_store);
    merge_plugin_manifest(&mut desktop_state, &runtime_layout);
    let (events, _) = broadcast::channel(32);
    GatewayState {
        app: DesktopAppInfo {
            name: app_name,
            version: app_version,
        },
        api: DesktopApiInfo {
            base_url: base_url.clone(),
            events_url: format!("{base_url}/api/desktop/events"),
            session_token,
        },
        runtime_root: runtime_layout.runtime_root.clone(),
        runtime_supervisor,
        agent_runtime: AgentRuntime::new(runtime_layout.runtime_root.clone()),
        agent_store,
        memory_store,
        preferences_store,
        session_store,
        desktop_state: Arc::new(RwLock::new(desktop_state)),
        events,
    }
}

fn merge_plugin_manifest(desktop_state: &mut DesktopState, runtime_layout: &RuntimeLayout) {
    match load_plugin_manifest(&runtime_layout.runtime_root) {
        Ok(read_model) => {
            desktop_state.plugins_workspace.tools =
                read_model.tools.into_iter().map(plugin_tool).collect();
            desktop_state.plugins_workspace.skills =
                read_model.skills.into_iter().map(plugin_skill).collect();
        }
        Err(error) => desktop_state
            .conversation
            .runtime_checks
            .push(RuntimeCheck {
                label: "Desktop plugin manifest".to_string(),
                value: error.to_string(),
                tone: "error".to_string(),
            }),
    }
}

fn merge_persisted_preferences(
    desktop_state: &mut DesktopState,
    preferences_store: &DesktopPreferencesStore,
) {
    match preferences_store.load_preferences() {
        Ok(Some(preferences)) => {
            desktop_state.preferences.selected_model = preferences.selected_model;
            desktop_state.preferences.selected_thinking = preferences.selected_thinking;
            desktop_state.preferences.permission_mode = preferences.permission_mode;
        }
        Ok(None) => {}
        Err(error) => desktop_state
            .conversation
            .runtime_checks
            .push(RuntimeCheck {
                label: "Desktop preferences store".to_string(),
                value: error.to_string(),
                tone: "error".to_string(),
            }),
    }
}

fn merge_persisted_sessions(desktop_state: &mut DesktopState, session_store: &DesktopSessionStore) {
    match session_store.load_sessions() {
        Ok(sessions) => apply_session_records(desktop_state, sessions),
        Err(error) => desktop_state
            .conversation
            .runtime_checks
            .push(RuntimeCheck {
                label: "Desktop session store".to_string(),
                value: error.to_string(),
                tone: "error".to_string(),
            }),
    }
}

fn apply_session_records(desktop_state: &mut DesktopState, sessions: Vec<DesktopSessionRecord>) {
    if sessions.is_empty() {
        return;
    }
    let mut selected_result_items = Vec::new();
    let mut has_active_thread = false;
    desktop_state.sidebar.pinned_threads.clear();
    desktop_state.sidebar.threads.clear();
    for session in sessions {
        let active = !has_active_thread;
        if active {
            selected_result_items = session.result_items;
            has_active_thread = true;
        }
        let thread = SidebarThread {
            id: session.thread_id,
            title: session.title,
            time: "已保存".to_string(),
            active,
            agent_avatar: true,
        };
        if session.pinned {
            desktop_state.sidebar.pinned_threads.push(thread);
        } else {
            desktop_state.sidebar.threads.push(thread);
        }
    }
    desktop_state.conversation.result_items = selected_result_items;
}

fn merge_persisted_memory_items(
    desktop_state: &mut DesktopState,
    memory_store: &DesktopMemoryStore,
) {
    match memory_store.load_items() {
        Ok(items) => {
            desktop_state.memory_workspace.items =
                items.into_iter().map(memory_item_from_record).collect();
            if let Some(item) = desktop_state.memory_workspace.items.first() {
                desktop_state.memory_workspace.selected_item_id = item.id.clone();
                desktop_state.memory_workspace.selected_agent_id = item.agent_id.clone();
            }
        }
        Err(error) => desktop_state
            .conversation
            .runtime_checks
            .push(RuntimeCheck {
                label: "Desktop memory store".to_string(),
                value: error.to_string(),
                tone: "error".to_string(),
            }),
    }
}

fn merge_persisted_agents(desktop_state: &mut DesktopState, agent_store: &DesktopAgentStore) {
    match agent_store.load_agents() {
        Ok(agents) => {
            let mut persisted_agents = Vec::new();
            for agent in agents {
                match serde_json::from_value::<AgentProfile>(agent) {
                    Ok(mut agent) => {
                        retain_rust_native_agent_channels(&mut agent);
                        persisted_agents.push(agent);
                    }
                    Err(error) => desktop_state
                        .conversation
                        .runtime_checks
                        .push(RuntimeCheck {
                            label: "Desktop agent store".to_string(),
                            value: format!("Invalid desktop agent record: {error}"),
                            tone: "error".to_string(),
                        }),
                }
            }
            if let Some(agent) = persisted_agents.first() {
                desktop_state.agent_workspace.selected_agent_id = agent.id.clone();
                desktop_state.memory_workspace.selected_agent_id = agent.id.clone();
            }
            desktop_state.agent_workspace.agents = persisted_agents;
        }
        Err(error) => desktop_state
            .conversation
            .runtime_checks
            .push(RuntimeCheck {
                label: "Desktop agent store".to_string(),
                value: error.to_string(),
                tone: "error".to_string(),
            }),
    }
}

fn router(state: GatewayState) -> Router {
    Router::new()
        .route("/api/desktop/bootstrap", get(bootstrap))
        .route("/api/desktop/state", get(desktop_state))
        .route("/api/desktop/runtime", get(runtime_status))
        .route("/api/desktop/events", get(events))
        .route("/api/desktop/search", get(search))
        .route("/api/desktop/sessions", get(list_sessions))
        .route(
            "/api/desktop/sessions/{thread_id}/history",
            get(session_history),
        )
        .route("/api/desktop/sessions/spawn", post(spawn_session))
        .route("/api/desktop/sessions/send", post(send_session))
        .route("/api/desktop/sessions/yield", post(yield_session))
        .route("/api/desktop/subagents", get(list_subagents))
        .route("/api/desktop/navigation/select", post(select_nav))
        .route("/api/desktop/threads/select", post(select_thread))
        .route("/api/desktop/messages", post(send_message))
        .route(
            "/api/desktop/permissions/{request_id}/decision",
            post(permission_decision),
        )
        .route("/api/desktop/preferences", patch(update_preferences))
        .route("/api/desktop/agents/{agent_id}/select", post(select_agent))
        .route(
            "/api/desktop/memory/items/{item_id}/select",
            post(select_memory_item),
        )
        .route(
            "/api/desktop/memory/agents/{agent_id}/select",
            post(select_memory_agent),
        )
        .route("/api/desktop/memory/query", patch(set_memory_query))
        .route("/api/desktop/memory/filter", patch(set_memory_filter))
        .route(
            "/api/desktop/{*path}",
            post(bridge_path_mutation).patch(bridge_path_mutation),
        )
        .layer(
            CorsLayer::new()
                .allow_origin(Any)
                .allow_methods([Method::GET, Method::POST, Method::PATCH])
                .allow_headers(Any),
        )
        .with_state(state)
}

async fn bootstrap(State(state): State<GatewayState>) -> Json<BootstrapResponse> {
    let runtime = state.runtime_supervisor.status();
    let desktop_state = state.desktop_state.read().await.clone();
    Json(BootstrapResponse {
        app: state.app.clone(),
        api: state.api.clone(),
        runtime,
        desktop_state,
    })
}

async fn desktop_state(State(state): State<GatewayState>) -> Json<DesktopState> {
    Json(state.desktop_state.read().await.clone())
}

async fn runtime_status(State(state): State<GatewayState>) -> Json<RuntimeStatus> {
    Json(state.runtime_supervisor.status())
}

async fn search(
    State(state): State<GatewayState>,
    Query(query): Query<SearchQuery>,
) -> Json<Vec<SearchSuggestion>> {
    let normalized_query = query.q.unwrap_or_default().trim().to_lowercase();
    let desktop_state = state.desktop_state.read().await;
    let suggestions = desktop_state
        .search_suggestions
        .iter()
        .filter(|item| {
            normalized_query.is_empty()
                || format!("{} {}", item.label, item.meta)
                    .to_lowercase()
                    .contains(&normalized_query)
        })
        .cloned()
        .collect();

    Json(suggestions)
}

async fn events(
    State(state): State<GatewayState>,
    Query(query): Query<EventsQuery>,
) -> Result<Sse<impl futures_util::Stream<Item = Result<Event, Infallible>>>, StatusCode> {
    authorize_token(query.session_token.as_deref(), &state)?;

    let runtime = state.runtime_supervisor.status();
    let initial_event = RuntimeEvent {
        event_type: "runtime",
        status: runtime.status,
        detail: runtime.detail,
    };
    let initial_data = serde_json::to_string(&initial_event).unwrap_or_else(|_| "{}".to_string());
    let initial_stream = stream::once(async move {
        Ok(Event::default()
            .event(initial_event.event_type)
            .data(initial_data))
    });
    let receiver = state.events.subscribe();
    let updates = stream::unfold(receiver, |mut receiver| async move {
        loop {
            match receiver.recv().await {
                Ok(event) => return Some((Ok(event_to_sse(event)), receiver)),
                Err(broadcast::error::RecvError::Lagged(_)) => continue,
                Err(broadcast::error::RecvError::Closed) => return None,
            }
        }
    });

    Ok(Sse::new(initial_stream.chain(updates)).keep_alive(KeepAlive::default()))
}

async fn select_nav(
    State(state): State<GatewayState>,
    headers: HeaderMap,
    Json(payload): Json<SelectNavRequest>,
) -> Result<Json<DesktopState>, StatusCode> {
    authorize_headers(&headers, &state)?;
    {
        let mut desktop_state = state.desktop_state.write().await;
        let selectable = payload.nav_id == "settings"
            || desktop_state
                .sidebar
                .nav_items
                .iter()
                .any(|item| item.id == payload.nav_id && item.id != "search");
        if selectable {
            desktop_state.active_nav_id = payload.nav_id;
        }
    }
    emit_state_changed(&state).await
}

async fn send_message(
    State(state): State<GatewayState>,
    headers: HeaderMap,
    Json(payload): Json<SendMessageRequest>,
) -> Result<Json<DesktopState>, StatusCode> {
    authorize_headers(&headers, &state)?;
    let text = payload.text.trim();
    if text.is_empty() {
        return Err(StatusCode::BAD_REQUEST);
    }
    run_native_state_mutation(&state, "send_message", json!({ "text": text })).await
}

async fn select_thread(
    State(state): State<GatewayState>,
    headers: HeaderMap,
    Json(payload): Json<SelectThreadRequest>,
) -> Result<Json<DesktopState>, StatusCode> {
    authorize_headers(&headers, &state)?;
    let selected_session = state
        .session_store
        .load_session(&payload.thread_id)
        .map_err(|error| session_store_status(&state, error))?;
    {
        let mut desktop_state = state.desktop_state.write().await;
        for thread in desktop_state.sidebar.pinned_threads.iter_mut() {
            thread.active = thread.id == payload.thread_id;
        }
        for thread in desktop_state.sidebar.threads.iter_mut() {
            thread.active = thread.id == payload.thread_id;
        }
        for thread in desktop_state.sidebar.discussion_threads.iter_mut() {
            thread.active = thread.id == payload.thread_id;
        }
        if let Some(session) = selected_session {
            desktop_state.conversation.result_items = session.result_items;
        }
    }
    emit_state_changed(&state).await
}

async fn permission_decision(
    State(state): State<GatewayState>,
    headers: HeaderMap,
    Path(request_id): Path<String>,
    Json(payload): Json<PermissionDecisionRequest>,
) -> Result<Json<DesktopState>, StatusCode> {
    authorize_headers(&headers, &state)?;
    let permission_request = {
        let desktop_state = state.desktop_state.read().await;
        if desktop_state.permission_request.id != request_id {
            return Err(StatusCode::NOT_FOUND);
        }
        let mut permission_request = desktop_state.permission_request.clone();
        permission_request.status = payload.decision;
        permission_request
    };
    {
        let mut desktop_state = state.desktop_state.write().await;
        desktop_state.permission_request = permission_request.clone();
    }
    let _ = state
        .events
        .send(DesktopEvent::PermissionChanged { permission_request });
    emit_state_changed(&state).await
}

async fn update_preferences(
    State(state): State<GatewayState>,
    headers: HeaderMap,
    Json(payload): Json<PreferencesPatch>,
) -> Result<Json<DesktopState>, StatusCode> {
    authorize_headers(&headers, &state)?;
    let updated_preferences = {
        let desktop_state = state.desktop_state.read().await;
        let mut preferences = desktop_state.preferences.clone();
        if let Some(model) = payload.selected_model {
            preferences.selected_model = model;
        }
        if let Some(thinking) = payload.selected_thinking {
            preferences.selected_thinking = thinking;
        }
        if let Some(permission_mode) = payload.permission_mode {
            preferences.permission_mode = permission_mode;
        }
        preferences
    };
    persist_desktop_preferences(&state, &updated_preferences)?;
    {
        let mut desktop_state = state.desktop_state.write().await;
        desktop_state.preferences = updated_preferences;
    }
    emit_state_changed(&state).await
}

async fn select_agent(
    State(state): State<GatewayState>,
    headers: HeaderMap,
    Path(agent_id): Path<String>,
) -> Result<Json<DesktopState>, StatusCode> {
    authorize_headers(&headers, &state)?;
    {
        let mut desktop_state = state.desktop_state.write().await;
        if desktop_state
            .agent_workspace
            .agents
            .iter()
            .any(|agent| agent.id == agent_id)
        {
            desktop_state.agent_workspace.selected_agent_id = agent_id.clone();
            desktop_state.memory_workspace.selected_agent_id = agent_id;
        }
    }
    emit_state_changed(&state).await
}

async fn select_memory_item(
    State(state): State<GatewayState>,
    headers: HeaderMap,
    Path(item_id): Path<String>,
) -> Result<Json<DesktopState>, StatusCode> {
    authorize_headers(&headers, &state)?;
    {
        let mut desktop_state = state.desktop_state.write().await;
        if desktop_state
            .memory_workspace
            .items
            .iter()
            .any(|item| item.id == item_id)
        {
            desktop_state.memory_workspace.selected_item_id = item_id;
        }
    }
    emit_state_changed(&state).await
}

async fn select_memory_agent(
    State(state): State<GatewayState>,
    headers: HeaderMap,
    Path(agent_id): Path<String>,
) -> Result<Json<DesktopState>, StatusCode> {
    authorize_headers(&headers, &state)?;
    {
        let mut desktop_state = state.desktop_state.write().await;
        if desktop_state
            .agent_workspace
            .agents
            .iter()
            .any(|agent| agent.id == agent_id)
        {
            desktop_state.memory_workspace.selected_agent_id = agent_id;
        }
    }
    emit_state_changed(&state).await
}

async fn set_memory_query(
    State(state): State<GatewayState>,
    headers: HeaderMap,
    Json(payload): Json<MemoryQueryPatch>,
) -> Result<Json<DesktopState>, StatusCode> {
    authorize_headers(&headers, &state)?;
    {
        let mut desktop_state = state.desktop_state.write().await;
        desktop_state.memory_workspace.query = payload.query;
    }
    emit_state_changed(&state).await
}

async fn set_memory_filter(
    State(state): State<GatewayState>,
    headers: HeaderMap,
    Json(payload): Json<MemoryFilterPatch>,
) -> Result<Json<DesktopState>, StatusCode> {
    authorize_headers(&headers, &state)?;
    {
        let mut desktop_state = state.desktop_state.write().await;
        desktop_state.memory_workspace.filter = payload.filter;
    }
    emit_state_changed(&state).await
}

async fn list_sessions(
    State(state): State<GatewayState>,
    headers: HeaderMap,
) -> Result<Json<Value>, StatusCode> {
    authorize_headers(&headers, &state)?;
    let sessions = state
        .session_store
        .list_summaries()
        .map_err(|error| session_store_status(&state, error))?;
    Ok(Json(json!({ "sessions": sessions })))
}

async fn session_history(
    State(state): State<GatewayState>,
    headers: HeaderMap,
    Path(thread_id): Path<String>,
) -> Result<Json<Value>, StatusCode> {
    authorize_headers(&headers, &state)?;
    let messages = state
        .session_store
        .session_history(&thread_id)
        .map_err(|error| session_store_status(&state, error))?;
    Ok(Json(json!({
        "sessionKey": thread_id,
        "messages": messages
    })))
}

async fn spawn_session(
    State(state): State<GatewayState>,
    headers: HeaderMap,
    Json(payload): Json<SessionSpawnRequest>,
) -> Result<Json<Value>, StatusCode> {
    authorize_headers(&headers, &state)?;
    let task = payload.task.trim();
    if task.is_empty() {
        return Err(StatusCode::BAD_REQUEST);
    }
    let label = payload
        .label
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let parent = payload
        .parent_session_key
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let session = state
        .session_store
        .spawn_session(parent, label, task)
        .map_err(|error| session_store_status(&state, error))?;
    {
        let mut desktop_state = state.desktop_state.write().await;
        desktop_state.sidebar.discussion_threads.insert(
            0,
            SidebarThread {
                id: session.key.clone(),
                title: session.title.clone(),
                time: "子 agent".to_string(),
                active: false,
                agent_avatar: true,
            },
        );
    }
    let _ = state.events.send(DesktopEvent::SessionStarted {
        thread_id: session.key.clone(),
    });
    let _ = state.events.send(DesktopEvent::StateChanged {
        desktop_state: state.desktop_state.read().await.clone(),
    });
    Ok(Json(json!({ "status": "spawned", "session": session })))
}

async fn send_session(
    State(state): State<GatewayState>,
    headers: HeaderMap,
    Json(payload): Json<SessionSendRequest>,
) -> Result<Json<Value>, StatusCode> {
    authorize_headers(&headers, &state)?;
    let session_key = payload.session_key.trim();
    let message = payload.message.trim();
    if session_key.is_empty() || message.is_empty() {
        return Err(StatusCode::BAD_REQUEST);
    }
    let session = state
        .session_store
        .send_to_session(session_key, message)
        .map_err(|error| session_store_status(&state, error))?;
    {
        let mut desktop_state = state.desktop_state.write().await;
        if active_thread_id(&desktop_state).as_deref() == Some(session_key) {
            desktop_state
                .conversation
                .result_items
                .push(format!("用户: {message}"));
        }
    }
    let _ = state.events.send(DesktopEvent::MessageFinal {
        thread_id: session.key.clone(),
        text: message.to_string(),
    });
    let _ = state.events.send(DesktopEvent::StateChanged {
        desktop_state: state.desktop_state.read().await.clone(),
    });
    Ok(Json(json!({ "status": "sent", "session": session })))
}

async fn yield_session(
    State(state): State<GatewayState>,
    headers: HeaderMap,
    Json(payload): Json<SessionYieldRequest>,
) -> Result<Json<Value>, StatusCode> {
    authorize_headers(&headers, &state)?;
    let session_key = payload.session_key.trim();
    if session_key.is_empty() {
        return Err(StatusCode::BAD_REQUEST);
    }
    let session = state
        .session_store
        .mark_session_yielded(session_key)
        .map_err(|error| session_store_status(&state, error))?;
    let _ = state.events.send(DesktopEvent::StateChanged {
        desktop_state: state.desktop_state.read().await.clone(),
    });
    Ok(Json(json!({ "status": "yielded", "session": session })))
}

async fn list_subagents(
    State(state): State<GatewayState>,
    headers: HeaderMap,
    Query(query): Query<SubagentsQuery>,
) -> Result<Json<Value>, StatusCode> {
    authorize_headers(&headers, &state)?;
    let parent = query
        .parent_session_key
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let subagents = state
        .session_store
        .list_subagents(parent)
        .map_err(|error| session_store_status(&state, error))?;
    Ok(Json(json!({ "subagents": subagents })))
}

async fn bridge_path_mutation(
    State(state): State<GatewayState>,
    headers: HeaderMap,
    method: Method,
    Path(path): Path<String>,
    body: Bytes,
) -> Result<Json<DesktopState>, StatusCode> {
    authorize_headers(&headers, &state)?;
    let input = parse_json_body(body)?;
    let Some((operation, input)) = map_desktop_operation(&method, &path, input) else {
        return Err(StatusCode::NOT_IMPLEMENTED);
    };
    run_native_state_mutation(&state, operation, input).await
}

fn authorize_headers(headers: &HeaderMap, state: &GatewayState) -> Result<(), StatusCode> {
    authorize_token(
        headers
            .get(SESSION_HEADER)
            .and_then(|value| value.to_str().ok()),
        state,
    )
}

fn authorize_token(token: Option<&str>, state: &GatewayState) -> Result<(), StatusCode> {
    match token {
        Some(token) if token == state.api.session_token => Ok(()),
        _ => Err(StatusCode::UNAUTHORIZED),
    }
}

async fn emit_state_changed(state: &GatewayState) -> Result<Json<DesktopState>, StatusCode> {
    let desktop_state = state.desktop_state.read().await.clone();
    let _ = state.events.send(DesktopEvent::StateChanged {
        desktop_state: desktop_state.clone(),
    });
    Ok(Json(desktop_state))
}

async fn run_native_state_mutation(
    state: &GatewayState,
    operation: &str,
    input: Value,
) -> Result<Json<DesktopState>, StatusCode> {
    if state.runtime_supervisor.status().status != crate::models::RuntimeStatusValue::Ready {
        return Err(StatusCode::SERVICE_UNAVAILABLE);
    }
    apply_native_operation(state, operation, input).await
}

async fn apply_native_operation(
    state: &GatewayState,
    operation: &str,
    input: Value,
) -> Result<Json<DesktopState>, StatusCode> {
    match operation {
        "send_message" => {
            let text = string_field(&input, "text").ok_or(StatusCode::BAD_REQUEST)?;
            let thread_id = {
                let desktop_state = state.desktop_state.read().await;
                active_thread_id(&desktop_state)
                    .unwrap_or_else(|| format!("thread-{}", Uuid::new_v4().simple()))
            };
            let send_result = state
                .agent_runtime
                .send_message(thread_id, text)
                .await
                .map_err(|error| {
                    let _ = state.events.send(DesktopEvent::OperationFailed {
                        code: error.code().to_string(),
                        message: error.message().to_string(),
                    });
                    agent_runtime_error_status(&error)
                })?;
            {
                let mut desktop_state = state.desktop_state.write().await;
                if !has_thread(&desktop_state, &send_result.thread_id) {
                    desktop_state.sidebar.threads.insert(
                        0,
                        SidebarThread {
                            id: send_result.thread_id.clone(),
                            title: title_from_message(&send_result.user_text),
                            time: "刚刚".to_string(),
                            active: true,
                            agent_avatar: true,
                        },
                    );
                }
                desktop_state
                    .conversation
                    .result_items
                    .push(format!("用户: {}", send_result.user_text));
                desktop_state
                    .conversation
                    .result_items
                    .push(send_result.assistant_text.clone());
            }
            let _ = state.events.send(DesktopEvent::SessionStarted {
                thread_id: send_result.thread_id.clone(),
            });
            let _ = state.events.send(DesktopEvent::MessageDelta {
                thread_id: send_result.thread_id.clone(),
                text: send_result.assistant_text.clone(),
            });
            let _ = state.events.send(DesktopEvent::MessageFinal {
                thread_id: send_result.thread_id,
                text: send_result.assistant_text,
            });
            emit_state_changed(state).await
        }
        "abort_message" | "steer_message" => {
            if operation == "steer_message" {
                let _ = string_field(&input, "text").ok_or(StatusCode::BAD_REQUEST)?;
            }
            emit_operation_failed(
                state,
                "no_active_message",
                "No active Rust desktop message generation is running.",
            );
            Err(StatusCode::CONFLICT)
        }
        "create_agent" => {
            let name = string_field(&input, "name").unwrap_or_else(|| "New Agent".to_string());
            let role = string_field(&input, "role").unwrap_or_else(|| "Agent".to_string());
            let description = string_field(&input, "description").unwrap_or_default();
            let channels = match agent_channels_from_input(&input) {
                Ok(channels) => channels,
                Err(message) => {
                    emit_operation_failed(state, "invalid_channel", message);
                    return Err(StatusCode::BAD_REQUEST);
                }
            };
            let id = format!("agent-{}", Uuid::new_v4().simple());
            let agent = agent_profile(id.clone(), name, role, description, channels);
            persist_agent_profile(state, &agent)?;
            {
                let mut desktop_state = state.desktop_state.write().await;
                desktop_state.agent_workspace.selected_agent_id = id.clone();
                desktop_state.memory_workspace.selected_agent_id = id.clone();
                desktop_state.agent_workspace.agents.push(agent);
            }
            emit_state_changed(state).await
        }
        "update_agent" => {
            let agent_id = string_field(&input, "agentId").ok_or(StatusCode::BAD_REQUEST)?;
            let mut updated_agent = {
                let desktop_state = state.desktop_state.read().await;
                desktop_state
                    .agent_workspace
                    .agents
                    .iter()
                    .find(|agent| agent.id == agent_id)
                    .cloned()
                    .ok_or(StatusCode::NOT_FOUND)?
            };
            if let Some(name) = string_field(&input, "name") {
                updated_agent.name = name;
            }
            if let Some(role) = string_field(&input, "role") {
                updated_agent.role = role;
            }
            if let Some(description) = string_field(&input, "description") {
                updated_agent.description = description;
            }
            persist_agent_profile(state, &updated_agent)?;
            {
                let mut desktop_state = state.desktop_state.write().await;
                if let Some(agent) = desktop_state
                    .agent_workspace
                    .agents
                    .iter_mut()
                    .find(|agent| agent.id == agent_id)
                {
                    *agent = updated_agent;
                }
            }
            emit_state_changed(state).await
        }
        "create_memory_item" => {
            let title = string_field(&input, "title").ok_or(StatusCode::BAD_REQUEST)?;
            let summary = string_field(&input, "summary").unwrap_or_default();
            let content = string_field(&input, "content").unwrap_or_default();
            let category = string_field(&input, "category").unwrap_or_else(|| "其他".to_string());
            let source = string_field(&input, "source").unwrap_or_else(|| "Desktop".to_string());
            let id = format!("memory-{}", Uuid::new_v4().simple());
            let default_agent_id = state
                .desktop_state
                .read()
                .await
                .memory_workspace
                .selected_agent_id
                .clone();
            let item = MemoryItem {
                id: id.clone(),
                agent_id: string_field(&input, "agentId")
                    .filter(|value| !value.is_empty())
                    .unwrap_or(default_agent_id),
                title,
                summary,
                content,
                category,
                tags: string_array_field(&input, "tags"),
                source,
                updated_at: "刚刚".to_string(),
                archived: false,
            };
            persist_memory_item(state, &item)?;
            {
                let mut desktop_state = state.desktop_state.write().await;
                desktop_state.memory_workspace.selected_item_id = id.clone();
                desktop_state.memory_workspace.items.push(item);
            }
            emit_state_changed(state).await
        }
        "archive_memory_item" => {
            let item_id = string_field(&input, "itemId").ok_or(StatusCode::BAD_REQUEST)?;
            let mut item = {
                let desktop_state = state.desktop_state.read().await;
                desktop_state
                    .memory_workspace
                    .items
                    .iter()
                    .find(|item| item.id == item_id)
                    .cloned()
                    .ok_or(StatusCode::NOT_FOUND)?
            };
            item.archived = true;
            item.updated_at = "刚刚".to_string();
            state
                .memory_store
                .archive_item(&item_id)
                .map_err(|error| memory_store_status(state, error))?;
            {
                let mut desktop_state = state.desktop_state.write().await;
                if let Some(item) = desktop_state
                    .memory_workspace
                    .items
                    .iter_mut()
                    .find(|item| item.id == item_id)
                {
                    item.archived = true;
                }
            }
            emit_state_changed(state).await
        }
        "update_memory_item" => {
            let item_id = string_field(&input, "itemId").ok_or(StatusCode::BAD_REQUEST)?;
            let mut updated_item = {
                let desktop_state = state.desktop_state.read().await;
                desktop_state
                    .memory_workspace
                    .items
                    .iter()
                    .find(|item| item.id == item_id)
                    .cloned()
                    .ok_or(StatusCode::NOT_FOUND)?
            };
            if let Some(title) = string_field(&input, "title") {
                updated_item.title = title;
            }
            if let Some(summary) = string_field(&input, "summary") {
                updated_item.summary = summary;
            }
            if let Some(content) = string_field(&input, "content") {
                updated_item.content = content;
            }
            if let Some(category) = string_field(&input, "category") {
                updated_item.category = category;
            }
            updated_item.updated_at = "刚刚".to_string();
            persist_memory_item(state, &updated_item)?;
            {
                let mut desktop_state = state.desktop_state.write().await;
                if let Some(item) = desktop_state
                    .memory_workspace
                    .items
                    .iter_mut()
                    .find(|item| item.id == item_id)
                {
                    *item = updated_item;
                }
            }
            emit_state_changed(state).await
        }
        "add_plugin_skill" => {
            let name = string_field(&input, "name").ok_or(StatusCode::BAD_REQUEST)?;
            let trigger = normalize_skill_trigger(
                string_field(&input, "trigger").unwrap_or_else(|| name.clone()),
            );
            let skill = PluginHostSkill {
                id: format!("plugin-skill-{}", Uuid::new_v4().simple()),
                name,
                trigger,
                description: string_field(&input, "description").unwrap_or_default(),
                status: "enabled".to_string(),
                source: "desktop".to_string(),
                icon: "sparkles".to_string(),
                open: false,
            };
            let skill = add_custom_plugin_skill(&state.runtime_root, skill)
                .map_err(|error| plugin_host_status(state, error))?;
            {
                let mut desktop_state = state.desktop_state.write().await;
                if let Some(existing) = desktop_state
                    .plugins_workspace
                    .skills
                    .iter_mut()
                    .find(|existing| existing.trigger == skill.trigger || existing.id == skill.id)
                {
                    *existing = plugin_skill(skill);
                } else {
                    desktop_state
                        .plugins_workspace
                        .skills
                        .push(plugin_skill(skill));
                }
                desktop_state.active_nav_id = "plugins".to_string();
            }
            emit_state_changed(state).await
        }
        "invoke_plugin_tool" => invoke_plugin_tool_operation(state, input).await,
        "add_agent_skill" => {
            let agent_id = string_field(&input, "agentId").ok_or(StatusCode::BAD_REQUEST)?;
            let mut agent = {
                let desktop_state = state.desktop_state.read().await;
                desktop_state
                    .agent_workspace
                    .agents
                    .iter()
                    .find(|agent| agent.id == agent_id)
                    .cloned()
                    .ok_or(StatusCode::NOT_FOUND)?
            };
            let name = string_field(&input, "name").ok_or(StatusCode::BAD_REQUEST)?;
            let trigger = normalize_skill_trigger(
                string_field(&input, "trigger").unwrap_or_else(|| name.clone()),
            );
            let skill = AgentSkill {
                id: format!("agent-skill-{}", Uuid::new_v4().simple()),
                name,
                trigger,
                description: string_field(&input, "description").unwrap_or_default(),
                status: "enabled".to_string(),
                source: "desktop".to_string(),
                icon: "sparkles".to_string(),
                open: false,
                enabled: true,
            };
            if let Some(existing) = agent
                .skills
                .iter_mut()
                .find(|existing| existing.trigger == skill.trigger)
            {
                *existing = skill;
            } else {
                agent.skills.push(skill);
            }
            persist_agent_profile(state, &agent)?;
            {
                let mut desktop_state = state.desktop_state.write().await;
                if let Some(existing) = desktop_state
                    .agent_workspace
                    .agents
                    .iter_mut()
                    .find(|existing| existing.id == agent_id)
                {
                    *existing = agent;
                }
            }
            emit_state_changed(state).await
        }
        "run_memory_dream" => {
            let selected_agent_id = {
                let desktop_state = state.desktop_state.read().await;
                string_field(&input, "agentId")
                    .unwrap_or_else(|| desktop_state.memory_workspace.selected_agent_id.clone())
            };
            let agent = {
                let desktop_state = state.desktop_state.read().await;
                desktop_state
                    .agent_workspace
                    .agents
                    .iter()
                    .find(|agent| agent.id == selected_agent_id)
                    .cloned()
                    .ok_or(StatusCode::NOT_FOUND)?
            };
            let dream_result = SpecialAgentRunner::new(state.runtime_root.clone())
                .dream_store()
                .run(&agent.id, "desktop memory dream")
                .map_err(|error| {
                    eprintln!("[desktop-gateway] memory dream failed: {error}");
                    StatusCode::INTERNAL_SERVER_ERROR
                })?;
            {
                let mut desktop_state = state.desktop_state.write().await;
                desktop_state.active_nav_id = "memory".to_string();
                desktop_state.memory_workspace.selected_agent_id = agent.id.clone();
                desktop_state.memory_workspace.query.clear();
                desktop_state.memory_workspace.filter = "全部".to_string();
                desktop_state.memory_workspace.selected_item_id =
                    first_visible_memory_item_id(&desktop_state, &agent.id).unwrap_or_default();
                desktop_state.memory_workspace.dream.status = "completed".to_string();
                desktop_state.memory_workspace.dream.agent_id = agent.id;
                desktop_state.memory_workspace.dream.message = format!(
                    "{} 的记忆整理已由 Rust special-agent 完成：{}",
                    agent.name,
                    dream_result["runId"].as_str().unwrap_or("dream")
                );
                desktop_state.memory_workspace.dream.last_run_at = "刚刚".to_string();
            }
            emit_state_changed(state).await
        }
        "pin_thread" | "unpin_thread" | "rename_thread" | "archive_thread" => {
            update_thread_operation(state, operation, input).await
        }
        "toggle_plugin_tool"
        | "toggle_plugin_skill"
        | "toggle_agent_tool"
        | "toggle_agent_skill" => toggle_operation(state, operation, input).await,
        _ => {
            let _ = state.events.send(DesktopEvent::OperationFailed {
                code: "unsupported".to_string(),
                message: format!("Desktop operation is not supported by Rust runtime: {operation}"),
            });
            Err(StatusCode::NOT_IMPLEMENTED)
        }
    }
}

fn agent_runtime_error_status(error: &AgentRuntimeError) -> StatusCode {
    match error {
        AgentRuntimeError::ProviderUnavailable(_) => StatusCode::SERVICE_UNAVAILABLE,
        AgentRuntimeError::UnsupportedProvider(_) => StatusCode::NOT_IMPLEMENTED,
        AgentRuntimeError::ProviderFailed(_) | AgentRuntimeError::TranscriptFailed(_) => {
            StatusCode::INTERNAL_SERVER_ERROR
        }
    }
}

fn persist_memory_item(state: &GatewayState, item: &MemoryItem) -> Result<(), StatusCode> {
    state
        .memory_store
        .upsert_item(memory_record_from_item(item))
        .map_err(|error| memory_store_status(state, error))
}

fn persist_agent_profile(state: &GatewayState, agent: &AgentProfile) -> Result<(), StatusCode> {
    state
        .agent_store
        .upsert_agent(
            &agent.id,
            serde_json::to_value(agent).map_err(|error| {
                agent_store_status(
                    state,
                    DesktopAgentStoreError::Invalid(format!(
                        "Failed to serialize desktop agent: {error}"
                    )),
                )
            })?,
        )
        .map_err(|error| agent_store_status(state, error))
}

fn persist_desktop_preferences(
    state: &GatewayState,
    preferences: &DesktopPreferences,
) -> Result<(), StatusCode> {
    state
        .preferences_store
        .save_preferences(&DesktopPreferencesRecord {
            selected_model: preferences.selected_model.clone(),
            selected_thinking: preferences.selected_thinking.clone(),
            permission_mode: preferences.permission_mode.clone(),
        })
        .map_err(|error| preferences_store_status(state, error))
}

fn agent_store_status(state: &GatewayState, error: DesktopAgentStoreError) -> StatusCode {
    let _ = state.events.send(DesktopEvent::OperationFailed {
        code: "agent_store_failed".to_string(),
        message: error.to_string(),
    });
    StatusCode::INTERNAL_SERVER_ERROR
}

fn preferences_store_status(
    state: &GatewayState,
    error: DesktopPreferencesStoreError,
) -> StatusCode {
    let _ = state.events.send(DesktopEvent::OperationFailed {
        code: "preferences_store_failed".to_string(),
        message: error.to_string(),
    });
    StatusCode::INTERNAL_SERVER_ERROR
}

fn session_store_status(state: &GatewayState, error: DesktopSessionStoreError) -> StatusCode {
    let _ = state.events.send(DesktopEvent::OperationFailed {
        code: "session_store_failed".to_string(),
        message: error.to_string(),
    });
    StatusCode::INTERNAL_SERVER_ERROR
}

fn memory_store_status(state: &GatewayState, error: DesktopMemoryStoreError) -> StatusCode {
    emit_operation_failed(state, "memory_store_failed", error.to_string());
    StatusCode::INTERNAL_SERVER_ERROR
}

fn plugin_host_status(state: &GatewayState, error: PluginHostError) -> StatusCode {
    emit_operation_failed(state, "plugin_host_failed", error.to_string());
    StatusCode::INTERNAL_SERVER_ERROR
}

fn emit_operation_failed(
    state: &GatewayState,
    code: impl Into<String>,
    message: impl Into<String>,
) {
    let _ = state.events.send(DesktopEvent::OperationFailed {
        code: code.into(),
        message: message.into(),
    });
}

fn memory_record_from_item(item: &MemoryItem) -> DesktopMemoryRecord {
    DesktopMemoryRecord {
        id: item.id.clone(),
        agent_id: item.agent_id.clone(),
        title: item.title.clone(),
        summary: item.summary.clone(),
        content: item.content.clone(),
        category: item.category.clone(),
        tags: item.tags.clone(),
        source: item.source.clone(),
        updated_at: item.updated_at.clone(),
        archived: item.archived,
    }
}

fn memory_item_from_record(record: DesktopMemoryRecord) -> MemoryItem {
    MemoryItem {
        id: record.id,
        agent_id: record.agent_id,
        title: record.title,
        summary: record.summary,
        content: record.content,
        category: record.category,
        tags: record.tags,
        source: record.source,
        updated_at: record.updated_at,
        archived: record.archived,
    }
}

fn plugin_tool(tool: PluginHostTool) -> PluginTool {
    PluginTool {
        id: tool.id,
        name: tool.name,
        description: tool.description,
        status: tool.status,
        permission: tool.permission,
        icon: tool.icon,
        open: tool.open,
    }
}

fn plugin_skill(skill: PluginHostSkill) -> PluginSkill {
    PluginSkill {
        id: skill.id,
        name: skill.name,
        trigger: skill.trigger,
        description: skill.description,
        status: skill.status,
        source: skill.source,
        icon: skill.icon,
        open: skill.open,
    }
}

async fn update_thread_operation(
    state: &GatewayState,
    operation: &str,
    input: Value,
) -> Result<Json<DesktopState>, StatusCode> {
    let thread_id = string_field(&input, "threadId").ok_or(StatusCode::BAD_REQUEST)?;
    let title = if operation == "rename_thread" {
        Some(string_field(&input, "title").ok_or(StatusCode::BAD_REQUEST)?)
    } else {
        None
    };
    {
        let desktop_state = state.desktop_state.read().await;
        if !has_thread(&desktop_state, &thread_id) {
            return Err(StatusCode::NOT_FOUND);
        }
    }
    match operation {
        "pin_thread" => state
            .session_store
            .set_thread_pinned(&thread_id, true)
            .map_err(|error| session_store_status(state, error))?,
        "unpin_thread" => state
            .session_store
            .set_thread_pinned(&thread_id, false)
            .map_err(|error| session_store_status(state, error))?,
        "rename_thread" => state
            .session_store
            .rename_thread(&thread_id, title.as_deref().unwrap_or_default())
            .map_err(|error| session_store_status(state, error))?,
        "archive_thread" => state
            .session_store
            .archive_thread(&thread_id)
            .map_err(|error| session_store_status(state, error))?,
        _ => {}
    }
    let mut next_thread_id = None;
    {
        let mut desktop_state = state.desktop_state.write().await;
        match operation {
            "pin_thread" => {
                if let Some(thread) = remove_thread(&mut desktop_state.sidebar.threads, &thread_id)
                {
                    desktop_state.sidebar.pinned_threads.push(thread);
                }
            }
            "unpin_thread" => {
                if let Some(thread) =
                    remove_thread(&mut desktop_state.sidebar.pinned_threads, &thread_id)
                {
                    desktop_state.sidebar.threads.insert(0, thread);
                }
            }
            "rename_thread" => {
                let title = title.expect("rename title validated");
                rename_thread(&mut desktop_state.sidebar.threads, &thread_id, &title);
                rename_thread(
                    &mut desktop_state.sidebar.pinned_threads,
                    &thread_id,
                    &title,
                );
                rename_thread(
                    &mut desktop_state.sidebar.discussion_threads,
                    &thread_id,
                    &title,
                );
            }
            "archive_thread" => {
                remove_thread(&mut desktop_state.sidebar.threads, &thread_id);
                remove_thread(&mut desktop_state.sidebar.pinned_threads, &thread_id);
                if active_thread_id(&desktop_state).is_none() {
                    next_thread_id = activate_first_visible_thread(&mut desktop_state);
                    if next_thread_id.is_none() {
                        desktop_state.conversation.result_items.clear();
                    }
                }
            }
            _ => {}
        }
    }
    if let Some(thread_id) = next_thread_id {
        if let Some(session) = state
            .session_store
            .load_session(&thread_id)
            .map_err(|error| session_store_status(state, error))?
        {
            state.desktop_state.write().await.conversation.result_items = session.result_items;
        }
    }
    emit_state_changed(state).await
}

async fn invoke_plugin_tool_operation(
    state: &GatewayState,
    input: Value,
) -> Result<Json<DesktopState>, StatusCode> {
    let plugin_id = string_field(&input, "pluginId").ok_or(StatusCode::BAD_REQUEST)?;
    let tool_id = string_field(&input, "toolId").ok_or(StatusCode::BAD_REQUEST)?;
    let tool_input = input.get("input").cloned().unwrap_or_else(|| json!({}));
    let thread_id = format!("plugin:{plugin_id}");
    let _ = state.events.send(DesktopEvent::ToolCall {
        thread_id: thread_id.clone(),
        tool_id: tool_id.clone(),
    });
    let result =
        match invoke_rust_native_plugin_tool(state, &plugin_id, &tool_id, &tool_input).await {
            Some(Ok(result)) => result,
            Some(Err(error)) => {
                let _ = state.events.send(DesktopEvent::ToolResult {
                    thread_id,
                    tool_id,
                    ok: false,
                });
                return Err(plugin_host_status(state, PluginHostError::Invalid(error)));
            }
            None => {
                if is_rust_native_plugin_id(&plugin_id) {
                    let _ = state.events.send(DesktopEvent::ToolResult {
                        thread_id: thread_id.clone(),
                        tool_id: tool_id.clone(),
                        ok: false,
                    });
                    return Err(plugin_host_status(
                        state,
                        PluginHostError::Invalid(format!(
                            "Rust-native plugin \"{plugin_id}\" does not expose tool \"{tool_id}\""
                        )),
                    ));
                }
                match invoke_node_plugin_tool(&state.runtime_root, &plugin_id, &tool_id, tool_input)
                    .await
                {
                    Ok(result) => result,
                    Err(error) => {
                        let _ = state.events.send(DesktopEvent::ToolResult {
                            thread_id,
                            tool_id,
                            ok: false,
                        });
                        return Err(plugin_host_status(state, error));
                    }
                }
            }
        };
    let result_text = plugin_tool_result_text(&result);
    {
        let mut desktop_state = state.desktop_state.write().await;
        desktop_state.active_nav_id = "plugins".to_string();
        desktop_state
            .conversation
            .result_items
            .push(format!("{plugin_id}/{tool_id}: {result_text}"));
    }
    let _ = state.events.send(DesktopEvent::ToolResult {
        thread_id,
        tool_id,
        ok: true,
    });
    emit_state_changed(state).await
}

fn is_rust_native_plugin_id(plugin_id: &str) -> bool {
    matches!(
        plugin_id,
        "comfyui" | "open-websearch" | "scrapling-fetch" | "qwen3-tts"
    )
}

async fn invoke_rust_native_plugin_tool(
    state: &GatewayState,
    plugin_id: &str,
    tool_id: &str,
    input: &Value,
) -> Option<Result<Value, String>> {
    match (plugin_id, tool_id) {
        ("comfyui", "comfyui_workflow") => Some(invoke_comfyui_native_tool(state, input).await),
        ("open-websearch", "open_websearch_search") => Some(
            run_open_websearch_search(native_tool_input(state, input))
                .await
                .map_err(|error| error.to_string()),
        ),
        ("scrapling-fetch", "scrapling_fetch") => Some(
            run_scrapling_fetch(native_tool_input(state, input))
                .await
                .map_err(|error| error.to_string()),
        ),
        ("qwen3-tts", "qwen3_tts_build_payload") => {
            Some(build_synthesis_payload(input).map_err(|error| error.to_string()))
        }
        ("qwen3-tts", "qwen3_tts_synthesize") => Some(
            synthesize_qwen3_tts(input.clone())
                .await
                .map_err(|error| error.to_string()),
        ),
        _ => None,
    }
}

async fn invoke_comfyui_native_tool(state: &GatewayState, input: &Value) -> Result<Value, String> {
    let action = input
        .get("action")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let operation = match action {
        Some(
            operation @ ("config" | "status" | "workflows-list" | "workflow-get" | "runs-list"
            | "outputs-list"),
        ) => operation,
        _ => "tool",
    };
    let native_input = json!({
        "params": input,
        "pluginConfig": input.get("pluginConfig").cloned().unwrap_or_else(|| json!({})),
        "workspaceDir": state.runtime_root.to_string_lossy()
    });
    handle_comfyui(operation, native_input)
        .await
        .map_err(|error| error.to_string())
}

fn native_tool_input(state: &GatewayState, input: &Value) -> Value {
    json!({
        "params": input,
        "pluginConfig": input.get("pluginConfig").cloned().unwrap_or_else(|| json!({})),
        "workspaceDir": state.runtime_root.to_string_lossy()
    })
}

fn plugin_tool_result_text(result: &Value) -> String {
    match result {
        Value::String(text) => text.clone(),
        _ => serde_json::to_string(result).unwrap_or_else(|_| "null".to_string()),
    }
}

async fn toggle_operation(
    state: &GatewayState,
    operation: &str,
    input: Value,
) -> Result<Json<DesktopState>, StatusCode> {
    if operation == "toggle_agent_tool" || operation == "toggle_agent_skill" {
        return toggle_agent_operation(state, operation, input).await;
    }
    let mut changed = false;
    {
        let mut desktop_state = state.desktop_state.write().await;
        match operation {
            "toggle_plugin_tool" => {
                let tool_id = string_field(&input, "toolId").ok_or(StatusCode::BAD_REQUEST)?;
                if let Some(tool) = desktop_state
                    .plugins_workspace
                    .tools
                    .iter_mut()
                    .find(|tool| tool.id == tool_id)
                {
                    tool.open = toggle_plugin_tool_open(&state.runtime_root, &tool_id)
                        .map_err(|error| plugin_host_status(state, error))?;
                    changed = true;
                }
            }
            "toggle_plugin_skill" => {
                let skill_id = string_field(&input, "skillId").ok_or(StatusCode::BAD_REQUEST)?;
                if let Some(skill) = desktop_state
                    .plugins_workspace
                    .skills
                    .iter_mut()
                    .find(|skill| skill.id == skill_id)
                {
                    skill.open = toggle_plugin_skill_open(&state.runtime_root, &skill_id)
                        .map_err(|error| plugin_host_status(state, error))?;
                    changed = true;
                }
            }
            _ => {}
        }
    }
    if !changed {
        return Err(StatusCode::NOT_FOUND);
    }
    emit_state_changed(state).await
}

async fn toggle_agent_operation(
    state: &GatewayState,
    operation: &str,
    input: Value,
) -> Result<Json<DesktopState>, StatusCode> {
    let agent_id = string_field(&input, "agentId").ok_or(StatusCode::BAD_REQUEST)?;
    let mut agent = {
        let desktop_state = state.desktop_state.read().await;
        desktop_state
            .agent_workspace
            .agents
            .iter()
            .find(|agent| agent.id == agent_id)
            .cloned()
            .ok_or(StatusCode::NOT_FOUND)?
    };
    let changed = match operation {
        "toggle_agent_tool" => {
            let tool_id = string_field(&input, "toolId").ok_or(StatusCode::BAD_REQUEST)?;
            if let Some(tool) = agent.tools.iter_mut().find(|tool| tool.id == tool_id) {
                tool.enabled = !tool.enabled;
                true
            } else {
                false
            }
        }
        "toggle_agent_skill" => {
            let skill_id = string_field(&input, "skillId").ok_or(StatusCode::BAD_REQUEST)?;
            if let Some(skill) = agent.skills.iter_mut().find(|skill| skill.id == skill_id) {
                skill.enabled = !skill.enabled;
                true
            } else {
                false
            }
        }
        _ => false,
    };
    if !changed {
        return Err(StatusCode::NOT_FOUND);
    }
    persist_agent_profile(state, &agent)?;
    {
        let mut desktop_state = state.desktop_state.write().await;
        if let Some(existing) = desktop_state
            .agent_workspace
            .agents
            .iter_mut()
            .find(|existing| existing.id == agent_id)
        {
            *existing = agent;
        }
    }
    emit_state_changed(state).await
}

fn parse_json_body(body: Bytes) -> Result<Value, StatusCode> {
    if body.is_empty() {
        return Ok(json!({}));
    }
    serde_json::from_slice(&body).map_err(|_| StatusCode::BAD_REQUEST)
}

fn map_desktop_operation(
    method: &Method,
    path: &str,
    input: Value,
) -> Option<(&'static str, Value)> {
    if path == "plugins/skills" && *method == Method::POST {
        return Some(("add_plugin_skill", input));
    }
    if path == "agents" && *method == Method::POST {
        return Some(("create_agent", input));
    }
    if path == "memory/items" && *method == Method::POST {
        return Some(("create_memory_item", input));
    }
    if path == "memory/dream/run" && *method == Method::POST {
        return Some(("run_memory_dream", input));
    }
    if path == "messages/abort" && *method == Method::POST {
        return Some(("abort_message", input));
    }
    if path == "messages/steer" && *method == Method::POST {
        return Some(("steer_message", input));
    }
    if let Some(tool_id) = path
        .strip_prefix("plugins/tools/")
        .and_then(|path| path.strip_suffix("/toggle"))
    {
        return Some(("toggle_plugin_tool", with_string(input, "toolId", tool_id)));
    }
    if let Some(rest) = path.strip_prefix("plugins/") {
        if let Some((plugin_id, rest)) = rest.split_once("/tools/") {
            if let Some(tool_id) = rest.strip_suffix("/invoke") {
                return Some((
                    "invoke_plugin_tool",
                    with_string(with_string(input, "pluginId", plugin_id), "toolId", tool_id),
                ));
            }
        }
    }
    if let Some(skill_id) = path
        .strip_prefix("plugins/skills/")
        .and_then(|path| path.strip_suffix("/toggle"))
    {
        return Some((
            "toggle_plugin_skill",
            with_string(input, "skillId", skill_id),
        ));
    }
    if let Some(agent_id) = path.strip_prefix("agents/") {
        if let Some(agent_id) = agent_id.strip_suffix("/select") {
            return Some(("select_agent", with_string(input, "agentId", agent_id)));
        }
        if let Some(rest) = agent_id.split_once("/tools/") {
            if let Some(tool_id) = rest.1.strip_suffix("/toggle") {
                return Some((
                    "toggle_agent_tool",
                    with_string(with_string(input, "agentId", rest.0), "toolId", tool_id),
                ));
            }
        }
        if let Some(rest) = agent_id.split_once("/skills/") {
            if let Some(skill_id) = rest.1.strip_suffix("/toggle") {
                return Some((
                    "toggle_agent_skill",
                    with_string(with_string(input, "agentId", rest.0), "skillId", skill_id),
                ));
            }
        }
        if let Some(agent_id) = agent_id.strip_suffix("/skills") {
            return Some(("add_agent_skill", with_string(input, "agentId", agent_id)));
        }
        if *method == Method::PATCH {
            return Some(("update_agent", with_string(input, "agentId", agent_id)));
        }
    }
    if let Some(thread_id) = path.strip_prefix("threads/") {
        if let Some(thread_id) = thread_id.strip_suffix("/pin") {
            return Some(("pin_thread", with_string(input, "threadId", thread_id)));
        }
        if let Some(thread_id) = thread_id.strip_suffix("/unpin") {
            return Some(("unpin_thread", with_string(input, "threadId", thread_id)));
        }
        if let Some(thread_id) = thread_id.strip_suffix("/rename") {
            return Some(("rename_thread", with_string(input, "threadId", thread_id)));
        }
        if let Some(thread_id) = thread_id.strip_suffix("/archive") {
            return Some(("archive_thread", with_string(input, "threadId", thread_id)));
        }
    }
    if let Some(item_id) = path.strip_prefix("memory/items/") {
        if let Some(item_id) = item_id.strip_suffix("/archive") {
            return Some(("archive_memory_item", with_string(input, "itemId", item_id)));
        }
        if *method == Method::PATCH {
            return Some(("update_memory_item", with_string(input, "itemId", item_id)));
        }
    }
    None
}

fn with_string(input: Value, key: &str, value: &str) -> Value {
    let mut object = match input {
        Value::Object(object) => object,
        _ => Map::new(),
    };
    object.insert(key.to_string(), Value::String(value.to_string()));
    Value::Object(object)
}

fn string_field(input: &Value, key: &str) -> Option<String> {
    input
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
}

fn string_array_field(input: &Value, key: &str) -> Vec<String> {
    input
        .get(key)
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(ToOwned::to_owned)
                .collect()
        })
        .unwrap_or_default()
}

fn normalize_skill_trigger(trigger: String) -> String {
    let trigger = trigger.trim();
    if trigger.starts_with('@') {
        trigger.to_string()
    } else {
        format!("@{trigger}")
    }
}

fn active_thread_id(desktop_state: &DesktopState) -> Option<String> {
    desktop_state
        .sidebar
        .pinned_threads
        .iter()
        .chain(desktop_state.sidebar.threads.iter())
        .chain(desktop_state.sidebar.discussion_threads.iter())
        .find(|thread| thread.active)
        .map(|thread| thread.id.clone())
}

fn first_visible_memory_item_id(desktop_state: &DesktopState, agent_id: &str) -> Option<String> {
    desktop_state
        .memory_workspace
        .items
        .iter()
        .find(|item| item.agent_id == agent_id && !item.archived)
        .map(|item| item.id.clone())
}

fn activate_first_visible_thread(desktop_state: &mut DesktopState) -> Option<String> {
    for thread in desktop_state
        .sidebar
        .pinned_threads
        .iter_mut()
        .chain(desktop_state.sidebar.threads.iter_mut())
        .chain(desktop_state.sidebar.discussion_threads.iter_mut())
    {
        thread.active = true;
        return Some(thread.id.clone());
    }
    None
}

fn has_thread(desktop_state: &DesktopState, thread_id: &str) -> bool {
    desktop_state
        .sidebar
        .pinned_threads
        .iter()
        .chain(desktop_state.sidebar.threads.iter())
        .chain(desktop_state.sidebar.discussion_threads.iter())
        .any(|thread| thread.id == thread_id)
}

fn remove_thread(threads: &mut Vec<SidebarThread>, thread_id: &str) -> Option<SidebarThread> {
    let index = threads.iter().position(|thread| thread.id == thread_id)?;
    Some(threads.remove(index))
}

fn rename_thread(threads: &mut [SidebarThread], thread_id: &str, title: &str) {
    if let Some(thread) = threads.iter_mut().find(|thread| thread.id == thread_id) {
        thread.title = title.to_string();
    }
}

fn title_from_message(text: &str) -> String {
    let mut title = text.chars().take(32).collect::<String>();
    if text.chars().count() > 32 {
        title.push_str("...");
    }
    title
}

fn agent_profile(
    id: String,
    name: String,
    role: String,
    description: String,
    channels: Vec<AgentChannelBinding>,
) -> AgentProfile {
    let avatar_initials = initials(&name);
    AgentProfile {
        id,
        name,
        role,
        description,
        status: "ready".to_string(),
        model: "gpt-5.5".to_string(),
        thinking: "high".to_string(),
        permission_mode: "工作区模式".to_string(),
        emotion: AgentEmotionProfile {
            style: "neutral".to_string(),
            tone: "direct".to_string(),
            boundaries: Vec::new(),
            prompt_md: String::new(),
        },
        voice: AgentVoiceConfig {
            enabled: false,
            input_enabled: false,
            output_enabled: false,
            wake_enabled: false,
            source: "qwen-preset".to_string(),
            preset_voice: "Cherry".to_string(),
            design_prompt: String::new(),
            clone_voice_name: String::new(),
            clone_sample_name: String::new(),
            style: String::new(),
            pace: String::new(),
        },
        channels,
        avatar: AgentAvatarProfile {
            initials: avatar_initials,
            gradient: "cyan".to_string(),
            image_data_url: None,
            source: None,
        },
        tools: Vec::new(),
        skills: Vec::new(),
    }
}

fn agent_channels_from_input(input: &Value) -> Result<Vec<AgentChannelBinding>, String> {
    let Some(channels_value) = input.get("channels") else {
        return Ok(Vec::new());
    };
    let mut channels = serde_json::from_value::<Vec<AgentChannelBinding>>(channels_value.clone())
        .map_err(|error| format!("Invalid agent channel payload: {error}"))?;
    for channel in &mut channels {
        if !is_desktop_or_native_channel_id(&channel.id) {
            return Err(format!(
                "Unsupported desktop channel id '{}'; channel must be declared in the Rust native channel catalog.",
                channel.id
            ));
        }
        normalize_agent_channel(channel);
    }
    dedupe_agent_channels(&mut channels);
    Ok(channels)
}

fn retain_rust_native_agent_channels(agent: &mut AgentProfile) {
    agent
        .channels
        .retain(|channel| is_desktop_or_native_channel_id(&channel.id));
    for channel in &mut agent.channels {
        normalize_agent_channel(channel);
    }
    dedupe_agent_channels(&mut agent.channels);
}

fn normalize_agent_channel(channel: &mut AgentChannelBinding) {
    if channel.id == "desktop" {
        channel.label = "桌面".to_string();
        if channel.config.is_none() {
            channel.config = Some(default_agent_channel_config("desktop"));
        }
        return;
    }
    if let Some(definition) = native_channel(&channel.id) {
        channel.label = definition.label.to_string();
        channel.config = Some(normalize_native_channel_config(
            channel.config.take(),
            definition,
        ));
    }
}

fn normalize_native_channel_config(
    existing: Option<AgentChannelConfig>,
    definition: &NativeChannelDefinition,
) -> AgentChannelConfig {
    let fallback = default_agent_channel_config(definition.id);
    let existing = existing.unwrap_or_else(|| fallback.clone());
    AgentChannelConfig {
        account_id: if existing.account_id.trim().is_empty() {
            fallback.account_id
        } else {
            existing.account_id.trim().to_string()
        },
        dm_policy: if existing.dm_policy.trim().is_empty() {
            fallback.dm_policy
        } else {
            existing.dm_policy.trim().to_string()
        },
        fields: normalize_native_channel_fields(&existing.fields, definition),
        group_policy: if existing.group_policy.trim().is_empty() {
            fallback.group_policy
        } else {
            existing.group_policy.trim().to_string()
        },
        target: if existing.target.trim().is_empty() {
            fallback.target
        } else {
            existing.target.trim().to_string()
        },
    }
}

fn normalize_native_channel_fields(
    existing_fields: &[AgentChannelConfigField],
    definition: &NativeChannelDefinition,
) -> Vec<AgentChannelConfigField> {
    let mut fields = definition
        .fields
        .iter()
        .map(|field| {
            let existing = existing_fields
                .iter()
                .find(|existing| existing.id == field.id);
            AgentChannelConfigField {
                id: field.id.to_string(),
                label: field.label.to_string(),
                secret: field.secret,
                value: existing
                    .map(|field| field.value.trim().to_string())
                    .filter(|value| !value.is_empty())
                    .unwrap_or_else(|| field.default_value.to_string()),
            }
        })
        .collect::<Vec<_>>();
    for existing in existing_fields {
        if definition
            .fields
            .iter()
            .any(|field| field.id == existing.id)
        {
            continue;
        }
        let id = existing.id.trim();
        if id.is_empty() {
            continue;
        }
        fields.push(AgentChannelConfigField {
            id: id.to_string(),
            label: if existing.label.trim().is_empty() {
                id.to_string()
            } else {
                existing.label.trim().to_string()
            },
            secret: existing.secret,
            value: existing.value.trim().to_string(),
        });
    }
    fields
}

fn default_agent_channel_config(channel_id: &str) -> AgentChannelConfig {
    match channel_id {
        "desktop" => AgentChannelConfig {
            account_id: "local".to_string(),
            dm_policy: "open".to_string(),
            fields: Vec::new(),
            group_policy: "open".to_string(),
            target: "desktop".to_string(),
        },
        "esp32" => AgentChannelConfig {
            account_id: "local".to_string(),
            dm_policy: "open".to_string(),
            fields: Vec::new(),
            group_policy: "open".to_string(),
            target: String::new(),
        },
        "feishu" | "ddingtalk" | "qqbot" | "weixin" => AgentChannelConfig {
            account_id: "default".to_string(),
            dm_policy: "pairing".to_string(),
            fields: Vec::new(),
            group_policy: "allowlist".to_string(),
            target: String::new(),
        },
        _ => AgentChannelConfig {
            account_id: "default".to_string(),
            dm_policy: "pairing".to_string(),
            fields: Vec::new(),
            group_policy: "allowlist".to_string(),
            target: String::new(),
        },
    }
}

fn dedupe_agent_channels(channels: &mut Vec<AgentChannelBinding>) {
    let mut seen = std::collections::BTreeSet::new();
    channels.retain(|channel| seen.insert(channel.id.clone()));
}

fn initials(name: &str) -> String {
    let mut chars = name
        .split_whitespace()
        .filter_map(|part| part.chars().next())
        .take(2)
        .collect::<String>();
    if chars.is_empty() {
        chars = "A".to_string();
    }
    chars.to_uppercase()
}

fn event_to_sse(event: DesktopEvent) -> Event {
    let event_name = match &event {
        DesktopEvent::Runtime { .. } => "runtime",
        DesktopEvent::RuntimeChanged { .. } => "runtimeChanged",
        DesktopEvent::SessionStarted { .. } => "sessionStarted",
        DesktopEvent::MessageDelta { .. } => "messageDelta",
        DesktopEvent::ToolCall { .. } => "toolCall",
        DesktopEvent::ToolResult { .. } => "toolResult",
        DesktopEvent::MessageFinal { .. } => "messageFinal",
        DesktopEvent::PermissionRequested { .. } => "permissionRequested",
        DesktopEvent::OperationFailed { .. } => "operationFailed",
        DesktopEvent::StateChanged { .. } => "stateChanged",
        DesktopEvent::PermissionChanged { .. } => "permissionChanged",
    };
    let data = serde_json::to_string(&event).unwrap_or_else(|_| "{}".to_string());
    Event::default().event(event_name).data(data)
}
