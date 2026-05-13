use serde_json::{json, Map, Value};

const DEFAULT_AGENT_ID: &str = "main";
const DEFAULT_MAIN_KEY: &str = "main";
const DEFAULT_ACCOUNT_ID: &str = "default";

pub fn execute_message_policy_operation(input: Value) -> Result<Value, String> {
    let operation = input
        .get("operation")
        .and_then(Value::as_str)
        .ok_or_else(|| "message_policy.operation is required".to_string())?;
    let payload = input.get("payload").cloned().unwrap_or_else(|| json!({}));
    match operation {
        "session.normalizeAgentId" => Ok(json!({
            "agentId": normalize_agent_id(value_string(payload.get("agentId")).as_deref())
        })),
        "session.buildAgentPeerSessionKey" => Ok(json!({
            "sessionKey": build_agent_peer_session_key(&payload)
        })),
        "session.resolveThreadSessionKeys" => resolve_thread_session_keys(&payload),
        "outbound.enforceCrossContextPolicy" => enforce_cross_context_policy(&payload),
        "outbound.buildDeliveryRequest" => build_delivery_request(&payload),
        "outbound.resolveFallbackSessionRoute" => resolve_fallback_session_route(&payload),
        "outbound.resolveReplyRoutingDecision" => resolve_reply_routing_decision(&payload),
        "outbound.resolveTypingPolicy" => resolve_typing_policy(&payload),
        "command.resolveControlCommandGate" => resolve_control_command_gate(&payload),
        "command.resolveDualTextControlCommandGate" => {
            resolve_dual_text_control_command_gate(&payload)
        }
        "inbound.finalizeContext" => finalize_inbound_context(&payload),
        "transcript.validateAppend" => validate_transcript_append(&payload),
        other => Err(format!("unsupported message_policy operation: {other}")),
    }
}

fn value_string(value: Option<&Value>) -> Option<String> {
    value
        .and_then(|value| match value {
            Value::String(text) => Some(text.trim().to_string()),
            Value::Number(number) => Some(number.to_string()),
            Value::Bool(value) => Some(value.to_string()),
            _ => None,
        })
        .filter(|value| !value.is_empty())
}

fn normalize_token(value: Option<&Value>) -> String {
    value_string(value).unwrap_or_default().to_lowercase()
}

fn value_string_array(value: Option<&Value>) -> Vec<String> {
    value
        .and_then(Value::as_array)
        .map(|values| {
            values
                .iter()
                .filter_map(|value| value_string(Some(value)))
                .collect()
        })
        .unwrap_or_default()
}

fn normalize_agent_id(value: Option<&str>) -> String {
    normalize_safe_id(value, DEFAULT_AGENT_ID)
}

fn normalize_account_id(value: Option<&str>) -> String {
    normalize_safe_id(value, DEFAULT_ACCOUNT_ID)
}

fn normalize_safe_id(value: Option<&str>, fallback: &str) -> String {
    let trimmed = value.unwrap_or_default().trim();
    if trimmed.is_empty() {
        return fallback.to_string();
    }
    let lowered = trimmed.to_lowercase();
    if is_valid_safe_id(&lowered) && !is_blocked_object_key(&lowered) {
        return lowered;
    }
    let mut normalized = String::new();
    let mut previous_dash = false;
    for ch in lowered.chars() {
        let valid = ch.is_ascii_alphanumeric() || ch == '_' || ch == '-';
        let next = if valid { ch } else { '-' };
        if next == '-' {
            if !previous_dash {
                normalized.push(next);
            }
            previous_dash = true;
        } else {
            normalized.push(next);
            previous_dash = false;
        }
        if normalized.len() >= 64 {
            break;
        }
    }
    let normalized = normalized.trim_matches('-').to_string();
    if normalized.is_empty() || is_blocked_object_key(&normalized) {
        fallback.to_string()
    } else {
        normalized
    }
}

fn is_valid_safe_id(value: &str) -> bool {
    let mut chars = value.chars();
    let Some(first) = chars.next() else {
        return false;
    };
    if !first.is_ascii_alphanumeric() {
        return false;
    }
    value.len() <= 64 && chars.all(|ch| ch.is_ascii_alphanumeric() || ch == '_' || ch == '-')
}

fn is_blocked_object_key(value: &str) -> bool {
    matches!(value, "__proto__" | "prototype" | "constructor")
}

fn normalize_main_key(value: Option<&Value>) -> String {
    let raw = normalize_token(value);
    if raw.is_empty() {
        DEFAULT_MAIN_KEY.to_string()
    } else {
        raw
    }
}

fn build_agent_main_session_key(agent_id: &str, main_key: Option<&Value>) -> String {
    format!(
        "agent:{}:{}",
        normalize_agent_id(Some(agent_id)),
        normalize_main_key(main_key)
    )
}

