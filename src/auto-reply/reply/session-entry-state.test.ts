import { describe, expect, it } from "vitest";
import type { SessionEntry } from "../../config/sessions/types.js";
import { buildSessionEntryState } from "./session-entry-state.js";

describe("buildSessionEntryState", () => {
  it("builds delivery fields without inheriting stale thread ids for non-thread sessions", () => {
    const baseEntry = {
      sessionId: "prev-session",
      updatedAt: 1_700_000_000_000,
      responseUsage: "full",
      sendPolicy: "allow",
      queueMode: "collect",
      queueDebounceMs: 300,
      queueCap: 9,
      queueDrop: "summarize",
      lastChannel: "telegram",
      lastTo: "telegram:user",
      lastAccountId: "acct-1",
      lastThreadId: "topic-99",
      displayName: "Old Display",
    } as SessionEntry;

    const result = buildSessionEntryState({
      ctx: {
        From: "telegram:sender",
        To: "telegram:bot",
        Surface: "telegram",
        Provider: "telegram",
        ChatType: "direct",
        ThreadLabel: "Inbox",
      },
      sessionKey: "agent:main:telegram:direct:123",
      baseEntry,
      resetCarryOver: { thinkingLevel: "high" },
      sessionId: "next-session",
      systemSent: false,
      abortedLastRun: false,
      now: 1_800_000_000_000,
      isThread: false,
    });

    expect(result).toMatchObject({
      sessionId: "next-session",
      updatedAt: 1_800_000_000_000,
      thinkingLevel: "high",
      responseUsage: "full",
      sendPolicy: "allow",
      queueMode: "collect",
      queueDebounceMs: 300,
      queueCap: 9,
      queueDrop: "summarize",
      lastChannel: "telegram",
      lastTo: "telegram:user",
      lastAccountId: "acct-1",
      lastThreadId: undefined,
      chatType: "direct",
      displayName: "Inbox",
      deliveryContext: {
        channel: "telegram",
        to: "telegram:user",
        accountId: "acct-1",
      },
      origin: {
        provider: "telegram",
        surface: "telegram",
        chatType: "direct",
        from: "telegram:sender",
        to: "telegram:bot",
      },
    });
    expect(result.deliveryContext?.threadId).toBeUndefined();
  });
});
