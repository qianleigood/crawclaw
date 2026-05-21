use axum::extract::{Path, State};
use axum::http::{HeaderMap, StatusCode};
use axum::Json;
use serde::Deserialize;

use crate::models::DesktopState;

use super::{authorize_headers, emit_state_changed, GatewayState};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct MemoryQueryPatch {
    query: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct MemoryFilterPatch {
    filter: String,
}

pub(super) async fn select_memory_item(
    State(state): State<GatewayState>,
    headers: HeaderMap,
    Path(item_id): Path<String>,
) -> Result<Json<DesktopState>, StatusCode> {
    authorize_headers(&headers, &state)?;
    {
        let mut desktop_state = state.desktop_state.write().await;
        if desktop_state
            .memory_workspace
            .items
            .iter()
            .any(|item| item.id == item_id)
        {
            desktop_state.memory_workspace.selected_item_id = item_id;
        }
    }
    emit_state_changed(&state).await
}

pub(super) async fn select_memory_agent(
    State(state): State<GatewayState>,
    headers: HeaderMap,
    Path(agent_id): Path<String>,
) -> Result<Json<DesktopState>, StatusCode> {
    authorize_headers(&headers, &state)?;
    {
        let mut desktop_state = state.desktop_state.write().await;
        if desktop_state
            .agent_workspace
            .agents
            .iter()
            .any(|agent| agent.id == agent_id)
        {
            desktop_state.memory_workspace.selected_agent_id = agent_id;
        }
    }
    emit_state_changed(&state).await
}

pub(super) async fn set_memory_query(
    State(state): State<GatewayState>,
    headers: HeaderMap,
    Json(payload): Json<MemoryQueryPatch>,
) -> Result<Json<DesktopState>, StatusCode> {
    authorize_headers(&headers, &state)?;
    {
        let mut desktop_state = state.desktop_state.write().await;
        desktop_state.memory_workspace.query = payload.query;
    }
    emit_state_changed(&state).await
}

pub(super) async fn set_memory_filter(
    State(state): State<GatewayState>,
    headers: HeaderMap,
    Json(payload): Json<MemoryFilterPatch>,
) -> Result<Json<DesktopState>, StatusCode> {
    authorize_headers(&headers, &state)?;
    {
        let mut desktop_state = state.desktop_state.write().await;
        desktop_state.memory_workspace.filter = payload.filter;
    }
    emit_state_changed(&state).await
}
