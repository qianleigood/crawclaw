use super::*;

pub(super) fn sessions_list(state: &GatewayState) -> Result<Value, String> {
    let sessions = state
        .session_store
        .list_summaries()
        .map_err(|error| error.to_string())?
        .into_iter()
        .map(|session| {
            json!({
                "key": session.key,
                "label": session.title,
                "title": session.title,
                "status": session.status,
                "messageCount": session.message_count,
                "spawnedBy": session.spawned_by,
                "yielded": session.yielded,
                "pinned": session.pinned
            })
        })
        .collect::<Vec<_>>();
    Ok(json!({ "count": sessions.len(), "sessions": sessions }))
}

pub(super) fn sessions_create(state: &GatewayState, params: Value) -> Result<Value, String> {
    let key = normalize_session_key(
        &string_param(&params, &["key", "sessionKey"]).unwrap_or_else(|| "main".to_string()),
    )?;
    let label = string_param(&params, &["label", "title"]);
    let model = string_param(&params, &["model"]);
    let status = state
        .session_store
        .create_session(&key, label.as_deref(), model.as_deref())
        .map_err(|error| error.to_string())?;
    let session_file = state
        .session_store
        .session_transcript_path(&key)
        .map_err(|error| error.to_string())?;
    Ok(json!({
        "ok": true,
        "key": key,
        "sessionId": format!("rust-session-{}", now_millis()),
        "runStarted": false,
        "entry": {
            "key": status.key,
            "sessionFile": session_file.to_string_lossy(),
            "label": label.unwrap_or(status.title.clone()),
            "title": status.title,
            "model": model,
            "status": status.status
        }
    }))
}

pub(super) fn sessions_preview(state: &GatewayState, params: Value) -> Result<Value, String> {
    let keys = params
        .get("keys")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let previews = keys
        .into_iter()
        .filter_map(|value| value.as_str().map(ToOwned::to_owned))
        .map(|key| {
            let normalized = normalize_session_key(&key)?;
            let messages = state
                .session_store
                .session_history(&normalized)
                .map_err(|error| error.to_string())?;
            let items = messages
                .into_iter()
                .take(20)
                .map(|message| {
                    json!({
                        "role": message.role,
                        "text": message.content
                    })
                })
                .collect::<Vec<_>>();
            Ok(json!({ "key": normalized, "status": "ok", "items": items }))
        })
        .collect::<Result<Vec<_>, String>>()?;
    Ok(json!({ "previews": previews }))
}

pub(super) fn sessions_resolve(state: &GatewayState, params: Value) -> Result<Value, String> {
    let label = required_param(&params, &["label", "key", "sessionKey"])?;
    if let Some(key) = state
        .session_store
        .resolve_session_by_label(&label)
        .map_err(|error| error.to_string())?
    {
        return Ok(json!({ "ok": true, "key": key }));
    }
    let normalized = normalize_session_key(&label)?;
    Ok(json!({ "ok": false, "key": normalized }))
}

pub(super) fn sessions_patch(state: &GatewayState, params: Value) -> Result<Value, String> {
    let key = normalize_session_key(&required_param(&params, &["key", "sessionKey"])?)?;
    let label = string_param(&params, &["label", "title"]);
    let model = string_param(&params, &["model"]);
    let pinned = params.get("pinned").and_then(Value::as_bool);
    let status_value = string_param(&params, &["status"]);
    let status = state
        .session_store
        .patch_session(
            &key,
            label.as_deref(),
            model.as_deref(),
            pinned,
            status_value.as_deref(),
        )
        .map_err(|error| error.to_string())?;
    Ok(json!({
        "ok": true,
        "key": key,
        "entry": {
            "key": status.key,
            "label": label.unwrap_or(status.title.clone()),
            "title": status.title,
            "model": model,
            "status": status.status,
            "pinned": status.pinned
        }
    }))
}

pub(super) async fn sessions_reset(state: &GatewayState, params: Value) -> Result<Value, String> {
    let key = normalize_session_key(&required_param(&params, &["key", "sessionKey"])?)?;
    run_sdk_session_end_hooks(state, &key, "clear").await?;
    let status = state
        .session_store
        .reset_session(&key)
        .map_err(|error| error.to_string())?;
    Ok(json!({
        "ok": true,
        "key": key,
        "entry": {
            "key": status.key,
            "sessionId": format!("rust-session-{}", now_millis()),
            "label": status.title,
            "title": status.title,
            "status": status.status
        }
    }))
}

