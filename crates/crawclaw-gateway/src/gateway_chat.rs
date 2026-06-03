use super::*;

pub(super) fn chat_history(state: &GatewayState, params: Value) -> Result<Value, String> {
    let session_key = normalize_session_key(&required_param(&params, &["sessionKey", "key"])?)?;
    let mut messages = state
        .session_store
        .session_history(&session_key)
        .map_err(|error| error.to_string())?;
    let limit = params
        .get("limit")
        .and_then(Value::as_u64)
        .unwrap_or(200)
        .min(1000) as usize;
    if messages.len() > limit {
        messages = messages.split_off(messages.len() - limit);
    }
    Ok(json!({
        "sessionKey": session_key,
        "sessionId": session_key,
        "messages": messages,
        "thinkingLevel": "medium",
        "fastMode": false
    }))
}

pub(super) fn chat_inject(state: &GatewayState, params: Value) -> Result<Value, String> {
    let session_key = normalize_session_key(&required_param(&params, &["sessionKey", "key"])?)?;
    let message = required_param(&params, &["message"])?;
    state
        .session_store
        .append_message(&session_key, "assistant", &message, Some("chat_inject"))
        .map_err(|error| error.to_string())?;
    let run_id = format!("inject-{}", now_millis());
    let payload = json!({
        "runId": run_id.clone(),
        "sessionKey": session_key,
        "seq": 0,
        "state": "final",
        "message": {
            "role": "assistant",
            "content": message
        }
    });
    emit(state, "chat", payload.clone());
    Ok(json!({
        "ok": true,
        "messageId": run_id,
        "event": payload
    }))
}

pub(super) fn chat_abort(params: Value) -> Result<Value, String> {
    let session_key = normalize_session_key(&required_param(&params, &["sessionKey", "key"])?)?;
    let run_ids = string_param(&params, &["runId"])
        .map(|run_id| vec![run_id])
        .unwrap_or_default();
    Ok(json!({
        "ok": true,
        "sessionKey": session_key,
        "aborted": false,
        "runIds": run_ids
    }))
}

pub(super) async fn execute_agent_run_turn(
    state: &GatewayState,
    params: &Value,
    default_run_prefix: &str,
) -> Result<AgentRunResult, String> {
    let session_key = normalize_session_key(&required_param(params, &["sessionKey", "key"])?)?;
    let run_id = string_param(params, &["idempotencyKey", "runId"])
        .unwrap_or_else(|| format!("{default_run_prefix}-{}", now_millis()));
    let mut params = params.clone();
    apply_gateway_agent_defaults(state, &mut params)?;
    let mut request = build_agent_run_request(&params, run_id, session_key)?;
    apply_sdk_session_start_hooks(state, &mut request).await?;
    apply_sdk_user_prompt_submit_hooks(state, &mut request).await?;
    record_rewind_checkpoint(state, &request);
    let tool_hook_policy = sdk_tool_use_hook_policy(state, &request)?;
    let run_post_turn_hooks = match &tool_hook_policy {
        Some(policy) => policy.post_tool_use.is_none(),
        None => true,
    };
    let failure_session_key = request.session_key.clone();
    let failure_agent_id = request.agent_id.clone();
    let result = match state
        .agent_runtime
        .run_turn_with_tool_hook_policy(request, tool_hook_policy)
        .await
    {
        Ok(result) => result,
        Err(error) => {
            let message = error.message().to_string();
            run_sdk_stop_failure_hooks(
                state,
                &failure_session_key,
                &failure_agent_id,
                &message,
                None,
            )
            .await;
            return Err(message);
        }
    };
    record_agent_run_events(state, &result)?;
    if run_post_turn_hooks {
        run_sdk_post_turn_hooks(state, &result).await?;
    }
    Ok(result)
}

async fn apply_sdk_session_start_hooks(
    state: &GatewayState,
    request: &mut AgentRunRequest,
) -> Result<(), String> {
    let is_new_session = state
        .session_store
        .session_history(&request.session_key)
        .map(|history| history.is_empty())
        .unwrap_or(true);
    if !is_new_session {
        return Ok(());
    }
    let mut input = sdk_base_hook_input(state, request, "SessionStart");
    if let Some(object) = input.as_object_mut() {
        object.insert("source".to_string(), Value::String("startup".to_string()));
        if request.model.model != "configured" {
            object.insert(
                "model".to_string(),
                Value::String(request.model.model.clone()),
            );
        }
    }
    let responses =
        run_sdk_hook_callbacks(state, "SessionStart", Some("startup"), input, None).await?;
    for response in responses {
        if let Some(reason) = sdk_hook_blocking_reason(&response) {
            return Err(reason);
        }
        if let Some(message) =
            sdk_hook_specific_string(&response, "SessionStart", "initialUserMessage")
        {
            prepend_hook_context_to_agent_request(request, &message);
        }
        if let Some(context) =
            sdk_hook_specific_string(&response, "SessionStart", "additionalContext")
        {
            append_hook_context_to_agent_request(request, &context);
        }
    }
    Ok(())
}

async fn apply_sdk_user_prompt_submit_hooks(
    state: &GatewayState,
    request: &mut AgentRunRequest,
) -> Result<(), String> {
    let mut input = sdk_base_hook_input(state, request, "UserPromptSubmit");
    if let Some(object) = input.as_object_mut() {
        object.insert(
            "prompt".to_string(),
            Value::String(request.inbound.body.clone()),
        );
    }
    let responses = run_sdk_hook_callbacks(state, "UserPromptSubmit", None, input, None).await?;
    for response in responses {
        if let Some(reason) = sdk_hook_blocking_reason(&response) {
            return Err(reason);
        }
        if let Some(context) =
            sdk_hook_specific_string(&response, "UserPromptSubmit", "additionalContext")
        {
            append_hook_context_to_agent_request(request, &context);
        }
    }
    Ok(())
}

pub(super) async fn run_sdk_session_end_hooks(
    state: &GatewayState,
    session_key: &str,
    reason: &str,
) -> Result<(), String> {
    let mut input = sdk_base_hook_input_for_session(state, session_key, "main", "SessionEnd");
    if let Some(object) = input.as_object_mut() {
        object.insert("reason".to_string(), Value::String(reason.to_string()));
    }
    let _ = run_sdk_hook_callbacks(state, "SessionEnd", Some(reason), input, None).await?;
    Ok(())
}

