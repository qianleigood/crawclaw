#![recursion_limit = "512"]

use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::future::Future;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::pin::Pin;
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

mod config_contract;
mod core_tools;
pub mod cron;
mod desktop_packaging;
pub mod memory;
mod message_policy;
mod native_plugin_registry;
mod package_build;
mod package_release;
mod plugin_dependency_plan;
mod provider_contract;
pub mod special_agents;

pub use config_contract::{
    base_config_schema_payload, base_config_schema_payload_json, config_doc_baseline_json,
    config_doc_baseline_jsonl, write_base_config_schema_artifact,
    write_config_doc_baseline_artifacts, BaseConfigSchemaWriteResult, ConfigDocBaselineWriteResult,
};
use core_tools::build_pi_agent_rust_tool_registry;
pub use desktop_packaging::{
    check_desktop_runtime_release_inputs, resolve_desktop_runtime_stage_paths,
    stage_desktop_tauri_runtime, DesktopRuntimeCheckOptions, DesktopRuntimeStagePaths,
};
pub use message_policy::execute_message_policy_operation;
pub use native_plugin_registry::{
    dispatch_native_service_lifecycle, invoke_native_plugin_operation, load_native_plugin_registry,
    with_native_runtime_context, NativePluginRegistry, NativePluginRegistryDiagnostic,
    NativePluginRuntime, NativeSidecarCommand, NativeToolRegistration,
};
pub use package_build::{
    list_bundled_plugin_pack_artifacts, list_static_package_asset_outputs,
    stage_native_binary_artifacts, stage_package_postbuild, write_package_build_metadata,
    StaticPackageAsset,
};
pub use package_release::{
    collect_package_release_check_errors, format_package_release_check_errors, run_package_prepack,
    PackagePrepackOutcome, PackageReleaseCheckErrors,
};
pub use plugin_dependency_plan::{
    relative_to_repo as plugin_dependency_plan_relative_to_repo,
    write_plugin_dependency_plan_artifacts, PluginDependencyPlanWriteResult,
};
pub use provider_contract::{
    render_bundled_capability_metadata_module, render_bundled_provider_auth_env_var_module,
    render_provider_runtime_constants_module, write_bundled_capability_metadata_module,
    write_bundled_provider_auth_env_var_module, write_provider_runtime_constants_module,
    GeneratedModuleWriteResult,
};

pub use crawclaw_channels::{
    canonical_agent_run_event_types, channel_contract_version, dispatch_native_channel_outbound,
    find_native_channel_descriptor, is_local_native_delivery_channel,
    list_native_channel_descriptors, lookup_native_channel_directory,
    resolve_native_channel_lifecycle_update, AgentModelSelection, AgentRunEvent, AgentRunRequest,
    ChannelCapabilityDescriptor, ChannelDeliveryResult, ChannelDirectoryLookupRequest,
    ChannelDirectoryLookupResult, ChannelInboundCapability, ChannelInboundEnvelope,
    ChannelLifecycleCapability, ChannelOutboundAction, ChannelOutboundCapability,
    ChannelOutboundRequest, ChatType as ChannelChatType, MessagingTarget, MessagingTargetKind,
    NativeChannelDeliveryRecord, NativeChannelDispatchContext, NativeChannelLifecycleInput,
    NativeChannelLifecycleUpdate, ReplyPayload, TranscriptRole,
};
use crawclaw_core::{RuntimeCompatStatus, RuntimeStatusValue};
use crawclaw_plugin_sdk::{NativeInvocationTarget, NativePluginDescriptor};
use crawclaw_providers::{
    send_native_provider_conversation_with_options, NativeProviderConfig,
    NativeProviderContentBlock, NativeProviderMessage, NativeProviderMessageRole,
    NativeProviderRequestOptions, NativeProviderTool, ProviderTransportError,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RuntimeLayout {
    pub runtime_root: PathBuf,
    pub binary_path: PathBuf,
    pub channel_manifest_path: PathBuf,
    pub manifest_path: PathBuf,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RuntimeCommand {
    pub program: PathBuf,
    pub args: Vec<String>,
    pub cwd: PathBuf,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct NativeRuntimeStatus {
    pub status: RuntimeStatusValue,
    pub detail: String,
    pub runtime_root: String,
    pub binary_path: String,
    pub compat: RuntimeCompatStatus,
}

pub fn runtime_binary_name() -> &'static str {
    if cfg!(windows) {
        "crawclaw-runtime.exe"
    } else {
        "crawclaw-runtime"
    }
}

pub fn gateway_binary_name() -> &'static str {
    if cfg!(windows) {
        "crawclaw-gateway.exe"
    } else {
        "crawclaw-gateway"
    }
}

pub fn native_plugins_binary_name() -> &'static str {
    if cfg!(windows) {
        "crawclaw-native-plugins.exe"
    } else {
        "crawclaw-native-plugins"
    }
}

impl RuntimeLayout {
    pub fn gateway_binary_path(&self) -> PathBuf {
        self.runtime_root.join("bin").join(gateway_binary_name())
    }

    pub fn native_plugins_binary_path(&self) -> PathBuf {
        self.runtime_root
            .join("bin")
            .join(native_plugins_binary_name())
    }
}

pub fn resolve_runtime_layout(resource_dir: PathBuf) -> RuntimeLayout {
    let runtime_root = resource_dir.join("runtime").join("crawclaw");
    RuntimeLayout {
        binary_path: runtime_root.join("bin").join(runtime_binary_name()),
        channel_manifest_path: runtime_root.join("channels").join("manifest.json"),
        manifest_path: runtime_root.join("runtimes").join("manifest.json"),
        runtime_root,
    }
}

pub fn build_desktop_runtime_status_command(layout: &RuntimeLayout) -> RuntimeCommand {
    RuntimeCommand {
        program: layout.binary_path.clone(),
        args: vec!["status".to_string(), "--json".to_string()],
        cwd: layout.runtime_root.clone(),
    }
}

pub fn build_gateway_help_command(layout: &RuntimeLayout) -> RuntimeCommand {
    RuntimeCommand {
        program: layout.gateway_binary_path(),
        args: vec!["--help".to_string()],
        cwd: layout.runtime_root.clone(),
    }
}

pub fn inspect_runtime_layout(layout: &RuntimeLayout) -> NativeRuntimeStatus {
    let missing = required_runtime_files(layout)
        .into_iter()
        .find(|path| !path.exists());
    let executable_error = missing
        .is_none()
        .then(|| first_non_executable_runtime_binary(layout))
        .flatten();
    let status = if missing.is_some() {
        RuntimeStatusValue::Missing
    } else if executable_error.is_some() {
        RuntimeStatusValue::Error
    } else {
        RuntimeStatusValue::Ready
    };
    let detail = match missing {
        Some(path) => format!("Missing embedded runtime file: {}", path.display()),
        None => {
            executable_error.unwrap_or_else(|| "Embedded Rust runtime is available.".to_string())
        }
    };
    let compat = compat_status(&status);

    NativeRuntimeStatus {
        status,
        detail,
        runtime_root: path_to_string(&layout.runtime_root),
        binary_path: path_to_string(&layout.binary_path),
        compat,
    }
}

pub fn stage_desktop_runtime_manifests(output: &Path) -> Result<(), String> {
    let runtimes_dir = output.join("runtimes");
    let channels_dir = output.join("channels");
    let providers_dir = output.join("providers");
    let plugins_dir = output.join("plugins");
    for dir in [&runtimes_dir, &channels_dir, &providers_dir, &plugins_dir] {
        fs::create_dir_all(dir).map_err(|error| {
            format!(
                "failed to create runtime directory {}: {error}",
                dir.display()
            )
        })?;
    }
    write_json_file(
        &runtimes_dir.join("manifest.json"),
        &json!({
            "runtime": "rust-native",
            "jsPluginRuntime": "none",
            "managedRuntimes": {
                "browser": {
                    "runtime": "rust-native-binary",
                    "provider": "agent-browser",
                    "binaryPath": if cfg!(windows) {
                        "browser/bin/agent-browser.exe"
                    } else {
                        "browser/bin/agent-browser"
                    },
                    "sourcePackage": "agent-browser",
                    "version": "0.27.0"
                },
                "searxng": {
                    "runtime": "python-sidecar",
                    "provider": "searxng",
                    "sidecar": "searxng",
                    "baseUrl": "http://127.0.0.1:3210",
                    "settingsPath": "searxng/settings.yml",
                    "pythonPath": if cfg!(windows) {
                        "searxng/venv/Scripts/python.exe"
                    } else {
                        "searxng/venv/bin/python"
                    },
                    "sourceRepo": "https://github.com/searxng/searxng",
                    "sourceCommit": "afafca93f30939f213c1bc3fa3379e5ed883122d",
                    "license": "AGPL-3.0-or-later"
                }
            }
        }),
    )?;
    write_json_file(
        &channels_dir.join("manifest.json"),
        &json!({
            "implementation": "rust-native",
            "channels": crawclaw_plugin_host::native_channels(),
        }),
    )?;
    write_json_file(
        &providers_dir.join("manifest.json"),
        &json!({
            "providers": crawclaw_providers::native_provider_ids(),
            "transports": crawclaw_providers::native_provider_transports(),
            "providerPlugins": crawclaw_providers::bundled_provider_plugin_metadata(),
            "providerDescriptors": crawclaw_providers::bundled_provider_descriptors(),
            "providerAuthChoices": crawclaw_providers::bundled_provider_auth_choices(),
            "providerSetupOptions": crawclaw_providers::bundled_provider_setup_options(),
            "providerModelPickerEntries": crawclaw_providers::bundled_provider_model_picker_entries(),
            "webProviderBoundaries": crawclaw_providers::bundled_web_provider_boundaries(),
            "defaultModels": crawclaw_providers::bundled_provider_default_models(),
        }),
    )?;
    write_json_file(
        &plugins_dir.join("manifest.json"),
        &json!({
            "readModel": true,
            "jsPluginRuntime": "none",
            "nativeChannels": crawclaw_plugin_host::native_channel_ids(),
        }),
    )?;
    Ok(())
}

fn write_json_file(path: &Path, value: &Value) -> Result<(), String> {
    let raw = serde_json::to_vec_pretty(value)
        .map_err(|error| format!("failed to serialize {}: {error}", path.display()))?;
    fs::write(path, raw).map_err(|error| format!("failed to write {}: {error}", path.display()))
}

fn required_runtime_files(layout: &RuntimeLayout) -> Vec<PathBuf> {
    vec![
        layout.runtime_root.clone(),
        layout.binary_path.clone(),
        layout.gateway_binary_path(),
        layout.native_plugins_binary_path(),
        layout.channel_manifest_path.clone(),
        layout.manifest_path.clone(),
    ]
}

#[cfg(unix)]
fn first_non_executable_runtime_binary(layout: &RuntimeLayout) -> Option<String> {
    use std::os::unix::fs::PermissionsExt;
    for path in [
        layout.binary_path.as_path(),
        layout.gateway_binary_path().as_path(),
        layout.native_plugins_binary_path().as_path(),
    ] {
        let metadata = fs::metadata(path).ok()?;
        if metadata.permissions().mode() & 0o111 == 0 {
            return Some(format!(
                "Embedded Rust runtime binary is not executable: {}",
                path.display()
            ));
        }
    }
    None
}

#[cfg(not(unix))]
fn first_non_executable_runtime_binary(_layout: &RuntimeLayout) -> Option<String> {
    None
}

fn compat_status(status: &RuntimeStatusValue) -> RuntimeCompatStatus {
    let _ = status;
    RuntimeCompatStatus::default()
}

fn path_to_string(path: &Path) -> String {
    path.to_string_lossy().to_string()
}

#[derive(Clone)]
pub struct AgentRuntime {
    runtime_root: PathBuf,
    pi_agent_backend: Arc<dyn AgentRuntimeBackend>,
    native_provider_backend: Arc<dyn AgentRuntimeBackend>,
}

pub struct AgentRuntimeRequest<'a> {
    pub runtime_root: &'a Path,
    pub thread_id: &'a str,
    pub user_text: &'a str,
    pub history: Vec<AgentRuntimeMessage>,
    pub provider_config: NativeProviderConfig,
    pub reasoning_level: Option<String>,
    pub enabled_tools: Vec<String>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AgentRuntimeMessage {
    pub role: AgentRuntimeMessageRole,
    pub content: String,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum AgentRuntimeMessageRole {
    User,
    Assistant,
}

#[derive(Clone, Copy, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum RustCoreToolStatus {
    RustNative,
    PendingNative,
}

#[derive(Clone, Copy, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RustCoreToolDefinition {
    pub id: &'static str,
    pub backing_runtime_id: &'static str,
    pub status: RustCoreToolStatus,
    pub default_enabled: bool,
    pub read_only: bool,
    pub label: &'static str,
    pub description: &'static str,
    pub section_id: &'static str,
    pub default_profiles: &'static [&'static str],
    pub lifecycle: &'static str,
    #[serde(rename = "includeInCrawClawGroup")]
    pub include_in_crawclaw_group: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RustAgentToolDescriptor {
    pub name: String,
    pub label: String,
    pub description: String,
    pub parameters: Value,
    pub read_only: bool,
}

#[derive(Clone, Copy, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RustCoreToolSection {
    pub id: &'static str,
    pub label: &'static str,
}

const PROFILE_MINIMAL_CODING_FULL: &[&str] = &["minimal", "coding", "full"];
const PROFILE_CODING_FULL: &[&str] = &["coding", "full"];
const PROFILE_MESSAGING: &[&str] = &["messaging"];
const PROFILE_FULL: &[&str] = &["full"];
const PROFILE_NONE: &[&str] = &[];

const RUST_CORE_TOOL_SECTIONS: &[RustCoreToolSection] = &[
    RustCoreToolSection {
        id: "fs",
        label: "Files",
    },
    RustCoreToolSection {
        id: "runtime",
        label: "Runtime",
    },
    RustCoreToolSection {
        id: "web",
        label: "Web",
    },
    RustCoreToolSection {
        id: "sessions",
        label: "Sessions",
    },
    RustCoreToolSection {
        id: "ui",
        label: "UI",
    },
    RustCoreToolSection {
        id: "messaging",
        label: "Messaging",
    },
    RustCoreToolSection {
        id: "automation",
        label: "Automation",
    },
    RustCoreToolSection {
        id: "skills",
        label: "Skills",
    },
    RustCoreToolSection {
        id: "workflow",
        label: "Workflow",
    },
    RustCoreToolSection {
        id: "review",
        label: "Review",
    },
    RustCoreToolSection {
        id: "memory",
        label: "Memory",
    },
    RustCoreToolSection {
        id: "session_summary",
        label: "Session Summary",
    },
    RustCoreToolSection {
        id: "media",
        label: "Media",
    },
];

const fn core_tool(
    id: &'static str,
    label: &'static str,
    description: &'static str,
    section_id: &'static str,
    default_profiles: &'static [&'static str],
    read_only: bool,
    include_in_crawclaw_group: bool,
) -> RustCoreToolDefinition {
    RustCoreToolDefinition {
        id,
        backing_runtime_id: id,
        status: RustCoreToolStatus::RustNative,
        default_enabled: true,
        read_only,
        label,
        description,
        section_id,
        default_profiles,
        lifecycle: "profile_default",
        include_in_crawclaw_group,
    }
}

const fn special_agent_tool(
    id: &'static str,
    label: &'static str,
    description: &'static str,
    section_id: &'static str,
    read_only: bool,
) -> RustCoreToolDefinition {
    RustCoreToolDefinition {
        lifecycle: "special_agent_only",
        ..core_tool(
            id,
            label,
            description,
            section_id,
            PROFILE_NONE,
            read_only,
            false,
        )
    }
}

const RUST_CORE_TOOL_DEFINITIONS: &[RustCoreToolDefinition] = &[
    core_tool(
        "read",
        "read",
        "Read file contents",
        "fs",
        PROFILE_MINIMAL_CODING_FULL,
        true,
        false,
    ),
    core_tool(
        "write",
        "write",
        "Create or overwrite files",
        "fs",
        PROFILE_CODING_FULL,
        false,
        false,
    ),
    core_tool(
        "edit",
        "edit",
        "Make precise edits",
        "fs",
        PROFILE_CODING_FULL,
        false,
        false,
    ),
    core_tool(
        "apply_patch",
        "apply_patch",
        "Patch files",
        "fs",
        PROFILE_CODING_FULL,
        false,
        false,
    ),
    core_tool(
        "bash",
        "bash",
        "Run shell commands",
        "runtime",
        PROFILE_CODING_FULL,
        false,
        false,
    ),
    core_tool(
        "process",
        "process",
        "Manage background processes",
        "runtime",
        PROFILE_CODING_FULL,
        false,
        false,
    ),
    core_tool(
        "grep",
        "grep",
        "Search file contents",
        "runtime",
        PROFILE_MINIMAL_CODING_FULL,
        true,
        false,
    ),
    core_tool(
        "find",
        "find",
        "Find files and directories",
        "runtime",
        PROFILE_MINIMAL_CODING_FULL,
        true,
        false,
    ),
    core_tool(
        "ls",
        "ls",
        "List directory contents",
        "runtime",
        PROFILE_MINIMAL_CODING_FULL,
        true,
        false,
    ),
    core_tool(
        "web_search",
        "web_search",
        "Search the web",
        "web",
        PROFILE_CODING_FULL,
        true,
        true,
    ),
    core_tool(
        "web_fetch",
        "web_fetch",
        "Fetch web content",
        "web",
        PROFILE_CODING_FULL,
        true,
        true,
    ),
    core_tool(
        "session_status",
        "session_status",
        "Session status",
        "sessions",
        PROFILE_MINIMAL_CODING_FULL,
        true,
        true,
    ),
    core_tool(
        "sessions_list",
        "sessions_list",
        "List sessions",
        "sessions",
        PROFILE_MINIMAL_CODING_FULL,
        true,
        true,
    ),
    core_tool(
        "sessions_history",
        "sessions_history",
        "Session history",
        "sessions",
        PROFILE_MINIMAL_CODING_FULL,
        true,
        true,
    ),
    core_tool(
        "sessions_send",
        "sessions_send",
        "Send to session",
        "sessions",
        PROFILE_CODING_FULL,
        false,
        true,
    ),
    core_tool(
        "sessions_spawn",
        "sessions_spawn",
        "Spawn sub-agent",
        "sessions",
        PROFILE_CODING_FULL,
        false,
        true,
    ),
    core_tool(
        "sessions_yield",
        "sessions_yield",
        "End turn to receive sub-agent results",
        "sessions",
        PROFILE_CODING_FULL,
        false,
        true,
    ),
    core_tool(
        "subagents",
        "subagents",
        "Manage sub-agents",
        "sessions",
        PROFILE_CODING_FULL,
        true,
        true,
    ),
    core_tool(
        "canvas",
        "canvas",
        "Control canvases",
        "ui",
        PROFILE_NONE,
        true,
        true,
    ),
    core_tool(
        "message",
        "message",
        "Send messages",
        "messaging",
        PROFILE_MESSAGING,
        false,
        true,
    ),
    core_tool(
        "cron",
        "cron",
        "Schedule tasks",
        "automation",
        PROFILE_FULL,
        false,
        true,
    ),
    core_tool(
        "image",
        "image",
        "Image understanding",
        "media",
        PROFILE_FULL,
        true,
        true,
    ),
    core_tool(
        "pdf",
        "pdf",
        "PDF analysis",
        "media",
        PROFILE_FULL,
        true,
        true,
    ),
    core_tool(
        "tts",
        "tts",
        "Text-to-speech conversion",
        "media",
        PROFILE_CODING_FULL,
        false,
        true,
    ),
    core_tool(
        "discover_skills",
        "discover_skills",
        "Search available skills",
        "skills",
        PROFILE_CODING_FULL,
        true,
        true,
    ),
    core_tool(
        "workflow",
        "workflow",
        "Manage and run workflows",
        "workflow",
        PROFILE_FULL,
        false,
        true,
    ),
    core_tool(
        "workflowize",
        "workflowize",
        "Create workflow drafts",
        "workflow",
        PROFILE_FULL,
        false,
        true,
    ),
    core_tool(
        "review_task",
        "review_task",
        "Review task completion",
        "review",
        PROFILE_FULL,
        true,
        true,
    ),
    core_tool(
        "write_experience_note",
        "write_experience_note",
        "Write reusable experience notes",
        "memory",
        PROFILE_CODING_FULL,
        false,
        true,
    ),
    special_agent_tool(
        "memory_manifest_read",
        "memory_manifest_read",
        "Read scoped durable-memory manifest",
        "memory",
        true,
    ),
    special_agent_tool(
        "memory_note_read",
        "memory_note_read",
        "Read scoped durable-memory notes",
        "memory",
        true,
    ),
    special_agent_tool(
        "memory_note_write",
        "memory_note_write",
        "Write scoped durable-memory notes",
        "memory",
        false,
    ),
    special_agent_tool(
        "memory_note_edit",
        "memory_note_edit",
        "Edit scoped durable-memory notes",
        "memory",
        false,
    ),
    special_agent_tool(
        "memory_note_delete",
        "memory_note_delete",
        "Delete scoped durable-memory notes",
        "memory",
        false,
    ),
    special_agent_tool(
        "session_summary_file_read",
        "session_summary_file_read",
        "Read session-summary files",
        "session_summary",
        true,
    ),
    special_agent_tool(
        "session_summary_file_edit",
        "session_summary_file_edit",
        "Edit session-summary files",
        "session_summary",
        false,
    ),
];

