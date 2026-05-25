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
    RemovePluginSkill,
    InvokePluginTool,
    AddAgentSkill,
    RunMemoryDream,
    Thread(ThreadMutation),
    Toggle(ToggleMutation),
    SetPluginToolEnabled,
    SetPluginSkillEnabled,
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

#[derive(Clone)]
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

pub(super) struct ResolvedDesktopAsset {
    pub file_name: String,
    pub media_type: String,
    pub path: PathBuf,
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
            start_desktop_message_generation((*state).clone(), text, send_context).await
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
        DesktopNativeMutation::AbortMessage => abort_desktop_message_generation(state).await,
        DesktopNativeMutation::SteerMessage => steer_desktop_message_generation(state, input).await,
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
                desktop_state.agent_workspace.selected_agent_id = id;
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
            let item_agent_id = item.agent_id.clone();
            persist_memory_item(state, &item)?;
            {
                let mut desktop_state = state.desktop_state.write().await;
                desktop_state.memory_workspace.selected_agent_id = item_agent_id;
                desktop_state.memory_workspace.selected_item_id = id.clone();
                desktop_state.memory_workspace.items.push(item);
            }
            emit_state_changed(state).await
        }
        DesktopNativeMutation::ArchiveMemoryItem => {
            let item_id = string_field(&input, "itemId").ok_or(StatusCode::BAD_REQUEST)?;
            let confirmed = bool_field(&input, "confirmed").unwrap_or(false);
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
            ensure_memory_cleanup_allowed(state, &item, confirmed).await?;
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
            if input.get("tags").is_some() {
                updated_item.tags = string_array_field(&input, "tags");
            }
            if let Some(source) = string_field(&input, "source") {
                updated_item.source = source;
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
            let skill_key = skill_key_from_trigger_or_name(&trigger, &name);
            let description = string_field(&input, "description").unwrap_or_default();
            write_runtime_plugin_skill(state, &skill_key, &name, &trigger, &description)
                .map_err(|error| plugin_host_status(state, error))?;
            let skill = PluginHostSkill {
                id: format!("custom-skill-{skill_key}"),
                skill_key,
                name,
                trigger,
                description,
                status: "enabled".to_string(),
                source: "custom".to_string(),
                icon: "sparkles".to_string(),
                enabled: true,
                install_status: "installed".to_string(),
                open: false,
            };
            let plugin_skill = plugin_skill(skill);
            {
                let mut desktop_state = state.desktop_state.write().await;
                if let Some(existing) =
                    desktop_state
                        .plugins_workspace
                        .skills
                        .iter_mut()
                        .find(|existing| {
                            existing.trigger == plugin_skill.trigger
                                || existing.id == plugin_skill.id
                        })
                {
                    *existing = plugin_skill;
                } else {
                    desktop_state.plugins_workspace.skills.push(plugin_skill);
                }
                desktop_state.active_nav_id = "plugins".to_string();
            }
            refresh_plugins_workspace(state).await?;
            emit_state_changed(state).await
        }
        DesktopNativeMutation::RemovePluginSkill => {
            let skill_id = string_field(&input, "skillId").ok_or(StatusCode::BAD_REQUEST)?;
            let skill = {
                let desktop_state = state.desktop_state.read().await;
                desktop_state
                    .plugins_workspace
                    .skills
                    .iter()
                    .find(|skill| skill.id == skill_id)
                    .cloned()
            }
            .ok_or(StatusCode::NOT_FOUND)?;
            if skill.source == "core" {
                return Err(StatusCode::CONFLICT);
            }
            remove_runtime_plugin_skill(state, &skill)
                .map_err(|error| plugin_host_status(state, error))?;
            refresh_plugins_workspace(state).await?;
            emit_state_changed(state).await
        }
        DesktopNativeMutation::InvokePluginTool => invoke_plugin_tool_operation(state, input).await,
        DesktopNativeMutation::SetPluginToolEnabled => {
            let tool_id = string_field(&input, "toolId").ok_or(StatusCode::BAD_REQUEST)?;
            let enabled = bool_field(&input, "enabled").ok_or(StatusCode::BAD_REQUEST)?;
            set_plugin_tool_enabled(&state.runtime_root, &tool_id, enabled)
                .map_err(|error| plugin_host_status(state, error))?;
            refresh_plugins_workspace(state).await?;
            emit_state_changed(state).await
        }
        DesktopNativeMutation::SetPluginSkillEnabled => {
            let skill_id = string_field(&input, "skillId").ok_or(StatusCode::BAD_REQUEST)?;
            let enabled = bool_field(&input, "enabled").ok_or(StatusCode::BAD_REQUEST)?;
            set_plugin_skill_enabled(&state.runtime_root, &skill_id, enabled)
                .map_err(|error| plugin_host_status(state, error))?;
            refresh_plugins_workspace(state).await?;
            emit_state_changed(state).await
        }
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
                    .or_else(|| {
                        if selected_agent_id == DEFAULT_MEMORY_AGENT_ID {
                            Some(default_memory_agent_profile())
                        } else {
                            None
                        }
                    })
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
            options.insert("memoryAfterTurn".to_string(), json!(false));
            {
                let mut desktop_state = state.desktop_state.write().await;
                desktop_state.active_nav_id = "memory".to_string();
                desktop_state.memory_workspace.selected_agent_id = agent.id.clone();
                desktop_state.memory_workspace.dream.status = "running".to_string();
                desktop_state.memory_workspace.dream.agent_id = agent.id.clone();
                desktop_state.memory_workspace.dream.message =
                    format!("正在整理 {} 的记忆。", agent.name);
                desktop_state.memory_workspace.dream.last_run_at = "刚刚".to_string();
            }
            let _ = emit_state_changed(state).await;
            let dream_result = match state
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
            {
                Ok(dream_result) => dream_result,
                Err(error) => {
                    eprintln!("[desktop-gateway] memory dream failed: {}", error.message());
                    {
                        let mut desktop_state = state.desktop_state.write().await;
                        desktop_state.memory_workspace.dream.status = "failed".to_string();
                        desktop_state.memory_workspace.dream.agent_id = agent.id.clone();
                        desktop_state.memory_workspace.dream.message =
                            format!("{} 的记忆整理失败：{}", agent.name, error.message());
                        desktop_state.memory_workspace.dream.last_run_at = "刚刚".to_string();
                    }
                    let _ = emit_state_changed(state).await;
                    return Err(StatusCode::INTERNAL_SERVER_ERROR);
                }
            };
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

async fn start_desktop_message_generation(
    state: GatewayState,
    text: String,
    send_context: DesktopSendContext,
) -> Result<Json<DesktopState>, StatusCode> {
    start_desktop_message_generation_task(state.clone(), text, send_context).await?;
    emit_state_changed(&state).await
}

async fn start_desktop_message_generation_task(
    state: GatewayState,
    text: String,
    send_context: DesktopSendContext,
) -> Result<(), StatusCode> {
    let run_id = format!("run-{}", Uuid::new_v4().simple());
    let assistant_message_id = now_message_id("assistant");
    let (start_sender, start_receiver) = oneshot::channel();
    let task_state = state.clone();
    let task_context = send_context.clone();
    let task_text = text.clone();
    let task_run_id = run_id.clone();
    let task_assistant_message_id = assistant_message_id.clone();
    let handle = tokio::spawn(async move {
        let _ = start_receiver.await;
        finish_desktop_message_generation(
            task_state,
            task_run_id,
            task_assistant_message_id,
            task_context,
            task_text,
        )
        .await;
    });
    let abort_handle = handle.abort_handle();
    {
        let mut active_generation = state.active_generation.lock().await;
        if active_generation.is_some() {
            abort_handle.abort();
            emit_operation_failed(
                &state,
                "active_message_running",
                "A Rust desktop message generation is already running.",
            );
            return Err(StatusCode::CONFLICT);
        }
        *active_generation = Some(ActiveDesktopGeneration {
            run_id: run_id.clone(),
            thread_id: send_context.thread_id.clone(),
            assistant_message_id: assistant_message_id.clone(),
            user_text: text.clone(),
            options: send_context.options.clone(),
            abort_handle: abort_handle.clone(),
            queued_follow_ups: Vec::new(),
        });
    }
    if let Err(status) = prepare_running_generation_state(
        &state,
        &send_context.thread_id,
        &assistant_message_id,
        &run_id,
        &text,
    )
    .await
    {
        abort_handle.abort();
        let mut active_generation = state.active_generation.lock().await;
        if matches!(
            active_generation.as_ref(),
            Some(active) if active.run_id == run_id
        ) {
            *active_generation = None;
        }
        return Err(status);
    }
    let _ = start_sender.send(());
    let _ = state.events.send(DesktopEvent::SessionStarted {
        thread_id: send_context.thread_id,
    });
    Ok(())
}

async fn prepare_running_generation_state(
    state: &GatewayState,
    thread_id: &str,
    assistant_message_id: &str,
    run_id: &str,
    text: &str,
) -> Result<(), StatusCode> {
    let created_thread = {
        let desktop_state = state.desktop_state.read().await;
        !has_thread(&desktop_state, thread_id)
    };
    if created_thread {
        state
            .session_store
            .create_session(thread_id, Some(text), None)
            .map_err(|error| session_store_status(state, error))?;
    }
    state
        .session_store
        .set_active_thread(thread_id)
        .map_err(|error| session_store_status(state, error))?;

    let mut desktop_state = state.desktop_state.write().await;
    for thread in &mut desktop_state.sidebar.pinned_threads {
        thread.active = thread.id == thread_id;
    }
    for thread in &mut desktop_state.sidebar.threads {
        thread.active = thread.id == thread_id;
    }
    for thread in &mut desktop_state.sidebar.discussion_threads {
        thread.active = thread.id == thread_id;
    }
    if created_thread {
        desktop_state.sidebar.threads.insert(
            0,
            SidebarThread {
                id: thread_id.to_string(),
                title: title_from_message(text),
                time: "刚刚".to_string(),
                active: true,
                agent_avatar: true,
            },
        );
    }
    desktop_state
        .conversation
        .result_items
        .push(format!("用户: {text}"));
    desktop_state
        .conversation
        .messages
        .push(conversation_user_message(text.to_string()));
    desktop_state
        .conversation
        .messages
        .push(conversation_running_assistant_message(
            assistant_message_id.to_string(),
            run_id.to_string(),
        ));
    Ok(())
}

async fn finish_desktop_message_generation(
    state: GatewayState,
    run_id: String,
    assistant_message_id: String,
    send_context: DesktopSendContext,
    text: String,
) {
    let result = state
        .agent_runtime
        .send_message_with_options(
            send_context.thread_id.clone(),
            text,
            send_context.options.clone(),
        )
        .await;
    match result {
        Ok(send_result) => {
            let mut queued_follow_ups = Vec::new();
            let mut active_abort_handle = None;
            {
                let mut desktop_state = state.desktop_state.write().await;
                update_assistant_generation_message(
                    &mut desktop_state,
                    &assistant_message_id,
                    send_result.assistant_text.clone(),
                    "done",
                    None,
                );
                desktop_state
                    .conversation
                    .result_items
                    .push(send_result.assistant_text.clone());
            }
            {
                let mut active_generation = state.active_generation.lock().await;
                if matches!(
                    active_generation.as_ref(),
                    Some(active) if active.run_id == run_id
                ) {
                    if let Some(mut active) = active_generation.take() {
                        active_abort_handle = Some(active.abort_handle);
                        queued_follow_ups.append(&mut active.queued_follow_ups);
                    }
                }
            }
            let _ = state.events.send(DesktopEvent::MessageDelta {
                thread_id: send_result.thread_id.clone(),
                text: send_result.assistant_text.clone(),
            });
            let _ = state.events.send(DesktopEvent::MessageFinal {
                thread_id: send_result.thread_id.clone(),
                text: send_result.assistant_text,
            });
            notify_desktop(
                &state,
                DesktopNotificationKind::TaskDone,
                "对话已完成",
                "模型回复已生成。",
            )
            .await;
            let _ = emit_state_changed(&state).await;
            if let Some(abort_handle) = active_abort_handle {
                run_queued_follow_up_generations(
                    state.clone(),
                    send_result.thread_id,
                    send_context.options,
                    abort_handle,
                    queued_follow_ups,
                )
                .await;
            }
        }
        Err(error) => {
            let error_code = error.code().to_string();
            let error_message = error.message().to_string();
            {
                let mut desktop_state = state.desktop_state.write().await;
                update_assistant_generation_message(
                    &mut desktop_state,
                    &assistant_message_id,
                    error_message.clone(),
                    "failed",
                    Some(error_code.clone()),
                );
                desktop_state
                    .conversation
                    .result_items
                    .push(error_message.clone());
            }
            {
                let mut active_generation = state.active_generation.lock().await;
                if matches!(
                    active_generation.as_ref(),
                    Some(active) if active.run_id == run_id
                ) {
                    *active_generation = None;
                }
            }
            let _ = state.events.send(DesktopEvent::OperationFailed {
                code: error_code,
                message: error_message,
            });
            let _ = emit_state_changed(&state).await;
        }
    }
}

async fn run_queued_follow_up_generations(
    state: GatewayState,
    thread_id: String,
    options: AgentRuntimeSendOptions,
    abort_handle: tokio::task::AbortHandle,
    queued_follow_ups: Vec<String>,
) {
    let mut pending_follow_ups = std::collections::VecDeque::from(queued_follow_ups);
    while let Some(follow_up) = pending_follow_ups.pop_front() {
        let run_id = format!("run-{}", Uuid::new_v4().simple());
        let assistant_message_id = now_message_id("assistant");
        {
            let mut active_generation = state.active_generation.lock().await;
            if active_generation.is_some() {
                emit_operation_failed(
                    &state,
                    "active_message_running",
                    "A Rust desktop message generation is already running.",
                );
                continue;
            }
            *active_generation = Some(ActiveDesktopGeneration {
                run_id: run_id.clone(),
                thread_id: thread_id.clone(),
                assistant_message_id: assistant_message_id.clone(),
                user_text: follow_up.clone(),
                options: options.clone(),
                abort_handle: abort_handle.clone(),
                queued_follow_ups: Vec::new(),
            });
        }
        if let Err(status) = prepare_running_generation_state(
            &state,
            &thread_id,
            &assistant_message_id,
            &run_id,
            &follow_up,
        )
        .await
        {
            let mut active_generation = state.active_generation.lock().await;
            if matches!(
                active_generation.as_ref(),
                Some(active) if active.run_id == run_id
            ) {
                *active_generation = None;
            }
            emit_operation_failed(
                &state,
                "queued_follow_up_failed",
                format!("Queued follow-up could not start: {status}"),
            );
            continue;
        }
        let _ = state.events.send(DesktopEvent::SessionStarted {
            thread_id: thread_id.clone(),
        });
        let _ = emit_state_changed(&state).await;

        match state
            .agent_runtime
            .send_message_with_options(thread_id.clone(), follow_up, options.clone())
            .await
        {
            Ok(send_result) => {
                let mut newly_queued = Vec::new();
                {
                    let mut desktop_state = state.desktop_state.write().await;
                    update_assistant_generation_message(
                        &mut desktop_state,
                        &assistant_message_id,
                        send_result.assistant_text.clone(),
                        "done",
                        None,
                    );
                    desktop_state
                        .conversation
                        .result_items
                        .push(send_result.assistant_text.clone());
                }
                {
                    let mut active_generation = state.active_generation.lock().await;
                    if matches!(
                        active_generation.as_ref(),
                        Some(active) if active.run_id == run_id
                    ) {
                        if let Some(mut active) = active_generation.take() {
                            newly_queued.append(&mut active.queued_follow_ups);
                        }
                    }
                }
                let _ = state.events.send(DesktopEvent::MessageDelta {
                    thread_id: send_result.thread_id.clone(),
                    text: send_result.assistant_text.clone(),
                });
                let _ = state.events.send(DesktopEvent::MessageFinal {
                    thread_id: send_result.thread_id,
                    text: send_result.assistant_text,
                });
                let _ = emit_state_changed(&state).await;
                pending_follow_ups.extend(newly_queued);
            }
            Err(error) => {
                let error_code = error.code().to_string();
                let error_message = error.message().to_string();
                {
                    let mut desktop_state = state.desktop_state.write().await;
                    update_assistant_generation_message(
                        &mut desktop_state,
                        &assistant_message_id,
                        error_message.clone(),
                        "failed",
                        Some(error_code.clone()),
                    );
                    desktop_state
                        .conversation
                        .result_items
                        .push(error_message.clone());
                }
                {
                    let mut active_generation = state.active_generation.lock().await;
                    if matches!(
                        active_generation.as_ref(),
                        Some(active) if active.run_id == run_id
                    ) {
                        *active_generation = None;
                    }
                }
                let _ = state.events.send(DesktopEvent::OperationFailed {
                    code: error_code,
                    message: error_message,
                });
                let _ = emit_state_changed(&state).await;
            }
        }
    }
}

async fn abort_desktop_message_generation(
    state: &GatewayState,
) -> Result<Json<DesktopState>, StatusCode> {
    let active_generation = state.active_generation.lock().await.take();
    let Some(active_generation) = active_generation else {
        emit_operation_failed(
            state,
            "no_active_message",
            "No active Rust desktop message generation is running.",
        );
        return Err(StatusCode::CONFLICT);
    };
    active_generation.abort_handle.abort();
    {
        let mut desktop_state = state.desktop_state.write().await;
        update_assistant_generation_message(
            &mut desktop_state,
            &active_generation.assistant_message_id,
            String::new(),
            "cancelled",
            None,
        );
    }
    emit_state_changed(state).await
}

async fn steer_desktop_message_generation(
    state: &GatewayState,
    input: Value,
) -> Result<Json<DesktopState>, StatusCode> {
    let text = string_field(&input, "text").ok_or(StatusCode::BAD_REQUEST)?;
    let mode = string_field(&input, "mode").ok_or(StatusCode::BAD_REQUEST)?;
    match mode.as_str() {
        "followUp" => {
            {
                let mut active_generation = state.active_generation.lock().await;
                let Some(active) = active_generation.as_mut() else {
                    emit_operation_failed(
                        state,
                        "no_active_message",
                        "No active Rust desktop message generation is running.",
                    );
                    return Err(StatusCode::CONFLICT);
                };
                active.queued_follow_ups.push(text.clone());
            }
            {
                let mut desktop_state = state.desktop_state.write().await;
                desktop_state
                    .conversation
                    .messages
                    .push(conversation_status_message(
                        "追问已排队".to_string(),
                        text,
                        "neutral".to_string(),
                    ));
            }
            emit_state_changed(state).await
        }
        "restart" => {
            let active_generation = state.active_generation.lock().await.take();
            let Some(active) = active_generation else {
                emit_operation_failed(
                    state,
                    "no_active_message",
                    "No active Rust desktop message generation is running.",
                );
                return Err(StatusCode::CONFLICT);
            };
            active.abort_handle.abort();
            {
                let mut desktop_state = state.desktop_state.write().await;
                update_assistant_generation_message(
                    &mut desktop_state,
                    &active.assistant_message_id,
                    String::new(),
                    "cancelled",
                    None,
                );
            }
            let restart_text = format!("{}\n\n修正指令：{}", active.user_text, text);
            start_desktop_message_generation(
                (*state).clone(),
                restart_text,
                DesktopSendContext {
                    thread_id: active.thread_id,
                    options: active.options,
                },
            )
            .await
        }
        _ => {
            emit_operation_failed(
                state,
                "invalid_steer_mode",
                "Desktop steer mode must be restart or followUp.",
            );
            Err(StatusCode::BAD_REQUEST)
        }
    }
}

fn conversation_running_assistant_message(id: String, run_id: String) -> ConversationMessage {
    ConversationMessage::Assistant {
        id,
        text: String::new(),
        status: Some("running".to_string()),
        run_id: Some(run_id),
        error_code: None,
        created_at: "刚刚".to_string(),
    }
}

fn update_assistant_generation_message(
    desktop_state: &mut DesktopState,
    assistant_message_id: &str,
    next_text: String,
    next_status: &str,
    next_error_code: Option<String>,
) {
    if let Some(ConversationMessage::Assistant {
        text,
        status,
        error_code,
        ..
    }) = desktop_state
        .conversation
        .messages
        .iter_mut()
        .find(|message| {
            matches!(message, ConversationMessage::Assistant { id, .. } if id == assistant_message_id)
        })
    {
        *text = next_text;
        *status = Some(next_status.to_string());
        *error_code = next_error_code;
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

pub(super) fn resolve_desktop_asset(
    state: &GatewayState,
    asset_id: &str,
) -> Result<ResolvedDesktopAsset, StatusCode> {
    validate_asset_id(asset_id).map_err(|message| {
        emit_operation_failed(state, "invalid_asset", message);
        StatusCode::BAD_REQUEST
    })?;
    let assets_dir = state.runtime_root.join("desktop").join("assets");
    let canonical_assets_dir = assets_dir.canonicalize().map_err(|_| {
        emit_operation_failed(
            state,
            "asset_not_found",
            "Desktop asset is not available.".to_string(),
        );
        StatusCode::NOT_FOUND
    })?;
    let prefix = format!("{asset_id}-");
    let entries = std::fs::read_dir(&canonical_assets_dir).map_err(|error| {
        emit_operation_failed(
            state,
            "asset_read_failed",
            format!("Failed to read desktop assets directory: {error}"),
        );
        StatusCode::INTERNAL_SERVER_ERROR
    })?;
    for entry in entries.flatten() {
        let file_name = entry.file_name().to_string_lossy().to_string();
        if !file_name.starts_with(&prefix) {
            continue;
        }
        let path = entry.path().canonicalize().map_err(|error| {
            emit_operation_failed(
                state,
                "asset_read_failed",
                format!("Failed to resolve desktop asset: {error}"),
            );
            StatusCode::INTERNAL_SERVER_ERROR
        })?;
        if !path.starts_with(&canonical_assets_dir) {
            emit_operation_failed(
                state,
                "invalid_asset",
                "Desktop asset path is outside the asset directory.".to_string(),
            );
            return Err(StatusCode::BAD_REQUEST);
        }
        let display_name = file_name
            .strip_prefix(&prefix)
            .unwrap_or(&file_name)
            .to_string();
        return Ok(ResolvedDesktopAsset {
            media_type: media_type_from_asset_path(&path),
            file_name: display_name,
            path,
        });
    }
    emit_operation_failed(
        state,
        "asset_not_found",
        "Desktop asset is not available.".to_string(),
    );
    Err(StatusCode::NOT_FOUND)
}

pub(super) async fn record_desktop_asset_action(
    state: &GatewayState,
    asset_id: &str,
    action: &str,
) -> Result<Json<DesktopState>, StatusCode> {
    let asset = resolve_desktop_asset(state, asset_id)?;
    run_desktop_asset_action(&asset, action).map_err(|message| {
        emit_operation_failed(state, "asset_action_failed", message);
        StatusCode::INTERNAL_SERVER_ERROR
    })?;
    let title = match action {
        "reveal" => "已在访达中定位资源",
        _ => "已打开资源",
    };
    append_and_persist_conversation_message(
        state,
        conversation_status_message(title.to_string(), asset.file_name, "neutral".to_string()),
    )
    .await
}

fn validate_asset_id(asset_id: &str) -> Result<(), String> {
    if asset_id.is_empty()
        || asset_id.contains('/')
        || asset_id.contains('\\')
        || asset_id.contains("..")
        || !asset_id.starts_with("asset-")
    {
        return Err("Invalid desktop asset id.".to_string());
    }
    Ok(())
}

fn media_type_from_asset_path(path: &Path) -> String {
    match path
        .extension()
        .and_then(|extension| extension.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase()
        .as_str()
    {
        "apng" => "image/apng",
        "avif" => "image/avif",
        "gif" => "image/gif",
        "jpg" | "jpeg" => "image/jpeg",
        "mp3" => "audio/mpeg",
        "mp4" => "video/mp4",
        "ogg" => "audio/ogg",
        "png" => "image/png",
        "svg" => "image/svg+xml",
        "wav" => "audio/wav",
        "webm" => "audio/webm",
        "webp" => "image/webp",
        _ => "application/octet-stream",
    }
    .to_string()
}

fn run_desktop_asset_action(asset: &ResolvedDesktopAsset, action: &str) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let mut command = std::process::Command::new("open");
        if action == "reveal" {
            command.arg("-R");
        }
        let status = command
            .arg(&asset.path)
            .status()
            .map_err(|error| format!("Failed to run open for desktop asset: {error}"))?;
        if !status.success() {
            return Err("macOS open command failed for desktop asset.".to_string());
        }
        return Ok(());
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = asset;
        let _ = action;
        Err("Desktop asset open is only supported on macOS.".to_string())
    }
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

async fn ensure_memory_cleanup_allowed(
    state: &GatewayState,
    item: &MemoryItem,
    confirmed: bool,
) -> Result<(), StatusCode> {
    let preferences = state.desktop_state.read().await.preferences.clone();
    if confirmed
        || !memory_cleanup_requires_confirmation(
            &preferences.memory_defaults.memory_cleanup_confirmation,
            item,
        )
    {
        return Ok(());
    }
    append_permission_blocking_error(
        state,
        "permission_required",
        "当前记忆清理设置要求确认后再清理这条记忆。",
        StatusCode::CONFLICT,
    )
    .await
}

fn memory_cleanup_requires_confirmation(policy: &str, item: &MemoryItem) -> bool {
    match policy.trim() {
        "不自动清理" => false,
        "仅重要记忆" => memory_item_is_important(item),
        _ => true,
    }
}

fn memory_item_is_important(item: &MemoryItem) -> bool {
    let searchable = [
        item.title.as_str(),
        item.summary.as_str(),
        item.category.as_str(),
        item.source.as_str(),
    ]
    .join(" ")
    .to_lowercase();
    let important_text = ["偏好", "项目", "决策", "流程", "长期", "重要"];
    let important_ascii = [
        "preference",
        "project",
        "decision",
        "procedure",
        "long-term",
        "important",
    ];
    important_text
        .iter()
        .any(|value| searchable.contains(value))
        || important_ascii
            .iter()
            .any(|value| searchable.contains(value))
        || item.tags.iter().any(|tag| {
            let tag = tag.to_lowercase();
            important_text.iter().any(|value| tag.contains(value))
                || important_ascii.iter().any(|value| tag.contains(value))
        })
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
                "done".to_string(),
                if detail.trim().is_empty() {
                    fallback_detail
                } else {
                    detail
                },
                finalize_success_workflow_steps(steps),
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

fn finalize_success_workflow_steps(
    mut steps: Vec<ConversationWorkflowStep>,
) -> Vec<ConversationWorkflowStep> {
    for step in &mut steps {
        if step.status == "active" || step.status == "pending" || step.status == "running" {
            step.status = "done".to_string();
        }
    }
    steps
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
                permission_policy: Some(desktop_permission_policy(
                    state,
                    &desktop_state.preferences.task_defaults.permission_mode,
                    &desktop_state.preferences.confirmation_defaults,
                )),
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
            permission_policy: Some(desktop_permission_policy(
                state,
                &agent.permission_mode,
                &desktop_state.preferences.confirmation_defaults,
            )),
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
        enabled: tool.enabled,
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
        enabled: skill.enabled,
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
        plugin_id: tool.plugin_id,
        name: tool.name,
        description: tool.description,
        status: tool.status,
        permission: tool.permission,
        icon: tool.icon,
        enabled: tool.enabled,
        source: tool.source,
        install_status: tool.install_status,
        open: tool.open,
    }
}

pub(super) fn plugin_skill(skill: PluginHostSkill) -> PluginSkill {
    PluginSkill {
        id: skill.id,
        skill_key: skill.skill_key,
        name: skill.name,
        trigger: skill.trigger,
        description: skill.description,
        status: skill.status,
        source: skill.source,
        icon: skill.icon,
        enabled: skill.enabled,
        install_status: skill.install_status,
        open: skill.open,
    }
}

pub(super) fn plugin_installed(plugin: PluginHostInstalledPlugin) -> InstalledPlugin {
    InstalledPlugin {
        id: plugin.id,
        name: plugin.name,
        status: plugin.status,
        source: plugin.source,
        install_status: plugin.install_status,
        enabled: plugin.enabled,
        version: plugin.version,
        manifest_path: plugin.manifest_path,
        open: plugin.open,
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

fn bool_field(input: &Value, key: &str) -> Option<bool> {
    input.get(key).and_then(Value::as_bool)
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

fn skill_key_from_trigger_or_name(trigger: &str, name: &str) -> String {
    let candidate = trigger
        .trim()
        .strip_prefix('@')
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| name.trim());
    let key = candidate
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() {
                ch.to_ascii_lowercase()
            } else {
                '-'
            }
        })
        .collect::<String>()
        .split('-')
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join("-");
    if key.is_empty() {
        format!("skill-{}", Uuid::new_v4().simple())
    } else {
        key
    }
}

fn write_runtime_plugin_skill(
    state: &GatewayState,
    skill_key: &str,
    name: &str,
    trigger: &str,
    description: &str,
) -> Result<(), PluginHostError> {
    let skill_dir = state.runtime_root.join("skills").join(skill_key);
    let skill_path = skill_dir.join("SKILL.md");
    std::fs::create_dir_all(&skill_dir).map_err(|error| {
        PluginHostError::Io(format!(
            "Failed to create skill directory {}: {error}",
            skill_dir.display()
        ))
    })?;
    let content = format!(
        "---\nname: {name}\ndescription: {description}\n---\n\n# {name}\n\nTrigger: `{trigger}`\n\n{description}\n"
    );
    std::fs::write(&skill_path, content).map_err(|error| {
        PluginHostError::Io(format!(
            "Failed to write skill {}: {error}",
            skill_path.display()
        ))
    })?;
    write_runtime_skill_config(&state.runtime_root, skill_key)
}

fn remove_runtime_plugin_skill(
    state: &GatewayState,
    skill: &PluginSkill,
) -> Result<(), PluginHostError> {
    let skill_dir = state.runtime_root.join("skills").join(&skill.skill_key);
    if skill_dir.join(".crawclaw-core-skill.json").exists() {
        return Err(PluginHostError::Invalid(
            "Core skills cannot be removed".to_string(),
        ));
    }
    match std::fs::remove_dir_all(&skill_dir) {
        Ok(()) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => {
            return Err(PluginHostError::Io(format!(
                "Failed to remove skill directory {}: {error}",
                skill_dir.display()
            )));
        }
    }
    remove_runtime_skill_config(&state.runtime_root, &skill.skill_key)?;
    remove_plugin_skill_state(&state.runtime_root, &skill.id)
}

fn write_runtime_skill_config(
    runtime_root: &PathBuf,
    skill_key: &str,
) -> Result<(), PluginHostError> {
    let config_path = runtime_root.join("config").join("crawclaw.json");
    let mut config = match std::fs::read_to_string(&config_path) {
        Ok(raw) => serde_json::from_str::<Value>(&raw).map_err(|error| {
            PluginHostError::Invalid(format!(
                "Invalid runtime config {}: {error}",
                config_path.display()
            ))
        })?,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => json!({}),
        Err(error) => {
            return Err(PluginHostError::Io(format!(
                "Failed to read runtime config {}: {error}",
                config_path.display()
            )));
        }
    };
    ensure_json_object(&mut config);
    set_object_path_value(
        &mut config,
        &["skills", "entries", skill_key, "enabled"],
        Value::Bool(true),
    )?;
    set_object_path_value(
        &mut config,
        &["skills", "entries", skill_key, "source"],
        Value::String("desktop".to_string()),
    )?;
    if let Some(parent) = config_path.parent() {
        std::fs::create_dir_all(parent).map_err(|error| {
            PluginHostError::Io(format!(
                "Failed to create runtime config directory {}: {error}",
                parent.display()
            ))
        })?;
    }
    let raw = serde_json::to_vec_pretty(&config).map_err(|error| {
        PluginHostError::Invalid(format!("Failed to serialize runtime config: {error}"))
    })?;
    std::fs::write(&config_path, raw).map_err(|error| {
        PluginHostError::Io(format!(
            "Failed to write runtime config {}: {error}",
            config_path.display()
        ))
    })
}

fn remove_runtime_skill_config(
    runtime_root: &PathBuf,
    skill_key: &str,
) -> Result<(), PluginHostError> {
    let config_path = runtime_root.join("config").join("crawclaw.json");
    let mut config = match std::fs::read_to_string(&config_path) {
        Ok(raw) => serde_json::from_str::<Value>(&raw).map_err(|error| {
            PluginHostError::Invalid(format!(
                "Invalid runtime config {}: {error}",
                config_path.display()
            ))
        })?,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(error) => {
            return Err(PluginHostError::Io(format!(
                "Failed to read runtime config {}: {error}",
                config_path.display()
            )));
        }
    };
    let _ = delete_object_path_value(&mut config, &["skills", "entries", skill_key])?;
    let raw = serde_json::to_vec_pretty(&config).map_err(|error| {
        PluginHostError::Invalid(format!("Failed to serialize runtime config: {error}"))
    })?;
    std::fs::write(&config_path, raw).map_err(|error| {
        PluginHostError::Io(format!(
            "Failed to write runtime config {}: {error}",
            config_path.display()
        ))
    })
}

fn ensure_json_object(value: &mut Value) {
    if !value.is_object() {
        *value = json!({});
    }
}

fn set_object_path_value(
    value: &mut Value,
    path: &[&str],
    next: Value,
) -> Result<(), PluginHostError> {
    if path.is_empty() {
        *value = next;
        return Ok(());
    }
    ensure_json_object(value);
    let mut current = value;
    for segment in &path[..path.len() - 1] {
        let object = current.as_object_mut().ok_or_else(|| {
            PluginHostError::Invalid("runtime config path is not an object".to_string())
        })?;
        current = object
            .entry((*segment).to_string())
            .or_insert_with(|| json!({}));
        ensure_json_object(current);
    }
    let object = current.as_object_mut().ok_or_else(|| {
        PluginHostError::Invalid("runtime config path is not an object".to_string())
    })?;
    object.insert(path[path.len() - 1].to_string(), next);
    Ok(())
}

fn delete_object_path_value(value: &mut Value, path: &[&str]) -> Result<bool, PluginHostError> {
    if path.is_empty() {
        return Ok(false);
    }
    let mut current = value;
    for segment in &path[..path.len() - 1] {
        let Some(object) = current.as_object_mut() else {
            return Ok(false);
        };
        let Some(next) = object.get_mut(*segment) else {
            return Ok(false);
        };
        current = next;
    }
    let object = current.as_object_mut().ok_or_else(|| {
        PluginHostError::Invalid("runtime config path is not an object".to_string())
    })?;
    Ok(object.remove(path[path.len() - 1]).is_some())
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

fn default_memory_agent_profile() -> AgentProfile {
    agent_profile(
        DEFAULT_MEMORY_AGENT_ID.to_string(),
        "本机默认".to_string(),
        "本机任务智能体".to_string(),
        "CrawClaw Desktop 的默认本机任务身份。".to_string(),
        Vec::new(),
    )
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
