use super::*;

pub(super) async fn rpc(
    State(state): State<GatewayState>,
    headers: HeaderMap,
    Json(request): Json<GatewayRpcRequest>,
) -> Result<Json<GatewayRpcResponse>, StatusCode> {
    authorize_headers(&headers, &state)?;
    let id = request.id.clone();
    match handle_gateway_method(&state, &request.method, request.params).await {
        Ok(result) => Ok(Json(GatewayRpcResponse {
            ok: true,
            id,
            result: Some(result),
            error: None,
        })),
        Err(error) => Ok(Json(GatewayRpcResponse {
            ok: false,
            id,
            result: None,
            error: Some(error),
        })),
    }
}

pub(super) fn handle_gateway_method<'a>(
    state: &'a GatewayState,
    method: &'a str,
    params: Value,
) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<Value, String>> + Send + 'a>> {
    if is_gateway_workflow_method(method) {
        return Box::pin(std::future::ready(handle_gateway_workflow_method(
            state, method, params,
        )));
    }
    Box::pin(handle_gateway_method_inner(state, method, params))
}

fn is_gateway_workflow_method(method: &str) -> bool {
    matches!(
        method,
        "workflow.list"
            | "workflow.match"
            | "workflow.runs"
            | "workflow.get"
            | "workflow.n8n.get"
            | "workflow.enable"
            | "workflow.disable"
            | "workflow.archive"
            | "workflow.unarchive"
            | "workflow.delete"
            | "workflow.deploy"
            | "workflow.run"
            | "workflow.status"
            | "workflow.cancel"
            | "workflow.resume"
            | "workflow.agent.run"
    )
}

fn handle_gateway_workflow_method(
    state: &GatewayState,
    method: &str,
    params: Value,
) -> Result<Value, String> {
    match method {
        "workflow.list" => workflow_list(state, params),
        "workflow.match" => workflow_match(state, params),
        "workflow.runs" => workflow_runs(state, params),
        "workflow.get" | "workflow.n8n.get" => workflow_get(state, params),
        "workflow.enable" | "workflow.disable" | "workflow.archive" | "workflow.unarchive"
        | "workflow.delete" | "workflow.deploy" => workflow_mutation(state, method, params),
        "workflow.run" => workflow_run(state, params),
        "workflow.status" | "workflow.cancel" | "workflow.resume" => {
            workflow_execution_action(state, method, params)
        }
        "workflow.agent.run" => workflow_agent_run(state, params),
        _ => Err(format!("unsupported method: {method}")),
    }
}

