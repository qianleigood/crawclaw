import {
  RUST_CORE_TOOL_DEFINITIONS,
  RUST_NATIVE_TOOL_DEFINITIONS,
  RUST_CORE_TOOL_SECTIONS,
} from "./rust-tool-catalog.js";

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
  lifecycle: ToolLifecycle;
  includeInCrawClawGroup: boolean;
};

const CORE_TOOL_SECTION_ORDER = RUST_CORE_TOOL_SECTIONS.map((section) => ({
  id: section.id,
  label: section.label,
}));

const CORE_TOOL_DEFINITIONS: CoreToolDefinition[] = [
  ...RUST_CORE_TOOL_DEFINITIONS.map((tool) => ({
    id: tool.id,
    label: tool.label,
    description: tool.description,
    sectionId: tool.sectionId,
    profiles: [...tool.defaultProfiles] as ToolProfileId[],
    lifecycle: tool.lifecycle as ToolLifecycle,
    includeInCrawClawGroup: tool.includeInCrawClawGroup,
  })),
  ...RUST_NATIVE_TOOL_DEFINITIONS.map((tool) => ({
    id: tool.id,
    label: tool.label,
    description: tool.description,
    sectionId: tool.sectionId,
    profiles: [...tool.defaultProfiles] as ToolProfileId[],
    lifecycle: tool.lifecycle as ToolLifecycle,
    includeInCrawClawGroup: tool.includeInCrawClawGroup,
  })),
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
  return tool.lifecycle;
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

export function listCoreToolIdsInCatalogOrder(): string[] {
  return CORE_TOOL_DEFINITIONS.map((tool) => tool.id);
}

export function listCoreToolPromptEntries(): Array<{ id: string; description: string }> {
  return CORE_TOOL_DEFINITIONS.map((tool) => ({
    id: tool.id,
    description: tool.description,
  }));
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
