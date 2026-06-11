use std::collections::BTreeSet;

use axum::extract::State;
use axum::http::{HeaderMap, StatusCode};
use axum::Json;
use serde::Deserialize;
use uuid::Uuid;

use crate::models::{
    AgentGroupMemberRunState, AgentGroupRoomSummary, AgentGroupRunState, AgentProfile,
    ConversationMessage, DesktopState, SidebarThread,
};

use super::desktop_native_operations::{
    active_thread_id, conversation_message_content, conversation_message_title,
    conversation_messages_for_loop_events, model_selection_from_agent, system_prompt_from_agent,
    title_from_message, tool_selection_from_agent,
};
use super::{
    authorize_headers, desktop_permission_policy, emit_operation_failed, emit_state_changed,
    session_store_status, GatewayState,
};
use crawclaw_runtime::AgentRuntimeSendOptions;

const DEFAULT_AGENT_GROUP_ID: &str = "default-supervised-room";
const DEFAULT_AGENT_GROUP_TITLE: &str = "任务群";
const DEFAULT_MAX_TURNS: u8 = 4;
const DEFAULT_MAX_PARALLEL_AGENTS: u8 = 3;
const MAX_TURNS_LIMIT: u8 = 12;
const MAX_PARALLEL_AGENTS_LIMIT: u8 = 3;

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct StartAgentGroupRunRequest {
    pub task: String,
    pub lead_agent_id: String,
    pub member_agent_ids: Vec<String>,
    pub max_turns: Option<u8>,
    pub max_parallel_agents: Option<u8>,
}

#[derive(Clone, Debug)]
struct ValidatedAgentGroupRun {
    task: String,
    lead: AgentProfile,
    members: Vec<AgentProfile>,
    max_turns: u8,
    max_parallel_agents: u8,
}

pub(super) fn sync_agent_group_workspace(desktop_state: &mut DesktopState) {
    let agents = &desktop_state.agent_workspace.agents;
    if agents.len() < 2 {
        desktop_state.agent_groups.selected_group_id.clear();
        desktop_state.agent_groups.groups.clear();
        return;
    }

    let selected_agent_id = desktop_state.agent_workspace.selected_agent_id.trim();
    let lead = agents
        .iter()
        .find(|agent| agent.id == selected_agent_id)
        .unwrap_or(&agents[0]);
    let member_agent_ids = agents
        .iter()
        .filter(|agent| agent.id != lead.id)
        .take(DEFAULT_MAX_PARALLEL_AGENTS as usize)
        .map(|agent| agent.id.clone())
        .collect::<Vec<_>>();
    let status = desktop_state
        .agent_groups
        .groups
        .iter()
        .find(|group| group.id == DEFAULT_AGENT_GROUP_ID)
        .map(|group| group.status.clone())
        .unwrap_or_else(|| "idle".to_string());
    let last_activity_at = desktop_state
        .agent_groups
        .groups
        .iter()
        .find(|group| group.id == DEFAULT_AGENT_GROUP_ID)
        .map(|group| group.last_activity_at.clone())
        .unwrap_or_else(|| "尚未运行".to_string());

    desktop_state.agent_groups.groups = vec![AgentGroupRoomSummary {
        id: DEFAULT_AGENT_GROUP_ID.to_string(),
        title: DEFAULT_AGENT_GROUP_TITLE.to_string(),
        lead_agent_id: lead.id.clone(),
        member_agent_ids,
        status,
        last_activity_at,
    }];
    desktop_state.agent_groups.selected_group_id = DEFAULT_AGENT_GROUP_ID.to_string();
}

