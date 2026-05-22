use std::collections::BTreeMap;
use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::Arc;

use anyhow::{bail, Context, Result};
use axum::body::Bytes;
use axum::http::{HeaderMap, Method, StatusCode};
use axum::routing::{get, patch, post};
use axum::{Json, Router};
use serde::{de::DeserializeOwned, Serialize};
use serde_json::{json, Map, Value};
use tokio::net::TcpListener;
use tokio::sync::{broadcast, RwLock};
use tower_http::cors::{Any, CorsLayer};
use uuid::Uuid;

use crawclaw_channels::{is_desktop_or_native_channel_id, native_channel, NativeChannelDefinition};
use crawclaw_native_plugins::comfyui::handle_comfyui;
use crawclaw_native_plugins::qwen3_tts::{build_synthesis_payload, synthesize_qwen3_tts};
use crawclaw_native_plugins::web::{run_searxng_search, run_spider_fetch};
use crawclaw_plugin_host::{
    add_custom_plugin_skill, load_plugin_manifest, toggle_plugin_skill_open,
    toggle_plugin_tool_open, PluginHostError, PluginHostSkill, PluginHostTool,
};
use crawclaw_runtime::{
    special_agents::find_special_agent, AgentModelSelection, AgentRunRequest, AgentRuntime,
    AgentRuntimeError, ChannelChatType, ChannelInboundEnvelope, DesktopAgentStore,
    DesktopAgentStoreError, DesktopMemoryRecord, DesktopMemoryStore, DesktopMemoryStoreError,
    DesktopPreferencesRecord, DesktopPreferencesStore, DesktopPreferencesStoreError,
    DesktopSessionRecord, DesktopSessionStore, DesktopSessionStoreError,
};

use crate::gateway::desktop_state::initial_desktop_state;
use crate::gateway::runtime_supervisor::RuntimeSupervisor;
use crate::models::{
    AgentAvatarProfile, AgentChannelBinding, AgentChannelConfig, AgentChannelConfigField,
    AgentEmotionProfile, AgentProfile, AgentSkill, AgentVoiceConfig, ConfirmationDefaults,
    ConversationMessage, DesktopApiInfo, DesktopAppInfo, DesktopEvent, DesktopPreferences,
    DesktopState, MemoryDefaults, MemoryItem, NotificationDefaults, PluginSkill, PluginTool,
    PrivacyDefaults, RuntimeCheck, SidebarThread, TaskDefaults, UiDefaults, AdvancedDefaults,
};
use crate::runtime_engine::RuntimeLayout;

mod desktop_agent_model;
mod desktop_agent_routes;
mod desktop_core_routes;
mod desktop_memory_routes;
mod desktop_mutation_routes;
mod desktop_native_operations;
mod desktop_plugin_operations;
mod desktop_session_routes;
use self::desktop_agent_model::{
    agent_channels_from_input, agent_profile, retain_rust_native_agent_channels,
};
use self::desktop_agent_routes::{select_agent, update_preferences};
use self::desktop_core_routes::{
    bootstrap, desktop_state, events, permission_decision, runtime_status, search, select_nav,
    select_thread, send_message,
};
use self::desktop_memory_routes::{
    select_memory_agent, select_memory_item, set_memory_filter, set_memory_query,
};
use self::desktop_mutation_routes::{
    abort_message, add_agent_skill, add_plugin_skill, archive_memory_item, archive_thread,
    create_agent, create_memory_item, invoke_plugin_tool, pin_thread, rename_thread_route,
    run_memory_dream, steer_message, toggle_agent_skill, toggle_agent_tool, toggle_plugin_skill,
    toggle_plugin_tool, unpin_thread, update_agent, update_memory_item,
};
use self::desktop_native_operations::{
    active_thread_id, parse_json_body, plugin_skill, plugin_tool, run_native_state_mutation,
    string_field, with_string, DesktopNativeMutation, ThreadMutation, ToggleMutation,
};
use self::desktop_plugin_operations::invoke_plugin_tool_operation;
use self::desktop_session_routes::{
    list_sessions, list_subagents, send_session, session_history, spawn_session, yield_session,
};

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
            let task_defaults_loaded = merge_persisted_preference_group::<TaskDefaults>(
                desktop_state,
                preferences.task_defaults,
                "taskDefaults",
                |preferences, task_defaults| preferences.task_defaults = task_defaults,
            );
            merge_persisted_preference_group::<ConfirmationDefaults>(
                desktop_state,
                preferences.confirmation_defaults,
                "confirmationDefaults",
                |preferences, confirmation_defaults| {
                    preferences.confirmation_defaults = confirmation_defaults;
                },
            );
            merge_persisted_preference_group::<NotificationDefaults>(
                desktop_state,
                preferences.notification_defaults,
                "notificationDefaults",
                |preferences, notification_defaults| {
                    preferences.notification_defaults = notification_defaults;
                },
            );
            merge_persisted_preference_group::<UiDefaults>(
                desktop_state,
                preferences.ui_defaults,
                "uiDefaults",
                |preferences, ui_defaults| preferences.ui_defaults = ui_defaults,
            );
            merge_persisted_preference_group::<MemoryDefaults>(
                desktop_state,
                preferences.memory_defaults,
                "memoryDefaults",
                |preferences, memory_defaults| preferences.memory_defaults = memory_defaults,
            );
            merge_persisted_preference_group::<PrivacyDefaults>(
                desktop_state,
                preferences.privacy_defaults,
                "privacyDefaults",
                |preferences, privacy_defaults| preferences.privacy_defaults = privacy_defaults,
            );
            merge_persisted_preference_group::<AdvancedDefaults>(
                desktop_state,
                preferences.advanced_defaults,
                "advancedDefaults",
                |preferences, advanced_defaults| preferences.advanced_defaults = advanced_defaults,
            );
            if task_defaults_loaded {
                sync_preference_aliases_from_task_defaults(&mut desktop_state.preferences);
            } else {
                sync_task_defaults_from_preference_aliases(&mut desktop_state.preferences);
            }
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

