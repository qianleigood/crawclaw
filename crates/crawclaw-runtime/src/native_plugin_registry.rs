use std::collections::BTreeSet;
use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::thread;
use std::time::{Duration, Instant};

use crawclaw_plugin_sdk::{
    NativeDescribeRequest, NativeDescribeResponse, NativeInvocationRequest, NativeInvocationTarget,
    NativeJsonRpcRequest, NativeJsonRpcResponse, NativeMediaUnderstandingProviderDescriptor,
    NativeModelProviderDescriptor, NativePluginDescriptor, NativePluginDiscovery,
    NativeServiceLifecycleRequest, NativeSpeechProviderDescriptor, NativeToolDescriptor,
    NativeWebFetchProviderDescriptor, NativeWebSearchProviderDescriptor,
    NATIVE_PLUGIN_JSONRPC_PROTOCOL, NATIVE_PLUGIN_JSONRPC_VERSION, NATIVE_PLUGIN_SCHEMA_VERSION,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

const SIDECAR_TIMEOUT: Duration = Duration::from_secs(2);

#[derive(Clone, Debug)]
pub enum NativePluginRuntime {
    Builtin,
    Sidecar(NativeSidecarCommand),
}

#[derive(Clone, Debug)]
pub struct NativeSidecarCommand {
    pub cwd: PathBuf,
    pub program: PathBuf,
    pub args: Vec<String>,
}

#[derive(Clone, Debug)]
pub struct NativePluginRegistryEntry {
    pub descriptor: NativePluginDescriptor,
    pub runtime: NativePluginRuntime,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct NativePluginRegistryDiagnostic {
    pub plugin_id: Option<String>,
    pub manifest_path: String,
    pub code: String,
    pub message: String,
}

#[derive(Clone, Debug)]
pub struct NativePluginRegistry {
    pub entries: Vec<NativePluginRegistryEntry>,
    pub diagnostics: Vec<NativePluginRegistryDiagnostic>,
}

#[derive(Clone, Debug)]
pub struct NativeToolRegistration {
    pub plugin_id: String,
    pub descriptor: NativeToolDescriptor,
    pub runtime: NativePluginRuntime,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct NativePluginManifest {
    #[serde(default)]
    id: Option<String>,
    #[serde(default)]
    native: Option<NativePluginDiscovery>,
}

impl NativePluginRegistry {
    pub fn descriptors(&self) -> Vec<NativePluginDescriptor> {
        self.entries
            .iter()
            .map(|entry| entry.descriptor.clone())
            .collect()
    }

    pub fn tool_registrations(&self) -> Vec<NativeToolRegistration> {
        self.entries
            .iter()
            .flat_map(|entry| {
                let plugin_id = entry.descriptor.plugin_id.clone();
                let runtime = entry.runtime.clone();
                entry
                    .descriptor
                    .tools
                    .clone()
                    .into_iter()
                    .map(move |descriptor| NativeToolRegistration {
                        plugin_id: plugin_id.clone(),
                        descriptor,
                        runtime: runtime.clone(),
                    })
            })
            .collect()
    }

    pub fn tool_descriptors(&self) -> Vec<(String, NativeToolDescriptor)> {
        self.tool_registrations()
            .into_iter()
            .map(|entry| (entry.plugin_id, entry.descriptor))
            .collect()
    }

    pub fn model_provider_descriptors(&self) -> Vec<NativeModelProviderDescriptor> {
        self.entries
            .iter()
            .flat_map(|entry| entry.descriptor.model_providers.clone())
            .collect()
    }

    pub fn web_search_provider_descriptors(&self) -> Vec<NativeWebSearchProviderDescriptor> {
        self.entries
            .iter()
            .flat_map(|entry| entry.descriptor.web_search_providers.clone())
            .collect()
    }

    pub fn web_fetch_provider_descriptors(&self) -> Vec<NativeWebFetchProviderDescriptor> {
        self.entries
            .iter()
            .flat_map(|entry| entry.descriptor.web_fetch_providers.clone())
            .collect()
    }

    pub fn speech_provider_descriptors(&self) -> Vec<NativeSpeechProviderDescriptor> {
        self.entries
            .iter()
            .flat_map(|entry| entry.descriptor.speech_providers.clone())
            .collect()
    }

    pub fn media_understanding_provider_descriptors(
        &self,
    ) -> Vec<NativeMediaUnderstandingProviderDescriptor> {
        self.entries
            .iter()
            .flat_map(|entry| entry.descriptor.media_understanding_providers.clone())
            .collect()
    }
}

pub fn load_native_plugin_registry(runtime_root: &Path) -> NativePluginRegistry {
    let mut diagnostics = Vec::new();
    let mut seen = BTreeSet::new();
    let mut entries = crawclaw_native_plugins::registry::builtin_native_plugin_descriptors()
        .into_iter()
        .map(|descriptor| {
            seen.insert(descriptor.plugin_id.clone());
            NativePluginRegistryEntry {
                descriptor,
                runtime: NativePluginRuntime::Builtin,
            }
        })
        .collect::<Vec<_>>();

    for manifest_path in native_plugin_manifest_paths(runtime_root) {
        let manifest_dir = manifest_path
            .parent()
            .map(Path::to_path_buf)
            .unwrap_or_else(|| runtime_root.to_path_buf());
        match read_native_manifest(&manifest_path) {
            Ok(Some((plugin_id, native))) => {
                if seen.contains(&plugin_id) {
                    diagnostics.push(diagnostic(
                        Some(plugin_id),
                        &manifest_path,
                        "duplicate_plugin_id",
                        "Installed native sidecar descriptor was ignored because a descriptor with the same plugin id is already registered.",
                    ));
                    continue;
                }
                let command = match sidecar_command(&manifest_dir, &native) {
                    Ok(command) => command,
                    Err(message) => {
                        diagnostics.push(diagnostic(
                            Some(plugin_id),
                            &manifest_path,
                            "invalid_native_command",
                            message,
                        ));
                        continue;
                    }
                };
                match describe_sidecar(&command, Some(&plugin_id)) {
                    Ok(descriptors) => {
                        let mut accepted = 0usize;
                        for descriptor in descriptors {
                            if let Err(message) = validate_sidecar_descriptor(&descriptor) {
                                diagnostics.push(diagnostic(
                                    Some(plugin_id.clone()),
                                    &manifest_path,
                                    "invalid_descriptor",
                                    message,
                                ));
                                continue;
                            }
                            if seen.contains(&descriptor.plugin_id) {
                                diagnostics.push(diagnostic(
                                    Some(descriptor.plugin_id),
                                    &manifest_path,
                                    "duplicate_plugin_id",
                                    "Sidecar descriptor was ignored because a descriptor with the same plugin id is already registered.",
                                ));
                                continue;
                            }
                            seen.insert(descriptor.plugin_id.clone());
                            entries.push(NativePluginRegistryEntry {
                                descriptor,
                                runtime: NativePluginRuntime::Sidecar(command.clone()),
                            });
                            accepted += 1;
                        }
                        if accepted == 0 {
                            diagnostics.push(diagnostic(
                                Some(plugin_id),
                                &manifest_path,
                                "empty_sidecar_descriptor",
                                "Native sidecar did not return any usable plugin descriptors.",
                            ));
                        }
                    }
                    Err(message) => diagnostics.push(diagnostic(
                        Some(plugin_id),
                        &manifest_path,
                        "sidecar_describe_failed",
                        message,
                    )),
                }
            }
            Ok(None) => {}
            Err(message) => diagnostics.push(diagnostic(
                None,
                &manifest_path,
                "manifest_read_failed",
                message,
            )),
        }
    }

    NativePluginRegistry {
        entries,
        diagnostics,
    }
}

pub async fn invoke_native_plugin_operation(
    runtime: NativePluginRuntime,
    target: NativeInvocationTarget,
    input: Value,
) -> Result<Value, String> {
    match runtime {
        NativePluginRuntime::Builtin => {
            crawclaw_native_plugins::registry::dispatch_builtin_native_plugin_operation(
                &target.plugin_id,
                &target.operation,
                input,
            )
            .await
            .map_err(|error| error.to_string())
        }
        NativePluginRuntime::Sidecar(command) => tokio::task::spawn_blocking(move || {
            invoke_sidecar(
                &command,
                "plugin.invoke",
                json!(NativeInvocationRequest { target, input }),
            )
            .and_then(|result| {
                result
                    .get("output")
                    .cloned()
                    .ok_or_else(|| "sidecar plugin.invoke response missing output".to_string())
            })
        })
        .await
        .map_err(|error| format!("sidecar task failed: {error}"))?,
    }
}

pub fn with_native_runtime_context(runtime_root: &Path, input: Value) -> Value {
    let mut object = match input {
        Value::Object(object) => object,
        other => {
            let mut wrapper = serde_json::Map::new();
            wrapper.insert("params".to_string(), other);
            wrapper
        }
    };
    let plugin_config = object
        .entry("pluginConfig".to_string())
        .or_insert_with(|| json!({}));
    if !plugin_config.is_object() {
        *plugin_config = json!({});
    }
    if let Some(config) = plugin_config.as_object_mut() {
        config
            .entry("runtimeRoot".to_string())
            .or_insert_with(|| Value::String(runtime_root.to_string_lossy().to_string()));
        config.entry("runtimesRoot".to_string()).or_insert_with(|| {
            Value::String(runtime_root.join("runtimes").to_string_lossy().to_string())
        });
        let node_bin = runtime_root
            .join("runtimes")
            .join("node-v24")
            .join("bin")
            .join(if cfg!(windows) { "node.exe" } else { "node" });
        if node_bin.exists() {
            config
                .entry("nodeBinPath".to_string())
                .or_insert_with(|| Value::String(node_bin.to_string_lossy().to_string()));
        }
    }
    Value::Object(object)
}

pub async fn dispatch_native_service_lifecycle(
    registry: NativePluginRegistry,
    plugin_id: &str,
    service_id: &str,
    start: bool,
    input: Value,
) -> Result<Value, String> {
    let requested_plugin_id = plugin_id.to_string();
    let entry = registry
        .entries
        .into_iter()
        .find(|entry| entry.descriptor.plugin_id == plugin_id)
        .ok_or_else(|| format!("unknown native plugin: {plugin_id}"))?;
    let service = entry
        .descriptor
        .services
        .into_iter()
        .find(|service| service.id == service_id)
        .ok_or_else(|| format!("unknown native plugin service: {plugin_id}/{service_id}"))?;
    match entry.runtime {
        NativePluginRuntime::Builtin => {
            crawclaw_native_plugins::registry::dispatch_builtin_native_service_lifecycle(
                plugin_id, service_id, start, input,
            )
            .await
            .map_err(|error| error.to_string())
        }
        NativePluginRuntime::Sidecar(command) => {
            let method = if start {
                "plugin.service.start"
            } else {
                "plugin.service.stop"
            };
            tokio::task::spawn_blocking(move || {
                invoke_sidecar(
                    &command,
                    method,
                    json!(NativeServiceLifecycleRequest {
                        plugin_id: requested_plugin_id,
                        service_id: service.id,
                        input,
                    }),
                )
            })
            .await
            .map_err(|error| format!("sidecar task failed: {error}"))?
        }
    }
}

fn native_plugin_manifest_paths(runtime_root: &Path) -> Vec<PathBuf> {
    let plugins_dir = runtime_root.join("plugins");
    let Ok(entries) = fs::read_dir(plugins_dir) else {
        return Vec::new();
    };
    let mut paths = entries
        .flatten()
        .filter_map(|entry| {
            let path = entry.path();
            path.is_dir()
                .then(|| path.join("crawclaw.plugin.json"))
                .filter(|manifest| manifest.exists())
        })
        .collect::<Vec<_>>();
    paths.sort();
    paths
}

fn read_native_manifest(
    manifest_path: &Path,
) -> Result<Option<(String, NativePluginDiscovery)>, String> {
    let raw = fs::read_to_string(manifest_path)
        .map_err(|error| format!("failed to read manifest: {error}"))?;
    let manifest = serde_json::from_str::<NativePluginManifest>(&raw)
        .map_err(|error| format!("invalid plugin manifest JSON: {error}"))?;
    let Some(native) = manifest.native else {
        return Ok(None);
    };
    if native.protocol != NATIVE_PLUGIN_JSONRPC_PROTOCOL
        || native.schema_version != NATIVE_PLUGIN_SCHEMA_VERSION
    {
        return Ok(None);
    }
    let plugin_id = manifest
        .id
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "native plugin manifest is missing id".to_string())?;
    Ok(Some((plugin_id, native)))
}

fn sidecar_command(
    plugin_dir: &Path,
    native: &NativePluginDiscovery,
) -> Result<NativeSidecarCommand, String> {
    if let Some((program, args)) = native.command.split_first() {
        if program.trim().is_empty() {
            return Err("native.command program is empty".to_string());
        }
        return Ok(NativeSidecarCommand {
            cwd: plugin_dir.to_path_buf(),
            program: PathBuf::from(program),
            args: args.to_vec(),
        });
    }
    let bin = native
        .bin
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "native.bin or native.command is required".to_string())?;
    let program = PathBuf::from(bin);
    let program = if program.is_absolute() {
        program
    } else {
        plugin_dir.join(program)
    };
    Ok(NativeSidecarCommand {
        cwd: plugin_dir.to_path_buf(),
        program,
        args: Vec::new(),
    })
}

fn describe_sidecar(
    command: &NativeSidecarCommand,
    plugin_id: Option<&str>,
) -> Result<Vec<NativePluginDescriptor>, String> {
    let params = serde_json::to_value(NativeDescribeRequest {
        plugin_id: plugin_id.map(ToOwned::to_owned),
    })
    .map_err(|error| error.to_string())?;
    let result = invoke_sidecar(command, "plugin.describe", params)?;
    serde_json::from_value::<NativeDescribeResponse>(result)
        .map(|response| response.descriptors)
        .map_err(|error| format!("invalid plugin.describe response: {error}"))
}

fn invoke_sidecar(
    command: &NativeSidecarCommand,
    method: &str,
    params: Value,
) -> Result<Value, String> {
    let mut child = Command::new(&command.program)
        .args(&command.args)
        .current_dir(&command.cwd)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|error| {
            format!(
                "failed to spawn native sidecar {}: {error}",
                command.program.display()
            )
        })?;

    let request = NativeJsonRpcRequest {
        jsonrpc: NATIVE_PLUGIN_JSONRPC_VERSION.to_string(),
        id: json!("describe"),
        method: method.to_string(),
        params,
    };
    {
        let stdin = child
            .stdin
            .as_mut()
            .ok_or_else(|| "native sidecar stdin is unavailable".to_string())?;
        writeln!(
            stdin,
            "{}",
            serde_json::to_string(&request).map_err(|error| error.to_string())?
        )
        .map_err(|error| format!("failed to write native sidecar request: {error}"))?;
    }
    drop(child.stdin.take());

    let deadline = Instant::now() + SIDECAR_TIMEOUT;
    loop {
        match child.try_wait() {
            Ok(Some(status)) => {
                if !status.success() {
                    return Err(format!("native sidecar exited with {status}"));
                }
                break;
            }
            Ok(None) if Instant::now() >= deadline => {
                let _ = child.kill();
                let _ = child.wait();
                return Err("native sidecar timed out".to_string());
            }
            Ok(None) => thread::sleep(Duration::from_millis(10)),
            Err(error) => return Err(format!("failed to wait for native sidecar: {error}")),
        }
    }

    let mut stdout = String::new();
    child
        .stdout
        .take()
        .ok_or_else(|| "native sidecar stdout is unavailable".to_string())?
        .read_to_string(&mut stdout)
        .map_err(|error| format!("failed to read native sidecar stdout: {error}"))?;
    let response_line = stdout
        .lines()
        .find(|line| !line.trim().is_empty())
        .ok_or_else(|| "native sidecar returned no JSON-RPC response".to_string())?;
    let response = serde_json::from_str::<NativeJsonRpcResponse>(response_line)
        .map_err(|error| format!("invalid native sidecar JSON-RPC response: {error}"))?;
    if let Some(error) = response.error {
        return Err(format!("{}: {}", error.code, error.message));
    }
    response
        .result
        .ok_or_else(|| "native sidecar JSON-RPC response missing result".to_string())
}

