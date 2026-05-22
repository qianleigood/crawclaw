use super::*;

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
