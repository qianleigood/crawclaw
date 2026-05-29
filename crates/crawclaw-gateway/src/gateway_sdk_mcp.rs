use super::*;

pub(super) async fn control_sdk_mcp_message(
    state: &GatewayState,
    server_name: String,
    message: Value,
) -> Result<Value, String> {
    let transport = state
        .sdk_mcp_transports
        .lock()
        .map_err(|_| "SDK MCP transport store lock poisoned".to_string())?
        .get(&server_name)
        .cloned()
        .ok_or_else(|| {
            format!(
                "SDK MCP server \"{server_name}\" is registered, but no live SDK WebSocket transport is attached."
            )
        })?;
    let request_id = format!("sdk-mcp-{}", now_millis());
    let expects_response = message.get("id").is_some();
    let (response_tx, response_rx) = oneshot::channel();
    transport
        .sender
        .send(SdkMcpOutboundRequest {
            request_id: request_id.clone(),
            server_name: server_name.clone(),
            message,
            response: response_tx,
        })
        .map_err(|_| format!("SDK MCP server \"{server_name}\" transport is disconnected"))?;
    let response = tokio::time::timeout(Duration::from_secs(60), response_rx)
        .await
        .map_err(|_| format!("SDK MCP server \"{server_name}\" did not respond before timeout"))?
        .map_err(|_| format!("SDK MCP server \"{server_name}\" transport closed"))??;
    match response.get("mcp_response").cloned() {
        Some(response) => Ok(json!({ "mcp_response": response })),
        None if !expects_response => Ok(json!({})),
        None => Err(format!(
            "SDK MCP server \"{server_name}\" response did not include mcp_response"
        )),
    }
}

pub(super) fn register_sdk_mcp_transport(
    state: &GatewayState,
    connection_id: &str,
    sender: mpsc::UnboundedSender<SdkMcpOutboundRequest>,
    servers: Vec<String>,
) -> Result<BTreeSet<String>, String> {
    let registered = state
        .sdk_mcp_servers
        .lock()
        .map_err(|_| "SDK MCP server store lock poisoned".to_string())?
        .keys()
        .cloned()
        .collect::<BTreeSet<_>>();
    let mut transports = state
        .sdk_mcp_transports
        .lock()
        .map_err(|_| "SDK MCP transport store lock poisoned".to_string())?;
    transports.retain(|_, transport| transport.connection_id != connection_id);
    let mut active = BTreeSet::new();
    for server in servers {
        if !registered.contains(&server) {
            continue;
        }
        active.insert(server.clone());
        transports.insert(
            server,
            SdkMcpTransport {
                connection_id: connection_id.to_string(),
                sender: sender.clone(),
            },
        );
    }
    Ok(active)
}

pub(super) fn unregister_sdk_mcp_transport(
    state: &GatewayState,
    connection_id: &str,
) -> Result<(), String> {
    state
        .sdk_mcp_transports
        .lock()
        .map_err(|_| "SDK MCP transport store lock poisoned".to_string())?
        .retain(|_, transport| transport.connection_id != connection_id);
    Ok(())
}

pub(super) fn register_sdk_control_transport(
    state: &GatewayState,
    connection_id: &str,
    sender: mpsc::UnboundedSender<SdkControlOutboundRequest>,
) -> Result<(), String> {
    *state
        .sdk_control_transport
        .lock()
        .map_err(|_| "SDK control transport store lock poisoned".to_string())? =
        Some(SdkControlTransport {
            connection_id: connection_id.to_string(),
            sender,
        });
    Ok(())
}

pub(super) fn unregister_sdk_control_transport(
    state: &GatewayState,
    connection_id: &str,
) -> Result<(), String> {
    let mut transport = state
        .sdk_control_transport
        .lock()
        .map_err(|_| "SDK control transport store lock poisoned".to_string())?;
    if transport
        .as_ref()
        .is_some_and(|transport| transport.connection_id == connection_id)
    {
        *transport = None;
    }
    Ok(())
}

