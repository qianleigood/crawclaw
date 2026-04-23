import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { setActiveCliLocale } from "../cli/i18n/text.js";
import type { RuntimeEnv } from "../runtime.js";
import { makeTempWorkspace } from "../test-helpers/workspace.js";
import {
  ensureWorkspaceAndSessions,
  normalizeGatewayTokenInput,
  openUrl,
  printWizardHeader,
  resolveBrowserOpenCommand,
  resolveControlUiLinks,
  validateGatewayPasswordInput,
} from "./onboard-helpers.js";

const mocks = vi.hoisted(() => ({
  runCommandWithTimeout: vi.fn<
    (
      argv: string[],
      options?: { timeoutMs?: number; windowsVerbatimArguments?: boolean },
    ) => Promise<{ stdout: string; stderr: string; code: number; signal: null; killed: boolean }>
  >(async () => ({
    stdout: "",
    stderr: "",
    code: 0,
    signal: null,
    killed: false,
  })),
  pickPrimaryTailnetIPv4: vi.fn<() => string | undefined>(() => undefined),
}));

vi.mock("../process/exec.js", () => ({
  runCommandWithTimeout: mocks.runCommandWithTimeout,
}));

vi.mock("../infra/tailnet.js", () => ({
  pickPrimaryTailnetIPv4: mocks.pickPrimaryTailnetIPv4,
}));

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  setActiveCliLocale("en");
});

describe("openUrl", () => {
  it("quotes URLs on win32 so '&' is not treated as cmd separator", async () => {
    vi.stubEnv("VITEST", "");
    vi.stubEnv("NODE_ENV", "");
    const platformSpy = vi.spyOn(process, "platform", "get").mockReturnValue("win32");
    vi.stubEnv("VITEST", "");
    vi.stubEnv("NODE_ENV", "development");

    const url =
      "https://accounts.google.com/o/oauth2/v2/auth?client_id=abc&response_type=code&redirect_uri=http%3A%2F%2Flocalhost";

    const ok = await openUrl(url);
    expect(ok).toBe(true);

    expect(mocks.runCommandWithTimeout).toHaveBeenCalledTimes(1);
    const [argv, options] = mocks.runCommandWithTimeout.mock.calls[0] ?? [];
    expect(argv?.slice(0, 4)).toEqual(["cmd", "/c", "start", '""']);
    expect(argv?.at(-1)).toBe(`"${url}"`);
    expect(options).toMatchObject({
      timeoutMs: 5_000,
      windowsVerbatimArguments: true,
    });

    platformSpy.mockRestore();
  });
});

describe("resolveBrowserOpenCommand", () => {
  it("marks win32 commands as quoteUrl=true", async () => {
    const platformSpy = vi.spyOn(process, "platform", "get").mockReturnValue("win32");
    const resolved = await resolveBrowserOpenCommand();
    expect(resolved.argv).toEqual(["cmd", "/c", "start", ""]);
    expect(resolved.quoteUrl).toBe(true);
    platformSpy.mockRestore();
  });
});

describe("resolveControlUiLinks", () => {
  it("uses customBindHost for custom bind", () => {
    const links = resolveControlUiLinks({
      port: 18789,
      bind: "custom",
      customBindHost: "192.168.1.100",
    });
    expect(links.httpUrl).toBe("http://192.168.1.100:18789/");
    expect(links.wsUrl).toBe("ws://192.168.1.100:18789");
  });

  it("falls back to loopback for invalid customBindHost", () => {
    const links = resolveControlUiLinks({
      port: 18789,
      bind: "custom",
      customBindHost: "192.168.001.100",
    });
    expect(links.httpUrl).toBe("http://127.0.0.1:18789/");
    expect(links.wsUrl).toBe("ws://127.0.0.1:18789");
  });

  it("uses tailnet IP for tailnet bind", () => {
    mocks.pickPrimaryTailnetIPv4.mockReturnValueOnce("100.64.0.9");
    const links = resolveControlUiLinks({
      port: 18789,
      bind: "tailnet",
    });
    expect(links.httpUrl).toBe("http://100.64.0.9:18789/");
    expect(links.wsUrl).toBe("ws://100.64.0.9:18789");
  });

  it("keeps loopback for auto even when tailnet is present", () => {
    mocks.pickPrimaryTailnetIPv4.mockReturnValueOnce("100.64.0.9");
    const links = resolveControlUiLinks({
      port: 18789,
      bind: "auto",
    });
    expect(links.httpUrl).toBe("http://127.0.0.1:18789/");
    expect(links.wsUrl).toBe("ws://127.0.0.1:18789");
  });

  it("falls back to loopback for tailnet bind when interface discovery throws", () => {
    mocks.pickPrimaryTailnetIPv4.mockImplementationOnce(() => {
      throw new Error("uv_interface_addresses failed");
    });

    const links = resolveControlUiLinks({
      port: 18789,
      bind: "tailnet",
    });

    expect(links.httpUrl).toBe("http://127.0.0.1:18789/");
    expect(links.wsUrl).toBe("ws://127.0.0.1:18789");
  });

  it("falls back to loopback for LAN bind when interface discovery throws", () => {
    vi.spyOn(os, "networkInterfaces").mockImplementationOnce(() => {
      throw new Error("uv_interface_addresses failed");
    });

    const links = resolveControlUiLinks({
      port: 18789,
      bind: "lan",
    });

    expect(links.httpUrl).toBe("http://127.0.0.1:18789/");
    expect(links.wsUrl).toBe("ws://127.0.0.1:18789");
  });
});