fn build_agent_peer_session_key(payload: &Value) -> String {
    let agent_id = value_string(payload.get("agentId")).unwrap_or_else(|| DEFAULT_AGENT_ID.into());
    let peer_kind = normalize_token(payload.get("peerKind"));
    let peer_kind = if peer_kind.is_empty() {
        "direct"
    } else {
        peer_kind.as_str()
    };
    if peer_kind == "direct" {
        let dm_scope = value_string(payload.get("dmScope")).unwrap_or_else(|| "main".into());
        let mut peer_id = value_string(payload.get("peerId")).unwrap_or_default();
        if dm_scope != "main" {
            if let Some(linked) = resolve_linked_peer_id(
                payload.get("identityLinks"),
                value_string(payload.get("channel"))
                    .as_deref()
                    .unwrap_or_default(),
                &peer_id,
            ) {
                peer_id = linked;
            }
        }
        let peer_id = peer_id.trim().to_lowercase();
        if dm_scope == "per-account-channel-peer" && !peer_id.is_empty() {
            let channel = normalize_token(payload.get("channel"));
            let channel = if channel.is_empty() {
                "unknown".to_string()
            } else {
                channel
            };
            let account_id =
                normalize_account_id(value_string(payload.get("accountId")).as_deref());
            return format!(
                "agent:{}:{channel}:{account_id}:direct:{peer_id}",
                normalize_agent_id(Some(&agent_id))
            );
        }
        if dm_scope == "per-channel-peer" && !peer_id.is_empty() {
            let channel = normalize_token(payload.get("channel"));
            let channel = if channel.is_empty() {
                "unknown".to_string()
            } else {
                channel
            };
            return format!(
                "agent:{}:{channel}:direct:{peer_id}",
                normalize_agent_id(Some(&agent_id))
            );
        }
        if dm_scope == "per-peer" && !peer_id.is_empty() {
            return format!(
                "agent:{}:direct:{peer_id}",
                normalize_agent_id(Some(&agent_id))
            );
        }
        return build_agent_main_session_key(&agent_id, payload.get("mainKey"));
    }

    let channel = normalize_token(payload.get("channel"));
    let channel = if channel.is_empty() {
        "unknown".to_string()
    } else {
        channel
    };
    let peer_id = value_string(payload.get("peerId"))
        .unwrap_or_else(|| "unknown".into())
        .to_lowercase();
    let peer_id = if peer_id.is_empty() {
        "unknown".to_string()
    } else {
        peer_id
    };
    format!(
        "agent:{}:{channel}:{peer_kind}:{peer_id}",
        normalize_agent_id(Some(&agent_id))
    )
}

fn resolve_linked_peer_id(
    identity_links: Option<&Value>,
    channel: &str,
    peer_id: &str,
) -> Option<String> {
    let links = identity_links?.as_object()?;
    let peer_id = peer_id.trim();
    if peer_id.is_empty() {
        return None;
    }
    let raw = peer_id.to_lowercase();
    let scoped = if channel.trim().is_empty() {
        None
    } else {
        Some(format!("{}:{peer_id}", channel.trim().to_lowercase()).to_lowercase())
    };
    for (canonical, ids) in links {
        let canonical = canonical.trim();
        if canonical.is_empty() {
            continue;
        }
        let Some(ids) = ids.as_array() else {
            continue;
        };
        if ids
            .iter()
            .filter_map(|id| value_string(Some(id)))
            .any(|id| {
                let id = id.to_lowercase();
                id == raw || scoped.as_ref().is_some_and(|scoped| &id == scoped)
            })
        {
            return Some(canonical.to_string());
        }
    }
    None
}

fn resolve_thread_session_keys(payload: &Value) -> Result<Value, String> {
    let base = value_string(payload.get("baseSessionKey"))
        .ok_or_else(|| "baseSessionKey is required".to_string())?;
    let thread_id = value_string(payload.get("threadId")).unwrap_or_default();
    if thread_id.is_empty() {
        return Ok(json!({ "sessionKey": base }));
    }
    let use_suffix = payload
        .get("useSuffix")
        .and_then(Value::as_bool)
        .unwrap_or(true);
    let session_key = if use_suffix {
        format!("{base}:thread:{}", thread_id.to_lowercase())
    } else {
        base.clone()
    };
    Ok(json!({
        "sessionKey": session_key,
        "parentSessionKey": payload.get("parentSessionKey").cloned().unwrap_or(Value::Null)
    }))
}

fn is_context_guarded_action(action: &str) -> bool {
    matches!(
        action,
        "send"
            | "poll"
            | "reply"
            | "sendWithEffect"
            | "sendAttachment"
            | "upload-file"
            | "thread-create"
            | "thread-reply"
            | "sticker"
    )
}

fn context_guard_target(action: &str, args: &Value) -> Option<String> {
    if !is_context_guarded_action(action) {
        return None;
    }
    if action == "thread-reply" || action == "thread-create" {
        return value_string(args.get("channelId")).or_else(|| value_string(args.get("to")));
    }
    value_string(args.get("to")).or_else(|| value_string(args.get("channelId")))
}

fn normalize_policy_target(channel: &str, raw: &str) -> Option<String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return None;
    }
    if channel.eq_ignore_ascii_case("slack") {
        return Some(trimmed.trim_start_matches('#').to_string());
    }
    Some(trimmed.to_string())
}