async fn run_sdk_post_turn_hooks(
    state: &GatewayState,
    result: &AgentRunResult,
) -> Result<(), String> {
    let agent_id = agent_run_result_agent_id(result);
    let mut calls = BTreeMap::<String, (String, Value)>::new();
    for event in &result.events {
        match event {
            AgentRunEvent::ToolCall {
                call_id,
                tool_name,
                arguments,
                ..
            } => {
                calls.insert(call_id.clone(), (tool_name.clone(), arguments.clone()));
            }
            AgentRunEvent::ToolProgress {
                call_id,
                tool_name,
                status,
                message,
                ..
            } if matches!(status.as_str(), "completed" | "failed") => {
                let (tool_name, tool_input) = calls
                    .get(call_id)
                    .cloned()
                    .unwrap_or_else(|| (tool_name.clone(), Value::Null));
                let hook_event = if status == "failed" {
                    "PostToolUseFailure"
                } else {
                    "PostToolUse"
                };
                let mut input = sdk_base_hook_input_for_session(
                    state,
                    &result.session_key,
                    agent_id,
                    hook_event,
                );
                if let Some(object) = input.as_object_mut() {
                    object.insert("tool_name".to_string(), Value::String(tool_name.clone()));
                    object.insert("tool_input".to_string(), tool_input);
                    object.insert("tool_use_id".to_string(), Value::String(call_id.clone()));
                    if hook_event == "PostToolUseFailure" {
                        object.insert(
                            "error".to_string(),
                            Value::String(message.clone().unwrap_or_default()),
                        );
                    } else {
                        object.insert(
                            "tool_response".to_string(),
                            json!({ "output": message.clone().unwrap_or_default() }),
                        );
                    }
                }
                let _ = run_sdk_hook_callbacks(
                    state,
                    hook_event,
                    Some(&tool_name),
                    input,
                    Some(call_id.clone()),
                )
                .await?;
            }
            _ => {}
        }
    }
    let mut stop_input =
        sdk_base_hook_input_for_session(state, &result.session_key, agent_id, "Stop");
    if let Some(object) = stop_input.as_object_mut() {
        object.insert("stop_hook_active".to_string(), Value::Bool(false));
        object.insert(
            "last_assistant_message".to_string(),
            Value::String(result.assistant_text.clone()),
        );
    }
    let _ = run_sdk_hook_callbacks(state, "Stop", None, stop_input, None).await?;
    Ok(())
}

async fn run_sdk_stop_failure_hooks(
    state: &GatewayState,
    session_key: &str,
    agent_id: &str,
    error: &str,
    last_assistant_message: Option<&str>,
) {
    let mut input = sdk_base_hook_input_for_session(state, session_key, agent_id, "StopFailure");
    if let Some(object) = input.as_object_mut() {
        object.insert("error".to_string(), Value::String(error.to_string()));
        if let Some(last_assistant_message) = last_assistant_message {
            object.insert(
                "last_assistant_message".to_string(),
                Value::String(last_assistant_message.to_string()),
            );
        }
    }
    let _ = run_sdk_hook_callbacks(state, "StopFailure", Some(error), input, None).await;
}

pub(super) async fn run_sdk_subagent_start_hooks(
    state: &GatewayState,
    parent_session_key: &str,
    agent_id: &str,
    agent_type: &str,
) -> Result<Vec<String>, String> {
    let mut input =
        sdk_base_hook_input_for_session(state, parent_session_key, "main", "SubagentStart");
    if let Some(object) = input.as_object_mut() {
        object.insert("agent_id".to_string(), Value::String(agent_id.to_string()));
        object.insert(
            "agent_type".to_string(),
            Value::String(agent_type.to_string()),
        );
    }
    let responses =
        run_sdk_hook_callbacks(state, "SubagentStart", Some(agent_type), input, None).await?;
    Ok(responses
        .into_iter()
        .filter_map(|response| {
            sdk_hook_specific_string(&response, "SubagentStart", "additionalContext")
        })
        .collect())
}

pub(super) async fn run_sdk_subagent_stop_hooks(
    state: &GatewayState,
    parent_session_key: &str,
    agent_id: &str,
    agent_type: &str,
    last_assistant_message: Option<&str>,
) -> Result<(), String> {
    let mut input =
        sdk_base_hook_input_for_session(state, parent_session_key, "main", "SubagentStop");
    let agent_transcript_path = state
        .session_store
        .session_transcript_path(agent_id)
        .map(|path| path.to_string_lossy().to_string())
        .unwrap_or_default();
    if let Some(object) = input.as_object_mut() {
        object.insert("stop_hook_active".to_string(), Value::Bool(false));
        object.insert("agent_id".to_string(), Value::String(agent_id.to_string()));
        object.insert(
            "agent_transcript_path".to_string(),
            Value::String(agent_transcript_path),
        );
        object.insert(
            "agent_type".to_string(),
            Value::String(agent_type.to_string()),
        );
        if let Some(message) = last_assistant_message {
            object.insert(
                "last_assistant_message".to_string(),
                Value::String(message.to_string()),
            );
        }
    }
    let _ = run_sdk_hook_callbacks(state, "SubagentStop", Some(agent_type), input, None).await?;
    Ok(())
}

fn agent_run_result_agent_id(result: &AgentRunResult) -> &str {
    result
        .events
        .iter()
        .find_map(|event| match event {
            AgentRunEvent::RunStarted { agent_id, .. } => Some(agent_id.as_str()),
            _ => None,
        })
        .unwrap_or("main")
}

fn sdk_base_hook_input(
    state: &GatewayState,
    request: &AgentRunRequest,
    hook_event_name: &str,
) -> Value {
    sdk_base_hook_input_for_session(
        state,
        &request.session_key,
        &request.agent_id,
        hook_event_name,
    )
}

pub(super) fn sdk_base_hook_input_for_session(
    state: &GatewayState,
    session_key: &str,
    agent_id: &str,
    hook_event_name: &str,
) -> Value {
    let transcript_path = state
        .session_store
        .session_transcript_path(session_key)
        .map(|path| path.to_string_lossy().to_string())
        .unwrap_or_default();
    let mut input = json!({
        "session_id": session_key,
        "transcript_path": transcript_path,
        "cwd": state.runtime_root.to_string_lossy().to_string(),
        "hook_event_name": hook_event_name
    });
    if agent_id != "main" {
        if let Some(object) = input.as_object_mut() {
            object.insert(
                "agent_type".to_string(),
                Value::String(agent_id.to_string()),
            );
        }
    }
    input
}

pub(super) fn sdk_hook_blocking_reason(response: &Value) -> Option<String> {
    if response
        .get("continue")
        .and_then(Value::as_bool)
        .is_some_and(|value| !value)
    {
        return Some(
            response
                .get("stopReason")
                .or_else(|| response.get("reason"))
                .and_then(Value::as_str)
                .unwrap_or("SDK hook blocked the turn")
                .to_string(),
        );
    }
    if response.get("decision").and_then(Value::as_str) == Some("block") {
        return Some(
            response
                .get("reason")
                .and_then(Value::as_str)
                .unwrap_or("SDK hook blocked the turn")
                .to_string(),
        );
    }
    None
}

pub(super) fn sdk_hook_specific_string(
    response: &Value,
    hook_event_name: &str,
    key: &str,
) -> Option<String> {
    let output = response.get("hookSpecificOutput")?;
    if output.get("hookEventName").and_then(Value::as_str) != Some(hook_event_name) {
        return None;
    }
    output
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
}

