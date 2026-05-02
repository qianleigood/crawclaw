import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NotebookLmConfig } from "../types/config.ts";

const execFileMock = vi.fn();
const tempRoots: string[] = [];
const originalStateDir = process.env.CRAWCLAW_STATE_DIR;

vi.mock("node:child_process", () => ({
  execFile: (...args: unknown[]) => execFileMock(...args),
}));

const baseConfig: NotebookLmConfig = {
  enabled: true,
  auth: {
    profile: "default",
    cookieFile: "/tmp/notebooklm-cookies.txt",
    statusTtlMs: 60_000,
    degradedCooldownMs: 120_000,
    refreshCooldownMs: 180_000,
    heartbeat: { enabled: true, minIntervalMs: 1_000, maxIntervalMs: 2_000 },
  },
  cli: {
    enabled: true,
    command: "python",
    args: ["/tmp/notebooklm-cli-recall.py", "{query}"],
    timeoutMs: 1000,
    limit: 5,
    notebookId: "nb-1",
  },
  write: {
    command: "python",
    args: ["/tmp/notebooklm-cli-recall.py", "write", "{payloadFile}", "{notebookId}"],
    timeoutMs: 1000,
    notebookId: "nb-1",
  },
};

function makeManagedNlmBin(): string {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "crawclaw-notebooklm-state-"));
  tempRoots.push(stateDir);
  const binPath =
    process.platform === "win32"
      ? path.join(stateDir, "runtimes", "notebooklm-mcp-cli", "venv", "Scripts", "nlm.exe")
      : path.join(stateDir, "runtimes", "notebooklm-mcp-cli", "venv", "bin", "nlm");
  fs.mkdirSync(path.dirname(binPath), { recursive: true });
  fs.writeFileSync(binPath, "", "utf8");
  process.env.CRAWCLAW_STATE_DIR = stateDir;
  return binPath;
}

