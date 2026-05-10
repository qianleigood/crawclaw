import { describe, expect, it, vi, beforeEach } from "vitest";
import { createComfyUiWorkflowTool } from "./tool.js";

const nativeMocks = vi.hoisted(() => ({
  runNativePluginOperation: vi.fn(),
}));

vi.mock("crawclaw/plugin-sdk/native-plugin-runtime", () => ({
  runNativePluginOperation: nativeMocks.runNativePluginOperation,
}));

function parseToolJson(result: unknown) {
  const text = (result as { content: Array<{ text: string }> }).content[0]?.text ?? "{}";
  return JSON.parse(text) as Record<string, unknown>;
}

describe("comfyui_workflow tool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("delegates workflow actions to the Rust native plugin runtime", async () => {
    nativeMocks.runNativePluginOperation.mockResolvedValueOnce({
      ok: true,
      action: "inspect",
      baseUrl: "http://127.0.0.1:8188",
      nodeCount: 1,
    });
    const tool = createComfyUiWorkflowTool(
      { workspaceDir: "/tmp/workspace" },
      { pluginConfig: { requestTimeoutMs: 1234 } },
    );

    const result = parseToolJson(await tool.execute("call-1", { action: "inspect" }));

    expect(result).toMatchObject({ ok: true, action: "inspect" });
    expect(nativeMocks.runNativePluginOperation).toHaveBeenCalledWith({
      plugin: "comfyui",
      operation: "tool",
      input: {
        params: { action: "inspect" },
        pluginConfig: { requestTimeoutMs: 1234 },
        workspaceDir: "/tmp/workspace",
      },
      timeoutMs: 1234,
    });
  });

  it("uses run timeout for long-running ComfyUI actions", async () => {
    nativeMocks.runNativePluginOperation.mockResolvedValueOnce({
      ok: true,
      action: "run",
      promptId: "prompt-1",
    });
    const tool = createComfyUiWorkflowTool(
      { workspaceDir: "/tmp/workspace" },
      { pluginConfig: { runTimeoutMs: 5000, requestTimeoutMs: 100 } },
    );

    const result = parseToolJson(
      await tool.execute("call-2", {
        action: "run",
        ir: { id: "demo" },
      }),
    );

    expect(result).toMatchObject({ ok: true, promptId: "prompt-1" });
    expect(nativeMocks.runNativePluginOperation).toHaveBeenCalledWith(
      expect.objectContaining({
        timeoutMs: 5000,
      }),
    );
  });
});
