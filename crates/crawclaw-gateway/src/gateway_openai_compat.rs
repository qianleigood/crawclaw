use super::*;

pub(super) async fn openai_models(
    State(state): State<GatewayState>,
    headers: HeaderMap,
) -> Response {
    if let Err(status) = authorize_headers(&headers, &state) {
        return status.into_response();
    }
    if !openai_compat_models_enabled(&state) {
        return StatusCode::NOT_FOUND.into_response();
    }
    Json(openai_models_response(&state, None).await).into_response()
}

pub(super) async fn openai_model(
    State(state): State<GatewayState>,
    headers: HeaderMap,
    AxumPath(model): AxumPath<String>,
) -> Response {
    if let Err(status) = authorize_headers(&headers, &state) {
        return status.into_response();
    }
    if !openai_compat_models_enabled(&state) {
        return StatusCode::NOT_FOUND.into_response();
    }
    let response = openai_models_response(&state, Some(model)).await;
    let status = if response.get("error").is_some() {
        StatusCode::NOT_FOUND
    } else {
        StatusCode::OK
    };
    (status, Json(response)).into_response()
}

pub(super) async fn openai_chat_completions(
    State(state): State<GatewayState>,
    headers: HeaderMap,
    Json(payload): Json<Value>,
) -> Response {
    if let Err(status) = authorize_headers(&headers, &state) {
        return status.into_response();
    }
    if !openai_compat_endpoint_enabled(&state, "chatCompletions") {
        return StatusCode::NOT_FOUND.into_response();
    }
    match openai_chat_completions_response_with_headers(&state, payload, Some(&headers)).await {
        Ok(response) => Json(response).into_response(),
        Err(message) => openai_compat_error(StatusCode::BAD_REQUEST, message).into_response(),
    }
}

pub(super) async fn openresponses(
    State(state): State<GatewayState>,
    headers: HeaderMap,
    Json(payload): Json<Value>,
) -> Response {
    if let Err(status) = authorize_headers(&headers, &state) {
        return status.into_response();
    }
    if !openai_compat_endpoint_enabled(&state, "responses") {
        return StatusCode::NOT_FOUND.into_response();
    }
    match openresponses_response_with_headers(&state, payload, Some(&headers)).await {
        Ok(response) => Json(response).into_response(),
        Err(message) => openai_compat_error(StatusCode::BAD_REQUEST, message).into_response(),
    }
}

pub(super) fn models_list(state: &GatewayState) -> Value {
    let provider_descriptors = crawclaw_providers::bundled_provider_descriptors();
    let native_registry = crawclaw_runtime::native_plugin_registry(&state.runtime_root);
    json!({
        "models": crawclaw_providers::bundled_provider_default_models()
            .into_iter()
            .map(|model| {
                let descriptor = provider_descriptors
                    .iter()
                    .find(|descriptor| descriptor.provider == model.provider);
                json!({
                    "id": model.model,
                    "name": model.name,
                    "provider": model.provider,
                    "reasoning": model.reasoning,
                    "source": "rust-native",
                    "transport": descriptor.and_then(|entry| entry.transport.clone()),
                    "pluginId": descriptor.map(|entry| entry.plugin_id.clone())
                })
            })
            .collect::<Vec<_>>(),
        "providerDescriptors": provider_descriptors,
        "providerAuthChoices": crawclaw_providers::bundled_provider_auth_choices(),
        "providerSetupOptions": crawclaw_providers::bundled_provider_setup_options(),
        "providerModelPickerEntries": crawclaw_providers::bundled_provider_model_picker_entries(),
        "webProviderBoundaries": crawclaw_providers::bundled_web_provider_boundaries(),
        "nativePluginDescriptors": native_registry.descriptors(),
        "nativeWebSearchProviders": native_registry.web_search_provider_descriptors(),
        "nativeWebFetchProviders": native_registry.web_fetch_provider_descriptors(),
        "nativeSpeechProviders": native_registry.speech_provider_descriptors(),
        "nativePluginRegistryDiagnostics": native_registry.diagnostics
    })
}

pub(super) async fn openai_models_response(
    _state: &GatewayState,
    model_id: Option<String>,
) -> Value {
    let ids = openai_compat_model_ids();
    match model_id {
        None => json!({
            "object": "list",
            "data": ids
                .into_iter()
                .map(openai_compat_model_object)
                .collect::<Vec<_>>()
        }),
        Some(model_id) if ids.iter().any(|id| *id == model_id) => {
            openai_compat_model_object(model_id)
        }
        Some(model_id) => json!({
            "error": {
                "message": format!("Model '{model_id}' not found."),
                "type": "invalid_request_error"
            }
        }),
    }
}

