import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { compileGraphIrToPrompt } from "./compiler.js";
import { listWorkflowRunRecords, saveWorkflowArtifacts } from "./store.js";
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

async function saveImageWorkflow(workflowsDir: string) {
  return saveWorkflowArtifacts({
    workflowsDir,
    ir: imageIrFixture,
    prompt: compileGraphIrToPrompt(imageIrFixture),
    meta: {
      goal: imageIrFixture.goal,
      baseUrl: "http://127.0.0.1:8188",
      catalogFingerprint: "test",
      mediaKind: imageIrFixture.mediaKind,
      diagnostics: [],
    },
  });
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

  it("records successful saved workflow runs with output filenames", async () => {
    const workspaceDir = await createTempDir();
    const workflowsDir = path.join(workspaceDir, ".crawclaw/comfyui/workflows");
    const saved = await saveImageWorkflow(workflowsDir);
    const history = {
      "prompt-1": {
        status: { status_str: "success", completed: true },
        outputs: {
          "7": {
            images: [{ filename: "saved.png", subfolder: "", type: "output" }],
          },
        },
      },
    };
    const tool = createComfyUiWorkflowTool(
      { workspaceDir },
      {
        pluginConfig: { runPollIntervalMs: 1 },
        createClient: () =>
          ({
            getObjectInfo: vi.fn(async () => objectInfoFixture),
            submitPrompt: vi.fn(async () => ({ prompt_id: "prompt-1", number: 1 })),
            getHistory: vi.fn(async () => history),
          }) as never,
      },
    );

    const result = parseToolJson(
      await tool.execute("call-1", {
        action: "run",
        workflowId: saved.workflowId,
        waitForCompletion: true,
      }),
    );

    expect(result).toMatchObject({ ok: true, action: "run", promptId: "prompt-1" });
    const records = await listWorkflowRunRecords({ workflowsDir, workflowId: saved.workflowId });
    expect(records).toMatchObject([
      {
        workflowId: saved.workflowId,
        promptId: "prompt-1",
        status: "success",
        outputs: [{ filename: "saved.png" }],
      },
    ]);
    expect(records[0]?.completedAt).toEqual(expect.any(String));
    expect(records[0]?.durationMs).toEqual(expect.any(Number));
  });

  it("returns successful saved workflow run results when history append fails", async () => {
    const workspaceDir = await createTempDir();
    const workflowsDir = path.join(workspaceDir, ".crawclaw/comfyui/workflows");
    const saved = await saveImageWorkflow(workflowsDir);
    await mkdir(path.join(workflowsDir, `${saved.workflowId}.runs.jsonl`));
    const history = {
      "prompt-history-success": {
        status: { status_str: "success", completed: true },
        outputs: {
          "7": {
            images: [{ filename: "history-failure.png", subfolder: "", type: "output" }],
          },
        },
      },
    };
    const tool = createComfyUiWorkflowTool(
      { workspaceDir },
      {
        pluginConfig: { runPollIntervalMs: 1 },
        createClient: () =>
          ({
            getObjectInfo: vi.fn(async () => objectInfoFixture),
            submitPrompt: vi.fn(async () => ({ prompt_id: "prompt-history-success", number: 1 })),
            getHistory: vi.fn(async () => history),
          }) as never,
      },
    );

    const result = parseToolJson(
      await tool.execute("call-1", {
        action: "run",
        workflowId: saved.workflowId,
        waitForCompletion: true,
      }),
    );

    expect(result).toMatchObject({
      ok: true,
      action: "run",
      promptId: "prompt-history-success",
      outputs: [{ filename: "history-failure.png" }],
    });
  });

  it("records failed waited saved workflow runs before rethrowing", async () => {
    const workspaceDir = await createTempDir();
    const workflowsDir = path.join(workspaceDir, ".crawclaw/comfyui/workflows");
    const saved = await saveImageWorkflow(workflowsDir);
    const tool = createComfyUiWorkflowTool(
      { workspaceDir },
      {
        pluginConfig: { runPollIntervalMs: 1 },
        createClient: () =>
          ({
            getObjectInfo: vi.fn(async () => objectInfoFixture),
            submitPrompt: vi.fn(async () => ({ prompt_id: "prompt-2", number: 1 })),
            getHistory: vi.fn(async () => ({
              "prompt-2": { status: { status_str: "error" } },
            })),
          }) as never,
      },
    );

    await expect(
      tool.execute("call-1", {
        action: "run",
        workflowId: saved.workflowId,
        waitForCompletion: true,
      }),
    ).rejects.toThrow("failed with status: error");

    const records = await listWorkflowRunRecords({ workflowsDir, workflowId: saved.workflowId });
    expect(records).toMatchObject([
      {
        workflowId: saved.workflowId,
        promptId: "prompt-2",
        status: "failed",
        error: "ComfyUI prompt prompt-2 failed with status: error",
      },
    ]);
    expect(records[0]?.completedAt).toEqual(expect.any(String));
    expect(records[0]?.durationMs).toEqual(expect.any(Number));
  });

  it("rethrows the original ComfyUI error when failed run history append fails", async () => {
    const workspaceDir = await createTempDir();
    const workflowsDir = path.join(workspaceDir, ".crawclaw/comfyui/workflows");
    const saved = await saveImageWorkflow(workflowsDir);
    await mkdir(path.join(workflowsDir, `${saved.workflowId}.runs.jsonl`));
    const tool = createComfyUiWorkflowTool(
      { workspaceDir },
      {
        pluginConfig: { runPollIntervalMs: 1 },
        createClient: () =>
          ({
            getObjectInfo: vi.fn(async () => objectInfoFixture),
            submitPrompt: vi.fn(async () => ({ prompt_id: "prompt-history-failure", number: 1 })),
            getHistory: vi.fn(async () => ({
              "prompt-history-failure": { status: { status_str: "error" } },
            })),
          }) as never,
      },
    );

    await expect(
      tool.execute("call-1", {
        action: "run",
        workflowId: saved.workflowId,
        waitForCompletion: true,
      }),
    ).rejects.toThrow("ComfyUI prompt prompt-history-failure failed with status: error");
  });

  it("records no workflow history for direct IR runs", async () => {
    const workspaceDir = await createTempDir();
    const workflowsDir = path.join(workspaceDir, ".crawclaw/comfyui/workflows");
    const tool = createComfyUiWorkflowTool(
      { workspaceDir },
      {
        createClient: () =>
          ({
            getObjectInfo: vi.fn(async () => objectInfoFixture),
            submitPrompt: vi.fn(async () => ({ prompt_id: "prompt-3", number: 1 })),
          }) as never,
      },
    );

    const result = parseToolJson(
      await tool.execute("call-1", {
        action: "run",
        ir: imageIrFixture,
      }),
    );

    expect(result).toMatchObject({ ok: true, action: "run", promptId: "prompt-3" });
    await expect(listWorkflowRunRecords({ workflowsDir })).resolves.toEqual([]);
  });
});