pub fn rust_core_tool_definitions() -> &'static [RustCoreToolDefinition] {
    RUST_CORE_TOOL_DEFINITIONS
}

pub fn rust_core_tool_sections() -> &'static [RustCoreToolSection] {
    RUST_CORE_TOOL_SECTIONS
}

pub fn native_plugin_descriptors() -> Vec<crawclaw_plugin_sdk::NativePluginDescriptor> {
    crawclaw_native_plugins::registry::builtin_native_plugin_descriptors()
}

pub fn native_plugin_tool_descriptors() -> Vec<(String, crawclaw_plugin_sdk::NativeToolDescriptor)>
{
    crawclaw_native_plugins::registry::builtin_native_tool_descriptors()
}

pub fn rust_tool_catalog_json_payload() -> Value {
    let native_tools = native_plugin_tool_descriptors()
        .into_iter()
        .map(|(plugin_id, descriptor)| {
            json!({
                "id": descriptor.name,
                "label": descriptor.label,
                "description": descriptor.description,
                "sectionId": "runtime",
                "defaultProfiles": descriptor.default_profiles,
                "lifecycle": "runtime_conditional",
                "includeInCrawClawGroup": true,
                "defaultEnabled": descriptor.default_enabled,
                "readOnly": descriptor.read_only,
                "status": "rust-native",
                "source": "native-plugin",
                "pluginId": plugin_id
            })
        })
        .collect::<Vec<_>>();

    json!({
        "sections": rust_core_tool_sections(),
        "coreTools": rust_core_tool_definitions(),
        "nativeTools": native_tools
    })
}

pub fn render_rust_tool_catalog_artifact() -> String {
    format!(
        "{}\n",
        serde_json::to_string_pretty(&rust_tool_catalog_json_payload())
            .expect("Rust tool catalog encodes as JSON")
    )
}

pub fn write_rust_tool_catalog_artifact(
    output_path: impl AsRef<Path>,
    check: bool,
) -> Result<GeneratedModuleWriteResult, String> {
    let output_path = output_path.as_ref().to_path_buf();
    let next = render_rust_tool_catalog_artifact();
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

pub fn native_plugin_registry(runtime_root: &Path) -> NativePluginRegistry {
    load_native_plugin_registry(runtime_root)
}

pub fn native_plugin_descriptors_for_runtime_root(
    runtime_root: &Path,
) -> Vec<crawclaw_plugin_sdk::NativePluginDescriptor> {
    native_plugin_registry(runtime_root).descriptors()
}

pub fn native_plugin_tool_descriptors_for_runtime_root(
    runtime_root: &Path,
) -> Vec<(String, crawclaw_plugin_sdk::NativeToolDescriptor)> {
    native_plugin_registry(runtime_root).tool_descriptors()
}

pub fn pi_agent_rust_tool_names() -> Vec<String> {
    let mut names = RUST_CORE_TOOL_DEFINITIONS
        .iter()
        .map(|definition| definition.id)
        .map(ToString::to_string)
        .collect::<Vec<_>>();
    let native_names = native_plugin_tool_descriptors()
        .into_iter()
        .map(|(_, descriptor)| descriptor.name)
        .collect::<Vec<_>>();
    let insert_at = names
        .iter()
        .position(|name| name == "grep")
        .unwrap_or(names.len());
    names.splice(insert_at..insert_at, native_names);
    names
}

pub fn pi_agent_rust_tool_names_for_runtime_root(runtime_root: &Path) -> Vec<String> {
    let mut names = RUST_CORE_TOOL_DEFINITIONS
        .iter()
        .map(|definition| definition.id)
        .map(ToString::to_string)
        .collect::<Vec<_>>();
    let native_names = native_plugin_tool_descriptors_for_runtime_root(runtime_root)
        .into_iter()
        .map(|(_, descriptor)| descriptor.name)
        .collect::<Vec<_>>();
    let insert_at = names
        .iter()
        .position(|name| name == "grep")
        .unwrap_or(names.len());
    names.splice(insert_at..insert_at, native_names);
    names
}

pub fn pi_agent_rust_tool_descriptors_for_runtime_root(
    runtime_root: &Path,
) -> Vec<RustAgentToolDescriptor> {
    build_pi_agent_rust_tool_registry(runtime_root)
        .tools()
        .iter()
        .map(|tool| RustAgentToolDescriptor {
            name: tool.name().to_string(),
            label: tool.label().to_string(),
            description: tool.description().to_string(),
            parameters: tool.parameters(),
            read_only: tool.is_read_only(),
        })
        .collect()
}

#[doc(hidden)]
pub fn build_pi_agent_rust_tool_registry_for_test(runtime_root: &Path) -> pi::sdk::ToolRegistry {
    build_pi_agent_rust_tool_registry(runtime_root)
}

pub async fn execute_rust_core_tool(
    runtime_root: &Path,
    tool_name: &str,
    input: Value,
) -> Result<Value, String> {
    let registry = build_pi_agent_rust_tool_registry(runtime_root);
    let tool = registry
        .get(tool_name)
        .ok_or_else(|| format!("unknown Rust runtime tool: {tool_name}"))?;
    let output = tool
        .execute("runtime-worker", input, None)
        .await
        .map_err(|error| error.to_string())?;
    Ok(tool_output_to_value(&output))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct NativePluginInvokeWorkerRequest {
    plugin_id: String,
    operation: String,
    #[serde(default)]
    input: Value,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct NativePluginServiceWorkerRequest {
    plugin_id: String,
    service_id: String,
    #[serde(default = "default_true")]
    start: bool,
    #[serde(default)]
    input: Value,
}

fn default_true() -> bool {
    true
}

fn native_target_matches(
    target: &NativeInvocationTarget,
    plugin_id: &str,
    operation: &str,
) -> bool {
    target.plugin_id == plugin_id && target.operation == operation
}

fn native_descriptor_declares_invocation(
    descriptor: &NativePluginDescriptor,
    plugin_id: &str,
    operation: &str,
) -> bool {
    descriptor
        .tools
        .iter()
        .any(|entry| native_target_matches(&entry.invocation, plugin_id, operation))
        || descriptor
            .gateway_methods
            .iter()
            .any(|entry| native_target_matches(&entry.invocation, plugin_id, operation))
        || descriptor
            .web_search_providers
            .iter()
            .any(|entry| native_target_matches(&entry.invocation, plugin_id, operation))
        || descriptor
            .web_fetch_providers
            .iter()
            .any(|entry| native_target_matches(&entry.invocation, plugin_id, operation))
        || descriptor
            .speech_providers
            .iter()
            .any(|entry| native_target_matches(&entry.synthesize, plugin_id, operation))
        || descriptor
            .media_understanding_providers
            .iter()
            .any(|entry| native_target_matches(&entry.invocation, plugin_id, operation))
        || descriptor.services.iter().any(|entry| {
            native_target_matches(&entry.start, plugin_id, operation)
                || native_target_matches(&entry.stop, plugin_id, operation)
        })
}

pub async fn execute_native_plugin_invoke_operation(
    runtime_root: &Path,
    input: Value,
) -> Result<Value, String> {
    let request = serde_json::from_value::<NativePluginInvokeWorkerRequest>(input)
        .map_err(|error| format!("invalid native_plugin_invoke request: {error}"))?;
    let registry = load_native_plugin_registry(runtime_root);
    let entry = registry
        .entries
        .into_iter()
        .find(|entry| entry.descriptor.plugin_id == request.plugin_id)
        .ok_or_else(|| format!("unknown native plugin: {}", request.plugin_id))?;
    if !native_descriptor_declares_invocation(
        &entry.descriptor,
        &request.plugin_id,
        &request.operation,
    ) {
        return Err(format!(
            "native plugin operation is not declared by descriptor: {}/{}",
            request.plugin_id, request.operation
        ));
    }
    let runtime = entry.runtime;
    let input = if matches!(&runtime, NativePluginRuntime::Builtin) {
        with_native_runtime_context(runtime_root, request.input)
    } else {
        request.input
    };
    invoke_native_plugin_operation(
        runtime,
        NativeInvocationTarget {
            plugin_id: request.plugin_id,
            operation: request.operation,
        },
        input,
    )
    .await
}

pub async fn execute_native_plugin_service_lifecycle_operation(
    runtime_root: &Path,
    input: Value,
) -> Result<Value, String> {
    let request = serde_json::from_value::<NativePluginServiceWorkerRequest>(input)
        .map_err(|error| format!("invalid native_plugin_service request: {error}"))?;
    let registry = load_native_plugin_registry(runtime_root);
    let is_builtin = registry
        .entries
        .iter()
        .find(|entry| entry.descriptor.plugin_id == request.plugin_id)
        .map(|entry| matches!(&entry.runtime, NativePluginRuntime::Builtin))
        .unwrap_or(false);
    let input = if is_builtin {
        with_native_runtime_context(runtime_root, request.input)
    } else {
        request.input
    };
    dispatch_native_service_lifecycle(
        registry,
        &request.plugin_id,
        &request.service_id,
        request.start,
        input,
    )
    .await
}

pub async fn execute_agent_run_turn_operation(
    runtime_root: &Path,
    input: Value,
) -> Result<Value, String> {
    let request = serde_json::from_value::<AgentRunRequest>(input)
        .map_err(|error| format!("invalid agent_run_turn request: {error}"))?;
    let result = AgentRuntime::new(runtime_root.to_path_buf())
        .run_turn(request)
        .await
        .map_err(|error| format!("{}: {}", error.code(), error.message()))?;
    serde_json::to_value(result)
        .map_err(|error| format!("failed to serialize agent_run_turn result: {error}"))
}

pub async fn execute_memory_runtime_operation(
    runtime_root: &Path,
    operation: &str,
    input: Value,
) -> Result<Value, String> {
    memory::execute_memory_runtime_operation(runtime_root, operation, input).await
}

pub async fn execute_cron_runtime_operation(
    runtime_root: &Path,
    operation: &str,
    input: Value,
) -> Result<Value, String> {
    cron::execute_cron_runtime_operation(runtime_root, operation, input).await
}

fn tool_output_to_value(output: &pi::sdk::ToolOutput) -> Value {
    let mut text_blocks = Vec::new();
    let content = output
        .content
        .iter()
        .map(|block| match block {
            pi::sdk::ContentBlock::Text(text) => {
                text_blocks.push(text.text.clone());
                json!({ "type": "text", "text": text.text })
            }
            pi::sdk::ContentBlock::Image(image) => json!({
                "type": "image",
                "data": image.data,
                "mimeType": image.mime_type
            }),
            _ => {
                let text = "unsupported tool content block".to_string();
                text_blocks.push(text.clone());
                json!({ "type": "text", "text": text })
            }
        })
        .collect::<Vec<_>>();
    json!({
        "content": content,
        "text": text_blocks.join("\n"),
        "details": output.details,
        "isError": output.is_error
    })
}

pub trait AgentRuntimeBackend: Send + Sync {
    fn send_message<'a>(
        &'a self,
        request: AgentRuntimeRequest<'a>,
    ) -> Pin<Box<dyn Future<Output = Result<String, AgentRuntimeError>> + Send + 'a>>;
}

#[derive(Clone, Default)]
pub struct PiAgentRuntimeBackend;

#[derive(Clone, Default)]
pub struct NativeProviderRuntimeBackend;

#[derive(Clone, Default)]
pub struct ProviderResolver;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AgentSendResult {
    pub thread_id: String,
    pub user_text: String,
    pub assistant_text: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AgentRunResult {
    pub run_id: String,
    pub session_key: String,
    pub assistant_text: String,
    pub events: Vec<AgentRunEvent>,
}

#[derive(Clone)]
pub struct DesktopMemoryStore {
    store_path: PathBuf,
}

#[derive(Clone)]
pub struct DesktopPreferencesStore {
    store_path: PathBuf,
}

#[derive(Clone)]
pub struct DesktopSessionStore {
    sessions_dir: PathBuf,
    metadata_path: PathBuf,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DesktopMemoryRecord {
    pub id: String,
    pub agent_id: String,
    pub title: String,
    pub summary: String,
    pub content: String,
    pub category: String,
    pub tags: Vec<String>,
    pub source: String,
    pub updated_at: String,
    pub archived: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DesktopPreferencesRecord {
    pub selected_model: String,
    pub selected_thinking: String,
    pub permission_mode: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DesktopSessionRecord {
    pub thread_id: String,
    pub title: String,
    pub pinned: bool,
    pub result_items: Vec<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DesktopSessionSummary {
    pub key: String,
    pub title: String,
    pub pinned: bool,
    pub status: String,
    pub message_count: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub spawned_by: Option<String>,
    pub yielded: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DesktopSessionStatus {
    pub key: String,
    pub title: String,
    pub pinned: bool,
    pub status: String,
    pub message_count: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub spawned_by: Option<String>,
    pub yielded: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DesktopSessionMessage {
    pub role: String,
    pub content: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source: Option<String>,
}

#[derive(Debug, PartialEq, Eq)]
pub enum DesktopMemoryStoreError {
    Io(String),
    Invalid(String),
}

impl std::fmt::Display for DesktopMemoryStoreError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Io(message) | Self::Invalid(message) => formatter.write_str(message),
        }
    }
}

impl std::error::Error for DesktopMemoryStoreError {}

#[derive(Debug, PartialEq, Eq)]
pub enum DesktopPreferencesStoreError {
    Io(String),
    Invalid(String),
}

impl std::fmt::Display for DesktopPreferencesStoreError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Io(message) | Self::Invalid(message) => formatter.write_str(message),
        }
    }
}

impl std::error::Error for DesktopPreferencesStoreError {}

#[derive(Debug, PartialEq, Eq)]
pub enum DesktopSessionStoreError {
    Io(String),
    Invalid(String),
}

impl std::fmt::Display for DesktopSessionStoreError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Io(message) | Self::Invalid(message) => formatter.write_str(message),
        }
    }
}

impl std::error::Error for DesktopSessionStoreError {}

#[derive(Clone)]
pub struct DesktopAgentStore {
    store_path: PathBuf,
}

#[derive(Debug, PartialEq, Eq)]
pub enum DesktopAgentStoreError {
    Io(String),
    Invalid(String),
}

impl std::fmt::Display for DesktopAgentStoreError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Io(message) | Self::Invalid(message) => formatter.write_str(message),
        }
    }
}

impl std::error::Error for DesktopAgentStoreError {}

impl DesktopAgentStore {
    pub fn new(runtime_root: PathBuf) -> Self {
        Self {
            store_path: runtime_root.join("agents").join("desktop-agents.json"),
        }
    }

    pub fn load_agents(&self) -> Result<Vec<serde_json::Value>, DesktopAgentStoreError> {
        let raw = match fs::read_to_string(&self.store_path) {
            Ok(raw) => raw,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
            Err(error) => {
                return Err(DesktopAgentStoreError::Io(format!(
                    "Failed to read desktop agent store: {error}"
                )));
            }
        };
        serde_json::from_str(&raw).map_err(|error| {
            DesktopAgentStoreError::Invalid(format!("Invalid desktop agent store: {error}"))
        })
    }

    pub fn upsert_agent(
        &self,
        agent_id: &str,
        agent: serde_json::Value,
    ) -> Result<(), DesktopAgentStoreError> {
        let mut agents = self.load_agents()?;
        if let Some(existing) = agents
            .iter_mut()
            .find(|agent| agent.get("id").and_then(serde_json::Value::as_str) == Some(agent_id))
        {
            *existing = agent;
        } else {
            agents.push(agent);
        }
        self.save_agents(&agents)
    }