fn prepend_hook_context_to_agent_request(request: &mut AgentRunRequest, context: &str) {
    let body = if request.inbound.body.trim().is_empty() {
        context.to_string()
    } else {
        format!("{context}\n\n{}", request.inbound.body)
    };
    request.inbound.raw_body = Some(body.clone());
    request.inbound.body = body;
}

fn append_hook_context_to_agent_request(request: &mut AgentRunRequest, context: &str) {
    let body = if request.inbound.body.trim().is_empty() {
        context.to_string()
    } else {
        format!("{}\n\n{context}", request.inbound.body)
    };
    request.inbound.raw_body = Some(body.clone());
    request.inbound.body = body;
}

fn sdk_tool_use_hook_policy(
    state: &GatewayState,
    request: &AgentRunRequest,
) -> Result<Option<AgentRuntimeToolHookPolicy>, String> {
    let matchers = state
        .sdk_hook_matchers
        .lock()
        .map_err(|_| "SDK hook matcher store lock poisoned".to_string())?;
    let has_pre_tool_use_hooks = matchers
        .get("PreToolUse")
        .is_some_and(|matchers| !matchers.is_empty());
    let has_post_tool_use_hooks = matchers
        .get("PostToolUse")
        .is_some_and(|matchers| !matchers.is_empty())
        || matchers
            .get("PostToolUseFailure")
            .is_some_and(|matchers| !matchers.is_empty());
    drop(matchers);
    if !has_pre_tool_use_hooks && !has_post_tool_use_hooks {
        return Ok(None);
    }
    let pre_tool_use: Option<Arc<dyn AgentRuntimePreToolUseHook>> = if has_pre_tool_use_hooks {
        Some(Arc::new(GatewayPreToolUseHook {
            state: state.clone(),
            session_key: request.session_key.clone(),
            agent_id: request.agent_id.clone(),
        }))
    } else {
        None
    };
    let post_tool_use: Option<Arc<dyn AgentRuntimePostToolUseHook>> = if has_post_tool_use_hooks {
        Some(Arc::new(GatewayPostToolUseHook {
            state: state.clone(),
            session_key: request.session_key.clone(),
            agent_id: request.agent_id.clone(),
        }))
    } else {
        None
    };
    Ok(Some(AgentRuntimeToolHookPolicy::with_tool_hooks(
        pre_tool_use,
        post_tool_use,
    )))
}

struct GatewayPreToolUseHook {
    state: GatewayState,
    session_key: String,
    agent_id: String,
}

impl AgentRuntimePreToolUseHook for GatewayPreToolUseHook {
    fn pre_tool_use<'a>(
        &'a self,
        request: AgentRuntimePreToolUseRequest,
    ) -> Pin<Box<dyn Future<Output = AgentRuntimePreToolUseDecision> + Send + 'a>> {
        Box::pin(async move {
            let mut input = sdk_base_hook_input_for_session(
                &self.state,
                &self.session_key,
                &self.agent_id,
                "PreToolUse",
            );
            if let Some(object) = input.as_object_mut() {
                object.insert(
                    "tool_name".to_string(),
                    Value::String(request.tool_name.clone()),
                );
                object.insert("tool_input".to_string(), request.input.clone());
                object.insert(
                    "tool_use_id".to_string(),
                    Value::String(request.tool_call_id.clone()),
                );
            }
            let responses = match run_sdk_hook_callbacks(
                &self.state,
                "PreToolUse",
                Some(&request.tool_name),
                input,
                Some(request.tool_call_id.clone()),
            )
            .await
            {
                Ok(responses) => responses,
                Err(error) => {
                    tracing::warn!(
                        tool_name = %request.tool_name,
                        tool_call_id = %request.tool_call_id,
                        error = %error,
                        "sdk_pre_tool_use_hook_failed"
                    );
                    return AgentRuntimePreToolUseDecision::Continue {
                        input: request.input,
                        additional_context: Vec::new(),
                    };
                }
            };
            sdk_pre_tool_use_decision(request.input, responses)
        })
    }
}

fn sdk_pre_tool_use_decision(
    original_input: Value,
    responses: Vec<Value>,
) -> AgentRuntimePreToolUseDecision {
    let mut input = original_input;
    let mut additional_context = Vec::new();
    for response in responses {
        if let Some(reason) = sdk_hook_blocking_reason(&response) {
            return AgentRuntimePreToolUseDecision::Block { message: reason };
        }
        if let Some(context) =
            sdk_hook_specific_string(&response, "PreToolUse", "additionalContext")
        {
            additional_context.push(context);
        }
        let Some(output) = response.get("hookSpecificOutput") else {
            continue;
        };
        if output.get("hookEventName").and_then(Value::as_str) != Some("PreToolUse") {
            continue;
        }
        if output.get("permissionDecision").and_then(Value::as_str) == Some("deny") {
            let message = output
                .get("permissionDecisionReason")
                .or_else(|| response.get("reason"))
                .and_then(Value::as_str)
                .unwrap_or("blocked by PreToolUse hook")
                .to_string();
            return AgentRuntimePreToolUseDecision::Block { message };
        }
        if let Some(updated_input) = output.get("updatedInput").filter(|value| value.is_object()) {
            input = updated_input.clone();
        }
    }
    AgentRuntimePreToolUseDecision::Continue {
        input,
        additional_context,
    }
}

struct GatewayPostToolUseHook {
    state: GatewayState,
    session_key: String,
    agent_id: String,
}

impl AgentRuntimePostToolUseHook for GatewayPostToolUseHook {
    fn post_tool_use<'a>(
        &'a self,
        request: AgentRuntimePostToolUseRequest,
    ) -> Pin<Box<dyn Future<Output = AgentRuntimePostToolUseDecision> + Send + 'a>> {
        Box::pin(async move {
            let hook_event = if request.error.is_some() {
                "PostToolUseFailure"
            } else {
                "PostToolUse"
            };
            let mut input = sdk_base_hook_input_for_session(
                &self.state,
                &self.session_key,
                &self.agent_id,
                hook_event,
            );
            if let Some(object) = input.as_object_mut() {
                object.insert(
                    "tool_name".to_string(),
                    Value::String(request.tool_name.clone()),
                );
                object.insert("tool_input".to_string(), request.input);
                object.insert(
                    "tool_use_id".to_string(),
                    Value::String(request.tool_call_id.clone()),
                );
                if let Some(error) = request.error {
                    object.insert("error".to_string(), Value::String(error));
                } else {
                    object.insert(
                        "tool_response".to_string(),
                        request.output.unwrap_or(Value::Null),
                    );
                }
            }
            let responses = match run_sdk_hook_callbacks(
                &self.state,
                hook_event,
                Some(&request.tool_name),
                input,
                Some(request.tool_call_id),
            )
            .await
            {
                Ok(responses) => responses,
                Err(error) => {
                    tracing::warn!(
                        tool_name = %request.tool_name,
                        error = %error,
                        "sdk_post_tool_use_hook_failed"
                    );
                    return AgentRuntimePostToolUseDecision::Continue {
                        updated_mcp_tool_output: None,
                        additional_context: Vec::new(),
                    };
                }
            };
            sdk_post_tool_use_decision(hook_event, responses)
        })
    }
}