async fn handle_gateway_method_inner(
    state: &GatewayState,
    method: &str,
    params: Value,
) -> Result<Value, String> {
    match method {
        "health" | "status" | "system.status" | "system.health" => Ok(json!({
            "runtime": "rust",
            "status": "ok",
            "implementation": "rust-native",
            "gatewayMethods": gateway_methods()
        })),
        "config.get" => config_get(state, params),
        "config.set" => config_set(state, params),
        "config.apply" => config_apply(state, params),
        "config.patch" => config_patch(state, params),
        "config.schema" => config_schema(),
        "config.schema.lookup" => config_schema_lookup(params),
        "secrets.reload" => secrets_reload(state),
        "secrets.resolve" => secrets_resolve(state, params),
        "tools.catalog" => Ok(tools_catalog(state, params)),
        "tools.effective" => Ok(tools_effective(state, params)),
        "tools.invoke" => tools_invoke(state, params).await,
        "message.policy" | "message_policy" => message_policy(params),
        "nativePlugin.invoke" | "native_plugin_invoke" => native_plugin_invoke(state, params).await,
        "nativePlugin.service.start" | "native_plugin_service_start" => {
            native_plugin_service_lifecycle(state, params, true).await
        }
        "nativePlugin.service.stop" | "native_plugin_service_stop" => {
            native_plugin_service_lifecycle(state, params, false).await
        }
        "models.list" => Ok(models_list(state)),
        "agents.list" => Ok(agents_list(state)),
        "logs.tail" => Ok(logs_tail()),
        "usage.status" => Ok(usage_status(state)),
        "usage.cost" => usage_cost(state, params),
        "doctor.memory.status" => doctor_memory_status(state),
        "agentRuntime.summary" => agent_runtime_summary(state, params),
        "agentRuntime.list" => agent_runtime_list(state, params),
        "agentRuntime.get" => agent_runtime_get(state, params),
        "agentRuntime.cancel" => agent_runtime_cancel(state, params),
        "agent.identity.get" => Ok(agent_identity(state)),
        "agent.inspect" => agent_inspect(state, params),
        "agent.observations.list" => agent_observations_list(state, params),
        "agent.wait" => agent_wait(state, params),
        "agents.create" => agents_create(state, params),
        "agents.update" => agents_update(state, params),
        "agents.delete" => agents_delete(state, params),
        "agents.files.list" => agents_files_list(state, params),
        "agents.files.get" => agents_files_get(state, params),
        "agents.files.set" => agents_files_set(state, params),
        "skills.status" => Ok(skills_status(state, params)),
        "skills.bins" => Ok(skills_bins(state)),
        "skills.install" => skills_install(state, params),
        "skills.update" => skills_update(state, params),
        "plugins.list" => plugins_list(state),
        "plugins.enable" => plugins_set_enabled(state, params, true),
        "plugins.disable" => plugins_set_enabled(state, params, false),
        "plugins.install" => plugins_install(state, params),
        "plugins.update" => plugins_update(state, params),
        "plugins.uninstall" => plugins_uninstall(state, params),
        "exec.approvals.get" => approvals_snapshot(state, "exec"),
        "exec.approvals.set" => approvals_set(state, params, "exec"),
        "exec.approval.request" => approval_request(state, params, "exec.approval"),
        "exec.approval.waitDecision" => approval_wait_decision(state, params),
        "exec.approval.resolve" => approval_resolve(state, params, "exec.approval"),
        "plugin.approval.request" => approval_request(state, params, "plugin.approval"),
        "plugin.approval.waitDecision" => approval_wait_decision(state, params),
        "plugin.approval.resolve" => approval_resolve(state, params, "plugin.approval"),
        "channels.status" => channels_status(state),
        "channels.capabilities" => channels_capabilities(params),
        "channels.setup.surface" => channels_setup_surface(state, params),
        "channels.config.get" => channels_config_get(state, params),
        "channels.config.schema" => Ok(channels_config_schema()),
        "channels.config.patch" => channels_config_patch(state, params),
        "channels.config.apply" => channels_config_apply(state, params),
        "channels.logout"
        | "channels.account.logout"
        | "channels.account.reconnect"
        | "channels.account.verify"
        | "channels.account.login.start"
        | "channels.account.login.wait"
        | "channels.login.start"
        | "channels.login.wait" => channel_action(state, method, params),
        "tts.status" => Ok(tts_status(state)),
        "tts.providers" => Ok(tts_providers(state)),
        "tts.enable" => tts_set_enabled(state, true),
        "tts.disable" => tts_set_enabled(state, false),
        "tts.setProvider" => tts_set_provider(state, params),
        "tts.convert" => tts_convert(state, params).await,
        "talk.config" => talk_config(state),
        "talk.mode" => talk_mode(state, params),
        "talk.speak" => talk_speak(state, params).await,
        "voice.getOverview" => Ok(voice_overview(state)),
        "voice.qwen3Tts.preview" | "voice.qwen3Tts.uploadReferenceAudio" => {
            voice_qwen3_tts(state, method, params).await
        }
        "voicewake.get" => Ok(voicewake_get(state)),
        "voicewake.set" => voicewake_set(state, params),
        "update.run" => update_run(state, params),
        "last-main-session-wake" | "system.mainSessionWake.last" => main_session_wake_last(state),
        "gateway.identity.get" => gateway_identity_get(state),
        "system-presence" => system_presence(state),
        "system-event" => system_event(state, params),
        "send" => channel_send(state, params),
        "channel.outbound.send" => channel_send(state, params),
        "poll" => channel_poll(state, params),
        "channel.outbound.poll" => channel_poll(state, params),
        "channel.outbound.action" => channel_outbound_action(state, params),
        "channel.inbound.handle" => channel_inbound_handle(state, params).await,
        "channel.directory.lookup" => channel_directory_lookup(params),
        "channel.lifecycle.status" => channel_lifecycle_status(state),
        "channel.lifecycle.start" | "channel.lifecycle.stop" | "channel.lifecycle.restart" => {
            channel_lifecycle_action(state, method, params)
        }
        "esp32.status.get" => esp32_status_get(state),
        "esp32.pairing.start" => esp32_pairing_start(state, params),
        "esp32.pairing.requests.list" => esp32_pairing_requests_list(state),
        "esp32.pairing.request.approve" => esp32_pairing_request_approve(state, params),
        "esp32.pairing.request.reject" => esp32_pairing_request_reject(state, params),
        "esp32.pairing.session.revoke" => esp32_pairing_session_revoke(state, params),
        "esp32.devices.list" => esp32_devices_list(state),
        "esp32.devices.get" => esp32_device_get(state, params),
        "esp32.devices.revoke" => esp32_devices_revoke(state, params),
        "esp32.devices.command.send" => esp32_device_command_send(state, params),
        "agent.runTurn" => agent_run_turn(state, params).await,
        "agent.command.run" | "agent_command_run" => agent_command_run(state, params).await,
        "autoReply.run" | "auto_reply.run" | "auto_reply_run" => {
            auto_reply_run(state, params).await
        }
        "autoReply.command" | "auto_reply.command" | "auto_reply_command" => {
            auto_reply_command(state, params).await
        }
        "agent.streamEvents" => agent_stream_events(state, params),
        "agent.cancel" => chat_abort(params),
        "chat.history" => chat_history(state, params),
        "chat.inject" => chat_inject(state, params),
        "chat.abort" => chat_abort(params),
        "chat.send" => chat_send(state, params).await,
        "wake" | "cron.start" | "cron.stop" | "cron.status" | "cron.list" | "cron.add"
        | "cron.update" | "cron.remove" | "cron.run" | "cron.runs" => {
            let wake_text = if method == "wake" {
                Some(
                    string_param(&params, &["text", "message"])
                        .unwrap_or_else(|| "cron wake".to_string()),
                )
            } else {
                None
            };
            let result = state.cron.handle_method(method, params).await?;
            if let Some(text) = wake_text {
                record_main_session_wake_event(state, &text, &result)?;
            }
            emit(state, "cron", result.clone());
            Ok(result)
        }
        "special_agents.list" | "special_agents_list" => Ok(json!({
            "status": "ok",
            "agents": special_agent_definitions()
        })),
        "special_agents.run" | "special_agents_run" => special_agent_run(state, params).await,
        "review_task" => {
            let task = required_param(&params, &["task", "message"])?;
            let quality = string_param(&params, &["stage", "kind"])
                .map(|stage| stage != "spec")
                .unwrap_or(true);
            let kind = if quality {
                "review-quality"
            } else {
                "review-spec"
            };
            let definition = find_special_agent(kind)
                .ok_or_else(|| format!("unknown special agent kind: {kind}"))?;
            special_agent_run_with_agent_runtime(
                state,
                SpecialAgentRunRequest {
                    kind: Some(kind.to_string()),
                    spawn_source: None,
                    task: Some(task),
                    scope: None,
                    parent_session_key: string_param(&params, &["parentSessionKey", "sessionKey"]),
                },
                definition,
            )
            .await
        }
        "memory.status" | "memory_status" => memory_runtime(state).status(),
        "memory.refresh" | "memory_refresh" => Ok(json!({
            "status": "ok",
            "provider": memory_runtime(state).refresh_notebooklm()?
        })),
        "memory.login" | "memory_login" => Ok(json!({
            "status": "ok",
            "provider": memory_runtime(state).login_notebooklm()?
        })),
        "memory.sync"
        | "memory_sync"
        | "memory.experience.sync.flush"
        | "memory_experience_sync_flush" => memory_runtime(state).sync_experience_outbox(),
        "memory.admin.overview" | "memory_admin_overview" => {
            let runtime = memory_runtime(state);
            Ok(json!({
                "status": "ok",
                "implementation": "rust-native",
                "runtime": runtime.info(),
                "memory": runtime.status()?,
                "dream": runtime.dream_store().status()?,
                "experience": {
                    "entries": runtime.experience_store().list()?
                }
            }))
        }
        "memory.durable.index.list" | "memory_durable_index_list" => {
            let scope =
                string_param(&params, &["scope", "agentId"]).unwrap_or_else(|| "main".to_string());
            let limit = params
                .get("limit")
                .and_then(Value::as_u64)
                .unwrap_or(50)
                .min(500) as usize;
            memory_runtime(state).durable_index_list(&scope, limit)
        }
        "memory.durable.index.get" | "memory_durable_index_get" => {
            let scope =
                string_param(&params, &["scope", "agentId"]).unwrap_or_else(|| "main".to_string());
            let id = required_param(&params, &["id", "notePath", "path"])?;
            memory_runtime(state).durable_index_get(&scope, &id)
        }
        "memory.dream.status" | "memory_dream_status" => {
            memory_runtime(state).dream_store().status()
        }
        "memory.dream.history" | "memory_dream_history" => Ok(json!({
            "status": "ok",
            "history": memory_runtime(state).dream_store().history()?
        })),
        "memory.dream.run" | "memory_dream_run" => {
            let scope =
                string_param(&params, &["scope", "agentId"]).unwrap_or_else(|| "main".to_string());
            let task = string_param(&params, &["task", "message"]).unwrap_or_default();
            let definition = find_special_agent("dream")
                .ok_or_else(|| "missing dream special agent".to_string())?;
            special_agent_run_with_agent_runtime(
                state,
                SpecialAgentRunRequest {
                    kind: Some("dream".to_string()),
                    spawn_source: None,
                    task: Some(task),
                    scope: Some(scope),
                    parent_session_key: None,
                },
                definition,
            )
            .await
        }
        "memory.session_summary.status"
        | "memory_session_summary_status"
        | "memory.sessionSummary.status" => {
            let scope = string_param(&params, &["scope", "agentId", "sessionKey"])
                .or_else(|| string_param(&params, &["sessionId"]))
                .unwrap_or_else(|| "main".to_string());
            memory_runtime(state).session_summary_store().status(&scope)
        }
        "memory.session_summary.refresh"
        | "memory_session_summary_refresh"
        | "memory.sessionSummary.refresh" => {
            let scope = string_param(&params, &["scope", "agentId", "sessionKey"])
                .or_else(|| string_param(&params, &["sessionId"]))
                .unwrap_or_else(|| "main".to_string());
            let content =
                string_param(&params, &["content", "summary", "message"]).unwrap_or_default();
            let definition = find_special_agent("session-summary")
                .ok_or_else(|| "missing session-summary special agent".to_string())?;
            special_agent_run_with_agent_runtime(
                state,
                SpecialAgentRunRequest {
                    kind: Some("session-summary".to_string()),
                    spawn_source: None,
                    task: Some(content),
                    scope: Some(scope),
                    parent_session_key: None,
                },
                definition,
            )
            .await
        }
        "memory.experience.outbox.list" | "memory_experience_outbox_list" => Ok(json!({
            "status": "ok",
            "entries": memory_runtime(state).experience_store().list()?
        })),
        "memory.experience.outbox.updateStatus" | "memory_experience_outbox_update_status" => {
            let entry_id = required_param(&params, &["id", "entryId"])?;
            let status = required_param(&params, &["status"])?;
            memory_runtime(state)
                .experience_store()
                .update_status(&entry_id, &status)
        }
        "memory.experience.outbox.prune" | "memory_experience_outbox_prune" => {
            memory_runtime(state).experience_store().prune()
        }
        "memory.promptJournal.summary" | "memory_prompt_journal_summary" => {
            memory_prompt_journal_summary(state, params)
        }
        "memory.bootstrap" | "memory_bootstrap" => {
            let session_id = required_param(&params, &["sessionId"])?;
            let session_key = string_param(&params, &["sessionKey"]);
            memory_runtime(state).bootstrap(&session_id, session_key.as_deref())
        }
        "memory.ingestBatch" | "memory_ingest_batch" => {
            let session_id = required_param(&params, &["sessionId"])?;
            let session_key = string_param(&params, &["sessionKey"]);
            let messages = params
                .get("messages")
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default();
            memory_runtime(state).ingest_batch(&session_id, session_key.as_deref(), &messages)
        }
        "memory.assemble" | "memory_assemble" => {
            let session_id = required_param(&params, &["sessionId"])?;
            let messages = params
                .get("messages")
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default();
            let prompt = string_param(&params, &["prompt"]);
            memory_runtime(state).assemble(&session_id, messages, prompt.as_deref())
        }
        "memory.compact" | "memory_compact" => {
            let session_id = required_param(&params, &["sessionId"])?;
            let force = params
                .get("force")
                .and_then(Value::as_bool)
                .unwrap_or(false);
            memory_compact_with_agent_runtime(state, &session_id, force).await
        }
        "memory.afterTurn" | "memory_after_turn" => {
            let session_id = required_param(&params, &["sessionId"])?;
            let session_key = string_param(&params, &["sessionKey"]);
            let messages = params
                .get("messages")
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default();
            let pre_prompt_message_count = params
                .get("prePromptMessageCount")
                .and_then(Value::as_u64)
                .unwrap_or(0) as usize;
            memory_runtime(state).after_turn(
                &session_id,
                session_key.as_deref(),
                &messages,
                pre_prompt_message_count,
            )
        }
        "memory.prepareSubagentSpawn" | "memory_prepare_subagent_spawn" => {
            let parent_session_key = required_param(&params, &["parentSessionKey"])?;
            let child_session_key = required_param(&params, &["childSessionKey"])?;
            memory_runtime(state).prepare_subagent_spawn(&parent_session_key, &child_session_key)
        }
        "memory.onSubagentEnded" | "memory_on_subagent_ended" => {
            let child_session_key = required_param(&params, &["childSessionKey"])?;
            let reason =
                string_param(&params, &["reason"]).unwrap_or_else(|| "completed".to_string());
            memory_runtime(state).on_subagent_ended(&child_session_key, &reason)
        }
        "sessions.list" | "sessions_list" => sessions_list(state),
        "sessions.create" => sessions_create(state, params),
        "sessions.preview" => sessions_preview(state, params),
        "sessions.resolve" => sessions_resolve(state, params),
        "sessions.patch" => sessions_patch(state, params),
        "sessions.reset" => sessions_reset(state, params),
        "sessions.delete" => sessions_delete(state, params),
        "sessions.compact" => sessions_compact(state, params),
        "sessions.abort" => chat_abort(params),
        "sessions.status" | "session_status" => {
            let session_key =
                string_param(&params, &["sessionKey", "key"]).unwrap_or_else(|| "main".to_string());
            Ok(json!({
                "session": state.session_store.session_status(&session_key).map_err(|error| error.to_string())?
            }))
        }
        "sessions.get" | "sessions.history" | "sessions_history" => {
            let session_key = required_param(&params, &["sessionKey", "key"])?;
            Ok(json!({
                "sessionKey": session_key,
                "messages": state.session_store.session_history(&session_key).map_err(|error| error.to_string())?
            }))
        }
        "sessions.send" | "sessions_send" => {
            let session_key = required_param(&params, &["sessionKey", "key"])?;
            let message = required_param(&params, &["message", "text"])?;
            let session = state
                .session_store
                .send_to_session(&session_key, &message)
                .map_err(|error| error.to_string())?;
            emit(
                state,
                "session.message",
                json!({
                    "sessionKey": session_key,
                    "role": "user",
                    "content": message
                }),
            );
            emit(state, "sessions.changed", json!({ "session": session }));
            Ok(json!({ "status": "sent", "session": session }))
        }
        "sessions.yield" | "sessions_yield" => {
            let session_key =
                string_param(&params, &["sessionKey", "key"]).unwrap_or_else(|| "main".to_string());
            let session = state
                .session_store
                .mark_session_yielded(&session_key)
                .map_err(|error| error.to_string())?;
            emit(state, "sessions.changed", json!({ "session": session }));
            Ok(json!({ "status": "yielded", "session": session }))
        }
        "sessions.subscribe" => Ok(json!({ "subscribed": true })),
        "sessions.unsubscribe" => Ok(json!({ "subscribed": false })),
        "sessions.messages.subscribe" => sessions_messages_subscription(state, params, true),
        "sessions.messages.unsubscribe" => sessions_messages_subscription(state, params, false),
        "subagents" | "subagents.list" => {
            let parent = string_param(&params, &["parentSessionKey", "parent", "spawnedBy"]);
            Ok(json!({
                "subagents": state.session_store.list_subagents(parent.as_deref()).map_err(|error| error.to_string())?
            }))
        }
        "subagents_spawn" => subagents_spawn(state, params).await,
        "subagents.control" | "subagents_control" => subagents_control(state, params).await,
        "subagents.announce" | "subagents_announce" => subagents_announce(state, params).await,
        "acp.session.list" | "acp_session_list" => acp_session_list(state, params),
        "acp.session.new" | "acp_session_new" => acp_session_new(state, params),
        "acp.session.load" | "acp_session_load" => acp_session_load(state, params),
        "acp.session.patch" | "acp_session_patch" => acp_session_patch(state, params),
        "acp.session.prompt" | "acp_session_prompt" => acp_session_prompt(state, params).await,
        "acp.session.cancel" | "acp_session_cancel" => acp_session_cancel(state, params),
        "acp.session.close" | "acp_session_close" => acp_session_close(state, params),
        other => Err(format!("Unsupported Rust Gateway method: {other}")),
    }
}
