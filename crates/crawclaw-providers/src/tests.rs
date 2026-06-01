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
    let actual = metadata
        .iter()
        .map(|entry| {
            (
                entry.plugin_id.clone(),
                (
                    entry.provider_ids.clone(),
                    entry.legacy_plugin_ids.clone(),
                    entry.auto_enable_when_configured_providers.clone(),
                ),
            )
        })
        .collect::<BTreeMap<_, _>>();

    assert_eq!(actual, collect_manifest_provider_contract_metadata());

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
        .model_choices
        .iter()
        .any(|entry| entry == "gpt-5.4-pro"));
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

    let missing_model_choices = descriptors
        .iter()
        .filter(|entry| entry.capabilities.chat && entry.model_choices.is_empty())
        .map(|entry| entry.provider.as_str())
        .collect::<Vec<_>>();
    assert_eq!(missing_model_choices, Vec::<&str>::new());

    let mut seen_choice_providers = BTreeSet::new();
    for choices in BUNDLED_PROVIDER_MODEL_CHOICES {
        assert!(
            seen_choice_providers.insert(choices.provider),
            "duplicate model choices provider {}",
            choices.provider
        );

        let mut seen_models = BTreeSet::new();
        for model in choices.models {
            assert!(
                seen_models.insert(*model),
                "duplicate model choice {} for {}",
                model,
                choices.provider
            );
        }
    }

    let classified_providers = SCOPED_PROVIDER_MODEL_PREFIXES
        .iter()
        .map(|(provider, _)| *provider)
        .chain(AGGREGATING_PROVIDER_MODEL_CHOICE_PROVIDERS.iter().copied())
        .collect::<BTreeSet<_>>();
    let unclassified_providers = BUNDLED_PROVIDER_MODEL_CHOICES
        .iter()
        .map(|choices| choices.provider)
        .filter(|provider| !classified_providers.contains(provider))
        .collect::<Vec<_>>();
    assert_eq!(
        unclassified_providers,
        Vec::<&str>::new(),
        "every provider model choice list must be classified as scoped or aggregating"
    );

    for (provider, prefixes) in SCOPED_PROVIDER_MODEL_PREFIXES {
        assert_provider_models_match_prefix(provider, prefixes);
    }
}

const AGGREGATING_PROVIDER_MODEL_CHOICE_PROVIDERS: &[&str] = &[
    "chutes",
    "huggingface",
    "kilocode",
    "litellm",
    "nvidia",
    "ollama",
    "opencode",
    "opencode-go",
    "openrouter",
    "sglang",
    "synthetic",
    "together",
    "venice",
    "vercel-ai-gateway",
    "vllm",
];

const SCOPED_PROVIDER_MODEL_PREFIXES: &[(&str, &[&str])] = &[
    ("amazon-bedrock", &["anthropic.", "us.anthropic."]),
    ("anthropic", &["sonnet-", "claude-"]),
    ("anthropic-vertex", &["claude-"]),
    ("byteplus", &["doubao-"]),
    ("byteplus-plan", &["doubao-", "ark-"]),
    ("cloudflare-ai-gateway", &["sonnet-", "claude-"]),
    ("copilot-proxy", &["gpt-"]),
    ("deepseek", &["deepseek-"]),
    ("github-copilot", &["gpt-"]),
    ("google", &["gemini-"]),
    ("google-gemini-cli", &["gemini-"]),
    ("kimi", &["kimi-"]),
    ("kimi-coding", &["kimi-", "k2"]),
    ("microsoft-foundry", &["gpt-"]),
    ("minimax", &["MiniMax-"]),
    ("minimax-portal", &["MiniMax-"]),
    ("mistral", &["mistral-", "magistral-", "pixtral-"]),
    ("modelstudio", &["qwen"]),
    ("moonshot", &["kimi-"]),
    ("openai", &["gpt-", "o"]),
    ("openai-codex", &["gpt-"]),
    ("qianfan", &["ernie-"]),
    ("volcengine", &["doubao-"]),
    ("volcengine-plan", &["doubao-", "ark-"]),
    ("xai", &["grok-"]),
    ("xiaomi", &["xmi-", "mimo-"]),
    ("zai", &["glm-"]),
];

