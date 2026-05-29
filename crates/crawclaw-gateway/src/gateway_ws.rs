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
    let connection_id = format!("sdk-ws-{}", now_millis());
    let (sdk_mcp_tx, mut sdk_mcp_rx) = mpsc::unbounded_channel::<SdkMcpOutboundRequest>();
    let (sdk_control_tx, mut sdk_control_rx) =
        mpsc::unbounded_channel::<SdkControlOutboundRequest>();
    let mut pending_sdk_mcp_requests =
        BTreeMap::<String, oneshot::Sender<Result<Value, String>>>::new();
    let mut pending_sdk_control_requests =
        BTreeMap::<String, oneshot::Sender<Result<Value, String>>>::new();
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
                let raw_value = match serde_json::from_str::<Value>(&raw) {
                    Ok(value) => value,
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
                if let Some(control_type) = raw_value.get("type").and_then(Value::as_str) {
                    match control_type {
                        "keep_alive" => continue,
                        "control_request" => {
                            let request_id = string_param(&raw_value, &["request_id", "requestId"])
                                .unwrap_or_else(|| format!("gateway-control-{}", now_millis()));
                            let sdk_mcp_servers =
                                sdk_mcp_servers_from_control_request(&raw_value);
                            let response = if connected {
                                claude_control_request(&state, raw_value.clone()).await.unwrap_or_else(|error| {
                                    claude_control_error_response(request_id, error)
                                })
                            } else {
                                claude_control_error_response(
                                    request_id,
                                    "gateway connect is required before SDK control messages"
                                        .to_string(),
                                )
                            };
                            if !sdk_mcp_servers.is_empty()
                                && sdk_control_response_is_success(&response)
                            {
                                if let Err(message) = register_sdk_mcp_transport(
                                    &state,
                                    &connection_id,
                                    sdk_mcp_tx.clone(),
                                    sdk_mcp_servers,
                                ) {
                                    let _ = send_ws_event(
                                        &mut sender,
                                        "operationFailed",
                                        json!({ "message": message }),
                                    )
                                    .await;
                                }
                            }
                            if sdk_frame_is_initialize(&raw_value)
                                && sdk_control_response_is_success(&response)
                            {
                                if let Err(message) = register_sdk_control_transport(
                                    &state,
                                    &connection_id,
                                    sdk_control_tx.clone(),
                                ) {
                                    let _ = send_ws_event(
                                        &mut sender,
                                        "operationFailed",
                                        json!({ "message": message }),
                                    )
                                    .await;
                                }
                            }
                            if sender.send(Message::Text(response.to_string().into())).await.is_err()
                            {
                                break;
                            }
                            continue;
                        }
                        "control_response" => {
                            if connected {
                                if take_sdk_mcp_control_response(
                                    &mut pending_sdk_control_requests,
                                    &raw_value,
                                ) {
                                    continue;
                                }
                                let _ = take_sdk_mcp_control_response(
                                    &mut pending_sdk_mcp_requests,
                                    &raw_value,
                                );
                            }
                            continue;
                        }
                        "control_cancel_request" => {
                            if connected {
                                let _ = control_cancel_request(&state, raw_value);
                            } else {
                                let _ = send_ws_event(
                                    &mut sender,
                                    "operationFailed",
                                    json!({ "message": "gateway connect is required before SDK control messages" }),
                                )
                                .await;
                            }
                            continue;
                        }
                        "update_environment_variables" => {
                            if connected {
                                if let Err(message) =
                                    control_update_environment_variables(raw_value)
                                {
                                    let _ = send_ws_event(
                                        &mut sender,
                                        "operationFailed",
                                        json!({ "message": message }),
                                    )
                                    .await;
                                }
                            } else {
                                let _ = send_ws_event(
                                    &mut sender,
                                    "operationFailed",
                                    json!({ "message": "gateway connect is required before SDK control messages" }),
                                )
                                .await;
                            }
                            continue;
                        }
                        _ => {}
                    }
                }
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
                let sdk_mcp_servers = if method == "initialize" {
                    sdk_mcp_servers_from_initialize_params(&request.params)
                } else if matches!(method.as_str(), "control_request" | "sdk.control_request") {
                    sdk_mcp_servers_from_control_request(&request.params)
                } else {
                    Vec::new()
                };
                let is_sdk_initialize_method = sdk_method_is_initialize(&method, &request.params);
                match handle_gateway_method(&state, &method, request.params).await {
                    Ok(payload) => {
                        let can_register_sdk_mcp = !matches!(
                            method.as_str(),
                            "control_request" | "sdk.control_request"
                        ) || sdk_control_response_is_success(&payload);
                        if !sdk_mcp_servers.is_empty() && can_register_sdk_mcp {
                            if let Err(message) = register_sdk_mcp_transport(
                                &state,
                                &connection_id,
                                sdk_mcp_tx.clone(),
                                sdk_mcp_servers,
                            ) {
                                let _ = send_ws_event(
                                    &mut sender,
                                    "operationFailed",
                                    json!({ "message": message }),
                                )
                                .await;
                            }
                        }
                        if is_sdk_initialize_method
                            && (method == "initialize" || can_register_sdk_mcp)
                        {
                            if let Err(message) = register_sdk_control_transport(
                                &state,
                                &connection_id,
                                sdk_control_tx.clone(),
                            ) {
                                let _ = send_ws_event(
                                    &mut sender,
                                    "operationFailed",
                                    json!({ "message": message }),
                                )
                                .await;
                            }
                        }
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
            sdk_mcp_request = sdk_mcp_rx.recv(), if connected => {
                let Some(request) = sdk_mcp_request else {
                    break;
                };
                let request_id = request.request_id.clone();
                if let Err(error) = send_sdk_mcp_control_request(&mut sender, &request).await {
                    let _ = request.response.send(Err(format!(
                        "failed to send SDK MCP control request: {error}"
                    )));
                    break;
                }
                pending_sdk_mcp_requests.insert(request_id, request.response);
            }
            sdk_control_request = sdk_control_rx.recv(), if connected => {
                let Some(request) = sdk_control_request else {
                    break;
                };
                let request_id = request.request_id.clone();
                if let Err(error) = send_sdk_outbound_control_request(&mut sender, &request).await {
                    let _ = request.response.send(Err(format!(
                        "failed to send SDK control request: {error}"
                    )));
                    break;
                }
                pending_sdk_control_requests.insert(request_id, request.response);
            }
        }
    }
    let _ = unregister_sdk_mcp_transport(&state, &connection_id);
    let _ = unregister_sdk_control_transport(&state, &connection_id);
    for (_, response) in pending_sdk_control_requests {
        let _ = response.send(Err("SDK WebSocket disconnected".to_string()));
    }
    for (_, response) in pending_sdk_mcp_requests {
        let _ = response.send(Err("SDK MCP WebSocket disconnected".to_string()));
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
