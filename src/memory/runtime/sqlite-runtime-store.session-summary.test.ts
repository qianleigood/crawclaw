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
  it("sets a busy timeout for concurrent runtime lifecycle access", async () => {
    const rootDir = await tempDirs.make("sqlite-busy-timeout-");
    const store = new SqliteRuntimeStore(`${rootDir}/runtime.sqlite`);
    await store.init();
    stores.push(store);

    const db = (
      store as unknown as {
        db?: {
          prepare(sql: string): {
            get(): unknown;
          };
        };
      }
    ).db;
    const row = db?.prepare("PRAGMA busy_timeout").get() as { timeout?: number } | undefined;

    expect(row?.timeout).toBe(5_000);
  });

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
});
