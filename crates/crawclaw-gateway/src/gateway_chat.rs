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
    let request = build_agent_run_request(params, run_id, session_key)?;
    let result = state
        .agent_runtime
        .run_turn(request)
        .await
        .map_err(|error| error.message().to_string())?;
    record_agent_run_events(state, &result)?;
    Ok(result)
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
        let message = required_param(params, &["message", "text"])?;
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
            metadata: BTreeMap::new(),
        }
    };

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
        enabled_tools: Vec::new(),
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
    options
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
    Ok(())
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
    let session_key = request
        .parent_session_key
        .clone()
        .unwrap_or_else(|| format!("special:{kind}:{run_id}"));
    let scope = request.scope.clone().unwrap_or_else(|| "main".to_string());
    let task = request.task.unwrap_or_default();
    let mut options = BTreeMap::new();
    options.insert(
        "specialAgent".to_string(),
        json!({
            "kind": kind,
            "spawnSource": definition.spawn_source,
            "executionMode": definition.execution_mode,
            "transcriptPolicy": definition.transcript_policy,
            "parentContextPolicy": definition.parent_context_policy,
            "timeoutSeconds": definition.timeout_seconds,
            "maxTurns": definition.max_turns
        }),
    );
    if definition.guard == Some(SpecialAgentToolGuard::MemoryMaintenance) {
        options.insert("memoryAfterTurn".to_string(), json!(false));
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
            metadata: BTreeMap::new(),
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
        options,
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
            "memory": memory,
            "implementation": "rust-native"
        }
    });
    emit(
        state,
        "specialAgent.result",
        json!({ "kind": kind, "result": response["result"].clone() }),
    );
    Ok(response)
}

pub(super) fn persist_special_agent_memory_result(
    state: &GatewayState,
    kind: &str,
    scope: &str,
    assistant_text: &str,
) -> Result<Value, String> {
    let runtime = memory_runtime(state);
    match kind {
        "dream" => runtime.dream_store().run(scope, assistant_text),
        "session-summary" => runtime
            .session_summary_store()
            .refresh(scope, assistant_text),
        "experience" => runtime.experience_store().write_note(
            scope,
            "special-agent",
            assistant_text,
            "rust-agent-runtime",
        ),
        "durable-memory" => runtime.durable_index_list(scope, 100),
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
    let thread_id = result.session_key;
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
