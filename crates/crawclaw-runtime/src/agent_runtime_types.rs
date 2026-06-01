use super::*;

#[derive(Clone)]
pub struct AgentRuntime {
    pub(super) runtime_root: PathBuf,
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
    pub timeout_seconds: u64,
    pub max_tool_iterations: usize,
    pub tool_selection: AgentRuntimeToolSelection,
    pub permission_policy: Option<AgentRuntimePermissionPolicy>,
    pub tool_hook_policy: Option<AgentRuntimeToolHookPolicy>,
    pub system_prompt: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentDefinition {
    pub id: String,
    pub label: String,
    pub prompt_kind: String,
    pub execution_mode: String,
    pub transcript_policy: String,
    pub parent_context_policy: String,
    pub tool_allowlist: Vec<String>,
    pub mcp_servers: Vec<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum AgentLoopEvent {
    ContextProjected {
        projection: ContextProjection,
    },
    ProviderBlock {
        block_type: String,
        text: Option<String>,
        metadata: Value,
    },
    ToolExecution {
        event: ToolExecutionEvent,
    },
    Hook {
        event: HookEvent,
    },
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum ToolExecutionEvent {
    Started {
        call_id: String,
        tool_name: String,
        arguments: Value,
    },
    PermissionRequested {
        request_id: String,
        tool_name: String,
        reason: String,
    },
    Progress {
        call_id: String,
        tool_name: String,
        status: String,
        message: Option<String>,
    },
    Completed {
        call_id: String,
        tool_name: String,
        output: Option<String>,
        is_error: bool,
    },
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HookEvent {
    pub hook: String,
    pub decision: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextProjection {
    pub profile_kind: String,
    pub parent_context_policy: String,
    pub history_message_count: usize,
    pub parent_message_count: usize,
    pub projected_history_message_count: usize,
    pub projected_message_count: usize,
    pub retained_tail_message_count: usize,
    pub compaction_active: bool,
    pub collapse_state: String,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextBudgetReport {
    pub estimated_tokens: usize,
    pub max_prompt_tokens: usize,
    pub state: String,
    pub overflow_retry_enabled: bool,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SidechainTranscript {
    pub parent_session_key: String,
    pub child_session_key: String,
    pub lifecycle: String,
    pub message_count: usize,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpToolDescriptor {
    pub server: String,
    pub name: String,
    pub description: String,
    pub read_only: bool,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolActivationState {
    pub activated_tools: Vec<String>,
    pub scope: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct AgentRunProfile {
    pub(crate) kind: AgentRunKind,
    pub(crate) execution_mode: AgentExecutionMode,
    pub(crate) transcript_policy: TranscriptPolicy,
    pub(crate) parent_context_policy: ParentContextPolicy,
    pub(crate) parent_session_key: Option<String>,
    pub(crate) tool_policy: ToolPolicy,
    pub(crate) skill_policy: SkillPolicy,
    pub(crate) memory_policy: MemoryPolicy,
    pub(crate) compaction_policy: CompactionPolicy,
    pub(crate) limits: AgentRunLimits,
    pub(crate) result_policy: AgentResultPolicy,
    pub(crate) special_agent_id: Option<String>,
    pub(crate) system_prompt: Option<String>,
    pub(crate) warnings: Vec<String>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum AgentRunKind {
    Normal,
    Btw,
    Subagent,
    SpecialAgent,
    Compaction,
    MemoryMaintenance,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum AgentExecutionMode {
    ThreadBound,
    Ephemeral,
    SpawnedSession,
    EmbeddedFork,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum TranscriptPolicy {
    ThreadBound,
    Isolated,
    None,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum ParentContextPolicy {
    CurrentSession,
    None,
    ForkMessagesOnly,
    FullEnvelope,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum ToolPolicy {
    Default,
    Disabled,
    AllowList(Vec<String>),
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum SkillPolicy {
    Default,
    Disabled,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct MemoryPolicy {
    pub(crate) recall: bool,
    pub(crate) after_turn: bool,
    pub(crate) maintenance_write: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum CompactionPolicy {
    Disabled,
    SummaryPlusTail,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct AgentRunLimits {
    pub(crate) timeout_seconds: u64,
    pub(crate) max_turns: u32,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum AgentResultPolicy {
    Reply,
    PersistSpecialAgent,
    PersistCompaction,
}

impl AgentRunKind {
    pub(crate) fn as_summary_str(self) -> &'static str {
        match self {
            Self::Normal => "normal",
            Self::Btw => "btw",
            Self::Subagent => "subagent",
            Self::SpecialAgent => "special_agent",
            Self::Compaction => "compaction",
            Self::MemoryMaintenance => "memory_maintenance",
        }
    }
}

impl ParentContextPolicy {
    pub(crate) fn as_summary_str(self) -> &'static str {
        match self {
            Self::CurrentSession => "current_session",
            Self::None => "none",
            Self::ForkMessagesOnly => "fork_messages_only",
            Self::FullEnvelope => "full_envelope",
        }
    }
}

impl Default for AgentRunProfile {
    fn default() -> Self {
        Self {
            kind: AgentRunKind::Normal,
            execution_mode: AgentExecutionMode::ThreadBound,
            transcript_policy: TranscriptPolicy::ThreadBound,
            parent_context_policy: ParentContextPolicy::CurrentSession,
            parent_session_key: None,
            tool_policy: ToolPolicy::Default,
            skill_policy: SkillPolicy::Default,
            memory_policy: MemoryPolicy {
                recall: true,
                after_turn: true,
                maintenance_write: false,
            },
            compaction_policy: CompactionPolicy::Disabled,
            limits: AgentRunLimits {
                timeout_seconds: 0,
                max_turns: 0,
            },
            result_policy: AgentResultPolicy::Reply,
            special_agent_id: None,
            system_prompt: None,
            warnings: Vec::new(),
        }
    }
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
    pub profile_kind: String,
    pub parent_context_policy: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub agent_definition: Option<String>,
    pub projection: ContextProjection,
    pub budget: ContextBudgetReport,
    pub included_tools: Vec<String>,
    pub deferred_tools: Vec<String>,
    pub activated_tools: Vec<String>,
    pub surfaced_skills: Vec<AgentRuntimeSkillSummary>,
    pub loaded_skills: Vec<String>,
    pub memory_snippets: Vec<String>,
    pub compaction: AgentRuntimeCompactionSummary,
    pub warnings: Vec<String>,
    pub message_count: usize,
    pub estimated_tokens: usize,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentRuntimeCompactionSummary {
    pub active: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub compacted_through: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub first_kept_message_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tail_start_message_id: Option<String>,
    pub retained_message_count: usize,
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
    pub tool_hook_policy: Option<AgentRuntimeToolHookPolicy>,
    pub system_prompt: Option<String>,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub enum AgentRuntimeToolSelection {
    #[default]
    Default,
    Disabled,
    AllowList(Vec<String>),
}