fn merge_persisted_preference_group<T>(
    desktop_state: &mut DesktopState,
    value: Value,
    field: &str,
    apply: impl FnOnce(&mut DesktopPreferences, T),
) -> bool
where
    T: DeserializeOwned,
{
    if value.is_null() {
        return false;
    }
    match serde_json::from_value::<T>(value) {
        Ok(group) => {
            apply(&mut desktop_state.preferences, group);
            true
        }
        Err(error) => {
            desktop_state.conversation.runtime_checks.push(RuntimeCheck {
                label: "Desktop preferences store".to_string(),
                value: format!("Invalid desktop preferences field {field}: {error}"),
                tone: "error".to_string(),
            });
            false
        }
    }
}

pub(super) fn sync_preference_aliases_from_task_defaults(preferences: &mut DesktopPreferences) {
    preferences.selected_model = preferences.task_defaults.selected_model.clone();
    preferences.selected_thinking = preferences.task_defaults.selected_thinking.clone();
    preferences.permission_mode = preferences.task_defaults.permission_mode.clone();
}

pub(super) fn sync_task_defaults_from_preference_aliases(preferences: &mut DesktopPreferences) {
    preferences.task_defaults.selected_model = preferences.selected_model.clone();
    preferences.task_defaults.selected_thinking = preferences.selected_thinking.clone();
    preferences.task_defaults.permission_mode = preferences.permission_mode.clone();
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
    let mut selected_messages = Vec::new();
    let mut has_active_thread = false;
    desktop_state.sidebar.pinned_threads.clear();
    desktop_state.sidebar.threads.clear();
    for session in sessions {
        let active = !has_active_thread;
        if active {
            selected_messages = conversation_messages_from_session(&session.thread_id, &session);
            selected_result_items = session.result_items.clone();
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
    desktop_state.conversation.messages = selected_messages;
    desktop_state.conversation.result_items = selected_result_items;
}

fn apply_session_conversation(
    desktop_state: &mut DesktopState,
    thread_id: &str,
    session: &DesktopSessionRecord,
) {
    desktop_state.conversation.messages = conversation_messages_from_session(thread_id, session);
    desktop_state.conversation.result_items = session.result_items.clone();
}

fn conversation_messages_from_session(
    thread_id: &str,
    session: &DesktopSessionRecord,
) -> Vec<ConversationMessage> {
    session
        .messages
        .iter()
        .enumerate()
        .map(|(index, message)| {
            let id = format!("{thread_id}-message-{index}");
            match message.kind.as_str() {
                "user" => ConversationMessage::User {
                    id,
                    text: message.text.clone(),
                    created_at: "已保存".to_string(),
                },
                "assistant" => ConversationMessage::Assistant {
                    id,
                    text: message.text.clone(),
                    created_at: "已保存".to_string(),
                },
                _ => ConversationMessage::Status {
                    id,
                    title: message.kind.clone(),
                    detail: message.text.clone(),
                    tone: "neutral".to_string(),
                    created_at: "已保存".to_string(),
                },
            }
        })
        .collect()
}

fn now_message_id(prefix: &str) -> String {
    format!("{prefix}-{}", Uuid::new_v4().simple())
}

fn conversation_user_message(text: String) -> ConversationMessage {
    ConversationMessage::User {
        id: now_message_id("user"),
        text,
        created_at: "刚刚".to_string(),
    }
}

fn conversation_assistant_message(text: String) -> ConversationMessage {
    ConversationMessage::Assistant {
        id: now_message_id("assistant"),
        text,
        created_at: "刚刚".to_string(),
    }
}

fn conversation_error_message(code: &str, detail: String) -> ConversationMessage {
    ConversationMessage::Error {
        id: now_message_id("error"),
        code: code.to_string(),
        title: "任务失败".to_string(),
        detail,
        created_at: "刚刚".to_string(),
    }
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
        .route("/api/desktop/messages/abort", post(abort_message))
        .route("/api/desktop/messages/steer", post(steer_message))
        .route(
            "/api/desktop/permissions/{request_id}/decision",
            post(permission_decision),
        )
        .route("/api/desktop/preferences", patch(update_preferences))
        .route("/api/desktop/plugins/skills", post(add_plugin_skill))
        .route(
            "/api/desktop/plugins/skills/{skill_id}/toggle",
            post(toggle_plugin_skill),
        )
        .route(
            "/api/desktop/plugins/tools/{tool_id}/toggle",
            post(toggle_plugin_tool),
        )
        .route(
            "/api/desktop/plugins/{plugin_id}/tools/{tool_id}/invoke",
            post(invoke_plugin_tool),
        )
        .route("/api/desktop/agents", post(create_agent))
        .route("/api/desktop/agents/{agent_id}", patch(update_agent))
        .route("/api/desktop/agents/{agent_id}/select", post(select_agent))
        .route(
            "/api/desktop/agents/{agent_id}/tools/{tool_id}/toggle",
            post(toggle_agent_tool),
        )
        .route(
            "/api/desktop/agents/{agent_id}/skills",
            post(add_agent_skill),
        )
        .route(
            "/api/desktop/agents/{agent_id}/skills/{skill_id}/toggle",
            post(toggle_agent_skill),
        )
        .route("/api/desktop/threads/{thread_id}/pin", post(pin_thread))
        .route("/api/desktop/threads/{thread_id}/unpin", post(unpin_thread))
        .route(
            "/api/desktop/threads/{thread_id}/rename",
            patch(rename_thread_route),
        )
        .route(
            "/api/desktop/threads/{thread_id}/archive",
            post(archive_thread),
        )
        .route("/api/desktop/memory/items", post(create_memory_item))
        .route(
            "/api/desktop/memory/items/{item_id}",
            patch(update_memory_item),
        )
        .route(
            "/api/desktop/memory/items/{item_id}/select",
            post(select_memory_item),
        )
        .route(
            "/api/desktop/memory/items/{item_id}/archive",
            post(archive_memory_item),
        )
        .route(
            "/api/desktop/memory/agents/{agent_id}/select",
            post(select_memory_agent),
        )
        .route("/api/desktop/memory/query", patch(set_memory_query))
        .route("/api/desktop/memory/filter", patch(set_memory_filter))
        .route("/api/desktop/memory/dream/run", post(run_memory_dream))
        .layer(
            CorsLayer::new()
                .allow_origin(Any)
                .allow_methods([Method::GET, Method::POST, Method::PATCH])
                .allow_headers(Any),
        )
        .with_state(state)
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
    let mut preferences = preferences.clone();
    sync_preference_aliases_from_task_defaults(&mut preferences);
    state
        .preferences_store
        .save_preferences(&DesktopPreferencesRecord {
            selected_model: preferences.selected_model.clone(),
            selected_thinking: preferences.selected_thinking.clone(),
            permission_mode: preferences.permission_mode.clone(),
            task_defaults: preference_group_value(state, "taskDefaults", &preferences.task_defaults)?,
            confirmation_defaults: preference_group_value(
                state,
                "confirmationDefaults",
                &preferences.confirmation_defaults,
            )?,
            notification_defaults: preference_group_value(
                state,
                "notificationDefaults",
                &preferences.notification_defaults,
            )?,
            ui_defaults: preference_group_value(state, "uiDefaults", &preferences.ui_defaults)?,
            memory_defaults: preference_group_value(
                state,
                "memoryDefaults",
                &preferences.memory_defaults,
            )?,
            privacy_defaults: preference_group_value(
                state,
                "privacyDefaults",
                &preferences.privacy_defaults,
            )?,
            advanced_defaults: preference_group_value(
                state,
                "advancedDefaults",
                &preferences.advanced_defaults,
            )?,
        })
        .map_err(|error| preferences_store_status(state, error))
}

fn preference_group_value<T: Serialize>(
    state: &GatewayState,
    field: &str,
    value: &T,
) -> Result<Value, StatusCode> {
    serde_json::to_value(value).map_err(|error| {
        preferences_store_status(
            state,
            DesktopPreferencesStoreError::Invalid(format!(
                "Failed to serialize desktop preferences field {field}: {error}"
            )),
        )
    })
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
