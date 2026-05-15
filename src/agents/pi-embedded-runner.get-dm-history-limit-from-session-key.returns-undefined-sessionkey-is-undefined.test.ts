import { describe, expect, it } from "vitest";
import type { CrawClawConfig } from "../config/config.js";
import { getHistoryLimitFromSessionKey } from "./pi-embedded-runner.js";

describe("getHistoryLimitFromSessionKey", () => {
  it("returns undefined when sessionKey is undefined", () => {
    expect(getHistoryLimitFromSessionKey(undefined, {})).toBeUndefined();
  });
  it("returns undefined when config is undefined", () => {
    expect(getHistoryLimitFromSessionKey("feishu:dm:123", undefined)).toBeUndefined();
  });
  it("returns dmHistoryLimit for feishu provider", () => {
    const config = {
      channels: { feishu: { dmHistoryLimit: 15 } },
    } as CrawClawConfig;
    expect(getHistoryLimitFromSessionKey("feishu:dm:123", config)).toBe(15);
  });
  it("returns dmHistoryLimit for weixin provider", () => {
    const config = {
      channels: { weixin: { dmHistoryLimit: 20 } },
    } as CrawClawConfig;
    expect(getHistoryLimitFromSessionKey("weixin:dm:123", config)).toBe(20);
  });
  it("returns dmHistoryLimit for agent-prefixed session keys", () => {
    const config = {
      channels: { feishu: { dmHistoryLimit: 10 } },
    } as CrawClawConfig;
    expect(getHistoryLimitFromSessionKey("agent:main:feishu:dm:123", config)).toBe(10);
  });
  it("strips thread suffix from dm session keys", () => {
    const config = {
      channels: { feishu: { dmHistoryLimit: 10, dms: { "123": { historyLimit: 7 } } } },
    } as CrawClawConfig;
    expect(getHistoryLimitFromSessionKey("agent:main:feishu:dm:123:thread:999", config)).toBe(7);
    expect(getHistoryLimitFromSessionKey("agent:main:feishu:dm:123:topic:555", config)).toBe(7);
    expect(getHistoryLimitFromSessionKey("feishu:dm:123:thread:999", config)).toBe(7);
  });
  it("keeps non-numeric thread markers in dm ids", () => {
    const config = {
      channels: {
        feishu: { dms: { "user:thread:abc": { historyLimit: 9 } } },
      },
    } as CrawClawConfig;
    expect(getHistoryLimitFromSessionKey("agent:main:feishu:dm:user:thread:abc", config)).toBe(9);
  });
  it("returns historyLimit for channel session kinds when configured", () => {
    const config = {
      channels: {
        ddingtalk: { historyLimit: 10, dmHistoryLimit: 15 },
        qqbot: { historyLimit: 8 },
      },
    } as CrawClawConfig;
    expect(getHistoryLimitFromSessionKey("agent:beta:ddingtalk:channel:c1", config)).toBe(10);
    expect(getHistoryLimitFromSessionKey("qqbot:channel:123456", config)).toBe(8);
  });
  it("returns undefined for non-dm/channel/group session kinds", () => {
    const config = {
      channels: {
        feishu: { dmHistoryLimit: 15, historyLimit: 10 },
      },
    } as CrawClawConfig;
    // "slash" is not dm, channel, or group
    expect(getHistoryLimitFromSessionKey("feishu:slash:123", config)).toBeUndefined();
  });
  it("returns undefined for unknown provider", () => {
    const config = {
      channels: { feishu: { dmHistoryLimit: 15 } },
    } as CrawClawConfig;
    expect(getHistoryLimitFromSessionKey("unknown:dm:123", config)).toBeUndefined();
  });
  it("returns undefined when provider config has no dmHistoryLimit", () => {
    const config = { channels: { feishu: {} } } as CrawClawConfig;
    expect(getHistoryLimitFromSessionKey("feishu:dm:123", config)).toBeUndefined();
  });
  it("handles all supported providers", () => {
    const providers = [
      "feishu",
      "weixin",
      "qqbot",
      "ddingtalk",
      "signal",
      "weixin",
      "qqbot",
      "feishu",
    ] as const;

    for (const provider of providers) {
      const config = {
        channels: { [provider]: { dmHistoryLimit: 5 } },
      } as CrawClawConfig;
      expect(getHistoryLimitFromSessionKey(`${provider}:dm:123`, config)).toBe(5);
    }
  });
  it("handles per-DM overrides for all supported providers", () => {
    const providers = [
      "feishu",
      "weixin",
      "qqbot",
      "ddingtalk",
      "signal",
      "weixin",
      "qqbot",
      "feishu",
    ] as const;

    for (const provider of providers) {
      // Test per-DM override takes precedence
      const configWithOverride = {
        channels: {
          [provider]: {
            dmHistoryLimit: 20,
            dms: { user123: { historyLimit: 7 } },
          },
        },
      } as CrawClawConfig;
      expect(getHistoryLimitFromSessionKey(`${provider}:dm:user123`, configWithOverride)).toBe(7);

      // Test fallback to provider default when user not in dms
      expect(getHistoryLimitFromSessionKey(`${provider}:dm:otheruser`, configWithOverride)).toBe(
        20,
      );

      // Test with agent-prefixed key
      expect(
        getHistoryLimitFromSessionKey(`agent:main:${provider}:dm:user123`, configWithOverride),
      ).toBe(7);
    }
  });
  it("returns per-DM override when set", () => {
    const config = {
      channels: {
        feishu: {
          dmHistoryLimit: 15,
          dms: { "123": { historyLimit: 5 } },
        },
      },
    } as CrawClawConfig;
    expect(getHistoryLimitFromSessionKey("feishu:dm:123", config)).toBe(5);
  });
  it("returns historyLimit for channel sessions for all providers", () => {
    const providers = [
      "feishu",
      "weixin",
      "qqbot",
      "ddingtalk",
      "signal",
      "weixin",
      "qqbot",
      "feishu",
    ] as const;

    for (const provider of providers) {
      const config = {
        channels: { [provider]: { historyLimit: 12 } },
      } as CrawClawConfig;
      expect(getHistoryLimitFromSessionKey(`${provider}:channel:123`, config)).toBe(12);
      expect(getHistoryLimitFromSessionKey(`agent:main:${provider}:channel:456`, config)).toBe(12);
    }
  });
  it("returns historyLimit for group sessions", () => {
    const config = {
      channels: {
        qqbot: { historyLimit: 15 },
        ddingtalk: { historyLimit: 10 },
      },
    } as CrawClawConfig;
    expect(getHistoryLimitFromSessionKey("qqbot:group:123", config)).toBe(15);
    expect(getHistoryLimitFromSessionKey("agent:main:ddingtalk:group:abc", config)).toBe(10);
  });
  it("returns undefined for channel sessions when historyLimit is not configured", () => {
    const config = {
      channels: {
        qqbot: { dmHistoryLimit: 10 }, // only dmHistoryLimit, no historyLimit
      },
    } as CrawClawConfig;
    expect(getHistoryLimitFromSessionKey("qqbot:channel:123", config)).toBeUndefined();
  });

  describe("backward compatibility", () => {
    it("accepts both legacy :dm: and new :direct: session keys", () => {
      const config = {
        channels: { feishu: { dmHistoryLimit: 10 } },
      } as CrawClawConfig;
      // Legacy format with :dm:
      expect(getHistoryLimitFromSessionKey("feishu:dm:123", config)).toBe(10);
      expect(getHistoryLimitFromSessionKey("agent:main:feishu:dm:123", config)).toBe(10);
      // New format with :direct:
      expect(getHistoryLimitFromSessionKey("feishu:direct:123", config)).toBe(10);
      expect(getHistoryLimitFromSessionKey("agent:main:feishu:direct:123", config)).toBe(10);
    });
  });
});
