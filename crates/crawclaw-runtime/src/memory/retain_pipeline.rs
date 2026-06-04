use serde_json::{json, Value};

use super::bank_resolver::BankContext;
use super::config::{HindsightConfig, HindsightQualityConfig};
use super::feedback_guard::{extract_text_content, strip_memory_tags};
use super::hindsight_client::HindsightClient;
use super::quality::{chunk_metadata, chunk_text_for_retain_with_config};

#[derive(Clone, Debug)]
pub struct RetainConfig {
    pub auto_retain: bool,
    pub retain_roles: Vec<String>,
    pub retain_every_n_turns: u32,
    pub retain_async: bool,
    pub primary_language: String,
    pub bilingual_technical_terms: bool,
    pub quality: HindsightQualityConfig,
}

#[derive(Clone, Debug, PartialEq)]
pub struct RetainChunk {
    pub content: String,
    pub metadata: Value,
}

impl From<&HindsightConfig> for RetainConfig {
    fn from(config: &HindsightConfig) -> Self {
        Self {
            auto_retain: config.auto_retain,
            retain_roles: config.retain_roles.clone(),
            retain_every_n_turns: config.retain_every_n_turns,
            retain_async: config.retain_async,
            primary_language: config.language_hints.primary_language.clone(),
            bilingual_technical_terms: config.language_hints.bilingual_technical_terms,
            quality: config.quality.clone(),
        }
    }
}

pub fn compose_retain_payload(
    messages: &[Value],
    _ctx: &BankContext,
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

pub fn compose_retain_chunks(
    messages: &[Value],
    ctx: &BankContext,
    config: &RetainConfig,
) -> Option<Vec<RetainChunk>> {
    let content = compose_retain_payload(messages, ctx, config)?;
    Some(chunk_retain_content(&content, config))
}

pub fn chunk_retain_content(content: &str, config: &RetainConfig) -> Vec<RetainChunk> {
    let (profile, chunks) =
        chunk_text_for_retain_with_config(content, &config.primary_language, &config.quality);
    let total = chunks.len();
    chunks
        .into_iter()
        .enumerate()
        .map(|(index, content)| RetainChunk {
            content,
            metadata: chunk_metadata(&profile, index, total),
        })
        .collect()
}

pub fn build_retain_tags(ctx: &BankContext, layer: &str) -> Vec<String> {
    let mut tags = vec![
        format!("agent:{}", ctx.agent_id),
        format!("layer:{}", layer),
    ];
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
            auto_retain: true,
            retain_roles: vec!["user".to_string(), "assistant".to_string()],
            retain_every_n_turns: 1,
            retain_async: false,
            primary_language: "auto".to_string(),
            bilingual_technical_terms: true,
            quality: HindsightQualityConfig::default(),
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
            auto_retain: true,
            retain_roles: vec!["user".to_string()],
            retain_every_n_turns: 1,
            retain_async: false,
            primary_language: "auto".to_string(),
            bilingual_technical_terms: true,
            quality: HindsightQualityConfig::default(),
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

    #[test]
    fn compose_retain_chunks_splits_long_chinese_content_on_sentence_boundaries() {
        let long_sentence = "用户要求中文记忆系统在高峰期排查网关、缓存和数据库问题。";
        let messages = vec![
            json!({"role": "user", "content": long_sentence.repeat(80)}),
            json!({"role": "assistant", "content": "已记录中文排障策略。"}),
        ];
        let config = RetainConfig {
            auto_retain: true,
            retain_roles: vec!["user".to_string(), "assistant".to_string()],
            retain_every_n_turns: 1,
            retain_async: false,
            primary_language: "zh-CN".to_string(),
            bilingual_technical_terms: true,
            quality: HindsightQualityConfig::default(),
        };
        let ctx = BankContext {
            agent_id: "main".to_string(),
            channel: None,
            user_id: None,
        };

        let chunks = compose_retain_chunks(&messages, &ctx, &config).expect("retain chunks");

        assert!(chunks.len() > 1);
        assert!(chunks.iter().all(|chunk| chunk.content.ends_with('。')));
        assert_eq!(chunks[0].metadata["chunkIndex"], 0);
        assert_eq!(chunks[0].metadata["language"], "zh-CN");
        assert_eq!(chunks[0].metadata["chunkTotal"], chunks.len());
    }

    #[test]
    fn retain_config_uses_quality_chunk_overrides() {
        let mut hindsight = HindsightConfig::default();
        hindsight.language_hints.primary_language = "zh-CN".to_string();
        hindsight.quality.retain_chunk_max_chars = Some(240);
        hindsight.quality.retain_chunk_overlap_chars = Some(24);
        let config = RetainConfig::from(&hindsight);
        let chunks = chunk_retain_content(
            &"用户要求中文记忆系统保留网关和缓存排障记录。".repeat(30),
            &config,
        );

        assert!(chunks.len() > 1);
        assert_eq!(chunks[0].metadata["chunkMaxChars"], 240);
        assert_eq!(chunks[0].metadata["chunkOverlapChars"], 24);
    }
}
