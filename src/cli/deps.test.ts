import { describe, expect, it, vi } from "vitest";

describe("createDefaultDeps", () => {
  it("does not expose legacy direct channel sender modules", async () => {
    const { createDefaultDeps } = await import("./deps.js");

    expect(createDefaultDeps()).toEqual({});
  });
});

describe("createOutboundSendDeps", () => {
  it("passes channel-id keyed dependencies through", async () => {
    const { createOutboundSendDeps } = await import("./deps.js");
    const sendFeishu = vi.fn();

    expect(createOutboundSendDeps({ feishu: sendFeishu })).toEqual({ feishu: sendFeishu });
  });
});