fn sdk_post_tool_use_decision(
    hook_event: &str,
    responses: Vec<Value>,
) -> AgentRuntimePostToolUseDecision {
    if hook_event != "PostToolUse" {
        let additional_context = sdk_hook_additional_contexts(hook_event, &responses);
        return AgentRuntimePostToolUseDecision::Continue {
            updated_mcp_tool_output: None,
            additional_context,
        };
    }
    let mut updated_mcp_tool_output = None;
    let additional_context = sdk_hook_additional_contexts(hook_event, &responses);
    for response in responses {
        let Some(output) = response.get("hookSpecificOutput") else {
            continue;
        };
        if output.get("hookEventName").and_then(Value::as_str) != Some("PostToolUse") {
            continue;
        }
        if let Some(updated) = output.get("updatedMCPToolOutput") {
            updated_mcp_tool_output = Some(updated.clone());
        }
    }
    AgentRuntimePostToolUseDecision::Continue {
        updated_mcp_tool_output,
        additional_context,
    }
}

fn sdk_hook_additional_contexts(hook_event: &str, responses: &[Value]) -> Vec<String> {
    responses
        .iter()
        .filter_map(|response| sdk_hook_specific_string(response, hook_event, "additionalContext"))
        .collect()
}

pub(super) fn build_agent_run_request(
    params: &Value,
    run_id: String,
    session_key: String,
) -> Result<AgentRunRequest, String> {
    let agent_id = string_param(params, &["agentId"]).unwrap_or_else(|| "main".to_string());
    let inbound = if let Some(value) = params.get("inbound") {
        let mut inbound = serde_json::from_value::<ChannelInboundEnvelope>(value.clone())
            .map_err(|error| format!("invalid agent inbound envelope: {error}"))?;
        if inbound.thread_id.is_none() {
            inbound.thread_id = Some(session_key.clone());
        }
        inbound
    } else {
        let message = required_param(params, &["message", "text", "prompt"])?;
        let mut metadata = BTreeMap::new();
        if let Some(parent) = string_param(params, &["parentSessionKey", "parent", "spawnedBy"]) {
            metadata.insert("parentSessionKey".to_string(), json!(parent));
        }
        if params.get("fork").and_then(Value::as_bool) == Some(true) {
            metadata.insert(
                "parentContextPolicy".to_string(),
                json!("fork_messages_only"),
            );
        } else if let Some(policy) = string_param(params, &["parentContextPolicy"]) {
            metadata.insert("parentContextPolicy".to_string(), json!(policy));
        }
        ChannelInboundEnvelope {
            channel: string_param(params, &["channel"]).unwrap_or_else(|| "gateway".to_string()),
            account_id: string_param(params, &["accountId"]),
            from: string_param(params, &["from"]).unwrap_or_else(|| "user".to_string()),
            to: string_param(params, &["to"]).unwrap_or_else(|| "agent:main".to_string()),
            chat_type: ChannelChatType::Direct,
            body: message.clone(),
            raw_body: Some(message),
            message_id: string_param(params, &["messageId"]),
            thread_id: Some(session_key.clone()),
            media_urls: Vec::new(),
            metadata,
        }
    };

    let profile = params
        .get("profile")
        .cloned()
        .map(serde_json::from_value::<AgentRunProfileRequest>)
        .transpose()
        .map_err(|error| format!("invalid agent run profile: {error}"))?
        .or_else(|| {
            string_param(params, &["btwQuestion"]).map(|_| AgentRunProfileRequest {
                kind: AgentRunProfileKind::Btw,
                special_agent: None,
                memory_after_turn: Some(false),
            })
        })
        .or_else(|| {
            Some(AgentRunProfileRequest {
                kind: AgentRunProfileKind::Normal,
                special_agent: None,
                memory_after_turn: Some(true),
            })
        });

    Ok(AgentRunRequest {
        run_id,
        agent_id,
        session_key,
        inbound,
        model: AgentModelSelection {
            provider: agent_model_param(params, "provider")
                .unwrap_or_else(|| "configured".to_string()),
            model: agent_model_param(params, "model").unwrap_or_else(|| "configured".to_string()),
            reasoning_level: string_param(params, &["reasoningLevel"]),
        },
        enabled_tools: agent_run_enabled_tools(params),
        profile,
        options: agent_run_options(params),
    })
}

pub(super) fn agent_run_options(params: &Value) -> BTreeMap<String, Value> {
    let mut options = params
        .get("options")
        .and_then(Value::as_object)
        .map(|object| {
            object
                .iter()
                .map(|(key, value)| (key.clone(), value.clone()))
                .collect::<BTreeMap<_, _>>()
        })
        .unwrap_or_default();
    if let Some(question) = string_param(params, &["btwQuestion"]) {
        options.insert("btwQuestion".to_string(), Value::String(question));
    }
    for key in [
        "systemPrompt",
        "system_prompt",
        "jsonSchema",
        "parentContextPolicy",
        "description",
        "subagent_type",
        "subagentType",
        "agentType",
        "permissionMode",
        "permission_mode",
        "mode",
        "mcpServers",
    ] {
        if let Some(value) = params.get(key) {
            options
                .entry(key.to_string())
                .or_insert_with(|| value.clone());
        }
    }
    options
}

