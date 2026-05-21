use axum::extract::{Path, State};
use axum::http::{HeaderMap, StatusCode};
use axum::Json;
use serde::Deserialize;

use crate::models::DesktopState;

use super::{authorize_headers, emit_state_changed, persist_desktop_preferences, GatewayState};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct PreferencesPatch {
    selected_model: Option<String>,
    selected_thinking: Option<String>,
    permission_mode: Option<String>,
}

pub(super) async fn update_preferences(
    State(state): State<GatewayState>,
    headers: HeaderMap,
    Json(payload): Json<PreferencesPatch>,
) -> Result<Json<DesktopState>, StatusCode> {
    authorize_headers(&headers, &state)?;
    let updated_preferences = {
        let desktop_state = state.desktop_state.read().await;
        let mut preferences = desktop_state.preferences.clone();
        if let Some(model) = payload.selected_model {
            preferences.selected_model = model;
        }
        if let Some(thinking) = payload.selected_thinking {
            preferences.selected_thinking = thinking;
        }
        if let Some(permission_mode) = payload.permission_mode {
            preferences.permission_mode = permission_mode;
        }
        preferences
    };
    persist_desktop_preferences(&state, &updated_preferences)?;
    {
        let mut desktop_state = state.desktop_state.write().await;
        desktop_state.preferences = updated_preferences;
    }
    emit_state_changed(&state).await
}

pub(super) async fn select_agent(
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
            desktop_state.agent_workspace.selected_agent_id = agent_id.clone();
            desktop_state.memory_workspace.selected_agent_id = agent_id;
        }
    }
    emit_state_changed(&state).await
}
