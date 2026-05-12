use serde_json::{json, Value};

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
        "outbound.resolveFallbackSessionRoute" => resolve_fallback_session_route(&payload),
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

fn finalize_inbound_context(payload: &Value) -> Result<Value, String> {
    let mut ctx = payload.get("ctx").cloned().unwrap_or_else(|| json!({}));
    let Some(map) = ctx.as_object_mut() else {
        return Err("inbound.finalizeContext ctx must be an object".to_string());
    };
    for key in [
        "Body",
        "RawBody",
        "CommandBody",
        "Transcript",
        "ThreadStarterBody",
        "ThreadHistoryBody",
    ] {
        if let Some(value) = map.get(key).and_then(Value::as_str) {
            map.insert(key.to_string(), Value::String(sanitize_inbound_text(value)));
        }
    }
    if !map.contains_key("Body") {
        map.insert("Body".to_string(), Value::String(String::new()));
    }
    let body = map
        .get("Body")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    if !map.contains_key("BodyForAgent") {
        map.insert("BodyForAgent".to_string(), Value::String(body.clone()));
    }
    if !map.contains_key("BodyForCommands") {
        map.insert("BodyForCommands".to_string(), Value::String(body));
    }
    if map.get("CommandAuthorized").and_then(Value::as_bool) != Some(true) {
        map.insert("CommandAuthorized".to_string(), Value::Bool(false));
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
}
