import { describe, expect, it, vi } from "vitest";
import { createOutboundSendDepsFromCliSource } from "./outbound-send-mapping.js";

describe("createOutboundSendDepsFromCliSource", () => {
  it("passes retained channel-keyed send deps through without legacy aliases", () => {
    const deps = {
      ddingtalk: vi.fn(),
      feishu: vi.fn(),
      qqbot: vi.fn(),
      weixin: vi.fn(),
      esp32: vi.fn(),
    };

    const outbound = createOutboundSendDepsFromCliSource(deps);

    expect(outbound).toEqual({
      ddingtalk: deps.ddingtalk,
      feishu: deps.feishu,
      qqbot: deps.qqbot,
      weixin: deps.weixin,
      esp32: deps.esp32,
    });
    expect(outbound).not.toHaveProperty("sendTelegram");
    expect(outbound).not.toHaveProperty("sendWhatsApp");
  });
});
