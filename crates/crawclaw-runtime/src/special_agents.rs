use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SpecialAgentExecutionMode {
    SpawnedSession,
    EmbeddedFork,
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SpecialAgentTranscriptPolicy {
    Isolated,
    ThreadBound,
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SpecialAgentParentContextPolicy {
    None,
    ForkMessagesOnly,
    FullEnvelope,
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SpecialAgentToolGuard {
    MemoryMaintenance,
}

#[derive(Clone, Copy, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SpecialAgentOutputContract {
    Findings,
    SessionSummary,
    MemoryReport,
}

#[derive(Clone, Copy, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SpecialAgentMemoryInputContract {
    None,
    MemoryDelta,
    ManualMaintenance,
    SessionSummary,
}

#[derive(Clone, Copy, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SpecialAgentMemoryLayerPolicy {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub default_layer: Option<&'static str>,
    pub allowed_layers: &'static [&'static str],
}

#[derive(Clone, Copy, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SpecialAgentPersistenceHandler {
    ChildTranscript,
    SessionSummary,
    HindsightMemory,
    HindsightDream,
    HindsightExperience,
}

#[derive(Clone, Copy, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SpecialAgentDefinition {
    pub id: &'static str,
    pub label: &'static str,
    pub spawn_source: &'static str,
    pub execution_mode: SpecialAgentExecutionMode,
    pub transcript_policy: SpecialAgentTranscriptPolicy,
    pub parent_context_policy: SpecialAgentParentContextPolicy,
    pub tool_allowlist: &'static [&'static str],
    #[serde(skip_serializing_if = "Option::is_none")]
    pub guard: Option<SpecialAgentToolGuard>,
    pub timeout_seconds: u64,
    pub max_turns: u32,
    pub prompt_id: &'static str,
    pub output_contract: SpecialAgentOutputContract,
    pub persistence_handler: SpecialAgentPersistenceHandler,
    pub input_contract: SpecialAgentMemoryInputContract,
    pub memory_layer_policy: SpecialAgentMemoryLayerPolicy,
}

pub const REVIEW_AGENT_TOOL_ALLOWLIST: &[&str] = &[
    "read",
    "grep",
    "find",
    "ls",
    "bash",
    "process",
    "session_status",
    "sessions_list",
    "sessions_history",
];

pub const KNOWLEDGE_MAINTENANCE_TOOL_ALLOWLIST: &[&str] =
    &["knowledge_recall", "knowledge_ingest", "sessions_history"];

pub const DREAM_TOOL_ALLOWLIST: &[&str] = &[
    "knowledge_recall",
    "knowledge_reflect",
    "knowledge_ingest",
    "knowledge_model_create",
    "knowledge_model_list",
    "session_summary_file_read",
    "sessions_history",
];

pub const SESSION_SUMMARY_TOOL_ALLOWLIST: &[&str] = &[
    "session_summary_file_read",
    "session_summary_file_edit",
    "sessions_history",
];

pub const EXPERIENCE_TOOL_ALLOWLIST: &[&str] = &["knowledge_ingest", "sessions_history"];