fn is_cross_context_target(channel: &str, target: &str, tool_context: &Value) -> bool {
    let current = value_string(tool_context.get("currentChannelId")).unwrap_or_default();
    if current.is_empty() {
        return false;
    }
    let Some(target) = normalize_policy_target(channel, target) else {
        return false;
    };
    let Some(current) = normalize_policy_target(channel, &current) else {
        return false;
    };
    target != current
}

fn enforce_cross_context_policy(payload: &Value) -> Result<Value, String> {
    let channel = value_string(payload.get("channel")).unwrap_or_default();
    let action = value_string(payload.get("action")).unwrap_or_default();
    let args = payload.get("args").unwrap_or(&Value::Null);
    let tool_context = payload.get("toolContext").unwrap_or(&Value::Null);
    let cfg = payload.get("cfg").unwrap_or(&Value::Null);
    let current = value_string(tool_context.get("currentChannelId")).unwrap_or_default();
    if current.is_empty() || !is_context_guarded_action(&action) {
        return Ok(json!({ "allowed": true }));
    }
    if cfg
        .pointer("/tools/message/allowCrossContextSend")
        .and_then(Value::as_bool)
        .unwrap_or(false)
    {
        return Ok(json!({ "allowed": true }));
    }
    let current_provider = value_string(tool_context.get("currentChannelProvider"));
    let allow_within_provider = cfg
        .pointer("/tools/message/crossContext/allowWithinProvider")
        .and_then(Value::as_bool)
        .unwrap_or(true);
    let allow_across_providers = cfg
        .pointer("/tools/message/crossContext/allowAcrossProviders")
        .and_then(Value::as_bool)
        .unwrap_or(false);

    if current_provider
        .as_deref()
        .is_some_and(|provider| provider != channel)
    {
        if !allow_across_providers {
            return Err(format!(
                "Cross-context messaging denied: action={action} target provider \"{channel}\" while bound to \"{}\".",
                current_provider.unwrap_or_default()
            ));
        }
        return Ok(json!({ "allowed": true }));
    }
    if allow_within_provider {
        return Ok(json!({ "allowed": true }));
    }
    let Some(target) = context_guard_target(&action, args) else {
        return Ok(json!({ "allowed": true }));
    };
    if !is_cross_context_target(&channel, &target, tool_context) {
        return Ok(json!({ "allowed": true }));
    }
    Err(format!(
        "Cross-context messaging denied: action={action} target=\"{target}\" while bound to \"{current}\" (channel={channel})."
    ))
}

fn strip_provider_prefix(raw: &str, channel: &str) -> String {
    let trimmed = raw.trim();
    let lower = trimmed.to_lowercase();
    let prefix = format!("{}:", channel.to_lowercase());
    if lower.starts_with(&prefix) {
        trimmed[prefix.len()..].trim().to_string()
    } else {
        trimmed.to_string()
    }
}

fn strip_kind_prefix(raw: &str) -> String {
    for prefix in [
        "user:",
        "channel:",
        "group:",
        "conversation:",
        "room:",
        "dm:",
    ] {
        if raw.to_lowercase().starts_with(prefix) {
            return raw[prefix.len()..].trim().to_string();
        }
    }
    raw.trim().to_string()
}

fn resolve_fallback_session_route(payload: &Value) -> Result<Value, String> {
    let channel = value_string(payload.get("channel")).unwrap_or_default();
    let agent_id = value_string(payload.get("agentId")).unwrap_or_else(|| DEFAULT_AGENT_ID.into());
    let account_id = value_string(payload.get("accountId"));
    let target = value_string(payload.get("target")).unwrap_or_default();
    let trimmed = strip_provider_prefix(&target, &channel);
    if trimmed.is_empty() {
        return Ok(json!({ "route": null }));
    }
    let resolved_kind = payload
        .get("resolvedTarget")
        .and_then(|target| value_string(target.get("kind")));
    let peer_kind = match resolved_kind.as_deref() {
        Some("user") => "direct",
        Some("channel") => "channel",
        Some("group") => "group",
        _ => "direct",
    };
    let peer_id = strip_kind_prefix(&trimmed);
    if peer_id.is_empty() {
        return Ok(json!({ "route": null }));
    }
    let session_cfg = payload.get("cfg").and_then(|cfg| cfg.get("session"));
    let dm_scope = session_cfg
        .and_then(|session| value_string(session.get("dmScope")))
        .unwrap_or_else(|| "main".into());
    let identity_links = session_cfg.and_then(|session| session.get("identityLinks"));
    let base_session_key = build_agent_peer_session_key(&json!({
        "agentId": agent_id,
        "channel": channel,
        "accountId": account_id,
        "peerKind": peer_kind,
        "peerId": peer_id,
        "dmScope": dm_scope,
        "identityLinks": identity_links.cloned().unwrap_or(Value::Null)
    }));
    let chat_type = if peer_kind == "direct" {
        "direct"
    } else if peer_kind == "channel" {
        "channel"
    } else {
        "group"
    };
    let from = if peer_kind == "direct" {
        format!("{channel}:{peer_id}")
    } else {
        format!("{channel}:{peer_kind}:{peer_id}")
    };
    let to_prefix = if peer_kind == "direct" {
        "user"
    } else {
        "channel"
    };
    Ok(json!({
        "route": {
            "sessionKey": base_session_key,
            "baseSessionKey": base_session_key,
            "peer": { "kind": peer_kind, "id": peer_id },
            "chatType": chat_type,
            "from": from,
            "to": format!("{to_prefix}:{peer_id}")
        }
    }))
}

