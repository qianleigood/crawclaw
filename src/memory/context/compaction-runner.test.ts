import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RuntimeStore } from "../runtime/runtime-store.ts";
import { writeSessionSummaryFile } from "../session-summary/store.ts";
import { runSessionMemoryCompaction } from "./compaction-runner.ts";

describe("runSessionMemoryCompaction", () => {
  const tempDirs: string[] = [];
  const longText = "token-rich recent content ".repeat(20).trim();

  afterEach(async () => {
    delete process.env.CRAWCLAW_STATE_DIR;
    await Promise.all(
      tempDirs.splice(0).map(async (dir) => {
        await fs.rm(dir, { recursive: true, force: true });
      }),
    );
  });

  it("returns Claude-style post-compact artifacts in details", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "crawclaw-compaction-runner-"));
    tempDirs.push(stateDir);
    process.env.CRAWCLAW_STATE_DIR = stateDir;

    await writeSessionSummaryFile({
      agentId: "main",
      sessionId: "session-compact",
      content: `# Session Summary

> Session: session-compact
> Updated: 2026-04-08T00:00:00.000Z

# Session Title
Compaction runner test

*One-line title for this session.*

# Current State
Compaction should emit Claude-style artifacts.

*What is the agent doing now? Keep this short and current.*

# Open Loops
Need to preserve the latest retry plan.

*Which work items, decisions, or follow-ups are still open right now? Keep this tightly focused on unresolved items.*

# Key results
Summary-backed compaction result.

*Only concrete user-visible outcomes or verified conclusions.*
`,
    });

    const runtimeStore = {
      getSessionSummaryState: vi.fn().mockResolvedValue({
        sessionId: "session-compact",
        lastSummarizedMessageId: "m2",
        lastSummaryUpdatedAt: Date.now(),
        tokensAtLastSummary: 1200,
        summaryInProgress: false,
        updatedAt: Date.now(),
      }),
      listMessagesByTurnRange: vi.fn().mockResolvedValue([
        { id: "m1", turnIndex: 1, role: "user", content: "older request one" },
        {
          id: "m2",
          turnIndex: 2,
          role: "assistant",
          content: longText,
          runtimeShape: {
            messageId: "assistant-compact-1",
            toolName: "read",
            content: [{ type: "toolUse", id: "tool-call-1", name: "read" }],
          },
        },
        { id: "m3", turnIndex: 3, role: "user", content: longText },
        { id: "m4", turnIndex: 4, role: "assistant", content: longText },
        { id: "m5", turnIndex: 5, role: "user", content: longText },
        { id: "m6", turnIndex: 6, role: "assistant", content: longText },
        { id: "m7", turnIndex: 7, role: "user", content: longText },
        { id: "m8", turnIndex: 8, role: "assistant", content: longText },
      ]),
      getSessionCompactionState: vi.fn().mockResolvedValue(null),
      upsertSessionCompactionState: vi.fn().mockResolvedValue(undefined),
      appendCompactionAudit: vi.fn().mockResolvedValue("audit-1"),
    };

    const result = await runSessionMemoryCompaction({
      runtimeStore: runtimeStore as unknown as RuntimeStore,
      logger: { info: vi.fn() },
      sessionId: "session-compact",
      agentId: "main",
      totalTurns: 8,
      tokenBudget: 900,
      currentTokenCount: 1400,
      force: true,
      runtimeContext: { trigger: "overflow" },
    });

    expect(result.compacted).toBe(true);
    if (!result.compacted || !result.result) {
      throw new Error(`expected compaction success, got ${result.reason ?? "unknown"}`);
    }
    expect(result.result.firstKeptEntryId).toBeTruthy();
    expect(result.result.summary).toContain("## Open Loops");
    expect(result.result.summary).not.toContain("## Worklog");
    expect(result.result.postCompactArtifacts).toEqual(
      expect.objectContaining({
        boundaryMarker: expect.objectContaining({
          type: "system",
          subtype: "compact_boundary",
          content: "Conversation compacted",
          compactMetadata: expect.objectContaining({
            trigger: "auto",
            preCompactDiscoveredTools: ["read"],
            preservedSegment: expect.objectContaining({
              anchorKind: "summary_message",
              anchorIndex: 0,
            }),
          }),
        }),
        summaryMessages: [
          expect.objectContaining({
            role: "user",
            subtype: "compact_summary",
            isCompactSummary: true,
            isVisibleInTranscriptOnly: true,
          }),
        ],
        messagesToKeep: expect.any(Array),
        attachments: [
          expect.objectContaining({
            type: "plan_attachment",
            title: "Current Plan",
            source: "session_summary",
          }),
        ],
      }),
    );
    expect(result.result.details).toEqual(
      expect.objectContaining({
        preservedTailStartTurn: expect.any(Number),
        summarizedMessages: expect.any(Number),
        keptMessages: expect.any(Number),
      }),
    );
  });
});
