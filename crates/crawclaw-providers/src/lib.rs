use std::fmt;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ProviderTransport {
    pub id: &'static str,
    pub transport: &'static str,
    pub capabilities: ProviderTransportCapabilities,
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ProviderTransportCapabilities {
    pub streaming: bool,
    pub tool_calling: bool,
    pub multimodal: bool,
    pub secret_ref: ProviderSecretRefCapabilities,
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ProviderSecretRefCapabilities {
    pub env: bool,
    pub file: bool,
    pub exec: bool,
}

#[derive(Clone, Copy, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ProviderAuthEnvVars {
    pub provider: &'static str,
    pub env_vars: &'static [&'static str],
}

#[derive(Clone, Copy, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BundledProviderPlugin {
    pub plugin_id: &'static str,
    pub providers: &'static [&'static str],
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BundledProviderPluginContractMetadata {
    pub plugin_id: String,
    pub provider_ids: Vec<String>,
    pub legacy_plugin_ids: Vec<String>,
    pub auto_enable_when_configured_providers: Vec<String>,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BundledProviderPluginMetadata {
    pub plugin_id: String,
    pub providers: Vec<String>,
    pub auth_env_vars: Value,
    pub auth_choices: Value,
    pub capabilities: BundledProviderPluginCapabilities,
}

#[derive(Clone, Copy, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BundledProviderPluginCapabilities {
    pub chat: bool,
    pub non_chat: bool,
    pub image_generation: bool,
    pub media_understanding: bool,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BundledProviderDescriptor {
    pub plugin_id: String,
    pub provider: String,
    pub kind: String,
    pub transport: Option<String>,
    pub default_model: Option<String>,
    pub auth_env_vars: Vec<String>,
    pub auth_choices: Value,
    pub auth_methods: Vec<BundledProviderAuthChoice>,
    pub capabilities: BundledProviderPluginCapabilities,
    pub transport_capabilities: Option<ProviderTransportCapabilities>,
}

#[derive(Clone, Copy, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BundledProviderDefaultModel {
    pub provider: &'static str,
    pub model: &'static str,
    pub name: &'static str,
    pub reasoning: bool,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BundledProviderAuthChoice {
    pub plugin_id: String,
    pub provider: String,
    pub method: String,
    pub choice_id: String,
    pub choice_label: String,
    pub choice_hint: Option<String>,
    pub group_id: String,
    pub group_label: String,
    pub group_hint: Option<String>,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BundledProviderSetupOption {
    pub plugin_id: String,
    pub provider: String,
    pub method: String,
    pub value: String,
    pub label: String,
    pub hint: Option<String>,
    pub group_id: String,
    pub group_label: String,
    pub group_hint: Option<String>,
    pub onboarding_scopes: Vec<String>,
}

#[derive(Clone, Copy, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BundledProviderModelPickerEntry {
    pub provider: &'static str,
    pub method: &'static str,
    pub value: &'static str,
    pub label: &'static str,
    pub hint: &'static str,
}

#[derive(Clone, Copy, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BundledProviderUsageDescriptor {
    pub provider: &'static str,
    pub display_name: &'static str,
    pub auth_provider: &'static str,
    pub aliases: &'static [&'static str],
    pub extra_env_keys: &'static [&'static str],
}

#[derive(Clone, Copy, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BundledWebProviderBoundary {
    pub surface: &'static str,
    pub plugin_id: &'static str,
    pub provider: &'static str,
    pub label: &'static str,
    pub product_boundary: &'static str,
    pub execution_runtime: &'static str,
    pub runtime_major: Option<u16>,
    pub sidecar: Option<&'static str>,
}

#[derive(Clone, Copy, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ProviderModelAlias {
    pub from: &'static str,
    pub to: &'static str,
}

#[derive(Clone, Copy, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ProviderModelDefaultCost {
    pub input: u32,
    pub output: u32,
    pub cache_read: u32,
    pub cache_write: u32,
}

#[derive(Clone, Copy, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ProviderCapabilitiesDefault {
    pub anthropic_tool_schema_mode: &'static str,
    pub anthropic_tool_choice_mode: &'static str,
    pub open_ai_payload_normalization_mode: &'static str,
    pub provider_family: &'static str,
    pub preserve_anthropic_thinking_signatures: bool,
    pub open_ai_compat_turn_validation: bool,
    pub gemini_thought_signature_sanitization: bool,
    pub transcript_tool_call_id_mode: &'static str,
    pub transcript_tool_call_id_model_hints: &'static [&'static str],
    pub gemini_thought_signature_model_hints: &'static [&'static str],
    pub drop_thinking_block_model_hints: &'static [&'static str],
}

#[derive(Clone, Copy, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ProviderCapabilityFallback {
    pub provider: &'static str,
    pub anthropic_tool_schema_mode: Option<&'static str>,
    pub anthropic_tool_choice_mode: Option<&'static str>,
    pub open_ai_payload_normalization_mode: Option<&'static str>,
    pub provider_family: Option<&'static str>,
    pub preserve_anthropic_thinking_signatures: Option<bool>,
    pub open_ai_compat_turn_validation: Option<bool>,
    pub gemini_thought_signature_sanitization: Option<bool>,
    pub transcript_tool_call_id_mode: Option<&'static str>,
    pub transcript_tool_call_id_model_hints: &'static [&'static str],
    pub gemini_thought_signature_model_hints: &'static [&'static str],
    pub drop_thinking_block_model_hints: &'static [&'static str],
}

#[derive(Clone, Copy, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ProviderModelNormalizationMetadata {
    pub anthropic_model_aliases: &'static [ProviderModelAlias],
    pub google_model_aliases: &'static [ProviderModelAlias],
    pub antigravity_low_suffix_ids: &'static [&'static str],
    pub xai_model_aliases: &'static [ProviderModelAlias],
}

pub const BUNDLED_PROVIDER_PLUGINS: &[BundledProviderPlugin] = &[
    BundledProviderPlugin {
        plugin_id: "amazon-bedrock",
        providers: &["amazon-bedrock"],
    },
    BundledProviderPlugin {
        plugin_id: "anthropic",
        providers: &["anthropic"],
    },
    BundledProviderPlugin {
        plugin_id: "anthropic-vertex",
        providers: &["anthropic-vertex"],
    },
    BundledProviderPlugin {
        plugin_id: "byteplus",
        providers: &["byteplus", "byteplus-plan"],
    },
    BundledProviderPlugin {
        plugin_id: "chutes",
        providers: &["chutes"],
    },
    BundledProviderPlugin {
        plugin_id: "cloudflare-ai-gateway",
        providers: &["cloudflare-ai-gateway"],
    },
    BundledProviderPlugin {
        plugin_id: "copilot-proxy",
        providers: &["copilot-proxy"],
    },
    BundledProviderPlugin {
        plugin_id: "deepseek",
        providers: &["deepseek"],
    },
    BundledProviderPlugin {
        plugin_id: "fal",
        providers: &["fal"],
    },
    BundledProviderPlugin {
        plugin_id: "github-copilot",
        providers: &["github-copilot"],
    },
    BundledProviderPlugin {
        plugin_id: "google",
        providers: &["google", "google-gemini-cli"],
    },
    BundledProviderPlugin {
        plugin_id: "huggingface",
        providers: &["huggingface"],
    },
    BundledProviderPlugin {
        plugin_id: "kilocode",
        providers: &["kilocode"],
    },
    BundledProviderPlugin {
        plugin_id: "kimi",
        providers: &["kimi", "kimi-coding"],
    },
    BundledProviderPlugin {
        plugin_id: "litellm",
        providers: &["litellm"],
    },
    BundledProviderPlugin {
        plugin_id: "microsoft-foundry",
        providers: &["microsoft-foundry"],
    },
    BundledProviderPlugin {
        plugin_id: "minimax",
        providers: &["minimax", "minimax-portal"],
    },
    BundledProviderPlugin {
        plugin_id: "mistral",
        providers: &["mistral"],
    },
    BundledProviderPlugin {
        plugin_id: "modelstudio",
        providers: &["modelstudio"],
    },
    BundledProviderPlugin {
        plugin_id: "moonshot",
        providers: &["moonshot"],
    },
    BundledProviderPlugin {
        plugin_id: "nvidia",
        providers: &["nvidia"],
    },
    BundledProviderPlugin {
        plugin_id: "ollama",
        providers: &["ollama"],
    },
    BundledProviderPlugin {
        plugin_id: "openai",
        providers: &["openai", "openai-codex"],
    },
    BundledProviderPlugin {
        plugin_id: "opencode",
        providers: &["opencode"],
    },
    BundledProviderPlugin {
        plugin_id: "opencode-go",
        providers: &["opencode-go"],
    },
    BundledProviderPlugin {
        plugin_id: "openrouter",
        providers: &["openrouter"],
    },
    BundledProviderPlugin {
        plugin_id: "qianfan",
        providers: &["qianfan"],
    },
    BundledProviderPlugin {
        plugin_id: "sglang",
        providers: &["sglang"],
    },
    BundledProviderPlugin {
        plugin_id: "synthetic",
        providers: &["synthetic"],
    },
    BundledProviderPlugin {
        plugin_id: "together",
        providers: &["together"],
    },
    BundledProviderPlugin {
        plugin_id: "venice",
        providers: &["venice"],
    },
    BundledProviderPlugin {
        plugin_id: "vercel-ai-gateway",
        providers: &["vercel-ai-gateway"],
    },
    BundledProviderPlugin {
        plugin_id: "vllm",
        providers: &["vllm"],
    },
    BundledProviderPlugin {
        plugin_id: "volcengine",
        providers: &["volcengine", "volcengine-plan"],
    },
    BundledProviderPlugin {
        plugin_id: "xai",
        providers: &["xai"],
    },
    BundledProviderPlugin {
        plugin_id: "xiaomi",
        providers: &["xiaomi"],
    },
    BundledProviderPlugin {
        plugin_id: "zai",
        providers: &["zai"],
    },
];

const BUNDLED_PROVIDER_PLUGIN_MANIFESTS: &[(&str, &str)] = &[
    (
        "amazon-bedrock",
        include_str!("../../../extensions/amazon-bedrock/crawclaw.plugin.json"),
    ),
    (
        "anthropic",
        include_str!("../../../extensions/anthropic/crawclaw.plugin.json"),
    ),
    (
        "anthropic-vertex",
        include_str!("../../../extensions/anthropic-vertex/crawclaw.plugin.json"),
    ),
    (
        "byteplus",
        include_str!("../../../extensions/byteplus/crawclaw.plugin.json"),
    ),
    (
        "chutes",
        include_str!("../../../extensions/chutes/crawclaw.plugin.json"),
    ),
    (
        "cloudflare-ai-gateway",
        include_str!("../../../extensions/cloudflare-ai-gateway/crawclaw.plugin.json"),
    ),
    (
        "copilot-proxy",
        include_str!("../../../extensions/copilot-proxy/crawclaw.plugin.json"),
    ),
    (
        "deepseek",
        include_str!("../../../extensions/deepseek/crawclaw.plugin.json"),
    ),
    (
        "fal",
        include_str!("../../../extensions/fal/crawclaw.plugin.json"),
    ),
    (
        "github-copilot",
        include_str!("../../../extensions/github-copilot/crawclaw.plugin.json"),
    ),
    (
        "google",
        include_str!("../../../extensions/google/crawclaw.plugin.json"),
    ),
    (
        "huggingface",
        include_str!("../../../extensions/huggingface/crawclaw.plugin.json"),
    ),
    (
        "kilocode",
        include_str!("../../../extensions/kilocode/crawclaw.plugin.json"),
    ),
    (
        "kimi",
        include_str!("../../../extensions/kimi-coding/crawclaw.plugin.json"),
    ),
    (
        "litellm",
        include_str!("../../../extensions/litellm/crawclaw.plugin.json"),
    ),
    (
        "microsoft-foundry",
        include_str!("../../../extensions/microsoft-foundry/crawclaw.plugin.json"),
    ),
    (
        "minimax",
        include_str!("../../../extensions/minimax/crawclaw.plugin.json"),
    ),
    (
        "mistral",
        include_str!("../../../extensions/mistral/crawclaw.plugin.json"),
    ),
    (
        "modelstudio",
        include_str!("../../../extensions/modelstudio/crawclaw.plugin.json"),
    ),
    (
        "moonshot",
        include_str!("../../../extensions/moonshot/crawclaw.plugin.json"),
    ),
    (
        "nvidia",
        include_str!("../../../extensions/nvidia/crawclaw.plugin.json"),
    ),
    (
        "ollama",
        include_str!("../../../extensions/ollama/crawclaw.plugin.json"),
    ),
    (
        "openai",
        include_str!("../../../extensions/openai/crawclaw.plugin.json"),
    ),
    (
        "opencode",
        include_str!("../../../extensions/opencode/crawclaw.plugin.json"),
    ),
    (
        "opencode-go",
        include_str!("../../../extensions/opencode-go/crawclaw.plugin.json"),
    ),
    (
        "openrouter",
        include_str!("../../../extensions/openrouter/crawclaw.plugin.json"),
    ),
    (
        "qianfan",
        include_str!("../../../extensions/qianfan/crawclaw.plugin.json"),
    ),
    (
        "sglang",
        include_str!("../../../extensions/sglang/crawclaw.plugin.json"),
    ),
    (
        "synthetic",
        include_str!("../../../extensions/synthetic/crawclaw.plugin.json"),
    ),
    (
        "together",
        include_str!("../../../extensions/together/crawclaw.plugin.json"),
    ),
    (
        "venice",
        include_str!("../../../extensions/venice/crawclaw.plugin.json"),
    ),
    (
        "vercel-ai-gateway",
        include_str!("../../../extensions/vercel-ai-gateway/crawclaw.plugin.json"),
    ),
    (
        "vllm",
        include_str!("../../../extensions/vllm/crawclaw.plugin.json"),
    ),
    (
        "volcengine",
        include_str!("../../../extensions/volcengine/crawclaw.plugin.json"),
    ),
    (
        "xai",
        include_str!("../../../extensions/xai/crawclaw.plugin.json"),
    ),
    (
        "xiaomi",
        include_str!("../../../extensions/xiaomi/crawclaw.plugin.json"),
    ),
    (
        "zai",
        include_str!("../../../extensions/zai/crawclaw.plugin.json"),
    ),
];

pub const BUNDLED_PROVIDER_AUTH_ENV_VAR_CANDIDATES: &[ProviderAuthEnvVars] = &[
    ProviderAuthEnvVars {
        provider: "anthropic",
        env_vars: &["ANTHROPIC_OAUTH_TOKEN", "ANTHROPIC_API_KEY"],
    },
    ProviderAuthEnvVars {
        provider: "byteplus",
        env_vars: &["BYTEPLUS_API_KEY"],
    },
    ProviderAuthEnvVars {
        provider: "chutes",
        env_vars: &["CHUTES_API_KEY"],
    },
    ProviderAuthEnvVars {
        provider: "cloudflare-ai-gateway",
        env_vars: &["CLOUDFLARE_AI_GATEWAY_API_KEY"],
    },
    ProviderAuthEnvVars {
        provider: "deepseek",
        env_vars: &["DEEPSEEK_API_KEY"],
    },
    ProviderAuthEnvVars {
        provider: "fal",
        env_vars: &["FAL_KEY"],
    },
    ProviderAuthEnvVars {
        provider: "github-copilot",
        env_vars: &["COPILOT_GITHUB_TOKEN", "GH_TOKEN", "GITHUB_TOKEN"],
    },
    ProviderAuthEnvVars {
        provider: "google",
        env_vars: &["GEMINI_API_KEY", "GOOGLE_API_KEY"],
    },
    ProviderAuthEnvVars {
        provider: "huggingface",
        env_vars: &["HUGGINGFACE_HUB_TOKEN", "HF_TOKEN"],
    },
    ProviderAuthEnvVars {
        provider: "kilocode",
        env_vars: &["KILOCODE_API_KEY"],
    },
    ProviderAuthEnvVars {
        provider: "kimi",
        env_vars: &["KIMI_API_KEY", "KIMICODE_API_KEY"],
    },
    ProviderAuthEnvVars {
        provider: "kimi-coding",
        env_vars: &["KIMI_API_KEY", "KIMICODE_API_KEY"],
    },
    ProviderAuthEnvVars {
        provider: "litellm",
        env_vars: &["LITELLM_API_KEY"],
    },
    ProviderAuthEnvVars {
        provider: "microsoft-foundry",
        env_vars: &["AZURE_OPENAI_API_KEY"],
    },
    ProviderAuthEnvVars {
        provider: "minimax",
        env_vars: &["MINIMAX_API_KEY"],
    },
    ProviderAuthEnvVars {
        provider: "minimax-portal",
        env_vars: &["MINIMAX_OAUTH_TOKEN", "MINIMAX_API_KEY"],
    },
    ProviderAuthEnvVars {
        provider: "mistral",
        env_vars: &["MISTRAL_API_KEY"],
    },
    ProviderAuthEnvVars {
        provider: "modelstudio",
        env_vars: &["MODELSTUDIO_API_KEY"],
    },
    ProviderAuthEnvVars {
        provider: "moonshot",
        env_vars: &["MOONSHOT_API_KEY"],
    },
    ProviderAuthEnvVars {
        provider: "nvidia",
        env_vars: &["NVIDIA_API_KEY"],
    },
    ProviderAuthEnvVars {
        provider: "ollama",
        env_vars: &["OLLAMA_API_KEY"],
    },
    ProviderAuthEnvVars {
        provider: "openai",
        env_vars: &["OPENAI_API_KEY"],
    },
    ProviderAuthEnvVars {
        provider: "opencode",
        env_vars: &["OPENCODE_API_KEY", "OPENCODE_ZEN_API_KEY"],
    },
    ProviderAuthEnvVars {
        provider: "opencode-go",
        env_vars: &["OPENCODE_API_KEY", "OPENCODE_ZEN_API_KEY"],
    },
    ProviderAuthEnvVars {
        provider: "openrouter",
        env_vars: &["OPENROUTER_API_KEY"],
    },
    ProviderAuthEnvVars {
        provider: "qianfan",
        env_vars: &["QIANFAN_API_KEY"],
    },
    ProviderAuthEnvVars {
        provider: "sglang",
        env_vars: &["SGLANG_API_KEY"],
    },
    ProviderAuthEnvVars {
        provider: "synthetic",
        env_vars: &["SYNTHETIC_API_KEY"],
    },
    ProviderAuthEnvVars {
        provider: "together",
        env_vars: &["TOGETHER_API_KEY"],
    },
    ProviderAuthEnvVars {
        provider: "venice",
        env_vars: &["VENICE_API_KEY"],
    },
    ProviderAuthEnvVars {
        provider: "vercel-ai-gateway",
        env_vars: &["AI_GATEWAY_API_KEY"],
    },
    ProviderAuthEnvVars {
        provider: "vllm",
        env_vars: &["VLLM_API_KEY"],
    },
    ProviderAuthEnvVars {
        provider: "volcengine",
        env_vars: &["VOLCANO_ENGINE_API_KEY"],
    },
    ProviderAuthEnvVars {
        provider: "xai",
        env_vars: &["XAI_API_KEY"],
    },
    ProviderAuthEnvVars {
        provider: "xiaomi",
        env_vars: &["XIAOMI_API_KEY"],
    },
    ProviderAuthEnvVars {
        provider: "zai",
        env_vars: &["ZAI_API_KEY", "Z_AI_API_KEY"],
    },
];