fn build_delivery_request(payload: &Value) -> Result<Value, String> {
    let request_id = value_string(payload.get("requestId"))
        .ok_or_else(|| "requestId is required".to_string())?;
    let channel = normalize_token(payload.get("channel"));
    if channel.is_empty() {
        return Err("channel is required".to_string());
    }
    let action =
        value_string(payload.get("action")).ok_or_else(|| "action is required".to_string())?;
    let to = value_string(payload.get("to")).ok_or_else(|| "to is required".to_string())?;
    let text = value_string(payload.get("text"));
    let media_urls = value_string_array(payload.get("mediaUrls"));
    if action == "send" && text.as_deref().unwrap_or_default().is_empty() && media_urls.is_empty() {
        return Err("send delivery request requires text or media".to_string());
    }

    let mut request = Map::new();
    request.insert("requestId".to_string(), Value::String(request_id));
    request.insert("channel".to_string(), Value::String(channel));
    if let Some(account_id) = value_string(payload.get("accountId")) {
        request.insert("accountId".to_string(), Value::String(account_id));
    }
    request.insert("action".to_string(), Value::String(action));
    request.insert("to".to_string(), Value::String(to));
    if let Some(text) = text {
        request.insert("text".to_string(), Value::String(text));
    }
    request.insert("mediaUrls".to_string(), json!(media_urls));
    if let Some(reply_to_id) = value_string(payload.get("replyToId")) {
        request.insert("replyToId".to_string(), Value::String(reply_to_id));
    }
    if let Some(thread_id) = value_string(payload.get("threadId")) {
        request.insert("threadId".to_string(), Value::String(thread_id));
    }
    request.insert(
        "params".to_string(),
        payload
            .get("params")
            .filter(|value| value.is_object())
            .cloned()
            .unwrap_or_else(|| json!({})),
    );

    Ok(json!({ "request": Value::Object(request) }))
}

const INTERNAL_MESSAGE_CHANNEL: &str = "webchat";

fn normalize_message_channel(value: Option<&Value>) -> Option<String> {
    value_string(value).map(|value| value.to_lowercase())
}

fn resolve_reply_routing_decision(payload: &Value) -> Result<Value, String> {
    let originating_channel = normalize_message_channel(payload.get("originatingChannel"));
    let provider_channel = normalize_message_channel(payload.get("provider"));
    let surface_channel = normalize_message_channel(payload.get("surface"));
    let current_surface = provider_channel.or_else(|| surface_channel.clone());
    let explicit_deliver_route = payload
        .get("explicitDeliverRoute")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let suppress_direct_user_delivery = payload
        .get("suppressDirectUserDelivery")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let originating_routable = payload
        .get("originatingRoutable")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let originating_to = value_string(payload.get("originatingTo"));

    let is_internal_webchat_turn = current_surface.as_deref() == Some(INTERNAL_MESSAGE_CHANNEL)
        && (surface_channel.as_deref() == Some(INTERNAL_MESSAGE_CHANNEL)
            || surface_channel.is_none())
        && !explicit_deliver_route;
    let should_route_to_originating = !suppress_direct_user_delivery
        && !is_internal_webchat_turn
        && originating_routable
        && originating_to
            .as_deref()
            .is_some_and(|value| !value.is_empty())
        && originating_channel != current_surface;
    let should_suppress_typing = suppress_direct_user_delivery
        || should_route_to_originating
        || originating_channel.as_deref() == Some(INTERNAL_MESSAGE_CHANNEL);

    Ok(json!({
        "originatingChannel": originating_channel,
        "currentSurface": current_surface,
        "isInternalWebchatTurn": is_internal_webchat_turn,
        "shouldRouteToOriginating": should_route_to_originating,
        "shouldSuppressTyping": should_suppress_typing
    }))
}

fn normalize_typing_policy(value: Option<&Value>) -> Option<String> {
    let value = value_string(value)?.to_lowercase();
    match value.as_str() {
        "auto" | "user_message" | "system_event" | "internal_webchat" | "heartbeat" => Some(value),
        _ => None,
    }
}

fn resolve_typing_policy(payload: &Value) -> Result<Value, String> {
    let is_heartbeat = payload
        .get("isHeartbeat")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let system_event = payload
        .get("systemEvent")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let originating_channel = normalize_message_channel(payload.get("originatingChannel"));
    let requested_policy = normalize_typing_policy(payload.get("requestedPolicy"));
    let typing_policy = if is_heartbeat {
        "heartbeat".to_string()
    } else if originating_channel.as_deref() == Some(INTERNAL_MESSAGE_CHANNEL) {
        "internal_webchat".to_string()
    } else if system_event {
        "system_event".to_string()
    } else {
        requested_policy.unwrap_or_else(|| "auto".to_string())
    };
    let suppress_typing = payload
        .get("suppressTyping")
        .and_then(Value::as_bool)
        .unwrap_or(false)
        || matches!(
            typing_policy.as_str(),
            "heartbeat" | "system_event" | "internal_webchat"
        );

    Ok(json!({
        "typingPolicy": typing_policy,
        "suppressTyping": suppress_typing
    }))
}

