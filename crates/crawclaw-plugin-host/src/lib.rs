use std::collections::BTreeSet;
use std::fs;
use std::path::Path;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

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
    channel_field("port", "Port", false, "1883"),
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
        description: "Rust-native ESP32 desktop assistant channel configuration surface.",
        icon: "audioLines",
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
    pub pi_quickjs_extensions: bool,
}

pub fn phase_three_capability() -> PluginHostCapability {
    PluginHostCapability {
        manifest_read_model: true,
        rust_or_wasm_entry_required: true,
        pi_quickjs_extensions: true,
    }
}

pub async fn invoke_js_plugin_tool(
    runtime_root: &Path,
    plugin_id: &str,
    tool_id: &str,
    input: serde_json::Value,
) -> Result<serde_json::Value, PluginHostError> {
    if plugin_id.trim().is_empty() || tool_id.trim().is_empty() {
        return Err(PluginHostError::Invalid(
            "JS plugin invocation requires pluginId and toolId.".to_string(),
        ));
    }
    let manifest_path = resolve_plugin_manifest_path(runtime_root, plugin_id);
    let manifest = load_js_plugin_manifest(&manifest_path)?;
    let entrypoint = resolve_js_plugin_entrypoint(&manifest_path, &manifest).ok_or_else(|| {
        PluginHostError::Invalid(format!(
            "JS plugin entrypoint is missing for {plugin_id}: {}",
            manifest_path.display()
        ))
    })?;
    let adapter_path =
        write_pi_quickjs_plugin_adapter(plugin_id, &manifest, &manifest_path, &entrypoint)?;

    let manager = pi::extensions::ExtensionManager::new();
    manager.set_cwd(path_string(runtime_root));
    let tools = Arc::new(pi::sdk::ToolRegistry::new(&[], runtime_root, None));
    let js_runtime = pi::extensions::JsExtensionRuntimeHandle::start(
        pi::extensions_js::PiJsRuntimeConfig {
            cwd: path_string(runtime_root),
            disk_cache_dir: Some(runtime_root.join(".cache").join("pijs-modules")),
            ..Default::default()
        },
        Arc::clone(&tools),
        manager.clone(),
    )
    .await
    .map_err(|error| pi_quickjs_error("failed to start runtime", error))?;
    manager.set_js_runtime(js_runtime.clone());

    let result = invoke_pi_quickjs_tool(
        &manager,
        &js_runtime,
        runtime_root,
        plugin_id,
        tool_id,
        input,
        &adapter_path,
    )
    .await;
    let _ = js_runtime.shutdown(Duration::from_secs(5)).await;
    result
}

fn resolve_plugin_manifest_path(runtime_root: &Path, plugin_id: &str) -> PathBuf {
    let plugin_manifest_path = runtime_root
        .join("plugins")
        .join(plugin_id)
        .join("crawclaw.plugin.json");
    if plugin_manifest_path.exists() {
        return plugin_manifest_path;
    }
    runtime_root.join("plugins").join("manifest.json")
}

fn path_string(path: &Path) -> String {
    path.to_string_lossy().to_string()
}

async fn invoke_pi_quickjs_tool(
    manager: &pi::extensions::ExtensionManager,
    js_runtime: &pi::extensions::JsExtensionRuntimeHandle,
    runtime_root: &Path,
    plugin_id: &str,
    tool_id: &str,
    input: Value,
    adapter_path: &Path,
) -> Result<Value, PluginHostError> {
    let spec = pi::extensions::JsExtensionLoadSpec::from_entry_path(adapter_path)
        .map_err(|error| pi_quickjs_error("failed to resolve plugin adapter", error))?;
    manager
        .load_js_extensions(vec![spec])
        .await
        .map_err(|error| pi_quickjs_error("failed to load plugin", error))?;
    let registered_tools = js_runtime
        .get_registered_tools()
        .await
        .map_err(|error| pi_quickjs_error("failed to list plugin tools", error))?;
    if !registered_tools.iter().any(|tool| tool.name == tool_id) {
        return Err(PluginHostError::Invalid(format!(
            "Tool not registered: {plugin_id}/{tool_id}"
        )));
    }
    js_runtime
        .execute_tool(
            tool_id.to_string(),
            format!("desktop-pi-quickjs-{plugin_id}-{tool_id}"),
            input,
            Arc::new(json!({
                "cwd": path_string(runtime_root),
                "pluginId": plugin_id,
                "pluginConfig": {}
            })),
            60_000,
        )
        .await
        .map_err(|error| pi_quickjs_error("failed to invoke plugin tool", error))
}

