import { describe, expect, it } from "vitest";
import type { GmMessageRow } from "../types/runtime.ts";
import { buildManualSessionSummaryRefreshContext } from "./manual-refresh.js";

function row(params: {
  id: string;
  role: GmMessageRow["role"];
  contentText?: string | null;
  content?: string | null;
}): GmMessageRow {
  return {
    id: params.id,
    sessionId: "sess-1",
    conversationUid: "conv-1",
    role: params.role,
    contentText: params.contentText ?? "",
    content: params.content ?? "",
    turnIndex: 1,
    extracted: false,
    createdAt: 1_774_972_800_000,
  };
}

describe("manual session summary refresh context", () => {
  it("builds parent fork context from persisted model-visible messages", () => {
    const result = buildManualSessionSummaryRefreshContext({
      sessionId: "sess-1",
      rows: [
        row({ id: "sys-1", role: "system", contentText: "system" }),
        row({ id: "u1", role: "user", contentText: "User request" }),
        row({ id: "a1", role: "assistant", contentText: "Assistant response" }),
      ],
    });

    expect(result.lastModelVisibleMessageId).toBe("a1");
    expect(result.parentForkContext).toMatchObject({
      parentRunId: "manual-session-summary:sess-1",
      provider: "manual",
      modelId: "session-summary-refresh",
    });
    expect(result.parentForkContext?.promptEnvelope.forkContextMessages).toEqual([
      expect.objectContaining({ id: "u1", role: "user", content: "User request" }),
      expect.objectContaining({ id: "a1", role: "assistant", content: "Assistant response" }),
    ]);
  });

  it("tracks the checkpoint from the last included message", () => {
    const result = buildManualSessionSummaryRefreshContext({
      sessionId: "sess-1",
      rows: [
        row({ id: "u1", role: "user", contentText: "User request" }),
        row({ id: "a-empty", role: "assistant", contentText: "" }),
      ],
    });

    expect(result.recentMessages).toHaveLength(1);
    expect(result.lastModelVisibleMessageId).toBe("u1");
  });
});