pub(super) fn sessions_delete(state: &GatewayState, params: Value) -> Result<Value, String> {
    let key = normalize_session_key(&required_param(&params, &["key", "sessionKey"])?)?;
    let deleted = state
        .session_store
        .delete_session(&key)
        .map_err(|error| error.to_string())?;
    Ok(json!({ "ok": true, "key": key, "deleted": deleted }))
}

pub(super) async fn sessions_compact(state: &GatewayState, params: Value) -> Result<Value, String> {
    let key = normalize_session_key(&required_param(&params, &["key", "sessionKey"])?)?;
    let max_lines = params
        .get("maxLines")
        .and_then(Value::as_u64)
        .unwrap_or(200) as usize;
    let trigger = string_param(&params, &["trigger"]).unwrap_or_else(|| "manual".to_string());
    run_sdk_pre_compact_hooks(state, &key, &trigger, None).await?;
    let (compacted, kept) = state
        .session_store
        .compact_session(&key, max_lines)
        .map_err(|error| error.to_string())?;
    run_sdk_post_compact_hooks(
        state,
        &key,
        &trigger,
        &format!("Compacted {compacted} messages; kept {kept}."),
    )
    .await?;
    Ok(json!({ "ok": true, "key": key, "compacted": compacted, "kept": kept }))
}

pub(super) fn sessions_messages_subscription(
    state: &GatewayState,
    params: Value,
    subscribed: bool,
) -> Result<Value, String> {
    let key = string_param(&params, &["key", "sessionKey"])
        .ok_or_else(|| "session key required".to_string())?;
    let normalized = normalize_session_key(&key)?;
    state
        .session_store
        .session_status(&normalized)
        .map_err(|error| error.to_string())?;
    Ok(json!({ "subscribed": subscribed, "key": normalized }))
}

