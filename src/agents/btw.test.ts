import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionEntry } from "../config/sessions.js";

const callGatewayCliMock = vi.fn();

vi.mock("../gateway/call.js", () => ({
  callGatewayCli: (request: unknown) => callGatewayCliMock(request),
}));

const { runBtwSideQuestion } = await import("./btw.js");
type RunBtwSideQuestionParams = Parameters<typeof runBtwSideQuestion>[0];

const DEFAULT_SESSION_KEY = "agent:main:main";
const DEFAULT_QUESTION = "What changed?";

function createSessionEntry(overrides: Partial<SessionEntry> = {}): SessionEntry {
  return {
    sessionId: "session-1",
    sessionFile: "session-1.jsonl",
    updatedAt: Date.now(),
    ...overrides,
  };
}

function runSideQuestion(overrides: Partial<RunBtwSideQuestionParams> = {}) {
  return runBtwSideQuestion({
    cfg: {} as never,
    agentDir: "/tmp/agent",
    provider: "anthropic",
    model: "claude-sonnet-4-5",
    question: DEFAULT_QUESTION,
    sessionEntry: createSessionEntry(),
    sessionKey: DEFAULT_SESSION_KEY,
    resolvedReasoningLevel: "off",
    opts: {},
    isNewSession: false,
    ...overrides,
  });
}

describe("runBtwSideQuestion", () => {
  beforeEach(() => {
    callGatewayCliMock.mockReset();
    callGatewayCliMock.mockResolvedValue({
      runId: "run-1",
      sessionKey: DEFAULT_SESSION_KEY,
      assistantText: "Side answer.",
      events: [
        {
          type: "replyPayload",
          payload: { text: "Side answer.", metadata: { btw: { question: DEFAULT_QUESTION } } },
        },
      ],
    });
  });

  it("delegates /btw side questions to the Rust command runtime", async () => {
    const result = await runSideQuestion({ opts: { runId: "btw-run-1" } });

    expect(callGatewayCliMock).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "agent.command.run",
        params: expect.objectContaining({
          runId: "btw-run-1",
          sessionKey: DEFAULT_SESSION_KEY,
          inbound: expect.objectContaining({
            channel: "btw",
            body: DEFAULT_QUESTION,
            metadata: { btw: { question: DEFAULT_QUESTION } },
          }),
          model: {
            provider: "anthropic",
            model: "claude-sonnet-4-5",
            reasoningLevel: "off",
          },
          options: {
            mode: "btw",
            btwQuestion: DEFAULT_QUESTION,
            ephemeral: true,
          },
        }),
      }),
    );
    expect(result).toEqual({ text: "Side answer.", btw: { question: DEFAULT_QUESTION } });
  });

  it("uses the session id when no session key is provided", async () => {
    await runSideQuestion({ sessionKey: undefined });

    expect(callGatewayCliMock).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "agent.command.run",
        params: expect.objectContaining({ sessionKey: "session-1" }),
      }),
    );
  });

  it("emits block replies without returning a final payload", async () => {
    const onBlockReply = vi.fn().mockResolvedValue(undefined);

    const result = await runSideQuestion({
      blockReplyChunking: { minChars: 20, maxChars: 80 },
      opts: { onBlockReply },
    });

    expect(onBlockReply).toHaveBeenCalledWith({
      text: "Side answer.",
      btw: { question: DEFAULT_QUESTION },
    });
    expect(result).toBeUndefined();
  });

  it("rejects missing session context", async () => {
    await expect(
      runSideQuestion({ sessionEntry: createSessionEntry({ sessionId: "" }), sessionKey: "" }),
    ).rejects.toThrow("No active session context.");
    expect(callGatewayCliMock).not.toHaveBeenCalled();
  });

  it("rejects empty Rust runtime output", async () => {
    callGatewayCliMock.mockResolvedValue({ runId: "run-1", sessionKey: DEFAULT_SESSION_KEY });

    await expect(runSideQuestion()).rejects.toThrow("No BTW response generated.");
  });
});
