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

  it("preserves external origin identity when webchat updates a channel-bound session", () => {
    const baseEntry = {
      sessionId: "prev-session",
      updatedAt: 1_700_000_000_000,
      lastChannel: "feishu",
      lastTo: "ou_833e794925a4d0da1e85f6cc2c3ab970",
      origin: {
        label: "钱磊",
        provider: "feishu",
        surface: "feishu",
        chatType: "direct",
        from: "feishu:ou_833e794925a4d0da1e85f6cc2c3ab970",
        to: "feishu:bot",
      },
    } as SessionEntry;

    const result = buildSessionEntryState({
      ctx: {
        From: "webchat:user-1",
        To: "webchat:agent",
        Surface: "webchat",
        Provider: "webchat",
        OriginatingChannel: "webchat",
        OriginatingTo: "session:client",
        ChatType: "direct",
      },
      sessionKey: "agent:main:feishu:direct:ou_833e794925a4d0da1e85f6cc2c3ab970",
      baseEntry,
      sessionId: "next-session",
      systemSent: false,
      abortedLastRun: false,
      now: 1_800_000_000_000,
      isThread: false,
    });

    expect(result.origin).toEqual(baseEntry.origin);
  });
});
