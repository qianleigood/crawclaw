import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GatewayRequestHandlerOptions } from "./types.js";

const mocks = vi.hoisted(() => ({
  loadConfig: vi.fn(),
  readConfigFileSnapshot: vi.fn(),
  applyPluginAutoEnable: vi.fn(),
  listChannelPlugins: vi.fn(),
  listChannelPluginCatalogEntries: vi.fn(),
  getChannelPlugin: vi.fn(),
  buildChannelUiCatalog: vi.fn(),
  buildChannelAccountSnapshot: vi.fn(),
  getChannelActivity: vi.fn(),
  listRecentDiagnosticChannelStreamingDecisions: vi.fn(),
  resolveChannelSetupWizardAdapterForPlugin: vi.fn(),
  formatCliCommand: vi.fn((value: string) => value),
}));

vi.mock("../../config/config.js", async () => {
  const actual =
    await vi.importActual<typeof import("../../config/config.js")>("../../config/config.js");
  return {
    ...actual,
    loadConfig: mocks.loadConfig,
    readConfigFileSnapshot: mocks.readConfigFileSnapshot,
  };
});

vi.mock("../../config/plugin-auto-enable.js", () => ({
  applyPluginAutoEnable: mocks.applyPluginAutoEnable,
}));

vi.mock("../../channels/plugins/index.js", () => ({
  listChannelPlugins: mocks.listChannelPlugins,
  getChannelPlugin: mocks.getChannelPlugin,
  normalizeChannelId: (value: string) => value,
}));

vi.mock("../../channels/plugins/catalog.js", () => ({
  buildChannelUiCatalog: mocks.buildChannelUiCatalog,
  listChannelPluginCatalogEntries: mocks.listChannelPluginCatalogEntries,
}));

vi.mock("../../channels/plugins/status.js", () => ({
  buildChannelAccountSnapshot: mocks.buildChannelAccountSnapshot,
}));

vi.mock("../../infra/channel-activity.js", () => ({
  getChannelActivity: mocks.getChannelActivity,
}));

vi.mock("../../logging/diagnostic-session-state.js", () => ({
  listRecentDiagnosticChannelStreamingDecisions:
    mocks.listRecentDiagnosticChannelStreamingDecisions,
}));

vi.mock("../../commands/channel-setup/registry.js", () => ({
  resolveChannelSetupWizardAdapterForPlugin: mocks.resolveChannelSetupWizardAdapterForPlugin,
}));

vi.mock("../../cli/command-format.js", () => ({
  formatCliCommand: mocks.formatCliCommand,
}));

import { channelsHandlers } from "./channels.js";

function createOptions(
  params: Record<string, unknown>,
  overrides?: Partial<GatewayRequestHandlerOptions>,
): GatewayRequestHandlerOptions {
  return {
    req: { type: "req", id: "req-1", method: "channels.status", params },
    params,
    client: null,
    isWebchatConnect: () => false,
    respond: vi.fn(),
    context: {
      getRuntimeSnapshot: () => ({
        channels: {},
        channelAccounts: {},
      }),
    },
    ...overrides,
  } as unknown as GatewayRequestHandlerOptions;
}