pub(super) async fn openai_chat_completions_response_with_headers(
    state: &GatewayState,
    payload: Value,
    headers: Option<&HeaderMap>,
) -> Result<Value, String> {
    let model = string_param(&payload, &["model"]).unwrap_or_else(|| "crawclaw".to_string());
    let options = openai_compat_request_options(headers)?;
    let agent_id = resolve_openai_compat_agent_id(&model, options.agent_id.as_deref())?;
    let prompt = build_openai_chat_prompt(&payload)?;
    let user = string_param(&payload, &["user"]);
    let run_id = format!("chatcmpl_{}", now_millis());
    let result = run_openai_compat_agent(
        state,
        OpenAiCompatAgentRun {
            run_id: run_id.clone(),
            agent_id: agent_id.clone(),
            session_key: openai_compat_session_key(
                &agent_id,
                "openai",
                user.as_deref(),
                options.session_key.as_deref(),
            ),
            message: prompt,
            channel: options
                .message_channel
                .unwrap_or_else(|| "webchat".to_string()),
        },
    )
    .await?;
    let created = now_seconds();
    Ok(json!({
        "id": run_id,
        "object": "chat.completion",
        "created": created,
        "model": model,
        "choices": [
            {
                "index": 0,
                "message": {
                    "role": "assistant",
                    "content": result.assistant_text
                },
                "finish_reason": "stop"
            }
        ],
        "usage": {
            "prompt_tokens": 0,
            "completion_tokens": 0,
            "total_tokens": 0
        }
    }))
}

pub(super) async fn openresponses_response_with_headers(
    state: &GatewayState,
    payload: Value,
    headers: Option<&HeaderMap>,
) -> Result<Value, String> {
    let model = string_param(&payload, &["model"]).unwrap_or_else(|| "crawclaw".to_string());
    let options = openai_compat_request_options(headers)?;
    let agent_id = resolve_openai_compat_agent_id(&model, options.agent_id.as_deref())?;
    let prompt = build_openresponses_prompt(&payload)?;
    let user = string_param(&payload, &["user"]);
    let run_id = format!("resp_{}", now_millis());
    let result = run_openai_compat_agent(
        state,
        OpenAiCompatAgentRun {
            run_id: run_id.clone(),
            agent_id: agent_id.clone(),
            session_key: openai_compat_session_key(
                &agent_id,
                "openresponses",
                user.as_deref(),
                options.session_key.as_deref(),
            ),
            message: prompt,
            channel: options
                .message_channel
                .unwrap_or_else(|| "webchat".to_string()),
        },
    )
    .await?;
    let output_id = format!("msg_{}", now_millis());
    Ok(json!({
        "id": run_id,
        "object": "response",
        "created_at": now_seconds(),
        "status": "completed",
        "model": model,
        "output": [
            {
                "id": output_id,
                "type": "message",
                "role": "assistant",
                "status": "completed",
                "content": [
                    {
                        "type": "output_text",
                        "text": result.assistant_text,
                        "annotations": []
                    }
                ]
            }
        ],
        "output_text": result.assistant_text,
        "usage": {
            "input_tokens": 0,
            "output_tokens": 0,
            "total_tokens": 0
        }
    }))
}

pub(super) struct OpenAiCompatAgentRun {
    run_id: String,
    agent_id: String,
    session_key: String,
    message: String,
    channel: String,
}

pub(super) async fn run_openai_compat_agent(
    state: &GatewayState,
    input: OpenAiCompatAgentRun,
) -> Result<AgentRunResult, String> {
    let request = AgentRunRequest {
        run_id: input.run_id,
        agent_id: input.agent_id.clone(),
        session_key: input.session_key.clone(),
        inbound: ChannelInboundEnvelope {
            channel: input.channel,
            account_id: Some("openai-compat".to_string()),
            from: "operator".to_string(),
            to: format!("agent:{}", input.agent_id),
            chat_type: ChannelChatType::Direct,
            body: input.message.clone(),
            raw_body: Some(input.message),
            message_id: None,
            thread_id: Some(input.session_key),
            media_urls: Vec::new(),
            metadata: BTreeMap::new(),
        },
        model: AgentModelSelection {
            provider: "configured".to_string(),
            model: "configured".to_string(),
            reasoning_level: None,
        },
        enabled_tools: Vec::new(),
        profile: Some(AgentRunProfileRequest {
            kind: AgentRunProfileKind::Normal,
            special_agent: None,
            memory_after_turn: Some(true),
        }),
        options: BTreeMap::new(),
    };
    let result = state
        .agent_runtime
        .run_turn(request)
        .await
        .map_err(|error| error.message().to_string())?;
    record_agent_run_events(state, &result)?;
    Ok(result)
}

