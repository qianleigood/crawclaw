#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct UserVisibleAgentDefinition {
    pub id: &'static str,
    pub label: &'static str,
    pub description: &'static str,
    pub prompt: &'static str,
    pub model: &'static str,
    pub permission_mode: &'static str,
    pub background: bool,
    pub parent_context_policy: &'static str,
    pub tool_allowlist: &'static [&'static str],
    pub mcp_servers: &'static [&'static str],
}

const READ_ONLY_TASK_TOOLS: &[&str] = &[
    "read",
    "grep",
    "find",
    "ls",
    "web_search",
    "web_fetch",
    "ListMcpResourcesTool",
    "ReadMcpResourceTool",
    "mcp__*",
];

const GENERAL_PURPOSE_PROMPT: &str = "You are the general-purpose CrawClaw subagent. Handle multi-step delegated work independently, use the available tools when they materially advance the task, and return a concise result that the parent agent can consume.";

const EXPLORE_PROMPT: &str = "You are the Explore agent. Inspect code, docs, configuration, transcripts, and tool-visible context to answer the delegated research question. Do not modify files, run mutating commands, create agents, or request plan exit. Return findings with concrete evidence and call out uncertainty.";

const PLAN_PROMPT: &str = "You are the Plan agent. Produce a concrete implementation plan from the delegated task and available evidence. Do not modify files, run mutating commands, create agents, or request plan exit. Prefer short ordered steps with clear verification gates.";

const VERIFICATION_PROMPT: &str = "You are the verification agent. Independently verify whether the delegated work is complete. Do not modify files, run mutating commands, create agents, or request plan exit. Check evidence first, then finish with exactly one verdict line: VERDICT: PASS, VERDICT: FAIL, or VERDICT: BLOCKED.";

const USER_VISIBLE_AGENT_DEFINITIONS: &[UserVisibleAgentDefinition] = &[
    UserVisibleAgentDefinition {
        id: "general-purpose",
        label: "General purpose",
        description: "General multi-step delegated task agent.",
        prompt: GENERAL_PURPOSE_PROMPT,
        model: "inherit",
        permission_mode: "workspace",
        background: false,
        parent_context_policy: "none",
        tool_allowlist: &[],
        mcp_servers: &[],
    },
    UserVisibleAgentDefinition {
        id: "Explore",
        label: "Explore",
        description: "Read-only exploration agent for code and context research.",
        prompt: EXPLORE_PROMPT,
        model: "inherit",
        permission_mode: "readOnly",
        background: false,
        parent_context_policy: "none",
        tool_allowlist: READ_ONLY_TASK_TOOLS,
        mcp_servers: &[],
    },
    UserVisibleAgentDefinition {
        id: "Plan",
        label: "Plan",
        description: "Read-only planning agent for implementation plans.",
        prompt: PLAN_PROMPT,
        model: "inherit",
        permission_mode: "readOnly",
        background: false,
        parent_context_policy: "none",
        tool_allowlist: READ_ONLY_TASK_TOOLS,
        mcp_servers: &[],
    },
    UserVisibleAgentDefinition {
        id: "verification",
        label: "Verification",
        description: "Read-only verification agent for completed work.",
        prompt: VERIFICATION_PROMPT,
        model: "inherit",
        permission_mode: "readOnly",
        background: true,
        parent_context_policy: "none",
        tool_allowlist: READ_ONLY_TASK_TOOLS,
        mcp_servers: &[],
    },
];

pub fn user_visible_agent_definitions() -> &'static [UserVisibleAgentDefinition] {
    USER_VISIBLE_AGENT_DEFINITIONS
}

pub fn find_user_visible_agent_definition(
    selector: &str,
) -> Option<&'static UserVisibleAgentDefinition> {
    let selector = selector.trim();
    if selector.is_empty() {
        return None;
    }
    let normalized = selector
        .chars()
        .filter(|ch| *ch != '-' && *ch != '_' && !ch.is_whitespace())
        .flat_map(char::to_lowercase)
        .collect::<String>();
    USER_VISIBLE_AGENT_DEFINITIONS.iter().find(|definition| {
        definition.id.eq_ignore_ascii_case(selector)
            || definition.label.eq_ignore_ascii_case(selector)
            || definition
                .id
                .chars()
                .filter(|ch| *ch != '-' && *ch != '_' && !ch.is_whitespace())
                .flat_map(char::to_lowercase)
                .collect::<String>()
                == normalized
    })
}
