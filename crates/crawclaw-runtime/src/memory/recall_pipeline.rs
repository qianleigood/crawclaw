use serde_json::Value;

use super::bank_resolver::{BankContext, BankResolverConfig};
use super::config::HindsightConfig;
use super::feedback_guard::extract_text_content;
use super::hindsight_client::{HindsightClient, RecallItem};

#[derive(Clone, Debug)]
pub struct RecallConfig {
    pub default_budget: String,
    pub max_tokens: u32,
    pub recall_context_turns: u32,
    pub recall_max_query_chars: usize,
    pub recall_types: Vec<String>,
    pub tags_match: String,
    pub tags: Vec<String>,
    pub bilingual_technical_terms: bool,
    pub primary_language: String,
}

impl From<&HindsightConfig> for RecallConfig {
    fn from(config: &HindsightConfig) -> Self {
        Self {
            default_budget: config.default_budget.clone(),
            max_tokens: config.max_tokens,
            recall_context_turns: config.recall_context_turns,
            recall_max_query_chars: config.recall_max_query_chars,
            recall_types: config.recall_types.clone(),
            tags_match: config.tags_match.clone(),
            tags: config.tags.clone(),
            bilingual_technical_terms: config.language_hints.bilingual_technical_terms,
            primary_language: config.language_hints.primary_language.clone(),
        }
    }
}

pub fn compose_recall_query(user_text: &str, messages: &[Value], config: &RecallConfig) -> String {
    let mut parts = vec![user_text.to_string()];

    let recent_count = (config.recall_context_turns * 2) as usize;
    let recent: Vec<&Value> = messages.iter().rev().take(recent_count).collect();
    for msg in recent.iter().rev() {
        let role = msg.get("role").and_then(Value::as_str).unwrap_or("");
        let text = extract_text_content(msg);
        if !text.is_empty() {
            parts.push(format!("{}: {}", role, text));
        }
    }

    let combined = parts.join("\n");

    let expanded = if config.bilingual_technical_terms {
        expand_bilingual_terms(&combined)
    } else {
        combined
    };

    truncate_at_sentence_boundary(&expanded, config.recall_max_query_chars)
}

pub fn truncate_at_sentence_boundary(text: &str, max_chars: usize) -> String {
    if text.chars().count() <= max_chars {
        return text.to_string();
    }
    let truncated: String = text.chars().take(max_chars).collect();
    let end = truncated
        .char_indices()
        .filter_map(|(index, c)| {
            (c == '。' || c == '！' || c == '？' || c == '.' || c == '!' || c == '?')
                .then_some(index + c.len_utf8())
        })
        .last();
    end.map(|index| truncated[..index].to_string())
        .unwrap_or(truncated)
}

pub fn expand_bilingual_terms(query: &str) -> String {
    let pairs = [
        ("微服务", "microservice"),
        ("网关", "gateway"),
        ("插件", "plugin"),
        ("记忆", "memory"),
        ("会话", "session"),
        ("配置", "config"),
        ("部署", "deploy"),
        ("测试", "test"),
        ("数据库", "database"),
        ("缓存", "cache"),
        ("容器", "container"),
        ("集群", "cluster"),
        ("监控", "monitor"),
        ("日志", "log"),
        ("消息队列", "message queue"),
        ("负载均衡", "load balancer"),
    ];
    let mut expanded = query.to_string();
    for (zh, en) in &pairs {
        if query.contains(zh) && !query.contains(en) {
            expanded.push_str(&format!(" {}", en));
        } else if query.contains(en) && !query.contains(zh) {
            expanded.push_str(&format!(" {}", zh));
        }
    }
    expanded
}

pub fn layer_recall_types(layer: &str) -> Vec<&'static str> {
    match layer {
        "durable" => vec!["world", "observation"],
        "experience" => vec!["experience", "observation"],
        "resource" => vec!["resource", "document", "source_fact"],
        "mental-models" => vec!["observation"],
        _ => vec!["observation"],
    }
}

pub fn build_recall_tags(config: &RecallConfig, layer: &str) -> Vec<String> {
    let mut tags = config.tags.clone();
    tags.push(format!("layer:{}", layer));
    tags.sort();
    tags.dedup();
    tags
}

