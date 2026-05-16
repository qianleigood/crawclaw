use std::collections::{BTreeMap, HashMap};
use std::fs;
use std::io::{Read, Write};
use std::path::{Component, Path, PathBuf};
use std::process::{Child, ChildStdin, Command, ExitStatus, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use async_trait::async_trait;
use crawclaw_native_plugins::llm_task::{complete_llm_task, prepare_llm_task, LlmTaskPrepareInput};
use crawclaw_native_plugins::web::{run_searxng_search, run_spider_fetch};
use crawclaw_plugin_sdk::{NativeToolContentBlock, NativeToolDescriptor, NativeToolResultEnvelope};
use crawclaw_providers::{
    send_native_provider_conversation, NativeProviderConfig, NativeProviderMessage,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::cron::CronTool;
use crate::special_agents::{
    find_special_agent, ExperienceStore, SessionSummaryStore, SpecialAgentMemoryTools,
};
use crate::DesktopSessionStore;
use crate::{
    invoke_native_plugin_operation, with_native_runtime_context, AgentModelSelection,
    AgentRunRequest, AgentRuntime, ChannelChatType, ChannelInboundEnvelope, NativePluginRuntime,
    NativeToolRegistration,
};

pub(crate) fn build_pi_agent_rust_tool_registry(runtime_root: &Path) -> pi::sdk::ToolRegistry {
    let process_registry = process_registry_for_root(runtime_root);
    let mut tools: Vec<Box<dyn pi::sdk::Tool>> = vec![
        pi::sdk::create_read_tool(runtime_root),
        pi::sdk::create_write_tool(runtime_root),
        pi::sdk::create_edit_tool(runtime_root),
        Box::new(ApplyPatchTool::new(runtime_root)),
        Box::new(BashTool::new(runtime_root, Arc::clone(&process_registry))),
        Box::new(ProcessTool::new(process_registry)),
        Box::new(SessionTool::new(runtime_root, SessionToolKind::Status)),
        Box::new(SessionTool::new(runtime_root, SessionToolKind::List)),
        Box::new(SessionTool::new(runtime_root, SessionToolKind::History)),
        Box::new(SessionTool::new(runtime_root, SessionToolKind::Send)),
        Box::new(SessionTool::new(runtime_root, SessionToolKind::Spawn)),
        Box::new(SessionTool::new(runtime_root, SessionToolKind::Yield)),
        Box::new(SessionTool::new(runtime_root, SessionToolKind::Subagents)),
        Box::new(CronTool::new(runtime_root)),
        Box::new(SpecialAgentTool::new(
            runtime_root,
            SpecialAgentToolKind::ReviewTask,
        )),
        Box::new(SpecialAgentTool::new(
            runtime_root,
            SpecialAgentToolKind::MemoryManifestRead,
        )),
        Box::new(SpecialAgentTool::new(
            runtime_root,
            SpecialAgentToolKind::MemoryNoteRead,
        )),
        Box::new(SpecialAgentTool::new(
            runtime_root,
            SpecialAgentToolKind::MemoryNoteWrite,
        )),
        Box::new(SpecialAgentTool::new(
            runtime_root,
            SpecialAgentToolKind::MemoryNoteEdit,
        )),
        Box::new(SpecialAgentTool::new(
            runtime_root,
            SpecialAgentToolKind::MemoryNoteDelete,
        )),
        Box::new(SpecialAgentTool::new(
            runtime_root,
            SpecialAgentToolKind::WriteExperienceNote,
        )),
        Box::new(SpecialAgentTool::new(
            runtime_root,
            SpecialAgentToolKind::SessionSummaryFileRead,
        )),
        Box::new(SpecialAgentTool::new(
            runtime_root,
            SpecialAgentToolKind::SessionSummaryFileEdit,
        )),
        Box::new(WebTool::new(WebToolKind::Search)),
        Box::new(WebTool::new(WebToolKind::Fetch)),
    ];
    tools.extend(
        crate::native_plugin_registry(runtime_root)
            .tool_registrations()
            .into_iter()
            .map(|registration| {
                Box::new(NativePluginTool::new(runtime_root, registration))
                    as Box<dyn pi::sdk::Tool>
            }),
    );
    tools.extend([
        pi::sdk::create_grep_tool(runtime_root),
        pi::sdk::create_find_tool(runtime_root),
        pi::sdk::create_ls_tool(runtime_root),
    ]);

    pi::sdk::ToolRegistry::from_tools(tools)
}

fn process_registry_for_root(runtime_root: &Path) -> Arc<ProcessRegistry> {
    static REGISTRIES: OnceLock<Mutex<HashMap<PathBuf, Arc<ProcessRegistry>>>> = OnceLock::new();
    let key = runtime_root
        .canonicalize()
        .unwrap_or_else(|_| runtime_root.to_path_buf());
    let registries = REGISTRIES.get_or_init(|| Mutex::new(HashMap::new()));
    let mut registries = registries.lock().expect("process registry map");
    Arc::clone(
        registries
            .entry(key)
            .or_insert_with(|| Arc::new(ProcessRegistry::default())),
    )
}

fn text_output(
    text: impl Into<String>,
    details: Option<Value>,
    is_error: bool,
) -> pi::sdk::ToolOutput {
    pi::sdk::ToolOutput {
        content: vec![pi::sdk::ContentBlock::Text(pi::sdk::TextContent::new(
            text.into(),
        ))],
        details,
        is_error,
    }
}

fn native_tool_output(result: Value) -> pi::sdk::ToolOutput {
    let envelope = result
        .as_object()
        .and_then(|object| object.get("content"))
        .and_then(Value::as_array)
        .and_then(|content| {
            if content.iter().all(|entry| {
                matches!(
                    entry.get("type").and_then(Value::as_str),
                    Some("text" | "image")
                )
            }) {
                serde_json::from_value::<NativeToolResultEnvelope>(result.clone()).ok()
            } else {
                None
            }
        });
    let Some(envelope) = envelope else {
        return text_output(
            serde_json::to_string_pretty(&result).unwrap_or_else(|_| "{}".to_string()),
            Some(result),
            false,
        );
    };

    let content = envelope
        .content
        .into_iter()
        .map(|block| match block {
            NativeToolContentBlock::Text { text } => {
                pi::sdk::ContentBlock::Text(pi::sdk::TextContent::new(text))
            }
            NativeToolContentBlock::Image { data, mime_type } => {
                pi::sdk::ContentBlock::Image(pi::sdk::ImageContent { data, mime_type })
            }
        })
        .collect::<Vec<_>>();

    pi::sdk::ToolOutput {
        content,
        details: envelope.details,
        is_error: envelope.is_error,
    }
}

fn tool_error(tool: &str, message: impl Into<String>) -> pi::sdk::Error {
    pi::sdk::Error::tool(tool, message.into())
}

#[derive(Clone, Copy)]
enum SessionToolKind {
    Status,
    List,
    History,
    Send,
    Spawn,
    Yield,
    Subagents,
}

impl SessionToolKind {
    fn name(self) -> &'static str {
        match self {
            Self::Status => "session_status",
            Self::List => "sessions_list",
            Self::History => "sessions_history",
            Self::Send => "sessions_send",
            Self::Spawn => "sessions_spawn",
            Self::Yield => "sessions_yield",
            Self::Subagents => "subagents",
        }
    }

    fn description(self) -> &'static str {
        match self {
            Self::Status => "Return Rust-native status for a desktop session.",
            Self::List => "List Rust-native desktop sessions.",
            Self::History => "Read Rust-native desktop session history.",
            Self::Send => "Append a message into another Rust-native desktop session.",
            Self::Spawn => "Create a Rust-native child subagent session.",
            Self::Yield => "Mark the current Rust-native session as yielded.",
            Self::Subagents => "List Rust-native child subagent sessions.",
        }
    }

    fn parameters(self) -> Value {
        match self {
            Self::List | Self::Subagents => json!({
                "type": "object",
                "properties": {
                    "parentSessionKey": {
                        "type": "string",
                        "description": "Optional parent session key for subagent filtering."
                    }
                }
            }),
            Self::Status | Self::History | Self::Yield => json!({
                "type": "object",
                "properties": {
                    "sessionKey": {
                        "type": "string",
                        "description": "Session key. Defaults to main for status/yield."
                    }
                }
            }),
            Self::Send => json!({
                "type": "object",
                "properties": {
                    "sessionKey": {
                        "type": "string",
                        "description": "Target session key."
                    },
                    "message": {
                        "type": "string",
                        "description": "Message to send into the target session."
                    }
                },
                "required": ["sessionKey", "message"]
            }),
            Self::Spawn => json!({
                "type": "object",
                "properties": {
                    "task": {
                        "type": "string",
                        "description": "Task for the child subagent session."
                    },
                    "label": {
                        "type": "string",
                        "description": "Optional child session label."
                    },
                    "parentSessionKey": {
                        "type": "string",
                        "description": "Optional parent session key."
                    }
                },
                "required": ["task"]
            }),
        }
    }
}

#[derive(Clone)]
struct SessionTool {
    runtime_root: PathBuf,
    kind: SessionToolKind,
}

impl SessionTool {
    fn new(runtime_root: &Path, kind: SessionToolKind) -> Self {
        Self {
            runtime_root: runtime_root.to_path_buf(),
            kind,
        }
    }
}

#[async_trait]
impl pi::sdk::Tool for SessionTool {
    fn name(&self) -> &str {
        self.kind.name()
    }

    fn label(&self) -> &str {
        self.kind.name()
    }

    fn description(&self) -> &str {
        self.kind.description()
    }

    fn parameters(&self) -> Value {
        self.kind.parameters()
    }