const SPECIAL_AGENT_DEFINITIONS: &[SpecialAgentDefinition] = &[
    SpecialAgentDefinition {
        id: "review-spec",
        label: "Review spec",
        spawn_source: "review-spec",
        execution_mode: SpecialAgentExecutionMode::SpawnedSession,
        transcript_policy: SpecialAgentTranscriptPolicy::Isolated,
        parent_context_policy: SpecialAgentParentContextPolicy::ForkMessagesOnly,
        tool_allowlist: REVIEW_AGENT_TOOL_ALLOWLIST,
        guard: None,
        timeout_seconds: 300,
        max_turns: 8,
        prompt_id: "review-spec",
        output_contract: SpecialAgentOutputContract::Findings,
        persistence_handler: SpecialAgentPersistenceHandler::ChildTranscript,
        input_contract: SpecialAgentMemoryInputContract::None,
        memory_layer_policy: SpecialAgentMemoryLayerPolicy {
            default_layer: None,
            allowed_layers: &[],
        },
    },
    SpecialAgentDefinition {
        id: "review-quality",
        label: "Review quality",
        spawn_source: "review-quality",
        execution_mode: SpecialAgentExecutionMode::SpawnedSession,
        transcript_policy: SpecialAgentTranscriptPolicy::Isolated,
        parent_context_policy: SpecialAgentParentContextPolicy::ForkMessagesOnly,
        tool_allowlist: REVIEW_AGENT_TOOL_ALLOWLIST,
        guard: None,
        timeout_seconds: 300,
        max_turns: 8,
        prompt_id: "review-quality",
        output_contract: SpecialAgentOutputContract::Findings,
        persistence_handler: SpecialAgentPersistenceHandler::ChildTranscript,
        input_contract: SpecialAgentMemoryInputContract::None,
        memory_layer_policy: SpecialAgentMemoryLayerPolicy {
            default_layer: None,
            allowed_layers: &[],
        },
    },
    SpecialAgentDefinition {
        id: "durable-memory",
        label: "Durable memory",
        spawn_source: "durable-memory",
        execution_mode: SpecialAgentExecutionMode::EmbeddedFork,
        transcript_policy: SpecialAgentTranscriptPolicy::ThreadBound,
        parent_context_policy: SpecialAgentParentContextPolicy::None,
        tool_allowlist: KNOWLEDGE_MAINTENANCE_TOOL_ALLOWLIST,
        guard: Some(SpecialAgentToolGuard::MemoryMaintenance),
        timeout_seconds: 90,
        max_turns: 5,
        prompt_id: "durable-memory",
        output_contract: SpecialAgentOutputContract::MemoryReport,
        persistence_handler: SpecialAgentPersistenceHandler::HindsightMemory,
        input_contract: SpecialAgentMemoryInputContract::MemoryDelta,
        memory_layer_policy: SpecialAgentMemoryLayerPolicy {
            default_layer: Some("durable"),
            allowed_layers: &["durable"],
        },
    },
    SpecialAgentDefinition {
        id: "dream",
        label: "Dream",
        spawn_source: "dream",
        execution_mode: SpecialAgentExecutionMode::EmbeddedFork,
        transcript_policy: SpecialAgentTranscriptPolicy::ThreadBound,
        parent_context_policy: SpecialAgentParentContextPolicy::None,
        tool_allowlist: DREAM_TOOL_ALLOWLIST,
        guard: Some(SpecialAgentToolGuard::MemoryMaintenance),
        timeout_seconds: 120,
        max_turns: 5,
        prompt_id: "dream",
        output_contract: SpecialAgentOutputContract::MemoryReport,
        persistence_handler: SpecialAgentPersistenceHandler::HindsightDream,
        input_contract: SpecialAgentMemoryInputContract::ManualMaintenance,
        memory_layer_policy: SpecialAgentMemoryLayerPolicy {
            default_layer: Some("mental-models"),
            allowed_layers: &["mental-models"],
        },
    },
    SpecialAgentDefinition {
        id: "session-summary",
        label: "Session summary",
        spawn_source: "session-summary",
        execution_mode: SpecialAgentExecutionMode::EmbeddedFork,
        transcript_policy: SpecialAgentTranscriptPolicy::ThreadBound,
        parent_context_policy: SpecialAgentParentContextPolicy::FullEnvelope,
        tool_allowlist: SESSION_SUMMARY_TOOL_ALLOWLIST,
        guard: Some(SpecialAgentToolGuard::MemoryMaintenance),
        timeout_seconds: 90,
        max_turns: 5,
        prompt_id: "session-summary",
        output_contract: SpecialAgentOutputContract::SessionSummary,
        persistence_handler: SpecialAgentPersistenceHandler::SessionSummary,
        input_contract: SpecialAgentMemoryInputContract::SessionSummary,
        memory_layer_policy: SpecialAgentMemoryLayerPolicy {
            default_layer: None,
            allowed_layers: &[],
        },
    },
    SpecialAgentDefinition {
        id: "experience",
        label: "Experience",
        spawn_source: "experience",
        execution_mode: SpecialAgentExecutionMode::EmbeddedFork,
        transcript_policy: SpecialAgentTranscriptPolicy::ThreadBound,
        parent_context_policy: SpecialAgentParentContextPolicy::None,
        tool_allowlist: EXPERIENCE_TOOL_ALLOWLIST,
        guard: Some(SpecialAgentToolGuard::MemoryMaintenance),
        timeout_seconds: 90,
        max_turns: 5,
        prompt_id: "experience",
        output_contract: SpecialAgentOutputContract::MemoryReport,
        persistence_handler: SpecialAgentPersistenceHandler::HindsightExperience,
        input_contract: SpecialAgentMemoryInputContract::ManualMaintenance,
        memory_layer_policy: SpecialAgentMemoryLayerPolicy {
            default_layer: Some("experience"),
            allowed_layers: &["experience"],
        },
    },
];

pub fn special_agent_definitions() -> &'static [SpecialAgentDefinition] {
    SPECIAL_AGENT_DEFINITIONS
}

pub fn find_special_agent(id_or_spawn_source: &str) -> Option<&'static SpecialAgentDefinition> {
    let normalized = id_or_spawn_source.trim().replace('_', "-");
    SPECIAL_AGENT_DEFINITIONS
        .iter()
        .find(|definition| definition.id == normalized || definition.spawn_source == normalized)
}

pub fn render_special_agent_prompt(definition: &SpecialAgentDefinition) -> String {
    match definition.prompt_id {
        "session-summary" => "Session summary special agent. Summarize older transcript context into a concise durable summary, preserve unresolved user intent, current task state, decisions, and next actions. Use only the allowed session-summary tools when persistence is needed.".to_string(),
        "durable-memory" => "Durable memory special agent. Extract durable project facts and user preferences from the provided context. Use only memory maintenance tools and report what changed.".to_string(),
        "dream" => "Dream special agent. Consolidate durable memory and session summaries into useful long-lived notes without requiring parent context.".to_string(),
        "experience" => "Experience special agent. Extract reusable engineering lessons and write a concise experience note when one is justified.".to_string(),
        "review-spec" => "Review spec special agent. Review the supplied design or plan against the requested requirements. Return findings first, ordered by severity, and avoid implementation changes.".to_string(),
        "review-quality" => "Review quality special agent. Review the supplied implementation for correctness, regressions, missing tests, and scope creep. Return findings first, ordered by severity.".to_string(),
        _ => format!("{} special agent. Follow the configured special-agent policy and allowed tools.", definition.label),
    }
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpecialAgentRunRequest {
    pub kind: Option<String>,
    pub spawn_source: Option<String>,
    pub task: Option<String>,
    pub scope: Option<String>,
    pub parent_session_key: Option<String>,
    pub context_package: Option<serde_json::Value>,
}
