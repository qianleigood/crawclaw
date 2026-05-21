use super::*;

pub(super) async fn invoke_plugin_tool_operation(
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

pub(super) async fn invoke_rust_native_plugin_tool(
    state: &GatewayState,
    plugin_id: &str,
    tool_id: &str,
    input: &Value,
) -> Option<Result<Value, String>> {
    match (plugin_id, tool_id) {
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
    }
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