pub(super) async fn start_agent_group_run(
    State(state): State<GatewayState>,
    headers: HeaderMap,
    Json(payload): Json<StartAgentGroupRunRequest>,
) -> Result<Json<DesktopState>, StatusCode> {
    authorize_headers(&headers, &state)?;
    let agents = state
        .desktop_state
        .read()
        .await
        .agent_workspace
        .agents
        .clone();
    let validated = match validate_agent_group_run_request(payload, &agents) {
        Ok(validated) => validated,
        Err((status, message)) => {
            let _ = append_group_message_to_thread(&state, None, message).await;
            return Err(status);
        }
    };

    let room_run_id = format!("group-run-{}", Uuid::new_v4().simple());
    let thread_id = format!("group-{}", Uuid::new_v4().simple());
    let group_id = DEFAULT_AGENT_GROUP_ID.to_string();
    state
        .session_store
        .create_session(&thread_id, Some(DEFAULT_AGENT_GROUP_TITLE), None)
        .map_err(|error| session_store_status(&state, error))?;
    state
        .session_store
        .set_active_thread(&thread_id)
        .map_err(|error| session_store_status(&state, error))?;

    {
        let mut desktop_state = state.desktop_state.write().await;
        sync_agent_group_workspace(&mut desktop_state);
        desktop_state.active_nav_id = "new-chat".to_string();
        for thread in desktop_state.sidebar.pinned_threads.iter_mut() {
            thread.active = false;
        }
        for thread in desktop_state.sidebar.threads.iter_mut() {
            thread.active = false;
        }
        for thread in desktop_state.sidebar.discussion_threads.iter_mut() {
            thread.active = false;
        }
        desktop_state.sidebar.discussion_threads.insert(
            0,
            SidebarThread {
                id: thread_id.clone(),
                title: title_from_message(&validated.task),
                time: "刚刚".to_string(),
                active: true,
                agent_avatar: true,
            },
        );
        desktop_state.conversation.messages.clear();
        desktop_state.conversation.result_items.clear();
        desktop_state.conversation.context_summary = None;
        set_group_summary_status(&mut desktop_state, &group_id, "running", "刚刚");
        desktop_state.agent_groups.active_run = Some(AgentGroupRunState {
            id: room_run_id.clone(),
            group_id: group_id.clone(),
            thread_id: thread_id.clone(),
            task: validated.task.clone(),
            lead_agent_id: validated.lead.id.clone(),
            member_runs: validated
                .members
                .iter()
                .map(|member| AgentGroupMemberRunState {
                    agent_id: member.id.clone(),
                    status: "pending".to_string(),
                    run_id: None,
                    summary: None,
                    error_code: None,
                })
                .collect(),
            status: "running".to_string(),
            created_at: "刚刚".to_string(),
            completed_at: None,
        });
    }

    append_group_message_to_thread(
        &state,
        Some(&thread_id),
        ConversationMessage::User {
            id: now_message_id("user"),
            text: validated.task.clone(),
            created_at: "刚刚".to_string(),
        },
    )
    .await?;
    append_group_message_to_thread(
        &state,
        Some(&thread_id),
        conversation_agent_group_message(
            &group_id,
            &room_run_id,
            "任务群已启动",
            format!(
                "Lead: {}。成员: {}。最多 {} 轮，最多 {} 个成员。",
                validated.lead.name,
                validated
                    .members
                    .iter()
                    .map(|member| member.name.as_str())
                    .collect::<Vec<_>>()
                    .join("、"),
                validated.max_turns,
                validated.max_parallel_agents
            ),
            "started",
            &validated.lead.id,
            member_ids(&validated.members),
            None,
            "running",
        ),
    )
    .await?;

    let response = emit_state_changed(&state).await?;
    let task_state = state.clone();
    tokio::spawn(async move {
        run_agent_group_room(task_state, group_id, room_run_id, thread_id, validated).await;
    });
    Ok(response)
}