pub const CORE_PROVIDER_AUTH_ENV_VAR_CANDIDATES: &[ProviderAuthEnvVars] = &[
    ProviderAuthEnvVars {
        provider: "chutes",
        env_vars: &["CHUTES_API_KEY"],
    },
    ProviderAuthEnvVars {
        provider: "voyage",
        env_vars: &["VOYAGE_API_KEY"],
    },
    ProviderAuthEnvVars {
        provider: "groq",
        env_vars: &["GROQ_API_KEY"],
    },
    ProviderAuthEnvVars {
        provider: "deepgram",
        env_vars: &["DEEPGRAM_API_KEY"],
    },
    ProviderAuthEnvVars {
        provider: "cerebras",
        env_vars: &["CEREBRAS_API_KEY"],
    },
    ProviderAuthEnvVars {
        provider: "litellm",
        env_vars: &["LITELLM_API_KEY"],
    },
    ProviderAuthEnvVars {
        provider: "anthropic-openai",
        env_vars: &["ANTHROPIC_API_KEY"],
    },
    ProviderAuthEnvVars {
        provider: "qwen-dashscope",
        env_vars: &["DASHSCOPE_API_KEY"],
    },
];

pub const CORE_PROVIDER_SETUP_ENV_VAR_OVERRIDES: &[ProviderAuthEnvVars] = &[
    ProviderAuthEnvVars {
        provider: "anthropic",
        env_vars: &["ANTHROPIC_API_KEY", "ANTHROPIC_OAUTH_TOKEN"],
    },
    ProviderAuthEnvVars {
        provider: "chutes",
        env_vars: &["CHUTES_API_KEY"],
    },
    ProviderAuthEnvVars {
        provider: "minimax-cn",
        env_vars: &["MINIMAX_API_KEY"],
    },
];

pub const EXTRA_PROVIDER_AUTH_ENV_VARS: &[&str] = &["MINIMAX_CODE_PLAN_KEY"];

pub const PROVIDER_USAGE_LABELS: &[(&str, &str)] = &[
    ("anthropic", "Claude"),
    ("github-copilot", "Copilot"),
    ("google-gemini-cli", "Gemini"),
    ("minimax", "MiniMax"),
    ("openai-codex", "Codex"),
    ("xiaomi", "Xiaomi"),
    ("zai", "z.ai"),
];

pub const PROVIDER_ATTRIBUTION_PRODUCT: &str = "CrawClaw";
pub const PROVIDER_ATTRIBUTION_ORIGINATOR: &str = "crawclaw";
pub const LOCAL_ENDPOINT_HOSTS: &[&str] = &["localhost", "127.0.0.1", "::1", "[::1]"];
pub const MOONSHOT_NATIVE_BASE_URLS: &[&str] =
    &["https://api.moonshot.ai/v1", "https://api.moonshot.cn/v1"];
pub const MODELSTUDIO_NATIVE_BASE_URLS: &[&str] = &[
    "https://coding-intl.dashscope.aliyuncs.com/v1",
    "https://coding.dashscope.aliyuncs.com/v1",
    "https://dashscope.aliyuncs.com/compatible-mode/v1",
    "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
];
pub const OPENAI_RESPONSES_APIS: &[&str] = &["openai-responses", "azure-openai-responses"];
pub const OPENAI_RESPONSES_PROVIDERS: &[&str] =
    &["openai", "azure-openai", "azure-openai-responses"];
pub const MOONSHOT_COMPAT_PROVIDERS: &[&str] = &["moonshot", "kimi"];
pub const TRANSCRIPT_OPENAI_MODEL_APIS: &[&str] = &[
    "openai",
    "openai-completions",
    "openai-responses",
    "openai-codex-responses",
];
pub const TRANSCRIPT_ANTHROPIC_MODEL_APIS: &[&str] =
    &["anthropic-messages", "bedrock-converse-stream"];
pub const OPENAI_COMPATIBLE_TURN_VALIDATION_API: &str = "openai-completions";
pub const OPENAI_COMPATIBLE_TOOL_ID_SANITIZATION_APIS: &[&str] = &[
    "openai-completions",
    "openai-responses",
    "openai-codex-responses",
    "azure-openai-responses",
];
pub const KNOWN_PROVIDER_FAMILIES: &[(&str, &str)] = &[
    ("anthropic", "anthropic"),
    ("azure-openai", "openai-family"),
    ("azure-openai-responses", "openai-family"),
    ("github-copilot", "github-copilot"),
    ("google", "google"),
    ("groq", "groq"),
    ("kimi", "moonshot"),
    ("mistral", "mistral"),
    ("modelstudio", "modelstudio"),
    ("moonshot", "moonshot"),
    ("openai", "openai-family"),
    ("openai-codex", "openai-family"),
    ("openrouter", "openrouter"),
    ("dashscope", "modelstudio"),
    ("together", "together"),
];

const RUST_PROVIDER_CAPABILITIES: ProviderTransportCapabilities = ProviderTransportCapabilities {
    streaming: true,
    tool_calling: true,
    multimodal: true,
    secret_ref: ProviderSecretRefCapabilities {
        env: true,
        file: true,
        exec: false,
    },
};

pub const NATIVE_PROVIDER_TRANSPORTS: &[ProviderTransport] = &[
    ProviderTransport {
        id: "amazon-bedrock",
        transport: "bedrock-converse-stream",
        capabilities: RUST_PROVIDER_CAPABILITIES,
    },
    ProviderTransport {
        id: "anthropic",
        transport: "anthropic-messages",
        capabilities: RUST_PROVIDER_CAPABILITIES,
    },
    ProviderTransport {
        id: "anthropic-vertex",
        transport: "anthropic-messages",
        capabilities: RUST_PROVIDER_CAPABILITIES,
    },
    ProviderTransport {
        id: "azure-openai",
        transport: "azure-openai-responses",
        capabilities: RUST_PROVIDER_CAPABILITIES,
    },
    ProviderTransport {
        id: "bedrock",
        transport: "bedrock-converse-stream",
        capabilities: RUST_PROVIDER_CAPABILITIES,
    },
    ProviderTransport {
        id: "byteplus",
        transport: "openai-completions",
        capabilities: RUST_PROVIDER_CAPABILITIES,
    },
    ProviderTransport {
        id: "byteplus-plan",
        transport: "openai-completions",
        capabilities: RUST_PROVIDER_CAPABILITIES,
    },
    ProviderTransport {
        id: "chutes",
        transport: "openai-completions",
        capabilities: RUST_PROVIDER_CAPABILITIES,
    },
    ProviderTransport {
        id: "cloudflare-ai-gateway",
        transport: "anthropic-messages",
        capabilities: RUST_PROVIDER_CAPABILITIES,
    },
    ProviderTransport {
        id: "copilot-proxy",
        transport: "openai-completions",
        capabilities: RUST_PROVIDER_CAPABILITIES,
    },
    ProviderTransport {
        id: "deepseek",
        transport: "openai-completions",
        capabilities: RUST_PROVIDER_CAPABILITIES,
    },
    ProviderTransport {
        id: "github-copilot",
        transport: "github-copilot",
        capabilities: RUST_PROVIDER_CAPABILITIES,
    },
    ProviderTransport {
        id: "google",
        transport: "google-generative-ai",
        capabilities: RUST_PROVIDER_CAPABILITIES,
    },
    ProviderTransport {
        id: "google-gemini-cli",
        transport: "google-generative-ai",
        capabilities: RUST_PROVIDER_CAPABILITIES,
    },
    ProviderTransport {
        id: "huggingface",
        transport: "openai-completions",
        capabilities: RUST_PROVIDER_CAPABILITIES,
    },
    ProviderTransport {
        id: "kilocode",
        transport: "openai-completions",
        capabilities: RUST_PROVIDER_CAPABILITIES,
    },
    ProviderTransport {
        id: "kimi",
        transport: "anthropic-messages",
        capabilities: RUST_PROVIDER_CAPABILITIES,
    },
    ProviderTransport {
        id: "kimi-coding",
        transport: "anthropic-messages",
        capabilities: RUST_PROVIDER_CAPABILITIES,
    },
    ProviderTransport {
        id: "litellm",
        transport: "openai-completions",
        capabilities: RUST_PROVIDER_CAPABILITIES,
    },
    ProviderTransport {
        id: "microsoft-foundry",
        transport: "openai-responses",
        capabilities: RUST_PROVIDER_CAPABILITIES,
    },
    ProviderTransport {
        id: "minimax",
        transport: "anthropic-messages",
        capabilities: RUST_PROVIDER_CAPABILITIES,
    },
    ProviderTransport {
        id: "minimax-portal",
        transport: "anthropic-messages",
        capabilities: RUST_PROVIDER_CAPABILITIES,
    },
    ProviderTransport {
        id: "mistral",
        transport: "openai-completions",
        capabilities: RUST_PROVIDER_CAPABILITIES,
    },
    ProviderTransport {
        id: "modelstudio",
        transport: "openai-completions",
        capabilities: RUST_PROVIDER_CAPABILITIES,
    },
    ProviderTransport {
        id: "moonshot",
        transport: "openai-completions",
        capabilities: RUST_PROVIDER_CAPABILITIES,
    },
    ProviderTransport {
        id: "nvidia",
        transport: "openai-completions",
        capabilities: RUST_PROVIDER_CAPABILITIES,
    },
    ProviderTransport {
        id: "ollama",
        transport: "ollama",
        capabilities: RUST_PROVIDER_CAPABILITIES,
    },
    ProviderTransport {
        id: "openai",
        transport: "openai-responses",
        capabilities: RUST_PROVIDER_CAPABILITIES,
    },
    ProviderTransport {
        id: "openai-codex",
        transport: "openai-codex-responses",
        capabilities: RUST_PROVIDER_CAPABILITIES,
    },
    ProviderTransport {
        id: "openai-compatible",
        transport: "openai-completions",
        capabilities: RUST_PROVIDER_CAPABILITIES,
    },
    ProviderTransport {
        id: "opencode",
        transport: "openai-completions",
        capabilities: RUST_PROVIDER_CAPABILITIES,
    },
    ProviderTransport {
        id: "opencode-go",
        transport: "openai-completions",
        capabilities: RUST_PROVIDER_CAPABILITIES,
    },
    ProviderTransport {
        id: "openrouter",
        transport: "openai-completions",
        capabilities: RUST_PROVIDER_CAPABILITIES,
    },
    ProviderTransport {
        id: "qianfan",
        transport: "openai-completions",
        capabilities: RUST_PROVIDER_CAPABILITIES,
    },
    ProviderTransport {
        id: "sglang",
        transport: "openai-completions",
        capabilities: RUST_PROVIDER_CAPABILITIES,
    },
    ProviderTransport {
        id: "synthetic",
        transport: "anthropic-messages",
        capabilities: RUST_PROVIDER_CAPABILITIES,
    },
    ProviderTransport {
        id: "together",
        transport: "openai-completions",
        capabilities: RUST_PROVIDER_CAPABILITIES,
    },
    ProviderTransport {
        id: "venice",
        transport: "openai-completions",
        capabilities: RUST_PROVIDER_CAPABILITIES,
    },
    ProviderTransport {
        id: "vercel-ai-gateway",
        transport: "anthropic-messages",
        capabilities: RUST_PROVIDER_CAPABILITIES,
    },
    ProviderTransport {
        id: "vllm",
        transport: "openai-completions",
        capabilities: RUST_PROVIDER_CAPABILITIES,
    },
    ProviderTransport {
        id: "volcengine",
        transport: "openai-completions",
        capabilities: RUST_PROVIDER_CAPABILITIES,
    },
    ProviderTransport {
        id: "volcengine-plan",
        transport: "openai-completions",
        capabilities: RUST_PROVIDER_CAPABILITIES,
    },
    ProviderTransport {
        id: "xai",
        transport: "openai-responses",
        capabilities: RUST_PROVIDER_CAPABILITIES,
    },
    ProviderTransport {
        id: "xiaomi",
        transport: "openai-completions",
        capabilities: RUST_PROVIDER_CAPABILITIES,
    },
    ProviderTransport {
        id: "zai",
        transport: "openai-completions",
        capabilities: RUST_PROVIDER_CAPABILITIES,
    },
];

pub const BUNDLED_PROVIDER_DEFAULT_MODELS: &[BundledProviderDefaultModel] = &[
    BundledProviderDefaultModel {
        provider: "amazon-bedrock",
        model: "anthropic.claude-sonnet-4-5-20250929-v1:0",
        name: "Claude Sonnet 4.5 on Bedrock",
        reasoning: true,
    },
    BundledProviderDefaultModel {
        provider: "anthropic",
        model: "sonnet-4.6",
        name: "Claude Sonnet 4.6",
        reasoning: true,
    },
    BundledProviderDefaultModel {
        provider: "anthropic-vertex",
        model: "claude-sonnet-4-6",
        name: "Claude Sonnet 4.6 on Vertex",
        reasoning: true,
    },
    BundledProviderDefaultModel {
        provider: "byteplus",
        model: "doubao-seed-1-6",
        name: "Doubao Seed 1.6",
        reasoning: false,
    },
    BundledProviderDefaultModel {
        provider: "byteplus-plan",
        model: "doubao-seed-1-6-thinking",
        name: "Doubao Seed 1.6 Thinking",
        reasoning: true,
    },
    BundledProviderDefaultModel {
        provider: "chutes",
        model: "deepseek-ai/DeepSeek-V3.2",
        name: "DeepSeek V3.2",
        reasoning: true,
    },
    BundledProviderDefaultModel {
        provider: "cloudflare-ai-gateway",
        model: "sonnet-4.6",
        name: "Claude Sonnet 4.6 through Cloudflare AI Gateway",
        reasoning: true,
    },
    BundledProviderDefaultModel {
        provider: "copilot-proxy",
        model: "gpt-5.4",
        name: "GPT-5.4 through Copilot Proxy",
        reasoning: true,
    },
    BundledProviderDefaultModel {
        provider: "deepseek",
        model: "deepseek-chat",
        name: "DeepSeek Chat",
        reasoning: true,
    },
    BundledProviderDefaultModel {
        provider: "github-copilot",
        model: "gpt-5.4",
        name: "GPT-5.4 through GitHub Copilot",
        reasoning: true,
    },
    BundledProviderDefaultModel {
        provider: "google",
        model: "gemini-3-pro-preview",
        name: "Gemini 3 Pro Preview",
        reasoning: true,
    },
    BundledProviderDefaultModel {
        provider: "google-gemini-cli",
        model: "gemini-3-pro-preview",
        name: "Gemini 3 Pro Preview through Gemini CLI",
        reasoning: true,
    },
    BundledProviderDefaultModel {
        provider: "huggingface",
        model: "Qwen/Qwen3-Coder-480B-A35B-Instruct",
        name: "Qwen3 Coder 480B A35B Instruct",
        reasoning: true,
    },
    BundledProviderDefaultModel {
        provider: "kilocode",
        model: "kilocode/code",
        name: "Kilo Code",
        reasoning: true,
    },
    BundledProviderDefaultModel {
        provider: "kimi",
        model: "kimi-code",
        name: "Kimi Code",
        reasoning: true,
    },
    BundledProviderDefaultModel {
        provider: "kimi-coding",
        model: "kimi-code",
        name: "Kimi Code",
        reasoning: true,
    },
    BundledProviderDefaultModel {
        provider: "litellm",
        model: "gpt-5.4",
        name: "GPT-5.4 through LiteLLM",
        reasoning: true,
    },
    BundledProviderDefaultModel {
        provider: "microsoft-foundry",
        model: "gpt-5.4",
        name: "GPT-5.4 on Microsoft Foundry",
        reasoning: true,
    },
    BundledProviderDefaultModel {
        provider: "minimax",
        model: "MiniMax-M2.7",
        name: "MiniMax M2.7",
        reasoning: true,
    },
    BundledProviderDefaultModel {
        provider: "minimax-portal",
        model: "MiniMax-M2.7",
        name: "MiniMax M2.7 Portal",
        reasoning: true,
    },
    BundledProviderDefaultModel {
        provider: "mistral",
        model: "mistral-large-latest",
        name: "Mistral Large",
        reasoning: true,
    },
    BundledProviderDefaultModel {
        provider: "modelstudio",
        model: "qwen3-coder-plus",
        name: "Qwen3 Coder Plus",
        reasoning: true,
    },
    BundledProviderDefaultModel {
        provider: "moonshot",
        model: "kimi-k2-0905-preview",
        name: "Kimi K2",
        reasoning: true,
    },
    BundledProviderDefaultModel {
        provider: "nvidia",
        model: "nvidia/llama-3.3-nemotron-super-49b-v1",
        name: "Llama 3.3 Nemotron Super",
        reasoning: true,
    },
    BundledProviderDefaultModel {
        provider: "ollama",
        model: OLLAMA_DEFAULT_MODEL,
        name: "GLM 4.7 Flash local",
        reasoning: true,
    },
    BundledProviderDefaultModel {
        provider: "openai",
        model: "gpt-5.4",
        name: "GPT-5.4",
        reasoning: true,
    },
    BundledProviderDefaultModel {
        provider: "openai-codex",
        model: "gpt-5.4",
        name: "GPT-5.4 Codex",
        reasoning: true,
    },
    BundledProviderDefaultModel {
        provider: "opencode",
        model: "opencode/zen",
        name: "OpenCode Zen",
        reasoning: true,
    },
    BundledProviderDefaultModel {
        provider: "opencode-go",
        model: "opencode/zen",
        name: "OpenCode Zen Go",
        reasoning: true,
    },
    BundledProviderDefaultModel {
        provider: "openrouter",
        model: "openai/gpt-5.4",
        name: "GPT-5.4 through OpenRouter",
        reasoning: true,
    },
    BundledProviderDefaultModel {
        provider: "qianfan",
        model: "ernie-4.5-turbo-128k",
        name: "ERNIE 4.5 Turbo",
        reasoning: true,
    },
    BundledProviderDefaultModel {
        provider: "sglang",
        model: "local",
        name: "SGLang local",
        reasoning: true,
    },
    BundledProviderDefaultModel {
        provider: "synthetic",
        model: "synthetic/mock",
        name: "Synthetic mock",
        reasoning: false,
    },
    BundledProviderDefaultModel {
        provider: "together",
        model: "meta-llama/Llama-3.3-70B-Instruct-Turbo",
        name: "Llama 3.3 70B Instruct Turbo",
        reasoning: true,
    },
    BundledProviderDefaultModel {
        provider: "venice",
        model: "venice-uncensored",
        name: "Venice Uncensored",
        reasoning: false,
    },
    BundledProviderDefaultModel {
        provider: "vercel-ai-gateway",
        model: "anthropic/claude-sonnet-4.6",
        name: "Claude Sonnet 4.6 through Vercel AI Gateway",
        reasoning: true,
    },
    BundledProviderDefaultModel {
        provider: "vllm",
        model: "local",
        name: "vLLM local",
        reasoning: true,
    },
    BundledProviderDefaultModel {
        provider: "volcengine",
        model: "doubao-seed-1-6",
        name: "Doubao Seed 1.6 on Volcengine",
        reasoning: false,
    },
    BundledProviderDefaultModel {
        provider: "volcengine-plan",
        model: "doubao-seed-1-6-thinking",
        name: "Doubao Seed 1.6 Thinking on Volcengine",
        reasoning: true,
    },
    BundledProviderDefaultModel {
        provider: "xai",
        model: "grok-4.20",
        name: "Grok 4.20",
        reasoning: true,
    },
    BundledProviderDefaultModel {
        provider: "xiaomi",
        model: "xmi-large",
        name: "Xiaomi MiLM Large",
        reasoning: true,
    },
    BundledProviderDefaultModel {
        provider: "zai",
        model: "glm-4.6",
        name: "GLM 4.6",
        reasoning: true,
    },
];