fn load_js_plugin_manifest(manifest_path: &Path) -> Result<Value, PluginHostError> {
    match fs::read_to_string(manifest_path) {
        Ok(raw) => serde_json::from_str(&raw).map_err(|error| {
            PluginHostError::Invalid(format!(
                "Invalid JS plugin manifest {}: {error}",
                manifest_path.display()
            ))
        }),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(json!({})),
        Err(error) => Err(PluginHostError::Io(format!(
            "Failed to read JS plugin manifest {}: {error}",
            manifest_path.display()
        ))),
    }
}

fn resolve_js_plugin_entrypoint(manifest_path: &Path, manifest: &Value) -> Option<PathBuf> {
    let root = manifest_path.parent()?;
    for candidate in js_plugin_entrypoint_candidates(manifest) {
        let entrypoint = root.join(candidate);
        if entrypoint.exists() {
            return Some(entrypoint);
        }
    }
    None
}

fn js_plugin_entrypoint_candidates(manifest: &Value) -> Vec<String> {
    let mut candidates = Vec::new();
    for key in ["entrypoint", "entry", "main", "module"] {
        if let Some(value) = manifest.get(key).and_then(Value::as_str) {
            push_non_empty_candidate(&mut candidates, value);
        }
    }
    if let Some(value) = manifest
        .get("runtime")
        .and_then(Value::as_object)
        .and_then(|runtime| runtime.get("entrypoint"))
        .and_then(Value::as_str)
    {
        push_non_empty_candidate(&mut candidates, value);
    }
    for fallback in ["index.js", "index.mjs", "index.ts"] {
        push_non_empty_candidate(&mut candidates, fallback);
    }
    candidates
}

fn push_non_empty_candidate(candidates: &mut Vec<String>, value: &str) {
    let candidate = value.trim();
    if !candidate.is_empty() && !candidates.iter().any(|existing| existing == candidate) {
        candidates.push(candidate.to_string());
    }
}

fn write_pi_quickjs_plugin_adapter(
    plugin_id: &str,
    manifest: &Value,
    manifest_path: &Path,
    entrypoint: &Path,
) -> Result<PathBuf, PluginHostError> {
    let plugin_root = manifest_path.parent().ok_or_else(|| {
        PluginHostError::Invalid(format!(
            "JS plugin manifest has no parent directory: {}",
            manifest_path.display()
        ))
    })?;
    let relative_entry = entrypoint.strip_prefix(plugin_root).map_err(|_| {
        PluginHostError::Invalid(format!(
            "JS plugin entrypoint must stay inside plugin root: {}",
            entrypoint.display()
        ))
    })?;
    let relative_entry_specifier = format!(
        "./{}",
        relative_entry
            .to_string_lossy()
            .replace(std::path::MAIN_SEPARATOR, "/")
    );
    let plugin_adapter_path = plugin_root.join(".crawclaw-pi-quickjs-adapter.mjs");
    let plugin_adapter =
        render_pi_quickjs_plugin_adapter(plugin_id, manifest, &relative_entry_specifier)?;
    if fs::write(&plugin_adapter_path, plugin_adapter).is_ok() {
        return Ok(plugin_adapter_path);
    }

    let adapter_dir = std::env::temp_dir()
        .join("crawclaw-pi-quickjs-adapters")
        .join(sanitize_path_component(plugin_id));
    fs::create_dir_all(&adapter_dir).map_err(|error| {
        PluginHostError::Io(format!(
            "Failed to create Pi QuickJS plugin adapter directory {}: {error}",
            adapter_dir.display()
        ))
    })?;
    let plugin_link = adapter_dir.join("plugin");
    let _ = fs::remove_file(&plugin_link);
    let _ = fs::remove_dir(&plugin_link);
    symlink_plugin_root(plugin_root, &plugin_link)?;

    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or_default();
    let adapter_path = adapter_dir.join(format!("{}-{stamp}.mjs", std::process::id()));
    let entry_specifier = format!(
        "./plugin/{}",
        relative_entry
            .to_string_lossy()
            .replace(std::path::MAIN_SEPARATOR, "/")
    );
    let adapter = render_pi_quickjs_plugin_adapter(plugin_id, manifest, &entry_specifier)?;
    fs::write(&adapter_path, adapter).map_err(|error| {
        PluginHostError::Io(format!(
            "Failed to write Pi QuickJS plugin adapter {}: {error}",
            adapter_path.display()
        ))
    })?;
    Ok(adapter_path)
}

#[cfg(unix)]
fn symlink_plugin_root(plugin_root: &Path, plugin_link: &Path) -> Result<(), PluginHostError> {
    std::os::unix::fs::symlink(plugin_root, plugin_link).map_err(|error| {
        PluginHostError::Io(format!(
            "Failed to link Pi QuickJS plugin root {}: {error}",
            plugin_root.display()
        ))
    })
}

