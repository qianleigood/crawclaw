use axum::body::Bytes;
use axum::extract::{Path, State};
use axum::http::{HeaderMap, StatusCode};
use axum::Json;

use crate::models::DesktopState;

use super::{
    authorize_headers, parse_json_body, run_native_state_mutation, with_string, GatewayState,
};

async fn run_body_mutation(
    state: GatewayState,
    headers: HeaderMap,
    body: Bytes,
    operation: &'static str,
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
    run_body_mutation(state, headers, body, "add_plugin_skill", Vec::new()).await
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
        "toggle_plugin_skill",
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
        "toggle_plugin_tool",
        vec![("toolId", tool_id)],
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
        "invoke_plugin_tool",
        vec![("pluginId", plugin_id), ("toolId", tool_id)],
    )
    .await
}

pub(super) async fn create_agent(
    State(state): State<GatewayState>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<Json<DesktopState>, StatusCode> {
    run_body_mutation(state, headers, body, "create_agent", Vec::new()).await
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
        "update_agent",
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
        "toggle_agent_tool",
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
        "add_agent_skill",
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
        "toggle_agent_skill",
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
        "pin_thread",
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
        "unpin_thread",
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
        "rename_thread",
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
        "archive_thread",
        vec![("threadId", thread_id)],
    )
    .await
}

pub(super) async fn create_memory_item(
    State(state): State<GatewayState>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<Json<DesktopState>, StatusCode> {
    run_body_mutation(state, headers, body, "create_memory_item", Vec::new()).await
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
        "update_memory_item",
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
        "archive_memory_item",
        vec![("itemId", item_id)],
    )
    .await
}

pub(super) async fn run_memory_dream(
    State(state): State<GatewayState>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<Json<DesktopState>, StatusCode> {
    run_body_mutation(state, headers, body, "run_memory_dream", Vec::new()).await
}

pub(super) async fn abort_message(
    State(state): State<GatewayState>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<Json<DesktopState>, StatusCode> {
    run_body_mutation(state, headers, body, "abort_message", Vec::new()).await
}

pub(super) async fn steer_message(
    State(state): State<GatewayState>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<Json<DesktopState>, StatusCode> {
    run_body_mutation(state, headers, body, "steer_message", Vec::new()).await
}
