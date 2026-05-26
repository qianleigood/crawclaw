use super::*;

#[derive(Clone)]
pub struct AgentRuntime {
    pub(super) runtime_root: PathBuf,
    pub(super) pi_agent_backend: Arc<dyn AgentRuntimeBackend>,
    pub(super) native_provider_backend: Arc<dyn AgentRuntimeBackend>,
}

pub struct AgentRuntimeRequest<'a> {
    pub runtime_root: &'a Path,
    pub thread_id: &'a str,
    pub user_text: &'a str,
    pub history: Vec<AgentRuntimeMessage>,
    pub runtime_context: RuntimeModelContext,
    pub provider_config: NativeProviderConfig,
    pub reasoning_level: Option<String>,
    pub tool_selection: AgentRuntimeToolSelection,
    pub permission_policy: Option<AgentRuntimePermissionPolicy>,
    pub system_prompt: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentRuntimeMessage {
    pub role: AgentRuntimeMessageRole,
    pub content: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub blocks: Vec<AgentRuntimeMessageBlock>,
}

impl AgentRuntimeMessage {
    pub fn text(role: AgentRuntimeMessageRole, content: impl Into<String>) -> Self {
        Self {
            role,
            content: content.into(),
            blocks: Vec::new(),
        }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum AgentRuntimeMessageBlock {
    Text {
        text: String,
    },
    Image {
        mime_type: String,
        data: String,
    },
    ToolUse {
        id: String,
        name: String,
        #[serde(default)]
        input: Value,
    },
    ToolResult {
        tool_use_id: String,
        content: String,
        #[serde(default)]
        is_error: bool,
    },
    Meta {
        #[serde(default)]
        data: Value,
    },
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AgentRuntimeMessageRole {
    User,
    Assistant,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentRuntimeContextSummary {
    pub included_tools: Vec<String>,
    pub deferred_tools: Vec<String>,
    pub surfaced_skills: Vec<AgentRuntimeSkillSummary>,
    pub loaded_skills: Vec<String>,
    pub memory_snippets: Vec<String>,
    pub message_count: usize,
    pub estimated_tokens: usize,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentRuntimeSkillSummary {
    pub name: String,
    pub description: String,
}

#[derive(Clone, Debug)]
pub struct RuntimeModelContext {
    pub system_sections: Vec<String>,
    pub messages: Vec<AgentRuntimeMessage>,
    pub included_tool_schemas: Vec<RustAgentToolDescriptor>,
    pub deferred_tool_names: Vec<String>,
    pub surfaced_skills: Vec<AgentRuntimeSkillSummary>,
    pub loaded_skill_contents: Vec<String>,
    pub context_summary: AgentRuntimeContextSummary,
}

impl RuntimeModelContext {
    pub fn system_prompt(&self) -> Option<String> {
        let prompt = self
            .system_sections
            .iter()
            .map(|section| section.trim())
            .filter(|section| !section.is_empty())
            .collect::<Vec<_>>()
            .join("\n\n");
        (!prompt.is_empty()).then_some(prompt)
    }
}

#[derive(Clone, Default)]
pub struct AgentRuntimeSendOptions {
    pub model_selection: Option<AgentModelSelection>,
    pub tool_selection: AgentRuntimeToolSelection,
    pub permission_policy: Option<AgentRuntimePermissionPolicy>,
    pub system_prompt: Option<String>,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub enum AgentRuntimeToolSelection {
    #[default]
    Default,
    Disabled,
    AllowList(Vec<String>),
}