fn validate_agent_group_run_request(
    request: StartAgentGroupRunRequest,
    agents: &[AgentProfile],
) -> Result<ValidatedAgentGroupRun, (StatusCode, ConversationMessage)> {
    let task = request.task.trim().to_string();
    if task.is_empty() {
        return Err(validation_error(
            StatusCode::BAD_REQUEST,
            "agent_group_empty_task",
            "任务群任务不能为空。".to_string(),
        ));
    }

    let lead_agent_id = request.lead_agent_id.trim();
    let Some(lead) = agents.iter().find(|agent| agent.id == lead_agent_id).cloned() else {
        return Err(validation_error(
            StatusCode::NOT_FOUND,
            "agent_group_lead_not_found",
            "任务群 lead agent 不存在。".to_string(),
        ));
    };

    let max_turns = request.max_turns.unwrap_or(DEFAULT_MAX_TURNS);
    if !(1..=MAX_TURNS_LIMIT).contains(&max_turns) {
        return Err(validation_error(
            StatusCode::BAD_REQUEST,
            "agent_group_invalid_max_turns",
            format!("任务群最大轮数必须在 1 到 {MAX_TURNS_LIMIT} 之间。"),
        ));
    }
    let max_parallel_agents = request
        .max_parallel_agents
        .unwrap_or(DEFAULT_MAX_PARALLEL_AGENTS);
    if !(1..=MAX_PARALLEL_AGENTS_LIMIT).contains(&max_parallel_agents) {
        return Err(validation_error(
            StatusCode::BAD_REQUEST,
            "agent_group_invalid_parallelism",
            format!("任务群并行 agent 数必须在 1 到 {MAX_PARALLEL_AGENTS_LIMIT} 之间。"),
        ));
    }

    let mut seen = BTreeSet::new();
    let mut members = Vec::new();
    for member_id in request
        .member_agent_ids
        .iter()
        .map(|member_id| member_id.trim())
        .filter(|member_id| !member_id.is_empty())
    {
        if !seen.insert(member_id.to_string()) {
            return Err(validation_error(
                StatusCode::BAD_REQUEST,
                "agent_group_duplicate_member",
                "任务群成员不能重复。".to_string(),
            ));
        }
        if member_id == lead.id {
            return Err(validation_error(
                StatusCode::BAD_REQUEST,
                "agent_group_lead_in_members",
                "Lead agent 不能同时作为成员 agent。".to_string(),
            ));
        }
        let Some(member) = agents.iter().find(|agent| agent.id == member_id).cloned() else {
            return Err(validation_error(
                StatusCode::NOT_FOUND,
                "agent_group_member_not_found",
                format!("任务群成员 agent 不存在：{member_id}"),
            ));
        };
        members.push(member);
    }

    if members.is_empty() {
        return Err(validation_error(
            StatusCode::BAD_REQUEST,
            "agent_group_empty_members",
            "任务群至少需要一个成员 agent。".to_string(),
        ));
    }
    if members.len() > max_parallel_agents as usize {
        return Err(validation_error(
            StatusCode::BAD_REQUEST,
            "agent_group_too_many_members",
            format!("任务群成员数不能超过 {max_parallel_agents}。"),
        ));
    }

    Ok(ValidatedAgentGroupRun {
        task,
        lead,
        members,
        max_turns,
        max_parallel_agents,
    })
}