#[cfg(windows)]
fn symlink_plugin_root(plugin_root: &Path, plugin_link: &Path) -> Result<(), PluginHostError> {
    std::os::windows::fs::symlink_dir(plugin_root, plugin_link).map_err(|error| {
        PluginHostError::Io(format!(
            "Failed to link Pi QuickJS plugin root {}: {error}",
            plugin_root.display()
        ))
    })
}

fn sanitize_path_component(value: &str) -> String {
    value
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || matches!(character, '-' | '_' | '.') {
                character
            } else {
                '_'
            }
        })
        .collect()
}

fn render_pi_quickjs_plugin_adapter(
    plugin_id: &str,
    manifest: &Value,
    entry_specifier: &str,
) -> Result<String, PluginHostError> {
    let plugin_id_json = serde_json::to_string(plugin_id).map_err(|error| {
        PluginHostError::Invalid(format!("Failed to serialize plugin id: {error}"))
    })?;
    let manifest_json = serde_json::to_string(manifest).map_err(|error| {
        PluginHostError::Invalid(format!("Failed to serialize plugin manifest: {error}"))
    })?;
    let entry_specifier_json = serde_json::to_string(entry_specifier).map_err(|error| {
        PluginHostError::Invalid(format!("Failed to serialize plugin entrypoint: {error}"))
    })?;
    Ok(format!(
        r#"
const pluginId = {plugin_id_json};
const manifest = {manifest_json};
const entrySpecifier = {entry_specifier_json};

function noop() {{}}

function installCrawClawApi(pi, pluginConfig) {{
  const logger = {{ debug: noop, info: noop, warn: noop, error: noop }};
  const originalRegisterTool = pi.registerTool.bind(pi);
  let registeredTool = false;
  pi.id = pluginId;
  pi.name = manifest.name || pluginId;
  pi.description = manifest.description || "";
  pi.source = "pi-quickjs";
  pi.registrationMode = "full";
  pi.config = {{}};
  pi.pluginConfig = pluginConfig;
  pi.logger = logger;
  pi.runtime = {{ version: "pi-quickjs" }};
  pi.registerTool = function registerCrawClawTool(toolOrFactory, opts = {{}}) {{
      registeredTool = true;
      const context = {{
        pluginConfig,
        sandboxed: false,
        workspaceDir: ".",
      }};
      const registered = typeof toolOrFactory === "function"
        ? toolOrFactory(context)
        : toolOrFactory;
      const tools = Array.isArray(registered) ? registered : [registered];
      for (const tool of tools) {{
        if (!tool) {{
          continue;
        }}
        const names = [
          ...(Array.isArray(opts.names) ? opts.names : []),
          opts.name,
          tool.name,
        ].filter((value) => typeof value === "string" && value.trim().length > 0);
        for (const name of names) {{
          originalRegisterTool({{
            name,
            label: tool.label || tool.name || name,
            description: tool.description || "",
            parameters: tool.parameters || tool.inputSchema || {{ type: "object", properties: {{}} }},
            execute: async (callId, input, onUpdate, abort, ctx) => {{
              if (!tool.execute) {{
                throw new Error(`Tool has no execute handler: ${{name}}`);
              }}
              const result = await tool.execute(callId, input || {{}}, onUpdate, abort, ctx);
              return result === undefined ? null : result;
            }},
          }});
        }}
      }}
  }};
  pi.registerHook = pi.registerHook || noop;
  pi.registerHttpRoute = pi.registerHttpRoute || noop;
  pi.registerChannel = pi.registerChannel || noop;
  pi.registerGatewayMethod = pi.registerGatewayMethod || noop;
  pi.registerCli = pi.registerCli || noop;
  pi.registerProvider = pi.registerProvider || noop;
  pi.registerProviderAuth = pi.registerProviderAuth || noop;
  pi.registerService = pi.registerService || noop;
  pi.registerWebSearchProvider = pi.registerWebSearchProvider || noop;
  pi.hasRegisteredCrawClawTool = () => registeredTool;
  return pi;
}}

export default async function init(pi) {{
  const crawclawApi = installCrawClawApi(pi, {{}});
  const module = await import(entrySpecifier);
  const entry = module.default ?? module;
  if (crawclawApi.hasRegisteredCrawClawTool()) {{
    return;
  }}
  if (entry && typeof entry.register === "function") {{
    const register = entry.register;
    await register(crawclawApi);
  }} else if (typeof entry === "function") {{
    await entry(crawclawApi);
  }} else {{
    throw new Error(`Unsupported CrawClaw plugin entry export for ${{pluginId}}`);
  }}
}}
"#
    ))
}

