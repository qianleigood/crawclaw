use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ProviderTransport {
    pub id: &'static str,
    pub transport: &'static str,
    pub capabilities: ProviderTransportCapabilities,
}

#[derive(Clone, Copy, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ProviderTransportPreset {
    pub provider: &'static str,
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
    pub model_choices: Vec<String>,
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

#[derive(Clone, Copy, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BundledProviderModelChoices {
    pub provider: &'static str,
    pub models: &'static [&'static str],
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
