use super::*;

#[derive(Clone, Copy)]
pub(super) enum SpecialAgentToolKind {
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
    pub(super) fn name(self) -> &'static str {
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
pub(super) struct SpecialAgentTool {
    runtime_root: PathBuf,
    kind: SpecialAgentToolKind,
}

impl SpecialAgentTool {
    pub(super) fn new(runtime_root: &Path, kind: SpecialAgentToolKind) -> Self {
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

pub(super) async fn run_review_task_with_agent_runtime(
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
            profile: Some(AgentRunProfileRequest {
                kind: AgentRunProfileKind::SpecialAgent,
                special_agent: Some(definition.id.to_string()),
                memory_after_turn: Some(
                    definition.guard != Some(SpecialAgentToolGuard::MemoryMaintenance),
                ),
            }),
            options: BTreeMap::new(),
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
