import { describe, expect, it, vi } from "vitest";
import type { SessionEntry } from "../config/sessions.js";

const sessionResetEntryMocks = vi.hoisted(() => ({
  resolveSessionModelRef: vi.fn(),
}));

vi.mock("./session-utils.js", () => ({
  resolveSessionModelRef: sessionResetEntryMocks.resolveSessionModelRef,
}));

const { buildGatewayResetEntry } = await import("./session-reset-entry.js");

describe("buildGatewayResetEntry", () => {
  it("preserves carry-over fields while clearing runtime state and allocating a new session id", () => {
    sessionResetEntryMocks.resolveSessionModelRef.mockReturnValue({
      provider: "anthropic",
      model: "claude-sonnet-4",
    });

    const currentEntry = {
      sessionId: "old-session-id",
      sessionFile: "/tmp/existing.jsonl",
      updatedAt: 1_700_000_000_000,
      systemSent: true,
      abortedLastRun: true,
      thinkingLevel: "high",
      fastMode: true,
      verboseLevel: "full",
      reasoningLevel: "on",
      elevatedLevel: "auto",
      providerOverride: "openai",
      modelOverride: "gpt-5.4",
      authProfileOverride: "owner",
      queueMode: "collect",
      queueDebounceMs: 300,
      queueCap: 9,
      queueDrop: "summarize",
      label: "Pinned",
      displayName: "Pinned Display",
      origin: {
        sourceSessionId: "root-session",
      },
      inputTokens: 42,
      outputTokens: 84,
      totalTokens: 126,
      totalTokensFresh: false,
      contextTokens: 1234,
      model: "stale-model",
      modelProvider: "stale-provider",
    } as SessionEntry;

    const result = buildGatewayResetEntry({
      cfg: {} as never,
      primaryKey: "agent:main:telegram:direct:123",
      currentEntry,
      storePath: "/tmp/sessions.json",
      now: 1_800_000_000_000,
      createSessionId: () => "new-session-id",
    });

    expect(result.resetSourceEntry).toEqual(currentEntry);
    expect(result.oldSessionId).toBe("old-session-id");
    expect(result.oldSessionFile).toBe("/tmp/existing.jsonl");
    expect(result.nextEntry).toMatchObject({
      sessionId: "new-session-id",
      updatedAt: 1_800_000_000_000,
      systemSent: false,
      abortedLastRun: false,
      thinkingLevel: "high",
      fastMode: true,
      verboseLevel: "full",
      reasoningLevel: "on",
      elevatedLevel: "auto",
      providerOverride: "openai",
      modelOverride: "gpt-5.4",
      authProfileOverride: "owner",
      queueMode: "collect",
      queueDebounceMs: 300,
      queueCap: 9,
      queueDrop: "summarize",
      label: "Pinned",
      displayName: "Pinned Display",
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      totalTokensFresh: true,
      contextTokens: undefined,
      modelProvider: "anthropic",
      model: "claude-sonnet-4",
      origin: { sourceSessionId: "root-session" },
    });
    expect(result.nextEntry.sessionFile).toMatch(/\.jsonl$/);
  });
});
