use axum::extract::{Path, State};
use axum::http::{HeaderMap, StatusCode};
use axum::Json;
use base64::engine::general_purpose::STANDARD;
use base64::Engine as _;
use serde::Deserialize;
use serde_json::{json, Map, Value};
use std::path::Path as FsPath;
use std::time::{SystemTime, UNIX_EPOCH};

use crate::gateway::desktop_state::initial_desktop_state;
use crate::models::{
    AdvancedDefaults, ConfirmationDefaults, DesktopState, MemoryDefaults, NotificationDefaults,
    PrivacyDefaults, TaskDefaults, UiDefaults,
};

use super::desktop_logging::{
    desktop_rust_log_filter, desktop_rust_log_path, recent_desktop_rust_log_lines,
};
use super::desktop_model_profile_routes::{
    apply_active_model_profile_for_selection, merge_persisted_model_profiles,
};
use super::desktop_settings_effects::{
    apply_desktop_settings_effects, send_desktop_notification, DesktopNotificationKind,
};
use super::{
    append_and_persist_conversation_message, authorize_headers, conversation_status_message,
    emit_state_changed, merge_persisted_agents, merge_persisted_memory_items,
    normalize_task_defaults, persist_desktop_preferences,
    sync_preference_aliases_from_task_defaults, sync_privacy_defaults_from_runtime_root,
    sync_task_defaults_from_preference_aliases, GatewayState,
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
        sync_privacy_defaults_from_runtime_root(&mut preferences, &state.runtime_root);
        preferences
    };
    persist_desktop_preferences(&state, &updated_preferences)?;
    tracing::info!(
        runtime_root = %state.runtime_root.display(),
        selected_model = %updated_preferences.selected_model,
        log_level = %updated_preferences.advanced_defaults.log_level,
        "desktop_preferences_updated"
    );
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
    let diagnostics_path = state
        .runtime_root
        .join("desktop")
        .join("diagnostics")
        .join(format!(
            "desktop-diagnostics-{}.json",
            uuid::Uuid::new_v4().simple()
        ));
    tracing::info!(
        runtime_root = %state.runtime_root.display(),
        diagnostics_path = %diagnostics_path.display(),
        "desktop_diagnostics_generated"
    );
    let diagnostics = build_advanced_diagnostics_snapshot(&state).await;
    write_json_file(&diagnostics_path, &diagnostics).map_err(|error| {
        emit_settings_error(&state, "settings_diagnostics_failed", error);
        StatusCode::INTERNAL_SERVER_ERROR
    })?;
    let _ = append_and_persist_conversation_message(
        &state,
        conversation_status_message(
            "诊断信息已生成".to_string(),
            diagnostics_path.to_string_lossy().to_string(),
            "ok".to_string(),
        ),
    )
    .await?;
    notify_settings_task_done(&state, "诊断信息已生成", "桌面诊断信息已写入当前对话。").await;
    emit_state_changed(&state).await
}

