import fs from "node:fs/promises";
import path from "node:path";
import { expect, it } from "vitest";

// Narrow public testing surface for plugin authors.
// Keep this list additive and limited to helpers we are willing to support.

export {
  createCliRuntimeCapture,
  firstWrittenJsonArg,
  spyRuntimeErrors,
  spyRuntimeJson,
  spyRuntimeLogs,
} from "../terminal/test-runtime-capture.js";
export type { CliMockOutputRuntime, CliRuntimeCapture } from "../terminal/test-runtime-capture.js";
export type { CrawClawConfig } from "../config/config.js";
export { callGateway } from "../gateway/call.js";
export { createEmptyPluginRegistry } from "../plugins/registry.js";
export {
  getActivePluginRegistry,
  resetPluginRuntimeStateForTest,
  setActivePluginRegistry,
} from "../plugins/runtime.js";
export type { RuntimeEnv } from "../runtime.js";
export type { MockFn } from "../test-utils/vitest-mock-fn.js";
export {
  createAuthCaptureJsonFetch,
  createRequestCaptureJsonFetch,
  installPinnedHostnameTestHooks,
} from "../media-understanding/audio.test-helpers.ts";
export { isLiveTestEnabled } from "../agents/live-test-helpers.js";
export { writeSkill } from "../agents/skills.e2e-test-helpers.js";
export { peekSystemEvents, resetSystemEventsForTest } from "../infra/system-events.js";
export { jsonResponse, requestBodyText, requestUrl } from "../test-helpers/http.js";
export { mockPinnedHostnameResolution } from "../test-helpers/ssrf.js";
export { sanitizeTerminalText } from "../terminal/safe-text.js";
export { withStateDirEnv } from "../test-helpers/state-dir-env.js";

/** Create a tiny Windows `.cmd` shim fixture for plugin tests that spawn CLIs. */
export async function createWindowsCmdShimFixture(params: {
  shimPath: string;
  scriptPath: string;
  shimLine: string;
}): Promise<void> {
  await fs.mkdir(path.dirname(params.scriptPath), { recursive: true });
  await fs.mkdir(path.dirname(params.shimPath), { recursive: true });
  await fs.writeFile(params.scriptPath, "module.exports = {};\n", "utf8");
  await fs.writeFile(params.shimPath, `@echo off\r\n${params.shimLine}\r\n`, "utf8");
}

type ResolveTargetMode = "explicit" | "implicit" | "heartbeat";

type ResolveTargetResult = {
  ok: boolean;
  to?: string;
  error?: unknown;
};

type ResolveTargetFn = (params: {
  to?: string;
  mode: ResolveTargetMode;
  allowFrom: string[];
}) => ResolveTargetResult;

/** Install shared target-resolution error handling cases. */
export function installCommonResolveTargetErrorCases(params: {
  resolveTarget: ResolveTargetFn;
  implicitAllowFrom: string[];
}) {
  const { resolveTarget, implicitAllowFrom } = params;

  it("should error on normalization failure with allowlist (implicit mode)", () => {
    const result = resolveTarget({
      to: "invalid-target",
      mode: "implicit",
      allowFrom: implicitAllowFrom,
    });

    expect(result.ok).toBe(false);
    expect(result.error).toBeDefined();
  });

  it("should error when no target provided with allowlist", () => {
    const result = resolveTarget({
      to: undefined,
      mode: "implicit",
      allowFrom: implicitAllowFrom,
    });

    expect(result.ok).toBe(false);
    expect(result.error).toBeDefined();
  });

  it("should error when no target and no allowlist", () => {
    const result = resolveTarget({
      to: undefined,
      mode: "explicit",
      allowFrom: [],
    });

    expect(result.ok).toBe(false);
    expect(result.error).toBeDefined();
  });

  it("should handle whitespace-only target", () => {
    const result = resolveTarget({
      to: "   ",
      mode: "explicit",
      allowFrom: [],
    });

    expect(result.ok).toBe(false);
    expect(result.error).toBeDefined();
  });
}
