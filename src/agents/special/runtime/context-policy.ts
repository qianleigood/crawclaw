import { resolveSpecialAgentDefinitionBySpawnSource } from "./registry.js";
import type { SpecialAgentDefinition } from "./types.js";

export function shouldUseIsolatedSpecialAgentContext(
  definitionOrSpawnSource: SpecialAgentDefinition | string | null | undefined,
): boolean {
  if (!definitionOrSpawnSource) {
    return false;
  }
  if (typeof definitionOrSpawnSource !== "string") {
    return definitionOrSpawnSource.isolatedContext === true;
  }
  const normalized = definitionOrSpawnSource.trim();
  if (!normalized) {
    return false;
  }
  return resolveSpecialAgentDefinitionBySpawnSource(normalized)?.isolatedContext === true;
}
