import { DatabaseSync } from "@photostructure/sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { createTrackedTempDirs } from "../../test-utils/tracked-temp-dirs.js";
import { SqliteRuntimeStore } from "../runtime/sqlite-runtime-store.js";
import {
  extractSessionSummaryPromotionCandidates,
  persistSessionSummaryPromotionCandidates,
} from "./promotion.js";
import { parseSessionSummaryDocument } from "./template.js";

const tempDirs = createTrackedTempDirs();
const stores: SqliteRuntimeStore[] = [];

afterEach(async () => {
  await Promise.all(stores.splice(0).map((store) => store.close()));
  await tempDirs.cleanup();
});

describe("session summary promotion bridge", () => {
  it("extracts durable promotion candidates from structured summary sections", async () => {
    const document = parseSessionSummaryDocument(`
# Session Title
_A short and distinctive 5-10 word descriptive title for the session. Super info dense, no filler_

Memory refactor

# Current State
_What is actively being worked on right now? Pending tasks not yet completed. Immediate next steps._

Finish the durable bridge.

# Open Loops
_Which work items, decisions, or follow-ups are still open right now? Keep this tightly focused on unresolved items._

Need to keep transcript priority explicit.

# Workflow
_What bash commands are usually run and in what order? How to interpret their output if not obvious?_

Run pnpm test for session summary files, then pnpm build.

# Errors & Corrections
_Errors encountered and how they were fixed. What did the user correct? What approaches failed and should not be tried again?_

Do not reintroduce prompt-time session summary injection; keep summary compaction-first.

# Key results
_If the user asked a specific output such as an answer to a question, a table, or other document, repeat the exact result here_

Session summary now starts with a light profile before upgrading to full.
`);
    const result = await extractSessionSummaryPromotionCandidates({
      sessionId: "session-1",
      document,
      summaryUpdatedAt: 1_717_171_717_000,
    });

    expect(result.length).toBeGreaterThan(0);
    expect(result[0]?.sourceType).toBe("session_summary_distillation");
    expect(result[0]?.candidate.memoryBucket).toBe("durable");
    expect(result[0]?.candidate.facts.join("\n")).toContain(
      "prompt-time session summary injection",
    );
  });

  it("upserts session-summary-derived promotion candidates by stable title", async () => {
    const rootDir = await tempDirs.make("session-summary-promotion-store-");
    const store = new SqliteRuntimeStore(`${rootDir}/runtime.sqlite`);
    await store.init();
    stores.push(store);

    const document = parseSessionSummaryDocument(`
# Session Title
_A short and distinctive 5-10 word descriptive title for the session. Super info dense, no filler_

Memory refactor

# Current State
_What is actively being worked on right now? Pending tasks not yet completed. Immediate next steps._

Finish the durable bridge.

# Open Loops
_Which work items, decisions, or follow-ups are still open right now? Keep this tightly focused on unresolved items._

Need to keep transcript priority explicit.

# Workflow
_What bash commands are usually run and in what order? How to interpret their output if not obvious?_

Run pnpm test for session summary files, then pnpm build.

# Errors & Corrections
_Errors encountered and how they were fixed. What did the user correct? What approaches failed and should not be tried again?_

Do not reintroduce prompt-time session summary injection; keep summary compaction-first.

# Key results
_If the user asked a specific output such as an answer to a question, a table, or other document, repeat the exact result here_

Session summary now starts with a light profile before upgrading to full.
`);

    const first = await persistSessionSummaryPromotionCandidates({
      runtimeStore: store,
      sessionId: "session-1",
      document,
      summaryUpdatedAt: 1_717_171_717_000,
    });
    const second = await persistSessionSummaryPromotionCandidates({
      runtimeStore: store,
      sessionId: "session-1",
      document,
      summaryUpdatedAt: 1_717_171_718_000,
    });

    expect(first.created).toBeGreaterThan(0);
    expect(second.updated).toBeGreaterThan(0);

    const rows = await store.listRecentPromotionCandidates(10);
    expect(
      rows.filter(
        (row) => row.sessionId === "session-1" && row.sourceType === "session_summary_distillation",
      ),
    ).toHaveLength(1);

    const db = new DatabaseSync(`${rootDir}/runtime.sqlite`);
    const candidateRows = db
      .prepare("SELECT candidate_json FROM gm_promotion_candidates WHERE session_id = ?")
      .all("session-1") as Array<{ candidate_json?: string }>;
    db.close();
    expect(candidateRows[0]?.candidate_json).toContain("session summary injection");
  });
});