fn nested_string_array_param(input: &Value, object_key: &str, key: &str) -> Option<Vec<String>> {
    input
        .get(object_key)
        .and_then(|value| value.as_object())
        .and_then(|object| object.get(key))
        .and_then(Value::as_array)
        .and_then(|values| {
            let out = values
                .iter()
                .filter_map(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(ToOwned::to_owned)
                .collect::<Vec<_>>();
            (!out.is_empty()).then_some(out)
        })
}

pub(super) fn agent_run_enabled_tools(params: &Value) -> Vec<String> {
    string_array_param(params, "enabledTools")
        .or_else(|| string_array_param(params, "allowedTools"))
        .or_else(|| nested_string_array_param(params, "options", "enabledTools"))
        .or_else(|| nested_string_array_param(params, "options", "allowedTools"))
        .unwrap_or_default()
}

pub(super) fn agent_model_param(params: &Value, field: &str) -> Option<String> {
    let top_level = if field == "model" {
        string_param(params, &["modelId"]).or_else(|| {
            params
                .get("model")
                .and_then(Value::as_str)
                .map(str::to_string)
        })
    } else {
        string_param(params, &[field])
    };
    top_level
        .or_else(|| {
            params
                .get("model")
                .and_then(Value::as_object)
                .and_then(|model| model.get(field))
                .and_then(Value::as_str)
                .map(str::to_string)
        })
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

pub(super) fn agent_run_events_value(events: &[AgentRunEvent]) -> Result<Value, String> {
    serde_json::to_value(events)
        .map_err(|error| format!("failed to serialize agent run events: {error}"))
}

pub(super) fn record_agent_run_events(
    state: &GatewayState,
    result: &AgentRunResult,
) -> Result<(), String> {
    let events = result
        .events
        .iter()
        .map(serde_json::to_value)
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("failed to serialize agent run events: {error}"))?;
    let mut runs = state
        .agent_run_events
        .lock()
        .map_err(|_| "agent run event store lock poisoned".to_string())?;
    runs.insert(result.run_id.clone(), events);
    drop(runs);
    for event in result
        .events
        .iter()
        .filter_map(agent_run_event_gateway_topic)
    {
        emit(
            state,
            event.0,
            json!({
                "runId": result.run_id,
                "event": event.1
            }),
        );
    }
    Ok(())
}

fn agent_run_event_gateway_topic(event: &AgentRunEvent) -> Option<(&'static str, Value)> {
    match event {
        AgentRunEvent::ContextProjected { .. } => {
            Some(("agent.contextProjected", serde_json::to_value(event).ok()?))
        }
        AgentRunEvent::ProviderBlock { .. } => {
            Some(("agent.providerBlock", serde_json::to_value(event).ok()?))
        }
        AgentRunEvent::ToolProgress { .. } => {
            Some(("agent.toolProgress", serde_json::to_value(event).ok()?))
        }
        AgentRunEvent::ToolUseSummary { .. } => {
            Some(("agent.toolUseSummary", serde_json::to_value(event).ok()?))
        }
        AgentRunEvent::PermissionRequested { .. } => Some((
            "agent.permissionRequested",
            serde_json::to_value(event).ok()?,
        )),
        AgentRunEvent::PermissionDecision { .. } => Some((
            "agent.permissionDecision",
            serde_json::to_value(event).ok()?,
        )),
        AgentRunEvent::HookDecision { .. } => {
            Some(("agent.hookDecision", serde_json::to_value(event).ok()?))
        }
        AgentRunEvent::SubagentLifecycle { .. } => {
            Some(("agent.subagentLifecycle", serde_json::to_value(event).ok()?))
        }
        AgentRunEvent::McpElicitation { .. } => {
            Some(("agent.mcpElicitation", serde_json::to_value(event).ok()?))
        }
        _ => None,
    }
}

pub(super) async fn agent_run_turn(state: &GatewayState, params: Value) -> Result<Value, String> {
    let result = execute_agent_run_turn(state, &params, "rust-agent-run").await?;
    agent_run_response(result, "agentRun")
}

pub(super) async fn agent_command_run(
    state: &GatewayState,
    params: Value,
) -> Result<Value, String> {
    let result = execute_agent_run_turn(state, &params, "rust-agent-command").await?;
    agent_run_response(result, "agentCommand")
}

pub(super) async fn auto_reply_run(state: &GatewayState, params: Value) -> Result<Value, String> {
    let result = execute_agent_run_turn(state, &params, "rust-auto-reply").await?;
    agent_run_response(result, "autoReply")
}

pub(super) async fn auto_reply_command(
    state: &GatewayState,
    params: Value,
) -> Result<Value, String> {
    let command = required_param(&params, &["command", "name", "action"])?;
    match command.as_str() {
        "run" | "reply" | "message" => auto_reply_run(state, params).await,
        "status" => Ok(json!({
            "ok": true,
            "status": "ok",
            "implementation": "rust-native",
            "runtime": "autoReply",
            "sessionKey": string_param(&params, &["sessionKey", "key"]).unwrap_or_else(|| "main".to_string())
        })),
        "compact" => {
            let session_key =
                string_param(&params, &["sessionKey", "key"]).unwrap_or_else(|| "main".to_string());
            let result = state
                .session_store
                .compact_session(&normalize_session_key(&session_key)?, 200)
                .map_err(|error| error.to_string())?;
            Ok(json!({
                "ok": true,
                "status": "compacted",
                "implementation": "rust-native",
                "sessionKey": session_key,
                "compacted": result.0,
                "kept": result.1
            }))
        }
        "abort" | "cancel" | "stop" => chat_abort(json!({
            "sessionKey": string_param(&params, &["sessionKey", "key"]).unwrap_or_else(|| "main".to_string()),
            "runId": string_param(&params, &["runId"])
        })),
        other => Err(format!("Unsupported Rust auto-reply command: {other}")),
    }
}

pub(super) fn agent_run_response(result: AgentRunResult, kind: &str) -> Result<Value, String> {
    let events = agent_run_events_value(&result.events)?;
    Ok(json!({
        "ok": true,
        "status": "completed",
        "kind": kind,
        "implementation": "rust-native",
        "runId": result.run_id,
        "sessionKey": result.session_key,
        "assistantText": result.assistant_text,
        "contextSummary": result.context_summary,
        "events": events
    }))
}

pub(super) async fn special_agent_run(
    state: &GatewayState,
    params: Value,
) -> Result<Value, String> {
    let request = serde_json::from_value::<SpecialAgentRunRequest>(params)
        .map_err(|error| format!("invalid special_agents.run params: {error}"))?;
    let selector = request
        .kind
        .as_deref()
        .or(request.spawn_source.as_deref())
        .ok_or_else(|| "special_agents.run requires kind or spawnSource".to_string())?;
    let definition = find_special_agent(selector)
        .ok_or_else(|| format!("unknown special agent kind: {selector}"))?;
    special_agent_run_with_agent_runtime(state, request, definition).await
}

pub(super) async fn special_agent_run_with_agent_runtime(
    state: &GatewayState,
    request: SpecialAgentRunRequest,
    definition: &'static SpecialAgentDefinition,
) -> Result<Value, String> {
    let kind = definition.id;
    let run_id = format!("special-{kind}-{}", now_millis());
    let session_key = special_agent_session_key(definition, kind, &run_id, &request);
    let scope = request.scope.clone().unwrap_or_else(|| "main".to_string());
    let task = special_agent_task_body(definition, &request)?;
    let mut metadata = BTreeMap::new();
    if definition.parent_context_policy
        != crawclaw_runtime::special_agents::SpecialAgentParentContextPolicy::None
    {
        if let Some(parent_session_key) = request.parent_session_key.as_deref() {
            metadata.insert(
                "parentSessionKey".to_string(),
                Value::String(parent_session_key.to_string()),
            );
        }
    }
    let agent_request = AgentRunRequest {
        run_id: run_id.clone(),
        agent_id: kind.to_string(),
        session_key: session_key.clone(),
        inbound: ChannelInboundEnvelope {
            channel: "special-agent".to_string(),
            account_id: Some("rust-runtime".to_string()),
            from: "special-agent".to_string(),
            to: format!("agent:{kind}"),
            chat_type: ChannelChatType::Direct,
            body: task.clone(),
            raw_body: Some(task),
            message_id: Some(format!("{run_id}:input")),
            thread_id: Some(session_key.clone()),
            media_urls: Vec::new(),
            metadata,
        },
        model: AgentModelSelection {
            provider: "configured".to_string(),
            model: "configured".to_string(),
            reasoning_level: None,
        },
        enabled_tools: definition
            .tool_allowlist
            .iter()
            .map(|tool| (*tool).to_string())
            .collect(),
        profile: Some(AgentRunProfileRequest {
            kind: AgentRunProfileKind::SpecialAgent,
            special_agent: Some(definition.id.to_string()),
            memory_after_turn: Some(
                definition.guard != Some(SpecialAgentToolGuard::MemoryMaintenance),
            ),
        }),
        options: BTreeMap::new(),
    };
    let result = state
        .agent_runtime
        .run_turn(agent_request)
        .await
        .map_err(|error| error.message().to_string())?;
    record_agent_run_events(state, &result)?;
    let events = agent_run_events_value(&result.events)?;
    let memory = persist_special_agent_memory_result(state, kind, &scope, &result.assistant_text)?;
    let response = json!({
        "status": "completed",
        "runId": result.run_id,
        "kind": kind,
        "executionMode": definition.execution_mode,
        "parentSessionKey": request.parent_session_key,
        "result": {
            "status": "completed",
            "assistantText": result.assistant_text,
            "payloads": [
                {
                    "text": result.assistant_text
                }
            ],
            "events": events,
            "contextSummary": result.context_summary,
            "memory": memory,
            "implementation": "rust-native"
        }
    });
    emit(
        state,
        "special_agents.result",
        json!({ "kind": kind, "result": response["result"].clone() }),
    );
    Ok(response)
}

fn special_agent_session_key(
    definition: &SpecialAgentDefinition,
    kind: &str,
    run_id: &str,
    request: &SpecialAgentRunRequest,
) -> String {
    if definition.guard == Some(SpecialAgentToolGuard::MemoryMaintenance) {
        return format!("special:{kind}:{run_id}");
    }
    request
        .parent_session_key
        .clone()
        .unwrap_or_else(|| format!("special:{kind}:{run_id}"))
}

fn special_agent_task_body(
    definition: &SpecialAgentDefinition,
    request: &SpecialAgentRunRequest,
) -> Result<String, String> {
    let task = request.task.clone().unwrap_or_default();
    if definition.input_contract != SpecialAgentMemoryInputContract::MemoryDelta {
        return Ok(task);
    }
    let package = request.context_package.clone().unwrap_or_else(|| {
        json!({
            "task": task,
            "recentModelVisibleMessages": [],
            "explicitSignals": {
                "explicitRememberAsked": false,
                "explicitForgetAsked": false,
                "hadDurableWriteThisTurn": false,
                "hadDurableDeleteThisTurn": false,
                "hadExperienceWriteThisTurn": false
            }
        })
    });
    let package_text = serde_json::to_string_pretty(&package)
        .map_err(|error| format!("failed to encode special-agent context package: {error}"))?;
    Ok(format!(
        "Use only the structured memory-maintenance input below. Do not infer durable memories from parent transcript history or hidden parent prompt context.\n\n<context_package>\n{package_text}\n</context_package>"
    ))
}

pub(super) fn persist_special_agent_memory_result(
    state: &GatewayState,
    kind: &str,
    scope: &str,
    assistant_text: &str,
) -> Result<Value, String> {
    let runtime = memory_runtime(state);
    match kind {
        "session-summary" => runtime
            .session_summary_store()
            .refresh(scope, assistant_text),
        "dream" | "experience" | "durable-memory" => Ok(json!({
            "status": "tool_owned",
            "handler": kind,
        })),
        _ => Ok(Value::Null),
    }
}

pub(super) async fn memory_compact_with_agent_runtime(
    state: &GatewayState,
    session_id: &str,
    force: bool,
) -> Result<Value, String> {
    let runtime = memory_runtime(state);
    let store = runtime.store();
    store.init()?;
    let messages = store.list_messages(session_id, 10_000)?;
    if !force && messages.len() < 64 {
        return Ok(json!({
            "ok": true,
            "compacted": false,
            "reason": "below_threshold"
        }));
    }
    run_sdk_pre_compact_hooks(state, session_id, "manual", None).await?;
    let transcript = serde_json::to_string_pretty(&messages)
        .map_err(|error| format!("failed to serialize compact transcript: {error}"))?;
    let definition = find_special_agent("session-summary")
        .ok_or_else(|| "missing session-summary special agent".to_string())?;
    let run = special_agent_run_with_agent_runtime(
        state,
        SpecialAgentRunRequest {
            kind: Some("session-summary".to_string()),
            spawn_source: None,
            task: Some(format!(
                "Compact session {session_id} into a concise, durable session summary.\n\n{transcript}"
            )),
            scope: Some(session_id.to_string()),
            parent_session_key: Some(format!("memory:compact:{session_id}")),
            context_package: None,
        },
        definition,
    )
    .await?;
    let summary = run
        .get("result")
        .and_then(|result| result.get("assistantText"))
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    store.upsert_session_compaction_state(session_id, messages.len() as i64)?;
    run_sdk_post_compact_hooks(state, session_id, "manual", &summary).await?;
    Ok(json!({
        "ok": true,
        "compacted": true,
        "result": {
            "summary": summary,
            "firstKeptEntryId": messages
                .last()
                .and_then(|message| message.get("id"))
                .and_then(Value::as_str)
                .unwrap_or(session_id),
            "tokensBefore": estimate_gateway_json_tokens(&json!(messages)),
            "tokensAfter": estimate_gateway_text_tokens(&summary),
            "runId": run.get("runId").cloned().unwrap_or(Value::Null),
            "implementation": "rust-native-agent-runtime"
        }
    }))
}

pub(super) async fn run_sdk_pre_compact_hooks(
    state: &GatewayState,
    session_key: &str,
    trigger: &str,
    custom_instructions: Option<String>,
) -> Result<(), String> {
    let trigger = compact_trigger(trigger);
    let mut input = sdk_base_hook_input_for_session(state, session_key, "main", "PreCompact");
    if let Some(object) = input.as_object_mut() {
        object.insert("trigger".to_string(), Value::String(trigger.clone()));
        object.insert(
            "custom_instructions".to_string(),
            custom_instructions
                .map(Value::String)
                .unwrap_or(Value::Null),
        );
    }
    let responses =
        run_sdk_hook_callbacks(state, "PreCompact", Some(&trigger), input, None).await?;
    for response in responses {
        if let Some(reason) = sdk_hook_blocking_reason(&response) {
            return Err(reason);
        }
    }
    Ok(())
}

pub(super) async fn run_sdk_post_compact_hooks(
    state: &GatewayState,
    session_key: &str,
    trigger: &str,
    compact_summary: &str,
) -> Result<(), String> {
    let trigger = compact_trigger(trigger);
    let mut input = sdk_base_hook_input_for_session(state, session_key, "main", "PostCompact");
    if let Some(object) = input.as_object_mut() {
        object.insert("trigger".to_string(), Value::String(trigger.clone()));
        object.insert(
            "compact_summary".to_string(),
            Value::String(compact_summary.to_string()),
        );
    }
    let responses =
        run_sdk_hook_callbacks(state, "PostCompact", Some(&trigger), input, None).await?;
    for response in responses {
        if let Some(reason) = sdk_hook_blocking_reason(&response) {
            return Err(reason);
        }
    }
    Ok(())
}

fn compact_trigger(value: &str) -> String {
    if value == "auto" {
        "auto".to_string()
    } else {
        "manual".to_string()
    }
}

pub(super) fn estimate_gateway_json_tokens(value: &Value) -> u32 {
    estimate_gateway_text_tokens(&serde_json::to_string(value).unwrap_or_default())
}

pub(super) fn estimate_gateway_text_tokens(value: &str) -> u32 {
    value.split_whitespace().count().max(value.len() / 4).max(1) as u32
}

pub(super) async fn channel_inbound_handle(
    state: &GatewayState,
    params: Value,
) -> Result<Value, String> {
    let inbound_value = params
        .get("inbound")
        .cloned()
        .ok_or_else(|| "channel.inbound.handle requires inbound envelope".to_string())?;
    let mut inbound = serde_json::from_value::<ChannelInboundEnvelope>(inbound_value)
        .map_err(|error| format!("invalid channel inbound envelope: {error}"))?;
    let session_key = resolve_inbound_session_key(&params, &inbound)?;
    if inbound.thread_id.is_none() {
        inbound.thread_id = Some(session_key.clone());
    }
    let run_id = string_param(&params, &["idempotencyKey", "runId"])
        .unwrap_or_else(|| format!("rust-inbound-{}", now_millis()));
    let request = AgentRunRequest {
        run_id,
        agent_id: string_param(&params, &["agentId"]).unwrap_or_else(|| "main".to_string()),
        session_key,
        inbound,
        model: AgentModelSelection {
            provider: agent_model_param(&params, "provider")
                .unwrap_or_else(|| "configured".to_string()),
            model: agent_model_param(&params, "model").unwrap_or_else(|| "configured".to_string()),
            reasoning_level: string_param(&params, &["reasoningLevel"]),
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
    let events = agent_run_events_value(&result.events)?;
    Ok(json!({
        "ok": true,
        "status": "completed",
        "runId": result.run_id,
        "sessionKey": result.session_key,
        "assistantText": result.assistant_text,
        "contextSummary": result.context_summary,
        "events": events
    }))
}

pub(super) fn resolve_inbound_session_key(
    params: &Value,
    inbound: &ChannelInboundEnvelope,
) -> Result<String, String> {
    if let Some(session_key) = string_param(params, &["sessionKey", "key"]) {
        return normalize_session_key(&session_key);
    }
    if let Some(thread_id) = inbound.thread_id.as_deref() {
        return normalize_session_key(thread_id);
    }
    Err("channel.inbound.handle requires sessionKey or inbound.threadId".to_string())
}

pub(super) fn agent_stream_events(state: &GatewayState, params: Value) -> Result<Value, String> {
    let run_id = required_param(&params, &["runId", "id"])?;
    let runs = state
        .agent_run_events
        .lock()
        .map_err(|_| "agent run event store lock poisoned".to_string())?;
    let events = runs
        .get(&run_id)
        .cloned()
        .ok_or_else(|| format!("agent run events not found: {run_id}"))?;
    Ok(json!({
        "ok": true,
        "runId": run_id,
        "events": events
    }))
}

pub(super) async fn chat_send(state: &GatewayState, params: Value) -> Result<Value, String> {
    let run_id = string_param(&params, &["idempotencyKey", "runId"])
        .unwrap_or_else(|| format!("rust-chat-{}", now_millis()));
    let session_key = normalize_session_key(&required_param(&params, &["sessionKey", "key"])?)?;
    tracing::info!(
        runtime_root = %state.runtime_root.display(),
        run_id = %run_id,
        session_key = %session_key,
        "rust_gateway_chat_send_started"
    );
    let mut run_params = params;
    ensure_json_object(&mut run_params).insert("runId".to_string(), Value::String(run_id.clone()));
    let result = match execute_agent_run_turn(state, &run_params, "rust-chat").await {
        Ok(result) => result,
        Err(error) => {
            tracing::info!(
                runtime_root = %state.runtime_root.display(),
                run_id = %run_id,
                session_key = %session_key,
                error = %error,
                "rust_gateway_chat_send_failed"
            );
            let payload = json!({
            "runId": run_id,
            "sessionKey": session_key,
            "seq": 0,
                    "state": "error",
                    "errorMessage": error
                });
            emit(state, "chat", payload);
            return Err(error);
        }
    };
    let assistant_text = result
        .events
        .iter()
        .find_map(|event| match event {
            AgentRunEvent::ReplyPayload { payload, .. } => payload.text.clone(),
            _ => None,
        })
        .unwrap_or_else(|| result.assistant_text.clone());
    let thread_id = result.session_key.clone();
    let events = agent_run_events_value(&result.events)?;
    let payload = json!({
        "runId": run_id.clone(),
        "sessionKey": thread_id.clone(),
        "seq": 0,
        "state": "final",
        "message": {
            "role": "assistant",
            "content": assistant_text
        },
        "stopReason": "end_turn"
    });
    emit(state, "chat", payload.clone());
    tracing::info!(
        runtime_root = %state.runtime_root.display(),
        run_id = %run_id,
        session_key = %thread_id,
        "rust_gateway_chat_send_completed"
    );
    Ok(json!({
        "ok": true,
        "status": "completed",
        "runId": run_id,
        "sessionKey": thread_id,
        "message": payload.get("message").cloned().unwrap_or(Value::Null),
        "contextSummary": result.context_summary,
        "events": events
    }))
}

pub(super) fn read_config_value(path: &PathBuf) -> Result<Value, String> {
    match std::fs::read_to_string(path) {
        Ok(raw) => serde_json::from_str(&raw)
            .map_err(|error| format!("invalid config {}: {error}", path.display())),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(Value::Object(Map::new())),
        Err(error) => Err(format!("failed to read config {}: {error}", path.display())),
    }
}

pub(super) fn write_config_value(path: &PathBuf, value: &Value) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|error| format!("failed to create config directory: {error}"))?;
    }
    let tmp = path.with_extension("json.tmp");
    let raw = serde_json::to_string_pretty(value)
        .map_err(|error| format!("failed to serialize config: {error}"))?;
    std::fs::write(&tmp, format!("{raw}\n"))
        .map_err(|error| format!("failed to write temp config {}: {error}", tmp.display()))?;
    std::fs::rename(&tmp, path)
        .map_err(|error| format!("failed to replace config {}: {error}", path.display()))
}

