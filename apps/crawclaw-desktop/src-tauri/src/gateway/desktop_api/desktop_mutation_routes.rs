use axum::body::Bytes;
use axum::extract::{Path, State};
use axum::http::{HeaderMap, StatusCode};
use axum::Json;

use crate::models::DesktopState;

use super::{
    authorize_headers, parse_json_body, run_native_state_mutation, with_string,
    DesktopNativeMutation, GatewayState, ThreadMutation, ToggleMutation,
};

async fn run_body_mutation(
    state: GatewayState,
    headers: HeaderMap,
    body: Bytes,
    operation: DesktopNativeMutation,
    path_fields: Vec<(&'static str, String)>,
) -> Result<Json<DesktopState>, StatusCode> {
    authorize_headers(&headers, &state)?;
    let mut input = parse_json_body(body)?;
    for (key, value) in path_fields {
        input = with_string(input, key, &value);
    }
    run_native_state_mutation(&state, operation, input).await
}

pub(super) async fn add_plugin_skill(
    State(state): State<GatewayState>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<Json<DesktopState>, StatusCode> {
    run_body_mutation(
        state,
        headers,
        body,
        DesktopNativeMutation::AddPluginSkill,
        Vec::new(),
    )
    .await
}

pub(super) async fn remove_plugin_skill(
    State(state): State<GatewayState>,
    headers: HeaderMap,
    Path(skill_id): Path<String>,
    body: Bytes,
) -> Result<Json<DesktopState>, StatusCode> {
    run_body_mutation(
        state,
        headers,
        body,
        DesktopNativeMutation::RemovePluginSkill,
        vec![("skillId", skill_id)],
    )
    .await
}

pub(super) async fn toggle_plugin_skill(
    State(state): State<GatewayState>,
    headers: HeaderMap,
    Path(skill_id): Path<String>,
    body: Bytes,
) -> Result<Json<DesktopState>, StatusCode> {
    run_body_mutation(
        state,
        headers,
        body,
        DesktopNativeMutation::Toggle(ToggleMutation::PluginSkill),
        vec![("skillId", skill_id)],
    )
    .await
}

pub(super) async fn toggle_plugin_tool(
    State(state): State<GatewayState>,
    headers: HeaderMap,
    Path(tool_id): Path<String>,
    body: Bytes,
) -> Result<Json<DesktopState>, StatusCode> {
    run_body_mutation(
        state,
        headers,
        body,
        DesktopNativeMutation::Toggle(ToggleMutation::PluginTool),
        vec![("toolId", tool_id)],
    )
    .await
}

pub(super) async fn set_plugin_tool_enabled_route(
    State(state): State<GatewayState>,
    headers: HeaderMap,
    Path(tool_id): Path<String>,
    body: Bytes,
) -> Result<Json<DesktopState>, StatusCode> {
    run_body_mutation(
        state,
        headers,
        body,
        DesktopNativeMutation::SetPluginToolEnabled,
        vec![("toolId", tool_id)],
    )
    .await
}

pub(super) async fn set_plugin_skill_enabled_route(
    State(state): State<GatewayState>,
    headers: HeaderMap,
    Path(skill_id): Path<String>,
    body: Bytes,
) -> Result<Json<DesktopState>, StatusCode> {
    run_body_mutation(
        state,
        headers,
        body,
        DesktopNativeMutation::SetPluginSkillEnabled,
        vec![("skillId", skill_id)],
    )
    .await
}

pub(super) async fn invoke_plugin_tool(
    State(state): State<GatewayState>,
    headers: HeaderMap,
    Path((plugin_id, tool_id)): Path<(String, String)>,
    body: Bytes,
) -> Result<Json<DesktopState>, StatusCode> {
    run_body_mutation(
        state,
        headers,
        body,
        DesktopNativeMutation::InvokePluginTool,
        vec![("pluginId", plugin_id), ("toolId", tool_id)],
    )
    .await
}

pub(super) async fn create_agent(
    State(state): State<GatewayState>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<Json<DesktopState>, StatusCode> {
    run_body_mutation(
        state,
        headers,
        body,
        DesktopNativeMutation::CreateAgent,
        Vec::new(),
    )
    .await
}

pub(super) async fn add_attachment_message(
    State(state): State<GatewayState>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<Json<DesktopState>, StatusCode> {
    run_body_mutation(
        state,
        headers,
        body,
        DesktopNativeMutation::AddAttachmentMessage,
        Vec::new(),
    )
    .await
}

pub(super) async fn add_media_message(
    State(state): State<GatewayState>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<Json<DesktopState>, StatusCode> {
    run_body_mutation(
        state,
        headers,
        body,
        DesktopNativeMutation::AddMediaMessage,
        Vec::new(),
    )
    .await
}

pub(super) async fn add_voice_message(
    State(state): State<GatewayState>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<Json<DesktopState>, StatusCode> {
    run_body_mutation(
        state,
        headers,
        body,
        DesktopNativeMutation::AddVoiceMessage,
        Vec::new(),
    )
    .await
}

pub(super) async fn add_workflow_message(
    State(state): State<GatewayState>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<Json<DesktopState>, StatusCode> {
    run_body_mutation(
        state,
        headers,
        body,
        DesktopNativeMutation::AddWorkflowMessage,
        Vec::new(),
    )
    .await
}

pub(super) async fn add_skill_call_message(
    State(state): State<GatewayState>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<Json<DesktopState>, StatusCode> {
    run_body_mutation(
        state,
        headers,
        body,
        DesktopNativeMutation::AddSkillCallMessage,
        Vec::new(),
    )
    .await
}

pub(super) async fn update_agent(
    State(state): State<GatewayState>,
    headers: HeaderMap,
    Path(agent_id): Path<String>,
    body: Bytes,
) -> Result<Json<DesktopState>, StatusCode> {
    run_body_mutation(
        state,
        headers,
        body,
        DesktopNativeMutation::UpdateAgent,
        vec![("agentId", agent_id)],
    )
    .await
}

pub(super) async fn toggle_agent_tool(
    State(state): State<GatewayState>,
    headers: HeaderMap,
    Path((agent_id, tool_id)): Path<(String, String)>,
    body: Bytes,
) -> Result<Json<DesktopState>, StatusCode> {
    run_body_mutation(
        state,
        headers,
        body,
        DesktopNativeMutation::Toggle(ToggleMutation::AgentTool),
        vec![("agentId", agent_id), ("toolId", tool_id)],
    )
    .await
}

pub(super) async fn add_agent_skill(
    State(state): State<GatewayState>,
    headers: HeaderMap,
    Path(agent_id): Path<String>,
    body: Bytes,
) -> Result<Json<DesktopState>, StatusCode> {
    run_body_mutation(
        state,
        headers,
        body,
        DesktopNativeMutation::AddAgentSkill,
        vec![("agentId", agent_id)],
    )
    .await
}

pub(super) async fn toggle_agent_skill(
    State(state): State<GatewayState>,
    headers: HeaderMap,
    Path((agent_id, skill_id)): Path<(String, String)>,
    body: Bytes,
) -> Result<Json<DesktopState>, StatusCode> {
    run_body_mutation(
        state,
        headers,
        body,
        DesktopNativeMutation::Toggle(ToggleMutation::AgentSkill),
        vec![("agentId", agent_id), ("skillId", skill_id)],
    )
    .await
}

pub(super) async fn pin_thread(
    State(state): State<GatewayState>,
    headers: HeaderMap,
    Path(thread_id): Path<String>,
    body: Bytes,
) -> Result<Json<DesktopState>, StatusCode> {
    run_body_mutation(
        state,
        headers,
        body,
        DesktopNativeMutation::Thread(ThreadMutation::Pin),
        vec![("threadId", thread_id)],
    )
    .await
}

pub(super) async fn unpin_thread(
    State(state): State<GatewayState>,
    headers: HeaderMap,
    Path(thread_id): Path<String>,
    body: Bytes,
) -> Result<Json<DesktopState>, StatusCode> {
    run_body_mutation(
        state,
        headers,
        body,
        DesktopNativeMutation::Thread(ThreadMutation::Unpin),
        vec![("threadId", thread_id)],
    )
    .await
}

pub(super) async fn rename_thread_route(
    State(state): State<GatewayState>,
    headers: HeaderMap,
    Path(thread_id): Path<String>,
    body: Bytes,
) -> Result<Json<DesktopState>, StatusCode> {
    run_body_mutation(
        state,
        headers,
        body,
        DesktopNativeMutation::Thread(ThreadMutation::Rename),
        vec![("threadId", thread_id)],
    )
    .await
}

pub(super) async fn archive_thread(
    State(state): State<GatewayState>,
    headers: HeaderMap,
    Path(thread_id): Path<String>,
    body: Bytes,
) -> Result<Json<DesktopState>, StatusCode> {
    run_body_mutation(
        state,
        headers,
        body,
        DesktopNativeMutation::Thread(ThreadMutation::Archive),
        vec![("threadId", thread_id)],
    )
    .await
}

pub(super) async fn create_memory_item(
    State(state): State<GatewayState>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<Json<DesktopState>, StatusCode> {
    run_body_mutation(
        state,
        headers,
        body,
        DesktopNativeMutation::CreateMemoryItem,
        Vec::new(),
    )
    .await
}

pub(super) async fn update_memory_item(
    State(state): State<GatewayState>,
    headers: HeaderMap,
    Path(item_id): Path<String>,
    body: Bytes,
) -> Result<Json<DesktopState>, StatusCode> {
    run_body_mutation(
        state,
        headers,
        body,
        DesktopNativeMutation::UpdateMemoryItem,
        vec![("itemId", item_id)],
    )
    .await
}

pub(super) async fn archive_memory_item(
    State(state): State<GatewayState>,
    headers: HeaderMap,
    Path(item_id): Path<String>,
    body: Bytes,
) -> Result<Json<DesktopState>, StatusCode> {
    run_body_mutation(
        state,
        headers,
        body,
        DesktopNativeMutation::ArchiveMemoryItem,
        vec![("itemId", item_id)],
    )
    .await
}

pub(super) async fn run_memory_dream(
    State(state): State<GatewayState>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<Json<DesktopState>, (StatusCode, Json<DesktopState>)> {
    if let Err(status) = authorize_headers(&headers, &state) {
        return Err(state_error_response(&state, status).await);
    }
    let input = match parse_json_body(body) {
        Ok(input) => input,
        Err(status) => return Err(state_error_response(&state, status).await),
    };
    match run_native_state_mutation(&state, DesktopNativeMutation::RunMemoryDream, input).await {
        Ok(state) => Ok(state),
        Err(status) => Err(state_error_response(&state, status).await),
    }
}

async fn state_error_response(
    state: &GatewayState,
    status: StatusCode,
) -> (StatusCode, Json<DesktopState>) {
    let desktop_state = state.desktop_state.read().await.clone();
    (status, Json(desktop_state))
}

pub(super) async fn abort_message(
    State(state): State<GatewayState>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<Json<DesktopState>, StatusCode> {
    run_body_mutation(
        state,
        headers,
        body,
        DesktopNativeMutation::AbortMessage,
        Vec::new(),
    )
    .await
}

pub(super) async fn steer_message(
    State(state): State<GatewayState>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<Json<DesktopState>, StatusCode> {
    run_body_mutation(
        state,
        headers,
        body,
        DesktopNativeMutation::SteerMessage,
        Vec::new(),
    )
    .await
}