    fn save_agents(&self, agents: &[serde_json::Value]) -> Result<(), DesktopAgentStoreError> {
        if let Some(parent) = self.store_path.parent() {
            fs::create_dir_all(parent).map_err(|error| {
                DesktopAgentStoreError::Io(format!(
                    "Failed to create desktop agent store directory: {error}"
                ))
            })?;
        }
        fs::write(
            &self.store_path,
            serde_json::to_vec_pretty(agents).map_err(|error| {
                DesktopAgentStoreError::Invalid(format!(
                    "Failed to serialize desktop agent store: {error}"
                ))
            })?,
        )
        .map_err(|error| {
            DesktopAgentStoreError::Io(format!("Failed to write desktop agent store: {error}"))
        })
    }
}

impl DesktopMemoryStore {
    pub fn new(runtime_root: PathBuf) -> Self {
        Self {
            store_path: runtime_root.join("memory").join("desktop-items.json"),
        }
    }

    pub fn load_items(&self) -> Result<Vec<DesktopMemoryRecord>, DesktopMemoryStoreError> {
        let raw = match fs::read_to_string(&self.store_path) {
            Ok(raw) => raw,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
            Err(error) => {
                return Err(DesktopMemoryStoreError::Io(format!(
                    "Failed to read desktop memory store: {error}"
                )));
            }
        };
        serde_json::from_str(&raw).map_err(|error| {
            DesktopMemoryStoreError::Invalid(format!("Invalid desktop memory store: {error}"))
        })
    }

    pub fn upsert_item(&self, item: DesktopMemoryRecord) -> Result<(), DesktopMemoryStoreError> {
        let mut items = self.load_items()?;
        if let Some(existing) = items.iter_mut().find(|existing| existing.id == item.id) {
            *existing = item;
        } else {
            items.push(item);
        }
        self.save_items(&items)
    }

    pub fn archive_item(&self, item_id: &str) -> Result<bool, DesktopMemoryStoreError> {
        let mut items = self.load_items()?;
        let mut changed = false;
        for item in &mut items {
            if item.id == item_id {
                item.archived = true;
                item.updated_at = "刚刚".to_string();
                changed = true;
            }
        }
        if changed {
            self.save_items(&items)?;
        }
        Ok(changed)
    }

    fn save_items(&self, items: &[DesktopMemoryRecord]) -> Result<(), DesktopMemoryStoreError> {
        if let Some(parent) = self.store_path.parent() {
            fs::create_dir_all(parent).map_err(|error| {
                DesktopMemoryStoreError::Io(format!(
                    "Failed to create desktop memory store directory: {error}"
                ))
            })?;
        }
        fs::write(
            &self.store_path,
            serde_json::to_vec_pretty(items).map_err(|error| {
                DesktopMemoryStoreError::Invalid(format!(
                    "Failed to serialize desktop memory store: {error}"
                ))
            })?,
        )
        .map_err(|error| {
            DesktopMemoryStoreError::Io(format!("Failed to write desktop memory store: {error}"))
        })
    }
}

impl DesktopPreferencesStore {
    pub fn new(runtime_root: PathBuf) -> Self {
        Self {
            store_path: runtime_root.join("config").join("desktop-preferences.json"),
        }
    }

    pub fn load_preferences(
        &self,
    ) -> Result<Option<DesktopPreferencesRecord>, DesktopPreferencesStoreError> {
        let raw = match fs::read_to_string(&self.store_path) {
            Ok(raw) => raw,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(error) => {
                return Err(DesktopPreferencesStoreError::Io(format!(
                    "Failed to read desktop preferences store: {error}"
                )));
            }
        };
        serde_json::from_str(&raw).map(Some).map_err(|error| {
            DesktopPreferencesStoreError::Invalid(format!(
                "Invalid desktop preferences store: {error}"
            ))
        })
    }

    pub fn save_preferences(
        &self,
        preferences: &DesktopPreferencesRecord,
    ) -> Result<(), DesktopPreferencesStoreError> {
        if let Some(parent) = self.store_path.parent() {
            fs::create_dir_all(parent).map_err(|error| {
                DesktopPreferencesStoreError::Io(format!(
                    "Failed to create desktop preferences store directory: {error}"
                ))
            })?;
        }
        fs::write(
            &self.store_path,
            serde_json::to_vec_pretty(preferences).map_err(|error| {
                DesktopPreferencesStoreError::Invalid(format!(
                    "Failed to serialize desktop preferences store: {error}"
                ))
            })?,
        )
        .map_err(|error| {
            DesktopPreferencesStoreError::Io(format!(
                "Failed to write desktop preferences store: {error}"
            ))
        })
    }
}

impl DesktopSessionStore {
    pub fn new(runtime_root: PathBuf) -> Self {
        let sessions_dir = runtime_root.join("sessions");
        Self {
            metadata_path: sessions_dir.join("desktop-session-metadata.json"),
            sessions_dir,
        }
    }

    pub fn load_sessions(&self) -> Result<Vec<DesktopSessionRecord>, DesktopSessionStoreError> {
        let metadata_by_thread = self.load_metadata_map()?;
        let entries = match fs::read_dir(&self.sessions_dir) {
            Ok(entries) => entries,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
            Err(error) => {
                return Err(DesktopSessionStoreError::Io(format!(
                    "Failed to read desktop session directory: {error}"
                )));
            }
        };

        let mut sessions = Vec::new();
        for entry in entries {
            let path = entry
                .map_err(|error| {
                    DesktopSessionStoreError::Io(format!(
                        "Failed to read desktop session entry: {error}"
                    ))
                })?
                .path();
            if path.extension().and_then(|extension| extension.to_str()) != Some("jsonl") {
                continue;
            }
            let thread_id = path
                .file_stem()
                .and_then(|stem| stem.to_str())
                .filter(|stem| !stem.is_empty())
                .map(ToOwned::to_owned)
                .ok_or_else(|| {
                    DesktopSessionStoreError::Invalid(format!(
                        "Invalid desktop session filename: {}",
                        path.display()
                    ))
                })?;
            let metadata = metadata_by_thread.get(&thread_id);
            if metadata.map(|metadata| metadata.archived).unwrap_or(false) {
                continue;
            }
            let raw = fs::read_to_string(&path).map_err(|error| {
                DesktopSessionStoreError::Io(format!(
                    "Failed to read desktop session transcript: {error}"
                ))
            })?;
            let transcript_entries = parse_transcript_entries(&raw, &path)?;
            let title = metadata
                .and_then(|metadata| metadata.title.clone())
                .unwrap_or_else(|| {
                    transcript_entries
                        .iter()
                        .find(|entry| entry.role == "user")
                        .map(|entry| title_from_transcript_text(&entry.content))
                        .unwrap_or_else(|| thread_id.clone())
                });
            let result_items = transcript_entries
                .into_iter()
                .filter_map(transcript_result_item)
                .collect();
            sessions.push(DesktopSessionRecord {
                thread_id,
                title,
                pinned: metadata.map(|metadata| metadata.pinned).unwrap_or(false),
                result_items,
            });
        }
        sessions.sort_by(|left, right| left.thread_id.cmp(&right.thread_id));
        Ok(sessions)
    }

    pub fn load_session(
        &self,
        thread_id: &str,
    ) -> Result<Option<DesktopSessionRecord>, DesktopSessionStoreError> {
        Ok(self
            .load_sessions()?
            .into_iter()
            .find(|session| session.thread_id == thread_id))
    }

    pub fn session_transcript_path(
        &self,
        thread_id: &str,
    ) -> Result<PathBuf, DesktopSessionStoreError> {
        self.transcript_path(thread_id)
    }

    pub fn create_session(
        &self,
        thread_id: &str,
        title: Option<&str>,
        model: Option<&str>,
    ) -> Result<DesktopSessionStatus, DesktopSessionStoreError> {
        let transcript_path = self.transcript_path(thread_id)?;
        if let Some(parent) = transcript_path.parent() {
            fs::create_dir_all(parent).map_err(|error| {
                DesktopSessionStoreError::Io(format!(
                    "Failed to create desktop session directory: {error}"
                ))
            })?;
        }
        fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&transcript_path)
            .map_err(|error| {
                DesktopSessionStoreError::Io(format!(
                    "Failed to create desktop session transcript: {error}"
                ))
            })?;
        self.update_thread_metadata(thread_id, |metadata| {
            if let Some(title) = title.map(str::trim).filter(|value| !value.is_empty()) {
                metadata.title = Some(title.to_string());
            }
            if let Some(model) = model.map(str::trim).filter(|value| !value.is_empty()) {
                metadata.model = Some(model.to_string());
            }
            metadata.status = Some("idle".to_string());
            metadata.archived = false;
        })?;
        self.session_status(thread_id)?
            .ok_or_else(|| DesktopSessionStoreError::Invalid("session was not created".to_string()))
    }

    pub fn patch_session(
        &self,
        thread_id: &str,
        title: Option<&str>,
        model: Option<&str>,
        pinned: Option<bool>,
        status: Option<&str>,
    ) -> Result<DesktopSessionStatus, DesktopSessionStoreError> {
        self.update_thread_metadata(thread_id, |metadata| {
            if let Some(title) = title.map(str::trim).filter(|value| !value.is_empty()) {
                metadata.title = Some(title.to_string());
            }
            if let Some(model) = model.map(str::trim).filter(|value| !value.is_empty()) {
                metadata.model = Some(model.to_string());
            }
            if let Some(pinned) = pinned {
                metadata.pinned = pinned;
            }
            if let Some(status) = status.map(str::trim).filter(|value| !value.is_empty()) {
                metadata.status = Some(status.to_string());
            }
            metadata.archived = false;
        })?;
        self.session_status(thread_id)?.ok_or_else(|| {
            DesktopSessionStoreError::Invalid(format!("Unknown desktop session: {thread_id}"))
        })
    }

    pub fn resolve_session_by_label(
        &self,
        label: &str,
    ) -> Result<Option<String>, DesktopSessionStoreError> {
        let needle = label.trim();
        if needle.is_empty() {
            return Ok(None);
        }
        Ok(self
            .list_summaries()?
            .into_iter()
            .find(|session| session.title == needle || session.key == needle)
            .map(|session| session.key))
    }

    pub fn reset_session(
        &self,
        thread_id: &str,
    ) -> Result<DesktopSessionStatus, DesktopSessionStoreError> {
        let transcript_path = self.transcript_path(thread_id)?;
        if let Some(parent) = transcript_path.parent() {
            fs::create_dir_all(parent).map_err(|error| {
                DesktopSessionStoreError::Io(format!(
                    "Failed to create desktop session directory: {error}"
                ))
            })?;
        }
        fs::write(&transcript_path, b"").map_err(|error| {
            DesktopSessionStoreError::Io(format!(
                "Failed to reset desktop session transcript: {error}"
            ))
        })?;
        self.update_thread_metadata(thread_id, |metadata| {
            metadata.status = Some("idle".to_string());
            metadata.yielded = false;
            metadata.archived = false;
        })?;
        self.session_status(thread_id)?.ok_or_else(|| {
            DesktopSessionStoreError::Invalid(format!("Unknown desktop session: {thread_id}"))
        })
    }

    pub fn delete_session(&self, thread_id: &str) -> Result<bool, DesktopSessionStoreError> {
        let transcript_path = self.transcript_path(thread_id)?;
        let mut deleted = false;
        match fs::remove_file(&transcript_path) {
            Ok(()) => deleted = true,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => {
                return Err(DesktopSessionStoreError::Io(format!(
                    "Failed to delete desktop session transcript: {error}"
                )));
            }
        }
        self.update_thread_metadata(thread_id, |metadata| {
            metadata.archived = true;
            metadata.pinned = false;
            metadata.status = Some("deleted".to_string());
        })?;
        Ok(deleted)
    }

    pub fn compact_session(
        &self,
        thread_id: &str,
        max_lines: usize,
    ) -> Result<(bool, usize), DesktopSessionStoreError> {
        let transcript_path = self.transcript_path(thread_id)?;
        let raw = match fs::read_to_string(&transcript_path) {
            Ok(raw) => raw,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                return Ok((false, 0));
            }
            Err(error) => {
                return Err(DesktopSessionStoreError::Io(format!(
                    "Failed to read desktop session transcript: {error}"
                )));
            }
        };
        let lines = raw
            .lines()
            .filter(|line| !line.trim().is_empty())
            .map(ToOwned::to_owned)
            .collect::<Vec<_>>();
        if lines.len() <= max_lines {
            return Ok((false, lines.len()));
        }
        let start = lines.len().saturating_sub(max_lines);
        let kept = lines[start..].join("\n");
        fs::write(&transcript_path, format!("{kept}\n")).map_err(|error| {
            DesktopSessionStoreError::Io(format!(
                "Failed to compact desktop session transcript: {error}"
            ))
        })?;
        Ok((true, lines.len() - start))
    }

    pub fn list_summaries(&self) -> Result<Vec<DesktopSessionSummary>, DesktopSessionStoreError> {
        let metadata_by_thread = self.load_metadata_map()?;
        let mut summaries = Vec::new();
        for session in self.load_sessions()? {
            let metadata = metadata_by_thread.get(&session.thread_id);
            summaries.push(DesktopSessionSummary {
                key: session.thread_id.clone(),
                title: session.title,
                pinned: session.pinned,
                status: metadata
                    .map(|metadata| metadata.effective_status())
                    .unwrap_or_else(|| "idle".to_string()),
                message_count: session.result_items.len(),
                spawned_by: metadata.and_then(|metadata| metadata.spawned_by.clone()),
                yielded: metadata.map(|metadata| metadata.yielded).unwrap_or(false),
            });
        }
        Ok(summaries)
    }

    pub fn session_status(
        &self,
        thread_id: &str,
    ) -> Result<Option<DesktopSessionStatus>, DesktopSessionStoreError> {
        let Some(session) = self.load_session(thread_id)? else {
            return Ok(None);
        };
        let metadata_by_thread = self.load_metadata_map()?;
        let metadata = metadata_by_thread.get(thread_id);
        Ok(Some(DesktopSessionStatus {
            key: session.thread_id,
            title: session.title,
            pinned: session.pinned,
            status: metadata
                .map(|metadata| metadata.effective_status())
                .unwrap_or_else(|| "idle".to_string()),
            message_count: session.result_items.len(),
            spawned_by: metadata.and_then(|metadata| metadata.spawned_by.clone()),
            yielded: metadata.map(|metadata| metadata.yielded).unwrap_or(false),
        }))
    }

    pub fn session_history(
        &self,
        thread_id: &str,
    ) -> Result<Vec<DesktopSessionMessage>, DesktopSessionStoreError> {
        let transcript_path = self.transcript_path(thread_id)?;
        let raw = match fs::read_to_string(&transcript_path) {
            Ok(raw) => raw,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
            Err(error) => {
                return Err(DesktopSessionStoreError::Io(format!(
                    "Failed to read desktop session transcript: {error}"
                )));
            }
        };
        Ok(parse_transcript_entries(&raw, &transcript_path)?
            .into_iter()
            .map(|entry| DesktopSessionMessage {
                role: entry.role,
                content: entry.content,
                source: entry.source,
            })
            .collect())
    }

    pub fn append_message(
        &self,
        thread_id: &str,
        role: &str,
        content: &str,
        source: Option<&str>,
    ) -> Result<(), DesktopSessionStoreError> {
        let transcript_path = self.transcript_path(thread_id)?;
        if let Some(parent) = transcript_path.parent() {
            fs::create_dir_all(parent).map_err(|error| {
                DesktopSessionStoreError::Io(format!(
                    "Failed to create desktop session directory: {error}"
                ))
            })?;
        }
        let entry = DesktopTranscriptEntry {
            role: role.to_string(),
            content: content.to_string(),
            source: source.map(ToOwned::to_owned),
        };
        let mut transcript = fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&transcript_path)
            .map_err(|error| {
                DesktopSessionStoreError::Io(format!(
                    "Failed to open desktop session transcript: {error}"
                ))
            })?;
        writeln!(
            transcript,
            "{}",
            serde_json::to_string(&entry).map_err(|error| {
                DesktopSessionStoreError::Invalid(format!(
                    "Failed to serialize desktop session message: {error}"
                ))
            })?
        )
        .map_err(|error| {
            DesktopSessionStoreError::Io(format!(
                "Failed to write desktop session transcript: {error}"
            ))
        })
    }

    pub fn send_to_session(
        &self,
        thread_id: &str,
        message: &str,
    ) -> Result<DesktopSessionStatus, DesktopSessionStoreError> {
        self.append_message(thread_id, "user", message, Some("sessions_send"))?;
        self.update_thread_metadata(thread_id, |metadata| {
            metadata.status = Some("pending".to_string());
            metadata.yielded = false;
        })?;
        self.session_status(thread_id)?
            .ok_or_else(|| DesktopSessionStoreError::Invalid("session was not created".to_string()))
    }

    pub fn spawn_session(
        &self,
        parent_thread_id: Option<&str>,
        label: Option<&str>,
        task: &str,
    ) -> Result<DesktopSessionStatus, DesktopSessionStoreError> {
        let child_thread_id = format!("subagent-{}", now_millis());
        let title = label
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(ToOwned::to_owned)
            .unwrap_or_else(|| title_from_transcript_text(task));
        self.append_message(&child_thread_id, "user", task, Some("sessions_spawn"))?;
        self.update_thread_metadata(&child_thread_id, |metadata| {
            metadata.title = Some(title);
            metadata.status = Some("spawned".to_string());
            metadata.spawned_by = parent_thread_id.map(ToOwned::to_owned);
            metadata.yielded = false;
        })?;
        self.session_status(&child_thread_id)?.ok_or_else(|| {
            DesktopSessionStoreError::Invalid("subagent session missing".to_string())
        })
    }

    pub fn mark_session_yielded(
        &self,
        thread_id: &str,
    ) -> Result<DesktopSessionStatus, DesktopSessionStoreError> {
        self.update_thread_metadata(thread_id, |metadata| {
            metadata.status = Some("yielded".to_string());
            metadata.yielded = true;
        })?;
        self.session_status(thread_id)?.ok_or_else(|| {
            DesktopSessionStoreError::Invalid(format!("Unknown desktop session: {thread_id}"))
        })
    }

    pub fn list_subagents(
        &self,
        parent_thread_id: Option<&str>,
    ) -> Result<Vec<DesktopSessionSummary>, DesktopSessionStoreError> {
        Ok(self
            .list_summaries()?
            .into_iter()
            .filter(
                |session| match (parent_thread_id, session.spawned_by.as_deref()) {
                    (Some(parent), Some(spawned_by)) => spawned_by == parent,
                    (Some(_), None) => false,
                    (None, Some(_)) => true,
                    (None, None) => false,
                },
            )
            .collect())
    }

    pub fn rename_thread(
        &self,
        thread_id: &str,
        title: &str,
    ) -> Result<(), DesktopSessionStoreError> {
        self.update_thread_metadata(thread_id, |metadata| {
            metadata.title = Some(title.to_string());
        })
    }

    pub fn set_thread_pinned(
        &self,
        thread_id: &str,
        pinned: bool,
    ) -> Result<(), DesktopSessionStoreError> {
        self.update_thread_metadata(thread_id, |metadata| {
            metadata.pinned = pinned;
        })
    }

    pub fn archive_thread(&self, thread_id: &str) -> Result<(), DesktopSessionStoreError> {
        self.update_thread_metadata(thread_id, |metadata| {
            metadata.archived = true;
            metadata.pinned = false;
        })
    }

    fn update_thread_metadata(
        &self,
        thread_id: &str,
        update: impl FnOnce(&mut DesktopSessionMetadataRecord),
    ) -> Result<(), DesktopSessionStoreError> {
        validate_thread_id(thread_id)?;
        let mut metadata_by_thread = self.load_metadata_map()?;
        let metadata = metadata_by_thread
            .entry(thread_id.to_string())
            .or_insert_with(|| DesktopSessionMetadataRecord {
                thread_id: thread_id.to_string(),
                ..DesktopSessionMetadataRecord::default()
            });
        update(metadata);
        self.save_metadata_map(metadata_by_thread)
    }

    fn transcript_path(&self, thread_id: &str) -> Result<PathBuf, DesktopSessionStoreError> {
        validate_thread_id(thread_id)?;
        Ok(self.sessions_dir.join(format!("{thread_id}.jsonl")))
    }

    fn load_metadata_map(
        &self,
    ) -> Result<BTreeMap<String, DesktopSessionMetadataRecord>, DesktopSessionStoreError> {
        let raw = match fs::read_to_string(&self.metadata_path) {
            Ok(raw) => raw,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                return Ok(BTreeMap::new());
            }
            Err(error) => {
                return Err(DesktopSessionStoreError::Io(format!(
                    "Failed to read desktop session metadata: {error}"
                )));
            }
        };
        let metadata_file: DesktopSessionMetadataFile =
            serde_json::from_str(&raw).map_err(|error| {
                DesktopSessionStoreError::Invalid(format!(
                    "Invalid desktop session metadata: {error}"
                ))
            })?;
        Ok(metadata_file
            .threads
            .into_iter()
            .map(|metadata| (metadata.thread_id.clone(), metadata))
            .collect())
    }

    fn save_metadata_map(
        &self,
        metadata_by_thread: BTreeMap<String, DesktopSessionMetadataRecord>,
    ) -> Result<(), DesktopSessionStoreError> {
        fs::create_dir_all(&self.sessions_dir).map_err(|error| {
            DesktopSessionStoreError::Io(format!(
                "Failed to create desktop session metadata directory: {error}"
            ))
        })?;
        let metadata_file = DesktopSessionMetadataFile {
            threads: metadata_by_thread.into_values().collect(),
        };
        fs::write(
            &self.metadata_path,
            serde_json::to_vec_pretty(&metadata_file).map_err(|error| {
                DesktopSessionStoreError::Invalid(format!(
                    "Failed to serialize desktop session metadata: {error}"
                ))
            })?,
        )
        .map_err(|error| {
            DesktopSessionStoreError::Io(format!(
                "Failed to write desktop session metadata: {error}"
            ))
        })
    }
}