async fn build_advanced_diagnostics_snapshot(state: &GatewayState) -> Value {
    let desktop_state = state.desktop_state.read().await;
    let runtime = state.runtime_supervisor.status();
    let settings_dir = state.runtime_root.join("desktop").join("settings");
    json!({
        "version": 1,
        "generatedAtUnixMs": now_unix_ms(),
        "runtimeRoot": state.runtime_root.to_string_lossy(),
        "runtime": runtime,
        "state": {
            "threads": desktop_state.sidebar.threads.len()
                + desktop_state.sidebar.pinned_threads.len()
                + desktop_state.sidebar.discussion_threads.len(),
            "agents": desktop_state.agent_workspace.agents.len(),
            "tools": desktop_state.plugins_workspace.tools.len(),
            "memoryItems": desktop_state.memory_workspace.items.len(),
            "workflows": count_files_under(&state.runtime_root.join("workflows")),
            "activeNavId": &desktop_state.active_nav_id,
            "permissionRequestStatus": &desktop_state.permission_request.status,
        },
        "advanced": {
            "logLevel": &desktop_state.preferences.advanced_defaults.log_level,
            "rustLogFilter": desktop_rust_log_filter(&desktop_state.preferences.advanced_defaults.log_level),
        },
        "settingsEffects": {
            "effectiveState": file_status(&settings_dir.join("effective-state.json")),
            "runtimeLogLevel": runtime_log_level_status(&settings_dir.join("runtime-log-level")),
            "notificationPolicy": file_status(&state.runtime_root.join("desktop/notifications/policy.json")),
            "memoryPolicy": file_status(&state.runtime_root.join("config/desktop-memory-policy.json")),
        },
        "rustLogPath": desktop_rust_log_path(&state.runtime_root).to_string_lossy(),
        "recentRustLog": recent_desktop_rust_log_lines(&state.runtime_root, 80),
    })
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
    let snapshot = build_privacy_export_snapshot(&state)
        .await
        .map_err(|error| {
            emit_settings_error(&state, "settings_export_failed", error);
            StatusCode::INTERNAL_SERVER_ERROR
        })?;
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

async fn build_privacy_export_snapshot(state: &GatewayState) -> Result<Value, String> {
    let desktop_state = state.desktop_state.read().await;
    let (files, skipped) = collect_privacy_export_files(&state.runtime_root)?;
    Ok(json!({
        "version": 1,
        "generatedAtUnixMs": now_unix_ms(),
        "runtimeRoot": state.runtime_root.to_string_lossy(),
        "state": {
            "preferences": &desktop_state.preferences,
            "conversation": &desktop_state.conversation,
            "sessions": {
                "threads": &desktop_state.sidebar.threads,
                "pinnedThreads": &desktop_state.sidebar.pinned_threads,
                "discussionThreads": &desktop_state.sidebar.discussion_threads,
            },
            "agents": &desktop_state.agent_workspace.agents,
            "memoryWorkspace": &desktop_state.memory_workspace,
            "plugins": &desktop_state.plugins_workspace,
        },
        "files": files,
        "skipped": skipped,
    }))
}

fn collect_privacy_export_files(runtime_root: &FsPath) -> Result<(Vec<Value>, Vec<Value>), String> {
    let mut files = Vec::new();
    let mut skipped = Vec::new();
    for root_name in [
        "desktop",
        "sessions",
        "agents",
        "memory",
        "workflows",
        "config",
        "credentials",
    ] {
        let path = runtime_root.join(root_name);
        if path.exists() {
            collect_privacy_export_path(runtime_root, &path, None, &mut files, &mut skipped)?;
        }
    }
    Ok((files, skipped))
}

fn collect_privacy_export_path(
    runtime_root: &FsPath,
    path: &FsPath,
    inherited_skip_reason: Option<&'static str>,
    files: &mut Vec<Value>,
    skipped: &mut Vec<Value>,
) -> Result<(), String> {
    let relative_path = export_relative_path(runtime_root, path)?;
    let skip_reason = inherited_skip_reason.or_else(|| privacy_export_skip_reason(&relative_path));
    let metadata = std::fs::symlink_metadata(path)
        .map_err(|error| format!("Failed to inspect export path {}: {error}", path.display()))?;
    if metadata.is_dir() {
        let entries = std::fs::read_dir(path).map_err(|error| {
            format!(
                "Failed to read export directory {}: {error}",
                path.display()
            )
        })?;
        for entry in entries {
            let entry =
                entry.map_err(|error| format!("Failed to read export directory entry: {error}"))?;
            collect_privacy_export_path(runtime_root, &entry.path(), skip_reason, files, skipped)?;
        }
        return Ok(());
    }
    if let Some(reason) = skip_reason {
        skipped.push(json!({
            "path": relative_path,
            "reason": reason,
            "bytes": metadata.len(),
        }));
        return Ok(());
    }
    if metadata.file_type().is_symlink() {
        skipped.push(json!({
            "path": relative_path,
            "reason": "symlink",
            "bytes": metadata.len(),
        }));
        return Ok(());
    }
    if !metadata.is_file() {
        skipped.push(json!({
            "path": relative_path,
            "reason": "unsupported",
            "bytes": metadata.len(),
        }));
        return Ok(());
    }
    let bytes = std::fs::read(path)
        .map_err(|error| format!("Failed to read export file {}: {error}", path.display()))?;
    files.push(privacy_export_file_entry(relative_path, &bytes)?);
    Ok(())
}

fn privacy_export_file_entry(relative_path: String, bytes: &[u8]) -> Result<Value, String> {
    let mut entry = Map::new();
    entry.insert("path".to_string(), json!(relative_path));
    entry.insert("bytes".to_string(), json!(bytes.len()));
    match std::str::from_utf8(bytes) {
        Ok(text) => match serde_json::from_str::<Value>(text) {
            Ok(value) => {
                entry.insert("type".to_string(), json!("json"));
                entry.insert("content".to_string(), sanitize_privacy_export_json(value));
            }
            Err(_) => {
                entry.insert("type".to_string(), json!("text"));
                entry.insert("content".to_string(), json!(text));
            }
        },
        Err(_) => {
            entry.insert("type".to_string(), json!("binary"));
            entry.insert("contentBase64".to_string(), json!(STANDARD.encode(bytes)));
        }
    }
    Ok(Value::Object(entry))
}

fn sanitize_privacy_export_json(value: Value) -> Value {
    match value {
        Value::Object(object) => Value::Object(
            object
                .into_iter()
                .map(|(key, value)| {
                    if is_sensitive_export_key(&key) {
                        (key, json!("[redacted]"))
                    } else {
                        (key, sanitize_privacy_export_json(value))
                    }
                })
                .collect(),
        ),
        Value::Array(values) => Value::Array(
            values
                .into_iter()
                .map(sanitize_privacy_export_json)
                .collect(),
        ),
        value => value,
    }
}

fn is_sensitive_export_key(key: &str) -> bool {
    matches!(
        key.to_ascii_lowercase().as_str(),
        "apikey" | "api_key" | "secret" | "token" | "password" | "credential"
    )
}

fn privacy_export_skip_reason(relative_path: &str) -> Option<&'static str> {
    if relative_path == "config/secrets" || relative_path.starts_with("config/secrets/") {
        Some("secret")
    } else if relative_path == "desktop/exports" || relative_path.starts_with("desktop/exports/") {
        Some("export")
    } else if relative_path == "credentials" || relative_path.starts_with("credentials/") {
        Some("credentials")
    } else {
        None
    }
}

