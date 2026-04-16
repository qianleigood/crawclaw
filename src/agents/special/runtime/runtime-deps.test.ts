import { describe, expect, it } from "vitest";
import { emitAgentActionEvent } from "../../action-feed/emit.js";
import { defaultSpecialAgentRuntimeDeps } from "./run-once.js";
import { createDefaultSpecialAgentActionRuntimeDeps } from "./runtime-deps.js";

describe("special agent runtime deps", () => {
  it("extends the shared runtime deps with action-feed emission", () => {
    expect(createDefaultSpecialAgentActionRuntimeDeps()).toEqual({
      ...defaultSpecialAgentRuntimeDeps,
      emitAgentActionEvent,
    });
  });
});
