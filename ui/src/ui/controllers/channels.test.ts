import { describe, expect, it, vi } from "vitest";
import {
  loadChannels,
  reconnectChannelAccount,
  startWhatsAppLogin,
  verifyChannelAccount,
  waitWhatsAppLogin,
} from "./channels.ts";
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

describe("channel account actions", () => {
  it("prefers channels.account.login.start when available", async () => {
    const { state, request, hasMethod } = createState();
    hasMethod.mockImplementation((method: string) => method !== "web.login.start");
    request.mockResolvedValue({ message: "scan", qrDataUrl: "data:image/png;base64,abc" });

    await startWhatsAppLogin(state, true, "whatsapp", "default");

    expect(request).toHaveBeenCalledWith("channels.account.login.start", {
      channel: "whatsapp",
      force: true,
      timeoutMs: 30000,
      accountId: "default",
    });
  });

  it("falls back to web.login.wait when only legacy wait is present", async () => {
    const { state, request, hasMethod } = createState();
    hasMethod.mockImplementation((method: string) => method === "web.login.wait");
    request.mockResolvedValue({ message: "connected", connected: true });

    await waitWhatsAppLogin(state, "whatsapp", "work");

    expect(request).toHaveBeenCalledWith("web.login.wait", {
      timeoutMs: 120000,
      accountId: "work",
    });
  });

  it("verifies a selected account and patches the current snapshot", async () => {
    const { state, request } = createState();
    state.channelsSnapshot = {
      ts: 1,
      channelOrder: ["whatsapp"],
      channelLabels: { whatsapp: "WhatsApp" },
      channels: {},
      channelAccounts: {
        whatsapp: [
          {
            accountId: "default",
            configured: true,
            connected: false,
          },
        ],
      },
      channelDefaultAccountId: { whatsapp: "default" },
    };
    request.mockResolvedValue({
      channel: "whatsapp",
      accountId: "default",
      snapshot: {
        accountId: "default",
        configured: true,
        connected: true,
        lastProbeAt: 123,
      },
    });

    await verifyChannelAccount(state, "whatsapp", "default");

    expect(request).toHaveBeenCalledWith("channels.account.verify", {
      channel: "whatsapp",
      accountId: "default",
      timeoutMs: 8000,
    });
    expect(state.channelsSnapshot?.channelAccounts.whatsapp[0]).toMatchObject({
      accountId: "default",
      connected: true,
      lastProbeAt: 123,
    });
  });

  it("reconnects a selected account and refreshes channel status", async () => {
    const { state, request } = createState();
    state.channelsSnapshot = {
      ts: 1,
      channelOrder: ["telegram"],
      channelLabels: { telegram: "Telegram" },
      channels: {},
      channelAccounts: {
        telegram: [
          {
            accountId: "default",
            configured: true,
            connected: false,
          },
        ],
      },
      channelDefaultAccountId: { telegram: "default" },
    };
    request.mockImplementation(async (method: string) => {
      if (method === "channels.account.reconnect") {
        return {
          channel: "telegram",
          accountId: "default",
          snapshot: {
            accountId: "default",
            configured: true,
            connected: true,
            running: true,
          },
        };
      }
      if (method === "channels.status") {
        return {
          ts: 2,
          channelOrder: ["telegram"],
          channelLabels: { telegram: "Telegram" },
          channels: {},
          channelAccounts: {
            telegram: [
              {
                accountId: "default",
                configured: true,
                connected: true,
                running: true,
              },
            ],
          },
          channelDefaultAccountId: { telegram: "default" },
        };
      }
      if (method === "feishu.cli.status") {
        return null;
      }
      throw new Error(`unexpected method: ${method}`);
    });

    await reconnectChannelAccount(state, "telegram", "default");

    expect(request).toHaveBeenNthCalledWith(1, "channels.account.reconnect", {
      channel: "telegram",
      accountId: "default",
      timeoutMs: 10000,
    });
    expect(request).toHaveBeenNthCalledWith(2, "channels.status", {
      probe: true,
      timeoutMs: 8000,
    });
    expect(state.channelsSnapshot?.channelAccounts.telegram[0]).toMatchObject({
      accountId: "default",
      connected: true,
      running: true,
    });
  });
});
