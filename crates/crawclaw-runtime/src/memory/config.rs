use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryRuntimeConfig {
    pub runtime_store: RuntimeStoreConfig,
    pub hindsight: HindsightConfig,
    pub dreaming: DreamingConfig,
    pub session_summary: SessionSummaryConfig,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct EffectiveMemoryPolicy {
    pub hindsight_enabled: bool,
    pub memory_mode: String,
    pub prompt_recall_enabled: bool,
    pub knowledge_tools_enabled: bool,
    pub auto_retain_enabled: bool,
    pub disabled_reasons: Vec<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct EffectiveToolAllowlist {
    pub tool_allowlist: Vec<String>,
    pub effective_tool_allowlist: Vec<String>,
    pub disabled_tools: Vec<String>,
    pub disabled_reason: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeStoreConfig {
    pub db_path: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HindsightConfig {
    pub enabled: bool,
    pub base_url: String,
    pub api_key: String,
    pub bank_prefix: String,
    pub bank_granularity: Vec<String>,
    pub shared_mode: bool,
    pub shared_bank_id: String,
    pub memory_mode: String,
    pub auto_retain: bool,
    pub retain_roles: Vec<String>,
    pub retain_every_n_turns: u32,
    pub retain_overlap_turns: u32,
    pub retain_async: bool,
    pub default_budget: String,
    pub max_tokens: u32,
    pub recall_context_turns: u32,
    pub recall_max_query_chars: usize,
    pub recall_types: Vec<String>,
    pub recall_injection_position: String,
    pub auto_reflect: bool,
    pub reflect_budget: String,
    pub reflect_max_tokens: u32,
    pub default_mental_models: bool,
    pub enable_knowledge_tools: bool,
    pub tags_match: String,
    pub tags: Vec<String>,
    pub timeout_ms: u64,
    pub language_hints: LanguageHints,
    pub quality: HindsightQualityConfig,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LanguageHints {
    pub primary_language: String,
    pub bilingual_technical_terms: bool,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HindsightQualityConfig {
    pub retain_chunk_max_chars: Option<usize>,
    pub retain_chunk_overlap_chars: Option<usize>,
    pub recall_min_score: Option<f64>,
    pub recall_rerank_top_k: Option<usize>,
    pub query_rewrite: Option<bool>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DreamingConfig {
    pub enabled: bool,
    pub min_hours: u32,
    pub min_sessions: u32,
    pub scan_throttle_ms: u64,
    pub lock_stale_after_ms: u64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionSummaryConfig {
    pub enabled: bool,
    pub min_tokens_to_init: u32,
    pub min_tokens_between_updates: u32,
    pub tool_calls_between_updates: u32,
    pub max_wait_ms: u64,
    pub max_turns: u32,
}

impl Default for HindsightConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            base_url: String::new(),
            api_key: String::new(),
            bank_prefix: "crawclaw".to_string(),
            bank_granularity: vec!["agent".to_string()],
            shared_mode: false,
            shared_bank_id: "crawclaw:shared".to_string(),
            memory_mode: "hybrid".to_string(),
            auto_retain: true,
            retain_roles: vec!["user".to_string(), "assistant".to_string()],
            retain_every_n_turns: 1,
            retain_overlap_turns: 0,
            retain_async: false,
            default_budget: "mid".to_string(),
            max_tokens: 2048,
            recall_context_turns: 1,
            recall_max_query_chars: 800,
            recall_types: vec!["observation".to_string()],
            recall_injection_position: "prepend".to_string(),
            auto_reflect: true,
            reflect_budget: "high".to_string(),
            reflect_max_tokens: 2048,
            default_mental_models: true,
            enable_knowledge_tools: false,
            tags_match: "all_strict".to_string(),
            tags: vec!["agent:main".to_string()],
            timeout_ms: 15_000,
            language_hints: LanguageHints::default(),
            quality: HindsightQualityConfig::default(),
        }
    }
}

impl Default for LanguageHints {
    fn default() -> Self {
        Self {
            primary_language: "auto".to_string(),
            bilingual_technical_terms: true,
        }
    }
}

impl Default for DreamingConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            min_hours: 4,
            min_sessions: 3,
            scan_throttle_ms: 300_000,
            lock_stale_after_ms: 600_000,
        }
    }
}

impl Default for SessionSummaryConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            min_tokens_to_init: 500,
            min_tokens_between_updates: 300,
            tool_calls_between_updates: 5,
            max_wait_ms: 30_000,
            max_turns: 5,
        }
    }
}

