import { beforeEach, describe, expect, it, vi } from "vitest";

const runPluginCommandWithTimeoutMock = vi.hoisted(() => vi.fn());

vi.mock("crawclaw/plugin-sdk/sandbox", () => ({
  runPluginCommandWithTimeout: runPluginCommandWithTimeoutMock,
}));

import { getFeishuCliStatus, runInteractiveLarkCliCommand, runLarkCliJson } from "./lark-cli.js";

describe("feishu-cli lark-cli runtime", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("marks status ready when version and auth succeed", async () => {
    runPluginCommandWithTimeoutMock
      .mockResolvedValueOnce({
        code: 0,
        stdout: "lark-cli version 1.0.7\n",
        stderr: "",
      })
      .mockResolvedValueOnce({
        code: 0,
        stdout: JSON.stringify({ ok: true, data: { profile: "default" } }),
        stderr: "",
      });

    const status = await getFeishuCliStatus({
      config: { enabled: true, command: "lark-cli", timeoutMs: 30_000, profile: "default" },
    });

    expect(status.installed).toBe(true);
    expect(status.authOk).toBe(true);
    expect(status.status).toBe("ready");
    expect(status.version).toBe("1.0.7");
    expect(runPluginCommandWithTimeoutMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        argv: ["lark-cli", "--profile", "default", "auth", "status"],
      }),
    );
  });

  it("marks status not_configured when auth status reports config error", async () => {
    runPluginCommandWithTimeoutMock
      .mockResolvedValueOnce({
        code: 0,
        stdout: "lark-cli version 1.0.7\n",
        stderr: "",
      })
      .mockResolvedValueOnce({
        code: 2,
        stdout: JSON.stringify({
          ok: false,
          error: {
            type: "config",
            message: "not configured",
            hint: "run `lark-cli config init --new`",
          },
        }),
        stderr: "",
      });

    const status = await getFeishuCliStatus({
      config: { enabled: true, command: "lark-cli", timeoutMs: 30_000 },
    });

    expect(status.authOk).toBe(false);
    expect(status.status).toBe("not_configured");
    expect(status.hint).toContain("config init");
  });

  it("normalizes auth recovery text to crawclaw wrapper commands", async () => {
    runPluginCommandWithTimeoutMock
      .mockResolvedValueOnce({
        code: 0,
        stdout: "lark-cli version 1.0.7\n",
        stderr: "",
      })
      .mockResolvedValueOnce({
        code: 2,
        stdout: JSON.stringify({
          ok: false,
          error: {
            type: "auth",
            message: "Run lark-cli auth login first.",
            hint: "Retry lark-cli auth login and then lark-cli auth status.",
          },
        }),
        stderr: "",
      });

    const status = await getFeishuCliStatus({
      config: { enabled: true, command: "lark-cli", timeoutMs: 30_000 },
    });

    expect(status.message).toContain("crawclaw feishu-cli auth login");
    expect(status.hint).toContain("crawclaw feishu-cli auth login");
    expect(status.hint).toContain("crawclaw feishu-cli status");
  });

  it("returns installed=false when lark-cli is missing", async () => {
    runPluginCommandWithTimeoutMock.mockResolvedValueOnce({
      code: 1,
      stdout: "",
      stderr: "spawn lark-cli ENOENT",
    });

    const status = await getFeishuCliStatus({
      config: { enabled: true, command: "lark-cli", timeoutMs: 30_000 },
    });

    expect(status.installed).toBe(false);
    expect(status.authOk).toBe(false);
    expect(status.message).toContain("ENOENT");
  });

  it("parses json payload from stdout for business commands", async () => {
    runPluginCommandWithTimeoutMock.mockResolvedValueOnce({
      code: 0,
      stdout: JSON.stringify({ ok: true, items: [{ id: "msg_1" }] }),
      stderr: "",
    });

    const result = await runLarkCliJson({ enabled: true, command: "lark-cli", timeoutMs: 30_000 }, [
      "im",
      "+messages-search",
      "--as",
      "user",
      "--format",
      "json",
      "--query",
      "hello",
    ]);

    expect(result.payload).toEqual({ ok: true, items: [{ id: "msg_1" }] });
  });

  it("launches interactive auth commands with inherited stdio", () => {
    const spawnSync = vi.fn().mockReturnValue({
      pid: 123,
      output: [],
      stdout: null,
      stderr: null,
      status: 0,
      signal: null,
    });

    const exitCode = runInteractiveLarkCliCommand({
      config: { enabled: true, command: "lark-cli", timeoutMs: 30_000, profile: "default" },
      args: ["auth", "login"],
      spawnSyncImpl: spawnSync as never,
    });

    expect(exitCode).toBe(0);
    expect(spawnSync).toHaveBeenCalledWith(
      "lark-cli",
      ["--profile", "default", "auth", "login"],
      expect.objectContaining({ stdio: "inherit" }),
    );
  });
});
