use super::*;

pub(super) async fn claude_control_method(
    state: &GatewayState,
    method: &str,
    params: Value,
) -> Result<Value, String> {
    match method {
        "initialize" => control_initialize(state, params).await,
        "interrupt" => control_interrupt(state, params),
        "set_permission_mode" => control_set_permission_mode(state, params),
        "set_model" => control_set_model(state, params),
        "set_max_thinking_tokens" => control_set_max_thinking_tokens(state, params),
        "mcp_status" => Ok(control_mcp_status(state, None)),
        "get_context_usage" => control_get_context_usage(state, params),
        "reload_plugins" => control_reload_plugins(state),
        "mcp_reconnect" => control_mcp_reconnect(state, params),
        "mcp_toggle" => control_mcp_toggle(state, params),
        "stop_task" => control_stop_task(state, params),
        "cancel_async_message" => control_cancel_async_message(state, params),
        "seed_read_state" => control_seed_read_state(state, params),
        "rewind_files" => control_rewind_files(state, params),
        "apply_flag_settings" => control_apply_flag_settings(state, params),
        "get_settings" => control_get_settings(state),
        _ => Err(format!("Unsupported Rust Gateway method: {method}")),
    }
}

pub(super) async fn claude_control_request(
    state: &GatewayState,
    params: Value,
) -> Result<Value, String> {
    let request_id = string_param(&params, &["request_id", "requestId"])
        .unwrap_or_else(|| format!("gateway-control-{}", now_millis()));
    let request = params.get("request").cloned().unwrap_or(params);
    let subtype = required_param(&request, &["subtype"])?;
    let response = match subtype.as_str() {
        "hook_callback" => control_hook_callback(state, request).await,
        "elicitation" => control_elicitation(state, request).await,
        "can_use_tool" => control_can_use_tool(state, request).await,
        "mcp_message" => control_mcp_message(state, request).await,
        "mcp_set_servers" => mcp_set_servers(state, request),
        other => claude_control_method(state, other, request).await,
    };
    let response = match response {
        Ok(value) => json!({
            "subtype": "success",
            "request_id": request_id,
            "response": value
        }),
        Err(error) => json!({
            "subtype": "error",
            "request_id": request_id,
            "error": error
        }),
    };
    Ok(json!({
        "type": "control_response",
        "response": response
    }))
}

pub(super) fn claude_control_error_response(request_id: String, error: String) -> Value {
    json!({
        "type": "control_response",
        "response": {
            "subtype": "error",
            "request_id": request_id,
            "error": error
        }
    })
}

pub(super) fn control_cancel_request(state: &GatewayState, params: Value) -> Result<Value, String> {
    let request_id = required_param(&params, &["request_id", "requestId"])?;
    let _ = agent_runtime_cancel(state, json!({ "taskId": request_id }));
    Ok(json!({}))
}

pub(super) fn control_update_environment_variables(params: Value) -> Result<Value, String> {
    let variables = params
        .get("variables")
        .and_then(Value::as_object)
        .ok_or_else(|| "update_environment_variables requires variables object".to_string())?;
    let mut updated = Vec::new();
    for (key, value) in variables {
        let value = value
            .as_str()
            .ok_or_else(|| format!("environment variable {key} value must be a string"))?;
        validate_environment_variable(key, value)?;
        std::env::set_var(key, value);
        updated.push(Value::String(key.clone()));
    }
    Ok(json!({
        "updated": updated
    }))
}

pub(super) async fn control_elicitation(
    state: &GatewayState,
    params: Value,
) -> Result<Value, String> {
    let server_name = required_param(&params, &["mcp_server_name", "mcpServerName", "server"])?;
    let message = required_param(&params, &["message"])?;
    let mode = string_param(&params, &["mode"]).unwrap_or_else(|| "form".to_string());
    if !matches!(mode.as_str(), "form" | "url") {
        return Err("elicitation mode must be form or url".to_string());
    }
    if mode == "url" {
        required_param(&params, &["url"])?;
    }
    if let Some(schema) = params
        .get("requested_schema")
        .or_else(|| params.get("requestedSchema"))
    {
        if !schema.is_object() {
            return Err("elicitation requested_schema must be an object".to_string());
        }
    }
    let id = string_param(&params, &["elicitation_id", "elicitationId", "id"])
        .unwrap_or_else(|| format!("elicitation-{}", now_millis()));
    let timeout_ms = params
        .get("timeoutMs")
        .or_else(|| params.get("timeout_ms"))
        .and_then(Value::as_u64)
        .unwrap_or(60_000)
        .min(600_000);
    if let Some(response) = apply_sdk_elicitation_hook(
        state,
        &params,
        &server_name,
        &message,
        &mode,
        &id,
        timeout_ms,
    )
    .await?
    {
        return Ok(response);
    }
    let created_at_ms = now_millis() as u64;
    let expires_at_ms = created_at_ms.saturating_add(timeout_ms);
    let record = SdkElicitationRecord {
        id: id.clone(),
        request: params.clone(),
        created_at_ms,
        expires_at_ms,
        response: None,
        resolved_by: None,
        resolved_at_ms: None,
    };
    {
        let mut elicitations = state
            .sdk_elicitations
            .lock()
            .map_err(|_| "SDK elicitation store lock poisoned".to_string())?;
        prune_expired_elicitations(&mut elicitations, created_at_ms);
        if elicitations.contains_key(&id) {
            return Err(format!("elicitation {id} is already pending"));
        }
        elicitations.insert(id.clone(), record);
    }
    emit(
        state,
        "sdk.elicitation.requested",
        json!({
            "id": id,
            "request": params,
            "serverName": server_name,
            "message": message,
            "mode": mode,
            "createdAtMs": created_at_ms,
            "expiresAtMs": expires_at_ms
        }),
    );
    run_sdk_notification_hooks(
        state,
        "elicitation",
        &format!("MCP server \"{server_name}\" requested input: {message}"),
        Some("MCP elicitation"),
    )
    .await?;
    loop {
        if let Some(response) = take_elicitation_response(state, &id)? {
            return apply_sdk_elicitation_result_hook(
                state,
                &server_name,
                &mode,
                &id,
                response,
                timeout_ms,
            )
            .await;
        }
        let now = now_millis() as u64;
        if now >= expires_at_ms {
            expire_elicitation(state, &id).await?;
            return apply_sdk_elicitation_result_hook(
                state,
                &server_name,
                &mode,
                &id,
                json!({ "action": "cancel" }),
                timeout_ms,
            )
            .await;
        }
        let wait_ms = expires_at_ms.saturating_sub(now).min(1_000);
        let _ = tokio::time::timeout(
            Duration::from_millis(wait_ms),
            state.sdk_elicitation_notify.notified(),
        )
        .await;
    }
}

async fn apply_sdk_elicitation_hook(
    state: &GatewayState,
    params: &Value,
    server_name: &str,
    message: &str,
    mode: &str,
    id: &str,
    timeout_ms: u64,
) -> Result<Option<Value>, String> {
    let mut input = sdk_base_hook_input_for_session(state, "main", "main", "Elicitation");
    if let Some(object) = input.as_object_mut() {
        object.insert(
            "mcp_server_name".to_string(),
            Value::String(server_name.to_string()),
        );
        object.insert("message".to_string(), Value::String(message.to_string()));
        object.insert("mode".to_string(), Value::String(mode.to_string()));
        object.insert("elicitation_id".to_string(), Value::String(id.to_string()));
        if let Some(url) = params.get("url").and_then(Value::as_str) {
            object.insert("url".to_string(), Value::String(url.to_string()));
        }
        if let Some(schema) = params
            .get("requested_schema")
            .or_else(|| params.get("requestedSchema"))
            .cloned()
        {
            object.insert("requested_schema".to_string(), schema);
        }
    }
    let responses =
        run_sdk_hook_callbacks(state, "Elicitation", Some(server_name), input, None).await?;
    for response in responses {
        if let Some(reason) = sdk_hook_blocking_reason(&response) {
            return Ok(Some(
                json!({ "action": "decline", "content": { "reason": reason } }),
            ));
        }
        if let Some(response) = sdk_elicitation_hook_response(&response, "Elicitation")? {
            return Ok(Some(
                apply_sdk_elicitation_result_hook(
                    state,
                    server_name,
                    mode,
                    id,
                    response,
                    timeout_ms,
                )
                .await?,
            ));
        }
    }
    Ok(None)
}

async fn apply_sdk_elicitation_result_hook(
    state: &GatewayState,
    server_name: &str,
    mode: &str,
    id: &str,
    response: Value,
    _timeout_ms: u64,
) -> Result<Value, String> {
    let action = response
        .get("action")
        .and_then(Value::as_str)
        .unwrap_or("cancel")
        .to_string();
    let mut input = sdk_base_hook_input_for_session(state, "main", "main", "ElicitationResult");
    if let Some(object) = input.as_object_mut() {
        object.insert(
            "mcp_server_name".to_string(),
            Value::String(server_name.to_string()),
        );
        object.insert("elicitation_id".to_string(), Value::String(id.to_string()));
        object.insert("mode".to_string(), Value::String(mode.to_string()));
        object.insert("action".to_string(), Value::String(action));
        if let Some(content) = response.get("content").filter(|value| value.is_object()) {
            object.insert("content".to_string(), content.clone());
        }
    }
    let responses =
        run_sdk_hook_callbacks(state, "ElicitationResult", Some(server_name), input, None).await?;
    for hook_response in responses {
        if let Some(reason) = sdk_hook_blocking_reason(&hook_response) {
            return Ok(json!({ "action": "decline", "content": { "reason": reason } }));
        }
        if let Some(updated) = sdk_elicitation_hook_response(&hook_response, "ElicitationResult")? {
            return Ok(updated);
        }
    }
    Ok(response)
}

