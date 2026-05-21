//! Desktop plugin read-model and catalog helpers.
//!
//! This crate does not host JavaScript plugin runtime behavior. It exposes the
//! Rust-native plugin and channel read models that desktop and maintainer
//! checks consume while runtime execution stays in the native plugin, channel,
//! provider, and Gateway crates.

use std::collections::BTreeSet;
use std::fs;
use std::path::Path;

use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct NativeChannelConfigField {
    pub id: &'static str,
    pub label: &'static str,
    pub secret: bool,
    pub default_value: &'static str,
}

#[derive(Clone, Copy, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct NativeChannelDefinition {
    pub id: &'static str,
    pub label: &'static str,
    pub description: &'static str,
    pub icon: &'static str,
    pub fields: &'static [NativeChannelConfigField],
}

const FEISHU_FIELDS: &[NativeChannelConfigField] = &[
    channel_field("appId", "App ID", false, ""),
    channel_field("appSecret", "App Secret", true, ""),
    channel_field("verificationToken", "Verification Token", true, ""),
    channel_field("encryptKey", "Encrypt Key", true, ""),
];

const DDINGTALK_FIELDS: &[NativeChannelConfigField] = &[
    channel_field("clientId", "Client ID", false, ""),
    channel_field("clientSecret", "Client Secret", true, ""),
];

const ESP32_FIELDS: &[NativeChannelConfigField] = &[
    channel_field("brokerMode", "Broker Mode", false, "managed"),
    channel_field("bindHost", "Bind Host", false, "127.0.0.1"),
    channel_field("advertisedHost", "Advertised Host", false, ""),
    channel_field("port", "Port", false, "1883"),
    channel_field("udpPort", "UDP Port", false, "1884"),
    channel_field("otaPath", "OTA Path", false, "/api/esp32/ota"),
    channel_field("wakeWord", "Wake Word", false, "true"),
];

const QQBOT_FIELDS: &[NativeChannelConfigField] = &[
    channel_field("appId", "App ID", false, ""),
    channel_field("clientSecret", "Client Secret", true, ""),
    channel_field("markdownSupport", "Markdown 支持", false, "true"),
];

const NATIVE_CHANNELS: &[NativeChannelDefinition] = &[
    NativeChannelDefinition {
        id: "ddingtalk",
        label: "钉钉",
        description: "Rust-native DingTalk channel control-plane and configuration surface.",
        icon: "messageCircle",
        fields: DDINGTALK_FIELDS,
    },
    NativeChannelDefinition {
        id: "feishu",
        label: "飞书",
        description: "Rust-native Feishu/Lark channel control-plane and configuration surface.",
        icon: "messageCircle",
        fields: FEISHU_FIELDS,
    },
    NativeChannelDefinition {
        id: "esp32",
        label: "ESP32",
        description: "Rust-native ESP32-S3-BOX-3 device channel control-plane and pairing surface.",
        icon: "cpu",
        fields: ESP32_FIELDS,
    },
    NativeChannelDefinition {
        id: "qqbot",
        label: "QQ Bot",
        description: "Rust-native QQ Bot channel control-plane and configuration surface.",
        icon: "messageCircle",
        fields: QQBOT_FIELDS,
    },
    NativeChannelDefinition {
        id: "weixin",
        label: "微信",
        description: "Rust-native Weixin QR-login channel control-plane and configuration surface.",
        icon: "messageCircle",
        fields: &[],
    },
];

const fn channel_field(
    id: &'static str,
    label: &'static str,
    secret: bool,
    default_value: &'static str,
) -> NativeChannelConfigField {
    NativeChannelConfigField {
        id,
        label,
        secret,
        default_value,
    }
}

pub fn native_channels() -> &'static [NativeChannelDefinition] {
    NATIVE_CHANNELS
}

pub fn native_channel_ids() -> Vec<&'static str> {
    NATIVE_CHANNELS.iter().map(|channel| channel.id).collect()
}

pub fn native_channel(id: &str) -> Option<&'static NativeChannelDefinition> {
    NATIVE_CHANNELS.iter().find(|channel| channel.id == id)
}

pub fn is_native_channel_id(id: &str) -> bool {
    native_channel(id).is_some()
}