async fn run_agent_group_room(
    state: GatewayState,
    group_id: String,
    room_run_id: String,
    thread_id: String,
    validated: ValidatedAgentGroupRun,
) {
    let mut member_outputs = Vec::new();
    let member_ids = member_ids(&validated.members);
    for member in &validated.members {
        let run_id = format!("group-member-{}", Uuid::new_v4().simple());
        set_member_run_status(
            &state,
            &room_run_id,
            &member.id,
            "running",
            Some(run_id.clone()),
            None,
            None,
        )
        .await;
        let _ = append_group_message_to_thread(
            &state,
            Some(&thread_id),
            conversation_agent_group_message(
                &group_id,
                &room_run_id,
                format!("{} 正在处理", member.name),
                "成员 agent 正在生成贡献。".to_string(),
                "memberRunning",
                &validated.lead.id,
                member_ids.clone(),
                Some(member.id.clone()),
                "running",
            ),
        )
        .await;

        let prompt = agent_group_member_prompt(
            &validated.task,
            &validated.lead.name,
            &member.name,
            validated.max_turns,
        );
        let result = state
            .agent_runtime
            .send_message_with_options(
                format!("{thread_id}:member:{}", member.id),
                prompt,
                agent_runtime_options_for_agent(&state, member).await,
            )
            .await;
        match result {
            Ok(result) => {
                for message in conversation_messages_for_loop_events(&result.loop_events) {
                    let _ = append_group_message_to_thread(&state, Some(&thread_id), message).await;
                }
                let summary = result.assistant_text;
                set_member_run_status(
                    &state,
                    &room_run_id,
                    &member.id,
                    "completed",
                    Some(run_id),
                    Some(summary.clone()),
                    None,
                )
                .await;
                member_outputs.push(AgentGroupMemberOutput {
                    agent_name: member.name.clone(),
                    status: "completed".to_string(),
                    content: summary.clone(),
                });
                let _ = append_group_message_to_thread(
                    &state,
                    Some(&thread_id),
                    conversation_agent_group_message(
                        &group_id,
                        &room_run_id,
                        format!("{} 已完成", member.name),
                        truncate_detail(&summary),
                        "memberCompleted",
                        &validated.lead.id,
                        member_ids.clone(),
                        Some(member.id.clone()),
                        "completed",
                    ),
                )
                .await;
            }
            Err(error) => {
                let message = error.message().to_string();
                set_member_run_status(
                    &state,
                    &room_run_id,
                    &member.id,
                    "failed",
                    Some(run_id),
                    None,
                    Some(error.code().to_string()),
                )
                .await;
                member_outputs.push(AgentGroupMemberOutput {
                    agent_name: member.name.clone(),
                    status: "failed".to_string(),
                    content: message.clone(),
                });
                let _ = append_group_message_to_thread(
                    &state,
                    Some(&thread_id),
                    conversation_agent_group_message(
                        &group_id,
                        &room_run_id,
                        format!("{} 失败", member.name),
                        message,
                        "memberFailed",
                        &validated.lead.id,
                        member_ids.clone(),
                        Some(member.id.clone()),
                        "failed",
                    ),
                )
                .await;
            }
        }
    }

    let _ = append_group_message_to_thread(
        &state,
        Some(&thread_id),
        conversation_agent_group_message(
            &group_id,
            &room_run_id,
            format!("{} 正在汇总", validated.lead.name),
            format!(
                "Lead agent 正在基于 {} 个成员贡献生成最终回复。",
                member_outputs.len()
            ),
            "leadRunning",
            &validated.lead.id,
            member_ids.clone(),
            Some(validated.lead.id.clone()),
            "running",
        ),
    )
    .await;

    let lead_prompt = agent_group_lead_prompt(&validated.task, &member_outputs);
    let lead_result = state
        .agent_runtime
        .send_message_with_options(
            thread_id.clone(),
            lead_prompt,
            agent_runtime_options_for_agent(&state, &validated.lead).await,
        )
        .await;
    match lead_result {
        Ok(result) => {
            for message in conversation_messages_for_loop_events(&result.loop_events) {
                let _ = append_group_message_to_thread(&state, Some(&thread_id), message).await;
            }
            let _ = append_group_message_to_thread(
                &state,
                Some(&thread_id),
                ConversationMessage::Assistant {
                    id: now_message_id("assistant"),
                    text: result.assistant_text.clone(),
                    status: Some("done".to_string()),
                    run_id: Some(room_run_id.clone()),
                    error_code: None,
                    created_at: "刚刚".to_string(),
                },
            )
            .await;
            finish_agent_group_run(&state, &group_id, &room_run_id, "completed").await;
        }
        Err(error) => {
            let _ = append_group_message_to_thread(
                &state,
                Some(&thread_id),
                conversation_agent_group_message(
                    &group_id,
                    &room_run_id,
                    "Lead 汇总失败",
                    error.message().to_string(),
                    "leadFailed",
                    &validated.lead.id,
                    member_ids,
                    Some(validated.lead.id.clone()),
                    "failed",
                ),
            )
            .await;
            finish_agent_group_run(&state, &group_id, &room_run_id, "failed").await;
        }
    }
}

async fn agent_runtime_options_for_agent(
    state: &GatewayState,
    agent: &AgentProfile,
) -> AgentRuntimeSendOptions {
    let confirmation_defaults = state
        .desktop_state
        .read()
        .await
        .preferences
        .confirmation_defaults
        .clone();
    AgentRuntimeSendOptions {
        model_selection: Some(model_selection_from_agent(agent)),
        tool_selection: tool_selection_from_agent(agent),
        permission_policy: Some(desktop_permission_policy(
            state,
            &agent.permission_mode,
            &confirmation_defaults,
        )),
        tool_hook_policy: None,
        system_prompt: Some(system_prompt_from_agent(agent)),
    }
}

