use super::*;

use crate::agent_tool_result_projection::ToolResultProjectionBudget;

const DEFAULT_CONTEXT_WINDOW_TOKENS: usize = 128_000;
const DEFAULT_OUTPUT_RESERVE_TOKENS: usize = 16_384;
const DEFAULT_PROVIDER_OVERHEAD_TOKENS: usize = 1_024;

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct ContextBudgetBasis {
    pub(crate) provider: String,
    pub(crate) model: String,
    pub(crate) model_context_window: usize,
    pub(crate) output_reserve_tokens: usize,
    pub(crate) provider_overhead_tokens: usize,
    pub(crate) agent_context_cap_tokens: Option<usize>,
    pub(crate) supports_tools: bool,
    pub(crate) supports_reasoning: bool,
    pub(crate) supports_image_input: bool,
    pub(crate) supports_streaming: bool,
    pub(crate) source: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct EffectiveContextBudget {
    pub(crate) provider: String,
    pub(crate) model: String,
    pub(crate) model_context_window: usize,
    pub(crate) resolved_context_window: usize,
    pub(crate) output_reserve_tokens: usize,
    pub(crate) provider_overhead_tokens: usize,
    pub(crate) tool_schema_tokens: usize,
    pub(crate) max_prompt_tokens: usize,
    pub(crate) supports_tools: bool,
    pub(crate) supports_reasoning: bool,
    pub(crate) supports_image_input: bool,
    pub(crate) supports_streaming: bool,
    pub(crate) source: String,
}

impl ContextBudgetBasis {
    pub(crate) fn with_tool_schema_tokens(
        &self,
        tool_schema_tokens: usize,
    ) -> EffectiveContextBudget {
        let resolved_context_window = self
            .agent_context_cap_tokens
            .map(|cap| self.model_context_window.min(cap))
            .unwrap_or(self.model_context_window);
        let reserved_tokens = self
            .output_reserve_tokens
            .saturating_add(self.provider_overhead_tokens)
            .saturating_add(tool_schema_tokens);
        EffectiveContextBudget {
            provider: self.provider.clone(),
            model: self.model.clone(),
            model_context_window: self.model_context_window,
            resolved_context_window,
            output_reserve_tokens: self.output_reserve_tokens,
            provider_overhead_tokens: self.provider_overhead_tokens,
            tool_schema_tokens,
            max_prompt_tokens: resolved_context_window
                .saturating_sub(reserved_tokens)
                .max(1),
            supports_tools: self.supports_tools,
            supports_reasoning: self.supports_reasoning,
            supports_image_input: self.supports_image_input,
            supports_streaming: self.supports_streaming,
            source: self.source.clone(),
        }
    }
}

impl EffectiveContextBudget {
    pub(crate) fn tool_result_projection_budget(&self) -> ToolResultProjectionBudget {
        ToolResultProjectionBudget::from_prompt_budget_tokens(self.max_prompt_tokens)
    }
}

#[derive(Clone, Copy)]
struct RuntimeContextBudgetSettings {
    context_cap_tokens: Option<usize>,
    reserve_tokens: usize,
    provider_overhead_tokens: usize,
}

#[derive(Clone, Copy)]
struct ModelLimits {
    context_window: usize,
    max_tokens: usize,
    capabilities: ModelCapabilities,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct ModelCapabilities {
    supports_tools: bool,
    supports_reasoning: bool,
    supports_image_input: bool,
    supports_streaming: bool,
}

impl Default for ModelCapabilities {
    fn default() -> Self {
        Self {
            supports_tools: true,
            supports_reasoning: true,
            supports_image_input: true,
            supports_streaming: true,
        }
    }
}

impl ModelCapabilities {
    fn with_transport(self, provider: &str) -> Self {
        let Some(transport) = crawclaw_providers::native_provider_transport_for_id(provider) else {
            return self;
        };
        Self {
            supports_tools: self.supports_tools && transport.capabilities.tool_calling,
            supports_reasoning: self.supports_reasoning,
            supports_image_input: self.supports_image_input && transport.capabilities.multimodal,
            supports_streaming: self.supports_streaming && transport.capabilities.streaming,
        }
    }
}

pub(crate) fn resolve_context_budget_basis(
    runtime_root: &Path,
    provider_config: Option<&NativeProviderConfig>,
) -> ContextBudgetBasis {
    let config = read_runtime_config(runtime_root);
    let settings = context_budget_settings(config.as_ref());
    let provider = provider_config
        .map(|config| config.provider.trim())
        .filter(|value| !value.is_empty())
        .unwrap_or("configured")
        .to_string();
    let model = provider_config
        .and_then(|config| config.model.as_deref())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("configured")
        .to_string();
    let (limits, source) = configured_model_limits(config.as_ref(), &provider, &model)
        .map(|limits| (limits, "config-model".to_string()))
        .or_else(|| {
            crawclaw_providers::bundled_provider_model_limit_for(&provider, &model).map(|limits| {
                (
                    ModelLimits {
                        context_window: limits.context_window,
                        max_tokens: limits.max_tokens,
                        capabilities: ModelCapabilities::default(),
                    },
                    "bundled-model".to_string(),
                )
            })
        })
        .unwrap_or_else(|| {
            (
                ModelLimits {
                    context_window: settings
                        .context_cap_tokens
                        .unwrap_or(DEFAULT_CONTEXT_WINDOW_TOKENS),
                    max_tokens: settings.reserve_tokens,
                    capabilities: ModelCapabilities::default(),
                },
                "fallback".to_string(),
            )
        });
    let output_reserve_tokens = settings.reserve_tokens.min(limits.max_tokens).max(1);
    let capabilities = limits.capabilities.with_transport(&provider);
    ContextBudgetBasis {
        provider,
        model,
        model_context_window: limits.context_window.max(1),
        output_reserve_tokens,
        provider_overhead_tokens: settings.provider_overhead_tokens,
        agent_context_cap_tokens: settings.context_cap_tokens,
        supports_tools: capabilities.supports_tools,
        supports_reasoning: capabilities.supports_reasoning,
        supports_image_input: capabilities.supports_image_input,
        supports_streaming: capabilities.supports_streaming,
        source,
    }
}

pub(crate) fn estimate_tool_schema_tokens(tools: &[RustAgentToolDescriptor]) -> usize {
    let chars = tools
        .iter()
        .map(|tool| {
            serde_json::to_string(tool)
                .map(|raw| raw.len())
                .unwrap_or(0)
        })
        .sum::<usize>();
    chars.div_ceil(4)
}

fn read_runtime_config(runtime_root: &Path) -> Option<Value> {
    let path = runtime_root.join("config").join("crawclaw.json");
    let raw = fs::read_to_string(path).ok()?;
    serde_json::from_str::<Value>(&raw).ok()
}

fn context_budget_settings(config: Option<&Value>) -> RuntimeContextBudgetSettings {
    RuntimeContextBudgetSettings {
        context_cap_tokens: config
            .and_then(|value| positive_usize_at(value, "/agents/defaults/contextTokens")),
        reserve_tokens: config
            .and_then(|value| positive_usize_at(value, "/agents/defaults/compaction/reserveTokens"))
            .unwrap_or(DEFAULT_OUTPUT_RESERVE_TOKENS),
        provider_overhead_tokens: DEFAULT_PROVIDER_OVERHEAD_TOKENS,
    }
}

fn configured_model_limits(
    config: Option<&Value>,
    provider: &str,
    model: &str,
) -> Option<ModelLimits> {
    let models = config?
        .pointer("/models/providers")?
        .as_object()?
        .get(provider)?
        .get("models")?
        .as_array()?;
    models.iter().find_map(|entry| {
        let id = entry.get("id").and_then(Value::as_str)?;
        if id != model {
            return None;
        }
        Some(ModelLimits {
            context_window: positive_usize_field(entry, "contextWindow")?,
            max_tokens: positive_usize_field(entry, "maxTokens")?,
            capabilities: configured_model_capabilities(entry),
        })
    })
}

fn configured_model_capabilities(entry: &Value) -> ModelCapabilities {
    let reasoning = bool_field(entry, "reasoning").unwrap_or(true);
    ModelCapabilities {
        supports_tools: compat_bool_field(entry, "supportsTools").unwrap_or(true),
        supports_reasoning: compat_bool_field(entry, "supportsReasoningEffort")
            .unwrap_or(reasoning),
        supports_image_input: input_supports_image(entry),
        supports_streaming: compat_bool_field(entry, "supportsStreaming").unwrap_or(true),
    }
}

fn input_supports_image(entry: &Value) -> bool {
    let Some(inputs) = entry.get("input").and_then(Value::as_array) else {
        return true;
    };
    inputs.iter().filter_map(Value::as_str).any(|input| {
        let input = input.trim().to_ascii_lowercase();
        input == "image" || input == "images" || input == "vision"
    })
}

fn compat_bool_field(value: &Value, field: &str) -> Option<bool> {
    value
        .get("compat")
        .and_then(Value::as_object)?
        .get(field)?
        .as_bool()
}

fn bool_field(value: &Value, field: &str) -> Option<bool> {
    value.get(field).and_then(Value::as_bool)
}

fn positive_usize_at(value: &Value, pointer: &str) -> Option<usize> {
    value
        .pointer(pointer)
        .and_then(Value::as_u64)
        .and_then(|value| usize::try_from(value).ok())
        .filter(|value| *value > 0)
}

fn positive_usize_field(value: &Value, field: &str) -> Option<usize> {
    value
        .get(field)
        .and_then(Value::as_u64)
        .and_then(|value| usize::try_from(value).ok())
        .filter(|value| *value > 0)
}