    async fn execute(
        &self,
        _tool_call_id: &str,
        input: Value,
        _on_update: Option<Box<dyn Fn(pi::sdk::ToolUpdate) + Send + Sync>>,
    ) -> pi::sdk::Result<pi::sdk::ToolOutput> {
        let store = DesktopSessionStore::new(self.runtime_root.clone());
        let result = match self.kind {
            SessionToolKind::Status => {
                let session_key = session_key_param(&input).unwrap_or_else(|| "main".to_string());
                json!({
                    "status": "ok",
                    "session": store.session_status(&session_key).map_err(|error| session_tool_error(self.kind, error))?
                })
            }
            SessionToolKind::List => json!({
                "status": "ok",
                "sessions": store.list_summaries().map_err(|error| session_tool_error(self.kind, error))?
            }),
            SessionToolKind::History => {
                let session_key = required_param(self.kind, &input, &["sessionKey", "key"])?;
                json!({
                    "status": "ok",
                    "sessionKey": session_key,
                    "messages": store.session_history(&session_key).map_err(|error| session_tool_error(self.kind, error))?
                })
            }
            SessionToolKind::Send => {
                let session_key = required_param(self.kind, &input, &["sessionKey", "key"])?;
                let message = required_param(self.kind, &input, &["message", "text"])?;
                let session = store
                    .send_to_session(&session_key, &message)
                    .map_err(|error| session_tool_error(self.kind, error))?;
                json!({
                    "status": "sent",
                    "session": session
                })
            }
            SessionToolKind::Spawn => {
                let task = required_param(self.kind, &input, &["task", "message"])?;
                let label = string_param(&input, &["label"]);
                let parent = string_param(&input, &["parentSessionKey", "parent", "spawnedBy"]);
                let session = store
                    .spawn_session(parent.as_deref(), label.as_deref(), &task)
                    .map_err(|error| session_tool_error(self.kind, error))?;
                json!({
                    "status": "spawned",
                    "session": session
                })
            }
            SessionToolKind::Yield => {
                let session_key = session_key_param(&input).unwrap_or_else(|| "main".to_string());
                let session = store
                    .mark_session_yielded(&session_key)
                    .map_err(|error| session_tool_error(self.kind, error))?;
                json!({
                    "status": "yielded",
                    "session": session
                })
            }
            SessionToolKind::Subagents => {
                let parent = string_param(&input, &["parentSessionKey", "parent", "spawnedBy"]);
                json!({
                    "status": "ok",
                    "subagents": store.list_subagents(parent.as_deref()).map_err(|error| session_tool_error(self.kind, error))?
                })
            }
        };
        Ok(native_tool_output(result))
    }
}

#[derive(Clone, Copy)]
enum SpecialAgentToolKind {
    ReviewTask,
    MemoryManifestRead,
    MemoryNoteRead,
    MemoryNoteWrite,
    MemoryNoteEdit,
    MemoryNoteDelete,
    WriteExperienceNote,
    SessionSummaryFileRead,
    SessionSummaryFileEdit,
}

impl SpecialAgentToolKind {
    fn name(self) -> &'static str {
        match self {
            Self::ReviewTask => "review_task",
            Self::MemoryManifestRead => "memory_manifest_read",
            Self::MemoryNoteRead => "memory_note_read",
            Self::MemoryNoteWrite => "memory_note_write",
            Self::MemoryNoteEdit => "memory_note_edit",
            Self::MemoryNoteDelete => "memory_note_delete",
            Self::WriteExperienceNote => "write_experience_note",
            Self::SessionSummaryFileRead => "session_summary_file_read",
            Self::SessionSummaryFileEdit => "session_summary_file_edit",
        }
    }

    fn description(self) -> &'static str {
        match self {
            Self::ReviewTask => "Run the Rust-native review special agent.",
            Self::MemoryManifestRead => "Read the Rust-native durable memory manifest for a scope.",
            Self::MemoryNoteRead => "Read a Rust-native durable memory Markdown note.",
            Self::MemoryNoteWrite => "Write a Rust-native durable memory Markdown note.",
            Self::MemoryNoteEdit => "Edit a Rust-native durable memory Markdown note.",
            Self::MemoryNoteDelete => "Delete a Rust-native durable memory Markdown note.",
            Self::WriteExperienceNote => "Append a Rust-native experience note to the outbox.",
            Self::SessionSummaryFileRead => "Read the Rust-native session summary Markdown file.",
            Self::SessionSummaryFileEdit => {
                "Replace the Rust-native session summary Markdown file."
            }
        }
    }

    fn parameters(self) -> Value {
        match self {
            Self::ReviewTask => json!({
                "type": "object",
                "properties": {
                    "task": { "type": "string" },
                    "stage": {
                        "type": "string",
                        "enum": ["spec", "quality"]
                    }
                },
                "required": ["task"]
            }),
            Self::MemoryManifestRead | Self::SessionSummaryFileRead => json!({
                "type": "object",
                "properties": {
                    "scope": { "type": "string" }
                }
            }),
            Self::MemoryNoteRead | Self::MemoryNoteDelete => json!({
                "type": "object",
                "properties": {
                    "scope": { "type": "string" },
                    "notePath": { "type": "string" }
                },
                "required": ["notePath"]
            }),
            Self::MemoryNoteWrite => json!({
                "type": "object",
                "properties": {
                    "scope": { "type": "string" },
                    "notePath": { "type": "string" },
                    "content": { "type": "string" }
                },
                "required": ["notePath", "content"]
            }),
            Self::MemoryNoteEdit => json!({
                "type": "object",
                "properties": {
                    "scope": { "type": "string" },
                    "notePath": { "type": "string" },
                    "search": { "type": "string" },
                    "replace": { "type": "string" }
                },
                "required": ["notePath", "search", "replace"]
            }),
            Self::WriteExperienceNote => json!({
                "type": "object",
                "properties": {
                    "scope": { "type": "string" },
                    "title": { "type": "string" },
                    "body": { "type": "string" },
                    "source": { "type": "string" }
                },
                "required": ["body"]
            }),
            Self::SessionSummaryFileEdit => json!({
                "type": "object",
                "properties": {
                    "scope": { "type": "string" },
                    "content": { "type": "string" }
                },
                "required": ["content"]
            }),
        }
    }

    fn is_read_only(self) -> bool {
        matches!(
            self,
            Self::ReviewTask
                | Self::MemoryManifestRead
                | Self::MemoryNoteRead
                | Self::SessionSummaryFileRead
        )
    }
}

#[derive(Clone)]
struct SpecialAgentTool {
    runtime_root: PathBuf,
    kind: SpecialAgentToolKind,
}

impl SpecialAgentTool {
    fn new(runtime_root: &Path, kind: SpecialAgentToolKind) -> Self {
        Self {
            runtime_root: runtime_root.to_path_buf(),
            kind,
        }
    }
}

#[async_trait]
impl pi::sdk::Tool for SpecialAgentTool {
    fn name(&self) -> &str {
        self.kind.name()
    }

    fn label(&self) -> &str {
        self.kind.name()
    }

    fn description(&self) -> &str {
        self.kind.description()
    }

    fn parameters(&self) -> Value {
        self.kind.parameters()
    }

    async fn execute(
        &self,
        _tool_call_id: &str,
        input: Value,
        _on_update: Option<Box<dyn Fn(pi::sdk::ToolUpdate) + Send + Sync>>,
    ) -> pi::sdk::Result<pi::sdk::ToolOutput> {
        let result = match self.kind {
            SpecialAgentToolKind::ReviewTask => {
                let task = required_tool_param(self.kind.name(), &input, &["task", "message"])?;
                let stage = string_param(&input, &["stage", "kind"]).unwrap_or_default();
                let kind = if stage == "spec" {
                    "review-spec"
                } else {
                    "review-quality"
                };
                run_review_task_with_agent_runtime(
                    &self.runtime_root,
                    kind,
                    &task,
                    session_key_param(&input),
                )
                .await
                .map_err(|error| tool_error(self.kind.name(), error))?
            }
            SpecialAgentToolKind::MemoryManifestRead => {
                let scope = scope_param(&input);
                json!(SpecialAgentMemoryTools::new(self.runtime_root.clone())
                    .read_manifest(&scope)
                    .map_err(|error| tool_error(self.kind.name(), error))?)
            }
            SpecialAgentToolKind::MemoryNoteRead => {
                let scope = scope_param(&input);
                let note_path =
                    required_tool_param(self.kind.name(), &input, &["notePath", "path"])?;
                json!(SpecialAgentMemoryTools::new(self.runtime_root.clone())
                    .read_note(&scope, &note_path)
                    .map_err(|error| tool_error(self.kind.name(), error))?)
            }
            SpecialAgentToolKind::MemoryNoteWrite => {
                let scope = scope_param(&input);
                let note_path =
                    required_tool_param(self.kind.name(), &input, &["notePath", "path"])?;
                let content = required_tool_param(self.kind.name(), &input, &["content"])?;
                json!(SpecialAgentMemoryTools::new(self.runtime_root.clone())
                    .write_note(&scope, &note_path, &content)
                    .map_err(|error| tool_error(self.kind.name(), error))?)
            }
            SpecialAgentToolKind::MemoryNoteEdit => {
                let scope = scope_param(&input);
                let note_path =
                    required_tool_param(self.kind.name(), &input, &["notePath", "path"])?;
                let search = required_tool_param(self.kind.name(), &input, &["search"])?;
                let replace = required_tool_param(self.kind.name(), &input, &["replace"])?;
                json!(SpecialAgentMemoryTools::new(self.runtime_root.clone())
                    .edit_note(&scope, &note_path, &search, &replace)
                    .map_err(|error| tool_error(self.kind.name(), error))?)
            }
            SpecialAgentToolKind::MemoryNoteDelete => {
                let scope = scope_param(&input);
                let note_path =
                    required_tool_param(self.kind.name(), &input, &["notePath", "path"])?;
                json!(SpecialAgentMemoryTools::new(self.runtime_root.clone())
                    .delete_note(&scope, &note_path)
                    .map_err(|error| tool_error(self.kind.name(), error))?)
            }
            SpecialAgentToolKind::WriteExperienceNote => {
                let scope = scope_param(&input);
                let title = string_param(&input, &["title"])
                    .unwrap_or_else(|| "Experience note".to_string());
                let body = required_tool_param(self.kind.name(), &input, &["body", "content"])?;
                let source =
                    string_param(&input, &["source"]).unwrap_or_else(|| "tool".to_string());
                ExperienceStore::new(self.runtime_root.clone())
                    .write_note(&scope, &title, &body, &source)
                    .map_err(|error| tool_error(self.kind.name(), error))?
            }
            SpecialAgentToolKind::SessionSummaryFileRead => {
                let scope = scope_param(&input);
                SessionSummaryStore::new(self.runtime_root.clone())
                    .read(&scope)
                    .map_err(|error| tool_error(self.kind.name(), error))?
            }
            SpecialAgentToolKind::SessionSummaryFileEdit => {
                let scope = scope_param(&input);
                let content = required_tool_param(self.kind.name(), &input, &["content"])?;
                SessionSummaryStore::new(self.runtime_root.clone())
                    .edit(&scope, &content)
                    .map_err(|error| tool_error(self.kind.name(), error))?
            }
        };
        Ok(native_tool_output(result))
    }

