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
    expect(resolveSpecialAgentToolAllowlistBySpawnSource("review-spec")).toEqual(
      REVIEW_TOOL_ALLOWLIST,
    );
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

  it("registers experience as a narrow embedded special agent", () => {
    const definition = resolveSpecialAgentDefinitionBySpawnSource("experience");

    expect(definition?.id).toBe("experience");
    expect(definition?.executionMode).toBe("embedded_fork");
    expect(definition?.transcriptPolicy).toBe("isolated");
    expect(definition?.toolPolicy).toMatchObject({
      allowlist: ["write_experience_note"],
      enforcement: "runtime_deny",
      modelVisibility: "allowlist",
    });
  });

  it("registers dream as an embedded memory maintenance agent", () => {
    const definition = resolveSpecialAgentDefinitionBySpawnSource("dream");

    expect(definition?.id).toBe("dream");
    expect(definition?.executionMode).toBe("embedded_fork");
    expect(definition?.transcriptPolicy).toBe("isolated");
    expect(definition?.toolPolicy).toMatchObject({
      enforcement: "runtime_deny",
      modelVisibility: "allowlist",
      guard: "memory_maintenance",
    });
    expect(definition?.systemPromptMode).toBe("isolated");
    expect(definition?.defaultMaxTurns).toBeUndefined();
  });

  it("keeps all registered special agent definitions contract-valid", () => {
    expect(listRegisteredSpecialAgentContractIssues()).toEqual([]);
  });
});
