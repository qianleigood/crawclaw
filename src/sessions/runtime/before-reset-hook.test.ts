import { beforeEach, describe, expect, it, vi } from "vitest";
import type { HookRunner } from "../../plugins/hooks.js";

const fsMocks = vi.hoisted(() => ({
  readFile: vi.fn(),
  readdir: vi.fn(),
}));

vi.mock("node:fs/promises", () => ({
  default: {
    readFile: fsMocks.readFile,
    readdir: fsMocks.readdir,
  },
}));

const { emitBeforeResetPluginHook, loadBeforeResetTranscript } =
  await import("./before-reset-hook.js");

describe("loadBeforeResetTranscript", () => {
  beforeEach(() => {
    fsMocks.readFile.mockReset();
    fsMocks.readdir.mockReset();
  });

  it("falls back to the latest archived transcript when the live file is gone", async () => {
    fsMocks.readFile.mockRejectedValueOnce(Object.assign(new Error("ENOENT"), { code: "ENOENT" }));
    fsMocks.readdir.mockResolvedValueOnce([
      "prev-session.jsonl.reset.2026-02-16T22-26-33.000Z",
      "prev-session.jsonl.reset.2026-02-15T22-26-33.000Z",
    ]);
    fsMocks.readFile.mockResolvedValueOnce(
      `${JSON.stringify({
        type: "message",
        id: "m1",
        message: { role: "user", content: "Recovered from archive" },
      })}\n`,
    );

    const result = await loadBeforeResetTranscript({
      sessionFile: "/tmp/prev-session.jsonl",
    });

    expect(result).toEqual({
      sessionFile: "/tmp/prev-session.jsonl.reset.2026-02-16T22-26-33.000Z",
      messages: [{ role: "user", content: "Recovered from archive" }],
    });
  });
});

describe("emitBeforeResetPluginHook", () => {
  const hookRunner: Pick<HookRunner, "hasHooks" | "runBeforeReset"> = {
    hasHooks: vi.fn(),
    runBeforeReset: vi.fn(),
  };

  beforeEach(() => {
    vi.mocked(hookRunner.hasHooks)
      .mockReset()
      .mockImplementation((name) => name === "before_reset");
    vi.mocked(hookRunner.runBeforeReset).mockReset().mockResolvedValue(undefined);
  });

  it("emits the before_reset hook with the loaded transcript context", async () => {
    emitBeforeResetPluginHook({
      hookRunner,
      loadMessages: async () => ({
        sessionFile: "/tmp/prev-session.jsonl",
        messages: [{ role: "user", content: "before" }],
      }),
      reason: "reset",
      agentId: "main",
      sessionKey: "agent:main:telegram:direct:123",
      sessionId: "prev-session",
      workspaceDir: "/tmp/crawclaw-workspace",
    });

    await vi.waitFor(() => expect(hookRunner.runBeforeReset).toHaveBeenCalledTimes(1));
    expect(hookRunner.runBeforeReset).toHaveBeenCalledWith(
      {
        sessionFile: "/tmp/prev-session.jsonl",
        messages: [{ role: "user", content: "before" }],
        reason: "reset",
      },
      {
        agentId: "main",
        sessionKey: "agent:main:telegram:direct:123",
        sessionId: "prev-session",
        workspaceDir: "/tmp/crawclaw-workspace",
      },
    );
  });
});