    fn is_read_only(&self) -> bool {
        self.kind.is_read_only()
    }
}

async fn run_review_task_with_agent_runtime(
    runtime_root: &Path,
    kind: &str,
    task: &str,
    parent_session_key: Option<String>,
) -> Result<Value, String> {
    let definition =
        find_special_agent(kind).ok_or_else(|| format!("unknown special agent kind: {kind}"))?;
    let run_id = format!("special-{kind}-{}", now_millis());
    let session_key = parent_session_key
        .clone()
        .unwrap_or_else(|| format!("special:{kind}:{run_id}"));
    let mut options = BTreeMap::new();
    options.insert(
        "specialAgent".to_string(),
        json!({
            "kind": definition.id,
            "spawnSource": definition.spawn_source,
            "executionMode": definition.execution_mode,
            "transcriptPolicy": definition.transcript_policy,
            "parentContextPolicy": definition.parent_context_policy,
            "timeoutSeconds": definition.timeout_seconds,
            "maxTurns": definition.max_turns
        }),
    );
    let result = AgentRuntime::new(runtime_root.to_path_buf())
        .run_turn(AgentRunRequest {
            run_id: run_id.clone(),
            agent_id: definition.id.to_string(),
            session_key: session_key.clone(),
            inbound: ChannelInboundEnvelope {
                channel: "special-agent".to_string(),
                account_id: Some("rust-runtime".to_string()),
                from: "review_task".to_string(),
                to: format!("agent:{}", definition.id),
                chat_type: ChannelChatType::Direct,
                body: task.to_string(),
                raw_body: Some(task.to_string()),
                message_id: Some(format!("{run_id}:input")),
                thread_id: Some(session_key),
                media_urls: Vec::new(),
                metadata: BTreeMap::new(),
            },
            model: AgentModelSelection {
                provider: "configured".to_string(),
                model: "configured".to_string(),
                reasoning_level: None,
            },
            enabled_tools: definition
                .tool_allowlist
                .iter()
                .map(|tool| (*tool).to_string())
                .collect(),
            options,
        })
        .await
        .map_err(|error| format!("{}: {}", error.code(), error.message()))?;
    let assistant_text = result.assistant_text;
    Ok(json!({
        "status": "completed",
        "runId": result.run_id,
        "kind": definition.id,
        "executionMode": definition.execution_mode,
        "parentSessionKey": parent_session_key,
        "result": {
            "status": "completed",
            "assistantText": assistant_text,
            "payloads": [
                {
                    "text": assistant_text
                }
            ],
            "implementation": "rust-native"
        }
    }))
}

#[derive(Clone, Copy)]
enum WebToolKind {
    Search,
    Fetch,
}

impl WebToolKind {
    fn name(self) -> &'static str {
        match self {
            Self::Search => "web_search",
            Self::Fetch => "web_fetch",
        }
    }

    fn description(self) -> &'static str {
        match self {
            Self::Search => "Search the web through the Rust native provider resolver.",
            Self::Fetch => {
                "Fetch and extract readable web content through the Rust native runtime."
            }
        }
    }

    fn parameters(self) -> Value {
        match self {
            Self::Search => json!({
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "Search query."
                    },
                    "count": {
                        "type": "number",
                        "description": "Maximum number of results."
                    },
                    "provider": {
                        "type": "string",
                        "enum": ["searxng"],
                        "description": "Optional Rust-owned search provider. web_search only supports SearXNG."
                    },
                    "baseUrl": {
                        "type": "string",
                        "description": "SearXNG base URL."
                    },
                    "engines": {
                        "type": "array",
                        "items": { "type": "string" }
                    },
                    "categories": {
                        "type": "array",
                        "items": { "type": "string" }
                    },
                    "language": { "type": "string" },
                    "safeSearch": { "type": "string", "enum": ["off", "moderate", "strict", "0", "1", "2"] },
                    "timeRange": { "type": "string", "enum": ["day", "month", "year"] },
                    "timeoutSeconds": { "type": "number" }
                },
                "required": ["query"]
            }),
            Self::Fetch => json!({
                "type": "object",
                "properties": {
                    "url": {
                        "type": "string",
                        "description": "HTTP or HTTPS URL to fetch."
                    },
                    "detail": {
                        "type": "string",
                        "enum": ["brief", "standard", "full"]
                    },
                    "output": {
                        "type": "string",
                        "enum": ["markdown", "text", "html", "structured"]
                    },
                    "render": {
                        "type": "string",
                        "enum": ["auto", "never", "stealth", "dynamic"]
                    },
                    "extractMode": {
                        "type": "string",
                        "enum": ["markdown", "text", "html"]
                    },
                    "extract": {
                        "type": "string",
                        "enum": ["readable", "raw", "links", "metadata"]
                    },
                    "maxChars": { "type": "number" },
                    "timeoutSeconds": { "type": "number" },
                    "mainContentOnly": { "type": "boolean" },
                    "waitUntil": {
                        "type": "string",
                        "enum": ["domcontentloaded", "load", "networkidle"]
                    },
                    "waitFor": { "type": "string" },
                    "sessionId": { "type": "string" }
                },
                "required": ["url"]
            }),
        }
    }
}

#[derive(Clone)]
struct WebTool {
    kind: WebToolKind,
}

impl WebTool {
    fn new(kind: WebToolKind) -> Self {
        Self { kind }
    }
}

#[async_trait]
impl pi::sdk::Tool for WebTool {
    fn name(&self) -> &str {
        self.kind.name()
    }

    fn label(&self) -> &str {
        self.kind.name()
    }

    fn description(&self) -> &str {
        self.kind.description()
    }

    fn parameters(&self) -> Value {
        self.kind.parameters()
    }

    async fn execute(
        &self,
        _tool_call_id: &str,
        input: Value,
        _on_update: Option<Box<dyn Fn(pi::sdk::ToolUpdate) + Send + Sync>>,
    ) -> pi::sdk::Result<pi::sdk::ToolOutput> {
        let result = match self.kind {
            WebToolKind::Search => run_web_search(input)
                .await
                .map_err(|error| tool_error(self.kind.name(), error.to_string()))?,
            WebToolKind::Fetch => run_spider_fetch(input)
                .await
                .map_err(|error| tool_error(self.kind.name(), error.to_string()))?,
        };
        Ok(native_tool_output(result))
    }

    fn is_read_only(&self) -> bool {
        true
    }
}

struct NativePluginTool {
    runtime_root: PathBuf,
    plugin_id: String,
    descriptor: NativeToolDescriptor,
    runtime: NativePluginRuntime,
}

