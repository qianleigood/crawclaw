import { describe, expect, it } from "vitest";
import { convertMinimaxXmlToolCallsInMessage } from "./attempt.minimax-tool-call-xml.js";

describe("convertMinimaxXmlToolCallsInMessage", () => {
  it("converts minimax xml invoke blocks into structured tool calls", () => {
    const message = {
      role: "assistant",
      stopReason: "stop",
      content: [
        { type: "thinking", thinking: "call tool" },
        {
          type: "text",
          text:
            "好的，我来记住这个偏好。\n" +
            "<minimax:tool_call>\n" +
            "<invoke name=\"memory_note_write\">\n" +
            "<parameter name=\"note_path\">60 Preferences/step-first.md</parameter>\n" +
            "<parameter name=\"content\">---\ntitle: Step-first\n---</parameter>\n" +
            "</invoke>\n" +
            "</minimax:tool_call>\n" +
            "以后按这个来。",
        },
      ],
    };

    const changed = convertMinimaxXmlToolCallsInMessage(
      message,
      new Set(["memory_note_write"]),
    );

    expect(changed).toBe(true);
    expect(message.stopReason).toBe("toolUse");
    expect(message.content).toEqual([
      { type: "thinking", thinking: "call tool" },
      {
        type: "toolCall",
        id: "call_minimax_xml_1",
        name: "memory_note_write",
        arguments: {
          notePath: "60 Preferences/step-first.md",
          content: "---\ntitle: Step-first\n---",
        },
      },
    ]);
  });

  it("ignores minimax xml invokes that do not match allowed tools", () => {
    const message = {
      role: "assistant",
      stopReason: "stop",
      content: [
        {
          type: "text",
          text:
            "<minimax:tool_call>\n" +
            "<invoke name=\"sessions_list\"></invoke>\n" +
            "</minimax:tool_call>",
        },
      ],
    };

    const changed = convertMinimaxXmlToolCallsInMessage(
      message,
      new Set(["memory_note_write"]),
    );

    expect(changed).toBe(false);
    expect(message.stopReason).toBe("stop");
    expect(message.content).toHaveLength(1);
  });
});