pub(super) async fn subagents_spawn(state: &GatewayState, params: Value) -> Result<Value, String> {
    let task = required_param(&params, &["task", "message", "prompt"])?;
    let parent = string_param(&params, &["parentSessionKey", "parent", "spawnedBy"])
        .unwrap_or_else(|| "main".to_string());
    let label = string_param(
        &params,
        &[
            "label",
            "title",
            "description",
            "subagent_type",
            "subagentType",
        ],
    );
    let tool_alias = string_param(&params, &["toolAlias"]);
    let agent_type = string_param(
        &params,
        &["subagent_type", "subagentType", "agentType", "agentId"],
    )
    .or_else(|| label.clone())
    .unwrap_or_else(|| "general-purpose".to_string());
    let session = state
        .session_store
        .spawn_session(Some(&parent), label.as_deref(), &task)
        .map_err(|error| error.to_string())?;
    emit(
        state,
        "sessionStarted",
        json!({ "session": session.clone() }),
    );
    emit(
        state,
        "sessions.changed",
        json!({ "session": session.clone() }),
    );

    if params.get("run").and_then(Value::as_bool) == Some(false) {
        return Ok(json!({
            "ok": true,
            "status": "spawned",
            "implementation": "rust-native",
            "sessionKey": session.key,
            "session": session
        }));
    }

    let mut run_params = params.clone();
    let run_object = ensure_json_object(&mut run_params);
    run_object.insert("sessionKey".to_string(), Value::String(session.key.clone()));
    run_object.insert("message".to_string(), Value::String(task.clone()));
    run_object.insert("channel".to_string(), Value::String("subagent".to_string()));
    if !run_object.contains_key("agentId") {
        if let Some(agent_type) = string_param(&params, &["subagent_type", "subagentType"]) {
            run_object.insert("agentId".to_string(), Value::String(agent_type));
        }
    }
    run_object.insert(
        "profile".to_string(),
        json!({
            "kind": "subagent",
            "memoryAfterTurn": true
        }),
    );
    run_object.insert(
        "idempotencyKey".to_string(),
        Value::String(
            string_param(&params, &["idempotencyKey", "runId"])
                .unwrap_or_else(|| format!("subagent-run-{}", now_millis())),
        ),
    );
    let start_context =
        run_sdk_subagent_start_hooks(state, &parent, &session.key, &agent_type).await?;
    append_subagent_start_context(&mut run_params, start_context);

    if params
        .get("run_in_background")
        .and_then(Value::as_bool)
        .unwrap_or(false)
    {
        let background_state = state.clone();
        let parent_session_key = parent.clone();
        let session_key = session.key.clone();
        let background_agent_type = agent_type.clone();
        let description = label.clone().unwrap_or_else(|| session.title.clone());
        let task_session_key = session_key.clone();
        let background_task = tokio::spawn(async move {
            match background_state.session_store.patch_session(
                &task_session_key,
                None,
                None,
                None,
                Some("running"),
            ) {
                Ok(running_session) => emit(
                    &background_state,
                    "sessions.changed",
                    json!({ "session": running_session }),
                ),
                Err(_) => {
                    let _ =
                        unregister_agent_task_abort_handle(&background_state, &task_session_key);
                    return;
                }
            }
            match execute_agent_run_turn(&background_state, &run_params, "rust-subagent").await {
                Ok(result) => {
                    let _ = run_sdk_subagent_stop_hooks(
                        &background_state,
                        &parent_session_key,
                        &task_session_key,
                        &background_agent_type,
                        Some(&result.assistant_text),
                    )
                    .await;
                    if let Ok(completed_session) = background_state.session_store.patch_session(
                        &task_session_key,
                        None,
                        None,
                        None,
                        Some("completed"),
                    ) {
                        emit(
                            &background_state,
                            "sessions.changed",
                            json!({ "session": completed_session }),
                        );
                    }
                }
                Err(_) => {
                    let _ = run_sdk_subagent_stop_hooks(
                        &background_state,
                        &parent_session_key,
                        &task_session_key,
                        &background_agent_type,
                        None,
                    )
                    .await;
                    if let Ok(failed_session) = background_state.session_store.patch_session(
                        &task_session_key,
                        None,
                        None,
                        None,
                        Some("failed"),
                    ) {
                        emit(
                            &background_state,
                            "sessions.changed",
                            json!({ "session": failed_session }),
                        );
                    }
                }
            }
            let _ = unregister_agent_task_abort_handle(&background_state, &task_session_key);
        });
        register_agent_task_abort_handle(state, &session_key, background_task.abort_handle())?;
        return Ok(json!({
            "ok": true,
            "status": "async_launched",
            "implementation": "rust-native",
            "agentId": session.key.clone(),
            "description": description,
            "prompt": task,
            "outputFile": format!("sessions/{}.jsonl", session.key),
            "canReadOutputFile": true,
            "sessionKey": session.key.clone(),
            "session": session
        }));
    }

    let running_session = state
        .session_store
        .patch_session(&session.key, None, None, None, Some("running"))
        .map_err(|error| error.to_string())?;
    emit(
        state,
        "sessions.changed",
        json!({ "session": running_session.clone() }),
    );

    let result = match execute_agent_run_turn(state, &run_params, "rust-subagent").await {
        Ok(result) => result,
        Err(error) => {
            let failed_session = state
                .session_store
                .patch_session(&session.key, None, None, None, Some("failed"))
                .map_err(|patch_error| patch_error.to_string())?;
            let _ =
                run_sdk_subagent_stop_hooks(state, &parent, &session.key, &agent_type, None).await;
            emit(
                state,
                "sessions.changed",
                json!({ "session": failed_session }),
            );
            return Err(error);
        }
    };
    run_sdk_subagent_stop_hooks(
        state,
        &parent,
        &session.key,
        &agent_type,
        Some(&result.assistant_text),
    )
    .await?;
    let completed_session = state
        .session_store
        .patch_session(&session.key, None, None, None, Some("completed"))
        .map_err(|error| error.to_string())?;
    emit(
        state,
        "sessions.changed",
        json!({ "session": completed_session.clone() }),
    );
    let events = agent_run_events_value(&result.events)?;
    if tool_alias
        .as_deref()
        .is_some_and(|alias| alias == "Agent" || alias == "Task")
    {
        return Ok(json!({
            "ok": true,
            "status": "completed",
            "implementation": "rust-native",
            "prompt": task,
            "agentId": completed_session.key.clone(),
            "agentType": string_param(&params, &["subagent_type", "subagentType", "agentType"]),
            "content": [{
                "type": "text",
                "text": result.assistant_text.clone()
            }],
            "totalToolUseCount": result.events.iter().filter(|event| matches!(event, AgentRunEvent::ToolCall { .. })).count(),
            "totalDurationMs": 0,
            "totalTokens": result.context_summary.estimated_tokens,
            "usage": {
                "input_tokens": result.context_summary.estimated_tokens,
                "output_tokens": 0,
                "cache_creation_input_tokens": null,
                "cache_read_input_tokens": null,
                "server_tool_use": null,
                "service_tier": null,
                "cache_creation": null
            },
            "sessionKey": result.session_key.clone(),
            "session": completed_session,
            "runId": result.run_id.clone(),
            "events": events
        }));
    }
    Ok(json!({
        "ok": true,
        "status": "completed",
        "implementation": "rust-native",
        "sessionKey": result.session_key,
        "session": completed_session,
        "runId": result.run_id,
        "assistantText": result.assistant_text,
        "events": events
    }))
}

