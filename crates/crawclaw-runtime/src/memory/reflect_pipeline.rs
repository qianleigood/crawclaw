use serde_json::{json, Value};

use super::bank_resolver::{BankContext, BankResolverConfig};
use super::config::HindsightConfig;
use super::hindsight_client::HindsightClient;

#[derive(Clone, Debug)]
pub struct ReflectConfig {
    pub auto_reflect: bool,
    pub reflect_budget: String,
    pub reflect_max_tokens: u32,
    pub default_mental_models: bool,
    pub min_hours: u32,
}

impl ReflectConfig {
    pub fn from_hindsight_config(hc: &HindsightConfig, dc: &super::config::DreamingConfig) -> Self {
        Self {
            auto_reflect: hc.auto_reflect,
            reflect_budget: hc.reflect_budget.clone(),
            reflect_max_tokens: hc.reflect_max_tokens,
            default_mental_models: hc.default_mental_models,
            min_hours: dc.min_hours,
        }
    }
}

const DEFAULT_MENTAL_MODELS_ZH: &[(&str, &str)] = &[
    ("用户偏好", "用户的长期偏好、习惯、沟通风格是什么？"),
    (
        "项目知识",
        "当前项目的技术栈、架构决策、已知问题是什么？",
    ),
    (
        "工作模式",
        "用户常见的工作流程、重复出现的模式是什么？",
    ),
    (
        "决策历史",
        "过去做过的重要决策及其理由是什么？",
    ),
];

const DEFAULT_MENTAL_MODELS_EN: &[(&str, &str)] = &[
    (
        "User Preferences",
        "What are the user's long-term preferences, habits, and communication style?",
    ),
    (
        "Project Knowledge",
        "What is the current project's tech stack, architecture decisions, and known issues?",
    ),
    (
        "Work Patterns",
        "What are the user's common workflows and recurring patterns?",
    ),
    (
        "Decision History",
        "What important decisions have been made and what were the reasons?",
    ),
];

pub fn ensure_default_mental_models(
    client: &HindsightClient,
    bank_id: &str,
    language: &str,
) -> Result<(), String> {
    let defaults = if language.starts_with("zh") {
        DEFAULT_MENTAL_MODELS_ZH
    } else {
        DEFAULT_MENTAL_MODELS_EN
    };

    let existing = client.list_mental_models(bank_id).unwrap_or_default();
    let existing_names: Vec<&str> = existing.iter().map(|m| m.name.as_str()).collect();

    for (name, query) in defaults {
        if !existing_names.contains(name) {
            client.create_mental_model(
                bank_id,
                name,
                query,
                vec!["auto".to_string(), "dream".to_string()],
                2048,
            )?;
        }
    }

    Ok(())
}

pub fn compose_reflection_query(recent_summaries: &[String]) -> String {
    let mut parts = vec![
        "Based on recent interactions, what patterns, preferences, and lessons should be consolidated?".to_string(),
    ];

    for (i, summary) in recent_summaries.iter().enumerate() {
        if !summary.trim().is_empty() {
            parts.push(format!("Session {}: {}", i + 1, summary));
        }
    }

    parts.join("\n\n")
}

pub fn dream_reflect(
    client: &HindsightClient,
    resolver: &BankResolverConfig,
    ctx: &BankContext,
    config: &ReflectConfig,
    recent_summaries: &[String],
) -> Result<Value, String> {
    if !config.auto_reflect {
        return Ok(json!({ "status": "skipped", "reason": "auto_reflect_disabled" }));
    }

    if !client.is_configured() {
        return Ok(json!({ "status": "skipped", "reason": "hindsight_not_configured" }));
    }

    let query = compose_reflection_query(recent_summaries);

    let durable_bank = resolver.resolve(ctx, "durable");
    let reflection = client.reflect(
        &durable_bank,
        &query,
        &config.reflect_budget,
        config.reflect_max_tokens,
    )?;

    let mm_bank = resolver.resolve(ctx, "mental-models");
    let tags = vec![
        format!("agent:{}", ctx.agent_id),
        "layer:mental-model".to_string(),
    ];
    let tag_refs: Vec<&str> = tags.iter().map(|s| s.as_str()).collect();

    let metadata = json!({
        "source": "dream",
        "agentId": ctx.agent_id,
    });

    match client.retain(
        &mm_bank,
        &reflection.text,
        "dream_consolidation",
        metadata,
        &tag_refs,
    ) {
        Ok(_) => {}
        Err(e) => {
            tracing::warn!(error = %e, "failed_to_store_mental_model");
        }
    }

    let models = client.list_mental_models(&mm_bank).unwrap_or_default();
    let mut refreshed = 0;
    for model in &models {
        if model.trigger_refresh_after_consolidation {
            match client.refresh_mental_model(&mm_bank, &model.id) {
                Ok(_) => refreshed += 1,
                Err(e) => {
                    tracing::warn!(model_id = %model.id, error = %e, "failed_to_refresh_mental_model");
                }
            }
        }
    }

    Ok(json!({
        "status": "completed",
        "reflection": reflection.text,
        "modelsRefreshed": refreshed,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn compose_reflection_query_includes_summaries() {
        let summaries = vec![
            "User asked about Rust memory management".to_string(),
            "Discussed async vs sync approaches".to_string(),
        ];
        let query = compose_reflection_query(&summaries);
        assert!(query.contains("patterns, preferences"));
        assert!(query.contains("Session 1"));
        assert!(query.contains("Rust memory management"));
    }

    #[test]
    fn compose_reflection_query_handles_empty() {
        let summaries = vec![];
        let query = compose_reflection_query(&summaries);
        assert!(query.contains("patterns, preferences"));
    }
}
