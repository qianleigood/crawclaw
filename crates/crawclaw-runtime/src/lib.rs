use std::collections::BTreeMap;
use std::fs;
use std::future::Future;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::pin::Pin;
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

mod core_tools;
pub mod cron;
pub mod memory;
pub mod special_agents;

use core_tools::build_pi_agent_rust_tool_registry;

use crawclaw_core::{RuntimeCompatMode, RuntimeCompatStatus, RuntimeStatusValue};
use crawclaw_providers::{
    send_native_provider_conversation, send_native_provider_conversation_with_options,
    NativeProviderConfig, NativeProviderContentBlock, NativeProviderMessage,
    NativeProviderMessageRole, NativeProviderRequestOptions, NativeProviderTool,
    ProviderTransportError,
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
        "crawclaw.exe"
    } else {
        "crawclaw"
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
        args: vec![
            "desktop-runtime".to_string(),
            "status".to_string(),
            "--json".to_string(),
        ],
        cwd: layout.runtime_root.clone(),
    }
}

pub fn build_gateway_help_command(layout: &RuntimeLayout) -> RuntimeCommand {
    RuntimeCommand {
        program: layout.binary_path.clone(),
        args: vec!["gateway".to_string(), "--help".to_string()],
        cwd: layout.runtime_root.clone(),
    }
}