fn sdk_elicitation_hook_response(
    response: &Value,
    event_name: &str,
) -> Result<Option<Value>, String> {
    let Some(output) = response.get("hookSpecificOutput") else {
        return Ok(None);
    };
    if output.get("hookEventName").and_then(Value::as_str) != Some(event_name) {
        return Ok(None);
    }
    let Some(action) = output.get("action").and_then(Value::as_str) else {
        return Ok(None);
    };
    if !matches!(action, "accept" | "decline" | "cancel") {
        return Err(format!(
            "{event_name} hook action must be accept, decline, or cancel"
        ));
    }
    let mut out = Map::new();
    out.insert("action".to_string(), Value::String(action.to_string()));
    if let Some(content) = output.get("content") {
        if !content.is_object() {
            return Err(format!("{event_name} hook content must be an object"));
        }
        out.insert("content".to_string(), content.clone());
    }
    Ok(Some(Value::Object(out)))
}

pub(super) async fn control_hook_callback(
    state: &GatewayState,
    params: Value,
) -> Result<Value, String> {
    let callback_id = required_param(&params, &["callback_id", "callbackId"])?;
    let input = params
        .get("input")
        .cloned()
        .filter(Value::is_object)
        .ok_or_else(|| "hook_callback requires input object".to_string())?;
    let id = string_param(&params, &["id", "request_id", "requestId"]).unwrap_or_else(|| {
        let tool_use = string_param(&params, &["tool_use_id", "toolUseId"])
            .unwrap_or_else(|| "callback".to_string());
        format!("hook-{callback_id}-{tool_use}-{}", now_millis())
    });
    let timeout_ms = params
        .get("timeoutMs")
        .or_else(|| params.get("timeout_ms"))
        .and_then(Value::as_u64)
        .unwrap_or(60_000)
        .min(600_000);
    let created_at_ms = now_millis() as u64;
    let expires_at_ms = created_at_ms.saturating_add(timeout_ms);
    let record = SdkHookCallbackRecord {
        id: id.clone(),
        callback_id: callback_id.clone(),
        request: params.clone(),
        created_at_ms,
        expires_at_ms,
        response: None,
        resolved_by: None,
        resolved_at_ms: None,
    };
    if is_sdk_control_transport_connected(state) {
        let request = json!({
            "subtype": "hook_callback",
            "callback_id": callback_id,
            "input": input,
            "tool_use_id": string_param(&params, &["tool_use_id", "toolUseId"])
        });
        return control_sdk_outbound_request(state, request, timeout_ms).await;
    }
    {
        let mut callbacks = state
            .sdk_hook_callbacks
            .lock()
            .map_err(|_| "SDK hook callback store lock poisoned".to_string())?;
        prune_expired_hook_callbacks(&mut callbacks, created_at_ms);
        if callbacks.contains_key(&id) {
            return Err(format!("hook callback {id} is already pending"));
        }
        callbacks.insert(id.clone(), record);
    }
    emit(
        state,
        "sdk.hookCallback.requested",
        json!({
            "id": id,
            "callbackId": callback_id,
            "input": input,
            "toolUseId": string_param(&params, &["tool_use_id", "toolUseId"]),
            "createdAtMs": created_at_ms,
            "expiresAtMs": expires_at_ms
        }),
    );
    run_sdk_notification_hooks(
        state,
        "hook_callback",
        &format!("SDK hook callback \"{callback_id}\" is waiting for a response."),
        Some("SDK hook callback"),
    )
    .await?;
    loop {
        if let Some(response) = take_hook_callback_response(state, &id)? {
            return Ok(response);
        }
        let now = now_millis() as u64;
        if now >= expires_at_ms {
            expire_hook_callback(state, &id).await?;
            return Ok(json!({}));
        }
        let wait_ms = expires_at_ms.saturating_sub(now).min(1_000);
        let _ = tokio::time::timeout(
            Duration::from_millis(wait_ms),
            state.sdk_hook_callback_notify.notified(),
        )
        .await;
    }
}

pub(super) fn control_hook_callback_list(state: &GatewayState) -> Result<Value, String> {
    let now = now_millis() as u64;
    let mut callbacks = state
        .sdk_hook_callbacks
        .lock()
        .map_err(|_| "SDK hook callback store lock poisoned".to_string())?;
    prune_expired_hook_callbacks(&mut callbacks, now);
    let pending = callbacks
        .values()
        .filter(|record| record.response.is_none())
        .map(sdk_hook_callback_record_value)
        .collect::<Vec<_>>();
    Ok(json!({ "pending": pending }))
}

pub(super) fn control_hook_callback_respond(
    state: &GatewayState,
    params: Value,
) -> Result<Value, String> {
    let id = required_param(&params, &["id", "request_id", "requestId"])?;
    let response = normalize_hook_callback_response(&params)?;
    let resolved_by = string_param(&params, &["resolvedBy", "resolved_by"]);
    let now = now_millis() as u64;
    let event = {
        let mut callbacks = state
            .sdk_hook_callbacks
            .lock()
            .map_err(|_| "SDK hook callback store lock poisoned".to_string())?;
        prune_expired_hook_callbacks(&mut callbacks, now);
        let record = callbacks
            .get_mut(&id)
            .ok_or_else(|| "unknown or expired hook callback id".to_string())?;
        if record.response.is_some() {
            return Err("hook callback already resolved".to_string());
        }
        record.response = Some(response.clone());
        record.resolved_by = resolved_by.clone();
        record.resolved_at_ms = Some(now);
        json!({
            "id": id,
            "callbackId": record.callback_id,
            "response": response,
            "resolvedBy": resolved_by,
            "ts": now
        })
    };
    state.sdk_hook_callback_notify.notify_waiters();
    emit(state, "sdk.hookCallback.resolved", event);
    Ok(json!({ "ok": true, "id": id }))
}

pub(super) fn control_elicitation_list(state: &GatewayState) -> Result<Value, String> {
    let now = now_millis() as u64;
    let mut elicitations = state
        .sdk_elicitations
        .lock()
        .map_err(|_| "SDK elicitation store lock poisoned".to_string())?;
    prune_expired_elicitations(&mut elicitations, now);
    let pending = elicitations
        .values()
        .filter(|record| record.response.is_none())
        .map(sdk_elicitation_record_value)
        .collect::<Vec<_>>();
    Ok(json!({ "pending": pending }))
}

pub(super) fn control_elicitation_respond(
    state: &GatewayState,
    params: Value,
) -> Result<Value, String> {
    let id = required_param(&params, &["id", "elicitation_id", "elicitationId"])?;
    let response = normalize_elicitation_response(&params)?;
    let resolved_by = string_param(&params, &["resolvedBy", "resolved_by"]);
    let now = now_millis() as u64;
    let event = {
        let mut elicitations = state
            .sdk_elicitations
            .lock()
            .map_err(|_| "SDK elicitation store lock poisoned".to_string())?;
        prune_expired_elicitations(&mut elicitations, now);
        let record = elicitations
            .get_mut(&id)
            .ok_or_else(|| "unknown or expired elicitation id".to_string())?;
        if record.response.is_some() {
            return Err("elicitation already resolved".to_string());
        }
        record.response = Some(response.clone());
        record.resolved_by = resolved_by.clone();
        record.resolved_at_ms = Some(now);
        json!({
            "id": id,
            "response": response,
            "resolvedBy": resolved_by,
            "ts": now
        })
    };
    state.sdk_elicitation_notify.notify_waiters();
    emit(state, "sdk.elicitation.resolved", event);
    Ok(json!({ "ok": true, "id": id }))
}

pub(super) async fn control_mcp_message(
    state: &GatewayState,
    params: Value,
) -> Result<Value, String> {
    let server_name = required_param(&params, &["server_name", "serverName", "server"])?;
    let message = params
        .get("message")
        .cloned()
        .ok_or_else(|| "mcp_message requires message".to_string())?;
    if !message.is_object() {
        return Err("mcp_message message must be a JSON-RPC object".to_string());
    }
    if is_registered_sdk_mcp_server(state, &server_name)? {
        return control_sdk_mcp_message(state, server_name, message).await;
    }
    match crawclaw_runtime::send_mcp_jsonrpc_message(&state.runtime_root, &server_name, message)
        .await?
    {
        Some(response) => Ok(json!({ "mcp_response": response })),
        None => Ok(json!({})),
    }
}

fn take_elicitation_response(state: &GatewayState, id: &str) -> Result<Option<Value>, String> {
    let mut elicitations = state
        .sdk_elicitations
        .lock()
        .map_err(|_| "SDK elicitation store lock poisoned".to_string())?;
    let Some(record) = elicitations.get(id) else {
        return Ok(Some(json!({ "action": "cancel" })));
    };
    let Some(response) = record.response.clone() else {
        return Ok(None);
    };
    elicitations.remove(id);
    Ok(Some(response))
}

fn take_hook_callback_response(state: &GatewayState, id: &str) -> Result<Option<Value>, String> {
    let mut callbacks = state
        .sdk_hook_callbacks
        .lock()
        .map_err(|_| "SDK hook callback store lock poisoned".to_string())?;
    let Some(record) = callbacks.get(id) else {
        return Ok(Some(json!({})));
    };
    let Some(response) = record.response.clone() else {
        return Ok(None);
    };
    callbacks.remove(id);
    Ok(Some(response))
}

