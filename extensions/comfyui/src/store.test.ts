import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { saveWorkflowArtifacts, loadWorkflowArtifacts } from "./store.js";
import { imageIrFixture } from "./test-fixtures.js";

const tempDirs: string[] = [];

async function createTempDir() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "crawclaw-comfyui-store-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("workflow artifact store", () => {
  it("saves IR, prompt JSON, and metadata sidecar", async () => {
    const workflowsDir = await createTempDir();

    const saved = await saveWorkflowArtifacts({
      workflowsDir,
      ir: imageIrFixture,
      prompt: { "1": { class_type: "Test", inputs: {} } },
      meta: {
        goal: imageIrFixture.goal,
        baseUrl: "http://127.0.0.1:8188",
        catalogFingerprint: "abc",
        mediaKind: "image",
        diagnostics: [],
      },
      now: () => new Date("2026-04-26T00:00:00.000Z"),
    });

    expect(saved.workflowId).toBe("create-a-neon-crab-image");
    await expect(readFile(saved.irPath, "utf8")).resolves.toContain('"mediaKind": "image"');
    const loaded = await loadWorkflowArtifacts({ workflowsDir, workflowId: saved.workflowId });
    expect(loaded.ir.goal).toBe(imageIrFixture.goal);
  });
});
