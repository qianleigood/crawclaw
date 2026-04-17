import { beforeEach, describe, expect, it, vi } from "vitest";

const bindingContextMocks = vi.hoisted(() => ({
  resolveConversationBindingContext: vi.fn(),
}));

vi.mock("./conversation-binding-context.js", () => ({
  resolveConversationBindingContext: bindingContextMocks.resolveConversationBindingContext,
}));

const {
  resolveConversationBindingAccountIdFromMessage,
  resolveConversationBindingChannelFromMessage,
  resolveConversationBindingContextFromAcpCommand,
  resolveConversationBindingContextFromMessage,
  resolveConversationBindingThreadIdFromMessage,
} = await import("./conversation-binding-input.js");

describe("conversation-binding-input", () => {
  beforeEach(() => {
    bindingContextMocks.resolveConversationBindingContext.mockReset();
    bindingContextMocks.resolveConversationBindingContext.mockReturnValue(null);
  });

  it("prefers originating channel over command, surface, and provider", () => {
    expect(
      resolveConversationBindingChannelFromMessage(
        {
          OriginatingChannel: "telegram",
          Surface: "discord",
          Provider: "matrix",
        },
        "slack",
      ),
    ).toBe("telegram");
  });

  it("defaults account ids to default and normalizes thread ids", () => {
    expect(resolveConversationBindingAccountIdFromMessage({})).toBe("default");
    expect(resolveConversationBindingAccountIdFromMessage({ AccountId: " acct-1 " })).toBe(
      "acct-1",
    );
    expect(resolveConversationBindingThreadIdFromMessage({ MessageThreadId: 123 })).toBe("123");
    expect(resolveConversationBindingThreadIdFromMessage({ MessageThreadId: " 456 " })).toBe("456");
  });

  it("passes normalized message binding inputs to the channels binding resolver", () => {
    resolveConversationBindingContextFromMessage({
      cfg: {} as never,
      ctx: {
        OriginatingChannel: "discord",
        AccountId: " acct-1 ",
        ChatType: "group",
        MessageThreadId: 12,
        ThreadParentId: "parent-1",
        SenderId: "sender-1",
        SessionKey: "session-1",
        ParentSessionKey: "parent-session-1",
        OriginatingTo: "channel:bound",
        To: "channel:fallback",
        From: "user:sender",
        NativeChannelId: "native-1",
      },
      senderId: "override-sender",
      sessionKey: "override-session",
      parentSessionKey: "override-parent",
      commandTo: "channel:command",
    });

    expect(bindingContextMocks.resolveConversationBindingContext).toHaveBeenCalledWith({
      cfg: {} as never,
      channel: "discord",
      accountId: "acct-1",
      chatType: "group",
      threadId: "12",
      threadParentId: "parent-1",
      senderId: "override-sender",
      sessionKey: "override-session",
      parentSessionKey: "override-parent",
      originatingTo: "channel:bound",
      commandTo: "channel:command",
      fallbackTo: "channel:fallback",
      from: "user:sender",
      nativeChannelId: "native-1",
    });
  });

  it("maps ACP command params into message binding inputs", () => {
    resolveConversationBindingContextFromAcpCommand({
      cfg: {} as never,
      ctx: {
        Provider: "telegram",
        AccountId: "acct-2",
        ParentSessionKey: "parent-session-2",
      },
      sessionKey: "session-2",
      command: {
        senderId: "sender-2",
        to: "conversation:command",
      },
    });

    expect(bindingContextMocks.resolveConversationBindingContext).toHaveBeenCalledWith({
      cfg: {} as never,
      channel: "telegram",
      accountId: "acct-2",
      chatType: undefined,
      threadId: undefined,
      threadParentId: undefined,
      senderId: "sender-2",
      sessionKey: "session-2",
      parentSessionKey: "parent-session-2",
      originatingTo: undefined,
      commandTo: "conversation:command",
      fallbackTo: undefined,
      from: undefined,
      nativeChannelId: undefined,
    });
  });
});