pub const BUNDLED_PROVIDER_MODEL_PICKERS: &[BundledProviderModelPickerEntry] = &[
    BundledProviderModelPickerEntry {
        provider: "ollama",
        method: "local",
        value: "provider-plugin:ollama:local",
        label: "Ollama (custom)",
        hint: "Detect models from a local or remote Ollama instance",
    },
    BundledProviderModelPickerEntry {
        provider: "sglang",
        method: "custom",
        value: "provider-plugin:sglang:custom",
        label: "SGLang (custom)",
        hint: "Enter SGLang URL + API key + model",
    },
    BundledProviderModelPickerEntry {
        provider: "vllm",
        method: "custom",
        value: "provider-plugin:vllm:custom",
        label: "vLLM (custom)",
        hint: "Enter vLLM URL + API key + model",
    },
];

pub const BUNDLED_PROVIDER_USAGE_DESCRIPTORS: &[BundledProviderUsageDescriptor] = &[
    BundledProviderUsageDescriptor {
        provider: "anthropic",
        display_name: "Claude",
        auth_provider: "anthropic",
        aliases: &["anthropic", "claude"],
        extra_env_keys: &[],
    },
    BundledProviderUsageDescriptor {
        provider: "github-copilot",
        display_name: "Copilot",
        auth_provider: "github-copilot",
        aliases: &["github-copilot"],
        extra_env_keys: &["GITHUB_COPILOT_TOKEN", "GH_COPILOT_TOKEN"],
    },
    BundledProviderUsageDescriptor {
        provider: "google-gemini-cli",
        display_name: "Gemini",
        auth_provider: "google",
        aliases: &["google-gemini-cli", "gemini", "google-gemini", "google"],
        extra_env_keys: &[],
    },
    BundledProviderUsageDescriptor {
        provider: "minimax",
        display_name: "MiniMax",
        auth_provider: "minimax",
        aliases: &["minimax"],
        extra_env_keys: &["MINIMAX_CODE_PLAN_KEY"],
    },
    BundledProviderUsageDescriptor {
        provider: "openai-codex",
        display_name: "Codex",
        auth_provider: "openai",
        aliases: &["openai-codex", "openai"],
        extra_env_keys: &["OPENAI_CODEX_TOKEN"],
    },
    BundledProviderUsageDescriptor {
        provider: "xiaomi",
        display_name: "Xiaomi",
        auth_provider: "xiaomi",
        aliases: &["xiaomi"],
        extra_env_keys: &[],
    },
    BundledProviderUsageDescriptor {
        provider: "zai",
        display_name: "z.ai",
        auth_provider: "zai",
        aliases: &["zai", "z-ai"],
        extra_env_keys: &[],
    },
];

pub const BUNDLED_WEB_PROVIDER_BOUNDARIES: &[BundledWebProviderBoundary] = &[
    BundledWebProviderBoundary {
        surface: "web-search",
        plugin_id: "searxng",
        provider: "searxng",
        label: "SearXNG",
        product_boundary: "rust-native-plugin",
        execution_runtime: "python-sidecar",
        runtime_major: None,
        sidecar: Some("searxng"),
    },
    BundledWebProviderBoundary {
        surface: "web-fetch",
        plugin_id: "spider-fetch",
        provider: "spider",
        label: "Spider",
        product_boundary: "rust-native-plugin",
        execution_runtime: "rust-static-fetch+spider-chrome",
        runtime_major: None,
        sidecar: None,
    },
];

pub const CLAUDE_CLI_BACKEND_ID: &str = "claude-cli";
pub const AGENT_DEFAULT_PROVIDER: &str = "anthropic";
pub const AGENT_DEFAULT_MODEL: &str = "claude-opus-4-6";
pub const AGENT_DEFAULT_CONTEXT_TOKENS: u32 = 200_000;
pub const AGENT_DEFAULT_MODEL_ALIASES: &[(&str, &str)] = &[
    ("opus", "anthropic/claude-opus-4-6"),
    ("sonnet", "anthropic/claude-sonnet-4-6"),
    ("gpt", "openai/gpt-5.4"),
    ("gpt-mini", "openai/gpt-5-mini"),
    ("gemini", "google/gemini-3.1-pro-preview"),
    ("gemini-flash", "google/gemini-3-flash-preview"),
    ("gemini-flash-lite", "google/gemini-3.1-flash-lite-preview"),
];
pub const PROVIDER_ID_ALIASES: &[(&str, &str)] = &[
    ("z.ai", "zai"),
    ("z-ai", "zai"),
    ("opencode-zen", "opencode"),
    ("opencode-go-auth", "opencode-go"),
    ("kimi-code", "kimi"),
    ("kimi-coding", "kimi"),
    ("bedrock", "amazon-bedrock"),
    ("aws-bedrock", "amazon-bedrock"),
    ("bytedance", "volcengine"),
    ("doubao", "volcengine"),
];
pub const PROVIDER_AUTH_ID_ALIASES: &[(&str, &str)] = &[
    ("volcengine-plan", "volcengine"),
    ("byteplus-plan", "byteplus"),
];
pub const ANTHROPIC_ADAPTIVE_THINKING_MODEL_PATTERN: &str =
    r#"^claude-(?:opus|sonnet)-4(?:\.|-)6(?:$|[-.])"#;
pub const AMAZON_BEDROCK_ADAPTIVE_THINKING_MODEL_PATTERN: &str =
    r#"claude-(?:opus|sonnet)-4(?:\.|-)6(?:$|[-.])"#;
pub const OPENAI_XHIGH_THINKING_MODEL_IDS: &[&str] = &[
    "gpt-5.4",
    "gpt-5.4-pro",
    "gpt-5.4-mini",
    "gpt-5.4-nano",
    "gpt-5.2",
];
pub const OPENAI_CODEX_XHIGH_THINKING_MODEL_IDS: &[&str] = &[
    "gpt-5.4",
    "gpt-5.3-codex-spark",
    "gpt-5.2-codex",
    "gpt-5.1-codex",
];
pub const GITHUB_COPILOT_XHIGH_THINKING_MODEL_IDS: &[&str] = &["gpt-5.2", "gpt-5.2-codex"];
pub const PROVIDER_MODEL_DEFAULT_COST: ProviderModelDefaultCost = ProviderModelDefaultCost {
    input: 0,
    output: 0,
    cache_read: 0,
    cache_write: 0,
};
pub const PROVIDER_MODEL_DEFAULT_INPUT_TYPES: &[&str] = &["text"];
pub const PROVIDER_MODEL_DEFAULT_MAX_TOKENS: u32 = 8_192;
pub const PROVIDER_DEFAULT_API_BY_PROVIDER: &[(&str, &str)] =
    &[("anthropic", "anthropic-messages")];
pub const ANTHROPIC_CONTEXT_1M_MODEL_PREFIXES: &[&str] = &["claude-opus-4", "claude-sonnet-4"];
pub const ANTHROPIC_CONTEXT_1M_TOKENS: u32 = 1_048_576;
pub const DEFAULT_PROVIDER_CAPABILITIES: ProviderCapabilitiesDefault =
    ProviderCapabilitiesDefault {
        anthropic_tool_schema_mode: "native",
        anthropic_tool_choice_mode: "native",
        open_ai_payload_normalization_mode: "default",
        provider_family: "default",
        preserve_anthropic_thinking_signatures: true,
        open_ai_compat_turn_validation: true,
        gemini_thought_signature_sanitization: false,
        transcript_tool_call_id_mode: "default",
        transcript_tool_call_id_model_hints: &[],
        gemini_thought_signature_model_hints: &[],
        drop_thinking_block_model_hints: &[],
    };
pub const PROVIDER_CAPABILITY_FALLBACKS: &[ProviderCapabilityFallback] = &[
    ProviderCapabilityFallback {
        provider: "anthropic",
        anthropic_tool_schema_mode: None,
        anthropic_tool_choice_mode: None,
        open_ai_payload_normalization_mode: None,
        provider_family: Some("anthropic"),
        preserve_anthropic_thinking_signatures: None,
        open_ai_compat_turn_validation: None,
        gemini_thought_signature_sanitization: None,
        transcript_tool_call_id_mode: None,
        transcript_tool_call_id_model_hints: &[],
        gemini_thought_signature_model_hints: &[],
        drop_thinking_block_model_hints: &["claude"],
    },
    ProviderCapabilityFallback {
        provider: "mistral",
        anthropic_tool_schema_mode: None,
        anthropic_tool_choice_mode: None,
        open_ai_payload_normalization_mode: None,
        provider_family: None,
        preserve_anthropic_thinking_signatures: None,
        open_ai_compat_turn_validation: None,
        gemini_thought_signature_sanitization: None,
        transcript_tool_call_id_mode: Some("strict9"),
        transcript_tool_call_id_model_hints: &[
            "mistral",
            "mixtral",
            "codestral",
            "pixtral",
            "devstral",
            "ministral",
            "mistralai",
        ],
        gemini_thought_signature_model_hints: &[],
        drop_thinking_block_model_hints: &[],
    },
    ProviderCapabilityFallback {
        provider: "moonshot",
        anthropic_tool_schema_mode: None,
        anthropic_tool_choice_mode: None,
        open_ai_payload_normalization_mode: Some("moonshot-thinking"),
        provider_family: None,
        preserve_anthropic_thinking_signatures: None,
        open_ai_compat_turn_validation: None,
        gemini_thought_signature_sanitization: None,
        transcript_tool_call_id_mode: None,
        transcript_tool_call_id_model_hints: &[],
        gemini_thought_signature_model_hints: &[],
        drop_thinking_block_model_hints: &[],
    },
    ProviderCapabilityFallback {
        provider: "kimi",
        anthropic_tool_schema_mode: Some("openai-functions"),
        anthropic_tool_choice_mode: Some("openai-string-modes"),
        open_ai_payload_normalization_mode: Some("moonshot-thinking"),
        provider_family: None,
        preserve_anthropic_thinking_signatures: None,
        open_ai_compat_turn_validation: None,
        gemini_thought_signature_sanitization: None,
        transcript_tool_call_id_mode: None,
        transcript_tool_call_id_model_hints: &[],
        gemini_thought_signature_model_hints: &[],
        drop_thinking_block_model_hints: &[],
    },
    ProviderCapabilityFallback {
        provider: "opencode",
        anthropic_tool_schema_mode: None,
        anthropic_tool_choice_mode: None,
        open_ai_payload_normalization_mode: None,
        provider_family: None,
        preserve_anthropic_thinking_signatures: None,
        open_ai_compat_turn_validation: Some(false),
        gemini_thought_signature_sanitization: Some(true),
        transcript_tool_call_id_mode: None,
        transcript_tool_call_id_model_hints: &[],
        gemini_thought_signature_model_hints: &["gemini"],
        drop_thinking_block_model_hints: &[],
    },
    ProviderCapabilityFallback {
        provider: "opencode-go",
        anthropic_tool_schema_mode: None,
        anthropic_tool_choice_mode: None,
        open_ai_payload_normalization_mode: None,
        provider_family: None,
        preserve_anthropic_thinking_signatures: None,
        open_ai_compat_turn_validation: Some(false),
        gemini_thought_signature_sanitization: Some(true),
        transcript_tool_call_id_mode: None,
        transcript_tool_call_id_model_hints: &[],
        gemini_thought_signature_model_hints: &["gemini"],
        drop_thinking_block_model_hints: &[],
    },
    ProviderCapabilityFallback {
        provider: "openai",
        anthropic_tool_schema_mode: None,
        anthropic_tool_choice_mode: None,
        open_ai_payload_normalization_mode: None,
        provider_family: Some("openai"),
        preserve_anthropic_thinking_signatures: None,
        open_ai_compat_turn_validation: None,
        gemini_thought_signature_sanitization: None,
        transcript_tool_call_id_mode: None,
        transcript_tool_call_id_model_hints: &[],
        gemini_thought_signature_model_hints: &[],
        drop_thinking_block_model_hints: &[],
    },
];
pub const MISTRAL_SAFE_MAX_TOKENS_BY_MODEL: &[(&str, u32)] = &[
    ("devstral-medium-latest", 32_768),
    ("magistral-small", 40_000),
    ("mistral-large-latest", 16_384),
    ("mistral-medium-2508", 8_192),
    ("mistral-small-latest", 16_384),
    ("pixtral-large-latest", 32_768),
];
pub const DEFAULT_CLAUDE_CLI_MODEL: &str = "claude-cli/claude-sonnet-4-6";
pub const ANTHROPIC_VERTEX_DEFAULT_REGION: &str = "global";
pub const ANTHROPIC_VERTEX_CREDENTIALS_MARKER: &str = "gcp-vertex-credentials";
pub const DUCKDUCKGO_DEFAULT_SAFE_SEARCH: &str = "moderate";
pub const OLLAMA_DEFAULT_BASE_URL: &str = "http://127.0.0.1:11434";
pub const OLLAMA_DEFAULT_CONTEXT_WINDOW: u32 = 128_000;
pub const OLLAMA_DEFAULT_MAX_TOKENS: u32 = 8_192;
pub const OLLAMA_DEFAULT_MODEL: &str = "glm-4.7-flash";
pub const OLLAMA_DEFAULT_EMBEDDING_MODEL: &str = "nomic-embed-text";
pub const OPENAI_DEFAULT_MODEL_REF: &str = "openai/gpt-5.4";
pub const OPENAI_CODEX_DEFAULT_MODEL_REF: &str = "openai-codex/gpt-5.4";
pub const OPENAI_DEFAULT_IMAGE_MODEL: &str = "gpt-image-1";
pub const OPENAI_DEFAULT_AUDIO_TRANSCRIPTION_MODEL: &str = "gpt-4o-mini-transcribe";
pub const OPENAI_DEFAULT_EMBEDDING_MODEL: &str = "text-embedding-3-small";
pub const GOOGLE_GEMINI_DEFAULT_MODEL_REF: &str = "google/gemini-3.1-pro-preview";
pub const OPENCODE_GO_DEFAULT_MODEL_REF: &str = "opencode-go/kimi-k2.5";
pub const OPENCODE_ZEN_DEFAULT_MODEL_REF: &str = "opencode/claude-opus-4-6";
pub const LEGACY_OPENCODE_ZEN_DEFAULT_MODEL_REFS: &[&str] =
    &["opencode/claude-opus-4-5", "opencode-zen/claude-opus-4-5"];

pub const ANTHROPIC_MODEL_ALIASES: &[ProviderModelAlias] = &[
    ProviderModelAlias {
        from: "opus-4.6",
        to: "claude-opus-4-6",
    },
    ProviderModelAlias {
        from: "opus-4.5",
        to: "claude-opus-4-5",
    },
    ProviderModelAlias {
        from: "sonnet-4.6",
        to: "claude-sonnet-4-6",
    },
    ProviderModelAlias {
        from: "sonnet-4.5",
        to: "claude-sonnet-4-5",
    },
];

pub const GOOGLE_MODEL_ALIASES: &[ProviderModelAlias] = &[
    ProviderModelAlias {
        from: "gemini-3-pro",
        to: "gemini-3-pro-preview",
    },
    ProviderModelAlias {
        from: "gemini-3-flash",
        to: "gemini-3-flash-preview",
    },
    ProviderModelAlias {
        from: "gemini-3.1-pro",
        to: "gemini-3.1-pro-preview",
    },
    ProviderModelAlias {
        from: "gemini-3.1-flash-lite",
        to: "gemini-3.1-flash-lite-preview",
    },
    ProviderModelAlias {
        from: "gemini-3.1-flash",
        to: "gemini-3-flash-preview",
    },
    ProviderModelAlias {
        from: "gemini-3.1-flash-preview",
        to: "gemini-3-flash-preview",
    },
];

pub const ANTIGRAVITY_LOW_SUFFIX_IDS: &[&str] =
    &["gemini-3-pro", "gemini-3.1-pro", "gemini-3-1-pro"];

pub const XAI_MODEL_ALIASES: &[ProviderModelAlias] = &[
    ProviderModelAlias {
        from: "grok-4-fast-reasoning",
        to: "grok-4-fast",
    },
    ProviderModelAlias {
        from: "grok-4-1-fast-reasoning",
        to: "grok-4-1-fast",
    },
    ProviderModelAlias {
        from: "grok-4.20-experimental-beta-0304-reasoning",
        to: "grok-4.20-beta-latest-reasoning",
    },
    ProviderModelAlias {
        from: "grok-4.20-reasoning",
        to: "grok-4.20-beta-latest-reasoning",
    },
    ProviderModelAlias {
        from: "grok-4.20-experimental-beta-0304-non-reasoning",
        to: "grok-4.20-beta-latest-non-reasoning",
    },
    ProviderModelAlias {
        from: "grok-4.20-non-reasoning",
        to: "grok-4.20-beta-latest-non-reasoning",
    },
];

pub fn is_claude_cli_provider(provider_id: &str) -> bool {
    provider_id
        .trim()
        .eq_ignore_ascii_case(CLAUDE_CLI_BACKEND_ID)
}