async fn expire_elicitation(state: &GatewayState, id: &str) -> Result<(), String> {
    let expired = state
        .sdk_elicitations
        .lock()
        .map_err(|_| "SDK elicitation store lock poisoned".to_string())?
        .remove(id);
    if let Some(record) = expired {
        emit(
            state,
            "sdk.elicitation.expired",
            json!({
                "id": record.id,
                "request": record.request,
                "ts": now_millis() as u64
            }),
        );
        run_sdk_notification_hooks(
            state,
            "elicitation_expired",
            &format!(
                "SDK elicitation \"{}\" expired before it was answered.",
                record.id
            ),
            Some("MCP elicitation expired"),
        )
        .await?;
    }
    Ok(())
}

async fn expire_hook_callback(state: &GatewayState, id: &str) -> Result<(), String> {
    let expired = state
        .sdk_hook_callbacks
        .lock()
        .map_err(|_| "SDK hook callback store lock poisoned".to_string())?
        .remove(id);
    if let Some(record) = expired {
        emit(
            state,
            "sdk.hookCallback.expired",
            json!({
                "id": record.id,
                "callbackId": record.callback_id,
                "request": record.request,
                "ts": now_millis() as u64
            }),
        );
        run_sdk_notification_hooks(
            state,
            "hook_callback_expired",
            &format!(
                "SDK hook callback \"{}\" expired before it was answered.",
                record.callback_id
            ),
            Some("SDK hook callback expired"),
        )
        .await?;
    }
    Ok(())
}

fn prune_expired_hook_callbacks(callbacks: &mut BTreeMap<String, SdkHookCallbackRecord>, now: u64) {
    callbacks.retain(|_, record| record.response.is_some() || record.expires_at_ms > now);
}

fn sdk_hook_callback_record_value(record: &SdkHookCallbackRecord) -> Value {
    json!({
        "id": record.id,
        "callbackId": record.callback_id,
        "request": record.request,
        "createdAtMs": record.created_at_ms,
        "expiresAtMs": record.expires_at_ms,
        "resolvedBy": record.resolved_by,
        "resolvedAtMs": record.resolved_at_ms
    })
}

fn prune_expired_elicitations(elicitations: &mut BTreeMap<String, SdkElicitationRecord>, now: u64) {
    elicitations.retain(|_, record| record.response.is_some() || record.expires_at_ms > now);
}

fn sdk_elicitation_record_value(record: &SdkElicitationRecord) -> Value {
    json!({
        "id": record.id,
        "request": record.request,
        "createdAtMs": record.created_at_ms,
        "expiresAtMs": record.expires_at_ms,
        "resolvedBy": record.resolved_by,
        "resolvedAtMs": record.resolved_at_ms
    })
}

fn normalize_elicitation_response(params: &Value) -> Result<Value, String> {
    let action = required_param(params, &["action"])?;
    if !matches!(action.as_str(), "accept" | "decline" | "cancel") {
        return Err("elicitation action must be accept, decline, or cancel".to_string());
    }
    let mut response = Map::new();
    response.insert("action".to_string(), Value::String(action));
    if let Some(content) = params.get("content") {
        if !content.is_object() {
            return Err("elicitation content must be an object".to_string());
        }
        response.insert("content".to_string(), content.clone());
    }
    Ok(Value::Object(response))
}

fn normalize_hook_callback_response(params: &Value) -> Result<Value, String> {
    if let Some(response) = params.get("response") {
        if !response.is_object() {
            return Err("hook_callback response must be an object".to_string());
        }
        return Ok(response.clone());
    }
    let object = params
        .as_object()
        .ok_or_else(|| "hook_callback response params must be an object".to_string())?;
    let mut response = Map::new();
    for (key, value) in object {
        if matches!(
            key.as_str(),
            "id" | "request_id" | "requestId" | "resolvedBy" | "resolved_by"
        ) {
            continue;
        }
        response.insert(key.clone(), value.clone());
    }
    Ok(Value::Object(response))
}

pub(super) fn register_sdk_hook_matchers(
    state: &GatewayState,
    hooks: Option<&Value>,
) -> Result<usize, String> {
    let Some(hooks) = hooks else {
        return Ok(0);
    };
    if hooks.is_null() {
        state
            .sdk_hook_matchers
            .lock()
            .map_err(|_| "SDK hook matcher store lock poisoned".to_string())?
            .clear();
        return Ok(0);
    }
    let hooks = hooks
        .as_object()
        .ok_or_else(|| "initialize hooks must be an object keyed by hook event".to_string())?;
    let mut next = BTreeMap::<String, Vec<SdkHookCallbackMatcher>>::new();
    let mut count = 0usize;
    for (event, matchers) in hooks {
        let Some(matchers) = matchers.as_array() else {
            return Err(format!("initialize hooks.{event} must be an array"));
        };
        let mut event_matchers = Vec::new();
        for matcher in matchers {
            let matcher_object = matcher
                .as_object()
                .ok_or_else(|| format!("initialize hooks.{event} entries must be objects"))?;
            let callback_ids = matcher_object
                .get("hookCallbackIds")
                .and_then(Value::as_array)
                .ok_or_else(|| format!("initialize hooks.{event} entries require hookCallbackIds"))?
                .iter()
                .filter_map(Value::as_str)
                .map(str::trim)
                .filter(|id| !id.is_empty())
                .map(ToOwned::to_owned)
                .collect::<Vec<_>>();
            if callback_ids.is_empty() {
                continue;
            }
            let matcher = matcher_object
                .get("matcher")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(ToOwned::to_owned);
            let timeout_ms = matcher_object
                .get("timeout")
                .and_then(Value::as_f64)
                .filter(|value| value.is_finite() && *value > 0.0)
                .map(|seconds| (seconds * 1000.0).ceil() as u64);
            count += callback_ids.len();
            event_matchers.push(SdkHookCallbackMatcher {
                matcher,
                callback_ids,
                timeout_ms,
            });
        }
        if !event_matchers.is_empty() {
            next.insert(event.clone(), event_matchers);
        }
    }
    *state
        .sdk_hook_matchers
        .lock()
        .map_err(|_| "SDK hook matcher store lock poisoned".to_string())? = next;
    Ok(count)
}

pub(super) async fn run_sdk_hook_callbacks(
    state: &GatewayState,
    event: &str,
    match_query: Option<&str>,
    input: Value,
    tool_use_id: Option<String>,
) -> Result<Vec<Value>, String> {
    let matchers = state
        .sdk_hook_matchers
        .lock()
        .map_err(|_| "SDK hook matcher store lock poisoned".to_string())?
        .get(event)
        .cloned()
        .unwrap_or_default();
    if matchers.is_empty() {
        return Ok(Vec::new());
    }
    let mut responses = Vec::new();
    for matcher in matchers
        .into_iter()
        .filter(|matcher| sdk_hook_matcher_matches(match_query, matcher.matcher.as_deref()))
    {
        for callback_id in matcher.callback_ids {
            let timeout_ms = matcher.timeout_ms.unwrap_or(60_000).min(600_000);
            let mut request = json!({
                "subtype": "hook_callback",
                "callback_id": callback_id,
                "input": input
            });
            if let (Some(object), Some(tool_use_id)) =
                (request.as_object_mut(), tool_use_id.as_ref())
            {
                object.insert(
                    "tool_use_id".to_string(),
                    Value::String(tool_use_id.clone()),
                );
            }
            let response = match control_sdk_outbound_request(state, request, timeout_ms).await {
                Ok(response) => response,
                Err(error) => {
                    let error_message = error.clone();
                    emit(
                        state,
                        "sdk.hookCallback.failed",
                        json!({
                            "callbackId": callback_id,
                            "hookEvent": event,
                            "error": error,
                            "ts": now_millis() as u64
                        }),
                    );
                    run_sdk_notification_hooks(
                        state,
                        "hook_callback_failed",
                        &format!(
                            "SDK hook callback \"{callback_id}\" for {event} failed: {error_message}"
                        ),
                        Some("SDK hook callback failed"),
                    )
                    .await?;
                    json!({})
                }
            };
            responses.push(response);
        }
    }
    Ok(responses)
}

pub(super) async fn run_sdk_notification_hooks(
    state: &GatewayState,
    notification_type: &str,
    message: &str,
    title: Option<&str>,
) -> Result<(), String> {
    if !is_sdk_control_transport_connected(state) {
        return Ok(());
    }
    let matchers = state
        .sdk_hook_matchers
        .lock()
        .map_err(|_| "SDK hook matcher store lock poisoned".to_string())?
        .get("Notification")
        .cloned()
        .unwrap_or_default();
    if matchers.is_empty() {
        return Ok(());
    }
    let mut input = sdk_base_hook_input_for_session(state, "main", "main", "Notification");
    if let Some(object) = input.as_object_mut() {
        object.insert("message".to_string(), Value::String(message.to_string()));
        object.insert(
            "notification_type".to_string(),
            Value::String(notification_type.to_string()),
        );
        if let Some(title) = title {
            object.insert("title".to_string(), Value::String(title.to_string()));
        }
    }
    for matcher in matchers.into_iter().filter(|matcher| {
        sdk_hook_matcher_matches(Some(notification_type), matcher.matcher.as_deref())
    }) {
        for callback_id in matcher.callback_ids {
            let timeout_ms = matcher.timeout_ms.unwrap_or(60_000).min(600_000);
            let request = json!({
                "subtype": "hook_callback",
                "callback_id": callback_id,
                "input": input.clone()
            });
            let _ = control_sdk_outbound_request(state, request, timeout_ms).await;
        }
    }
    Ok(())
}

