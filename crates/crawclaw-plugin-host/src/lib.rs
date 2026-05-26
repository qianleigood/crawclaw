//! Desktop plugin read-model and catalog helpers.
//!
//! This crate does not host JavaScript plugin runtime behavior. It exposes the
//! Rust-native plugin read model that desktop and maintainer checks consume
//! while runtime execution stays in the native plugin, channel, provider, and
//! Gateway crates.

use std::collections::BTreeSet;
use std::fs;
use std::path::Path;

use serde::{Deserialize, Serialize};

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

const CORE_SKILL_MARKER_FILE: &str = ".crawclaw-core-skill.json";

fn default_true() -> bool {
    true
}

fn default_plugin_id() -> String {
    "core".to_string()
}

fn default_source() -> String {
    "manifest".to_string()
}

fn default_install_status() -> String {
    "installed".to_string()
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub struct PluginManifestReadModel {
    #[serde(default)]
    pub tools: Vec<PluginHostTool>,
    #[serde(default)]
    pub skills: Vec<PluginHostSkill>,
    #[serde(default)]
    pub installed: Vec<PluginHostInstalledPlugin>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PluginHostTool {
    pub id: String,
    #[serde(default = "default_plugin_id")]
    pub plugin_id: String,
    pub name: String,
    pub description: String,
    pub status: String,
    pub permission: String,
    pub icon: String,
    #[serde(default = "default_true")]
    pub enabled: bool,
    #[serde(default = "default_source")]
    pub source: String,
    #[serde(default = "default_install_status")]
    pub install_status: String,
    #[serde(default)]
    pub open: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PluginHostSkill {
    pub id: String,
    #[serde(default)]
    pub skill_key: String,
    pub name: String,
    pub trigger: String,
    pub description: String,
    pub status: String,
    pub source: String,
    pub icon: String,
    #[serde(default = "default_true")]
    pub enabled: bool,
    #[serde(default = "default_install_status")]
    pub install_status: String,
    #[serde(default)]
    pub open: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PluginHostInstalledPlugin {
    pub id: String,
    pub name: String,
    pub status: String,
    pub source: String,
    pub install_status: String,
    pub enabled: bool,
    pub version: Option<String>,
    pub manifest_path: Option<String>,
    #[serde(default)]
    pub open: bool,
}

fn first_batch_rust_native_tools() -> Vec<PluginHostTool> {
    vec![
        PluginHostTool {
            id: "comfyui_workflow".to_string(),
            plugin_id: "comfyui".to_string(),
            name: "ComfyUI Workflow".to_string(),
            description:
                "检查、验证并运行本机 ComfyUI 工作流，用于 AI 生图和自动化出图任务。"
                    .to_string(),
            status: "available".to_string(),
            permission: "requiresApproval".to_string(),
            icon: "image".to_string(),
            enabled: true,
            source: "rust-native".to_string(),
            install_status: "available".to_string(),
            open: false,
        },
        PluginHostTool {
            id: "searxng_search".to_string(),
            plugin_id: "searxng".to_string(),
            name: "SearXNG Search".to_string(),
            description: "通过 SearXNG 搜索端点获取联网检索结果，用于公开网页信息查找。"
                .to_string(),
            status: "available".to_string(),
            permission: "network".to_string(),
            icon: "search".to_string(),
            enabled: true,
            source: "rust-native".to_string(),
            install_status: "available".to_string(),
            open: false,
        },
        PluginHostTool {
            id: "spider_fetch".to_string(),
            plugin_id: "spider-fetch".to_string(),
            name: "Spider Fetch".to_string(),
            description:
                "抓取静态或浏览器渲染后的网页内容，用于读取页面正文和结构化资料。"
                    .to_string(),
            status: "available".to_string(),
            permission: "network".to_string(),
            icon: "search".to_string(),
            enabled: true,
            source: "rust-native".to_string(),
            install_status: "available".to_string(),
            open: false,
        },
        PluginHostTool {
            id: "qwen3_tts_build_payload".to_string(),
            plugin_id: "qwen3-tts".to_string(),
            name: "Qwen3-TTS Payload".to_string(),
            description:
                "整理 Qwen3-TTS 本地语音合成请求，把文本和声音参数转换成可执行载荷。"
                    .to_string(),
            status: "available".to_string(),
            permission: "local".to_string(),
            icon: "wrench".to_string(),
            enabled: true,
            source: "rust-native".to_string(),
            install_status: "available".to_string(),
            open: false,
        },
        PluginHostTool {
            id: "qwen3_tts_synthesize".to_string(),
            plugin_id: "qwen3-tts".to_string(),
            name: "Qwen3-TTS Synthesize".to_string(),
            description: "调用本机 Qwen3-TTS 运行时合成语音，适合本地配音和语音预览。"
                .to_string(),
            status: "available".to_string(),
            permission: "local".to_string(),
            icon: "wrench".to_string(),
            enabled: true,
            source: "rust-native".to_string(),
            install_status: "available".to_string(),
            open: false,
        },
    ]
}

fn runtime_core_tools() -> Vec<PluginHostTool> {
    crawclaw_runtime::rust_core_tool_definitions()
        .iter()
        .map(|tool| PluginHostTool {
            id: tool.id.to_string(),
            plugin_id: "crawclaw-runtime".to_string(),
            name: tool.label.to_string(),
            description: tool.description.to_string(),
            status: "available".to_string(),
            permission: runtime_core_tool_permission(tool).to_string(),
            icon: runtime_core_tool_icon(tool).to_string(),
            enabled: true,
            source: "rust-native".to_string(),
            install_status: "available".to_string(),
            open: false,
        })
        .collect()
}

fn runtime_native_plugin_tools(runtime_root: &Path) -> Vec<PluginHostTool> {
    crawclaw_runtime::native_plugin_tool_descriptors_for_runtime_root(runtime_root)
        .into_iter()
        .map(|(plugin_id, tool)| {
            let permission = native_plugin_tool_permission(&plugin_id, tool.read_only, tool.approval.is_some());
            PluginHostTool {
                id: tool.name,
                plugin_id: plugin_id.clone(),
                name: tool.label,
                description: tool.description,
                status: "available".to_string(),
                permission: permission.to_string(),
                icon: native_plugin_tool_icon(&plugin_id).to_string(),
                enabled: true,
                source: "rust-native".to_string(),
                install_status: "available".to_string(),
                open: false,
            }
        })
        .collect()
}

fn runtime_core_tool_permission(tool: &crawclaw_runtime::RustCoreToolDefinition) -> &'static str {
    if tool.read_only {
        return "只读";
    }
    match tool.section_id {
        "fs" | "memory" | "session_summary" => "workspace",
        "runtime" => "command",
        "messaging" | "automation" | "workflow" | "sessions" => "highRisk",
        "ui" => "externalApp",
        _ => "local",
    }
}

fn runtime_core_tool_icon(tool: &crawclaw_runtime::RustCoreToolDefinition) -> &'static str {
    match tool.section_id {
        "fs" | "session_summary" => "fileText",
        "runtime" => "wrench",
        "web" => "search",
        "sessions" => "messageCircle",
        "messaging" => "messageCircle",
        "automation" => "clock3",
        "skills" => "sparkles",
        "workflow" => "blocks",
        "memory" => "brain",
        "media" if tool.id == "image" => "image",
        "media" => "fileText",
        _ => "wrench",
    }
}

fn native_plugin_tool_permission(
    plugin_id: &str,
    read_only: bool,
    requires_approval: bool,
) -> &'static str {
    if read_only {
        return "只读";
    }
    if requires_approval {
        return "requiresApproval";
    }
    match plugin_id {
        "browser" => "externalApp",
        "lobster" | "llm-task" => "highRisk",
        _ => "local",
    }
}

fn native_plugin_tool_icon(plugin_id: &str) -> &'static str {
    match plugin_id {
        "browser" => "search",
        "comfyui" | "minimax-mcp" => "image",
        "lobster" | "llm-task" => "blocks",
        _ => "wrench",
    }
}

