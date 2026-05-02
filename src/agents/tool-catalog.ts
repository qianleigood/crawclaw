export type ToolProfileId = "minimal" | "coding" | "messaging" | "full";

export type ToolLifecycle =
  | "profile_default"
  | "runtime_conditional"
  | "special_agent_only"
  | "owner_restricted";

type ToolProfilePolicy = {
  allow?: string[];
  deny?: string[];
};

export type CoreToolSection = {
  id: string;
  label: string;
  tools: Array<{
    id: string;
    label: string;
    description: string;
  }>;
};

type CoreToolDefinition = {
  id: string;
  label: string;
  description: string;
  sectionId: string;
  profiles: ToolProfileId[];
  lifecycle?: ToolLifecycle;
  includeInCrawClawGroup?: boolean;
};

const CORE_TOOL_SECTION_ORDER: Array<{ id: string; label: string }> = [
  { id: "fs", label: "Files" },
  { id: "runtime", label: "Runtime" },
  { id: "web", label: "Web" },
  { id: "sessions", label: "Sessions" },
  { id: "ui", label: "UI" },
  { id: "messaging", label: "Messaging" },
  { id: "automation", label: "Automation" },
  { id: "nodes", label: "Nodes" },
  { id: "agents", label: "Agents" },
  { id: "skills", label: "Skills" },
  { id: "workflow", label: "Workflow" },
  { id: "review", label: "Review" },
  { id: "memory", label: "Memory" },
  { id: "session_summary", label: "Session Summary" },
  { id: "improvement", label: "Improvement" },
  { id: "media", label: "Media" },
];

