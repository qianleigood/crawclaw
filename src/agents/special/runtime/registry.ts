import {
  DREAM_AGENT_DEFINITION,
  MEMORY_EXTRACTION_AGENT_DEFINITION,
  SESSION_SUMMARY_AGENT_DEFINITION,
} from "../../../memory/special-agents.js";
import {
  REVIEW_QUALITY_AGENT_DEFINITION,
  REVIEW_SPEC_AGENT_DEFINITION,
} from "../../review-agent.js";
import { validateSpecialAgentDefinitionContract, type SpecialAgentDefinition } from "./types.js";

export type RegisteredSpecialAgentContractIssue = {
  id: string;
  spawnSource: string;
  issues: string[];
};

function getRegisteredSpecialAgentDefinitions(): readonly SpecialAgentDefinition[] {
  return [
    REVIEW_SPEC_AGENT_DEFINITION,
    REVIEW_QUALITY_AGENT_DEFINITION,
    MEMORY_EXTRACTION_AGENT_DEFINITION,
    DREAM_AGENT_DEFINITION,
    SESSION_SUMMARY_AGENT_DEFINITION,
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
