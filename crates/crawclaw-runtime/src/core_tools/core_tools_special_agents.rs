use super::*;

#[derive(Clone, Copy)]
pub(super) enum SpecialAgentToolKind {
    ReviewTask,
    // Hindsight knowledge tools (replace old file-based memory tools)
    KnowledgeRecall,
    KnowledgeReflect,
    KnowledgeIngest,
    KnowledgeModelList,
    KnowledgeModelCreate,
    // Session summary (unchanged — stays local)
    SessionSummaryFileRead,
    SessionSummaryFileEdit,
}

impl SpecialAgentToolKind {
    pub(super) fn name(self) -> &'static str {
        match self {
            Self::ReviewTask => "review_task",
            Self::KnowledgeRecall => "knowledge_recall",
            Self::KnowledgeReflect => "knowledge_reflect",
            Self::KnowledgeIngest => "knowledge_ingest",
            Self::KnowledgeModelList => "knowledge_model_list",
            Self::KnowledgeModelCreate => "knowledge_model_create",
            Self::SessionSummaryFileRead => "session_summary_file_read",
            Self::SessionSummaryFileEdit => "session_summary_file_edit",
        }
    }

    fn description(self) -> &'static str {
        match self {
            Self::ReviewTask => "Run the Rust-native review special agent.",
            Self::KnowledgeRecall => {
                "Search Hindsight memory banks for relevant knowledge. \
                 Returns observations, facts, and mental model content."
            }
            Self::KnowledgeReflect => {
                "Deep synthesis query against Hindsight memory. \
                 Generates higher-order insights from accumulated memories."
            }
            Self::KnowledgeIngest => {
                "Ingest content into Hindsight memory bank. \
                 Useful for injecting documents, code snippets, or reference material."
            }
            Self::KnowledgeModelList => {
                "List all mental models in a Hindsight bank. \
                 Mental models are pre-computed high-level understandings."
            }
            Self::KnowledgeModelCreate => {
                "Create a new mental model in a Hindsight bank. \
                 The model will be auto-refreshed after future consolidations."
            }
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
            Self::KnowledgeRecall => json!({
                "type": "object",
                "properties": {
                    "query": { "type": "string", "description": "Search query" },
                    "layer": {
                        "type": "string",
                        "enum": ["durable", "experience", "resource", "mental-models"],
                        "description": "Memory layer to search (default: durable)"
                    },
                    "budget": {
                        "type": "string",
                        "enum": ["low", "mid", "high"],
                        "description": "Search thoroughness (default: mid)"
                    },
                    "maxTokens": { "type": "integer", "description": "Max result tokens (default: 2048)" }
                },
                "required": ["query"]
            }),
            Self::KnowledgeReflect => json!({
                "type": "object",
                "properties": {
                    "query": { "type": "string", "description": "Reflection query" },
                    "budget": {
                        "type": "string",
                        "enum": ["low", "mid", "high"],
                        "description": "Reflection depth (default: high)"
                    },
                    "maxTokens": { "type": "integer", "description": "Max result tokens (default: 2048)" }
                },
                "required": ["query"]
            }),
            Self::KnowledgeIngest => json!({
                "type": "object",
                "properties": {
                    "content": { "type": "string", "description": "Content to ingest" },
                    "context": { "type": "string", "description": "Context about the content" },
                    "layer": {
                        "type": "string",
                        "enum": ["durable", "experience", "resource"],
                        "description": "Target layer (default: resource)"
                    }
                },
                "required": ["content"]
            }),
            Self::KnowledgeModelList => json!({
                "type": "object",
                "properties": {
                    "layer": {
                        "type": "string",
                        "enum": ["durable", "experience", "mental-models"],
                        "description": "Bank layer (default: mental-models)"
                    }
                }
            }),
            Self::KnowledgeModelCreate => json!({
                "type": "object",
                "properties": {
                    "name": { "type": "string", "description": "Model name" },
                    "sourceQuery": { "type": "string", "description": "Source query for the model" },
                    "tags": {
                        "type": "array",
                        "items": { "type": "string" },
                        "description": "Tags for the model"
                    },
                    "maxTokens": { "type": "integer", "description": "Max tokens (default: 2048)" }
                },
                "required": ["name", "sourceQuery"]
            }),
            Self::SessionSummaryFileRead => json!({
                "type": "object",
                "properties": {
                    "scope": { "type": "string" }
                }
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
                | Self::KnowledgeRecall
                | Self::KnowledgeReflect
                | Self::KnowledgeModelList
                | Self::SessionSummaryFileRead
        )
    }

    fn all() -> &'static [Self] {
        &[
            Self::ReviewTask,
            Self::KnowledgeRecall,
            Self::KnowledgeReflect,
            Self::KnowledgeIngest,
            Self::KnowledgeModelList,
            Self::KnowledgeModelCreate,
            Self::SessionSummaryFileRead,
            Self::SessionSummaryFileEdit,
        ]
    }
}

