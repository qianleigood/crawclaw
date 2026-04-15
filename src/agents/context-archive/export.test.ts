import fs from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import { SqliteRuntimeStore } from "../../memory/runtime/sqlite-runtime-store.ts";
import { createTrackedTempDirs } from "../../test-utils/tracked-temp-dirs.js";
import { createContextArchiveService } from "./service.js";
import {
  exportContextArchiveRun,
  exportContextArchiveSnapshot,
} from "./export.js";

const tempDirs = createTrackedTempDirs();
const stores: SqliteRuntimeStore[] = [];

afterEach(async () => {
  await Promise.all(stores.splice(0).map((store) => store.close()));
  await tempDirs.cleanup();
});

async function createArchiveFixture() {
  const rootDir = await tempDirs.make("context-archive-export-");
  const runtimeStore = new SqliteRuntimeStore(`${rootDir}/runtime.sqlite`);
  await runtimeStore.init();
  stores.push(runtimeStore);
  return createContextArchiveService({
    runtimeStore,
    rootDir: `${rootDir}/archive`,
  });
}

describe("context archive export", () => {
  it("writes the advertised run and event refs for a single run", async () => {
    const archive = await createArchiveFixture();
    const run = await archive.createRun({
      sessionId: "session-export-1",
      sessionKey: "agent:main:session-export-1",
      taskId: "task-export-1",
      agentId: "main",
      label: "export-run",
    });
    await archive.appendEvent({
      runId: run.id,
      type: "turn.model_visible_context",
      payload: { prompt: "hello export" },
      metadata: { source: "test" },
    });

    const exported = await exportContextArchiveRun({
      archive,
      runId: run.id,
    });

    expect(exported).toMatchObject({
      run: {
        id: run.id,
        sessionId: "session-export-1",
      },
      eventCount: 1,
    });
    const runFile = JSON.parse(await fs.readFile(exported!.refs.runRef, "utf8")) as {
      run: { id: string };
      eventCount: number;
    };
    expect(runFile).toMatchObject({
      run: { id: run.id },
      eventCount: 1,
    });
    const eventLines = (await fs.readFile(exported!.refs.eventsRef, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { type: string; payloadBlobHash?: string; payload?: unknown });
    expect(eventLines).toHaveLength(1);
    expect(eventLines[0]).toMatchObject({
      type: "turn.model_visible_context",
    });
    expect(eventLines[0]?.payloadBlobHash).toEqual(expect.any(String));
    expect(eventLines[0]).not.toHaveProperty("payload");
  });

  it("exports all matching runs in one snapshot", async () => {
    const archive = await createArchiveFixture();
    const runA = await archive.createRun({
      sessionId: "session-export-2",
      taskId: "task-export-2",
      agentId: "main",
    });
    const runB = await archive.createRun({
      sessionId: "session-export-2",
      taskId: "task-export-2",
      agentId: "main",
    });

    const snapshot = await exportContextArchiveSnapshot({
      archive,
      taskId: "task-export-2",
    });

    expect(snapshot.runs.map((run) => run.run.id).toSorted()).toEqual([runA.id, runB.id].toSorted());
  });
});