#[derive(Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct DesktopSessionMetadataFile {
    #[serde(default)]
    threads: Vec<DesktopSessionMetadataRecord>,
}

#[derive(Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct DesktopSessionMetadataRecord {
    #[serde(default)]
    thread_id: String,
    #[serde(default)]
    title: Option<String>,
    #[serde(default)]
    pinned: bool,
    #[serde(default)]
    archived: bool,
    #[serde(default)]
    status: Option<String>,
    #[serde(default)]
    spawned_by: Option<String>,
    #[serde(default)]
    yielded: bool,
    #[serde(default)]
    model: Option<String>,
}

impl DesktopSessionMetadataRecord {
    fn effective_status(&self) -> String {
        self.status
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .unwrap_or("idle")
            .to_string()
    }
}

#[derive(Clone, Serialize, Deserialize)]
struct DesktopTranscriptEntry {
    role: String,
    content: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    source: Option<String>,
}

fn parse_transcript_entries(
    raw: &str,
    path: &Path,
) -> Result<Vec<DesktopTranscriptEntry>, DesktopSessionStoreError> {
    raw.lines()
        .enumerate()
        .filter(|(_, line)| !line.trim().is_empty())
        .map(|(index, line)| {
            serde_json::from_str::<DesktopTranscriptEntry>(line).map_err(|error| {
                DesktopSessionStoreError::Invalid(format!(
                    "Invalid desktop session transcript at {}:{}: {error}",
                    path.display(),
                    index + 1
                ))
            })
        })
        .collect()
}

fn parse_agent_runtime_history(
    raw: &str,
    path: &Path,
) -> Result<Vec<AgentRuntimeMessage>, AgentRuntimeError> {
    raw.lines()
        .enumerate()
        .filter(|(_, line)| !line.trim().is_empty())
        .filter_map(|(index, line)| {
            let entry = match serde_json::from_str::<DesktopTranscriptEntry>(line) {
                Ok(entry) => entry,
                Err(error) => {
                    return Some(Err(AgentRuntimeError::TranscriptFailed(format!(
                        "Invalid Rust session transcript at {}:{}: {error}",
                        path.display(),
                        index + 1
                    ))));
                }
            };
            let role = match entry.role.as_str() {
                "user" => AgentRuntimeMessageRole::User,
                "assistant" => AgentRuntimeMessageRole::Assistant,
                _ => return None,
            };
            Some(Ok(AgentRuntimeMessage {
                role,
                content: entry.content,
            }))
        })
        .collect()
}

fn transcript_result_item(entry: DesktopTranscriptEntry) -> Option<String> {
    let content = entry.content.trim();
    if content.is_empty() {
        return None;
    }
    match entry.role.as_str() {
        "user" => Some(format!("用户: {content}")),
        "assistant" => Some(content.to_string()),
        role => Some(format!("{role}: {content}")),
    }
}

fn title_from_transcript_text(text: &str) -> String {
    let mut title = text.chars().take(32).collect::<String>();
    if text.chars().count() > 32 {
        title.push_str("...");
    }
    title
}

fn validate_thread_id(thread_id: &str) -> Result<(), DesktopSessionStoreError> {
    let trimmed = thread_id.trim();
    if trimmed.is_empty()
        || trimmed.contains('/')
        || trimmed.contains('\\')
        || trimmed == "."
        || trimmed == ".."
    {
        return Err(DesktopSessionStoreError::Invalid(format!(
            "Invalid desktop session key: {thread_id}"
        )));
    }
    Ok(())
}

fn now_millis() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or(0)
}

#[derive(Debug, PartialEq, Eq)]
pub enum AgentRuntimeError {
    ProviderUnavailable(String),
    UnsupportedProvider(String),
    ProviderFailed(String),
    TranscriptFailed(String),
}

impl AgentRuntimeError {
    pub fn code(&self) -> &'static str {
        match self {
            Self::ProviderUnavailable(_) => "provider_unavailable",
            Self::UnsupportedProvider(_) => "unsupported",
            Self::ProviderFailed(_) => "provider_failed",
            Self::TranscriptFailed(_) => "transcript_failed",
        }
    }

    pub fn message(&self) -> &str {
        match self {
            Self::ProviderUnavailable(message)
            | Self::UnsupportedProvider(message)
            | Self::ProviderFailed(message)
            | Self::TranscriptFailed(message) => message,
        }
    }
}

fn agent_run_option_string(options: &BTreeMap<String, Value>, keys: &[&str]) -> Option<String> {
    keys.iter()
        .find_map(|key| options.get(*key).and_then(Value::as_str))
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn agent_run_option_is(options: &BTreeMap<String, Value>, key: &str, expected: &str) -> bool {
    options
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .is_some_and(|value| value.eq_ignore_ascii_case(expected))
}

fn build_btw_question_prompt(question: &str) -> String {
    [
        "You are answering an ephemeral /btw side question about the current conversation.",
        "Use the conversation only as background context.",
        "Answer only the side question below.",
        "Do not continue, resume, or complete any unfinished task from the conversation.",
        "Do not emit tool calls, pseudo-tool calls, shell commands, file writes, patches, or code unless the side question explicitly asks for them.",
        "Do not say you will continue the main task after answering.",
        "If the question can be answered briefly, answer briefly.",
        "",
        "<btw_side_question>",
        question.trim(),
        "</btw_side_question>",
    ]
    .join("\n")
}

impl AgentRuntime {
    pub fn new(runtime_root: PathBuf) -> Self {
        Self {
            runtime_root,
            pi_agent_backend: Arc::new(PiAgentRuntimeBackend),
            native_provider_backend: Arc::new(NativeProviderRuntimeBackend),
        }
    }

    pub fn with_pi_agent_backend(
        runtime_root: PathBuf,
        pi_agent_backend: Arc<dyn AgentRuntimeBackend>,
    ) -> Self {
        Self {
            runtime_root,
            pi_agent_backend,
            native_provider_backend: Arc::new(NativeProviderRuntimeBackend),
        }
    }

    pub async fn run_turn(
        &self,
        request: AgentRunRequest,
    ) -> Result<AgentRunResult, AgentRuntimeError> {
        let run_id = request.run_id;
        let agent_id = request.agent_id;
        let session_key = request.session_key;
        let user_text = request.inbound.body;
        let inbound_metadata = request.inbound.metadata;
        let model = request.model;
        let options = request.options;
        if agent_run_option_is(&options, "mode", "btw") {
            let question = agent_run_option_string(&options, &["btwQuestion"]).or_else(|| {
                inbound_metadata
                    .get("btw")
                    .and_then(Value::as_object)
                    .and_then(|btw| btw.get("question"))
                    .and_then(Value::as_str)
                    .map(str::to_string)
            });
            let question = question
                .or_else(|| (!user_text.trim().is_empty()).then(|| user_text.clone()))
                .ok_or_else(|| {
                    AgentRuntimeError::ProviderFailed("No BTW question provided.".to_string())
                })?;
            return self
                .run_btw_turn(run_id, agent_id, session_key, question, model)
                .await;
        }
        let result = self
            .send_message_with_model(
                session_key.clone(),
                user_text.clone(),
                Some(&model),
                &request.enabled_tools,
            )
            .await?;
        let assistant_text = result.assistant_text;
        let mut events = vec![
            AgentRunEvent::RunStarted {
                run_id: run_id.clone(),
                agent_id,
                session_key: session_key.clone(),
            },
            AgentRunEvent::ReplyPayload {
                run_id: run_id.clone(),
                payload: ReplyPayload {
                    text: Some(assistant_text.clone()),
                    media_urls: Vec::new(),
                    metadata: BTreeMap::new(),
                },
            },
            AgentRunEvent::TranscriptAppended {
                run_id: run_id.clone(),
                session_key: session_key.clone(),
                role: TranscriptRole::Assistant,
                message_id: format!("{run_id}:assistant"),
            },
        ];
        match self.record_memory_after_turn(
            &result.thread_id,
            &session_key,
            &run_id,
            &user_text,
            &assistant_text,
        ) {
            Ok(memory_result) => events.push(AgentRunEvent::ToolResult {
                run_id: run_id.clone(),
                call_id: format!("{run_id}:memory-after-turn"),
                tool_name: "memory.afterTurn".to_string(),
                result: memory_result,
                is_error: None,
            }),
            Err(error) => events.push(AgentRunEvent::ToolResult {
                run_id: run_id.clone(),
                call_id: format!("{run_id}:memory-after-turn"),
                tool_name: "memory.afterTurn".to_string(),
                result: json!({ "error": error }),
                is_error: Some(true),
            }),
        }
        events.push(AgentRunEvent::RunCompleted {
            run_id: run_id.clone(),
        });
        Ok(AgentRunResult {
            run_id,
            session_key: result.thread_id,
            assistant_text,
            events,
        })
    }

    async fn run_btw_turn(
        &self,
        run_id: String,
        agent_id: String,
        session_key: String,
        question: String,
        model: AgentModelSelection,
    ) -> Result<AgentRunResult, AgentRuntimeError> {
        let result = self
            .send_ephemeral_message_with_model(
                session_key.clone(),
                build_btw_question_prompt(&question),
                Some(&model),
                &[],
            )
            .await?;
        let assistant_text = result.assistant_text;
        let mut metadata = BTreeMap::new();
        metadata.insert("btw".to_string(), json!({ "question": question }));
        let events = vec![
            AgentRunEvent::RunStarted {
                run_id: run_id.clone(),
                agent_id,
                session_key: session_key.clone(),
            },
            AgentRunEvent::ReplyPayload {
                run_id: run_id.clone(),
                payload: ReplyPayload {
                    text: Some(assistant_text.clone()),
                    media_urls: Vec::new(),
                    metadata,
                },
            },
            AgentRunEvent::RunCompleted {
                run_id: run_id.clone(),
            },
        ];
        Ok(AgentRunResult {
            run_id,
            session_key,
            assistant_text,
            events,
        })
    }

    pub async fn send_message(
        &self,
        thread_id: String,
        user_text: String,
    ) -> Result<AgentSendResult, AgentRuntimeError> {
        self.send_message_with_model(thread_id, user_text, None, &[])
            .await
    }

    async fn send_message_with_model(
        &self,
        thread_id: String,
        user_text: String,
        model_selection: Option<&AgentModelSelection>,
        enabled_tools: &[String],
    ) -> Result<AgentSendResult, AgentRuntimeError> {
        let config = self.read_provider_config()?;
        let history = self.load_thread_history(&thread_id)?;
        let assistant_text = match config.runtime_mode() {
            DesktopAgentRuntimeMode::PiAgentRust => {
                let mut provider_config =
                    ProviderResolver::resolve_desktop_config(&config, &self.runtime_root)?;
                apply_agent_model_selection(&mut provider_config, model_selection)?;
                self.pi_agent_backend
                    .send_message(AgentRuntimeRequest {
                        runtime_root: &self.runtime_root,
                        thread_id: &thread_id,
                        user_text: &user_text,
                        history: history.clone(),
                        provider_config,
                        reasoning_level: model_selection
                            .and_then(|model| model.reasoning_level.clone()),
                        enabled_tools: enabled_tools.to_vec(),
                    })
                    .await?
            }
            DesktopAgentRuntimeMode::NativeProvider => {
                let mut provider_config =
                    ProviderResolver::resolve_desktop_config(&config, &self.runtime_root)?;
                apply_agent_model_selection(&mut provider_config, model_selection)?;
                self.native_provider_backend
                    .send_message(AgentRuntimeRequest {
                        runtime_root: &self.runtime_root,
                        thread_id: &thread_id,
                        user_text: &user_text,
                        history: history.clone(),
                        provider_config,
                        reasoning_level: model_selection
                            .and_then(|model| model.reasoning_level.clone()),
                        enabled_tools: enabled_tools.to_vec(),
                    })
                    .await?
            }
        };

        self.append_transcript(&thread_id, &user_text, &assistant_text)?;
        Ok(AgentSendResult {
            thread_id,
            user_text,
            assistant_text,
        })
    }

    async fn send_ephemeral_message_with_model(
        &self,
        thread_id: String,
        user_text: String,
        model_selection: Option<&AgentModelSelection>,
        enabled_tools: &[String],
    ) -> Result<AgentSendResult, AgentRuntimeError> {
        let config = self.read_provider_config()?;
        let history = self.load_thread_history(&thread_id)?;
        let assistant_text = match config.runtime_mode() {
            DesktopAgentRuntimeMode::PiAgentRust => {
                let mut provider_config =
                    ProviderResolver::resolve_desktop_config(&config, &self.runtime_root)?;
                apply_agent_model_selection(&mut provider_config, model_selection)?;
                self.pi_agent_backend
                    .send_message(AgentRuntimeRequest {
                        runtime_root: &self.runtime_root,
                        thread_id: &thread_id,
                        user_text: &user_text,
                        history: history.clone(),
                        provider_config,
                        reasoning_level: model_selection
                            .and_then(|model| model.reasoning_level.clone()),
                        enabled_tools: enabled_tools.to_vec(),
                    })
                    .await?
            }
            DesktopAgentRuntimeMode::NativeProvider => {
                let mut provider_config =
                    ProviderResolver::resolve_desktop_config(&config, &self.runtime_root)?;
                apply_agent_model_selection(&mut provider_config, model_selection)?;
                self.native_provider_backend
                    .send_message(AgentRuntimeRequest {
                        runtime_root: &self.runtime_root,
                        thread_id: &thread_id,
                        user_text: &user_text,
                        history,
                        provider_config,
                        reasoning_level: model_selection
                            .and_then(|model| model.reasoning_level.clone()),
                        enabled_tools: enabled_tools.to_vec(),
                    })
                    .await?
            }
        };

        Ok(AgentSendResult {
            thread_id,
            user_text,
            assistant_text,
        })
    }

    fn read_provider_config(&self) -> Result<DesktopAgentProviderConfig, AgentRuntimeError> {
        let config_path = self
            .runtime_root
            .join("config")
            .join("desktop-agent-provider.json");
        let raw = fs::read_to_string(&config_path).map_err(|error| {
            if error.kind() == std::io::ErrorKind::NotFound {
                AgentRuntimeError::ProviderUnavailable(
                    "No Rust-native desktop agent provider is configured.".to_string(),
                )
            } else {
                AgentRuntimeError::ProviderUnavailable(format!(
                    "Failed to read desktop agent provider config: {error}"
                ))
            }
        })?;
        serde_json::from_str(&raw).map_err(|error| {
            AgentRuntimeError::ProviderUnavailable(format!(
                "Invalid desktop agent provider config: {error}"
            ))
        })
    }

    fn load_thread_history(
        &self,
        thread_id: &str,
    ) -> Result<Vec<AgentRuntimeMessage>, AgentRuntimeError> {
        let transcript_path = self
            .runtime_root
            .join("sessions")
            .join(format!("{thread_id}.jsonl"));
        let raw = match fs::read_to_string(&transcript_path) {
            Ok(raw) => raw,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
            Err(error) => {
                return Err(AgentRuntimeError::TranscriptFailed(format!(
                    "Failed to read Rust session transcript: {error}"
                )));
            }
        };
        parse_agent_runtime_history(&raw, &transcript_path)
    }

    fn append_transcript(
        &self,
        thread_id: &str,
        user_text: &str,
        assistant_text: &str,
    ) -> Result<(), AgentRuntimeError> {
        let store = DesktopSessionStore::new(self.runtime_root.clone());
        store
            .append_message(thread_id, "user", user_text, Some("agent"))
            .map_err(|error| AgentRuntimeError::TranscriptFailed(error.to_string()))?;
        store
            .append_message(thread_id, "assistant", assistant_text, Some("agent"))
            .map_err(|error| AgentRuntimeError::TranscriptFailed(error.to_string()))?;
        Ok(())
    }

    fn record_memory_after_turn(
        &self,
        session_id: &str,
        session_key: &str,
        run_id: &str,
        user_text: &str,
        assistant_text: &str,
    ) -> Result<Value, String> {
        let db_path = self
            .runtime_root
            .join("memory")
            .join("runtime.db")
            .to_string_lossy()
            .to_string();
        let memory_config = crate::memory::MemoryRuntimeConfig::from_value(
            &json!({
                "runtimeStore": {
                    "dbPath": db_path
                }
            }),
            &self.runtime_root,
        );
        let runtime =
            crate::memory::RustMemoryRuntime::with_config(self.runtime_root.clone(), memory_config);
        let messages = vec![
            json!({
                "id": format!("{run_id}:user"),
                "role": "user",
                "content": user_text,
                "source": "agent-runtime"
            }),
            json!({
                "id": format!("{run_id}:assistant"),
                "role": "assistant",
                "content": assistant_text,
                "source": "agent-runtime"
            }),
        ];
        runtime.after_turn(session_id, Some(session_key), &messages, 0)
    }
}

fn is_configured_model_marker(value: &str) -> bool {
    let trimmed = value.trim();
    trimmed.is_empty() || trimmed == "configured"
}

fn apply_agent_model_selection(
    config: &mut NativeProviderConfig,
    model_selection: Option<&AgentModelSelection>,
) -> Result<(), AgentRuntimeError> {
    let Some(selection) = model_selection else {
        return Ok(());
    };
    if !is_configured_model_marker(&selection.provider) {
        let provider = selection.provider.trim();
        ensure_native_chat_provider(provider)?;
        config.provider = provider.to_string();
    }
    if !is_configured_model_marker(&selection.model) {
        config.model = Some(selection.model.trim().to_string());
    }
    Ok(())
}

fn ensure_native_chat_provider(provider: &str) -> Result<(), AgentRuntimeError> {
    let descriptor = crawclaw_providers::bundled_provider_descriptors()
        .into_iter()
        .find(|entry| entry.provider == provider);
    if descriptor
        .as_ref()
        .map(|entry| entry.transport.is_none())
        .unwrap_or(false)
    {
        return Err(AgentRuntimeError::UnsupportedProvider(format!(
            "Desktop agent provider {provider} does not expose a Rust-native chat transport."
        )));
    }
    Ok(())
}

fn map_provider_error(error: ProviderTransportError) -> AgentRuntimeError {
    match error {
        ProviderTransportError::Unavailable(message) => {
            AgentRuntimeError::ProviderUnavailable(message)
        }
        ProviderTransportError::InvalidResponse(message) => {
            AgentRuntimeError::ProviderFailed(message)
        }
        ProviderTransportError::Unsupported(message) => {
            AgentRuntimeError::UnsupportedProvider(message)
        }
    }
}

impl AgentRuntimeBackend for NativeProviderRuntimeBackend {
    fn send_message<'a>(
        &'a self,
        request: AgentRuntimeRequest<'a>,
    ) -> Pin<Box<dyn Future<Output = Result<String, AgentRuntimeError>> + Send + 'a>> {
        Box::pin(async move {
            let messages = agent_history_with_user(&request.history, request.user_text);
            send_native_provider_conversation_with_options(
                &request.provider_config,
                &messages,
                &NativeProviderRequestOptions {
                    reasoning_level: request.reasoning_level.clone(),
                    ..NativeProviderRequestOptions::default()
                },
            )
            .await
            .map_err(map_provider_error)
        })
    }
}