fn agent_group_member_prompt(
    task: &str,
    lead_name: &str,
    member_name: &str,
    max_turns: u8,
) -> String {
    [
        "You are participating in a CrawClaw supervised agent group room.".to_string(),
        format!("Lead agent: {lead_name}"),
        format!("Your role: {member_name}"),
        format!("Room round budget: {max_turns}"),
        String::new(),
        "Task:".to_string(),
        task.trim().to_string(),
        String::new(),
        "Return the contribution that the lead agent should consider. Do not address the user directly unless the task asks for a draft user-facing answer.".to_string(),
    ]
    .join("\n")
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct AgentGroupMemberOutput {
    agent_name: String,
    status: String,
    content: String,
}

fn agent_group_lead_prompt(task: &str, member_outputs: &[AgentGroupMemberOutput]) -> String {
    let mut sections = vec![
        "You are the lead agent in a CrawClaw supervised agent group room.".to_string(),
        "Synthesize the member contributions into one final user-facing answer.".to_string(),
        "Call out uncertainty only when the member evidence requires it.".to_string(),
        String::new(),
        "Original task:".to_string(),
        task.trim().to_string(),
        String::new(),
        "Member contributions:".to_string(),
    ];
    for output in member_outputs {
        sections.push(format!(
            "```member\nname: {}\nstatus: {}\n{}\n```",
            output.agent_name,
            output.status,
            output.content.trim()
        ));
    }
    sections.join("\n")
}

async fn append_group_message_to_thread(
    state: &GatewayState,
    thread_id: Option<&str>,
    message: ConversationMessage,
) -> Result<(), StatusCode> {
    let title = conversation_message_title(&message);
    let content = conversation_message_content(&message);
    let thread_id = match thread_id {
        Some(thread_id) => thread_id.to_string(),
        None => {
            let desktop_state = state.desktop_state.read().await;
            active_thread_id(&desktop_state)
                .unwrap_or_else(|| format!("thread-{}", Uuid::new_v4().simple()))
        }
    };
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
        .append_desktop_message(&thread_id, "desktop", &content, Some("desktop"), desktop_message)
        .map_err(|error| session_store_status(state, error))?;
    let mut changed_active_thread = false;
    {
        let mut desktop_state = state.desktop_state.write().await;
        if active_thread_id(&desktop_state).as_deref() == Some(thread_id.as_str()) {
            desktop_state.conversation.messages.push(message);
            if !content.trim().is_empty() {
                desktop_state.conversation.result_items.push(content);
            }
            changed_active_thread = true;
        }
        if title.trim().is_empty() {
            return Ok(());
        }
    }
    if changed_active_thread {
        let _ = emit_state_changed(state).await;
    }
    Ok(())
}

fn conversation_agent_group_message(
    group_id: &str,
    room_run_id: &str,
    title: impl Into<String>,
    detail: impl Into<String>,
    stage: &str,
    lead_agent_id: &str,
    member_agent_ids: Vec<String>,
    active_agent_id: Option<String>,
    status: &str,
) -> ConversationMessage {
    ConversationMessage::AgentGroup {
        id: now_message_id("agent-group"),
        group_id: group_id.to_string(),
        room_run_id: room_run_id.to_string(),
        title: title.into(),
        detail: detail.into(),
        stage: stage.to_string(),
        lead_agent_id: lead_agent_id.to_string(),
        member_agent_ids,
        active_agent_id,
        status: status.to_string(),
        created_at: "刚刚".to_string(),
    }
}

fn validation_error(
    status: StatusCode,
    code: &str,
    detail: String,
) -> (StatusCode, ConversationMessage) {
    (
        status,
        ConversationMessage::Error {
            id: now_message_id("error"),
            code: code.to_string(),
            title: "任务群启动失败".to_string(),
            detail,
            created_at: "刚刚".to_string(),
        },
    )
}

async fn set_member_run_status(
    state: &GatewayState,
    room_run_id: &str,
    agent_id: &str,
    status: &str,
    run_id: Option<String>,
    summary: Option<String>,
    error_code: Option<String>,
) {
    {
        let mut desktop_state = state.desktop_state.write().await;
        set_member_run_status_in_state(
            &mut desktop_state,
            room_run_id,
            agent_id,
            status,
            run_id,
            summary,
            error_code,
        );
    }
    let _ = emit_state_changed(state).await;
}

fn set_member_run_status_in_state(
    desktop_state: &mut DesktopState,
    room_run_id: &str,
    agent_id: &str,
    status: &str,
    run_id: Option<String>,
    summary: Option<String>,
    error_code: Option<String>,
) {
    let Some(active_run) = desktop_state.agent_groups.active_run.as_mut() else {
        return;
    };
    if active_run.id != room_run_id {
        return;
    }
    if let Some(member_run) = active_run
        .member_runs
        .iter_mut()
        .find(|member_run| member_run.agent_id == agent_id)
    {
        member_run.status = status.to_string();
        if run_id.is_some() {
            member_run.run_id = run_id;
        }
        if summary.is_some() {
            member_run.summary = summary;
        }
        if error_code.is_some() {
            member_run.error_code = error_code;
        }
    }
}

async fn finish_agent_group_run(
    state: &GatewayState,
    group_id: &str,
    room_run_id: &str,
    status: &str,
) {
    {
        let mut desktop_state = state.desktop_state.write().await;
        if let Some(active_run) = desktop_state.agent_groups.active_run.as_mut() {
            if active_run.id == room_run_id {
                active_run.status = status.to_string();
                active_run.completed_at = Some("刚刚".to_string());
            }
        }
        set_group_summary_status(&mut desktop_state, group_id, status, "刚刚");
    }
    let _ = emit_state_changed(state).await;
}

fn set_group_summary_status(
    desktop_state: &mut DesktopState,
    group_id: &str,
    status: &str,
    last_activity_at: &str,
) {
    if let Some(group) = desktop_state
        .agent_groups
        .groups
        .iter_mut()
        .find(|group| group.id == group_id)
    {
        group.status = status.to_string();
        group.last_activity_at = last_activity_at.to_string();
    }
}

fn member_ids(members: &[AgentProfile]) -> Vec<String> {
    members.iter().map(|member| member.id.clone()).collect()
}

fn now_message_id(prefix: &str) -> String {
    format!("{prefix}-{}", Uuid::new_v4().simple())
}

fn truncate_detail(value: &str) -> String {
    let trimmed = value.trim();
    let mut detail = trimmed.chars().take(180).collect::<String>();
    if trimmed.chars().count() > 180 {
        detail.push_str("...");
    }
    detail
}

#[cfg(test)]
fn enabled_tool(id: &str) -> crate::models::AgentTool {
    use crate::models::AgentTool;

    AgentTool {
        id: id.to_string(),
        name: id.to_string(),
        description: String::new(),
        status: "ready".to_string(),
        permission: "workspace".to_string(),
        icon: "wrench".to_string(),
        open: false,
        enabled: true,
    }
}

#[cfg(test)]
fn test_agent(id: &str, name: &str) -> AgentProfile {
    use crate::models::{
        AgentAvatarProfile, AgentEmotionProfile, AgentSkill, AgentVoiceConfig,
    };

    AgentProfile {
        id: id.to_string(),
        name: name.to_string(),
        role: "Agent".to_string(),
        description: String::new(),
        status: "ready".to_string(),
        model: "configured".to_string(),
        thinking: "medium".to_string(),
        permission_mode: "工作区模式".to_string(),
        emotion: AgentEmotionProfile {
            style: "neutral".to_string(),
            tone: "direct".to_string(),
            boundaries: Vec::new(),
            prompt_md: String::new(),
        },
        voice: AgentVoiceConfig {
            enabled: false,
            input_enabled: false,
            output_enabled: false,
            wake_enabled: false,
            source: String::new(),
            preset_voice: String::new(),
            design_prompt: String::new(),
            clone_voice_name: String::new(),
            clone_sample_name: String::new(),
            style: String::new(),
            pace: String::new(),
        },
        channels: Vec::new(),
        avatar: AgentAvatarProfile {
            initials: name.chars().take(2).collect(),
            gradient: "blue".to_string(),
            image_data_url: None,
            source: None,
        },
        tools: vec![enabled_tool("read")],
        skills: Vec::<AgentSkill>::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::gateway::desktop_state::initial_desktop_state;
    use crate::models::{RuntimeCompatStatus, RuntimeStatus, RuntimeStatusValue};
    use axum::extract::State;
    use axum::http::HeaderMap;
    use axum::Json;
    use crawclaw_runtime::{AgentRuntimeToolSelection, RuntimeLayout};

    #[test]
    fn desktop_agent_group_routes_reject_duplicate_members() {
        let agents = vec![test_agent("lead", "Lead"), test_agent("member", "Member")];
        let result = validate_agent_group_run_request(
            StartAgentGroupRunRequest {
                task: "Do it".to_string(),
                lead_agent_id: "lead".to_string(),
                member_agent_ids: vec!["member".to_string(), "member".to_string()],
                max_turns: None,
                max_parallel_agents: None,
            },
            &agents,
        );

        assert!(matches!(result, Err((StatusCode::BAD_REQUEST, _))));
    }

    #[test]
    fn desktop_agent_group_routes_reject_missing_lead() {
        let agents = vec![test_agent("member", "Member")];
        let result = validate_agent_group_run_request(
            StartAgentGroupRunRequest {
                task: "Do it".to_string(),
                lead_agent_id: "lead".to_string(),
                member_agent_ids: vec!["member".to_string()],
                max_turns: None,
                max_parallel_agents: None,
            },
            &agents,
        );

        assert!(matches!(result, Err((StatusCode::NOT_FOUND, _))));
    }

    #[test]
    fn desktop_agent_group_routes_reject_lead_as_member() {
        let agents = vec![test_agent("lead", "Lead"), test_agent("member", "Member")];
        let result = validate_agent_group_run_request(
            StartAgentGroupRunRequest {
                task: "Do it".to_string(),
                lead_agent_id: "lead".to_string(),
                member_agent_ids: vec!["lead".to_string()],
                max_turns: None,
                max_parallel_agents: None,
            },
            &agents,
        );

        assert!(matches!(result, Err((StatusCode::BAD_REQUEST, _))));
    }

    #[test]
    fn desktop_agent_group_routes_derive_default_group() {
        let mut state = initial_desktop_state(&RuntimeStatus {
            status: RuntimeStatusValue::Ready,
            detail: "ready".to_string(),
            runtime_root: "/tmp/crawclaw-test".to_string(),
            binary_path: "/tmp/crawclaw-test/bin/crawclaw-runtime".to_string(),
            compat: RuntimeCompatStatus::default(),
        });
        state.agent_workspace.selected_agent_id = "lead".to_string();
        state.agent_workspace.agents = vec![
            test_agent("lead", "Lead"),
            test_agent("member-a", "Member A"),
            test_agent("member-b", "Member B"),
        ];

        sync_agent_group_workspace(&mut state);

        assert_eq!(state.agent_groups.selected_group_id, DEFAULT_AGENT_GROUP_ID);
        assert_eq!(state.agent_groups.groups.len(), 1);
        assert_eq!(state.agent_groups.groups[0].lead_agent_id, "lead");
        assert_eq!(
            state.agent_groups.groups[0].member_agent_ids,
            vec!["member-a".to_string(), "member-b".to_string()]
        );
    }

    #[tokio::test]
    async fn desktop_agent_group_routes_place_group_threads_in_discussions() {
        let state = super::super::build_state(
            "CrawClaw Desktop".to_string(),
            "test".to_string(),
            "http://127.0.0.1:1".to_string(),
            "session".to_string(),
            test_runtime_layout("agent-group-discussion-thread"),
        )
        .await;
        {
            let mut desktop_state = state.desktop_state.write().await;
            desktop_state.agent_workspace.selected_agent_id = "lead".to_string();
            desktop_state.agent_workspace.agents = vec![
                test_agent("lead", "Lead"),
                test_agent("member", "Member"),
            ];
            sync_agent_group_workspace(&mut desktop_state);
        }
        let mut headers = HeaderMap::new();
        headers.insert("x-crawclaw-desktop-session", "session".parse().unwrap());

        let Json(desktop_state) = start_agent_group_run(
            State(state),
            headers,
            Json(StartAgentGroupRunRequest {
                task: "Draft rollout".to_string(),
                lead_agent_id: "lead".to_string(),
                member_agent_ids: vec!["member".to_string()],
                max_turns: Some(1),
                max_parallel_agents: Some(1),
            }),
        )
        .await
        .expect("start group run");

        assert!(desktop_state.sidebar.threads.is_empty());
        assert_eq!(desktop_state.sidebar.discussion_threads.len(), 1);
        assert_eq!(
            desktop_state.sidebar.discussion_threads[0].id,
            desktop_state.agent_groups.active_run.expect("active run").thread_id
        );
        assert!(desktop_state.sidebar.discussion_threads[0].active);
    }

    #[test]
    fn agent_group_member_prompt_contains_task_and_role() {
        let prompt = agent_group_member_prompt("Draft rollout", "Lead", "Reviewer", 4);

        assert!(prompt.contains("Lead agent: Lead"));
        assert!(prompt.contains("Your role: Reviewer"));
        assert!(prompt.contains("Draft rollout"));
        assert!(prompt.contains("Room round budget: 4"));
    }

    #[test]
    fn agent_group_lead_prompt_contains_member_outputs() {
        let prompt = agent_group_lead_prompt(
            "Ship this",
            &[AgentGroupMemberOutput {
                agent_name: "Planner".to_string(),
                status: "completed".to_string(),
                content: "Use staged rollout".to_string(),
            }],
        );

        assert!(prompt.contains("Original task:"));
        assert!(prompt.contains("Ship this"));
        assert!(prompt.contains("name: Planner"));
        assert!(prompt.contains("Use staged rollout"));
    }

    #[test]
    fn agent_group_state_marks_failed_member_without_stopping_room() {
        let mut state = initial_desktop_state(&RuntimeStatus {
            status: RuntimeStatusValue::Ready,
            detail: "ready".to_string(),
            runtime_root: "/tmp/crawclaw-test".to_string(),
            binary_path: "/tmp/crawclaw-test/bin/crawclaw-runtime".to_string(),
            compat: RuntimeCompatStatus::default(),
        });
        state.agent_groups.active_run = Some(AgentGroupRunState {
            id: "run-1".to_string(),
            group_id: DEFAULT_AGENT_GROUP_ID.to_string(),
            thread_id: "thread-1".to_string(),
            task: "Task".to_string(),
            lead_agent_id: "lead".to_string(),
            member_runs: vec![AgentGroupMemberRunState {
                agent_id: "member".to_string(),
                status: "running".to_string(),
                run_id: None,
                summary: None,
                error_code: None,
            }],
            status: "running".to_string(),
            created_at: "刚刚".to_string(),
            completed_at: None,
        });

        set_member_run_status_in_state(
            &mut state,
            "run-1",
            "member",
            "failed",
            Some("member-run-1".to_string()),
            None,
            Some("provider_failed".to_string()),
        );

        let active_run = state.agent_groups.active_run.expect("active run");
        assert_eq!(active_run.status, "running");
        assert_eq!(active_run.member_runs[0].status, "failed");
        assert_eq!(
            active_run.member_runs[0].error_code.as_deref(),
            Some("provider_failed")
        );
    }

    #[test]
    fn desktop_agent_group_routes_agent_options_use_agent_tool_selection() {
        let agent = test_agent("member", "Member");
        assert!(matches!(
            tool_selection_from_agent(&agent),
            AgentRuntimeToolSelection::AllowList(_)
        ));
    }

    fn test_runtime_layout(name: &str) -> RuntimeLayout {
        let runtime_root =
            std::env::temp_dir().join(format!("crawclaw-desktop-{name}-{}", Uuid::new_v4()));
        RuntimeLayout {
            binary_path: runtime_root.join("bin").join("crawclaw-runtime"),
            channel_manifest_path: runtime_root.join("channels").join("manifest.json"),
            manifest_path: runtime_root.join("runtimes").join("manifest.json"),
            runtime_root,
        }
    }
}
