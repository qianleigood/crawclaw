import {
  DREAM_AGENT_DEFINITION,
  MEMORY_EXTRACTION_AGENT_DEFINITION,
  SESSION_SUMMARY_AGENT_DEFINITION,
} from "../../../memory/special-agents.js";
import { VERIFICATION_AGENT_DEFINITION } from "../../verification-agent.js";
import { validateSpecialAgentDefinitionContract, type SpecialAgentDefinition } from "./types.js";

export type RegisteredSpecialAgentContractIssue = {
  id: string;
  spawnSource: string;
  issues: string[];
};

const REGISTERED_SPECIAL_AGENT_DEFINITIONS = [
  VERIFICATION_AGENT_DEFINITION,
  MEMORY_EXTRACTION_AGENT_DEFINITION,
  DREAM_AGENT_DEFINITION,
  SESSION_SUMMARY_AGENT_DEFINITION,
] as const satisfies readonly SpecialAgentDefinition[];

export function listRegisteredSpecialAgentDefinitions(): readonly SpecialAgentDefinition[] {
  return REGISTERED_SPECIAL_AGENT_DEFINITIONS;
}

export function listRegisteredSpecialAgentContractIssues(): RegisteredSpecialAgentContractIssue[] {
  return REGISTERED_SPECIAL_AGENT_DEFINITIONS.map((definition) => {
    const issues = validateSpecialAgentDefinitionContract(definition);
    if (issues.length === 0) {
      return null;
    }
    return {
      id: definition.id,
      spawnSource: definition.spawnSource,
      issues,
    } satisfies RegisteredSpecialAgentContractIssue;
  }).filter((entry): entry is RegisteredSpecialAgentContractIssue => entry !== null);
}

export function resolveSpecialAgentDefinitionBySpawnSource(
  spawnSource?: string,
): SpecialAgentDefinition | undefined {
  const normalized = spawnSource?.trim();
  if (!normalized) {
    return undefined;
  }
  return REGISTERED_SPECIAL_AGENT_DEFINITIONS.find(
    (definition) => definition.spawnSource === normalized,
  );
}

export function resolveSpecialAgentToolAllowlistBySpawnSource(
  spawnSource?: string,
): readonly string[] | undefined {
  return resolveSpecialAgentDefinitionBySpawnSource(spawnSource)?.toolPolicy?.allowlist;
}
