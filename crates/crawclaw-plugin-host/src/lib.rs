use std::collections::BTreeSet;
use std::fs;
use std::hash::{DefaultHasher, Hash, Hasher};
use std::path::Path;
use std::path::PathBuf;
use std::process::Command;
use std::time::UNIX_EPOCH;

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

pub async fn invoke_node_plugin_tool(
    runtime_root: &Path,
    plugin_id: &str,
    tool_id: &str,
    input: serde_json::Value,
) -> Result<serde_json::Value, PluginHostError> {
    invoke_node_plugin_tool_with_options(
        runtime_root,
        plugin_id,
        tool_id,
        input,
        NodePluginInvocationOptions::default(),
    )
    .await
}

#[derive(Clone, Debug)]
struct NodePluginInvocationOptions {
    node_bin: Option<PathBuf>,
    required_node_major: Option<u32>,
}

impl Default for NodePluginInvocationOptions {
    fn default() -> Self {
        Self {
            node_bin: None,
            required_node_major: Some(24),
        }
    }
}

async fn invoke_node_plugin_tool_with_options(
    runtime_root: &Path,
    plugin_id: &str,
    tool_id: &str,
    input: serde_json::Value,
    options: NodePluginInvocationOptions,
) -> Result<serde_json::Value, PluginHostError> {
    if plugin_id.trim().is_empty() || tool_id.trim().is_empty() {
        return Err(PluginHostError::Invalid(
            "Node plugin invocation requires pluginId and toolId.".to_string(),
        ));
    }
    let node_bin = resolve_node_plugin_binary(runtime_root, options.node_bin)?;
    if let Some(major) = options.required_node_major {
        assert_node_major(&node_bin, major)?;
    }

    let manifest_path = resolve_plugin_manifest_path(runtime_root, plugin_id);
    let manifest = load_node_plugin_manifest(&manifest_path)?;
    if !manifest_declares_node_runtime(&manifest) {
        return Err(PluginHostError::Invalid(format!(
            "Node plugin {plugin_id} must declare runtime.kind=\"node\"."
        )));
    }
    let source_entrypoint =
        resolve_node_plugin_entrypoint(&manifest_path, &manifest).ok_or_else(|| {
            PluginHostError::Invalid(format!(
                "Node plugin entrypoint is missing for {plugin_id}: {}",
                manifest_path.display()
            ))
        })?;
    let plugin_root = manifest_path.parent().ok_or_else(|| {
        PluginHostError::Invalid(format!(
            "Node plugin manifest has no parent directory: {}",
            manifest_path.display()
        ))
    })?;
    let language = node_plugin_language(&manifest, &source_entrypoint);
    let prepared_entrypoint = prepare_node_plugin_entrypoint(
        runtime_root,
        plugin_id,
        plugin_root,
        &source_entrypoint,
        language,
        &node_bin,
    )?;
    let runner_path = write_node_plugin_runner(runtime_root, plugin_id)?;
    run_node_plugin_tool(
        &node_bin,
        &runner_path,
        &prepared_entrypoint,
        plugin_root,
        plugin_id,
        tool_id,
        input,
    )
}

fn resolve_node_plugin_binary(
    runtime_root: &Path,
    explicit: Option<PathBuf>,
) -> Result<PathBuf, PluginHostError> {
    if let Some(path) = explicit {
        return Ok(path);
    }
    if let Some(path) = std::env::var_os("CRAWCLAW_DESKTOP_NODE24_BIN") {
        return Ok(PathBuf::from(path));
    }
    let binary = if cfg!(windows) { "node.exe" } else { "node" };
    let candidate = runtime_root
        .join("runtimes")
        .join("node-v24")
        .join("bin")
        .join(binary);
    if candidate.exists() {
        return Ok(candidate);
    }
    Err(PluginHostError::Invalid(format!(
        "Bundled Node 24 runtime not found. Set CRAWCLAW_DESKTOP_NODE24_BIN or stage {}.",
        candidate.display()
    )))
}