pub fn is_desktop_or_native_channel_id(id: &str) -> bool {
    id == "desktop" || is_native_channel_id(id)
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PluginHostCapability {
    pub manifest_read_model: bool,
    pub rust_or_wasm_entry_required: bool,
}

pub fn phase_three_capability() -> PluginHostCapability {
    PluginHostCapability {
        manifest_read_model: true,
        rust_or_wasm_entry_required: true,
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub struct PluginManifestReadModel {
    #[serde(default)]
    pub tools: Vec<PluginHostTool>,
    #[serde(default)]
    pub skills: Vec<PluginHostSkill>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PluginHostTool {
    pub id: String,
    pub name: String,
    pub description: String,
    pub status: String,
    pub permission: String,
    pub icon: String,
    #[serde(default)]
    pub open: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PluginHostSkill {
    pub id: String,
    pub name: String,
    pub trigger: String,
    pub description: String,
    pub status: String,
    pub source: String,
    pub icon: String,
    #[serde(default)]
    pub open: bool,
}

fn first_batch_rust_native_tools() -> Vec<PluginHostTool> {
    vec![
        PluginHostTool {
            id: "comfyui_workflow".to_string(),
            name: "ComfyUI Workflow".to_string(),
            description:
                "Inspect, validate, and run local ComfyUI workflows through the Rust runtime."
                    .to_string(),
            status: "available".to_string(),
            permission: "requiresApproval".to_string(),
            icon: "image".to_string(),
            open: false,
        },
        PluginHostTool {
            id: "searxng_search".to_string(),
            name: "SearXNG Search".to_string(),
            description: "Search a SearXNG endpoint through the Rust native runtime.".to_string(),
            status: "available".to_string(),
            permission: "network".to_string(),
            icon: "search".to_string(),
            open: false,
        },
        PluginHostTool {
            id: "spider_fetch".to_string(),
            name: "Spider Fetch".to_string(),
            description:
                "Fetch static and browser-rendered web content through the Rust native runtime."
                    .to_string(),
            status: "available".to_string(),
            permission: "network".to_string(),
            icon: "search".to_string(),
            open: false,
        },
        PluginHostTool {
            id: "qwen3_tts_build_payload".to_string(),
            name: "Qwen3-TTS Payload".to_string(),
            description:
                "Prepare local Qwen3-TTS synthesis payloads through the Rust native runtime."
                    .to_string(),
            status: "available".to_string(),
            permission: "local".to_string(),
            icon: "wrench".to_string(),
            open: false,
        },
        PluginHostTool {
            id: "qwen3_tts_synthesize".to_string(),
            name: "Qwen3-TTS Synthesize".to_string(),
            description: "Synthesize speech through the local Qwen3-TTS native path.".to_string(),
            status: "available".to_string(),
            permission: "local".to_string(),
            icon: "wrench".to_string(),
            open: false,
        },
    ]
}

fn first_batch_rust_native_skills() -> Vec<PluginHostSkill> {
    vec![PluginHostSkill {
        id: "open-prose-prose".to_string(),
        name: "OpenProse".to_string(),
        trigger: "@prose".to_string(),
        description: "OpenProse VM skill pack for orchestrated multi-agent workflows.".to_string(),
        status: "enabled".to_string(),
        source: "rust-native".to_string(),
        icon: "sparkles".to_string(),
        open: false,
    }]
}

fn merge_unique_tool(tools: &mut Vec<PluginHostTool>, tool: PluginHostTool) {
    if !tools.iter().any(|existing| existing.id == tool.id) {
        tools.push(tool);
    }
}

fn merge_unique_skill(skills: &mut Vec<PluginHostSkill>, skill: PluginHostSkill) {
    if !skills
        .iter()
        .any(|existing| existing.id == skill.id || existing.trigger == skill.trigger)
    {
        skills.push(skill);
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
struct PluginHostUiState {
    #[serde(default)]
    open_tools: BTreeSet<String>,
    #[serde(default)]
    open_skills: BTreeSet<String>,
}

#[derive(Debug, PartialEq, Eq)]
pub enum PluginHostError {
    Io(String),
    Invalid(String),
}

impl std::fmt::Display for PluginHostError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Io(message) | Self::Invalid(message) => formatter.write_str(message),
        }
    }
}

impl std::error::Error for PluginHostError {}

pub fn load_plugin_manifest(
    runtime_root: &Path,
) -> Result<PluginManifestReadModel, PluginHostError> {
    let manifest_path = runtime_root.join("plugins").join("manifest.json");
    let mut read_model = match fs::read_to_string(&manifest_path) {
        Ok(raw) => serde_json::from_str(&raw).map_err(|error| {
            PluginHostError::Invalid(format!("Invalid desktop plugin manifest: {error}"))
        })?,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            PluginManifestReadModel::default()
        }
        Err(error) => {
            return Err(PluginHostError::Io(format!(
                "Failed to read desktop plugin manifest: {error}"
            )));
        }
    };
    for tool in first_batch_rust_native_tools() {
        merge_unique_tool(&mut read_model.tools, tool);
    }
    for skill in first_batch_rust_native_skills() {
        merge_unique_skill(&mut read_model.skills, skill);
    }
    for custom_skill in load_custom_plugin_skills(runtime_root)? {
        merge_unique_skill(&mut read_model.skills, custom_skill);
    }
    let ui_state = load_plugin_ui_state(runtime_root)?;
    for tool in &mut read_model.tools {
        tool.open = ui_state.open_tools.contains(&tool.id);
    }
    for skill in &mut read_model.skills {
        skill.open = ui_state.open_skills.contains(&skill.id);
    }
    Ok(read_model)
}

pub fn toggle_plugin_tool_open(
    runtime_root: &Path,
    tool_id: &str,
) -> Result<bool, PluginHostError> {
    let mut ui_state = load_plugin_ui_state(runtime_root)?;
    let open = toggle_set_value(&mut ui_state.open_tools, tool_id);
    save_plugin_ui_state(runtime_root, &ui_state)?;
    Ok(open)
}

pub fn add_custom_plugin_skill(
    runtime_root: &Path,
    skill: PluginHostSkill,
) -> Result<PluginHostSkill, PluginHostError> {
    let mut skills = load_custom_plugin_skills(runtime_root)?;
    if let Some(existing) = skills
        .iter_mut()
        .find(|existing| existing.id == skill.id || existing.trigger == skill.trigger)
    {
        *existing = skill.clone();
    } else {
        skills.push(skill.clone());
    }
    save_custom_plugin_skills(runtime_root, &skills)?;
    Ok(skill)
}

pub fn toggle_plugin_skill_open(
    runtime_root: &Path,
    skill_id: &str,
) -> Result<bool, PluginHostError> {
    let mut ui_state = load_plugin_ui_state(runtime_root)?;
    let open = toggle_set_value(&mut ui_state.open_skills, skill_id);
    save_plugin_ui_state(runtime_root, &ui_state)?;
    Ok(open)
}

fn load_plugin_ui_state(runtime_root: &Path) -> Result<PluginHostUiState, PluginHostError> {
    let state_path = plugin_ui_state_path(runtime_root);
    let raw = match fs::read_to_string(&state_path) {
        Ok(raw) => raw,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok(PluginHostUiState::default());
        }
        Err(error) => {
            return Err(PluginHostError::Io(format!(
                "Failed to read desktop plugin UI state: {error}"
            )));
        }
    };
    serde_json::from_str(&raw).map_err(|error| {
        PluginHostError::Invalid(format!("Invalid desktop plugin UI state: {error}"))
    })
}

fn save_plugin_ui_state(
    runtime_root: &Path,
    ui_state: &PluginHostUiState,
) -> Result<(), PluginHostError> {
    let state_path = plugin_ui_state_path(runtime_root);
    if let Some(parent) = state_path.parent() {
        fs::create_dir_all(parent).map_err(|error| {
            PluginHostError::Io(format!(
                "Failed to create desktop plugin UI state directory: {error}"
            ))
        })?;
    }
    let raw = serde_json::to_string_pretty(ui_state).map_err(|error| {
        PluginHostError::Invalid(format!(
            "Failed to serialize desktop plugin UI state: {error}"
        ))
    })?;
    fs::write(&state_path, raw).map_err(|error| {
        PluginHostError::Io(format!("Failed to write desktop plugin UI state: {error}"))
    })
}

fn plugin_ui_state_path(runtime_root: &Path) -> std::path::PathBuf {
    runtime_root
        .join("plugins")
        .join("desktop-plugin-state.json")
}

fn load_custom_plugin_skills(runtime_root: &Path) -> Result<Vec<PluginHostSkill>, PluginHostError> {
    let path = custom_plugin_skills_path(runtime_root);
    let raw = match fs::read_to_string(&path) {
        Ok(raw) => raw,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(error) => {
            return Err(PluginHostError::Io(format!(
                "Failed to read desktop custom plugin skills: {error}"
            )));
        }
    };
    serde_json::from_str(&raw).map_err(|error| {
        PluginHostError::Invalid(format!("Invalid desktop custom plugin skills: {error}"))
    })
}

fn save_custom_plugin_skills(
    runtime_root: &Path,
    skills: &[PluginHostSkill],
) -> Result<(), PluginHostError> {
    let path = custom_plugin_skills_path(runtime_root);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| {
            PluginHostError::Io(format!(
                "Failed to create desktop custom plugin skills directory: {error}"
            ))
        })?;
    }
    let raw = serde_json::to_vec_pretty(skills).map_err(|error| {
        PluginHostError::Invalid(format!(
            "Failed to serialize desktop custom plugin skills: {error}"
        ))
    })?;
    fs::write(&path, raw).map_err(|error| {
        PluginHostError::Io(format!(
            "Failed to write desktop custom plugin skills: {error}"
        ))
    })
}