pub(super) fn read_json_file(path: &std::path::Path) -> Result<Value, String> {
    let raw = std::fs::read_to_string(path)
        .map_err(|error| format!("failed to read {}: {error}", path.display()))?;
    serde_json::from_str(&raw).map_err(|error| format!("invalid JSON {}: {error}", path.display()))
}

pub(super) fn write_json_file(path: &std::path::Path, value: &Value) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|error| format!("failed to create directory {}: {error}", parent.display()))?;
    }
    let raw = serde_json::to_string_pretty(value)
        .map_err(|error| format!("failed to serialize JSON: {error}"))?;
    std::fs::write(path, format!("{raw}\n"))
        .map_err(|error| format!("failed to write {}: {error}", path.display()))
}

pub(super) fn append_jsonl(path: &std::path::Path, value: &Value) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|error| format!("failed to create directory {}: {error}", parent.display()))?;
    }
    let mut file = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
        .map_err(|error| format!("failed to open {}: {error}", path.display()))?;
    let raw = serde_json::to_string(value)
        .map_err(|error| format!("failed to serialize JSONL entry: {error}"))?;
    writeln!(file, "{raw}").map_err(|error| format!("failed to append {}: {error}", path.display()))
}

pub(super) fn safe_runtime_component_id(raw: &str, label: &str) -> Result<String, String> {
    let value = raw.trim();
    if value.is_empty()
        || value == "."
        || value == ".."
        || value.contains('/')
        || value.contains('\\')
        || value.contains("..")
    {
        return Err(format!("{label} must be a safe local identifier"));
    }
    Ok(value.to_string())
}

