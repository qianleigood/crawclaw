mod types;
pub use types::*;
mod catalog;
pub use catalog::*;
mod models;
pub use models::*;

use serde_json::{json, Value};

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
    BUNDLED_PROVIDER_PLUGINS
        .iter()
        .map(bundled_provider_plugin_metadata_from_catalog)
        .collect()
}

pub fn bundled_provider_plugin_contract_metadata() -> Vec<BundledProviderPluginContractMetadata> {
    BUNDLED_PROVIDER_PLUGINS
        .iter()
        .map(bundled_provider_plugin_contract_metadata_from_catalog)
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
    BUNDLED_PROVIDER_PLUGINS
        .iter()
        .flat_map(bundled_provider_descriptors_from_catalog)
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

fn bundled_provider_plugin_metadata_from_catalog(
    plugin: &BundledProviderPlugin,
) -> BundledProviderPluginMetadata {
    let providers = plugin
        .providers
        .iter()
        .map(|provider| (*provider).to_string())
        .collect::<Vec<_>>();
    let chat = providers.iter().any(|provider| {
        NATIVE_PROVIDER_TRANSPORTS
            .iter()
            .any(|entry| entry.id == provider)
    });
    let image_generation = plugin.plugin_id == "fal";
    let media_understanding = matches!(plugin.plugin_id, "openai");
    BundledProviderPluginMetadata {
        plugin_id: plugin.plugin_id.to_string(),
        providers,
        auth_env_vars: bundled_provider_auth_env_vars_json(plugin.providers),
        auth_choices: bundled_provider_auth_choices_json(plugin.plugin_id),
        capabilities: BundledProviderPluginCapabilities {
            chat,
            non_chat: !chat,
            image_generation,
            media_understanding,
        },
    }
}

fn bundled_provider_plugin_contract_metadata_from_catalog(
    plugin: &BundledProviderPlugin,
) -> BundledProviderPluginContractMetadata {
    let override_entry = BUNDLED_PROVIDER_PLUGIN_CONTRACT_OVERRIDES
        .iter()
        .find(|entry| entry.plugin_id == plugin.plugin_id);
    BundledProviderPluginContractMetadata {
        plugin_id: plugin.plugin_id.to_string(),
        provider_ids: plugin
            .providers
            .iter()
            .map(|provider| (*provider).to_string())
            .collect(),
        legacy_plugin_ids: override_entry
            .map(|entry| entry.legacy_plugin_ids)
            .unwrap_or_default()
            .iter()
            .map(|value| (*value).to_string())
            .collect(),
        auto_enable_when_configured_providers: override_entry
            .map(|entry| entry.auto_enable_when_configured_providers)
            .unwrap_or_default()
            .iter()
            .map(|value| (*value).to_string())
            .collect(),
    }
}

fn bundled_provider_auth_env_vars_json(providers: &[&str]) -> Value {
    let entries = providers
        .iter()
        .filter_map(|provider| {
            bundled_provider_auth_env_vars_for(provider)
                .map(|env_vars| ((*provider).to_string(), json!(env_vars)))
        })
        .collect::<serde_json::Map<_, _>>();
    Value::Object(entries)
}

fn bundled_provider_auth_choices_json(plugin_id: &str) -> Value {
    BUNDLED_PROVIDER_PLUGIN_MANIFESTS
        .iter()
        .find(|(entry_plugin_id, _)| *entry_plugin_id == plugin_id)
        .and_then(|(_, raw)| serde_json::from_str::<Value>(raw).ok())
        .and_then(|manifest| manifest.get("providerAuthChoices").cloned())
        .unwrap_or_else(|| json!([]))
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

fn bundled_provider_descriptors_from_catalog(
    plugin: &BundledProviderPlugin,
) -> Vec<BundledProviderDescriptor> {
    let metadata = bundled_provider_plugin_metadata_from_catalog(plugin);
    let auth_methods = BUNDLED_PROVIDER_PLUGIN_MANIFESTS
        .iter()
        .find(|(plugin_id, _)| *plugin_id == plugin.plugin_id)
        .map(|(plugin_id, raw)| parse_bundled_provider_auth_choices(plugin_id, raw))
        .unwrap_or_default();
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
                kind: bundled_provider_kind(plugin.plugin_id, transport.is_some()),
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

mod transport;
pub(crate) use transport::non_empty;
pub use transport::*;
#[cfg(test)]
pub(crate) use transport::{
    is_implemented_native_provider_transport, openai_compatible_chat_completions_url,
};

#[cfg(test)]
mod tests;