fn resolve_command_authorized(payload: &Value) -> bool {
    let use_access_groups = payload
        .get("useAccessGroups")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let mode =
        value_string(payload.get("modeWhenAccessGroupsOff")).unwrap_or_else(|| "allow".into());
    let authorizers = payload
        .get("authorizers")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    if !use_access_groups {
        if mode == "allow" {
            return true;
        }
        if mode == "deny" {
            return false;
        }
        let any_configured = authorizers.iter().any(|entry| {
            entry
                .get("configured")
                .and_then(Value::as_bool)
                .unwrap_or(false)
        });
        if !any_configured {
            return true;
        }
        return authorizers.iter().any(|entry| {
            entry
                .get("configured")
                .and_then(Value::as_bool)
                .unwrap_or(false)
                && entry
                    .get("allowed")
                    .and_then(Value::as_bool)
                    .unwrap_or(false)
        });
    }
    authorizers.iter().any(|entry| {
        entry
            .get("configured")
            .and_then(Value::as_bool)
            .unwrap_or(false)
            && entry
                .get("allowed")
                .and_then(Value::as_bool)
                .unwrap_or(false)
    })
}

fn resolve_control_command_gate(payload: &Value) -> Result<Value, String> {
    let command_authorized = resolve_command_authorized(payload);
    let allow_text_commands = payload
        .get("allowTextCommands")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let has_control_command = payload
        .get("hasControlCommand")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    Ok(json!({
        "commandAuthorized": command_authorized,
        "shouldBlock": allow_text_commands && has_control_command && !command_authorized
    }))
}

fn resolve_dual_text_control_command_gate(payload: &Value) -> Result<Value, String> {
    resolve_control_command_gate(&json!({
        "useAccessGroups": payload.get("useAccessGroups").cloned().unwrap_or(Value::Bool(false)),
        "authorizers": [
            {
                "configured": payload.get("primaryConfigured").cloned().unwrap_or(Value::Bool(false)),
                "allowed": payload.get("primaryAllowed").cloned().unwrap_or(Value::Bool(false))
            },
            {
                "configured": payload.get("secondaryConfigured").cloned().unwrap_or(Value::Bool(false)),
                "allowed": payload.get("secondaryAllowed").cloned().unwrap_or(Value::Bool(false))
            }
        ],
        "allowTextCommands": true,
        "hasControlCommand": payload.get("hasControlCommand").cloned().unwrap_or(Value::Bool(false)),
        "modeWhenAccessGroupsOff": payload.get("modeWhenAccessGroupsOff").cloned().unwrap_or(Value::Null)
    }))
}

fn sanitize_inbound_text(text: &str) -> String {
    let normalized = text.replace("\r\n", "\n").replace('\r', "\n");
    let mut out = Vec::new();
    for line in normalized.lines() {
        if line.trim_start().starts_with("System:") {
            let indent_len = line.len() - line.trim_start().len();
            out.push(format!(
                "{}System (untrusted):{}",
                &line[..indent_len],
                &line[indent_len + "System:".len()..]
            ));
        } else {
            out.push(line.to_string());
        }
    }
    out.join("\n")
        .replace("[System Message]", "(System Message)")
        .replace("[System]", "(System)")
        .replace("[Assistant]", "(Assistant)")
        .replace("[Internal]", "(Internal)")
}

fn normalize_chat_type(value: Option<&Value>) -> Option<String> {
    let value = value?.as_str()?.trim().to_lowercase();
    match value.as_str() {
        "direct" | "dm" => Some("direct".to_string()),
        "group" => Some("group".to_string()),
        "channel" => Some("channel".to_string()),
        _ => None,
    }
}

fn normalize_inbound_text_field(value: Option<&Value>) -> Option<String> {
    value.and_then(Value::as_str).map(sanitize_inbound_text)
}

fn normalized_inbound_text_or_empty(value: Option<&Value>) -> String {
    normalize_inbound_text_field(value).unwrap_or_default()
}

fn text_field(map: &serde_json::Map<String, Value>, key: &str) -> Option<String> {
    map.get(key)
        .and_then(Value::as_str)
        .map(ToString::to_string)
}

fn resolve_conversation_id(from: Option<&str>) -> Option<String> {
    let trimmed = from?.trim();
    if trimmed.is_empty() {
        return None;
    }
    let candidate = trimmed
        .split(':')
        .filter(|part| !part.is_empty())
        .next_back()
        .unwrap_or(trimmed);
    if candidate.is_empty() {
        None
    } else {
        Some(candidate.to_string())
    }
}

fn should_append_conversation_id(id: &str) -> bool {
    id.chars().all(|ch| ch.is_ascii_digit()) || id.contains("@g.us")
}