fn append_subagent_start_context(params: &mut Value, contexts: Vec<String>) {
    let context = contexts
        .into_iter()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .collect::<Vec<_>>()
        .join("\n\n");
    if context.is_empty() {
        return;
    }
    let object = ensure_json_object(params);
    let message = object
        .get("message")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let next = if message.trim().is_empty() {
        context
    } else {
        format!("{message}\n\n{context}")
    };
    object.insert("message".to_string(), Value::String(next));
}

pub(super) async fn subagents_control(
    state: &GatewayState,
    params: Value,
) -> Result<Value, String> {
    let action = required_param(&params, &["action", "command"])?;
    match action.as_str() {
        "list" | "status" => {
            let parent = string_param(&params, &["parentSessionKey", "parent", "spawnedBy"]);
            Ok(json!({
                "ok": true,
                "status": "ok",
                "implementation": "rust-native",
                "subagents": state.session_store.list_subagents(parent.as_deref()).map_err(|error| error.to_string())?
            }))
        }
        "kill" | "cancel" | "stop" => {
            let key = resolve_existing_session_key(
                state,
                &required_param(&params, &["sessionKey", "key"])?,
            )?;
            let status = state
                .session_store
                .patch_session(&key, None, None, None, Some("killed"))
                .map_err(|error| error.to_string())?;
            emit(
                state,
                "sessions.changed",
                json!({ "session": status.clone() }),
            );
            Ok(json!({
                "ok": true,
                "status": "killed",
                "implementation": "rust-native",
                "sessionKey": key,
                "session": status
            }))
        }
        "killAll" | "kill_all" | "cancelAll" | "cancel_all" => {
            let parent = string_param(&params, &["parentSessionKey", "parent", "spawnedBy"]);
            let sessions = state
                .session_store
                .list_subagents(parent.as_deref())
                .map_err(|error| error.to_string())?;
            let mut killed = Vec::new();
            for session in sessions {
                if matches!(session.status.as_str(), "done" | "completed" | "killed") {
                    continue;
                }
                let status = state
                    .session_store
                    .patch_session(&session.key, None, None, None, Some("killed"))
                    .map_err(|error| error.to_string())?;
                emit(
                    state,
                    "sessions.changed",
                    json!({ "session": status.clone() }),
                );
                killed.push(json!({ "key": status.key, "status": status.status }));
            }
            Ok(json!({
                "ok": true,
                "status": "killed",
                "implementation": "rust-native",
                "killed": killed
            }))
        }
        "send" | "steer" => {
            let key = resolve_existing_session_key(
                state,
                &required_param(&params, &["sessionKey", "key"])?,
            )?;
            let message = required_param(&params, &["message", "text"])?;
            let mut run_params = params.clone();
            let run_object = ensure_json_object(&mut run_params);
            run_object.insert("sessionKey".to_string(), Value::String(key));
            run_object.insert("message".to_string(), Value::String(message));
            run_object.insert(
                "channel".to_string(),
                Value::String("subagent-control".to_string()),
            );
            run_object.insert(
                "idempotencyKey".to_string(),
                Value::String(
                    string_param(&params, &["idempotencyKey", "runId"])
                        .unwrap_or_else(|| format!("subagent-control-{}", now_millis())),
                ),
            );
            let result =
                execute_agent_run_turn(state, &run_params, "rust-subagent-control").await?;
            let events = agent_run_events_value(&result.events)?;
            Ok(json!({
                "ok": true,
                "status": "accepted",
                "implementation": "rust-native",
                "sessionKey": result.session_key,
                "runId": result.run_id,
                "assistantText": result.assistant_text,
                "events": events
            }))
        }
        other => Err(format!("Unsupported Rust subagent control action: {other}")),
    }
}

