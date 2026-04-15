import fs from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import { SqliteRuntimeStore } from "../../memory/runtime/sqlite-runtime-store.ts";
import { createTrackedTempDirs } from "../../test-utils/tracked-temp-dirs.js";
import { createContextArchiveService } from "./service.js";

const tempDirs = createTrackedTempDirs();
const stores: SqliteRuntimeStore[] = [];

afterEach(async () => {
  await Promise.all(stores.splice(0).map((store) => store.close()));
  await tempDirs.cleanup();
});

async function createArchiveFixture() {
  const rootDir = await tempDirs.make("context-archive-");
  const dbPath = `${rootDir}/runtime.sqlite`;
  const runtimeStore = new SqliteRuntimeStore(dbPath);
  await runtimeStore.init();
  stores.push(runtimeStore);
  return createContextArchiveService({
    runtimeStore,
    rootDir: `${rootDir}/archive`,
  });
}

describe("context archive service", () => {
  it("creates indexed runs and appends append-only events", async () => {
    const archive = await createArchiveFixture();

    const run = await archive.createRun({
      sessionId: "session-1",
      sessionKey: "agent:main:session-1",
      taskId: "task-1",
      agentId: "main",
      label: "main-run",
      metadata: { source: "test" },
    });

    const event = await archive.appendEvent({
      runId: run.id,
      type: "turn.model_visible_context",
      payload: { prompt: "hello", messages: [{ role: "user", content: "hi" }] },
      blobKeys: ["schema.tools"],
    });

    const readRun = await archive.readRun(run.id);
    const events = await archive.readEvents(run.id, { hydratePayload: true });
    const blobs = await archive.listBlobs(run.id);
    const runIds = await archive.listRunIds();

    expect(readRun).toMatchObject({
      id: run.id,
      sessionId: "session-1",
      sessionKey: "agent:main:session-1",
      taskId: "task-1",
      agentId: "main",
      label: "main-run",
      metadata: { source: "test" },
    });
    expect(event.type).toBe("turn.model_visible_context");
    expect(events).toHaveLength(1);
    expect(events[0]?.payload).toMatchObject({
      prompt: "hello",
      messages: [{ role: "user", content: "hi" }],
    });
    expect(events[0]?.blobKeys).toEqual(["schema.tools"]);
    expect(blobs).toHaveLength(1);
    expect(blobs[0]?.blobKey).toBe("event.1.payload");
    expect(runIds).toContain(run.id);
  });

  it("reports usage and prunes expired runs by age and total size", async () => {
    const archive = await createArchiveFixture();
    const day = 24 * 60 * 60 * 1000;
    const staleRun = await archive.createRun({
      sessionId: "session-stale",
      conversationUid: "session-stale",
      kind: "session",
      createdAt: 0,
    });
    await archive.putBlob({
      runId: staleRun.id,
      blobKey: "stale.payload",
      content: "abc",
      createdAt: 0,
    });

    const freshRun = await archive.createRun({
      sessionId: "session-fresh",
      conversationUid: "session-fresh",
      kind: "session",
      createdAt: 2 * day + 1,
    });
    await archive.putBlob({
      runId: freshRun.id,
      blobKey: "fresh.payload",
      content: "defgh",
      createdAt: 2 * day + 1,
    });

    await expect(archive.getUsage()).resolves.toMatchObject({
      runCount: 2,
      blobCount: 2,
      eventCount: 0,
      totalBytes: 8,
    });

    const report = await archive.pruneRetention({
      now: 3 * day,
      retentionDays: 1,
      maxTotalBytes: 4,
    });

    expect(report).toMatchObject({
      checkedRunCount: 2,
      prunedRunCount: 2,
      totalBytesBefore: 8,
      totalBytesAfter: 0,
      reclaimedBytes: 8,
      retainedRunCount: 0,
      dryRun: false,
    });
    expect(await archive.readRun(staleRun.id)).toBeNull();
    expect(await archive.readRun(freshRun.id)).toBeNull();
    await expect(archive.getUsage()).resolves.toMatchObject({
      runCount: 0,
      blobCount: 0,
      eventCount: 0,
      totalBytes: 0,
    });
  });

  it("stores custom blobs in the runtime index and reads them back", async () => {
    const archive = await createArchiveFixture();
    const run = await archive.createRun({
      sessionId: "session-2",
      kind: "session",
    });

    const blob = await archive.putBlob({
      runId: run.id,
      blobKey: "model-visible-context",
      blobKind: "prompt",
      content: { prompt: "hello", tools: ["read", "exec"] },
      metadata: { section: "model-visible" },
    });

    const record = await archive.readBlobRecord(run.id, "model-visible-context");
    const payload = await archive.readBlobJson<{ prompt: string; tools: string[] }>(
      run.id,
      "model-visible-context",
    );

    expect(blob.runId).toBe(run.id);
    expect(record).toMatchObject({
      runId: run.id,
      blobKey: "model-visible-context",
      blobKind: "prompt",
      metadata: { section: "model-visible" },
    });
    expect(payload).toEqual({ prompt: "hello", tools: ["read", "exec"] });
  });

  it("replaces oversized blobs with placeholder payloads", async () => {
    const archive = await createArchiveFixture();
    const run = await archive.createRun({
      sessionId: "session-oversized",
      kind: "session",
    });

    const strictArchive = createContextArchiveService({
      runtimeStore: stores.at(-1)!,
      rootDir: archive.rootDir,
      maxBlobBytes: 8,
    });

    const blob = await strictArchive.putBlob({
      runId: run.id,
      blobKey: "oversized",
      content: "this is definitely larger than eight bytes",
    });
    const payload = await strictArchive.readBlobJson<Record<string, unknown>>(run.id, "oversized");

    expect(blob.metadata).toMatchObject({
      archiveOmitted: true,
      originalSizeBytes: expect.any(Number),
    });
    expect(payload).toMatchObject({
      omitted: true,
      reason: "max_blob_bytes_exceeded",
      maxBlobBytes: 8,
    });
  });

  it("describes matching archive runs with file refs for inspection", async () => {
    const archive = await createArchiveFixture();
    const run = await archive.createRun({
      sessionId: "session-3",
      conversationUid: "run-3",
      kind: "turn",
      archiveMode: "replay",
      status: "complete",
      agentId: "worker",
      metadata: { runId: "agent-run-3" },
    });
    await archive.putBlob({
      runId: run.id,
      blobKey: "payload",
      content: { prompt: "inspect me" },
    });

    const inspection = await archive.inspect({ runId: "agent-run-3" });

    expect(inspection.runs).toHaveLength(1);
    expect(inspection.runs[0]).toMatchObject({
      id: run.id,
      metadata: { runId: "agent-run-3" },
      refs: {
        runRef: `${archive.rootDir}/runs/${run.id}.json`,
        eventsRef: `${archive.rootDir}/events/${run.id}.jsonl`,
      },
    });
    expect(inspection.runs[0]?.refs.blobRefs[0]).toContain(`${archive.rootDir}/blobs/`);
  });

  it("writes run and event mirror files that match the advertised refs", async () => {
    const archive = await createArchiveFixture();
    const run = await archive.createRun({
      sessionId: "session-4",
      taskId: "task-4",
      agentId: "main",
      status: "recording",
    });
    await archive.appendEvent({
      runId: run.id,
      type: "turn.model_output",
      turnIndex: 1,
      payload: { text: "done" },
    });

    const described = await archive.describeRun(run.id);
    const runJson = JSON.parse(await fs.readFile(described!.refs.runRef, "utf8")) as {
      id: string;
      status: string;
    };
    const eventLines = (await fs.readFile(described!.refs.eventsRef, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { type: string; payload?: unknown });

    expect(runJson).toMatchObject({
      id: run.id,
      status: "recording",
    });
    expect(eventLines).toHaveLength(1);
    expect(eventLines[0]).toMatchObject({
      type: "turn.model_output",
    });
    expect(eventLines[0]).not.toHaveProperty("payload");
  });
});
