use serde_json::{json, Value};

use super::bank_resolver::BankContext;
use super::config::HindsightConfig;
use super::feedback_guard::{extract_text_content, strip_memory_tags};
use super::hindsight_client::HindsightClient;

#[derive(Clone, Debug)]
pub struct RetainConfig {
    pub retain_roles: Vec<String>,
    pub retain_every_n_turns: u32,
    pub retain_async: bool,
}

impl From<&HindsightConfig> for RetainConfig {
    fn from(config: &HindsightConfig) -> Self {
        Self {
            retain_roles: config.retain_roles.clone(),
            retain_every_n_turns: config.retain_every_n_turns,
            retain_async: config.retain_async,
        }
    }
}

pub fn compose_retain_payload(
    messages: &[Value],
    ctx: &BankContext,
    config: &RetainConfig,
) -> Option<String> {
    let filtered: Vec<&Value> = messages
        .iter()
        .filter(|m| {
            let role = m.get("role").and_then(Value::as_str).unwrap_or("");
            config.retain_roles.iter().any(|r| r == role)
        })
        .collect();

    if filtered.is_empty() {
        return None;
    }

    let cleaned: Vec<Value> = filtered.iter().map(|m| strip_memory_tags(m)).collect();

    let content = cleaned
        .iter()
        .map(|m| {
            let role = m.get("role").and_then(Value::as_str).unwrap_or("unknown");
            let text = extract_text_content(m);
            format!("{}: {}", role, text)
        })
        .collect::<Vec<_>>()
        .join("\n\n");

    if content.trim().is_empty() {
        return None;
    }

    Some(content)
}

pub fn build_retain_tags(ctx: &BankContext, layer: &str) -> Vec<String> {
    let mut tags = vec![format!("agent:{}", ctx.agent_id), format!("layer:{}", layer)];
    if let Some(ref channel) = ctx.channel {
        tags.push(format!("channel:{}", channel));
    }
    tags
}

pub fn build_retain_metadata(ctx: &BankContext) -> Value {
    let mut meta = json!({ "agentId": ctx.agent_id });
    if let Some(ref channel) = ctx.channel {
        meta["channel"] = Value::String(channel.clone());
    }
    if let Some(ref user_id) = ctx.user_id {
        meta["userId"] = Value::String(user_id.clone());
    }
    meta
}

pub fn auto_retain(
    client: &HindsightClient,
    bank_id: &str,
    content: &str,
    ctx: &BankContext,
) -> Result<(), String> {
    let tags = build_retain_tags(ctx, "experience");
    let tag_refs: Vec<&str> = tags.iter().map(|s| s.as_str()).collect();
    let metadata = build_retain_metadata(ctx);

    match client.retain(bank_id, content, "agent_turn", metadata, &tag_refs) {
        Ok(_) => Ok(()),
        Err(e) => Err(format!("Auto-retain failed: {e}")),
    }
}

pub fn should_retain_this_turn(
    turn_number: u32,
    retain_every_n_turns: u32,
    has_final_assistant_reply: bool,
    has_tool_calls: bool,
) -> bool {
    if !has_final_assistant_reply {
        return false;
    }
    if has_tool_calls {
        return false;
    }
    if retain_every_n_turns == 0 {
        return false;
    }
    turn_number % retain_every_n_turns == 0
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn compose_retain_filters_by_role() {
        let messages = vec![
            json!({"role": "user", "content": "hello"}),
            json!({"role": "assistant", "content": "hi"}),
            json!({"role": "system", "content": "system msg"}),
        ];
        let config = RetainConfig {
            retain_roles: vec!["user".to_string(), "assistant".to_string()],
            retain_every_n_turns: 1,
            retain_async: false,
        };
        let ctx = BankContext {
            agent_id: "main".to_string(),
            channel: None,
            user_id: None,
        };
        let result = compose_retain_payload(&messages, &ctx, &config);
        assert!(result.is_some());
        let content = result.unwrap();
        assert!(content.contains("user: hello"));
        assert!(content.contains("assistant: hi"));
        assert!(!content.contains("system"));
    }

    #[test]
    fn compose_retain_strips_memory_tags() {
        let messages = vec![json!({
            "role": "user",
            "content": "Before <hindsight_memories>injected</hindsight_memories> After"
        })];
        let config = RetainConfig {
            retain_roles: vec!["user".to_string()],
            retain_every_n_turns: 1,
            retain_async: false,
        };
        let ctx = BankContext {
            agent_id: "main".to_string(),
            channel: None,
            user_id: None,
        };
        let result = compose_retain_payload(&messages, &ctx, &config).unwrap();
        assert!(!result.contains("hindsight_memories"));
        assert!(result.contains("Before"));
        assert!(result.contains("After"));
    }

    #[test]
    fn should_retain_respects_turn_number() {
        assert!(should_retain_this_turn(1, 1, true, false));
        assert!(should_retain_this_turn(5, 5, true, false));
        assert!(!should_retain_this_turn(3, 5, true, false));
    }

    #[test]
    fn should_retain_rejects_without_assistant_reply() {
        assert!(!should_retain_this_turn(1, 1, false, false));
    }

    #[test]
    fn should_retain_rejects_with_tool_calls() {
        assert!(!should_retain_this_turn(1, 1, true, true));
    }
}
