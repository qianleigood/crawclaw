import { describe, expect, it } from "vitest";
import { extractMessageRuntimeMeta, normalizeIncomingMessage } from "./message.ts";

describe("message runtime meta extraction", () => {
  it("extracts provider ids, tool use ids, tool result ids, and thinking signatures", () => {
    const message = {
      role: "assistant",
      id: "assistant-msg-1",
      content: [
        { type: "text", text: "I am going to use a tool." },
        { type: "toolUse", id: "tool-call-1" },
        { type: "tool_result", tool_use_id: "tool-call-1" },
        { type: "thinking", thinkingSignature: "sig-1" },
      ],
    };

    expect(extractMessageRuntimeMeta(message, "assistant")).toEqual({
      providerMessageId: "assistant-msg-1",
      toolUseIds: ["tool-call-1"],
      toolResultIds: ["tool-call-1"],
      thinkingSignatures: ["sig-1"],
    });
  });

  it("normalizes tool result messages while preserving runtime metadata", () => {
    const normalized = normalizeIncomingMessage({
      role: "toolResult",
      toolCallId: "tool-call-7",
      toolName: "read",
      isError: false,
      content: [{ type: "text", text: "tool output" }],
    });

    expect(normalized.contentText).toBe("tool output");
    expect(normalized.runtimeMeta).toEqual({
      toolResultIds: ["tool-call-7"],
    });
    expect(normalized.runtimeShape).toEqual({
      toolCallId: "tool-call-7",
      toolName: "read",
      isError: false,
      content: [{ type: "text", text: "tool output" }],
    });
  });

  it("captures API-relevant structured assistant content for later invariant repair", () => {
    const normalized = normalizeIncomingMessage({
      role: "assistant",
      id: "assistant-msg-9",
      uuid: "uuid-9",
      stopReason: "toolUse",
      content: [
        { type: "thinking", thinking: "internal", thinkingSignature: "sig-9" },
        { type: "toolUse", id: "tool-call-9", name: "grep", arguments: { q: "needle" } },
      ],
    });

    expect(normalized.runtimeShape).toEqual({
      messageId: "assistant-msg-9",
      messageUuid: "uuid-9",
      stopReason: "toolUse",
      content: [
        { type: "thinking", thinking: "internal", thinkingSignature: "sig-9" },
        { type: "toolUse", id: "tool-call-9", name: "grep", arguments: { q: "needle" } },
      ],
    });
  });
});
