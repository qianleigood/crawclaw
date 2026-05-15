import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChannelPlugin } from "../../channels/plugins/types.js";
import type { GatewayRequestHandlerOptions, RespondFn } from "../request-types.js";

const channelRegistryMocks = vi.hoisted(() => ({
  getChannelPlugin: vi.fn(),
  listChannelPlugins: vi.fn(),
}));

vi.mock("../../channels/plugins/index.js", () => ({
  getChannelPlugin: channelRegistryMocks.getChannelPlugin,
  listChannelPlugins: channelRegistryMocks.listChannelPlugins,
}));

function createWebLoginContext() {
  return {
    stopChannel: vi.fn(async () => {}),
    startChannel: vi.fn(async () => {}),
  };
}

function createRespondCapture() {
  const calls: Parameters<RespondFn>[] = [];
  const respond: RespondFn = (...args) => {
    calls.push(args);
  };
  return { calls, respond };
}

function createHandlerOptions(
  params: Record<string, unknown>,
  context: ReturnType<typeof createWebLoginContext>,
  respond: RespondFn,
): GatewayRequestHandlerOptions {
  return {
    req: { type: "req", id: "req-1", method: "web.login.start", params },
    params,
    client: null,
    isWebchatConnect: () => false,
    respond,
    context: context as unknown as GatewayRequestHandlerOptions["context"],
  };
}

describe("web login gateway handlers", () => {
  beforeEach(() => {
    channelRegistryMocks.getChannelPlugin.mockReset();
    channelRegistryMocks.listChannelPlugins.mockReset();
  });

  it("uses the explicit Weixin QR provider instead of channel gateway method metadata", async () => {
    const loginWithQrStart = vi.fn(async () => ({
      channel: "weixin",
      accountId: "default",
      message: "scan",
    }));
    const weixinPlugin = {
      id: "weixin",
      gateway: { loginWithQrStart },
    } satisfies Partial<ChannelPlugin>;
    channelRegistryMocks.getChannelPlugin.mockImplementation((channel: string) =>
      channel === "weixin" ? weixinPlugin : undefined,
    );
    channelRegistryMocks.listChannelPlugins.mockReturnValue([weixinPlugin]);
    const context = createWebLoginContext();
    const { calls, respond } = createRespondCapture();
    const { webHandlers } = await import("./web.js");

    await webHandlers["web.login.start"](
      createHandlerOptions({ accountId: "default", force: true }, context, respond),
    );

    expect(channelRegistryMocks.getChannelPlugin).toHaveBeenCalledWith("weixin");
    expect(loginWithQrStart).toHaveBeenCalledWith({
      accountId: "default",
      force: true,
      timeoutMs: undefined,
      verbose: false,
    });
    expect(context.stopChannel).toHaveBeenCalledWith("weixin", "default");
    expect(calls).toEqual([
      [true, { channel: "weixin", accountId: "default", message: "scan" }, undefined],
    ]);
  });
});
