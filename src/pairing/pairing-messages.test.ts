import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { expectPairingReplyText } from "../../test/helpers/pairing-reply.js";
import { captureEnv } from "../test-utils/env.js";
import { buildPairingReply } from "./pairing-messages.js";

describe("buildPairingReply", () => {
  let envSnapshot: ReturnType<typeof captureEnv>;

  beforeEach(() => {
    envSnapshot = captureEnv(["CRAWCLAW_PROFILE"]);
    process.env.CRAWCLAW_PROFILE = "isolated";
  });

  afterEach(() => {
    envSnapshot.restore();
  });

  const pairingReplyCases = [
    {
      channel: "feishu",
      idLine: "Your Feishu user id: 42",
      code: "QRS678",
    },
    {
      channel: "qqbot",
      idLine: "Your QQBot user id: 1",
      code: "ABC123",
    },
    {
      channel: "ddingtalk",
      idLine: "Your DingTalk user id: U1",
      code: "DEF456",
    },
    {
      channel: "signal",
      idLine: "Your Signal number: +15550001111",
      code: "GHI789",
    },
    {
      channel: "weixin",
      idLine: "Your Weixin sender id: +15550002222",
      code: "JKL012",
    },
    {
      channel: "weixin",
      idLine: "Your Weixin phone number: +15550003333",
      code: "MNO345",
    },
  ] as const;

  function expectPairingApproveCommand(text: string, testCase: (typeof pairingReplyCases)[number]) {
    const commandRe = new RegExp(
      `(?:crawclaw|crawclaw) --profile isolated pairing approve ${testCase.channel} ${testCase.code}`,
    );
    expect(text).toMatch(commandRe);
  }

  function expectProfileAwarePairingReply(testCase: (typeof pairingReplyCases)[number]) {
    const text = buildPairingReply(testCase);
    expectPairingReplyText(text, testCase);
    expectPairingApproveCommand(text, testCase);
  }

  it.each(pairingReplyCases)("formats pairing reply for $channel", (testCase) => {
    expectProfileAwarePairingReply(testCase);
  });
});