pub(super) struct SpecialAgentTool {
    runtime_root: PathBuf,
    kind: SpecialAgentToolKind,
}

impl SpecialAgentTool {
    pub(super) fn new(runtime_root: impl Into<PathBuf>, kind: SpecialAgentToolKind) -> Self {
        Self {
            runtime_root: runtime_root.into(),
            kind,
        }
    }

    pub(super) fn all(runtime_root: impl Into<PathBuf> + Clone) -> Vec<Self> {
        SpecialAgentToolKind::all()
            .iter()
            .map(|&kind| Self::new(runtime_root.clone(), kind))
            .collect()
    }
}

fn scope_param(input: &Value) -> String {
    string_param(input, &["scope"]).unwrap_or_else(|| "default".to_string())
}

fn required_tool_param(
    kind: SpecialAgentToolKind,
    input: &Value,
    keys: &[&str],
) -> pi::sdk::Result<String> {
    string_param(input, keys).ok_or_else(|| {
        pi::sdk::Error::validation(format!(
            "Missing required parameter '{}' for tool '{}'",
            keys.join(" | "),
            kind.name()
        ))
    })
}

fn string_param(input: &Value, keys: &[&str]) -> Option<String> {
    for key in keys {
        if let Some(s) = input.get(key).and_then(Value::as_str) {
            if !s.is_empty() {
                return Some(s.to_string());
            }
        }
    }
    None
}

fn now_millis() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
}

