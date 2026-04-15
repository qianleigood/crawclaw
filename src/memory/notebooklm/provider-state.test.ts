import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NotebookLmConfig } from "../types/config.ts";

const execFileMock = vi.fn();

vi.mock("node:child_process", () => ({
  execFile: (...args: unknown[]) => execFileMock(...args),
}));

const baseConfig: NotebookLmConfig = {
  enabled: true,
  auth: {
    profile: "default",
    cookieFile: "/tmp/notebooklm-cookies.txt",
    autoRefresh: false,
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
    enabled: true,
    command: "python",
    args: ["/tmp/notebooklm-cli-recall.py", "write", "{payloadFile}", "{notebookId}"],
    timeoutMs: 1000,
    notebookId: "nb-1",
  },
};

describe("getNotebookLmProviderState", () => {
  beforeEach(() => {
    execFileMock.mockReset();
  });

  afterEach(() => {
    vi.resetModules();
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
    execFileMock
      .mockImplementationOnce((_command, _args, _options, callback) => {
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
    expect(second.details).toContain("refresh cooldown active");
    expect(execFileMock).toHaveBeenCalledTimes(1);
  });
});
