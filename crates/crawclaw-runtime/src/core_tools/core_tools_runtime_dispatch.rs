use super::*;

#[derive(Clone, Copy)]
pub(super) enum CoreRuntimeToolKind {
    Canvas,
    Message,
    Image,
    Pdf,
    Tts,
    DiscoverSkills,
    Workflow,
    Workflowize,
}

impl CoreRuntimeToolKind {
    pub(super) fn name(self) -> &'static str {
        match self {
            Self::Canvas => "canvas",
            Self::Message => "message",
            Self::Image => "image",
            Self::Pdf => "pdf",
            Self::Tts => "tts",
            Self::DiscoverSkills => "discover_skills",
            Self::Workflow => "workflow",
            Self::Workflowize => "workflowize",
        }
    }

    fn description(self) -> &'static str {
        match self {
            Self::Canvas => "Canvas control is unavailable in current CrawClaw builds.",
            Self::Message => "Send messages and channel actions through Rust outbound delivery.",
            Self::Image => "Describe images through the Rust native media-understanding registry.",
            Self::Pdf => "Analyze PDF documents through the Rust runtime.",
            Self::Tts => "Convert text to speech through the Rust native TTS provider.",
            Self::DiscoverSkills => "Search available skills from the Rust runtime skill roots.",
            Self::Workflow => "Manage local workflow registry entries through the Rust runtime.",
            Self::Workflowize => "Create a local workflow draft through the Rust runtime.",
        }
    }

    fn parameters(self) -> Value {
        match self {
            Self::Canvas => json!({
                "type": "object",
                "properties": {
                    "action": { "type": "string", "enum": ["present", "hide", "navigate", "eval", "snapshot"] }
                },
                "required": ["action"]
            }),
            Self::Message => json!({
                "type": "object",
                "properties": {
                    "action": { "type": "string", "enum": ["send", "poll", "action"] },
                    "channel": { "type": "string" },
                    "accountId": { "type": "string" },
                    "target": { "type": "string" },
                    "to": { "type": "string" },
                    "text": { "type": "string" },
                    "message": { "type": "string" },
                    "mediaUrls": { "type": "array", "items": { "type": "string" } },
                    "threadId": { "type": "string" },
                    "replyToId": { "type": "string" }
                }
            }),
            Self::Image => json!({
                "type": "object",
                "properties": {
                    "prompt": { "type": "string" },
                    "image": { "type": "string" },
                    "images": { "type": "array", "items": { "type": "string" } },
                    "model": { "type": "string" },
                    "provider": { "type": "string" },
                    "apiKey": { "type": "string" },
                    "baseUrl": { "type": "string" },
                    "maxTokens": { "type": "number" }
                }
            }),
            Self::Pdf => json!({
                "type": "object",
                "properties": {
                    "prompt": { "type": "string" },
                    "pdf": { "type": "string" },
                    "pdfs": { "type": "array", "items": { "type": "string" } },
                    "pages": { "type": "string" },
                    "model": { "type": "string" },
                    "maxBytesMb": { "type": "number" }
                }
            }),
            Self::Tts => json!({
                "type": "object",
                "properties": {
                    "text": { "type": "string" },
                    "channel": { "type": "string" },
                    "voice": { "type": "string" },
                    "outputFormat": { "type": "string" },
                    "providerOverrides": { "type": "object" },
                    "providerConfig": { "type": "object" },
                    "baseUrl": { "type": "string" }
                },
                "required": ["text"]
            }),
            Self::DiscoverSkills => json!({
                "type": "object",
                "properties": {
                    "taskDescription": { "type": "string" },
                    "limit": { "type": "number" }
                },
                "required": ["taskDescription"]
            }),
            Self::Workflow => json!({
                "type": "object",
                "properties": {
                    "action": { "type": "string" },
                    "workflow": { "type": "string" },
                    "query": { "type": "string" },
                    "limit": { "type": "number" },
                    "inputs": { "type": "object" },
                    "patch": { "type": "object" }
                },
                "required": ["action"]
            }),
            Self::Workflowize => json!({
                "type": "object",
                "properties": {
                    "name": { "type": "string" },
                    "goal": { "type": "string" },
                    "topology": { "type": "string" },
                    "description": { "type": "string" },
                    "sourceSummary": { "type": "string" },
                    "steps": { "type": "array", "items": { "type": "string" } },
                    "stepSpecs": { "type": "array", "items": { "type": "object" } },
                    "tags": { "type": "array", "items": { "type": "string" } },
                    "inputs": { "type": "array", "items": { "type": "string" } },
                    "outputs": { "type": "array", "items": { "type": "string" } },
                    "safeForAutoRun": { "type": "boolean" },
                    "requiresApproval": { "type": "boolean" }
                },
                "required": ["name", "goal"]
            }),
        }
    }

    fn is_read_only(self) -> bool {
        matches!(
            self,
            Self::Canvas | Self::Image | Self::Pdf | Self::DiscoverSkills
        )
    }
}

#[derive(Clone)]
pub(super) struct CoreRuntimeTool {
    runtime_root: PathBuf,
    kind: CoreRuntimeToolKind,
}

impl CoreRuntimeTool {
    pub(super) fn new(runtime_root: &Path, kind: CoreRuntimeToolKind) -> Self {
        Self {
            runtime_root: runtime_root.to_path_buf(),
            kind,
        }
    }
}

#[async_trait]
impl pi::sdk::Tool for CoreRuntimeTool {
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
            CoreRuntimeToolKind::Canvas => run_canvas_tool(&self.runtime_root, input)
                .map_err(|error| tool_error(self.kind.name(), error))?,
            CoreRuntimeToolKind::Message => run_message_tool(&self.runtime_root, input)
                .map_err(|error| tool_error(self.kind.name(), error))?,
            CoreRuntimeToolKind::Image => run_image_tool(&self.runtime_root, input)
                .await
                .map_err(|error| tool_error(self.kind.name(), error))?,
            CoreRuntimeToolKind::Pdf => run_pdf_tool(&self.runtime_root, input)
                .await
                .map_err(|error| tool_error(self.kind.name(), error))?,
            CoreRuntimeToolKind::Tts => run_tts_tool(&self.runtime_root, input)
                .await
                .map_err(|error| tool_error(self.kind.name(), error))?,
            CoreRuntimeToolKind::DiscoverSkills => {
                run_discover_skills_tool(&self.runtime_root, input)
                    .map_err(|error| tool_error(self.kind.name(), error))?
            }
            CoreRuntimeToolKind::Workflow => run_workflow_tool(&self.runtime_root, input)
                .map_err(|error| tool_error(self.kind.name(), error))?,
            CoreRuntimeToolKind::Workflowize => run_workflowize_tool(&self.runtime_root, input)
                .map_err(|error| tool_error(self.kind.name(), error))?,
        };
        Ok(native_tool_output(result))
    }

    fn is_read_only(&self) -> bool {
        self.kind.is_read_only()
    }
}