fn assert_node_major(node_bin: &Path, required_major: u32) -> Result<(), PluginHostError> {
    let output = Command::new(node_bin)
        .arg("--version")
        .output()
        .map_err(|error| {
            PluginHostError::Io(format!(
                "Failed to run Node runtime {}: {error}",
                node_bin.display()
            ))
        })?;
    if !output.status.success() {
        return Err(PluginHostError::Invalid(format!(
            "Node runtime {} failed --version: {}",
            node_bin.display(),
            String::from_utf8_lossy(&output.stderr).trim()
        )));
    }
    let version = String::from_utf8_lossy(&output.stdout);
    let major = version
        .trim()
        .strip_prefix('v')
        .and_then(|value| value.split('.').next())
        .and_then(|value| value.parse::<u32>().ok());
    if major == Some(required_major) {
        return Ok(());
    }
    Err(PluginHostError::Invalid(format!(
        "Bundled Node runtime must be Node {required_major}.x, got {}.",
        version.trim()
    )))
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum NodePluginLanguage {
    JavaScript,
    TypeScript,
}

fn manifest_declares_node_runtime(manifest: &Value) -> bool {
    manifest
        .get("runtime")
        .and_then(Value::as_object)
        .and_then(|runtime| runtime.get("kind"))
        .and_then(Value::as_str)
        .map(|kind| kind == "node")
        .unwrap_or(false)
}

fn node_plugin_language(manifest: &Value, entrypoint: &Path) -> NodePluginLanguage {
    let language = manifest
        .get("runtime")
        .and_then(Value::as_object)
        .and_then(|runtime| runtime.get("language"))
        .and_then(Value::as_str)
        .unwrap_or_default();
    if language == "ts" || entrypoint.extension().and_then(|ext| ext.to_str()) == Some("ts") {
        NodePluginLanguage::TypeScript
    } else {
        NodePluginLanguage::JavaScript
    }
}

fn prepare_node_plugin_entrypoint(
    runtime_root: &Path,
    plugin_id: &str,
    plugin_root: &Path,
    source_entrypoint: &Path,
    language: NodePluginLanguage,
    node_bin: &Path,
) -> Result<PathBuf, PluginHostError> {
    if language == NodePluginLanguage::JavaScript {
        return Ok(source_entrypoint.to_path_buf());
    }
    let relative_entry = source_entrypoint.strip_prefix(plugin_root).map_err(|_| {
        PluginHostError::Invalid(format!(
            "Node plugin entrypoint must stay inside plugin root: {}",
            source_entrypoint.display()
        ))
    })?;
    let cache_dir = runtime_root
        .join(".cache")
        .join("node-plugins")
        .join(sanitize_path_component(plugin_id));
    fs::create_dir_all(&cache_dir).map_err(|error| {
        PluginHostError::Io(format!(
            "Failed to create Node plugin cache {}: {error}",
            cache_dir.display()
        ))
    })?;
    let output = cache_dir.join(format!(
        "{}.mjs",
        node_entrypoint_cache_key(source_entrypoint)
    ));
    let source_mtime = fs::metadata(source_entrypoint)
        .and_then(|metadata| metadata.modified())
        .ok();
    let output_mtime = fs::metadata(&output)
        .and_then(|metadata| metadata.modified())
        .ok();
    if output.exists() && source_mtime <= output_mtime {
        return Ok(output);
    }
    compile_type_script_entrypoint(node_bin, source_entrypoint, &output).map_err(|error| {
        PluginHostError::Invalid(format!(
            "Failed to compile TypeScript plugin entrypoint {}: {error}",
            relative_entry.display()
        ))
    })?;
    Ok(output)
}

fn node_entrypoint_cache_key(entrypoint: &Path) -> String {
    let mut hasher = DefaultHasher::new();
    entrypoint.to_string_lossy().hash(&mut hasher);
    if let Ok(metadata) = fs::metadata(entrypoint) {
        metadata.len().hash(&mut hasher);
        if let Ok(modified) = metadata.modified() {
            if let Ok(duration) = modified.duration_since(UNIX_EPOCH) {
                duration.as_nanos().hash(&mut hasher);
            }
        }
    }
    format!("{:016x}", hasher.finish())
}

fn compile_type_script_entrypoint(
    node_bin: &Path,
    source: &Path,
    output: &Path,
) -> Result<(), String> {
    let source_json = serde_json::to_string(&source.to_string_lossy())
        .map_err(|error| format!("failed to serialize TypeScript source path: {error}"))?;
    let output_json = serde_json::to_string(&output.to_string_lossy())
        .map_err(|error| format!("failed to serialize TypeScript output path: {error}"))?;
    let script = format!(
        r#"
import {{ mkdirSync, readFileSync, writeFileSync }} from "node:fs";
import {{ dirname }} from "node:path";
import {{ stripTypeScriptTypes }} from "node:module";
const source = {source_json};
const output = {output_json};
mkdirSync(dirname(output), {{ recursive: true }});
const stripped = stripTypeScriptTypes(readFileSync(source, "utf8"), {{ mode: "strip" }});
writeFileSync(output, stripped);
"#
    );
    let result = Command::new(node_bin)
        .arg("--input-type=module")
        .arg("-e")
        .arg(script)
        .output()
        .map_err(|error| format!("failed to run Node compiler: {error}"))?;
    if result.status.success() {
        return Ok(());
    }
    Err(String::from_utf8_lossy(&result.stderr).trim().to_string())
}

fn write_node_plugin_runner(
    runtime_root: &Path,
    plugin_id: &str,
) -> Result<PathBuf, PluginHostError> {
    let cache_dir = runtime_root
        .join(".cache")
        .join("node-plugins")
        .join(sanitize_path_component(plugin_id));
    fs::create_dir_all(&cache_dir).map_err(|error| {
        PluginHostError::Io(format!(
            "Failed to create Node plugin runner cache {}: {error}",
            cache_dir.display()
        ))
    })?;
    let runner_path = cache_dir.join("runner.mjs");
    fs::write(&runner_path, NODE_PLUGIN_RUNNER).map_err(|error| {
        PluginHostError::Io(format!(
            "Failed to write Node plugin runner {}: {error}",
            runner_path.display()
        ))
    })?;
    Ok(runner_path)
}

const NODE_PLUGIN_RESULT_PREFIX: &str = "__CRAWCLAW_NODE_PLUGIN_RESULT__";

const NODE_PLUGIN_RUNNER: &str = r#"
import { pathToFileURL } from "node:url";

const [entrypoint, pluginRoot, pluginId, toolId, inputJson] = process.argv.slice(2);
const resultPrefix = "__CRAWCLAW_NODE_PLUGIN_RESULT__";

function unsupported(name) {
  return () => {
    throw new Error(`${name} is not supported by the Node plugin runtime v1`);
  };
}

async function main() {
  const input = inputJson ? JSON.parse(inputJson) : {};
  const tools = new Map();
  const api = {
    id: pluginId,
    name: pluginId,
    description: "",
    source: "node",
    registrationMode: "full",
    config: {},
    pluginConfig: {},
    runtime: { version: "node", kind: "node" },
    logger: console,
    registerTool(toolOrFactory, opts = {}) {
      const context = {
        pluginConfig: {},
        sandboxed: false,
        workspaceDir: pluginRoot,
      };
      const registered = typeof toolOrFactory === "function"
        ? toolOrFactory(context)
        : toolOrFactory;
      const toolsToRegister = Array.isArray(registered) ? registered : [registered];
      for (const tool of toolsToRegister) {
        if (!tool) {
          continue;
        }
        const names = [
          ...(Array.isArray(opts.names) ? opts.names : []),
          opts.name,
          tool.name,
        ].filter((value) => typeof value === "string" && value.trim().length > 0);
        for (const name of names) {
          tools.set(name, tool);
        }
      }
    },
    registerHook: unsupported("registerHook"),
    registerHttpRoute: unsupported("registerHttpRoute"),
    registerChannel: unsupported("registerChannel"),
    registerGatewayMethod: unsupported("registerGatewayMethod"),
    registerCli: unsupported("registerCli"),
    registerService: unsupported("registerService"),
    registerCliBackend: unsupported("registerCliBackend"),
    registerProvider: unsupported("registerProvider"),
    registerProviderAuth: unsupported("registerProviderAuth"),
    registerSpeechProvider: unsupported("registerSpeechProvider"),
    registerMediaUnderstandingProvider: unsupported("registerMediaUnderstandingProvider"),
    registerWebFetchProvider: unsupported("registerWebFetchProvider"),
    registerWebSearchProvider: unsupported("registerWebSearchProvider"),
    registerCommand: unsupported("registerCommand"),
    onConversationBindingResolved: unsupported("onConversationBindingResolved"),
    on: unsupported("on"),
    resolvePath(value) {
      return value;
    },
  };

  const module = await import(pathToFileURL(entrypoint).href);
  const entry = module.default ?? module;
  if (entry && typeof entry.register === "function") {
    await entry.register(api);
  } else if (typeof entry === "function") {
    await entry(api);
  } else {
    throw new Error(`Unsupported CrawClaw plugin entry export for ${pluginId}`);
  }
  const tool = tools.get(toolId);
  if (!tool || typeof tool.execute !== "function") {
    throw new Error(`Tool not registered: ${pluginId}/${toolId}`);
  }
  const value = await tool.execute(`desktop-node-${pluginId}-${toolId}`, input, undefined, undefined, {
    cwd: pluginRoot,
    pluginId,
  });
  console.log(`${resultPrefix}${JSON.stringify({ ok: true, result: value ?? null })}`);
}

main().catch((error) => {
  console.log(`${resultPrefix}${JSON.stringify({
    ok: false,
    message: error && error.stack ? error.stack : String(error),
  })}`);
  process.exitCode = 1;
});
"#;

fn run_node_plugin_tool(
    node_bin: &Path,
    runner_path: &Path,
    entrypoint: &Path,
    plugin_root: &Path,
    plugin_id: &str,
    tool_id: &str,
    input: Value,
) -> Result<Value, PluginHostError> {
    let output = Command::new(node_bin)
        .arg(runner_path)
        .arg(entrypoint)
        .arg(plugin_root)
        .arg(plugin_id)
        .arg(tool_id)
        .arg(input.to_string())
        .current_dir(plugin_root)
        .output()
        .map_err(|error| {
            PluginHostError::Io(format!(
                "Failed to run Node plugin runtime {}: {error}",
                node_bin.display()
            ))
        })?;
    let stdout = String::from_utf8_lossy(&output.stdout);
    let result_line = stdout
        .lines()
        .rev()
        .find_map(|line| line.strip_prefix(NODE_PLUGIN_RESULT_PREFIX));
    let Some(raw_result) = result_line else {
        return Err(PluginHostError::Invalid(format!(
            "Node plugin {plugin_id}/{tool_id} did not return a result. stderr: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        )));
    };
    let envelope: Value = serde_json::from_str(raw_result).map_err(|error| {
        PluginHostError::Invalid(format!("Invalid Node plugin result envelope: {error}"))
    })?;
    if envelope.get("ok").and_then(Value::as_bool) == Some(true) && output.status.success() {
        return Ok(envelope.get("result").cloned().unwrap_or(Value::Null));
    }
    let stderr = String::from_utf8_lossy(&output.stderr);
    let message = envelope
        .get("message")
        .and_then(Value::as_str)
        .unwrap_or_else(|| stderr.trim());
    Err(PluginHostError::Invalid(format!(
        "Node plugin {plugin_id}/{tool_id} failed: {message}"
    )))
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

fn load_node_plugin_manifest(manifest_path: &Path) -> Result<Value, PluginHostError> {
    match fs::read_to_string(manifest_path) {
        Ok(raw) => serde_json::from_str(&raw).map_err(|error| {
            PluginHostError::Invalid(format!(
                "Invalid Node plugin manifest {}: {error}",
                manifest_path.display()
            ))
        }),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(json!({})),
        Err(error) => Err(PluginHostError::Io(format!(
            "Failed to read Node plugin manifest {}: {error}",
            manifest_path.display()
        ))),
    }
}

fn resolve_node_plugin_entrypoint(manifest_path: &Path, manifest: &Value) -> Option<PathBuf> {
    let root = manifest_path.parent()?;
    for candidate in node_plugin_entrypoint_candidates(manifest) {
        let entrypoint = root.join(candidate);
        if entrypoint.exists() {
            return Some(entrypoint);
        }
    }
    None
}

fn node_plugin_entrypoint_candidates(manifest: &Value) -> Vec<String> {
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
            vec!["brokerMode", "bindHost", "port"]
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
    async fn node_plugin_invocation_rejects_legacy_js_fallback_manifest() {
        let runtime_root = unique_runtime_root("node-plugin-missing-runtime");
        write_test_node_plugin(
            &runtime_root,
            serde_json::json!({
                "id": "test-node",
                "entrypoint": "index.mjs",
                "allowJsPluginFallback": true,
                "compat": { "jsPluginFallback": true }
            }),
            "index.mjs",
            NODE_PLUGIN_ENTRY_JS,
        );

        let error = invoke_node_plugin_tool_with_options(
            &runtime_root,
            "test-node",
            "echo",
            serde_json::json!({ "message": "hi" }),
            NodePluginInvocationOptions {
                node_bin: Some(current_node_binary()),
                required_node_major: None,
            },
        )
        .await
        .expect_err("node runtime should be explicit");

        assert!(error.to_string().contains("runtime.kind=\"node\""));
    }

    #[tokio::test]
    async fn node_plugin_invocation_runs_registered_js_tool() {
        let runtime_root = unique_runtime_root("node-plugin-js");
        write_test_node_plugin(
            &runtime_root,
            serde_json::json!({
                "id": "test-node",
                "runtime": {
                    "kind": "node",
                    "language": "js",
                    "entrypoint": "index.mjs"
                }
            }),
            "index.mjs",
            NODE_PLUGIN_ENTRY_JS,
        );

        let result = invoke_node_plugin_tool_with_options(
            &runtime_root,
            "test-node",
            "echo",
            serde_json::json!({ "message": "hi" }),
            NodePluginInvocationOptions {
                node_bin: Some(current_node_binary()),
                required_node_major: None,
            },
        )
        .await
        .expect("tool result");

        assert_eq!(result["output"], "node:node:hi");
    }

    #[tokio::test]
    async fn node_plugin_invocation_compiles_ts_to_cached_mjs() {
        let runtime_root = unique_runtime_root("node-plugin-ts");
        write_test_node_plugin(
            &runtime_root,
            serde_json::json!({
                "id": "test-node",
                "runtime": {
                    "kind": "node",
                    "language": "ts",
                    "entrypoint": "index.ts"
                }
            }),
            "index.ts",
            r#"
export default function register(api: any) {
  api.registerTool({
    name: "echo",
    async execute(_callId: string, input: { message: string }) {
      return { output: `${api.source}:${api.runtime.version}:${input.message as string}` };
    }
  });
}
"#,
        );

        let result = invoke_node_plugin_tool_with_options(
            &runtime_root,
            "test-node",
            "echo",
            serde_json::json!({ "message": "hi" }),
            NodePluginInvocationOptions {
                node_bin: Some(current_node_binary()),
                required_node_major: None,
            },
        )
        .await
        .expect("tool result");

        assert_eq!(result["output"], "node:node:hi");
        assert!(runtime_root
            .join(".cache")
            .join("node-plugins")
            .join("test-node")
            .exists());
    }

    const NODE_PLUGIN_ENTRY_JS: &str = r#"
export default function register(api) {
  api.registerTool({
    name: "echo",
    async execute(_callId, input) {
      return { output: `${api.source}:${api.runtime.version}:${input.message}` };
    }
  });
}
"#;

    fn write_test_node_plugin(
        runtime_root: &Path,
        manifest: serde_json::Value,
        entrypoint: &str,
        entry: &str,
    ) -> PathBuf {
        let plugin_dir = runtime_root.join("plugins").join("test-node");
        fs::create_dir_all(&plugin_dir).expect("plugin dir");
        fs::write(
            plugin_dir.join("crawclaw.plugin.json"),
            serde_json::to_vec_pretty(&manifest).expect("manifest json"),
        )
        .expect("plugin manifest");
        fs::write(plugin_dir.join(entrypoint), entry).expect("plugin entry");
        plugin_dir
    }

    fn current_node_binary() -> PathBuf {
        std::env::var_os("NODE")
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from("node"))
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
