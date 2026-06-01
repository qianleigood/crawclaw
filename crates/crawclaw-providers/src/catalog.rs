use super::*;

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

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct BundledProviderPluginContractOverride {
    pub(crate) plugin_id: &'static str,
    pub(crate) legacy_plugin_ids: &'static [&'static str],
    pub(crate) auto_enable_when_configured_providers: &'static [&'static str],
}

pub(crate) const BUNDLED_PROVIDER_PLUGIN_CONTRACT_OVERRIDES:
    &[BundledProviderPluginContractOverride] = &[
    BundledProviderPluginContractOverride {
        plugin_id: "copilot-proxy",
        legacy_plugin_ids: &[],
        auto_enable_when_configured_providers: &["copilot-proxy"],
    },
    BundledProviderPluginContractOverride {
        plugin_id: "google",
        legacy_plugin_ids: &[],
        auto_enable_when_configured_providers: &["google-gemini-cli"],
    },
    BundledProviderPluginContractOverride {
        plugin_id: "minimax",
        legacy_plugin_ids: &["minimax-portal-auth"],
        auto_enable_when_configured_providers: &["minimax", "minimax-portal"],
    },
];

pub(crate) const BUNDLED_PROVIDER_PLUGIN_MANIFESTS: &[(&str, &str)] = &[
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
pub const MINIMAX_OAUTH_MARKER: &str = "minimax-oauth";
pub const OAUTH_API_KEY_MARKER_PREFIX: &str = "oauth:";
pub const OLLAMA_LOCAL_AUTH_MARKER: &str = "ollama-local";
pub const CUSTOM_LOCAL_AUTH_MARKER: &str = "custom-local";
pub const GCP_VERTEX_CREDENTIALS_MARKER: &str = "gcp-vertex-credentials";
pub const NON_ENV_SECRETREF_MARKER: &str = "secretref-managed";
pub const SECRETREF_ENV_HEADER_MARKER_PREFIX: &str = "secretref-env:";
pub const AWS_BEDROCK_BEARER_TOKEN_ENV: &str = "AWS_BEARER_TOKEN_BEDROCK";
pub const AWS_ACCESS_KEY_ID_ENV: &str = "AWS_ACCESS_KEY_ID";
pub const AWS_SECRET_ACCESS_KEY_ENV: &str = "AWS_SECRET_ACCESS_KEY";
pub const AWS_PROFILE_ENV: &str = "AWS_PROFILE";
pub const AWS_SDK_ENV_MARKERS: &[&str] = &[
    AWS_BEDROCK_BEARER_TOKEN_ENV,
    AWS_ACCESS_KEY_ID_ENV,
    AWS_PROFILE_ENV,
];
pub const LEGACY_ENV_API_KEY_MARKERS: &[&str] = &[
    "GOOGLE_API_KEY",
    "DEEPSEEK_API_KEY",
    "FIREWORKS_API_KEY",
    "NOVITA_API_KEY",
    "AZURE_OPENAI_API_KEY",
    "AZURE_API_KEY",
    "MINIMAX_CODE_PLAN_KEY",
];
pub const ANTHROPIC_PROVIDER_ID: &str = "anthropic";
pub const ANTHROPIC_VERTEX_PROVIDER_ID: &str = "anthropic-vertex";
pub const AMAZON_BEDROCK_PROVIDER_ID: &str = "amazon-bedrock";
pub const GITHUB_COPILOT_PROVIDER_ID: &str = "github-copilot";
pub const GOOGLE_PROVIDER_ID: &str = "google";
pub const GOOGLE_VERTEX_PROVIDER_ID: &str = "google-vertex";
pub const GROQ_PROVIDER_ID: &str = "groq";
pub const KILOCODE_PROVIDER_ID: &str = "kilocode";
pub const MINIMAX_PROVIDER_ID: &str = "minimax";
pub const MINIMAX_PORTAL_PROVIDER_ID: &str = "minimax-portal";
pub const MISTRAL_PROVIDER_ID: &str = "mistral";
pub const MODELSTUDIO_PROVIDER_ID: &str = "modelstudio";
pub const MOONSHOT_PROVIDER_ID: &str = "moonshot";
pub const OLLAMA_PROVIDER_ID: &str = "ollama";
pub const OPENAI_PROVIDER_ID: &str = "openai";
pub const OPENAI_CODEX_PROVIDER_ID: &str = "openai-codex";
pub const OPENROUTER_PROVIDER_ID: &str = "openrouter";
pub const TOGETHER_PROVIDER_ID: &str = "together";
pub const VERCEL_AI_GATEWAY_PROVIDER_ID: &str = "vercel-ai-gateway";
pub const XAI_PROVIDER_ID: &str = "xai";
pub const ZAI_PROVIDER_ID: &str = "zai";
pub const ANTHROPIC_API_KEY_ENV: &str = "ANTHROPIC_API_KEY";
pub const ANTHROPIC_OAUTH_TOKEN_ENV: &str = "ANTHROPIC_OAUTH_TOKEN";
pub const ANTHROPIC_VERTEX_USE_GCP_METADATA_ENV: &str = "ANTHROPIC_VERTEX_USE_GCP_METADATA";
pub const GOOGLE_APPLICATION_CREDENTIALS_ENV: &str = "GOOGLE_APPLICATION_CREDENTIALS";
pub const OAUTH_PROVIDER_AUTH_ENV_VARS: &[&str] =
    &[ANTHROPIC_OAUTH_TOKEN_ENV, "MINIMAX_OAUTH_TOKEN"];
pub const AUTH_COOLDOWN_BYPASS_PROVIDER_IDS: &[&str] =
    &[OPENROUTER_PROVIDER_ID, KILOCODE_PROVIDER_ID];
pub const AUTH_WHAM_COOLDOWN_PROBE_PROVIDER_ID: &str = OPENAI_CODEX_PROVIDER_ID;

pub const PROVIDER_USAGE_LABELS: &[(&str, &str)] = &[
    ("anthropic", "Claude"),
    ("github-copilot", "Copilot"),
    ("google-gemini-cli", "Gemini"),
    ("minimax", "MiniMax"),
    ("openai-codex", "Codex"),
    ("xiaomi", "Xiaomi"),
    ("zai", "z.ai"),
];

pub const MODEL_APIS: &[&str] = &[
    "openai-completions",
    "openai-responses",
    "openai-codex-responses",
    "anthropic-messages",
    "google-generative-ai",
    "github-copilot",
    "bedrock-converse-stream",
    "ollama",
    "azure-openai-responses",
];
pub const PROVIDER_ATTRIBUTION_PRODUCT: &str = "CrawClaw";
pub const PROVIDER_ATTRIBUTION_ORIGINATOR: &str = "crawclaw";
pub const PROVIDER_ATTRIBUTION_REFERER_URL: &str = "https://docs.crawclaw.ai";
pub const OPENROUTER_ATTRIBUTION_DOCS_URL: &str = "https://openrouter.ai/docs/app-attribution";
pub const OPENROUTER_ATTRIBUTION_CATEGORY: &str = "cli-agent";
pub const OPENAI_COMPLETIONS_API: &str = "openai-completions";
pub const OPENAI_RESPONSES_API: &str = "openai-responses";
pub const OPENAI_CODEX_RESPONSES_API: &str = "openai-codex-responses";
pub const OPENAI_AUDIO_TRANSCRIPTIONS_API: &str = "openai-audio-transcriptions";
pub const ANTHROPIC_MESSAGES_API: &str = "anthropic-messages";
pub const MODEL_COMPAT_THINKING_FORMATS: &[&str] =
    &["openai", "openrouter", "zai", "qwen", "qwen-chat-template"];
pub const MODEL_COMPAT_MAX_TOKENS_FIELDS: &[&str] = &["max_completion_tokens", "max_tokens"];
pub const MINIMAX_VLM_MODEL_ID: &str = "MiniMax-VL-01";
pub const MINIMAX_API_HOST_ENV: &str = "MINIMAX_API_HOST";
pub const MINIMAX_DEFAULT_API_HOST: &str = "https://api.minimax.io";
pub const MINIMAX_VLM_API_PATH: &str = "/v1/coding_plan/vlm";
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
pub const GOOGLE_MODEL_APIS: &[&str] = &["google-gemini-cli", "google-generative-ai"];
pub const OPENAI_COMPATIBLE_TURN_VALIDATION_API: &str = "openai-completions";
pub const OPENAI_COMPATIBLE_TOOL_ID_SANITIZATION_APIS: &[&str] = &[
    "openai-completions",
    "openai-responses",
    "openai-codex-responses",
    "azure-openai-responses",
];
pub const OPENROUTER_MODELS_API_URL: &str = "https://openrouter.ai/api/v1/models";
pub const OPENROUTER_DEFAULT_MODEL_REF: &str = "openrouter/auto";
pub const MODEL_CATALOG_CONFIGURED_PROVIDER_IDS: &[&str] = &["deepseek", "kilocode", "ollama"];
pub const OPENROUTER_PRICING_PROVIDER_ALIASES: &[(&str, &str)] = &[
    ("google-gemini-cli", "google"),
    ("kimi", "moonshotai"),
    ("kimi-coding", "moonshotai"),
    ("moonshot", "moonshotai"),
    ("moonshotai", "moonshotai"),
    ("openai-codex", "openai"),
    ("xai", "x-ai"),
    ("zai", "z-ai"),
];
pub const OPENROUTER_WRAPPER_PROVIDERS: &[&str] = &[
    "cloudflare-ai-gateway",
    "kilocode",
    "openrouter",
    "vercel-ai-gateway",
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

pub const OPENAI_COMPLETIONS_THIN_PROVIDER_PRESETS: &[ProviderTransportPreset] = &[
    ProviderTransportPreset {
        provider: "byteplus",
    },
    ProviderTransportPreset {
        provider: "byteplus-plan",
    },
    ProviderTransportPreset { provider: "chutes" },
    ProviderTransportPreset {
        provider: "copilot-proxy",
    },
    ProviderTransportPreset {
        provider: "deepseek",
    },
    ProviderTransportPreset {
        provider: "huggingface",
    },
    ProviderTransportPreset {
        provider: "litellm",
    },
    ProviderTransportPreset {
        provider: "mistral",
    },
    ProviderTransportPreset {
        provider: "modelstudio",
    },
    ProviderTransportPreset {
        provider: "moonshot",
    },
    ProviderTransportPreset { provider: "nvidia" },
    ProviderTransportPreset {
        provider: "opencode",
    },
    ProviderTransportPreset {
        provider: "opencode-go",
    },
    ProviderTransportPreset {
        provider: "qianfan",
    },
    ProviderTransportPreset { provider: "sglang" },
    ProviderTransportPreset {
        provider: "together",
    },
    ProviderTransportPreset { provider: "venice" },
    ProviderTransportPreset { provider: "vllm" },
    ProviderTransportPreset {
        provider: "volcengine",
    },
    ProviderTransportPreset {
        provider: "volcengine-plan",
    },
];

pub const EXPLICIT_NATIVE_PROVIDER_TRANSPORTS: &[ProviderTransport] = &[
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
        id: "cloudflare-ai-gateway",
        transport: "anthropic-messages",
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
        id: "openrouter",
        transport: "openai-completions",
        capabilities: RUST_PROVIDER_CAPABILITIES,
    },
    ProviderTransport {
        id: "synthetic",
        transport: "anthropic-messages",
        capabilities: RUST_PROVIDER_CAPABILITIES,
    },
    ProviderTransport {
        id: "vercel-ai-gateway",
        transport: "anthropic-messages",
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

pub fn native_provider_transport_catalog() -> Vec<ProviderTransport> {
    let mut transports = EXPLICIT_NATIVE_PROVIDER_TRANSPORTS.to_vec();
    transports.extend(
        OPENAI_COMPLETIONS_THIN_PROVIDER_PRESETS
            .iter()
            .map(openai_completions_preset_transport),
    );
    transports.sort_by(|left, right| left.id.cmp(right.id));
    transports
}

pub fn native_provider_transport_for_id(provider: &str) -> Option<ProviderTransport> {
    EXPLICIT_NATIVE_PROVIDER_TRANSPORTS
        .iter()
        .copied()
        .find(|transport| transport.id == provider)
        .or_else(|| {
            OPENAI_COMPLETIONS_THIN_PROVIDER_PRESETS
                .iter()
                .copied()
                .find(|preset| preset.provider == provider)
                .map(|preset| openai_completions_preset_transport(&preset))
        })
}

fn openai_completions_preset_transport(preset: &ProviderTransportPreset) -> ProviderTransport {
    ProviderTransport {
        id: preset.provider,
        transport: "openai-completions",
        capabilities: RUST_PROVIDER_CAPABILITIES,
    }
}
