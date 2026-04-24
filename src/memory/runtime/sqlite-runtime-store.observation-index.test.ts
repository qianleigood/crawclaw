import { afterEach, describe, expect, it } from "vitest";
import { createTrackedTempDirs } from "../../test-utils/tracked-temp-dirs.js";
import { SqliteRuntimeStore } from "./sqlite-runtime-store.js";

const tempDirs = createTrackedTempDirs();
const stores: SqliteRuntimeStore[] = [];

afterEach(async () => {
  await Promise.all(stores.splice(0).map(async (store) => store.close()));
  if (process.platform === "win32") {
    return;
  }
  await tempDirs.cleanup();
});

describe("SqliteRuntimeStore observation index", () => {
  it("round-trips observation runs and events with filtering, cursor paging, and dedupe", async () => {
    const rootDir = await tempDirs.make("sqlite-observation-index-");
    const store = new SqliteRuntimeStore(`${rootDir}/runtime.sqlite`);
    await store.init();
    stores.push(store);

    await store.upsertObservationRun({
      traceId: "trace-a",
      rootSpanId: "span-root-a",
      runId: "run-a",
      taskId: "task-a",
      sessionId: "session-a",
      sessionKey: "agent:main:main",
      agentId: "main",
      status: "running",
      startedAt: 100,
      lastEventAt: 120,
      eventCount: 1,
      errorCount: 0,
      sourcesJson: JSON.stringify(["lifecycle"]),
      summary: "running main observation",
      createdAt: 100,
      updatedAt: 120,
    });
    await store.upsertObservationRun({
      traceId: "trace-b",
      rootSpanId: "span-root-b",
      runId: "run-b",
      taskId: "task-b",
      sessionId: "session-b",
      sessionKey: "agent:worker:main",
      agentId: "worker",
      status: "error",
      startedAt: 200,
      endedAt: 240,
      lastEventAt: 240,
      eventCount: 2,
      errorCount: 1,
      sourcesJson: JSON.stringify(["lifecycle", "trajectory"]),
      summary: "failed worker observation",
      createdAt: 200,
      updatedAt: 240,
    });

    await store.upsertObservationEvent({
      eventId: "event-a",
      eventKey: "lifecycle:run-a:turn_started:span-root-a",
      traceId: "trace-a",
      spanId: "span-root-a",
      parentSpanId: null,
      runId: "run-a",
      taskId: "task-a",
      sessionId: "session-a",
      sessionKey: "agent:main:main",
      agentId: "main",
      source: "lifecycle",
      type: "run.lifecycle.turn_started",
      phase: "turn_started",
      status: "running",
      summary: "turn started",
      observationJson: JSON.stringify({
        trace: { traceId: "trace-a", spanId: "span-root-a", parentSpanId: null },
        runtime: { runId: "run-a", taskId: "task-a" },
        source: "run-loop",
      }),
      refsJson: JSON.stringify({ requestId: "request-a" }),
      createdAt: 100,
    });
    await store.upsertObservationEvent({
      eventId: "event-a-retry",
      eventKey: "lifecycle:run-a:turn_started:span-root-a",
      traceId: "trace-a",
      spanId: "span-root-a",
      parentSpanId: null,
      runId: "run-a",
      taskId: "task-a",
      sessionId: "session-a",
      sessionKey: "agent:main:main",
      agentId: "main",
      source: "lifecycle",
      type: "run.lifecycle.turn_started",
      phase: "turn_started",
      status: "running",
      summary: "turn started retry",
      observationJson: JSON.stringify({
        trace: { traceId: "trace-a", spanId: "span-root-a", parentSpanId: null },
        runtime: { runId: "run-a", taskId: "task-a" },
        source: "run-loop",
      }),
      createdAt: 100,
    });

    await expect(store.listObservationRuns({ query: "task-a", limit: 10 })).resolves.toMatchObject({
      items: [
        expect.objectContaining({
          traceId: "trace-a",
          runId: "run-a",
          taskId: "task-a",
          status: "running",
        }),
      ],
    });
    await expect(
      store.listObservationRuns({ status: "error", source: "trajectory", from: 190, to: 250 }),
    ).resolves.toMatchObject({
      items: [expect.objectContaining({ traceId: "trace-b", status: "error" })],
    });

    const firstPage = await store.listObservationRuns({ limit: 1 });
    expect(firstPage.items.map((item) => item.traceId)).toEqual(["trace-b"]);
    expect(firstPage.nextCursor).toBeTruthy();
    const secondPage = await store.listObservationRuns({ limit: 1, cursor: firstPage.nextCursor });
    expect(secondPage.items.map((item) => item.traceId)).toEqual(["trace-a"]);

    await expect(store.getObservationRunByLookup({ runId: "run-a" })).resolves.toMatchObject({
      traceId: "trace-a",
    });
    await expect(store.listObservationEvents("trace-a", 10)).resolves.toHaveLength(1);

    await store.upsertObservationBackfillCheckpoint({
      source: "context-archive",
      cursor: "240",
      updatedAt: 300,
    });
    await expect(store.getObservationBackfillCheckpoint("context-archive")).resolves.toMatchObject({
      source: "context-archive",
      cursor: "240",
      updatedAt: 300,
    });
  });
});
