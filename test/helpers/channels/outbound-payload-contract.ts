import { vi } from "vitest";
import type { ReplyPayload } from "../../../src/auto-reply/types.js";
import {
  createSlackOutboundPayloadHarness,
  installChannelOutboundPayloadContractSuite,
  primeChannelOutboundSendMock,
} from "../../../src/channels/plugins/contracts/suites.js";
import { createDirectTextMediaOutbound } from "../../../src/channels/plugins/outbound/direct-text-media.js";
import type { ChannelOutboundAdapter } from "../../../src/channels/plugins/types.js";
import { sendPayloadWithChunkedTextAndMedia } from "../../../src/plugin-sdk/reply-payload.js";
import {
  chunkTextForOutbound as chunkZaloTextForOutbound,
  sendPayloadWithChunkedTextAndMedia as sendZaloPayloadWithChunkedTextAndMedia,
} from "../../../src/plugin-sdk/zalo.js";
import { sendPayloadWithChunkedTextAndMedia as sendZalouserPayloadWithChunkedTextAndMedia } from "../../../src/plugin-sdk/zalouser.js";
import {
  loadBundledPluginPublicSurfaceSync,
  loadBundledPluginTestApiSync,
} from "../../../src/test-utils/bundled-plugin-public-surface.js";
type ParseZalouserOutboundTarget = (raw: string) => { threadId: string; isGroup: boolean };

type PayloadAdapter = Pick<
  ChannelOutboundAdapter,
  "chunker" | "textChunkLimit" | "sendText" | "sendMedia"
> & {
  sendText: NonNullable<ChannelOutboundAdapter["sendText"]>;
  sendMedia: NonNullable<ChannelOutboundAdapter["sendMedia"]>;
};

function requirePayloadAdapter(
  pluginId: string,
  plugin: {
    outbound?: Pick<
      ChannelOutboundAdapter,
      "chunker" | "textChunkLimit" | "sendText" | "sendMedia"
    >;
  },
): PayloadAdapter {
  if (!plugin.outbound?.sendText || !plugin.outbound?.sendMedia) {
    throw new Error(`${pluginId} payload adapter unavailable`);
  }
  return plugin.outbound as PayloadAdapter;
}

const { discordPlugin } = loadBundledPluginPublicSurfaceSync<{
  discordPlugin: {
    outbound?: Pick<
      ChannelOutboundAdapter,
      "chunker" | "textChunkLimit" | "sendText" | "sendMedia"
    >;
  };
}>({
  pluginId: "discord",
  artifactBasename: "index.js",
});
const discordOutbound = requirePayloadAdapter("discord", discordPlugin);
const { whatsappPlugin } = loadBundledPluginPublicSurfaceSync<{
  whatsappPlugin: {
    outbound?: Pick<
      ChannelOutboundAdapter,
      "chunker" | "textChunkLimit" | "sendText" | "sendMedia"
    >;
  };
}>({
  pluginId: "whatsapp",
  artifactBasename: "index.js",
});
const whatsappOutbound = requirePayloadAdapter("whatsapp", whatsappPlugin);
const { parseZalouserOutboundTarget } = loadBundledPluginTestApiSync<{
  parseZalouserOutboundTarget: ParseZalouserOutboundTarget;
}>("zalouser");

type PayloadHarnessParams = {
  payload: ReplyPayload;
  sendResults?: Array<{ messageId: string }>;
};

function buildChannelSendResult(channel: string, result: Record<string, unknown>) {
  return {
    channel,
    messageId: typeof result.messageId === "string" ? result.messageId : "",
  };
}

function createDiscordHarness(params: PayloadHarnessParams) {
  const sendDiscord = vi.fn();
  primeChannelOutboundSendMock(
    sendDiscord,
    { messageId: "dc-1", channelId: "123456" },
    params.sendResults,
  );
  const ctx = {
    cfg: {},
    to: "channel:123456",
    text: "",
    payload: params.payload,
    deps: {
      sendDiscord,
    },
  };
  return {
    run: async () =>
      await sendPayloadWithChunkedTextAndMedia({
        ctx,
        textChunkLimit: discordOutbound.textChunkLimit,
        chunker: discordOutbound.chunker,
        sendText: async (nextCtx) => await discordOutbound.sendText(nextCtx),
        sendMedia: async (nextCtx) => await discordOutbound.sendMedia(nextCtx),
        emptyResult: { channel: "discord", messageId: "" },
      }),
    sendMock: sendDiscord,
    to: ctx.to,
  };
}

function createWhatsAppHarness(params: PayloadHarnessParams) {
  const sendWhatsApp = vi.fn();
  primeChannelOutboundSendMock(sendWhatsApp, { messageId: "wa-1" }, params.sendResults);
  const ctx = {
    cfg: {},
    to: "5511999999999@c.us",
    text: "",
    payload: params.payload,
    deps: {
      sendWhatsApp,
    },
  };
  return {
    run: async () =>
      await sendPayloadWithChunkedTextAndMedia({
        ctx,
        textChunkLimit: whatsappOutbound.textChunkLimit,
        chunker: whatsappOutbound.chunker,
        sendText: async (nextCtx) => await whatsappOutbound.sendText(nextCtx),
        sendMedia: async (nextCtx) => await whatsappOutbound.sendMedia(nextCtx),
        emptyResult: { channel: "whatsapp", messageId: "" },
      }),
    sendMock: sendWhatsApp,
    to: ctx.to,
  };
}

