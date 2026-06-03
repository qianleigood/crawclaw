#![recursion_limit = "512"]

extern crate self as pi;

use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::future::Future;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::pin::Pin;
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

pub mod agent_definitions;
pub mod core_tools;
pub mod cron;
pub mod memory;
mod message_policy;
mod native_plugin_registry;
pub mod sdk;
pub mod special_agents;

mod agent_context;
mod agent_context_budget;
mod agent_loop_events;
mod agent_prompts;
mod agent_provider_bridge;
mod agent_runtime_backend;
mod agent_runtime_permissions;
mod agent_runtime_types;
mod agent_tool_result_projection;
mod desktop_runtime_stores;
mod runtime_tool_catalog;
use self::agent_context::*;
use self::agent_context_budget::*;
use self::agent_loop_events::*;
use self::agent_provider_bridge::*;
pub use self::agent_runtime_backend::*;
pub use self::agent_runtime_permissions::*;
pub use self::agent_runtime_types::*;
pub use self::desktop_runtime_stores::*;
pub use self::runtime_tool_catalog::*;

pub use core_tools::core_tools_mcp::{
    mcp_prompt_slash_commands, mcp_server_runtime_statuses, send_mcp_jsonrpc_message,
};
use core_tools::{
    build_native_runtime_tool_registry, build_native_runtime_tool_registry_with_special_agent,
};
pub use message_policy::execute_message_policy_operation;
pub use native_plugin_registry::{
    dispatch_native_service_lifecycle, invoke_native_plugin_operation, load_native_plugin_registry,
    with_native_runtime_context, NativePluginRegistry, NativePluginRegistryDiagnostic,
    NativePluginRuntime, NativeSidecarCommand, NativeToolRegistration,
};

pub use crawclaw_channels::{
    canonical_agent_run_event_types, channel_contract_version, dispatch_native_channel_outbound,
    find_native_channel_descriptor, is_local_native_delivery_channel,
    list_native_channel_descriptors, lookup_native_channel_directory,
    resolve_native_channel_lifecycle_update, AgentModelSelection, AgentRunEvent,
    AgentRunProfileKind, AgentRunProfileRequest, AgentRunRequest, ChannelCapabilityDescriptor,
    ChannelDeliveryResult, ChannelDirectoryLookupRequest, ChannelDirectoryLookupResult,
    ChannelInboundCapability, ChannelInboundEnvelope, ChannelLifecycleCapability,
    ChannelOutboundAction, ChannelOutboundCapability, ChannelOutboundRequest,
    ChatType as ChannelChatType, MessagingTarget, MessagingTargetKind, NativeChannelDeliveryRecord,
    NativeChannelDispatchContext, NativeChannelLifecycleInput, NativeChannelLifecycleUpdate,
    ReplyPayload, TranscriptRole,
};
use crawclaw_core::{RuntimeCompatStatus, RuntimeStatusValue};
use crawclaw_plugin_sdk::{NativeInvocationTarget, NativePluginDescriptor};
use crawclaw_providers::{
    send_native_provider_conversation_response_with_options, NativeProviderAssistantResponse,
    NativeProviderConfig, NativeProviderContentBlock, NativeProviderMessage,
    NativeProviderMessageRole, NativeProviderRequestOptions, ProviderTransportError,
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
            "channels": crawclaw_channels::native_channels(),
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
            "nativeChannels": crawclaw_channels::native_channel_ids(),
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

#[cfg(test)]
mod tests;