impl NativePluginTool {
    fn new(runtime_root: &Path, registration: NativeToolRegistration) -> Self {
        Self {
            runtime_root: runtime_root.to_path_buf(),
            plugin_id: registration.plugin_id,
            descriptor: registration.descriptor,
            runtime: registration.runtime,
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DesktopProviderConfigFile {
    provider: String,
    #[serde(default)]
    base_url: Option<String>,
    #[serde(default)]
    api_key: Option<Value>,
    #[serde(default)]
    model: Option<String>,
    #[serde(default)]
    api: Option<String>,
    #[serde(default)]
    api_version: Option<String>,
}

fn optional_string(value: Option<&str>) -> Option<String> {
    value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
}

fn resolve_secret_string(
    runtime_root: &Path,
    value: Option<&Value>,
) -> Result<Option<String>, String> {
    let Some(value) = value else {
        return Ok(None);
    };
    if let Some(raw) = value.as_str() {
        return Ok(optional_string(Some(raw)));
    }
    let Some(object) = value.as_object() else {
        return Err("desktop provider apiKey must be a string or SecretRef".to_string());
    };
    let source = object
        .get("source")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let id = object.get("id").and_then(Value::as_str).unwrap_or_default();
    match source {
        "env" => std::env::var(id)
            .map(|secret| optional_string(Some(&secret)))
            .map_err(|_| format!("environment variable {id} is not set")),
        "file" => {
            let path = PathBuf::from(id);
            let path = if path.is_absolute() {
                path
            } else {
                runtime_root.join(path)
            };
            fs::read_to_string(&path)
                .map(|secret| optional_string(Some(secret.trim_end())))
                .map_err(|error| {
                    format!("failed to read file SecretRef {}: {error}", path.display())
                })
        }
        "exec" => {
            Err("exec SecretRef is not enabled in the Rust llm-task host callback".to_string())
        }
        _ => Err(format!("unsupported SecretRef source {source}")),
    }
}

fn read_desktop_provider_config(runtime_root: &Path) -> Result<NativeProviderConfig, String> {
    let path = runtime_root
        .join("config")
        .join("desktop-agent-provider.json");
    let raw = fs::read_to_string(&path).map_err(|error| {
        format!(
            "failed to read desktop provider config {}: {error}",
            path.display()
        )
    })?;
    let config: DesktopProviderConfigFile = serde_json::from_str(&raw).map_err(|error| {
        format!(
            "invalid desktop provider config {}: {error}",
            path.display()
        )
    })?;
    let provider = optional_string(Some(&config.provider))
        .ok_or_else(|| "desktop provider config is missing provider".to_string())?;
    let model = optional_string(config.model.as_deref()).or_else(|| {
        crawclaw_providers::bundled_provider_default_model_for(&provider)
            .map(|entry| entry.model.to_string())
    });
    Ok(NativeProviderConfig {
        provider,
        base_url: optional_string(config.base_url.as_deref()),
        api_key: resolve_secret_string(runtime_root, config.api_key.as_ref())?,
        model,
        api: optional_string(config.api.as_deref()),
        api_version: optional_string(config.api_version.as_deref()),
    })
}

async fn execute_llm_task_with_host_agent(
    runtime_root: &Path,
    input: Value,
) -> pi::sdk::Result<Value> {
    let provider_config = read_desktop_provider_config(runtime_root)
        .map_err(|error| tool_error("llm-task", error))?;
    let default_model = provider_config
        .model
        .as_ref()
        .map(|model| format!("{}/{}", provider_config.provider, model));
    let prepared = prepare_llm_task(LlmTaskPrepareInput {
        params: input.clone(),
        plugin_config: json!({}),
        default_model,
        workspace_dir: runtime_root.to_string_lossy().to_string(),
    })
    .map_err(|error| tool_error("llm-task", error.to_string()))?;
    let mut task_provider_config = provider_config;
    task_provider_config.provider = prepared.provider.clone();
    task_provider_config.model = Some(prepared.model.clone());
    let assistant_text = send_native_provider_conversation(
        &task_provider_config,
        &[NativeProviderMessage::user(prepared.full_prompt)],
    )
    .await
    .map_err(|error| tool_error("llm-task", error.to_string()))?;
    complete_llm_task(json!({
        "payloads": [{ "text": assistant_text }],
        "schema": input.get("schema").cloned().unwrap_or(Value::Null),
        "provider": prepared.provider,
        "model": prepared.model
    }))
    .map_err(|error| tool_error("llm-task", error.to_string()))
}

#[async_trait]
impl pi::sdk::Tool for NativePluginTool {
    fn name(&self) -> &str {
        &self.descriptor.name
    }

    fn label(&self) -> &str {
        &self.descriptor.label
    }

    fn description(&self) -> &str {
        &self.descriptor.description
    }

    fn parameters(&self) -> Value {
        self.descriptor.parameters.clone()
    }

    async fn execute(
        &self,
        _tool_call_id: &str,
        input: Value,
        _on_update: Option<Box<dyn Fn(pi::sdk::ToolUpdate) + Send + Sync>>,
    ) -> pi::sdk::Result<pi::sdk::ToolOutput> {
        let result = if matches!(&self.runtime, NativePluginRuntime::Builtin)
            && self.plugin_id == "llm-task"
            && self.descriptor.invocation.operation == "execute"
        {
            execute_llm_task_with_host_agent(&self.runtime_root, input).await?
        } else {
            invoke_native_plugin_operation(
                self.runtime.clone(),
                self.descriptor.invocation.clone(),
                if matches!(&self.runtime, NativePluginRuntime::Builtin) {
                    with_native_runtime_context(&self.runtime_root, input)
                } else {
                    input
                },
            )
            .await
            .map_err(|error| tool_error(&self.descriptor.name, error.to_string()))?
        };
        Ok(native_tool_output(result))
    }

    fn is_read_only(&self) -> bool {
        self.descriptor.read_only
    }
}

async fn run_web_search(input: Value) -> crawclaw_native_plugins::NativeResult<Value> {
    match string_param(tool_input_params(&input), &["provider"])
        .unwrap_or_else(|| "searxng".to_string())
        .as_str()
    {
        "searxng" | "" => run_searxng_search(input).await,
        provider => Err(crawclaw_native_plugins::NativeError::InvalidInput(format!(
            "web_search only supports searxng provider; got {provider}"
        ))),
    }
}

fn tool_input_params(input: &Value) -> &Value {
    input.get("params").unwrap_or(input)
}

fn session_tool_error(kind: SessionToolKind, error: impl std::fmt::Display) -> pi::sdk::Error {
    tool_error(kind.name(), error.to_string())
}

fn session_key_param(input: &Value) -> Option<String> {
    string_param(input, &["sessionKey", "key", "threadId"])
}

fn required_param(kind: SessionToolKind, input: &Value, keys: &[&str]) -> pi::sdk::Result<String> {
    string_param(input, keys)
        .ok_or_else(|| pi::sdk::Error::validation(format!("{} requires {}", kind.name(), keys[0])))
}

fn required_tool_param(tool: &str, input: &Value, keys: &[&str]) -> pi::sdk::Result<String> {
    string_param(input, keys)
        .ok_or_else(|| pi::sdk::Error::validation(format!("{tool} requires {}", keys[0])))
}

fn scope_param(input: &Value) -> String {
    string_param(input, &["scope", "agentId", "sessionKey"]).unwrap_or_else(|| "main".to_string())
}

fn string_param(input: &Value, keys: &[&str]) -> Option<String> {
    keys.iter()
        .filter_map(|key| input.get(*key).and_then(Value::as_str))
        .map(str::trim)
        .find(|value| !value.is_empty())
        .map(ToOwned::to_owned)
}

#[derive(Clone)]
struct ApplyPatchTool {
    cwd: PathBuf,
}

impl ApplyPatchTool {
    fn new(cwd: &Path) -> Self {
        Self {
            cwd: cwd.to_path_buf(),
        }
    }
}

#[derive(Deserialize)]
struct ApplyPatchInput {
    input: String,
}

#[async_trait]
impl pi::sdk::Tool for ApplyPatchTool {
    fn name(&self) -> &str {
        "apply_patch"
    }

    fn label(&self) -> &str {
        "apply_patch"
    }

    fn description(&self) -> &str {
        "Apply a patch to one or more files using the apply_patch format. The input should include *** Begin Patch and *** End Patch markers."
    }

    fn parameters(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "input": {
                    "type": "string",
                    "description": "Patch content using the *** Begin Patch/End Patch format."
                }
            },
            "required": ["input"]
        })
    }