describe("channelsHandlers channels.status", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.loadConfig.mockReturnValue({});
    mocks.applyPluginAutoEnable.mockImplementation(({ config }) => ({ config, changes: [] }));
    mocks.readConfigFileSnapshot.mockResolvedValue({
      valid: true,
      runtimeConfig: {},
    });
    mocks.buildChannelUiCatalog
      .mockReturnValueOnce({
        order: ["whatsapp"],
        labels: { whatsapp: "WhatsApp" },
        detailLabels: { whatsapp: "WhatsApp" },
        systemImages: { whatsapp: undefined },
        entries: [{ id: "whatsapp", label: "WhatsApp", detailLabel: "WhatsApp" }],
      })
      .mockReturnValue({
        order: ["whatsapp", "telegram"],
        labels: { whatsapp: "WhatsApp", telegram: "Telegram" },
        detailLabels: { whatsapp: "WhatsApp", telegram: "Telegram" },
        systemImages: { whatsapp: undefined, telegram: undefined },
        entries: [
          { id: "whatsapp", label: "WhatsApp", detailLabel: "WhatsApp" },
          { id: "telegram", label: "Telegram", detailLabel: "Telegram" },
        ],
      });
    mocks.listChannelPluginCatalogEntries.mockReturnValue([
      {
        id: "whatsapp",
        meta: {
          id: "whatsapp",
          label: "WhatsApp",
          selectionLabel: "WhatsApp",
          docsPath: "/channels/whatsapp",
        },
        install: { npmSpec: "@crawclaw/whatsapp" },
      },
      {
        id: "telegram",
        meta: {
          id: "telegram",
          label: "Telegram",
          selectionLabel: "Telegram",
          docsPath: "/channels/telegram",
        },
        install: { npmSpec: "@crawclaw/telegram" },
      },
    ]);
    mocks.buildChannelAccountSnapshot.mockResolvedValue({
      accountId: "default",
      configured: true,
    });
    mocks.getChannelActivity.mockReturnValue({
      inboundAt: null,
      outboundAt: null,
    });
    mocks.listRecentDiagnosticChannelStreamingDecisions.mockReturnValue([]);
    mocks.resolveChannelSetupWizardAdapterForPlugin.mockReturnValue(undefined);
    mocks.listChannelPlugins.mockReturnValue([
      {
        id: "whatsapp",
        config: {
          listAccountIds: () => ["default"],
          resolveAccount: () => ({}),
          isEnabled: () => true,
          isConfigured: async (_account: unknown, cfg: { autoEnabled?: boolean }) =>
            Boolean(cfg.autoEnabled),
        },
      },
    ]);
  });

  it("uses the auto-enabled config snapshot for channel account state", async () => {
    const autoEnabledConfig = { autoEnabled: true };
    mocks.applyPluginAutoEnable.mockReturnValue({ config: autoEnabledConfig, changes: [] });
    const respond = vi.fn();
    const opts = createOptions(
      { probe: false, timeoutMs: 2000 },
      {
        respond,
      },
    );

    await channelsHandlers["channels.status"](opts);

    expect(mocks.applyPluginAutoEnable).toHaveBeenCalledWith({
      config: {},
      env: process.env,
    });
    expect(mocks.buildChannelAccountSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        cfg: autoEnabledConfig,
        accountId: "default",
      }),
    );
    expect(respond).toHaveBeenCalledWith(
      true,
      expect.objectContaining({
        catalogOrder: ["whatsapp", "telegram"],
        catalogLabels: { whatsapp: "WhatsApp", telegram: "Telegram" },
        channels: {
          whatsapp: expect.objectContaining({
            configured: true,
          }),
        },
        channelControls: {
          whatsapp: expect.objectContaining({
            loginMode: "none",
            canReconnect: true,
            canVerify: false,
            canLogout: false,
            canEdit: false,
            canSetup: false,
            multiAccount: false,
            actions: ["reconnect"],
          }),
        },
      }),
      undefined,
    );
  });

  it("attaches latest channel streaming decision to account snapshots", async () => {
    mocks.listRecentDiagnosticChannelStreamingDecisions.mockReturnValue([
      {
        ts: 123,
        channel: "whatsapp",
        accountId: "default",
        surface: "editable_draft_stream",
        enabled: true,
        reason: "enabled",
        chatId: "chat-1",
      },
    ]);
    const respond = vi.fn();
    const opts = createOptions({ probe: false }, { respond });

    await channelsHandlers["channels.status"](opts);

    expect(respond).toHaveBeenCalledWith(
      true,
      expect.objectContaining({
        channelAccounts: {
          whatsapp: [
            expect.objectContaining({
              streaming: {
                ts: 123,
                surface: "editable_draft_stream",
                enabled: true,
                reason: "enabled",
                chatId: "chat-1",
              },
            }),
          ],
        },
      }),
      undefined,
    );
  });

  it("surfaces exposed channel actions and login mode in channel controls", async () => {
    mocks.listChannelPlugins.mockReturnValue([
      {
        id: "whatsapp",
        configSchema: { schema: { type: "object" } },
        setupWizard: {},
        config: {
          listAccountIds: () => ["default", "work"],
          resolveAccount: () => ({}),
          isEnabled: () => true,
        },
        status: {
          probeAccount: vi.fn(async () => ({ ok: true })),
        },
        gateway: {
          loginWithQrStart: vi.fn(),
          loginWithQrWait: vi.fn(),
          logoutAccount: vi.fn(async () => ({ cleared: true })),
        },
      },
    ]);
    const respond = vi.fn();
    const opts = createOptions({ probe: false }, { respond });

    await channelsHandlers["channels.status"](opts);

    expect(respond).toHaveBeenCalledWith(
      true,
      expect.objectContaining({
        channelControls: {
          whatsapp: {
            loginMode: "qr",
            actions: ["login", "reconnect", "verify", "logout", "edit", "setup"],
            canReconnect: true,
            canVerify: true,
            canLogout: true,
            canEdit: true,
            canSetup: true,
            multiAccount: true,
          },
        },
      }),
      undefined,
    );
  });

  it("starts QR login for a selected channel account", async () => {
    const loginWithQrStart = vi.fn(async () => ({
      message: "scan now",
      qrDataUrl: "data:image/png;base64,abc",
    }));
    const plugin = {
      id: "zalouser",
      config: {
        listAccountIds: () => ["default"],
        resolveAccount: () => ({}),
      },
      gateway: {
        loginWithQrStart,
      },
    };
    mocks.getChannelPlugin.mockReturnValue(plugin);
    const stopChannel = vi.fn(async () => undefined);
    const respond = vi.fn();
    const opts = {
      ...createOptions(
        { channel: "zalouser", accountId: "default", force: true, timeoutMs: 5000 },
        { respond },
      ),
      req: {
        type: "req",
        id: "req-login",
        method: "channels.account.login.start",
        params: { channel: "zalouser", accountId: "default", force: true, timeoutMs: 5000 },
      },
      context: {
        ...createOptions({}).context,
        stopChannel,
      },
    } as unknown as GatewayRequestHandlerOptions;

    await channelsHandlers["channels.account.login.start"](opts);

    expect(stopChannel).toHaveBeenCalledWith("zalouser", "default");
    expect(loginWithQrStart).toHaveBeenCalledWith({
      accountId: "default",
      force: true,
      timeoutMs: 5000,
      verbose: false,
    });
    expect(respond).toHaveBeenCalledWith(
      true,
      {
        channel: "zalouser",
        accountId: "default",
        message: "scan now",
        qrDataUrl: "data:image/png;base64,abc",
      },
      undefined,
    );
  });

  it("builds a setup surface from the channel setup adapter", async () => {
    const plugin = {
      id: "telegram",
      meta: {
        label: "Telegram",
        detailLabel: "Telegram bot",
        docsPath: "/channels/telegram",
      },
      setupWizard: {},
      configSchema: { schema: { type: "object" } },
      config: {
        listAccountIds: () => ["default", "ops"],
        defaultAccountId: () => "default",
        resolveAccount: () => ({}),
      },
      gateway: {
        loginWithQrStart: vi.fn(),
        loginWithQrWait: vi.fn(),
      },
    };
    mocks.getChannelPlugin.mockReturnValue(plugin);
    mocks.resolveChannelSetupWizardAdapterForPlugin.mockReturnValue({
      getStatus: vi.fn(async () => ({
        channel: "telegram",
        configured: false,
        statusLines: ["Telegram: needs token"],
        selectionHint: "needs token",
        quickstartScore: 2,
      })),
    });
    const respond = vi.fn();
    const opts = {
      ...createOptions({ channel: "telegram" }, { respond }),
      req: {
        type: "req",
        id: "req-setup",
        method: "channels.setup.surface",
        params: { channel: "telegram" },
      },
    } as unknown as GatewayRequestHandlerOptions;

    await channelsHandlers["channels.setup.surface"](opts);

    expect(respond).toHaveBeenCalledWith(
      true,
      expect.objectContaining({
        channel: "telegram",
        label: "Telegram",
        detailLabel: "Telegram bot",
        docsPath: "/channels/telegram",
        configured: false,
        mode: "wizard",
        selectionHint: "needs token",
        statusLines: ["Telegram: needs token"],
        defaultAccountId: "default",
        accountIds: ["default", "ops"],
        canSetup: true,
        canEdit: true,
        multiAccount: true,
        loginMode: "qr",
      }),
      undefined,
    );
  });

  it("restarts a selected channel account and returns a fresh snapshot", async () => {
    const plugin = {
      id: "telegram",
      config: {
        listAccountIds: () => ["default"],
        resolveAccount: () => ({}),
        isConfigured: vi.fn(async () => true),
      },
    };
    mocks.getChannelPlugin.mockReturnValue(plugin);
    mocks.buildChannelAccountSnapshot.mockResolvedValue({
      accountId: "default",
      configured: true,
      running: true,
    });
    const stopChannel = vi.fn(async () => undefined);
    const startChannel = vi.fn(async () => undefined);
    const respond = vi.fn();

    await channelsHandlers["channels.account.reconnect"]({
      ...createOptions(
        {
          channel: "telegram",
          accountId: "default",
          timeoutMs: 4000,
        },
        {
          req: {
            type: "req",
            id: "req-2",
            method: "channels.account.reconnect",
            params: {
              channel: "telegram",
              accountId: "default",
              timeoutMs: 4000,
            },
          },
          respond,
          context: {
            getRuntimeSnapshot: () => ({
              channels: {},
              channelAccounts: {},
            }),
            stopChannel,
            startChannel,
          } as unknown as GatewayRequestHandlerOptions["context"],
        },
      ),
    } as GatewayRequestHandlerOptions);

    expect(stopChannel).toHaveBeenCalledWith("telegram", "default");
    expect(startChannel).toHaveBeenCalledWith("telegram", "default");
    expect(respond).toHaveBeenCalledWith(
      true,
      expect.objectContaining({
        channel: "telegram",
        accountId: "default",
        snapshot: expect.objectContaining({
          accountId: "default",
          running: true,
        }),
      }),
      undefined,
    );
  });

  it("verifies a selected channel account and returns probe details", async () => {
    const probeAccount = vi.fn(async () => ({ ok: true }));
    const auditAccount = vi.fn(async () => ({ attention: [] }));
    const plugin = {
      id: "whatsapp",
      config: {
        listAccountIds: () => ["default"],
        resolveAccount: () => ({}),
        isConfigured: vi.fn(async () => true),
      },
      status: {
        probeAccount,
        auditAccount,
      },
    };
    mocks.getChannelPlugin.mockReturnValue(plugin);
    mocks.buildChannelAccountSnapshot.mockResolvedValue({
      accountId: "default",
      configured: true,
      connected: true,
    });
    const respond = vi.fn();
    const opts = {
      ...createOptions({ channel: "whatsapp", accountId: "default", timeoutMs: 4000 }, { respond }),
      req: {
        type: "req",
        id: "req-verify",
        method: "channels.account.verify",
        params: { channel: "whatsapp", accountId: "default", timeoutMs: 4000 },
      },
    } as unknown as GatewayRequestHandlerOptions;

    await channelsHandlers["channels.account.verify"](opts);

    expect(probeAccount).toHaveBeenCalled();
    expect(auditAccount).toHaveBeenCalled();
    expect(respond).toHaveBeenCalledWith(
      true,
      expect.objectContaining({
        channel: "whatsapp",
        accountId: "default",
        snapshot: expect.objectContaining({
          accountId: "default",
          connected: true,
        }),
        probe: { ok: true },
        audit: { attention: [] },
      }),
      undefined,
    );
  });
});
