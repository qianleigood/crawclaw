import { describe, expect, it } from "vitest";
import { resolveMemoryConfig } from "./resolve.js";

describe("resolveMemoryConfig", () => {
  it("drops removed dream transcript fallback config", () => {
    const config = resolveMemoryConfig({
      dreaming: {
        enabled: false,
        minHours: 12,
        transcriptFallback: {
          enabled: true,
          maxSessions: 50,
        },
      },
    });

    expect(config.dreaming).toEqual({
      enabled: false,
      minHours: 12,
      minSessions: 5,
      scanThrottleMs: 10 * 60_000,
      lockStaleAfterMs: 60 * 60_000,
    });
    expect(config.dreaming).not.toHaveProperty("transcriptFallback");
  });
});