fn sdk_hook_matcher_matches(match_query: Option<&str>, matcher: Option<&str>) -> bool {
    let Some(matcher) = matcher.map(str::trim).filter(|matcher| !matcher.is_empty()) else {
        return true;
    };
    if matcher == "*" {
        return true;
    }
    let Some(match_query) = match_query else {
        return true;
    };
    if matcher
        .chars()
        .all(|character| character.is_ascii_alphanumeric() || matches!(character, '_' | '|'))
    {
        return matcher
            .split('|')
            .map(str::trim)
            .any(|pattern| pattern == match_query);
    }
    regex::Regex::new(matcher)
        .map(|regex| regex.is_match(match_query))
        .unwrap_or(false)
}

async fn control_initialize(state: &GatewayState, params: Value) -> Result<Value, String> {
    register_sdk_prompt_settings(state, &params)?;
    register_sdk_hook_matchers(state, params.get("hooks"))?;
    run_sdk_setup_hooks(state).await?;
    register_sdk_mcp_servers(state, params.get("sdkMcpServers"))?;
    register_sdk_json_schema(state, params.get("jsonSchema"))?;
    if let Some(agents) = params.get("agents") {
        register_sdk_agent_definitions(state, agents)?;
    }
    Ok(json!({
        "commands": initialize_command_infos(state),
        "agents": initialize_agent_infos(state),
        "output_style": "default",
        "available_output_styles": ["default"],
        "models": initialize_model_infos(state),
        "account": {},
        "pid": std::process::id(),
        "fast_mode_state": "off"
    }))
}

async fn run_sdk_setup_hooks(state: &GatewayState) -> Result<(), String> {
    let mut input = sdk_base_hook_input_for_session(state, "main", "main", "Setup");
    if let Some(object) = input.as_object_mut() {
        object.insert("trigger".to_string(), Value::String("init".to_string()));
    }
    let responses = run_sdk_hook_callbacks(state, "Setup", Some("init"), input, None).await?;
    let mut contexts = Vec::new();
    for response in responses {
        if let Some(reason) = sdk_hook_blocking_reason(&response) {
            return Err(reason);
        }
        if let Some(context) = sdk_hook_specific_string(&response, "Setup", "additionalContext") {
            contexts.push(context);
        }
    }
    append_sdk_setup_context(state, contexts)
}

fn append_sdk_setup_context(state: &GatewayState, contexts: Vec<String>) -> Result<(), String> {
    let context = contexts
        .into_iter()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .collect::<Vec<_>>()
        .join("\n\n");
    if context.is_empty() {
        return Ok(());
    }
    let mut append_prompt = state
        .sdk_append_system_prompt
        .lock()
        .map_err(|_| "SDK append system prompt store lock poisoned".to_string())?;
    match append_prompt.as_mut() {
        Some(prompt) if !prompt.trim().is_empty() => {
            prompt.push_str("\n\n");
            prompt.push_str(&context);
        }
        _ => {
            *append_prompt = Some(context);
        }
    }
    Ok(())
}

fn control_interrupt(state: &GatewayState, params: Value) -> Result<Value, String> {
    if params.get("taskId").is_some() || params.get("runId").is_some() {
        return agent_runtime_cancel(state, params);
    }
    let session_key =
        string_param(&params, &["sessionKey", "key"]).unwrap_or_else(|| "main".to_string());
    let mut result = chat_abort(json!({ "sessionKey": session_key }))?;
    if let Some(object) = result.as_object_mut() {
        object.insert("interrupted".to_string(), Value::Bool(true));
    }
    Ok(result)
}

fn control_stop_task(state: &GatewayState, params: Value) -> Result<Value, String> {
    let task_id = required_param(&params, &["task_id", "taskId", "runId"])?;
    let result = agent_runtime_cancel(state, json!({ "taskId": task_id }))?;
    if result
        .get("cancelled")
        .and_then(Value::as_bool)
        .unwrap_or(false)
    {
        return Ok(json!({}));
    }
    let reason = result
        .get("reason")
        .and_then(Value::as_str)
        .unwrap_or("not found");
    let reason = if matches!(reason, "missing_task" | "not_found") {
        "not found"
    } else {
        reason
    };
    Err(format!("Task {task_id} could not be stopped: {reason}"))
}

fn control_cancel_async_message(state: &GatewayState, params: Value) -> Result<Value, String> {
    let message_uuid = required_param(&params, &["message_uuid", "messageUuid"])?;
    let result = agent_runtime_cancel(state, json!({ "taskId": message_uuid }))?;
    Ok(json!({
        "cancelled": result
            .get("cancelled")
            .and_then(Value::as_bool)
            .unwrap_or(false)
    }))
}

fn control_seed_read_state(state: &GatewayState, params: Value) -> Result<Value, String> {
    let raw_path = required_param(&params, &["path"])?;
    let requested_mtime = params
        .get("mtime")
        .and_then(Value::as_f64)
        .filter(|value| value.is_finite() && *value >= 0.0)
        .map(|value| value.floor() as u64)
        .ok_or_else(|| "seed_read_state requires non-negative numeric mtime".to_string())?;
    let Some(path) = resolve_sdk_read_state_path(state, &raw_path) else {
        return Ok(json!({}));
    };
    let Some(seed) = sdk_read_state_seed(&path, requested_mtime) else {
        return Ok(json!({}));
    };
    state
        .sdk_read_state_seeds
        .lock()
        .map_err(|_| "SDK read-state seed store lock poisoned".to_string())?
        .insert(path.to_string_lossy().to_string(), seed);
    Ok(json!({}))
}

pub(super) async fn control_can_use_tool(
    state: &GatewayState,
    params: Value,
) -> Result<Value, String> {
    let tool_name = required_param(&params, &["tool_name", "toolName", "name", "tool"])?;
    let input = permission_input(&params)?;
    let tool_use_id = string_param(&params, &["tool_use_id", "toolUseId", "toolUseID"]);
    let session_key = string_param(&params, &["sessionKey", "session_id", "sessionId", "key"])
        .unwrap_or_else(|| "main".to_string());
    let agent_id = string_param(&params, &["agentId", "agent_id"]).unwrap_or_else(|| {
        if session_key == "main" {
            "main".to_string()
        } else {
            session_key.clone()
        }
    });
    let runtime_config = read_config_value(&runtime_control_config_path(state))?;
    let permission_mode = string_param(&params, &["permissionMode", "permission_mode", "mode"])
        .map(|mode| normalize_permission_mode(&mode))
        .or_else(|| {
            get_json_path(&runtime_config, "claudeCode.permissionMode")
                .and_then(Value::as_str)
                .map(normalize_permission_mode)
        })
        .unwrap_or_else(|| "default".to_string());
    let allowed = tool_rule_set(&runtime_config, "tools.allow");
    if !allowed.is_empty()
        && !allowed
            .iter()
            .any(|rule| tool_name_matches_control_rule(&tool_name, rule))
    {
        return permission_deny_with_hook(
            state,
            &session_key,
            &agent_id,
            &tool_name,
            &input,
            tool_use_id,
            format!("Tool {tool_name} is not in tools.allow"),
        )
        .await;
    }
    let denied = tool_rule_set(&runtime_config, "tools.deny");
    if denied
        .iter()
        .any(|rule| tool_name_matches_control_rule(&tool_name, rule))
    {
        return permission_deny_with_hook(
            state,
            &session_key,
            &agent_id,
            &tool_name,
            &input,
            tool_use_id,
            format!("Tool {tool_name} is denied by config"),
        )
        .await;
    }
    let Some(read_only) = tool_read_only(state, &tool_name) else {
        return permission_deny_with_hook(
            state,
            &session_key,
            &agent_id,
            &tool_name,
            &input,
            tool_use_id,
            format!("Tool {tool_name} was not found"),
        )
        .await;
    };
    if matches!(permission_mode.as_str(), "plan" | "dontAsk") && !read_only {
        return permission_deny_with_hook(
            state,
            &session_key,
            &agent_id,
            &tool_name,
            &input,
            tool_use_id,
            format!("Tool {tool_name} is blocked in {permission_mode} permission mode"),
        )
        .await;
    }
    let original_input = input.clone();
    match apply_sdk_permission_request_hooks(
        state,
        &params,
        &session_key,
        &agent_id,
        &tool_name,
        input,
        tool_use_id.clone(),
    )
    .await?
    {
        PermissionRequestHookResult::Allow(input) => Ok(permission_allow(input, tool_use_id)),
        PermissionRequestHookResult::Deny(message) => {
            permission_deny_with_hook(
                state,
                &session_key,
                &agent_id,
                &tool_name,
                &original_input,
                tool_use_id,
                message,
            )
            .await
        }
    }
}

enum PermissionRequestHookResult {
    Allow(Value),
    Deny(String),
}

async fn apply_sdk_permission_request_hooks(
    state: &GatewayState,
    params: &Value,
    session_key: &str,
    agent_id: &str,
    tool_name: &str,
    input: Value,
    tool_use_id: Option<String>,
) -> Result<PermissionRequestHookResult, String> {
    let mut hook_input =
        sdk_base_hook_input_for_session(state, session_key, agent_id, "PermissionRequest");
    if let Some(object) = hook_input.as_object_mut() {
        object.insert(
            "tool_name".to_string(),
            Value::String(tool_name.to_string()),
        );
        object.insert("tool_input".to_string(), input.clone());
        if let Some(suggestions) = params
            .get("permission_suggestions")
            .or_else(|| params.get("permissionSuggestions"))
            .cloned()
        {
            object.insert("permission_suggestions".to_string(), suggestions);
        }
    }
    let responses = run_sdk_hook_callbacks(
        state,
        "PermissionRequest",
        Some(tool_name),
        hook_input,
        tool_use_id,
    )
    .await?;
    Ok(permission_request_hook_decision(input, responses))
}

