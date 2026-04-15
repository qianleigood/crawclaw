import { describe, expect, it, vi } from "vitest";
import { GatewayRequestError } from "../gateway.ts";
import { loadChannels } from "./channels.ts";
import type { ChannelsState } from "./channels.types.ts";

function createState(): { state: ChannelsState; request: ReturnType<typeof vi.fn> } {
  const request = vi.fn();
  const state: ChannelsState = {
    client: {
      request,
    } as unknown as ChannelsState["client"],
    connected: true,
    channelsLoading: false,
    channelsSnapshot: null,
    channelsError: null,
    channelsLastSuccess: null,
    feishuCliStatus: null,
    feishuCliError: null,
    feishuCliLastSuccess: null,
    feishuCliSupported: null,
    whatsappLoginMessage: null,
    whatsappLoginQrDataUrl: null,
    whatsappLoginConnected: null,
    whatsappBusy: false,
  };
  return { state, request };
}

describe("loadChannels", () => {
  it("loads channel and Feishu CLI status in one refresh", async () => {
    const { state, request } = createState();
    request.mockImplementation(async (method: string) => {
      if (method === "channels.status") {
        return {
          ts: 1,
          channelOrder: [],
          channelLabels: {},
          channels: {},
          channelAccounts: {},
          channelDefaultAccountId: {},
        };
      }
      if (method === "feishu.cli.status") {
        return {
          identity: "user",
          enabled: true,
          command: "lark-cli",
          timeoutMs: 8000,
          installed: true,
          version: "1.0.7",
          authOk: true,
          status: "ready",
        };
      }
      throw new Error(`unexpected method: ${method}`);
    });

    await loadChannels(state, false);

    expect(request).toHaveBeenCalledWith("channels.status", {
      probe: false,
      timeoutMs: 8000,
    });
    expect(request).toHaveBeenCalledWith("feishu.cli.status", {
      verify: false,
      timeoutMs: 8000,
    });
    expect(state.channelsSnapshot?.ts).toBe(1);
    expect(state.feishuCliStatus?.status).toBe("ready");
    expect(state.feishuCliSupported).toBe(true);
    expect(state.channelsError).toBeNull();
    expect(state.feishuCliError).toBeNull();
  });

  it("treats missing feishu-cli plugin as optional", async () => {
    const { state, request } = createState();
    request.mockImplementation(async (method: string) => {
      if (method === "channels.status") {
        return {
          ts: 1,
          channelOrder: [],
          channelLabels: {},
          channels: {},
          channelAccounts: {},
          channelDefaultAccountId: {},
        };
      }
      if (method === "feishu.cli.status") {
        throw new GatewayRequestError({
          code: "INVALID_REQUEST",
          message: "unknown method: feishu.cli.status",
        });
      }
      throw new Error(`unexpected method: ${method}`);
    });

    await loadChannels(state, false);

    expect(state.channelsSnapshot?.ts).toBe(1);
    expect(state.feishuCliStatus).toBeNull();
    expect(state.feishuCliSupported).toBe(false);
    expect(state.feishuCliError).toBeNull();
  });
});
