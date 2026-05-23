use std::fs;
use std::path::Path;
use std::sync::{Arc, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};

use serde_json::{json, Value};

use crate::models::{DesktopPreferences, NotificationDefaults};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum DesktopNotificationKind {
    TaskDone,
    ConfirmNeeded,
    DreamDone,
    AutomationFailed,
}

pub trait DesktopNativeSettingsBridge: Send + Sync {
    fn apply_preferences(&self, preferences: &DesktopPreferences) -> Result<(), String>;
    fn show_notification(&self, title: &str, body: &str, sound: bool) -> Result<(), String>;
}

static NATIVE_SETTINGS_BRIDGE: OnceLock<Arc<dyn DesktopNativeSettingsBridge>> = OnceLock::new();

pub fn install_desktop_native_settings_bridge(bridge: Arc<dyn DesktopNativeSettingsBridge>) {
    let _ = NATIVE_SETTINGS_BRIDGE.set(bridge);
}

pub(super) fn apply_desktop_settings_effects(
    runtime_root: &Path,
    preferences: &DesktopPreferences,
) -> Result<(), String> {
    write_settings_effect_files(runtime_root, preferences)?;
    if let Some(bridge) = NATIVE_SETTINGS_BRIDGE.get() {
        bridge.apply_preferences(preferences)?;
    }
    Ok(())
}

pub(super) fn send_desktop_notification(
    runtime_root: &Path,
    preferences: &DesktopPreferences,
    kind: DesktopNotificationKind,
    title: &str,
    body: &str,
) -> Result<bool, String> {
    if !notification_kind_enabled(&preferences.notification_defaults, kind) {
        return Ok(false);
    }
    let record = json!({
        "kind": notification_kind_id(kind),
        "title": title,
        "body": body,
        "sound": preferences.notification_defaults.notification_sound,
        "sentAtUnixMs": now_unix_ms(),
    });
    write_json_file(
        &runtime_root
            .join("desktop")
            .join("notifications")
            .join("last-notification.json"),
        &record,
    )?;
    if let Some(bridge) = NATIVE_SETTINGS_BRIDGE.get() {
        bridge.show_notification(
            title,
            body,
            preferences.notification_defaults.notification_sound,
        )?;
    }
    Ok(true)
}

fn write_settings_effect_files(
    runtime_root: &Path,
    preferences: &DesktopPreferences,
) -> Result<(), String> {
    let settings_dir = runtime_root.join("desktop").join("settings");
    fs::create_dir_all(&settings_dir).map_err(|error| {
        format!(
            "Failed to create desktop settings directory {}: {error}",
            settings_dir.display()
        )
    })?;
    let effective_state = json!({
        "hot": true,
        "updatedAtUnixMs": now_unix_ms(),
        "task": &preferences.task_defaults,
        "confirmation": &preferences.confirmation_defaults,
        "notifications": &preferences.notification_defaults,
        "ui": &preferences.ui_defaults,
        "memory": &preferences.memory_defaults,
        "privacy": &preferences.privacy_defaults,
        "advanced": &preferences.advanced_defaults,
        "selectedModel": &preferences.selected_model,
        "selectedThinking": &preferences.selected_thinking,
        "permissionMode": &preferences.permission_mode,
        "modelOptions": &preferences.model_options,
    });
    write_json_file(&settings_dir.join("effective-state.json"), &effective_state)?;
    fs::write(
        settings_dir.join("runtime-log-level"),
        preferences.advanced_defaults.log_level.as_bytes(),
    )
    .map_err(|error| format!("Failed to write desktop runtime log level: {error}"))?;
    write_json_file(
        &runtime_root
            .join("desktop")
            .join("notifications")
            .join("policy.json"),
        &json!({
            "enabled": notification_policy_enabled(&preferences.notification_defaults),
            "defaults": &preferences.notification_defaults,
            "updatedAtUnixMs": now_unix_ms(),
        }),
    )?;
    write_json_file(
        &runtime_root
            .join("desktop")
            .join("memory")
            .join("dream-policy.json"),
        &json!({
            "enabled": preferences.memory_defaults.memory_dream_enabled,
            "frequency": preferences.memory_defaults.memory_dream_frequency,
            "cleanupConfirmation": preferences.memory_defaults.memory_cleanup_confirmation,
            "updatedAtUnixMs": now_unix_ms(),
        }),
    )?;
    Ok(())
}

fn write_json_file(path: &Path, value: &Value) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("Failed to create {}: {error}", parent.display()))?;
    }
    let bytes = serde_json::to_vec_pretty(value)
        .map_err(|error| format!("Failed to encode {}: {error}", path.display()))?;
    fs::write(path, bytes).map_err(|error| format!("Failed to write {}: {error}", path.display()))
}

fn notification_policy_enabled(defaults: &NotificationDefaults) -> bool {
    defaults.notify_task_done
        || defaults.notify_confirm_needed
        || defaults.notify_dream_done
        || defaults.notify_automation_failed
}

fn notification_kind_enabled(
    defaults: &NotificationDefaults,
    kind: DesktopNotificationKind,
) -> bool {
    match kind {
        DesktopNotificationKind::TaskDone => defaults.notify_task_done,
        DesktopNotificationKind::ConfirmNeeded => defaults.notify_confirm_needed,
        DesktopNotificationKind::DreamDone => defaults.notify_dream_done,
        DesktopNotificationKind::AutomationFailed => defaults.notify_automation_failed,
    }
}

fn notification_kind_id(kind: DesktopNotificationKind) -> &'static str {
    match kind {
        DesktopNotificationKind::TaskDone => "taskDone",
        DesktopNotificationKind::ConfirmNeeded => "confirmNeeded",
        DesktopNotificationKind::DreamDone => "dreamDone",
        DesktopNotificationKind::AutomationFailed => "automationFailed",
    }
}

fn now_unix_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or_default()
}