fn permission_request_hook_decision(
    input: Value,
    responses: Vec<Value>,
) -> PermissionRequestHookResult {
    let mut input = input;
    for response in responses {
        if let Some(reason) = sdk_hook_blocking_reason(&response) {
            return PermissionRequestHookResult::Deny(reason);
        }
        let Some(output) = response.get("hookSpecificOutput") else {
            continue;
        };
        if output.get("hookEventName").and_then(Value::as_str) != Some("PermissionRequest") {
            continue;
        }
        let Some(decision) = output.get("decision") else {
            continue;
        };
        match decision.get("behavior").and_then(Value::as_str) {
            Some("allow") => {
                if let Some(updated_input) = decision
                    .get("updatedInput")
                    .filter(|value| value.is_object())
                {
                    input = updated_input.clone();
                }
            }
            Some("deny") => {
                return PermissionRequestHookResult::Deny(
                    decision
                        .get("message")
                        .and_then(Value::as_str)
                        .unwrap_or("permission denied by SDK hook")
                        .to_string(),
                );
            }
            _ => {}
        }
    }
    PermissionRequestHookResult::Allow(input)
}

async fn permission_deny_with_hook(
    state: &GatewayState,
    session_key: &str,
    agent_id: &str,
    tool_name: &str,
    input: &Value,
    tool_use_id: Option<String>,
    message: String,
) -> Result<Value, String> {
    let retry = run_sdk_permission_denied_hooks(
        state,
        session_key,
        agent_id,
        tool_name,
        input,
        tool_use_id.clone(),
        &message,
    )
    .await?;
    Ok(permission_deny(message, tool_use_id, retry))
}

async fn run_sdk_permission_denied_hooks(
    state: &GatewayState,
    session_key: &str,
    agent_id: &str,
    tool_name: &str,
    input: &Value,
    tool_use_id: Option<String>,
    reason: &str,
) -> Result<bool, String> {
    let mut hook_input =
        sdk_base_hook_input_for_session(state, session_key, agent_id, "PermissionDenied");
    let tool_use_id_value = tool_use_id
        .clone()
        .unwrap_or_else(|| format!("permission-denied-{}", now_millis()));
    if let Some(object) = hook_input.as_object_mut() {
        object.insert(
            "tool_name".to_string(),
            Value::String(tool_name.to_string()),
        );
        object.insert("tool_input".to_string(), input.clone());
        object.insert("tool_use_id".to_string(), Value::String(tool_use_id_value));
        object.insert("reason".to_string(), Value::String(reason.to_string()));
    }
    let responses = run_sdk_hook_callbacks(
        state,
        "PermissionDenied",
        Some(tool_name),
        hook_input,
        tool_use_id,
    )
    .await?;
    Ok(responses.into_iter().any(|response| {
        response
            .get("hookSpecificOutput")
            .filter(|output| {
                output.get("hookEventName").and_then(Value::as_str) == Some("PermissionDenied")
            })
            .and_then(|output| output.get("retry"))
            .and_then(Value::as_bool)
            .unwrap_or(false)
    }))
}

fn control_set_permission_mode(state: &GatewayState, params: Value) -> Result<Value, String> {
    let mode = required_param(&params, &["permissionMode", "permission_mode", "mode"])?;
    let mode = normalize_permission_mode(&mode);
    update_runtime_control_config(state, |config| {
        set_json_path(
            config,
            "claudeCode.permissionMode",
            Value::String(mode.clone()),
        )
    })?;
    Ok(json!({ "mode": mode }))
}

fn control_set_model(state: &GatewayState, params: Value) -> Result<Value, String> {
    let mut selection = parse_control_model(&params)?;
    if selection.provider.is_none()
        && selection.model.is_none()
        && selection.reasoning_level.is_none()
    {
        return Err("set_model requires provider, model, or reasoningLevel".to_string());
    }
    if selection.provider.is_none() {
        if let Some(provider) = selection
            .model
            .as_deref()
            .and_then(infer_provider_for_model)
        {
            selection.provider = Some(provider);
        }
    }

    let provider_path = desktop_provider_config_path(state);
    let mut provider_config = read_config_value(&provider_path)?;
    let provider_object = ensure_json_object(&mut provider_config);
    if provider_object.get("provider").is_none() && selection.provider.is_none() {
        return Err("set_model requires provider when no provider config exists".to_string());
    }
    if let Some(provider) = &selection.provider {
        provider_object.insert("provider".to_string(), Value::String(provider.clone()));
    }
    if let Some(model) = &selection.model {
        provider_object.insert("model".to_string(), Value::String(model.clone()));
    }
    write_config_value(&provider_path, &provider_config)?;

    update_runtime_control_config(state, |config| {
        set_json_path(
            config,
            "claudeCode.model",
            json!({
                "provider": selection.provider.clone()
                    .or_else(|| provider_config.get("provider").and_then(Value::as_str).map(str::to_string)),
                "model": selection.model.clone()
                    .or_else(|| provider_config.get("model").and_then(Value::as_str).map(str::to_string)),
                "reasoningLevel": selection.reasoning_level.clone()
            }),
        )
    })?;
    Ok(json!({}))
}

fn control_set_max_thinking_tokens(state: &GatewayState, params: Value) -> Result<Value, String> {
    let max_tokens = params
        .get("maxThinkingTokens")
        .or_else(|| params.get("max_thinking_tokens"))
        .ok_or_else(|| "set_max_thinking_tokens requires maxThinkingTokens".to_string())?;
    let max_tokens = if max_tokens.is_null() {
        Value::Null
    } else {
        let value = max_tokens.as_u64().ok_or_else(|| {
            "set_max_thinking_tokens requires a non-negative integer or null".to_string()
        })?;
        Value::from(value)
    };
    update_runtime_control_config(state, |config| {
        set_json_path(config, "claudeCode.maxThinkingTokens", max_tokens.clone())
    })?;
    Ok(json!({}))
}

fn control_get_context_usage(state: &GatewayState, params: Value) -> Result<Value, String> {
    let session_key =
        string_param(&params, &["sessionKey", "key"]).unwrap_or_else(|| "main".to_string());
    let messages = state
        .session_store
        .session_history(&session_key)
        .unwrap_or_default();
    let raw = serde_json::to_string(&messages)
        .map_err(|error| format!("failed to serialize session context: {error}"))?;
    let estimated_tokens = raw.len().div_ceil(4);
    let raw_max_tokens = 200_000usize;
    let percentage = if raw_max_tokens == 0 {
        0
    } else {
        (estimated_tokens * 100 / raw_max_tokens).min(100)
    };
    let categories = if estimated_tokens == 0 {
        Vec::new()
    } else {
        vec![json!({
            "name": "Messages",
            "tokens": estimated_tokens,
            "color": "#3b82f6"
        })]
    };
    let model = applied_model_name(&control_model_settings(state));
    Ok(json!({
        "categories": categories,
        "totalTokens": estimated_tokens,
        "maxTokens": raw_max_tokens,
        "rawMaxTokens": raw_max_tokens,
        "percentage": percentage,
        "gridRows": [],
        "model": model,
        "memoryFiles": [],
        "mcpTools": [],
        "agents": [],
        "isAutoCompactEnabled": false,
        "apiUsage": Value::Null,
        "messageBreakdown": {
            "toolCallTokens": 0,
            "toolResultTokens": 0,
            "attachmentTokens": 0,
            "assistantMessageTokens": 0,
            "userMessageTokens": estimated_tokens,
            "toolCallsByType": [],
            "attachmentsByType": []
        }
    }))
}

fn control_reload_plugins(state: &GatewayState) -> Result<Value, String> {
    let plugins = plugins_list(state)?;
    let diagnostics = plugins
        .get("diagnostics")
        .and_then(Value::as_array)
        .map(Vec::len)
        .unwrap_or(0);
    Ok(json!({
        "commands": initialize_command_infos(state),
        "agents": initialize_agent_infos(state),
        "plugins": reload_plugin_infos(&plugins),
        "mcpServers": control_mcp_status(state, None)
            .get("mcpServers")
            .cloned()
            .unwrap_or_else(|| Value::Array(Vec::new())),
        "error_count": diagnostics
    }))
}

fn control_mcp_reconnect(state: &GatewayState, params: Value) -> Result<Value, String> {
    let server = required_param(&params, &["server", "serverName", "name"])?;
    let status = control_mcp_status(state, Some(server.clone()));
    let Some(entry) = status
        .get("mcpServers")
        .and_then(Value::as_array)
        .and_then(|servers| servers.first())
    else {
        return Err(format!("Server not found: {server}"));
    };
    let status = entry
        .get("status")
        .and_then(Value::as_str)
        .unwrap_or("pending");
    if status == "connected" {
        return Ok(json!({}));
    }
    let error = entry
        .get("error")
        .and_then(Value::as_str)
        .map(|error| format!(": {error}"))
        .unwrap_or_default();
    Err(format!("Server status: {status}{error}"))
}

fn control_mcp_toggle(state: &GatewayState, params: Value) -> Result<Value, String> {
    let server = required_param(&params, &["server", "serverName", "name"])?;
    let enabled = bool_param(&params, &["enabled"])
        .or_else(|| bool_param(&params, &["disabled"]).map(|disabled| !disabled))
        .ok_or_else(|| "mcp_toggle requires enabled or disabled".to_string())?;
    let path = runtime_control_config_path(state);
    let mut config = read_config_value(&path)?;
    if get_json_path(&config, &format!("mcpServers.{server}")).is_none() {
        return Err(format!("MCP server \"{server}\" not found"));
    }
    delete_json_path(&mut config, &format!("mcpServers.{server}.disabled"));
    set_string_array_membership(&mut config, "disabledMcpServers", &server, !enabled)?;
    if !enabled {
        remove_string_from_json_array(&mut config, "enabledMcpServers", &server);
    }
    write_config_value(&path, &config)?;
    Ok(json!({}))
}

