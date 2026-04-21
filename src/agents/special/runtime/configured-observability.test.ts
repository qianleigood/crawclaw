import { describe, expect, it, vi } from "vitest";
import { createConfiguredSpecialAgentObservability } from "./configured-observability.js";
import type { SpecialAgentObservabilityParams } from "./observability.js";

describe("configured special agent observability", () => {
  it("wires runtime config into special agent observability", () => {
    const runtimeConfig = { memory: { durableExtraction: { enabled: true } } };
    const observability = {
      hooks: {},
      recordResult: vi.fn(),
    };
    const createSpecialAgentObservability = vi.fn().mockReturnValue(observability);

    const result = createConfiguredSpecialAgentObservability(
      {
        definition: {
          id: "review-spec",
          label: "review spec",
          spawnSource: "review-spec",
          toolPolicy: {
            allowlist: ["read"],
          },
        },
        sessionId: "session-1",
        sessionKey: "session-key-1",
        agentId: "agent-1",
        parentRunId: "parent-run-1",
      } satisfies Omit<SpecialAgentObservabilityParams, "config">,
      {
        getRuntimeConfigSnapshot: vi.fn().mockReturnValue(runtimeConfig),
        createSpecialAgentObservability,
      },
    );

    expect(result).toEqual({
      runtimeConfig,
      observability,
    });
    expect(createSpecialAgentObservability).toHaveBeenCalledWith({
      definition: {
        id: "review-spec",
        label: "review spec",
        spawnSource: "review-spec",
        toolPolicy: {
          allowlist: ["read"],
        },
      },
      config: runtimeConfig,
      sessionId: "session-1",
      sessionKey: "session-key-1",
      agentId: "agent-1",
      parentRunId: "parent-run-1",
    });
  });

  it("normalizes missing runtime config to undefined", () => {
    const observability = {
      hooks: {},
      recordResult: vi.fn(),
    };

    const result = createConfiguredSpecialAgentObservability(
      {
        definition: {
          id: "review-spec",
          label: "review spec",
          spawnSource: "review-spec",
          toolPolicy: {
            allowlist: ["read"],
          },
        },
        sessionId: "session-2",
      } satisfies Omit<SpecialAgentObservabilityParams, "config">,
      {
        getRuntimeConfigSnapshot: vi.fn().mockReturnValue(null),
        createSpecialAgentObservability: vi.fn().mockReturnValue(observability),
      },
    );

    expect(result.runtimeConfig).toBeUndefined();
  });
});
