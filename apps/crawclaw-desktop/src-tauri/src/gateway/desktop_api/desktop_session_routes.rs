use axum::extract::{Path, Query, State};
use axum::http::{HeaderMap, StatusCode};
use axum::Json;
use serde::Deserialize;
use serde_json::{json, Value};

use crate::models::{DesktopEvent, SidebarThread};

use super::{active_thread_id, authorize_headers, session_store_status, GatewayState};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct SessionSpawnRequest {
    task: String,
    label: Option<String>,
    parent_session_key: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct SessionSendRequest {
    session_key: String,
    message: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct SessionYieldRequest {
    session_key: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct SubagentsQuery {
    parent_session_key: Option<String>,
}

pub(super) async fn list_sessions(
    State(state): State<GatewayState>,
    headers: HeaderMap,
) -> Result<Json<Value>, StatusCode> {
    authorize_headers(&headers, &state)?;
    let sessions = state
        .session_store
        .list_summaries()
        .map_err(|error| session_store_status(&state, error))?;
    Ok(Json(json!({ "sessions": sessions })))
}

pub(super) async fn session_history(
    State(state): State<GatewayState>,
    headers: HeaderMap,
    Path(thread_id): Path<String>,
) -> Result<Json<Value>, StatusCode> {
    authorize_headers(&headers, &state)?;
    let messages = state
        .session_store
        .session_history(&thread_id)
        .map_err(|error| session_store_status(&state, error))?;
    Ok(Json(json!({
        "sessionKey": thread_id,
        "messages": messages
    })))
}

pub(super) async fn spawn_session(
    State(state): State<GatewayState>,
    headers: HeaderMap,
    Json(payload): Json<SessionSpawnRequest>,
) -> Result<Json<Value>, StatusCode> {
    authorize_headers(&headers, &state)?;
    let task = payload.task.trim();
    if task.is_empty() {
        return Err(StatusCode::BAD_REQUEST);
    }
    let label = payload
        .label
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let parent = payload
        .parent_session_key
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let session = state
        .session_store
        .spawn_session(parent, label, task)
        .map_err(|error| session_store_status(&state, error))?;
    {
        let mut desktop_state = state.desktop_state.write().await;
        desktop_state.sidebar.discussion_threads.insert(
            0,
            SidebarThread {
                id: session.key.clone(),
                title: session.title.clone(),
                time: "子 agent".to_string(),
                active: false,
                agent_avatar: true,
            },
        );
    }
    let _ = state.events.send(DesktopEvent::SessionStarted {
        thread_id: session.key.clone(),
    });
    let _ = state.events.send(DesktopEvent::StateChanged {
        desktop_state: state.desktop_state.read().await.clone(),
    });
    Ok(Json(json!({ "status": "spawned", "session": session })))
}

pub(super) async fn send_session(
    State(state): State<GatewayState>,
    headers: HeaderMap,
    Json(payload): Json<SessionSendRequest>,
) -> Result<Json<Value>, StatusCode> {
    authorize_headers(&headers, &state)?;
    let session_key = payload.session_key.trim();
    let message = payload.message.trim();
    if session_key.is_empty() || message.is_empty() {
        return Err(StatusCode::BAD_REQUEST);
    }
    let session = state
        .session_store
        .send_to_session(session_key, message)
        .map_err(|error| session_store_status(&state, error))?;
    {
        let mut desktop_state = state.desktop_state.write().await;
        if active_thread_id(&desktop_state).as_deref() == Some(session_key) {
            desktop_state
                .conversation
                .result_items
                .push(format!("用户: {message}"));
        }
    }
    let _ = state.events.send(DesktopEvent::MessageFinal {
        thread_id: session.key.clone(),
        role: "user".to_string(),
        text: message.to_string(),
    });
    let _ = state.events.send(DesktopEvent::StateChanged {
        desktop_state: state.desktop_state.read().await.clone(),
    });
    Ok(Json(json!({ "status": "sent", "session": session })))
}

pub(super) async fn yield_session(
    State(state): State<GatewayState>,
    headers: HeaderMap,
    Json(payload): Json<SessionYieldRequest>,
) -> Result<Json<Value>, StatusCode> {
    authorize_headers(&headers, &state)?;
    let session_key = payload.session_key.trim();
    if session_key.is_empty() {
        return Err(StatusCode::BAD_REQUEST);
    }
    let session = state
        .session_store
        .mark_session_yielded(session_key)
        .map_err(|error| session_store_status(&state, error))?;
    let _ = state.events.send(DesktopEvent::StateChanged {
        desktop_state: state.desktop_state.read().await.clone(),
    });
    Ok(Json(json!({ "status": "yielded", "session": session })))
}

pub(super) async fn list_subagents(
    State(state): State<GatewayState>,
    headers: HeaderMap,
    Query(query): Query<SubagentsQuery>,
) -> Result<Json<Value>, StatusCode> {
    authorize_headers(&headers, &state)?;
    let parent = query
        .parent_session_key
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let subagents = state
        .session_store
        .list_subagents(parent)
        .map_err(|error| session_store_status(&state, error))?;
    Ok(Json(json!({ "subagents": subagents })))
}