    async fn execute(
        &self,
        _tool_call_id: &str,
        input: Value,
        _on_update: Option<Box<dyn Fn(pi::sdk::ToolUpdate) + Send + Sync>>,
    ) -> pi::sdk::Result<pi::sdk::ToolOutput> {
        let input: ApplyPatchInput = serde_json::from_value(input)
            .map_err(|error| pi::sdk::Error::validation(error.to_string()))?;
        if input.input.trim().is_empty() {
            return Err(pi::sdk::Error::validation("Provide a patch input."));
        }
        let result = apply_patch_text(&input.input, &self.cwd)
            .map_err(|error| tool_error("apply_patch", error))?;
        Ok(text_output(
            result.text,
            Some(json!({ "summary": result.summary })),
            false,
        ))
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ApplyPatchSummary {
    added: Vec<String>,
    modified: Vec<String>,
    deleted: Vec<String>,
}

struct ApplyPatchResult {
    summary: ApplyPatchSummary,
    text: String,
}

enum PatchHunk {
    Add {
        path: String,
        contents: String,
    },
    Delete {
        path: String,
    },
    Update {
        path: String,
        move_path: Option<String>,
        chunks: Vec<UpdateFileChunk>,
    },
}

#[derive(Clone)]
struct UpdateFileChunk {
    change_context: Option<String>,
    old_lines: Vec<String>,
    new_lines: Vec<String>,
    is_end_of_file: bool,
}

fn apply_patch_text(input: &str, cwd: &Path) -> Result<ApplyPatchResult, String> {
    let hunks = parse_patch_text(input)?;
    if hunks.is_empty() {
        return Err("No files were modified.".to_string());
    }

    let mut summary = ApplyPatchSummary {
        added: Vec::new(),
        modified: Vec::new(),
        deleted: Vec::new(),
    };

    for hunk in hunks {
        match hunk {
            PatchHunk::Add { path, contents } => {
                let target = resolve_workspace_path(cwd, &path)?;
                if let Some(parent) = target.parent() {
                    fs::create_dir_all(parent)
                        .map_err(|error| format!("Failed to create parent directory: {error}"))?;
                }
                fs::write(&target, contents)
                    .map_err(|error| format!("Failed to write {}: {error}", path))?;
                record_summary(&mut summary.added, display_path(cwd, &target));
            }
            PatchHunk::Delete { path } => {
                let target = resolve_workspace_path(cwd, &path)?;
                remove_path(&target)
                    .map_err(|error| format!("Failed to delete {}: {error}", path))?;
                record_summary(&mut summary.deleted, display_path(cwd, &target));
            }
            PatchHunk::Update {
                path,
                move_path,
                chunks,
            } => {
                let target = resolve_workspace_path(cwd, &path)?;
                let updated = apply_update_hunks(&target, &chunks)?;
                if let Some(move_path) = move_path {
                    let move_target = resolve_workspace_path(cwd, &move_path)?;
                    if let Some(parent) = move_target.parent() {
                        fs::create_dir_all(parent).map_err(|error| {
                            format!("Failed to create parent directory: {error}")
                        })?;
                    }
                    fs::write(&move_target, updated)
                        .map_err(|error| format!("Failed to write {}: {error}", move_path))?;
                    remove_path(&target)
                        .map_err(|error| format!("Failed to delete {}: {error}", path))?;
                    record_summary(&mut summary.modified, display_path(cwd, &move_target));
                } else {
                    fs::write(&target, updated)
                        .map_err(|error| format!("Failed to write {}: {error}", path))?;
                    record_summary(&mut summary.modified, display_path(cwd, &target));
                }
            }
        }
    }

    let text = format_patch_summary(&summary);
    Ok(ApplyPatchResult { summary, text })
}

fn record_summary(bucket: &mut Vec<String>, value: String) {
    if !bucket.contains(&value) {
        bucket.push(value);
    }
}

fn format_patch_summary(summary: &ApplyPatchSummary) -> String {
    let mut lines = vec!["Success. Updated the following files:".to_string()];
    lines.extend(summary.added.iter().map(|file| format!("A {file}")));
    lines.extend(summary.modified.iter().map(|file| format!("M {file}")));
    lines.extend(summary.deleted.iter().map(|file| format!("D {file}")));
    lines.join("\n")
}

fn remove_path(path: &Path) -> std::io::Result<()> {
    if path.is_dir() {
        fs::remove_dir_all(path)
    } else {
        fs::remove_file(path)
    }
}

fn resolve_workspace_path(cwd: &Path, raw_path: &str) -> Result<PathBuf, String> {
    let path = Path::new(raw_path.trim());
    if path.as_os_str().is_empty() {
        return Err("Patch path is empty.".to_string());
    }
    if path.is_absolute() {
        return Err(format!("Patch path must be relative: {raw_path}"));
    }

    let mut normalized = PathBuf::new();
    for component in path.components() {
        match component {
            Component::Normal(part) => normalized.push(part),
            Component::CurDir => {}
            Component::ParentDir => {
                return Err(format!("Patch path escapes the workspace root: {raw_path}"));
            }
            Component::Prefix(_) | Component::RootDir => {
                return Err(format!("Patch path must be relative: {raw_path}"));
            }
        }
    }

    let root = cwd.canonicalize().unwrap_or_else(|_| cwd.to_path_buf());
    let target = root.join(normalized);
    if target.exists() {
        let canonical = target
            .canonicalize()
            .map_err(|error| format!("Failed to resolve {}: {error}", target.display()))?;
        if !canonical.starts_with(&root) {
            return Err(format!("Patch path escapes the workspace root: {raw_path}"));
        }
    }
    Ok(target)
}

fn display_path(cwd: &Path, path: &Path) -> String {
    let root = cwd.canonicalize().unwrap_or_else(|_| cwd.to_path_buf());
    path.strip_prefix(&root)
        .unwrap_or(path)
        .to_string_lossy()
        .to_string()
}

fn parse_patch_text(input: &str) -> Result<Vec<PatchHunk>, String> {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        return Err("Invalid patch: input is empty.".to_string());
    }
    let lines: Vec<String> = trimmed.lines().map(ToOwned::to_owned).collect();
    let lines = check_patch_boundaries_lenient(lines)?;
    let mut hunks = Vec::new();
    let mut index = 1;
    let last = lines.len().saturating_sub(1);
    let mut line_number = 2;
    while index < last {
        let (hunk, consumed) = parse_one_hunk(&lines[index..last], line_number)?;
        hunks.push(hunk);
        index += consumed;
        line_number += consumed;
    }
    Ok(hunks)
}

fn check_patch_boundaries_lenient(lines: Vec<String>) -> Result<Vec<String>, String> {
    if check_patch_boundaries_strict(&lines).is_ok() {
        return Ok(lines);
    }
    if lines.len() >= 4 {
        let first = lines.first().map(String::as_str).unwrap_or_default();
        let last = lines.last().map(String::as_str).unwrap_or_default();
        if matches!(first, "<<EOF" | "<<'EOF'" | "<<\"EOF\"") && last.ends_with("EOF") {
            let inner = lines[1..lines.len() - 1].to_vec();
            check_patch_boundaries_strict(&inner)?;
            return Ok(inner);
        }
    }
    check_patch_boundaries_strict(&lines)?;
    Ok(lines)
}

fn check_patch_boundaries_strict(lines: &[String]) -> Result<(), String> {
    let first = lines.first().map(|line| line.trim()).unwrap_or_default();
    let last = lines.last().map(|line| line.trim()).unwrap_or_default();
    if first == "*** Begin Patch" && last == "*** End Patch" {
        return Ok(());
    }
    if first != "*** Begin Patch" {
        return Err("The first line of the patch must be '*** Begin Patch'".to_string());
    }
    Err("The last line of the patch must be '*** End Patch'".to_string())
}

fn parse_one_hunk(lines: &[String], line_number: usize) -> Result<(PatchHunk, usize), String> {
    if lines.is_empty() {
        return Err(format!(
            "Invalid patch hunk at line {line_number}: empty hunk"
        ));
    }
    let first = lines[0].trim();
    if let Some(path) = first.strip_prefix("*** Add File: ") {
        let mut contents = String::new();
        let mut consumed = 1;
        for line in &lines[1..] {
            if let Some(content) = line.strip_prefix('+') {
                contents.push_str(content);
                contents.push('\n');
                consumed += 1;
            } else {
                break;
            }
        }
        return Ok((
            PatchHunk::Add {
                path: path.to_string(),
                contents,
            },
            consumed,
        ));
    }
    if let Some(path) = first.strip_prefix("*** Delete File: ") {
        return Ok((
            PatchHunk::Delete {
                path: path.to_string(),
            },
            1,
        ));
    }
    if let Some(path) = first.strip_prefix("*** Update File: ") {
        let mut index = 1;
        let mut consumed = 1;
        let mut move_path = None;
        if let Some(candidate) = lines.get(index).map(|line| line.trim()) {
            if let Some(path) = candidate.strip_prefix("*** Move to: ") {
                move_path = Some(path.to_string());
                index += 1;
                consumed += 1;
            }
        }
        let mut chunks = Vec::new();
        while index < lines.len() {
            if lines[index].trim().is_empty() {
                index += 1;
                consumed += 1;
                continue;
            }
            if lines[index].starts_with("***") {
                break;
            }
            let (chunk, chunk_lines) = parse_update_file_chunk(
                &lines[index..],
                line_number + consumed,
                chunks.is_empty(),
            )?;
            chunks.push(chunk);
            index += chunk_lines;
            consumed += chunk_lines;
        }
        if chunks.is_empty() {
            return Err(format!(
                "Invalid patch hunk at line {line_number}: Update file hunk for path '{path}' is empty"
            ));
        }
        return Ok((
            PatchHunk::Update {
                path: path.to_string(),
                move_path,
                chunks,
            },
            consumed,
        ));
    }
    Err(format!(
        "Invalid patch hunk at line {line_number}: '{}' is not a valid hunk header.",
        lines[0]
    ))
}

fn parse_update_file_chunk(
    lines: &[String],
    line_number: usize,
    allow_missing_context: bool,
) -> Result<(UpdateFileChunk, usize), String> {
    if lines.is_empty() {
        return Err(format!(
            "Invalid patch hunk at line {line_number}: Update hunk does not contain any lines"
        ));
    }

    let mut change_context = None;
    let mut start_index = 0;
    if lines[0] == "@@" {
        start_index = 1;
    } else if let Some(context) = lines[0].strip_prefix("@@ ") {
        change_context = Some(context.to_string());
        start_index = 1;
    } else if !allow_missing_context {
        return Err(format!(
            "Invalid patch hunk at line {line_number}: Expected update hunk to start with a @@ context marker, got: '{}'",
            lines[0]
        ));
    }

    if start_index >= lines.len() {
        return Err(format!(
            "Invalid patch hunk at line {}: Update hunk does not contain any lines",
            line_number + 1
        ));
    }

    let mut chunk = UpdateFileChunk {
        change_context,
        old_lines: Vec::new(),
        new_lines: Vec::new(),
        is_end_of_file: false,
    };
    let mut parsed_lines = 0;
    for line in &lines[start_index..] {
        if line == "*** End of File" {
            if parsed_lines == 0 {
                return Err(format!(
                    "Invalid patch hunk at line {}: Update hunk does not contain any lines",
                    line_number + 1
                ));
            }
            chunk.is_end_of_file = true;
            parsed_lines += 1;
            break;
        }

        let mut chars = line.chars();
        match chars.next() {
            None => {
                chunk.old_lines.push(String::new());
                chunk.new_lines.push(String::new());
                parsed_lines += 1;
            }
            Some(' ') => {
                let content = chars.as_str().to_string();
                chunk.old_lines.push(content.clone());
                chunk.new_lines.push(content);
                parsed_lines += 1;
            }
            Some('+') => {
                chunk.new_lines.push(chars.as_str().to_string());
                parsed_lines += 1;
            }
            Some('-') => {
                chunk.old_lines.push(chars.as_str().to_string());
                parsed_lines += 1;
            }
            Some(_) if parsed_lines > 0 => break,
            Some(_) => {
                return Err(format!(
                    "Invalid patch hunk at line {}: Unexpected line found in update hunk: '{}'.",
                    line_number + 1,
                    line
                ));
            }
        }
    }

    Ok((chunk, parsed_lines + start_index))
}

fn apply_update_hunks(file_path: &Path, chunks: &[UpdateFileChunk]) -> Result<String, String> {
    let contents = fs::read_to_string(file_path).map_err(|error| {
        format!(
            "Failed to read file to update {}: {error}",
            file_path.display()
        )
    })?;
    let mut original_lines: Vec<String> = contents.split('\n').map(ToOwned::to_owned).collect();
    if original_lines.last().is_some_and(String::is_empty) {
        original_lines.pop();
    }
    let replacements = compute_replacements(&original_lines, file_path, chunks)?;
    let mut new_lines = apply_replacements(&original_lines, &replacements);
    if new_lines.last().is_none_or(|line| !line.is_empty()) {
        new_lines.push(String::new());
    }
    Ok(new_lines.join("\n"))
}

fn compute_replacements(
    original_lines: &[String],
    file_path: &Path,
    chunks: &[UpdateFileChunk],
) -> Result<Vec<(usize, usize, Vec<String>)>, String> {
    let mut replacements = Vec::new();
    let mut line_index = 0;
    for chunk in chunks {
        if let Some(context) = &chunk.change_context {
            let Some(context_index) = seek_sequence(
                original_lines,
                std::slice::from_ref(context),
                line_index,
                false,
            ) else {
                return Err(format!(
                    "Failed to find context '{}' in {}",
                    context,
                    file_path.display()
                ));
            };
            line_index = context_index + 1;
        }
        if chunk.old_lines.is_empty() {
            let insertion_index = if original_lines.last().is_some_and(String::is_empty) {
                original_lines.len().saturating_sub(1)
            } else {
                original_lines.len()
            };
            replacements.push((insertion_index, 0, chunk.new_lines.clone()));
            continue;
        }

        let mut pattern = chunk.old_lines.clone();
        let mut new_slice = chunk.new_lines.clone();
        let mut found = seek_sequence(original_lines, &pattern, line_index, chunk.is_end_of_file);
        if found.is_none() && pattern.last().is_some_and(String::is_empty) {
            pattern.pop();
            if new_slice.last().is_some_and(String::is_empty) {
                new_slice.pop();
            }
            found = seek_sequence(original_lines, &pattern, line_index, chunk.is_end_of_file);
        }
        let Some(found) = found else {
            return Err(format!(
                "Failed to find expected lines in {}:\n{}",
                file_path.display(),
                chunk.old_lines.join("\n")
            ));
        };
        replacements.push((found, pattern.len(), new_slice));
        line_index = found + pattern.len();
    }
    replacements.sort_by_key(|replacement| replacement.0);
    Ok(replacements)
}

fn apply_replacements(
    original_lines: &[String],
    replacements: &[(usize, usize, Vec<String>)],
) -> Vec<String> {
    let mut result = original_lines.to_vec();
    for (start, old_len, new_lines) in replacements.iter().rev() {
        for _ in 0..*old_len {
            if *start < result.len() {
                result.remove(*start);
            }
        }
        for (offset, line) in new_lines.iter().enumerate() {
            result.insert(start + offset, line.clone());
        }
    }
    result
}

fn seek_sequence(lines: &[String], pattern: &[String], start: usize, eof: bool) -> Option<usize> {
    if pattern.is_empty() {
        return Some(start);
    }
    if pattern.len() > lines.len() {
        return None;
    }
    let max_start = lines.len() - pattern.len();
    let search_start = if eof && lines.len() >= pattern.len() {
        max_start
    } else {
        start
    };
    if search_start > max_start {
        return None;
    }
    let normalizers: &[fn(&str) -> String] = &[
        |value| value.to_string(),
        |value| value.trim_end().to_string(),
        |value| value.trim().to_string(),
        |value| normalize_punctuation(value.trim()),
    ];
    for normalize in normalizers {
        for index in search_start..=max_start {
            if lines_match(lines, pattern, index, *normalize) {
                return Some(index);
            }
        }
    }
    None
}

fn lines_match(
    lines: &[String],
    pattern: &[String],
    start: usize,
    normalize: fn(&str) -> String,
) -> bool {
    pattern
        .iter()
        .enumerate()
        .all(|(offset, expected)| normalize(&lines[start + offset]) == normalize(expected))
}

fn normalize_punctuation(value: &str) -> String {
    value
        .chars()
        .map(|character| match character {
            '\u{2010}' | '\u{2011}' | '\u{2012}' | '\u{2013}' | '\u{2014}' | '\u{2015}'
            | '\u{2212}' => '-',
            '\u{2018}' | '\u{2019}' | '\u{201A}' | '\u{201B}' => '\'',
            '\u{201C}' | '\u{201D}' | '\u{201E}' | '\u{201F}' => '"',
            '\u{00A0}' | '\u{2002}' | '\u{2003}' | '\u{2004}' | '\u{2005}' | '\u{2006}'
            | '\u{2007}' | '\u{2008}' | '\u{2009}' | '\u{200A}' | '\u{202F}' | '\u{205F}'
            | '\u{3000}' => ' ',
            other => other,
        })
        .collect()
}

#[derive(Clone)]
struct BashTool {
    cwd: PathBuf,
    registry: Arc<ProcessRegistry>,
}

impl BashTool {
    fn new(cwd: &Path, registry: Arc<ProcessRegistry>) -> Self {
        Self {
            cwd: cwd.to_path_buf(),
            registry,
        }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct BashInput {
    command: String,
    timeout: Option<u64>,
    background: Option<bool>,
    yield_ms: Option<u64>,
}

#[async_trait]
impl pi::sdk::Tool for BashTool {
    fn name(&self) -> &str {
        "bash"
    }

    fn label(&self) -> &str {
        "bash"
    }

    fn description(&self) -> &str {
        "Execute shell commands with background continuation. Use yieldMs/background to continue later via process tool."
    }

    fn parameters(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "command": {
                    "type": "string",
                    "description": "Shell command to execute"
                },
                "timeout": {
                    "type": "integer",
                    "description": "Timeout in seconds. Foreground commands default to 120 seconds; background commands have no default timeout."
                },
                "yieldMs": {
                    "type": "integer",
                    "description": "Milliseconds to wait before backgrounding"
                },
                "background": {
                    "type": "boolean",
                    "description": "Run in background immediately"
                }
            },
            "required": ["command"]
        })
    }

