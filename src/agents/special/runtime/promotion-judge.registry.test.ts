import { describe, expect, it } from "vitest";
import {
  resolveSpecialAgentDefinitionBySpawnSource,
  resolveSpecialAgentToolAllowlistBySpawnSource,
} from "./registry.js";

describe("promotion judge special agent registry", () => {
  it("registers promotion-judge as an embedded runtime-deny special agent", () => {
    const definition = resolveSpecialAgentDefinitionBySpawnSource("promotion-judge");

    expect(definition?.id).toBe("promotion-judge");
    expect(definition?.executionMode).toBe("embedded_fork");
    expect(definition?.transcriptPolicy).toBe("isolated");
    expect(definition?.parentContextPolicy).toBe("none");
    expect(definition?.toolPolicy?.enforcement).toBe("runtime_deny");
    expect(definition?.toolPolicy?.modelVisibility).toBe("allowlist");
    expect(resolveSpecialAgentToolAllowlistBySpawnSource("promotion-judge")).toEqual([
      "read",
      "submit_promotion_verdict",
    ]);
  });
});