fn validate_sidecar_descriptor(descriptor: &NativePluginDescriptor) -> Result<(), String> {
    if descriptor.schema_version != NATIVE_PLUGIN_SCHEMA_VERSION {
        return Err(format!(
            "unsupported schemaVersion {}; expected {}",
            descriptor.schema_version, NATIVE_PLUGIN_SCHEMA_VERSION
        ));
    }
    if descriptor.plugin_id.trim().is_empty() {
        return Err("descriptor pluginId is empty".to_string());
    }
    Ok(())
}

fn diagnostic(
    plugin_id: Option<String>,
    manifest_path: &Path,
    code: &str,
    message: impl Into<String>,
) -> NativePluginRegistryDiagnostic {
    NativePluginRegistryDiagnostic {
        plugin_id,
        manifest_path: manifest_path.to_string_lossy().to_string(),
        code: code.to_string(),
        message: message.into(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(unix)]
    #[test]
    fn registry_merges_installed_sidecar_descriptors() {
        use std::os::unix::fs::PermissionsExt;

        let root = tempfile::tempdir().expect("temp root");
        let plugin_dir = root.path().join("plugins").join("acme-native");
        fs::create_dir_all(&plugin_dir).expect("plugin dir");
        let sidecar = plugin_dir.join("sidecar.sh");
        fs::write(
            &sidecar,
            r#"#!/bin/sh
read line
printf '%s\n' '{"jsonrpc":"2.0","id":"describe","result":{"descriptors":[{"schemaVersion":1,"pluginId":"acme-native","name":"Acme Native","tools":[{"name":"acme_tool","label":"Acme Tool","description":"Runs native work.","parameters":{"type":"object"},"invocation":{"pluginId":"acme-native","operation":"run"},"readOnly":true}],"webSearchProviders":[{"id":"acme-search","label":"Acme Search","invocation":{"pluginId":"acme-native","operation":"search"}}]}]}}'
"#,
        )
        .expect("sidecar");
        let mut permissions = fs::metadata(&sidecar).expect("metadata").permissions();
        permissions.set_mode(0o755);
        fs::set_permissions(&sidecar, permissions).expect("permissions");
        fs::write(
            plugin_dir.join("crawclaw.plugin.json"),
            serde_json::to_string(&json!({
                "id": "acme-native",
                "native": {
                    "protocol": "crawclaw-native-plugin-jsonrpc",
                    "schemaVersion": 1,
                    "bin": "sidecar.sh"
                }
            }))
            .expect("manifest"),
        )
        .expect("write manifest");

        let registry = load_native_plugin_registry(root.path());

        assert!(
            registry.diagnostics.is_empty(),
            "{:?}",
            registry.diagnostics
        );
        assert!(registry
            .descriptors()
            .iter()
            .any(|descriptor| descriptor.plugin_id == "acme-native"));
        assert!(registry
            .tool_descriptors()
            .iter()
            .any(|(_, descriptor)| descriptor.name == "acme_tool"));
        assert!(registry
            .web_search_provider_descriptors()
            .iter()
            .any(|descriptor| descriptor.id == "acme-search"));
    }
}