fn export_relative_path(runtime_root: &FsPath, path: &FsPath) -> Result<String, String> {
    let relative = path.strip_prefix(runtime_root).map_err(|error| {
        format!(
            "Failed to relativize export path {}: {error}",
            path.display()
        )
    })?;
    Ok(relative
        .components()
        .map(|component| component.as_os_str().to_string_lossy())
        .collect::<Vec<_>>()
        .join("/"))
}

fn write_json_file(path: &FsPath, value: &Value) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|error| format!("Failed to create {}: {error}", parent.display()))?;
    }
    let bytes = serde_json::to_vec_pretty(value)
        .map_err(|error| format!("Failed to encode {}: {error}", path.display()))?;
    std::fs::write(path, bytes)
        .map_err(|error| format!("Failed to write {}: {error}", path.display()))
}

fn file_status(path: &FsPath) -> Value {
    match std::fs::metadata(path) {
        Ok(metadata) => json!({
            "exists": true,
            "path": path.to_string_lossy(),
            "bytes": metadata.len(),
        }),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => json!({
            "exists": false,
            "path": path.to_string_lossy(),
        }),
        Err(error) => json!({
            "exists": false,
            "path": path.to_string_lossy(),
            "error": error.to_string(),
        }),
    }
}

fn runtime_log_level_status(path: &FsPath) -> Value {
    let mut status = file_status(path);
    if let Some(object) = status.as_object_mut() {
        if let Ok(value) = std::fs::read_to_string(path) {
            object.insert("value".to_string(), json!(value.trim()));
        }
    }
    status
}