fn set_string_array_membership(
    config: &mut Value,
    path: &str,
    name: &str,
    present: bool,
) -> Result<(), String> {
    let mut names = get_json_path(config, path)
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(Value::as_str)
                .map(str::to_string)
                .collect::<BTreeSet<_>>()
        })
        .unwrap_or_default();
    if present {
        names.insert(name.to_string());
    } else {
        names.remove(name);
    }
    if names.is_empty() {
        delete_json_path(config, path);
        return Ok(());
    }
    set_json_path(
        config,
        path,
        Value::Array(names.into_iter().map(Value::String).collect()),
    )
}

fn control_apply_flag_settings(state: &GatewayState, params: Value) -> Result<Value, String> {
    let patch = params
        .get("settings")
        .or_else(|| params.get("flags"))
        .cloned()
        .unwrap_or(params);
    if !patch.is_object() {
        return Err("apply_flag_settings requires an object settings payload".to_string());
    }
    let patch = patch
        .as_object()
        .cloned()
        .expect("object checked before flag settings merge");
    update_runtime_control_config(state, |config| {
        let mut flags = get_json_path(config, "claudeCode.flags")
            .cloned()
            .unwrap_or_else(|| Value::Object(Map::new()));
        let flag_object = ensure_json_object(&mut flags);
        for (key, value) in patch {
            if value.is_null() {
                flag_object.remove(&key);
            } else {
                merge_json(flag_object.entry(key).or_insert(Value::Null), value);
            }
        }
        set_json_path(config, "claudeCode.flags", flags)
    })?;
    Ok(json!({}))
}

fn control_get_settings(state: &GatewayState) -> Result<Value, String> {
    let settings = control_settings(state)?;
    let claude_code = settings
        .get("claudeCode")
        .cloned()
        .unwrap_or_else(|| Value::Object(Map::new()));
    let model = claude_code.get("model").cloned().unwrap_or(Value::Null);
    let local_settings = json!({
        "permissionMode": claude_code
            .get("permissionMode")
            .cloned()
            .unwrap_or_else(|| Value::String("workspace".to_string())),
        "maxThinkingTokens": claude_code
            .get("maxThinkingTokens")
            .cloned()
            .unwrap_or(Value::Null),
        "model": model.clone()
    });
    let flag_settings = claude_code
        .get("flags")
        .cloned()
        .unwrap_or_else(|| Value::Object(Map::new()));
    let mut effective = local_settings.clone();
    merge_json(&mut effective, flag_settings.clone());
    Ok(json!({
        "effective": effective,
        "sources": [
            { "source": "userSettings", "settings": {} },
            { "source": "projectSettings", "settings": {} },
            { "source": "localSettings", "settings": local_settings },
            { "source": "flagSettings", "settings": flag_settings },
            { "source": "policySettings", "settings": {} }
        ],
        "applied": {
            "model": applied_model_name(&model),
            "effort": applied_model_effort(&model)
        }
    }))
}

fn control_mcp_status(state: &GatewayState, server: Option<String>) -> Value {
    let runtime_status = mcp_runtime_status_by_server(state);
    let servers = mcp_servers_control_status_snapshot(state)
        .into_iter()
        .filter(|entry| {
            server
                .as_deref()
                .map(|name| entry.get("name").and_then(Value::as_str) == Some(name))
                .unwrap_or(true)
        })
        .map(|entry| control_mcp_server_status(state, entry, &runtime_status))
        .collect::<Vec<_>>();
    json!({
        "mcpServers": servers
    })
}

fn mcp_runtime_status_by_server(state: &GatewayState) -> BTreeMap<String, Value> {
    crawclaw_runtime::mcp_server_runtime_statuses(&state.runtime_root)
        .into_iter()
        .filter_map(|status| {
            let name = status.get("name").and_then(Value::as_str)?.to_string();
            Some((name, status))
        })
        .collect()
}

fn control_mcp_server_status(
    state: &GatewayState,
    entry: Value,
    runtime_status: &BTreeMap<String, Value>,
) -> Value {
    let name = entry
        .get("name")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    let enabled = entry
        .get("enabled")
        .and_then(Value::as_bool)
        .unwrap_or(true);
    let server_status = runtime_status.get(&name);
    let status = if !enabled {
        "disabled"
    } else if entry.get("type").and_then(Value::as_str) == Some("sdk")
        && is_sdk_mcp_transport_connected(state, &name)
    {
        "connected"
    } else {
        server_status
            .and_then(|status| status.get("status"))
            .and_then(Value::as_str)
            .unwrap_or("pending")
    };
    let mut status = json!({
        "name": name,
        "status": status,
        "scope": "runtime",
        "toolCount": server_status
            .and_then(|status| status.get("toolCount"))
            .and_then(Value::as_u64)
            .unwrap_or(0),
        "readOnlyToolCount": server_status
            .and_then(|status| status.get("readOnlyToolCount"))
            .and_then(Value::as_u64)
            .unwrap_or(0),
        "promptCount": server_status
            .and_then(|status| status.get("promptCount"))
            .and_then(Value::as_u64)
            .unwrap_or(0),
        "resourceCount": server_status
            .and_then(|status| status.get("resourceCount"))
            .and_then(Value::as_u64)
            .unwrap_or(0)
    });
    if let (Some(object), Some(config)) = (status.as_object_mut(), entry.get("config")) {
        object.insert("config".to_string(), config.clone());
    }
    if let (Some(object), Some(error)) = (
        status.as_object_mut(),
        server_status.and_then(|status| status.get("error")),
    ) {
        object.insert("error".to_string(), error.clone());
    }
    status
}

fn control_settings(state: &GatewayState) -> Result<Value, String> {
    let runtime_config_path = runtime_control_config_path(state);
    let runtime_config = read_config_value(&runtime_config_path)?;
    let claude_config = get_json_path(&runtime_config, "claudeCode")
        .cloned()
        .unwrap_or_else(|| Value::Object(Map::new()));
    let permission_mode = claude_config
        .get("permissionMode")
        .and_then(Value::as_str)
        .map(normalize_permission_mode)
        .unwrap_or_else(|| "default".to_string());
    let max_thinking_tokens = claude_config
        .get("maxThinkingTokens")
        .and_then(Value::as_u64)
        .map(Value::from)
        .unwrap_or(Value::Null);
    let flags = claude_config
        .get("flags")
        .cloned()
        .unwrap_or_else(|| Value::Object(Map::new()));
    Ok(json!({
        "runtimeConfigPath": runtime_config_path.to_string_lossy(),
        "gatewayConfigPath": config_path(state).to_string_lossy(),
        "claudeCode": {
            "model": control_model_settings(state),
            "permissionMode": permission_mode,
            "maxThinkingTokens": max_thinking_tokens,
            "flags": flags
        },
        "mcpServers": mcp_servers_snapshot(state)
    }))
}

fn initialize_command_infos(state: &GatewayState) -> Vec<Value> {
    let mut commands = BTreeMap::<String, Value>::new();
    for command in project_markdown_command_infos(state).into_iter().chain(
        crawclaw_runtime::mcp_prompt_slash_commands(&state.runtime_root),
    ) {
        if let Some(name) = command.get("name").and_then(Value::as_str) {
            commands.entry(name.to_string()).or_insert(command);
        }
    }
    commands.into_values().collect()
}

fn initialize_agent_infos(state: &GatewayState) -> Vec<Value> {
    agents_list(state)
        .get("agents")
        .and_then(Value::as_array)
        .map(|agents| {
            agents
                .iter()
                .filter_map(|agent| {
                    let name = agent.get("name").and_then(Value::as_str)?;
                    let model = agent.get("model").and_then(|model| {
                        model
                            .as_str()
                            .or_else(|| model.get("primary").and_then(Value::as_str))
                    });
                    let mut info = json!({
                        "name": name,
                        "description": agent
                            .get("description")
                            .and_then(Value::as_str)
                            .unwrap_or("Default CrawClaw agent")
                    });
                    if let (Some(object), Some(model)) = (info.as_object_mut(), model) {
                        object.insert("model".to_string(), Value::String(model.to_string()));
                    }
                    Some(info)
                })
                .collect()
        })
        .unwrap_or_default()
}

fn project_markdown_command_infos(state: &GatewayState) -> Vec<Value> {
    let config = read_config_value(&config_path(state)).ok();
    let mut commands = Vec::new();
    for root in markdown_command_roots(state, config.as_ref()) {
        for path in markdown_files_under(&root) {
            let Ok(raw) = std::fs::read_to_string(&path) else {
                continue;
            };
            if let Some(command) = markdown_command_info(&root, &path, &raw) {
                commands.push(command);
            }
        }
    }
    commands
}