fn resolve_conversation_label(map: &serde_json::Map<String, Value>) -> Option<String> {
    if let Some(explicit) =
        text_field(map, "ConversationLabel").map(|value| value.trim().to_string())
    {
        if !explicit.is_empty() {
            return Some(explicit);
        }
    }
    if let Some(thread_label) = text_field(map, "ThreadLabel").map(|value| value.trim().to_string())
    {
        if !thread_label.is_empty() {
            return Some(thread_label);
        }
    }
    let chat_type = normalize_chat_type(map.get("ChatType"));
    if chat_type.as_deref() == Some("direct") {
        return text_field(map, "SenderName")
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
            .or_else(|| {
                text_field(map, "From")
                    .map(|value| value.trim().to_string())
                    .filter(|value| !value.is_empty())
            });
    }
    let base = ["GroupChannel", "GroupSubject", "GroupSpace", "From"]
        .into_iter()
        .find_map(|key| {
            text_field(map, key)
                .map(|value| value.trim().to_string())
                .filter(|value| !value.is_empty())
        })?;
    let Some(id) = resolve_conversation_id(text_field(map, "From").as_deref()) else {
        return Some(base);
    };
    if !should_append_conversation_id(&id)
        || base == id
        || base.contains(&id)
        || base.to_lowercase().contains(" id:")
        || base.starts_with('#')
        || base.starts_with('@')
    {
        return Some(base);
    }
    Some(format!("{base} id:{id}"))
}

