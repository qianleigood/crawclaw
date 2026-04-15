import {
  DREAM_AGENT_DEFINITION,
  MEMORY_EXTRACTION_AGENT_DEFINITION,
  SESSION_SUMMARY_AGENT_DEFINITION,
} from "../../../memory/special-agents.js";
import { VERIFICATION_AGENT_DEFINITION } from "../../verification-agent.js";
import type { SpecialAgentDefinition } from "./types.js";

function buildRegisteredSpecialAgentDefinitions(): readonly SpecialAgentDefinition[] {
  return [
    VERIFICATION_AGENT_DEFINITION,
    MEMORY_EXTRACTION_AGENT_DEFINITION,
    DREAM_AGENT_DEFINITION,
    SESSION_SUMMARY_AGENT_DEFINITION,
  ] as const satisfies readonly SpecialAgentDefinition[];
}

export function listRegisteredSpecialAgentDefinitions(): readonly SpecialAgentDefinition[] {
  return buildRegisteredSpecialAgentDefinitions();
}

export function resolveSpecialAgentDefinitionBySpawnSource(
  spawnSource?: string,
): SpecialAgentDefinition | undefined {
  const normalized = spawnSource?.trim();
  if (!normalized) {
    return undefined;
  }
  return buildRegisteredSpecialAgentDefinitions().find(
    (definition) => definition.spawnSource === normalized,
  );
}

export function resolveSpecialAgentToolAllowlistBySpawnSource(
  spawnSource?: string,
): readonly string[] | undefined {
  return resolveSpecialAgentDefinitionBySpawnSource(spawnSource)?.toolPolicy?.allowlist;
}