const CORE_TOOL_DEFINITIONS: CoreToolDefinition[] = [
  {
    id: "read",
    label: "read",
    description: "Read file contents",
    sectionId: "fs",
    profiles: ["coding"],
  },
  {
    id: "write",
    label: "write",
    description: "Create or overwrite files",
    sectionId: "fs",
    profiles: ["coding"],
  },
  {
    id: "edit",
    label: "edit",
    description: "Make precise edits",
    sectionId: "fs",
    profiles: ["coding"],
  },
  {
    id: "apply_patch",
    label: "apply_patch",
    description: "Patch files",
    sectionId: "fs",
    profiles: ["coding"],
  },
  {
    id: "exec",
    label: "exec",
    description: "Run shell commands",
    sectionId: "runtime",
    profiles: ["coding"],
  },
  {
    id: "process",
    label: "process",
    description: "Manage background processes",
    sectionId: "runtime",
    profiles: ["coding"],
  },
  {
    id: "code_execution",
    label: "code_execution",
    description: "Run sandboxed remote analysis",
    sectionId: "runtime",
    profiles: ["coding"],
    includeInCrawClawGroup: true,
  },
  {
    id: "web_search",
    label: "web_search",
    description: "Search the web",
    sectionId: "web",
    profiles: ["coding"],
    includeInCrawClawGroup: true,
  },
  {
    id: "web_fetch",
    label: "web_fetch",
    description: "Fetch web content",
    sectionId: "web",
    profiles: ["coding"],
    includeInCrawClawGroup: true,
  },
  {
    id: "x_search",
    label: "x_search",
    description: "Search X posts",
    sectionId: "web",
    profiles: ["coding"],
    includeInCrawClawGroup: true,
  },
  {
    id: "sessions_list",
    label: "sessions_list",
    description: "List sessions",
    sectionId: "sessions",
    profiles: ["coding", "messaging"],
    includeInCrawClawGroup: true,
  },
  {
    id: "sessions_history",
    label: "sessions_history",
    description: "Session history",
    sectionId: "sessions",
    profiles: ["coding", "messaging"],
    includeInCrawClawGroup: true,
  },
  {
    id: "sessions_send",
    label: "sessions_send",
    description: "Send to session",
    sectionId: "sessions",
    profiles: ["coding", "messaging"],
    includeInCrawClawGroup: true,
  },
  {
    id: "sessions_spawn",
    label: "sessions_spawn",
    description: "Spawn sub-agent",
    sectionId: "sessions",
    profiles: ["coding"],
    includeInCrawClawGroup: true,
  },
  {
    id: "sessions_yield",
    label: "sessions_yield",
    description: "End turn to receive sub-agent results",
    sectionId: "sessions",
    profiles: ["coding"],
    includeInCrawClawGroup: true,
  },
  {
    id: "subagents",
    label: "subagents",
    description: "Manage sub-agents",
    sectionId: "sessions",
    profiles: ["coding"],
    includeInCrawClawGroup: true,
  },
  {
    id: "session_status",
    label: "session_status",
    description: "Session status",
    sectionId: "sessions",
    profiles: ["minimal", "coding", "messaging"],
    includeInCrawClawGroup: true,
  },
  {
    id: "browser",
    label: "browser",
    description: "Control web browser",
    sectionId: "ui",
    profiles: ["coding"],
    lifecycle: "runtime_conditional",
    includeInCrawClawGroup: true,
  },
  {
    id: "canvas",
    label: "canvas",
    description: "Control canvases",
    sectionId: "ui",
    profiles: [],
    includeInCrawClawGroup: true,
  },
  {
    id: "message",
    label: "message",
    description: "Send messages",
    sectionId: "messaging",
    profiles: ["messaging"],
    includeInCrawClawGroup: true,
  },
  {
    id: "cron",
    label: "cron",
    description: "Schedule tasks",
    sectionId: "automation",
    profiles: ["coding"],
    lifecycle: "owner_restricted",
    includeInCrawClawGroup: true,
  },
  {
    id: "gateway",
    label: "gateway",
    description: "Gateway control",
    sectionId: "automation",
    profiles: [],
    lifecycle: "owner_restricted",
    includeInCrawClawGroup: true,
  },
  {
    id: "nodes",
    label: "nodes",
    description: "Nodes + devices",
    sectionId: "nodes",
    profiles: [],
    lifecycle: "owner_restricted",
    includeInCrawClawGroup: true,
  },
  {
    id: "agents_list",
    label: "agents_list",
    description: "List agents",
    sectionId: "agents",
    profiles: [],
    includeInCrawClawGroup: true,
  },
  {
    id: "image",
    label: "image",
    description: "Image understanding",
    sectionId: "media",
    profiles: ["coding"],
    includeInCrawClawGroup: true,
  },
  {
    id: "pdf",
    label: "pdf",
    description: "PDF analysis",
    sectionId: "media",
    profiles: ["coding"],
    includeInCrawClawGroup: true,
  },
  {
    id: "tts",
    label: "tts",
    description: "Text-to-speech conversion",
    sectionId: "media",
    profiles: [],
    includeInCrawClawGroup: true,
  },
  {
    id: "discover_skills",
    label: "discover_skills",
    description: "Search available skills",
    sectionId: "skills",
    profiles: ["coding"],
    includeInCrawClawGroup: true,
  },
  {
    id: "workflow",
    label: "workflow",
    description: "Manage and run workflows",
    sectionId: "workflow",
    profiles: ["coding"],
    includeInCrawClawGroup: true,
  },
  {
    id: "workflowize",
    label: "workflowize",
    description: "Create workflow drafts",
    sectionId: "workflow",
    profiles: ["coding"],
    includeInCrawClawGroup: true,
  },
  {
    id: "review_task",
    label: "review_task",
    description: "Review task completion",
    sectionId: "review",
    profiles: ["coding"],
    includeInCrawClawGroup: true,
  },
  {
    id: "write_experience_note",
    label: "write_experience_note",
    description: "Write reusable experience notes",
    sectionId: "memory",
    profiles: ["coding"],
    includeInCrawClawGroup: true,
  },
  {
    id: "memory_manifest_read",
    label: "memory_manifest_read",
    description: "Read scoped durable-memory manifest",
    sectionId: "memory",
    profiles: ["coding"],
  },
  {
    id: "memory_note_read",
    label: "memory_note_read",
    description: "Read scoped durable-memory notes",
    sectionId: "memory",
    profiles: ["coding"],
  },
  {
    id: "memory_note_write",
    label: "memory_note_write",
    description: "Write scoped durable-memory notes",
    sectionId: "memory",
    profiles: ["coding"],
  },
  {
    id: "memory_note_edit",
    label: "memory_note_edit",
    description: "Edit scoped durable-memory notes",
    sectionId: "memory",
    profiles: ["coding"],
  },
  {
    id: "memory_note_delete",
    label: "memory_note_delete",
    description: "Delete scoped durable-memory notes",
    sectionId: "memory",
    profiles: ["coding"],
  },
  {
    id: "session_summary_file_read",
    label: "session_summary_file_read",
    description: "Read session-summary files",
    sectionId: "session_summary",
    profiles: [],
    lifecycle: "special_agent_only",
  },
  {
    id: "session_summary_file_edit",
    label: "session_summary_file_edit",
    description: "Edit session-summary files",
    sectionId: "session_summary",
    profiles: [],
    lifecycle: "special_agent_only",
  },
  {
    id: "submit_promotion_verdict",
    label: "submit_promotion_verdict",
    description: "Submit promotion judge verdicts",
    sectionId: "improvement",
    profiles: [],
    lifecycle: "special_agent_only",
  },
];

