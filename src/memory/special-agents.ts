import { createEmbeddedMemorySpecialAgentDefinition } from "../agents/special/runtime/definition-presets.js";
import type { SpecialAgentDefinition } from "../agents/special/runtime/types.js";
import {
  DREAM_MEMORY_MAINTENANCE_TOOL_ALLOWLIST,
  MEMORY_FILE_MAINTENANCE_TOOL_ALLOWLIST,
} from "./special-agent-toollists.js";

export const DREAM_AGENT_DEFINITION: SpecialAgentDefinition =
  createEmbeddedMemorySpecialAgentDefinition({
    id: "dream",
    label: "dream",
    spawnSource: "dream",
    allowlist: DREAM_MEMORY_MAINTENANCE_TOOL_ALLOWLIST,
    parentContextPolicy: "none",
    modelVisibility: "allowlist",
    guard: "memory_maintenance",
    defaultRunTimeoutSeconds: 120,
  });

export const DURABLE_MEMORY_AGENT_DEFINITION: SpecialAgentDefinition =
  createEmbeddedMemorySpecialAgentDefinition({
    id: "durable_memory",
    label: "durable-memory",
    spawnSource: "durable-memory",
    allowlist: MEMORY_FILE_MAINTENANCE_TOOL_ALLOWLIST,
    parentContextPolicy: "fork_messages_only",
    modelVisibility: "allowlist",
    defaultRunTimeoutSeconds: 90,
    defaultMaxTurns: 5,
  });

export const EXPERIENCE_AGENT_DEFINITION: SpecialAgentDefinition =
  createEmbeddedMemorySpecialAgentDefinition({
    id: "experience",
    label: "experience",
    spawnSource: "experience",
    allowlist: ["write_experience_note"],
    parentContextPolicy: "none",
    modelVisibility: "allowlist",
    defaultRunTimeoutSeconds: 90,
    defaultMaxTurns: 5,
  });

export const SESSION_SUMMARY_AGENT_DEFINITION: SpecialAgentDefinition = {
  ...createEmbeddedMemorySpecialAgentDefinition({
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
};
