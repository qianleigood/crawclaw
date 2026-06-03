use std::collections::BTreeSet;
use std::convert::Infallible;

use axum::extract::{Path, Query, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::sse::{Event, KeepAlive, Sse};
use axum::Json;
use futures_util::{stream, StreamExt};
use serde::Deserialize;
use serde_json::json;
use tokio::sync::broadcast;

use crate::models::{
    BootstrapResponse, DesktopEvent, DesktopState, PermissionStatus, RuntimeEvent, RuntimeStatus,
    SearchSuggestion,
};

use super::{
    apply_session_conversation, authorize_headers, authorize_token,
    clear_active_thread_conversation, desktop_state_snapshot, emit_state_changed,
    run_native_state_mutation, session_store_status, upsert_permission_message,
    DesktopNativeMutation, GatewayState,
};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct EventsQuery {
    session_token: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct SearchQuery {
    q: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct SelectNavRequest {
    nav_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct SendMessageRequest {
    text: String,
    agent_id: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct SelectThreadRequest {
    thread_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct PermissionDecisionRequest {
    pub(super) decision: PermissionStatus,
}

pub(super) async fn bootstrap(State(state): State<GatewayState>) -> Json<BootstrapResponse> {
    let runtime = state.runtime_supervisor.status();
    let desktop_state = desktop_state_snapshot(&state).await;
    Json(BootstrapResponse {
        app: state.app.clone(),
        api: state.api.clone(),
        runtime,
        desktop_state,
    })
}

pub(super) async fn desktop_state(State(state): State<GatewayState>) -> Json<DesktopState> {
    Json(desktop_state_snapshot(&state).await)
}

pub(super) async fn runtime_status(State(state): State<GatewayState>) -> Json<RuntimeStatus> {
    Json(state.runtime_supervisor.status())
}

pub(super) async fn search(
    State(state): State<GatewayState>,
    Query(query): Query<SearchQuery>,
) -> Json<Vec<SearchSuggestion>> {
    let normalized_query = query.q.unwrap_or_default().trim().to_lowercase();
    let desktop_state = state.desktop_state.read().await;
    let mut suggestions = Vec::new();
    let mut seen = BTreeSet::new();
    for item in &desktop_state.search_suggestions {
        push_search_suggestion(
            &mut suggestions,
            &mut seen,
            &normalized_query,
            item.clone(),
            &format!("{} {}", item.label, item.meta),
        );
    }
    for thread in desktop_state
        .sidebar
        .pinned_threads
        .iter()
        .chain(desktop_state.sidebar.threads.iter())
        .chain(desktop_state.sidebar.discussion_threads.iter())
    {
        push_search_suggestion(
            &mut suggestions,
            &mut seen,
            &normalized_query,
            SearchSuggestion {
                id: format!("thread:{}", thread.id),
                label: thread.title.clone(),
                meta: "对话".to_string(),
                icon: "messageCircle".to_string(),
                target_nav_id: "new-chat".to_string(),
                target_item_id: Some(thread.id.clone()),
            },
            &format!("{} {}", thread.title, thread.time),
        );
    }
    for agent in &desktop_state.agent_workspace.agents {
        push_search_suggestion(
            &mut suggestions,
            &mut seen,
            &normalized_query,
            SearchSuggestion {
                id: format!("agent:{}", agent.id),
                label: agent.name.clone(),
                meta: format!("智能体 · {}", agent.role),
                icon: "bot".to_string(),
                target_nav_id: "agent".to_string(),
                target_item_id: Some(agent.id.clone()),
            },
            &format!("{} {} {}", agent.name, agent.role, agent.description),
        );
    }
    for memory in desktop_state
        .memory_workspace
        .items
        .iter()
        .filter(|item| !item.archived)
    {
        push_search_suggestion(
            &mut suggestions,
            &mut seen,
            &normalized_query,
            SearchSuggestion {
                id: format!("memory:{}", memory.id),
                label: memory.title.clone(),
                meta: format!("记忆 · {}", memory.category),
                icon: "brain".to_string(),
                target_nav_id: "memory".to_string(),
                target_item_id: Some(memory.id.clone()),
            },
            &format!(
                "{} {} {} {}",
                memory.title,
                memory.summary,
                memory.content,
                memory.tags.join(" ")
            ),
        );
    }
    for skill in &desktop_state.plugins_workspace.skills {
        push_search_suggestion(
            &mut suggestions,
            &mut seen,
            &normalized_query,
            SearchSuggestion {
                id: format!("skill:{}", skill.id),
                label: skill.name.clone(),
                meta: format!("Skill · {}", skill.trigger),
                icon: skill.icon.clone(),
                target_nav_id: "plugins".to_string(),
                target_item_id: Some(skill.id.clone()),
            },
            &format!("{} {} {}", skill.name, skill.trigger, skill.description),
        );
    }
    for tool in &desktop_state.plugins_workspace.tools {
        push_search_suggestion(
            &mut suggestions,
            &mut seen,
            &normalized_query,
            SearchSuggestion {
                id: format!("tool:{}", tool.id),
                label: tool.name.clone(),
                meta: "工具".to_string(),
                icon: tool.icon.clone(),
                target_nav_id: "plugins".to_string(),
                target_item_id: Some(tool.id.clone()),
            },
            &format!("{} {} {}", tool.name, tool.permission, tool.description),
        );
    }

    Json(suggestions)
}

fn push_search_suggestion(
    suggestions: &mut Vec<SearchSuggestion>,
    seen: &mut BTreeSet<String>,
    normalized_query: &str,
    suggestion: SearchSuggestion,
    haystack: &str,
) {
    if !normalized_query.is_empty()
        && !haystack.to_lowercase().contains(normalized_query)
        && !suggestion.label.to_lowercase().contains(normalized_query)
        && !suggestion.meta.to_lowercase().contains(normalized_query)
    {
        return;
    }
    if seen.insert(suggestion.id.clone()) {
        suggestions.push(suggestion);
    }
}

pub(super) async fn events(
    State(state): State<GatewayState>,
    Query(query): Query<EventsQuery>,
) -> Result<Sse<impl futures_util::Stream<Item = Result<Event, Infallible>>>, StatusCode> {
    authorize_token(query.session_token.as_deref(), &state)?;

    let runtime = state.runtime_supervisor.status();
    let initial_event = RuntimeEvent {
        event_type: "runtime",
        status: runtime.status,
        detail: runtime.detail,
    };
    let initial_data = serde_json::to_string(&initial_event).unwrap_or_else(|_| "{}".to_string());
    let initial_stream = stream::once(async move {
        Ok(Event::default()
            .event(initial_event.event_type)
            .data(initial_data))
    });
    let receiver = state.events.subscribe();
    let updates = stream::unfold(receiver, |mut receiver| async move {
        loop {
            match receiver.recv().await {
                Ok(event) => return Some((Ok(event_to_sse(event)), receiver)),
                Err(broadcast::error::RecvError::Lagged(_)) => continue,
                Err(broadcast::error::RecvError::Closed) => return None,
            }
        }
    });

    Ok(Sse::new(initial_stream.chain(updates)).keep_alive(KeepAlive::default()))
}

pub(super) async fn select_nav(
    State(state): State<GatewayState>,
    headers: HeaderMap,
    Json(payload): Json<SelectNavRequest>,
) -> Result<Json<DesktopState>, StatusCode> {
    authorize_headers(&headers, &state)?;
    {
        let mut desktop_state = state.desktop_state.write().await;
        let selectable = payload.nav_id == "settings"
            || desktop_state
                .sidebar
                .nav_items
                .iter()
                .any(|item| item.id == payload.nav_id && item.id != "search");
        if selectable {
            desktop_state.active_nav_id = payload.nav_id;
            if desktop_state.active_nav_id == "new-chat" {
                clear_active_thread_conversation(&mut desktop_state);
                state
                    .session_store
                    .clear_active_thread()
                    .map_err(|error| session_store_status(&state, error))?;
            }
        }
    }
    emit_state_changed(&state).await
}

pub(super) async fn send_message(
    State(state): State<GatewayState>,
    headers: HeaderMap,
    Json(payload): Json<SendMessageRequest>,
) -> Result<Json<DesktopState>, StatusCode> {
    authorize_headers(&headers, &state)?;
    let text = payload.text.trim();
    if text.is_empty() {
        return Err(StatusCode::BAD_REQUEST);
    }
    tracing::info!(
        runtime_root = %state.runtime_root.display(),
        has_agent = payload.agent_id.is_some(),
        text_len = text.len(),
        "desktop_send_message_requested"
    );
    run_native_state_mutation(
        &state,
        DesktopNativeMutation::SendMessage,
        json!({ "text": text, "agentId": payload.agent_id }),
    )
    .await
}

pub(super) async fn select_thread(
    State(state): State<GatewayState>,
    headers: HeaderMap,
    Json(payload): Json<SelectThreadRequest>,
) -> Result<Json<DesktopState>, StatusCode> {
    authorize_headers(&headers, &state)?;
    let selected_session = state
        .session_store
        .load_session(&payload.thread_id)
        .map_err(|error| session_store_status(&state, error))?;
    {
        let mut desktop_state = state.desktop_state.write().await;
        desktop_state.active_nav_id = "new-chat".to_string();
        for thread in desktop_state.sidebar.pinned_threads.iter_mut() {
            thread.active = thread.id == payload.thread_id;
        }
        for thread in desktop_state.sidebar.threads.iter_mut() {
            thread.active = thread.id == payload.thread_id;
        }
        for thread in desktop_state.sidebar.discussion_threads.iter_mut() {
            thread.active = thread.id == payload.thread_id;
        }
        if let Some(session) = selected_session {
            state
                .session_store
                .set_active_thread(&session.thread_id)
                .map_err(|error| session_store_status(&state, error))?;
            apply_session_conversation(&mut desktop_state, &session.thread_id, &session);
        }
    }
    emit_state_changed(&state).await
}

pub(super) async fn permission_decision(
    State(state): State<GatewayState>,
    headers: HeaderMap,
    Path(request_id): Path<String>,
    Json(payload): Json<PermissionDecisionRequest>,
) -> Result<Json<DesktopState>, StatusCode> {
    authorize_headers(&headers, &state)?;
    let permission_request = {
        let desktop_state = state.desktop_state.read().await;
        if desktop_state.permission_request.id != request_id {
            return Err(StatusCode::NOT_FOUND);
        }
        let mut permission_request = desktop_state.permission_request.clone();
        permission_request.status = payload.decision;
        permission_request
    };
    {
        let mut desktop_state = state.desktop_state.write().await;
        desktop_state.permission_request = permission_request.clone();
        upsert_permission_message(&mut desktop_state, &permission_request);
    }
    if let Some(waiter) = state.permission_waiters.lock().await.remove(&request_id) {
        let _ = waiter.send(permission_request.status.clone());
    }
    let _ = state
        .events
        .send(DesktopEvent::PermissionChanged { permission_request });
    emit_state_changed(&state).await
}

fn event_to_sse(event: DesktopEvent) -> Event {
    let event_name = match &event {
        DesktopEvent::Runtime { .. } => "runtime",
        DesktopEvent::RuntimeChanged { .. } => "runtimeChanged",
        DesktopEvent::SessionStarted { .. } => "sessionStarted",
        DesktopEvent::MessageDelta { .. } => "messageDelta",
        DesktopEvent::ToolCall { .. } => "toolCall",
        DesktopEvent::ToolResult { .. } => "toolResult",
        DesktopEvent::MessageFinal { .. } => "messageFinal",
        DesktopEvent::PermissionRequested { .. } => "permissionRequested",
        DesktopEvent::OperationFailed { .. } => "operationFailed",
        DesktopEvent::StateChanged { .. } => "stateChanged",
        DesktopEvent::PermissionChanged { .. } => "permissionChanged",
    };
    let data = serde_json::to_string(&event).unwrap_or_else(|_| "{}".to_string());
    Event::default().event(event_name).data(data)
}
