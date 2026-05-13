import fs from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { runCrawClawRuntimeTool } from "../agents/runtime-tools/native.js";
import { resolveRunTypingPolicyWithRust } from "./typing-policy-runtime.js";

vi.mock("../agents/runtime-tools/native.js", () => ({
  runCrawClawRuntimeTool: vi.fn(),
}));

const runRuntimeTool = vi.mocked(runCrawClawRuntimeTool);

describe("resolveRunTypingPolicyWithRust", () => {
  beforeEach(() => {
    runRuntimeTool.mockReset();
  });

  it("uses the Rust message policy worker operation", async () => {
    runRuntimeTool.mockResolvedValue({
      typingPolicy: "system_event",
      suppressTyping: true,
    });

    const result = await resolveRunTypingPolicyWithRust({
      requestedPolicy: "user_message",
      originatingChannel: "Telegram",
      systemEvent: true,
    });

    expect(result.typingPolicy).toBe("system_event");
    expect(runRuntimeTool).toHaveBeenCalledWith(
      "message_policy",
      {
        operation: "outbound.resolveTypingPolicy",
        payload: {
          requestedPolicy: "user_message",
          suppressTyping: undefined,
          isHeartbeat: undefined,
          originatingChannel: "telegram",
          systemEvent: true,
        },
      },
      { timeoutMs: 30_000 },
    );
  });

  it("keeps dispatch and prepared replies on the Rust typing policy adapter", () => {
    const dispatchSource = fs.readFileSync(
      new URL("../auto-reply/reply/dispatch-from-config.ts", import.meta.url),
      "utf8",
    );
    const preparedReplySource = fs.readFileSync(
      new URL("../auto-reply/reply/get-reply-run.ts", import.meta.url),
      "utf8",
    );

    expect(dispatchSource).toContain("../../channels/typing-policy-runtime.js");
    expect(dispatchSource).not.toContain("../../channels/typing-policy.js");
    expect(preparedReplySource).toContain("../../channels/typing-policy-runtime.js");
    expect(preparedReplySource).not.toContain("../../channels/typing-policy.js");
  });
});
