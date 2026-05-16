export {
  applyExtraParamsToAgent,
  resolveAgentTransportOverride,
  resolveExtraParams,
  resolvePreparedExtraParams,
} from "./runtime-support/extra-params.js";

export { applyGoogleTurnOrderingFix } from "./runtime-support/google.js";
export { getHistoryLimitFromSessionKey, limitHistoryTurns } from "./runtime-support/history.js";
export { resolveAgentSessionLane } from "./runtime-support/lanes.js";
export { createSystemPromptOverride } from "./runtime-support/system-prompt.js";
export type {
  AgentRuntimeAgentMeta,
  AgentRuntimeCompactResult,
  AgentRuntimeRunMeta,
  AgentRuntimeRunResult,
} from "./runtime-support/types.js";
