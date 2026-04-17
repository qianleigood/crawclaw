import { describe, expect, it } from "vitest";
import type { CrawClawConfig } from "../config/config.js";
import { getHistoryLimitFromSessionKey } from "./pi-embedded-runner.js";

describe("getHistoryLimitFromSessionKey", () => {
  it("keeps backward compatibility for dm/direct session kinds", () => {
    const config = {
      channels: { telegram: { dmHistoryLimit: 10 } },
    } as CrawClawConfig;

    expect(getHistoryLimitFromSessionKey("telegram:dm:123", config)).toBe(10);
    expect(getHistoryLimitFromSessionKey("telegram:direct:123", config)).toBe(10);
  });

  it("returns historyLimit for channel and group session kinds", () => {
    const config = {
      channels: { discord: { historyLimit: 12, dmHistoryLimit: 5 } },
    } as CrawClawConfig;

    expect(getHistoryLimitFromSessionKey("discord:channel:123", config)).toBe(12);
    expect(getHistoryLimitFromSessionKey("discord:group:456", config)).toBe(12);
  });

  it("returns undefined for unsupported session kinds", () => {
    const config = {
      channels: { discord: { historyLimit: 12, dmHistoryLimit: 5 } },
    } as CrawClawConfig;

    expect(getHistoryLimitFromSessionKey("discord:slash:123", config)).toBeUndefined();
  });
});
