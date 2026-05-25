use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::fs;
use std::net::SocketAddr;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use anyhow::{bail, Context, Result};
use axum::body::Bytes;
use axum::http::{HeaderMap, Method, StatusCode};
use axum::routing::{delete, get, patch, post};
use axum::{Json, Router};
use serde::{de::DeserializeOwned, Serialize};
use serde_json::{json, Map, Value};
use tokio::net::TcpListener;
use tokio::sync::{broadcast, oneshot, Mutex, RwLock};
use tower_http::cors::{Any, CorsLayer};
use uuid::Uuid;

use crawclaw_channels::{is_desktop_or_native_channel_id, native_channel, NativeChannelDefinition};
use crawclaw_native_plugins::comfyui::handle_comfyui;
use crawclaw_native_plugins::qwen3_tts::{build_synthesis_payload, synthesize_qwen3_tts};
use crawclaw_native_plugins::web::{run_searxng_search, run_spider_fetch};
use crawclaw_plugin_host::{
    load_plugin_manifest, remove_plugin_skill_state, set_plugin_skill_enabled,
    set_plugin_tool_enabled, sync_core_skills, toggle_plugin_skill_open, toggle_plugin_tool_open,
    PluginHostError, PluginHostInstalledPlugin, PluginHostSkill, PluginHostTool,
};
use crawclaw_runtime::{
    special_agents::find_special_agent, AgentModelSelection, AgentRunRequest, AgentRuntime,
    AgentRuntimeConfirmationPolicy, AgentRuntimePermissionCategory, AgentRuntimePermissionDecision,
    AgentRuntimePermissionMode, AgentRuntimePermissionPolicy, AgentRuntimePermissionRequest,
    AgentRuntimePermissionRequester, AgentRuntimeSendOptions, AgentRuntimeToolSelection,
    ChannelChatType, ChannelInboundEnvelope, DesktopAgentStore, DesktopAgentStoreError,
    DesktopMemoryRecord, DesktopMemoryStore, DesktopMemoryStoreError, DesktopModelProfileStore,
    DesktopPreferencesRecord, DesktopPreferencesStore, DesktopPreferencesStoreError,
    DesktopSessionRecord, DesktopSessionStore, DesktopSessionStoreError,
};

use crate::gateway::desktop_state::initial_desktop_state;
use crate::gateway::runtime_supervisor::RuntimeSupervisor;
use crate::models::{
    AdvancedDefaults, AgentAvatarProfile, AgentChannelBinding, AgentChannelConfig,
    AgentChannelConfigField, AgentEmotionProfile, AgentProfile, AgentSkill, AgentTool,
    AgentVoiceConfig, ConfirmationDefaults, ConversationMediaItem, ConversationMessage,
    ConversationWorkflowStep, DesktopApiInfo, DesktopAppInfo, DesktopEvent, DesktopPreferences,
    DesktopState, InstalledPlugin, MemoryDefaults, MemoryItem, NotificationDefaults,
    PermissionStatus, PluginSkill, PluginTool, PrivacyDefaults, RuntimeCheck, SidebarThread,
    TaskDefaults, UiDefaults,
};
use crate::runtime_engine::RuntimeLayout;

mod desktop_agent_model;
mod desktop_agent_routes;
mod desktop_core_routes;
mod desktop_logging;
mod desktop_memory_routes;
mod desktop_model_profile_routes;
mod desktop_mutation_routes;
mod desktop_native_operations;
mod desktop_plugin_operations;
mod desktop_session_routes;
pub mod desktop_settings_effects;
use self::desktop_agent_model::{
    agent_channels_from_input, agent_profile, retain_rust_native_agent_channels,
};
use self::desktop_agent_routes::{
    select_agent, settings_clear_cache, settings_delete_local_data, settings_diagnostics,
    settings_export_data, settings_reset_state, update_preferences,
};
use self::desktop_core_routes::{
    bootstrap, desktop_state, events, permission_decision, runtime_status, search, select_nav,
    select_thread, send_message,
};
use self::desktop_logging::configure_desktop_rust_logging;
use self::desktop_memory_routes::{
    select_memory_agent, select_memory_item, set_memory_filter, set_memory_query,
};
use self::desktop_model_profile_routes::{
    apply_active_model_profile_for_selection, merge_persisted_model_profiles,
    test_and_save_model_profile,
};
use self::desktop_mutation_routes::{
    abort_message, add_agent_skill, add_attachment_message, add_media_message, add_plugin_skill,
    add_skill_call_message, add_voice_message, add_workflow_message, archive_memory_item,
    archive_thread, create_agent, create_memory_item, desktop_asset_content, invoke_plugin_tool,
    open_desktop_asset, pin_thread, remove_plugin_skill, rename_thread_route, reveal_desktop_asset,
    run_memory_dream, set_plugin_skill_enabled_route, set_plugin_tool_enabled_route, steer_message,
    toggle_agent_skill, toggle_agent_tool, toggle_plugin_skill, toggle_plugin_tool, unpin_thread,
    update_agent, update_memory_item,
};
use self::desktop_native_operations::{
    active_thread_id, append_and_persist_conversation_message,
    append_and_persist_conversation_message_with_emit, parse_json_body, plugin_installed,
    plugin_skill, plugin_tool, record_desktop_asset_action, resolve_desktop_asset,
    run_native_state_mutation, string_field, with_string, DesktopNativeMutation, ThreadMutation,
    ToggleMutation,
};
use self::desktop_plugin_operations::{
    install_plugin, invoke_plugin_tool_operation, invoke_rust_native_plugin_tool,
    plugin_tool_result_text, set_installed_plugin_enabled, uninstall_plugin,
};
use self::desktop_session_routes::{
    list_sessions, list_subagents, send_session, session_history, spawn_session, yield_session,
};
use self::desktop_settings_effects::{
    apply_desktop_settings_effects, send_desktop_notification, DesktopNotificationKind,
};

