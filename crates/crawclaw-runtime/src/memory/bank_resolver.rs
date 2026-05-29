use serde::{Deserialize, Serialize};

use super::config::HindsightConfig;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BankResolverConfig {
    pub prefix: String,
    pub granularity: Vec<String>,
    pub shared_mode: bool,
    pub shared_bank_id: String,
}

#[derive(Clone, Debug)]
pub struct BankContext {
    pub agent_id: String,
    pub channel: Option<String>,
    pub user_id: Option<String>,
}

impl BankResolverConfig {
    pub fn from_hindsight_config(config: &HindsightConfig) -> Self {
        Self {
            prefix: config.bank_prefix.clone(),
            granularity: config.bank_granularity.clone(),
            shared_mode: config.shared_mode,
            shared_bank_id: config.shared_bank_id.clone(),
        }
    }

    pub fn resolve(&self, ctx: &BankContext, layer: &str) -> String {
        if self.shared_mode {
            return format!("{}:{}", self.shared_bank_id, layer);
        }
        let mut parts = vec![self.prefix.clone()];
        for dim in &self.granularity {
            match dim.as_str() {
                "agent" => parts.push(ctx.agent_id.clone()),
                "channel" => {
                    if let Some(ref v) = ctx.channel {
                        parts.push(v.clone());
                    }
                }
                "user" => {
                    if let Some(ref v) = ctx.user_id {
                        parts.push(v.clone());
                    }
                }
                _ => {}
            }
        }
        parts.push(layer.to_string());
        parts.join(":")
    }
}

pub const LAYERS: &[&str] = &["durable", "experience", "resource", "mental-models"];

pub fn bank_mission(layer: &str, language: &str) -> (&'static str, &'static str) {
    match (layer, language) {
        ("durable", "zh-CN") => (
            "长期记忆",
            "提取用户明确表达的偏好、重要的项目决策和稳定的知识事实。跳过临时任务细节和一次性请求。",
        ),
        ("experience", "zh-CN") => (
            "经验记忆",
            "记录成功的操作方法、失败的教训和可复用的工作流程。关注可迁移的经验，而非特定任务的执行细节。",
        ),
        ("resource", "zh-CN") => (
            "资源记忆",
            "存储项目文档、代码片段和参考资料的关键信息。关注文档的核心内容和结构。",
        ),
        ("mental-models", "zh-CN") => (
            "心智模型",
            "通过反思形成的高阶理解。整合零散记忆，形成对用户、项目和工作模式的整体认知。",
        ),
        ("durable", _) => (
            "Durable Memory",
            "Extract user preferences, project decisions, and stable facts. Skip ephemeral task details.",
        ),
        ("experience", _) => (
            "Experience Memory",
            "Record reusable procedures, failure patterns, and lessons learned. Focus on transferable experience.",
        ),
        ("resource", _) => (
            "Resource Memory",
            "Store key information from documents, code, and references. Focus on core content and structure.",
        ),
        ("mental-models", _) => (
            "Mental Models",
            "Higher-order understanding formed by reflection. Synthesize scattered memories into coherent understanding.",
        ),
        _ => ("Memory", "General memory bank"),
    }
}

pub fn bank_disposition(layer: &str) -> (i32, i32, i32) {
    match layer {
        "experience" => (4, 3, 2),
        "durable" => (2, 4, 3),
        "mental-models" => (3, 2, 3),
        _ => (3, 3, 3),
    }
}
