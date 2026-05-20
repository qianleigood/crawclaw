use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::path::{Path, PathBuf};

use serde::Serialize;

const WEB_DOCS_URL: &str = "https://docs.crawclaw.ai/tools/web";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GeneratedModuleWriteResult {
    pub changed: bool,
    pub wrote: bool,
    pub output_path: PathBuf,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
struct BundledCapabilityMetadataEntryBuilder {
    provider_ids: BTreeSet<String>,
    web_fetch_provider_ids: BTreeSet<String>,
    web_search_provider_ids: BTreeSet<String>,
    tool_names: BTreeSet<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
struct BundledCapabilityMetadataEntry {
    plugin_id: String,
    provider_ids: Vec<String>,
    web_fetch_provider_ids: Vec<String>,
    web_search_provider_ids: Vec<String>,
    tool_names: Vec<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
struct BundledNativeProviderInvocation {
    plugin_id: String,
    operation: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
struct BundledNativeWebProviderMetadataEntry {
    plugin_id: String,
    id: String,
    label: String,
    hint: String,
    onboarding_scopes: Vec<String>,
    requires_credential: bool,
    env_vars: Vec<String>,
    placeholder: String,
    signup_url: String,
    docs_url: String,
    invocation: BundledNativeProviderInvocation,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
struct BundledNativeSpeechProviderMetadataEntry {
    plugin_id: String,
    id: String,
    label: String,
    voices: Vec<String>,
    synthesize: BundledNativeProviderInvocation,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
struct BundledCapabilityMetadataJsonPayload {
    plugin_contract_snapshots: Vec<BundledCapabilityMetadataEntry>,
    bundled_manifest_records: Vec<BundledManifestRegistryEntry>,
    native_web_search_providers: Vec<BundledNativeWebProviderMetadataEntry>,
    native_web_fetch_providers: Vec<BundledNativeWebProviderMetadataEntry>,
    native_speech_providers: Vec<BundledNativeSpeechProviderMetadataEntry>,
    legacy_plugin_id_aliases: BTreeMap<String, String>,
    auto_enable_provider_plugin_ids: BTreeMap<String, String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
struct BundledManifestRegistryEntry {
    dir_name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    package_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    package_version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    package_description: Option<String>,
    manifest: serde_json::Value,
}

impl BundledCapabilityMetadataEntry {
    fn is_empty(&self) -> bool {
        self.provider_ids.is_empty()
            && self.web_fetch_provider_ids.is_empty()
            && self.web_search_provider_ids.is_empty()
            && self.tool_names.is_empty()
    }
}

impl BundledCapabilityMetadataEntryBuilder {
    fn into_entry(self, plugin_id: String) -> BundledCapabilityMetadataEntry {
        BundledCapabilityMetadataEntry {
            plugin_id,
            provider_ids: self.provider_ids.into_iter().collect(),
            web_fetch_provider_ids: self.web_fetch_provider_ids.into_iter().collect(),
            web_search_provider_ids: self.web_search_provider_ids.into_iter().collect(),
            tool_names: self.tool_names.into_iter().collect(),
        }
    }
}

pub fn render_bundled_provider_auth_env_var_module() -> String {
    let mut entries = crawclaw_providers::bundled_provider_auth_env_vars();
    entries.sort_by(|left, right| left.provider.cmp(right.provider));
    let payload = entries
        .into_iter()
        .map(|entry| {
            (
                entry.provider.to_string(),
                entry
                    .env_vars
                    .into_iter()
                    .map(|value| (*value).to_string())
                    .collect::<Vec<_>>(),
            )
        })
        .collect::<BTreeMap<_, _>>();
    format!(
        "{}\n",
        serde_json::to_string_pretty(&payload).expect("provider auth env vars encode as JSON")
    )
}

pub fn write_bundled_provider_auth_env_var_module(
    output_path: impl AsRef<Path>,
    check: bool,
) -> Result<GeneratedModuleWriteResult, String> {
    let output_path = output_path.as_ref().to_path_buf();
    let next = render_bundled_provider_auth_env_var_module();
    let current = match fs::read_to_string(&output_path) {
        Ok(value) => Some(value),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
        Err(error) => return Err(format!("failed to read {}: {error}", output_path.display())),
    };
    let changed = current.as_deref() != Some(next.as_str());
    if check {
        return Ok(GeneratedModuleWriteResult {
            changed,
            wrote: false,
            output_path,
        });
    }
    if changed {
        if let Some(parent) = output_path.parent() {
            fs::create_dir_all(parent)
                .map_err(|error| format!("failed to create {}: {error}", parent.display()))?;
        }
        fs::write(&output_path, next)
            .map_err(|error| format!("failed to write {}: {error}", output_path.display()))?;
    }
    Ok(GeneratedModuleWriteResult {
        changed,
        wrote: changed,
        output_path,
    })
}

pub fn render_bundled_capability_metadata_module() -> String {
    format!(
        "{}\n",
        serde_json::to_string_pretty(&bundled_capability_metadata_json_payload())
            .expect("bundled capability metadata encodes as JSON")
    )
}

pub fn write_bundled_capability_metadata_module(
    output_path: impl AsRef<Path>,
    check: bool,
) -> Result<GeneratedModuleWriteResult, String> {
    let output_path = output_path.as_ref().to_path_buf();
    let next = render_bundled_capability_metadata_module();
    let current = match fs::read_to_string(&output_path) {
        Ok(value) => Some(value),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
        Err(error) => return Err(format!("failed to read {}: {error}", output_path.display())),
    };
    let changed = current.as_deref() != Some(next.as_str());
    if check {
        return Ok(GeneratedModuleWriteResult {
            changed,
            wrote: false,
            output_path,
        });
    }
    if changed {
        if let Some(parent) = output_path.parent() {
            fs::create_dir_all(parent)
                .map_err(|error| format!("failed to create {}: {error}", parent.display()))?;
        }
        fs::write(&output_path, next)
            .map_err(|error| format!("failed to write {}: {error}", output_path.display()))?;
    }
    Ok(GeneratedModuleWriteResult {
        changed,
        wrote: changed,
        output_path,
    })
}

pub fn render_provider_runtime_constants_module() -> String {
    format!(
        "{}\n",
        serde_json::to_string_pretty(&provider_runtime_constants_json_payload())
            .expect("provider runtime constants encode as JSON")
    )
}

fn provider_runtime_constants_json_payload() -> serde_json::Value {
    serde_json::json!({
        "CLAUDE_CLI_BACKEND_ID": crawclaw_providers::CLAUDE_CLI_BACKEND_ID,
        "AGENT_DEFAULT_PROVIDER": crawclaw_providers::AGENT_DEFAULT_PROVIDER,
        "AGENT_DEFAULT_MODEL": crawclaw_providers::AGENT_DEFAULT_MODEL,
        "AGENT_DEFAULT_CONTEXT_TOKENS": crawclaw_providers::AGENT_DEFAULT_CONTEXT_TOKENS,
        "AGENT_DEFAULT_MODEL_ALIASES": json_static_string_record(crawclaw_providers::AGENT_DEFAULT_MODEL_ALIASES),
        "PROVIDER_ID_ALIASES": json_static_string_record(crawclaw_providers::PROVIDER_ID_ALIASES),
        "PROVIDER_AUTH_ID_ALIASES": json_static_string_record(crawclaw_providers::PROVIDER_AUTH_ID_ALIASES),
        "ANTHROPIC_ADAPTIVE_THINKING_MODEL_PATTERN": crawclaw_providers::ANTHROPIC_ADAPTIVE_THINKING_MODEL_PATTERN,
        "AMAZON_BEDROCK_ADAPTIVE_THINKING_MODEL_PATTERN": crawclaw_providers::AMAZON_BEDROCK_ADAPTIVE_THINKING_MODEL_PATTERN,
        "OPENAI_XHIGH_THINKING_MODEL_IDS": crawclaw_providers::OPENAI_XHIGH_THINKING_MODEL_IDS,
        "OPENAI_CODEX_XHIGH_THINKING_MODEL_IDS": crawclaw_providers::OPENAI_CODEX_XHIGH_THINKING_MODEL_IDS,
        "GITHUB_COPILOT_XHIGH_THINKING_MODEL_IDS": crawclaw_providers::GITHUB_COPILOT_XHIGH_THINKING_MODEL_IDS,
        "DEFAULT_MODEL_COST": crawclaw_providers::PROVIDER_MODEL_DEFAULT_COST,
        "DEFAULT_MODEL_INPUT": crawclaw_providers::PROVIDER_MODEL_DEFAULT_INPUT_TYPES,
        "DEFAULT_MODEL_MAX_TOKENS": crawclaw_providers::PROVIDER_MODEL_DEFAULT_MAX_TOKENS,
        "PROVIDER_DEFAULT_API_BY_PROVIDER": json_static_string_record(crawclaw_providers::PROVIDER_DEFAULT_API_BY_PROVIDER),
        "MODEL_APIS": crawclaw_providers::MODEL_APIS,
        "ANTHROPIC_CONTEXT_1M_MODEL_PREFIXES": crawclaw_providers::ANTHROPIC_CONTEXT_1M_MODEL_PREFIXES,
        "ANTHROPIC_CONTEXT_1M_TOKENS": crawclaw_providers::ANTHROPIC_CONTEXT_1M_TOKENS,
        "DEFAULT_PROVIDER_CAPABILITIES": crawclaw_providers::DEFAULT_PROVIDER_CAPABILITIES,
        "PROVIDER_CAPABILITY_FALLBACKS": json_provider_capability_fallbacks(crawclaw_providers::PROVIDER_CAPABILITY_FALLBACKS),
        "CORE_PROVIDER_AUTH_ENV_VAR_CANDIDATES": json_provider_auth_env_var_record(crawclaw_providers::CORE_PROVIDER_AUTH_ENV_VAR_CANDIDATES),
        "CORE_PROVIDER_SETUP_ENV_VAR_OVERRIDES": json_provider_auth_env_var_record(crawclaw_providers::CORE_PROVIDER_SETUP_ENV_VAR_OVERRIDES),
        "EXTRA_PROVIDER_AUTH_ENV_VARS": crawclaw_providers::EXTRA_PROVIDER_AUTH_ENV_VARS,
        "MINIMAX_OAUTH_MARKER": crawclaw_providers::MINIMAX_OAUTH_MARKER,
        "OAUTH_API_KEY_MARKER_PREFIX": crawclaw_providers::OAUTH_API_KEY_MARKER_PREFIX,
        "OLLAMA_LOCAL_AUTH_MARKER": crawclaw_providers::OLLAMA_LOCAL_AUTH_MARKER,
        "CUSTOM_LOCAL_AUTH_MARKER": crawclaw_providers::CUSTOM_LOCAL_AUTH_MARKER,
        "GCP_VERTEX_CREDENTIALS_MARKER": crawclaw_providers::GCP_VERTEX_CREDENTIALS_MARKER,
        "NON_ENV_SECRETREF_MARKER": crawclaw_providers::NON_ENV_SECRETREF_MARKER,
        "SECRETREF_ENV_HEADER_MARKER_PREFIX": crawclaw_providers::SECRETREF_ENV_HEADER_MARKER_PREFIX,
        "AWS_BEDROCK_BEARER_TOKEN_ENV": crawclaw_providers::AWS_BEDROCK_BEARER_TOKEN_ENV,
        "AWS_ACCESS_KEY_ID_ENV": crawclaw_providers::AWS_ACCESS_KEY_ID_ENV,
        "AWS_SECRET_ACCESS_KEY_ENV": crawclaw_providers::AWS_SECRET_ACCESS_KEY_ENV,
        "AWS_PROFILE_ENV": crawclaw_providers::AWS_PROFILE_ENV,
        "AWS_SDK_ENV_MARKERS": crawclaw_providers::AWS_SDK_ENV_MARKERS,
        "LEGACY_ENV_API_KEY_MARKERS": crawclaw_providers::LEGACY_ENV_API_KEY_MARKERS,
        "ANTHROPIC_PROVIDER_ID": crawclaw_providers::ANTHROPIC_PROVIDER_ID,
        "ANTHROPIC_VERTEX_PROVIDER_ID": crawclaw_providers::ANTHROPIC_VERTEX_PROVIDER_ID,
        "AMAZON_BEDROCK_PROVIDER_ID": crawclaw_providers::AMAZON_BEDROCK_PROVIDER_ID,
        "GITHUB_COPILOT_PROVIDER_ID": crawclaw_providers::GITHUB_COPILOT_PROVIDER_ID,
        "GOOGLE_PROVIDER_ID": crawclaw_providers::GOOGLE_PROVIDER_ID,
        "GOOGLE_VERTEX_PROVIDER_ID": crawclaw_providers::GOOGLE_VERTEX_PROVIDER_ID,
        "GROQ_PROVIDER_ID": crawclaw_providers::GROQ_PROVIDER_ID,
        "KILOCODE_PROVIDER_ID": crawclaw_providers::KILOCODE_PROVIDER_ID,
        "MINIMAX_PROVIDER_ID": crawclaw_providers::MINIMAX_PROVIDER_ID,
        "MINIMAX_PORTAL_PROVIDER_ID": crawclaw_providers::MINIMAX_PORTAL_PROVIDER_ID,
        "MISTRAL_PROVIDER_ID": crawclaw_providers::MISTRAL_PROVIDER_ID,
        "MODELSTUDIO_PROVIDER_ID": crawclaw_providers::MODELSTUDIO_PROVIDER_ID,
        "MOONSHOT_PROVIDER_ID": crawclaw_providers::MOONSHOT_PROVIDER_ID,
        "OLLAMA_PROVIDER_ID": crawclaw_providers::OLLAMA_PROVIDER_ID,
        "OPENAI_PROVIDER_ID": crawclaw_providers::OPENAI_PROVIDER_ID,
        "OPENAI_CODEX_PROVIDER_ID": crawclaw_providers::OPENAI_CODEX_PROVIDER_ID,
        "OPENROUTER_PROVIDER_ID": crawclaw_providers::OPENROUTER_PROVIDER_ID,
        "TOGETHER_PROVIDER_ID": crawclaw_providers::TOGETHER_PROVIDER_ID,
        "VERCEL_AI_GATEWAY_PROVIDER_ID": crawclaw_providers::VERCEL_AI_GATEWAY_PROVIDER_ID,
        "XAI_PROVIDER_ID": crawclaw_providers::XAI_PROVIDER_ID,
        "ZAI_PROVIDER_ID": crawclaw_providers::ZAI_PROVIDER_ID,
        "ANTHROPIC_API_KEY_ENV": crawclaw_providers::ANTHROPIC_API_KEY_ENV,
        "ANTHROPIC_OAUTH_TOKEN_ENV": crawclaw_providers::ANTHROPIC_OAUTH_TOKEN_ENV,
        "ANTHROPIC_VERTEX_USE_GCP_METADATA_ENV": crawclaw_providers::ANTHROPIC_VERTEX_USE_GCP_METADATA_ENV,
        "GOOGLE_APPLICATION_CREDENTIALS_ENV": crawclaw_providers::GOOGLE_APPLICATION_CREDENTIALS_ENV,
        "OAUTH_PROVIDER_AUTH_ENV_VARS": crawclaw_providers::OAUTH_PROVIDER_AUTH_ENV_VARS,
        "AUTH_COOLDOWN_BYPASS_PROVIDER_IDS": crawclaw_providers::AUTH_COOLDOWN_BYPASS_PROVIDER_IDS,
        "AUTH_WHAM_COOLDOWN_PROBE_PROVIDER_ID": crawclaw_providers::AUTH_WHAM_COOLDOWN_PROBE_PROVIDER_ID,
        "PROVIDER_USAGE_LABELS": json_static_string_record(crawclaw_providers::PROVIDER_USAGE_LABELS),
        "PROVIDER_ATTRIBUTION_PRODUCT": crawclaw_providers::PROVIDER_ATTRIBUTION_PRODUCT,
        "PROVIDER_ATTRIBUTION_ORIGINATOR": crawclaw_providers::PROVIDER_ATTRIBUTION_ORIGINATOR,
        "PROVIDER_ATTRIBUTION_REFERER_URL": crawclaw_providers::PROVIDER_ATTRIBUTION_REFERER_URL,
        "OPENROUTER_ATTRIBUTION_DOCS_URL": crawclaw_providers::OPENROUTER_ATTRIBUTION_DOCS_URL,
        "OPENROUTER_ATTRIBUTION_CATEGORY": crawclaw_providers::OPENROUTER_ATTRIBUTION_CATEGORY,
        "OPENAI_COMPLETIONS_API": crawclaw_providers::OPENAI_COMPLETIONS_API,
        "OPENAI_RESPONSES_API": crawclaw_providers::OPENAI_RESPONSES_API,
        "OPENAI_CODEX_RESPONSES_API": crawclaw_providers::OPENAI_CODEX_RESPONSES_API,
        "OPENAI_AUDIO_TRANSCRIPTIONS_API": crawclaw_providers::OPENAI_AUDIO_TRANSCRIPTIONS_API,
        "ANTHROPIC_MESSAGES_API": crawclaw_providers::ANTHROPIC_MESSAGES_API,
        "MODEL_COMPAT_THINKING_FORMATS": crawclaw_providers::MODEL_COMPAT_THINKING_FORMATS,
        "MODEL_COMPAT_MAX_TOKENS_FIELDS": crawclaw_providers::MODEL_COMPAT_MAX_TOKENS_FIELDS,
        "MINIMAX_VLM_MODEL_ID": crawclaw_providers::MINIMAX_VLM_MODEL_ID,
        "MINIMAX_API_HOST_ENV": crawclaw_providers::MINIMAX_API_HOST_ENV,
        "MINIMAX_DEFAULT_API_HOST": crawclaw_providers::MINIMAX_DEFAULT_API_HOST,
        "MINIMAX_VLM_API_PATH": crawclaw_providers::MINIMAX_VLM_API_PATH,
        "LOCAL_ENDPOINT_HOSTS": crawclaw_providers::LOCAL_ENDPOINT_HOSTS,
        "MOONSHOT_NATIVE_BASE_URLS": crawclaw_providers::MOONSHOT_NATIVE_BASE_URLS,
        "MODELSTUDIO_NATIVE_BASE_URLS": crawclaw_providers::MODELSTUDIO_NATIVE_BASE_URLS,
        "OPENAI_RESPONSES_APIS": crawclaw_providers::OPENAI_RESPONSES_APIS,
        "OPENAI_RESPONSES_PROVIDERS": crawclaw_providers::OPENAI_RESPONSES_PROVIDERS,
        "MOONSHOT_COMPAT_PROVIDERS": crawclaw_providers::MOONSHOT_COMPAT_PROVIDERS,
        "TRANSCRIPT_OPENAI_MODEL_APIS": crawclaw_providers::TRANSCRIPT_OPENAI_MODEL_APIS,
        "TRANSCRIPT_ANTHROPIC_MODEL_APIS": crawclaw_providers::TRANSCRIPT_ANTHROPIC_MODEL_APIS,
        "GOOGLE_MODEL_APIS": crawclaw_providers::GOOGLE_MODEL_APIS,
        "OPENAI_COMPATIBLE_TURN_VALIDATION_API": crawclaw_providers::OPENAI_COMPATIBLE_TURN_VALIDATION_API,
        "OPENAI_COMPATIBLE_TOOL_ID_SANITIZATION_APIS": crawclaw_providers::OPENAI_COMPATIBLE_TOOL_ID_SANITIZATION_APIS,
        "OPENROUTER_MODELS_API_URL": crawclaw_providers::OPENROUTER_MODELS_API_URL,
        "OPENROUTER_DEFAULT_MODEL_REF": crawclaw_providers::OPENROUTER_DEFAULT_MODEL_REF,
        "MODEL_CATALOG_CONFIGURED_PROVIDER_IDS": crawclaw_providers::MODEL_CATALOG_CONFIGURED_PROVIDER_IDS,
        "OPENROUTER_PRICING_PROVIDER_ALIASES": json_static_string_record(crawclaw_providers::OPENROUTER_PRICING_PROVIDER_ALIASES),
        "OPENROUTER_WRAPPER_PROVIDERS": crawclaw_providers::OPENROUTER_WRAPPER_PROVIDERS,
        "KNOWN_PROVIDER_FAMILIES": json_static_string_record(crawclaw_providers::KNOWN_PROVIDER_FAMILIES),
        "MISTRAL_SAFE_MAX_TOKENS_BY_MODEL": json_static_u32_record(crawclaw_providers::MISTRAL_SAFE_MAX_TOKENS_BY_MODEL),
        "DEFAULT_CLAUDE_CLI_MODEL": crawclaw_providers::DEFAULT_CLAUDE_CLI_MODEL,
        "ANTHROPIC_VERTEX_DEFAULT_REGION": crawclaw_providers::ANTHROPIC_VERTEX_DEFAULT_REGION,
        "ANTHROPIC_VERTEX_CREDENTIALS_MARKER": crawclaw_providers::ANTHROPIC_VERTEX_CREDENTIALS_MARKER,
        "OLLAMA_DEFAULT_BASE_URL": crawclaw_providers::OLLAMA_DEFAULT_BASE_URL,
        "OLLAMA_DEFAULT_CONTEXT_WINDOW": crawclaw_providers::OLLAMA_DEFAULT_CONTEXT_WINDOW,
        "OLLAMA_DEFAULT_MAX_TOKENS": crawclaw_providers::OLLAMA_DEFAULT_MAX_TOKENS,
        "OLLAMA_DEFAULT_MODEL": crawclaw_providers::OLLAMA_DEFAULT_MODEL,
        "OLLAMA_DEFAULT_EMBEDDING_MODEL": crawclaw_providers::OLLAMA_DEFAULT_EMBEDDING_MODEL,
        "OPENAI_DEFAULT_MODEL": crawclaw_providers::OPENAI_DEFAULT_MODEL_REF,
        "OPENAI_CODEX_DEFAULT_MODEL": crawclaw_providers::OPENAI_CODEX_DEFAULT_MODEL_REF,
        "OPENAI_DEFAULT_IMAGE_MODEL": crawclaw_providers::OPENAI_DEFAULT_IMAGE_MODEL,
        "OPENAI_DEFAULT_AUDIO_TRANSCRIPTION_MODEL": crawclaw_providers::OPENAI_DEFAULT_AUDIO_TRANSCRIPTION_MODEL,
        "OPENAI_DEFAULT_EMBEDDING_MODEL": crawclaw_providers::OPENAI_DEFAULT_EMBEDDING_MODEL,
        "GOOGLE_GEMINI_DEFAULT_MODEL": crawclaw_providers::GOOGLE_GEMINI_DEFAULT_MODEL_REF,
        "OPENCODE_GO_DEFAULT_MODEL_REF": crawclaw_providers::OPENCODE_GO_DEFAULT_MODEL_REF,
        "OPENCODE_ZEN_DEFAULT_MODEL": crawclaw_providers::OPENCODE_ZEN_DEFAULT_MODEL_REF,
        "LEGACY_OPENCODE_ZEN_DEFAULT_MODELS": crawclaw_providers::LEGACY_OPENCODE_ZEN_DEFAULT_MODEL_REFS,
    })
}

fn json_static_string_record(entries: &[(&str, &str)]) -> BTreeMap<String, String> {
    entries
        .iter()
        .map(|(key, value)| ((*key).to_string(), (*value).to_string()))
        .collect()
}

fn json_static_u32_record(entries: &[(&str, u32)]) -> BTreeMap<String, u32> {
    entries
        .iter()
        .map(|(key, value)| ((*key).to_string(), *value))
        .collect()
}

fn json_provider_auth_env_var_record(
    entries: &[crawclaw_providers::ProviderAuthEnvVars],
) -> BTreeMap<String, Vec<String>> {
    entries
        .iter()
        .map(|entry| {
            (
                entry.provider.to_string(),
                entry
                    .env_vars
                    .iter()
                    .map(|value| (*value).to_string())
                    .collect(),
            )
        })
        .collect()
}

fn json_provider_capability_fallbacks(
    entries: &[crawclaw_providers::ProviderCapabilityFallback],
) -> BTreeMap<String, serde_json::Value> {
    entries
        .iter()
        .map(|entry| {
            let mut value =
                serde_json::to_value(entry).expect("provider capability fallback encodes as JSON");
            if let Some(object) = value.as_object_mut() {
                object.remove("provider");
                object.retain(|_, value| match value {
                    serde_json::Value::Null => false,
                    serde_json::Value::Array(values) => !values.is_empty(),
                    _ => true,
                });
            }
            (entry.provider.to_string(), value)
        })
        .collect()
}

pub fn write_provider_runtime_constants_module(
    output_path: impl AsRef<Path>,
    check: bool,
) -> Result<GeneratedModuleWriteResult, String> {
    let output_path = output_path.as_ref().to_path_buf();
    let next = render_provider_runtime_constants_module();
    let current = match fs::read_to_string(&output_path) {
        Ok(value) => Some(value),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
        Err(error) => return Err(format!("failed to read {}: {error}", output_path.display())),
    };
    let changed = current.as_deref() != Some(next.as_str());
    if check {
        return Ok(GeneratedModuleWriteResult {
            changed,
            wrote: false,
            output_path,
        });
    }
    if changed {
        if let Some(parent) = output_path.parent() {
            fs::create_dir_all(parent)
                .map_err(|error| format!("failed to create {}: {error}", parent.display()))?;
        }
        fs::write(&output_path, next)
            .map_err(|error| format!("failed to write {}: {error}", output_path.display()))?;
    }
    Ok(GeneratedModuleWriteResult {
        changed,
        wrote: changed,
        output_path,
    })
}

fn bundled_capability_metadata_payload() -> (
    Vec<BundledCapabilityMetadataEntry>,
    BTreeMap<String, String>,
    BTreeMap<String, String>,
) {
    let mut entries = BTreeMap::<String, BundledCapabilityMetadataEntryBuilder>::new();
    let mut legacy_aliases = BTreeMap::<String, String>::new();
    let mut auto_enable_provider_plugins = BTreeMap::<String, String>::new();

    for metadata in crawclaw_providers::bundled_provider_plugin_contract_metadata() {
        let entry = entries.entry(metadata.plugin_id.clone()).or_default();
        entry.provider_ids.extend(metadata.provider_ids);
        for legacy_plugin_id in metadata.legacy_plugin_ids {
            legacy_aliases.insert(legacy_plugin_id, metadata.plugin_id.clone());
        }
        for provider_id in metadata.auto_enable_when_configured_providers {
            auto_enable_provider_plugins.insert(provider_id, metadata.plugin_id.clone());
        }
    }

    for descriptor in crawclaw_native_plugins::registry::builtin_native_plugin_descriptors() {
        let entry = entries.entry(descriptor.plugin_id.clone()).or_default();
        entry.provider_ids.extend(
            descriptor
                .model_providers
                .into_iter()
                .map(|provider| provider.id),
        );
        entry.web_fetch_provider_ids.extend(
            descriptor
                .web_fetch_providers
                .into_iter()
                .map(|provider| provider.id),
        );
        entry.web_search_provider_ids.extend(
            descriptor
                .web_search_providers
                .into_iter()
                .map(|provider| provider.id),
        );
        entry
            .tool_names
            .extend(descriptor.tools.into_iter().map(|tool| tool.name));
    }

    let snapshots = entries
        .into_iter()
        .map(|(plugin_id, entry)| entry.into_entry(plugin_id))
        .filter(|entry| !entry.is_empty())
        .collect();

    (snapshots, legacy_aliases, auto_enable_provider_plugins)
}

fn bundled_capability_metadata_json_payload() -> BundledCapabilityMetadataJsonPayload {
    let (plugin_contract_snapshots, legacy_plugin_id_aliases, auto_enable_provider_plugin_ids) =
        bundled_capability_metadata_payload();
    let native_metadata = bundled_native_provider_metadata_payload();
    BundledCapabilityMetadataJsonPayload {
        plugin_contract_snapshots,
        bundled_manifest_records: bundled_manifest_registry_records(),
        native_web_search_providers: native_metadata.web_search_providers,
        native_web_fetch_providers: native_metadata.web_fetch_providers,
        native_speech_providers: native_metadata.speech_providers,
        legacy_plugin_id_aliases,
        auto_enable_provider_plugin_ids,
    }
}

fn bundled_manifest_registry_records() -> Vec<BundledManifestRegistryEntry> {
    let repo_root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..");
    let extensions_root = repo_root.join("extensions");
    let Ok(entries) = fs::read_dir(&extensions_root) else {
        return Vec::new();
    };
    let mut records = Vec::new();
    for entry in entries.flatten() {
        let Ok(file_type) = entry.file_type() else {
            continue;
        };
        if !file_type.is_dir() {
            continue;
        }
        let dir_name = entry.file_name().to_string_lossy().to_string();
        let plugin_dir = entry.path();
        let manifest_path = plugin_dir.join("crawclaw.plugin.json");
        if !manifest_path.exists() {
            continue;
        }
        let manifest = read_json_value(&manifest_path);
        if manifest
            .get("native")
            .and_then(serde_json::Value::as_object)
            .is_none()
        {
            continue;
        }
        let package_json = read_json_value_optional(&plugin_dir.join("package.json"));
        records.push(BundledManifestRegistryEntry {
            dir_name,
            package_name: package_json
                .as_ref()
                .and_then(|value| value.get("name"))
                .and_then(serde_json::Value::as_str)
                .map(ToOwned::to_owned),
            package_version: package_json
                .as_ref()
                .and_then(|value| value.get("version"))
                .and_then(serde_json::Value::as_str)
                .map(ToOwned::to_owned),
            package_description: package_json
                .as_ref()
                .and_then(|value| value.get("description"))
                .and_then(serde_json::Value::as_str)
                .map(ToOwned::to_owned),
            manifest,
        });
    }
    records.sort_by(|left, right| {
        value_string(&left.manifest, "id")
            .cmp(&value_string(&right.manifest, "id"))
            .then_with(|| left.dir_name.cmp(&right.dir_name))
    });
    records
}

fn read_json_value(path: &Path) -> serde_json::Value {
    let raw = fs::read_to_string(path)
        .unwrap_or_else(|error| panic!("failed to read {}: {error}", path.display()));
    serde_json::from_str(&raw)
        .unwrap_or_else(|error| panic!("failed to parse {}: {error}", path.display()))
}

fn read_json_value_optional(path: &Path) -> Option<serde_json::Value> {
    if !path.exists() {
        return None;
    }
    Some(read_json_value(path))
}

fn value_string(value: &serde_json::Value, key: &str) -> String {
    value
        .get(key)
        .and_then(serde_json::Value::as_str)
        .unwrap_or_default()
        .to_string()
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
struct BundledNativeProviderMetadataPayload {
    web_search_providers: Vec<BundledNativeWebProviderMetadataEntry>,
    web_fetch_providers: Vec<BundledNativeWebProviderMetadataEntry>,
    speech_providers: Vec<BundledNativeSpeechProviderMetadataEntry>,
}

fn bundled_native_provider_metadata_payload() -> BundledNativeProviderMetadataPayload {
    let mut payload = BundledNativeProviderMetadataPayload::default();
    for descriptor in crawclaw_native_plugins::registry::builtin_native_plugin_descriptors() {
        let plugin_id = descriptor.plugin_id;
        payload
            .web_search_providers
            .extend(descriptor.web_search_providers.into_iter().map(|provider| {
                BundledNativeWebProviderMetadataEntry {
                    plugin_id: plugin_id.clone(),
                    hint: native_web_provider_hint(&provider.id, &provider.label),
                    onboarding_scopes: vec!["text-inference".to_string()],
                    requires_credential: false,
                    env_vars: native_web_provider_env_vars(&provider.id),
                    placeholder: String::new(),
                    signup_url: WEB_DOCS_URL.to_string(),
                    docs_url: WEB_DOCS_URL.to_string(),
                    invocation: BundledNativeProviderInvocation {
                        plugin_id: provider.invocation.plugin_id,
                        operation: provider.invocation.operation,
                    },
                    id: provider.id,
                    label: provider.label,
                }
            }));
        payload
            .web_fetch_providers
            .extend(descriptor.web_fetch_providers.into_iter().map(|provider| {
                BundledNativeWebProviderMetadataEntry {
                    plugin_id: plugin_id.clone(),
                    hint: native_web_provider_hint(&provider.id, &provider.label),
                    onboarding_scopes: Vec::new(),
                    requires_credential: false,
                    env_vars: native_web_provider_env_vars(&provider.id),
                    placeholder: String::new(),
                    signup_url: WEB_DOCS_URL.to_string(),
                    docs_url: WEB_DOCS_URL.to_string(),
                    invocation: BundledNativeProviderInvocation {
                        plugin_id: provider.invocation.plugin_id,
                        operation: provider.invocation.operation,
                    },
                    id: provider.id,
                    label: provider.label,
                }
            }));
        payload
            .speech_providers
            .extend(descriptor.speech_providers.into_iter().map(|provider| {
                BundledNativeSpeechProviderMetadataEntry {
                    plugin_id: plugin_id.clone(),
                    id: provider.id,
                    label: provider.label,
                    voices: provider.voices,
                    synthesize: BundledNativeProviderInvocation {
                        plugin_id: provider.synthesize.plugin_id,
                        operation: provider.synthesize.operation,
                    },
                }
            }));
    }
    payload.web_search_providers.sort_by(|left, right| {
        left.id
            .cmp(&right.id)
            .then_with(|| left.plugin_id.cmp(&right.plugin_id))
    });
    payload.web_fetch_providers.sort_by(|left, right| {
        left.id
            .cmp(&right.id)
            .then_with(|| left.plugin_id.cmp(&right.plugin_id))
    });
    payload.speech_providers.sort_by(|left, right| {
        left.id
            .cmp(&right.id)
            .then_with(|| left.plugin_id.cmp(&right.plugin_id))
    });
    payload
}

fn native_web_provider_hint(id: &str, label: &str) -> String {
    match id {
        "searxng" => "Use the bundled managed local SearXNG web search provider".to_string(),
        "spider" => {
            "Use the bundled native static HTTP and browser-rendered fetch provider".to_string()
        }
        _ => format!("Use the bundled native {label} provider"),
    }
}

fn native_web_provider_env_vars(id: &str) -> Vec<String> {
    match id {
        "searxng" => vec!["SEARXNG_BASE_URL".to_string()],
        _ => Vec::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bundled_provider_auth_env_var_module_uses_rust_provider_metadata() {
        let source = render_bundled_provider_auth_env_var_module();
        let payload: BTreeMap<String, Vec<String>> = serde_json::from_str(&source).unwrap();
        assert_eq!(
            payload.get("anthropic").unwrap(),
            &vec![
                "ANTHROPIC_OAUTH_TOKEN".to_string(),
                "ANTHROPIC_API_KEY".to_string()
            ]
        );
        assert_eq!(
            payload.get("github-copilot").unwrap(),
            &vec![
                "COPILOT_GITHUB_TOKEN".to_string(),
                "GH_TOKEN".to_string(),
                "GITHUB_TOKEN".to_string()
            ]
        );
        assert_eq!(
            payload.get("openai").unwrap(),
            &vec!["OPENAI_API_KEY".to_string()]
        );
        assert!(!payload.contains_key("openai-codex"));
    }

    #[test]
    fn bundled_capability_metadata_module_uses_rust_plugin_metadata() {
        let source = render_bundled_capability_metadata_module();
        let payload: serde_json::Value = serde_json::from_str(&source).unwrap();
        let snapshots = payload["pluginContractSnapshots"].as_array().unwrap();
        assert!(snapshots.iter().any(|entry| {
            entry["pluginId"] == "openai"
                && entry["providerIds"].as_array().unwrap()
                    == &vec![
                        serde_json::Value::String("openai".to_string()),
                        serde_json::Value::String("openai-codex".to_string()),
                    ]
        }));
        assert!(snapshots.iter().any(|entry| {
            entry["pluginId"] == "searxng"
                && entry["webSearchProviderIds"].as_array().unwrap()
                    == &vec![serde_json::Value::String("searxng".to_string())]
        }));
        assert!(snapshots.iter().any(|entry| {
            entry["pluginId"] == "spider-fetch"
                && entry["webFetchProviderIds"].as_array().unwrap()
                    == &vec![serde_json::Value::String("spider".to_string())]
        }));
        assert!(snapshots.iter().any(|entry| {
            entry["pluginId"] == "comfyui"
                && entry["toolNames"].as_array().unwrap()
                    == &vec![serde_json::Value::String("comfyui_workflow".to_string())]
        }));
        assert_eq!(
            payload["legacyPluginIdAliases"]["minimax-portal-auth"],
            "minimax"
        );
        assert_eq!(
            payload["autoEnableProviderPluginIds"]["google-gemini-cli"],
            "google"
        );
    }

    #[test]
    fn bundled_capability_metadata_includes_native_manifest_registry_records() {
        let source = render_bundled_capability_metadata_module();
        let payload: serde_json::Value = serde_json::from_str(&source).unwrap();
        let records = payload["bundledManifestRecords"].as_array().unwrap();
        assert_eq!(records.len(), 45);
        let openai = records
            .iter()
            .find(|entry| entry["manifest"]["id"] == "openai")
            .unwrap();
        assert_eq!(openai["dirName"], "openai");
        assert_eq!(openai["packageName"], "@crawclaw/openai-provider");
        assert_eq!(openai["manifest"]["enabledByDefault"], true);
        assert!(openai["manifest"]["configSchema"].is_object());
        assert!(records
            .iter()
            .all(|entry| entry["manifest"]["native"].is_object()));
    }

    #[test]
    fn bundled_capability_metadata_module_emits_native_provider_descriptors_from_rust() {
        let source = render_bundled_capability_metadata_module();
        let payload: serde_json::Value = serde_json::from_str(&source).unwrap();
        let web_search = payload["nativeWebSearchProviders"].as_array().unwrap();
        let searxng = web_search
            .iter()
            .find(|entry| entry["id"] == "searxng")
            .unwrap();
        assert_eq!(searxng["label"], "SearXNG");
        assert_eq!(
            searxng["hint"],
            "Use the bundled managed local SearXNG web search provider"
        );
        assert_eq!(
            searxng["onboardingScopes"].as_array().unwrap(),
            &vec![serde_json::Value::String("text-inference".to_string())]
        );
        assert_eq!(
            searxng["envVars"].as_array().unwrap(),
            &vec![serde_json::Value::String("SEARXNG_BASE_URL".to_string())]
        );
        assert_eq!(searxng["invocation"]["pluginId"], "searxng");
        assert_eq!(searxng["invocation"]["operation"], "search");

        let web_fetch = payload["nativeWebFetchProviders"].as_array().unwrap();
        let spider = web_fetch
            .iter()
            .find(|entry| entry["id"] == "spider")
            .unwrap();
        assert_eq!(
            spider["hint"],
            "Use the bundled native static HTTP and browser-rendered fetch provider"
        );
        assert_eq!(spider["docsUrl"], "https://docs.crawclaw.ai/tools/web");
        assert_eq!(spider["invocation"]["pluginId"], "spider-fetch");
        assert_eq!(spider["invocation"]["operation"], "fetch");

        let speech = payload["nativeSpeechProviders"].as_array().unwrap();
        let qwen3_tts = speech
            .iter()
            .find(|entry| entry["id"] == "qwen3-tts")
            .unwrap();
        assert_eq!(
            qwen3_tts["voices"].as_array().unwrap(),
            &vec![serde_json::Value::String("assistant".to_string())]
        );
        assert_eq!(qwen3_tts["synthesize"]["pluginId"], "qwen3-tts");
        assert_eq!(qwen3_tts["synthesize"]["operation"], "synthesize");
    }

    #[test]
    fn provider_runtime_constants_module_uses_rust_provider_metadata() {
        let source = render_provider_runtime_constants_module();
        let payload: serde_json::Value = serde_json::from_str(&source).unwrap();
        assert_eq!(payload["CLAUDE_CLI_BACKEND_ID"], "claude-cli");
        assert_eq!(payload["AGENT_DEFAULT_PROVIDER"], "anthropic");
        assert_eq!(payload["AGENT_DEFAULT_MODEL"], "claude-opus-4-6");
        assert_eq!(payload["AGENT_DEFAULT_CONTEXT_TOKENS"], 200000);
        assert_eq!(
            payload["AGENT_DEFAULT_MODEL_ALIASES"]["opus"],
            "anthropic/claude-opus-4-6"
        );
        assert_eq!(
            payload["AGENT_DEFAULT_MODEL_ALIASES"]["gpt-mini"],
            "openai/gpt-5-mini"
        );
        assert_eq!(
            payload["AGENT_DEFAULT_MODEL_ALIASES"]["gemini-flash-lite"],
            "google/gemini-3.1-flash-lite-preview"
        );
        assert_eq!(payload["PROVIDER_ID_ALIASES"]["z.ai"], "zai");
        assert_eq!(
            payload["PROVIDER_ID_ALIASES"]["aws-bedrock"],
            "amazon-bedrock"
        );
        assert_eq!(payload["PROVIDER_ID_ALIASES"]["doubao"], "volcengine");
        assert_eq!(
            payload["PROVIDER_AUTH_ID_ALIASES"]["volcengine-plan"],
            "volcengine"
        );
        assert_eq!(
            payload["PROVIDER_AUTH_ID_ALIASES"]["byteplus-plan"],
            "byteplus"
        );
        assert!(payload["ANTHROPIC_ADAPTIVE_THINKING_MODEL_PATTERN"]
            .as_str()
            .unwrap()
            .starts_with("^claude-(?:opus|sonnet)-4"));
        assert!(payload["AMAZON_BEDROCK_ADAPTIVE_THINKING_MODEL_PATTERN"]
            .as_str()
            .unwrap()
            .starts_with("claude-(?:opus|sonnet)-4"));
        assert!(payload["OPENAI_XHIGH_THINKING_MODEL_IDS"]
            .as_array()
            .unwrap()
            .contains(&serde_json::Value::String("gpt-5.4".to_string())));
        assert!(payload["OPENAI_CODEX_XHIGH_THINKING_MODEL_IDS"]
            .as_array()
            .unwrap()
            .contains(&serde_json::Value::String(
                "gpt-5.3-codex-spark".to_string()
            )));
        assert_eq!(payload["DEFAULT_MODEL_COST"]["cacheWrite"], 0);
        assert_eq!(
            payload["DEFAULT_MODEL_INPUT"].as_array().unwrap(),
            &vec![serde_json::Value::String("text".to_string())]
        );
        assert_eq!(payload["DEFAULT_MODEL_MAX_TOKENS"], 8192);
        assert_eq!(
            payload["PROVIDER_DEFAULT_API_BY_PROVIDER"]["anthropic"],
            "anthropic-messages"
        );
        assert!(payload["MODEL_APIS"]
            .as_array()
            .unwrap()
            .contains(&serde_json::Value::String(
                "openai-codex-responses".to_string()
            )));
        assert!(payload["MODEL_APIS"]
            .as_array()
            .unwrap()
            .contains(&serde_json::Value::String(
                "azure-openai-responses".to_string()
            )));
        assert_eq!(payload["ANTHROPIC_CONTEXT_1M_TOKENS"], 1048576);
        assert_eq!(
            payload["DEFAULT_PROVIDER_CAPABILITIES"]["providerFamily"],
            "default"
        );
        assert_eq!(
            payload["PROVIDER_CAPABILITY_FALLBACKS"]["anthropic"]["providerFamily"],
            "anthropic"
        );
        assert_eq!(
            payload["CORE_PROVIDER_AUTH_ENV_VAR_CANDIDATES"]["voyage"][0],
            "VOYAGE_API_KEY"
        );
        assert_eq!(
            payload["CORE_PROVIDER_SETUP_ENV_VAR_OVERRIDES"]["anthropic"]
                .as_array()
                .unwrap(),
            &vec![
                serde_json::Value::String("ANTHROPIC_API_KEY".to_string()),
                serde_json::Value::String("ANTHROPIC_OAUTH_TOKEN".to_string())
            ]
        );
        assert_eq!(
            payload["EXTRA_PROVIDER_AUTH_ENV_VARS"][0],
            "MINIMAX_CODE_PLAN_KEY"
        );
        assert_eq!(payload["MINIMAX_OAUTH_MARKER"], "minimax-oauth");
        assert_eq!(payload["OAUTH_API_KEY_MARKER_PREFIX"], "oauth:");
        assert_eq!(
            payload["AWS_BEDROCK_BEARER_TOKEN_ENV"],
            "AWS_BEARER_TOKEN_BEDROCK"
        );
        assert!(payload["AWS_SDK_ENV_MARKERS"]
            .as_array()
            .unwrap()
            .contains(&serde_json::Value::String("AWS_PROFILE".to_string())));
        assert!(payload["LEGACY_ENV_API_KEY_MARKERS"]
            .as_array()
            .unwrap()
            .contains(&serde_json::Value::String(
                "AZURE_OPENAI_API_KEY".to_string()
            )));
        assert_eq!(payload["ANTHROPIC_PROVIDER_ID"], "anthropic");
        assert_eq!(payload["ANTHROPIC_VERTEX_PROVIDER_ID"], "anthropic-vertex");
        assert_eq!(payload["OPENAI_CODEX_PROVIDER_ID"], "openai-codex");
        assert_eq!(
            payload["VERCEL_AI_GATEWAY_PROVIDER_ID"],
            "vercel-ai-gateway"
        );
        assert_eq!(payload["ANTHROPIC_API_KEY_ENV"], "ANTHROPIC_API_KEY");
        assert_eq!(
            payload["ANTHROPIC_OAUTH_TOKEN_ENV"],
            "ANTHROPIC_OAUTH_TOKEN"
        );
        assert_eq!(
            payload["GOOGLE_APPLICATION_CREDENTIALS_ENV"],
            "GOOGLE_APPLICATION_CREDENTIALS"
        );
        assert_eq!(
            payload["OAUTH_PROVIDER_AUTH_ENV_VARS"][0],
            "ANTHROPIC_OAUTH_TOKEN"
        );
        assert_eq!(
            payload["AUTH_COOLDOWN_BYPASS_PROVIDER_IDS"][0],
            "openrouter"
        );
        assert_eq!(
            payload["AUTH_WHAM_COOLDOWN_PROBE_PROVIDER_ID"],
            "openai-codex"
        );
        assert_eq!(payload["PROVIDER_USAGE_LABELS"]["openai-codex"], "Codex");
        assert_eq!(payload["PROVIDER_USAGE_LABELS"]["zai"], "z.ai");
        assert_eq!(payload["PROVIDER_ATTRIBUTION_PRODUCT"], "CrawClaw");
        assert_eq!(payload["PROVIDER_ATTRIBUTION_ORIGINATOR"], "crawclaw");
        assert_eq!(
            payload["PROVIDER_ATTRIBUTION_REFERER_URL"],
            "https://docs.crawclaw.ai"
        );
        assert_eq!(
            payload["OPENROUTER_ATTRIBUTION_DOCS_URL"],
            "https://openrouter.ai/docs/app-attribution"
        );
        assert_eq!(payload["OPENROUTER_ATTRIBUTION_CATEGORY"], "cli-agent");
        assert_eq!(payload["OPENAI_COMPLETIONS_API"], "openai-completions");
        assert_eq!(payload["OPENAI_RESPONSES_API"], "openai-responses");
        assert_eq!(
            payload["OPENAI_CODEX_RESPONSES_API"],
            "openai-codex-responses"
        );
        assert_eq!(
            payload["OPENAI_AUDIO_TRANSCRIPTIONS_API"],
            "openai-audio-transcriptions"
        );
        assert_eq!(payload["ANTHROPIC_MESSAGES_API"], "anthropic-messages");
        assert!(payload["MODEL_COMPAT_THINKING_FORMATS"]
            .as_array()
            .unwrap()
            .contains(&serde_json::Value::String("qwen-chat-template".to_string())));
        assert_eq!(
            payload["MODEL_COMPAT_MAX_TOKENS_FIELDS"][0],
            "max_completion_tokens"
        );
        assert_eq!(payload["MINIMAX_VLM_MODEL_ID"], "MiniMax-VL-01");
        assert_eq!(payload["MINIMAX_API_HOST_ENV"], "MINIMAX_API_HOST");
        assert_eq!(
            payload["MINIMAX_DEFAULT_API_HOST"],
            "https://api.minimax.io"
        );
        assert_eq!(payload["MINIMAX_VLM_API_PATH"], "/v1/coding_plan/vlm");
        assert!(payload["LOCAL_ENDPOINT_HOSTS"]
            .as_array()
            .unwrap()
            .contains(&serde_json::Value::String("::1".to_string())));
        assert!(payload["MOONSHOT_NATIVE_BASE_URLS"]
            .as_array()
            .unwrap()
            .contains(&serde_json::Value::String(
                "https://api.moonshot.ai/v1".to_string()
            )));
        assert!(payload["MODELSTUDIO_NATIVE_BASE_URLS"]
            .as_array()
            .unwrap()
            .contains(&serde_json::Value::String(
                "https://dashscope.aliyuncs.com/compatible-mode/v1".to_string()
            )));
        assert_eq!(payload["OPENAI_RESPONSES_APIS"][0], "openai-responses");
        assert!(payload["OPENAI_RESPONSES_PROVIDERS"]
            .as_array()
            .unwrap()
            .contains(&serde_json::Value::String(
                "azure-openai-responses".to_string()
            )));
        assert_eq!(payload["MOONSHOT_COMPAT_PROVIDERS"][0], "moonshot");
        assert!(payload["TRANSCRIPT_OPENAI_MODEL_APIS"]
            .as_array()
            .unwrap()
            .contains(&serde_json::Value::String(
                "openai-codex-responses".to_string()
            )));
        assert!(payload["TRANSCRIPT_ANTHROPIC_MODEL_APIS"]
            .as_array()
            .unwrap()
            .contains(&serde_json::Value::String(
                "bedrock-converse-stream".to_string()
            )));
        assert_eq!(payload["GOOGLE_MODEL_APIS"][0], "google-gemini-cli");
        assert_eq!(
            payload["OPENAI_COMPATIBLE_TURN_VALIDATION_API"],
            "openai-completions"
        );
        assert!(payload["OPENAI_COMPATIBLE_TOOL_ID_SANITIZATION_APIS"]
            .as_array()
            .unwrap()
            .contains(&serde_json::Value::String(
                "azure-openai-responses".to_string()
            )));
        assert_eq!(
            payload["OPENROUTER_MODELS_API_URL"],
            "https://openrouter.ai/api/v1/models"
        );
        assert_eq!(payload["OPENROUTER_DEFAULT_MODEL_REF"], "openrouter/auto");
        assert_eq!(
            payload["MODEL_CATALOG_CONFIGURED_PROVIDER_IDS"][0],
            "deepseek"
        );
        assert_eq!(
            payload["OPENROUTER_PRICING_PROVIDER_ALIASES"]["openai-codex"],
            "openai"
        );
        assert_eq!(
            payload["OPENROUTER_PRICING_PROVIDER_ALIASES"]["zai"],
            "z-ai"
        );
        assert!(payload["OPENROUTER_WRAPPER_PROVIDERS"]
            .as_array()
            .unwrap()
            .contains(&serde_json::Value::String("vercel-ai-gateway".to_string())));
        assert_eq!(
            payload["KNOWN_PROVIDER_FAMILIES"]["openai-codex"],
            "openai-family"
        );
        assert_eq!(payload["KNOWN_PROVIDER_FAMILIES"]["kimi"], "moonshot");
        assert_eq!(
            payload["MISTRAL_SAFE_MAX_TOKENS_BY_MODEL"]["magistral-small"],
            40000
        );
        assert_eq!(payload["ANTHROPIC_VERTEX_DEFAULT_REGION"], "global");
        assert_eq!(payload["OLLAMA_DEFAULT_BASE_URL"], "http://127.0.0.1:11434");
        assert_eq!(payload["OLLAMA_DEFAULT_CONTEXT_WINDOW"], 128000);
        assert_eq!(payload["OPENAI_DEFAULT_MODEL"], "openai/gpt-5.4");
        assert_eq!(
            payload["GOOGLE_GEMINI_DEFAULT_MODEL"],
            "google/gemini-3.1-pro-preview"
        );
        assert_eq!(
            payload["OPENCODE_ZEN_DEFAULT_MODEL"],
            "opencode/claude-opus-4-6"
        );
        assert_eq!(
            payload["LEGACY_OPENCODE_ZEN_DEFAULT_MODELS"][0],
            "opencode/claude-opus-4-5"
        );
    }
}
