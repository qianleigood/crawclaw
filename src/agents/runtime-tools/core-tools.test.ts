import { beforeEach, describe, expect, it, vi } from "vitest";

const { runCrawClawRuntimeToolMock } = vi.hoisted(() => ({
  runCrawClawRuntimeToolMock: vi.fn(),
}));

async function loadCoreTools() {
  vi.resetModules();
  vi.doMock("./native.js", () => ({
    runCrawClawRuntimeTool: runCrawClawRuntimeToolMock,
  }));
  return await import("./core-tools.js");
}

describe("Rust core tool adapters", () => {
  beforeEach(() => {
    runCrawClawRuntimeToolMock.mockReset();
    runCrawClawRuntimeToolMock.mockResolvedValue({
      content: [{ type: "text", text: "ok" }],
      details: { status: "ok" },
    });
  });

  it("normalizes read/write/edit aliases before calling the Rust runtime", async () => {
    const { createRustEditTool, createRustReadTool, createRustWriteTool } = await loadCoreTools();
    const root = "/tmp/crawclaw-workspace";
    await createRustWriteTool(root).execute("write-1", {
      file_path: "a.txt",
      content: [{ type: "text", text: "hello" }],
    });
    await createRustEditTool(root).execute("edit-1", {
      file: "a.txt",
      old_string: [{ type: "text", text: "hello" }],
      newString: "hi",
    });
    await createRustReadTool(root).execute("read-1", {
      filePath: "a.txt",
    });

    expect(runCrawClawRuntimeToolMock).toHaveBeenNthCalledWith(
      1,
      "write",
      { path: "a.txt", content: "hello" },
      { runtimeRoot: root },
    );
    expect(runCrawClawRuntimeToolMock).toHaveBeenNthCalledWith(
      2,
      "edit",
      { path: "a.txt", oldText: "hello", newText: "hi" },
      { runtimeRoot: root },
    );
    expect(runCrawClawRuntimeToolMock).toHaveBeenNthCalledWith(
      3,
      "read",
      { path: "a.txt" },
      { runtimeRoot: root },
    );
  });

  it("routes session, cron, and special-agent tools through the Rust runtime", async () => {
    const { createRustCronTool, createRustSessionTool, createRustSpecialAgentTool } =
      await loadCoreTools();
    await createRustSessionTool("sessions_history", { sessionKey: "main" }).execute(
      "sessions-1",
      {},
    );
    await createRustCronTool({ sessionKey: "main" }).execute("cron-1", {
      action: "status",
    });
    await createRustSpecialAgentTool("memory_note_read", { scope: "main" }).execute("memory-1", {
      notePath: "notes/a.md",
    });

    expect(runCrawClawRuntimeToolMock).toHaveBeenNthCalledWith(
      1,
      "sessions_history",
      { sessionKey: "main" },
      undefined,
    );
    expect(runCrawClawRuntimeToolMock).toHaveBeenNthCalledWith(
      2,
      "cron",
      { sessionKey: "main", action: "status" },
      undefined,
    );
    expect(runCrawClawRuntimeToolMock).toHaveBeenNthCalledWith(
      3,
      "memory_note_read",
      { scope: "main", notePath: "notes/a.md" },
      undefined,
    );
  });
});