describe("normalizeGatewayTokenInput", () => {
  it("returns empty string for undefined or null", () => {
    expect(normalizeGatewayTokenInput(undefined)).toBe("");
    expect(normalizeGatewayTokenInput(null)).toBe("");
  });

  it("trims string input", () => {
    expect(normalizeGatewayTokenInput("  token  ")).toBe("token");
  });

  it("returns empty string for non-string input", () => {
    expect(normalizeGatewayTokenInput(123)).toBe("");
  });

  it('rejects literal string coercion artifacts ("undefined"/"null")', () => {
    expect(normalizeGatewayTokenInput("undefined")).toBe("");
    expect(normalizeGatewayTokenInput("null")).toBe("");
  });
});

describe("validateGatewayPasswordInput", () => {
  it("requires a non-empty password", () => {
    expect(validateGatewayPasswordInput("")).toBe("Required");
    expect(validateGatewayPasswordInput("   ")).toBe("Required");
  });

  it("rejects literal string coercion artifacts", () => {
    expect(validateGatewayPasswordInput("undefined")).toBe(
      'Cannot be the literal string "undefined" or "null"',
    );
    expect(validateGatewayPasswordInput("null")).toBe(
      'Cannot be the literal string "undefined" or "null"',
    );
  });

  it("accepts a normal password", () => {
    expect(validateGatewayPasswordInput(" secret ")).toBeUndefined();
  });
});

describe("printWizardHeader", () => {
  it("does not print the block art banner", () => {
    const log = vi.fn();
    const runtime: RuntimeEnv = {
      log,
      error: vi.fn(),
      exit: vi.fn(),
    };

    printWizardHeader(runtime);

    const output = String(log.mock.calls[0]?.[0] ?? "");
    expect(output).not.toContain("▄▄▄▄");
    expect(output).not.toContain("██░");
    expect(output).not.toContain("▀▀▀▀");
    expect(output.toLowerCase()).toContain("crawclaw");
  });

  it("localizes the setup header when zh-CN is active", () => {
    setActiveCliLocale("zh-CN");
    const log = vi.fn();
    const runtime: RuntimeEnv = {
      log,
      error: vi.fn(),
      exit: vi.fn(),
    };

    printWizardHeader(runtime);

    expect(log).toHaveBeenCalledWith("CrawClaw 设置");
  });
});

describe("ensureWorkspaceAndSessions", () => {
  it("localizes workspace and sessions ready logs when zh-CN is active", async () => {
    const tempDir = await makeTempWorkspace("crawclaw-onboard-helpers-");
    try {
      setActiveCliLocale("zh-CN");
      vi.stubEnv("CRAWCLAW_STATE_DIR", path.join(tempDir, "state"));
      const log = vi.fn();
      const runtime: RuntimeEnv = {
        log,
        error: vi.fn(),
        exit: vi.fn(),
      };
      const workspaceDir = path.join(tempDir, "workspace");

      await ensureWorkspaceAndSessions(workspaceDir, runtime, { skipBootstrap: true });

      expect(log.mock.calls.map((call) => String(call[0]))).toEqual([
        `工作区 OK: ${workspaceDir}`,
        `会话 OK: ${path.join(tempDir, "state", "agents", "main", "sessions")}`,
      ]);
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });
});
