use std::convert::Infallible;

use axum::extract::{Query, State};
use axum::http::StatusCode;
use axum::response::sse::{Event, KeepAlive, Sse};
use axum::Json;
use futures_util::{stream, StreamExt};
use serde::Deserialize;
use serde_json::{json, Value};
use tokio::sync::broadcast;

use super::{authorize_token, runtime_status_value, GatewayState};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct GatewayEventsQuery {
    token: Option<String>,
}

pub(super) async fn runtime_status(State(state): State<GatewayState>) -> Json<Value> {
    Json(runtime_status_value(&state))
}

pub(super) async fn gateway_bootstrap(State(state): State<GatewayState>) -> Json<Value> {
    Json(json!({
        "app": {
            "name": "CrawClaw",
            "version": env!("CARGO_PKG_VERSION")
        },
        "api": {
            "eventsUrl": "/api/gateway/events",
            "rpcUrl": "/api/gateway/rpc"
        },
        "runtime": runtime_status_value(&state),
        "state": gateway_state_value(&state)
    }))
}

pub(super) async fn gateway_state(State(state): State<GatewayState>) -> Json<Value> {
    Json(gateway_state_value(&state))
}

pub(super) async fn events(
    State(state): State<GatewayState>,
    Query(query): Query<GatewayEventsQuery>,
) -> Result<Sse<impl futures_util::Stream<Item = Result<Event, Infallible>>>, StatusCode> {
    authorize_token(query.token.as_deref(), &state)?;
    let initial_data =
        serde_json::to_string(&runtime_status_value(&state)).unwrap_or_else(|_| "{}".to_string());
    let initial_stream =
        stream::once(
            async move { Ok(Event::default().event("runtimeChanged").data(initial_data)) },
        );
    let receiver = state.events.subscribe();
    let updates = stream::unfold(receiver, |mut receiver| async move {
        loop {
            match receiver.recv().await {
                Ok(event) => return Some((Ok(json_event_to_sse(event)), receiver)),
                Err(broadcast::error::RecvError::Lagged(_)) => continue,
                Err(broadcast::error::RecvError::Closed) => return None,
            }
        }
    });
    Ok(Sse::new(initial_stream.chain(updates)).keep_alive(KeepAlive::default()))
}

fn gateway_state_value(state: &GatewayState) -> Value {
    let sessions = state.session_store.list_summaries().unwrap_or_default();
    json!({
        "sessions": sessions,
        "runtime": {
            "implementation": "rust-native",
            "jsPluginRuntime": "none"
        }
    })
}

fn json_event_to_sse(event: Value) -> Event {
    let event_type = event
        .get("type")
        .and_then(Value::as_str)
        .unwrap_or("stateChanged")
        .to_string();
    let data = serde_json::to_string(event.get("payload").unwrap_or(&Value::Null))
        .unwrap_or_else(|_| "null".to_string());
    Event::default().event(event_type).data(data)
}
