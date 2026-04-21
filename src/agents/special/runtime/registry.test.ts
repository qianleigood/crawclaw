import { describe, expect, it } from "vitest";
import { REVIEW_TOOL_ALLOWLIST } from "../../review-agent.js";
import {
  listRegisteredSpecialAgentContractIssues,
  resolveSpecialAgentDefinitionBySpawnSource,
  resolveSpecialAgentToolAllowlistBySpawnSource,
} from "./registry.js";

describe("special agent registry", () => {
  it("resolves registered definitions by spawn source", () => {
    const definition = resolveSpecialAgentDefinitionBySpawnSource("review-spec");

    expect(definition?.id).toBe("review-spec");
    expect(definition?.executionMode).toBe("spawned_session");
    expect(definition?.transcriptPolicy).toBe("isolated");
    expect(definition?.toolPolicy?.enforcement).toBe("runtime_deny");
  });

  it("resolves tool allowlists through the shared registry", () => {
    expect(resolveSpecialAgentToolAllowlistBySpawnSource("review-quality")).toEqual(
      REVIEW_TOOL_ALLOWLIST,
    );
    expect(resolveSpecialAgentToolAllowlistBySpawnSource("missing")).toBeUndefined();
  });

  it("exposes cache policy for memory special agents", () => {
    const definition = resolveSpecialAgentDefinitionBySpawnSource("session-summary");

    expect(definition?.cachePolicy).toEqual({
      cacheRetention: "short",
    });
    expect(definition?.toolPolicy?.enforcement).toBe("runtime_deny");
  });

  it("keeps all registered special agent definitions contract-valid", () => {
    expect(listRegisteredSpecialAgentContractIssues()).toEqual([]);
  });
});
