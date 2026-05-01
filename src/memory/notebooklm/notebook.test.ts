import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NotebookLmConfig } from "../types/config.ts";

const execFileMock = vi.fn();

vi.mock("node:child_process", () => ({
  execFile: (...args: unknown[]) => execFileMock(...args),
}));

const baseConfig: NotebookLmConfig = {
  enabled: true,
  auth: {
    profile: "work",
    cookieFile: "",
    statusTtlMs: 60_000,
    degradedCooldownMs: 120_000,
    refreshCooldownMs: 180_000,
    heartbeat: { enabled: true, minIntervalMs: 1_000, maxIntervalMs: 2_000 },
  },
  cli: {
    enabled: true,
    command: "nlm",
    args: ["notebook", "query", "{notebookId}", "{query}", "--json", "--profile", "{profile}"],
    timeoutMs: 1000,
    limit: 5,
    notebookId: "",
  },
  write: {
    enabled: false,
    command: "",
    args: ["{payloadFile}"],
    timeoutMs: 1000,
    notebookId: "",
  },
};

describe("ensureNotebookLmNotebook", () => {
  beforeEach(() => {
    execFileMock.mockReset();
  });

  it("selects an existing CrawClaw notebook by title", async () => {
    execFileMock.mockImplementation((_command, _args, _options, callback) => {
      callback(
        null,
        JSON.stringify([
          { id: "other", title: "Other", source_count: 1 },
          { id: "nb-crawclaw", title: "CrawClaw", source_count: 3 },
        ]),
      );
    });

    const { ensureNotebookLmNotebook } = await import("./notebook.ts");
    const result = await ensureNotebookLmNotebook({ config: baseConfig });

    expect(result).toEqual({
      status: "selected",
      notebookId: "nb-crawclaw",
      title: "CrawClaw",
      profile: "work",
      sourceCount: 3,
    });
    expect(execFileMock).toHaveBeenCalledWith(
      "nlm",
      ["notebook", "list", "--json", "--profile", "work"],
      expect.objectContaining({ timeout: 30_000 }),
      expect.any(Function),
    );
  });

  it("creates a CrawClaw notebook when none exists", async () => {
    execFileMock
      .mockImplementationOnce((_command, _args, _options, callback) => {
        callback(null, JSON.stringify([{ id: "other", title: "Other", source_count: 1 }]));
      })
      .mockImplementationOnce((_command, _args, _options, callback) => {
        callback(null, "✓ Notebook created\n  ID: nb-new\n");
      });

    const { ensureNotebookLmNotebook } = await import("./notebook.ts");
    const result = await ensureNotebookLmNotebook({ config: baseConfig });

    expect(result).toEqual({
      status: "created",
      notebookId: "nb-new",
      title: "CrawClaw",
      profile: "work",
      sourceCount: 0,
    });
    expect(execFileMock.mock.calls[1]?.[1]).toEqual([
      "notebook",
      "create",
      "CrawClaw",
      "--profile",
      "work",
    ]);
  });

  it("retries notebook creation once after a transient NotebookLM API error", async () => {
    execFileMock
      .mockImplementationOnce((_command, _args, _options, callback) => {
        callback(null, JSON.stringify([]));
      })
      .mockImplementationOnce((_command, _args, _options, callback) => {
        callback(
          new Error("Command failed"),
          "",
          '{"status":"error","error":"API error (code 7): type.googleapis.com/google.rpc.ErrorInfo"}',
        );
      })
      .mockImplementationOnce((_command, _args, _options, callback) => {
        callback(null, "✓ Notebook created\n  ID: nb-retry\n");
      });

    const { ensureNotebookLmNotebook } = await import("./notebook.ts");
    const result = await ensureNotebookLmNotebook({ config: baseConfig });

    expect(result).toEqual(
      expect.objectContaining({
        status: "created",
        notebookId: "nb-retry",
      }),
    );
    expect(execFileMock).toHaveBeenCalledTimes(3);
  });

  it("does not create a notebook when creation is disabled", async () => {
    execFileMock.mockImplementation((_command, _args, _options, callback) => {
      callback(null, JSON.stringify([]));
    });

    const { ensureNotebookLmNotebook } = await import("./notebook.ts");

    await expect(ensureNotebookLmNotebook({ config: baseConfig, create: false })).rejects.toThrow(
      'NotebookLM notebook "CrawClaw" was not found.',
    );
    expect(execFileMock).toHaveBeenCalledTimes(1);
  });
});