describe("getNotebookLmProviderState", () => {
  beforeEach(() => {
    execFileMock.mockReset();
  });

  afterEach(() => {
    vi.resetModules();
    if (originalStateDir === undefined) {
      delete process.env.CRAWCLAW_STATE_DIR;
    } else {
      process.env.CRAWCLAW_STATE_DIR = originalStateDir;
    }
    for (const root of tempRoots.splice(0)) {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("reports ready state from the wrapper status response", async () => {
    execFileMock.mockImplementation((_command, _args, _options, callback) => {
      callback(
        null,
        JSON.stringify({
          status: "ok",
          ready: true,
          reason: null,
          profile: "default",
          notebookId: "nb-1",
          refreshAttempted: false,
          refreshSucceeded: false,
          authSource: "profile",
        }),
      );
    });

    const { getNotebookLmProviderState } = await import("./provider-state.ts");
    const state = await getNotebookLmProviderState({
      mode: "query",
      config: baseConfig,
    });

    expect(state).toMatchObject({
      enabled: true,
      ready: true,
      lifecycle: "ready",
      reason: null,
      profile: "default",
      notebookId: "nb-1",
      authSource: "profile",
    });
    expect(execFileMock).toHaveBeenCalledTimes(1);
  });

  it("checks unified nlm auth with login --check", async () => {
    execFileMock.mockImplementation((_command, args, _options, callback) => {
      expect(args).toEqual(["login", "--check", "--profile", "work"]);
      callback(
        null,
        [
          "✓ Authentication valid!",
          "  Profile: work",
          "  Notebooks found: 3",
          "  Account: user@example.com",
        ].join("\n"),
      );
    });

    const { getNotebookLmProviderState } = await import("./provider-state.ts");
    const state = await getNotebookLmProviderState({
      mode: "query",
      config: {
        ...baseConfig,
        auth: { ...baseConfig.auth, profile: "work" },
        cli: {
          ...baseConfig.cli,
          command: "nlm",
          args: ["notebook", "query", "{notebookId}", "{query}", "--json"],
        },
        write: {
          ...baseConfig.write,
          enabled: false,
        } as unknown as NotebookLmConfig["write"],
      },
    });

    expect(state).toMatchObject({
      enabled: true,
      ready: true,
      lifecycle: "ready",
      reason: null,
      profile: "work",
      notebookId: "nb-1",
      authSource: "profile",
    });
  });

  it("checks auth through the managed nlm runtime when no command is configured", async () => {
    const binPath = makeManagedNlmBin();
    execFileMock.mockImplementation((command, args, _options, callback) => {
      expect(command).toBe(binPath);
      expect(args).toEqual(["login", "--check"]);
      callback(null, "✓ Authentication valid!\n  Profile: default\n  Notebooks found: 3");
    });

    const { getNotebookLmProviderState } = await import("./provider-state.ts");
    const state = await getNotebookLmProviderState({
      mode: "query",
      config: {
        ...baseConfig,
        cli: {
          ...baseConfig.cli,
          command: "",
          args: ["notebook", "query", "{notebookId}", "{query}", "--json"],
        },
      },
    });

    expect(state).toMatchObject({
      ready: true,
      lifecycle: "ready",
      reason: null,
    });
  });

  it("retries transient NotebookLM API code 7 auth checks before degrading", async () => {
    execFileMock
      .mockImplementationOnce((_command, _args, _options, callback) => {
        callback(
          new Error("Command failed"),
          "",
          "✗ Authentication failed: API error (code 7): type.googleapis.com/google.rpc.ErrorInfo",
        );
      })
      .mockImplementationOnce((_command, _args, _options, callback) => {
        callback(null, "✓ Authentication valid!\n  Profile: default\n  Notebooks found: 3");
      });

    const { getNotebookLmProviderState } = await import("./provider-state.ts");
    const state = await getNotebookLmProviderState({
      mode: "query",
      config: {
        ...baseConfig,
        cli: {
          ...baseConfig.cli,
          command: "nlm",
          args: ["notebook", "query", "{notebookId}", "{query}", "--json"],
        },
      },
    });

    expect(state).toMatchObject({
      ready: true,
      lifecycle: "ready",
      reason: null,
    });
    expect(execFileMock).toHaveBeenCalledTimes(2);
  });

  it("returns a classified missing state when wrapper reports auth expiry", async () => {
    execFileMock.mockImplementation((_command, _args, _options, callback) => {
      callback(
        null,
        JSON.stringify({
          status: "missing",
          ready: false,
          reason: "auth_expired",
          profile: "default",
          refreshAttempted: true,
          refreshSucceeded: false,
          error: "Authentication expired",
        }),
      );
    });

    const { getNotebookLmProviderState } = await import("./provider-state.ts");
    const state = await getNotebookLmProviderState({
      mode: "write",
      config: {
        ...baseConfig,
        auth: {
          ...baseConfig.auth,
          cookieFile: "",
        },
        cli: {
          ...baseConfig.cli,
          notebookId: "nb-2",
        },
        write: {
          ...baseConfig.write,
          notebookId: "nb-2",
        },
      },
    });

    expect(state).toMatchObject({
      ready: false,
      lifecycle: "expired",
      reason: "auth_expired",
      recommendedAction: "crawclaw memory login",
      refreshAttempted: true,
      refreshSucceeded: false,
    });
  });

  it("reuses cached degraded state during cooldown instead of probing repeatedly", async () => {
    vi.useFakeTimers();
    execFileMock.mockImplementation((_command, _args, _options, callback) => {
      callback(
        null,
        JSON.stringify({
          status: "missing",
          ready: false,
          reason: "auth_expired",
          profile: "default",
          refreshAttempted: false,
          refreshSucceeded: false,
          error: "Authentication expired",
        }),
      );
    });

    const { getNotebookLmProviderState } = await import("./provider-state.ts");
    const config = {
      ...baseConfig,
      auth: { ...baseConfig.auth, degradedCooldownMs: 10 * 60_000 },
    };

    const first = await getNotebookLmProviderState({ mode: "query", config });
    const second = await getNotebookLmProviderState({ mode: "query", config });

    expect(first.lifecycle).toBe("expired");
    expect(second.lifecycle).toBe("expired");
    expect(execFileMock).toHaveBeenCalledTimes(1);
  });

  it("runs explicit refresh and enforces refresh cooldown after failure", async () => {
    vi.useFakeTimers();
    execFileMock.mockImplementationOnce((_command, _args, _options, callback) => {
      callback(
        null,
        JSON.stringify({
          status: "missing",
          ready: false,
          reason: "cookie_invalid",
          profile: "default",
          refreshAttempted: true,
          refreshSucceeded: false,
          error: "Invalid cookie fallback",
        }),
      );
    });

    const { refreshNotebookLmProviderState } = await import("./provider-state.ts");
    const config = {
      ...baseConfig,
      auth: { ...baseConfig.auth, refreshCooldownMs: 10 * 60_000 },
    };

    const first = await refreshNotebookLmProviderState({ mode: "query", config });
    const second = await refreshNotebookLmProviderState({ mode: "query", config });

    expect(first.refreshAttempted).toBe(true);
    expect(first.ready).toBe(false);
    expect(first.lifecycle).toBe("expired");
    expect(first.recommendedAction).toBe("crawclaw memory login");
    expect(first.nextAllowedRefreshAt).toEqual(expect.any(String));
    expect(second.details).toContain("refresh cooldown active");
    expect(second.lifecycle).toBe("expired");
    expect(second.nextAllowedRefreshAt).toBe(first.nextAllowedRefreshAt);
    expect(execFileMock).toHaveBeenCalledTimes(1);
  });
});