pub fn to_claude_cli_model_ref(raw: &str) -> Option<String> {
    let trimmed = raw.trim();
    let model_id = trimmed.strip_prefix("anthropic/")?.trim();
    if !model_id.to_ascii_lowercase().starts_with("claude-") {
        return None;
    }
    Some(format!("{CLAUDE_CLI_BACKEND_ID}/{model_id}"))
}

pub fn normalize_anthropic_vertex_region(value: Option<&str>) -> String {
    let Some(region) = value.map(str::trim).filter(|region| !region.is_empty()) else {
        return ANTHROPIC_VERTEX_DEFAULT_REGION.to_string();
    };
    if region
        .chars()
        .all(|ch| ch.is_ascii_lowercase() || ch.is_ascii_digit() || ch == '-')
    {
        return region.to_string();
    }
    ANTHROPIC_VERTEX_DEFAULT_REGION.to_string()
}

pub fn anthropic_vertex_region_from_base_url(base_url: &str) -> Option<String> {
    let trimmed = base_url.trim();
    if trimmed.is_empty() {
        return None;
    }
    let without_scheme = trimmed
        .strip_prefix("https://")
        .or_else(|| trimmed.strip_prefix("http://"))
        .unwrap_or(trimmed);
    let host = without_scheme
        .split('/')
        .next()
        .unwrap_or("")
        .split(':')
        .next()
        .unwrap_or("");
    if host.eq_ignore_ascii_case("aiplatform.googleapis.com") {
        return Some(ANTHROPIC_VERTEX_DEFAULT_REGION.to_string());
    }
    let suffix = "-aiplatform.googleapis.com";
    let lower = host.to_ascii_lowercase();
    lower
        .strip_suffix(suffix)
        .filter(|region| {
            !region.is_empty()
                && region
                    .chars()
                    .all(|ch| ch.is_ascii_lowercase() || ch.is_ascii_digit() || ch == '-')
        })
        .map(ToString::to_string)
}

pub fn anthropic_vertex_config_api_key_marker(has_available_auth: bool) -> Option<&'static str> {
    has_available_auth.then_some(ANTHROPIC_VERTEX_CREDENTIALS_MARKER)
}

pub fn normalize_anthropic_model_id(id: &str) -> String {
    let trimmed = id.trim();
    if trimmed.is_empty() {
        return trimmed.to_string();
    }
    let lower = trimmed.to_ascii_lowercase();
    ANTHROPIC_MODEL_ALIASES
        .iter()
        .find(|alias| alias.from == lower)
        .map(|alias| alias.to)
        .unwrap_or(trimmed)
        .to_string()
}

pub fn normalize_google_model_id(id: &str) -> String {
    GOOGLE_MODEL_ALIASES
        .iter()
        .find(|alias| alias.from == id)
        .map(|alias| alias.to)
        .unwrap_or(id)
        .to_string()
}

pub fn normalize_antigravity_model_id(id: &str) -> String {
    if ANTIGRAVITY_LOW_SUFFIX_IDS.contains(&id) {
        format!("{id}-low")
    } else {
        id.to_string()
    }
}

pub fn normalize_xai_model_id(id: &str) -> String {
    XAI_MODEL_ALIASES
        .iter()
        .find(|alias| alias.from == id)
        .map(|alias| alias.to)
        .unwrap_or(id)
        .to_string()
}

pub fn normalize_duckduckgo_safe_search(value: Option<&str>) -> &'static str {
    match value.map(str::trim).map(str::to_ascii_lowercase).as_deref() {
        Some("strict") => "strict",
        Some("off") => "off",
        _ => DUCKDUCKGO_DEFAULT_SAFE_SEARCH,
    }
}

pub fn native_provider_transports() -> Vec<ProviderTransport> {
    NATIVE_PROVIDER_TRANSPORTS.to_vec()
}

pub fn native_provider_ids() -> Vec<&'static str> {
    NATIVE_PROVIDER_TRANSPORTS
        .iter()
        .map(|provider| provider.id)
        .collect()
}

pub fn bundled_provider_plugins() -> Vec<BundledProviderPlugin> {
    BUNDLED_PROVIDER_PLUGINS.to_vec()
}

pub fn bundled_provider_plugin_metadata() -> Vec<BundledProviderPluginMetadata> {
    BUNDLED_PROVIDER_PLUGIN_MANIFESTS
        .iter()
        .map(|(plugin_id, raw)| parse_bundled_provider_plugin_metadata(plugin_id, raw))
        .collect()
}

pub fn bundled_provider_plugin_contract_metadata() -> Vec<BundledProviderPluginContractMetadata> {
    BUNDLED_PROVIDER_PLUGIN_MANIFESTS
        .iter()
        .map(|(plugin_id, raw)| parse_bundled_provider_plugin_contract_metadata(plugin_id, raw))
        .filter(|entry| {
            !entry.provider_ids.is_empty()
                || !entry.legacy_plugin_ids.is_empty()
                || !entry.auto_enable_when_configured_providers.is_empty()
        })
        .collect()
}

pub fn bundled_provider_auth_choices() -> Vec<BundledProviderAuthChoice> {
    BUNDLED_PROVIDER_PLUGIN_MANIFESTS
        .iter()
        .flat_map(|(plugin_id, raw)| parse_bundled_provider_auth_choices(plugin_id, raw))
        .collect()
}

pub fn bundled_provider_setup_options() -> Vec<BundledProviderSetupOption> {
    bundled_provider_auth_choices()
        .into_iter()
        .map(|choice| BundledProviderSetupOption {
            plugin_id: choice.plugin_id,
            provider: choice.provider,
            method: choice.method,
            value: choice.choice_id,
            label: choice.choice_label,
            hint: choice.choice_hint,
            group_id: choice.group_id,
            group_label: choice.group_label,
            group_hint: choice.group_hint,
            onboarding_scopes: Vec::new(),
        })
        .collect()
}

pub fn bundled_provider_model_picker_entries() -> Vec<BundledProviderModelPickerEntry> {
    BUNDLED_PROVIDER_MODEL_PICKERS.to_vec()
}

pub fn bundled_provider_usage_descriptors() -> Vec<BundledProviderUsageDescriptor> {
    BUNDLED_PROVIDER_USAGE_DESCRIPTORS.to_vec()
}

pub fn bundled_web_provider_boundaries() -> Vec<BundledWebProviderBoundary> {
    BUNDLED_WEB_PROVIDER_BOUNDARIES.to_vec()
}

pub fn provider_model_normalization_metadata() -> ProviderModelNormalizationMetadata {
    ProviderModelNormalizationMetadata {
        anthropic_model_aliases: ANTHROPIC_MODEL_ALIASES,
        google_model_aliases: GOOGLE_MODEL_ALIASES,
        antigravity_low_suffix_ids: ANTIGRAVITY_LOW_SUFFIX_IDS,
        xai_model_aliases: XAI_MODEL_ALIASES,
    }
}

pub fn bundled_provider_descriptors() -> Vec<BundledProviderDescriptor> {
    BUNDLED_PROVIDER_PLUGIN_MANIFESTS
        .iter()
        .flat_map(|(plugin_id, raw)| parse_bundled_provider_descriptors(plugin_id, raw))
        .collect()
}

pub fn bundled_provider_ids() -> Vec<&'static str> {
    BUNDLED_PROVIDER_PLUGINS
        .iter()
        .flat_map(|plugin| plugin.providers.iter().copied())
        .collect()
}

pub fn bundled_provider_auth_env_vars() -> Vec<ProviderAuthEnvVars> {
    BUNDLED_PROVIDER_AUTH_ENV_VAR_CANDIDATES.to_vec()
}

pub fn bundled_provider_auth_env_vars_for(provider: &str) -> Option<&'static [&'static str]> {
    BUNDLED_PROVIDER_AUTH_ENV_VAR_CANDIDATES
        .iter()
        .find(|entry| entry.provider == provider)
        .map(|entry| entry.env_vars)
}

pub fn bundled_provider_default_model_for(provider: &str) -> Option<BundledProviderDefaultModel> {
    BUNDLED_PROVIDER_DEFAULT_MODELS
        .iter()
        .copied()
        .find(|entry| entry.provider == provider)
}

pub fn bundled_provider_default_models() -> Vec<BundledProviderDefaultModel> {
    BUNDLED_PROVIDER_DEFAULT_MODELS.to_vec()
}

pub fn provider_config_schema() -> Value {
    json!({
        "version": "rust-provider-config-v1",
        "schema": {
            "type": "object",
            "properties": {
                "models": {
                    "type": "object",
                    "properties": {
                        "mode": {
                            "type": "string",
                            "enum": ["merge", "replace"]
                        },
                        "providers": {
                            "type": "object",
                            "additionalProperties": provider_config_schema_provider_entry()
                        }
                    }
                }
            }
        },
        "uiHints": provider_config_ui_hints()
    })
}

pub fn provider_config_schema_lookup(path: &str) -> Value {
    let children = match path.trim() {
        "" => vec![config_lookup_child("models", "models", "Model Providers")],
        "models" => vec![
            config_lookup_child("mode", "models.mode", "Model Catalog Mode"),
            config_lookup_child("providers", "models.providers", "Model Providers"),
        ],
        "models.providers" => vec![config_lookup_child(
            "*",
            "models.providers.*",
            "Provider Entry",
        )],
        "models.providers.*" => vec![
            config_lookup_child(
                "baseUrl",
                "models.providers.*.baseUrl",
                "Model Provider Base URL",
            ),
            config_lookup_child(
                "apiKey",
                "models.providers.*.apiKey",
                "Model Provider API Key",
            ),
            config_lookup_child(
                "auth",
                "models.providers.*.auth",
                "Model Provider Auth Mode",
            ),
            config_lookup_child(
                "api",
                "models.providers.*.api",
                "Model Provider API Adapter",
            ),
            config_lookup_child(
                "injectNumCtxForOpenAICompat",
                "models.providers.*.injectNumCtxForOpenAICompat",
                "Model Provider Inject num_ctx (OpenAI Compat)",
            ),
            config_lookup_child(
                "headers",
                "models.providers.*.headers",
                "Model Provider Headers",
            ),
            config_lookup_child(
                "authHeader",
                "models.providers.*.authHeader",
                "Model Provider Authorization Header",
            ),
            config_lookup_child(
                "models",
                "models.providers.*.models",
                "Model Provider Model List",
            ),
        ],
        "models.providers.*.headers" => {
            vec![config_lookup_child(
                "*",
                "models.providers.*.headers.*",
                "Model Provider Header",
            )]
        }
        _ => Vec::new(),
    };
    json!({ "path": path, "children": children })
}

fn provider_config_schema_provider_entry() -> Value {
    json!({
        "type": "object",
        "properties": {
            "baseUrl": { "type": "string" },
            "apiKey": secret_input_schema(),
            "auth": {
                "type": "string",
                "enum": ["api-key", "aws-sdk", "oauth", "token"]
            },
            "api": {
                "type": "string",
                "enum": [
                    "openai-completions",
                    "openai-responses",
                    "openai-codex-responses",
                    "anthropic-messages",
                    "google-generative-ai",
                    "github-copilot",
                    "bedrock-converse-stream",
                    "ollama",
                    "azure-openai-responses"
                ]
            },
            "injectNumCtxForOpenAICompat": { "type": "boolean" },
            "headers": {
                "type": "object",
                "additionalProperties": secret_input_schema()
            },
            "authHeader": { "type": "boolean" },
            "models": {
                "type": "array",
                "items": model_definition_schema()
            }
        }
    })
}

fn model_definition_schema() -> Value {
    json!({
        "type": "object",
        "required": ["id", "name", "reasoning", "input", "cost", "contextWindow", "maxTokens"],
        "properties": {
            "id": { "type": "string" },
            "name": { "type": "string" },
            "api": {
                "type": "string",
                "enum": [
                    "openai-completions",
                    "openai-responses",
                    "openai-codex-responses",
                    "anthropic-messages",
                    "google-generative-ai",
                    "github-copilot",
                    "bedrock-converse-stream",
                    "ollama",
                    "azure-openai-responses"
                ]
            },
            "reasoning": { "type": "boolean" },
            "input": {
                "type": "array",
                "items": { "type": "string", "enum": ["text", "image"] }
            },
            "cost": {
                "type": "object",
                "required": ["input", "output", "cacheRead", "cacheWrite"],
                "properties": {
                    "input": { "type": "number" },
                    "output": { "type": "number" },
                    "cacheRead": { "type": "number" },
                    "cacheWrite": { "type": "number" }
                }
            },
            "contextWindow": { "type": "integer" },
            "maxTokens": { "type": "integer" },
            "headers": {
                "type": "object",
                "additionalProperties": { "type": "string" }
            },
            "compat": { "type": "object", "additionalProperties": true }
        }
    })
}

fn secret_input_schema() -> Value {
    json!({
        "oneOf": [
            { "type": "string" },
            {
                "type": "object",
                "required": ["source", "id"],
                "properties": {
                    "source": { "type": "string", "enum": ["env", "file", "exec"] },
                    "id": { "type": "string" }
                }
            }
        ]
    })
}

fn provider_config_ui_hints() -> Value {
    json!({
        "models": {
            "label": "Models",
            "help": "Model catalog and provider connection settings.",
            "tags": ["models"]
        },
        "models.mode": {
            "label": "Model Catalog Mode",
            "help": "Controls provider catalog behavior: merge keeps built-ins and overlays custom providers; replace uses only configured providers.",
            "tags": ["models"]
        },
        "models.providers": {
            "label": "Model Providers",
            "help": "Provider map keyed by provider ID containing connection/auth settings and concrete model definitions.",
            "tags": ["models"]
        },
        "models.providers.*.baseUrl": {
            "label": "Model Provider Base URL",
            "help": "Base URL for the provider endpoint used to serve model requests for that provider entry.",
            "tags": ["models", "url-secret"]
        },
        "models.providers.*.apiKey": {
            "label": "Model Provider API Key",
            "help": "Provider credential used for API-key based authentication when the provider requires direct key auth.",
            "tags": ["security", "auth", "models"],
            "sensitive": true
        },
        "models.providers.*.auth": {
            "label": "Model Provider Auth Mode",
            "help": "Selects provider auth style: api-key, token, oauth, or aws-sdk.",
            "tags": ["models"]
        },
        "models.providers.*.api": {
            "label": "Model Provider API Adapter",
            "help": "Provider API adapter selection controlling request/response compatibility handling for model calls.",
            "tags": ["models"]
        },
        "models.providers.*.injectNumCtxForOpenAICompat": {
            "label": "Model Provider Inject num_ctx (OpenAI Compat)",
            "help": "Controls whether CrawClaw injects options.num_ctx for Ollama providers configured with the OpenAI-compatible adapter.",
            "tags": ["models"]
        },
        "models.providers.*.headers": {
            "label": "Model Provider Headers",
            "help": "Static HTTP headers merged into provider requests for tenant routing, proxy auth, or custom gateway requirements.",
            "tags": ["models"]
        },
        "models.providers.*.headers.*": {
            "label": "Model Provider Header",
            "help": "Header value for a model provider request.",
            "tags": ["security", "auth", "models"],
            "sensitive": true
        },
        "models.providers.*.authHeader": {
            "label": "Model Provider Authorization Header",
            "help": "Force credential transport in the Authorization header when required.",
            "tags": ["models"]
        },
        "models.providers.*.models": {
            "label": "Model Provider Model List",
            "help": "Concrete model definitions exposed by this provider.",
            "tags": ["models"]
        }
    })
}

fn config_lookup_child(key: &str, path: &str, label: &str) -> Value {
    json!({ "key": key, "path": path, "label": label })
}