fn count_files_under(path: &FsPath) -> usize {
    let Ok(entries) = std::fs::read_dir(path) else {
        return 0;
    };
    entries
        .filter_map(Result::ok)
        .map(|entry| {
            let path = entry.path();
            if path.is_dir() {
                count_files_under(&path)
            } else if path.is_file() {
                1
            } else {
                0
            }
        })
        .sum()
}

fn now_unix_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or(0)
}

pub(super) async fn settings_clear_cache(
    State(state): State<GatewayState>,
    headers: HeaderMap,
) -> Result<Json<DesktopState>, StatusCode> {
    authorize_headers(&headers, &state)?;
    for dir in ["cache", "downloads", "previews", "tmp"] {
        remove_dir_if_exists(state.runtime_root.join("desktop").join(dir)).map_err(|error| {
            emit_settings_error(&state, "settings_clear_cache_failed", error);
            StatusCode::INTERNAL_SERVER_ERROR
        })?;
    }
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
    tracing::info!(
        runtime_root = %state.runtime_root.display(),
        "desktop_local_data_delete_requested"
    );
    for path in [
        state.runtime_root.join("desktop"),
        state.runtime_root.join("sessions"),
        state.runtime_root.join("workflows"),
        state
            .runtime_root
            .join("agents")
            .join("desktop-agents.json"),
        state.runtime_root.join("memory"),
        state
            .runtime_root
            .join("config")
            .join("desktop-preferences.json"),
        state
            .runtime_root
            .join("config")
            .join("desktop-memory-policy.json"),
        state
            .runtime_root
            .join("config")
            .join("desktop-agent-provider.json"),
        state
            .runtime_root
            .join("config")
            .join("desktop-model-profiles.json"),
    ] {
        remove_path_if_exists(path).map_err(|error| {
            emit_settings_error(&state, "settings_delete_local_data_failed", error);
            StatusCode::INTERNAL_SERVER_ERROR
        })?;
    }
    {
        let mut desktop_state = state.desktop_state.write().await;
        let mut reset_state = initial_desktop_state(&state.runtime_supervisor.status());
        sync_privacy_defaults_from_runtime_root(&mut reset_state.preferences, &state.runtime_root);
        *desktop_state = reset_state;
    }
    emit_state_changed(&state).await
}

pub(super) async fn settings_reset_state(
    State(state): State<GatewayState>,
    headers: HeaderMap,
    Json(payload): Json<SettingsActionRequest>,
) -> Result<Json<DesktopState>, StatusCode> {
    authorize_headers(&headers, &state)?;
    require_confirmation(payload.confirm.as_deref(), "RESET")?;
    tracing::info!(
        runtime_root = %state.runtime_root.display(),
        "desktop_state_reset_requested"
    );
    for path in [
        state.runtime_root.join("sessions"),
        state
            .runtime_root
            .join("config")
            .join("desktop-preferences.json"),
        state.runtime_root.join("desktop").join("settings"),
        state.runtime_root.join("desktop").join("diagnostics"),
        state.runtime_root.join("desktop").join("logs"),
    ] {
        remove_path_if_exists(path).map_err(|error| {
            emit_settings_error(&state, "settings_reset_state_failed", error);
            StatusCode::INTERNAL_SERVER_ERROR
        })?;
    }
    let mut reset_state = initial_desktop_state(&state.runtime_supervisor.status());
    sync_privacy_defaults_from_runtime_root(&mut reset_state.preferences, &state.runtime_root);
    merge_persisted_agents(&mut reset_state, &state.agent_store);
    merge_persisted_memory_items(&mut reset_state, &state.memory_store);
    merge_persisted_model_profiles(&mut reset_state, &state.model_profile_store);
    apply_desktop_settings_effects(&state.runtime_root, &reset_state.preferences).map_err(
        |error| {
            emit_settings_error(&state, "settings_reset_state_failed", error);
            StatusCode::INTERNAL_SERVER_ERROR
        },
    )?;
    {
        let mut desktop_state = state.desktop_state.write().await;
        *desktop_state = reset_state;
    }
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
