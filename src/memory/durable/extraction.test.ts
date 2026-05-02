import { describe, expect, it } from "vitest";
import { makeAgentToolResultMessage } from "../../agents/test-helpers/agent-message-fixtures.js";
import {
  classifyAfterTurnDurableSkipReason,
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
});
