import { describe, expect, it, vi } from "vitest";
import { loadChannels, startWhatsAppLogin, waitWhatsAppLogin } from "./channels.ts";
import type { ChannelsState } from "./channels.types.ts";

function createState(): {
  state: ChannelsState;
  request: ReturnType<typeof vi.fn>;
  hasMethod: ReturnType<typeof vi.fn>;
} {
  const request = vi.fn();
  const hasMethod = vi.fn(() => true);
  const state: ChannelsState = {
    client: {
      hasMethod,
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
  return { state, request, hasMethod };
}

describe("loadChannels", () => {
  it("loads channel and Feishu CLI status in one refresh", async () => {
    const { state, request, hasMethod } = createState();
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

    expect(hasMethod).toHaveBeenCalledWith("feishu.cli.status");
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

  it("treats missing feishu-cli support as optional when the method is absent", async () => {
    const { state, request, hasMethod } = createState();
    hasMethod.mockImplementation((method: string) => method !== "feishu.cli.status");
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
      throw new Error(`unexpected method: ${method}`);
    });

    await loadChannels(state, false);

    expect(request).not.toHaveBeenCalledWith("feishu.cli.status", expect.anything());
    expect(state.channelsSnapshot?.ts).toBe(1);
    expect(state.feishuCliStatus).toBeNull();
    expect(state.feishuCliSupported).toBe(false);
    expect(state.feishuCliError).toBeNull();
  });
});

describe("whatsapp login method aliases", () => {
  it("prefers channels.login.start when available", async () => {
    const { state, request, hasMethod } = createState();
    hasMethod.mockImplementation((method: string) => method !== "web.login.start");
    request.mockResolvedValue({ message: "scan", qrDataUrl: "data:image/png;base64,abc" });

    await startWhatsAppLogin(state, true);

    expect(request).toHaveBeenCalledWith("channels.login.start", {
      force: true,
      timeoutMs: 30000,
    });
  });

  it("falls back to web.login.wait when only the legacy alias is present", async () => {
    const { state, request, hasMethod } = createState();
    hasMethod.mockImplementation((method: string) => method === "web.login.wait");
    request.mockResolvedValue({ message: "connected", connected: true });

    await waitWhatsAppLogin(state);

    expect(request).toHaveBeenCalledWith("web.login.wait", {
      timeoutMs: 120000,
    });
  });
});
