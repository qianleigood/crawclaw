import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createTurixDesktopTool } from "./tool.js";

const tempDirs: string[] = [];

async function createTempDir() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "crawclaw-turix-tool-"));
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

describe("turix_desktop_run tool", () => {
  it("returns a plan without launching TuriX", async () => {
    const workspaceDir = await createTempDir();
    const runner = vi.fn();
    const tool = createTurixDesktopTool(
      { workspaceDir, senderIsOwner: true },
      {
        pluginConfig: {},
        env: { CRAWCLAW_STATE_DIR: workspaceDir },
        runner,
      },
    );

    const result = parseToolJson(
      await tool.execute("call-1", {
        task: "Open Calculator and compute 2+2",
        mode: "plan",
      }),
    );

    expect(result).toMatchObject({
      status: "planned",
      mode: "plan",
      task: "Open Calculator and compute 2+2",
    });
    expect(runner).not.toHaveBeenCalled();
  });

  it("rejects non-owner desktop runs", async () => {
    const workspaceDir = await createTempDir();
    const tool = createTurixDesktopTool(
      { workspaceDir, senderIsOwner: false },
      {
        pluginConfig: {},
        env: { CRAWCLAW_STATE_DIR: workspaceDir },
        runner: vi.fn(),
      },
    );

    await expect(
      tool.execute("call-1", {
        task: "Open Calculator",
        mode: "run",
      }),
    ).rejects.toThrow(/owner/i);
  });

  it("blocks channel-originated runs unless remote requests are enabled", async () => {
    const workspaceDir = await createTempDir();
    const tool = createTurixDesktopTool(
      {
        workspaceDir,
        senderIsOwner: true,
        deliveryContext: { channel: "telegram", to: "user-1" },
      },
      {
        pluginConfig: {},
        env: { CRAWCLAW_STATE_DIR: workspaceDir },
        runner: vi.fn(),
      },
    );

    await expect(
      tool.execute("call-1", {
        task: "Open Calculator",
        mode: "run",
      }),
    ).rejects.toThrow(/local desktop/i);
  });

  it("launches the runner for approved run mode", async () => {
    const workspaceDir = await createTempDir();
    const runner = vi.fn(async () => ({
      status: "completed" as const,
      runId: "call-1",
      summary: "TuriX run completed.",
      artifactRefs: { log: path.join(workspaceDir, "run.log") },
      warnings: [],
    }));
    const tool = createTurixDesktopTool(
      { workspaceDir, senderIsOwner: true },
      {
        pluginConfig: {
          runtime: {
            mode: "external",
            projectDir: workspaceDir,
            pythonPath: "/usr/bin/python3",
          },
          allowRemoteRequests: true,
        },
        env: { CRAWCLAW_STATE_DIR: workspaceDir },
        runner,
      },
    );

    const result = parseToolJson(
      await tool.execute("call-1", {
        task: "Open Calculator",
        mode: "run",
        maxSteps: 3,
        timeoutMs: 1000,
      }),
    );

    expect(runner).toHaveBeenCalledWith(
      expect.objectContaining({
        task: "Open Calculator",
        runId: "call-1",
        maxSteps: 3,
        timeoutMs: 1000,
      }),
    );
    expect(result).toMatchObject({
      status: "completed",
      runId: "call-1",
      summary: "TuriX run completed.",
    });
  });
});