    async fn execute(
        &self,
        _tool_call_id: &str,
        input: Value,
        _on_update: Option<Box<dyn Fn(pi::sdk::ToolUpdate) + Send + Sync>>,
    ) -> pi::sdk::Result<pi::sdk::ToolOutput> {
        let input: BashInput = serde_json::from_value(input)
            .map_err(|error| pi::sdk::Error::validation(error.to_string()))?;
        if input.command.trim().is_empty() {
            return Err(pi::sdk::Error::validation("Provide a command to start."));
        }

        let background = input.background == Some(true);
        let yield_ms = input.yield_ms;
        let timeout = if background || yield_ms.is_some() {
            input.timeout
        } else {
            Some(input.timeout.unwrap_or(120))
        };
        let session = start_shell_session(&self.registry, &self.cwd, input.command, timeout)?;

        if background || yield_ms == Some(0) {
            mark_session_backgrounded(&session);
            return Ok(running_session_output(&session));
        }

        if let Some(yield_ms) = yield_ms {
            wait_for_session(&session, Duration::from_millis(yield_ms));
            if !session.lock().expect("session").exited {
                mark_session_backgrounded(&session);
                return Ok(running_session_output(&session));
            }
        } else {
            wait_for_session(&session, Duration::from_secs(timeout.unwrap_or(120) + 5));
        }

        let snapshot = snapshot_session(&session);
        self.registry.delete(&snapshot.id);
        Ok(completed_bash_output(&snapshot))
    }
}

#[derive(Default)]
struct ProcessRegistry {
    next_id: AtomicU64,
    inner: Mutex<ProcessRegistryInner>,
}

#[derive(Default)]
struct ProcessRegistryInner {
    running: HashMap<String, Arc<Mutex<ProcessSession>>>,
    finished: HashMap<String, FinishedProcessSession>,
}

struct ProcessSession {
    id: String,
    command: String,
    cwd: String,
    pid: u32,
    started_at: u128,
    pending_stdout: String,
    pending_stderr: String,
    aggregated: String,
    tail: String,
    exit_code: Option<i32>,
    exit_signal: Option<String>,
    exited: bool,
    backgrounded: bool,
    truncated: bool,
    child: Arc<Mutex<Child>>,
    stdin: Option<Arc<Mutex<ChildStdin>>>,
}

#[derive(Clone)]
struct FinishedProcessSession {
    id: String,
    command: String,
    started_at: u128,
    ended_at: u128,
    status: ProcessStatus,
    exit_code: Option<i32>,
    exit_signal: Option<String>,
    aggregated: String,
    tail: String,
    truncated: bool,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum ProcessStatus {
    Completed,
    Failed,
}

impl ProcessRegistry {
    fn next_session_id(&self) -> String {
        let next = self.next_id.fetch_add(1, Ordering::Relaxed) + 1;
        format!("bash-{}-{next}", now_millis())
    }

    fn add(&self, session: Arc<Mutex<ProcessSession>>) {
        let id = session.lock().expect("session").id.clone();
        self.inner
            .lock()
            .expect("process registry")
            .running
            .insert(id, session);
    }

    fn running(&self, session_id: &str) -> Option<Arc<Mutex<ProcessSession>>> {
        self.inner
            .lock()
            .expect("process registry")
            .running
            .get(session_id)
            .cloned()
    }

    fn finished(&self, session_id: &str) -> Option<FinishedProcessSession> {
        self.inner
            .lock()
            .expect("process registry")
            .finished
            .get(session_id)
            .cloned()
    }

    fn list_running(&self) -> Vec<Arc<Mutex<ProcessSession>>> {
        self.inner
            .lock()
            .expect("process registry")
            .running
            .values()
            .cloned()
            .collect()
    }

    fn list_finished(&self) -> Vec<FinishedProcessSession> {
        self.inner
            .lock()
            .expect("process registry")
            .finished
            .values()
            .cloned()
            .collect()
    }

    fn delete(&self, session_id: &str) {
        let mut inner = self.inner.lock().expect("process registry");
        inner.running.remove(session_id);
        inner.finished.remove(session_id);
    }

    fn finish_if_exited(&self, session_id: &str) -> Option<FinishedProcessSession> {
        let session = self.running(session_id)?;
        let snapshot = snapshot_session(&session);
        if !snapshot.exited || !snapshot.backgrounded {
            return None;
        }
        let status = if snapshot.exit_code == Some(0) && snapshot.exit_signal.is_none() {
            ProcessStatus::Completed
        } else {
            ProcessStatus::Failed
        };
        let finished = FinishedProcessSession {
            id: snapshot.id.clone(),
            command: snapshot.command,
            started_at: snapshot.started_at,
            ended_at: now_millis(),
            status,
            exit_code: snapshot.exit_code,
            exit_signal: snapshot.exit_signal,
            aggregated: snapshot.aggregated,
            tail: snapshot.tail,
            truncated: snapshot.truncated,
        };
        let mut inner = self.inner.lock().expect("process registry");
        inner.running.remove(session_id);
        inner
            .finished
            .insert(session_id.to_string(), finished.clone());
        Some(finished)
    }
}

struct SessionSnapshot {
    id: String,
    command: String,
    cwd: String,
    pid: u32,
    started_at: u128,
    aggregated: String,
    tail: String,
    exit_code: Option<i32>,
    exit_signal: Option<String>,
    exited: bool,
    backgrounded: bool,
    truncated: bool,
}

fn start_shell_session(
    registry: &Arc<ProcessRegistry>,
    cwd: &Path,
    command: String,
    timeout: Option<u64>,
) -> pi::sdk::Result<Arc<Mutex<ProcessSession>>> {
    let shell = resolve_shell();
    let mut child = Command::new(shell)
        .arg("-lc")
        .arg(&command)
        .current_dir(cwd)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| tool_error("bash", format!("Failed to spawn shell: {error}")))?;

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| tool_error("bash", "Missing stdout"))?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| tool_error("bash", "Missing stderr"))?;
    let stdin = child.stdin.take().map(|stdin| Arc::new(Mutex::new(stdin)));
    let pid = child.id();
    let child = Arc::new(Mutex::new(child));
    let id = registry.next_session_id();
    let session = Arc::new(Mutex::new(ProcessSession {
        id: id.clone(),
        command,
        cwd: cwd.to_string_lossy().to_string(),
        pid,
        started_at: now_millis(),
        pending_stdout: String::new(),
        pending_stderr: String::new(),
        aggregated: String::new(),
        tail: String::new(),
        exit_code: None,
        exit_signal: None,
        exited: false,
        backgrounded: false,
        truncated: false,
        child: Arc::clone(&child),
        stdin,
    }));
    registry.add(Arc::clone(&session));
    spawn_output_reader(Arc::clone(&session), stdout, true);
    spawn_output_reader(Arc::clone(&session), stderr, false);
    spawn_waiter(Arc::clone(&session), child, timeout);
    Ok(session)
}