impl AgentRuntimeBackend for PiAgentRuntimeBackend {
    fn send_message<'a>(
        &'a self,
        request: AgentRuntimeRequest<'a>,
    ) -> Pin<Box<dyn Future<Output = Result<String, AgentRuntimeError>> + Send + 'a>> {
        Box::pin(async move {
            let provider = Arc::new(CrawClawPiProvider {
                config: request.provider_config.clone(),
                reasoning_level: request.reasoning_level.clone(),
            });
            let tools = build_filtered_pi_agent_rust_tool_registry(
                request.runtime_root,
                &request.enabled_tools,
            );
            let agent_config = pi::sdk::AgentConfig {
                system_prompt: None,
                max_tool_iterations: 8,
                stream_options: pi::sdk::StreamOptions::default(),
                block_images: false,
                fail_closed_hooks: false,
            };
            let session = Arc::new(asupersync::sync::Mutex::new(pi_session_from_history(
                &request.history,
            )));
            let agent = pi::sdk::Agent::new(provider, tools, agent_config);
            let agent_session = pi::sdk::AgentSession::new(
                agent,
                session,
                false,
                pi::compaction::ResolvedCompactionSettings::default(),
            );
            let mut handle = pi::sdk::AgentSessionHandle::from_session_with_listeners(
                agent_session,
                pi::sdk::EventListeners::default(),
            );
            let assistant = handle
                .prompt(request.user_text.to_string(), |_| {})
                .await
                .map_err(map_pi_agent_error)?;
            pi_agent_assistant_text(&assistant)
        })
    }
}

fn build_filtered_pi_agent_rust_tool_registry(
    runtime_root: &Path,
    enabled_tools: &[String],
) -> pi::sdk::ToolRegistry {
    let registry = build_pi_agent_rust_tool_registry(runtime_root);
    if enabled_tools.is_empty() {
        return registry;
    }
    let allowlist = enabled_tools
        .iter()
        .map(|tool| tool.trim())
        .filter(|tool| !tool.is_empty())
        .collect::<BTreeSet<_>>();
    if allowlist.is_empty() {
        return pi::sdk::ToolRegistry::from_tools(Vec::new());
    }
    pi::sdk::ToolRegistry::from_tools(
        registry
            .into_tools()
            .into_iter()
            .filter(|tool| allowlist.contains(tool.name()))
            .collect(),
    )
}

#[derive(Clone)]
struct CrawClawPiProvider {
    config: NativeProviderConfig,
    reasoning_level: Option<String>,
}

#[async_trait::async_trait]
impl pi::sdk::Provider for CrawClawPiProvider {
    fn name(&self) -> &str {
        &self.config.provider
    }

    fn api(&self) -> &str {
        &self.config.provider
    }

    fn model_id(&self) -> &str {
        self.config.model.as_deref().unwrap_or("")
    }

    async fn stream(
        &self,
        context: &pi::sdk::ProviderContext<'_>,
        _options: &pi::sdk::StreamOptions,
    ) -> pi::sdk::Result<
        Pin<Box<dyn futures::Stream<Item = pi::sdk::Result<pi::sdk::StreamEvent>> + Send>>,
    > {
        let messages = pi_messages_to_native_provider_messages(context.messages.as_ref());
        if messages.is_empty() {
            return Err(pi::sdk::Error::provider(
                self.name(),
                "missing provider conversation messages",
            ));
        }
        let options = NativeProviderRequestOptions {
            stream: true,
            reasoning_level: self.reasoning_level.clone(),
            tools: context
                .tools
                .iter()
                .map(|tool| NativeProviderTool {
                    name: tool.name.clone(),
                    description: Some(tool.description.clone()),
                    input_schema: tool.parameters.clone(),
                })
                .collect(),
        };
        let text =
            send_native_provider_conversation_with_options(&self.config, &messages, &options)
                .await
                .map_err(|error| pi::sdk::Error::provider(self.name(), error.to_string()))?;
        let message = pi_assistant_message(&self.config, text.clone());
        let mut partial = message.clone();
        partial.content.clear();
        let events = vec![
            Ok(pi::sdk::StreamEvent::Start { partial }),
            Ok(pi::sdk::StreamEvent::TextStart { content_index: 0 }),
            Ok(pi::sdk::StreamEvent::TextDelta {
                content_index: 0,
                delta: text.clone(),
            }),
            Ok(pi::sdk::StreamEvent::TextEnd {
                content_index: 0,
                content: text,
            }),
            Ok(pi::sdk::StreamEvent::Done {
                reason: pi::sdk::StopReason::Stop,
                message,
            }),
        ];
        Ok(Box::pin(futures::stream::iter(events)))
    }
}

fn pi_user_content_text(content: &pi::sdk::UserContent) -> String {
    match content {
        pi::sdk::UserContent::Text(text) => text.clone(),
        pi::sdk::UserContent::Blocks(blocks) => blocks
            .iter()
            .filter_map(|block| match block {
                pi::sdk::ContentBlock::Text(text) => Some(text.text.as_str()),
                _ => None,
            })
            .collect::<Vec<_>>()
            .join("\n"),
    }
}

fn pi_user_content_blocks(content: &pi::sdk::UserContent) -> Vec<NativeProviderContentBlock> {
    match content {
        pi::sdk::UserContent::Text(text) => vec![NativeProviderContentBlock::text(text.clone())],
        pi::sdk::UserContent::Blocks(blocks) => blocks
            .iter()
            .filter_map(|block| match block {
                pi::sdk::ContentBlock::Text(text) => {
                    Some(NativeProviderContentBlock::text(text.text.clone()))
                }
                pi::sdk::ContentBlock::Image(image) => {
                    Some(NativeProviderContentBlock::image_base64(
                        image.mime_type.clone(),
                        image.data.clone(),
                    ))
                }
                _ => None,
            })
            .collect(),
    }
}

fn pi_assistant_content_text(content: &[pi::sdk::ContentBlock]) -> String {
    content
        .iter()
        .filter_map(|block| match block {
            pi::sdk::ContentBlock::Text(text) => Some(text.text.as_str()),
            _ => None,
        })
        .collect::<Vec<_>>()
        .join("\n")
}

fn pi_messages_to_native_provider_messages(
    messages: &[pi::sdk::Message],
) -> Vec<NativeProviderMessage> {
    messages
        .iter()
        .filter_map(|message| match message {
            pi::sdk::Message::User(user) => Some(NativeProviderMessage {
                role: NativeProviderMessageRole::User,
                content: pi_user_content_text(&user.content),
                blocks: pi_user_content_blocks(&user.content),
            }),
            pi::sdk::Message::Assistant(assistant) => Some(NativeProviderMessage {
                role: NativeProviderMessageRole::Assistant,
                content: pi_assistant_content_text(&assistant.content),
                blocks: Vec::new(),
            }),
            _ => None,
        })
        .filter(|message| !message.content.trim().is_empty() || !message.blocks.is_empty())
        .collect()
}

fn agent_history_with_user(
    history: &[AgentRuntimeMessage],
    user_text: &str,
) -> Vec<NativeProviderMessage> {
    let mut messages = history
        .iter()
        .filter_map(agent_message_to_native_provider_message)
        .collect::<Vec<_>>();
    messages.push(NativeProviderMessage::user(user_text));
    messages
}

fn agent_message_to_native_provider_message(
    message: &AgentRuntimeMessage,
) -> Option<NativeProviderMessage> {
    let content = message.content.trim();
    if content.is_empty() {
        return None;
    }
    Some(NativeProviderMessage {
        role: match message.role {
            AgentRuntimeMessageRole::User => NativeProviderMessageRole::User,
            AgentRuntimeMessageRole::Assistant => NativeProviderMessageRole::Assistant,
        },
        content: content.to_string(),
        blocks: Vec::new(),
    })
}

fn pi_session_from_history(history: &[AgentRuntimeMessage]) -> pi::sdk::Session {
    let mut session = pi::sdk::Session::in_memory();
    for message in history {
        match message.role {
            AgentRuntimeMessageRole::User => {
                session.append_model_message(pi::sdk::Message::User(pi::sdk::UserMessage {
                    content: pi::sdk::UserContent::Text(message.content.clone()),
                    timestamp: current_unix_millis(),
                }));
            }
            AgentRuntimeMessageRole::Assistant => {
                session.append_model_message(pi::sdk::Message::assistant(
                    pi::sdk::AssistantMessage {
                        content: vec![pi::sdk::ContentBlock::Text(pi::sdk::TextContent::new(
                            message.content.clone(),
                        ))],
                        api: String::new(),
                        provider: String::new(),
                        model: String::new(),
                        usage: pi::sdk::Usage::default(),
                        stop_reason: pi::sdk::StopReason::Stop,
                        error_message: None,
                        timestamp: current_unix_millis(),
                    },
                ));
            }
        }
    }
    session
}

fn pi_assistant_message(config: &NativeProviderConfig, text: String) -> pi::sdk::AssistantMessage {
    pi::sdk::AssistantMessage {
        content: vec![pi::sdk::ContentBlock::Text(pi::sdk::TextContent::new(text))],
        api: config.provider.clone(),
        provider: config.provider.clone(),
        model: config.model.clone().unwrap_or_default(),
        usage: pi::sdk::Usage::default(),
        stop_reason: pi::sdk::StopReason::Stop,
        error_message: None,
        timestamp: current_unix_millis(),
    }
}

fn current_unix_millis() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| i64::try_from(duration.as_millis()).unwrap_or(i64::MAX))
        .unwrap_or_default()
}

fn map_pi_agent_error(error: pi::sdk::Error) -> AgentRuntimeError {
    AgentRuntimeError::ProviderFailed(format!("pi_agent_rust direct runtime failed: {error}"))
}