pub(super) async fn control_sdk_outbound_request(
    state: &GatewayState,
    request: Value,
    timeout_ms: u64,
) -> Result<Value, String> {
    let transport = state
        .sdk_control_transport
        .lock()
        .map_err(|_| "SDK control transport store lock poisoned".to_string())?
        .clone()
        .ok_or_else(|| "No live SDK control transport is attached".to_string())?;
    let request_id = format!("sdk-control-{}", now_millis());
    let (response_tx, response_rx) = oneshot::channel();
    transport
        .sender
        .send(SdkControlOutboundRequest {
            request_id: request_id.clone(),
            request,
            response: response_tx,
        })
        .map_err(|_| "SDK control transport is disconnected".to_string())?;
    tokio::time::timeout(Duration::from_millis(timeout_ms.max(1)), response_rx)
        .await
        .map_err(|_| "SDK control request did not respond before timeout".to_string())?
        .map_err(|_| "SDK control transport closed".to_string())?
}

pub(super) fn is_sdk_control_transport_connected(state: &GatewayState) -> bool {
    state
        .sdk_control_transport
        .lock()
        .map(|transport| transport.is_some())
        .unwrap_or(false)
}

pub(super) fn is_sdk_mcp_transport_connected(state: &GatewayState, server_name: &str) -> bool {
    state
        .sdk_mcp_transports
        .lock()
        .map(|transports| transports.contains_key(server_name))
        .unwrap_or(false)
}

pub(super) fn sdk_mcp_servers_from_initialize_params(params: &Value) -> Vec<String> {
    params
        .get("sdkMcpServers")
        .and_then(Value::as_array)
        .map(|servers| {
            servers
                .iter()
                .filter_map(Value::as_str)
                .map(str::trim)
                .filter(|name| !name.is_empty())
                .map(ToOwned::to_owned)
                .collect()
        })
        .unwrap_or_default()
}

pub(super) fn sdk_mcp_servers_from_control_request(frame: &Value) -> Vec<String> {
    let Some(request) = frame.get("request") else {
        return Vec::new();
    };
    if request.get("subtype").and_then(Value::as_str) != Some("initialize") {
        return Vec::new();
    }
    sdk_mcp_servers_from_initialize_params(request)
}

pub(super) fn sdk_control_response_is_success(frame: &Value) -> bool {
    frame
        .get("response")
        .and_then(|response| response.get("subtype"))
        .and_then(Value::as_str)
        == Some("success")
}

pub(super) fn sdk_frame_is_initialize(frame: &Value) -> bool {
    frame
        .get("request")
        .and_then(|request| request.get("subtype"))
        .and_then(Value::as_str)
        == Some("initialize")
}

pub(super) fn sdk_method_is_initialize(method: &str, params: &Value) -> bool {
    if method == "initialize" {
        return true;
    }
    matches!(method, "control_request" | "sdk.control_request") && sdk_frame_is_initialize(params)
}

pub(super) fn take_sdk_mcp_control_response(
    pending: &mut BTreeMap<String, oneshot::Sender<Result<Value, String>>>,
    frame: &Value,
) -> bool {
    let Some(response) = frame.get("response") else {
        return false;
    };
    let Some(request_id) = response
        .get("request_id")
        .or_else(|| response.get("requestId"))
        .and_then(Value::as_str)
    else {
        return false;
    };
    let Some(sender) = pending.remove(request_id) else {
        return false;
    };
    let result = match response.get("subtype").and_then(Value::as_str) {
        Some("success") => Ok(response
            .get("response")
            .cloned()
            .unwrap_or_else(|| json!({}))),
        Some("error") => Err(response
            .get("error")
            .and_then(Value::as_str)
            .unwrap_or("SDK MCP control request failed")
            .to_string()),
        _ => Err("SDK MCP control response subtype must be success or error".to_string()),
    };
    let _ = sender.send(result);
    true
}

pub(super) async fn send_sdk_outbound_control_request<S>(
    socket: &mut S,
    request: &SdkControlOutboundRequest,
) -> Result<(), axum::Error>
where
    S: Sink<Message, Error = axum::Error> + Unpin,
{
    socket
        .send(Message::Text(
            json!({
                "type": "control_request",
                "request_id": request.request_id,
                "request": request.request
            })
            .to_string()
            .into(),
        ))
        .await
}

pub(super) async fn send_sdk_mcp_control_request<S>(
    socket: &mut S,
    request: &SdkMcpOutboundRequest,
) -> Result<(), axum::Error>
where
    S: Sink<Message, Error = axum::Error> + Unpin,
{
    socket
        .send(Message::Text(
            json!({
                "type": "control_request",
                "request_id": request.request_id,
                "request": {
                    "subtype": "mcp_message",
                    "server_name": request.server_name,
                    "message": request.message
                }
            })
            .to_string()
            .into(),
        ))
        .await
}
