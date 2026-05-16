import { expect, vi } from "vitest";
import type { AgentMessage } from "./agent-types.js";

export type SessionEntry = { type: string; customType: string; data: unknown };
export type SanitizeSessionHistoryFn =
  typeof import("./runtime-support/google.js").sanitizeSessionHistory;
type SanitizeSessionManager = Parameters<SanitizeSessionHistoryFn>[0]["sessionManager"];
export type SanitizeSessionHistoryMockedHelpers = typeof import("./runtime-helpers.js");
export type SanitizeSessionHistoryHarness = {
  sanitizeSessionHistory: SanitizeSessionHistoryFn;
  mockedHelpers: SanitizeSessionHistoryMockedHelpers;
};
export const TEST_SESSION_ID = "test-session";

export function makeModelSnapshotEntry(data: {
  timestamp?: number;
  provider: string;
  modelApi: string;
  modelId: string;
}): SessionEntry {
  return {
    type: "custom",
    customType: "model-snapshot",
    data: {
      timestamp: data.timestamp ?? Date.now(),
      provider: data.provider,
      modelApi: data.modelApi,
      modelId: data.modelId,
    },
  };
}

export function makeInMemorySessionManager(entries: SessionEntry[]): SanitizeSessionManager {
  return {
    getEntries: vi.fn(() => entries),
    appendCustomEntry: vi.fn((customType: string, data: unknown) => {
      entries.push({ type: "custom", customType, data });
    }),
  } as unknown as SanitizeSessionManager;
}

export function makeMockSessionManager(): SanitizeSessionManager {
  return {
    getEntries: vi.fn().mockReturnValue([]),
    appendCustomEntry: vi.fn(),
  } as unknown as SanitizeSessionManager;
}

export function makeSimpleUserMessages(): AgentMessage[] {
  const messages = [{ role: "user", content: "hello" }];
  return messages as unknown as AgentMessage[];
}

export async function loadSanitizeSessionHistoryWithCleanMocks(): Promise<SanitizeSessionHistoryHarness> {
  vi.resetModules();
  vi.resetAllMocks();
  const mockedHelpers = await import("./runtime-helpers.js");
  vi.mocked(mockedHelpers.sanitizeSessionMessagesImages).mockImplementation(async (msgs) => msgs);
  const mod = await import("./runtime-support/google.js");
  return {
    sanitizeSessionHistory: mod.sanitizeSessionHistory,
    mockedHelpers,
  };
}

export function makeReasoningAssistantMessages(opts?: {
  thinkingSignature?: "object" | "json";
}): AgentMessage[] {
  const thinkingSignature: unknown =
    opts?.thinkingSignature === "json"
      ? JSON.stringify({ id: "rs_test", type: "reasoning" })
      : { id: "rs_test", type: "reasoning" };

  // Intentional: we want to build message payloads that can carry non-string
  // signatures, but core typing currently expects a string.
  const messages = [
    {
      role: "assistant",
      content: [
        {
          type: "thinking",
          thinking: "reasoning",
          thinkingSignature,
        },
      ],
    },
  ];

  return messages as unknown as AgentMessage[];
}

export async function sanitizeWithOpenAIResponses(params: {
  sanitizeSessionHistory: SanitizeSessionHistoryFn;
  messages: AgentMessage[];
  sessionManager: SanitizeSessionManager;
  modelId?: string;
}) {
  return await params.sanitizeSessionHistory({
    messages: params.messages,
    modelApi: "openai-responses",
    provider: "openai",
    sessionManager: params.sessionManager,
    modelId: params.modelId,
    sessionId: TEST_SESSION_ID,
  });
}

export function expectOpenAIResponsesStrictSanitizeCall(
  sanitizeSessionMessagesImagesMock: unknown,
  messages: AgentMessage[],
) {
  expect(sanitizeSessionMessagesImagesMock).toHaveBeenCalledWith(
    messages,
    "session:history",
    expect.objectContaining({
      sanitizeMode: "images-only",
      sanitizeToolCallIds: true,
      toolCallIdMode: "strict",
    }),
  );
}

export function makeSnapshotChangedOpenAIReasoningScenario() {
  const sessionEntries = [
    makeModelSnapshotEntry({
      provider: "anthropic",
      modelApi: "anthropic-messages",
      modelId: "claude-3-7",
    }),
  ];
  return {
    sessionManager: makeInMemorySessionManager(sessionEntries),
    messages: makeReasoningAssistantMessages({ thinkingSignature: "object" }),
    modelId: "gpt-5.2-codex",
  };
}

export async function sanitizeSnapshotChangedOpenAIReasoning(params: {
  sanitizeSessionHistory: SanitizeSessionHistoryFn;
}) {
  const { sessionManager, messages, modelId } = makeSnapshotChangedOpenAIReasoningScenario();
  return await sanitizeWithOpenAIResponses({
    sanitizeSessionHistory: params.sanitizeSessionHistory,
    messages,
    modelId,
    sessionManager,
  });
}
