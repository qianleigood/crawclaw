import { emitAgentActionEvent } from "../../action-feed/emit.js";
import { defaultSpecialAgentRuntimeDeps, type SpecialAgentRuntimeDeps } from "./run-once.js";

export type SpecialAgentActionRuntimeDeps = SpecialAgentRuntimeDeps & {
  emitAgentActionEvent: typeof emitAgentActionEvent;
};

export function createDefaultSpecialAgentActionRuntimeDeps(): SpecialAgentActionRuntimeDeps {
  return {
    ...defaultSpecialAgentRuntimeDeps,
    emitAgentActionEvent,
  };
}
