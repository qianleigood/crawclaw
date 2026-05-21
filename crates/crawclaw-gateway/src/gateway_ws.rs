use super::*;

pub(super) async fn ws(
    ws: WebSocketUpgrade,
    State(state): State<GatewayState>,
) -> impl IntoResponse {
    ws.on_upgrade(move |socket| handle_ws(socket, state))
}

pub(super) async fn handle_ws(socket: WebSocket, state: GatewayState) {
    let nonce = format!("rust-{}", now_millis());
    let (mut sender, mut receiver) = socket.split();
    let _ = sender
        .send(Message::Text(
            json!({
                "type": "event",
                "event": "connect.challenge",
                "payload": { "nonce": nonce }
            })
            .to_string()
            .into(),
        ))
        .await;

    let mut connected = false;
    let mut gateway_events = state.events.subscribe();
    let mut session_events_subscribed = false;
    let mut session_message_subscriptions = BTreeSet::<String>::new();
    loop {
        tokio::select! {
            message = receiver.next() => {
                let Some(message) = message else {
                    break;
                };
                let Ok(message) = message else {
                    break;
                };
                let Message::Text(raw) = message else {
                    continue;
                };
                let request = match serde_json::from_str::<GatewayWsRequest>(&raw) {
                    Ok(request) if request.frame_type == "req" => request,
                    Ok(request) => {
                        let _ = send_ws_error(
                            &mut sender,
                            &request.id,
                            "INVALID_REQUEST",
                            "unsupported gateway frame type",
                        )
                        .await;
                        continue;
                    }
                    Err(error) => {
                        let _ = send_ws_event(
                            &mut sender,
                            "operationFailed",
                            json!({ "message": format!("invalid gateway frame: {error}") }),
                        )
                        .await;
                        continue;
                    }
                };

                if request.method == "connect" {
                    match authorize_connect(&state, &request.params) {
                        Ok(()) => {
                            connected = true;
                            let hello = hello_ok(&state);
                            let _ = send_ws_ok(&mut sender, &request.id, hello).await;
                        }
                        Err(message) => {
                            let _ = send_ws_error(&mut sender, &request.id, "UNAUTHORIZED", &message).await;
                        }
                    }
                    continue;
                }

                if !connected {
                    let _ = send_ws_error(
                        &mut sender,
                        &request.id,
                        "UNAUTHORIZED",
                        "gateway connect is required before requests",
                    )
                    .await;
                    continue;
                }

                let method = request.method.clone();
                match handle_gateway_method(&state, &method, request.params).await {
                    Ok(payload) => {
                        apply_ws_subscription_state(
                            &method,
                            &payload,
                            &mut session_events_subscribed,
                            &mut session_message_subscriptions,
                        );
                        let _ = send_ws_ok(&mut sender, &request.id, payload).await;
                    }
                    Err(message) => {
                        let _ = send_ws_error(&mut sender, &request.id, "UNAVAILABLE", &message).await;
                    }
                }
            }
            event = gateway_events.recv(), if connected => {
                let Ok(event) = event else {
                    continue;
                };
                if !should_forward_ws_event(&event, session_events_subscribed, &session_message_subscriptions) {
                    continue;
                }
                let event_type = event.get("type").and_then(Value::as_str).unwrap_or("event");
                let payload = event.get("payload").cloned().unwrap_or(Value::Null);
                if send_ws_event(&mut sender, event_type, payload).await.is_err() {
                    break;
                }
            }
        }
    }
}

pub(super) async fn send_ws_ok<S>(
    socket: &mut S,
    id: &str,
    payload: Value,
) -> Result<(), axum::Error>
where
    S: Sink<Message, Error = axum::Error> + Unpin,
{
    socket
        .send(Message::Text(
            json!({
                "type": "res",
                "id": id,
                "ok": true,
                "payload": payload
            })
            .to_string()
            .into(),
        ))
        .await
}

pub(super) async fn send_ws_error<S>(
    socket: &mut S,
    id: &str,
    code: &str,
    message: &str,
) -> Result<(), axum::Error>
where
    S: Sink<Message, Error = axum::Error> + Unpin,
{
    socket
        .send(Message::Text(
            json!({
                "type": "res",
                "id": id,
                "ok": false,
                "error": {
                    "code": code,
                    "message": message
                }
            })
            .to_string()
            .into(),
        ))
        .await
}

pub(super) async fn send_ws_event<S>(
    socket: &mut S,
    event: &str,
    payload: Value,
) -> Result<(), axum::Error>
where
    S: Sink<Message, Error = axum::Error> + Unpin,
{
    socket
        .send(Message::Text(
            json!({
                "type": "event",
                "event": event,
                "payload": payload
            })
            .to_string()
            .into(),
        ))
        .await
}

pub(super) fn apply_ws_subscription_state(
    method: &str,
    payload: &Value,
    session_events_subscribed: &mut bool,
    session_message_subscriptions: &mut BTreeSet<String>,
) {
    match method {
        "sessions.subscribe" => *session_events_subscribed = true,
        "sessions.unsubscribe" => *session_events_subscribed = false,
        "sessions.messages.subscribe" => {
            if let Some(key) = payload.get("key").and_then(Value::as_str) {
                session_message_subscriptions.insert(key.to_string());
            }
        }
        "sessions.messages.unsubscribe" => {
            if let Some(key) = payload.get("key").and_then(Value::as_str) {
                session_message_subscriptions.remove(key);
            }
        }
        _ => {}
    }
}

pub(super) fn should_forward_ws_event(
    event: &Value,
    session_events_subscribed: bool,
    session_message_subscriptions: &BTreeSet<String>,
) -> bool {
    match event
        .get("type")
        .and_then(Value::as_str)
        .unwrap_or_default()
    {
        "session.message" => event
            .get("payload")
            .and_then(|payload| payload.get("sessionKey"))
            .and_then(Value::as_str)
            .map(|session_key| session_message_subscriptions.contains(session_key))
            .unwrap_or(false),
        "sessions.changed" => session_events_subscribed,
        _ => true,
    }
}
