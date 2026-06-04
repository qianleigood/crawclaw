use std::collections::HashSet;

use serde_json::{json, Value};

use super::bank_resolver::{BankContext, BankResolverConfig};
use super::config::{HindsightConfig, HindsightQualityConfig};
use super::feedback_guard::extract_text_content;
use super::hindsight_client::{HindsightClient, RecallItem};
use super::quality::{rewrite_recall_query_with_config, MemoryQualityProfile};

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
    pub recall_min_score: f64,
    pub recall_rerank_top_k: usize,
    pub quality: HindsightQualityConfig,
}

impl From<&HindsightConfig> for RecallConfig {
    fn from(config: &HindsightConfig) -> Self {
        let profile = MemoryQualityProfile::for_language_hint_with_config(
            &config.language_hints.primary_language,
            &config.quality,
        );
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
            recall_min_score: profile.recall_min_score,
            recall_rerank_top_k: profile.recall_rerank_top_k,
            quality: config.quality.clone(),
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
    let rewritten = rewrite_recall_query_with_config(
        &expanded,
        &config.primary_language,
        config.bilingual_technical_terms,
        &config.quality,
    );

    truncate_at_sentence_boundary(&rewritten, config.recall_max_query_chars)
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
            Ok(response) => all_items.extend(tag_recall_items_with_layer(response.items, layer)),
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
    let all_items = dedupe_recall_items(all_items);
    let all_items = apply_recall_quality(
        all_items,
        config.recall_min_score,
        config.recall_rerank_top_k,
    );

    let budget = config.max_tokens as usize;
    enforce_token_budget(all_items, budget)
}

fn tag_recall_items_with_layer(items: Vec<RecallItem>, layer: &str) -> Vec<RecallItem> {
    items
        .into_iter()
        .map(|mut item| {
            if let Some(metadata) = item.metadata.as_object_mut() {
                metadata.insert("layer".to_string(), json!(layer));
            } else {
                item.metadata = json!({
                    "layer": layer,
                    "raw": item.metadata,
                });
            }
            item
        })
        .collect()
}

fn dedupe_recall_items(items: Vec<RecallItem>) -> Vec<RecallItem> {
    let mut seen = HashSet::new();
    items
        .into_iter()
        .filter(|item| item.id.is_empty() || seen.insert(item.id.clone()))
        .collect()
}

#[cfg(test)]
fn tag_recall_items_with_layer_for_test(items: Vec<RecallItem>, layer: &str) -> Vec<RecallItem> {
    tag_recall_items_with_layer(items, layer)
}

#[cfg(test)]
fn dedupe_recall_items_for_test(items: Vec<RecallItem>) -> Vec<RecallItem> {
    dedupe_recall_items(items)
}

fn apply_recall_quality(
    items: Vec<RecallItem>,
    min_score: f64,
    rerank_top_k: usize,
) -> Vec<RecallItem> {
    let mut result: Vec<RecallItem> = items
        .into_iter()
        .filter(|item| item.score >= min_score)
        .collect();
    if rerank_top_k > 0 && result.len() > rerank_top_k {
        result.truncate(rerank_top_k);
    }
    result
}

#[cfg(test)]
fn apply_recall_quality_for_test(
    items: Vec<RecallItem>,
    min_score: f64,
    rerank_top_k: usize,
) -> Vec<RecallItem> {
    apply_recall_quality(items, min_score, rerank_top_k)
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
            recall_min_score: 0.0,
            recall_rerank_top_k: 12,
            quality: HindsightQualityConfig::default(),
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
    fn chinese_recall_query_rewrite_preserves_terms_and_aliases() {
        let messages = vec![
            json!({"role": "user", "content": "线上网关在高峰期出现超时，需要排查缓存和数据库。"}),
            json!({"role": "assistant", "content": "建议先看 gateway 日志，再检查 cache hit rate。"}),
        ];
        let config = RecallConfig {
            default_budget: "mid".to_string(),
            max_tokens: 2048,
            recall_context_turns: 1,
            recall_max_query_chars: 800,
            recall_types: vec!["observation".to_string()],
            tags_match: "all_strict".to_string(),
            tags: vec!["agent:main".to_string()],
            bilingual_technical_terms: true,
            primary_language: "zh-CN".to_string(),
            recall_min_score: 0.15,
            recall_rerank_top_k: 12,
            quality: HindsightQualityConfig::default(),
        };

        let query = compose_recall_query("如何恢复网关稳定性？", &messages, &config);

        assert!(query.contains("检索问题"));
        assert!(query.contains("如何恢复网关稳定性"));
        assert!(query.contains("gateway"));
        assert!(query.contains("cache"));
        assert!(query.contains("数据库"));
    }

    #[test]
    fn recall_quality_filters_low_scores_and_caps_rerank_top_k() {
        let items = vec![
            RecallItem {
                id: "high".to_string(),
                text: "高相关中文记忆".to_string(),
                memory_type: "observation".to_string(),
                score: 0.92,
                metadata: json!({}),
            },
            RecallItem {
                id: "mid".to_string(),
                text: "中等相关记忆".to_string(),
                memory_type: "observation".to_string(),
                score: 0.41,
                metadata: json!({}),
            },
            RecallItem {
                id: "low".to_string(),
                text: "低相关噪声".to_string(),
                memory_type: "observation".to_string(),
                score: 0.04,
                metadata: json!({}),
            },
        ];

        let filtered = apply_recall_quality_for_test(items, 0.1, 1);

        assert_eq!(filtered.len(), 1);
        assert_eq!(filtered[0].id, "high");
    }

    #[test]
    fn tags_recall_items_with_query_layer() {
        let items = vec![RecallItem {
            id: "one".to_string(),
            text: "remembered".to_string(),
            memory_type: "observation".to_string(),
            score: 1.0,
            metadata: json!({ "source": "hindsight" }),
        }];
        let tagged = tag_recall_items_with_layer_for_test(items, "durable");
        assert_eq!(tagged[0].metadata["layer"], "durable");
        assert_eq!(tagged[0].metadata["source"], "hindsight");
    }

    #[test]
    fn preserves_recall_items_without_ids_when_deduping() {
        let items = vec![
            RecallItem {
                id: String::new(),
                text: "first".to_string(),
                memory_type: "observation".to_string(),
                score: 1.0,
                metadata: json!({}),
            },
            RecallItem {
                id: String::new(),
                text: "second".to_string(),
                memory_type: "observation".to_string(),
                score: 0.9,
                metadata: json!({}),
            },
            RecallItem {
                id: "same".to_string(),
                text: "third".to_string(),
                memory_type: "observation".to_string(),
                score: 0.8,
                metadata: json!({}),
            },
            RecallItem {
                id: "same".to_string(),
                text: "duplicate".to_string(),
                memory_type: "observation".to_string(),
                score: 0.7,
                metadata: json!({}),
            },
        ];
        let deduped = dedupe_recall_items_for_test(items);
        assert_eq!(
            deduped
                .iter()
                .map(|item| item.text.as_str())
                .collect::<Vec<_>>(),
            vec!["first", "second", "third"]
        );
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

    #[test]
    fn recall_config_uses_quality_overrides() {
        let mut config = HindsightConfig::default();
        config.language_hints.primary_language = "zh-CN".to_string();
        config.quality.recall_min_score = Some(0.33);
        config.quality.recall_rerank_top_k = Some(4);

        let recall = RecallConfig::from(&config);

        assert_eq!(recall.recall_min_score, 0.33);
        assert_eq!(recall.recall_rerank_top_k, 4);
    }

    #[test]
    fn recall_config_can_disable_chinese_query_rewrite() {
        let messages = vec![json!({"role": "user", "content": "网关 cache 报错"})];
        let mut hindsight = HindsightConfig::default();
        hindsight.language_hints.primary_language = "zh-CN".to_string();
        hindsight.quality.query_rewrite = Some(false);
        let config = RecallConfig::from(&hindsight);

        let query = compose_recall_query("排查网关", &messages, &config);

        assert!(!query.contains("检索问题"));
        assert!(query.contains("gateway"));
        assert!(query.contains("缓存"));
    }
}
