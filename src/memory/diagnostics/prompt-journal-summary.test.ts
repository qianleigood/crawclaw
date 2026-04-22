import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { summarizePromptJournal } from "./prompt-journal-summary.ts";

describe("summarizePromptJournal", () => {
  it("aggregates journal files into a compact summary", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "crawclaw-memory-journal-summary-"));
    const filePath = path.join(dir, "2026-04-05.jsonl");
    await fs.writeFile(
      filePath,
      [
        JSON.stringify({
          ts: "2026-04-05T12:00:00.000Z",
          dateBucket: "2026-04-05",
          stage: "prompt_assembly",
          sessionKey: "s1",
          payload: { estimatedTokens: 800, systemContextText: "abc" },
        }),
        JSON.stringify({
          ts: "2026-04-05T12:00:01.000Z",
          dateBucket: "2026-04-05",
          stage: "after_turn_decision",
          sessionKey: "s1",
          payload: { decision: "skip_direct_write", skipReason: "durable_write" },
        }),
        JSON.stringify({
          ts: "2026-04-05T12:00:02.000Z",
          dateBucket: "2026-04-05",
          stage: "durable_extraction",
          sessionKey: "s2",
          payload: { notesSaved: 0, reason: "no_memories_saved" },
        }),
        JSON.stringify({
          ts: "2026-04-05T12:00:02.500Z",
          dateBucket: "2026-04-05",
          stage: "durable_extraction",
          sessionKey: "s3",
          payload: { notesSaved: 1, reason: "saved_feedback_preference" },
        }),
        JSON.stringify({
          ts: "2026-04-05T12:00:03.000Z",
          dateBucket: "2026-04-05",
          stage: "experience_extract",
          sessionKey: "s2",
          payload: { status: "written", writtenCount: 1, updatedCount: 0, deletedCount: 0 },
        }),
        JSON.stringify({
          ts: "2026-04-05T12:00:04.000Z",
          dateBucket: "2026-04-05",
          stage: "experience_write",
          sessionKey: "s2",
          payload: { status: "ok", action: "create", title: "MiniMax 工具挂载调试流程" },
        }),
      ].join("\n"),
      "utf8",
    );

    const summary = await summarizePromptJournal({ dir, days: 1 });
    expect(summary.totalEvents).toBe(6);
    expect(summary.stageCounts.prompt_assembly).toBe(1);
    expect(summary.uniqueSessions).toBe(3);
    expect(summary.promptAssembly.avgEstimatedTokens).toBe(800);
    expect(summary.afterTurn.decisionCounts.skip_direct_write).toBe(1);
    expect(summary.afterTurn.skipReasonCounts.durable_write).toBe(1);
    expect(summary.durableExtraction.count).toBe(2);
    expect(summary.durableExtraction.notesSavedTotal).toBe(1);
    expect(summary.durableExtraction.nonZeroSaveCount).toBe(1);
    expect(summary.durableExtraction.zeroSaveCount).toBe(1);
    expect(summary.durableExtraction.saveRate).toBe(0.5);
    expect(summary.experienceExtraction.statusCounts.written).toBe(1);
    expect(summary.experienceExtraction.writtenCount).toBe(1);
    expect(summary.experienceWrite.statusCounts.ok).toBe(1);
    expect(summary.experienceWrite.actionCounts.create).toBe(1);
    expect(summary.experienceWrite.titles[0]).toEqual({
      title: "MiniMax 工具挂载调试流程",
      count: 1,
    });
  });
});