fn resolve_bank_id(runtime_root: &Path, layer: &str) -> String {
    let config = crate::memory::MemoryRuntimeConfig::load(runtime_root);
    let resolver =
        crate::memory::bank_resolver::BankResolverConfig::from_hindsight_config(&config.hindsight);
    let ctx = crate::memory::bank_resolver::BankContext {
        agent_id: "main".to_string(),
        channel: None,
        user_id: None,
    };
    resolver.resolve(&ctx, layer)
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
                let task = required_tool_param(self.kind, &input, &["task"])?;
                let stage = string_param(&input, &["stage"]);
                let kind = match stage.as_deref() {
                    Some("spec") => "review-spec".to_string(),
                    Some("quality") | None => "review-quality".to_string(),
                    Some(other) => other.to_string(),
                };
                run_review_task_with_agent_runtime(&self.runtime_root, &kind, &task, None)
                    .await
                    .map_err(|error| pi::sdk::Error::tool(self.kind.name(), error))?
            }

            // --- Hindsight Knowledge Tools ---
            SpecialAgentToolKind::KnowledgeRecall => {
                let query = required_tool_param(self.kind, &input, &["query"])?;
                let layer =
                    string_param(&input, &["layer"]).unwrap_or_else(|| "durable".to_string());
                let budget = string_param(&input, &["budget"]).unwrap_or_else(|| "mid".to_string());
                let max_tokens = input
                    .get("maxTokens")
                    .and_then(Value::as_u64)
                    .unwrap_or(2048) as u32;

                let runtime = crate::memory::MemoryRuntime::new(self.runtime_root.clone());
                let client = runtime.hindsight().ok_or_else(|| {
                    pi::sdk::Error::tool(self.kind.name(), "Hindsight not configured")
                })?;
                let bank_id = resolve_bank_id(&self.runtime_root, &layer);
                let config = runtime.config();
                let tags: Vec<&str> = config.hindsight.tags.iter().map(|s| s.as_str()).collect();

                let response = client
                    .recall(
                        &bank_id,
                        &query,
                        &config
                            .hindsight
                            .recall_types
                            .iter()
                            .map(|s| s.as_str())
                            .collect::<Vec<_>>(),
                        &budget,
                        max_tokens,
                        &tags,
                        &config.hindsight.tags_match,
                    )
                    .map_err(|e| pi::sdk::Error::tool(self.kind.name(), e))?;

                json!({
                    "status": "ok",
                    "provider": "hindsight",
                    "bank": bank_id,
                    "items": response.items.iter().map(|item| json!({
                        "text": item.text,
                        "type": item.memory_type,
                        "score": item.score,
                    })).collect::<Vec<_>>(),
                    "itemCount": response.items.len(),
                })
            }

            SpecialAgentToolKind::KnowledgeReflect => {
                let query = required_tool_param(self.kind, &input, &["query"])?;
                let budget =
                    string_param(&input, &["budget"]).unwrap_or_else(|| "high".to_string());
                let max_tokens = input
                    .get("maxTokens")
                    .and_then(Value::as_u64)
                    .unwrap_or(2048) as u32;

                let runtime = crate::memory::MemoryRuntime::new(self.runtime_root.clone());
                let client = runtime.hindsight().ok_or_else(|| {
                    pi::sdk::Error::tool(self.kind.name(), "Hindsight not configured")
                })?;
                let bank_id = resolve_bank_id(&self.runtime_root, "mental-models");

                let response = client
                    .reflect(&bank_id, &query, &budget, max_tokens)
                    .map_err(|e| pi::sdk::Error::tool(self.kind.name(), e))?;

                json!({
                    "status": "ok",
                    "provider": "hindsight",
                    "text": response.text,
                    "basedOn": response.based_on,
                })
            }

            SpecialAgentToolKind::KnowledgeIngest => {
                let content = required_tool_param(self.kind, &input, &["content"])?;
                let context = string_param(&input, &["context"])
                    .unwrap_or_else(|| "manual_ingest".to_string());
                let layer =
                    string_param(&input, &["layer"]).unwrap_or_else(|| "resource".to_string());

                let runtime = crate::memory::MemoryRuntime::new(self.runtime_root.clone());
                let client = runtime.hindsight().ok_or_else(|| {
                    pi::sdk::Error::tool(self.kind.name(), "Hindsight not configured")
                })?;
                let bank_id = resolve_bank_id(&self.runtime_root, &layer);
                let config = runtime.config();
                let tags: Vec<&str> = config.hindsight.tags.iter().map(|s| s.as_str()).collect();

                let response = client
                    .retain(
                        &bank_id,
                        &content,
                        &context,
                        json!({ "source": "knowledge_ingest_tool", "layer": layer }),
                        &tags,
                    )
                    .map_err(|e| pi::sdk::Error::tool(self.kind.name(), e))?;

                json!({
                    "status": "ok",
                    "provider": "hindsight",
                    "bank": response.bank,
                })
            }

            SpecialAgentToolKind::KnowledgeModelList => {
                let layer =
                    string_param(&input, &["layer"]).unwrap_or_else(|| "mental-models".to_string());

                let runtime = crate::memory::MemoryRuntime::new(self.runtime_root.clone());
                let client = runtime.hindsight().ok_or_else(|| {
                    pi::sdk::Error::tool(self.kind.name(), "Hindsight not configured")
                })?;
                let bank_id = resolve_bank_id(&self.runtime_root, &layer);

                let models = client
                    .list_mental_models(&bank_id)
                    .map_err(|e| pi::sdk::Error::tool(self.kind.name(), e))?;

                json!({
                    "status": "ok",
                    "provider": "hindsight",
                    "bank": bank_id,
                    "models": models.iter().map(|m| json!({
                        "id": m.id,
                        "name": m.name,
                        "content": m.content,
                        "tags": m.tags,
                    })).collect::<Vec<_>>(),
                    "modelCount": models.len(),
                })
            }

            SpecialAgentToolKind::KnowledgeModelCreate => {
                let name = required_tool_param(self.kind, &input, &["name"])?;
                let source_query = required_tool_param(self.kind, &input, &["sourceQuery"])?;
                let tags = input
                    .get("tags")
                    .and_then(Value::as_array)
                    .map(|arr| {
                        arr.iter()
                            .filter_map(|v| v.as_str().map(String::from))
                            .collect()
                    })
                    .unwrap_or_default();
                let max_tokens = input
                    .get("maxTokens")
                    .and_then(Value::as_u64)
                    .unwrap_or(2048) as u32;

                let runtime = crate::memory::MemoryRuntime::new(self.runtime_root.clone());
                let client = runtime.hindsight().ok_or_else(|| {
                    pi::sdk::Error::tool(self.kind.name(), "Hindsight not configured")
                })?;
                let bank_id = resolve_bank_id(&self.runtime_root, "mental-models");

                client
                    .create_mental_model(&bank_id, &name, &source_query, tags, max_tokens)
                    .map_err(|e| pi::sdk::Error::tool(self.kind.name(), e))?;

                json!({
                    "status": "ok",
                    "provider": "hindsight",
                    "bank": bank_id,
                    "name": name,
                })
            }

            // --- Session Summary (unchanged) ---
            SpecialAgentToolKind::SessionSummaryFileRead => {
                let scope = scope_param(&input);
                crate::memory::SessionSummaryStore::new(self.runtime_root.clone())
                    .read(&scope)
                    .map_err(|error| pi::sdk::Error::tool(self.kind.name(), error))?
            }
            SpecialAgentToolKind::SessionSummaryFileEdit => {
                let scope = scope_param(&input);
                let content = required_tool_param(self.kind, &input, &["content"])?;
                crate::memory::SessionSummaryStore::new(self.runtime_root.clone())
                    .edit(&scope, &content)
                    .map_err(|error| pi::sdk::Error::tool(self.kind.name(), error))?
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
