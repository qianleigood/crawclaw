import { describe, expect, it } from "vitest";
import {
  calculateCompactionBoundaryStartRow,
  MIN_COMPACTION_TEXT_MESSAGES,
} from "./compaction.ts";
import type { GmMessageRow } from "../types/runtime.ts";

function row(params: Partial<GmMessageRow> & Pick<GmMessageRow, "id" | "turnIndex" | "role" | "content">): GmMessageRow {
  return {
    sessionId: "session-1",
    conversationUid: "conv-1",
    contentText: params.content,
    extracted: false,
    createdAt: params.turnIndex,
    ...params,
  };
}

describe("calculateCompactionBoundaryStartRow", () => {
  it("starts from the summarized boundary and expands backward to satisfy minimums", () => {
    const rows: GmMessageRow[] = [
      row({ id: "m1", turnIndex: 1, role: "user", content: "old request one" }),
      row({ id: "m2", turnIndex: 2, role: "assistant", content: "old reply two" }),
      row({ id: "m3", turnIndex: 3, role: "user", content: "old request three" }),
      row({ id: "m4", turnIndex: 4, role: "assistant", content: "old reply four" }),
      row({ id: "m5", turnIndex: 5, role: "user", content: "old request five" }),
      row({ id: "m6", turnIndex: 6, role: "assistant", content: "boundary reply six" }),
      row({ id: "m7", turnIndex: 7, role: "user", content: "new work seven" }),
      row({ id: "m8", turnIndex: 8, role: "assistant", content: "new work eight" }),
    ];

    const startRow = calculateCompactionBoundaryStartRow({
      rows,
      summarizedThroughMessageId: "m6",
      minTokens: 12,
      minTextMessages: MIN_COMPACTION_TEXT_MESSAGES,
      maxTokens: 200,
    });

    expect(startRow?.id).toBe("m4");
  });

  it("does not start from a tool result mid-turn", () => {
    const rows: GmMessageRow[] = [
      row({ id: "m1", turnIndex: 1, role: "user", content: "request" }),
      row({ id: "m2", turnIndex: 2, role: "assistant", content: "tool use" }),
      row({ id: "m3", turnIndex: 2, role: "toolResult", content: "tool result payload" }),
      row({ id: "m4", turnIndex: 3, role: "assistant", content: "final answer" }),
    ];

    const startRow = calculateCompactionBoundaryStartRow({
      rows,
      summarizedThroughMessageId: "m1",
      minTokens: 5,
      minTextMessages: 1,
      maxTokens: 5,
    });

    expect(startRow?.id).toBe("m2");
  });

  it("rewinds to the beginning of a contiguous assistant/toolResult chain", () => {
    const rows: GmMessageRow[] = [
      row({ id: "m1", turnIndex: 1, role: "user", content: "request" }),
      row({ id: "m2", turnIndex: 2, role: "assistant", content: "tool use batch one" }),
      row({ id: "m3", turnIndex: 3, role: "toolResult", content: "tool result batch one" }),
      row({ id: "m4", turnIndex: 4, role: "assistant", content: "follow-up tool use" }),
      row({ id: "m5", turnIndex: 5, role: "toolResult", content: "follow-up tool result" }),
      row({ id: "m6", turnIndex: 6, role: "assistant", content: "final answer" }),
    ];

    const startRow = calculateCompactionBoundaryStartRow({
      rows,
      summarizedThroughMessageId: "m3",
      minTokens: 1,
      minTextMessages: 1,
      maxTokens: 1,
    });

    expect(startRow?.id).toBe("m2");
  });

  it("rewinds to include the exact tool use row when kept messages contain a matching tool result id", () => {
    const rows: GmMessageRow[] = [
      row({ id: "m1", turnIndex: 1, role: "user", content: "older compacted request" }),
      row({
        id: "m2",
        turnIndex: 2,
        role: "assistant",
        content: "tool use emitted earlier",
        runtimeMeta: { providerMessageId: "assistant-msg-1", toolUseIds: ["tool-call-1"] },
      }),
      row({ id: "m3", turnIndex: 3, role: "user", content: "new request after the summarized boundary" }),
      row({
        id: "m4",
        turnIndex: 4,
        role: "toolResult",
        content: "tool result linked to the earlier tool use",
        runtimeMeta: { toolResultIds: ["tool-call-1"] },
      }),
      row({ id: "m5", turnIndex: 5, role: "assistant", content: "final answer after the tool result" }),
    ];

    const startRow = calculateCompactionBoundaryStartRow({
      rows,
      summarizedThroughMessageId: "m2",
      minTokens: 1,
      minTextMessages: 1,
      maxTokens: 1,
    });

    expect(startRow?.id).toBe("m2");
  });

  it("uses runtime shape content to preserve tool_use/tool_result pairs exactly", () => {
    const rows: GmMessageRow[] = [
      row({ id: "m1", turnIndex: 1, role: "user", content: "older compacted request" }),
      row({
        id: "m2",
        turnIndex: 2,
        role: "assistant",
        content: "assistant tool use chunk",
        runtimeShape: {
          messageId: "assistant-msg-10",
          content: [{ type: "toolUse", id: "tool-call-10", name: "read" }],
        },
      }),
      row({
        id: "m3",
        turnIndex: 3,
        role: "user",
        content: "tool result wrapped in a user message",
        runtimeShape: {
          content: [{ type: "tool_result", tool_use_id: "tool-call-10", content: "ok" }],
        },
      }),
      row({ id: "m4", turnIndex: 4, role: "assistant", content: "final answer" }),
    ];

    const startRow = calculateCompactionBoundaryStartRow({
      rows,
      summarizedThroughMessageId: "m2",
      minTokens: 1,
      minTextMessages: 1,
      maxTokens: 1,
    });

    expect(startRow?.id).toBe("m2");
  });

  it("rewinds to include the earliest row sharing a provider message id in the kept range", () => {
    const rows: GmMessageRow[] = [
      row({ id: "m1", turnIndex: 1, role: "user", content: "older compacted request" }),
      row({
        id: "m2",
        turnIndex: 2,
        role: "assistant",
        content: "assistant message first chunk",
        runtimeMeta: { providerMessageId: "assistant-msg-2" },
      }),
      row({
        id: "m3",
        turnIndex: 3,
        role: "unknown",
        content: "assistant message hidden chunk",
        runtimeMeta: { providerMessageId: "assistant-msg-2" },
      }),
      row({ id: "m4", turnIndex: 4, role: "assistant", content: "next assistant response" }),
    ];

    const startRow = calculateCompactionBoundaryStartRow({
      rows,
      summarizedThroughMessageId: "m2",
      minTokens: 1,
      minTextMessages: 1,
      maxTokens: 1,
    });

    expect(startRow?.id).toBe("m2");
  });

  it("does not expand backward past the preserved tail floor from a prior compaction", () => {
    const rows: GmMessageRow[] = [
      row({ id: "m1", turnIndex: 1, role: "user", content: "very old request one" }),
      row({ id: "m2", turnIndex: 2, role: "assistant", content: "very old reply two" }),
      row({ id: "m3", turnIndex: 3, role: "user", content: "prior preserved floor starts here" }),
      row({ id: "m4", turnIndex: 4, role: "assistant", content: "summary boundary reply" }),
      row({ id: "m5", turnIndex: 5, role: "user", content: "recent work one" }),
      row({ id: "m6", turnIndex: 6, role: "assistant", content: "recent work two" }),
    ];

    const startRow = calculateCompactionBoundaryStartRow({
      rows,
      summarizedThroughMessageId: "m4",
      minTokens: 10_000,
      minTextMessages: 10,
      maxTokens: 10_000,
      floorMessageId: "m3",
      floorTurnIndex: 3,
    });

    expect(startRow?.id).toBe("m3");
  });

  it("does not expand backward past the latest compacted transcript marker", () => {
    const rows: GmMessageRow[] = [
      row({ id: "m1", turnIndex: 1, role: "user", content: "very old request one" }),
      row({ id: "m2", turnIndex: 2, role: "assistant", content: "[compacted assistant message into session memory] turn=2" }),
      row({ id: "m3", turnIndex: 3, role: "user", content: "disk boundary after compaction marker" }),
      row({ id: "m4", turnIndex: 4, role: "assistant", content: "summary boundary reply" }),
      row({ id: "m5", turnIndex: 5, role: "user", content: "recent work one" }),
      row({ id: "m6", turnIndex: 6, role: "assistant", content: "recent work two" }),
    ];

    const startRow = calculateCompactionBoundaryStartRow({
      rows,
      summarizedThroughMessageId: "m4",
      minTokens: 10_000,
      minTextMessages: 10,
      maxTokens: 10_000,
    });

    expect(startRow?.id).toBe("m3");
  });

  it("supports resumed-session fallback when the summary exists but no summarized message id is available", () => {
    const rows: GmMessageRow[] = [
      row({ id: "m1", turnIndex: 1, role: "user", content: "older request one" }),
      row({ id: "m2", turnIndex: 2, role: "assistant", content: "older reply two" }),
      row({ id: "m3", turnIndex: 3, role: "user", content: "recent request three" }),
      row({ id: "m4", turnIndex: 4, role: "assistant", content: "recent reply four" }),
      row({ id: "m5", turnIndex: 5, role: "user", content: "recent request five" }),
      row({ id: "m6", turnIndex: 6, role: "assistant", content: "recent reply six" }),
    ];

    const startRow = calculateCompactionBoundaryStartRow({
      rows,
      summarizedThroughMessageId: null,
      minTokens: 12,
      minTextMessages: 2,
      maxTokens: 200,
    });

    expect(startRow?.id).toBe("m5");
  });
});
