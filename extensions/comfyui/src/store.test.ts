import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  appendWorkflowRunRecord,
  listWorkflowArtifacts,
  listWorkflowOutputSummaries,
  listWorkflowRunRecords,
  loadWorkflowArtifacts,
  saveWorkflowArtifacts,
} from "./store.js";
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

  it("lists saved workflows with last run status and output count", async () => {
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
        diagnostics: [
          { code: "invalid_choice", severity: "warning", message: "missing size hint" },
        ],
      },
      now: () => new Date("2026-04-26T00:00:00.000Z"),
    });
    await appendWorkflowRunRecord({
      workflowsDir,
      workflowId: saved.workflowId,
      record: {
        workflowId: saved.workflowId,
        promptId: "prompt-1",
        status: "success",
        startedAt: "2026-04-26T00:01:00.000Z",
        completedAt: "2026-04-26T00:01:05.000Z",
        outputs: [
          {
            type: "image",
            nodeId: "1",
            filename: "out.png",
            subfolder: "",
            kind: "image",
          },
        ],
      },
    });

    const workflows = await listWorkflowArtifacts({ workflowsDir });

    expect(workflows).toMatchObject([
      {
        workflowId: saved.workflowId,
        goal: imageIrFixture.goal,
        diagnosticsCount: 1,
        outputCount: 1,
        promptId: "prompt-1",
        lastRun: { status: "success", promptId: "prompt-1" },
      },
    ]);
    expect(workflows[0]?.paths).toEqual({
      irPath: saved.irPath,
      promptPath: saved.promptPath,
      metaPath: saved.metaPath,
    });
  });

  it("skips malformed workflow metadata while still returning valid workflows", async () => {
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
    });
    await writeFile(path.join(workflowsDir, "broken.meta.json"), "{bad json", "utf8");
    await writeFile(
      path.join(workflowsDir, "invalid-kind.meta.json"),
      JSON.stringify({
        goal: "Invalid media kind",
        baseUrl: "http://127.0.0.1:8188",
        catalogFingerprint: "abc",
        mediaKind: "not-real",
        diagnostics: [],
      }),
      "utf8",
    );

    const workflows = await listWorkflowArtifacts({ workflowsDir });

    expect(workflows.map((workflow) => workflow.workflowId)).toEqual([saved.workflowId]);
  });

  it("rejects invalid workflow ids that could escape the workflow root", async () => {
    const workflowsDir = await createTempDir();

    await expect(loadWorkflowArtifacts({ workflowsDir, workflowId: "../outside" })).rejects.toThrow(
      "Invalid ComfyUI workflow id",
    );
  });

  it("lists run records and output summaries newest first while skipping malformed JSONL lines", async () => {
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
    });
    await writeFile(
      path.join(workflowsDir, `${saved.workflowId}.runs.jsonl`),
      [
        JSON.stringify({
          workflowId: saved.workflowId,
          promptId: "old",
          status: "success",
          startedAt: "2026-04-26T00:00:00.000Z",
          outputs: [
            {
              type: "image",
              nodeId: "1",
              filename: "old.png",
              subfolder: "",
              kind: "image",
            },
          ],
        }),
        "{bad json",
        "",
        JSON.stringify({
          workflowId: saved.workflowId,
          promptId: "new",
          status: "failed",
          startedAt: "2026-04-26T00:02:00.000Z",
          error: "boom",
          outputs: [
            {
              type: "image",
              nodeId: "1",
              filename: "new.png",
              subfolder: "",
              kind: "image",
            },
          ],
        }),
      ].join("\n"),
      "utf8",
    );

    const runs = await listWorkflowRunRecords({ workflowsDir, workflowId: saved.workflowId });
    const outputs = await listWorkflowOutputSummaries({
      workflowsDir,
      workflowId: saved.workflowId,
    });

    expect(runs.map((run) => run.promptId)).toEqual(["new", "old"]);
    expect(outputs.map((output) => output.filename)).toEqual(["new.png", "old.png"]);
    expect(outputs[0]).toMatchObject({
      workflowId: saved.workflowId,
      promptId: "new",
      status: "failed",
      createdAt: "2026-04-26T00:02:00.000Z",
    });
  });

  it("filters mismatched workflow ids from a requested run file", async () => {
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
    });
    await writeFile(
      path.join(workflowsDir, `${saved.workflowId}.runs.jsonl`),
      [
        JSON.stringify({
          workflowId: "other-workflow",
          promptId: "wrong",
          status: "success",
          startedAt: "2026-04-26T00:01:00.000Z",
        }),
        JSON.stringify({
          workflowId: saved.workflowId,
          promptId: "right",
          status: "success",
          startedAt: "2026-04-26T00:00:00.000Z",
        }),
      ].join("\n"),
      "utf8",
    );

    const runs = await listWorkflowRunRecords({ workflowsDir, workflowId: saved.workflowId });

    expect(runs.map((run) => run.promptId)).toEqual(["right"]);
  });

  it("drops malformed output entries from output summaries", async () => {
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
    });
    await writeFile(
      path.join(workflowsDir, `${saved.workflowId}.runs.jsonl`),
      JSON.stringify({
        workflowId: saved.workflowId,
        promptId: "mixed",
        status: "success",
        startedAt: "2026-04-26T00:00:00.000Z",
        outputs: [
          "bad",
          {
            type: "image",
            nodeId: "2",
            filename: "invalid.png",
            localPath: 1,
            kind: "image",
          },
          {
            kind: "not-real",
            nodeId: "1",
            filename: "x.png",
          },
          {
            type: "image",
            nodeId: "1",
            filename: "valid.png",
            subfolder: "",
            kind: "image",
          },
        ],
      }),
      "utf8",
    );

    const outputs = await listWorkflowOutputSummaries({
      workflowsDir,
      workflowId: saved.workflowId,
    });

    expect(outputs.map((output) => output.filename)).toEqual(["valid.png"]);
  });

  it("applies output summary limit after flattening run outputs", async () => {
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
    });
    await writeFile(
      path.join(workflowsDir, `${saved.workflowId}.runs.jsonl`),
      [
        JSON.stringify({
          workflowId: saved.workflowId,
          promptId: "old",
          status: "success",
          startedAt: "2026-04-26T00:00:00.000Z",
          outputs: [
            {
              type: "image",
              nodeId: "1",
              filename: "old-1.png",
              subfolder: "",
              kind: "image",
            },
            {
              type: "image",
              nodeId: "2",
              filename: "old-2.png",
              subfolder: "",
              kind: "image",
            },
          ],
        }),
        JSON.stringify({
          workflowId: saved.workflowId,
          promptId: "new",
          status: "success",
          startedAt: "2026-04-26T00:01:00.000Z",
          outputs: [],
        }),
      ].join("\n"),
      "utf8",
    );

    const outputs = await listWorkflowOutputSummaries({
      workflowsDir,
      workflowId: saved.workflowId,
      limit: 1,
    });

    expect(outputs.map((output) => output.filename)).toEqual(["old-1.png"]);
  });
});