pub(super) fn openai_compat_error(
    status: StatusCode,
    message: String,
) -> (StatusCode, Json<Value>) {
    (
        status,
        Json(json!({
            "error": {
                "message": message,
                "type": if status == StatusCode::BAD_REQUEST {
                    "invalid_request_error"
                } else {
                    "api_error"
                }
            }
        })),
    )
}

pub(super) fn openai_compat_model_ids() -> Vec<String> {
    vec![
        "crawclaw".to_string(),
        "crawclaw/default".to_string(),
        "crawclaw/main".to_string(),
    ]
}

pub(super) fn openai_compat_model_object(id: String) -> Value {
    json!({
        "id": id,
        "object": "model",
        "created": 0,
        "owned_by": "crawclaw",
        "permission": []
    })
}

pub(super) fn openai_compat_models_enabled(state: &GatewayState) -> bool {
    openai_compat_endpoint_enabled(state, "chatCompletions")
        || openai_compat_endpoint_enabled(state, "responses")
}

pub(super) fn openai_compat_endpoint_enabled(state: &GatewayState, endpoint: &str) -> bool {
    let config = read_config_value(&config_path(state)).unwrap_or_else(|_| json!({}));
    get_json_path(
        &config,
        &format!("gateway.http.endpoints.{endpoint}.enabled"),
    )
    .and_then(Value::as_bool)
    .unwrap_or(false)
}

#[derive(Default)]
pub(super) struct OpenAiCompatRequestOptions {
    agent_id: Option<String>,
    session_key: Option<String>,
    message_channel: Option<String>,
}

pub(super) fn openai_compat_request_options(
    headers: Option<&HeaderMap>,
) -> Result<OpenAiCompatRequestOptions, String> {
    let Some(headers) = headers else {
        return Ok(OpenAiCompatRequestOptions::default());
    };
    Ok(OpenAiCompatRequestOptions {
        agent_id: optional_header(headers, OPENAI_COMPAT_AGENT_ID_HEADER)
            .map(|value| validate_openai_compat_agent_id(&value))
            .transpose()?,
        session_key: optional_header(headers, OPENAI_COMPAT_SESSION_KEY_HEADER),
        message_channel: optional_header(headers, OPENAI_COMPAT_MESSAGE_CHANNEL_HEADER)
            .map(|value| validate_openai_compat_message_channel(&value))
            .transpose()?,
    })
}

pub(super) fn optional_header(headers: &HeaderMap, name: &str) -> Option<String> {
    headers
        .get(name)
        .and_then(|value| value.to_str().ok())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
}

pub(super) fn resolve_openai_compat_agent_id(
    model: &str,
    header_agent_id: Option<&str>,
) -> Result<String, String> {
    let model = model.trim();
    if model.is_empty() || model == "crawclaw" || model == "crawclaw/default" {
        return Ok(header_agent_id.unwrap_or("main").to_string());
    }
    let agent_id = model
        .strip_prefix("crawclaw/")
        .or_else(|| model.strip_prefix("crawclaw:"))
        .or_else(|| model.strip_prefix("agent:"))
        .ok_or_else(|| "Invalid `model`. Use `crawclaw` or `crawclaw/<agentId>`.".to_string())?;
    validate_openai_compat_agent_id(agent_id)
}

pub(super) fn validate_openai_compat_agent_id(agent_id: &str) -> Result<String, String> {
    let value = agent_id.trim();
    let valid = !value.is_empty()
        && value.len() <= 64
        && value
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || ch == '_' || ch == '-')
        && value
            .chars()
            .next()
            .map(|ch| ch.is_ascii_alphanumeric())
            .unwrap_or(false);
    if valid {
        Ok(value.to_string())
    } else {
        Err("Invalid `model`. Use `crawclaw` or `crawclaw/<agentId>`.".to_string())
    }
}

pub(super) fn validate_openai_compat_message_channel(channel: &str) -> Result<String, String> {
    let value = channel.trim();
    let valid = !value.is_empty()
        && value.len() <= 64
        && value
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || ch == '_' || ch == '-' || ch == '.')
        && value
            .chars()
            .next()
            .map(|ch| ch.is_ascii_alphanumeric())
            .unwrap_or(false);
    if valid {
        Ok(value.to_string())
    } else {
        Err("Invalid `x-crawclaw-message-channel`.".to_string())
    }
}

