import { afterEach, describe, expect, it } from "vitest";
import { SqliteRuntimeStore } from "./sqlite-runtime-store.js";
import { createTrackedTempDirs } from "../../test-utils/tracked-temp-dirs.js";

const tempDirs = createTrackedTempDirs();
const stores: SqliteRuntimeStore[] = [];

afterEach(async () => {
  await Promise.all(stores.splice(0).map(async (store) => store.close()));
  await tempDirs.cleanup();
});

describe("SqliteRuntimeStore session summary state", () => {
  it("round-trips session summary state", async () => {
    const rootDir = await tempDirs.make("sqlite-session-summary-state-");
    const store = new SqliteRuntimeStore(`${rootDir}/runtime.sqlite`);
    await store.init();
    stores.push(store);

    await store.upsertSessionSummaryState({
      sessionId: "session-1",
      lastSummarizedMessageId: "msg-8",
      lastSummaryUpdatedAt: 1_717_171_717_000,
      tokensAtLastSummary: 144,
      summaryInProgress: true,
      updatedAt: 1_717_171_718_000,
    });

    expect(await store.getSessionSummaryState("session-1")).toEqual({
      sessionId: "session-1",
      lastSummarizedMessageId: "msg-8",
      lastSummaryUpdatedAt: 1_717_171_717_000,
      tokensAtLastSummary: 144,
      summaryInProgress: true,
      updatedAt: 1_717_171_718_000,
    });

    await store.upsertSessionSummaryState({
      sessionId: "session-1",
      lastSummarizedMessageId: null,
      lastSummaryUpdatedAt: null,
      tokensAtLastSummary: 0,
      summaryInProgress: false,
      updatedAt: 1_717_171_719_000,
    });

    expect(await store.getSessionSummaryState("session-1")).toEqual({
      sessionId: "session-1",
      lastSummarizedMessageId: null,
      lastSummaryUpdatedAt: null,
      tokensAtLastSummary: 0,
      summaryInProgress: false,
      updatedAt: 1_717_171_719_000,
    });
  });
});
