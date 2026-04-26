import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { imageIrFixture, objectInfoFixture } from "./test-fixtures.js";
import { createComfyUiWorkflowTool } from "./tool.js";

const tempDirs: string[] = [];

async function createTempDir() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "crawclaw-comfyui-tool-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function parseToolJson(result: unknown) {
  const text = (result as { content: Array<{ text: string }> }).content[0]?.text ?? "{}";
  return JSON.parse(text) as Record<string, unknown>;
}

describe("comfyui_workflow tool", () => {
  it("inspects the local ComfyUI catalog", async () => {
    const workspaceDir = await createTempDir();
    const tool = createComfyUiWorkflowTool(
      { workspaceDir },
      {
        createClient: () =>
          ({
            getObjectInfo: vi.fn(async () => objectInfoFixture),
            getSystemStats: vi.fn(async () => ({ system: "ok" })),
          }) as never,
      },
    );

    const result = parseToolJson(await tool.execute("call-1", { action: "inspect" }));

    expect(result).toMatchObject({ ok: true, action: "inspect" });
    expect(result.nodeCount).toBeGreaterThan(0);
  });

  it("creates and saves a validated workflow", async () => {
    const workspaceDir = await createTempDir();
    const tool = createComfyUiWorkflowTool(
      { workspaceDir },
      {
        createClient: () =>
          ({
            getObjectInfo: vi.fn(async () => objectInfoFixture),
          }) as never,
      },
    );

    const result = parseToolJson(
      await tool.execute("call-1", {
        action: "create",
        goal: "Create a neon crab image",
        mediaKind: "image",
        save: true,
      }),
    );

    expect(result).toMatchObject({
      ok: true,
      action: "create",
      workflowId: "create-a-neon-crab-image",
    });
  });

  it("rejects raw ComfyUI prompt JSON on run", async () => {
    const workspaceDir = await createTempDir();
    const tool = createComfyUiWorkflowTool({ workspaceDir });

    await expect(
      tool.execute("call-1", {
        action: "run",
        prompt: { "1": { class_type: "SaveImage", inputs: {} } },
      }),
    ).rejects.toThrow(/raw prompt json/i);
  });

  it("waits for completion before downloading run outputs", async () => {
    const workspaceDir = await createTempDir();
    const history = {
      "prompt-1": {
        status: { status_str: "success", completed: true },
        outputs: {
          "7": {
            images: [{ filename: "a.png", subfolder: "", type: "output" }],
          },
        },
      },
    };
    const getHistory = vi.fn(async () => history);
    const tool = createComfyUiWorkflowTool(
      { workspaceDir },
      {
        pluginConfig: { runPollIntervalMs: 1 },
        createClient: () =>
          ({
            getObjectInfo: vi.fn(async () => objectInfoFixture),
            submitPrompt: vi.fn(async () => ({ prompt_id: "prompt-1", number: 1 })),
            getHistory,
            downloadView: vi.fn(async () => new Uint8Array(Buffer.from("image-bytes"))),
          }) as never,
      },
    );

    const result = parseToolJson(
      await tool.execute("call-1", {
        action: "run",
        ir: imageIrFixture,
        downloadOutputs: true,
      }),
    );

    expect(getHistory).toHaveBeenCalledWith("prompt-1");
    expect(result.outputs).toEqual([
      expect.objectContaining({
        kind: "image",
        localPath: expect.stringContaining(path.join("prompt-1", "a.png")),
      }),
    ]);
  });
});
