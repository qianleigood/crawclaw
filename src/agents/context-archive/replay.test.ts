import { afterEach, describe, expect, it } from "vitest";
import { SqliteRuntimeStore } from "../../memory/runtime/sqlite-runtime-store.ts";
import { createTrackedTempDirs } from "../../test-utils/tracked-temp-dirs.js";
import { createContextArchiveService } from "./service.js";
import { exportContextArchiveRun } from "./export.js";
import { replayContextArchiveRun } from "./replay.js";

const tempDirs = createTrackedTempDirs();
const stores: SqliteRuntimeStore[] = [];

afterEach(async () => {
  await Promise.all(stores.splice(0).map((store) => store.close()));
  await tempDirs.cleanup();
});

async function createArchiveFixture() {
  const rootDir = await tempDirs.make("context-archive-replay-");
  const runtimeStore = new SqliteRuntimeStore(`${rootDir}/runtime.sqlite`);
  await runtimeStore.init();
  stores.push(runtimeStore);
  return createContextArchiveService({
    runtimeStore,
    rootDir: `${rootDir}/archive`,
  });
}

describe("context archive replay", () => {
  it("replays exported events and hydrates payloads from blob storage", async () => {
    const archive = await createArchiveFixture();
    const run = await archive.createRun({
      sessionId: "session-replay-1",
      sessionKey: "agent:main:session-replay-1",
      kind: "turn",
      status: "complete",
    });
    await archive.appendEvent({
      runId: run.id,
      type: "turn.model_visible_context",
      payload: {
        prompt: "replay me",
        messages: [{ role: "user", content: "hi" }],
      },
    });

    const exported = await exportContextArchiveRun({
      archive,
      runId: run.id,
    });
    const replayed = await replayContextArchiveRun({
      runRef: exported!.refs.runRef,
      hydratePayload: true,
    });

    expect(replayed).toMatchObject({
      run: { id: run.id },
      refs: {
        runRef: exported!.refs.runRef,
        eventsRef: exported!.refs.eventsRef,
      },
    });
    expect(replayed?.events).toHaveLength(1);
    expect(replayed?.events[0]?.payload).toMatchObject({
      prompt: "replay me",
      messages: [{ role: "user", content: "hi" }],
    });
  });

  it("returns null when the exported run artifact is missing", async () => {
    const replayed = await replayContextArchiveRun({
      rootDir: "/tmp/context-archive-missing",
      runId: "car_missing",
    });

    expect(replayed).toBeNull();
  });
});
