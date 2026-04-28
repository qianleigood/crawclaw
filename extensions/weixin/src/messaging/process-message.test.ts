import type { CrawClawConfig, PluginRuntime } from "crawclaw/plugin-sdk/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WeixinMessage } from "../api/types.js";
import { processOneMessage } from "./process-message.js";

const commandAuthMocks = vi.hoisted(() => ({
  resolveSenderCommandAuthorizationWithRuntime: vi.fn(async () => ({
    senderAllowedForCommands: true,
    commandAuthorized: true,
  })),
  resolveDirectDmAuthorizationOutcome: vi.fn(() => "allowed"),
}));

const handleSlashCommandMock = vi.hoisted(() => vi.fn(async () => ({ handled: false })));
const setContextTokenMock = vi.hoisted(() => vi.fn());
const sendTypingMock = vi.hoisted(() => vi.fn(async () => undefined));

vi.mock("crawclaw/plugin-sdk/command-auth", () => ({
  resolveSenderCommandAuthorizationWithRuntime:
    commandAuthMocks.resolveSenderCommandAuthorizationWithRuntime,
  resolveDirectDmAuthorizationOutcome: commandAuthMocks.resolveDirectDmAuthorizationOutcome,
}));

vi.mock("../api/api.js", () => ({
  sendTyping: sendTypingMock,
}));

vi.mock("../auth/accounts.js", () => ({
  loadWeixinAccount: vi.fn(() => ({ userId: "user-1" })),
}));

vi.mock("../auth/pairing.js", () => ({
  readFrameworkAllowFromList: vi.fn(() => []),
}));

vi.mock("../media/media-download.js", () => ({
  downloadMediaFromItem: vi.fn(async () => ({})),
}));

vi.mock("./debug-mode.js", () => ({
  isDebugMode: vi.fn(() => false),
}));

vi.mock("./error-notice.js", () => ({
  sendWeixinErrorNotice: vi.fn(async () => undefined),
}));

vi.mock("./inbound.js", () => ({
  setContextToken: setContextTokenMock,
  getContextTokenFromMsgContext: vi.fn(() => "ctx-token"),
  isMediaItem: vi.fn(() => false),
  weixinMessageToMsgContext: vi.fn((full: WeixinMessage, accountId: string) => ({
    Body: "hi",
    From: full.from_user_id ?? "",
    To: full.from_user_id ?? "",
    Provider: "weixin",
    Surface: "weixin",
    ChatType: "direct",
    AccountId: accountId,
  })),
}));

vi.mock("./outbound-hooks.js", () => ({
  applyWeixinMessageSendingHook: vi.fn(async ({ text }: { text: string }) => ({
    cancelled: false,
    text,
  })),
  emitWeixinMessageSent: vi.fn(),
}));

vi.mock("./send-media.js", () => ({
  sendWeixinMediaFile: vi.fn(async () => undefined),
}));

vi.mock("./send.js", () => ({
  sendMessageWeixin: vi.fn(async () => ({ messageId: "msg-1" })),
}));

vi.mock("./slash-commands.js", () => ({
  handleSlashCommand: handleSlashCommandMock,
}));

describe("weixin processOneMessage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does not force-disable block streaming for reply dispatch", async () => {
    const dispatchReplyFromConfig = vi.fn(async () => undefined);
    const withReplyDispatcher = vi.fn(async ({ run }: { run: () => Promise<void> }) => await run());

    const channelRuntime = {
      commands: {},
      routing: {
        resolveAgentRoute: vi.fn(() => ({
          agentId: "main",
          sessionKey: "agent:main:weixin:direct:user@im.wechat",
          mainSessionKey: "agent:main:main",
        })),
      },
      session: {
        resolveStorePath: vi.fn(() => "/tmp/crawclaw-weixin-session-store.json"),
        recordInboundSession: vi.fn(async () => undefined),
      },
      media: {
        saveMediaBuffer: vi.fn(async () => "/tmp/inbound.bin"),
      },
      reply: {
        finalizeInboundContext: vi.fn((ctx: unknown) => ctx),
        resolveHumanDelayConfig: vi.fn(() => undefined),
        createReplyDispatcherWithTyping: vi.fn(() => ({
          dispatcher: {},
          replyOptions: {},
          markDispatchIdle: vi.fn(),
        })),
        withReplyDispatcher,
        dispatchReplyFromConfig,
      },
    } as unknown as PluginRuntime["channel"];

    await processOneMessage(
      {
        from_user_id: "user@im.wechat",
        item_list: [{ type: 1, text_item: { text: "hi" } }],
      } as WeixinMessage,
      {
        accountId: "default",
        config: {} as CrawClawConfig,
        channelRuntime,
        baseUrl: "https://example.invalid",
        cdnBaseUrl: "https://cdn.example.invalid",
        log: () => {},
        errLog: () => {},
      },
    );

    expect(dispatchReplyFromConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        replyOptions: expect.not.objectContaining({
          disableBlockStreaming: true,
        }),
      }),
    );
  });
});