fn resolve_shell() -> &'static str {
    for candidate in ["/bin/bash", "/usr/bin/bash", "/usr/local/bin/bash"] {
        if Path::new(candidate).exists() {
            return candidate;
        }
    }
    "sh"
}

fn spawn_output_reader(
    session: Arc<Mutex<ProcessSession>>,
    mut reader: impl Read + Send + 'static,
    stdout: bool,
) {
    thread::spawn(move || {
        let mut buffer = [0_u8; 8192];
        loop {
            match reader.read(&mut buffer) {
                Ok(0) => break,
                Ok(count) => {
                    let text = String::from_utf8_lossy(&buffer[..count]).to_string();
                    append_output(&session, &text, stdout);
                }
                Err(_) => break,
            }
        }
    });
}

fn spawn_waiter(
    session: Arc<Mutex<ProcessSession>>,
    child: Arc<Mutex<Child>>,
    timeout: Option<u64>,
) {
    thread::spawn(move || {
        let deadline = timeout.map(|seconds| Instant::now() + Duration::from_secs(seconds));
        loop {
            let status = {
                let mut child = child.lock().expect("child process");
                match child.try_wait() {
                    Ok(status) => status,
                    Err(error) => {
                        mark_runtime_exit(&session, format!("Failed to wait for process: {error}"));
                        return;
                    }
                }
            };
            if let Some(status) = status {
                mark_status_exit(&session, status);
                return;
            }
            if deadline.is_some_and(|deadline| Instant::now() >= deadline) {
                let _ = child.lock().expect("child process").kill();
                mark_timeout_exit(&session);
                return;
            }
            thread::sleep(Duration::from_millis(20));
        }
    });
}

fn append_output(session: &Arc<Mutex<ProcessSession>>, text: &str, stdout: bool) {
    const MAX_OUTPUT: usize = 1_000_000;
    let mut session = session.lock().expect("session");
    if stdout {
        session.pending_stdout.push_str(text);
    } else {
        session.pending_stderr.push_str(text);
    }
    session.aggregated.push_str(text);
    if session.aggregated.len() > MAX_OUTPUT {
        let keep_from =
            char_boundary_at_or_after(&session.aggregated, session.aggregated.len() - MAX_OUTPUT);
        session.aggregated = session.aggregated[keep_from..].to_string();
        session.truncated = true;
    }
    session.tail = tail(&session.aggregated, 2000);
}

fn mark_status_exit(session: &Arc<Mutex<ProcessSession>>, status: ExitStatus) {
    let mut session = session.lock().expect("session");
    session.exited = true;
    session.exit_code = status.code();
    session.exit_signal = exit_signal(&status);
}

fn mark_timeout_exit(session: &Arc<Mutex<ProcessSession>>) {
    let mut session = session.lock().expect("session");
    session.exited = true;
    session.exit_code = None;
    session.exit_signal = Some("timeout".to_string());
}

fn mark_runtime_exit(session: &Arc<Mutex<ProcessSession>>, message: String) {
    append_output(session, &message, false);
    let mut session = session.lock().expect("session");
    session.exited = true;
    session.exit_code = None;
    session.exit_signal = Some("runtime-error".to_string());
}

#[cfg(unix)]
fn exit_signal(status: &ExitStatus) -> Option<String> {
    use std::os::unix::process::ExitStatusExt as _;
    status.signal().map(|signal| signal.to_string())
}

#[cfg(not(unix))]
fn exit_signal(_status: &ExitStatus) -> Option<String> {
    None
}

fn mark_session_backgrounded(session: &Arc<Mutex<ProcessSession>>) {
    session.lock().expect("session").backgrounded = true;
}

fn wait_for_session(session: &Arc<Mutex<ProcessSession>>, duration: Duration) {
    let deadline = Instant::now() + duration;
    while Instant::now() < deadline {
        if session.lock().expect("session").exited {
            return;
        }
        thread::sleep(Duration::from_millis(10));
    }
}

fn snapshot_session(session: &Arc<Mutex<ProcessSession>>) -> SessionSnapshot {
    let session = session.lock().expect("session");
    SessionSnapshot {
        id: session.id.clone(),
        command: session.command.clone(),
        cwd: session.cwd.clone(),
        pid: session.pid,
        started_at: session.started_at,
        aggregated: session.aggregated.clone(),
        tail: session.tail.clone(),
        exit_code: session.exit_code,
        exit_signal: session.exit_signal.clone(),
        exited: session.exited,
        backgrounded: session.backgrounded,
        truncated: session.truncated,
    }
}

fn drain_pending(session: &Arc<Mutex<ProcessSession>>) -> String {
    let mut session = session.lock().expect("session");
    let output = [
        session.pending_stdout.trim_end(),
        session.pending_stderr.trim_end(),
    ]
    .into_iter()
    .filter(|value| !value.is_empty())
    .collect::<Vec<_>>()
    .join("\n");
    session.pending_stdout.clear();
    session.pending_stderr.clear();
    output
}

fn running_session_output(session: &Arc<Mutex<ProcessSession>>) -> pi::sdk::ToolOutput {
    let snapshot = snapshot_session(session);
    text_output(
        format!(
            "Command still running (session {}, pid {}). Use process (list/poll/log/write/kill/clear/remove) for follow-up.",
            snapshot.id, snapshot.pid
        ),
        Some(json!({
            "status": "running",
            "sessionId": snapshot.id,
            "pid": snapshot.pid,
            "startedAt": snapshot.started_at,
            "cwd": snapshot.cwd,
            "tail": snapshot.tail,
        })),
        false,
    )
}

fn completed_bash_output(snapshot: &SessionSnapshot) -> pi::sdk::ToolOutput {
    let status = if snapshot.exit_code == Some(0) && snapshot.exit_signal.is_none() {
        "completed"
    } else {
        "failed"
    };
    let text = if snapshot.aggregated.trim().is_empty() {
        "(no output)".to_string()
    } else {
        snapshot.aggregated.clone()
    };
    text_output(
        text,
        Some(json!({
            "status": status,
            "exitCode": snapshot.exit_code,
            "exitSignal": snapshot.exit_signal,
            "aggregated": snapshot.aggregated,
            "cwd": snapshot.cwd,
        })),
        status == "failed",
    )
}

#[derive(Clone)]
struct ProcessTool {
    registry: Arc<ProcessRegistry>,
}

impl ProcessTool {
    fn new(registry: Arc<ProcessRegistry>) -> Self {
        Self { registry }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProcessInput {
    action: String,
    session_id: Option<String>,
    data: Option<String>,
    keys: Option<Vec<String>>,
    literal: Option<String>,
    text: Option<String>,
    eof: Option<bool>,
    timeout: Option<Value>,
}

#[async_trait]
impl pi::sdk::Tool for ProcessTool {
    fn name(&self) -> &str {
        "process"
    }

    fn label(&self) -> &str {
        "process"
    }

    fn description(&self) -> &str {
        "Manage running bash sessions: list, poll, log, write, send-keys, submit, paste, kill, clear, remove."
    }

    fn parameters(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "action": {
                    "type": "string",
                    "description": "Process action: list, poll, log, write, send-keys, submit, paste, kill, clear, remove"
                },
                "sessionId": {
                    "type": "string",
                    "description": "Session id for actions other than list"
                },
                "data": {
                    "type": "string",
                    "description": "Data to write"
                },
                "keys": {
                    "type": "array",
                    "items": { "type": "string" },
                    "description": "Key tokens for send-keys"
                },
                "literal": {
                    "type": "string",
                    "description": "Literal text for send-keys"
                },
                "text": {
                    "type": "string",
                    "description": "Text to paste"
                },
                "eof": {
                    "type": "boolean",
                    "description": "Close stdin after write"
                },
                "timeout": {
                    "type": "integer",
                    "description": "For poll: wait up to this many milliseconds before returning"
                }
            },
            "required": ["action"]
        })
    }

    async fn execute(
        &self,
        _tool_call_id: &str,
        input: Value,
        _on_update: Option<Box<dyn Fn(pi::sdk::ToolUpdate) + Send + Sync>>,
    ) -> pi::sdk::Result<pi::sdk::ToolOutput> {
        let input: ProcessInput = serde_json::from_value(input)
            .map_err(|error| pi::sdk::Error::validation(error.to_string()))?;
        match input.action.as_str() {
            "list" => Ok(self.list()),
            "poll" => self.poll(&required_session_id(&input)?, poll_timeout(&input.timeout)),
            "log" => self.log(&required_session_id(&input)?),
            "write" => self.write(
                &required_session_id(&input)?,
                input.data.unwrap_or_default(),
                input.eof == Some(true),
            ),
            "send-keys" => self.write(
                &required_session_id(&input)?,
                encode_key_tokens(input.literal, input.keys)?,
                false,
            ),
            "submit" => self.write(&required_session_id(&input)?, "\n".to_string(), false),
            "paste" => self.write(
                &required_session_id(&input)?,
                input.text.unwrap_or_default(),
                false,
            ),
            "kill" => self.kill(&required_session_id(&input)?),
            "clear" | "remove" => Ok(self.remove(&required_session_id(&input)?)),
            action => Ok(text_output(
                format!("Unknown action {action}"),
                Some(json!({ "status": "failed" })),
                true,
            )),
        }
    }
}

