use axum::extract::{Path, State};
use axum::http::{HeaderMap, StatusCode};
use axum::Json;
use serde::Deserialize;

use crate::models::{
    AdvancedDefaults, ConfirmationDefaults, DesktopState, MemoryDefaults, NotificationDefaults,
    PrivacyDefaults, TaskDefaults, UiDefaults,
};

use super::desktop_model_profile_routes::apply_active_model_profile_for_selection;
use super::desktop_settings_effects::{
    apply_desktop_settings_effects, send_desktop_notification, DesktopNotificationKind,
};
use super::{
    append_and_persist_conversation_message, authorize_headers, conversation_status_message,
    emit_state_changed, normalize_task_defaults, persist_desktop_preferences,
    sync_preference_aliases_from_task_defaults, sync_task_defaults_from_preference_aliases,
    GatewayState,
};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct PreferencesPatch {
    selected_model: Option<String>,
    selected_thinking: Option<String>,
    permission_mode: Option<String>,
    model_options: Option<Vec<String>>,
    task_defaults: Option<TaskDefaultsPatch>,
    confirmation_defaults: Option<ConfirmationDefaultsPatch>,
    notification_defaults: Option<NotificationDefaultsPatch>,
    ui_defaults: Option<UiDefaultsPatch>,
    memory_defaults: Option<MemoryDefaultsPatch>,
    privacy_defaults: Option<PrivacyDefaultsPatch>,
    advanced_defaults: Option<AdvancedDefaultsPatch>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TaskDefaultsPatch {
    selected_model: Option<String>,
    selected_thinking: Option<String>,
    permission_mode: Option<String>,
    response_speed: Option<String>,
    allow_tools: Option<bool>,
    show_reasoning_summary: Option<bool>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ConfirmationDefaultsPatch {
    confirm_file_changes: Option<bool>,
    confirm_commands: Option<bool>,
    confirm_external_apps: Option<bool>,
    confirm_high_risk: Option<bool>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct NotificationDefaultsPatch {
    notify_task_done: Option<bool>,
    notify_confirm_needed: Option<bool>,
    notify_dream_done: Option<bool>,
    notify_automation_failed: Option<bool>,
    notification_sound: Option<bool>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct UiDefaultsPatch {
    default_page: Option<String>,
    language: Option<String>,
    appearance: Option<String>,
    launch_at_login: Option<bool>,
    show_in_menu_bar: Option<bool>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct MemoryDefaultsPatch {
    remember_preferences: Option<bool>,
    remember_project_context: Option<bool>,
    memory_dream_enabled: Option<bool>,
    memory_dream_frequency: Option<String>,
    memory_cleanup_confirmation: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PrivacyDefaultsPatch {
    data_location: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct AdvancedDefaultsPatch {
    log_level: Option<String>,
}

pub(super) async fn update_preferences(
    State(state): State<GatewayState>,
    headers: HeaderMap,
    Json(payload): Json<PreferencesPatch>,
) -> Result<Json<DesktopState>, StatusCode> {
    authorize_headers(&headers, &state)?;
    let updated_preferences = {
        let desktop_state = state.desktop_state.read().await;
        let mut preferences = desktop_state.preferences.clone();
        if let Some(task_defaults) = payload.task_defaults {
            task_defaults.apply(&mut preferences.task_defaults);
            sync_preference_aliases_from_task_defaults(&mut preferences);
        }
        if let Some(confirmation_defaults) = payload.confirmation_defaults {
            confirmation_defaults.apply(&mut preferences.confirmation_defaults);
        }
        if let Some(notification_defaults) = payload.notification_defaults {
            notification_defaults.apply(&mut preferences.notification_defaults);
        }
        if let Some(ui_defaults) = payload.ui_defaults {
            ui_defaults.apply(&mut preferences.ui_defaults);
        }
        if let Some(memory_defaults) = payload.memory_defaults {
            memory_defaults.apply(&mut preferences.memory_defaults);
        }
        if let Some(privacy_defaults) = payload.privacy_defaults {
            privacy_defaults.apply(&mut preferences.privacy_defaults);
        }
        if let Some(advanced_defaults) = payload.advanced_defaults {
            advanced_defaults.apply(&mut preferences.advanced_defaults);
        }
        let mut aliases_changed = false;
        if let Some(model) = payload.selected_model {
            preferences.selected_model = model;
            aliases_changed = true;
        }
        if let Some(thinking) = payload.selected_thinking {
            preferences.selected_thinking = thinking;
            aliases_changed = true;
        }
        if let Some(permission_mode) = payload.permission_mode {
            preferences.permission_mode = permission_mode;
            aliases_changed = true;
        }
        if let Some(model_options) = payload.model_options {
            preferences.model_options = normalize_model_options(model_options);
        }
        if aliases_changed {
            sync_task_defaults_from_preference_aliases(&mut preferences);
        }
        preferences
    };
    persist_desktop_preferences(&state, &updated_preferences)?;
    apply_active_model_profile_for_selection(
        &state.runtime_root,
        &state.model_profile_store,
        &updated_preferences.selected_model,
    )
    .map_err(|error| {
        emit_settings_error(&state, "model_profile_apply_failed", error.to_string());
        StatusCode::INTERNAL_SERVER_ERROR
    })?;
    apply_desktop_settings_effects(&state.runtime_root, &updated_preferences).map_err(|error| {
        emit_settings_error(&state, "settings_hot_apply_failed", error);
        StatusCode::INTERNAL_SERVER_ERROR
    })?;
    {
        let mut desktop_state = state.desktop_state.write().await;
        desktop_state.preferences = updated_preferences;
    }
    emit_state_changed(&state).await
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct SettingsActionRequest {
    confirm: Option<String>,
}

pub(super) async fn settings_diagnostics(
    State(state): State<GatewayState>,
    headers: HeaderMap,
) -> Result<Json<DesktopState>, StatusCode> {
    authorize_headers(&headers, &state)?;
    let detail = {
        let desktop_state = state.desktop_state.read().await;
        format!(
            "runtimeRoot={} threads={} agents={} tools={}",
            state.runtime_root.to_string_lossy(),
            desktop_state.sidebar.threads.len() + desktop_state.sidebar.pinned_threads.len(),
            desktop_state.agent_workspace.agents.len(),
            desktop_state.plugins_workspace.tools.len()
        )
    };
    let _ = append_and_persist_conversation_message(
        &state,
        conversation_status_message("诊断信息已生成".to_string(), detail, "ok".to_string()),
    )
    .await?;
    notify_settings_task_done(&state, "诊断信息已生成", "桌面诊断信息已写入当前对话。").await;
    emit_state_changed(&state).await
}

pub(super) async fn settings_export_data(
    State(state): State<GatewayState>,
    headers: HeaderMap,
) -> Result<Json<DesktopState>, StatusCode> {
    authorize_headers(&headers, &state)?;
    let export_path = state
        .runtime_root
        .join("desktop")
        .join("exports")
        .join(format!(
            "desktop-export-{}.json",
            uuid::Uuid::new_v4().simple()
        ));
    if let Some(parent) = export_path.parent() {
        std::fs::create_dir_all(parent).map_err(|error| {
            emit_settings_error(&state, "settings_export_failed", error.to_string());
            StatusCode::INTERNAL_SERVER_ERROR
        })?;
    }
    let snapshot = {
        let desktop_state = state.desktop_state.read().await;
        serde_json::json!({
            "preferences": desktop_state.preferences,
            "conversation": desktop_state.conversation,
            "agents": desktop_state.agent_workspace.agents,
            "plugins": desktop_state.plugins_workspace,
        })
    };
    std::fs::write(
        &export_path,
        serde_json::to_vec_pretty(&snapshot).map_err(|error| {
            emit_settings_error(&state, "settings_export_failed", error.to_string());
            StatusCode::INTERNAL_SERVER_ERROR
        })?,
    )
    .map_err(|error| {
        emit_settings_error(&state, "settings_export_failed", error.to_string());
        StatusCode::INTERNAL_SERVER_ERROR
    })?;
    let _ = append_and_persist_conversation_message(
        &state,
        conversation_status_message(
            "桌面数据已导出".to_string(),
            export_path.to_string_lossy().to_string(),
            "ok".to_string(),
        ),
    )
    .await?;
    notify_settings_task_done(&state, "桌面数据已导出", "桌面数据导出已完成。").await;
    emit_state_changed(&state).await
}

pub(super) async fn settings_clear_cache(
    State(state): State<GatewayState>,
    headers: HeaderMap,
) -> Result<Json<DesktopState>, StatusCode> {
    authorize_headers(&headers, &state)?;
    remove_dir_if_exists(state.runtime_root.join("desktop").join("cache")).map_err(|error| {
        emit_settings_error(&state, "settings_clear_cache_failed", error);
        StatusCode::INTERNAL_SERVER_ERROR
    })?;
    let _ = append_and_persist_conversation_message(
        &state,
        conversation_status_message(
            "桌面缓存已清理".to_string(),
            state
                .runtime_root
                .join("desktop")
                .join("cache")
                .to_string_lossy()
                .to_string(),
            "ok".to_string(),
        ),
    )
    .await?;
    notify_settings_task_done(&state, "桌面缓存已清理", "桌面缓存清理已完成。").await;
    emit_state_changed(&state).await
}

pub(super) async fn settings_delete_local_data(
    State(state): State<GatewayState>,
    headers: HeaderMap,
    Json(payload): Json<SettingsActionRequest>,
) -> Result<Json<DesktopState>, StatusCode> {
    authorize_headers(&headers, &state)?;
    require_confirmation(payload.confirm.as_deref(), "DELETE")?;
    for path in [
        state.runtime_root.join("desktop"),
        state.runtime_root.join("sessions"),
        state.runtime_root.join("workflows"),
        state
            .runtime_root
            .join("memory")
            .join("desktop-memory.json"),
        state
            .runtime_root
            .join("config")
            .join("desktop-preferences.json"),
    ] {
        remove_path_if_exists(path).map_err(|error| {
            emit_settings_error(&state, "settings_delete_local_data_failed", error);
            StatusCode::INTERNAL_SERVER_ERROR
        })?;
    }
    let _ = append_and_persist_conversation_message(
        &state,
        conversation_status_message(
            "本地桌面数据已删除".to_string(),
            "已删除桌面会话、缓存、导出、工作流和桌面偏好；credentials 未被删除。".to_string(),
            "ok".to_string(),
        ),
    )
    .await?;
    notify_settings_task_done(
        &state,
        "本地桌面数据已删除",
        "桌面自有数据已删除，credentials 已保留。",
    )
    .await;
    emit_state_changed(&state).await
}

pub(super) async fn settings_reset_state(
    State(state): State<GatewayState>,
    headers: HeaderMap,
    Json(payload): Json<SettingsActionRequest>,
) -> Result<Json<DesktopState>, StatusCode> {
    authorize_headers(&headers, &state)?;
    require_confirmation(payload.confirm.as_deref(), "RESET")?;
    for path in [
        state.runtime_root.join("sessions"),
        state
            .runtime_root
            .join("config")
            .join("desktop-preferences.json"),
    ] {
        remove_path_if_exists(path).map_err(|error| {
            emit_settings_error(&state, "settings_reset_state_failed", error);
            StatusCode::INTERNAL_SERVER_ERROR
        })?;
    }
    let _ = append_and_persist_conversation_message(
        &state,
        conversation_status_message(
            "桌面状态已重置".to_string(),
            "已重置桌面会话和偏好；credentials 未被删除。".to_string(),
            "ok".to_string(),
        ),
    )
    .await?;
    notify_settings_task_done(&state, "桌面状态已重置", "桌面会话和偏好重置已完成。").await;
    emit_state_changed(&state).await
}

fn normalize_model_options(model_options: Vec<String>) -> Vec<String> {
    let mut options = Vec::new();
    for option in model_options {
        let option = option.trim();
        if !option.is_empty() && !options.iter().any(|item| item == option) {
            options.push(option.to_string());
        }
    }
    options
}

fn require_confirmation(actual: Option<&str>, expected: &str) -> Result<(), StatusCode> {
    if actual == Some(expected) {
        Ok(())
    } else {
        Err(StatusCode::BAD_REQUEST)
    }
}

fn remove_dir_if_exists(path: std::path::PathBuf) -> Result<(), String> {
    match std::fs::remove_dir_all(&path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(format!("Failed to remove {}: {error}", path.display())),
    }
}

fn remove_path_if_exists(path: std::path::PathBuf) -> Result<(), String> {
    match std::fs::metadata(&path) {
        Ok(metadata) if metadata.is_dir() => remove_dir_if_exists(path),
        Ok(_) => std::fs::remove_file(&path)
            .map_err(|error| format!("Failed to remove {}: {error}", path.display())),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(format!("Failed to inspect {}: {error}", path.display())),
    }
}

fn emit_settings_error(state: &GatewayState, code: &str, message: String) {
    let _ = state
        .events
        .send(crate::models::DesktopEvent::OperationFailed {
            code: code.to_string(),
            message,
        });
}

async fn notify_settings_task_done(state: &GatewayState, title: &str, body: &str) {
    let preferences = {
        let desktop_state = state.desktop_state.read().await;
        desktop_state.preferences.clone()
    };
    if let Err(error) = send_desktop_notification(
        &state.runtime_root,
        &preferences,
        DesktopNotificationKind::TaskDone,
        title,
        body,
    ) {
        emit_settings_error(state, "settings_notification_failed", error);
    }
}

impl TaskDefaultsPatch {
    fn apply(self, task_defaults: &mut TaskDefaults) {
        if let Some(selected_model) = self.selected_model {
            task_defaults.selected_model = selected_model;
        }
        if let Some(selected_thinking) = self.selected_thinking {
            task_defaults.selected_thinking = selected_thinking;
        }
        if let Some(permission_mode) = self.permission_mode {
            task_defaults.permission_mode = permission_mode;
        }
        if let Some(response_speed) = self.response_speed {
            task_defaults.response_speed = response_speed;
        }
        if let Some(allow_tools) = self.allow_tools {
            task_defaults.allow_tools = allow_tools;
        }
        if let Some(show_reasoning_summary) = self.show_reasoning_summary {
            task_defaults.show_reasoning_summary = show_reasoning_summary;
        }
        normalize_task_defaults(task_defaults);
    }
}

impl ConfirmationDefaultsPatch {
    fn apply(self, confirmation_defaults: &mut ConfirmationDefaults) {
        if let Some(confirm_file_changes) = self.confirm_file_changes {
            confirmation_defaults.confirm_file_changes = confirm_file_changes;
        }
        if let Some(confirm_commands) = self.confirm_commands {
            confirmation_defaults.confirm_commands = confirm_commands;
        }
        if let Some(confirm_external_apps) = self.confirm_external_apps {
            confirmation_defaults.confirm_external_apps = confirm_external_apps;
        }
        if let Some(confirm_high_risk) = self.confirm_high_risk {
            confirmation_defaults.confirm_high_risk = confirm_high_risk;
        }
    }
}

impl NotificationDefaultsPatch {
    fn apply(self, notification_defaults: &mut NotificationDefaults) {
        if let Some(notify_task_done) = self.notify_task_done {
            notification_defaults.notify_task_done = notify_task_done;
        }
        if let Some(notify_confirm_needed) = self.notify_confirm_needed {
            notification_defaults.notify_confirm_needed = notify_confirm_needed;
        }
        if let Some(notify_dream_done) = self.notify_dream_done {
            notification_defaults.notify_dream_done = notify_dream_done;
        }
        if let Some(notify_automation_failed) = self.notify_automation_failed {
            notification_defaults.notify_automation_failed = notify_automation_failed;
        }
        if let Some(notification_sound) = self.notification_sound {
            notification_defaults.notification_sound = notification_sound;
        }
    }
}

impl UiDefaultsPatch {
    fn apply(self, ui_defaults: &mut UiDefaults) {
        if let Some(default_page) = self.default_page {
            ui_defaults.default_page = default_page;
        }
        if let Some(language) = self.language {
            ui_defaults.language = language;
        }
        if let Some(appearance) = self.appearance {
            ui_defaults.appearance = appearance;
        }
        if let Some(launch_at_login) = self.launch_at_login {
            ui_defaults.launch_at_login = launch_at_login;
        }
        if let Some(show_in_menu_bar) = self.show_in_menu_bar {
            ui_defaults.show_in_menu_bar = show_in_menu_bar;
        }
    }
}

impl MemoryDefaultsPatch {
    fn apply(self, memory_defaults: &mut MemoryDefaults) {
        if let Some(remember_preferences) = self.remember_preferences {
            memory_defaults.remember_preferences = remember_preferences;
        }
        if let Some(remember_project_context) = self.remember_project_context {
            memory_defaults.remember_project_context = remember_project_context;
        }
        if let Some(memory_dream_enabled) = self.memory_dream_enabled {
            memory_defaults.memory_dream_enabled = memory_dream_enabled;
        }
        if let Some(memory_dream_frequency) = self.memory_dream_frequency {
            memory_defaults.memory_dream_frequency = memory_dream_frequency;
        }
        if let Some(memory_cleanup_confirmation) = self.memory_cleanup_confirmation {
            memory_defaults.memory_cleanup_confirmation = memory_cleanup_confirmation;
        }
    }
}

impl PrivacyDefaultsPatch {
    fn apply(self, privacy_defaults: &mut PrivacyDefaults) {
        if let Some(data_location) = self.data_location {
            privacy_defaults.data_location = data_location;
        }
    }
}

impl AdvancedDefaultsPatch {
    fn apply(self, advanced_defaults: &mut AdvancedDefaults) {
        if let Some(log_level) = self.log_level {
            advanced_defaults.log_level = log_level;
        }
    }
}

pub(super) async fn select_agent(
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