pub(super) async fn subagents_announce(
    state: &GatewayState,
    params: Value,
) -> Result<Value, String> {
    let child_session_key = resolve_existing_session_key(
        state,
        &required_param(&params, &["childSessionKey", "sessionKey", "key"])?,
    )?;
    let requester_session_key = resolve_existing_session_key(
        state,
        &required_param(&params, &["requesterSessionKey", "parentSessionKey"])?,
    )?;
    let findings = string_param(&params, &["findings", "message", "text"])
        .unwrap_or_else(|| "Subagent completed.".to_string());
    let announce_type = string_param(&params, &["announceType", "type"])
        .unwrap_or_else(|| "subagent task".to_string());
    let message = format!("Completed {announce_type} from {child_session_key}:\n\n{findings}");

    let mut run_params = params.clone();
    let run_object = ensure_json_object(&mut run_params);
    run_object.insert(
        "sessionKey".to_string(),
        Value::String(requester_session_key.clone()),
    );
    run_object.insert("message".to_string(), Value::String(message));
    run_object.insert(
        "channel".to_string(),
        Value::String("subagent-announce".to_string()),
    );
    run_object.insert(
        "idempotencyKey".to_string(),
        Value::String(
            string_param(&params, &["announceId", "idempotencyKey", "runId"])
                .unwrap_or_else(|| format!("subagent-announce-{}", now_millis())),
        ),
    );

    let result = execute_agent_run_turn(state, &run_params, "rust-subagent-announce").await?;
    if params
        .get("cleanup")
        .and_then(Value::as_str)
        .is_some_and(|cleanup| cleanup == "delete")
    {
        let _ = state.session_store.delete_session(&child_session_key);
    } else {
        let _ =
            state
                .session_store
                .patch_session(&child_session_key, None, None, None, Some("done"));
    }
    let events = agent_run_events_value(&result.events)?;
    Ok(json!({
        "ok": true,
        "status": "announced",
        "implementation": "rust-native",
        "childSessionKey": child_session_key,
        "requesterSessionKey": requester_session_key,
        "runId": result.run_id,
        "assistantText": result.assistant_text,
        "events": events
    }))
}

pub(super) fn acp_session_list(state: &GatewayState, params: Value) -> Result<Value, String> {
    let limit = params
        .get("limit")
        .and_then(Value::as_u64)
        .unwrap_or(100)
        .min(1000) as usize;
    let sessions = state
        .session_store
        .list_summaries()
        .map_err(|error| error.to_string())?
        .into_iter()
        .take(limit)
        .map(|session| {
            json!({
                "id": session.key,
                "sessionId": session.key,
                "key": session.key,
                "title": session.title,
                "status": session.status,
                "messageCount": session.message_count,
                "spawnedBy": session.spawned_by
            })
        })
        .collect::<Vec<_>>();
    Ok(json!({
        "ok": true,
        "implementation": "rust-native",
        "sessions": sessions
    }))
}

pub(super) fn acp_session_new(state: &GatewayState, params: Value) -> Result<Value, String> {
    let key = normalize_session_key(
        &string_param(&params, &["sessionKey", "key", "sessionId"])
            .unwrap_or_else(|| format!("acp:{}", now_millis())),
    )?;
    let label = string_param(&params, &["label", "title"]).unwrap_or_else(|| format!("ACP {key}"));
    let model = string_param(&params, &["model"]);
    let status = state
        .session_store
        .create_session(&key, Some(&label), model.as_deref())
        .map_err(|error| error.to_string())?;
    Ok(json!({
        "ok": true,
        "implementation": "rust-native",
        "sessionId": key,
        "sessionKey": status.key,
        "session": status
    }))
}

pub(super) fn acp_session_load(state: &GatewayState, params: Value) -> Result<Value, String> {
    let key = resolve_existing_session_key(
        state,
        &required_param(&params, &["sessionKey", "key", "sessionId"])?,
    )?;
    let status = state
        .session_store
        .session_status(&key)
        .map_err(|error| error.to_string())?
        .ok_or_else(|| format!("ACP session not found: {key}"))?;
    let messages = state
        .session_store
        .session_history(&key)
        .map_err(|error| error.to_string())?;
    Ok(json!({
        "ok": true,
        "implementation": "rust-native",
        "sessionId": key,
        "sessionKey": status.key,
        "session": status,
        "messages": messages
    }))
}