fn pi_agent_assistant_text(
    assistant: &pi::sdk::AssistantMessage,
) -> Result<String, AgentRuntimeError> {
    let text = assistant
        .content
        .iter()
        .filter_map(|content| match content {
            pi::sdk::ContentBlock::Text(text) => Some(text.text.as_str()),
            _ => None,
        })
        .collect::<String>();
    if text.trim().is_empty() {
        return Err(AgentRuntimeError::ProviderFailed(
            "pi_agent_rust direct runtime did not produce assistant text.".to_string(),
        ));
    }
    Ok(text)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DesktopAgentProviderConfig {
    #[serde(default)]
    runtime: DesktopAgentRuntimeMode,
    provider: String,
    base_url: Option<String>,
    api_key: Option<Value>,
    model: Option<String>,
    api: Option<String>,
    api_version: Option<String>,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
enum DesktopAgentRuntimeMode {
    PiAgentRust,
    NativeProvider,
}

impl Default for DesktopAgentRuntimeMode {
    fn default() -> Self {
        Self::PiAgentRust
    }
}

impl DesktopAgentProviderConfig {
    fn runtime_mode(&self) -> DesktopAgentRuntimeMode {
        self.runtime
    }
}

impl ProviderResolver {
    fn resolve_desktop_config(
        config: &DesktopAgentProviderConfig,
        runtime_root: &Path,
    ) -> Result<NativeProviderConfig, AgentRuntimeError> {
        if config.provider.trim().is_empty() {
            return Err(AgentRuntimeError::ProviderUnavailable(
                "Desktop agent provider config is missing provider.".to_string(),
            ));
        }
        let provider = config.provider.trim().to_string();
        ensure_native_chat_provider(&provider)?;
        let default_model = crawclaw_providers::bundled_provider_default_model_for(&provider)
            .map(|entry| entry.model.to_string());
        Ok(NativeProviderConfig {
            provider,
            base_url: optional_config_value(config.base_url.as_deref()),
            api_key: resolve_secret_input_string(runtime_root, config.api_key.as_ref(), "apiKey")?,
            model: optional_config_value(config.model.as_deref()).or(default_model),
            api: optional_config_value(config.api.as_deref()),
            api_version: optional_config_value(config.api_version.as_deref()),
        })
    }
}

fn resolve_secret_input_string(
    runtime_root: &Path,
    value: Option<&Value>,
    field: &str,
) -> Result<Option<String>, AgentRuntimeError> {
    let Some(value) = value else {
        return Ok(None);
    };
    if let Some(raw) = value.as_str() {
        return Ok(optional_config_value(Some(raw)));
    }
    let Some(object) = value.as_object() else {
        return Err(AgentRuntimeError::ProviderUnavailable(format!(
            "Desktop agent provider config {field} must be a string or SecretRef."
        )));
    };
    let source = object
        .get("source")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let id = object.get("id").and_then(Value::as_str).unwrap_or_default();
    match source {
        "env" => std::env::var(id)
            .map(|secret| optional_config_value(Some(&secret)))
            .map_err(|_| {
                AgentRuntimeError::ProviderUnavailable(format!(
                    "Environment variable {id} for desktop provider {field} is not set."
                ))
            }),
        "file" => {
            let path = PathBuf::from(id);
            let path = if path.is_absolute() {
                path
            } else {
                runtime_root.join(path)
            };
            fs::read_to_string(&path)
                .map(|secret| optional_config_value(Some(secret.trim_end())))
                .map_err(|error| {
                    AgentRuntimeError::ProviderUnavailable(format!(
                        "Failed to read file SecretRef {} for desktop provider {field}: {error}",
                        path.display()
                    ))
                })
        }
        "exec" => Err(AgentRuntimeError::ProviderUnavailable(format!(
            "Exec SecretRef resolution for desktop provider {field} is not enabled in the Rust runtime."
        ))),
        _ => Err(AgentRuntimeError::ProviderUnavailable(format!(
            "Unsupported SecretRef source {source} for desktop provider {field}."
        ))),
    }
}

fn optional_config_value(value: Option<&str>) -> Option<String> {
    value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
}

#[cfg(test)]
mod tests {
    use super::*;
    use futures::StreamExt;
    use pi::sdk::Provider;
    use serde_json::json;
    use std::future::Future;
    use std::io::Read;
    use std::net::TcpListener;
    use std::pin::Pin;
    use std::sync::mpsc;
    use std::thread;

    fn repo_root() -> PathBuf {
        Path::new(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .and_then(Path::parent)
            .expect("repo root")
            .to_path_buf()
    }

    fn collect_ts_files(root: &Path, files: &mut Vec<PathBuf>) {
        for entry in fs::read_dir(root).expect("read source directory") {
            let entry = entry.expect("source directory entry");
            let path = entry.path();
            if path.is_dir() {
                if path.file_name().is_some_and(|name| name == "node_modules") {
                    continue;
                }
                collect_ts_files(&path, files);
            } else if path.is_file()
                && path
                    .extension()
                    .is_some_and(|ext| ext == "ts" || ext == "tsx")
            {
                files.push(path);
            }
        }
    }

    fn slash_path(path: &Path) -> String {
        path.to_string_lossy()
            .replace(std::path::MAIN_SEPARATOR, "/")
    }

    fn is_core_src_ts_test_surface(relative: &str) -> bool {
        (relative.starts_with("src/")
            || relative.starts_with("test/")
            || relative.starts_with("apps/crawclaw-desktop/"))
            && (relative.ends_with(".test.ts")
                || relative.ends_with(".test.tsx")
                || relative.ends_with(".live.test.ts")
                || relative.ends_with(".e2e.test.ts")
                || relative.ends_with(".e2e.test.tsx")
                || relative.ends_with(".suite.ts")
                || relative.ends_with(".test-helpers.ts")
                || relative.ends_with(".test-utils.ts")
                || relative.ends_with(".test-support.ts")
                || relative.ends_with(".test-mocks.ts")
                || relative.ends_with(".test-harness.ts")
                || relative.ends_with(".e2e-harness.ts")
                || relative.ends_with("-test-helpers.ts")
                || relative.ends_with("/test-helpers.ts")
                || relative.ends_with("/test-utils.ts")
                || relative.contains("/test-helpers/")
                || relative.contains("/test-utils/")
                || relative.starts_with("apps/crawclaw-desktop/src/test/")
                || relative.starts_with("test/"))
    }

    fn is_ts_declaration(relative: &str) -> bool {
        relative.ends_with(".d.ts") || relative.ends_with(".d.tsx")
    }

    #[test]
    fn rust_runtime_repo_guardrails_keep_core_src_ts_tests_absent() {
        let root = repo_root();
        let mut files = Vec::new();
        collect_ts_files(&root.join("src"), &mut files);
        collect_ts_files(&root.join("test"), &mut files);
        collect_ts_files(
            &root.join("apps").join("crawclaw-desktop").join("src"),
            &mut files,
        );
        let existing = files
            .into_iter()
            .map(|file| slash_path(file.strip_prefix(&root).expect("relative source path")))
            .filter(|relative| is_core_src_ts_test_surface(relative))
            .collect::<Vec<_>>();

        assert!(
            existing.is_empty(),
            "removed TypeScript core src tests came back: {existing:?}"
        );
    }

    #[test]
    fn rust_runtime_repo_guardrails_keep_ts_test_env_toggles_absent() {
        let root = repo_root();
        let mut files = Vec::new();
        collect_ts_files(&root.join("src"), &mut files);

        let forbidden_needles = [
            "process.env.VITEST",
            "process.env.NODE_ENV === \"test\"",
            "process.env.NODE_ENV === 'test'",
            "CRAWCLAW_TEST",
            "__CRAWCLAW_TEST",
        ];
        let mut hits = Vec::new();
        for file in files {
            let relative = slash_path(file.strip_prefix(&root).expect("relative source path"));
            if is_ts_declaration(&relative) || is_core_src_ts_test_surface(&relative) {
                continue;
            }
            let source = fs::read_to_string(&file).expect("read TS source");
            for needle in forbidden_needles {
                if source.contains(needle) {
                    hits.push(format!("{relative}: {needle}"));
                }
            }
        }

        assert!(
            hits.is_empty(),
            "removed TypeScript test environment toggles came back: {hits:?}"
        );
    }

    #[test]
    fn runtime_layout_reports_no_default_js_compat() {
        let runtime_root = unique_test_runtime_root("runtime-no-js-compat");
        let layout = RuntimeLayout {
            binary_path: runtime_root.join("bin").join(runtime_binary_name()),
            channel_manifest_path: runtime_root.join("channels").join("manifest.json"),
            manifest_path: runtime_root.join("runtimes").join("manifest.json"),
            runtime_root: runtime_root.clone(),
        };
        fs::create_dir_all(layout.binary_path.parent().expect("binary parent")).unwrap();
        fs::create_dir_all(
            layout
                .channel_manifest_path
                .parent()
                .expect("channels parent"),
        )
        .unwrap();
        fs::create_dir_all(layout.manifest_path.parent().expect("manifest parent")).unwrap();
        fs::write(&layout.binary_path, "").unwrap();
        fs::write(layout.gateway_binary_path(), "").unwrap();
        fs::write(layout.native_plugins_binary_path(), "").unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let gateway_path = layout.gateway_binary_path();
            let native_plugins_path = layout.native_plugins_binary_path();
            for path in [
                layout.binary_path.as_path(),
                gateway_path.as_path(),
                native_plugins_path.as_path(),
            ] {
                let mut permissions = fs::metadata(path).unwrap().permissions();
                permissions.set_mode(0o755);
                fs::set_permissions(path, permissions).unwrap();
            }
        }
        fs::write(&layout.channel_manifest_path, "{}").unwrap();
        fs::write(&layout.manifest_path, r#"{"runtime":"rust-native"}"#).unwrap();

        let status = inspect_runtime_layout(&layout);

        assert_eq!(status.status, RuntimeStatusValue::Ready);
        assert_eq!(status.compat, RuntimeCompatStatus::default());

        let _ = fs::remove_dir_all(runtime_root);
    }

    #[test]
    fn desktop_runtime_manifest_advertises_managed_searxng_runtime() {
        let runtime_root = unique_test_runtime_root("runtime-searxng-manifest");

        stage_desktop_runtime_manifests(&runtime_root).expect("stage runtime manifests");
        let raw = fs::read_to_string(runtime_root.join("runtimes").join("manifest.json"))
            .expect("runtime manifest");
        let manifest: Value = serde_json::from_str(&raw).expect("manifest json");

        assert_eq!(manifest["jsPluginRuntime"], "none");
        assert_eq!(
            manifest["managedRuntimes"]["browser"]["runtime"],
            "rust-native-binary"
        );
        assert_eq!(
            manifest["managedRuntimes"]["browser"]["provider"],
            "agent-browser"
        );
        assert_eq!(
            manifest["managedRuntimes"]["searxng"]["runtime"],
            "python-sidecar"
        );
        assert_eq!(
            manifest["managedRuntimes"]["searxng"]["provider"],
            "searxng"
        );
        assert_eq!(
            manifest["managedRuntimes"]["searxng"]["sourceCommit"],
            "afafca93f30939f213c1bc3fa3379e5ed883122d"
        );
        assert_eq!(
            manifest["managedRuntimes"]["searxng"]["license"],
            "AGPL-3.0-or-later"
        );

        let _ = fs::remove_dir_all(runtime_root);
    }

    #[test]
    fn pi_agent_rust_core_tool_registry_uses_crawclaw_tool_names() {
        let runtime_root = unique_test_runtime_root("pi-agent-rust-core-tools");
        let registry = build_pi_agent_rust_tool_registry(&runtime_root);
        let tool_names: Vec<&str> = registry.tools().iter().map(|tool| tool.name()).collect();

        let expected_tool_names = vec![
            "read",
            "write",
            "edit",
            "apply_patch",
            "bash",
            "process",
            "browser",
            "lobster",
            "comfyui_workflow",
            "llm-task",
            "grep",
            "find",
            "ls",
            "web_search",
            "web_fetch",
            "session_status",
            "sessions_list",
            "sessions_history",
            "sessions_send",
            "sessions_spawn",
            "sessions_yield",
            "subagents",
            "canvas",
            "message",
            "cron",
            "image",
            "pdf",
            "tts",
            "discover_skills",
            "workflow",
            "workflowize",
            "review_task",
            "write_experience_note",
            "memory_manifest_read",
            "memory_note_read",
            "memory_note_write",
            "memory_note_edit",
            "memory_note_delete",
            "session_summary_file_read",
            "session_summary_file_edit",
        ];
        assert_eq!(tool_names, expected_tool_names);
        assert!(registry.get("bash").is_some());
        assert!(registry.get("exec").is_none());
        assert_eq!(
            pi_agent_rust_tool_names(),
            expected_tool_names
                .into_iter()
                .map(ToString::to_string)
                .collect::<Vec<_>>()
        );
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn pi_agent_rust_tool_registry_executes_installed_native_sidecar_tool() {
        use std::os::unix::fs::PermissionsExt;

        let runtime_root = unique_test_runtime_root("pi-agent-rust-sidecar-tool");
        let plugin_dir = runtime_root.join("plugins").join("acme-native");
        fs::create_dir_all(&plugin_dir).expect("plugin dir");
        let sidecar = plugin_dir.join("sidecar.sh");
        fs::write(
            &sidecar,
            r#"#!/bin/sh
read line
case "$line" in
  *plugin.invoke*)
    printf '%s\n' '{"jsonrpc":"2.0","id":"describe","result":{"output":{"ok":true}}}'
    ;;
  *)
    printf '%s\n' '{"jsonrpc":"2.0","id":"describe","result":{"descriptors":[{"schemaVersion":1,"pluginId":"acme-native","name":"Acme Native","tools":[{"name":"acme_tool","label":"Acme Tool","description":"Runs native work.","parameters":{"type":"object"},"invocation":{"pluginId":"acme-native","operation":"run"},"readOnly":true}]}]}}'
    ;;
esac
"#,
        )
        .expect("sidecar");
        let mut permissions = fs::metadata(&sidecar).expect("metadata").permissions();
        permissions.set_mode(0o755);
        fs::set_permissions(&sidecar, permissions).expect("permissions");
        fs::write(
            plugin_dir.join("crawclaw.plugin.json"),
            serde_json::to_vec_pretty(&json!({
                "id": "acme-native",
                "native": {
                    "protocol": "crawclaw-native-plugin-jsonrpc",
                    "schemaVersion": 1,
                    "bin": "sidecar.sh"
                }
            }))
            .expect("manifest json"),
        )
        .expect("manifest");

        let output = execute_rust_core_tool(&runtime_root, "acme_tool", json!({ "value": 1 }))
            .await
            .expect("sidecar tool output");

        assert_eq!(output["details"], json!({ "ok": true }));

        let _ = fs::remove_dir_all(runtime_root);
    }

    #[test]
    fn grep_find_ls_are_default_rust_native_discovery_tools() {
        let runtime_root = unique_test_runtime_root("pi-agent-rust-discovery-tools");
        let registry = build_pi_agent_rust_tool_registry(&runtime_root);
        let tool_names: Vec<&str> = registry.tools().iter().map(|tool| tool.name()).collect();

        assert_eq!(
            tool_names,
            vec![
                "read",
                "write",
                "edit",
                "apply_patch",
                "bash",
                "process",
                "browser",
                "lobster",
                "comfyui_workflow",
                "llm-task",
                "grep",
                "find",
                "ls",
                "web_search",
                "web_fetch",
                "session_status",
                "sessions_list",
                "sessions_history",
                "sessions_send",
                "sessions_spawn",
                "sessions_yield",
                "subagents",
                "canvas",
                "message",
                "cron",
                "image",
                "pdf",
                "tts",
                "discover_skills",
                "workflow",
                "workflowize",
                "review_task",
                "write_experience_note",
                "memory_manifest_read",
                "memory_note_read",
                "memory_note_write",
                "memory_note_edit",
                "memory_note_delete",
                "session_summary_file_read",
                "session_summary_file_edit",
            ]
        );
        for tool_name in ["grep", "find", "ls"] {
            let tool = registry.get(tool_name).expect("discovery tool");
            assert!(tool.is_read_only(), "{tool_name} should be read-only");
        }
    }

    #[test]
    fn pi_agent_rust_tool_registry_honors_runtime_allowlist() {
        let runtime_root = unique_test_runtime_root("pi-agent-rust-tool-allowlist");
        let registry = build_filtered_pi_agent_rust_tool_registry(
            &runtime_root,
            &[
                "memory_note_read".to_string(),
                "sessions_history".to_string(),
            ],
        );
        let tool_names = registry
            .tools()
            .iter()
            .map(|tool| tool.name())
            .collect::<Vec<_>>();

        assert_eq!(tool_names, vec!["sessions_history", "memory_note_read"]);
        assert!(registry.get("memory_note_write").is_none());
        assert!(registry.get("bash").is_none());
    }

    #[test]
    fn rust_core_tool_inventory_tracks_native_tools() {
        let definition = |tool_id: &str| {
            rust_core_tool_definitions()
                .iter()
                .find(|tool| tool.id == tool_id)
                .expect("tool definition")
        };

        assert_eq!(
            definition("bash"),
            &RustCoreToolDefinition {
                id: "bash",
                backing_runtime_id: "bash",
                status: RustCoreToolStatus::RustNative,
                default_enabled: true,
                read_only: false,
                label: "bash",
                description: "Run shell commands",
                section_id: "runtime",
                default_profiles: &["coding", "full"],
                lifecycle: "profile_default",
                include_in_crawclaw_group: false,
            }
        );
        assert_eq!(
            definition("apply_patch").status,
            RustCoreToolStatus::RustNative
        );
        assert!(definition("apply_patch").default_enabled);
        assert_eq!(definition("process").status, RustCoreToolStatus::RustNative);
        assert!(definition("process").default_enabled);
        assert!(definition("web_search").default_enabled);
        assert!(definition("web_search").read_only);
        assert!(definition("web_fetch").default_enabled);
        assert!(definition("web_fetch").read_only);
        assert!(definition("sessions_send").default_enabled);
        assert!(!definition("sessions_send").read_only);
        assert!(definition("sessions_spawn").default_enabled);
        assert!(!definition("sessions_spawn").read_only);
        assert!(definition("sessions_yield").default_enabled);
        assert!(!definition("sessions_yield").read_only);
        assert!(definition("cron").default_enabled);
        assert!(!definition("cron").read_only);
        assert_eq!(definition("canvas").description, "Control canvases");
        assert!(definition("canvas").default_enabled);
        assert_eq!(definition("message").section_id, "messaging");
        assert!(!definition("message").read_only);
        assert!(definition("image").read_only);
        assert!(definition("pdf").read_only);
        assert!(!definition("tts").read_only);
        assert!(definition("discover_skills").read_only);
        assert!(!definition("workflow").read_only);
        assert!(!definition("workflowize").read_only);
        for tool_name in [
            "session_status",
            "sessions_list",
            "sessions_history",
            "subagents",
            "review_task",
            "memory_manifest_read",
            "memory_note_read",
            "session_summary_file_read",
        ] {
            assert!(definition(tool_name).default_enabled);
            assert!(definition(tool_name).read_only);
        }
        for tool_name in [
            "memory_note_write",
            "memory_note_edit",
            "memory_note_delete",
            "write_experience_note",
            "session_summary_file_edit",
        ] {
            assert!(definition(tool_name).default_enabled);
            assert!(!definition(tool_name).read_only);
        }
        for tool_name in ["grep", "find", "ls"] {
            assert!(definition(tool_name).default_enabled);
            assert!(definition(tool_name).read_only);
        }
        let tool_names = pi_agent_rust_tool_names();
        for expected in [
            "apply_patch",
            "process",
            "sessions_spawn",
            "message",
            "cron",
            "tts",
            "workflow",
            "workflowize",
            "review_task",
            "memory_note_write",
            "write_experience_note",
            "web_search",
            "web_fetch",
            "browser",
            "lobster",
            "comfyui_workflow",
            "llm-task",
        ] {
            assert!(tool_names.contains(&expected.to_string()));
        }
    }

    #[test]
    fn rust_tool_catalog_artifact_uses_runtime_inventory() {
        let payload = rust_tool_catalog_json_payload();
        let sections = payload["sections"].as_array().expect("sections");
        let core_tools = payload["coreTools"].as_array().expect("core tools");
        let native_tools = payload["nativeTools"].as_array().expect("native tools");

        assert!(sections.iter().any(|section| section["id"] == "runtime"));
        assert!(core_tools.iter().any(|tool| tool["id"] == "bash"));
        assert!(native_tools.iter().any(|tool| {
            tool["id"] == "browser"
                && tool["source"] == "native-plugin"
                && tool["status"] == "rust-native"
        }));

        let artifact = render_rust_tool_catalog_artifact();
        assert!(artifact.ends_with('\n'));
        assert!(artifact.contains("\"coreTools\""));
        assert!(artifact.contains("\"nativeTools\""));
    }

    #[tokio::test]
    async fn core_tools_canvas_message_and_discover_skills_are_rust_backed() {
        let runtime_root = unique_test_runtime_root("core-tools-rust-backed");
        fs::create_dir_all(runtime_root.join("skills/demo")).expect("skill dir");
        fs::write(
            runtime_root.join("skills/demo/SKILL.md"),
            "---\nname: demo\ndescription: Demo skill for Rust discovery.\n---\n# Demo\n",
        )
        .expect("skill file");

        let canvas =
            execute_rust_core_tool(&runtime_root, "canvas", json!({ "action": "snapshot" }))
                .await
                .expect("canvas output");
        assert_eq!(canvas["details"]["status"], "ok");
        assert_eq!(canvas["details"]["implementation"], "rust-native");
        assert_eq!(canvas["details"]["state"]["visible"], false);

        let message = execute_rust_core_tool(
            &runtime_root,
            "message",
            json!({
                "action": "send",
                "channel": "desktop",
                "target": "user",
                "text": "hello"
            }),
        )
        .await
        .expect("message output");
        assert_eq!(message["details"]["deliveryStatus"], "delivered");
        assert_eq!(message["details"]["implementation"], "rust-native");

        let skills = execute_rust_core_tool(
            &runtime_root,
            "discover_skills",
            json!({ "taskDescription": "Need a demo helper", "limit": 5 }),
        )
        .await
        .expect("discover skills output");
        assert_eq!(skills["details"]["status"], "ok");
        assert!(skills["details"]["skills"]
            .as_array()
            .expect("skills")
            .iter()
            .any(|skill| skill["name"] == "demo"));

        let _ = fs::remove_dir_all(runtime_root);
    }

    #[tokio::test]
    async fn core_tools_workflow_lifecycle_is_rust_backed() {
        let runtime_root = unique_test_runtime_root("core-tools-workflow-lifecycle");
        let created = execute_rust_core_tool(
            &runtime_root,
            "workflowize",
            json!({
                "name": "Demo workflow",
                "goal": "Exercise Rust workflow lifecycle",
                "safeForAutoRun": true,
                "requiresApproval": false,
                "steps": [{ "id": "one", "title": "First step" }]
            }),
        )
        .await
        .expect("workflow created");
        let workflow_id = created["details"]["workflowId"]
            .as_str()
            .expect("workflow id");
        assert_eq!(created["details"]["target"], "rust-native");

        let updated = execute_rust_core_tool(
            &runtime_root,
            "workflow",
            json!({
                "action": "update",
                "workflow": workflow_id,
                "patch": { "description": "Updated by Rust runtime" }
            }),
        )
        .await
        .expect("workflow updated");
        assert_eq!(updated["details"]["status"], "updated");
        assert_eq!(updated["details"]["workflow"]["specVersion"], 2);

        let versions = execute_rust_core_tool(
            &runtime_root,
            "workflow",
            json!({ "action": "versions", "workflow": workflow_id }),
        )
        .await
        .expect("workflow versions");
        assert_eq!(
            versions["details"]["versions"]
                .as_array()
                .expect("versions")
                .len(),
            2
        );

        let diff = execute_rust_core_tool(
            &runtime_root,
            "workflow",
            json!({
                "action": "diff",
                "workflow": workflow_id,
                "fromSpecVersion": 1,
                "toSpecVersion": 2
            }),
        )
        .await
        .expect("workflow diff");
        assert_eq!(diff["details"]["changed"], true);

        let deployed = execute_rust_core_tool(
            &runtime_root,
            "workflow",
            json!({ "action": "deploy", "workflow": workflow_id }),
        )
        .await
        .expect("workflow deployed");
        assert_eq!(
            deployed["details"]["workflow"]["deploymentState"],
            "deployed"
        );

        let run = execute_rust_core_tool(
            &runtime_root,
            "workflow",
            json!({
                "action": "run",
                "workflow": workflow_id,
                "inputs": { "topic": "rust" }
            }),
        )
        .await
        .expect("workflow run");
        let run_id = run["details"]["runId"].as_str().expect("run id");
        assert_eq!(run["details"]["status"], "running");

        let status = execute_rust_core_tool(
            &runtime_root,
            "workflow",
            json!({ "action": "status", "executionId": run_id }),
        )
        .await
        .expect("workflow status");
        assert_eq!(status["details"]["execution"]["status"], "running");

        let cancelled = execute_rust_core_tool(
            &runtime_root,
            "workflow",
            json!({ "action": "cancel", "executionId": run_id }),
        )
        .await
        .expect("workflow cancel");
        assert_eq!(cancelled["details"]["execution"]["status"], "cancelled");

        let runs = execute_rust_core_tool(
            &runtime_root,
            "workflow",
            json!({ "action": "runs", "workflow": workflow_id }),
        )
        .await
        .expect("workflow runs");
        assert_eq!(
            runs["details"]["runs"][0]["executionId"].as_str(),
            Some(run_id)
        );

        let _ = fs::remove_dir_all(runtime_root);
    }

    #[test]
    fn special_agent_registry_tracks_all_native_agents() {
        let definitions = crate::special_agents::special_agent_definitions();
        let ids = definitions
            .iter()
            .map(|definition| definition.id)
            .collect::<Vec<_>>();

        assert_eq!(
            ids,
            vec![
                "review-spec",
                "review-quality",
                "durable-memory",
                "dream",
                "session-summary",
                "experience",
            ]
        );
        assert!(definitions
            .iter()
            .all(|definition| !definition.tool_allowlist.is_empty()));
    }

    #[test]
    fn special_agent_memory_tools_manage_scoped_notes() {
        let runtime_root = unique_test_runtime_root("special-memory-tools");
        let tools = crate::special_agents::SpecialAgentMemoryTools::new(runtime_root.clone());

        let write = tools
            .write_note("main", "reference/test.md", "# Test\nold text")
            .expect("write note");
        assert_eq!(write.status, "ok");

        let read = tools
            .read_note("main", "reference/test.md")
            .expect("read note");
        assert_eq!(read.content, "# Test\nold text");

        let edit = tools
            .edit_note("main", "reference/test.md", "old text", "new text")
            .expect("edit note");
        assert_eq!(edit.replacements, 1);

        let manifest = tools.read_manifest("main").expect("manifest");
        assert_eq!(manifest.entries.len(), 1);
        assert_eq!(manifest.entries[0].note_path, "reference/test.md");

        let deleted = tools
            .delete_note("main", "reference/test.md")
            .expect("delete note");
        assert_eq!(deleted.status, "deleted");

        let _ = fs::remove_dir_all(runtime_root);
    }

    #[tokio::test]
    async fn rust_native_session_tools_manage_subagent_sessions() {
        let runtime_root = unique_test_runtime_root("pi-agent-rust-session-tools");
        fs::create_dir_all(&runtime_root).expect("runtime root");
        let registry = build_pi_agent_rust_tool_registry(&runtime_root);
        let spawn = registry.get("sessions_spawn").expect("sessions_spawn tool");
        let list = registry.get("sessions_list").expect("sessions_list tool");
        let history = registry
            .get("sessions_history")
            .expect("sessions_history tool");
        let send = registry.get("sessions_send").expect("sessions_send tool");
        let yield_tool = registry.get("sessions_yield").expect("sessions_yield tool");
        let subagents = registry.get("subagents").expect("subagents tool");

        let spawned = spawn
            .execute(
                "spawn-call",
                json!({
                    "task": "check the Rust gateway",
                    "label": "gateway worker",
                    "parentSessionKey": "main"
                }),
                None,
            )
            .await
            .expect("spawn session");
        let child_key = spawned
            .details
            .as_ref()
            .and_then(|details| details.get("session"))
            .and_then(|session| session.get("key"))
            .and_then(serde_json::Value::as_str)
            .expect("child key")
            .to_string();

        send.execute(
            "send-call",
            json!({
                "sessionKey": child_key.clone(),
                "message": "follow up"
            }),
            None,
        )
        .await
        .expect("send session message");
        let yielded = yield_tool
            .execute(
                "yield-call",
                json!({
                    "sessionKey": child_key.clone()
                }),
                None,
            )
            .await
            .expect("yield session");

        assert_eq!(
            yielded
                .details
                .as_ref()
                .and_then(|details| details.get("session"))
                .and_then(|session| session.get("yielded")),
            Some(&json!(true))
        );
        assert!(tool_output_text(
            &history
                .execute(
                    "history-call",
                    json!({
                        "sessionKey": child_key.clone()
                    }),
                    None,
                )
                .await
                .expect("history")
        )
        .contains("follow up"));
        assert!(tool_output_text(
            &subagents
                .execute(
                    "subagents-call",
                    json!({
                        "parentSessionKey": "main"
                    }),
                    None,
                )
                .await
                .expect("subagents")
        )
        .contains("gateway worker"));
        assert!(tool_output_text(
            &list
                .execute("list-call", json!({}), None)
                .await
                .expect("list")
        )
        .contains("gateway worker"));
    }

    #[tokio::test]
    async fn rust_native_web_fetch_uses_canonical_tool_name() {
        let runtime_root = unique_test_runtime_root("pi-agent-rust-web-fetch");
        fs::create_dir_all(&runtime_root).expect("runtime root");
        let registry = build_pi_agent_rust_tool_registry(&runtime_root);
        let web_search = registry.get("web_search").expect("web_search tool");
        let web_fetch = registry.get("web_fetch").expect("web_fetch tool");
        let listener = TcpListener::bind("127.0.0.1:0").expect("web fetch listener");
        let addr = listener.local_addr().expect("listener addr");
        thread::spawn(move || {
            let (mut stream, _) = listener.accept().expect("accept web fetch request");
            let mut buffer = [0_u8; 1024];
            let _ = stream.read(&mut buffer);
            let body = "<html><head><title>Rust Web Fetch</title></head><body><main>Rust native web_fetch content</main></body></html>";
            let response = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                body.len(),
                body
            );
            std::io::Write::write_all(&mut stream, response.as_bytes())
                .expect("write web fetch response");
        });

        assert!(web_search.is_read_only());
        assert!(web_fetch.is_read_only());
        let output = web_fetch
            .execute(
                "web-fetch-call",
                json!({
                    "url": format!("http://{addr}/article"),
                    "output": "text",
                    "maxChars": 2_000
                }),
                None,
            )
            .await
            .expect("web_fetch should execute");

        assert!(tool_output_text(&output).contains("Rust native web_fetch content"));
        assert_eq!(
            output
                .details
                .as_ref()
                .and_then(|details| details.get("provider")),
            Some(&json!("spider"))
        );
    }

    #[tokio::test]
    async fn rust_native_web_search_only_exposes_searxng_provider() {
        let runtime_root = unique_test_runtime_root("pi-agent-rust-web-search-provider");
        fs::create_dir_all(&runtime_root).expect("runtime root");
        let registry = build_pi_agent_rust_tool_registry(&runtime_root);
        let web_search = registry.get("web_search").expect("web_search tool");
        let parameters = web_search.parameters();
        let providers = parameters
            .pointer("/properties/provider/enum")
            .and_then(serde_json::Value::as_array)
            .expect("provider enum")
            .iter()
            .map(|value| value.as_str().expect("provider value"))
            .collect::<Vec<_>>();

        assert_eq!(providers, vec!["searxng"]);
        let error = web_search
            .execute(
                "web-search-call",
                json!({
                    "query": "rust native",
                    "provider": "brave"
                }),
                None,
            )
            .await
            .expect_err("non-searxng provider should not be accepted by web_search");

        assert!(format!("{error}").contains("only supports searxng"));
    }

    #[tokio::test]
    async fn rust_native_apply_patch_updates_workspace_files() {
        let runtime_root = unique_test_runtime_root("pi-agent-rust-apply-patch");
        fs::create_dir_all(&runtime_root).expect("runtime root");
        fs::write(runtime_root.join("sample.txt"), "old\n").expect("sample");
        let registry = build_pi_agent_rust_tool_registry(&runtime_root);
        let apply_patch = registry.get("apply_patch").expect("apply_patch tool");
        let patch = [
            "*** Begin Patch",
            "*** Update File: sample.txt",
            "@@",
            "-old",
            "+new",
            "*** End Patch",
        ]
        .join("\n");

        let output = apply_patch
            .execute(
                "apply-patch-call",
                json!({
                    "input": patch
                }),
                None,
            )
            .await
            .expect("apply patch");

        assert_eq!(
            fs::read_to_string(runtime_root.join("sample.txt")).expect("sample after"),
            "new\n"
        );
        assert!(tool_output_text(&output).contains("M sample.txt"));
        assert_eq!(
            output
                .details
                .as_ref()
                .and_then(|details| details.get("summary")),
            Some(&json!({"added":[],"modified":["sample.txt"],"deleted":[]}))
        );
    }

    #[tokio::test]
    async fn rust_native_bash_and_process_manage_background_sessions() {
        let runtime_root = unique_test_runtime_root("pi-agent-rust-process");
        fs::create_dir_all(&runtime_root).expect("runtime root");
        let registry = build_pi_agent_rust_tool_registry(&runtime_root);
        let bash = registry.get("bash").expect("bash tool");
        let process = registry.get("process").expect("process tool");

        let started = bash
            .execute(
                "bash-call",
                json!({
                    "command": "printf start; sleep 0.05; printf done",
                    "background": true
                }),
                None,
            )
            .await
            .expect("start background bash");
        let session_id = started
            .details
            .as_ref()
            .and_then(|details| details.get("sessionId"))
            .and_then(serde_json::Value::as_str)
            .expect("session id")
            .to_string();

        let polled = process
            .execute(
                "process-call",
                json!({
                    "action": "poll",
                    "sessionId": session_id,
                    "timeout": 1000
                }),
                None,
            )
            .await
            .expect("poll background bash");

        assert!(tool_output_text(&polled).contains("startdone"));
        assert_eq!(
            polled
                .details
                .as_ref()
                .and_then(|details| details.get("status")),
            Some(&json!("completed"))
        );
    }

    #[tokio::test]
    async fn agent_runtime_uses_pi_agent_rust_direct_backend_by_default() {
        let runtime_root = unique_test_runtime_root("pi-agent-direct");
        let config_dir = runtime_root.join("config");
        fs::create_dir_all(&config_dir).expect("config dir");
        fs::write(
            config_dir.join("desktop-agent-provider.json"),
            serde_json::to_vec_pretty(&json!({
                "provider": "test-provider",
                "model": "test-model",
                "apiKey": "test-key"
            }))
            .expect("config json"),
        )
        .expect("write config");

        let backend = Arc::new(FakeAgentRuntimeBackend {
            reply: "hello from pi_agent_rust".to_string(),
        });
        let runtime = AgentRuntime::with_pi_agent_backend(runtime_root.clone(), backend);
        let result = runtime
            .send_message("thread-pi".to_string(), "hello direct".to_string())
            .await
            .expect("pi direct result");

        assert_eq!(result.assistant_text, "hello from pi_agent_rust");
        let transcript = fs::read_to_string(runtime_root.join("sessions").join("thread-pi.jsonl"))
            .expect("transcript");
        assert!(transcript.contains(r#""content":"hello direct""#));
        assert!(transcript.contains(r#""content":"hello from pi_agent_rust""#));
    }

    #[tokio::test]
    async fn agent_runtime_run_turn_emits_rust_event_contract() {
        let runtime_root = unique_test_runtime_root("agent-run-turn-events");
        let config_dir = runtime_root.join("config");
        fs::create_dir_all(&config_dir).expect("config dir");
        fs::write(
            config_dir.join("desktop-agent-provider.json"),
            serde_json::to_vec_pretty(&json!({
                "provider": "test-provider",
                "model": "test-model",
                "apiKey": "test-key"
            }))
            .expect("config json"),
        )
        .expect("write config");

        let runtime = AgentRuntime::with_pi_agent_backend(
            runtime_root.clone(),
            Arc::new(FakeAgentRuntimeBackend {
                reply: "hello from run_turn".to_string(),
            }),
        );
        let result = runtime
            .run_turn(AgentRunRequest {
                run_id: "run-1".to_string(),
                agent_id: "main".to_string(),
                session_key: "thread-events".to_string(),
                inbound: ChannelInboundEnvelope {
                    channel: "gateway".to_string(),
                    account_id: Some("local".to_string()),
                    from: "user".to_string(),
                    to: "agent:main".to_string(),
                    chat_type: ChannelChatType::Direct,
                    body: "hello event loop".to_string(),
                    raw_body: Some("hello event loop".to_string()),
                    message_id: Some("in-1".to_string()),
                    thread_id: Some("thread-events".to_string()),
                    media_urls: Vec::new(),
                    metadata: BTreeMap::new(),
                },
                model: AgentModelSelection {
                    provider: "test-provider".to_string(),
                    model: "test-model".to_string(),
                    reasoning_level: None,
                },
                enabled_tools: Vec::new(),
                options: BTreeMap::new(),
            })
            .await
            .expect("run turn");

        assert_eq!(result.run_id, "run-1");
        assert_eq!(result.session_key, "thread-events");
        assert_eq!(result.assistant_text, "hello from run_turn");
        assert_eq!(
            serde_json::to_value(&result.events).expect("events json"),
            json!([
                {
                    "type": "runStarted",
                    "runId": "run-1",
                    "agentId": "main",
                    "sessionKey": "thread-events"
                },
                {
                    "type": "replyPayload",
                    "runId": "run-1",
                    "payload": {
                        "text": "hello from run_turn"
                    }
                },
                {
                    "type": "transcriptAppended",
                    "runId": "run-1",
                    "sessionKey": "thread-events",
                    "role": "assistant",
                    "messageId": "run-1:assistant"
                },
                {
                    "type": "toolResult",
                    "runId": "run-1",
                    "callId": "run-1:memory-after-turn",
                    "toolName": "memory.afterTurn",
                    "result": {
                        "status": "ok",
                        "ingest": {
                            "ingestedCount": 2
                        },
                        "durableExtraction": true,
                        "experienceExtraction": true,
                        "sessionSummary": true
                    }
                },
                {
                    "type": "runCompleted",
                    "runId": "run-1"
                }
            ])
        );

        let transcript =
            fs::read_to_string(runtime_root.join("sessions").join("thread-events.jsonl"))
                .expect("transcript");
        assert!(transcript.contains(r#""content":"hello event loop""#));
        assert!(transcript.contains(r#""content":"hello from run_turn""#));
        let memory_messages =
            crate::memory::RuntimeStore::new(runtime_root.join("memory").join("runtime.db"))
                .list_messages("thread-events", 10)
                .expect("memory messages");
        assert_eq!(memory_messages.len(), 2);
    }

    #[tokio::test]
    async fn memory_runtime_compact_operation_uses_native_agent_runtime() {
        let runtime_root = unique_test_runtime_root("memory-runtime-compact-agent");
        let (provider_base_url, request_rx) =
            start_openai_compatible_provider("compact from runtime agent");
        let config_dir = runtime_root.join("config");
        fs::create_dir_all(&config_dir).expect("config dir");
        fs::write(
            config_dir.join("desktop-agent-provider.json"),
            serde_json::to_vec_pretty(&json!({
                "provider": "openai-compatible",
                "baseUrl": provider_base_url,
                "model": "test-model",
                "apiKey": "test-key"
            }))
            .expect("config json"),
        )
        .expect("write config");

        execute_memory_runtime_operation(
            &runtime_root,
            "memory.ingestBatch",
            json!({
                "sessionId": "runtime-compact-session",
                "messages": [
                    { "id": "m1", "role": "user", "content": "runtime compact input" },
                    { "id": "m2", "role": "assistant", "content": "runtime compact response" }
                ]
            }),
        )
        .await
        .expect("ingest compact messages");
        let compact = execute_memory_runtime_operation(
            &runtime_root,
            "memory.compact",
            json!({
                "sessionId": "runtime-compact-session",
                "force": true
            }),
        )
        .await
        .expect("compact via runtime operation");

        assert_eq!(compact["ok"], true);
        assert_eq!(compact["compacted"], true);
        assert_eq!(compact["result"]["summary"], "compact from runtime agent");
        assert_eq!(
            compact["result"]["implementation"],
            "rust-native-agent-runtime"
        );
        let request = request_rx
            .recv_timeout(std::time::Duration::from_secs(2))
            .expect("captured compact provider request");
        assert!(request.contains("runtime compact input"));

        let summary = fs::read_to_string(
            runtime_root.join("memory/session-summary/runtime-compact-session.md"),
        )
        .expect("summary file");
        assert!(summary.contains("compact from runtime agent"));

        let _ = fs::remove_dir_all(runtime_root);
    }

    #[tokio::test]
    async fn review_task_tool_uses_native_agent_runtime() {
        let runtime_root = unique_test_runtime_root("review-task-agent-runtime");
        let (provider_base_url, request_rx) =
            start_openai_compatible_provider("reviewed by runtime agent");
        let config_dir = runtime_root.join("config");
        fs::create_dir_all(&config_dir).expect("config dir");
        fs::write(
            config_dir.join("desktop-agent-provider.json"),
            serde_json::to_vec_pretty(&json!({
                "provider": "openai-compatible",
                "baseUrl": provider_base_url,
                "model": "test-model",
                "apiKey": "test-key"
            }))
            .expect("config json"),
        )
        .expect("write config");

        let output = execute_rust_core_tool(
            &runtime_root,
            "review_task",
            json!({
                "stage": "spec",
                "task": "review this Rust migration"
            }),
        )
        .await
        .expect("review task tool");

        assert_eq!(output["details"]["kind"], "review-spec");
        assert_eq!(
            output["details"]["result"]["assistantText"],
            "reviewed by runtime agent"
        );
        let request = request_rx
            .recv_timeout(std::time::Duration::from_secs(2))
            .expect("captured review provider request");
        assert!(request.contains("review this Rust migration"));

        let _ = fs::remove_dir_all(runtime_root);
    }

    #[tokio::test]
    async fn agent_runtime_run_turn_applies_request_model_selection() {
        let runtime_root = unique_test_runtime_root("agent-run-turn-model-selection");
        let config_dir = runtime_root.join("config");
        fs::create_dir_all(&config_dir).expect("config dir");
        fs::write(
            config_dir.join("desktop-agent-provider.json"),
            serde_json::to_vec_pretty(&json!({
                "provider": "configured-provider",
                "model": "configured-model",
                "apiKey": "test-key"
            }))
            .expect("config json"),
        )
        .expect("write config");

        let runtime = AgentRuntime::with_pi_agent_backend(
            runtime_root,
            Arc::new(FakeAgentRuntimeBackend {
                reply: "selected model reply".to_string(),
            }),
        );
        let result = runtime
            .run_turn(AgentRunRequest {
                run_id: "run-model".to_string(),
                agent_id: "main".to_string(),
                session_key: "thread-model".to_string(),
                inbound: ChannelInboundEnvelope {
                    channel: "gateway".to_string(),
                    account_id: None,
                    from: "user".to_string(),
                    to: "agent:main".to_string(),
                    chat_type: ChannelChatType::Direct,
                    body: "hello selected model".to_string(),
                    raw_body: Some("hello selected model".to_string()),
                    message_id: None,
                    thread_id: Some("thread-model".to_string()),
                    media_urls: Vec::new(),
                    metadata: BTreeMap::new(),
                },
                model: AgentModelSelection {
                    provider: "test-provider".to_string(),
                    model: "test-model".to_string(),
                    reasoning_level: None,
                },
                enabled_tools: Vec::new(),
                options: BTreeMap::new(),
            })
            .await
            .expect("run turn");

        assert_eq!(result.assistant_text, "selected model reply");
    }

    #[tokio::test]
    async fn agent_runtime_btw_turn_is_ephemeral_and_marks_reply_metadata() {
        let runtime_root = unique_test_runtime_root("agent-run-turn-btw");
        let config_dir = runtime_root.join("config");
        fs::create_dir_all(&config_dir).expect("config dir");
        fs::write(
            config_dir.join("desktop-agent-provider.json"),
            serde_json::to_vec_pretty(&json!({
                "provider": "test-provider",
                "model": "test-model",
                "apiKey": "test-key"
            }))
            .expect("config json"),
        )
        .expect("write config");

        let runtime = AgentRuntime::with_pi_agent_backend(
            runtime_root.clone(),
            Arc::new(FakeAgentRuntimeBackend {
                reply: "side answer".to_string(),
            }),
        );
        let result = runtime
            .run_turn(AgentRunRequest {
                run_id: "run-btw".to_string(),
                agent_id: "main".to_string(),
                session_key: "thread-btw".to_string(),
                inbound: ChannelInboundEnvelope {
                    channel: "btw".to_string(),
                    account_id: None,
                    from: "user".to_string(),
                    to: "agent:main".to_string(),
                    chat_type: ChannelChatType::Direct,
                    body: "what changed?".to_string(),
                    raw_body: Some("what changed?".to_string()),
                    message_id: None,
                    thread_id: Some("thread-btw".to_string()),
                    media_urls: Vec::new(),
                    metadata: BTreeMap::new(),
                },
                model: AgentModelSelection {
                    provider: "test-provider".to_string(),
                    model: "test-model".to_string(),
                    reasoning_level: Some("off".to_string()),
                },
                enabled_tools: Vec::new(),
                options: BTreeMap::from([
                    ("mode".to_string(), json!("btw")),
                    ("btwQuestion".to_string(), json!("what changed?")),
                    ("ephemeral".to_string(), json!(true)),
                ]),
            })
            .await
            .expect("btw run turn");

        assert_eq!(result.assistant_text, "side answer");
        assert_eq!(
            serde_json::to_value(&result.events).expect("events json"),
            json!([
                {
                    "type": "runStarted",
                    "runId": "run-btw",
                    "agentId": "main",
                    "sessionKey": "thread-btw"
                },
                {
                    "type": "replyPayload",
                    "runId": "run-btw",
                    "payload": {
                        "text": "side answer",
                        "metadata": {
                            "btw": {
                                "question": "what changed?"
                            }
                        }
                    }
                },
                {
                    "type": "runCompleted",
                    "runId": "run-btw"
                }
            ])
        );
        assert!(!runtime_root
            .join("sessions")
            .join("thread-btw.jsonl")
            .exists());
        let memory_db = runtime_root.join("memory").join("runtime.db");
        if memory_db.exists() {
            let memory_messages = crate::memory::RuntimeStore::new(memory_db)
                .list_messages("thread-btw", 10)
                .expect("memory messages");
            assert!(memory_messages.is_empty());
        }
    }

    #[tokio::test]
    async fn pi_agent_rust_direct_backend_uses_crawclaw_provider_transport() {
        let runtime_root = unique_test_runtime_root("pi-agent-direct-provider-bridge");
        let (provider_base_url, request_rx) =
            start_openai_compatible_provider("reply from provider bridge");
        let config_dir = runtime_root.join("config");
        fs::create_dir_all(&config_dir).expect("config dir");
        fs::write(
            config_dir.join("desktop-agent-provider.json"),
            serde_json::to_vec_pretty(&json!({
                "runtime": "pi-agent-rust",
                "provider": "openai-compatible",
                "baseUrl": provider_base_url,
                "apiKey": "test-key",
                "model": "test-model"
            }))
            .expect("config json"),
        )
        .expect("write config");
        let sessions_dir = runtime_root.join("sessions");
        fs::create_dir_all(&sessions_dir).expect("sessions dir");
        fs::write(
            sessions_dir.join("thread-pi.jsonl"),
            [
                r#"{"role":"user","content":"previous user"}"#,
                r#"{"role":"assistant","content":"previous assistant"}"#,
            ]
            .join("\n"),
        )
        .expect("seed transcript");

        let runtime = AgentRuntime::new(runtime_root);
        let result = runtime
            .send_message("thread-pi".to_string(), "hello bridge".to_string())
            .await
            .expect("pi direct provider bridge result");

        assert_eq!(result.assistant_text, "reply from provider bridge");
        let request = request_rx.recv().expect("captured provider request");
        assert!(request.contains(r#""role":"user""#));
        assert!(request.contains(r#""role":"assistant""#));
        assert!(request.contains("previous user"));
        assert!(request.contains("previous assistant"));
        assert!(request.contains("hello bridge"));
    }

    #[tokio::test]
    async fn pi_agent_rust_provider_bridge_passes_streaming_tools_and_images() {
        let (provider_base_url, request_rx) =
            start_openai_compatible_provider("reply from provider bridge");
        let provider = CrawClawPiProvider {
            config: NativeProviderConfig {
                provider: "openai-compatible".to_string(),
                base_url: Some(provider_base_url),
                api_key: Some("test-key".to_string()),
                model: Some("test-model".to_string()),
                api: None,
                api_version: None,
            },
            reasoning_level: None,
        };
        let context = pi::sdk::ProviderContext::owned(
            None,
            vec![pi::sdk::Message::User(pi::sdk::UserMessage {
                content: pi::sdk::UserContent::Blocks(vec![
                    pi::sdk::ContentBlock::Text(pi::sdk::TextContent::new("describe this")),
                    pi::sdk::ContentBlock::Image(pi::sdk::ImageContent {
                        data: "iVBORw0KGgo=".to_string(),
                        mime_type: "image/png".to_string(),
                    }),
                ]),
                timestamp: 1,
            })],
            vec![pi::sdk::ToolDef {
                name: "lookup_weather".to_string(),
                description: "Look up weather".to_string(),
                parameters: json!({ "type": "object" }),
            }],
        );

        let stream = provider
            .stream(&context, &pi::sdk::StreamOptions::default())
            .await
            .expect("provider stream");
        let events = stream
            .collect::<Vec<_>>()
            .await
            .into_iter()
            .collect::<Result<Vec<_>, _>>()
            .expect("stream events");

        assert!(!events.is_empty());
        let request = request_rx.recv().expect("captured provider request");
        assert!(request.contains(r#""stream":true"#));
        assert!(request.contains("lookup_weather"));
        assert!(request.contains("iVBORw0KGgo="));
    }

    #[tokio::test]
    async fn native_llm_task_tool_runs_host_agent_without_ts_wrapper() {
        let runtime_root = unique_test_runtime_root("native-llm-task-tool");
        let config_dir = runtime_root.join("config");
        fs::create_dir_all(&config_dir).expect("config dir");
        let (provider_base_url, request_rx) = start_openai_compatible_provider(r#"{"ok":true}"#);
        fs::write(
            config_dir.join("desktop-agent-provider.json"),
            serde_json::to_vec_pretty(&json!({
                "provider": "openai-compatible",
                "baseUrl": provider_base_url,
                "apiKey": "test-key",
                "model": "test-model"
            }))
            .expect("config json"),
        )
        .expect("write config");

        let registry = build_pi_agent_rust_tool_registry(&runtime_root);
        let tool = registry
            .tools()
            .iter()
            .find(|tool| tool.name() == "llm-task")
            .expect("llm-task tool");
        let output = tool
            .execute(
                "llm-task-call",
                json!({
                    "prompt": "return ok",
                    "schema": {
                        "type": "object",
                        "properties": { "ok": { "type": "boolean" } },
                        "required": ["ok"]
                    }
                }),
                None,
            )
            .await
            .expect("llm-task execute");

        assert_eq!(
            output.details.as_ref().expect("details")["json"],
            json!({ "ok": true })
        );
        let request = request_rx.recv().expect("captured provider request");
        assert!(request.contains("Return ONLY a valid JSON value."));
        assert!(!request.contains("\"tools\""));

        let _ = fs::remove_dir_all(runtime_root);
    }

    #[tokio::test]
    async fn agent_runtime_rejects_unknown_runtime_modes() {
        let runtime_root = unique_test_runtime_root("unknown-runtime-mode");
        let config_dir = runtime_root.join("config");
        fs::create_dir_all(&config_dir).expect("config dir");
        fs::write(
            config_dir.join("desktop-agent-provider.json"),
            serde_json::to_vec_pretty(&json!({
                "runtime": "legacy-sidecar-mode",
                "provider": "test-provider",
                "model": "test-model"
            }))
            .expect("config json"),
        )
        .expect("write config");

        let runtime = AgentRuntime::with_pi_agent_backend(
            runtime_root,
            Arc::new(FakeAgentRuntimeBackend {
                reply: "should not run".to_string(),
            }),
        );
        let error = runtime
            .send_message("thread-pi".to_string(), "second".to_string())
            .await
            .expect_err("unknown runtime mode should be rejected");

        assert!(error.message().contains("legacy-sidecar-mode"));
    }

    #[test]
    fn resolves_rust_runtime_binary_under_resource_runtime_root() {
        let layout = resolve_runtime_layout(PathBuf::from("/app/Contents/Resources"));

        assert_eq!(
            layout.binary_path,
            PathBuf::from("/app/Contents/Resources/runtime/crawclaw/bin")
                .join(runtime_binary_name())
        );
        assert_eq!(
            layout.manifest_path,
            PathBuf::from("/app/Contents/Resources/runtime/crawclaw/runtimes/manifest.json")
        );
        assert_eq!(
            layout.channel_manifest_path,
            PathBuf::from("/app/Contents/Resources/runtime/crawclaw/channels/manifest.json")
        );
    }

    #[test]
    fn desktop_agent_provider_config_builds_native_provider_config() {
        let runtime_root = unique_test_runtime_root("desktop-agent-provider-config");
        let config = DesktopAgentProviderConfig {
            runtime: DesktopAgentRuntimeMode::NativeProvider,
            provider: "anthropic".to_string(),
            base_url: Some("https://api.anthropic.com".to_string()),
            api_key: Some(json!("secret")),
            model: Some("sonnet-4.6".to_string()),
            api: Some("anthropic-messages".to_string()),
            api_version: Some("2023-06-01".to_string()),
        };

        let native_config = ProviderResolver::resolve_desktop_config(&config, &runtime_root)
            .expect("native provider config");

        assert_eq!(native_config.provider, "anthropic");
        assert_eq!(native_config.model.as_deref(), Some("sonnet-4.6"));
        assert_eq!(native_config.api.as_deref(), Some("anthropic-messages"));
        assert_eq!(native_config.api_version.as_deref(), Some("2023-06-01"));
    }

    #[test]
    fn desktop_agent_provider_config_uses_rust_default_model_catalog() {
        let runtime_root = unique_test_runtime_root("desktop-agent-provider-default-model");
        let config = DesktopAgentProviderConfig {
            runtime: DesktopAgentRuntimeMode::NativeProvider,
            provider: "openai".to_string(),
            base_url: None,
            api_key: Some(json!("secret")),
            model: None,
            api: None,
            api_version: None,
        };

        let native_config = ProviderResolver::resolve_desktop_config(&config, &runtime_root)
            .expect("native provider config");

        assert_eq!(native_config.provider, "openai");
        assert_eq!(native_config.model.as_deref(), Some("gpt-5.4"));
    }

    #[test]
    fn desktop_agent_provider_config_rejects_non_chat_provider_descriptors() {
        let runtime_root = unique_test_runtime_root("desktop-agent-provider-non-chat");
        let config = DesktopAgentProviderConfig {
            runtime: DesktopAgentRuntimeMode::NativeProvider,
            provider: "fal".to_string(),
            base_url: None,
            api_key: Some(json!("secret")),
            model: None,
            api: None,
            api_version: None,
        };

        let error = ProviderResolver::resolve_desktop_config(&config, &runtime_root)
            .expect_err("non-chat provider should be rejected");

        assert!(error
            .message()
            .contains("does not expose a Rust-native chat transport"));
    }

    #[test]
    fn desktop_agent_provider_config_resolves_file_secret_ref_api_key() {
        let runtime_root = unique_test_runtime_root("desktop-agent-provider-secret-ref");
        let secret_path = runtime_root.join("secrets").join("provider-api-key");
        fs::create_dir_all(secret_path.parent().expect("secret parent")).expect("secret dir");
        fs::write(&secret_path, "resolved-secret\n").expect("write secret");
        let config = DesktopAgentProviderConfig {
            runtime: DesktopAgentRuntimeMode::NativeProvider,
            provider: "openai-compatible".to_string(),
            base_url: Some("https://api.example.test/v1".to_string()),
            api_key: Some(json!({
                "source": "file",
                "provider": "default",
                "id": secret_path.to_string_lossy()
            })),
            model: Some("model-a".to_string()),
            api: None,
            api_version: None,
        };

        let native_config = ProviderResolver::resolve_desktop_config(&config, &runtime_root)
            .expect("native provider config");

        assert_eq!(native_config.api_key.as_deref(), Some("resolved-secret"));
    }

    #[derive(Clone)]
    struct FakeAgentRuntimeBackend {
        reply: String,
    }

    impl AgentRuntimeBackend for FakeAgentRuntimeBackend {
        fn send_message<'a>(
            &'a self,
            request: AgentRuntimeRequest<'a>,
        ) -> Pin<Box<dyn Future<Output = Result<String, AgentRuntimeError>> + Send + 'a>> {
            Box::pin(async move {
                assert_eq!(request.provider_config.provider, "test-provider");
                assert_eq!(request.provider_config.model.as_deref(), Some("test-model"));
                assert_eq!(request.provider_config.api_key.as_deref(), Some("test-key"));
                assert!(request.history.is_empty());
                Ok(self.reply.clone())
            })
        }
    }

    fn unique_test_runtime_root(name: &str) -> PathBuf {
        let unique = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("clock")
            .as_nanos();
        std::env::temp_dir().join(format!(
            "crawclaw-runtime-{name}-{}-{unique}",
            std::process::id()
        ))
    }

    fn start_openai_compatible_provider(reply: &str) -> (String, mpsc::Receiver<String>) {
        let listener = TcpListener::bind("127.0.0.1:0").expect("provider listener");
        let addr = listener.local_addr().expect("provider addr");
        let reply = reply.to_string();
        let (request_tx, request_rx) = mpsc::channel();
        thread::spawn(move || {
            let (mut stream, _) = listener.accept().expect("provider request");
            let request = read_http_request(&mut stream);
            let request_text = String::from_utf8_lossy(&request).to_string();
            request_tx
                .send(request_text.clone())
                .expect("send captured request");
            let (content_type, body) = if request_text.contains(r#""stream":true"#) {
                let chunk = serde_json::to_string(&json!({
                    "choices": [
                        {
                            "delta": {
                                "content": reply
                            }
                        }
                    ]
                }))
                .expect("response chunk");
                (
                    "text/event-stream",
                    format!("data: {chunk}\n\ndata: [DONE]\n\n"),
                )
            } else {
                (
                    "application/json",
                    serde_json::to_string(&json!({
                        "choices": [
                            {
                                "message": {
                                    "content": reply
                                }
                            }
                        ]
                    }))
                    .expect("response body"),
                )
            };
            write!(
                stream,
                "HTTP/1.1 200 OK\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                body.len(),
                body
            )
            .expect("write response");
        });
        (format!("http://{addr}/v1"), request_rx)
    }

    fn read_http_request(stream: &mut std::net::TcpStream) -> Vec<u8> {
        let mut request = Vec::new();
        let mut buffer = [0_u8; 8192];
        loop {
            let count = stream.read(&mut buffer).expect("read request");
            if count == 0 {
                break;
            }
            request.extend_from_slice(&buffer[..count]);
            if http_request_complete(&request) {
                break;
            }
        }
        request
    }

    fn http_request_complete(request: &[u8]) -> bool {
        let Some(header_end) = request.windows(4).position(|window| window == b"\r\n\r\n") else {
            return false;
        };
        let headers = String::from_utf8_lossy(&request[..header_end]);
        let content_length = headers.lines().find_map(|line| {
            let (name, value) = line.split_once(':')?;
            if name.eq_ignore_ascii_case("content-length") {
                value.trim().parse::<usize>().ok()
            } else {
                None
            }
        });
        let Some(content_length) = content_length else {
            return true;
        };
        request.len() >= header_end + 4 + content_length
    }

    fn tool_output_text(output: &pi::sdk::ToolOutput) -> String {
        output
            .content
            .iter()
            .filter_map(|block| match block {
                pi::sdk::ContentBlock::Text(text) => Some(text.text.as_str()),
                _ => None,
            })
            .collect::<Vec<_>>()
            .join("\n")
    }
}