pub(super) fn safe_config_component_id(raw: &str, label: &str) -> Result<String, String> {
    let value = safe_runtime_component_id(raw, label)?;
    if value.contains('.') {
        return Err(format!("{label} cannot contain dots"));
    }
    Ok(value)
}

pub(super) fn merge_json(target: &mut Value, patch: Value) {
    match (target, patch) {
        (Value::Object(target), Value::Object(patch)) => {
            for (key, value) in patch {
                merge_json(target.entry(key).or_insert(Value::Null), value);
            }
        }
        (target, patch) => *target = patch,
    }
}

pub(super) fn ensure_json_object(value: &mut Value) -> &mut Map<String, Value> {
    if !value.is_object() {
        *value = Value::Object(Map::new());
    }
    value.as_object_mut().expect("object initialized")
}

pub(super) fn get_json_path<'a>(value: &'a Value, path: &str) -> Option<&'a Value> {
    let mut current = value;
    for segment in path.split('.').filter(|segment| !segment.is_empty()) {
        current = current.get(segment)?;
    }
    Some(current)
}

pub(super) fn set_json_path(value: &mut Value, path: &str, next: Value) -> Result<(), String> {
    let segments = path
        .split('.')
        .filter(|segment| !segment.trim().is_empty())
        .collect::<Vec<_>>();
    if segments.is_empty() {
        return Err("config path cannot be empty".to_string());
    }
    let mut current = value;
    for segment in &segments[..segments.len() - 1] {
        if !current.is_object() {
            *current = Value::Object(Map::new());
        }
        current = current
            .as_object_mut()
            .expect("object initialized")
            .entry((*segment).to_string())
            .or_insert_with(|| Value::Object(Map::new()));
    }
    if !current.is_object() {
        *current = Value::Object(Map::new());
    }
    current
        .as_object_mut()
        .expect("object initialized")
        .insert(segments[segments.len() - 1].to_string(), next);
    Ok(())
}

