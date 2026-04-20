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

describe("SqliteRuntimeStore context assembly audits", () => {
  it("round-trips system context tokens via context assembly audits", async () => {
    const rootDir = await tempDirs.make("sqlite-context-assembly-audit-");
    const store = new SqliteRuntimeStore(`${rootDir}/runtime.sqlite`);
    await store.init();
    stores.push(store);

    await store.appendContextAssemblyAudit({
      sessionId: "session-1",
      prompt: "assemble this",
      rawMessageCount: 12,
      compactedMessageCount: 9,
      rawMessageTokens: 2_000,
      compactedMessageTokens: 1_200,
      sessionSummaryTokens: 180,
      recallTokens: 420,
      systemContextTokens: 640,
      preservedTailStartTurn: 4,
      compactionStatePresent: true,
      compactionMode: "session-summary",
      detailsJson: JSON.stringify({ test: true }),
      createdAt: 1_717_171_717_000,
    });

    const audits = await store.listRecentContextAssemblyAudits(5, "session-1");
    expect(audits).toHaveLength(1);
    expect(audits[0]?.systemContextTokens).toBe(640);
    expect(audits[0]?.sessionSummaryTokens).toBe(180);
    expect(audits[0]?.compactionMode).toBe("session-summary");
  });

  it("renames legacy session_memory_tokens columns to session_summary_tokens during init", async () => {
    const rootDir = await tempDirs.make("sqlite-context-assembly-audit-legacy-");
    const dbPath = `${rootDir}/runtime.sqlite`;
    const legacyDb = new DatabaseSync(dbPath);
    legacyDb.exec(`
      CREATE TABLE gm_context_assembly_audits (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        prompt TEXT,
        raw_message_count INTEGER NOT NULL,
        compacted_message_count INTEGER NOT NULL,
        raw_message_tokens INTEGER NOT NULL,
        compacted_message_tokens INTEGER NOT NULL,
        session_memory_tokens INTEGER,
        recall_tokens INTEGER,
        system_prompt_addition_tokens INTEGER,
        preserved_tail_start_turn INTEGER,
        compaction_state_present INTEGER NOT NULL DEFAULT 0,
        details_json TEXT,
        created_at INTEGER NOT NULL
      );
    `);
    legacyDb.close();

    const store = new SqliteRuntimeStore(dbPath);
    await store.init();
    stores.push(store);

    await store.appendContextAssemblyAudit({
      sessionId: "session-legacy",
      rawMessageCount: 1,
      compactedMessageCount: 1,
      rawMessageTokens: 100,
      compactedMessageTokens: 100,
      sessionSummaryTokens: 25,
    });

    const verifyDb = new DatabaseSync(dbPath, { readonly: true });
    const columns = verifyDb
      .prepare("PRAGMA table_info(gm_context_assembly_audits)")
      .all() as Array<{ name?: string }>;
    verifyDb.close();

    const columnNames = columns.map((column) => column.name ?? "");
    expect(columnNames).toContain("session_summary_tokens");
    expect(columnNames).not.toContain("session_memory_tokens");

    const audits = await store.listRecentContextAssemblyAudits(5, "session-legacy");
    expect(audits[0]?.sessionSummaryTokens).toBe(25);
  });
});