function createDirectTextMediaHarness(params: PayloadHarnessParams) {
  const sendFn = vi.fn();
  primeChannelOutboundSendMock(sendFn, { messageId: "m1" }, params.sendResults);
  const outbound = createDirectTextMediaOutbound({
    channel: "imessage",
    resolveSender: () => sendFn,
    resolveMaxBytes: () => undefined,
    buildTextOptions: (opts) => opts as never,
    buildMediaOptions: (opts) => opts as never,
  });
  const ctx = {
    cfg: {},
    to: "user1",
    text: "",
    payload: params.payload,
  };
  return {
    run: async () => await outbound.sendPayload!(ctx),
    sendMock: sendFn,
    to: ctx.to,
  };
}

function createZaloHarness(params: PayloadHarnessParams) {
  const sendZalo = vi.fn();
  primeChannelOutboundSendMock(sendZalo, { ok: true, messageId: "zl-1" }, params.sendResults);
  const ctx = {
    cfg: {},
    to: "123456789",
    text: "",
    payload: params.payload,
  };
  return {
    run: async () =>
      await sendZaloPayloadWithChunkedTextAndMedia({
        ctx,
        textChunkLimit: 2000,
        chunker: chunkZaloTextForOutbound,
        sendText: async (nextCtx) =>
          buildChannelSendResult(
            "zalo",
            await sendZalo(nextCtx.to, nextCtx.text, {
              accountId: undefined,
              cfg: nextCtx.cfg,
            }),
          ),
        sendMedia: async (nextCtx) =>
          buildChannelSendResult(
            "zalo",
            await sendZalo(nextCtx.to, nextCtx.text, {
              accountId: undefined,
              cfg: nextCtx.cfg,
              mediaUrl: nextCtx.mediaUrl,
            }),
          ),
        emptyResult: { channel: "zalo", messageId: "" },
      }),
    sendMock: sendZalo,
    to: ctx.to,
  };
}

function createZalouserHarness(params: PayloadHarnessParams) {
  const sendZalouser = vi.fn();
  primeChannelOutboundSendMock(sendZalouser, { ok: true, messageId: "zlu-1" }, params.sendResults);
  const ctx = {
    cfg: {},
    to: "user:987654321",
    text: "",
    payload: params.payload,
  };
  return {
    run: async () =>
      await sendZalouserPayloadWithChunkedTextAndMedia({
        ctx,
        sendText: async (nextCtx) => {
          const target = parseZalouserOutboundTarget(nextCtx.to);
          return buildChannelSendResult(
            "zalouser",
            await sendZalouser(target.threadId, nextCtx.text, {
              profile: "default",
              isGroup: target.isGroup,
              textMode: "markdown",
              textChunkMode: "length",
              textChunkLimit: 1200,
            }),
          );
        },
        sendMedia: async (nextCtx) => {
          const target = parseZalouserOutboundTarget(nextCtx.to);
          return buildChannelSendResult(
            "zalouser",
            await sendZalouser(target.threadId, nextCtx.text, {
              profile: "default",
              isGroup: target.isGroup,
              mediaUrl: nextCtx.mediaUrl,
              textMode: "markdown",
              textChunkMode: "length",
              textChunkLimit: 1200,
            }),
          );
        },
        emptyResult: { channel: "zalouser", messageId: "" },
      }),
    sendMock: sendZalouser,
    to: "987654321",
  };
}

export function installSlackOutboundPayloadContractSuite() {
  installChannelOutboundPayloadContractSuite({
    channel: "slack",
    chunking: { mode: "passthrough", longTextLength: 5000 },
    createHarness: createSlackOutboundPayloadHarness,
  });
}

export function installDiscordOutboundPayloadContractSuite() {
  installChannelOutboundPayloadContractSuite({
    channel: "discord",
    chunking: { mode: "passthrough", longTextLength: 3000 },
    createHarness: createDiscordHarness,
  });
}

export function installWhatsAppOutboundPayloadContractSuite() {
  installChannelOutboundPayloadContractSuite({
    channel: "whatsapp",
    chunking: { mode: "split", longTextLength: 5000, maxChunkLength: 4000 },
    createHarness: createWhatsAppHarness,
  });
}

export function installZaloOutboundPayloadContractSuite() {
  installChannelOutboundPayloadContractSuite({
    channel: "zalo",
    chunking: { mode: "split", longTextLength: 3000, maxChunkLength: 2000 },
    createHarness: createZaloHarness,
  });
}

export function installZalouserOutboundPayloadContractSuite() {
  installChannelOutboundPayloadContractSuite({
    channel: "zalouser",
    chunking: { mode: "passthrough", longTextLength: 3000 },
    createHarness: createZalouserHarness,
  });
}

export function installDirectTextMediaOutboundPayloadContractSuite() {
  installChannelOutboundPayloadContractSuite({
    channel: "imessage",
    chunking: { mode: "split", longTextLength: 5000, maxChunkLength: 4000 },
    createHarness: createDirectTextMediaHarness,
  });
}
