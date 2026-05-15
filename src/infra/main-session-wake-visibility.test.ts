import { describe, expect, it } from "vitest";
import type { CrawClawConfig } from "../config/config.js";
import { resolveMainSessionWakeVisibility } from "./main-session-wake-visibility.js";

describe("resolveMainSessionWakeVisibility", () => {
  function createChannelDefaultsHeartbeatConfig(heartbeat: {
    showOk?: boolean;
    showAlerts?: boolean;
    useIndicator?: boolean;
  }): CrawClawConfig {
    return {
      channels: {
        defaults: {
          heartbeat,
        },
      },
    } as CrawClawConfig;
  }

  function createFeishuAccountHeartbeatConfig(): CrawClawConfig {
    return {
      channels: {
        feishu: {
          heartbeat: {
            showOk: true,
          },
          accounts: {
            primary: {
              heartbeat: {
                showOk: false,
              },
            },
          },
        },
      },
    } as CrawClawConfig;
  }

  it("returns default values when no config is provided", () => {
    const cfg = {} as CrawClawConfig;
    const result = resolveMainSessionWakeVisibility({ cfg, channel: "feishu" });

    expect(result).toEqual({
      showOk: false,
      showAlerts: true,
      useIndicator: true,
    });
  });

  it("uses channel defaults when provided", () => {
    const cfg = createChannelDefaultsHeartbeatConfig({
      showOk: true,
      showAlerts: false,
      useIndicator: false,
    });

    const result = resolveMainSessionWakeVisibility({ cfg, channel: "feishu" });

    expect(result).toEqual({
      showOk: true,
      showAlerts: false,
      useIndicator: false,
    });
  });

  it("per-channel config overrides channel defaults", () => {
    const cfg = {
      channels: {
        defaults: {
          heartbeat: {
            showOk: false,
            showAlerts: true,
            useIndicator: true,
          },
        },
        feishu: {
          heartbeat: {
            showOk: true,
          },
        },
      },
    } as CrawClawConfig;

    const result = resolveMainSessionWakeVisibility({ cfg, channel: "feishu" });

    expect(result).toEqual({
      showOk: true,
      showAlerts: true,
      useIndicator: true,
    });
  });

  it("per-account config overrides per-channel config", () => {
    const cfg = {
      channels: {
        defaults: {
          heartbeat: {
            showOk: false,
            showAlerts: true,
            useIndicator: true,
          },
        },
        feishu: {
          heartbeat: {
            showOk: false,
            showAlerts: false,
          },
          accounts: {
            primary: {
              heartbeat: {
                showOk: true,
                showAlerts: true,
              },
            },
          },
        },
      },
    } as CrawClawConfig;

    const result = resolveMainSessionWakeVisibility({
      cfg,
      channel: "feishu",
      accountId: "primary",
    });

    expect(result).toEqual({
      showOk: true,
      showAlerts: true,
      useIndicator: true,
    });
  });

  it("falls through to defaults when account has no heartbeat config", () => {
    const cfg = {
      channels: {
        defaults: {
          heartbeat: {
            showOk: false,
          },
        },
        feishu: {
          heartbeat: {
            showAlerts: false,
          },
          accounts: {
            primary: {},
          },
        },
      },
    } as CrawClawConfig;

    const result = resolveMainSessionWakeVisibility({
      cfg,
      channel: "feishu",
      accountId: "primary",
    });

    expect(result).toEqual({
      showOk: false,
      showAlerts: false,
      useIndicator: true,
    });
  });

  it("handles missing accountId gracefully", () => {
    const cfg = createFeishuAccountHeartbeatConfig();
    const result = resolveMainSessionWakeVisibility({ cfg, channel: "feishu" });

    expect(result.showOk).toBe(true);
  });

  it("handles non-existent account gracefully", () => {
    const cfg = createFeishuAccountHeartbeatConfig();
    const result = resolveMainSessionWakeVisibility({
      cfg,
      channel: "feishu",
      accountId: "nonexistent",
    });

    expect(result.showOk).toBe(true);
  });

  it("works with weixin channel", () => {
    const cfg = {
      channels: {
        weixin: {
          heartbeat: {
            showOk: true,
            showAlerts: false,
          },
        },
      },
    } as CrawClawConfig;

    const result = resolveMainSessionWakeVisibility({ cfg, channel: "weixin" });

    expect(result).toEqual({
      showOk: true,
      showAlerts: false,
      useIndicator: true,
    });
  });

  it("works with qqbot channel", () => {
    const cfg = {
      channels: {
        qqbot: {
          heartbeat: {
            useIndicator: false,
          },
        },
      },
    } as CrawClawConfig;

    const result = resolveMainSessionWakeVisibility({ cfg, channel: "qqbot" });

    expect(result).toEqual({
      showOk: false,
      showAlerts: true,
      useIndicator: false,
    });
  });

  it("works with ddingtalk channel", () => {
    const cfg = {
      channels: {
        ddingtalk: {
          heartbeat: {
            showOk: true,
            showAlerts: true,
            useIndicator: true,
          },
        },
      },
    } as CrawClawConfig;

    const result = resolveMainSessionWakeVisibility({ cfg, channel: "ddingtalk" });

    expect(result).toEqual({
      showOk: true,
      showAlerts: true,
      useIndicator: true,
    });
  });

  it("webchat uses channel defaults only (no per-channel config)", () => {
    const cfg = createChannelDefaultsHeartbeatConfig({
      showOk: true,
      showAlerts: false,
      useIndicator: false,
    });

    const result = resolveMainSessionWakeVisibility({ cfg, channel: "webchat" });

    expect(result).toEqual({
      showOk: true,
      showAlerts: false,
      useIndicator: false,
    });
  });

  it("webchat returns defaults when no channel defaults configured", () => {
    const cfg = {} as CrawClawConfig;

    const result = resolveMainSessionWakeVisibility({ cfg, channel: "webchat" });

    expect(result).toEqual({
      showOk: false,
      showAlerts: true,
      useIndicator: true,
    });
  });

  it("webchat ignores accountId (only uses defaults)", () => {
    const cfg = {
      channels: {
        defaults: {
          heartbeat: {
            showOk: true,
          },
        },
      },
    } as CrawClawConfig;

    const result = resolveMainSessionWakeVisibility({
      cfg,
      channel: "webchat",
      accountId: "some-account",
    });

    expect(result.showOk).toBe(true);
  });
});
