import {
  REVIEW_QUALITY_AGENT_DEFINITION,
  REVIEW_SPEC_AGENT_DEFINITION,
} from "../../review-agent.js";
import { createRuntimeMemorySpecialAgentDefinition } from "./definition-presets.js";
import { validateSpecialAgentDefinitionContract, type SpecialAgentDefinition } from "./types.js";

export type RegisteredSpecialAgentContractIssue = {
  id: string;
  spawnSource: string;
  issues: string[];
};

const MEMORY_FILE_MAINTENANCE_TOOL_ALLOWLIST = [
  "memory_manifest_read",
  "memory_note_read",
  "memory_note_write",
  "memory_note_edit",
  "memory_note_delete",
  "sessions_history",
] as const;

const DREAM_MEMORY_MAINTENANCE_TOOL_ALLOWLIST = [
  "memory_manifest_read",
  "memory_note_read",
  "memory_note_write",
  "memory_note_edit",
  "memory_note_delete",
  "session_summary_file_read",
  "sessions_history",
] as const;

const DURABLE_MEMORY_AGENT_DEFINITION = createRuntimeMemorySpecialAgentDefinition({
  id: "durable_memory",
  label: "durable-memory",
  spawnSource: "durable-memory",
  allowlist: MEMORY_FILE_MAINTENANCE_TOOL_ALLOWLIST,
  parentContextPolicy: "fork_messages_only",
  modelVisibility: "allowlist",
  defaultRunTimeoutSeconds: 90,
  defaultMaxTurns: 5,
});

const DREAM_AGENT_DEFINITION = createRuntimeMemorySpecialAgentDefinition({
  id: "dream",
  label: "dream",
  spawnSource: "dream",
  allowlist: DREAM_MEMORY_MAINTENANCE_TOOL_ALLOWLIST,
  parentContextPolicy: "none",
  modelVisibility: "allowlist",
  guard: "memory_maintenance",
  defaultRunTimeoutSeconds: 120,
});

const SESSION_SUMMARY_AGENT_DEFINITION = {
  ...createRuntimeMemorySpecialAgentDefinition({
    id: "session_summary",
    label: "session-summary",
    spawnSource: "session-summary",
    allowlist: ["session_summary_file_read", "session_summary_file_edit"],
    parentContextPolicy: "full_envelope",
    modelVisibility: "allowlist",
    defaultRunTimeoutSeconds: 90,
    defaultMaxTurns: 5,
  }),
  cachePolicy: {
    cacheRetention: "short",
  },
} satisfies SpecialAgentDefinition;

const EXPERIENCE_AGENT_DEFINITION = createRuntimeMemorySpecialAgentDefinition({
  id: "experience",
  label: "experience",
  spawnSource: "experience",
  allowlist: ["write_experience_note"],
  parentContextPolicy: "none",
  modelVisibility: "allowlist",
  defaultRunTimeoutSeconds: 90,
  defaultMaxTurns: 5,
});

function getRegisteredSpecialAgentDefinitions(): readonly SpecialAgentDefinition[] {
  return [
    REVIEW_SPEC_AGENT_DEFINITION,
    REVIEW_QUALITY_AGENT_DEFINITION,
    DURABLE_MEMORY_AGENT_DEFINITION,
    DREAM_AGENT_DEFINITION,
    SESSION_SUMMARY_AGENT_DEFINITION,
    EXPERIENCE_AGENT_DEFINITION,
  ] as const satisfies readonly SpecialAgentDefinition[];
}

export function listRegisteredSpecialAgentDefinitions(): readonly SpecialAgentDefinition[] {
  return getRegisteredSpecialAgentDefinitions();
}

export function listRegisteredSpecialAgentContractIssues(): RegisteredSpecialAgentContractIssue[] {
  return getRegisteredSpecialAgentDefinitions()
    .map((definition) => {
      const issues = validateSpecialAgentDefinitionContract(definition);
      if (issues.length === 0) {
        return null;
      }
      return {
        id: definition.id,
        spawnSource: definition.spawnSource,
        issues,
      } satisfies RegisteredSpecialAgentContractIssue;
    })
    .filter((entry): entry is RegisteredSpecialAgentContractIssue => entry !== null);
}

export function resolveSpecialAgentDefinitionBySpawnSource(
  spawnSource?: string,
): SpecialAgentDefinition | undefined {
  const normalized = spawnSource?.trim();
  if (!normalized) {
    return undefined;
  }
  return getRegisteredSpecialAgentDefinitions().find(
    (definition) => definition.spawnSource === normalized,
  );
}

export function resolveSpecialAgentToolAllowlistBySpawnSource(
  spawnSource?: string,
): readonly string[] | undefined {
  return resolveSpecialAgentDefinitionBySpawnSource(spawnSource)?.toolPolicy?.allowlist;
}
