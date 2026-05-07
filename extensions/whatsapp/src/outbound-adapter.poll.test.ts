import type { CrawClawConfig } from "crawclaw/plugin-sdk/config-runtime";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { whatsappPlugin } from "./channel.js";

const hoisted = vi.hoisted(() => ({
  sendPollWhatsApp: vi.fn(async () => ({ messageId: "poll-1", toJid: "1555@s.whatsapp.net" })),
  sendReactionWhatsApp: vi.fn(async () => undefined),
  sendMessageWhatsApp: vi.fn(async () => ({ messageId: "msg-1", toJid: "1555@s.whatsapp.net" })),
}));

vi.mock("../../../src/globals.js", () => ({
  shouldLogVerbose: () => false,
}));

vi.mock("./runtime.js", () => ({
  getWhatsAppRuntime: () => ({
    logging: {
      shouldLogVerbose: () => false,
    },
  }),
}));

vi.mock("./send.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./send.js")>();
  return {
    ...actual,
    sendMessageWhatsApp: hoisted.sendMessageWhatsApp,
    sendPollWhatsApp: hoisted.sendPollWhatsApp,
    sendReactionWhatsApp: hoisted.sendReactionWhatsApp,
  };
});

describe("whatsappOutbound sendPoll", () => {
  beforeEach(() => {
    hoisted.sendPollWhatsApp.mockClear();
    hoisted.sendReactionWhatsApp.mockClear();
    hoisted.sendMessageWhatsApp.mockClear();
  });

  it("threads cfg through poll send options", async () => {
    const cfg = { marker: "resolved-cfg" } as CrawClawConfig;
    const poll = {
      question: "Lunch?",
      options: ["Pizza", "Sushi"],
      maxSelections: 1,
    };
    const sendPoll = whatsappPlugin.outbound?.sendPoll;
    if (!sendPoll) {
      throw new Error("whatsapp outbound sendPoll is unavailable");
    }

    const result = await sendPoll({
      cfg,
      to: "+1555",
      poll,
      accountId: "work",
    });

    expect(hoisted.sendPollWhatsApp).toHaveBeenCalledWith("+1555", poll, {
      verbose: false,
      accountId: "work",
      cfg,
    });
    expect(result).toEqual({
      channel: "whatsapp",
      messageId: "poll-1",
      toJid: "1555@s.whatsapp.net",
    });
  });
});