pub(super) fn acp_session_patch(state: &GatewayState, params: Value) -> Result<Value, String> {
    let key = resolve_existing_session_key(
        state,
        &required_param(&params, &["sessionKey", "key", "sessionId"])?,
    )?;
    let status = state
        .session_store
        .patch_session(
            &key,
            string_param(&params, &["label", "title"]).as_deref(),
            string_param(&params, &["model"]).as_deref(),
            params.get("pinned").and_then(Value::as_bool),
            string_param(&params, &["status", "mode"]).as_deref(),
        )
        .map_err(|error| error.to_string())?;
    Ok(json!({
        "ok": true,
        "implementation": "rust-native",
        "sessionId": key,
        "session": status
    }))
}

pub(super) async fn acp_session_prompt(
    state: &GatewayState,
    params: Value,
) -> Result<Value, String> {
    let key = resolve_existing_session_key(
        state,
        &required_param(&params, &["sessionKey", "key", "sessionId"])?,
    )?;
    let prompt = required_param(&params, &["prompt", "message", "text"])?;
    let mut run_params = params.clone();
    let run_object = ensure_json_object(&mut run_params);
    run_object.insert("sessionKey".to_string(), Value::String(key.clone()));
    run_object.insert("message".to_string(), Value::String(prompt));
    run_object.insert("channel".to_string(), Value::String("acp".to_string()));
    run_object.insert(
        "idempotencyKey".to_string(),
        Value::String(
            string_param(&params, &["idempotencyKey", "runId"])
                .unwrap_or_else(|| format!("acp-prompt-{}", now_millis())),
        ),
    );
    let result = execute_agent_run_turn(state, &run_params, "rust-acp").await?;
    let events = agent_run_events_value(&result.events)?;
    Ok(json!({
        "ok": true,
        "status": "completed",
        "implementation": "rust-native",
        "sessionId": key,
        "sessionKey": result.session_key,
        "runId": result.run_id,
        "assistantText": result.assistant_text,
        "events": events
    }))
}

pub(super) fn acp_session_cancel(state: &GatewayState, params: Value) -> Result<Value, String> {
    let key = resolve_existing_session_key(
        state,
        &required_param(&params, &["sessionKey", "key", "sessionId"])?,
    )?;
    let status = state
        .session_store
        .patch_session(&key, None, None, None, Some("killed"))
        .map_err(|error| error.to_string())?;
    Ok(json!({
        "ok": true,
        "status": "cancelled",
        "implementation": "rust-native",
        "sessionId": key,
        "session": status
    }))
}

pub(super) fn acp_session_close(state: &GatewayState, params: Value) -> Result<Value, String> {
    let key = resolve_existing_session_key(
        state,
        &required_param(&params, &["sessionKey", "key", "sessionId"])?,
    )?;
    let deleted = if params
        .get("delete")
        .and_then(Value::as_bool)
        .unwrap_or(false)
    {
        state
            .session_store
            .delete_session(&key)
            .map_err(|error| error.to_string())?
    } else {
        let _ = state
            .session_store
            .patch_session(&key, None, None, None, Some("closed"));
        false
    };
    Ok(json!({
        "ok": true,
        "status": "closed",
        "implementation": "rust-native",
        "sessionId": key,
        "deleted": deleted
    }))
}

pub(super) fn normalize_session_key(input: &str) -> Result<String, String> {
    let value = input.trim();
    if value.is_empty() {
        return Err("session key cannot be empty".to_string());
    }
    if value.contains('/') || value.contains('\\') || value == "." || value == ".." {
        return Err(format!("invalid session key: {input}"));
    }
    if value.starts_with("agent:") {
        Ok(value.to_string())
    } else {
        Ok(format!("agent:main:{value}"))
    }
}

pub(super) fn resolve_existing_session_key(
    state: &GatewayState,
    input: &str,
) -> Result<String, String> {
    let raw = input.trim();
    if raw.is_empty() {
        return Err("session key cannot be empty".to_string());
    }
    if state
        .session_store
        .session_status(raw)
        .map_err(|error| error.to_string())?
        .is_some()
    {
        return Ok(raw.to_string());
    }
    normalize_session_key(raw)
}