fn markdown_command_roots(state: &GatewayState, config: Option<&Value>) -> Vec<PathBuf> {
    let mut roots = BTreeSet::<PathBuf>::new();
    insert_markdown_command_roots_for_workspace(&mut roots, &state.runtime_root);
    if let Some(config) = config {
        if let Some(workspace) = get_json_path(config, "agents.defaults.workspace")
            .and_then(Value::as_str)
            .map(|workspace| control_workspace_path(state, workspace))
        {
            insert_markdown_command_roots_for_workspace(&mut roots, &workspace);
        }
        if let Some(entries) = get_json_path(config, "agents.entries").and_then(Value::as_object) {
            for entry in entries.values() {
                if let Some(workspace) = json_string_field(entry, "workspace")
                    .map(|workspace| control_workspace_path(state, &workspace))
                {
                    insert_markdown_command_roots_for_workspace(&mut roots, &workspace);
                }
            }
        }
    }
    roots.into_iter().filter(|path| path.is_dir()).collect()
}

fn insert_markdown_command_roots_for_workspace(roots: &mut BTreeSet<PathBuf>, workspace: &Path) {
    roots.insert(workspace.join(".claude").join("commands"));
    roots.insert(workspace.join(".commands"));
}

fn control_workspace_path(state: &GatewayState, workspace: &str) -> PathBuf {
    let path = expand_user_path(workspace);
    if path.is_absolute() {
        path
    } else {
        state.runtime_root.join(path)
    }
}

fn markdown_files_under(root: &Path) -> Vec<PathBuf> {
    let mut pending = vec![root.to_path_buf()];
    let mut files = Vec::new();
    while let Some(dir) = pending.pop() {
        let Ok(entries) = std::fs::read_dir(&dir) else {
            continue;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            let Ok(file_type) = entry.file_type() else {
                continue;
            };
            if file_type.is_dir() {
                pending.push(path);
                continue;
            }
            if file_type.is_file()
                && path.extension().and_then(|value| value.to_str()) == Some("md")
            {
                files.push(path);
            }
        }
    }
    files.sort();
    files
}

fn markdown_command_info(root: &Path, path: &Path, raw: &str) -> Option<Value> {
    let (frontmatter, content) = simple_markdown_frontmatter(raw);
    if !frontmatter_bool(&frontmatter, "user-invocable", true)
        || frontmatter_bool(&frontmatter, "hide-from-slash-command-tool", false)
    {
        return None;
    }
    let name = markdown_command_name(root, path)?;
    let description = frontmatter_string(&frontmatter, "description")
        .or_else(|| markdown_description_from_content(content, "Custom command"));
    let info = json!({
        "name": name,
        "description": description.unwrap_or_default(),
        "argumentHint": frontmatter_string(&frontmatter, "argument-hint").unwrap_or_default()
    });
    Some(info)
}

fn markdown_command_name(root: &Path, path: &Path) -> Option<String> {
    let relative = path.strip_prefix(root).ok()?;
    let mut parts = relative
        .components()
        .filter_map(|component| match component {
            std::path::Component::Normal(value) => value.to_str(),
            _ => None,
        })
        .map(|part| part.strip_suffix(".md").unwrap_or(part))
        .map(sanitize_markdown_command_name)
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>();
    if parts.is_empty() {
        return None;
    }
    if parts.last().map(String::as_str) == Some("skill") {
        parts.pop();
    }
    if parts.is_empty() {
        return None;
    }
    Some(parts.join(":"))
}

fn sanitize_markdown_command_name(value: &str) -> String {
    value
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' {
                ch.to_ascii_lowercase()
            } else {
                '-'
            }
        })
        .collect::<String>()
        .split('-')
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join("-")
}

fn simple_markdown_frontmatter(raw: &str) -> (BTreeMap<String, Value>, &str) {
    let Some(stripped) = raw.strip_prefix("---") else {
        return (BTreeMap::new(), raw);
    };
    let Some(stripped) = stripped
        .strip_prefix("\r\n")
        .or_else(|| stripped.strip_prefix('\n'))
    else {
        return (BTreeMap::new(), raw);
    };
    let Some((frontmatter_end, delimiter_len)) = stripped
        .find("\n---\n")
        .map(|index| (index, 5))
        .or_else(|| stripped.find("\r\n---\r\n").map(|index| (index, 7)))
        .or_else(|| stripped.find("\n---\r\n").map(|index| (index, 6)))
        .or_else(|| stripped.find("\r\n---\n").map(|index| (index, 6)))
    else {
        return (BTreeMap::new(), raw);
    };
    (
        parse_simple_frontmatter(&stripped[..frontmatter_end]),
        &stripped[frontmatter_end + delimiter_len..],
    )
}

fn parse_simple_frontmatter(raw: &str) -> BTreeMap<String, Value> {
    let mut map = BTreeMap::new();
    let mut current_list_key: Option<String> = None;
    for line in raw.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }
        if let Some(item) = trimmed.strip_prefix("- ") {
            if let Some(key) = current_list_key.as_ref() {
                push_frontmatter_list_item(&mut map, key, item);
            }
            continue;
        }
        let Some((key, value)) = trimmed.split_once(':') else {
            current_list_key = None;
            continue;
        };
        let key = key.trim();
        let value = value.trim();
        if key.is_empty() {
            current_list_key = None;
            continue;
        }
        if value.is_empty() {
            map.insert(key.to_string(), Value::Array(Vec::new()));
            current_list_key = Some(key.to_string());
            continue;
        }
        current_list_key = None;
        map.insert(key.to_string(), parse_frontmatter_value(value));
    }
    map
}

fn parse_frontmatter_value(value: &str) -> Value {
    let value = value
        .split_once(" #")
        .map(|(value, _)| value)
        .unwrap_or(value)
        .trim();
    if value.starts_with('[') && value.ends_with(']') {
        return Value::Array(
            value[1..value.len() - 1]
                .split(',')
                .map(unquote_frontmatter_value)
                .filter(|value| !value.is_empty())
                .map(Value::String)
                .collect(),
        );
    }
    Value::String(unquote_frontmatter_value(value))
}

fn push_frontmatter_list_item(map: &mut BTreeMap<String, Value>, key: &str, item: &str) {
    let item = parse_frontmatter_value(item);
    match map.get_mut(key) {
        Some(Value::Array(items)) => items.push(item),
        _ => {
            map.insert(key.to_string(), Value::Array(vec![item]));
        }
    }
}

fn frontmatter_string(frontmatter: &BTreeMap<String, Value>, key: &str) -> Option<String> {
    frontmatter
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
}

fn frontmatter_bool(frontmatter: &BTreeMap<String, Value>, key: &str, default: bool) -> bool {
    frontmatter
        .get(key)
        .and_then(Value::as_str)
        .map(|value| {
            let value = value.trim().to_ascii_lowercase();
            matches!(value.as_str(), "true" | "1" | "yes" | "on")
        })
        .unwrap_or(default)
}

fn markdown_description_from_content(content: &str, fallback: &str) -> Option<String> {
    content
        .lines()
        .find_map(|line| {
            let line = line.trim();
            if line.is_empty() {
                return None;
            }
            let description = line.trim_start_matches('#').trim();
            if description.is_empty() {
                None
            } else if description.chars().count() > 100 {
                Some(format!(
                    "{}...",
                    description.chars().take(97).collect::<String>()
                ))
            } else {
                Some(description.to_string())
            }
        })
        .or_else(|| Some(fallback.to_string()))
}

fn json_string_field(value: &Value, key: &str) -> Option<String> {
    value
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
}

fn unquote_frontmatter_value(value: &str) -> String {
    value
        .trim()
        .trim_matches('"')
        .trim_matches('\'')
        .trim()
        .to_string()
}

fn initialize_model_infos(state: &GatewayState) -> Vec<Value> {
    models_list(state)
        .get("models")
        .and_then(Value::as_array)
        .map(|models| {
            models
                .iter()
                .filter_map(|model| {
                    let model_id = model.get("id").and_then(Value::as_str)?;
                    let provider = model
                        .get("provider")
                        .and_then(Value::as_str)
                        .unwrap_or("provider");
                    let value = format!("{provider}/{model_id}");
                    let display_name = model
                        .get("name")
                        .and_then(Value::as_str)
                        .unwrap_or(model_id);
                    let mut info = json!({
                        "value": value,
                        "displayName": display_name,
                        "description": format!("{display_name} via {provider}")
                    });
                    if model
                        .get("reasoning")
                        .and_then(Value::as_bool)
                        .unwrap_or(false)
                    {
                        if let Some(object) = info.as_object_mut() {
                            object.insert("supportsEffort".to_string(), Value::Bool(true));
                            object.insert(
                                "supportedEffortLevels".to_string(),
                                json!(["low", "medium", "high", "max"]),
                            );
                        }
                    }
                    Some(info)
                })
                .collect()
        })
        .unwrap_or_default()
}

fn reload_plugin_infos(plugins: &Value) -> Vec<Value> {
    plugins
        .get("plugins")
        .and_then(Value::as_array)
        .map(|plugins| {
            plugins
                .iter()
                .filter_map(|plugin| {
                    let name = plugin.get("name").and_then(Value::as_str)?;
                    let path = plugin
                        .get("installPath")
                        .or_else(|| plugin.get("sourcePath"))
                        .or_else(|| plugin.get("source"))
                        .and_then(Value::as_str)
                        .unwrap_or("");
                    let mut info = json!({
                        "name": name,
                        "path": path
                    });
                    if let Some(source) = plugin.get("source").and_then(Value::as_str) {
                        if let Some(object) = info.as_object_mut() {
                            object.insert("source".to_string(), Value::String(source.to_string()));
                        }
                    }
                    Some(info)
                })
                .collect()
        })
        .unwrap_or_default()
}

