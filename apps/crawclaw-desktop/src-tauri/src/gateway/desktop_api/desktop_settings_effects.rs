use std::fs;
use std::path::Path;
use std::sync::{Arc, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};

use serde_json::{json, Value};

use crate::models::{DesktopPreferences, NotificationDefaults};

use super::desktop_logging::configure_desktop_rust_logging;

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
    configure_desktop_rust_logging(runtime_root, &preferences.advanced_defaults.log_level)?;
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
    let memory_policy_path = runtime_root
        .join("config")
        .join("desktop-memory-policy.json");
    let mut memory_policy = json!({
        "rememberPreferences": preferences.memory_defaults.remember_preferences,
        "rememberProjectContext": preferences.memory_defaults.remember_project_context,
        "memoryDreamEnabled": preferences.memory_defaults.memory_dream_enabled,
        "memoryDreamFrequency": preferences.memory_defaults.memory_dream_frequency,
        "memoryCleanupConfirmation": preferences.memory_defaults.memory_cleanup_confirmation,
        "updatedAtUnixMs": now_unix_ms(),
    });
    preserve_hindsight_policy_fields(&memory_policy_path, &mut memory_policy);
    write_json_file(&memory_policy_path, &memory_policy)?;
    Ok(())
}

pub(super) fn update_desktop_memory_policy(
    runtime_root: &Path,
    patch: &Value,
) -> Result<(), String> {
    let path = runtime_root
        .join("config")
        .join("desktop-memory-policy.json");
    let mut policy = read_json_file(&path).unwrap_or_else(|| json!({}));
    let Some(policy_object) = policy.as_object_mut() else {
        policy = json!({});
        let policy_object = policy.as_object_mut().expect("object policy");
        if let Some(patch_object) = patch.as_object() {
            for (key, value) in patch_object {
                policy_object.insert(key.clone(), value.clone());
            }
        }
        return write_json_file(&path, &policy);
    };
    if let Some(patch_object) = patch.as_object() {
        for (key, value) in patch_object {
            policy_object.insert(key.clone(), value.clone());
        }
    }
    write_json_file(&path, &policy)
}

fn preserve_hindsight_policy_fields(path: &Path, policy: &mut Value) {
    let Some(existing) = read_json_file(path) else {
        return;
    };
    let Some(existing_object) = existing.as_object() else {
        return;
    };
    let Some(policy_object) = policy.as_object_mut() else {
        return;
    };
    for key in [
        "hindsightEnabled",
        "hindsightMode",
        "hindsightBaseUrl",
        "hindsightManaged",
        "hindsightLifecycleStatus",
        "hindsightLifecycleReason",
    ] {
        if let Some(value) = existing_object.get(key) {
            policy_object.insert(key.to_string(), value.clone());
        }
    }
}

fn read_json_file(path: &Path) -> Option<Value> {
    let text = fs::read_to_string(path).ok()?;
    serde_json::from_str(&text).ok()
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::gateway::desktop_state::initial_desktop_state;
    use crate::models::RuntimeStatus;
    use crawclaw_core::{RuntimeCompatStatus, RuntimeStatusValue};
    use uuid::Uuid;

    fn test_preferences() -> DesktopPreferences {
        initial_desktop_state(&RuntimeStatus {
            status: RuntimeStatusValue::Ready,
            detail: "ready".to_string(),
            runtime_root: "/tmp/crawclaw-test".to_string(),
            binary_path: "/tmp/crawclaw-test/bin/crawclaw-runtime".to_string(),
            compat: RuntimeCompatStatus::default(),
        })
        .preferences
    }

    fn test_runtime_root(name: &str) -> std::path::PathBuf {
        std::env::temp_dir().join(format!("crawclaw-desktop-{name}-{}", Uuid::new_v4()))
    }

    #[test]
    fn notification_kind_gate_controls_recording_and_sound_state() {
        let runtime_root = test_runtime_root("notification-gate");
        let notification_path = runtime_root
            .join("desktop")
            .join("notifications")
            .join("last-notification.json");
        let mut preferences = test_preferences();
        preferences.notification_defaults.notify_task_done = false;
        preferences.notification_defaults.notification_sound = true;

        let sent = send_desktop_notification(
            &runtime_root,
            &preferences,
            DesktopNotificationKind::TaskDone,
            "完成",
            "任务完成。",
        )
        .expect("notification gate");

        assert!(!sent);
        assert!(!notification_path.exists());

        preferences.notification_defaults.notify_task_done = true;
        let sent = send_desktop_notification(
            &runtime_root,
            &preferences,
            DesktopNotificationKind::TaskDone,
            "完成",
            "任务完成。",
        )
        .expect("notification send");

        assert!(sent);
        let notification: Value = serde_json::from_str(
            &fs::read_to_string(&notification_path).expect("notification record"),
        )
        .expect("notification json");
        assert_eq!(notification["kind"], "taskDone");
        assert_eq!(notification["title"], "完成");
        assert_eq!(notification["body"], "任务完成。");
        assert_eq!(notification["sound"], true);

        let _ = fs::remove_dir_all(runtime_root);
    }
}

fn now_unix_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or_default()
}