pub fn inspect_runtime_layout(layout: &RuntimeLayout) -> NativeRuntimeStatus {
    let missing = required_runtime_files(layout)
        .into_iter()
        .find(|path| !path.exists());
    let status = if missing.is_some() {
        RuntimeStatusValue::Missing
    } else {
        RuntimeStatusValue::Ready
    };
    let detail = match missing {
        Some(path) => format!("Missing embedded runtime file: {}", path.display()),
        None => "Embedded Rust runtime is available.".to_string(),
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

fn required_runtime_files(layout: &RuntimeLayout) -> Vec<&Path> {
    vec![
        layout.runtime_root.as_path(),
        layout.binary_path.as_path(),
        layout.channel_manifest_path.as_path(),
        layout.manifest_path.as_path(),
    ]
}

fn compat_status(status: &RuntimeStatusValue) -> RuntimeCompatStatus {
    if *status == RuntimeStatusValue::Ready {
        RuntimeCompatStatus {
            mode: RuntimeCompatMode::PiQuickJs,
            detail: "Pi QuickJS extension runtime is managed by the Rust plugin host.".to_string(),
        }
    } else {
        RuntimeCompatStatus::default()
    }
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
}

const RUST_CORE_TOOL_DEFINITIONS: &[RustCoreToolDefinition] = &[
    RustCoreToolDefinition {
        id: "read",
        backing_runtime_id: "read",
        status: RustCoreToolStatus::RustNative,
        default_enabled: true,
        read_only: true,
    },
    RustCoreToolDefinition {
        id: "write",
        backing_runtime_id: "write",
        status: RustCoreToolStatus::RustNative,
        default_enabled: true,
        read_only: false,
    },
    RustCoreToolDefinition {
        id: "edit",
        backing_runtime_id: "edit",
        status: RustCoreToolStatus::RustNative,
        default_enabled: true,
        read_only: false,
    },
    RustCoreToolDefinition {
        id: "apply_patch",
        backing_runtime_id: "apply_patch",
        status: RustCoreToolStatus::RustNative,
        default_enabled: true,
        read_only: false,
    },
    RustCoreToolDefinition {
        id: "bash",
        backing_runtime_id: "bash",
        status: RustCoreToolStatus::RustNative,
        default_enabled: true,
        read_only: false,
    },
    RustCoreToolDefinition {
        id: "process",
        backing_runtime_id: "process",
        status: RustCoreToolStatus::RustNative,
        default_enabled: true,
        read_only: false,
    },
    RustCoreToolDefinition {
        id: "session_status",
        backing_runtime_id: "session_status",
        status: RustCoreToolStatus::RustNative,
        default_enabled: true,
        read_only: true,
    },
    RustCoreToolDefinition {
        id: "sessions_list",
        backing_runtime_id: "sessions_list",
        status: RustCoreToolStatus::RustNative,
        default_enabled: true,
        read_only: true,
    },
    RustCoreToolDefinition {
        id: "sessions_history",
        backing_runtime_id: "sessions_history",
        status: RustCoreToolStatus::RustNative,
        default_enabled: true,
        read_only: true,
    },
    RustCoreToolDefinition {
        id: "sessions_send",
        backing_runtime_id: "sessions_send",
        status: RustCoreToolStatus::RustNative,
        default_enabled: true,
        read_only: false,
    },
    RustCoreToolDefinition {
        id: "sessions_spawn",
        backing_runtime_id: "sessions_spawn",
        status: RustCoreToolStatus::RustNative,
        default_enabled: true,
        read_only: false,
    },
    RustCoreToolDefinition {
        id: "sessions_yield",
        backing_runtime_id: "sessions_yield",
        status: RustCoreToolStatus::RustNative,
        default_enabled: true,
        read_only: false,
    },
    RustCoreToolDefinition {
        id: "subagents",
        backing_runtime_id: "subagents",
        status: RustCoreToolStatus::RustNative,
        default_enabled: true,
        read_only: true,
    },
    RustCoreToolDefinition {
        id: "cron",
        backing_runtime_id: "cron",
        status: RustCoreToolStatus::RustNative,
        default_enabled: true,
        read_only: false,
    },
    RustCoreToolDefinition {
        id: "review_task",
        backing_runtime_id: "review_task",
        status: RustCoreToolStatus::RustNative,
        default_enabled: true,
        read_only: true,
    },
    RustCoreToolDefinition {
        id: "memory_manifest_read",
        backing_runtime_id: "memory_manifest_read",
        status: RustCoreToolStatus::RustNative,
        default_enabled: true,
        read_only: true,
    },
    RustCoreToolDefinition {
        id: "memory_note_read",
        backing_runtime_id: "memory_note_read",
        status: RustCoreToolStatus::RustNative,
        default_enabled: true,
        read_only: true,
    },
    RustCoreToolDefinition {
        id: "memory_note_write",
        backing_runtime_id: "memory_note_write",
        status: RustCoreToolStatus::RustNative,
        default_enabled: true,
        read_only: false,
    },
    RustCoreToolDefinition {
        id: "memory_note_edit",
        backing_runtime_id: "memory_note_edit",
        status: RustCoreToolStatus::RustNative,
        default_enabled: true,
        read_only: false,
    },
    RustCoreToolDefinition {
        id: "memory_note_delete",
        backing_runtime_id: "memory_note_delete",
        status: RustCoreToolStatus::RustNative,
        default_enabled: true,
        read_only: false,
    },
    RustCoreToolDefinition {
        id: "write_experience_note",
        backing_runtime_id: "write_experience_note",
        status: RustCoreToolStatus::RustNative,
        default_enabled: true,
        read_only: false,
    },
    RustCoreToolDefinition {
        id: "session_summary_file_read",
        backing_runtime_id: "session_summary_file_read",
        status: RustCoreToolStatus::RustNative,
        default_enabled: true,
        read_only: true,
    },
    RustCoreToolDefinition {
        id: "session_summary_file_edit",
        backing_runtime_id: "session_summary_file_edit",
        status: RustCoreToolStatus::RustNative,
        default_enabled: true,
        read_only: false,
    },
    RustCoreToolDefinition {
        id: "web_search",
        backing_runtime_id: "web_search",
        status: RustCoreToolStatus::RustNative,
        default_enabled: true,
        read_only: true,
    },
    RustCoreToolDefinition {
        id: "web_fetch",
        backing_runtime_id: "web_fetch",
        status: RustCoreToolStatus::RustNative,
        default_enabled: true,
        read_only: true,
    },
    RustCoreToolDefinition {
        id: "grep",
        backing_runtime_id: "grep",
        status: RustCoreToolStatus::RustNative,
        default_enabled: true,
        read_only: true,
    },
    RustCoreToolDefinition {
        id: "find",
        backing_runtime_id: "find",
        status: RustCoreToolStatus::RustNative,
        default_enabled: true,
        read_only: true,
    },
    RustCoreToolDefinition {
        id: "ls",
        backing_runtime_id: "ls",
        status: RustCoreToolStatus::RustNative,
        default_enabled: true,
        read_only: true,
    },
];

pub fn rust_core_tool_definitions() -> &'static [RustCoreToolDefinition] {
    RUST_CORE_TOOL_DEFINITIONS
}

pub fn pi_agent_rust_tool_names() -> Vec<&'static str> {
    RUST_CORE_TOOL_DEFINITIONS
        .iter()
        .map(|definition| definition.id)
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
            _ => json!({ "type": "unsupported" }),
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

    pub async fn send_message(
        &self,
        thread_id: String,
        user_text: String,
    ) -> Result<AgentSendResult, AgentRuntimeError> {
        let config = self.read_provider_config()?;
        let history = self.load_thread_history(&thread_id)?;
        let assistant_text = match config.runtime_mode() {
            DesktopAgentRuntimeMode::PiAgentRust => {
                let provider_config =
                    ProviderResolver::resolve_desktop_config(&config, &self.runtime_root)?;
                self.pi_agent_backend
                    .send_message(AgentRuntimeRequest {
                        runtime_root: &self.runtime_root,
                        thread_id: &thread_id,
                        user_text: &user_text,
                        history: history.clone(),
                        provider_config,
                    })
                    .await?
            }
            DesktopAgentRuntimeMode::NativeProvider => {
                let provider_config =
                    ProviderResolver::resolve_desktop_config(&config, &self.runtime_root)?;
                self.native_provider_backend
                    .send_message(AgentRuntimeRequest {
                        runtime_root: &self.runtime_root,
                        thread_id: &thread_id,
                        user_text: &user_text,
                        history: history.clone(),
                        provider_config,
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
            send_native_provider_conversation(&request.provider_config, &messages)
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
            });
            let tools = build_pi_agent_rust_tool_registry(request.runtime_root);
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

#[derive(Clone)]
struct CrawClawPiProvider {
    config: NativeProviderConfig,
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

    #[test]
    fn pi_agent_rust_core_tool_registry_uses_crawclaw_tool_names() {
        let runtime_root = unique_test_runtime_root("pi-agent-rust-core-tools");
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
                "session_status",
                "sessions_list",
                "sessions_history",
                "sessions_send",
                "sessions_spawn",
                "sessions_yield",
                "subagents",
                "cron",
                "review_task",
                "memory_manifest_read",
                "memory_note_read",
                "memory_note_write",
                "memory_note_edit",
                "memory_note_delete",
                "write_experience_note",
                "session_summary_file_read",
                "session_summary_file_edit",
                "web_search",
                "web_fetch",
                "grep",
                "find",
                "ls"
            ]
        );
        assert!(registry.get("bash").is_some());
        assert!(registry.get("exec").is_none());
        assert_eq!(
            pi_agent_rust_tool_names(),
            vec![
                "read",
                "write",
                "edit",
                "apply_patch",
                "bash",
                "process",
                "session_status",
                "sessions_list",
                "sessions_history",
                "sessions_send",
                "sessions_spawn",
                "sessions_yield",
                "subagents",
                "cron",
                "review_task",
                "memory_manifest_read",
                "memory_note_read",
                "memory_note_write",
                "memory_note_edit",
                "memory_note_delete",
                "write_experience_note",
                "session_summary_file_read",
                "session_summary_file_edit",
                "web_search",
                "web_fetch",
                "grep",
                "find",
                "ls"
            ]
        );
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
                "session_status",
                "sessions_list",
                "sessions_history",
                "sessions_send",
                "sessions_spawn",
                "sessions_yield",
                "subagents",
                "cron",
                "review_task",
                "memory_manifest_read",
                "memory_note_read",
                "memory_note_write",
                "memory_note_edit",
                "memory_note_delete",
                "write_experience_note",
                "session_summary_file_read",
                "session_summary_file_edit",
                "web_search",
                "web_fetch",
                "grep",
                "find",
                "ls"
            ]
        );
        for tool_name in ["grep", "find", "ls"] {
            let tool = registry.get(tool_name).expect("discovery tool");
            assert!(tool.is_read_only(), "{tool_name} should be read-only");
        }
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
        assert!(pi_agent_rust_tool_names().contains(&"apply_patch"));
        assert!(pi_agent_rust_tool_names().contains(&"process"));
        assert!(pi_agent_rust_tool_names().contains(&"sessions_spawn"));
        assert!(pi_agent_rust_tool_names().contains(&"cron"));
        assert!(pi_agent_rust_tool_names().contains(&"review_task"));
        assert!(pi_agent_rust_tool_names().contains(&"memory_note_write"));
        assert!(pi_agent_rust_tool_names().contains(&"write_experience_note"));
        assert!(pi_agent_rust_tool_names().contains(&"web_search"));
        assert!(pi_agent_rust_tool_names().contains(&"web_fetch"));
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
            Some(&json!("scrapling"))
        );
    }

    #[tokio::test]
    async fn rust_native_web_search_only_exposes_open_websearch_provider() {
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

        assert_eq!(providers, vec!["open-websearch"]);
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
            .expect_err("non-open-websearch provider should not be accepted by web_search");

        assert!(format!("{error}").contains("only supports open-websearch"));
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
            request_tx
                .send(String::from_utf8_lossy(&request).to_string())
                .expect("send captured request");
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
            let body = format!("data: {chunk}\n\ndata: [DONE]\n\n");
            write!(
                stream,
                "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
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
