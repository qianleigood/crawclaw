use super::*;

pub(crate) fn default_agent_definition(profile: &AgentRunProfile) -> AgentDefinition {
    let id = profile
        .special_agent_id
        .clone()
        .unwrap_or_else(|| match profile.kind {
            AgentRunKind::Normal => "main".to_string(),
            AgentRunKind::Btw => "btw".to_string(),
            AgentRunKind::Subagent => "subagent".to_string(),
            AgentRunKind::SpecialAgent => "special-agent".to_string(),
            AgentRunKind::Compaction => "session-summary".to_string(),
            AgentRunKind::MemoryMaintenance => "memory-maintenance".to_string(),
        });
    AgentDefinition {
        label: match profile.kind {
            AgentRunKind::Normal => "Main agent",
            AgentRunKind::Btw => "BTW side question",
            AgentRunKind::Subagent => "Delegated subagent",
            AgentRunKind::SpecialAgent => "Special agent",
            AgentRunKind::Compaction => "Session summary agent",
            AgentRunKind::MemoryMaintenance => "Memory maintenance agent",
        }
        .to_string(),
        prompt_kind: profile.kind.as_summary_str().to_string(),
        execution_mode: format!("{:?}", profile.execution_mode),
        transcript_policy: format!("{:?}", profile.transcript_policy),
        parent_context_policy: profile.parent_context_policy.as_summary_str().to_string(),
        tool_allowlist: match &profile.tool_policy {
            ToolPolicy::AllowList(tools) => tools.clone(),
            ToolPolicy::Default | ToolPolicy::Disabled => Vec::new(),
        },
        mcp_servers: Vec::new(),
        id,
    }
}

pub(crate) fn render_agent_prompt(profile: &AgentRunProfile) -> Option<String> {
    if profile.system_prompt.is_some() {
        return profile.system_prompt.clone();
    }
    match profile.kind {
        AgentRunKind::Normal => Some(normal_agent_prompt()),
        AgentRunKind::Btw => Some(btw_agent_prompt()),
        AgentRunKind::Subagent => Some(subagent_prompt(profile.parent_context_policy)),
        AgentRunKind::SpecialAgent | AgentRunKind::Compaction | AgentRunKind::MemoryMaintenance => {
            None
        }
    }
}

fn normal_agent_prompt() -> String {
    [
        "You are the CrawClaw Rust agent kernel.",
        "Work from the assembled context, visible tools, loaded skills, and memory snippets supplied by the runtime.",
        "Use tools when they materially advance the task; keep tool inputs precise and wait for tool results before relying on them.",
        "If a task is independent and delegated through Agent or subagents_spawn, write a self-contained task with the needed background.",
        "Preserve transcript correctness: never invent tool results, permission decisions, memory writes, or subagent outcomes.",
        "When context has been compacted, treat the compacted summary as authoritative background and the retained tail as the recent transcript.",
    ]
    .join("\n")
}

fn btw_agent_prompt() -> String {
    [
        "You are answering an ephemeral side question.",
        "Use the conversation only as background.",
        "Do not continue the main task, mutate files, or call tools.",
    ]
    .join("\n")
}

fn subagent_prompt(parent_context_policy: ParentContextPolicy) -> String {
    let inheritance = match parent_context_policy {
        ParentContextPolicy::None | ParentContextPolicy::CurrentSession => {
            "The task text is the source of truth; do not assume hidden parent context."
        }
        ParentContextPolicy::ForkMessagesOnly | ParentContextPolicy::FullEnvelope => {
            "Parent context was injected by the runtime; use it as background without rewriting it into the child transcript."
        }
    };
    [
        "You are a CrawClaw delegated sidechain agent.",
        inheritance,
        "Focus on the delegated task and return a concise result that the parent agent can consume.",
        "Do not report completion until the delegated task has been verified or the blocker is explicit.",
    ]
    .join("\n")
}