fn custom_plugin_skills_path(runtime_root: &Path) -> std::path::PathBuf {
    runtime_root
        .join("plugins")
        .join("desktop-custom-skills.json")
}

fn toggle_set_value(values: &mut BTreeSet<String>, value: &str) -> bool {
    if values.remove(value) {
        false
    } else {
        values.insert(value.to_string());
        true
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    #[test]
    fn native_channel_catalog_covers_bundled_native_channels() {
        assert_eq!(
            native_channel_ids(),
            vec!["ddingtalk", "feishu", "esp32", "qqbot", "weixin"]
        );
        assert!(!is_native_channel_id("dingtalk"));
        assert!(!is_native_channel_id("discord"));
        assert!(!is_native_channel_id("telegram"));
    }

    #[test]
    fn native_channel_catalog_exposes_rust_config_fields() {
        let feishu = native_channel("feishu").expect("feishu channel");
        assert_eq!(feishu.label, "飞书");
        assert_eq!(
            feishu
                .fields
                .iter()
                .map(|field| field.id)
                .collect::<Vec<_>>(),
            vec!["appId", "appSecret", "verificationToken", "encryptKey"]
        );

        let ddingtalk = native_channel("ddingtalk").expect("ddingtalk channel");
        assert_eq!(ddingtalk.label, "钉钉");
        assert_eq!(
            ddingtalk
                .fields
                .iter()
                .map(|field| field.id)
                .collect::<Vec<_>>(),
            vec!["clientId", "clientSecret"]
        );

        let weixin = native_channel("weixin").expect("weixin channel");
        assert_eq!(weixin.label, "微信");
        assert!(weixin.fields.is_empty());

        let esp32 = native_channel("esp32").expect("esp32 channel");
        assert_eq!(esp32.label, "ESP32");
        assert_eq!(esp32.icon, "cpu");
        assert_eq!(
            esp32
                .fields
                .iter()
                .map(|field| field.id)
                .collect::<Vec<_>>(),
            vec![
                "brokerMode",
                "bindHost",
                "advertisedHost",
                "port",
                "udpPort",
                "otaPath",
                "wakeWord"
            ]
        );
    }

    #[test]
    fn plugin_host_capability_requires_native_plugin_entries_by_default() {
        let capability = phase_three_capability();

        assert!(capability.manifest_read_model);
        assert!(capability.rust_or_wasm_entry_required);
    }

    #[test]
    fn plugin_manifest_includes_first_batch_rust_native_plugins() {
        let runtime_root = unique_runtime_root("native-plugin-read-model");
        let read_model = load_plugin_manifest(&runtime_root).expect("plugin manifest");

        assert!(read_model
            .tools
            .iter()
            .any(|tool| tool.id == "comfyui_workflow" && tool.name == "ComfyUI Workflow"));
        assert!(read_model
            .tools
            .iter()
            .any(|tool| tool.id == "searxng_search" && tool.name == "SearXNG Search"));
        assert!(read_model
            .tools
            .iter()
            .any(|tool| tool.id == "spider_fetch" && tool.name == "Spider Fetch"));
        assert!(read_model
            .tools
            .iter()
            .any(|tool| tool.id == "qwen3_tts_build_payload" && tool.name == "Qwen3-TTS Payload"));
        assert!(read_model
            .tools
            .iter()
            .any(|tool| tool.id == "qwen3_tts_synthesize" && tool.name == "Qwen3-TTS Synthesize"));
        assert!(read_model
            .skills
            .iter()
            .any(|skill| skill.id == "open-prose-prose" && skill.trigger == "@prose"));
    }

    fn unique_runtime_root(name: &str) -> PathBuf {
        let unique = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("clock")
            .as_nanos();
        std::env::temp_dir().join(format!(
            "crawclaw-plugin-host-test-{}-{}-{unique}",
            std::process::id(),
            name
        ))
    }
}