const CORE_TOOL_BY_ID = new Map<string, CoreToolDefinition>(
  CORE_TOOL_DEFINITIONS.map((tool) => [tool.id, tool]),
);

function listCoreToolIdsForProfile(profile: ToolProfileId): string[] {
  return CORE_TOOL_DEFINITIONS.filter((tool) => tool.profiles.includes(profile)).map(
    (tool) => tool.id,
  );
}

function resolveToolLifecycle(tool: CoreToolDefinition): ToolLifecycle {
  return tool.lifecycle ?? "profile_default";
}

const CORE_TOOL_PROFILES: Record<ToolProfileId, ToolProfilePolicy> = {
  minimal: {
    allow: listCoreToolIdsForProfile("minimal"),
  },
  coding: {
    allow: listCoreToolIdsForProfile("coding"),
  },
  messaging: {
    allow: listCoreToolIdsForProfile("messaging"),
  },
  full: {},
};

function buildCoreToolGroupMap(): Record<string, string[]> {
  const sectionToolMap = new Map<string, string[]>();
  for (const tool of CORE_TOOL_DEFINITIONS) {
    const groupId = `group:${tool.sectionId}`;
    const list = sectionToolMap.get(groupId) ?? [];
    list.push(tool.id);
    sectionToolMap.set(groupId, list);
  }
  const crawclawTools = CORE_TOOL_DEFINITIONS.filter((tool) => tool.includeInCrawClawGroup).map(
    (tool) => tool.id,
  );
  return {
    "group:crawclaw": crawclawTools,
    ...Object.fromEntries(sectionToolMap.entries()),
  };
}

export const CORE_TOOL_GROUPS = buildCoreToolGroupMap();

export const PROFILE_OPTIONS = [
  { id: "minimal", label: "Minimal" },
  { id: "coding", label: "Coding" },
  { id: "messaging", label: "Messaging" },
  { id: "full", label: "Full" },
] as const;

export function resolveCoreToolProfilePolicy(profile?: string): ToolProfilePolicy | undefined {
  if (!profile) {
    return undefined;
  }
  const resolved = CORE_TOOL_PROFILES[profile as ToolProfileId];
  if (!resolved) {
    return undefined;
  }
  if (!resolved.allow && !resolved.deny) {
    return undefined;
  }
  return {
    allow: resolved.allow ? [...resolved.allow] : undefined,
    deny: resolved.deny ? [...resolved.deny] : undefined,
  };
}

export function listCoreToolSections(): CoreToolSection[] {
  return CORE_TOOL_SECTION_ORDER.map((section) => ({
    id: section.id,
    label: section.label,
    tools: CORE_TOOL_DEFINITIONS.filter((tool) => tool.sectionId === section.id).map((tool) => ({
      id: tool.id,
      label: tool.label,
      description: tool.description,
    })),
  })).filter((section) => section.tools.length > 0);
}

export function resolveCoreToolProfiles(toolId: string): ToolProfileId[] {
  const tool = CORE_TOOL_BY_ID.get(toolId);
  if (!tool) {
    return [];
  }
  return [...tool.profiles];
}

export function resolveCoreToolLifecycle(toolId: string): ToolLifecycle | undefined {
  const tool = CORE_TOOL_BY_ID.get(toolId);
  return tool ? resolveToolLifecycle(tool) : undefined;
}

export function listCoreToolIdsByLifecycle(lifecycle: ToolLifecycle): string[] {
  return CORE_TOOL_DEFINITIONS.filter((tool) => resolveToolLifecycle(tool) === lifecycle).map(
    (tool) => tool.id,
  );
}

export function isKnownCoreToolId(toolId: string): boolean {
  return CORE_TOOL_BY_ID.has(toolId);
}