fn control_model_settings(state: &GatewayState) -> Value {
    let runtime_config = read_config_value(&runtime_control_config_path(state))
        .unwrap_or_else(|_| Value::Object(Map::new()));
    if let Some(model) = get_json_path(&runtime_config, "claudeCode.model") {
        return model.clone();
    }
    let provider_config = read_config_value(&desktop_provider_config_path(state))
        .unwrap_or_else(|_| Value::Object(Map::new()));
    if !provider_config.is_object() {
        return Value::Null;
    }
    json!({
        "provider": provider_config.get("provider").and_then(Value::as_str),
        "model": provider_config.get("model").and_then(Value::as_str),
        "reasoningLevel": Value::Null
    })
}

fn applied_model_name(model: &Value) -> String {
    let provider = model
        .get("provider")
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty());
    let model_name = model
        .get("model")
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty());
    match (provider, model_name) {
        (Some(provider), Some(model_name)) => format!("{provider}/{model_name}"),
        (_, Some(model_name)) => model_name.to_string(),
        _ => "default".to_string(),
    }
}

fn applied_model_effort(model: &Value) -> Value {
    match model
        .get("reasoningLevel")
        .and_then(Value::as_str)
        .filter(|value| matches!(*value, "low" | "medium" | "high" | "max"))
    {
        Some(value) => Value::String(value.to_string()),
        None => Value::Null,
    }
}

fn update_runtime_control_config<F>(state: &GatewayState, update: F) -> Result<Value, String>
where
    F: FnOnce(&mut Value) -> Result<(), String>,
{
    let path = runtime_control_config_path(state);
    let mut config = read_config_value(&path)?;
    update(&mut config)?;
    write_config_value(&path, &config)?;
    Ok(config)
}

fn runtime_control_config_path(state: &GatewayState) -> PathBuf {
    state.runtime_root.join("config").join("crawclaw.json")
}

fn desktop_provider_config_path(state: &GatewayState) -> PathBuf {
    state
        .runtime_root
        .join("config")
        .join("desktop-agent-provider.json")
}

fn resolve_sdk_read_state_path(state: &GatewayState, raw_path: &str) -> Option<PathBuf> {
    let trimmed = raw_path.trim();
    if trimmed.is_empty() {
        return None;
    }
    let root = state.runtime_root.canonicalize().ok()?;
    let candidate = expand_user_path(trimmed);
    let path = if candidate.is_absolute() {
        candidate
    } else {
        root.join(candidate)
    };
    let canonical = path.canonicalize().ok()?;
    canonical.starts_with(&root).then_some(canonical)
}

fn sdk_read_state_seed(path: &Path, requested_mtime: u64) -> Option<Value> {
    let metadata = std::fs::metadata(path).ok()?;
    if !metadata.is_file() {
        return None;
    }
    let disk_mtime: u64 = metadata
        .modified()
        .ok()?
        .duration_since(UNIX_EPOCH)
        .ok()?
        .as_millis()
        .try_into()
        .ok()?;
    if disk_mtime > requested_mtime {
        return None;
    }
    let raw = std::fs::read_to_string(path).ok()?;
    let content = raw
        .strip_prefix('\u{FEFF}')
        .unwrap_or(&raw)
        .replace("\r\n", "\n");
    Some(json!({
        "content": content,
        "timestamp": disk_mtime,
        "offset": Value::Null,
        "limit": Value::Null
    }))
}

struct ControlModelSelection {
    provider: Option<String>,
    model: Option<String>,
    reasoning_level: Option<String>,
}

fn parse_control_model(params: &Value) -> Result<ControlModelSelection, String> {
    let model_object = params.get("model").and_then(Value::as_object);
    let mut provider = string_param(params, &["provider"]).or_else(|| {
        model_object
            .and_then(|model| model.get("provider"))
            .and_then(Value::as_str)
            .map(str::to_string)
    });
    let mut model = model_object
        .and_then(|object| object.get("model"))
        .and_then(Value::as_str)
        .map(str::to_string)
        .or_else(|| string_param(params, &["modelId"]))
        .or_else(|| {
            params
                .get("model")
                .and_then(Value::as_str)
                .map(str::to_string)
        });
    if provider.is_none() {
        if let Some((raw_provider, raw_model)) = model
            .as_deref()
            .and_then(|value| value.trim().split_once('/'))
        {
            if !raw_provider.trim().is_empty() && !raw_model.trim().is_empty() {
                provider = Some(raw_provider.trim().to_string());
                model = Some(raw_model.trim().to_string());
            }
        }
    }
    let reasoning_level = string_param(params, &["reasoningLevel", "reasoning_level", "thinking"])
        .or_else(|| {
            model_object
                .and_then(|model| {
                    model
                        .get("reasoningLevel")
                        .or_else(|| model.get("reasoning_level"))
                        .or_else(|| model.get("thinking"))
                })
                .and_then(Value::as_str)
                .map(str::to_string)
        });
    Ok(ControlModelSelection {
        provider: provider.map(clean_control_string).transpose()?,
        model: model.map(clean_control_string).transpose()?,
        reasoning_level: reasoning_level.map(clean_control_string).transpose()?,
    })
}

fn infer_provider_for_model(model: &str) -> Option<String> {
    const PREFERRED_PROVIDERS: &[&str] = &["anthropic", "openai", "google", "xai", "ollama"];
    PREFERRED_PROVIDERS
        .iter()
        .copied()
        .chain(crawclaw_providers::bundled_provider_ids())
        .find(|provider| provider_supports_model(provider, model))
        .map(str::to_string)
}

fn provider_supports_model(provider: &str, model: &str) -> bool {
    crawclaw_providers::bundled_provider_default_model_for(provider)
        .is_some_and(|entry| entry.model == model)
        || crawclaw_providers::bundled_provider_model_choices_for(provider)
            .iter()
            .any(|choice| choice == model)
}

fn clean_control_string(value: String) -> Result<String, String> {
    let value = value.trim().to_string();
    if value.is_empty() {
        return Err("control string values cannot be empty".to_string());
    }
    Ok(value)
}

fn normalize_permission_mode(value: &str) -> String {
    match value.trim() {
        "default" | "workspace" => "default".to_string(),
        "readOnly" | "read_only" | "readonly" | "read-only" => "plan".to_string(),
        "acceptEdits" | "accept_edits" | "accept-edits" => "acceptEdits".to_string(),
        "bypassPermissions" | "bypass_permissions" | "bypass-permissions" | "fullAccess"
        | "full_access" | "full-access" => "bypassPermissions".to_string(),
        "plan" => "plan".to_string(),
        "dontAsk" | "dont_ask" | "dont-ask" => "dontAsk".to_string(),
        other => other.to_string(),
    }
}

fn tool_rule_set(config: &Value, path: &str) -> BTreeSet<String> {
    get_json_path(config, path)
        .and_then(Value::as_array)
        .map(|values| {
            values
                .iter()
                .filter_map(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_string)
                .collect()
        })
        .unwrap_or_default()
}

fn tool_name_matches_control_rule(tool_name: &str, rule: &str) -> bool {
    let rule = rule.trim();
    if rule == tool_name || rule == "*" {
        return true;
    }
    if let Some(prefix) = rule.strip_suffix('*') {
        return tool_name.starts_with(prefix);
    }
    if let Some((server, tool)) = mcp_tool_rule_parts(rule) {
        return mcp_tool_rule_parts(tool_name)
            .map(|(tool_server, tool_name)| {
                server == tool_server && (tool.is_empty() || tool == "*" || tool == tool_name)
            })
            .unwrap_or(false);
    }
    false
}

fn mcp_tool_rule_parts(value: &str) -> Option<(&str, &str)> {
    let remainder = value.strip_prefix("mcp__")?;
    remainder
        .split_once("__")
        .map(|(server, tool)| (server, tool))
        .or(Some((remainder, "")))
}

fn tool_read_only(state: &GatewayState, tool_name: &str) -> Option<bool> {
    crawclaw_runtime::rust_core_tool_definitions()
        .iter()
        .find(|definition| definition.id == tool_name)
        .map(|definition| definition.read_only)
        .or_else(|| {
            crawclaw_runtime::pi_agent_rust_tool_descriptors_for_runtime_root(&state.runtime_root)
                .into_iter()
                .find(|descriptor| descriptor.name == tool_name)
                .map(|descriptor| descriptor.read_only)
        })
}

fn permission_input(params: &Value) -> Result<Value, String> {
    let input = params.get("input").cloned().unwrap_or_else(|| json!({}));
    if input.is_object() {
        Ok(input)
    } else {
        Err("can_use_tool input must be an object".to_string())
    }
}

fn permission_allow(input: Value, tool_use_id: Option<String>) -> Value {
    let mut response = json!({
        "behavior": "allow",
        "updatedInput": input
    });
    if let (Some(object), Some(tool_use_id)) = (response.as_object_mut(), tool_use_id) {
        object.insert("toolUseID".to_string(), Value::String(tool_use_id));
    }
    response
}

fn permission_deny(message: String, tool_use_id: Option<String>, retry: bool) -> Value {
    let mut response = json!({
        "behavior": "deny",
        "message": message
    });
    if let (Some(object), Some(tool_use_id)) = (response.as_object_mut(), tool_use_id) {
        object.insert("toolUseID".to_string(), Value::String(tool_use_id));
    }
    if let Some(object) = response.as_object_mut() {
        object.insert("retry".to_string(), Value::Bool(retry));
    }
    response
}

fn validate_environment_variable(key: &str, value: &str) -> Result<(), String> {
    if key.is_empty() {
        return Err("environment variable name must not be empty".to_string());
    }
    if key.contains('=') || key.contains('\0') {
        return Err(format!("environment variable {key} has an invalid name"));
    }
    if value.contains('\0') {
        return Err(format!(
            "environment variable {key} value contains a NUL byte"
        ));
    }
    Ok(())
}
