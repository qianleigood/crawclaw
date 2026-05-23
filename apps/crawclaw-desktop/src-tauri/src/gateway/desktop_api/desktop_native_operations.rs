use base64::Engine;
use std::path::PathBuf;

use super::desktop_settings_effects::{send_desktop_notification, DesktopNotificationKind};
use super::*;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum DesktopNativeMutation {
    SendMessage,
    AddAttachmentMessage,
    AddMediaMessage,
    AddVoiceMessage,
    AddWorkflowMessage,
    AddSkillCallMessage,
    AbortMessage,
    SteerMessage,
    CreateAgent,
    UpdateAgent,
    CreateMemoryItem,
    ArchiveMemoryItem,
    UpdateMemoryItem,
    AddPluginSkill,
    InvokePluginTool,
    AddAgentSkill,
    RunMemoryDream,
    Thread(ThreadMutation),
    Toggle(ToggleMutation),
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum ThreadMutation {
    Pin,
    Unpin,
    Rename,
    Archive,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum ToggleMutation {
    PluginTool,
    PluginSkill,
    AgentTool,
    AgentSkill,
}

struct DesktopSendContext {
    thread_id: String,
    options: AgentRuntimeSendOptions,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct AddAttachmentMessageInput {
    title: String,
    file_name: String,
    media_type: String,
    #[serde(default)]
    confirm: bool,
    #[serde(default)]
    detail: Option<String>,
    #[serde(default)]
    source: Option<DesktopAssetSource>,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct AddMediaMessageInput {
    media_type: String,
    title: String,
    #[serde(default)]
    confirm: bool,
    #[serde(default)]
    items: Vec<ConversationMediaItem>,
    #[serde(default)]
    source: Option<DesktopAssetSource>,
    #[serde(default)]
    provider_config: Option<Value>,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct AddVoiceMessageInput {
    direction: String,
    title: String,
    duration_label: String,
    #[serde(default)]
    prompt: Option<String>,
    #[serde(default)]
    language: Option<String>,
    #[serde(default)]
    transcript: Option<String>,
    #[serde(default)]
    source: Option<DesktopAssetSource>,
    #[serde(default)]
    provider_config: Option<Value>,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct AddWorkflowMessageInput {
    workflow_kind: String,
    #[serde(default)]
    action: Option<String>,
    title: String,
    #[serde(default)]
    confirm: bool,
    #[serde(default)]
    status: Option<String>,
    #[serde(default)]
    detail: String,
    #[serde(default)]
    steps: Vec<ConversationWorkflowStep>,
    #[serde(default)]
    input: Value,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct AddSkillCallMessageInput {
    skill_id: String,
    title: String,
    #[serde(default)]
    status: Option<String>,
    #[serde(default)]
    detail: Option<String>,
    #[serde(default)]
    text: Option<String>,
    #[serde(default)]
    execute: bool,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct DesktopAssetSource {
    kind: String,
    #[serde(default)]
    path: Option<String>,
    #[serde(default)]
    file_name: Option<String>,
    #[serde(default)]
    mime_type: Option<String>,
    #[serde(default)]
    data_base64: Option<String>,
}

struct DesktopAssetRecord {
    asset_id: String,
    file_name: String,
    media_type: String,
    size_bytes: u64,
    path: PathBuf,
}

pub(super) async fn run_native_state_mutation(
    state: &GatewayState,
    operation: DesktopNativeMutation,
    input: Value,
) -> Result<Json<DesktopState>, StatusCode> {
    if state.runtime_supervisor.status().status != crate::models::RuntimeStatusValue::Ready {
        return Err(StatusCode::SERVICE_UNAVAILABLE);
    }
    apply_native_operation(state, operation, input).await
}

pub(super) async fn apply_native_operation(
    state: &GatewayState,
    operation: DesktopNativeMutation,
    input: Value,
) -> Result<Json<DesktopState>, StatusCode> {
    match operation {
        DesktopNativeMutation::SendMessage => {
            let text = string_field(&input, "text").ok_or(StatusCode::BAD_REQUEST)?;
            let send_context = desktop_send_context(state, &input).await?;
            let send_result = match state
                .agent_runtime
                .send_message_with_options(
                    send_context.thread_id,
                    text.clone(),
                    send_context.options,
                )
                .await
            {
                Ok(send_result) => send_result,
                Err(error) => {
                    let _ = state.events.send(DesktopEvent::OperationFailed {
                        code: error.code().to_string(),
                        message: error.message().to_string(),
                    });
                    let _ = append_and_persist_conversation_message_with_emit(
                        state,
                        conversation_user_message(text),
                        false,
                    )
                    .await;
                    let _ = append_and_persist_conversation_message_with_emit(
                        state,
                        conversation_error_message(error.code(), error.message().to_string()),
                        true,
                    )
                    .await;
                    return Err(agent_runtime_error_status(&error));
                }
            };
            state
                .session_store
                .set_active_thread(&send_result.thread_id)
                .map_err(|error| session_store_status(state, error))?;
            {
                let mut desktop_state = state.desktop_state.write().await;
                if !has_thread(&desktop_state, &send_result.thread_id) {
                    desktop_state.sidebar.threads.insert(
                        0,
                        SidebarThread {
                            id: send_result.thread_id.clone(),
                            title: title_from_message(&send_result.user_text),
                            time: "刚刚".to_string(),
                            active: true,
                            agent_avatar: true,
                        },
                    );
                }
                desktop_state
                    .conversation
                    .result_items
                    .push(format!("用户: {}", send_result.user_text));
                desktop_state
                    .conversation
                    .result_items
                    .push(send_result.assistant_text.clone());
                desktop_state
                    .conversation
                    .messages
                    .push(conversation_user_message(send_result.user_text.clone()));
                desktop_state
                    .conversation
                    .messages
                    .push(conversation_assistant_message(
                        send_result.assistant_text.clone(),
                    ));
            }
            let _ = state.events.send(DesktopEvent::SessionStarted {
                thread_id: send_result.thread_id.clone(),
            });
            let _ = state.events.send(DesktopEvent::MessageDelta {
                thread_id: send_result.thread_id.clone(),
                text: send_result.assistant_text.clone(),
            });
            let _ = state.events.send(DesktopEvent::MessageFinal {
                thread_id: send_result.thread_id,
                text: send_result.assistant_text,
            });
            notify_desktop(
                state,
                DesktopNotificationKind::TaskDone,
                "对话已完成",
                "模型回复已生成。",
            )
            .await;
            emit_state_changed(state).await
        }
        DesktopNativeMutation::AddAttachmentMessage => {
            let input = parse_desktop_message_input::<AddAttachmentMessageInput>(state, input)?;
            validate_asset_file_name(&input.file_name).map_err(|message| {
                emit_operation_failed(state, "invalid_asset", message);
                StatusCode::BAD_REQUEST
            })?;
            ensure_desktop_file_action_allowed(state, input.source.as_ref(), input.confirm).await?;
            let asset = persist_desktop_asset(
                state,
                input.source.as_ref(),
                &input.file_name,
                &input.media_type,
            )?;
            let file_name = asset
                .as_ref()
                .map(|asset| asset.file_name.clone())
                .unwrap_or(input.file_name);
            let media_type = asset
                .as_ref()
                .map(|asset| asset.media_type.clone())
                .unwrap_or(input.media_type);
            append_and_persist_conversation_message(
                state,
                conversation_attachment_message_with_asset(
                    input.title,
                    file_name,
                    media_type,
                    input.detail,
                    asset.as_ref().map(|asset| asset.asset_id.clone()),
                    asset.as_ref().map(|asset| asset.size_bytes),
                ),
            )
            .await
        }
        DesktopNativeMutation::AddMediaMessage => {
            let mut input = parse_desktop_message_input::<AddMediaMessageInput>(state, input)?;
            ensure_desktop_file_action_allowed(state, input.source.as_ref(), input.confirm).await?;
            let asset = persist_desktop_asset(
                state,
                input.source.as_ref(),
                "media-message",
                &input.media_type,
            )?;
            if let Some(asset) = asset {
                if input.items.is_empty() {
                    input.items.push(ConversationMediaItem {
                        id: asset.asset_id.clone(),
                        label: asset.file_name.clone(),
                        kind: input.media_type.clone(),
                        asset_id: Some(asset.asset_id.clone()),
                        mime_type: Some(asset.media_type.clone()),
                        size_bytes: Some(asset.size_bytes),
                        status: Some("done".to_string()),
                        detail: None,
                    });
                } else if let Some(item) = input.items.first_mut() {
                    item.asset_id = Some(asset.asset_id.clone());
                    item.mime_type = Some(asset.media_type.clone());
                    item.size_bytes = Some(asset.size_bytes);
                    item.status = Some("done".to_string());
                }
                if input.media_type == "image" || asset.media_type.starts_with("image/") {
                    match run_openai_media_understanding(
                        state,
                        "image",
                        &asset,
                        input.provider_config.clone(),
                        None,
                        None,
                    )
                    .await
                    {
                        Ok(value) => {
                            if let Some(detail) = media_understanding_text(&value) {
                                if let Some(item) = input.items.first_mut() {
                                    item.detail = Some(detail);
                                    item.status = Some("done".to_string());
                                }
                            }
                        }
                        Err(error) => {
                            if let Some(item) = input.items.first_mut() {
                                item.status = Some("failed".to_string());
                                item.detail = Some(format!("媒体理解失败：{error}"));
                            }
                            let mut message = conversation_media_message(
                                input.media_type,
                                input.title,
                                input.items,
                            );
                            if let ConversationMessage::Media {
                                status, error_code, ..
                            } = &mut message
                            {
                                *status = Some("failed".to_string());
                                *error_code = Some("media_understanding_failed".to_string());
                            }
                            return append_and_persist_conversation_message(state, message).await;
                        }
                    }
                }
            }
            append_and_persist_conversation_message(
                state,
                conversation_media_message(input.media_type, input.title, input.items),
            )
            .await
        }
        DesktopNativeMutation::AddVoiceMessage => {
            let input = parse_desktop_message_input::<AddVoiceMessageInput>(state, input)?;
            let asset = persist_desktop_asset(
                state,
                input.source.as_ref(),
                "voice-message.webm",
                "audio/webm",
            )?;
            let mut transcript = input.transcript;
            let mut transcription_error = None;
            if let Some(asset) = asset.as_ref() {
                match run_openai_media_understanding(
                    state,
                    "audio",
                    asset,
                    input.provider_config,
                    input.prompt,
                    input.language,
                )
                .await
                {
                    Ok(value) => {
                        if let Some(text) = media_understanding_text(&value) {
                            transcript = Some(text);
                        }
                    }
                    Err(error) => {
                        transcription_error = Some(error);
                    }
                }
            }
            let mut message = conversation_voice_message(
                input.direction,
                input.title,
                input.duration_label,
                transcript,
            );
            if let ConversationMessage::Voice {
                asset_id,
                mime_type,
                size_bytes,
                status,
                error_code,
                transcript,
                ..
            } = &mut message
            {
                *asset_id = asset.as_ref().map(|asset| asset.asset_id.clone());
                *mime_type = asset.as_ref().map(|asset| asset.media_type.clone());
                *size_bytes = asset.as_ref().map(|asset| asset.size_bytes);
                if let Some(error) = transcription_error {
                    *status = Some("failed".to_string());
                    *error_code = Some("voice_transcription_failed".to_string());
                    if transcript.as_deref().unwrap_or_default().trim().is_empty() {
                        *transcript = Some(format!("语音转写失败：{error}"));
                    }
                } else {
                    *status = Some("done".to_string());
                }
            }
            append_and_persist_conversation_message(state, message).await
        }
        DesktopNativeMutation::AddWorkflowMessage => {
            let input = parse_desktop_message_input::<AddWorkflowMessageInput>(state, input)?;
            ensure_desktop_workflow_action_allowed(state, &input).await?;
            let message = run_workflow_message(state, input).await;
            append_and_persist_conversation_message(state, message).await
        }
        DesktopNativeMutation::AddSkillCallMessage => {
            let input = parse_desktop_message_input::<AddSkillCallMessageInput>(state, input)?;
            let status = input.status.unwrap_or_else(|| {
                if input.execute {
                    "running".to_string()
                } else {
                    "context".to_string()
                }
            });
            let detail = input.detail.or(input.text);
            append_and_persist_conversation_message(
                state,
                conversation_skill_call_message(input.skill_id, input.title, status, detail),
            )
            .await
        }
        DesktopNativeMutation::AbortMessage | DesktopNativeMutation::SteerMessage => {
            if operation == DesktopNativeMutation::SteerMessage {
                let _ = string_field(&input, "text").ok_or(StatusCode::BAD_REQUEST)?;
            }
            emit_operation_failed(
                state,
                "no_active_message",
                "No active Rust desktop message generation is running.",
            );
            Err(StatusCode::CONFLICT)
        }
        DesktopNativeMutation::CreateAgent => {
            let name = string_field(&input, "name").unwrap_or_else(|| "New Agent".to_string());
            let role = string_field(&input, "role").unwrap_or_else(|| "Agent".to_string());
            let description = string_field(&input, "description").unwrap_or_default();
            let channels = match agent_channels_from_input(&input) {
                Ok(channels) => channels,
                Err(message) => {
                    emit_operation_failed(state, "invalid_channel", message);
                    return Err(StatusCode::BAD_REQUEST);
                }
            };
            let id = format!("agent-{}", Uuid::new_v4().simple());
            let mut agent = agent_profile(id.clone(), name, role, description, channels);
            apply_agent_configuration_from_input(state, &mut agent, &input).await?;
            persist_agent_profile(state, &agent)?;
            {
                let mut desktop_state = state.desktop_state.write().await;
                desktop_state.agent_workspace.selected_agent_id = id.clone();
                desktop_state.memory_workspace.selected_agent_id = id.clone();
                desktop_state.agent_workspace.agents.push(agent);
            }
            emit_state_changed(state).await
        }
        DesktopNativeMutation::UpdateAgent => {
            let agent_id = string_field(&input, "agentId").ok_or(StatusCode::BAD_REQUEST)?;
            let mut updated_agent = {
                let desktop_state = state.desktop_state.read().await;
                desktop_state
                    .agent_workspace
                    .agents
                    .iter()
                    .find(|agent| agent.id == agent_id)
                    .cloned()
                    .ok_or(StatusCode::NOT_FOUND)?
            };
            if let Some(name) = string_field(&input, "name") {
                updated_agent.name = name;
            }
            if let Some(role) = string_field(&input, "role") {
                updated_agent.role = role;
            }
            if let Some(description) = string_field(&input, "description") {
                updated_agent.description = description;
            }
            apply_agent_configuration_from_input(state, &mut updated_agent, &input).await?;
            persist_agent_profile(state, &updated_agent)?;
            {
                let mut desktop_state = state.desktop_state.write().await;
                if let Some(agent) = desktop_state
                    .agent_workspace
                    .agents
                    .iter_mut()
                    .find(|agent| agent.id == agent_id)
                {
                    *agent = updated_agent;
                }
            }
            emit_state_changed(state).await
        }
        DesktopNativeMutation::CreateMemoryItem => {
            let title = string_field(&input, "title").ok_or(StatusCode::BAD_REQUEST)?;
            let summary = string_field(&input, "summary").unwrap_or_default();
            let content = string_field(&input, "content").unwrap_or_default();
            let category = string_field(&input, "category").unwrap_or_else(|| "其他".to_string());
            let source = string_field(&input, "source").unwrap_or_else(|| "Desktop".to_string());
            let id = format!("memory-{}", Uuid::new_v4().simple());
            let default_agent_id = state
                .desktop_state
                .read()
                .await
                .memory_workspace
                .selected_agent_id
                .clone();
            let item = MemoryItem {
                id: id.clone(),
                agent_id: string_field(&input, "agentId")
                    .filter(|value| !value.is_empty())
                    .unwrap_or(default_agent_id),
                title,
                summary,
                content,
                category,
                tags: string_array_field(&input, "tags"),
                source,
                updated_at: "刚刚".to_string(),
                archived: false,
            };
            persist_memory_item(state, &item)?;
            {
                let mut desktop_state = state.desktop_state.write().await;
                desktop_state.memory_workspace.selected_item_id = id.clone();
                desktop_state.memory_workspace.items.push(item);
            }
            emit_state_changed(state).await
        }
        DesktopNativeMutation::ArchiveMemoryItem => {
            let item_id = string_field(&input, "itemId").ok_or(StatusCode::BAD_REQUEST)?;
            let mut item = {
                let desktop_state = state.desktop_state.read().await;
                desktop_state
                    .memory_workspace
                    .items
                    .iter()
                    .find(|item| item.id == item_id)
                    .cloned()
                    .ok_or(StatusCode::NOT_FOUND)?
            };
            item.archived = true;
            item.updated_at = "刚刚".to_string();
            state
                .memory_store
                .archive_item(&item_id)
                .map_err(|error| memory_store_status(state, error))?;
            {
                let mut desktop_state = state.desktop_state.write().await;
                if let Some(item) = desktop_state
                    .memory_workspace
                    .items
                    .iter_mut()
                    .find(|item| item.id == item_id)
                {
                    item.archived = true;
                }
            }
            emit_state_changed(state).await
        }
        DesktopNativeMutation::UpdateMemoryItem => {
            let item_id = string_field(&input, "itemId").ok_or(StatusCode::BAD_REQUEST)?;
            let mut updated_item = {
                let desktop_state = state.desktop_state.read().await;
                desktop_state
                    .memory_workspace
                    .items
                    .iter()
                    .find(|item| item.id == item_id)
                    .cloned()
                    .ok_or(StatusCode::NOT_FOUND)?
            };
            if let Some(title) = string_field(&input, "title") {
                updated_item.title = title;
            }
            if let Some(summary) = string_field(&input, "summary") {
                updated_item.summary = summary;
            }
            if let Some(content) = string_field(&input, "content") {
                updated_item.content = content;
            }
            if let Some(category) = string_field(&input, "category") {
                updated_item.category = category;
            }
            updated_item.updated_at = "刚刚".to_string();
            persist_memory_item(state, &updated_item)?;
            {
                let mut desktop_state = state.desktop_state.write().await;
                if let Some(item) = desktop_state
                    .memory_workspace
                    .items
                    .iter_mut()
                    .find(|item| item.id == item_id)
                {
                    *item = updated_item;
                }
            }
            emit_state_changed(state).await
        }
        DesktopNativeMutation::AddPluginSkill => {
            let name = string_field(&input, "name").ok_or(StatusCode::BAD_REQUEST)?;
            let trigger = normalize_skill_trigger(
                string_field(&input, "trigger").unwrap_or_else(|| name.clone()),
            );
            let skill = PluginHostSkill {
                id: format!("plugin-skill-{}", Uuid::new_v4().simple()),
                name,
                trigger,
                description: string_field(&input, "description").unwrap_or_default(),
                status: "enabled".to_string(),
                source: "desktop".to_string(),
                icon: "sparkles".to_string(),
                open: false,
            };
            let skill = add_custom_plugin_skill(&state.runtime_root, skill)
                .map_err(|error| plugin_host_status(state, error))?;
            {
                let mut desktop_state = state.desktop_state.write().await;
                if let Some(existing) = desktop_state
                    .plugins_workspace
                    .skills
                    .iter_mut()
                    .find(|existing| existing.trigger == skill.trigger || existing.id == skill.id)
                {
                    *existing = plugin_skill(skill);
                } else {
                    desktop_state
                        .plugins_workspace
                        .skills
                        .push(plugin_skill(skill));
                }
                desktop_state.active_nav_id = "plugins".to_string();
            }
            emit_state_changed(state).await
        }
        DesktopNativeMutation::InvokePluginTool => invoke_plugin_tool_operation(state, input).await,
        DesktopNativeMutation::AddAgentSkill => {
            let agent_id = string_field(&input, "agentId").ok_or(StatusCode::BAD_REQUEST)?;
            let mut agent = {
                let desktop_state = state.desktop_state.read().await;
                desktop_state
                    .agent_workspace
                    .agents
                    .iter()
                    .find(|agent| agent.id == agent_id)
                    .cloned()
                    .ok_or(StatusCode::NOT_FOUND)?
            };
            let name = string_field(&input, "name").ok_or(StatusCode::BAD_REQUEST)?;
            let trigger = normalize_skill_trigger(
                string_field(&input, "trigger").unwrap_or_else(|| name.clone()),
            );
            let skill = AgentSkill {
                id: format!("agent-skill-{}", Uuid::new_v4().simple()),
                name,
                trigger,
                description: string_field(&input, "description").unwrap_or_default(),
                status: "enabled".to_string(),
                source: "desktop".to_string(),
                icon: "sparkles".to_string(),
                open: false,
                enabled: true,
            };
            if let Some(existing) = agent
                .skills
                .iter_mut()
                .find(|existing| existing.trigger == skill.trigger)
            {
                *existing = skill;
            } else {
                agent.skills.push(skill);
            }
            persist_agent_profile(state, &agent)?;
            {
                let mut desktop_state = state.desktop_state.write().await;
                if let Some(existing) = desktop_state
                    .agent_workspace
                    .agents
                    .iter_mut()
                    .find(|existing| existing.id == agent_id)
                {
                    *existing = agent;
                }
            }
            emit_state_changed(state).await
        }
        DesktopNativeMutation::RunMemoryDream => {
            let preferences = state.desktop_state.read().await.preferences.clone();
            if !preferences.memory_defaults.memory_dream_enabled {
                let _ = append_and_persist_conversation_message_with_emit(
                    state,
                    conversation_error_message(
                        "memory_dream_disabled",
                        "记忆做梦已在设置中关闭。".to_string(),
                    ),
                    true,
                )
                .await;
                return Err(StatusCode::CONFLICT);
            }
            let selected_agent_id = {
                let desktop_state = state.desktop_state.read().await;
                string_field(&input, "agentId")
                    .unwrap_or_else(|| desktop_state.memory_workspace.selected_agent_id.clone())
            };
            let agent = {
                let desktop_state = state.desktop_state.read().await;
                desktop_state
                    .agent_workspace
                    .agents
                    .iter()
                    .find(|agent| agent.id == selected_agent_id)
                    .cloned()
                    .ok_or(StatusCode::NOT_FOUND)?
            };
            let definition =
                find_special_agent("dream").ok_or(StatusCode::INTERNAL_SERVER_ERROR)?;
            let run_id = format!("desktop-dream-{}", Uuid::new_v4());
            let session_key = format!("special:dream:{run_id}");
            let mut options = BTreeMap::new();
            options.insert(
                "specialAgent".to_string(),
                json!({
                    "kind": definition.id,
                    "spawnSource": definition.spawn_source,
                    "executionMode": definition.execution_mode,
                    "transcriptPolicy": definition.transcript_policy,
                    "parentContextPolicy": definition.parent_context_policy,
                    "timeoutSeconds": definition.timeout_seconds,
                    "maxTurns": definition.max_turns
                }),
            );
            let dream_result = state
                .agent_runtime
                .run_turn(AgentRunRequest {
                    run_id,
                    agent_id: "dream".to_string(),
                    session_key: session_key.clone(),
                    inbound: ChannelInboundEnvelope {
                        channel: "desktop".to_string(),
                        account_id: Some("desktop".to_string()),
                        from: "desktop".to_string(),
                        to: "agent:dream".to_string(),
                        chat_type: ChannelChatType::Direct,
                        body: format!("Run memory dream for agent {}", agent.id),
                        raw_body: Some("desktop memory dream".to_string()),
                        message_id: Some(format!("{session_key}:input")),
                        thread_id: Some(session_key),
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
                })
                .await
                .map_err(|error| {
                    eprintln!("[desktop-gateway] memory dream failed: {}", error.message());
                    StatusCode::INTERNAL_SERVER_ERROR
                })?;
            {
                let mut desktop_state = state.desktop_state.write().await;
                desktop_state.active_nav_id = "memory".to_string();
                desktop_state.memory_workspace.selected_agent_id = agent.id.clone();
                desktop_state.memory_workspace.query.clear();
                desktop_state.memory_workspace.filter = "全部".to_string();
                desktop_state.memory_workspace.selected_item_id =
                    first_visible_memory_item_id(&desktop_state, &agent.id).unwrap_or_default();
                desktop_state.memory_workspace.dream.status = "completed".to_string();
                desktop_state.memory_workspace.dream.agent_id = agent.id;
                desktop_state.memory_workspace.dream.message = format!(
                    "{} 的记忆整理已由 Rust special-agent 完成：{}",
                    agent.name, dream_result.run_id
                );
                desktop_state.memory_workspace.dream.last_run_at = "刚刚".to_string();
            }
            notify_desktop(
                state,
                DesktopNotificationKind::DreamDone,
                "记忆做梦已完成",
                "记忆整理结果已写入记忆工作区。",
            )
            .await;
            emit_state_changed(state).await
        }
        DesktopNativeMutation::Thread(operation) => {
            update_thread_operation(state, operation, input).await
        }
        DesktopNativeMutation::Toggle(operation) => toggle_operation(state, operation, input).await,
    }
}

fn parse_desktop_message_input<T: DeserializeOwned>(
    state: &GatewayState,
    input: Value,
) -> Result<T, StatusCode> {
    serde_json::from_value(input).map_err(|error| {
        emit_operation_failed(
            state,
            "invalid_message",
            format!("Invalid desktop conversation message payload: {error}"),
        );
        StatusCode::BAD_REQUEST
    })
}

pub(super) async fn append_and_persist_conversation_message(
    state: &GatewayState,
    message: ConversationMessage,
) -> Result<Json<DesktopState>, StatusCode> {
    append_and_persist_conversation_message_with_emit(state, message, true).await
}

pub(super) async fn append_and_persist_conversation_message_with_emit(
    state: &GatewayState,
    message: ConversationMessage,
    emit: bool,
) -> Result<Json<DesktopState>, StatusCode> {
    let title = conversation_message_title(&message);
    let content = conversation_message_content(&message);
    let (thread_id, created_thread) = {
        let mut desktop_state = state.desktop_state.write().await;
        let active_thread_id = active_thread_id(&desktop_state);
        let created_thread = active_thread_id.is_none();
        let thread_id = active_thread_id.unwrap_or_else(|| {
            let thread_id = format!("thread-{}", Uuid::new_v4().simple());
            for thread in desktop_state.sidebar.pinned_threads.iter_mut() {
                thread.active = false;
            }
            for thread in desktop_state.sidebar.threads.iter_mut() {
                thread.active = false;
            }
            for thread in desktop_state.sidebar.discussion_threads.iter_mut() {
                thread.active = false;
            }
            desktop_state.sidebar.threads.insert(
                0,
                SidebarThread {
                    id: thread_id.clone(),
                    title: title_from_message(&title),
                    time: "刚刚".to_string(),
                    active: true,
                    agent_avatar: true,
                },
            );
            thread_id
        });
        desktop_state.conversation.messages.push(message.clone());
        (thread_id, created_thread)
    };
    if created_thread {
        state
            .session_store
            .create_session(&thread_id, Some(&title), None)
            .map_err(|error| session_store_status(state, error))?;
    }
    let desktop_message = serde_json::to_value(&message).map_err(|error| {
        emit_operation_failed(
            state,
            "conversation_persist_failed",
            format!("Failed to serialize desktop conversation message: {error}"),
        );
        StatusCode::INTERNAL_SERVER_ERROR
    })?;
    state
        .session_store
        .append_desktop_message(
            &thread_id,
            "desktop",
            &content,
            Some("desktop"),
            desktop_message,
        )
        .map_err(|error| session_store_status(state, error))?;
    {
        let mut desktop_state = state.desktop_state.write().await;
        if !content.trim().is_empty() {
            desktop_state.conversation.result_items.push(content);
        }
    }
    if emit {
        emit_state_changed(state).await
    } else {
        let desktop_state = state.desktop_state.read().await.clone();
        Ok(Json(desktop_state))
    }
}

fn conversation_message_title(message: &ConversationMessage) -> String {
    match message {
        ConversationMessage::User { text, .. } | ConversationMessage::Assistant { text, .. } => {
            text.clone()
        }
        ConversationMessage::ToolCall { title, .. }
        | ConversationMessage::ToolResult { title, .. }
        | ConversationMessage::Permission { title, .. }
        | ConversationMessage::Status { title, .. }
        | ConversationMessage::Attachment { title, .. }
        | ConversationMessage::Media { title, .. }
        | ConversationMessage::Workflow { title, .. }
        | ConversationMessage::Voice { title, .. }
        | ConversationMessage::SkillCall { title, .. }
        | ConversationMessage::Error { title, .. } => title.clone(),
    }
}

fn conversation_message_content(message: &ConversationMessage) -> String {
    match message {
        ConversationMessage::User { text, .. } | ConversationMessage::Assistant { text, .. } => {
            text.clone()
        }
        ConversationMessage::ToolResult { text, .. } => text.clone(),
        ConversationMessage::Permission { detail, .. }
        | ConversationMessage::Status { detail, .. }
        | ConversationMessage::Workflow { detail, .. }
        | ConversationMessage::Error { detail, .. } => detail.clone(),
        ConversationMessage::Attachment {
            title,
            file_name,
            detail,
            ..
        } => detail
            .clone()
            .unwrap_or_else(|| format!("{title}: {file_name}")),
        ConversationMessage::Media { title, .. }
        | ConversationMessage::Voice { title, .. }
        | ConversationMessage::SkillCall { title, .. }
        | ConversationMessage::ToolCall { title, .. } => title.clone(),
    }
}

fn persist_desktop_asset(
    state: &GatewayState,
    source: Option<&DesktopAssetSource>,
    fallback_file_name: &str,
    fallback_media_type: &str,
) -> Result<Option<DesktopAssetRecord>, StatusCode> {
    let Some(source) = source else {
        return Ok(None);
    };
    let file_name = source
        .file_name
        .as_deref()
        .unwrap_or(fallback_file_name)
        .trim();
    validate_asset_file_name(file_name).map_err(|message| {
        emit_operation_failed(state, "invalid_asset", message);
        StatusCode::BAD_REQUEST
    })?;
    let media_type = source
        .mime_type
        .as_deref()
        .unwrap_or(fallback_media_type)
        .trim()
        .to_string();
    let bytes = match source.kind.as_str() {
        "tauriPath" => {
            let path = source.path.as_deref().ok_or_else(|| {
                emit_operation_failed(
                    state,
                    "invalid_asset",
                    "tauriPath attachment source requires path.".to_string(),
                );
                StatusCode::BAD_REQUEST
            })?;
            std::fs::read(path).map_err(|error| {
                emit_operation_failed(
                    state,
                    "asset_read_failed",
                    format!("Failed to read selected attachment: {error}"),
                );
                StatusCode::BAD_REQUEST
            })?
        }
        "browserFile" => {
            let encoded = source.data_base64.as_deref().ok_or_else(|| {
                emit_operation_failed(
                    state,
                    "invalid_asset",
                    "browserFile attachment source requires dataBase64.".to_string(),
                );
                StatusCode::BAD_REQUEST
            })?;
            decode_browser_file_base64(encoded).map_err(|error| {
                emit_operation_failed(
                    state,
                    "invalid_asset",
                    format!("Invalid browserFile dataBase64: {error}"),
                );
                StatusCode::BAD_REQUEST
            })?
        }
        other => {
            emit_operation_failed(
                state,
                "invalid_asset",
                format!("Unsupported desktop asset source kind: {other}"),
            );
            return Err(StatusCode::BAD_REQUEST);
        }
    };
    let asset_id = format!("asset-{}", Uuid::new_v4().simple());
    let assets_dir = state.runtime_root.join("desktop").join("assets");
    std::fs::create_dir_all(&assets_dir).map_err(|error| {
        emit_operation_failed(
            state,
            "asset_write_failed",
            format!("Failed to create desktop assets directory: {error}"),
        );
        StatusCode::INTERNAL_SERVER_ERROR
    })?;
    let asset_path = assets_dir.join(format!("{asset_id}-{file_name}"));
    std::fs::write(&asset_path, &bytes).map_err(|error| {
        emit_operation_failed(
            state,
            "asset_write_failed",
            format!("Failed to write desktop asset: {error}"),
        );
        StatusCode::INTERNAL_SERVER_ERROR
    })?;
    Ok(Some(DesktopAssetRecord {
        asset_id,
        file_name: file_name.to_string(),
        media_type,
        size_bytes: bytes.len() as u64,
        path: asset_path,
    }))
}

fn validate_asset_file_name(file_name: &str) -> Result<(), String> {
    if file_name.is_empty()
        || file_name == "."
        || file_name == ".."
        || file_name.contains('/')
        || file_name.contains('\\')
    {
        return Err(format!("Invalid desktop asset file name: {file_name}"));
    }
    Ok(())
}

fn decode_browser_file_base64(encoded: &str) -> Result<Vec<u8>, base64::DecodeError> {
    let payload = encoded
        .strip_prefix("data:")
        .and_then(|_| encoded.split_once(',').map(|(_, payload)| payload))
        .unwrap_or(encoded);
    base64::engine::general_purpose::STANDARD.decode(payload)
}

async fn ensure_desktop_file_action_allowed(
    state: &GatewayState,
    source: Option<&DesktopAssetSource>,
    confirmed: bool,
) -> Result<(), StatusCode> {
    if source.is_none() {
        return Ok(());
    }
    let preferences = state.desktop_state.read().await.preferences.clone();
    if preferences.confirmation_defaults.confirm_file_changes && !confirmed {
        append_permission_blocking_error(
            state,
            "permission_required",
            "当前设置要求在保存本地附件或媒体副本前确认。本次文件已被拒绝写入桌面资源目录。",
            StatusCode::CONFLICT,
        )
        .await
    } else {
        Ok(())
    }
}

async fn ensure_desktop_workflow_action_allowed(
    state: &GatewayState,
    input: &AddWorkflowMessageInput,
) -> Result<(), StatusCode> {
    if !is_high_risk_workflow_action(&input.workflow_kind, input.action.as_deref()) {
        return Ok(());
    }
    let preferences = state.desktop_state.read().await.preferences.clone();
    if is_read_only_permission_mode(&preferences.permission_mode) {
        return append_permission_blocking_error(
            state,
            "permission_denied",
            "当前权限模式是只读模式，不能执行会调用外部工作流或修改本地状态的对话动作。",
            StatusCode::FORBIDDEN,
        )
        .await;
    }
    if preferences.confirmation_defaults.confirm_high_risk && !input.confirm {
        return append_permission_blocking_error(
            state,
            "permission_required",
            "当前设置要求高风险工作流执行前确认。本次工作流请求已暂停。",
            StatusCode::CONFLICT,
        )
        .await;
    }
    Ok(())
}

async fn append_permission_blocking_error(
    state: &GatewayState,
    code: &str,
    detail: &str,
    status: StatusCode,
) -> Result<(), StatusCode> {
    if code == "permission_required" {
        notify_desktop(
            state,
            DesktopNotificationKind::ConfirmNeeded,
            "需要确认",
            detail,
        )
        .await;
    }
    let _ = append_and_persist_conversation_message_with_emit(
        state,
        conversation_error_message(code, detail.to_string()),
        true,
    )
    .await;
    Err(status)
}

fn is_read_only_permission_mode(permission_mode: &str) -> bool {
    permission_mode
        .split_whitespace()
        .collect::<String>()
        .contains("只读")
        || permission_mode.to_ascii_lowercase().contains("read-only")
        || permission_mode.to_ascii_lowercase().contains("readonly")
}

fn is_high_risk_workflow_action(workflow_kind: &str, action: Option<&str>) -> bool {
    let normalized = action.unwrap_or_default().trim().to_ascii_lowercase();
    match workflow_kind {
        "comfyui" => matches!(
            normalized.as_str(),
            "run" | "workflow.run" | "queue" | "enqueue" | "submit"
        ),
        "schedule" => !matches!(
            normalized.as_str(),
            "" | "status" | "list" | "cron.status" | "cron.list"
        ),
        "n8n" => matches!(
            normalized.as_str(),
            "run" | "execute" | "trigger" | "workflow.run" | "workflow.execute"
        ),
        _ => !matches!(normalized.as_str(), "" | "status" | "list" | "get"),
    }
}

async fn run_openai_media_understanding(
    state: &GatewayState,
    capability: &str,
    asset: &DesktopAssetRecord,
    provider_config: Option<Value>,
    prompt: Option<String>,
    language: Option<String>,
) -> Result<Value, String> {
    let mut request = desktop_media_provider_request(state, provider_config);
    request.insert(
        "capability".to_string(),
        Value::String(capability.to_string()),
    );
    request.insert(
        "attachments".to_string(),
        json!([{
            "index": 0,
            "fileName": &asset.file_name,
            "mimeType": &asset.media_type,
            "path": asset.path.to_string_lossy()
        }]),
    );
    if let Some(prompt) = prompt.filter(|value| !value.trim().is_empty()) {
        request.insert("prompt".to_string(), Value::String(prompt));
    }
    if let Some(language) = language.filter(|value| !value.trim().is_empty()) {
        request.insert("language".to_string(), Value::String(language));
    }

    let request =
        crawclaw_runtime::with_native_runtime_context(&state.runtime_root, Value::Object(request));
    crawclaw_native_plugins::registry::dispatch_builtin_native_plugin_operation(
        "openai",
        "media-understanding",
        request,
    )
    .await
    .map_err(|error| error.to_string())
}

fn desktop_media_provider_request(
    state: &GatewayState,
    provider_config: Option<Value>,
) -> serde_json::Map<String, Value> {
    if let Some(Value::Object(object)) = provider_config {
        return object;
    }
    let config_path = state
        .runtime_root
        .join("config")
        .join("desktop-agent-provider.json");
    let Ok(raw) = std::fs::read_to_string(config_path) else {
        return serde_json::Map::new();
    };
    let Ok(Value::Object(config)) = serde_json::from_str::<Value>(&raw) else {
        return serde_json::Map::new();
    };
    let provider = config
        .get("provider")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_ascii_lowercase();
    if !(provider.contains("openai") || provider.contains("compatible")) {
        return serde_json::Map::new();
    }
    let mut request = serde_json::Map::new();
    for key in ["apiKey", "baseUrl", "model", "timeoutSeconds"] {
        if let Some(value) = config.get(key) {
            request.insert(key.to_string(), value.clone());
        }
    }
    request
}

fn media_understanding_text(value: &Value) -> Option<String> {
    value
        .pointer("/outputs/0/text")
        .or_else(|| value.pointer("/details/outputs/0/text"))
        .or_else(|| value.get("output_text"))
        .or_else(|| value.pointer("/details/output_text"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
}

async fn run_workflow_message(
    state: &GatewayState,
    input: AddWorkflowMessageInput,
) -> ConversationMessage {
    let workflow_kind = input.workflow_kind;
    let title = input.title;
    let steps = input.steps;
    let fallback_detail = input.detail;
    let workflow_result = match workflow_kind.as_str() {
        "comfyui" => {
            let mut tool_input = input.input;
            if let Some(action) = input.action {
                tool_input = with_string(tool_input, "action", &action);
            } else {
                tool_input = with_string(tool_input, "action", "status");
            }
            invoke_rust_native_plugin_tool(state, "comfyui", "comfyui_workflow", &tool_input)
                .await
                .unwrap_or_else(|| Err("Rust-native ComfyUI tool is not available.".to_string()))
        }
        "schedule" => {
            let action = input.action.unwrap_or_else(|| "cron.status".to_string());
            crawclaw_runtime::execute_cron_runtime_operation(
                &state.runtime_root,
                &action,
                input.input,
            )
            .await
        }
        "n8n" => {
            let action = input.action.unwrap_or_else(|| "list".to_string());
            let mut tool_input = input.input;
            tool_input = with_string(tool_input, "action", &action);
            crawclaw_runtime::execute_rust_core_tool(&state.runtime_root, "workflow", tool_input)
                .await
        }
        _ => Err(format!("Unsupported workflow kind: {workflow_kind}")),
    };
    match workflow_result {
        Ok(value) => {
            let detail = plugin_tool_result_text(&value);
            let mut message = conversation_workflow_message(
                workflow_kind,
                title,
                input.status.unwrap_or_else(|| "done".to_string()),
                if detail.trim().is_empty() {
                    fallback_detail
                } else {
                    detail
                },
                steps,
            );
            if let ConversationMessage::Workflow {
                workflow_id,
                run_id,
                ..
            } = &mut message
            {
                *workflow_id = value
                    .pointer("/details/workflowId")
                    .or_else(|| value.pointer("/details/workflow/workflowId"))
                    .and_then(Value::as_str)
                    .map(ToOwned::to_owned);
                *run_id = value
                    .pointer("/details/runId")
                    .or_else(|| value.pointer("/details/execution/executionId"))
                    .and_then(Value::as_str)
                    .map(ToOwned::to_owned);
            }
            message
        }
        Err(error) => {
            notify_desktop(
                state,
                DesktopNotificationKind::AutomationFailed,
                "工作流执行失败",
                &error,
            )
            .await;
            let mut message = conversation_workflow_message(
                workflow_kind,
                title,
                "failed".to_string(),
                if fallback_detail.trim().is_empty() {
                    error.clone()
                } else {
                    format!("{fallback_detail}\n{error}")
                },
                steps,
            );
            if let ConversationMessage::Workflow { error_code, .. } = &mut message {
                *error_code = Some("workflow_failed".to_string());
            }
            message
        }
    }
}

async fn notify_desktop(
    state: &GatewayState,
    kind: DesktopNotificationKind,
    title: &str,
    body: &str,
) {
    let preferences = state.desktop_state.read().await.preferences.clone();
    if let Err(error) =
        send_desktop_notification(&state.runtime_root, &preferences, kind, title, body)
    {
        emit_operation_failed(state, "desktop_notification_failed", error);
    }
}

pub(super) fn agent_runtime_error_status(error: &AgentRuntimeError) -> StatusCode {
    match error {
        AgentRuntimeError::ProviderUnavailable(_) => StatusCode::SERVICE_UNAVAILABLE,
        AgentRuntimeError::UnsupportedProvider(_) => StatusCode::NOT_IMPLEMENTED,
        AgentRuntimeError::ProviderFailed(_) | AgentRuntimeError::TranscriptFailed(_) => {
            StatusCode::INTERNAL_SERVER_ERROR
        }
    }
}

async fn desktop_send_context(
    state: &GatewayState,
    input: &Value,
) -> Result<DesktopSendContext, StatusCode> {
    let desktop_state = state.desktop_state.read().await;
    let thread_id = active_thread_id(&desktop_state)
        .unwrap_or_else(|| format!("thread-{}", Uuid::new_v4().simple()));
    let Some(agent_id) = string_field(input, "agentId") else {
        return Ok(DesktopSendContext {
            thread_id,
            options: AgentRuntimeSendOptions {
                model_selection: Some(model_selection_from_preferences(&desktop_state.preferences)),
                tool_selection: if desktop_state.preferences.task_defaults.allow_tools {
                    AgentRuntimeToolSelection::Default
                } else {
                    AgentRuntimeToolSelection::Disabled
                },
                system_prompt: None,
            },
        });
    };
    let agent = desktop_state
        .agent_workspace
        .agents
        .iter()
        .find(|agent| agent.id == agent_id)
        .ok_or(StatusCode::NOT_FOUND)?;

    Ok(DesktopSendContext {
        thread_id,
        options: AgentRuntimeSendOptions {
            model_selection: Some(model_selection_from_agent(agent)),
            tool_selection: tool_selection_from_agent(agent),
            system_prompt: Some(system_prompt_from_agent(agent)),
        },
    })
}

fn model_selection_from_preferences(preferences: &DesktopPreferences) -> AgentModelSelection {
    let selected_model = preferences.selected_model.trim();
    let (provider, model) = selected_model
        .split_once('/')
        .map(|(provider, model)| (provider.trim(), model.trim()))
        .unwrap_or(("configured", selected_model));

    AgentModelSelection {
        provider: non_empty_model_part(provider),
        model: non_empty_model_part(model),
        reasoning_level: Some(preferences.selected_thinking.trim().to_string())
            .filter(|value| !value.is_empty()),
    }
}

fn model_selection_from_agent(agent: &AgentProfile) -> AgentModelSelection {
    let selected_model = agent.model.trim();
    let (provider, model) = selected_model
        .split_once('/')
        .map(|(provider, model)| (provider.trim(), model.trim()))
        .unwrap_or(("configured", selected_model));

    AgentModelSelection {
        provider: non_empty_model_part(provider),
        model: non_empty_model_part(model),
        reasoning_level: Some(agent.thinking.trim().to_string()).filter(|value| !value.is_empty()),
    }
}

fn tool_selection_from_agent(agent: &AgentProfile) -> AgentRuntimeToolSelection {
    let tool_ids = agent
        .tools
        .iter()
        .filter(|tool| tool.enabled)
        .map(|tool| tool.id.trim())
        .filter(|tool| !tool.is_empty())
        .map(ToOwned::to_owned)
        .collect::<Vec<_>>();
    if tool_ids.is_empty() {
        AgentRuntimeToolSelection::Disabled
    } else {
        AgentRuntimeToolSelection::AllowList(tool_ids)
    }
}

fn system_prompt_from_agent(agent: &AgentProfile) -> String {
    let mut sections = vec![
        "# 智能体上下文".to_string(),
        format!("名称: {}", agent.name),
        format!("角色: {}", agent.role),
        format!("权限模式: {}", agent.permission_mode),
    ];
    if !agent.description.trim().is_empty() {
        sections.push(format!("描述: {}", agent.description.trim()));
    }
    if !agent.emotion.prompt_md.trim().is_empty() {
        sections.push(agent.emotion.prompt_md.trim().to_string());
    }
    let skills = agent
        .skills
        .iter()
        .filter(|skill| skill.enabled)
        .map(|skill| {
            format!(
                "- {} {}: {}",
                normalize_skill_trigger(skill.trigger.clone()),
                skill.name,
                skill.description
            )
        })
        .collect::<Vec<_>>();
    if !skills.is_empty() {
        sections.push("可用技能:".to_string());
        sections.extend(skills);
    }
    sections.join("\n")
}

async fn apply_agent_configuration_from_input(
    state: &GatewayState,
    agent: &mut AgentProfile,
    input: &Value,
) -> Result<(), StatusCode> {
    if let Some(model) = string_field(input, "model") {
        agent.model = model;
    }
    if let Some(thinking) = string_field(input, "thinking") {
        agent.thinking = thinking;
    }
    if let Some(permission_mode) = string_field(input, "permissionMode") {
        agent.permission_mode = permission_mode;
    }
    if let Some(status) = string_field(input, "status") {
        agent.status = status;
    }
    if let Some(emotion) = input.get("emotion") {
        agent.emotion =
            serde_json::from_value::<AgentEmotionProfile>(emotion.clone()).map_err(|error| {
                emit_operation_failed(
                    state,
                    "invalid_agent_config",
                    format!("Invalid agent emotion payload: {error}"),
                );
                StatusCode::BAD_REQUEST
            })?;
    }
    if let Some(voice) = input.get("voice") {
        agent.voice =
            serde_json::from_value::<AgentVoiceConfig>(voice.clone()).map_err(|error| {
                emit_operation_failed(
                    state,
                    "invalid_agent_config",
                    format!("Invalid agent voice payload: {error}"),
                );
                StatusCode::BAD_REQUEST
            })?;
    }
    if let Some(avatar) = input.get("avatar") {
        agent.avatar =
            serde_json::from_value::<AgentAvatarProfile>(avatar.clone()).map_err(|error| {
                emit_operation_failed(
                    state,
                    "invalid_agent_config",
                    format!("Invalid agent avatar payload: {error}"),
                );
                StatusCode::BAD_REQUEST
            })?;
    }
    if input.get("channels").is_some() {
        agent.channels = agent_channels_from_input(input).map_err(|message| {
            emit_operation_failed(state, "invalid_channel", message);
            StatusCode::BAD_REQUEST
        })?;
    }
    if input.get("toolIds").is_some() {
        agent.tools = resolve_agent_tools(state, string_array_field(input, "toolIds")).await?;
    }
    if input.get("skillIds").is_some() {
        agent.skills = resolve_agent_skills(state, string_array_field(input, "skillIds")).await?;
    }
    Ok(())
}

async fn resolve_agent_tools(
    state: &GatewayState,
    requested_ids: Vec<String>,
) -> Result<Vec<AgentTool>, StatusCode> {
    let (plugin_tools, existing_tools) = {
        let desktop_state = state.desktop_state.read().await;
        (
            desktop_state.plugins_workspace.tools.clone(),
            desktop_state
                .agent_workspace
                .agents
                .iter()
                .flat_map(|agent| agent.tools.clone())
                .collect::<Vec<_>>(),
        )
    };
    let runtime_tools =
        crawclaw_runtime::pi_agent_rust_tool_descriptors_for_runtime_root(&state.runtime_root);
    let mut tools = Vec::new();
    let mut seen = std::collections::BTreeSet::new();
    for requested_id in requested_ids {
        if !seen.insert(requested_id.clone()) {
            continue;
        }
        if let Some(tool) = runtime_tools
            .iter()
            .find(|tool| tool.name == requested_id)
            .map(agent_tool_from_runtime_descriptor)
            .or_else(|| {
                plugin_tools
                    .iter()
                    .find(|tool| tool.id == requested_id)
                    .map(agent_tool_from_plugin_tool)
            })
            .or_else(|| {
                existing_tools
                    .iter()
                    .find(|tool| tool.id == requested_id)
                    .cloned()
                    .map(|mut tool| {
                        tool.enabled = true;
                        tool
                    })
            })
        {
            tools.push(tool);
            continue;
        }
        emit_operation_failed(
            state,
            "invalid_agent_capability",
            format!("Unknown agent tool id: {requested_id}"),
        );
        return Err(StatusCode::BAD_REQUEST);
    }
    Ok(tools)
}

async fn resolve_agent_skills(
    state: &GatewayState,
    requested_ids: Vec<String>,
) -> Result<Vec<AgentSkill>, StatusCode> {
    let (plugin_skills, existing_skills) = {
        let desktop_state = state.desktop_state.read().await;
        (
            desktop_state.plugins_workspace.skills.clone(),
            desktop_state
                .agent_workspace
                .agents
                .iter()
                .flat_map(|agent| agent.skills.clone())
                .collect::<Vec<_>>(),
        )
    };
    let mut skills = Vec::new();
    let mut seen = std::collections::BTreeSet::new();
    for requested_id in requested_ids {
        if !seen.insert(requested_id.clone()) {
            continue;
        }
        if let Some(skill) = plugin_skills
            .iter()
            .find(|skill| skill.id == requested_id)
            .map(agent_skill_from_plugin_skill)
            .or_else(|| {
                existing_skills
                    .iter()
                    .find(|skill| skill.id == requested_id)
                    .cloned()
                    .map(|mut skill| {
                        skill.enabled = true;
                        skill
                    })
            })
        {
            skills.push(skill);
            continue;
        }
        emit_operation_failed(
            state,
            "invalid_agent_capability",
            format!("Unknown agent skill id: {requested_id}"),
        );
        return Err(StatusCode::BAD_REQUEST);
    }
    Ok(skills)
}

fn agent_tool_from_runtime_descriptor(
    tool: &crawclaw_runtime::RustAgentToolDescriptor,
) -> AgentTool {
    AgentTool {
        id: tool.name.clone(),
        name: tool.label.clone(),
        description: tool.description.clone(),
        status: "available".to_string(),
        permission: if tool.read_only {
            "只读"
        } else {
            "工作区"
        }
        .to_string(),
        icon: "terminal".to_string(),
        open: false,
        enabled: true,
    }
}

fn agent_tool_from_plugin_tool(tool: &PluginTool) -> AgentTool {
    AgentTool {
        id: tool.id.clone(),
        name: tool.name.clone(),
        description: tool.description.clone(),
        status: tool.status.clone(),
        permission: tool.permission.clone(),
        icon: tool.icon.clone(),
        open: tool.open,
        enabled: true,
    }
}

fn agent_skill_from_plugin_skill(skill: &PluginSkill) -> AgentSkill {
    AgentSkill {
        id: skill.id.clone(),
        name: skill.name.clone(),
        trigger: normalize_skill_trigger(skill.trigger.clone()),
        description: skill.description.clone(),
        status: skill.status.clone(),
        source: skill.source.clone(),
        icon: skill.icon.clone(),
        open: skill.open,
        enabled: true,
    }
}

fn non_empty_model_part(value: &str) -> String {
    if value.is_empty() {
        "configured".to_string()
    } else {
        value.to_string()
    }
}

pub(super) fn plugin_tool(tool: PluginHostTool) -> PluginTool {
    PluginTool {
        id: tool.id,
        name: tool.name,
        description: tool.description,
        status: tool.status,
        permission: tool.permission,
        icon: tool.icon,
        open: tool.open,
    }
}

pub(super) fn plugin_skill(skill: PluginHostSkill) -> PluginSkill {
    PluginSkill {
        id: skill.id,
        name: skill.name,
        trigger: skill.trigger,
        description: skill.description,
        status: skill.status,
        source: skill.source,
        icon: skill.icon,
        open: skill.open,
    }
}

pub(super) async fn update_thread_operation(
    state: &GatewayState,
    operation: ThreadMutation,
    input: Value,
) -> Result<Json<DesktopState>, StatusCode> {
    let thread_id = string_field(&input, "threadId").ok_or(StatusCode::BAD_REQUEST)?;
    let title = if operation == ThreadMutation::Rename {
        Some(string_field(&input, "title").ok_or(StatusCode::BAD_REQUEST)?)
    } else {
        None
    };
    {
        let desktop_state = state.desktop_state.read().await;
        if !has_thread(&desktop_state, &thread_id) {
            return Err(StatusCode::NOT_FOUND);
        }
    }
    match operation {
        ThreadMutation::Pin => state
            .session_store
            .set_thread_pinned(&thread_id, true)
            .map_err(|error| session_store_status(state, error))?,
        ThreadMutation::Unpin => state
            .session_store
            .set_thread_pinned(&thread_id, false)
            .map_err(|error| session_store_status(state, error))?,
        ThreadMutation::Rename => state
            .session_store
            .rename_thread(&thread_id, title.as_deref().unwrap_or_default())
            .map_err(|error| session_store_status(state, error))?,
        ThreadMutation::Archive => state
            .session_store
            .archive_thread(&thread_id)
            .map_err(|error| session_store_status(state, error))?,
    }
    let mut next_thread_id = None;
    {
        let mut desktop_state = state.desktop_state.write().await;
        let active_before = active_thread_id(&desktop_state);
        match operation {
            ThreadMutation::Pin => {
                if let Some(mut thread) =
                    remove_thread(&mut desktop_state.sidebar.threads, &thread_id)
                {
                    if active_before.is_none() || thread.active {
                        thread.active = true;
                        next_thread_id = Some(thread.id.clone());
                    }
                    desktop_state.sidebar.pinned_threads.push(thread);
                }
            }
            ThreadMutation::Unpin => {
                if let Some(mut thread) =
                    remove_thread(&mut desktop_state.sidebar.pinned_threads, &thread_id)
                {
                    if active_before.is_none() || thread.active {
                        thread.active = true;
                        next_thread_id = Some(thread.id.clone());
                    }
                    desktop_state.sidebar.threads.insert(0, thread);
                }
            }
            ThreadMutation::Rename => {
                let title = title.expect("rename title validated");
                rename_thread(&mut desktop_state.sidebar.threads, &thread_id, &title);
                rename_thread(
                    &mut desktop_state.sidebar.pinned_threads,
                    &thread_id,
                    &title,
                );
                rename_thread(
                    &mut desktop_state.sidebar.discussion_threads,
                    &thread_id,
                    &title,
                );
            }
            ThreadMutation::Archive => {
                remove_thread(&mut desktop_state.sidebar.threads, &thread_id);
                remove_thread(&mut desktop_state.sidebar.pinned_threads, &thread_id);
                next_thread_id = active_thread_id(&desktop_state)
                    .or_else(|| activate_first_visible_thread(&mut desktop_state));
                if next_thread_id.is_none() {
                    desktop_state.conversation.messages.clear();
                    desktop_state.conversation.result_items.clear();
                }
            }
        }
    }
    if let Some(thread_id) = next_thread_id {
        state
            .session_store
            .set_active_thread(&thread_id)
            .map_err(|error| session_store_status(state, error))?;
        if let Some(session) = state
            .session_store
            .load_session(&thread_id)
            .map_err(|error| session_store_status(state, error))?
        {
            let mut desktop_state = state.desktop_state.write().await;
            apply_session_conversation(&mut desktop_state, &session.thread_id, &session);
        }
    }
    emit_state_changed(state).await
}

pub(super) async fn toggle_operation(
    state: &GatewayState,
    operation: ToggleMutation,
    input: Value,
) -> Result<Json<DesktopState>, StatusCode> {
    if matches!(
        operation,
        ToggleMutation::AgentTool | ToggleMutation::AgentSkill
    ) {
        return toggle_agent_operation(state, operation, input).await;
    }
    let mut changed = false;
    {
        let mut desktop_state = state.desktop_state.write().await;
        match operation {
            ToggleMutation::PluginTool => {
                let tool_id = string_field(&input, "toolId").ok_or(StatusCode::BAD_REQUEST)?;
                if let Some(tool) = desktop_state
                    .plugins_workspace
                    .tools
                    .iter_mut()
                    .find(|tool| tool.id == tool_id)
                {
                    tool.open = toggle_plugin_tool_open(&state.runtime_root, &tool_id)
                        .map_err(|error| plugin_host_status(state, error))?;
                    changed = true;
                }
            }
            ToggleMutation::PluginSkill => {
                let skill_id = string_field(&input, "skillId").ok_or(StatusCode::BAD_REQUEST)?;
                if let Some(skill) = desktop_state
                    .plugins_workspace
                    .skills
                    .iter_mut()
                    .find(|skill| skill.id == skill_id)
                {
                    skill.open = toggle_plugin_skill_open(&state.runtime_root, &skill_id)
                        .map_err(|error| plugin_host_status(state, error))?;
                    changed = true;
                }
            }
            ToggleMutation::AgentTool | ToggleMutation::AgentSkill => {}
        }
    }
    if !changed {
        return Err(StatusCode::NOT_FOUND);
    }
    emit_state_changed(state).await
}

pub(super) async fn toggle_agent_operation(
    state: &GatewayState,
    operation: ToggleMutation,
    input: Value,
) -> Result<Json<DesktopState>, StatusCode> {
    let agent_id = string_field(&input, "agentId").ok_or(StatusCode::BAD_REQUEST)?;
    let mut agent = {
        let desktop_state = state.desktop_state.read().await;
        desktop_state
            .agent_workspace
            .agents
            .iter()
            .find(|agent| agent.id == agent_id)
            .cloned()
            .ok_or(StatusCode::NOT_FOUND)?
    };
    let changed = match operation {
        ToggleMutation::AgentTool => {
            let tool_id = string_field(&input, "toolId").ok_or(StatusCode::BAD_REQUEST)?;
            if let Some(tool) = agent.tools.iter_mut().find(|tool| tool.id == tool_id) {
                tool.enabled = !tool.enabled;
                true
            } else {
                false
            }
        }
        ToggleMutation::AgentSkill => {
            let skill_id = string_field(&input, "skillId").ok_or(StatusCode::BAD_REQUEST)?;
            if let Some(skill) = agent.skills.iter_mut().find(|skill| skill.id == skill_id) {
                skill.enabled = !skill.enabled;
                true
            } else {
                false
            }
        }
        ToggleMutation::PluginTool | ToggleMutation::PluginSkill => false,
    };
    if !changed {
        return Err(StatusCode::NOT_FOUND);
    }
    persist_agent_profile(state, &agent)?;
    {
        let mut desktop_state = state.desktop_state.write().await;
        if let Some(existing) = desktop_state
            .agent_workspace
            .agents
            .iter_mut()
            .find(|existing| existing.id == agent_id)
        {
            *existing = agent;
        }
    }
    emit_state_changed(state).await
}

pub(super) fn parse_json_body(body: Bytes) -> Result<Value, StatusCode> {
    if body.is_empty() {
        return Ok(json!({}));
    }
    serde_json::from_slice(&body).map_err(|_| StatusCode::BAD_REQUEST)
}

pub(super) fn with_string(input: Value, key: &str, value: &str) -> Value {
    let mut object = match input {
        Value::Object(object) => object,
        _ => Map::new(),
    };
    object.insert(key.to_string(), Value::String(value.to_string()));
    Value::Object(object)
}

pub(super) fn string_field(input: &Value, key: &str) -> Option<String> {
    input
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
}

pub(super) fn string_array_field(input: &Value, key: &str) -> Vec<String> {
    input
        .get(key)
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(ToOwned::to_owned)
                .collect()
        })
        .unwrap_or_default()
}

pub(super) fn normalize_skill_trigger(trigger: String) -> String {
    let trigger = trigger.trim();
    if trigger.starts_with('@') {
        trigger.to_string()
    } else {
        format!("@{trigger}")
    }
}

pub(super) fn active_thread_id(desktop_state: &DesktopState) -> Option<String> {
    desktop_state
        .sidebar
        .pinned_threads
        .iter()
        .chain(desktop_state.sidebar.threads.iter())
        .chain(desktop_state.sidebar.discussion_threads.iter())
        .find(|thread| thread.active)
        .map(|thread| thread.id.clone())
}

pub(super) fn first_visible_memory_item_id(
    desktop_state: &DesktopState,
    agent_id: &str,
) -> Option<String> {
    desktop_state
        .memory_workspace
        .items
        .iter()
        .find(|item| item.agent_id == agent_id && !item.archived)
        .map(|item| item.id.clone())
}

pub(super) fn activate_first_visible_thread(desktop_state: &mut DesktopState) -> Option<String> {
    for thread in desktop_state
        .sidebar
        .pinned_threads
        .iter_mut()
        .chain(desktop_state.sidebar.threads.iter_mut())
        .chain(desktop_state.sidebar.discussion_threads.iter_mut())
    {
        thread.active = true;
        return Some(thread.id.clone());
    }
    None
}

pub(super) fn has_thread(desktop_state: &DesktopState, thread_id: &str) -> bool {
    desktop_state
        .sidebar
        .pinned_threads
        .iter()
        .chain(desktop_state.sidebar.threads.iter())
        .chain(desktop_state.sidebar.discussion_threads.iter())
        .any(|thread| thread.id == thread_id)
}

pub(super) fn remove_thread(
    threads: &mut Vec<SidebarThread>,
    thread_id: &str,
) -> Option<SidebarThread> {
    let index = threads.iter().position(|thread| thread.id == thread_id)?;
    Some(threads.remove(index))
}

pub(super) fn rename_thread(threads: &mut [SidebarThread], thread_id: &str, title: &str) {
    if let Some(thread) = threads.iter_mut().find(|thread| thread.id == thread_id) {
        thread.title = title.to_string();
    }
}

pub(super) fn title_from_message(text: &str) -> String {
    let mut title = text.chars().take(32).collect::<String>();
    if text.chars().count() > 32 {
        title.push_str("...");
    }
    title
}