fn parse_bundled_provider_plugin_metadata(
    plugin_id: &str,
    raw: &str,
) -> BundledProviderPluginMetadata {
    let manifest = serde_json::from_str::<Value>(raw).unwrap_or_else(|_| json!({}));
    let providers = manifest
        .get("providers")
        .and_then(Value::as_array)
        .map(|values| {
            values
                .iter()
                .filter_map(Value::as_str)
                .map(ToOwned::to_owned)
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    let auth_env_vars = manifest
        .get("providerAuthEnvVars")
        .cloned()
        .unwrap_or_else(|| json!({}));
    let auth_choices = manifest
        .get("providerAuthChoices")
        .cloned()
        .unwrap_or_else(|| json!([]));
    let chat = providers.iter().any(|provider| {
        NATIVE_PROVIDER_TRANSPORTS
            .iter()
            .any(|entry| entry.id == provider)
    });
    let image_generation = plugin_id == "fal";
    let media_understanding = matches!(plugin_id, "openai");
    BundledProviderPluginMetadata {
        plugin_id: plugin_id.to_string(),
        providers,
        auth_env_vars,
        auth_choices,
        capabilities: BundledProviderPluginCapabilities {
            chat,
            non_chat: !chat,
            image_generation,
            media_understanding,
        },
    }
}

fn parse_bundled_provider_plugin_contract_metadata(
    plugin_id: &str,
    raw: &str,
) -> BundledProviderPluginContractMetadata {
    let manifest = serde_json::from_str::<Value>(raw).unwrap_or_else(|_| json!({}));
    BundledProviderPluginContractMetadata {
        plugin_id: plugin_id.to_string(),
        provider_ids: string_array_field(&manifest, "providers"),
        legacy_plugin_ids: string_array_field(&manifest, "legacyPluginIds"),
        auto_enable_when_configured_providers: string_array_field(
            &manifest,
            "autoEnableWhenConfiguredProviders",
        ),
    }
}

fn parse_bundled_provider_auth_choices(
    plugin_id: &str,
    raw: &str,
) -> Vec<BundledProviderAuthChoice> {
    let manifest = serde_json::from_str::<Value>(raw).unwrap_or_else(|_| json!({}));
    manifest
        .get("providerAuthChoices")
        .and_then(Value::as_array)
        .map(|choices| {
            choices
                .iter()
                .filter_map(|choice| parse_bundled_provider_auth_choice(plugin_id, choice))
                .collect()
        })
        .unwrap_or_default()
}

fn parse_bundled_provider_auth_choice(
    plugin_id: &str,
    choice: &Value,
) -> Option<BundledProviderAuthChoice> {
    let provider = string_field(choice, "provider")?;
    let method = string_field(choice, "method")?;
    let choice_id = string_field(choice, "choiceId")?;
    let choice_label = string_field(choice, "choiceLabel")?;
    let group_id = string_field(choice, "groupId").unwrap_or_else(|| provider.clone());
    let group_label = string_field(choice, "groupLabel").unwrap_or_else(|| choice_label.clone());
    Some(BundledProviderAuthChoice {
        plugin_id: plugin_id.to_string(),
        provider,
        method,
        choice_id,
        choice_label,
        choice_hint: string_field(choice, "choiceHint"),
        group_id,
        group_label,
        group_hint: string_field(choice, "groupHint"),
    })
}

fn string_field(value: &Value, key: &str) -> Option<String> {
    value
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|raw| !raw.is_empty())
        .map(ToOwned::to_owned)
}

fn string_array_field(value: &Value, key: &str) -> Vec<String> {
    value
        .get(key)
        .and_then(Value::as_array)
        .map(|values| {
            values
                .iter()
                .filter_map(Value::as_str)
                .map(str::trim)
                .filter(|raw| !raw.is_empty())
                .map(ToOwned::to_owned)
                .collect()
        })
        .unwrap_or_default()
}

fn parse_bundled_provider_descriptors(
    plugin_id: &str,
    raw: &str,
) -> Vec<BundledProviderDescriptor> {
    let metadata = parse_bundled_provider_plugin_metadata(plugin_id, raw);
    let auth_methods = parse_bundled_provider_auth_choices(plugin_id, raw);
    metadata
        .providers
        .iter()
        .map(|provider| {
            let transport = NATIVE_PROVIDER_TRANSPORTS
                .iter()
                .find(|entry| entry.id == provider);
            let default_model = bundled_provider_default_model_for(provider);
            let auth_env_vars = bundled_provider_auth_env_vars_for(provider)
                .unwrap_or_default()
                .iter()
                .map(|value| (*value).to_string())
                .collect::<Vec<_>>();
            BundledProviderDescriptor {
                plugin_id: metadata.plugin_id.clone(),
                provider: provider.clone(),
                kind: bundled_provider_kind(plugin_id, transport.is_some()),
                transport: transport.map(|entry| entry.transport.to_string()),
                default_model: default_model.map(|entry| entry.model.to_string()),
                auth_env_vars,
                auth_choices: metadata.auth_choices.clone(),
                auth_methods: auth_methods
                    .iter()
                    .filter(|choice| choice.provider == *provider)
                    .cloned()
                    .collect(),
                capabilities: metadata.capabilities,
                transport_capabilities: transport.map(|entry| entry.capabilities),
            }
        })
        .collect()
}

fn bundled_provider_kind(plugin_id: &str, has_chat_transport: bool) -> String {
    if has_chat_transport {
        "chat".to_string()
    } else if plugin_id == "fal" {
        "image-generation".to_string()
    } else {
        "non-chat".to_string()
    }
}

fn resolve_provider_transport(
    config: &NativeProviderConfig,
) -> Result<&str, ProviderTransportError> {
    if let Some(api) = non_empty(config.api.as_deref()) {
        return Ok(api);
    }
    NATIVE_PROVIDER_TRANSPORTS
        .iter()
        .find(|transport| transport.id == config.provider)
        .map(|transport| transport.transport)
        .ok_or_else(|| {
            ProviderTransportError::Unsupported(format!(
                "Rust provider transport is not registered: {}",
                config.provider
            ))
        })
}

fn is_default_openai_provider(provider: &str) -> bool {
    provider == "openai" || provider == "openai-codex"
}

pub fn default_model_options() -> Vec<String> {
    vec![
        "gpt-5.5".to_string(),
        "gpt-5.4".to_string(),
        "sonnet-4.6".to_string(),
        "ollama/local".to_string(),
    ]
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct OpenAiCompatibleConfig {
    pub base_url: String,
    pub api_key: String,
    pub model: String,
}

#[derive(Debug, PartialEq, Eq)]
pub enum ProviderTransportError {
    Unavailable(String),
    InvalidResponse(String),
    Unsupported(String),
}

impl fmt::Display for ProviderTransportError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Unavailable(message)
            | Self::InvalidResponse(message)
            | Self::Unsupported(message) => formatter.write_str(message),
        }
    }
}

impl std::error::Error for ProviderTransportError {}

