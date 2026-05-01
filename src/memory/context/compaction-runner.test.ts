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
        summaryProfile: "light",
        summaryAgeMs: expect.any(Number),
        waitedForSummaryMs: expect.any(Number),
        minPreservedTokens: 240,
        maxPreservedTokens: 840,
        minTextMessages: 5,
        compactSummaryBudgetTokens: 600,
      }),
    );
  });

  it("clears a stale session summary in-progress lease before compaction", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "crawclaw-compaction-stale-"));
    tempDirs.push(stateDir);
    process.env.CRAWCLAW_STATE_DIR = stateDir;

    await writeSessionSummaryFile({
      agentId: "main",
      sessionId: "session-stale",
      content: `# Session Title
Stale summary lease

# Current State
Summary-backed compaction is ready.

# Open Loops
Keep the tail intact.

# Task specification
Compact with the existing summary.

# Workflow
Run compaction after clearing stale state.

# Errors & Corrections
Old in-progress state should not block compaction.

# Key results
Compaction can proceed.
`,
    });

    const staleState = {
      sessionId: "session-stale",
      lastSummarizedMessageId: "m2",
      lastSummaryUpdatedAt: Date.now() - 120_000,
      tokensAtLastSummary: 1200,
      summaryInProgress: true,
      updatedAt: Date.now() - 120_000,
    };
    const runtimeStore = {
      getSessionSummaryState: vi
        .fn()
        .mockResolvedValueOnce(staleState)
        .mockResolvedValueOnce({ ...staleState, summaryInProgress: false })
        .mockResolvedValueOnce({ ...staleState, summaryInProgress: false }),
      upsertSessionSummaryState: vi.fn().mockResolvedValue(undefined),
      listMessagesByTurnRange: vi.fn().mockResolvedValue([
        { id: "m1", turnIndex: 1, role: "user", content: "older request one" },
        { id: "m2", turnIndex: 2, role: "assistant", content: longText },
        { id: "m3", turnIndex: 3, role: "user", content: longText },
        { id: "m4", turnIndex: 4, role: "assistant", content: longText },
        { id: "m5", turnIndex: 5, role: "user", content: longText },
        { id: "m6", turnIndex: 6, role: "assistant", content: longText },
        { id: "m7", turnIndex: 7, role: "user", content: longText },
        { id: "m8", turnIndex: 8, role: "assistant", content: longText },
      ]),
      getSessionCompactionState: vi.fn().mockResolvedValue(null),
      upsertSessionCompactionState: vi.fn().mockResolvedValue(undefined),
      appendCompactionAudit: vi.fn().mockResolvedValue("audit-stale"),
    };

    const result = await runSessionMemoryCompaction({
      runtimeStore: runtimeStore as unknown as RuntimeStore,
      logger: { info: vi.fn() },
      sessionId: "session-stale",
      agentId: "main",
      totalTurns: 8,
      tokenBudget: 900,
      currentTokenCount: 1400,
      force: true,
      runtimeContext: { trigger: "overflow" },
      maxSummaryWaitMs: 10,
    });

    expect(runtimeStore.upsertSessionSummaryState).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "session-stale",
        summaryInProgress: false,
      }),
    );
    expect(result.compacted).toBe(true);
    if (!result.compacted || !result.result) {
      throw new Error(`expected compaction success, got ${result.reason ?? "unknown"}`);
    }
    expect(result.result.details).toEqual(
      expect.objectContaining({ staleSummaryLeaseCleared: true }),
    );
  });

  it("compacts with a transcript fallback when no session summary exists", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "crawclaw-compaction-fallback-"));
    tempDirs.push(stateDir);
    process.env.CRAWCLAW_STATE_DIR = stateDir;

    const runtimeStore = {
      getSessionSummaryState: vi.fn().mockResolvedValue(null),
      listMessagesByTurnRange: vi.fn().mockResolvedValue([
        { id: "m1", turnIndex: 1, role: "user", content: "older request one" },
        { id: "m2", turnIndex: 2, role: "assistant", content: longText },
        { id: "m3", turnIndex: 3, role: "user", content: longText },
        { id: "m4", turnIndex: 4, role: "assistant", content: longText },
        { id: "m5", turnIndex: 5, role: "user", content: longText },
        { id: "m6", turnIndex: 6, role: "assistant", content: longText },
        { id: "m7", turnIndex: 7, role: "user", content: longText },
        { id: "m8", turnIndex: 8, role: "assistant", content: longText },
      ]),
      getSessionCompactionState: vi.fn().mockResolvedValue(null),
      upsertSessionCompactionState: vi.fn().mockResolvedValue(undefined),
      appendCompactionAudit: vi.fn().mockResolvedValue("audit-fallback"),
    };
    const complete = vi.fn().mockResolvedValue("Recovered transcript fallback summary.");

    const result = await runSessionMemoryCompaction({
      runtimeStore: runtimeStore as unknown as RuntimeStore,
      logger: { info: vi.fn() },
      sessionId: "session-fallback",
      agentId: "main",
      totalTurns: 8,
      tokenBudget: 900,
      currentTokenCount: 1400,
      force: true,
      runtimeContext: { trigger: "overflow" },
      complete,
    });

    expect(result.compacted).toBe(true);
    if (!result.compacted || !result.result) {
      throw new Error(`expected fallback compaction success, got ${result.reason ?? "unknown"}`);
    }
    expect(complete).toHaveBeenCalledOnce();
    expect(result.reason).toBe("transcript-fallback-tail-compaction");
    expect(runtimeStore.upsertSessionCompactionState).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: "transcript-fallback",
        summarizedThroughMessageId: null,
        summaryOverrideText: expect.stringContaining("Recovered transcript fallback summary."),
      }),
    );
    expect(result.result.details).toEqual(
      expect.objectContaining({
        resumedWithoutBoundary: true,
        summaryProfile: null,
        summarySource: "transcript-fallback-llm",
      }),
    );
  });
});