const SESSION_HEADER: &str = "x-crawclaw-desktop-session";
pub(super) const DEFAULT_MEMORY_AGENT_ID: &str = "main";

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
    model_profile_store: DesktopModelProfileStore,
    preferences_store: DesktopPreferencesStore,
    session_store: DesktopSessionStore,
    desktop_state: Arc<RwLock<DesktopState>>,
    active_generation: Arc<Mutex<Option<ActiveDesktopGeneration>>>,
    permission_waiters: Arc<Mutex<HashMap<String, oneshot::Sender<PermissionStatus>>>>,
    events: broadcast::Sender<DesktopEvent>,
}

#[derive(Clone)]
struct ActiveDesktopGeneration {
    run_id: String,
    thread_id: String,
    assistant_message_id: String,
    user_text: String,
    options: AgentRuntimeSendOptions,
    abort_handle: tokio::task::AbortHandle,
    queued_follow_ups: Vec<String>,
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
    let memory_store_root = desktop_store_root(&runtime_layout.runtime_root);
    let agent_store = DesktopAgentStore::new(runtime_layout.runtime_root.clone());
    let memory_store = DesktopMemoryStore::new(memory_store_root.clone());
    let legacy_memory_store = (memory_store_root != runtime_layout.runtime_root)
        .then(|| DesktopMemoryStore::new(runtime_layout.runtime_root.clone()));
    let model_profile_store = DesktopModelProfileStore::new(runtime_layout.runtime_root.clone());
    let preferences_store = DesktopPreferencesStore::new(runtime_layout.runtime_root.clone());
    let session_store = DesktopSessionStore::new(runtime_layout.runtime_root.clone());
    let mut desktop_state = initial_desktop_state(&runtime);
    migrate_legacy_desktop_memory_items(
        &mut desktop_state,
        &memory_store,
        legacy_memory_store.as_ref(),
    );
    migrate_legacy_workspace_memory_items(
        &mut desktop_state,
        &memory_store,
        &runtime_layout.runtime_root,
        &memory_store_root,
    );
    merge_persisted_agents(&mut desktop_state, &agent_store);
    merge_persisted_memory_items(&mut desktop_state, &memory_store);
    merge_persisted_preferences(&mut desktop_state, &preferences_store);
    sync_privacy_defaults_from_runtime_root(
        &mut desktop_state.preferences,
        &runtime_layout.runtime_root,
    );
    merge_persisted_model_profiles(&mut desktop_state, &model_profile_store);
    merge_persisted_sessions(&mut desktop_state, &session_store);
    merge_plugin_manifest(&mut desktop_state, &runtime_layout);
    if let Err(error) = apply_active_model_profile_for_selection(
        &runtime_layout.runtime_root,
        &model_profile_store,
        &desktop_state.preferences.selected_model,
    ) {
        desktop_state
            .conversation
            .runtime_checks
            .push(RuntimeCheck {
                label: "Desktop model profiles".to_string(),
                value: error.to_string(),
                tone: "error".to_string(),
            });
    }
    match apply_desktop_settings_effects(&runtime_layout.runtime_root, &desktop_state.preferences) {
        Ok(()) => desktop_state
            .conversation
            .runtime_checks
            .push(RuntimeCheck {
                label: "Desktop settings".to_string(),
                value: "hot".to_string(),
                tone: "ok".to_string(),
            }),
        Err(error) => desktop_state
            .conversation
            .runtime_checks
            .push(RuntimeCheck {
                label: "Desktop settings".to_string(),
                value: error,
                tone: "error".to_string(),
            }),
    }
    if let Err(error) = configure_desktop_rust_logging(
        &runtime_layout.runtime_root,
        &desktop_state.preferences.advanced_defaults.log_level,
    ) {
        desktop_state
            .conversation
            .runtime_checks
            .push(RuntimeCheck {
                label: "Desktop Rust logging".to_string(),
                value: error,
                tone: "error".to_string(),
            });
    }
    tracing::info!(
        runtime_root = %runtime_layout.runtime_root.display(),
        status = ?runtime.status,
        "desktop_gateway_state_built"
    );
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
        model_profile_store,
        preferences_store,
        session_store,
        desktop_state: Arc::new(RwLock::new(desktop_state)),
        active_generation: Arc::new(Mutex::new(None)),
        permission_waiters: Arc::new(Mutex::new(HashMap::new())),
        events,
    }
}

#[derive(Clone)]
struct DesktopRuntimePermissionRequester {
    state: GatewayState,
}

impl AgentRuntimePermissionRequester for DesktopRuntimePermissionRequester {
    fn request_permission<'a>(
        &'a self,
        request: AgentRuntimePermissionRequest,
    ) -> std::pin::Pin<
        Box<dyn std::future::Future<Output = AgentRuntimePermissionDecision> + Send + 'a>,
    > {
        Box::pin(async move { request_runtime_permission(self.state.clone(), request).await })
    }
}

async fn request_runtime_permission(
    state: GatewayState,
    request: AgentRuntimePermissionRequest,
) -> AgentRuntimePermissionDecision {
    let request_id = format!("permission-{}", Uuid::new_v4().simple());
    let permission_request = crate::models::PermissionRequest {
        id: request_id.clone(),
        title: request.title,
        detail: request.detail,
        status: PermissionStatus::Pending,
    };
    tracing::info!(
        runtime_root = %state.runtime_root.display(),
        request_id = %permission_request.id,
        title = %permission_request.title,
        "desktop_runtime_permission_requested"
    );
    let (sender, receiver) = oneshot::channel();
    state
        .permission_waiters
        .lock()
        .await
        .insert(request_id, sender);
    {
        let mut desktop_state = state.desktop_state.write().await;
        desktop_state.permission_request = permission_request.clone();
        upsert_permission_message(&mut desktop_state, &permission_request);
    }
    let preferences = state.desktop_state.read().await.preferences.clone();
    if let Err(error) = send_desktop_notification(
        &state.runtime_root,
        &preferences,
        DesktopNotificationKind::ConfirmNeeded,
        &permission_request.title,
        &permission_request.detail,
    ) {
        let _ = state.events.send(DesktopEvent::OperationFailed {
            code: "desktop_notification_failed".to_string(),
            message: error,
        });
    }
    let _ = emit_state_changed(&state).await;
    let _ = state
        .events
        .send(DesktopEvent::PermissionRequested { permission_request });
    match receiver.await {
        Ok(PermissionStatus::Approved) => AgentRuntimePermissionDecision::Approved,
        Ok(PermissionStatus::Denied | PermissionStatus::Pending) | Err(_) => {
            AgentRuntimePermissionDecision::Denied
        }
    }
}