pub async fn send_openai_compatible_message(
    config: &OpenAiCompatibleConfig,
    user_text: &str,
) -> Result<String, ProviderTransportError> {
    send_native_provider_message(
        &NativeProviderConfig {
            provider: "openai-compatible".to_string(),
            base_url: Some(config.base_url.clone()),
            api_key: Some(config.api_key.clone()),
            model: Some(config.model.clone()),
            api: None,
            api_version: None,
        },
        user_text,
    )
    .await
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct NativeProviderConfig {
    pub provider: String,
    pub base_url: Option<String>,
    pub api_key: Option<String>,
    pub model: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub api: Option<String>,
    pub api_version: Option<String>,
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum NativeProviderMessageRole {
    User,
    Assistant,
}

impl NativeProviderMessageRole {
    fn as_chat_role(self) -> &'static str {
        match self {
            Self::User => "user",
            Self::Assistant => "assistant",
        }
    }

    fn as_google_role(self) -> &'static str {
        match self {
            Self::User => "user",
            Self::Assistant => "model",
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct NativeProviderMessage {
    pub role: NativeProviderMessageRole,
    pub content: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub blocks: Vec<NativeProviderContentBlock>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum NativeProviderContentBlock {
    Text { text: String },
    Image { mime_type: String, data: String },
}

impl NativeProviderContentBlock {
    pub fn text(text: impl Into<String>) -> Self {
        Self::Text { text: text.into() }
    }

    pub fn image_base64(mime_type: impl Into<String>, data: impl Into<String>) -> Self {
        Self::Image {
            mime_type: mime_type.into(),
            data: data.into(),
        }
    }
}

impl NativeProviderMessage {
    pub fn user(content: impl Into<String>) -> Self {
        Self {
            role: NativeProviderMessageRole::User,
            content: content.into(),
            blocks: Vec::new(),
        }
    }

    pub fn assistant(content: impl Into<String>) -> Self {
        Self {
            role: NativeProviderMessageRole::Assistant,
            content: content.into(),
            blocks: Vec::new(),
        }
    }

    pub fn user_blocks(blocks: Vec<NativeProviderContentBlock>) -> Self {
        Self {
            role: NativeProviderMessageRole::User,
            content: native_content_blocks_text(&blocks),
            blocks,
        }
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct NativeProviderRequest {
    pub url: String,
    pub headers: Vec<(String, String)>,
    pub body: Value,
    pub response_format: NativeProviderResponseFormat,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum NativeProviderResponseFormat {
    OpenAiResponses,
    ChatCompletions,
    AnthropicMessages,
    GoogleGenerateContent,
    OllamaChat,
    BedrockConverse,
}

#[derive(Clone, Debug, Default, PartialEq)]
pub struct NativeProviderRequestOptions {
    pub stream: bool,
    pub tools: Vec<NativeProviderTool>,
    pub reasoning_level: Option<String>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct NativeProviderTool {
    pub name: String,
    pub description: Option<String>,
    pub input_schema: Value,
}

pub async fn send_native_provider_message(
    config: &NativeProviderConfig,
    user_text: &str,
) -> Result<String, ProviderTransportError> {
    send_native_provider_conversation(config, &[NativeProviderMessage::user(user_text)]).await
}

pub async fn send_native_provider_conversation(
    config: &NativeProviderConfig,
    messages: &[NativeProviderMessage],
) -> Result<String, ProviderTransportError> {
    send_native_provider_conversation_with_options(
        config,
        messages,
        &NativeProviderRequestOptions::default(),
    )
    .await
}

pub async fn send_native_provider_conversation_with_options(
    config: &NativeProviderConfig,
    messages: &[NativeProviderMessage],
    options: &NativeProviderRequestOptions,
) -> Result<String, ProviderTransportError> {
    let request =
        build_native_provider_conversation_request_with_options(config, messages, options)?;
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|error| ProviderTransportError::Unavailable(error.to_string()))?;
    let mut builder = client.post(&request.url);
    for (name, value) in &request.headers {
        builder = builder.header(name, value);
    }
    let response = builder
        .json(&request.body)
        .send()
        .await
        .map_err(|error| ProviderTransportError::Unavailable(error.to_string()))?;

    let status = response.status();
    if !status.is_success() {
        return Err(ProviderTransportError::Unavailable(format!(
            "provider returned HTTP {status}"
        )));
    }

    if options.stream {
        let body = response
            .text()
            .await
            .map_err(|error| ProviderTransportError::InvalidResponse(error.to_string()))?;
        return parse_native_provider_stream_response(request.response_format, &body);
    }

    let body = response
        .json::<Value>()
        .await
        .map_err(|error| ProviderTransportError::InvalidResponse(error.to_string()))?;
    parse_native_provider_response(request.response_format, body)
}

pub fn build_native_provider_request(
    config: &NativeProviderConfig,
    user_text: &str,
) -> Result<NativeProviderRequest, ProviderTransportError> {
    build_native_provider_conversation_request(config, &[NativeProviderMessage::user(user_text)])
}

pub fn build_native_provider_conversation_request(
    config: &NativeProviderConfig,
    messages: &[NativeProviderMessage],
) -> Result<NativeProviderRequest, ProviderTransportError> {
    build_native_provider_conversation_request_with_options(
        config,
        messages,
        &NativeProviderRequestOptions::default(),
    )
}

pub fn build_native_provider_conversation_request_with_options(
    config: &NativeProviderConfig,
    messages: &[NativeProviderMessage],
    options: &NativeProviderRequestOptions,
) -> Result<NativeProviderRequest, ProviderTransportError> {
    let messages = normalize_native_provider_messages(messages)?;
    let transport = resolve_provider_transport(config)?;
    if !is_implemented_native_provider_transport(transport) {
        return Err(ProviderTransportError::Unsupported(format!(
            "Unsupported Rust provider transport: {transport}"
        )));
    }
    match transport {
        "openai-responses" | "openai-codex-responses" => openai_responses_request(
            config,
            if is_default_openai_provider(&config.provider) {
                "https://api.openai.com/v1"
            } else {
                ""
            },
            "Authorization",
            "Bearer ",
            &messages,
            options,
        ),
        "azure-openai-responses" => azure_openai_request(config, &messages, options),
        "anthropic-messages" => anthropic_messages_request(config, &messages, options),
        "google-generative-ai" => google_generate_content_request(config, &messages, options),
        "ollama" => ollama_chat_request(config, &messages, options),
        "bedrock-converse-stream" => bedrock_converse_request(config, &messages, options),
        "github-copilot" => chat_completions_request(
            config,
            "https://api.githubcopilot.com",
            "Authorization",
            "Bearer ",
            &messages,
            options,
        ),
        "openai-completions" => {
            chat_completions_request(config, "", "Authorization", "Bearer ", &messages, options)
        }
        _ => unreachable!("transport implementation checked before request build"),
    }
}

fn is_implemented_native_provider_transport(transport: &str) -> bool {
    matches!(
        transport,
        "openai-responses"
            | "openai-codex-responses"
            | "azure-openai-responses"
            | "anthropic-messages"
            | "google-generative-ai"
            | "ollama"
            | "bedrock-converse-stream"
            | "github-copilot"
            | "openai-completions"
    )
}

pub fn parse_native_provider_response(
    format: NativeProviderResponseFormat,
    body: Value,
) -> Result<String, ProviderTransportError> {
    let text = match format {
        NativeProviderResponseFormat::OpenAiResponses => body
            .get("output_text")
            .and_then(Value::as_str)
            .map(ToOwned::to_owned)
            .or_else(|| {
                first_text_at_path(&body, &["output", "content", "text"]).map(ToOwned::to_owned)
            }),
        NativeProviderResponseFormat::ChatCompletions => body
            .get("choices")
            .and_then(Value::as_array)
            .and_then(|choices| choices.first())
            .and_then(|choice| choice.get("message"))
            .and_then(|message| message.get("content"))
            .and_then(Value::as_str)
            .map(ToOwned::to_owned),
        NativeProviderResponseFormat::AnthropicMessages => body
            .get("content")
            .and_then(Value::as_array)
            .and_then(|parts| text_from_parts(parts, "text")),
        NativeProviderResponseFormat::GoogleGenerateContent => body
            .get("candidates")
            .and_then(Value::as_array)
            .and_then(|candidates| candidates.first())
            .and_then(|candidate| candidate.get("content"))
            .and_then(|content| content.get("parts"))
            .and_then(Value::as_array)
            .and_then(|parts| text_from_parts(parts, "text")),
        NativeProviderResponseFormat::OllamaChat => body
            .get("message")
            .and_then(|message| message.get("content"))
            .and_then(Value::as_str)
            .map(ToOwned::to_owned),
        NativeProviderResponseFormat::BedrockConverse => body
            .get("output")
            .and_then(|output| output.get("message"))
            .and_then(|message| message.get("content"))
            .and_then(Value::as_array)
            .and_then(|parts| text_from_parts(parts, "text")),
    };
    text.filter(|content| !content.trim().is_empty())
        .ok_or_else(|| {
            ProviderTransportError::InvalidResponse(
                "provider response did not include assistant content".to_string(),
            )
        })
}

pub fn parse_native_provider_stream_delta(
    format: NativeProviderResponseFormat,
    chunk: &str,
) -> Result<Option<String>, ProviderTransportError> {
    let Some(body) = stream_chunk_json(chunk)? else {
        return Ok(None);
    };
    let text = match format {
        NativeProviderResponseFormat::OpenAiResponses => body
            .get("delta")
            .and_then(Value::as_str)
            .map(ToOwned::to_owned),
        NativeProviderResponseFormat::ChatCompletions => body
            .get("choices")
            .and_then(Value::as_array)
            .and_then(|choices| choices.first())
            .and_then(|choice| choice.get("delta"))
            .and_then(|delta| delta.get("content"))
            .and_then(Value::as_str)
            .map(ToOwned::to_owned),
        NativeProviderResponseFormat::AnthropicMessages => body
            .get("delta")
            .and_then(|delta| delta.get("text"))
            .and_then(Value::as_str)
            .map(ToOwned::to_owned),
        NativeProviderResponseFormat::GoogleGenerateContent => body
            .get("candidates")
            .and_then(Value::as_array)
            .and_then(|candidates| candidates.first())
            .and_then(|candidate| candidate.get("content"))
            .and_then(|content| content.get("parts"))
            .and_then(Value::as_array)
            .and_then(|parts| text_from_parts(parts, "text")),
        NativeProviderResponseFormat::OllamaChat => body
            .get("message")
            .and_then(|message| message.get("content"))
            .and_then(Value::as_str)
            .map(ToOwned::to_owned),
        NativeProviderResponseFormat::BedrockConverse => body
            .get("contentBlockDelta")
            .and_then(|event| event.get("delta"))
            .and_then(|delta| delta.get("text"))
            .and_then(Value::as_str)
            .map(ToOwned::to_owned),
    };
    Ok(text.filter(|text| !text.trim().is_empty()))
}

pub fn parse_native_provider_stream_response(
    format: NativeProviderResponseFormat,
    body: &str,
) -> Result<String, ProviderTransportError> {
    let mut text = String::new();
    for line in body.lines().map(str::trim).filter(|line| !line.is_empty()) {
        if line.starts_with(':') || line.starts_with("event:") || line.starts_with("id:") {
            continue;
        }
        if let Some(delta) = parse_native_provider_stream_delta(format, line)? {
            text.push_str(&delta);
        }
    }
    if text.trim().is_empty() {
        return Err(ProviderTransportError::InvalidResponse(
            "provider stream did not include assistant content".to_string(),
        ));
    }
    Ok(text)
}

fn openai_compatible_chat_completions_url(base_url: &str) -> String {
    let base_url = base_url.trim_end_matches('/');
    if base_url.ends_with("/v1") {
        format!("{base_url}/chat/completions")
    } else {
        format!("{base_url}/v1/chat/completions")
    }
}

fn openai_responses_request(
    config: &NativeProviderConfig,
    default_base_url: &str,
    auth_header: &str,
    auth_prefix: &str,
    messages: &[NativeProviderMessage],
    options: &NativeProviderRequestOptions,
) -> Result<NativeProviderRequest, ProviderTransportError> {
    let base_url = resolve_base_url(config, default_base_url)?;
    let mut body = json!({
        "model": required(&config.model, "model")?,
        "input": openai_responses_input(messages),
    });
    apply_openai_responses_options(&mut body, options);
    apply_openai_responses_provider_policy(config, &mut body);
    Ok(NativeProviderRequest {
        url: join_url_path(&base_url, "responses"),
        headers: vec![auth_pair(
            auth_header,
            auth_prefix,
            required(&config.api_key, "apiKey")?,
        )],
        body,
        response_format: NativeProviderResponseFormat::OpenAiResponses,
    })
}

fn apply_openai_responses_provider_policy(config: &NativeProviderConfig, body: &mut Value) {
    if config.provider == "xai" {
        body["tool_stream"] = Value::Bool(true);
        if let Some(object) = body.as_object_mut() {
            object.remove("reasoning");
            object.remove("reasoningEffort");
            object.remove("reasoning_effort");
        }
    }
}

fn azure_openai_request(
    config: &NativeProviderConfig,
    messages: &[NativeProviderMessage],
    options: &NativeProviderRequestOptions,
) -> Result<NativeProviderRequest, ProviderTransportError> {
    let base_url = required(&config.base_url, "baseUrl")?;
    let api_version = config
        .api_version
        .as_deref()
        .unwrap_or("2025-04-01-preview");
    let mut body = json!({
        "model": required(&config.model, "model")?,
        "input": openai_responses_input(messages),
    });
    apply_openai_responses_options(&mut body, options);
    Ok(NativeProviderRequest {
        url: format!(
            "{}?api-version={api_version}",
            join_url_path(base_url.trim_end_matches('/'), "responses")
        ),
        headers: vec![("api-key".to_string(), required(&config.api_key, "apiKey")?)],
        body,
        response_format: NativeProviderResponseFormat::OpenAiResponses,
    })
}

fn anthropic_messages_request(
    config: &NativeProviderConfig,
    messages: &[NativeProviderMessage],
    options: &NativeProviderRequestOptions,
) -> Result<NativeProviderRequest, ProviderTransportError> {
    let base_url = resolve_base_url(
        config,
        if config.provider == "anthropic" {
            "https://api.anthropic.com"
        } else {
            ""
        },
    )?;
    let mut body = json!({
        "model": required(&config.model, "model")?,
        "max_tokens": 1024,
        "messages": native_messages_for_anthropic(messages),
    });
    apply_anthropic_options(&mut body, options);
    Ok(NativeProviderRequest {
        url: join_url_path(&base_url, "v1/messages"),
        headers: vec![
            (
                "x-api-key".to_string(),
                required(&config.api_key, "apiKey")?,
            ),
            ("anthropic-version".to_string(), "2023-06-01".to_string()),
        ],
        body,
        response_format: NativeProviderResponseFormat::AnthropicMessages,
    })
}

fn google_generate_content_request(
    config: &NativeProviderConfig,
    messages: &[NativeProviderMessage],
    options: &NativeProviderRequestOptions,
) -> Result<NativeProviderRequest, ProviderTransportError> {
    let base_url = resolve_base_url(
        config,
        if config.provider == "google" {
            "https://generativelanguage.googleapis.com/v1beta"
        } else {
            ""
        },
    )?;
    let model = required(&config.model, "model")?;
    let mut body = json!({
        "contents": native_messages_for_google(messages),
    });
    apply_google_options(&mut body, options);
    let method = if options.stream {
        "streamGenerateContent"
    } else {
        "generateContent"
    };
    Ok(NativeProviderRequest {
        url: format!(
            "{}/models/{model}:{method}?key={}",
            base_url,
            required(&config.api_key, "apiKey")?
        ),
        headers: Vec::new(),
        body,
        response_format: NativeProviderResponseFormat::GoogleGenerateContent,
    })
}

fn ollama_chat_request(
    config: &NativeProviderConfig,
    messages: &[NativeProviderMessage],
    options: &NativeProviderRequestOptions,
) -> Result<NativeProviderRequest, ProviderTransportError> {
    let base_url = config
        .base_url
        .as_deref()
        .unwrap_or("http://127.0.0.1:11434")
        .trim_end_matches('/');
    let mut headers = Vec::new();
    if let Some(api_key) = non_empty(config.api_key.as_deref()) {
        headers.push(auth_pair("Authorization", "Bearer ", api_key.to_string()));
    }
    let mut body = json!({
        "model": required(&config.model, "model")?,
        "messages": native_messages_for_ollama(messages),
        "stream": options.stream,
    });
    apply_ollama_options(&mut body, options);
    Ok(NativeProviderRequest {
        url: join_url_path(base_url, "api/chat"),
        headers,
        body,
        response_format: NativeProviderResponseFormat::OllamaChat,
    })
}

fn bedrock_converse_request(
    config: &NativeProviderConfig,
    messages: &[NativeProviderMessage],
    options: &NativeProviderRequestOptions,
) -> Result<NativeProviderRequest, ProviderTransportError> {
    let base_url = required(&config.base_url, "baseUrl")?;
    let model = required(&config.model, "model")?;
    let mut headers = Vec::new();
    if let Some(api_key) = non_empty(config.api_key.as_deref()) {
        headers.push(auth_pair("Authorization", "Bearer ", api_key.to_string()));
    }
    let mut body = json!({
        "messages": native_messages_for_bedrock(messages),
    });
    apply_bedrock_options(&mut body, options);
    let method = if options.stream {
        "converse-stream"
    } else {
        "converse"
    };
    Ok(NativeProviderRequest {
        url: join_url_path(
            base_url.trim_end_matches('/'),
            &format!("model/{model}/{method}"),
        ),
        headers,
        body,
        response_format: NativeProviderResponseFormat::BedrockConverse,
    })
}

fn chat_completions_request(
    config: &NativeProviderConfig,
    default_base_url: &str,
    auth_header: &str,
    auth_prefix: &str,
    messages: &[NativeProviderMessage],
    options: &NativeProviderRequestOptions,
) -> Result<NativeProviderRequest, ProviderTransportError> {
    let base_url = config
        .base_url
        .as_deref()
        .filter(|base_url| !base_url.trim().is_empty())
        .or_else(|| non_empty(Some(default_base_url)))
        .ok_or_else(|| {
            ProviderTransportError::Unavailable("Provider config is missing baseUrl.".to_string())
        })?;
    let url = if config.provider == "openai-compatible" {
        openai_compatible_chat_completions_url(base_url)
    } else {
        join_url_path(base_url.trim_end_matches('/'), "chat/completions")
    };
    let mut body = json!({
        "model": required(&config.model, "model")?,
        "messages": native_messages_for_chat(messages),
        "stream": options.stream,
    });
    apply_chat_completions_options(&mut body, options);
    let mut headers = vec![auth_pair(
        auth_header,
        auth_prefix,
        required(&config.api_key, "apiKey")?,
    )];
    apply_openai_compatible_provider_policy(config, &mut body, &mut headers, options);
    Ok(NativeProviderRequest {
        url,
        headers,
        body,
        response_format: NativeProviderResponseFormat::ChatCompletions,
    })
}

fn apply_openai_compatible_provider_policy(
    config: &NativeProviderConfig,
    body: &mut Value,
    headers: &mut Vec<(String, String)>,
    options: &NativeProviderRequestOptions,
) {
    match config.provider.as_str() {
        "kilocode" => {
            let feature =
                std::env::var("KILOCODE_FEATURE").unwrap_or_else(|_| "crawclaw".to_string());
            upsert_header(headers, "X-KILOCODE-FEATURE", feature);
            if config
                .model
                .as_deref()
                .map(|model| model != "kilo/auto" && !is_proxy_reasoning_unsupported(model))
                .unwrap_or(false)
            {
                if let Some(level) = options.reasoning_level.as_deref() {
                    body["reasoning"] = json!({ "effort": map_reasoning_level(level) });
                    if let Some(object) = body.as_object_mut() {
                        object.remove("reasoning_effort");
                    }
                }
            }
        }
        "openrouter" => {
            upsert_header(headers, "HTTP-Referer", "https://docs.crawclaw.ai");
            upsert_header(headers, "X-OpenRouter-Title", "CrawClaw");
            upsert_header(headers, "X-OpenRouter-Categories", "cli-agent");
            if config
                .model
                .as_deref()
                .map(|model| !is_proxy_reasoning_unsupported(model))
                .unwrap_or(false)
            {
                if let Some(level) = options.reasoning_level.as_deref() {
                    body["reasoning"] = json!({ "effort": map_reasoning_level(level) });
                    if let Some(object) = body.as_object_mut() {
                        object.remove("reasoning_effort");
                    }
                }
            }
        }
        "zai" => {
            body["tool_stream"] = Value::Bool(true);
        }
        _ => {}
    }
}

fn upsert_header(headers: &mut Vec<(String, String)>, name: &str, value: impl Into<String>) {
    let value = value.into();
    if let Some((_, existing)) = headers
        .iter_mut()
        .find(|(existing, _)| existing.eq_ignore_ascii_case(name))
    {
        *existing = value;
    } else {
        headers.push((name.to_string(), value));
    }
}

fn is_proxy_reasoning_unsupported(model_id: &str) -> bool {
    model_id.to_lowercase().starts_with("x-ai/")
}

fn map_reasoning_level(level: &str) -> &str {
    match level {
        "off" => "none",
        "adaptive" => "medium",
        "minimal" | "low" | "medium" | "high" | "xhigh" => level,
        _ => "medium",
    }
}

fn resolve_base_url(
    config: &NativeProviderConfig,
    default_base_url: &str,
) -> Result<String, ProviderTransportError> {
    config
        .base_url
        .as_deref()
        .filter(|base_url| !base_url.trim().is_empty())
        .or_else(|| non_empty(Some(default_base_url)))
        .map(|base_url| base_url.trim_end_matches('/').to_string())
        .ok_or_else(|| {
            ProviderTransportError::Unavailable("Provider config is missing baseUrl.".to_string())
        })
}

fn normalize_native_provider_messages(
    messages: &[NativeProviderMessage],
) -> Result<Vec<NativeProviderMessage>, ProviderTransportError> {
    let normalized = messages
        .iter()
        .filter_map(|message| {
            let content = message.content.trim();
            let blocks = normalize_native_content_blocks(&message.blocks);
            if content.is_empty() && blocks.is_empty() {
                None
            } else {
                Some(NativeProviderMessage {
                    role: message.role,
                    content: content.to_string(),
                    blocks,
                })
            }
        })
        .collect::<Vec<_>>();
    if normalized.is_empty() {
        return Err(ProviderTransportError::Unavailable(
            "Provider request is missing messages.".to_string(),
        ));
    }
    Ok(normalized)
}

fn normalize_native_content_blocks(
    blocks: &[NativeProviderContentBlock],
) -> Vec<NativeProviderContentBlock> {
    blocks
        .iter()
        .filter_map(|block| match block {
            NativeProviderContentBlock::Text { text } => non_empty(Some(text.as_str()))
                .map(|text| NativeProviderContentBlock::text(text.to_string())),
            NativeProviderContentBlock::Image { mime_type, data } => {
                let mime_type = non_empty(Some(mime_type.as_str()))?;
                let data = non_empty(Some(data.as_str()))?;
                Some(NativeProviderContentBlock::image_base64(
                    mime_type.to_string(),
                    data.to_string(),
                ))
            }
        })
        .collect()
}

fn native_content_blocks_text(blocks: &[NativeProviderContentBlock]) -> String {
    blocks
        .iter()
        .filter_map(|block| match block {
            NativeProviderContentBlock::Text { text } => non_empty(Some(text.as_str())),
            NativeProviderContentBlock::Image { .. } => None,
        })
        .collect::<Vec<_>>()
        .join("\n")
}

fn openai_responses_input(messages: &[NativeProviderMessage]) -> Value {
    if let [message] = messages {
        if message.role == NativeProviderMessageRole::User && message.blocks.is_empty() {
            return Value::String(message.content.clone());
        }
    }
    Value::Array(
        messages
            .iter()
            .map(|message| {
                json!({
                    "role": message.role.as_chat_role(),
                    "content": openai_responses_content(message),
                })
            })
            .collect(),
    )
}

fn openai_responses_content(message: &NativeProviderMessage) -> Value {
    let blocks = native_message_blocks(message);
    Value::Array(
        blocks
            .iter()
            .map(|block| match block {
                NativeProviderContentBlock::Text { text } => {
                    json!({ "type": "input_text", "text": text })
                }
                NativeProviderContentBlock::Image { mime_type, data } => json!({
                    "type": "input_image",
                    "image_url": data_url(mime_type, data)
                }),
            })
            .collect(),
    )
}

fn native_messages_for_chat(messages: &[NativeProviderMessage]) -> Vec<Value> {
    messages
        .iter()
        .map(|message| {
            json!({
                "role": message.role.as_chat_role(),
                "content": chat_content(message),
            })
        })
        .collect()
}

fn native_messages_for_anthropic(messages: &[NativeProviderMessage]) -> Vec<Value> {
    messages
        .iter()
        .map(|message| {
            json!({
                "role": message.role.as_chat_role(),
                "content": anthropic_content(message),
            })
        })
        .collect()
}

fn native_messages_for_google(messages: &[NativeProviderMessage]) -> Vec<Value> {
    messages
        .iter()
        .map(|message| {
            json!({
                "role": message.role.as_google_role(),
                "parts": google_parts(message),
            })
        })
        .collect()
}

fn native_messages_for_bedrock(messages: &[NativeProviderMessage]) -> Vec<Value> {
    messages
        .iter()
        .map(|message| {
            json!({
                "role": message.role.as_chat_role(),
                "content": bedrock_content(message),
            })
        })
        .collect()
}

fn native_messages_for_ollama(messages: &[NativeProviderMessage]) -> Vec<Value> {
    messages
        .iter()
        .map(|message| {
            let mut value = json!({
                "role": message.role.as_chat_role(),
                "content": native_content_blocks_text(&native_message_blocks(message)),
            });
            let images = native_message_blocks(message)
                .iter()
                .filter_map(|block| match block {
                    NativeProviderContentBlock::Image { data, .. } => {
                        Some(Value::String(data.clone()))
                    }
                    NativeProviderContentBlock::Text { .. } => None,
                })
                .collect::<Vec<_>>();
            if !images.is_empty() {
                value["images"] = Value::Array(images);
            }
            value
        })
        .collect()
}

fn native_message_blocks(message: &NativeProviderMessage) -> Vec<NativeProviderContentBlock> {
    if !message.blocks.is_empty() {
        return message.blocks.clone();
    }
    vec![NativeProviderContentBlock::text(message.content.clone())]
}

fn chat_content(message: &NativeProviderMessage) -> Value {
    if message.blocks.is_empty() {
        return Value::String(message.content.clone());
    }
    Value::Array(
        native_message_blocks(message)
            .iter()
            .map(|block| match block {
                NativeProviderContentBlock::Text { text } => {
                    json!({ "type": "text", "text": text })
                }
                NativeProviderContentBlock::Image { mime_type, data } => json!({
                    "type": "image_url",
                    "image_url": { "url": data_url(mime_type, data) }
                }),
            })
            .collect(),
    )
}

fn anthropic_content(message: &NativeProviderMessage) -> Value {
    if message.blocks.is_empty() {
        return Value::String(message.content.clone());
    }
    Value::Array(
        native_message_blocks(message)
            .iter()
            .map(|block| match block {
                NativeProviderContentBlock::Text { text } => {
                    json!({ "type": "text", "text": text })
                }
                NativeProviderContentBlock::Image { mime_type, data } => json!({
                    "type": "image",
                    "source": {
                        "type": "base64",
                        "media_type": mime_type,
                        "data": data
                    }
                }),
            })
            .collect(),
    )
}

fn google_parts(message: &NativeProviderMessage) -> Vec<Value> {
    native_message_blocks(message)
        .iter()
        .map(|block| match block {
            NativeProviderContentBlock::Text { text } => json!({ "text": text }),
            NativeProviderContentBlock::Image { mime_type, data } => json!({
                "inlineData": {
                    "mimeType": mime_type,
                    "data": data
                }
            }),
        })
        .collect()
}

fn bedrock_content(message: &NativeProviderMessage) -> Vec<Value> {
    native_message_blocks(message)
        .iter()
        .map(|block| match block {
            NativeProviderContentBlock::Text { text } => json!({ "text": text }),
            NativeProviderContentBlock::Image { mime_type, data } => json!({
                "image": {
                    "format": image_format_from_mime(mime_type),
                    "source": { "bytes": data }
                }
            }),
        })
        .collect()
}

fn data_url(mime_type: &str, data: &str) -> String {
    format!("data:{mime_type};base64,{data}")
}

fn image_format_from_mime(mime_type: &str) -> &str {
    mime_type
        .rsplit('/')
        .next()
        .filter(|format| !format.trim().is_empty())
        .unwrap_or("png")
}

fn apply_openai_responses_options(body: &mut Value, options: &NativeProviderRequestOptions) {
    if options.stream {
        body["stream"] = Value::Bool(true);
    }
    if !options.tools.is_empty() {
        body["tools"] = Value::Array(options.tools.iter().map(openai_responses_tool).collect());
        body["tool_choice"] = Value::String("auto".to_string());
    }
}

fn apply_chat_completions_options(body: &mut Value, options: &NativeProviderRequestOptions) {
    if !options.tools.is_empty() {
        body["tools"] = Value::Array(options.tools.iter().map(openai_chat_tool).collect());
        body["tool_choice"] = Value::String("auto".to_string());
    }
}

fn apply_anthropic_options(body: &mut Value, options: &NativeProviderRequestOptions) {
    if options.stream {
        body["stream"] = Value::Bool(true);
    }
    if !options.tools.is_empty() {
        body["tools"] = Value::Array(options.tools.iter().map(anthropic_tool).collect());
        body["tool_choice"] = json!({ "type": "auto" });
    }
}

fn apply_google_options(body: &mut Value, options: &NativeProviderRequestOptions) {
    if !options.tools.is_empty() {
        body["tools"] = json!([{
            "functionDeclarations": options.tools.iter().map(google_tool).collect::<Vec<_>>()
        }]);
    }
}

fn apply_ollama_options(body: &mut Value, options: &NativeProviderRequestOptions) {
    if !options.tools.is_empty() {
        body["tools"] = Value::Array(options.tools.iter().map(openai_chat_tool).collect());
    }
}

fn apply_bedrock_options(body: &mut Value, options: &NativeProviderRequestOptions) {
    if !options.tools.is_empty() {
        body["toolConfig"] = json!({
            "tools": options.tools.iter().map(bedrock_tool).collect::<Vec<_>>()
        });
    }
}

fn openai_responses_tool(tool: &NativeProviderTool) -> Value {
    json!({
        "type": "function",
        "name": tool.name,
        "description": tool.description.as_deref().unwrap_or(""),
        "parameters": tool.input_schema,
    })
}

fn openai_chat_tool(tool: &NativeProviderTool) -> Value {
    json!({
        "type": "function",
        "function": {
            "name": tool.name,
            "description": tool.description.as_deref().unwrap_or(""),
            "parameters": tool.input_schema,
        }
    })
}

fn anthropic_tool(tool: &NativeProviderTool) -> Value {
    json!({
        "name": tool.name,
        "description": tool.description.as_deref().unwrap_or(""),
        "input_schema": tool.input_schema,
    })
}

fn google_tool(tool: &NativeProviderTool) -> Value {
    json!({
        "name": tool.name,
        "description": tool.description.as_deref().unwrap_or(""),
        "parameters": tool.input_schema,
    })
}

fn bedrock_tool(tool: &NativeProviderTool) -> Value {
    json!({
        "toolSpec": {
            "name": tool.name,
            "description": tool.description.as_deref().unwrap_or(""),
            "inputSchema": { "json": tool.input_schema }
        }
    })
}

fn required(value: &Option<String>, field: &str) -> Result<String, ProviderTransportError> {
    non_empty(value.as_deref())
        .map(ToOwned::to_owned)
        .ok_or_else(|| {
            ProviderTransportError::Unavailable(format!("Provider config is missing {field}."))
        })
}

fn non_empty(value: Option<&str>) -> Option<&str> {
    value.map(str::trim).filter(|value| !value.is_empty())
}

fn auth_pair(name: &str, prefix: &str, value: String) -> (String, String) {
    (name.to_string(), format!("{prefix}{}", value.trim()))
}

fn join_url_path(base_url: &str, path: &str) -> String {
    format!(
        "{}/{}",
        base_url.trim_end_matches('/'),
        path.trim_start_matches('/')
    )
}

fn text_from_parts(parts: &[Value], field: &str) -> Option<String> {
    parts
        .iter()
        .filter_map(|part| part.get(field).and_then(Value::as_str))
        .find(|text| !text.trim().is_empty())
        .map(ToOwned::to_owned)
}

fn first_text_at_path<'a>(body: &'a Value, path: &[&str]) -> Option<&'a str> {
    if path.is_empty() {
        return body.as_str();
    }
    match body {
        Value::Array(values) => values
            .iter()
            .find_map(|value| first_text_at_path(value, path)),
        Value::Object(map) => map
            .get(path[0])
            .and_then(|value| first_text_at_path(value, &path[1..])),
        _ => None,
    }
}

fn stream_chunk_json(chunk: &str) -> Result<Option<Value>, ProviderTransportError> {
    let mut payload = chunk.trim();
    if let Some(stripped) = payload.strip_prefix("data:") {
        payload = stripped.trim();
    }
    if payload.is_empty() || payload == "[DONE]" {
        return Ok(None);
    }
    serde_json::from_str(payload)
        .map(Some)
        .map_err(|error| ProviderTransportError::InvalidResponse(error.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::{BTreeMap, BTreeSet};
    use std::fs;
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::path::PathBuf;
    use std::sync::mpsc;
    use std::thread;

    const RUST_NATIVE_CHAT_MODEL_PROVIDERS: &[&str] = &[
        "amazon-bedrock",
        "anthropic",
        "anthropic-vertex",
        "azure-openai",
        "bedrock",
        "byteplus",
        "byteplus-plan",
        "chutes",
        "cloudflare-ai-gateway",
        "copilot-proxy",
        "deepseek",
        "github-copilot",
        "google",
        "google-gemini-cli",
        "huggingface",
        "kilocode",
        "kimi",
        "kimi-coding",
        "litellm",
        "microsoft-foundry",
        "minimax",
        "minimax-portal",
        "mistral",
        "modelstudio",
        "moonshot",
        "nvidia",
        "ollama",
        "openai",
        "openai-codex",
        "openai-compatible",
        "opencode",
        "opencode-go",
        "openrouter",
        "qianfan",
        "sglang",
        "synthetic",
        "together",
        "venice",
        "vercel-ai-gateway",
        "vllm",
        "volcengine",
        "volcengine-plan",
        "xai",
        "xiaomi",
        "zai",
    ];
    const NON_CHAT_PROVIDER_PLUGINS: &[&str] = &["fal"];

    #[test]
    fn covers_phase_three_provider_transport_families() {
        let ids = native_provider_ids();
        for required in RUST_NATIVE_CHAT_MODEL_PROVIDERS {
            assert!(
                ids.contains(required),
                "missing provider transport {required}"
            );
        }
    }

    #[test]
    fn native_provider_capability_matrix_covers_runtime_transport_features() {
        let transports = native_provider_transports();
        assert_eq!(transports.len(), native_provider_ids().len());

        for provider in RUST_NATIVE_CHAT_MODEL_PROVIDERS {
            let transport = transports
                .iter()
                .find(|transport| transport.id == *provider)
                .unwrap_or_else(|| panic!("missing provider transport {provider}"));
            assert!(
                transport.capabilities.streaming,
                "{provider} should advertise streaming"
            );
            assert!(
                transport.capabilities.tool_calling,
                "{provider} should advertise tool calling"
            );
            assert!(
                transport.capabilities.multimodal,
                "{provider} should advertise multimodal input"
            );
            assert!(
                transport.capabilities.secret_ref.env && transport.capabilities.secret_ref.file,
                "{provider} should advertise env/file SecretRef support"
            );
            assert!(
                !transport.capabilities.secret_ref.exec,
                "{provider} should not advertise exec SecretRef support"
            );
        }
    }

    #[test]
    fn registered_native_provider_transports_have_request_builders() {
        let missing = native_provider_transports()
            .into_iter()
            .map(|entry| entry.transport)
            .collect::<BTreeSet<_>>()
            .into_iter()
            .filter(|transport| !is_implemented_native_provider_transport(transport))
            .collect::<Vec<_>>();

        assert_eq!(missing, Vec::<&str>::new());
    }

    #[test]
    fn bundled_provider_auth_env_vars_cover_plugin_manifest_snapshot() {
        let actual = bundled_provider_auth_env_vars()
            .into_iter()
            .map(|entry| {
                (
                    entry.provider.to_string(),
                    entry
                        .env_vars
                        .iter()
                        .map(|value| (*value).to_string())
                        .collect::<Vec<_>>(),
                )
            })
            .collect::<BTreeMap<_, _>>();

        assert_eq!(actual, collect_manifest_provider_auth_env_vars());
        assert_eq!(
            actual.get("fal").map(Vec::as_slice),
            Some(&["FAL_KEY".to_string()][..])
        );
    }

    #[test]
    fn bundled_provider_plugins_cover_plugin_manifest_snapshot() {
        let actual = bundled_provider_plugins()
            .into_iter()
            .map(|entry| {
                (
                    entry.plugin_id.to_string(),
                    entry
                        .providers
                        .iter()
                        .map(|value| (*value).to_string())
                        .collect::<Vec<_>>(),
                )
            })
            .collect::<BTreeMap<_, _>>();

        assert_eq!(actual, collect_manifest_provider_plugins());
        assert_eq!(
            actual.get("fal").map(Vec::as_slice),
            Some(&["fal".to_string()][..])
        );
    }

    #[test]
    fn bundled_provider_plugin_metadata_exposes_auth_and_non_chat_capabilities() {
        let metadata = bundled_provider_plugin_metadata();
        assert_eq!(metadata.len(), bundled_provider_plugins().len());

        let openai = metadata
            .iter()
            .find(|entry| entry.plugin_id == "openai")
            .expect("openai metadata");
        assert!(openai.capabilities.chat);
        assert!(openai.capabilities.media_understanding);
        assert!(openai
            .auth_choices
            .as_array()
            .expect("auth choices")
            .iter()
            .any(|choice| choice["choiceId"] == "openai-api-key"));
        assert_eq!(openai.auth_env_vars["openai"], json!(["OPENAI_API_KEY"]));

        let fal = metadata
            .iter()
            .find(|entry| entry.plugin_id == "fal")
            .expect("fal metadata");
        assert!(!fal.capabilities.chat);
        assert!(fal.capabilities.non_chat);
        assert!(fal.capabilities.image_generation);
    }

    #[test]
    fn bundled_provider_plugin_contract_metadata_covers_manifest_contracts() {
        let metadata = bundled_provider_plugin_contract_metadata();
        assert_eq!(metadata.len(), bundled_provider_plugins().len());

        let google = metadata
            .iter()
            .find(|entry| entry.plugin_id == "google")
            .expect("google contract metadata");
        assert_eq!(google.provider_ids, vec!["google", "google-gemini-cli"]);
        assert_eq!(
            google.auto_enable_when_configured_providers,
            vec!["google-gemini-cli"]
        );

        let minimax = metadata
            .iter()
            .find(|entry| entry.plugin_id == "minimax")
            .expect("minimax contract metadata");
        assert_eq!(minimax.provider_ids, vec!["minimax", "minimax-portal"]);
        assert_eq!(minimax.legacy_plugin_ids, vec!["minimax-portal-auth"]);
        assert_eq!(
            minimax.auto_enable_when_configured_providers,
            vec!["minimax", "minimax-portal"]
        );

        let openai = metadata
            .iter()
            .find(|entry| entry.plugin_id == "openai")
            .expect("openai contract metadata");
        assert_eq!(openai.provider_ids, vec!["openai", "openai-codex"]);
    }

    #[test]
    fn bundled_provider_descriptors_are_rust_authoritative() {
        let descriptors = bundled_provider_descriptors();
        let descriptor_ids = descriptors
            .iter()
            .map(|entry| entry.provider.as_str())
            .collect::<BTreeSet<_>>();
        let expected_ids = bundled_provider_ids().into_iter().collect::<BTreeSet<_>>();

        assert_eq!(descriptor_ids, expected_ids);

        let openai = descriptors
            .iter()
            .find(|entry| entry.provider == "openai")
            .expect("openai descriptor");
        assert_eq!(openai.plugin_id, "openai");
        assert_eq!(openai.kind, "chat");
        assert_eq!(openai.transport.as_deref(), Some("openai-responses"));
        assert_eq!(openai.default_model.as_deref(), Some("gpt-5.4"));
        assert!(openai
            .auth_env_vars
            .iter()
            .any(|entry| entry == "OPENAI_API_KEY"));
        assert!(openai
            .auth_choices
            .as_array()
            .expect("auth choices")
            .iter()
            .any(|choice| choice["choiceId"] == "openai-api-key"));
        assert!(openai.transport_capabilities.is_some());

        let fal = descriptors
            .iter()
            .find(|entry| entry.provider == "fal")
            .expect("fal descriptor");
        assert_eq!(fal.kind, "image-generation");
        assert_eq!(fal.transport, None);
        assert_eq!(fal.default_model, None);
        assert!(fal.capabilities.non_chat);
        assert!(fal.capabilities.image_generation);
        assert!(fal.transport_capabilities.is_none());

        let missing_default_models = descriptors
            .iter()
            .filter(|entry| entry.capabilities.chat && entry.default_model.is_none())
            .map(|entry| entry.provider.as_str())
            .collect::<Vec<_>>();
        assert_eq!(missing_default_models, Vec::<&str>::new());
    }

    #[test]
    fn bundled_provider_product_surfaces_are_rust_authoritative() {
        let auth_choices = bundled_provider_auth_choices();
        assert!(auth_choices.iter().any(|choice| {
            choice.plugin_id == "openai"
                && choice.provider == "openai"
                && choice.method == "api-key"
                && choice.choice_id == "openai-api-key"
                && choice.choice_label == "OpenAI API key"
        }));
        assert!(auth_choices.iter().any(|choice| {
            choice.plugin_id == "minimax"
                && choice.provider == "minimax"
                && choice.method == "api-global"
                && choice.choice_id == "minimax-global-api"
        }));

        let setup_options = bundled_provider_setup_options();
        assert!(setup_options.iter().any(|choice| {
            choice.provider == "openai"
                && choice.value == "openai-api-key"
                && choice.label == "OpenAI API key"
        }));

        let model_pickers = bundled_provider_model_picker_entries();
        assert!(model_pickers.iter().any(|entry| {
            entry.provider == "ollama"
                && entry.method == "local"
                && entry.value == "provider-plugin:ollama:local"
        }));

        let usage_descriptors = bundled_provider_usage_descriptors();
        assert!(usage_descriptors.iter().any(|entry| {
            entry.provider == "openai-codex"
                && entry.auth_provider == "openai"
                && entry.extra_env_keys.contains(&"OPENAI_CODEX_TOKEN")
        }));

        let web_boundaries = bundled_web_provider_boundaries();
        assert!(web_boundaries.iter().any(|entry| {
            entry.surface == "web-search"
                && entry.provider == "searxng"
                && entry.product_boundary == "rust-native-plugin"
                && entry.execution_runtime == "python-sidecar"
                && entry.runtime_major.is_none()
                && entry.sidecar == Some("searxng")
        }));
        assert!(web_boundaries.iter().any(|entry| {
            entry.surface == "web-fetch"
                && entry.provider == "spider"
                && entry.product_boundary == "rust-native-plugin"
        }));
    }

    #[test]
    fn provider_extension_constants_are_rust_authoritative() {
        assert!(is_claude_cli_provider(" CLAUDE-CLI "));
        assert_eq!(
            to_claude_cli_model_ref("anthropic/claude-sonnet-4-6").as_deref(),
            Some(DEFAULT_CLAUDE_CLI_MODEL)
        );
        assert_eq!(to_claude_cli_model_ref("openai/gpt-5.4"), None);

        assert_eq!(
            normalize_anthropic_vertex_region(Some("us-east1")),
            "us-east1"
        );
        assert_eq!(
            normalize_anthropic_vertex_region(Some("us-central1.attacker.example")),
            ANTHROPIC_VERTEX_DEFAULT_REGION
        );
        assert_eq!(
            anthropic_vertex_region_from_base_url("https://europe-west4-aiplatform.googleapis.com")
                .as_deref(),
            Some("europe-west4")
        );
        assert_eq!(
            anthropic_vertex_region_from_base_url("https://aiplatform.googleapis.com").as_deref(),
            Some(ANTHROPIC_VERTEX_DEFAULT_REGION)
        );
        assert_eq!(
            anthropic_vertex_region_from_base_url("https://proxy.example.com/google/aiplatform"),
            None
        );
        assert_eq!(
            anthropic_vertex_config_api_key_marker(true),
            Some(ANTHROPIC_VERTEX_CREDENTIALS_MARKER)
        );

        assert_eq!(
            normalize_anthropic_model_id(" Opus-4.6 "),
            "claude-opus-4-6"
        );
        assert_eq!(
            normalize_anthropic_model_id("sonnet-4.5"),
            "claude-sonnet-4-5"
        );
        assert_eq!(
            normalize_anthropic_model_id("claude-sonnet-4-20250514"),
            "claude-sonnet-4-20250514"
        );
        assert_eq!(
            normalize_google_model_id("gemini-3-pro"),
            "gemini-3-pro-preview"
        );
        assert_eq!(
            normalize_google_model_id("gemini-3.1-flash-preview"),
            "gemini-3-flash-preview"
        );
        assert_eq!(
            normalize_antigravity_model_id("gemini-3-1-pro"),
            "gemini-3-1-pro-low"
        );
        assert_eq!(
            normalize_xai_model_id("grok-4.20-experimental-beta-0304-reasoning"),
            "grok-4.20-beta-latest-reasoning"
        );
        assert_eq!(
            normalize_xai_model_id("grok-4-fast-reasoning"),
            "grok-4-fast"
        );
        assert_eq!(normalize_xai_model_id("grok-4"), "grok-4");

        assert_eq!(normalize_duckduckgo_safe_search(Some("STRICT")), "strict");
        assert_eq!(
            normalize_duckduckgo_safe_search(Some("invalid")),
            "moderate"
        );
        assert_eq!(OLLAMA_DEFAULT_BASE_URL, "http://127.0.0.1:11434");
        assert_eq!(AGENT_DEFAULT_PROVIDER, "anthropic");
        assert_eq!(AGENT_DEFAULT_MODEL, "claude-opus-4-6");
        assert_eq!(AGENT_DEFAULT_CONTEXT_TOKENS, 200_000);
        assert!(PROVIDER_ID_ALIASES.contains(&("z.ai", "zai")));
        assert!(PROVIDER_ID_ALIASES.contains(&("aws-bedrock", "amazon-bedrock")));
        assert!(PROVIDER_ID_ALIASES.contains(&("doubao", "volcengine")));
        assert!(PROVIDER_AUTH_ID_ALIASES.contains(&("volcengine-plan", "volcengine")));
        assert!(PROVIDER_AUTH_ID_ALIASES.contains(&("byteplus-plan", "byteplus")));
        assert!(ANTHROPIC_ADAPTIVE_THINKING_MODEL_PATTERN.contains("opus|sonnet"));
        assert!(AMAZON_BEDROCK_ADAPTIVE_THINKING_MODEL_PATTERN.contains("opus|sonnet"));
        assert!(OPENAI_XHIGH_THINKING_MODEL_IDS.contains(&"gpt-5.4"));
        assert!(OPENAI_CODEX_XHIGH_THINKING_MODEL_IDS.contains(&"gpt-5.3-codex-spark"));
        assert!(GITHUB_COPILOT_XHIGH_THINKING_MODEL_IDS.contains(&"gpt-5.2-codex"));
        assert_eq!(PROVIDER_MODEL_DEFAULT_COST.input, 0);
        assert_eq!(PROVIDER_MODEL_DEFAULT_COST.cache_write, 0);
        assert_eq!(PROVIDER_MODEL_DEFAULT_INPUT_TYPES, &["text"]);
        assert_eq!(PROVIDER_MODEL_DEFAULT_MAX_TOKENS, 8_192);
        assert!(PROVIDER_DEFAULT_API_BY_PROVIDER.contains(&("anthropic", "anthropic-messages")));
        assert!(ANTHROPIC_CONTEXT_1M_MODEL_PREFIXES.contains(&"claude-opus-4"));
        assert!(ANTHROPIC_CONTEXT_1M_MODEL_PREFIXES.contains(&"claude-sonnet-4"));
        assert_eq!(ANTHROPIC_CONTEXT_1M_TOKENS, 1_048_576);
        assert_eq!(DEFAULT_PROVIDER_CAPABILITIES.provider_family, "default");
        assert!(DEFAULT_PROVIDER_CAPABILITIES.open_ai_compat_turn_validation);
        assert!(PROVIDER_CAPABILITY_FALLBACKS
            .iter()
            .any(|entry| entry.provider == "kimi"
                && entry.anthropic_tool_schema_mode == Some("openai-functions")));
        assert!(PROVIDER_CAPABILITY_FALLBACKS
            .iter()
            .any(|entry| entry.provider == "mistral"
                && entry
                    .transcript_tool_call_id_model_hints
                    .contains(&"codestral")));
        assert!(CORE_PROVIDER_AUTH_ENV_VAR_CANDIDATES
            .iter()
            .any(|entry| entry.provider == "voyage" && entry.env_vars == ["VOYAGE_API_KEY"]));
        assert!(CORE_PROVIDER_SETUP_ENV_VAR_OVERRIDES.iter().any(|entry| {
            entry.provider == "anthropic" && entry.env_vars.contains(&"ANTHROPIC_OAUTH_TOKEN")
        }));
        assert_eq!(EXTRA_PROVIDER_AUTH_ENV_VARS, &["MINIMAX_CODE_PLAN_KEY"]);
        assert!(PROVIDER_USAGE_LABELS.contains(&("openai-codex", "Codex")));
        assert!(PROVIDER_USAGE_LABELS.contains(&("zai", "z.ai")));
        assert_eq!(PROVIDER_ATTRIBUTION_PRODUCT, "CrawClaw");
        assert_eq!(PROVIDER_ATTRIBUTION_ORIGINATOR, "crawclaw");
        assert_eq!(
            LOCAL_ENDPOINT_HOSTS,
            &["localhost", "127.0.0.1", "::1", "[::1]"]
        );
        assert!(MOONSHOT_NATIVE_BASE_URLS.contains(&"https://api.moonshot.ai/v1"));
        assert!(MODELSTUDIO_NATIVE_BASE_URLS
            .contains(&"https://dashscope.aliyuncs.com/compatible-mode/v1"));
        assert_eq!(
            OPENAI_RESPONSES_APIS,
            &["openai-responses", "azure-openai-responses"]
        );
        assert_eq!(
            OPENAI_RESPONSES_PROVIDERS,
            &["openai", "azure-openai", "azure-openai-responses"]
        );
        assert_eq!(MOONSHOT_COMPAT_PROVIDERS, &["moonshot", "kimi"]);
        assert_eq!(
            TRANSCRIPT_OPENAI_MODEL_APIS,
            &[
                "openai",
                "openai-completions",
                "openai-responses",
                "openai-codex-responses"
            ]
        );
        assert_eq!(
            TRANSCRIPT_ANTHROPIC_MODEL_APIS,
            &["anthropic-messages", "bedrock-converse-stream"]
        );
        assert_eq!(OPENAI_COMPATIBLE_TURN_VALIDATION_API, "openai-completions");
        assert_eq!(
            OPENAI_COMPATIBLE_TOOL_ID_SANITIZATION_APIS,
            &[
                "openai-completions",
                "openai-responses",
                "openai-codex-responses",
                "azure-openai-responses"
            ]
        );
        assert!(KNOWN_PROVIDER_FAMILIES.contains(&("openai-codex", "openai-family")));
        assert!(KNOWN_PROVIDER_FAMILIES.contains(&("kimi", "moonshot")));
        assert!(KNOWN_PROVIDER_FAMILIES.contains(&("dashscope", "modelstudio")));
        assert!(MISTRAL_SAFE_MAX_TOKENS_BY_MODEL.contains(&("magistral-small", 40_000)));
        assert!(MISTRAL_SAFE_MAX_TOKENS_BY_MODEL.contains(&("mistral-medium-2508", 8_192)));
        assert_eq!(OLLAMA_DEFAULT_CONTEXT_WINDOW, 128_000);
        assert_eq!(OLLAMA_DEFAULT_MAX_TOKENS, 8_192);
        assert_eq!(OLLAMA_DEFAULT_MODEL, "glm-4.7-flash");
        assert_eq!(OLLAMA_DEFAULT_EMBEDDING_MODEL, "nomic-embed-text");
        assert_eq!(OPENAI_DEFAULT_MODEL_REF, "openai/gpt-5.4");
        assert_eq!(OPENAI_CODEX_DEFAULT_MODEL_REF, "openai-codex/gpt-5.4");
        assert_eq!(OPENAI_DEFAULT_IMAGE_MODEL, "gpt-image-1");
        assert_eq!(
            OPENAI_DEFAULT_AUDIO_TRANSCRIPTION_MODEL,
            "gpt-4o-mini-transcribe"
        );
        assert_eq!(OPENAI_DEFAULT_EMBEDDING_MODEL, "text-embedding-3-small");
        assert_eq!(
            GOOGLE_GEMINI_DEFAULT_MODEL_REF,
            "google/gemini-3.1-pro-preview"
        );
        assert_eq!(OPENCODE_GO_DEFAULT_MODEL_REF, "opencode-go/kimi-k2.5");
        assert_eq!(OPENCODE_ZEN_DEFAULT_MODEL_REF, "opencode/claude-opus-4-6");
        assert_eq!(
            LEGACY_OPENCODE_ZEN_DEFAULT_MODEL_REFS,
            &["opencode/claude-opus-4-5", "opencode-zen/claude-opus-4-5"]
        );
    }

    #[test]
    fn native_chat_transports_cover_all_chat_provider_plugins() {
        let native = native_provider_ids().into_iter().collect::<BTreeSet<_>>();
        let missing = bundled_provider_ids()
            .into_iter()
            .filter(|provider| {
                !NON_CHAT_PROVIDER_PLUGINS.contains(provider) && !native.contains(provider)
            })
            .collect::<Vec<_>>();

        assert_eq!(missing, Vec::<&str>::new());
        assert!(!native.contains("fal"));
    }

    #[test]
    fn rust_provider_config_schema_owns_model_provider_fields() {
        let schema = provider_config_schema();
        assert_eq!(schema["version"], "rust-provider-config-v1");
        assert_eq!(schema["schema"]["type"], "object");
        assert_eq!(
            schema["schema"]["properties"]["models"]["properties"]["providers"]
                ["additionalProperties"]["properties"]["baseUrl"]["type"],
            "string"
        );
        assert_eq!(
            schema["schema"]["properties"]["models"]["properties"]["providers"]
                ["additionalProperties"]["properties"]["apiKey"]["oneOf"][0]["type"],
            "string"
        );
        assert_eq!(
            schema["schema"]["properties"]["models"]["properties"]["providers"]
                ["additionalProperties"]["properties"]["models"]["items"]["required"],
            json!([
                "id",
                "name",
                "reasoning",
                "input",
                "cost",
                "contextWindow",
                "maxTokens"
            ])
        );
        assert_eq!(
            schema["uiHints"]["models.providers.*.apiKey"]["sensitive"],
            true
        );
        assert!(schema["uiHints"].get("plugins.entries.*.hooks").is_none());
    }

    #[test]
    fn rust_provider_config_schema_lookup_lists_provider_children() {
        let lookup = provider_config_schema_lookup("models.providers.*");
        let paths = lookup["children"]
            .as_array()
            .expect("children")
            .iter()
            .filter_map(|child| child.get("path").and_then(Value::as_str))
            .collect::<BTreeSet<_>>();
        assert!(paths.contains("models.providers.*.baseUrl"));
        assert!(paths.contains("models.providers.*.apiKey"));
        assert!(paths.contains("models.providers.*.api"));
        assert!(paths.contains("models.providers.*.models"));

        let root = provider_config_schema_lookup("");
        assert!(root["children"]
            .as_array()
            .expect("root children")
            .iter()
            .any(|child| child["path"] == "models"));
    }

    #[test]
    fn openai_compatible_endpoint_honors_explicit_v1_base_url() {
        assert_eq!(
            openai_compatible_chat_completions_url("http://127.0.0.1:11434/v1"),
            "http://127.0.0.1:11434/v1/chat/completions"
        );
    }

    #[test]
    fn builds_streaming_tool_and_multimodal_requests_for_native_transports() {
        let tool = NativeProviderTool {
            name: "lookup_weather".to_string(),
            description: Some("Look up weather".to_string()),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "city": { "type": "string" }
                },
                "required": ["city"]
            }),
        };
        let messages = vec![NativeProviderMessage::user_blocks(vec![
            NativeProviderContentBlock::text("describe this image"),
            NativeProviderContentBlock::image_base64("image/png", "iVBORw0KGgo="),
        ])];

        for provider in RUST_NATIVE_CHAT_MODEL_PROVIDERS {
            let request = build_native_provider_conversation_request_with_options(
                &NativeProviderConfig {
                    provider: (*provider).to_string(),
                    base_url: Some(format!("https://example.test/{provider}")),
                    api_key: Some("secret".to_string()),
                    model: Some("model-a".to_string()),
                    api: None,
                    api_version: Some("2025-04-01-preview".to_string()),
                },
                &messages,
                &NativeProviderRequestOptions {
                    stream: true,
                    tools: vec![tool.clone()],
                    reasoning_level: None,
                },
            )
            .unwrap_or_else(|error| panic!("{provider} request should build: {error}"));
            let body = serde_json::to_string(&request.body).expect("request body json");

            assert!(
                body.contains("lookup_weather"),
                "{provider} should include tool declarations"
            );
            assert!(
                body.contains("describe this image") && body.contains("iVBORw0KGgo="),
                "{provider} should include text and image content"
            );
            assert!(
                body.contains("stream") || request.url.contains("stream"),
                "{provider} should opt into streaming at the transport layer"
            );
        }
    }

    #[test]
    fn builds_native_http_requests_for_all_phase_three_provider_families() {
        for provider in RUST_NATIVE_CHAT_MODEL_PROVIDERS {
            let request = build_native_provider_request(
                &NativeProviderConfig {
                    provider: (*provider).to_string(),
                    base_url: Some(format!("https://example.test/{provider}")),
                    api_key: Some("secret".to_string()),
                    model: Some("model-a".to_string()),
                    api: None,
                    api_version: Some("2025-04-01-preview".to_string()),
                },
                "hello",
            )
            .unwrap_or_else(|error| panic!("{provider} should build a native request: {error}"));

            assert!(
                request.url.starts_with("https://example.test/"),
                "{provider} should use a native HTTP endpoint"
            );
            assert!(
                serde_json::to_string(&request.body)
                    .expect("request body json")
                    .contains("hello"),
                "{provider} should include the user message"
            );
        }
    }

    #[test]
    fn applies_native_openai_compatible_provider_policies() {
        let base_config = |provider: &str, model: &str| NativeProviderConfig {
            provider: provider.to_string(),
            base_url: Some(format!("https://example.test/{provider}")),
            api_key: Some("secret".to_string()),
            model: Some(model.to_string()),
            api: None,
            api_version: None,
        };

        let zai = build_native_provider_conversation_request_with_options(
            &base_config("zai", "glm-5"),
            &[NativeProviderMessage::user("hello")],
            &NativeProviderRequestOptions::default(),
        )
        .expect("zai request");
        assert_eq!(zai.body["tool_stream"], Value::Bool(true));

        let kilocode = build_native_provider_conversation_request_with_options(
            &base_config("kilocode", "anthropic/claude-sonnet-4"),
            &[NativeProviderMessage::user("hello")],
            &NativeProviderRequestOptions {
                reasoning_level: Some("high".to_string()),
                ..NativeProviderRequestOptions::default()
            },
        )
        .expect("kilocode request");
        assert!(kilocode
            .headers
            .iter()
            .any(|(name, value)| name == "X-KILOCODE-FEATURE" && value == "crawclaw"));
        assert_eq!(kilocode.body["reasoning"], json!({ "effort": "high" }));

        let openrouter = build_native_provider_conversation_request_with_options(
            &base_config("openrouter", "anthropic/claude-opus-4-6"),
            &[NativeProviderMessage::user("hello")],
            &NativeProviderRequestOptions {
                reasoning_level: Some("low".to_string()),
                ..NativeProviderRequestOptions::default()
            },
        )
        .expect("openrouter request");
        assert!(openrouter
            .headers
            .iter()
            .any(|(name, value)| name == "X-OpenRouter-Title" && value == "CrawClaw"));
        assert_eq!(openrouter.body["reasoning"], json!({ "effort": "low" }));
    }

    #[test]
    fn applies_native_xai_responses_policy() {
        let request = build_native_provider_conversation_request_with_options(
            &NativeProviderConfig {
                provider: "xai".to_string(),
                base_url: Some("https://api.x.ai/v1".to_string()),
                api_key: Some("secret".to_string()),
                model: Some("grok-4.20-beta-latest-reasoning".to_string()),
                api: None,
                api_version: None,
            },
            &[NativeProviderMessage::user("hello")],
            &NativeProviderRequestOptions::default(),
        )
        .expect("xai request");

        assert_eq!(request.body["tool_stream"], Value::Bool(true));
        assert!(request.body.get("reasoning").is_none());
        assert!(request.body.get("reasoning_effort").is_none());
    }

    #[test]
    fn builds_native_conversation_requests_with_assistant_history() {
        let request = build_native_provider_conversation_request(
            &NativeProviderConfig {
                provider: "openai-compatible".to_string(),
                base_url: Some("https://example.test/openai-compatible".to_string()),
                api_key: Some("secret".to_string()),
                model: Some("model-a".to_string()),
                api: None,
                api_version: None,
            },
            &[
                NativeProviderMessage::user("previous user"),
                NativeProviderMessage::assistant("previous assistant"),
                NativeProviderMessage::user("next user"),
            ],
        )
        .expect("conversation request");

        assert_eq!(
            request.body["messages"],
            json!([
                { "role": "user", "content": "previous user" },
                { "role": "assistant", "content": "previous assistant" },
                { "role": "user", "content": "next user" }
            ])
        );
    }

    #[test]
    fn parses_native_provider_response_shapes() {
        for (format, raw, expected) in [
            (
                NativeProviderResponseFormat::OpenAiResponses,
                r#"{"output_text":"openai reply"}"#,
                "openai reply",
            ),
            (
                NativeProviderResponseFormat::ChatCompletions,
                r#"{"choices":[{"message":{"content":"chat reply"}}]}"#,
                "chat reply",
            ),
            (
                NativeProviderResponseFormat::AnthropicMessages,
                r#"{"content":[{"type":"text","text":"anthropic reply"}]}"#,
                "anthropic reply",
            ),
            (
                NativeProviderResponseFormat::GoogleGenerateContent,
                r#"{"candidates":[{"content":{"parts":[{"text":"google reply"}]}}]}"#,
                "google reply",
            ),
            (
                NativeProviderResponseFormat::OllamaChat,
                r#"{"message":{"content":"ollama reply"}}"#,
                "ollama reply",
            ),
            (
                NativeProviderResponseFormat::BedrockConverse,
                r#"{"output":{"message":{"content":[{"text":"bedrock reply"}]}}}"#,
                "bedrock reply",
            ),
        ] {
            let body: serde_json::Value = serde_json::from_str(raw).expect("response json");
            assert_eq!(
                parse_native_provider_response(format, body).expect("assistant text"),
                expected
            );
        }
    }

    #[tokio::test]
    async fn sends_openai_compatible_request_to_mocked_provider() {
        let (base_url, request_rx) =
            serve_once(r#"{"choices":[{"message":{"content":"mocked provider reply"}}]}"#);

        let reply = send_native_provider_message(
            &NativeProviderConfig {
                provider: "openai-compatible".to_string(),
                base_url: Some(base_url),
                api_key: Some("test-key".to_string()),
                model: Some("model-a".to_string()),
                api: None,
                api_version: None,
            },
            "hello provider",
        )
        .await
        .expect("provider reply");

        assert_eq!(reply, "mocked provider reply");
        let request = request_rx.recv().expect("captured request");
        assert!(request.starts_with("POST /v1/chat/completions HTTP/1.1"));
        assert!(request.contains("authorization: Bearer test-key"));
        assert!(request.contains(r#""model":"model-a""#));
        assert!(request.contains("hello provider"));
    }

    #[tokio::test]
    async fn streams_openai_compatible_tool_multimodal_request_to_mocked_provider() {
        let (base_url, request_rx) = serve_once(
            "data: {\"choices\":[{\"delta\":{\"content\":\"streamed \"}}]}\n\n\
             data: {\"choices\":[{\"delta\":{\"content\":\"reply\"}}]}\n\n\
             data: [DONE]\n\n",
        );
        let tool = NativeProviderTool {
            name: "lookup_weather".to_string(),
            description: Some("Look up weather".to_string()),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "city": { "type": "string" }
                },
                "required": ["city"]
            }),
        };

        let reply = send_native_provider_conversation_with_options(
            &NativeProviderConfig {
                provider: "openai-compatible".to_string(),
                base_url: Some(base_url),
                api_key: Some("test-key".to_string()),
                model: Some("model-a".to_string()),
                api: None,
                api_version: None,
            },
            &[NativeProviderMessage::user_blocks(vec![
                NativeProviderContentBlock::text("describe this image"),
                NativeProviderContentBlock::image_base64("image/png", "iVBORw0KGgo="),
            ])],
            &NativeProviderRequestOptions {
                stream: true,
                tools: vec![tool],
                reasoning_level: None,
            },
        )
        .await
        .expect("streamed provider reply");

        assert_eq!(reply, "streamed reply");
        let request = request_rx.recv().expect("captured request");
        assert!(request.starts_with("POST /v1/chat/completions HTTP/1.1"));
        assert!(request.contains("authorization: Bearer test-key"));
        assert!(request.contains(r#""model":"model-a""#));
        assert!(request.contains(r#""stream":true"#));
        assert!(request.contains("lookup_weather"));
        assert!(request.contains("describe this image"));
        assert!(request.contains("data:image/png;base64,iVBORw0KGgo="));
    }

    #[test]
    fn parses_native_provider_stream_delta_shapes() {
        for (format, raw, expected) in [
            (
                NativeProviderResponseFormat::OpenAiResponses,
                r#"data: {"type":"response.output_text.delta","delta":"openai"}"#,
                Some("openai"),
            ),
            (
                NativeProviderResponseFormat::ChatCompletions,
                r#"data: {"choices":[{"delta":{"content":"chat"}}]}"#,
                Some("chat"),
            ),
            (
                NativeProviderResponseFormat::AnthropicMessages,
                r#"data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"anthropic"}}"#,
                Some("anthropic"),
            ),
            (
                NativeProviderResponseFormat::GoogleGenerateContent,
                r#"{"candidates":[{"content":{"parts":[{"text":"google"}]}}]}"#,
                Some("google"),
            ),
            (
                NativeProviderResponseFormat::OllamaChat,
                r#"{"message":{"content":"ollama"},"done":false}"#,
                Some("ollama"),
            ),
            (
                NativeProviderResponseFormat::BedrockConverse,
                r#"{"contentBlockDelta":{"delta":{"text":"bedrock"}}}"#,
                Some("bedrock"),
            ),
            (
                NativeProviderResponseFormat::ChatCompletions,
                "data: [DONE]",
                None,
            ),
        ] {
            assert_eq!(
                parse_native_provider_stream_delta(format, raw).expect("stream delta"),
                expected.map(ToOwned::to_owned)
            );
        }
    }

    fn collect_manifest_provider_auth_env_vars() -> BTreeMap<String, Vec<String>> {
        let repo_root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..");
        let extensions_dir = repo_root.join("extensions");
        let mut entries = BTreeMap::new();

        for item in fs::read_dir(extensions_dir).expect("extensions dir") {
            let manifest_path = item
                .expect("extension dir")
                .path()
                .join("crawclaw.plugin.json");
            if !manifest_path.is_file() {
                continue;
            }
            let manifest = fs::read_to_string(&manifest_path).expect("manifest");
            let manifest: Value = serde_json::from_str(&manifest).expect("manifest json");
            let Some(auth_env_vars) = manifest
                .get("providerAuthEnvVars")
                .and_then(Value::as_object)
            else {
                continue;
            };

            for (provider, env_vars) in auth_env_vars {
                let Some(env_vars) = env_vars.as_array() else {
                    continue;
                };
                let env_vars = env_vars
                    .iter()
                    .filter_map(Value::as_str)
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                    .map(str::to_string)
                    .collect::<Vec<_>>();
                if !provider.trim().is_empty() && !env_vars.is_empty() {
                    entries.insert(provider.trim().to_string(), env_vars);
                }
            }
        }

        entries
    }

    fn collect_manifest_provider_plugins() -> BTreeMap<String, Vec<String>> {
        let repo_root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..");
        let extensions_dir = repo_root.join("extensions");
        let mut entries = BTreeMap::new();

        for item in fs::read_dir(extensions_dir).expect("extensions dir") {
            let manifest_path = item
                .expect("extension dir")
                .path()
                .join("crawclaw.plugin.json");
            if !manifest_path.is_file() {
                continue;
            }
            let manifest = fs::read_to_string(&manifest_path).expect("manifest");
            let manifest: Value = serde_json::from_str(&manifest).expect("manifest json");
            let Some(providers) = manifest.get("providers").and_then(Value::as_array) else {
                continue;
            };
            let providers = providers
                .iter()
                .filter_map(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_string)
                .collect::<Vec<_>>();
            let Some(plugin_id) = manifest.get("id").and_then(Value::as_str).map(str::trim) else {
                continue;
            };
            if !plugin_id.is_empty() && !providers.is_empty() {
                entries.insert(plugin_id.to_string(), providers);
            }
        }

        entries
    }

    fn serve_once(response_body: &'static str) -> (String, mpsc::Receiver<String>) {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind mock provider");
        let addr = listener.local_addr().expect("mock provider addr");
        let (request_tx, request_rx) = mpsc::channel();
        thread::spawn(move || {
            let (mut stream, _) = listener.accept().expect("accept provider request");
            let mut buffer = [0; 8192];
            let count = stream.read(&mut buffer).expect("read provider request");
            request_tx
                .send(String::from_utf8_lossy(&buffer[..count]).to_string())
                .expect("send captured request");
            let response = format!(
                "HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{}",
                response_body.len(),
                response_body
            );
            stream
                .write_all(response.as_bytes())
                .expect("write provider response");
        });
        (format!("http://{addr}"), request_rx)
    }
}
