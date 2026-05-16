import { describe, expect, it } from "vitest";
import type { FinalizedMsgContext } from "../auto-reply/templating.js";
import type { CrawClawConfig } from "../config/config.js";
import {
  buildCanonicalSentMessageToolCallPreflightContext,
  deriveInboundMessageToolCallPreflightContext,
  toInternalMessagePreprocessedContext,
  toInternalMessageReceivedContext,
  toInternalMessageSentContext,
  toInternalMessageTranscribedContext,
} from "./message-hook-mappers.js";

function makeInboundCtx(overrides: Partial<FinalizedMsgContext> = {}): FinalizedMsgContext {
  return {
    From: "feishu:user:123",
    To: "feishu:chat:456",
    Body: "body",
    BodyForAgent: "body-for-agent",
    BodyForCommands: "commands-body",
    RawBody: "raw-body",
    Transcript: "hello transcript",
    Timestamp: 1710000000,
    Provider: "feishu",
    Surface: "feishu",
    OriginatingChannel: "feishu",
    OriginatingTo: "feishu:chat:456",
    AccountId: "acc-1",
    MessageSid: "msg-1",
    SenderId: "sender-1",
    SenderName: "User One",
    SenderUsername: "userone",
    SenderE164: "+15551234567",
    MessageThreadId: 42,
    MediaPath: "/tmp/audio.ogg",
    MediaType: "audio/ogg",
    GroupSubject: "ops",
    GroupChannel: "ops-room",
    GroupSpace: "guild-1",
    ...overrides,
  } as FinalizedMsgContext;
}

describe("message hook mappers", () => {
  it("derives canonical inbound context with body precedence and group metadata", () => {
    const canonical = deriveInboundMessageToolCallPreflightContext(makeInboundCtx());

    expect(canonical.content).toBe("commands-body");
    expect(canonical.channelId).toBe("feishu");
    expect(canonical.conversationId).toBe("feishu:chat:456");
    expect(canonical.messageId).toBe("msg-1");
    expect(canonical.isGroup).toBe(true);
    expect(canonical.groupId).toBe("feishu:chat:456");
    expect(canonical.guildId).toBe("guild-1");
  });

  it("supports explicit content/messageId overrides", () => {
    const canonical = deriveInboundMessageToolCallPreflightContext(makeInboundCtx(), {
      content: "override-content",
      messageId: "override-msg",
    });

    expect(canonical.content).toBe("override-content");
    expect(canonical.messageId).toBe("override-msg");
  });

  it("preserves multi-attachment arrays for inbound claim metadata", () => {
    const canonical = deriveInboundMessageToolCallPreflightContext(
      makeInboundCtx({
        MediaPath: undefined,
        MediaType: undefined,
        MediaPaths: ["/tmp/tree.jpg", "/tmp/ramp.jpg"],
        MediaTypes: ["image/jpeg", "image/jpeg"],
      }),
    );

    expect(canonical.mediaPath).toBe("/tmp/tree.jpg");
    expect(canonical.mediaType).toBe("image/jpeg");
    expect(canonical.mediaPaths).toEqual(["/tmp/tree.jpg", "/tmp/ramp.jpg"]);
    expect(canonical.mediaTypes).toEqual(["image/jpeg", "image/jpeg"]);
  });

  it("maps canonical inbound context to internal received payloads", () => {
    const canonical = deriveInboundMessageToolCallPreflightContext(makeInboundCtx());

    expect(toInternalMessageReceivedContext(canonical)).toEqual({
      from: "feishu:user:123",
      content: "commands-body",
      timestamp: 1710000000,
      channelId: "feishu",
      accountId: "acc-1",
      conversationId: "feishu:chat:456",
      messageId: "msg-1",
      metadata: expect.objectContaining({
        senderUsername: "userone",
        senderE164: "+15551234567",
      }),
    });
  });

  it("maps transcribed and preprocessed internal payloads", () => {
    const cfg = {} as CrawClawConfig;
    const canonical = deriveInboundMessageToolCallPreflightContext(
      makeInboundCtx({ Transcript: undefined }),
    );

    const transcribed = toInternalMessageTranscribedContext(canonical, cfg);
    expect(transcribed.transcript).toBe("");
    expect(transcribed.cfg).toBe(cfg);

    const preprocessed = toInternalMessagePreprocessedContext(canonical, cfg);
    expect(preprocessed.transcript).toBeUndefined();
    expect(preprocessed.isGroup).toBe(true);
    expect(preprocessed.groupId).toBe("feishu:chat:456");
    expect(preprocessed.cfg).toBe(cfg);
  });

  it("maps sent context consistently for internal hooks", () => {
    const canonical = buildCanonicalSentMessageToolCallPreflightContext({
      to: "feishu:chat:456",
      content: "reply",
      success: false,
      error: "network error",
      channelId: "feishu",
      accountId: "acc-1",
      messageId: "out-1",
      isGroup: true,
      groupId: "feishu:chat:456",
    });

    expect(toInternalMessageSentContext(canonical)).toEqual({
      to: "feishu:chat:456",
      content: "reply",
      success: false,
      error: "network error",
      channelId: "feishu",
      accountId: "acc-1",
      conversationId: "feishu:chat:456",
      messageId: "out-1",
      isGroup: true,
      groupId: "feishu:chat:456",
    });
  });
});
