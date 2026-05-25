use axum::body::Bytes;
use axum::extract::Path;
use axum::extract::State;
use axum::http::{HeaderMap, StatusCode};
use axum::Json;

use super::*;

pub(super) async fn install_plugin(
    State(state): State<GatewayState>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<Json<DesktopState>, StatusCode> {
    authorize_headers(&headers, &state)?;
    let input = parse_json_body(body)?;
    let params = plugin_install_params(&input)?;
    let result = crawclaw_gateway::call_gateway_method_for_runtime_root(
        state.runtime_root.clone(),
        state.runtime_root.join("config"),
        "plugins.install",
        params,
    )
    .await
    .map_err(|error| {
        emit_operation_failed(&state, "plugin_install_failed", error);
        StatusCode::BAD_REQUEST
    })?;
    refresh_plugins_workspace(&state).await?;
    {
        let mut desktop_state = state.desktop_state.write().await;
        if let Some(plugin_id) = result
            .get("pluginId")
            .and_then(Value::as_str)
            .or_else(|| result.get("id").and_then(Value::as_str))
        {
            desktop_state
                .conversation
                .result_items
                .push(format!("插件已安装: {plugin_id}"));
        }
    }
    emit_state_changed(&state).await
}

pub(super) async fn uninstall_plugin(
    State(state): State<GatewayState>,
    headers: HeaderMap,
    Path(plugin_id): Path<String>,
) -> Result<Json<DesktopState>, StatusCode> {
    authorize_headers(&headers, &state)?;
    let params = json!({ "id": plugin_id });
    let result = crawclaw_gateway::call_gateway_method_for_runtime_root(
        state.runtime_root.clone(),
        state.runtime_root.join("config"),
        "plugins.uninstall",
        params,
    )
    .await
    .map_err(|error| {
        emit_operation_failed(&state, "plugin_uninstall_failed", error);
        StatusCode::BAD_REQUEST
    })?;
    refresh_plugins_workspace(&state).await?;
    {
        let mut desktop_state = state.desktop_state.write().await;
        if let Some(plugin_id) = result
            .get("pluginId")
            .and_then(Value::as_str)
            .or_else(|| result.get("id").and_then(Value::as_str))
        {
            desktop_state
                .conversation
                .result_items
                .push(format!("插件已卸载: {plugin_id}"));
        }
    }
    emit_state_changed(&state).await
}

pub(super) async fn set_installed_plugin_enabled(
    State(state): State<GatewayState>,
    headers: HeaderMap,
    Path(plugin_id): Path<String>,
    body: Bytes,
) -> Result<Json<DesktopState>, StatusCode> {
    authorize_headers(&headers, &state)?;
    let input = parse_json_body(body)?;
    let enabled = input
        .get("enabled")
        .and_then(Value::as_bool)
        .ok_or(StatusCode::BAD_REQUEST)?;
    let method = if enabled {
        "plugins.enable"
    } else {
        "plugins.disable"
    };
    crawclaw_gateway::call_gateway_method_for_runtime_root(
        state.runtime_root.clone(),
        state.runtime_root.join("config"),
        method,
        json!({ "id": plugin_id }),
    )
    .await
    .map_err(|error| {
        emit_operation_failed(&state, "plugin_enabled_failed", error);
        StatusCode::BAD_REQUEST
    })?;
    refresh_plugins_workspace(&state).await?;
    emit_state_changed(&state).await
}

fn plugin_install_params(input: &Value) -> Result<Value, StatusCode> {
    let source = string_field(input, "source").ok_or(StatusCode::BAD_REQUEST)?;
    let mut params = Map::new();
    if let Some(marketplace_plugin) = string_field(input, "marketplacePlugin")
        .or_else(|| string_field(input, "marketplace_plugin"))
    {
        params.insert(
            "marketplaceSource".to_string(),
            Value::String(source.to_string()),
        );
        params.insert(
            "marketplacePlugin".to_string(),
            Value::String(marketplace_plugin),
        );
    } else if looks_like_bundled_plugin_id(&source) {
        params.insert("pluginId".to_string(), Value::String(source));
    } else {
        params.insert("raw".to_string(), Value::String(source));
    }
    if let Some(link) = input.get("link").and_then(Value::as_bool) {
        params.insert("link".to_string(), Value::Bool(link));
    }
    if let Some(pin) = input.get("pin").and_then(Value::as_bool) {
        params.insert("pin".to_string(), Value::Bool(pin));
    }
    Ok(Value::Object(params))
}

fn looks_like_bundled_plugin_id(source: &str) -> bool {
    source
        .chars()
        .all(|ch| ch.is_ascii_lowercase() || ch.is_ascii_digit() || ch == '-')
}

pub(super) async fn invoke_plugin_tool_operation(
    state: &GatewayState,
    input: Value,
) -> Result<Json<DesktopState>, StatusCode> {
    let plugin_id = string_field(&input, "pluginId").ok_or(StatusCode::BAD_REQUEST)?;
    let tool_id = string_field(&input, "toolId").ok_or(StatusCode::BAD_REQUEST)?;
    let tool_input = input.get("input").cloned().unwrap_or_else(|| json!({}));
    let thread_id = format!("plugin:{plugin_id}");
    let title = format!("{plugin_id}/{tool_id}");
    let confirmed = input
        .get("confirmed")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    ensure_plugin_tool_allowed(state, &plugin_id, &tool_id, &title, confirmed).await?;
    let _ = state.events.send(DesktopEvent::ToolCall {
        thread_id: thread_id.clone(),
        tool_id: tool_id.clone(),
    });
    let _ = append_and_persist_conversation_message_with_emit(
        state,
        conversation_tool_call_message(tool_id.clone(), title.clone(), None),
        false,
    )
    .await?;
    let result = match invoke_rust_native_plugin_tool(state, &plugin_id, &tool_id, &tool_input)
        .await
    {
        Some(Ok(result)) => result,
        Some(Err(error)) => {
            let _ = state.events.send(DesktopEvent::ToolResult {
                thread_id,
                tool_id: tool_id.clone(),
                ok: false,
            });
            let _ = append_and_persist_conversation_message(
                state,
                conversation_tool_result_message(
                    tool_id.clone(),
                    title.clone(),
                    false,
                    error.clone(),
                ),
            )
            .await;
            return Err(plugin_host_status(state, PluginHostError::Invalid(error)));
        }
        None => {
            let error =
                format!("Rust-native plugin \"{plugin_id}\" does not expose tool \"{tool_id}\"");
            let _ = state.events.send(DesktopEvent::ToolResult {
                thread_id: thread_id.clone(),
                tool_id: tool_id.clone(),
                ok: false,
            });
            let _ = append_and_persist_conversation_message(
                state,
                conversation_tool_result_message(
                    tool_id.clone(),
                    title.clone(),
                    false,
                    error.clone(),
                ),
            )
            .await;
            return Err(plugin_host_status(state, PluginHostError::Invalid(error)));
        }
    };
    let result_text = plugin_tool_result_text(&result);
    let _ = append_and_persist_conversation_message(
        state,
        conversation_tool_result_message(tool_id.clone(), title, true, result_text.clone()),
    )
    .await?;
    {
        let mut desktop_state = state.desktop_state.write().await;
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

async fn ensure_plugin_tool_allowed(
    state: &GatewayState,
    plugin_id: &str,
    tool_id: &str,
    title: &str,
    confirmed: bool,
) -> Result<(), StatusCode> {
    let (permission, name, enabled, preferences) = {
        let desktop_state = state.desktop_state.read().await;
        let Some(tool) = desktop_state
            .plugins_workspace
            .tools
            .iter()
            .find(|tool| tool.plugin_id == plugin_id && tool.id == tool_id)
            .cloned()
        else {
            return Ok(());
        };
        (
            tool.permission,
            tool.name,
            tool.enabled,
            desktop_state.preferences.clone(),
        )
    };
    if !enabled || !preferences.task_defaults.allow_tools {
        emit_operation_failed(
            state,
            "plugin_tool_disabled",
            format!("Tool {title} is disabled by desktop preferences."),
        );
        return Err(StatusCode::FORBIDDEN);
    }
    if preferences.task_defaults.permission_mode == "只读模式"
        && !is_read_only_plugin_permission(&permission)
    {
        emit_operation_failed(
            state,
            "permission_denied",
            format!("只读模式不允许运行 {title}。"),
        );
        return Err(StatusCode::FORBIDDEN);
    }
    let Some((category, should_confirm)) =
        plugin_permission_confirmation(&permission, &preferences.confirmation_defaults)
    else {
        return Ok(());
    };
    if !should_confirm || confirmed {
        return Ok(());
    }
    let decision = request_runtime_permission(
        state.clone(),
        AgentRuntimePermissionRequest {
            category,
            detail: format!("{name} 将以 {permission} 权限试运行。"),
            title: format!("运行插件工具 {title}"),
            tool_call_id: format!("plugin:{plugin_id}:{tool_id}"),
            tool_name: title.to_string(),
        },
    )
    .await;
    if decision == AgentRuntimePermissionDecision::Approved {
        Ok(())
    } else {
        emit_operation_failed(
            state,
            "permission_denied",
            format!("已拒绝运行插件工具 {title}。"),
        );
        Err(StatusCode::FORBIDDEN)
    }
}

fn is_read_only_plugin_permission(permission: &str) -> bool {
    matches!(permission, "local" | "read" | "readonly" | "只读")
}

fn plugin_permission_confirmation(
    permission: &str,
    confirmations: &ConfirmationDefaults,
) -> Option<(AgentRuntimePermissionCategory, bool)> {
    match permission {
        "local" | "read" | "readonly" | "只读" => None,
        "workspace" => Some((
            AgentRuntimePermissionCategory::FileChange,
            confirmations.confirm_file_changes,
        )),
        "command" => Some((
            AgentRuntimePermissionCategory::Command,
            confirmations.confirm_commands,
        )),
        "externalApp" => Some((
            AgentRuntimePermissionCategory::ExternalApp,
            confirmations.confirm_external_apps,
        )),
        "network" => Some((
            AgentRuntimePermissionCategory::ExternalApp,
            confirmations.confirm_external_apps,
        )),
        "requiresApproval" | "highRisk" => Some((
            AgentRuntimePermissionCategory::HighRisk,
            confirmations.confirm_high_risk,
        )),
        _ => Some((
            AgentRuntimePermissionCategory::ExternalApp,
            confirmations.confirm_external_apps || confirmations.confirm_high_risk,
        )),
    }
}

pub(super) async fn invoke_rust_native_plugin_tool(
    state: &GatewayState,
    plugin_id: &str,
    tool_id: &str,
    input: &Value,
) -> Option<Result<Value, String>> {
    if plugin_id == "crawclaw-runtime" {
        return Some(
            crawclaw_runtime::execute_rust_core_tool(&state.runtime_root, tool_id, input.clone())
                .await,
        );
    }
    let result = match (plugin_id, tool_id) {
        ("comfyui", "comfyui_workflow") => Some(invoke_comfyui_native_tool(state, input).await),
        ("searxng", "searxng_search") => Some(
            run_searxng_search(native_tool_input(state, input))
                .await
                .map_err(|error| error.to_string()),
        ),
        ("spider-fetch", "spider_fetch") => Some(
            run_spider_fetch(native_tool_input(state, input))
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
    };
    if result.is_some() {
        return result;
    }
    let operation =
        crawclaw_runtime::native_plugin_tool_descriptors_for_runtime_root(&state.runtime_root)
            .into_iter()
            .find_map(|(descriptor_plugin_id, descriptor)| {
                (descriptor_plugin_id == plugin_id && descriptor.name == tool_id)
                    .then(|| descriptor.invocation.operation)
            })?;
    Some(
        crawclaw_runtime::execute_native_plugin_invoke_operation(
            &state.runtime_root,
            json!({
                "pluginId": plugin_id,
                "operation": operation,
                "input": input,
            }),
        )
        .await,
    )
}

pub(super) async fn invoke_comfyui_native_tool(
    state: &GatewayState,
    input: &Value,
) -> Result<Value, String> {
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

pub(super) fn native_tool_input(state: &GatewayState, input: &Value) -> Value {
    json!({
        "params": input,
        "pluginConfig": input.get("pluginConfig").cloned().unwrap_or_else(|| json!({})),
        "workspaceDir": state.runtime_root.to_string_lossy()
    })
}

pub(super) fn plugin_tool_result_text(result: &Value) -> String {
    match result {
        Value::String(text) => text.clone(),
        _ => serde_json::to_string(result).unwrap_or_else(|_| "null".to_string()),
    }
}
