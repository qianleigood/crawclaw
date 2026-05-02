import { describe, expect, it } from "vitest";
import {
  castAgentMessages,
  makeAgentAssistantMessage,
  makeAgentToolResultMessage,
  makeAgentUserMessage,
} from "../../agents/test-helpers/agent-message-fixtures.js";
import {
  classifyAfterTurnDurableSkipReason,
  collectRecentDurableConversation,
  hasDurableMemoryWriteInMessages,
  shouldSkipAfterTurnDurableExtraction,
} from "./extraction.ts";

describe("durable extraction helpers", () => {
  it("treats only mutating durable-memory tools as explicit writes", () => {
    expect(
      hasDurableMemoryWriteInMessages([
        makeAgentToolResultMessage({
          toolCallId: "call-0",
          toolName: "memory_manifest_read",
          content: [{ type: "text", text: "ok" }],
        }),
      ]),
    ).toBe(false);

    expect(
      hasDurableMemoryWriteInMessages([
        makeAgentToolResultMessage({
          toolCallId: "call-read",
          toolName: "memory_note_read",
          content: [{ type: "text", text: "ok" }],
        }),
      ]),
    ).toBe(false);

    expect(
      hasDurableMemoryWriteInMessages([
        makeAgentToolResultMessage({
          toolCallId: "call-1",
          toolName: "memory_note_write",
          content: [{ type: "text", text: "ok" }],
        }),
      ]),
    ).toBe(true);

    expect(
      hasDurableMemoryWriteInMessages([
        makeAgentToolResultMessage({
          toolCallId: "call-2",
          toolName: "memory_note_delete",
          content: [{ type: "text", text: "ok" }],
        }),
      ]),
    ).toBe(true);

    expect(
      hasDurableMemoryWriteInMessages([
        makeAgentToolResultMessage({
          toolCallId: "call-3",
          toolName: "write_experience_note",
          content: [{ type: "text", text: "ok" }],
        }),
      ]),
    ).toBe(false);
  });

  it("classifies after-turn skip reasons only for explicit durable writes", () => {
    expect(
      classifyAfterTurnDurableSkipReason([
        makeAgentToolResultMessage({
          toolCallId: "call-4a",
          toolName: "memory_note_read",
          content: [{ type: "text", text: "ok" }],
        }),
      ]),
    ).toBeNull();

    expect(
      classifyAfterTurnDurableSkipReason([
        makeAgentToolResultMessage({
          toolCallId: "call-4",
          toolName: "memory_note_write",
          content: [{ type: "text", text: "ok" }],
        }),
      ]),
    ).toBe("durable_write");

    expect(
      classifyAfterTurnDurableSkipReason([
        makeAgentToolResultMessage({
          toolCallId: "call-5",
          toolName: "write_experience_note",
          content: [{ type: "text", text: '{"status":"ok","noteId":"abc"}' }],
        }),
      ]),
    ).toBeNull();
  });

  it("does not suppress after-turn durable extraction after experience note write", () => {
    expect(
      shouldSkipAfterTurnDurableExtraction([
        makeAgentToolResultMessage({
          toolCallId: "call-6",
          toolName: "write_experience_note",
          content: [{ type: "text", text: '{"status":"ok","noteId":"abc"}' }],
          details: { status: "ok", noteId: "abc" },
        }),
      ]),
    ).toBe(false);

    expect(
      shouldSkipAfterTurnDurableExtraction([
        makeAgentToolResultMessage({
          toolCallId: "call-7",
          toolName: "write_experience_note",
          content: [{ type: "text", text: '{"status":"error"}' }],
          details: { status: "error" },
          isError: true,
        }),
      ]),
    ).toBe(false);
  });

  it("collects only recent visible user and assistant messages", () => {
    const recent = collectRecentDurableConversation(
      castAgentMessages([
        makeAgentUserMessage({ content: "记住我喜欢简洁回复。" }),
        makeAgentToolResultMessage({
          toolCallId: "call-8",
          toolName: "memory_note_write",
          content: [{ type: "text", text: "ignored" }],
        }),
        makeAgentAssistantMessage({
          content: [{ type: "text", text: "好的，以后我会尽量简洁。" }],
        }),
      ]),
      8,
    );

    expect(recent).toEqual([
      { role: "user", text: "记住我喜欢简洁回复。" },
      { role: "assistant", text: "好的，以后我会尽量简洁。" },
    ]);
  });

  it("strips internal runtime context before durable extraction", () => {
    const recent = collectRecentDurableConversation(
      castAgentMessages([
        makeAgentUserMessage({
          content: [
            "[Sat 2026-05-02 14:14 GMT+8] <<<BEGIN_CRAWCLAW_INTERNAL_CONTEXT>>>",
            "CrawClaw runtime context (internal):",
            "This context is runtime-generated, not user-authored. Keep internal details private.",
            "",
            "[Internal task completion event]",
            "Action:",
            "Reply ONLY: NO_REPLY if this exact result was already delivered.",
            "<<<END_CRAWCLAW_INTERNAL_CONTEXT>>>",
          ].join("\n"),
        }),
        makeAgentUserMessage({
          content: [
            "[Sat 2026-05-02 14:15 GMT+8] <<<BEGIN_CRAWCLAW_INTERNAL_CONTEXT>>>",
            "internal delivery block",
            "<<<END_CRAWCLAW_INTERNAL_CONTEXT>>>",
            "",
            "记住我喜欢简洁回复。",
          ].join("\n"),
        }),
      ]),
      8,
    );

    expect(recent).toEqual([{ role: "user", text: "记住我喜欢简洁回复。" }]);
  });
});
