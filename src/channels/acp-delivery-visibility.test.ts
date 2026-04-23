import { beforeEach, describe, expect, it } from "vitest";
import { setActivePluginRegistry } from "../plugins/runtime.js";
import { createOutboundTestPlugin, createTestRegistry } from "../test-utils/channel-plugins.js";
import {
  resolveAcpDeliveryChannel,
  shouldTreatAcpDeliveredTextAsVisible,
} from "./acp-delivery-visibility.js";

beforeEach(() => {
  setActivePluginRegistry(createTestRegistry([]));
});

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

  it("uses channel outbound visibility hooks", () => {
    setActivePluginRegistry(
      createTestRegistry([
        {
          pluginId: "telegram",
          source: "test",
          plugin: createOutboundTestPlugin({
            id: "telegram",
            outbound: {
              deliveryMode: "direct",
              shouldTreatDeliveredTextAsVisible: ({ kind }) => kind !== "final",
            },
          }),
        },
      ]),
    );

    expect(
      shouldTreatAcpDeliveredTextAsVisible({
        channel: "telegram",
        kind: "block",
        text: "hello",
      }),
    ).toBe(true);
  });

  it("does not treat non-final text as visible without a channel hook", () => {
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