fn assert_provider_models_match_prefix(provider: &str, prefixes: &[&str]) {
    let choices = BUNDLED_PROVIDER_MODEL_CHOICES
        .iter()
        .find(|entry| entry.provider == provider)
        .unwrap_or_else(|| panic!("missing model choices for {provider}"));
    let invalid = choices
        .models
        .iter()
        .copied()
        .filter(|model| !prefixes.iter().any(|prefix| model.starts_with(prefix)))
        .collect::<Vec<_>>();
    assert_eq!(
        invalid,
        Vec::<&str>::new(),
        "{provider} model choices should stay scoped to its model family"
    );
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
    assert!(auth_choices.iter().any(|choice| {
        choice.plugin_id == "xiaomi"
            && choice.provider == "xiaomi"
            && choice.method == "token-plan"
            && choice.choice_id == "xiaomi-token-plan"
    }));

    let setup_options = bundled_provider_setup_options();
    assert!(setup_options.iter().any(|choice| {
        choice.provider == "openai"
            && choice.value == "openai-api-key"
            && choice.label == "OpenAI API key"
    }));
    assert!(setup_options.iter().any(|choice| {
        choice.provider == "xiaomi"
            && choice.value == "xiaomi-token-plan"
            && choice.method == "token-plan"
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
    assert_eq!(
        MODEL_APIS,
        &[
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
    );
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
    assert_eq!(MINIMAX_OAUTH_MARKER, "minimax-oauth");
    assert_eq!(OAUTH_API_KEY_MARKER_PREFIX, "oauth:");
    assert_eq!(OLLAMA_LOCAL_AUTH_MARKER, "ollama-local");
    assert_eq!(CUSTOM_LOCAL_AUTH_MARKER, "custom-local");
    assert_eq!(GCP_VERTEX_CREDENTIALS_MARKER, "gcp-vertex-credentials");
    assert_eq!(NON_ENV_SECRETREF_MARKER, "secretref-managed");
    assert_eq!(SECRETREF_ENV_HEADER_MARKER_PREFIX, "secretref-env:");
    assert_eq!(AWS_BEDROCK_BEARER_TOKEN_ENV, "AWS_BEARER_TOKEN_BEDROCK");
    assert_eq!(AWS_ACCESS_KEY_ID_ENV, "AWS_ACCESS_KEY_ID");
    assert_eq!(AWS_SECRET_ACCESS_KEY_ENV, "AWS_SECRET_ACCESS_KEY");
    assert_eq!(AWS_PROFILE_ENV, "AWS_PROFILE");
    assert_eq!(
        AWS_SDK_ENV_MARKERS,
        &[
            "AWS_BEARER_TOKEN_BEDROCK",
            "AWS_ACCESS_KEY_ID",
            "AWS_PROFILE"
        ]
    );
    assert!(LEGACY_ENV_API_KEY_MARKERS.contains(&"AZURE_OPENAI_API_KEY"));
    assert_eq!(ANTHROPIC_PROVIDER_ID, "anthropic");
    assert_eq!(ANTHROPIC_VERTEX_PROVIDER_ID, "anthropic-vertex");
    assert_eq!(AMAZON_BEDROCK_PROVIDER_ID, "amazon-bedrock");
    assert_eq!(GITHUB_COPILOT_PROVIDER_ID, "github-copilot");
    assert_eq!(GOOGLE_PROVIDER_ID, "google");
    assert_eq!(GOOGLE_VERTEX_PROVIDER_ID, "google-vertex");
    assert_eq!(GROQ_PROVIDER_ID, "groq");
    assert_eq!(KILOCODE_PROVIDER_ID, "kilocode");
    assert_eq!(MINIMAX_PROVIDER_ID, "minimax");
    assert_eq!(MINIMAX_PORTAL_PROVIDER_ID, "minimax-portal");
    assert_eq!(MISTRAL_PROVIDER_ID, "mistral");
    assert_eq!(MODELSTUDIO_PROVIDER_ID, "modelstudio");
    assert_eq!(MOONSHOT_PROVIDER_ID, "moonshot");
    assert_eq!(OLLAMA_PROVIDER_ID, "ollama");
    assert_eq!(OPENAI_PROVIDER_ID, "openai");
    assert_eq!(OPENAI_CODEX_PROVIDER_ID, "openai-codex");
    assert_eq!(OPENROUTER_PROVIDER_ID, "openrouter");
    assert_eq!(TOGETHER_PROVIDER_ID, "together");
    assert_eq!(VERCEL_AI_GATEWAY_PROVIDER_ID, "vercel-ai-gateway");
    assert_eq!(XAI_PROVIDER_ID, "xai");
    assert_eq!(ZAI_PROVIDER_ID, "zai");
    assert_eq!(ANTHROPIC_API_KEY_ENV, "ANTHROPIC_API_KEY");
    assert_eq!(ANTHROPIC_OAUTH_TOKEN_ENV, "ANTHROPIC_OAUTH_TOKEN");
    assert_eq!(
        ANTHROPIC_VERTEX_USE_GCP_METADATA_ENV,
        "ANTHROPIC_VERTEX_USE_GCP_METADATA"
    );
    assert_eq!(
        GOOGLE_APPLICATION_CREDENTIALS_ENV,
        "GOOGLE_APPLICATION_CREDENTIALS"
    );
    assert_eq!(
        OAUTH_PROVIDER_AUTH_ENV_VARS,
        &["ANTHROPIC_OAUTH_TOKEN", "MINIMAX_OAUTH_TOKEN"]
    );
    assert_eq!(
        AUTH_COOLDOWN_BYPASS_PROVIDER_IDS,
        &["openrouter", "kilocode"]
    );
    assert_eq!(AUTH_WHAM_COOLDOWN_PROBE_PROVIDER_ID, "openai-codex");
    assert!(PROVIDER_USAGE_LABELS.contains(&("openai-codex", "Codex")));
    assert!(PROVIDER_USAGE_LABELS.contains(&("zai", "z.ai")));
    assert_eq!(PROVIDER_ATTRIBUTION_PRODUCT, "CrawClaw");
    assert_eq!(PROVIDER_ATTRIBUTION_ORIGINATOR, "crawclaw");
    assert_eq!(PROVIDER_ATTRIBUTION_REFERER_URL, "https://docs.crawclaw.ai");
    assert_eq!(
        OPENROUTER_ATTRIBUTION_DOCS_URL,
        "https://openrouter.ai/docs/app-attribution"
    );
    assert_eq!(OPENROUTER_ATTRIBUTION_CATEGORY, "cli-agent");
    assert_eq!(OPENAI_COMPLETIONS_API, "openai-completions");
    assert_eq!(OPENAI_RESPONSES_API, "openai-responses");
    assert_eq!(OPENAI_CODEX_RESPONSES_API, "openai-codex-responses");
    assert_eq!(
        OPENAI_AUDIO_TRANSCRIPTIONS_API,
        "openai-audio-transcriptions"
    );
    assert_eq!(ANTHROPIC_MESSAGES_API, "anthropic-messages");
    assert_eq!(
        MODEL_COMPAT_THINKING_FORMATS,
        &["openai", "openrouter", "zai", "qwen", "qwen-chat-template"]
    );
    assert_eq!(
        MODEL_COMPAT_MAX_TOKENS_FIELDS,
        &["max_completion_tokens", "max_tokens"]
    );
    assert_eq!(MINIMAX_VLM_MODEL_ID, "MiniMax-VL-01");
    assert_eq!(MINIMAX_API_HOST_ENV, "MINIMAX_API_HOST");
    assert_eq!(MINIMAX_DEFAULT_API_HOST, "https://api.minimax.io");
    assert_eq!(MINIMAX_VLM_API_PATH, "/v1/coding_plan/vlm");
    assert_eq!(
        LOCAL_ENDPOINT_HOSTS,
        &["localhost", "127.0.0.1", "::1", "[::1]"]
    );
    assert!(MOONSHOT_NATIVE_BASE_URLS.contains(&"https://api.moonshot.ai/v1"));
    assert!(
        MODELSTUDIO_NATIVE_BASE_URLS.contains(&"https://dashscope.aliyuncs.com/compatible-mode/v1")
    );
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
    assert_eq!(
        GOOGLE_MODEL_APIS,
        &["google-gemini-cli", "google-generative-ai"]
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
    assert_eq!(
        OPENROUTER_MODELS_API_URL,
        "https://openrouter.ai/api/v1/models"
    );
    assert_eq!(OPENROUTER_DEFAULT_MODEL_REF, "openrouter/auto");
    assert_eq!(
        MODEL_CATALOG_CONFIGURED_PROVIDER_IDS,
        &["deepseek", "kilocode", "ollama"]
    );
    assert!(OPENROUTER_PRICING_PROVIDER_ALIASES.contains(&("openai-codex", "openai")));
    assert!(OPENROUTER_PRICING_PROVIDER_ALIASES.contains(&("zai", "z-ai")));
    assert!(OPENROUTER_WRAPPER_PROVIDERS.contains(&"openrouter"));
    assert!(OPENROUTER_WRAPPER_PROVIDERS.contains(&"vercel-ai-gateway"));
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
        schema["schema"]["properties"]["models"]["properties"]["providers"]["additionalProperties"]
            ["properties"]["baseUrl"]["type"],
        "string"
    );
    assert_eq!(
        schema["schema"]["properties"]["models"]["properties"]["providers"]["additionalProperties"]
            ["properties"]["apiKey"]["oneOf"][0]["type"],
        "string"
    );
    assert_eq!(
        schema["schema"]["properties"]["models"]["properties"]["providers"]["additionalProperties"]
            ["properties"]["models"]["items"]["required"],
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
                system_prompt: None,
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
fn anthropic_messages_request_uses_provider_level_system_prompt() {
    let request = build_native_provider_conversation_request_with_options(
        &NativeProviderConfig {
            provider: "anthropic".to_string(),
            base_url: Some("https://api.example.test".to_string()),
            api_key: Some("secret".to_string()),
            model: Some("claude-test".to_string()),
            api: None,
            api_version: None,
        },
        &[NativeProviderMessage::user("hello")],
        &NativeProviderRequestOptions {
            system_prompt: Some("You are CrawClaw Desktop.".to_string()),
            ..NativeProviderRequestOptions::default()
        },
    )
    .expect("anthropic request");

    assert_eq!(request.body["system"], "You are CrawClaw Desktop.");
    let messages = request.body["messages"].as_array().expect("messages");
    assert_eq!(messages.len(), 1);
    assert_eq!(messages[0]["role"], "user");
    assert!(!serde_json::to_string(&messages[0])
        .expect("message json")
        .contains("You are CrawClaw Desktop."));
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

    let xiaomi_token_plan = build_native_provider_conversation_request_with_options(
        &NativeProviderConfig {
            provider: "xiaomi".to_string(),
            base_url: Some("https://token-plan-cn.xiaomimimo.com/v1".to_string()),
            api_key: Some("tp-secret".to_string()),
            model: Some("mimo-v2.5-pro".to_string()),
            api: None,
            api_version: None,
        },
        &[NativeProviderMessage::user("hello")],
        &NativeProviderRequestOptions::default(),
    )
    .expect("xiaomi token plan request");
    assert!(xiaomi_token_plan
        .headers
        .iter()
        .any(|(name, value)| name == "api-key" && value == "tp-secret"));
    assert!(!xiaomi_token_plan
        .headers
        .iter()
        .any(|(name, _)| name.eq_ignore_ascii_case("Authorization")));

    let xiaomi_pay_as_you_go = build_native_provider_conversation_request_with_options(
        &NativeProviderConfig {
            provider: "xiaomi".to_string(),
            base_url: Some("https://api.xiaomimimo.com/v1".to_string()),
            api_key: Some("sk-secret".to_string()),
            model: Some("xmi-large".to_string()),
            api: None,
            api_version: None,
        },
        &[NativeProviderMessage::user("hello")],
        &NativeProviderRequestOptions::default(),
    )
    .expect("xiaomi pay-as-you-go request");
    assert!(xiaomi_pay_as_you_go
        .headers
        .iter()
        .any(|(name, value)| name == "api-key" && value == "sk-secret"));
    assert!(!xiaomi_pay_as_you_go
        .headers
        .iter()
        .any(|(name, _)| name.eq_ignore_ascii_case("Authorization")));
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
fn applies_native_openai_responses_reasoning_policy() {
    let request = build_native_provider_conversation_request_with_options(
        &NativeProviderConfig {
            provider: "openai".to_string(),
            base_url: Some("https://api.openai.com/v1".to_string()),
            api_key: Some("secret".to_string()),
            model: Some("gpt-5.4".to_string()),
            api: None,
            api_version: None,
        },
        &[NativeProviderMessage::user("hello")],
        &NativeProviderRequestOptions {
            reasoning_level: Some("high".to_string()),
            ..NativeProviderRequestOptions::default()
        },
    )
    .expect("openai responses request");

    assert_eq!(request.body["reasoning"], json!({ "effort": "high" }));

    let non_reasoning_request = build_native_provider_conversation_request_with_options(
        &NativeProviderConfig {
            provider: "openai".to_string(),
            base_url: Some("https://api.openai.com/v1".to_string()),
            api_key: Some("secret".to_string()),
            model: Some("gpt-4o".to_string()),
            api: None,
            api_version: None,
        },
        &[NativeProviderMessage::user("hello")],
        &NativeProviderRequestOptions {
            reasoning_level: Some("high".to_string()),
            ..NativeProviderRequestOptions::default()
        },
    )
    .expect("openai non-reasoning responses request");

    assert!(non_reasoning_request.body.get("reasoning").is_none());
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
async fn sends_openai_compatible_local_request_without_api_key() {
    let (base_url, request_rx) =
        serve_once(r#"{"choices":[{"message":{"content":"mocked local reply"}}]}"#);

    let reply = send_native_provider_message(
        &NativeProviderConfig {
            provider: "openai-compatible".to_string(),
            base_url: Some(base_url),
            api_key: None,
            model: Some("model-a".to_string()),
            api: None,
            api_version: None,
        },
        "hello local provider",
    )
    .await
    .expect("provider reply");

    assert_eq!(reply, "mocked local reply");
    let request = request_rx.recv().expect("captured request");
    assert!(request.starts_with("POST /v1/chat/completions HTTP/1.1"));
    assert!(!request.contains("authorization:"));
    assert!(request.contains(r#""model":"model-a""#));
    assert!(request.contains("hello local provider"));
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
            system_prompt: None,
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

#[test]
fn parses_openai_compatible_stream_tool_calls() {
    let body = concat!(
        "data: {\"choices\":[{\"delta\":{\"tool_calls\":[{\"index\":0,\"id\":\"call_1\",\"type\":\"function\",\"function\":{\"name\":\"lookup_weather\",\"arguments\":\"{\\\"city\\\":\\\"Paris\\\"}\"}}]}}]}\n\n",
        "data: {\"choices\":[{\"delta\":{},\"finish_reason\":\"tool_calls\"}]}\n\n",
        "data: [DONE]\n\n",
    );

    let response = parse_native_provider_stream_assistant_response(
        NativeProviderResponseFormat::ChatCompletions,
        body,
    )
    .expect("assistant response");

    assert_eq!(response.text, "");
    assert_eq!(response.tool_calls.len(), 1);
    assert_eq!(response.tool_calls[0].id, "call_1");
    assert_eq!(response.tool_calls[0].name, "lookup_weather");
    assert_eq!(response.tool_calls[0].arguments, json!({ "city": "Paris" }));
}

#[test]
fn parses_openai_compatible_non_stream_tool_calls() {
    let response = parse_native_provider_assistant_response(
        NativeProviderResponseFormat::ChatCompletions,
        json!({
            "choices": [
                {
                    "message": {
                        "content": null,
                        "tool_calls": [
                            {
                                "id": "call_1",
                                "type": "function",
                                "function": {
                                    "name": "lookup_weather",
                                    "arguments": "{\"city\":\"Paris\"}"
                                }
                            }
                        ]
                    }
                }
            ]
        }),
    )
    .expect("assistant response");

    assert_eq!(response.text, "");
    assert_eq!(response.tool_calls.len(), 1);
    assert_eq!(response.tool_calls[0].id, "call_1");
    assert_eq!(response.tool_calls[0].name, "lookup_weather");
    assert_eq!(response.tool_calls[0].arguments, json!({ "city": "Paris" }));
}

#[test]
fn serializes_openai_compatible_tool_call_and_result_messages() {
    let request = build_native_provider_conversation_request_with_options(
        &NativeProviderConfig {
            provider: "openai-compatible".to_string(),
            base_url: Some("https://example.test/v1".to_string()),
            api_key: Some("secret".to_string()),
            model: Some("test-model".to_string()),
            api: None,
            api_version: None,
        },
        &[
            NativeProviderMessage {
                role: NativeProviderMessageRole::Assistant,
                content: String::new(),
                blocks: vec![NativeProviderContentBlock::tool_call(
                    "call_1",
                    "lookup_weather",
                    json!({ "city": "Paris" }),
                )],
            },
            NativeProviderMessage::tool_result(
                "call_1",
                Some("lookup_weather".to_string()),
                "sunny",
                false,
            ),
        ],
        &NativeProviderRequestOptions::default(),
    )
    .expect("openai-compatible request");

    let messages = request.body["messages"].as_array().expect("messages");
    assert_eq!(messages.len(), 2);
    assert_eq!(messages[0]["role"], "assistant");
    assert!(messages[0]["content"].is_null());
    assert_eq!(messages[0]["tool_calls"][0]["id"], "call_1");
    assert_eq!(
        messages[0]["tool_calls"][0]["function"]["name"],
        "lookup_weather"
    );
    assert_eq!(
        messages[0]["tool_calls"][0]["function"]["arguments"],
        "{\"city\":\"Paris\"}"
    );
    assert_eq!(messages[1]["role"], "tool");
    assert_eq!(messages[1]["tool_call_id"], "call_1");
    assert_eq!(messages[1]["name"], "lookup_weather");
    assert_eq!(messages[1]["content"], "sunny");
}

#[test]
fn parses_native_provider_tool_call_shapes() {
    let cases = [
        (
            NativeProviderResponseFormat::OpenAiResponses,
            "call_responses",
            json!({
                "output": [
                    {
                        "type": "function_call",
                        "call_id": "call_responses",
                        "name": "lookup_weather",
                        "arguments": "{\"city\":\"Paris\"}"
                    }
                ]
            }),
        ),
        (
            NativeProviderResponseFormat::AnthropicMessages,
            "toolu_1",
            json!({
                "content": [
                    {
                        "type": "tool_use",
                        "id": "toolu_1",
                        "name": "lookup_weather",
                        "input": { "city": "Paris" }
                    }
                ]
            }),
        ),
        (
            NativeProviderResponseFormat::GoogleGenerateContent,
            "call_google",
            json!({
                "candidates": [
                    {
                        "content": {
                            "parts": [
                                {
                                    "functionCall": {
                                        "id": "call_google",
                                        "name": "lookup_weather",
                                        "args": { "city": "Paris" }
                                    }
                                }
                            ]
                        }
                    }
                ]
            }),
        ),
        (
            NativeProviderResponseFormat::OllamaChat,
            "call_0",
            json!({
                "message": {
                    "tool_calls": [
                        {
                            "function": {
                                "name": "lookup_weather",
                                "arguments": { "city": "Paris" }
                            }
                        }
                    ]
                }
            }),
        ),
        (
            NativeProviderResponseFormat::BedrockConverse,
            "tooluse_1",
            json!({
                "output": {
                    "message": {
                        "content": [
                            {
                                "toolUse": {
                                    "toolUseId": "tooluse_1",
                                    "name": "lookup_weather",
                                    "input": { "city": "Paris" }
                                }
                            }
                        ]
                    }
                }
            }),
        ),
    ];

    for (format, expected_id, body) in cases {
        let response = parse_native_provider_assistant_response(format, body)
            .unwrap_or_else(|error| panic!("{format:?} should parse tool call: {error}"));
        assert_eq!(response.text, "");
        assert_eq!(response.tool_calls.len(), 1);
        assert_eq!(response.tool_calls[0].id, expected_id);
        assert_eq!(response.tool_calls[0].name, "lookup_weather");
        assert_eq!(response.tool_calls[0].arguments, json!({ "city": "Paris" }));
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

fn collect_manifest_provider_contract_metadata(
) -> BTreeMap<String, (Vec<String>, Vec<String>, Vec<String>)> {
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
        let Some(plugin_id) = manifest.get("id").and_then(Value::as_str).map(str::trim) else {
            continue;
        };
        let providers = string_array_manifest_field(&manifest, "providers");
        if plugin_id.is_empty() || providers.is_empty() {
            continue;
        }
        entries.insert(
            plugin_id.to_string(),
            (
                providers,
                string_array_manifest_field(&manifest, "legacyPluginIds"),
                string_array_manifest_field(&manifest, "autoEnableWhenConfiguredProviders"),
            ),
        );
    }

    entries
}

fn string_array_manifest_field(value: &Value, key: &str) -> Vec<String> {
    value
        .get(key)
        .and_then(Value::as_array)
        .map(|values| {
            values
                .iter()
                .filter_map(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_string)
                .collect()
        })
        .unwrap_or_default()
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