impl ProcessTool {
    fn list(&self) -> pi::sdk::ToolOutput {
        let mut lines = Vec::new();
        for session in self.registry.list_running() {
            let snapshot = snapshot_session(&session);
            let status = if snapshot.exited {
                "completed"
            } else {
                "running"
            };
            lines.push(format!(
                "{} {:9} {} :: {}",
                snapshot.id,
                status,
                format_duration(now_millis().saturating_sub(snapshot.started_at)),
                snapshot.command
            ));
        }
        for finished in self.registry.list_finished() {
            lines.push(format!(
                "{} {:9} {} :: {}",
                finished.id,
                status_text(finished.status),
                format_duration(finished.ended_at.saturating_sub(finished.started_at)),
                finished.command
            ));
        }
        text_output(
            if lines.is_empty() {
                "No running or recent sessions.".to_string()
            } else {
                lines.join("\n")
            },
            Some(json!({ "status": "completed" })),
            false,
        )
    }

    fn poll(&self, session_id: &str, timeout: Duration) -> pi::sdk::Result<pi::sdk::ToolOutput> {
        if let Some(session) = self.registry.running(session_id) {
            if !session.lock().expect("session").backgrounded {
                return Ok(text_output(
                    format!("Session {session_id} is not backgrounded."),
                    Some(json!({ "status": "failed" })),
                    true,
                ));
            }
            wait_for_session(&session, timeout);
            thread::sleep(Duration::from_millis(20));
            let output = drain_pending(&session);
            let snapshot = snapshot_session(&session);
            if snapshot.exited {
                let status = if snapshot.exit_code == Some(0) && snapshot.exit_signal.is_none() {
                    "completed"
                } else {
                    "failed"
                };
                let text = if output.is_empty() {
                    snapshot.tail.clone()
                } else {
                    output
                };
                let text = format!(
                    "{}\n\nProcess exited with {}.",
                    if text.is_empty() {
                        "(no output)"
                    } else {
                        text.as_str()
                    },
                    snapshot.exit_signal.as_ref().map_or_else(
                        || format!("code {}", snapshot.exit_code.unwrap_or(0)),
                        |signal| { format!("signal {signal}") }
                    )
                );
                self.registry.finish_if_exited(session_id);
                return Ok(text_output(
                    text,
                    Some(json!({
                        "status": status,
                        "sessionId": session_id,
                        "exitCode": snapshot.exit_code,
                        "exitSignal": snapshot.exit_signal,
                        "aggregated": snapshot.aggregated,
                    })),
                    status == "failed",
                ));
            }
            return Ok(text_output(
                format!(
                    "{}\n\nProcess still running.",
                    if output.is_empty() {
                        "(no new output)"
                    } else {
                        output.as_str()
                    }
                ),
                Some(json!({
                    "status": "running",
                    "sessionId": session_id,
                    "aggregated": snapshot.aggregated,
                })),
                false,
            ));
        }

        if let Some(finished) = self.registry.finished(session_id) {
            let status = status_text(finished.status);
            return Ok(text_output(
                format!(
                    "{}\n\nProcess exited with {}.",
                    if finished.tail.is_empty() {
                        "(no output recorded)"
                    } else {
                        finished.tail.as_str()
                    },
                    finished.exit_signal.as_ref().map_or_else(
                        || format!("code {}", finished.exit_code.unwrap_or(0)),
                        |signal| { format!("signal {signal}") }
                    )
                ),
                Some(json!({
                    "status": status,
                    "sessionId": session_id,
                    "exitCode": finished.exit_code,
                    "exitSignal": finished.exit_signal,
                    "aggregated": finished.aggregated,
                })),
                status == "failed",
            ));
        }

        Ok(text_output(
            format!("No session found for {session_id}"),
            Some(json!({ "status": "failed" })),
            true,
        ))
    }

    fn log(&self, session_id: &str) -> pi::sdk::Result<pi::sdk::ToolOutput> {
        if let Some(session) = self.registry.running(session_id) {
            let snapshot = snapshot_session(&session);
            let status = if snapshot.exited {
                "completed"
            } else {
                "running"
            };
            return Ok(text_output(
                if snapshot.aggregated.is_empty() {
                    "(no output yet)".to_string()
                } else {
                    snapshot.aggregated
                },
                Some(json!({
                    "status": status,
                    "sessionId": session_id,
                    "truncated": snapshot.truncated,
                })),
                false,
            ));
        }
        if let Some(finished) = self.registry.finished(session_id) {
            return Ok(text_output(
                if finished.aggregated.is_empty() {
                    "(no output recorded)".to_string()
                } else {
                    finished.aggregated.clone()
                },
                Some(json!({
                    "status": status_text(finished.status),
                    "sessionId": session_id,
                    "truncated": finished.truncated,
                })),
                false,
            ));
        }
        Ok(text_output(
            format!("No session found for {session_id}"),
            Some(json!({ "status": "failed" })),
            true,
        ))
    }

    fn write(
        &self,
        session_id: &str,
        data: String,
        close_stdin: bool,
    ) -> pi::sdk::Result<pi::sdk::ToolOutput> {
        let Some(session) = self.registry.running(session_id) else {
            return Ok(text_output(
                format!("No active session found for {session_id}"),
                Some(json!({ "status": "failed" })),
                true,
            ));
        };
        let stdin = session.lock().expect("session").stdin.clone();
        let Some(stdin) = stdin else {
            return Ok(text_output(
                format!("Session {session_id} stdin is not writable."),
                Some(json!({ "status": "failed" })),
                true,
            ));
        };
        let mut stdin = stdin.lock().expect("stdin");
        stdin
            .write_all(data.as_bytes())
            .map_err(|error| tool_error("process", format!("Failed to write stdin: {error}")))?;
        if close_stdin {
            let _ = stdin.flush();
            drop(stdin);
            session.lock().expect("session").stdin = None;
        }
        Ok(text_output(
            format!("Wrote {} bytes to session {session_id}.", data.len()),
            Some(json!({ "status": "running", "sessionId": session_id })),
            false,
        ))
    }

    fn kill(&self, session_id: &str) -> pi::sdk::Result<pi::sdk::ToolOutput> {
        let Some(session) = self.registry.running(session_id) else {
            return Ok(text_output(
                format!("No active session found for {session_id}"),
                Some(json!({ "status": "failed" })),
                true,
            ));
        };
        let child = Arc::clone(&session.lock().expect("session").child);
        child
            .lock()
            .expect("child process")
            .kill()
            .map_err(|error| tool_error("process", format!("Failed to kill process: {error}")))?;
        Ok(text_output(
            format!("Killed session {session_id}."),
            Some(json!({ "status": "failed", "sessionId": session_id })),
            true,
        ))
    }

    fn remove(&self, session_id: &str) -> pi::sdk::ToolOutput {
        if let Some(session) = self.registry.running(session_id) {
            let child = Arc::clone(&session.lock().expect("session").child);
            let _ = child.lock().expect("child process").kill();
        }
        self.registry.delete(session_id);
        text_output(
            format!("Removed session {session_id}."),
            Some(json!({ "status": "completed" })),
            false,
        )
    }
}

fn required_session_id(input: &ProcessInput) -> pi::sdk::Result<String> {
    input
        .session_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
        .ok_or_else(|| pi::sdk::Error::validation("sessionId is required for this action."))
}

fn encode_key_tokens(
    literal: Option<String>,
    keys: Option<Vec<String>>,
) -> pi::sdk::Result<String> {
    if let Some(literal) = literal {
        if !literal.is_empty() {
            return Ok(literal);
        }
    }
    let Some(keys) = keys else {
        return Err(pi::sdk::Error::validation("No key data provided."));
    };
    let mut encoded = String::new();
    for key in keys {
        let normalized = key.trim().to_ascii_lowercase();
        let sequence = match normalized.as_str() {
            "enter" | "return" => "\r",
            "tab" => "\t",
            "escape" | "esc" => "\u{1b}",
            "backspace" => "\u{7f}",
            "ctrl-c" | "control-c" => "\u{3}",
            "ctrl-d" | "control-d" => "\u{4}",
            "up" => "\u{1b}[A",
            "down" => "\u{1b}[B",
            "right" => "\u{1b}[C",
            "left" => "\u{1b}[D",
            "" => "",
            _ => {
                return Err(pi::sdk::Error::validation(format!(
                    "Unsupported key token: {key}"
                )));
            }
        };
        encoded.push_str(sequence);
    }
    if encoded.is_empty() {
        return Err(pi::sdk::Error::validation("No key data provided."));
    }
    Ok(encoded)
}

fn poll_timeout(value: &Option<Value>) -> Duration {
    let millis = match value {
        Some(Value::Number(number)) => number.as_u64().unwrap_or(0),
        Some(Value::String(value)) => value.trim().parse::<u64>().unwrap_or(0),
        _ => 0,
    };
    Duration::from_millis(millis.min(120_000))
}

fn now_millis() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
}

fn tail(text: &str, max: usize) -> String {
    if text.len() <= max {
        return text.to_string();
    }
    let start = char_boundary_at_or_after(text, text.len() - max);
    text[start..].to_string()
}

fn char_boundary_at_or_after(text: &str, mut index: usize) -> usize {
    while index < text.len() && !text.is_char_boundary(index) {
        index += 1;
    }
    index
}

fn status_text(status: ProcessStatus) -> &'static str {
    match status {
        ProcessStatus::Completed => "completed",
        ProcessStatus::Failed => "failed",
    }
}

fn format_duration(millis: u128) -> String {
    if millis < 1000 {
        format!("{millis}ms")
    } else {
        format!("{:.1}s", millis as f64 / 1000.0)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn native_tool_output_maps_text_and_image_blocks() {
        let output = native_tool_output(json!({
            "content": [
                { "type": "text", "text": "snapshot" },
                { "type": "image", "data": "aW1n", "mimeType": "image/png" }
            ],
            "details": { "ok": true }
        }));

        assert!(!output.is_error);
        assert_eq!(output.details, Some(json!({ "ok": true })));
        assert_eq!(output.content.len(), 2);
        match &output.content[0] {
            pi::sdk::ContentBlock::Text(text) => assert_eq!(text.text, "snapshot"),
            other => panic!("expected text block, got {other:?}"),
        }
        match &output.content[1] {
            pi::sdk::ContentBlock::Image(image) => {
                assert_eq!(image.data, "aW1n");
                assert_eq!(image.mime_type, "image/png");
            }
            other => panic!("expected image block, got {other:?}"),
        }
    }
}