impl Default for RuntimeStoreConfig {
    fn default() -> Self {
        Self {
            db_path: "~/.crawclaw/memory-runtime.db".to_string(),
        }
    }
}

impl Default for MemoryRuntimeConfig {
    fn default() -> Self {
        Self {
            runtime_store: RuntimeStoreConfig::default(),
            hindsight: HindsightConfig::default(),
            dreaming: DreamingConfig::default(),
            session_summary: SessionSummaryConfig::default(),
        }
    }
}

impl HindsightConfig {
    pub fn prompt_recall_enabled(&self) -> bool {
        self.enabled && !self.memory_mode.trim().eq_ignore_ascii_case("tools")
    }

    pub fn knowledge_tools_enabled(&self) -> bool {
        self.enabled
            && self.enable_knowledge_tools
            && !self.memory_mode.trim().eq_ignore_ascii_case("context")
    }
}

impl EffectiveMemoryPolicy {
    pub fn from_config(config: &MemoryRuntimeConfig) -> Self {
        Self::from_hindsight_config(&config.hindsight)
    }

    pub fn from_hindsight_config(config: &HindsightConfig) -> Self {
        let prompt_recall_enabled = config.prompt_recall_enabled();
        let knowledge_tools_enabled = config.knowledge_tools_enabled();
        let auto_retain_enabled = config.enabled && config.auto_retain;
        let mut disabled_reasons = Vec::new();
        if !config.enabled {
            disabled_reasons.push("memory.hindsight.enabled=false".to_string());
        }
        if config.memory_mode.trim().eq_ignore_ascii_case("context") {
            disabled_reasons.push(
                "memory.hindsight.memoryMode=context disables Hindsight knowledge tools"
                    .to_string(),
            );
        }
        if config.memory_mode.trim().eq_ignore_ascii_case("tools") {
            disabled_reasons
                .push("memory.hindsight.memoryMode=tools disables prompt recall".to_string());
        }
        if !config.enable_knowledge_tools {
            disabled_reasons.push("memory.hindsight.enableKnowledgeTools=false".to_string());
        }
        if !config.auto_retain {
            disabled_reasons.push("memory.hindsight.autoRetain=false".to_string());
        }
        Self {
            hindsight_enabled: config.enabled,
            memory_mode: config.memory_mode.clone(),
            prompt_recall_enabled,
            knowledge_tools_enabled,
            auto_retain_enabled,
            disabled_reasons,
        }
    }

    pub fn apply_tool_allowlist<S: AsRef<str>>(&self, tools: &[S]) -> EffectiveToolAllowlist {
        let mut tool_allowlist = Vec::new();
        let mut effective_tool_allowlist = Vec::new();
        let mut disabled_tools = Vec::new();
        for tool in tools {
            let tool = tool.as_ref().to_string();
            tool_allowlist.push(tool.clone());
            if is_hindsight_knowledge_tool_name(&tool) && !self.knowledge_tools_enabled {
                disabled_tools.push(tool);
            } else {
                effective_tool_allowlist.push(tool);
            }
        }
        let disabled_reason = if disabled_tools.is_empty() {
            String::new()
        } else {
            self.knowledge_tool_disabled_reason()
        };
        EffectiveToolAllowlist {
            tool_allowlist,
            effective_tool_allowlist,
            disabled_tools,
            disabled_reason,
        }
    }

    fn knowledge_tool_disabled_reason(&self) -> String {
        self.disabled_reasons
            .iter()
            .find(|reason| {
                reason.contains("enabled=false")
                    || reason.contains("memoryMode=context")
                    || reason.contains("enableKnowledgeTools=false")
            })
            .cloned()
            .unwrap_or_else(|| "Hindsight knowledge tools are disabled".to_string())
    }
}

pub fn is_hindsight_knowledge_tool_name(tool_name: &str) -> bool {
    matches!(
        tool_name,
        "knowledge_recall"
            | "knowledge_reflect"
            | "knowledge_ingest"
            | "knowledge_model_list"
            | "knowledge_model_create"
    )
}