fn desktop_permission_policy(
    state: &GatewayState,
    permission_mode: &str,
    confirmations: &ConfirmationDefaults,
) -> AgentRuntimePermissionPolicy {
    let mode = match permission_mode {
        "只读模式" => AgentRuntimePermissionMode::ReadOnly,
        "完全访问" => AgentRuntimePermissionMode::FullAccess,
        _ => AgentRuntimePermissionMode::Workspace,
    };
    AgentRuntimePermissionPolicy {
        mode,
        confirmations: AgentRuntimeConfirmationPolicy {
            confirm_file_changes: confirmations.confirm_file_changes,
            confirm_commands: confirmations.confirm_commands,
            confirm_external_apps: confirmations.confirm_external_apps,
            confirm_high_risk: confirmations.confirm_high_risk,
        },
        requester: Some(Arc::new(DesktopRuntimePermissionRequester {
            state: state.clone(),
        })),
    }
}

fn merge_plugin_manifest(desktop_state: &mut DesktopState, runtime_layout: &RuntimeLayout) {
    if let Some(source_root) = resolve_core_skills_root() {
        if let Err(error) = sync_core_skills(&runtime_layout.runtime_root, &source_root) {
            desktop_state
                .conversation
                .runtime_checks
                .push(RuntimeCheck {
                    label: "Desktop core skills".to_string(),
                    value: error.to_string(),
                    tone: "error".to_string(),
                });
        }
    }
    match load_plugin_manifest(&runtime_layout.runtime_root) {
        Ok(read_model) => {
            desktop_state.plugins_workspace.tools =
                read_model.tools.into_iter().map(plugin_tool).collect();
            desktop_state.plugins_workspace.skills =
                read_model.skills.into_iter().map(plugin_skill).collect();
            desktop_state.plugins_workspace.installed = read_model
                .installed
                .into_iter()
                .map(plugin_installed)
                .collect();
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

async fn refresh_plugins_workspace(state: &GatewayState) -> Result<(), StatusCode> {
    if let Some(source_root) = resolve_core_skills_root() {
        sync_core_skills(&state.runtime_root, &source_root)
            .map_err(|error| plugin_host_status(state, error))?;
    }
    let read_model = load_plugin_manifest(&state.runtime_root)
        .map_err(|error| plugin_host_status(state, error))?;
    let mut desktop_state = state.desktop_state.write().await;
    desktop_state.plugins_workspace.tools = read_model.tools.into_iter().map(plugin_tool).collect();
    desktop_state.plugins_workspace.skills =
        read_model.skills.into_iter().map(plugin_skill).collect();
    desktop_state.plugins_workspace.installed = read_model
        .installed
        .into_iter()
        .map(plugin_installed)
        .collect();
    desktop_state.active_nav_id = "plugins".to_string();
    Ok(())
}

fn resolve_core_skills_root() -> Option<PathBuf> {
    if let Some(path) = std::env::var_os("CRAWCLAW_CORE_SKILLS_ROOT")
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
        .filter(|path| path.join("coding-agent").join("SKILL.md").exists())
    {
        return Some(path);
    }
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    find_core_skills_root(manifest_dir)
        .or_else(|| std::env::current_dir().ok().and_then(find_core_skills_root))
}

fn find_core_skills_root(start: PathBuf) -> Option<PathBuf> {
    start
        .ancestors()
        .map(|ancestor| ancestor.join("skills"))
        .find(|skills_root| skills_root.join("coding-agent").join("SKILL.md").exists())
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
            if !preferences.model_options.is_empty() {
                desktop_state.preferences.model_options = preferences.model_options;
            }
            let task_defaults_loaded = merge_persisted_preference_group::<TaskDefaults>(
                desktop_state,
                preferences.task_defaults,
                "taskDefaults",
                |preferences, task_defaults| preferences.task_defaults = task_defaults,
            );
            normalize_task_defaults(&mut desktop_state.preferences.task_defaults);
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

fn runtime_data_location(runtime_root: &Path) -> String {
    runtime_root.to_string_lossy().to_string()
}

pub(super) fn sync_privacy_defaults_from_runtime_root(
    preferences: &mut DesktopPreferences,
    runtime_root: &Path,
) {
    preferences.privacy_defaults.data_location = runtime_data_location(runtime_root);
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
            desktop_state
                .conversation
                .runtime_checks
                .push(RuntimeCheck {
                    label: "Desktop preferences store".to_string(),
                    value: format!("Invalid desktop preferences field {field}: {error}"),
                    tone: "error".to_string(),
                });
            false
        }
    }
}

pub(super) fn sync_preference_aliases_from_task_defaults(preferences: &mut DesktopPreferences) {
    normalize_task_defaults(&mut preferences.task_defaults);
    preferences.selected_model = preferences.task_defaults.selected_model.clone();
    preferences.selected_thinking = preferences.task_defaults.selected_thinking.clone();
    preferences.permission_mode = preferences.task_defaults.permission_mode.clone();
}

pub(super) fn sync_task_defaults_from_preference_aliases(preferences: &mut DesktopPreferences) {
    normalize_task_defaults(&mut preferences.task_defaults);
    preferences.task_defaults.selected_model = preferences.selected_model.clone();
    preferences.task_defaults.selected_thinking = preferences.selected_thinking.clone();
    preferences.task_defaults.permission_mode = preferences.permission_mode.clone();
}

pub(super) fn normalize_task_defaults(task_defaults: &mut TaskDefaults) {
    task_defaults.response_speed = normalize_reply_mode(&task_defaults.response_speed);
}

fn normalize_reply_mode(value: &str) -> String {
    match value.trim() {
        "简洁" | "更快" | "compact" | "concise" | "off" => "简洁".to_string(),
        "详细" | "更稳" | "detailed" | "verbose" | "full" => "详细".to_string(),
        "标准" | "standard" | "balanced" | "normal" | "on" => "标准".to_string(),
        _ => "标准".to_string(),
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
    desktop_state.sidebar.pinned_threads.clear();
    desktop_state.sidebar.threads.clear();
    let mut active_session = None;
    for session in sessions {
        let active = session.active && active_session.is_none();
        let thread = SidebarThread {
            id: session.thread_id.clone(),
            title: session.title.clone(),
            time: "已保存".to_string(),
            active,
            agent_avatar: true,
        };
        if session.pinned {
            desktop_state.sidebar.pinned_threads.push(thread);
        } else {
            desktop_state.sidebar.threads.push(thread);
        }
        if active {
            active_session = Some(session);
        }
    }
    if let Some(session) = active_session {
        apply_session_conversation(desktop_state, &session.thread_id, &session);
    } else {
        clear_active_thread_conversation(desktop_state);
    }
}

fn apply_session_conversation(
    desktop_state: &mut DesktopState,
    thread_id: &str,
    session: &DesktopSessionRecord,
) {
    desktop_state.conversation.messages = conversation_messages_from_session(thread_id, session);
    desktop_state.conversation.result_items = session.result_items.clone();
}

pub(super) fn clear_active_thread_conversation(desktop_state: &mut DesktopState) {
    for thread in desktop_state.sidebar.pinned_threads.iter_mut() {
        thread.active = false;
    }
    for thread in desktop_state.sidebar.threads.iter_mut() {
        thread.active = false;
    }
    for thread in desktop_state.sidebar.discussion_threads.iter_mut() {
        thread.active = false;
    }
    desktop_state.conversation.messages.clear();
    desktop_state.conversation.result_items.clear();
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
            if let Some(desktop_message) = &message.desktop_message {
                if let Ok(message) =
                    serde_json::from_value::<ConversationMessage>(desktop_message.clone())
                {
                    return message;
                }
            }
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
                    status: Some("done".to_string()),
                    run_id: None,
                    error_code: None,
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

fn conversation_error_message(code: &str, detail: String) -> ConversationMessage {
    ConversationMessage::Error {
        id: now_message_id("error"),
        code: code.to_string(),
        title: "任务失败".to_string(),
        detail,
        created_at: "刚刚".to_string(),
    }
}

pub(super) fn conversation_tool_call_message(
    tool_id: String,
    title: String,
    detail: Option<String>,
) -> ConversationMessage {
    ConversationMessage::ToolCall {
        id: now_message_id("tool-call"),
        tool_id,
        title,
        detail,
        created_at: "刚刚".to_string(),
    }
}

pub(super) fn conversation_tool_result_message(
    tool_id: String,
    title: String,
    ok: bool,
    text: String,
) -> ConversationMessage {
    ConversationMessage::ToolResult {
        id: now_message_id("tool-result"),
        tool_id,
        title,
        ok,
        text,
        created_at: "刚刚".to_string(),
    }
}

pub(super) fn conversation_attachment_message_with_asset(
    title: String,
    file_name: String,
    media_type: String,
    detail: Option<String>,
    asset_id: Option<String>,
    size_bytes: Option<u64>,
) -> ConversationMessage {
    ConversationMessage::Attachment {
        id: now_message_id("attachment"),
        title,
        file_name,
        media_type,
        asset_id,
        size_bytes,
        status: Some("done".to_string()),
        error_code: None,
        detail,
        created_at: "刚刚".to_string(),
    }
}

pub(super) fn conversation_media_message(
    media_type: String,
    title: String,
    items: Vec<ConversationMediaItem>,
) -> ConversationMessage {
    ConversationMessage::Media {
        id: now_message_id("media"),
        media_type,
        title,
        items,
        status: Some("done".to_string()),
        error_code: None,
        created_at: "刚刚".to_string(),
    }
}

pub(super) fn conversation_voice_message(
    direction: String,
    title: String,
    duration_label: String,
    transcript: Option<String>,
) -> ConversationMessage {
    ConversationMessage::Voice {
        id: now_message_id("voice"),
        direction,
        title,
        duration_label,
        asset_id: None,
        mime_type: None,
        size_bytes: None,
        status: Some("done".to_string()),
        error_code: None,
        transcript,
        created_at: "刚刚".to_string(),
    }
}

pub(super) fn conversation_workflow_message(
    workflow_kind: String,
    title: String,
    status: String,
    detail: String,
    steps: Vec<ConversationWorkflowStep>,
) -> ConversationMessage {
    ConversationMessage::Workflow {
        id: now_message_id("workflow"),
        workflow_kind,
        title,
        status,
        detail,
        steps,
        workflow_id: None,
        run_id: None,
        error_code: None,
        created_at: "刚刚".to_string(),
    }
}

pub(super) fn conversation_skill_call_message(
    skill_id: String,
    title: String,
    status: String,
    detail: Option<String>,
) -> ConversationMessage {
    ConversationMessage::SkillCall {
        id: now_message_id("skill-call"),
        skill_id,
        title,
        status,
        execution_id: None,
        error_code: None,
        detail,
        created_at: "刚刚".to_string(),
    }
}

pub(super) fn conversation_status_message(
    title: String,
    detail: String,
    tone: String,
) -> ConversationMessage {
    ConversationMessage::Status {
        id: now_message_id("status"),
        title,
        detail,
        tone,
        created_at: "刚刚".to_string(),
    }
}

pub(super) fn upsert_permission_message(
    desktop_state: &mut DesktopState,
    permission_request: &crate::models::PermissionRequest,
) {
    let detail = match permission_request.status {
        PermissionStatus::Pending => permission_request.detail.clone(),
        PermissionStatus::Approved => format!("已允许一次：{}", permission_request.detail),
        PermissionStatus::Denied => format!("已拒绝：{}", permission_request.detail),
    };
    if let Some(ConversationMessage::Permission {
        title: existing_title,
        status: existing_status,
        detail: existing_detail,
        ..
    }) = desktop_state
        .conversation
        .messages
        .iter_mut()
        .find(|message| {
            matches!(message, ConversationMessage::Permission { request_id: id, .. } if id == &permission_request.id)
        })
    {
        *existing_title = permission_request.title.clone();
        *existing_status = permission_request.status.clone();
        *existing_detail = detail;
        return;
    }
    desktop_state
        .conversation
        .messages
        .push(ConversationMessage::Permission {
            id: now_message_id("permission"),
            request_id: permission_request.id.clone(),
            title: permission_request.title.clone(),
            detail,
            status: permission_request.status.clone(),
            created_at: "刚刚".to_string(),
        });
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::gateway::desktop_api::desktop_core_routes::{
        permission_decision, PermissionDecisionRequest,
    };
    use crate::gateway::desktop_state::initial_desktop_state;
    use crate::models::{PermissionStatus, RuntimeStatus};
    use axum::extract::{Path, State};
    use axum::http::HeaderMap;
    use axum::Json;
    use crawclaw_core::{RuntimeCompatStatus, RuntimeStatusValue};
    use crawclaw_runtime::{
        AgentRuntimePermissionCategory, AgentRuntimePermissionDecision,
        AgentRuntimePermissionRequest,
    };
    use std::time::Duration;

    fn ready_runtime_status() -> RuntimeStatus {
        RuntimeStatus {
            status: RuntimeStatusValue::Ready,
            detail: "ready".to_string(),
            runtime_root: "/tmp/crawclaw-test".to_string(),
            binary_path: "/tmp/crawclaw-test/bin/crawclaw-runtime".to_string(),
            compat: RuntimeCompatStatus::default(),
        }
    }

    #[test]
    fn upsert_permission_message_updates_existing_message() {
        let mut state = initial_desktop_state(&ready_runtime_status());

        upsert_permission_message(
            &mut state,
            &crate::models::PermissionRequest {
                id: "permission-1".to_string(),
                title: "确认执行命令".to_string(),
                detail: "工具 bash 想运行：printf ok".to_string(),
                status: PermissionStatus::Pending,
            },
        );
        upsert_permission_message(
            &mut state,
            &crate::models::PermissionRequest {
                id: "permission-1".to_string(),
                title: "确认执行命令".to_string(),
                detail: "工具 bash 想运行：printf ok".to_string(),
                status: PermissionStatus::Approved,
            },
        );

        let permission_messages = state
            .conversation
            .messages
            .iter()
            .filter(|message| matches!(message, ConversationMessage::Permission { .. }))
            .count();
        assert_eq!(permission_messages, 1);
        assert!(matches!(
            state.conversation.messages.last(),
            Some(ConversationMessage::Permission {
                request_id,
                status: PermissionStatus::Approved,
                ..
            }) if request_id == "permission-1"
        ));
    }

    #[tokio::test]
    async fn permission_decision_resolves_pending_runtime_permission_request() {
        let state = build_state(
            "CrawClaw Desktop".to_string(),
            "test".to_string(),
            "http://127.0.0.1:1".to_string(),
            "session".to_string(),
            test_runtime_layout("permission-decision-resolves"),
        )
        .await;
        let decision_task = tokio::spawn(request_runtime_permission(
            state.clone(),
            AgentRuntimePermissionRequest {
                tool_call_id: "tool-call-1".to_string(),
                tool_name: "bash".to_string(),
                title: "确认执行命令".to_string(),
                detail: "工具 bash 想运行：printf ok".to_string(),
                category: AgentRuntimePermissionCategory::Command,
            },
        ));

        let request_id = tokio::time::timeout(Duration::from_secs(2), async {
            loop {
                let permission_request =
                    state.desktop_state.read().await.permission_request.clone();
                if !permission_request.id.is_empty() {
                    return permission_request.id;
                }
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        })
        .await
        .expect("permission request id");
        {
            let desktop_state = state.desktop_state.read().await;
            assert_eq!(desktop_state.permission_request.title, "确认执行命令");
            assert_eq!(
                desktop_state.permission_request.detail,
                "工具 bash 想运行：printf ok"
            );
        }
        let notification_path = state
            .runtime_root
            .join("desktop")
            .join("notifications")
            .join("last-notification.json");
        let notification: serde_json::Value = serde_json::from_str(
            &std::fs::read_to_string(notification_path).expect("notification"),
        )
        .expect("notification json");
        assert_eq!(notification["kind"], "confirmNeeded");
        assert_eq!(notification["title"], "确认执行命令");
        assert_eq!(notification["body"], "工具 bash 想运行：printf ok");

        let mut headers = HeaderMap::new();
        headers.insert("x-crawclaw-desktop-session", "session".parse().unwrap());
        let _ = permission_decision(
            State(state),
            headers,
            Path(request_id),
            Json(PermissionDecisionRequest {
                decision: PermissionStatus::Approved,
            }),
        )
        .await
        .expect("permission decision");

        let decision = decision_task.await.expect("permission waiter");
        assert_eq!(decision, AgentRuntimePermissionDecision::Approved);
    }

    #[tokio::test]
    async fn runtime_permission_request_emits_state_changed_for_ui_confirmation() {
        let state = build_state(
            "CrawClaw Desktop".to_string(),
            "test".to_string(),
            "http://127.0.0.1:1".to_string(),
            "session".to_string(),
            test_runtime_layout("permission-request-state-changed"),
        )
        .await;
        let mut events = state.events.subscribe();
        let decision_task = tokio::spawn(request_runtime_permission(
            state.clone(),
            AgentRuntimePermissionRequest {
                tool_call_id: "tool-call-2".to_string(),
                tool_name: "bash".to_string(),
                title: "确认执行命令".to_string(),
                detail: "工具 bash 想运行：printf ok".to_string(),
                category: AgentRuntimePermissionCategory::Command,
            },
        ));

        let state_changed = tokio::time::timeout(Duration::from_secs(2), async {
            loop {
                if let Ok(DesktopEvent::StateChanged { desktop_state }) = events.recv().await {
                    if desktop_state.permission_request.status == PermissionStatus::Pending {
                        return desktop_state;
                    }
                }
            }
        })
        .await
        .expect("stateChanged with pending permission");
        assert_eq!(state_changed.permission_request.title, "确认执行命令");
        assert!(state_changed.conversation.messages.iter().any(|message| {
            matches!(message, ConversationMessage::Permission {
                request_id,
                status: PermissionStatus::Pending,
                ..
            } if request_id == &state_changed.permission_request.id)
        }));

        let request_id = state_changed.permission_request.id.clone();
        let mut headers = HeaderMap::new();
        headers.insert("x-crawclaw-desktop-session", "session".parse().unwrap());
        let _ = permission_decision(
            State(state),
            headers,
            Path(request_id),
            Json(PermissionDecisionRequest {
                decision: PermissionStatus::Denied,
            }),
        )
        .await
        .expect("permission decision");
        let decision = decision_task.await.expect("permission waiter");
        assert_eq!(decision, AgentRuntimePermissionDecision::Denied);
    }

    #[test]
    fn desktop_store_root_moves_packaged_macos_state_out_of_app_bundle() {
        let runtime_root =
            PathBuf::from("/Applications/CrawClaw Desktop.app/Contents/Resources/runtime/crawclaw");
        let store_root =
            desktop_store_root_from_home(&runtime_root, Some(std::path::Path::new("/Users/test")));

        assert_eq!(
            store_root,
            PathBuf::from(
                "/Users/test/Library/Application Support/crawclaw-desktop/runtime/crawclaw"
            )
        );
        assert!(!store_root.starts_with("/Applications/CrawClaw Desktop.app"));
    }

    #[test]
    fn desktop_store_root_keeps_dev_runtime_root() {
        let runtime_root = PathBuf::from("/tmp/crawclaw-dev/runtime/crawclaw");

        assert_eq!(
            desktop_store_root_from_home(&runtime_root, Some(std::path::Path::new("/Users/test")),),
            runtime_root
        );
    }

    #[test]
    fn workspace_memory_dirs_include_legacy_home_memory() {
        let runtime_root =
            PathBuf::from("/Applications/CrawClaw Desktop.app/Contents/Resources/runtime/crawclaw");
        let memory_store_root = PathBuf::from(
            "/Users/test/Library/Application Support/crawclaw-desktop/runtime/crawclaw",
        );
        let home = PathBuf::from("/Users/test");

        let dirs =
            legacy_workspace_memory_dirs(&runtime_root, &memory_store_root, Some(home.as_path()));

        assert_eq!(
            dirs,
            vec![
                PathBuf::from(
                    "/Users/test/Library/Application Support/crawclaw-desktop/runtime/crawclaw/workspace/memory"
                ),
                PathBuf::from(
                    "/Applications/CrawClaw Desktop.app/Contents/Resources/runtime/crawclaw/workspace/memory"
                ),
                PathBuf::from("/Users/test/.crawclaw/workspace/memory"),
            ]
        );
    }

    #[test]
    fn workspace_memory_markdown_import_uses_frontmatter_without_path_source() {
        let dir = std::env::temp_dir().join(format!(
            "crawclaw-desktop-workspace-memory-{}",
            Uuid::new_v4()
        ));
        fs::create_dir_all(&dir).expect("memory dir");
        let path = dir.join("user-preference-chinese.md");
        fs::write(
            &path,
            r#"---
title: "用户语言偏好：中文优先"
description: "用户默认希望用中文回复。"
type: user
created: 2025-12-05
---

# 用户语言偏好：中文优先

用户默认偏好中文回复。
"#,
        )
        .expect("memory file");

        let record = workspace_memory_record_from_markdown(&path)
            .expect("memory record result")
            .expect("memory record");

        assert_eq!(record.id, "workspace-memory-user-preference-chinese");
        assert_eq!(record.agent_id, "main");
        assert_eq!(record.title, "用户语言偏好：中文优先");
        assert_eq!(record.summary, "用户默认希望用中文回复。");
        assert_eq!(record.category, "偏好");
        assert_eq!(record.tags, vec!["workspace-memory", "user"]);
        assert_eq!(record.source, "workspace-memory");
        assert_eq!(record.updated_at, "2025-12-05");
        assert!(record.content.contains("用户默认偏好中文回复。"));
    }

    fn test_runtime_layout(name: &str) -> RuntimeLayout {
        let runtime_root =
            std::env::temp_dir().join(format!("crawclaw-desktop-{name}-{}", Uuid::new_v4()));
        RuntimeLayout {
            binary_path: runtime_root.join("bin").join("crawclaw-runtime"),
            channel_manifest_path: runtime_root.join("channels").join("manifest.json"),
            manifest_path: runtime_root.join("runtimes").join("manifest.json"),
            runtime_root,
        }
    }
}

fn desktop_store_root(runtime_root: &Path) -> PathBuf {
    let home = std::env::var_os("HOME").map(PathBuf::from);
    desktop_store_root_from_home(runtime_root, home.as_deref())
}

fn desktop_store_root_from_home(runtime_root: &Path, home: Option<&Path>) -> PathBuf {
    if runtime_root
        .to_string_lossy()
        .contains(".app/Contents/Resources/")
    {
        if let Some(home) = home {
            return home
                .join("Library")
                .join("Application Support")
                .join("crawclaw-desktop")
                .join("runtime")
                .join("crawclaw");
        }
    }
    runtime_root.to_path_buf()
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

fn migrate_legacy_desktop_memory_items(
    desktop_state: &mut DesktopState,
    memory_store: &DesktopMemoryStore,
    legacy_memory_store: Option<&DesktopMemoryStore>,
) {
    let Some(legacy_memory_store) = legacy_memory_store else {
        return;
    };
    match migrate_legacy_desktop_memory_items_inner(memory_store, legacy_memory_store) {
        Ok(_) => {}
        Err(error) => desktop_state
            .conversation
            .runtime_checks
            .push(RuntimeCheck {
                label: "Desktop memory migration".to_string(),
                value: error.to_string(),
                tone: "error".to_string(),
            }),
    }
}

fn migrate_legacy_desktop_memory_items_inner(
    memory_store: &DesktopMemoryStore,
    legacy_memory_store: &DesktopMemoryStore,
) -> Result<usize, DesktopMemoryStoreError> {
    let legacy_items = legacy_memory_store.load_items()?;
    if legacy_items.is_empty() {
        return Ok(0);
    }
    let current_items = memory_store.load_items()?;
    let mut existing_ids: BTreeSet<String> =
        current_items.into_iter().map(|item| item.id).collect();
    let mut migrated = 0;
    for item in legacy_items {
        if existing_ids.insert(item.id.clone()) {
            memory_store.upsert_item(item)?;
            migrated += 1;
        }
    }
    Ok(migrated)
}

fn migrate_legacy_workspace_memory_items(
    desktop_state: &mut DesktopState,
    memory_store: &DesktopMemoryStore,
    runtime_root: &Path,
    memory_store_root: &Path,
) {
    let workspace_memory_dirs = legacy_workspace_memory_dirs(
        runtime_root,
        memory_store_root,
        legacy_home_dir().as_deref(),
    );
    match migrate_legacy_workspace_memory_items_inner(memory_store, &workspace_memory_dirs) {
        Ok(_) => {}
        Err(error) => desktop_state
            .conversation
            .runtime_checks
            .push(RuntimeCheck {
                label: "Workspace memory migration".to_string(),
                value: error.to_string(),
                tone: "error".to_string(),
            }),
    }
}

fn migrate_legacy_workspace_memory_items_inner(
    memory_store: &DesktopMemoryStore,
    workspace_memory_dirs: &[PathBuf],
) -> Result<usize, DesktopMemoryStoreError> {
    let current_items = memory_store.load_items()?;
    let mut existing_ids: BTreeSet<String> =
        current_items.into_iter().map(|item| item.id).collect();
    let mut migrated = 0;

    for memory_dir in workspace_memory_dirs {
        let entries = match fs::read_dir(memory_dir) {
            Ok(entries) => entries,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => continue,
            Err(error) => {
                return Err(DesktopMemoryStoreError::Io(format!(
                    "Failed to read workspace memory directory: {error}"
                )));
            }
        };

        for entry in entries {
            let entry = entry.map_err(|error| {
                DesktopMemoryStoreError::Io(format!(
                    "Failed to read workspace memory directory entry: {error}"
                ))
            })?;
            let path = entry.path();
            if !is_workspace_memory_markdown(&path) {
                continue;
            }
            let Some(record) = workspace_memory_record_from_markdown(&path)? else {
                continue;
            };
            if existing_ids.insert(record.id.clone()) {
                memory_store.upsert_item(record)?;
                migrated += 1;
            }
        }
    }

    Ok(migrated)
}

fn legacy_workspace_memory_dirs(
    runtime_root: &Path,
    memory_store_root: &Path,
    home: Option<&Path>,
) -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    push_unique_path(
        &mut dirs,
        memory_store_root.join("workspace").join("memory"),
    );
    push_unique_path(&mut dirs, runtime_root.join("workspace").join("memory"));
    if should_import_home_workspace_memory(runtime_root) {
        if let Some(home) = home {
            push_unique_path(
                &mut dirs,
                home.join(".crawclaw").join("workspace").join("memory"),
            );
        }
    }
    dirs
}

fn should_import_home_workspace_memory(runtime_root: &Path) -> bool {
    runtime_root
        .to_string_lossy()
        .contains(".app/Contents/Resources/")
}

fn push_unique_path(paths: &mut Vec<PathBuf>, path: PathBuf) {
    if !paths.iter().any(|existing| existing == &path) {
        paths.push(path);
    }
}

fn legacy_home_dir() -> Option<PathBuf> {
    std::env::var_os("HOME").map(PathBuf::from)
}

fn is_workspace_memory_markdown(path: &Path) -> bool {
    path.extension().and_then(|extension| extension.to_str()) == Some("md")
        && path.file_name().and_then(|name| name.to_str()) != Some("MEMORY.md")
}

fn workspace_memory_record_from_markdown(
    path: &Path,
) -> Result<Option<DesktopMemoryRecord>, DesktopMemoryStoreError> {
    let Some(stem) = path.file_stem().and_then(|stem| stem.to_str()) else {
        return Ok(None);
    };
    let id_slug = memory_slug(stem);
    if id_slug.is_empty() {
        return Ok(None);
    }

    let raw = fs::read_to_string(path).map_err(|error| {
        DesktopMemoryStoreError::Io(format!("Failed to read workspace memory file: {error}"))
    })?;
    let (frontmatter, body) = split_markdown_frontmatter(&raw);
    let body = body.trim();
    let title = frontmatter
        .get("title")
        .cloned()
        .or_else(|| first_markdown_heading(body))
        .unwrap_or_else(|| stem.replace(['-', '_'], " "));
    let summary = frontmatter
        .get("description")
        .cloned()
        .or_else(|| first_markdown_summary(body))
        .unwrap_or_else(|| title.clone());
    let memory_type = frontmatter
        .get("type")
        .map(String::as_str)
        .unwrap_or("legacy");
    let mut tags = vec!["workspace-memory".to_string()];
    if !memory_type.is_empty() {
        tags.push(memory_type.to_string());
    }

    Ok(Some(DesktopMemoryRecord {
        id: format!("workspace-memory-{id_slug}"),
        agent_id: DEFAULT_MEMORY_AGENT_ID.to_string(),
        title,
        summary,
        content: body.to_string(),
        category: workspace_memory_category(memory_type).to_string(),
        tags,
        source: "workspace-memory".to_string(),
        updated_at: frontmatter
            .get("created")
            .cloned()
            .unwrap_or_else(|| "已导入".to_string()),
        archived: false,
    }))
}

fn split_markdown_frontmatter(raw: &str) -> (BTreeMap<String, String>, &str) {
    let mut frontmatter = BTreeMap::new();
    let Some(rest) = raw
        .strip_prefix("---\n")
        .or_else(|| raw.strip_prefix("---\r\n"))
    else {
        return (frontmatter, raw);
    };

    let mut offset = raw.len() - rest.len();
    for line in rest.split_inclusive('\n') {
        let trimmed = line.trim();
        if trimmed == "---" {
            return (frontmatter, &raw[offset + line.len()..]);
        }
        if let Some((key, value)) = trimmed.split_once(':') {
            frontmatter.insert(key.trim().to_string(), trim_frontmatter_value(value));
        }
        offset += line.len();
    }

    (BTreeMap::new(), raw)
}

fn trim_frontmatter_value(value: &str) -> String {
    let trimmed = value.trim();
    trimmed
        .strip_prefix('"')
        .and_then(|value| value.strip_suffix('"'))
        .or_else(|| {
            trimmed
                .strip_prefix('\'')
                .and_then(|value| value.strip_suffix('\''))
        })
        .unwrap_or(trimmed)
        .to_string()
}

fn first_markdown_heading(body: &str) -> Option<String> {
    body.lines()
        .find_map(|line| line.trim().strip_prefix("# ").map(str::trim))
        .filter(|line| !line.is_empty())
        .map(ToString::to_string)
}

fn first_markdown_summary(body: &str) -> Option<String> {
    body.lines()
        .map(str::trim)
        .find(|line| !line.is_empty() && !line.starts_with('#') && !line.starts_with("---"))
        .map(ToString::to_string)
}

fn workspace_memory_category(memory_type: &str) -> &'static str {
    match memory_type {
        "user" => "偏好",
        "project" => "项目",
        "feedback" => "经验",
        _ => "其他",
    }
}

fn memory_slug(value: &str) -> String {
    value
        .chars()
        .filter_map(|character| {
            if character.is_ascii_alphanumeric() {
                Some(character.to_ascii_lowercase())
            } else if character == '-' || character == '_' {
                Some('-')
            } else {
                None
            }
        })
        .collect::<String>()
        .trim_matches('-')
        .to_string()
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
            "/api/desktop/messages/attachments",
            post(add_attachment_message),
        )
        .route("/api/desktop/messages/media", post(add_media_message))
        .route("/api/desktop/messages/voice", post(add_voice_message))
        .route(
            "/api/desktop/messages/workflows",
            post(add_workflow_message),
        )
        .route("/api/desktop/messages/skills", post(add_skill_call_message))
        .route("/api/desktop/messages/abort", post(abort_message))
        .route("/api/desktop/messages/steer", post(steer_message))
        .route(
            "/api/desktop/assets/{asset_id}/content",
            get(desktop_asset_content),
        )
        .route(
            "/api/desktop/assets/{asset_id}/open",
            post(open_desktop_asset),
        )
        .route(
            "/api/desktop/assets/{asset_id}/reveal",
            post(reveal_desktop_asset),
        )
        .route(
            "/api/desktop/permissions/{request_id}/decision",
            post(permission_decision),
        )
        .route("/api/desktop/preferences", patch(update_preferences))
        .route(
            "/api/desktop/model-profiles/test-and-save",
            post(test_and_save_model_profile),
        )
        .route(
            "/api/desktop/settings/diagnostics",
            post(settings_diagnostics),
        )
        .route(
            "/api/desktop/settings/export-data",
            post(settings_export_data),
        )
        .route(
            "/api/desktop/settings/clear-cache",
            post(settings_clear_cache),
        )
        .route(
            "/api/desktop/settings/delete-local-data",
            post(settings_delete_local_data),
        )
        .route(
            "/api/desktop/settings/reset-state",
            post(settings_reset_state),
        )
        .route("/api/desktop/plugins/skills", post(add_plugin_skill))
        .route("/api/desktop/plugins/install", post(install_plugin))
        .route(
            "/api/desktop/plugins/{plugin_id}/uninstall",
            post(uninstall_plugin),
        )
        .route(
            "/api/desktop/plugins/{plugin_id}/enabled",
            patch(set_installed_plugin_enabled),
        )
        .route(
            "/api/desktop/plugins/skills/{skill_id}",
            delete(remove_plugin_skill),
        )
        .route(
            "/api/desktop/plugins/skills/{skill_id}/toggle",
            post(toggle_plugin_skill),
        )
        .route(
            "/api/desktop/plugins/skills/{skill_id}/enabled",
            patch(set_plugin_skill_enabled_route),
        )
        .route(
            "/api/desktop/plugins/tools/{tool_id}/toggle",
            post(toggle_plugin_tool),
        )
        .route(
            "/api/desktop/plugins/tools/{tool_id}/enabled",
            patch(set_plugin_tool_enabled_route),
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
    sync_privacy_defaults_from_runtime_root(&mut preferences, &state.runtime_root);
    sync_preference_aliases_from_task_defaults(&mut preferences);
    state
        .preferences_store
        .save_preferences(&DesktopPreferencesRecord {
            selected_model: preferences.selected_model.clone(),
            selected_thinking: preferences.selected_thinking.clone(),
            permission_mode: preferences.permission_mode.clone(),
            model_options: preferences.model_options.clone(),
            task_defaults: preference_group_value(
                state,
                "taskDefaults",
                &preferences.task_defaults,
            )?,
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
