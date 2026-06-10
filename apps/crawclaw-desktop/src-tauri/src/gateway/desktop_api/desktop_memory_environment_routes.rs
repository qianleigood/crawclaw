use axum::extract::State;
use axum::http::{HeaderMap, StatusCode};
use axum::Json;
use serde::Deserialize;
use serde_json::{json, Value};

use crawclaw_runtime::memory::MemoryRuntime;

use super::desktop_hindsight_lifecycle::prepare_desktop_hindsight_lifecycle;
use super::{
    append_and_persist_conversation_message, authorize_headers, conversation_status_message,
    emit_state_changed, GatewayState,
};
use crate::models::{DesktopState, RuntimeCheck};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct MemoryEnvironmentReinstallRequest {
    confirm: Option<String>,
}

pub(super) async fn check_memory_environment(
    State(state): State<GatewayState>,
) -> Result<Json<DesktopState>, StatusCode> {
    refresh_memory_environment_state(&state, "check", json!({})).await?;
    emit_state_changed(&state).await
}

pub(super) async fn repair_memory_environment(
    State(state): State<GatewayState>,
    headers: HeaderMap,
) -> Result<Json<DesktopState>, StatusCode> {
    authorize_headers(&headers, &state)?;
    let operation = repair_memory_environment_inner(&state).await;
    refresh_memory_environment_state(&state, "repair", operation).await?;
    let _ = append_and_persist_conversation_message(
        &state,
        conversation_status_message(
            "记忆环境修复已完成".to_string(),
            "已检查 Hindsight 生命周期并重新初始化记忆 banks。".to_string(),
            "ok".to_string(),
        ),
    )
    .await?;
    emit_state_changed(&state).await
}

pub(super) async fn reinstall_memory_environment(
    State(state): State<GatewayState>,
    headers: HeaderMap,
    Json(payload): Json<MemoryEnvironmentReinstallRequest>,
) -> Result<Json<DesktopState>, StatusCode> {
    authorize_headers(&headers, &state)?;
    if payload.confirm.as_deref() != Some("REINSTALL") {
        return Err(StatusCode::BAD_REQUEST);
    }

    let operation = repair_memory_environment_inner(&state).await;
    refresh_memory_environment_state(&state, "reinstall", operation).await?;
    let _ = append_and_persist_conversation_message(
        &state,
        conversation_status_message(
            "记忆运行环境已重新安装".to_string(),
            "已保留 memory/ 与 hindsight/ 数据目录，并重新准备 Hindsight 运行环境。".to_string(),
            "ok".to_string(),
        ),
    )
    .await?;
    emit_state_changed(&state).await
}

async fn repair_memory_environment_inner(state: &GatewayState) -> Value {
    let lifecycle = prepare_desktop_hindsight_lifecycle(&state.runtime_root)
        .await
        .map(|value| json!({ "status": "ok", "result": value }))
        .unwrap_or_else(|error| json!({ "status": "error", "error": error }));

    let runtime_root = state.runtime_root.clone();
    let bootstrap = tokio::task::spawn_blocking(move || {
        MemoryRuntime::new(runtime_root).bootstrap("desktop-memory:bootstrap", None)
    })
    .await
    .map_err(|error| format!("memory bootstrap join failed: {error}"))
    .and_then(|result| result)
    .map(|value| json!({ "status": "ok", "result": value }))
    .unwrap_or_else(|error| json!({ "status": "error", "error": error }));

    json!({
        "lifecycle": lifecycle,
        "bootstrap": bootstrap,
    })
}

async fn refresh_memory_environment_state(
    state: &GatewayState,
    action: &'static str,
    operation: Value,
) -> Result<(), StatusCode> {
    let runtime_root = state.runtime_root.clone();
    let mut status = tokio::task::spawn_blocking(move || MemoryRuntime::new(runtime_root).status())
        .await
        .map_err(|error| format!("memory runtime status join failed: {error}"))
        .and_then(|result| result)
        .unwrap_or_else(|error| {
            json!({
                "status": "error",
                "error": error,
            })
        });
    attach_environment_action(&mut status, action, operation);

    let runtime_check = memory_runtime_check(&status);
    let mut desktop_state = state.desktop_state.write().await;
    desktop_state.memory_workspace.runtime_status = status;
    upsert_memory_runtime_check(&mut desktop_state.conversation.runtime_checks, runtime_check);
    Ok(())
}

fn attach_environment_action(status: &mut Value, action: &str, operation: Value) {
    if !status.is_object() {
        *status = json!({
            "status": "error",
            "error": "memory status was not an object",
        });
    }
    if let Some(object) = status.as_object_mut() {
        object.insert("action".to_string(), json!(action));
        object.insert("operation".to_string(), operation);
        object.insert("checkedAt".to_string(), json!("刚刚"));
    }
}

fn memory_runtime_check(status: &Value) -> RuntimeCheck {
    let lifecycle_status = status
        .pointer("/hindsight/lifecycle/status")
        .and_then(Value::as_str)
        .or_else(|| status.get("status").and_then(Value::as_str))
        .unwrap_or("unknown");
    let reason = status
        .pointer("/hindsight/lifecycle/reason")
        .or_else(|| status.get("error"))
        .and_then(Value::as_str)
        .unwrap_or("");
    RuntimeCheck {
        label: "Memory".to_string(),
        value: if reason.is_empty() {
            lifecycle_status.to_string()
        } else {
            format!("{lifecycle_status}: {reason}")
        },
        tone: match lifecycle_status {
            "ready" | "ok" => "ok",
            "starting" | "disabled" | "unknown" => "neutral",
            _ => "danger",
        }
        .to_string(),
    }
}

fn upsert_memory_runtime_check(checks: &mut Vec<RuntimeCheck>, check: RuntimeCheck) {
    if let Some(existing) = checks.iter_mut().find(|item| item.label == check.label) {
        *existing = check;
    } else {
        checks.push(check);
    }
}
