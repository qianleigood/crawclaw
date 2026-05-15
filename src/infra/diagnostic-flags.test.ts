import { describe, expect, it } from "vitest";
import type { CrawClawConfig } from "../config/config.js";
import {
  isDiagnosticFlagEnabled,
  matchesDiagnosticFlag,
  resolveDiagnosticFlags,
} from "./diagnostic-flags.js";

describe("resolveDiagnosticFlags", () => {
  it("normalizes and dedupes config and env flags", () => {
    const cfg = {
      diagnostics: { flags: [" Feishu.Http ", "cache.*", "CACHE.*"] },
    } as CrawClawConfig;
    const env = {
      CRAWCLAW_DIAGNOSTICS: " foo, Cache.*  feishu.http  ",
    } as NodeJS.ProcessEnv;

    expect(resolveDiagnosticFlags(cfg, env)).toEqual(["feishu.http", "cache.*", "foo"]);
  });

  it("treats false-like env values as no extra flags", () => {
    const cfg = {
      diagnostics: { flags: ["feishu.http"] },
    } as CrawClawConfig;

    for (const raw of ["0", "false", "off", "none", "   "]) {
      expect(
        resolveDiagnosticFlags(cfg, {
          CRAWCLAW_DIAGNOSTICS: raw,
        } as NodeJS.ProcessEnv),
      ).toEqual(["feishu.http"]);
    }
  });
});

describe("matchesDiagnosticFlag", () => {
  it("matches exact, namespace, prefix, and wildcard rules", () => {
    expect(matchesDiagnosticFlag("feishu.http", ["feishu.http"])).toBe(true);
    expect(matchesDiagnosticFlag("cache", ["cache.*"])).toBe(true);
    expect(matchesDiagnosticFlag("cache.hit", ["cache.*"])).toBe(true);
    expect(matchesDiagnosticFlag("tool.exec.fast", ["tool.exec*"])).toBe(true);
    expect(matchesDiagnosticFlag("anything", ["all"])).toBe(true);
    expect(matchesDiagnosticFlag("anything", ["*"])).toBe(true);
  });

  it("rejects blank and non-matching flags", () => {
    expect(matchesDiagnosticFlag("   ", ["*"])).toBe(false);
    expect(matchesDiagnosticFlag("cache.hit", ["cache.miss", "tool.*"])).toBe(false);
  });
});

describe("isDiagnosticFlagEnabled", () => {
  it("resolves config and env together before matching", () => {
    const cfg = {
      diagnostics: { flags: ["gateway.*"] },
    } as CrawClawConfig;
    const env = {
      CRAWCLAW_DIAGNOSTICS: "feishu.http",
    } as NodeJS.ProcessEnv;

    expect(isDiagnosticFlagEnabled("gateway.ws", cfg, env)).toBe(true);
    expect(isDiagnosticFlagEnabled("feishu.http", cfg, env)).toBe(true);
    expect(isDiagnosticFlagEnabled("ddingtalk.http", cfg, env)).toBe(false);
  });
});