fn first_batch_rust_native_skills() -> Vec<PluginHostSkill> {
    vec![PluginHostSkill {
        id: "open-prose-prose".to_string(),
        skill_key: "prose".to_string(),
        name: "OpenProse".to_string(),
        trigger: "@prose".to_string(),
        description: "OpenProse VM skill pack for orchestrated multi-agent workflows.".to_string(),
        status: "enabled".to_string(),
        source: "rust-native".to_string(),
        icon: "sparkles".to_string(),
        enabled: true,
        install_status: "available".to_string(),
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
    #[serde(default)]
    open_plugins: BTreeSet<String>,
    #[serde(default)]
    disabled_tools: BTreeSet<String>,
    #[serde(default)]
    disabled_skills: BTreeSet<String>,
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
    for tool in runtime_core_tools() {
        merge_unique_tool(&mut read_model.tools, tool);
    }
    for tool in first_batch_rust_native_tools() {
        merge_unique_tool(&mut read_model.tools, tool);
    }
    for tool in runtime_native_plugin_tools(runtime_root) {
        merge_unique_tool(&mut read_model.tools, tool);
    }
    for skill in first_batch_rust_native_skills() {
        merge_unique_skill(&mut read_model.skills, skill);
    }
    for skill in load_runtime_skills(runtime_root)? {
        merge_unique_skill(&mut read_model.skills, skill);
    }
    for custom_skill in load_custom_plugin_skills(runtime_root)? {
        merge_unique_skill(&mut read_model.skills, custom_skill);
    }
    read_model.installed = load_installed_plugins(runtime_root)?;
    let ui_state = load_plugin_ui_state(runtime_root)?;
    for tool in &mut read_model.tools {
        if tool.plugin_id.trim().is_empty() {
            tool.plugin_id = default_plugin_id();
        }
        if tool.source.trim().is_empty() {
            tool.source = default_source();
        }
        if tool.install_status.trim().is_empty() {
            tool.install_status = default_install_status();
        }
        if ui_state.open_tools.contains(&tool.id) {
            tool.open = true;
        }
        if ui_state.disabled_tools.contains(&tool.id) {
            tool.enabled = false;
        }
    }
    for skill in &mut read_model.skills {
        if skill.skill_key.trim().is_empty() {
            skill.skill_key = skill_key_from_trigger_or_name(&skill.trigger, &skill.name);
        }
        if skill.install_status.trim().is_empty() {
            skill.install_status = default_install_status();
        }
        if ui_state.open_skills.contains(&skill.id) {
            skill.open = true;
        }
        if ui_state.disabled_skills.contains(&skill.id) {
            skill.enabled = false;
        }
    }
    for installed in &mut read_model.installed {
        installed.open = ui_state.open_plugins.contains(&installed.id);
    }
    Ok(read_model)
}

pub fn sync_core_skills(
    runtime_root: &Path,
    source_skills_root: &Path,
) -> Result<Vec<PluginHostSkill>, PluginHostError> {
    let mut synced = Vec::new();
    let entries = match fs::read_dir(source_skills_root) {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(error) => {
            return Err(PluginHostError::Io(format!(
                "Failed to read core skills: {error}"
            )));
        }
    };
    for entry in entries.flatten() {
        let source_dir = entry.path();
        if !source_dir.is_dir() {
            continue;
        }
        let Some(skill_key) = source_dir
            .file_name()
            .and_then(|value| value.to_str())
            .map(ToOwned::to_owned)
        else {
            continue;
        };
        let source_skill = source_dir.join("SKILL.md");
        if !source_skill.exists() {
            continue;
        }
        let target_dir = runtime_root.join("skills").join(&skill_key);
        let target_skill = target_dir.join("SKILL.md");
        let target_marker = target_dir.join(CORE_SKILL_MARKER_FILE);
        if target_skill.exists() && !target_marker.exists() {
            if let Some(skill) = skill_from_path(&target_skill, &skill_key, "custom")? {
                synced.push(skill);
            }
            continue;
        }
        fs::create_dir_all(&target_dir).map_err(|error| {
            PluginHostError::Io(format!(
                "Failed to create core skill directory {}: {error}",
                target_dir.display()
            ))
        })?;
        fs::copy(&source_skill, &target_skill).map_err(|error| {
            PluginHostError::Io(format!(
                "Failed to sync core skill {}: {error}",
                source_skill.display()
            ))
        })?;
        let marker = serde_json::to_vec_pretty(&serde_json::json!({
            "source": "core",
            "skillKey": skill_key
        }))
        .map_err(|error| PluginHostError::Invalid(error.to_string()))?;
        fs::write(&target_marker, marker).map_err(|error| {
            PluginHostError::Io(format!(
                "Failed to write core skill marker {}: {error}",
                target_marker.display()
            ))
        })?;
        if let Some(skill) = skill_from_path(&target_skill, &skill_key, "core")? {
            synced.push(skill);
        }
    }
    Ok(synced)
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

pub fn toggle_plugin_installed_open(
    runtime_root: &Path,
    plugin_id: &str,
) -> Result<bool, PluginHostError> {
    let mut ui_state = load_plugin_ui_state(runtime_root)?;
    let open = toggle_set_value(&mut ui_state.open_plugins, plugin_id);
    save_plugin_ui_state(runtime_root, &ui_state)?;
    Ok(open)
}

pub fn set_plugin_tool_enabled(
    runtime_root: &Path,
    tool_id: &str,
    enabled: bool,
) -> Result<bool, PluginHostError> {
    let mut ui_state = load_plugin_ui_state(runtime_root)?;
    if enabled {
        ui_state.disabled_tools.remove(tool_id);
    } else {
        ui_state.disabled_tools.insert(tool_id.to_string());
    }
    save_plugin_ui_state(runtime_root, &ui_state)?;
    Ok(enabled)
}

pub fn set_plugin_skill_enabled(
    runtime_root: &Path,
    skill_id: &str,
    enabled: bool,
) -> Result<bool, PluginHostError> {
    let mut ui_state = load_plugin_ui_state(runtime_root)?;
    if enabled {
        ui_state.disabled_skills.remove(skill_id);
    } else {
        ui_state.disabled_skills.insert(skill_id.to_string());
    }
    save_plugin_ui_state(runtime_root, &ui_state)?;
    Ok(enabled)
}

pub fn remove_plugin_skill_state(
    runtime_root: &Path,
    skill_id: &str,
) -> Result<(), PluginHostError> {
    let mut ui_state = load_plugin_ui_state(runtime_root)?;
    ui_state.disabled_skills.remove(skill_id);
    ui_state.open_skills.remove(skill_id);
    save_plugin_ui_state(runtime_root, &ui_state)
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

fn load_runtime_skills(runtime_root: &Path) -> Result<Vec<PluginHostSkill>, PluginHostError> {
    let skills_root = runtime_root.join("skills");
    let entries = match fs::read_dir(&skills_root) {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(error) => {
            return Err(PluginHostError::Io(format!(
                "Failed to read runtime skills: {error}"
            )));
        }
    };
    let mut skills = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let Some(skill_key) = path
            .file_name()
            .and_then(|value| value.to_str())
            .map(ToOwned::to_owned)
        else {
            continue;
        };
        let source = if path.join(CORE_SKILL_MARKER_FILE).exists() {
            "core"
        } else {
            "custom"
        };
        if let Some(skill) = skill_from_path(&path.join("SKILL.md"), &skill_key, source)? {
            skills.push(skill);
        }
    }
    Ok(skills)
}

fn skill_from_path(
    skill_path: &Path,
    skill_key: &str,
    source: &str,
) -> Result<Option<PluginHostSkill>, PluginHostError> {
    let raw = match fs::read_to_string(skill_path) {
        Ok(raw) => raw,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => {
            return Err(PluginHostError::Io(format!(
                "Failed to read skill {}: {error}",
                skill_path.display()
            )));
        }
    };
    let name = frontmatter_field(&raw, "name").unwrap_or_else(|| skill_key.to_string());
    let description = frontmatter_field(&raw, "description")
        .or_else(|| first_markdown_heading(&raw))
        .unwrap_or_default();
    Ok(Some(PluginHostSkill {
        id: format!("{source}-skill-{skill_key}"),
        skill_key: skill_key.to_string(),
        trigger: format!("@{}", skill_key.replace('_', "-")),
        name,
        description,
        status: "已启用".to_string(),
        source: source.to_string(),
        icon: "sparkles".to_string(),
        enabled: true,
        install_status: "installed".to_string(),
        open: false,
    }))
}

fn frontmatter_field(raw: &str, key: &str) -> Option<String> {
    let mut lines = raw.lines();
    if lines.next()? != "---" {
        return None;
    }
    let prefix = format!("{key}:");
    for line in lines {
        if line == "---" {
            return None;
        }
        let trimmed = line.trim();
        if let Some(value) = trimmed.strip_prefix(&prefix) {
            return Some(value.trim().trim_matches('"').trim_matches('\'').to_string())
                .filter(|value| !value.is_empty());
        }
    }
    None
}

fn first_markdown_heading(raw: &str) -> Option<String> {
    raw.lines()
        .find_map(|line| line.trim().strip_prefix("# ").map(str::trim))
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
}

fn skill_key_from_trigger_or_name(trigger: &str, name: &str) -> String {
    let candidate = trigger
        .trim()
        .strip_prefix('@')
        .filter(|value| !value.is_empty())
        .unwrap_or(name.trim());
    candidate
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() {
                ch.to_ascii_lowercase()
            } else {
                '-'
            }
        })
        .collect::<String>()
        .split('-')
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join("-")
}

fn load_installed_plugins(
    runtime_root: &Path,
) -> Result<Vec<PluginHostInstalledPlugin>, PluginHostError> {
    let plugins_root = runtime_root.join("plugins");
    let config = read_runtime_config(runtime_root);
    let entries = match fs::read_dir(&plugins_root) {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(error) => {
            return Err(PluginHostError::Io(format!(
                "Failed to read installed plugins: {error}"
            )));
        }
    };
    let mut installed = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let manifest_path = path.join("crawclaw.plugin.json");
        if !manifest_path.exists() {
            continue;
        }
        let manifest = fs::read_to_string(&manifest_path)
            .ok()
            .and_then(|raw| serde_json::from_str::<serde_json::Value>(&raw).ok())
            .unwrap_or_else(|| serde_json::json!({}));
        let id = manifest
            .get("id")
            .and_then(serde_json::Value::as_str)
            .map(ToOwned::to_owned)
            .or_else(|| {
                path.file_name()
                    .and_then(|value| value.to_str())
                    .map(ToOwned::to_owned)
            })
            .unwrap_or_else(|| "plugin".to_string());
        let name = manifest
            .get("name")
            .and_then(serde_json::Value::as_str)
            .unwrap_or(&id)
            .to_string();
        let version = manifest
            .get("version")
            .and_then(serde_json::Value::as_str)
            .map(ToOwned::to_owned);
        let enabled = config
            .as_ref()
            .and_then(|config| installed_plugin_enabled(config, &id))
            .unwrap_or(true);
        installed.push(PluginHostInstalledPlugin {
            id,
            name,
            version,
            status: "installed".to_string(),
            source: "installed".to_string(),
            install_status: "installed".to_string(),
            enabled,
            manifest_path: Some(manifest_path.to_string_lossy().to_string()),
            open: false,
        });
    }
    installed.sort_by(|left, right| left.id.cmp(&right.id));
    Ok(installed)
}

fn read_runtime_config(runtime_root: &Path) -> Option<serde_json::Value> {
    fs::read_to_string(runtime_root.join("config").join("crawclaw.json"))
        .ok()
        .and_then(|raw| serde_json::from_str(&raw).ok())
}

fn installed_plugin_enabled(config: &serde_json::Value, plugin_id: &str) -> Option<bool> {
    config
        .get("plugins")?
        .get("entries")?
        .get(plugin_id)?
        .get("enabled")?
        .as_bool()
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
            .any(|tool| tool.plugin_id == "crawclaw-runtime" && tool.id == "read"));
        assert!(read_model
            .tools
            .iter()
            .any(|tool| tool.plugin_id == "crawclaw-runtime" && tool.id == "bash"));
        assert!(read_model
            .tools
            .iter()
            .any(|tool| tool.plugin_id == "browser" && tool.id == "browser"));
        assert!(read_model
            .tools
            .iter()
            .any(|tool| tool.plugin_id == "llm-task" && tool.id == "llm-task"));
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
