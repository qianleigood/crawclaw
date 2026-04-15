import { afterEach, describe, expect, it } from "vitest";
import { SqliteRuntimeStore } from "./sqlite-runtime-store.js";
import { createTrackedTempDirs } from "../../test-utils/tracked-temp-dirs.js";

const tempDirs = createTrackedTempDirs();
const stores: SqliteRuntimeStore[] = [];

afterEach(async () => {
  await Promise.all(stores.splice(0).map(async (store) => store.close()));
  await tempDirs.cleanup();
});

describe("SqliteRuntimeStore gm_messages runtime meta", () => {
  it("round-trips structured runtime metadata for gm_messages", async () => {
    const rootDir = await tempDirs.make("sqlite-runtime-meta-");
    const store = new SqliteRuntimeStore(`${rootDir}/runtime.sqlite`);
    await store.init();
    stores.push(store);

    await store.appendMessage({
      sessionId: "session-1",
      conversationUid: "conv-1",
      role: "assistant",
      content: "assistant tool planning",
      turnIndex: 3,
      runtimeMeta: {
        providerMessageId: "assistant-msg-7",
        toolUseIds: ["tool-call-1", "tool-call-2"],
        thinkingSignatures: ["thinking-sig-1"],
      },
      runtimeShape: {
        messageId: "assistant-msg-7",
        messageUuid: "uuid-1",
        stopReason: "toolUse",
        content: [
          { type: "thinking", thinking: "reasoning", thinkingSignature: "thinking-sig-1" },
          { type: "toolUse", id: "tool-call-1", name: "read" },
          { type: "toolUse", id: "tool-call-2", name: "exec" },
        ],
      },
      createdAt: 1_717_171_717_000,
    });

    await store.appendMessage({
      sessionId: "session-1",
      conversationUid: "conv-1",
      role: "toolResult",
      content: "tool result payload",
      turnIndex: 4,
      runtimeMeta: {
        toolResultIds: ["tool-call-2"],
      },
      runtimeShape: {
        toolCallId: "tool-call-2",
        toolName: "exec",
        isError: false,
        content: [{ type: "text", text: "tool result payload" }],
      },
      createdAt: 1_717_171_718_000,
    });

    const rows = await store.listMessagesByTurnRange("session-1", 1, 10);

    expect(rows).toHaveLength(2);
    expect(rows[0]?.runtimeMeta).toEqual({
      providerMessageId: "assistant-msg-7",
      toolUseIds: ["tool-call-1", "tool-call-2"],
      thinkingSignatures: ["thinking-sig-1"],
    });
    expect(rows[0]?.runtimeShape).toEqual({
      messageId: "assistant-msg-7",
      messageUuid: "uuid-1",
      stopReason: "toolUse",
      content: [
        { type: "thinking", thinking: "reasoning", thinkingSignature: "thinking-sig-1" },
        { type: "toolUse", id: "tool-call-1", name: "read" },
        { type: "toolUse", id: "tool-call-2", name: "exec" },
      ],
    });
    expect(rows[1]?.runtimeMeta).toEqual({
      toolResultIds: ["tool-call-2"],
    });
    expect(rows[1]?.runtimeShape).toEqual({
      toolCallId: "tool-call-2",
      toolName: "exec",
      isError: false,
      content: [{ type: "text", text: "tool result payload" }],
    });
  });
});
