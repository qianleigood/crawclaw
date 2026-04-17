import { describe, expect, it } from "vitest";
import {
  resolveAcpDeliveryChannel,
  shouldTreatAcpDeliveredTextAsVisible,
} from "./acp-delivery-visibility.js";

describe("resolveAcpDeliveryChannel", () => {
  it("normalizes channel ids", () => {
    expect(resolveAcpDeliveryChannel(" Telegram ")).toBe("telegram");
    expect(resolveAcpDeliveryChannel("")).toBeUndefined();
  });
});

describe("shouldTreatAcpDeliveredTextAsVisible", () => {
  it("always treats final text as visible", () => {
    expect(
      shouldTreatAcpDeliveredTextAsVisible({
        channel: "discord",
        kind: "final",
        text: "done",
      }),
    ).toBe(true);
  });

  it("treats telegram block text as visible but not other channels", () => {
    expect(
      shouldTreatAcpDeliveredTextAsVisible({
        channel: "telegram",
        kind: "block",
        text: "hello",
      }),
    ).toBe(true);
    expect(
      shouldTreatAcpDeliveredTextAsVisible({
        channel: "discord",
        kind: "block",
        text: "hello",
      }),
    ).toBe(false);
  });

  it("ignores blank text", () => {
    expect(
      shouldTreatAcpDeliveredTextAsVisible({
        channel: "telegram",
        kind: "block",
        text: "   ",
      }),
    ).toBe(false);
  });
});