fn pi_quickjs_error(context: &str, error: impl std::fmt::Display) -> PluginHostError {
    PluginHostError::Invalid(format!("Pi QuickJS plugin {context}: {error}"))
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
            id: "open_websearch_search".to_string(),
            name: "Open-WebSearch".to_string(),
            description:
                "Search an Open-WebSearch-compatible endpoint through the Rust native runtime."
                    .to_string(),
            status: "available".to_string(),
            permission: "network".to_string(),
            icon: "search".to_string(),
            open: false,
        },
        PluginHostTool {
            id: "scrapling_fetch".to_string(),
            name: "Scrapling Fetch".to_string(),
            description:
                "Fetch static web content through the Rust native runtime without the Python sidecar."
                    .to_string(),
            status: "available".to_string(),
            permission: "network".to_string(),
            icon: "search".to_string(),
            open: false,
        },
        PluginHostTool {
            id: "qwen3_tts_build_payload".to_string(),
            name: "Qwen3-TTS Payload".to_string(),
            description: "Prepare local Qwen3-TTS synthesis payloads through the Rust native runtime."
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

    #[test]
    fn native_channel_catalog_keeps_only_retained_channels() {
        assert_eq!(
            native_channel_ids(),
            vec!["ddingtalk", "feishu", "esp32", "qqbot", "weixin"]
        );
        assert!(!is_native_channel_id("dingtalk"));
        assert!(!is_native_channel_id("discord"));
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
    }

    #[test]
    fn plugin_host_capability_exposes_pi_quickjs_extensions() {
        let capability = phase_three_capability();

        assert!(capability.manifest_read_model);
        assert!(capability.rust_or_wasm_entry_required);
        assert!(capability.pi_quickjs_extensions);
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
            .any(|tool| tool.id == "open_websearch_search" && tool.name == "Open-WebSearch"));
        assert!(read_model
            .tools
            .iter()
            .any(|tool| tool.id == "scrapling_fetch" && tool.name == "Scrapling Fetch"));
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

    #[tokio::test]
    async fn js_plugin_invocation_uses_pi_quickjs_runtime() {
        let runtime_root = unique_runtime_root("pi-quickjs-plugin");
        write_test_js_plugin(&runtime_root);

        let result = invoke_js_plugin_tool(
            &runtime_root,
            "test-js",
            "echo",
            serde_json::json!({ "message": "hi" }),
        )
        .await
        .expect("tool result");

        assert_eq!(result["output"], "pi-quickjs:pi-quickjs:hi");
        assert!(!runtime_root
            .join("compat")
            .join("js-plugin-runner.mjs")
            .exists());
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn js_plugin_invocation_uses_temp_adapter_when_plugin_root_is_read_only() {
        use std::os::unix::fs::PermissionsExt;

        let runtime_root = unique_runtime_root("pi-quickjs-read-only-plugin");
        let plugin_dir = write_test_js_plugin(&runtime_root);
        let mut permissions = fs::metadata(&plugin_dir)
            .expect("plugin metadata")
            .permissions();
        permissions.set_mode(0o555);
        fs::set_permissions(&plugin_dir, permissions).expect("read-only plugin dir");

        let result = invoke_js_plugin_tool(
            &runtime_root,
            "test-js",
            "echo",
            serde_json::json!({ "message": "hi" }),
        )
        .await
        .expect("tool result");

        let mut permissions = fs::metadata(&plugin_dir)
            .expect("plugin metadata")
            .permissions();
        permissions.set_mode(0o755);
        fs::set_permissions(&plugin_dir, permissions).expect("restore plugin dir");
        assert_eq!(result["output"], "pi-quickjs:pi-quickjs:hi");
        assert!(!plugin_dir.join(".crawclaw-pi-quickjs-adapter.mjs").exists());
    }

    fn write_test_js_plugin(runtime_root: &Path) -> PathBuf {
        let plugin_dir = runtime_root.join("plugins").join("test-js");
        fs::create_dir_all(&plugin_dir).expect("plugin dir");
        fs::write(
            plugin_dir.join("crawclaw.plugin.json"),
            serde_json::to_vec_pretty(&serde_json::json!({
                "id": "test-js",
                "entrypoint": "index.mjs"
            }))
            .expect("manifest json"),
        )
        .expect("plugin manifest");
        fs::write(
            plugin_dir.join("index.mjs"),
            r#"
            export default {
              async register(api) {
                api.registerTool({
                  name: "echo",
                  description: "Echo a test message",
                  parameters: {
                    type: "object",
                    properties: { message: { type: "string" } }
                  },
                  execute: async (_callId, input) => {
                    return {
                      output: `${api.source}:${api.runtime.version}:${input.message}`
                    };
                  }
                });
              }
            };
            "#,
        )
        .expect("plugin entry");
        plugin_dir
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