pub(super) fn delete_json_path(value: &mut Value, path: &str) -> bool {
    let segments = path
        .split('.')
        .filter(|segment| !segment.trim().is_empty())
        .collect::<Vec<_>>();
    if segments.is_empty() {
        return false;
    }
    let mut current = value;
    for segment in &segments[..segments.len() - 1] {
        let Some(next) = current.get_mut(*segment) else {
            return false;
        };
        current = next;
    }
    current
        .as_object_mut()
        .and_then(|object| object.remove(segments[segments.len() - 1]))
        .is_some()
}

pub(super) fn remove_string_from_json_array(value: &mut Value, path: &str, needle: &str) -> bool {
    let Some(array) = get_json_path(value, path).and_then(Value::as_array) else {
        return false;
    };
    if !array
        .iter()
        .any(|entry| entry.as_str().map(|entry| entry == needle).unwrap_or(false))
    {
        return false;
    }
    let next = array
        .iter()
        .filter(|entry| entry.as_str().map(|entry| entry != needle).unwrap_or(true))
        .cloned()
        .collect::<Vec<_>>();
    if next.is_empty() {
        delete_json_path(value, path)
    } else {
        set_json_path(value, path, Value::Array(next)).is_ok()
    }
}

pub(super) fn add_string_to_json_array(
    value: &mut Value,
    path: &str,
    entry: &str,
) -> Result<(), String> {
    let mut next = get_json_path(value, path)
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    if next
        .iter()
        .any(|value| value.as_str().map(|value| value == entry).unwrap_or(false))
    {
        return Ok(());
    }
    next.push(Value::String(entry.to_string()));
    set_json_path(value, path, Value::Array(next))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn agent_run_event_gateway_topic_maps_tool_use_summary() {
        let event = AgentRunEvent::ToolUseSummary {
            run_id: "run-1".to_string(),
            call_id: "call-1".to_string(),
            tool_name: "Read".to_string(),
            status: "completed".to_string(),
            is_error: false,
            read_only: true,
            duration_ms: 12,
            result_projected: true,
            result_persisted: false,
            omitted_chars: 42,
            persisted_path: None,
        };

        let (topic, payload) = agent_run_event_gateway_topic(&event).expect("gateway topic");

        assert_eq!(topic, "agent.toolUseSummary");
        assert_eq!(payload["type"], "toolUseSummary");
        assert_eq!(payload["callId"], "call-1");
        assert_eq!(payload["readOnly"], true);
        assert_eq!(payload["resultProjected"], true);
        assert_eq!(payload["omittedChars"], 42);
    }

    #[test]
    fn agent_run_event_gateway_topic_maps_permission_decision() {
        let event = AgentRunEvent::PermissionDecision {
            run_id: "run-1".to_string(),
            request_id: "call-1".to_string(),
            tool_name: "bash".to_string(),
            decision: "approved".to_string(),
            mode: "workspace".to_string(),
            category: "command".to_string(),
            reason: "Run command: printf hi".to_string(),
        };

        let (topic, payload) = agent_run_event_gateway_topic(&event).expect("gateway topic");

        assert_eq!(topic, "agent.permissionDecision");
        assert_eq!(payload["type"], "permissionDecision");
        assert_eq!(payload["requestId"], "call-1");
        assert_eq!(payload["decision"], "approved");
        assert_eq!(payload["mode"], "workspace");
        assert_eq!(payload["category"], "command");
    }
}
