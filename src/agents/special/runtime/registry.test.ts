import { describe, expect, it } from "vitest";
import { VERIFICATION_TOOL_ALLOWLIST } from "../../verification-agent.js";
import {
  resolveSpecialAgentDefinitionBySpawnSource,
  resolveSpecialAgentToolAllowlistBySpawnSource,
} from "./registry.js";

describe("special agent registry", () => {
  it("resolves registered definitions by spawn source", () => {
    const definition = resolveSpecialAgentDefinitionBySpawnSource("verification");

    expect(definition?.id).toBe("verification");
    expect(definition?.executionMode).toBe("spawned_session");
    expect(definition?.transcriptPolicy).toBe("isolated");
    expect(definition?.toolPolicy?.enforcement).toBe("runtime_deny");
  });

  it("resolves tool allowlists through the shared registry", () => {
    expect(resolveSpecialAgentToolAllowlistBySpawnSource("verification")).toEqual(
      VERIFICATION_TOOL_ALLOWLIST,
    );
    expect(resolveSpecialAgentToolAllowlistBySpawnSource("missing")).toBeUndefined();
  });

  it("exposes cache policy for memory special agents", () => {
    const definition = resolveSpecialAgentDefinitionBySpawnSource("session-summary");

    expect(definition?.cachePolicy).toEqual({
      cacheRetention: "short",
      skipWrite: true,
      promptCache: {
        scope: "parent_session",
        retention: "24h",
      },
    });
    expect(definition?.toolPolicy?.enforcement).toBe("runtime_deny");
  });
});
