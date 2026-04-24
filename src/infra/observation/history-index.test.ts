import { afterEach, describe, expect, it } from "vitest";
import { SqliteRuntimeStore } from "../../memory/runtime/sqlite-runtime-store.js";
import { createTrackedTempDirs } from "../../test-utils/tracked-temp-dirs.js";
import { createObservationRoot } from "./context.js";
import { backfillObservationIndex, indexObservationEvent } from "./history-index.js";

const tempDirs = createTrackedTempDirs();
const stores: SqliteRuntimeStore[] = [];

afterEach(async () => {
  await Promise.all(stores.splice(0).map(async (store) => store.close()));
  if (process.platform === "win32") {
    return;
  }
  await tempDirs.cleanup();
});

describe("observation history index", () => {
  it("indexes safe event metadata and deduplicates canonical event keys", async () => {
    const rootDir = await tempDirs.make("observation-history-index-");
    const store = new SqliteRuntimeStore(`${rootDir}/runtime.sqlite`);
    await store.init();
    stores.push(store);
    const observation = createObservationRoot({
      source: "test",
      runtime: {
        runId: "run-history",
        taskId: "task-history",
        sessionId: "session-history",
        sessionKey: "agent:main:main",
        agentId: "main",
      },
      trace: {
        traceId: "trace-history",
        spanId: "span-root-history",
        parentSpanId: null,
      },
    });

    await indexObservationEvent({
      store,
      eventKey: "lifecycle:run-history:turn_started",
      observation,
      source: "lifecycle",
      type: "run.lifecycle.turn_started",
      phase: "turn_started",
      status: "running",
      summary: "turn started",
      createdAt: 100,
      refs: {
        requestId: "request-history",
        prompt: "secret prompt body",
      },
      payloadRef: {
        archiveRunId: "carun-history",
        transcript: "secret transcript body",
      },
    });
    await indexObservationEvent({
      store,
      eventKey: "lifecycle:run-history:turn_started",
      observation,
      source: "lifecycle",
      type: "run.lifecycle.turn_started",
      phase: "turn_started",
      status: "running",
      summary: "turn started retry",
      createdAt: 100,
    });

    const runs = await store.listObservationRuns({ query: "run-history", limit: 10 });
    expect(runs.items).toEqual([
      expect.objectContaining({
        runId: "run-history",
        taskId: "task-history",
        traceId: "trace-history",
        status: "running",
        eventCount: 1,
        errorCount: 0,
        sourcesJson: JSON.stringify(["lifecycle"]),
      }),
    ]);

    const events = await store.listObservationEvents("trace-history", 10);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      eventKey: "lifecycle:run-history:turn_started",
      traceId: "trace-history",
      refsJson: JSON.stringify({ requestId: "request-history" }),
      payloadRefJson: JSON.stringify({ archiveRunId: "carun-history" }),
    });
    expect(JSON.stringify(events)).not.toContain("secret prompt body");
    expect(JSON.stringify(events)).not.toContain("secret transcript body");
  });

  it("backfills context archive events that already contain ObservationContext", async () => {
    const rootDir = await tempDirs.make("observation-history-backfill-");
    const store = new SqliteRuntimeStore(`${rootDir}/runtime.sqlite`);
    await store.init();
    stores.push(store);
    const observation = createObservationRoot({
      source: "run-loop",
      runtime: {
        runId: "run-archive",
        taskId: "task-archive",
        sessionId: "session-archive",
        agentId: "main",
      },
      trace: {
        traceId: "trace-archive",
        spanId: "span-root-archive",
        parentSpanId: null,
      },
    });
    const archiveRunId = await store.createContextArchiveRun({
      sessionId: "session-archive",
      conversationUid: "session-archive",
      runKind: "turn",
      status: "complete",
      taskId: "task-archive",
      agentId: "main",
      metadataJson: JSON.stringify({ observation }),
      createdAt: 500,
      updatedAt: 700,
    });
    await store.appendContextArchiveEvent({
      runId: archiveRunId,
      eventKind: "run.lifecycle.turn_started",
      payloadJson: JSON.stringify({
        phase: "turn_started",
        observation,
        refs: { requestId: "request-archive", message: "secret message body" },
      }),
      createdAt: 500,
    });
    await store.appendContextArchiveEvent({
      runId: archiveRunId,
      eventKind: "legacy.no_observation",
      payloadJson: JSON.stringify({ runId: "legacy-run" }),
      createdAt: 600,
    });

    await backfillObservationIndex({ store, stateDir: rootDir });

    const runs = await store.listObservationRuns({ query: "run-archive", limit: 10 });
    expect(runs.items).toEqual([
      expect.objectContaining({
        traceId: "trace-archive",
        runId: "run-archive",
        taskId: "task-archive",
        sourcesJson: JSON.stringify(["archive"]),
      }),
    ]);
    const events = await store.listObservationEvents("trace-archive", 10);
    expect(events).toHaveLength(1);
    expect(JSON.parse(events[0]?.payloadRefJson ?? "{}")).toMatchObject({
      archiveRunId,
      archiveEventId: expect.any(String),
    });
    expect(JSON.stringify(events)).not.toContain("secret message body");
  });
});
