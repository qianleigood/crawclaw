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
    pub cli_backend: bool,
    pub media_understanding: bool,
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
        provider: "brave",
        env_vars: &["BRAVE_API_KEY"],
    },
    ProviderAuthEnvVars {
        provider: "byteplus",
        env_vars: &["BYTEPLUS_API_KEY"],
    },
    ProviderAuthEnvVars {
        provider: "chutes",
        env_vars: &["CHUTES_API_KEY", "CHUTES_OAUTH_TOKEN"],
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
        provider: "exa",
        env_vars: &["EXA_API_KEY"],
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
        provider: "perplexity",
        env_vars: &["PERPLEXITY_API_KEY", "OPENROUTER_API_KEY"],
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
    let contracts = manifest
        .get("contracts")
        .cloned()
        .unwrap_or_else(|| json!({}));
    let media_understanding = contracts
        .get("mediaUnderstandingProviders")
        .and_then(Value::as_array)
        .map(|values| !values.is_empty())
        .unwrap_or(false);
    let cli_backend = manifest
        .get("cliBackends")
        .and_then(Value::as_array)
        .map(|values| !values.is_empty())
        .unwrap_or(false);
    let image_generation = plugin_id == "fal";
    BundledProviderPluginMetadata {
        plugin_id: plugin_id.to_string(),
        providers,
        auth_env_vars,
        auth_choices,
        capabilities: BundledProviderPluginCapabilities {
            chat,
            non_chat: !chat,
            image_generation,
            cli_backend,
            media_understanding,
        },
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
    match resolve_provider_transport(config)? {
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
        transport => Err(ProviderTransportError::Unsupported(format!(
            "Rust provider transport is not implemented: {transport}"
        ))),
    }
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
    Ok(NativeProviderRequest {
        url,
        headers: vec![auth_pair(
            auth_header,
            auth_prefix,
            required(&config.api_key, "apiKey")?,
        )],
        body,
        response_format: NativeProviderResponseFormat::ChatCompletions,
    })
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
        assert!(openai.capabilities.cli_backend);
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