pub(super) fn openai_compat_session_key(
    agent_id: &str,
    prefix: &str,
    user: Option<&str>,
    explicit: Option<&str>,
) -> String {
    if let Some(explicit) = explicit.map(str::trim).filter(|value| !value.is_empty()) {
        return explicit.to_string();
    }
    let suffix = user
        .map(safe_openai_compat_session_component)
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| now_millis().to_string());
    format!("agent:{agent_id}:{prefix}-{suffix}")
}

pub(super) fn safe_openai_compat_session_component(value: &str) -> String {
    value
        .trim()
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || ch == '_' || ch == '-' || ch == '.' || ch == ':' {
                ch
            } else {
                '_'
            }
        })
        .collect::<String>()
}

pub(super) fn build_openai_chat_prompt(payload: &Value) -> Result<String, String> {
    let messages = payload
        .get("messages")
        .and_then(Value::as_array)
        .ok_or_else(|| "Missing user message in `messages`.".to_string())?;
    let mut system_parts = Vec::new();
    let mut conversation = Vec::new();
    for message in messages {
        let role = message
            .get("role")
            .and_then(Value::as_str)
            .unwrap_or("")
            .trim();
        if role.is_empty() {
            continue;
        }
        let content = extract_openai_text_content(message.get("content").unwrap_or(&Value::Null));
        let content = content.trim();
        if content.is_empty() {
            continue;
        }
        match role {
            "system" | "developer" => system_parts.push(content.to_string()),
            "assistant" => conversation.push(format!("Assistant: {content}")),
            "tool" | "function" => conversation.push(format!("Tool: {content}")),
            "user" => conversation.push(format!("User: {content}")),
            _ => {}
        }
    }
    if !conversation.iter().any(|entry| entry.starts_with("User: ")) {
        return Err("Missing user message in `messages`.".to_string());
    }
    let mut parts = Vec::new();
    if !system_parts.is_empty() {
        parts.push(format!(
            "System instructions:\n{}",
            system_parts.join("\n\n")
        ));
    }
    parts.push(conversation.join("\n\n"));
    Ok(parts.join("\n\n"))
}

pub(super) fn build_openresponses_prompt(payload: &Value) -> Result<String, String> {
    let Some(input) = payload.get("input") else {
        return Err("Missing `input`.".to_string());
    };
    let mut system_parts = Vec::new();
    if let Some(instructions) = payload.get("instructions").and_then(Value::as_str) {
        if !instructions.trim().is_empty() {
            system_parts.push(instructions.trim().to_string());
        }
    }
    let mut conversation = Vec::new();
    match input {
        Value::String(text) if !text.trim().is_empty() => {
            conversation.push(format!("User: {}", text.trim()));
        }
        Value::Array(items) => {
            for item in items {
                let item_type = item.get("type").and_then(Value::as_str).unwrap_or("");
                if item_type == "message" {
                    let role = item.get("role").and_then(Value::as_str).unwrap_or("user");
                    let content =
                        extract_openai_text_content(item.get("content").unwrap_or(&Value::Null));
                    let content = content.trim();
                    if content.is_empty() {
                        continue;
                    }
                    match role {
                        "system" | "developer" => system_parts.push(content.to_string()),
                        "assistant" => conversation.push(format!("Assistant: {content}")),
                        _ => conversation.push(format!("User: {content}")),
                    }
                } else if item_type == "function_call_output" {
                    let call_id = item
                        .get("call_id")
                        .and_then(Value::as_str)
                        .unwrap_or("unknown");
                    let output = item.get("output").and_then(Value::as_str).unwrap_or("");
                    if !output.trim().is_empty() {
                        conversation.push(format!("Tool:{call_id}: {}", output.trim()));
                    }
                }
            }
        }
        _ => {}
    }
    if conversation.is_empty() {
        return Err("Missing `input`.".to_string());
    }
    let mut parts = Vec::new();
    if !system_parts.is_empty() {
        parts.push(format!(
            "System instructions:\n{}",
            system_parts.join("\n\n")
        ));
    }
    parts.push(conversation.join("\n\n"));
    Ok(parts.join("\n\n"))
}

pub(super) fn extract_openai_text_content(value: &Value) -> String {
    match value {
        Value::String(text) => text.clone(),
        Value::Array(parts) => parts
            .iter()
            .filter_map(|part| {
                part.get("text")
                    .or_else(|| part.get("input_text"))
                    .and_then(Value::as_str)
            })
            .filter(|text| !text.trim().is_empty())
            .collect::<Vec<_>>()
            .join("\n"),
        _ => String::new(),
    }
}

pub(super) fn now_seconds() -> u64 {
    (now_millis() / 1000) as u64
}
