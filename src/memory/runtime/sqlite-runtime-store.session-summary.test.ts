import { DatabaseSync } from "@photostructure/sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { createTrackedTempDirs } from "../../test-utils/tracked-temp-dirs.js";
import { SqliteRuntimeStore } from "./sqlite-runtime-store.js";

const tempDirs = createTrackedTempDirs();
const stores: SqliteRuntimeStore[] = [];

afterEach(async () => {
  await Promise.all(stores.splice(0).map(async (store) => store.close()));
  await tempDirs.cleanup();
});

describe("SqliteRuntimeStore session summary state", () => {
  it("does not create legacy extraction tables during init", async () => {
    const rootDir = await tempDirs.make("sqlite-no-extraction-jobs-");
    const dbPath = `${rootDir}/runtime.sqlite`;
    const store = new SqliteRuntimeStore(dbPath);
    await store.init();
    stores.push(store);

    const db = new DatabaseSync(dbPath);
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all() as Array<{ name?: string }>;
    db.close();

    const tableNames = tables.map((table) => table.name ?? "");
    expect(tableNames).not.toContain("gm_extraction_jobs");
    expect(tableNames).not.toContain("gm_extraction_windows");
  });

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

  it("searches bounded model-visible transcript excerpts inside one durable scope", async () => {
    const rootDir = await tempDirs.make("sqlite-dream-transcript-search-");
    const store = new SqliteRuntimeStore(`${rootDir}/runtime.sqlite`);
    await store.init();
    stores.push(store);

    await store.upsertSessionScope({
      sessionId: "session-1",
      sessionKey: "agent:main:feishu:user-1",
      scopeKey: "main:feishu:user-1",
      agentId: "main",
      channel: "feishu",
      userId: "user-1",
    });
    await store.upsertSessionScope({
      sessionId: "session-2",
      sessionKey: "agent:main:feishu:user-1",
      scopeKey: "main:feishu:user-1",
      agentId: "main",
      channel: "feishu",
      userId: "user-1",
    });
    await store.upsertSessionScope({
      sessionId: "session-3",
      sessionKey: "agent:main:feishu:user-2",
      scopeKey: "main:feishu:user-2",
      agentId: "main",
      channel: "feishu",
      userId: "user-2",
    });

    for (const message of [
      {
        sessionId: "session-1",
        role: "user",
        content: "alpha fallback should preserve product decision context",
        turnIndex: 1,
        createdAt: 100,
      },
      {
        sessionId: "session-1",
        role: "system",
        content: "alpha private system prompt must not be returned",
        turnIndex: 2,
        createdAt: 101,
      },
      {
        sessionId: "session-2",
        role: "assistant",
        content: "second session confirms alpha as a durable recall signal",
        turnIndex: 1,
        createdAt: 200,
      },
      {
        sessionId: "session-2",
        role: "toolResult",
        content: "another alpha match should be capped per session",
        turnIndex: 2,
        createdAt: 201,
      },
      {
        sessionId: "session-3",
        role: "user",
        content: "alpha belongs to a different durable scope",
        turnIndex: 1,
        createdAt: 300,
      },
    ]) {
      await store.appendMessage({
        sessionId: message.sessionId,
        conversationUid: `${message.sessionId}-conversation`,
        role: message.role,
        content: message.content,
        turnIndex: message.turnIndex,
        createdAt: message.createdAt,
      });
    }

    const rows = await store.searchScopedModelVisibleMessages({
      scopeKey: "main:feishu:user-1",
      sessionIds: ["session-1", "session-2", "session-3"],
      query: "alpha",
      maxSessions: 3,
      maxMatchesPerSession: 1,
      maxTotalBytes: 2_000,
      maxExcerptChars: 72,
    });

    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.sessionId).toSorted()).toEqual(["session-1", "session-2"]);
    expect(rows.every((row) => row.excerpt.length <= 72)).toBe(true);
    expect(rows.some((row) => row.role === "system")).toBe(false);
    expect(rows.some((row) => row.sessionId === "session-3")).toBe(false);
  });
});