fn normalize_media_type(value: Option<&Value>) -> Option<String> {
    value
        .and_then(Value::as_str)
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn array_len(value: Option<&Value>) -> usize {
    value.and_then(Value::as_array).map_or(0, Vec::len)
}

fn has_non_empty_string(value: Option<&Value>) -> bool {
    value
        .and_then(Value::as_str)
        .is_some_and(|value| !value.trim().is_empty())
}

fn count_inbound_media_entries(map: &serde_json::Map<String, Value>) -> usize {
    let path_count = array_len(map.get("MediaPaths"));
    let url_count = array_len(map.get("MediaUrls"));
    let single = usize::from(
        has_non_empty_string(map.get("MediaPath")) || has_non_empty_string(map.get("MediaUrl")),
    );
    path_count.max(url_count).max(single)
}

fn normalized_media_types(value: Option<&Value>) -> Option<Vec<Option<String>>> {
    let values = value?.as_array()?;
    if values.is_empty() {
        return None;
    }
    Some(
        values
            .iter()
            .map(|entry| normalize_media_type(Some(entry)))
            .collect(),
    )
}

fn finalize_inbound_context(payload: &Value) -> Result<Value, String> {
    let mut ctx = payload
        .get("ctx")
        .cloned()
        .unwrap_or_else(|| payload.clone());
    let opts = payload.get("opts").unwrap_or(&Value::Null);
    let Some(map) = ctx.as_object_mut() else {
        return Err("inbound.finalizeContext ctx must be an object".to_string());
    };

    let body = normalized_inbound_text_or_empty(map.get("Body"));
    map.insert("Body".to_string(), Value::String(body.clone()));
    for key in [
        "RawBody",
        "CommandBody",
        "Transcript",
        "ThreadStarterBody",
        "ThreadHistoryBody",
    ] {
        match normalize_inbound_text_field(map.get(key)) {
            Some(value) => {
                map.insert(key.to_string(), Value::String(value));
            }
            None => {
                map.remove(key);
            }
        }
    }
    if let Some(entries) = map.get("UntrustedContext").and_then(Value::as_array) {
        let normalized = entries
            .iter()
            .filter_map(|entry| normalize_inbound_text_field(Some(entry)))
            .filter(|entry| !entry.is_empty())
            .map(Value::String)
            .collect::<Vec<_>>();
        map.insert("UntrustedContext".to_string(), Value::Array(normalized));
    }

    let chat_type = normalize_chat_type(map.get("ChatType"));
    let force_chat_type = opts
        .get("forceChatType")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    if let Some(chat_type) = chat_type {
        if force_chat_type
            || map.get("ChatType").and_then(Value::as_str) != Some(chat_type.as_str())
        {
            map.insert("ChatType".to_string(), Value::String(chat_type));
        }
    }

    let force_body_for_agent = opts
        .get("forceBodyForAgent")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let body_for_agent_source = if force_body_for_agent {
        Some(body.clone())
    } else {
        text_field(map, "BodyForAgent")
            .or_else(|| text_field(map, "CommandBody"))
            .or_else(|| text_field(map, "RawBody"))
            .or_else(|| Some(body.clone()))
    };
    map.insert(
        "BodyForAgent".to_string(),
        Value::String(sanitize_inbound_text(
            body_for_agent_source.as_deref().unwrap_or_default(),
        )),
    );

    let force_body_for_commands = opts
        .get("forceBodyForCommands")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let body_for_commands_source = if force_body_for_commands {
        text_field(map, "CommandBody")
            .or_else(|| text_field(map, "RawBody"))
            .or_else(|| Some(body.clone()))
    } else {
        text_field(map, "BodyForCommands")
            .or_else(|| text_field(map, "CommandBody"))
            .or_else(|| text_field(map, "RawBody"))
            .or_else(|| Some(body.clone()))
    };
    map.insert(
        "BodyForCommands".to_string(),
        Value::String(sanitize_inbound_text(
            body_for_commands_source.as_deref().unwrap_or_default(),
        )),
    );

    let force_conversation_label = opts
        .get("forceConversationLabel")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let explicit_label = text_field(map, "ConversationLabel")
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    if force_conversation_label || explicit_label.is_none() {
        if let Some(label) = resolve_conversation_label(map) {
            map.insert("ConversationLabel".to_string(), Value::String(label));
        }
    } else if let Some(label) = explicit_label {
        map.insert("ConversationLabel".to_string(), Value::String(label));
    }

    if map.get("CommandAuthorized").and_then(Value::as_bool) != Some(true) {
        map.insert("CommandAuthorized".to_string(), Value::Bool(false));
    }

    let media_count = count_inbound_media_entries(map);
    if media_count > 0 {
        const DEFAULT_MEDIA_TYPE: &str = "application/octet-stream";
        let media_type = normalize_media_type(map.get("MediaType"));
        let mut final_types =
            if let Some(mut values) = normalized_media_types(map.get("MediaTypes")) {
                while values.len() < media_count {
                    values.push(None);
                }
                values
                    .into_iter()
                    .take(media_count)
                    .map(|value| value.unwrap_or_else(|| DEFAULT_MEDIA_TYPE.to_string()))
                    .collect::<Vec<_>>()
            } else if let Some(media_type) = media_type.clone() {
                let mut values = vec![media_type];
                while values.len() < media_count {
                    values.push(DEFAULT_MEDIA_TYPE.to_string());
                }
                values
            } else {
                vec![DEFAULT_MEDIA_TYPE.to_string(); media_count]
            };
        if final_types.is_empty() {
            final_types.push(DEFAULT_MEDIA_TYPE.to_string());
        }
        let final_media_type = media_type.unwrap_or_else(|| final_types[0].clone());
        map.insert("MediaType".to_string(), Value::String(final_media_type));
        map.insert(
            "MediaTypes".to_string(),
            Value::Array(final_types.into_iter().map(Value::String).collect()),
        );
    }

    Ok(json!({ "ctx": ctx }))
}

fn validate_transcript_append(payload: &Value) -> Result<Value, String> {
    if value_string(payload.get("sessionFile")).is_none() {
        return Err("sessionFile is required".to_string());
    }
    if payload.get("message").is_none() {
        return Err("message is required".to_string());
    }
    Ok(json!({
        "ok": true,
        "idempotencyKey": value_string(payload.get("idempotencyKey"))
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn message_policy_builds_peer_session_keys() {
        let result = execute_message_policy_operation(json!({
            "operation": "session.buildAgentPeerSessionKey",
            "payload": {
                "agentId": "Ops Agent",
                "channel": "Slack",
                "peerKind": "direct",
                "peerId": "U123",
                "dmScope": "per-channel-peer"
            }
        }))
        .expect("policy result");
        assert_eq!(result["sessionKey"], "agent:ops-agent:slack:direct:u123");
    }

    #[test]
    fn message_policy_denies_cross_provider_sends() {
        let error = execute_message_policy_operation(json!({
            "operation": "outbound.enforceCrossContextPolicy",
            "payload": {
                "cfg": {},
                "channel": "telegram",
                "action": "send",
                "args": { "to": "telegram:@ops" },
                "toolContext": {
                    "currentChannelId": "C123",
                    "currentChannelProvider": "slack"
                }
            }
        }))
        .expect_err("policy denial");
        assert!(error.contains("target provider \"telegram\" while bound to \"slack\""));
    }

    #[test]
    fn message_policy_builds_fallback_outbound_routes() {
        let result = execute_message_policy_operation(json!({
            "operation": "outbound.resolveFallbackSessionRoute",
            "payload": {
                "cfg": { "session": { "dmScope": "per-channel-peer" } },
                "channel": "discord",
                "agentId": "main",
                "target": "user:123",
                "resolvedTarget": { "kind": "user" }
            }
        }))
        .expect("route");
        assert_eq!(
            result.pointer("/route/sessionKey").and_then(Value::as_str),
            Some("agent:main:discord:direct:123")
        );
        assert_eq!(
            result.pointer("/route/to").and_then(Value::as_str),
            Some("user:123")
        );
    }

    #[test]
    fn message_policy_builds_channel_outbound_requests() {
        let result = execute_message_policy_operation(json!({
            "operation": "outbound.buildDeliveryRequest",
            "payload": {
                "requestId": "out-1",
                "channel": "slack",
                "accountId": "default",
                "action": "send",
                "to": "channel:C123",
                "text": "hello",
                "mediaUrls": ["file:///tmp/a.png"],
                "replyToId": "reply-1",
                "threadId": "thread-1",
                "params": { "silent": true }
            }
        }))
        .expect("delivery request");

        assert_eq!(
            result.pointer("/request/requestId").and_then(Value::as_str),
            Some("out-1")
        );
        assert_eq!(
            result.pointer("/request/channel").and_then(Value::as_str),
            Some("slack")
        );
        assert_eq!(
            result.pointer("/request/action").and_then(Value::as_str),
            Some("send")
        );
        assert_eq!(
            result
                .pointer("/request/mediaUrls/0")
                .and_then(Value::as_str),
            Some("file:///tmp/a.png")
        );
    }

    #[test]
    fn message_policy_resolves_reply_routing_decision() {
        let result = execute_message_policy_operation(json!({
            "operation": "outbound.resolveReplyRoutingDecision",
            "payload": {
                "provider": "slack",
                "surface": "slack",
                "originatingChannel": "telegram",
                "originatingTo": "telegram:123",
                "originatingRoutable": true
            }
        }))
        .expect("routing decision");
        assert_eq!(result["originatingChannel"], "telegram");
        assert_eq!(result["currentSurface"], "slack");
        assert_eq!(result["shouldRouteToOriginating"], true);
        assert_eq!(result["shouldSuppressTyping"], true);
    }

    #[test]
    fn message_policy_keeps_internal_webchat_on_local_route() {
        let result = execute_message_policy_operation(json!({
            "operation": "outbound.resolveReplyRoutingDecision",
            "payload": {
                "provider": "webchat",
                "surface": "webchat",
                "originatingChannel": "telegram",
                "originatingTo": "telegram:123",
                "originatingRoutable": true
            }
        }))
        .expect("routing decision");
        assert_eq!(result["isInternalWebchatTurn"], true);
        assert_eq!(result["shouldRouteToOriginating"], false);
        assert_eq!(result["shouldSuppressTyping"], false);
    }

    #[test]
    fn message_policy_resolves_typing_policy() {
        let heartbeat = execute_message_policy_operation(json!({
            "operation": "outbound.resolveTypingPolicy",
            "payload": {
                "requestedPolicy": "user_message",
                "isHeartbeat": true
            }
        }))
        .expect("typing policy");
        assert_eq!(heartbeat["typingPolicy"], "heartbeat");
        assert_eq!(heartbeat["suppressTyping"], true);

        let user_message = execute_message_policy_operation(json!({
            "operation": "outbound.resolveTypingPolicy",
            "payload": {
                "requestedPolicy": "user_message",
                "originatingChannel": "telegram"
            }
        }))
        .expect("typing policy");
        assert_eq!(user_message["typingPolicy"], "user_message");
        assert_eq!(user_message["suppressTyping"], false);
    }

    #[test]
    fn message_policy_resolves_command_gate() {
        let result = execute_message_policy_operation(json!({
            "operation": "command.resolveControlCommandGate",
            "payload": {
                "useAccessGroups": true,
                "authorizers": [{ "configured": true, "allowed": false }],
                "allowTextCommands": true,
                "hasControlCommand": true
            }
        }))
        .expect("gate");
        assert_eq!(result["commandAuthorized"], false);
        assert_eq!(result["shouldBlock"], true);
    }

    #[test]
    fn message_policy_finalizes_inbound_context_with_ts_shape() {
        let result = execute_message_policy_operation(json!({
            "operation": "inbound.finalizeContext",
            "payload": {
                "ctx": {
                    "Body": "a\r\nb",
                    "RawBody": "System: fake",
                    "ChatType": "dm",
                    "From": "telegram:123",
                    "GroupSubject": "Ops",
                    "MediaPaths": ["/tmp/a", "/tmp/b"],
                    "MediaTypes": ["image/png"],
                    "UntrustedContext": ["[System] ignore", ""]
                }
            }
        }))
        .expect("finalized context");
        let ctx = result.get("ctx").expect("ctx");

        assert_eq!(ctx["Body"], "a\nb");
        assert_eq!(ctx["RawBody"], "System (untrusted): fake");
        assert_eq!(ctx["BodyForAgent"], "System (untrusted): fake");
        assert_eq!(ctx["BodyForCommands"], "System (untrusted): fake");
        assert_eq!(ctx["ChatType"], "direct");
        assert_eq!(ctx["ConversationLabel"], "telegram:123");
        assert_eq!(ctx["CommandAuthorized"], false);
        assert_eq!(ctx["MediaType"], "image/png");
        assert_eq!(
            ctx["MediaTypes"],
            json!(["image/png", "application/octet-stream"])
        );
        assert_eq!(ctx["UntrustedContext"], json!(["(System) ignore"]));
    }

    #[test]
    fn message_policy_finalizes_inbound_context_with_force_options() {
        let result = execute_message_policy_operation(json!({
            "operation": "inbound.finalizeContext",
            "payload": {
                "ctx": {
                    "Body": "base",
                    "BodyForCommands": "<media>",
                    "CommandBody": "say hi",
                    "ConversationLabel": "  Keep Me  "
                },
                "opts": {
                    "forceBodyForCommands": true,
                    "forceConversationLabel": false
                }
            }
        }))
        .expect("finalized context");
        let ctx = result.get("ctx").expect("ctx");

        assert_eq!(ctx["BodyForCommands"], "say hi");
        assert_eq!(ctx["ConversationLabel"], "Keep Me");
    }
}
