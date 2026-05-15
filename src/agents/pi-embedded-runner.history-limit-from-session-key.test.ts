import { describe, expect, it } from "vitest";
import type { CrawClawConfig } from "../config/config.js";
import { getHistoryLimitFromSessionKey } from "./pi-embedded-runner.js";

describe("getHistoryLimitFromSessionKey", () => {
  it("keeps backward compatibility for dm/direct session kinds", () => {
    const config = {
      channels: { feishu: { dmHistoryLimit: 10 } },
    } as CrawClawConfig;

    expect(getHistoryLimitFromSessionKey("feishu:dm:123", config)).toBe(10);
    expect(getHistoryLimitFromSessionKey("feishu:direct:123", config)).toBe(10);
  });

  it("returns historyLimit for channel and group session kinds", () => {
    const config = {
      channels: { qqbot: { historyLimit: 12, dmHistoryLimit: 5 } },
    } as CrawClawConfig;

    expect(getHistoryLimitFromSessionKey("qqbot:channel:123", config)).toBe(12);
    expect(getHistoryLimitFromSessionKey("qqbot:group:456", config)).toBe(12);
  });

  it("returns undefined for unsupported session kinds", () => {
    const config = {
      channels: { qqbot: { historyLimit: 12, dmHistoryLimit: 5 } },
    } as CrawClawConfig;

    expect(getHistoryLimitFromSessionKey("qqbot:slash:123", config)).toBeUndefined();
  });
});
