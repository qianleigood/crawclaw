import { describe, expect, it } from "vitest";
import type { CrawClawConfig } from "../config/config.js";
import { collectMissingExplicitDefaultAccountWarnings } from "./doctor/shared/default-account-warnings.js";

describe("collectMissingExplicitDefaultAccountWarnings", () => {
  it("warns when multiple named accounts are configured without default selection", () => {
    const cfg: CrawClawConfig = {
      channels: {
        feishu: {
          accounts: {
            alerts: { botToken: "a" },
            work: { botToken: "w" },
          },
        },
      },
    };

    const warnings = collectMissingExplicitDefaultAccountWarnings(cfg);
    expect(warnings).toEqual([
      expect.stringContaining("channels.feishu: multiple accounts are configured"),
    ]);
  });

  it("does not warn for a single named account without default", () => {
    const cfg: CrawClawConfig = {
      channels: {
        feishu: {
          accounts: {
            work: { botToken: "w" },
          },
        },
      },
    };

    expect(collectMissingExplicitDefaultAccountWarnings(cfg)).toEqual([]);
  });

  it("does not warn when accounts.default exists", () => {
    const cfg: CrawClawConfig = {
      channels: {
        feishu: {
          accounts: {
            default: { botToken: "d" },
            work: { botToken: "w" },
          },
        },
      },
    };

    expect(collectMissingExplicitDefaultAccountWarnings(cfg)).toEqual([]);
  });

  it("does not warn when defaultAccount points to a configured account", () => {
    const cfg: CrawClawConfig = {
      channels: {
        feishu: {
          defaultAccount: "work",
          accounts: {
            alerts: { botToken: "a" },
            work: { botToken: "w" },
          },
        },
      },
    };

    expect(collectMissingExplicitDefaultAccountWarnings(cfg)).toEqual([]);
  });

  it("normalizes defaultAccount before validating configured account ids", () => {
    const cfg: CrawClawConfig = {
      channels: {
        feishu: {
          defaultAccount: "Router D",
          accounts: {
            "router-d": { botToken: "r" },
            work: { botToken: "w" },
          },
        },
      },
    };

    expect(collectMissingExplicitDefaultAccountWarnings(cfg)).toEqual([]);
  });

  it("warns when defaultAccount is invalid for configured accounts", () => {
    const cfg: CrawClawConfig = {
      channels: {
        feishu: {
          defaultAccount: "missing",
          accounts: {
            alerts: { botToken: "a" },
            work: { botToken: "w" },
          },
        },
      },
    };

    const warnings = collectMissingExplicitDefaultAccountWarnings(cfg);
    expect(warnings).toEqual([
      expect.stringContaining('channels.feishu: defaultAccount is set to "missing"'),
    ]);
  });

  it("warns across channels that support account maps", () => {
    const cfg: CrawClawConfig = {
      channels: {
        feishu: {
          accounts: {
            alerts: { botToken: "a" },
            work: { botToken: "w" },
          },
        },
        ddingtalk: {
          accounts: {
            a: { botToken: "x" },
            b: { botToken: "y" },
          },
        },
      },
    };

    const warnings = collectMissingExplicitDefaultAccountWarnings(cfg);
    expect(warnings).toHaveLength(2);
    expect(warnings.some((line) => line.includes("channels.feishu"))).toBe(true);
    expect(warnings.some((line) => line.includes("channels.ddingtalk"))).toBe(true);
  });
});