pub fn parallel_recall(
    client: &HindsightClient,
    resolver: &BankResolverConfig,
    ctx: &BankContext,
    query: &str,
    config: &RecallConfig,
) -> Vec<RecallItem> {
    let layers = ["durable", "experience", "resource", "mental-models"];
    let mut all_items = Vec::new();

    for layer in &layers {
        let bank_id = resolver.resolve(ctx, layer);
        let types = layer_recall_types(layer);
        let tags = build_recall_tags(config, layer);
        let tag_refs: Vec<&str> = tags.iter().map(|s| s.as_str()).collect();

        match client.recall(
            &bank_id,
            query,
            &types,
            &config.default_budget,
            config.max_tokens,
            &tag_refs,
            &config.tags_match,
        ) {
            Ok(response) => all_items.extend(response.items),
            Err(e) => {
                tracing::warn!(layer = layer, error = %e, "hindsight_recall_failed");
            }
        }
    }

    all_items.sort_by(|a, b| {
        b.score
            .partial_cmp(&a.score)
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    all_items.dedup_by(|a, b| a.id == b.id);

    let budget = config.max_tokens as usize;
    enforce_token_budget(all_items, budget)
}

fn enforce_token_budget(items: Vec<RecallItem>, max_tokens: usize) -> Vec<RecallItem> {
    let mut result = Vec::new();
    let mut total_tokens = 0;

    for item in items {
        let item_tokens = estimate_tokens(&item.text);
        if total_tokens + item_tokens > max_tokens && !result.is_empty() {
            break;
        }
        total_tokens += item_tokens;
        result.push(item);
    }

    result
}

fn estimate_tokens(text: &str) -> usize {
    (text.chars().count() / 4).max(1)
}

pub fn format_recall_for_injection(items: &[RecallItem], layer: &str) -> String {
    if items.is_empty() {
        return String::new();
    }

    let tag = format!("{}_recall", layer.replace('-', "_"));
    let mut lines = vec![format!("<{}>", tag)];

    for (i, item) in items.iter().enumerate() {
        lines.push(format!("{}. {}", i + 1, item.text));
    }

    lines.push(format!("</{}>", tag));
    lines.join("\n")
}

pub fn format_all_recall_for_injection(
    durable: &[RecallItem],
    experience: &[RecallItem],
    resource: &[RecallItem],
    mental_models: &[RecallItem],
) -> Vec<(String, String)> {
    let mut sections = Vec::new();

    let d = format_recall_for_injection(durable, "durable");
    if !d.is_empty() {
        sections.push(("Durable recall".to_string(), d));
    }

    let e = format_recall_for_injection(experience, "experience");
    if !e.is_empty() {
        sections.push(("Experience recall".to_string(), e));
    }

    let r = format_recall_for_injection(resource, "resource");
    if !r.is_empty() {
        sections.push(("Resource recall".to_string(), r));
    }

    let m = format_recall_for_injection(mental_models, "mental-models");
    if !m.is_empty() {
        sections.push(("Mental model recall".to_string(), m));
    }

    sections
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn compose_recall_query_includes_recent_context() {
        let messages = vec![
            json!({"role": "user", "content": "first"}),
            json!({"role": "assistant", "content": "second"}),
            json!({"role": "user", "content": "third"}),
        ];
        let config = RecallConfig {
            default_budget: "mid".to_string(),
            max_tokens: 2048,
            recall_context_turns: 1,
            recall_max_query_chars: 800,
            recall_types: vec!["observation".to_string()],
            tags_match: "all_strict".to_string(),
            tags: vec!["agent:main".to_string()],
            bilingual_technical_terms: false,
            primary_language: "auto".to_string(),
        };
        let query = compose_recall_query("current question", &messages, &config);
        assert!(query.contains("current question"));
    }

    #[test]
    fn expand_bilingual_terms_zh_to_en() {
        let result = expand_bilingual_terms("如何配置微服务");
        assert!(result.contains("microservice"));
    }

    #[test]
    fn expand_bilingual_terms_en_to_zh() {
        let result = expand_bilingual_terms("how to configure gateway");
        assert!(result.contains("网关"));
    }

    #[test]
    fn truncate_respects_sentence_boundary() {
        let text = "这是第一句话。这是第二句话。这是第三句话。";
        let result = truncate_at_sentence_boundary(text, 15);
        assert!(result.ends_with('。'));
    }

    #[test]
    fn truncate_falls_back_to_char_limit() {
        let text = "no sentence boundary here at all";
        let result = truncate_at_sentence_boundary(text, 10);
        assert!(result.chars().count() <= 10);
    }
}
