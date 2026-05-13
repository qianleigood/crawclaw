import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GatewayRequestHandlerOptions } from "../request-types.js";

const mocks = vi.hoisted(() => ({
  loadConfig: vi.fn(),
  readConfigFileSnapshot: vi.fn(),
  applyPluginAutoEnable: vi.fn(),
  listChannelPlugins: vi.fn(),
  shouldAllowBundledTsChannelRuntime: vi.fn(() => true),
  listBundledPluginMetadata: vi.fn<() => Array<{ manifest: { channels?: string[] } }>>(() => []),
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

vi.mock("../../channels/plugins/bundled-runtime-policy.js", () => ({
  shouldAllowBundledTsChannelRuntime: mocks.shouldAllowBundledTsChannelRuntime,
}));

vi.mock("../../plugins/bundled-plugin-metadata.js", () => ({
  listBundledPluginMetadata: mocks.listBundledPluginMetadata,
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
    mocks.shouldAllowBundledTsChannelRuntime.mockReset();
    mocks.shouldAllowBundledTsChannelRuntime.mockReturnValue(true);
    mocks.listBundledPluginMetadata.mockReset();
    mocks.listBundledPluginMetadata.mockReturnValue([]);
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

  it("omits bundled TS channel plugins from status when native channel runtime is authoritative", async () => {
    mocks.shouldAllowBundledTsChannelRuntime.mockReturnValue(false);
    mocks.listBundledPluginMetadata.mockReturnValue([
      {
        manifest: {
          channels: ["telegram"],
        },
      },
    ]);
    mocks.buildChannelUiCatalog.mockReset();
    mocks.buildChannelUiCatalog.mockImplementation(
      (plugins: Array<{ id: string; meta?: unknown }>) => ({
        order: plugins.map((plugin) => plugin.id),
        labels: Object.fromEntries(plugins.map((plugin) => [plugin.id, plugin.id])),
        detailLabels: Object.fromEntries(plugins.map((plugin) => [plugin.id, plugin.id])),
        systemImages: {},
        entries: plugins.map((plugin) => ({
          id: plugin.id,
          label: plugin.id,
          detailLabel: plugin.id,
        })),
      }),
    );
    mocks.listChannelPlugins.mockReturnValue([
      {
        id: "telegram",
        meta: { id: "telegram", label: "Telegram" },
        config: {
          listAccountIds: () => ["default"],
          resolveAccount: () => ({}),
          isEnabled: () => true,
        },
      },
      {
        id: "externalchat",
        meta: { id: "externalchat", label: "External Chat" },
        config: {
          listAccountIds: () => ["default"],
          resolveAccount: () => ({}),
          isEnabled: () => true,
        },
      },
    ]);
    const respond = vi.fn();

    await channelsHandlers["channels.status"](createOptions({ probe: false }, { respond }));

    expect(mocks.buildChannelAccountSnapshot).toHaveBeenCalledTimes(1);
    expect(mocks.buildChannelAccountSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        plugin: expect.objectContaining({ id: "externalchat" }),
      }),
    );
    expect(respond).toHaveBeenCalledWith(
      true,
      expect.objectContaining({
        channelOrder: ["externalchat"],
        channels: {
          externalchat: expect.any(Object),
        },
        channelAccounts: {
          externalchat: [expect.objectContaining({ accountId: "default" })],
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

  it("starts native bundled channel accounts without resolving TS channel plugins", async () => {
    mocks.shouldAllowBundledTsChannelRuntime.mockReturnValue(false);
    mocks.listBundledPluginMetadata.mockReturnValue([
      {
        manifest: {
          channels: ["desktop"],
        },
      },
    ]);
    mocks.getChannelPlugin.mockReturnValue(undefined);
    const startChannel = vi.fn(async () => undefined);
    const respond = vi.fn();

    await channelsHandlers["channels.account.login.start"]({
      ...createOptions(
        {
          channel: "desktop",
          accountId: "local",
        },
        {
          req: {
            type: "req",
            id: "req-native-login",
            method: "channels.account.login.start",
            params: {
              channel: "desktop",
              accountId: "local",
            },
          },
          respond,
          context: {
            getRuntimeSnapshot: () => ({
              channels: {},
              channelAccounts: {
                desktop: {
                  local: {
                    accountId: "local",
                    configured: true,
                    connected: true,
                  },
                },
              },
            }),
            startChannel,
          } as unknown as GatewayRequestHandlerOptions["context"],
        },
      ),
    } as GatewayRequestHandlerOptions);

    expect(mocks.getChannelPlugin).not.toHaveBeenCalled();
    expect(startChannel).toHaveBeenCalledWith("desktop", "local");
    expect(respond).toHaveBeenCalledWith(
      true,
      expect.objectContaining({
        channel: "desktop",
        accountId: "local",
        connected: true,
        implementation: "rust-native",
      }),
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

  it("restarts native bundled channel accounts without resolving TS channel plugins", async () => {
    mocks.shouldAllowBundledTsChannelRuntime.mockReturnValue(false);
    mocks.listBundledPluginMetadata.mockReturnValue([
      {
        manifest: {
          channels: ["telegram"],
        },
      },
    ]);
    mocks.getChannelPlugin.mockReturnValue(undefined);
    const stopChannel = vi.fn(async () => undefined);
    const startChannel = vi.fn(async () => undefined);
    const respond = vi.fn();

    await channelsHandlers["channels.account.reconnect"]({
      ...createOptions(
        {
          channel: "telegram",
          accountId: "default",
        },
        {
          req: {
            type: "req",
            id: "req-native-reconnect",
            method: "channels.account.reconnect",
            params: {
              channel: "telegram",
              accountId: "default",
            },
          },
          respond,
          context: {
            getRuntimeSnapshot: () => ({
              channels: {},
              channelAccounts: {
                telegram: {
                  default: {
                    accountId: "default",
                    configured: true,
                    connected: false,
                  },
                },
              },
            }),
            stopChannel,
            startChannel,
          } as unknown as GatewayRequestHandlerOptions["context"],
        },
      ),
    } as GatewayRequestHandlerOptions);

    expect(mocks.getChannelPlugin).not.toHaveBeenCalled();
    expect(stopChannel).toHaveBeenCalledWith("telegram", "default");
    expect(startChannel).toHaveBeenCalledWith("telegram", "default");
    expect(respond).toHaveBeenCalledWith(
      true,
      expect.objectContaining({
        channel: "telegram",
        accountId: "default",
        snapshot: expect.objectContaining({
          accountId: "default",
          configured: true,
        }),
      }),
      undefined,
    );
  });

  it("builds native bundled channel setup surface without resolving TS channel plugins", async () => {
    mocks.shouldAllowBundledTsChannelRuntime.mockReturnValue(false);
    mocks.listBundledPluginMetadata.mockReturnValue([
      {
        manifest: {
          channels: ["telegram"],
        },
      },
    ]);
    mocks.getChannelPlugin.mockReturnValue(undefined);
    mocks.listChannelPluginCatalogEntries.mockReturnValue([
      {
        id: "telegram",
        meta: {
          id: "telegram",
          label: "Telegram",
          selectionLabel: "Telegram",
          detailLabel: "Telegram bot",
          docsPath: "/channels/telegram",
        },
        install: { npmSpec: "@crawclaw/telegram" },
      },
    ]);
    mocks.loadConfig.mockReturnValue({
      channels: {
        telegram: {
          token: "test-token",
        },
      },
    });
    const respond = vi.fn();

    await channelsHandlers["channels.setup.surface"]({
      ...createOptions(
        { channel: "telegram" },
        {
          req: {
            type: "req",
            id: "req-native-setup",
            method: "channels.setup.surface",
            params: { channel: "telegram" },
          },
          respond,
        },
      ),
    } as GatewayRequestHandlerOptions);

    expect(mocks.getChannelPlugin).not.toHaveBeenCalled();
    expect(respond).toHaveBeenCalledWith(
      true,
      expect.objectContaining({
        channel: "telegram",
        label: "Telegram",
        detailLabel: "Telegram bot",
        docsPath: "/channels/telegram",
        configured: true,
        mode: "config",
        implementation: "rust-native",
      }),
      undefined,
    );
  });

  it("verifies native bundled channel accounts without resolving TS channel plugins", async () => {
    mocks.shouldAllowBundledTsChannelRuntime.mockReturnValue(false);
    mocks.listBundledPluginMetadata.mockReturnValue([
      {
        manifest: {
          channels: ["telegram"],
        },
      },
    ]);
    mocks.getChannelPlugin.mockReturnValue(undefined);
    const respond = vi.fn();

    await channelsHandlers["channels.account.verify"]({
      ...createOptions(
        {
          channel: "telegram",
          accountId: "default",
        },
        {
          req: {
            type: "req",
            id: "req-native-verify",
            method: "channels.account.verify",
            params: {
              channel: "telegram",
              accountId: "default",
            },
          },
          respond,
          context: {
            getRuntimeSnapshot: () => ({
              channels: {},
              channelAccounts: {
                telegram: {
                  default: {
                    accountId: "default",
                    configured: true,
                    connected: true,
                  },
                },
              },
            }),
          } as unknown as GatewayRequestHandlerOptions["context"],
        },
      ),
    } as GatewayRequestHandlerOptions);

    expect(mocks.getChannelPlugin).not.toHaveBeenCalled();
    expect(respond).toHaveBeenCalledWith(
      true,
      expect.objectContaining({
        channel: "telegram",
        accountId: "default",
        implementation: "rust-native",
        snapshot: expect.objectContaining({
          accountId: "default",
          connected: true,
        }),
      }),
      undefined,
    );
  });

  it("logs out native bundled channel accounts without resolving TS channel plugins", async () => {
    mocks.shouldAllowBundledTsChannelRuntime.mockReturnValue(false);
    mocks.listBundledPluginMetadata.mockReturnValue([
      {
        manifest: {
          channels: ["telegram"],
        },
      },
    ]);
    mocks.getChannelPlugin.mockReturnValue(undefined);
    const stopChannel = vi.fn(async () => undefined);
    const markChannelLoggedOut = vi.fn();
    const respond = vi.fn();

    await channelsHandlers["channels.account.logout"]({
      ...createOptions(
        {
          channel: "telegram",
          accountId: "default",
        },
        {
          req: {
            type: "req",
            id: "req-native-logout",
            method: "channels.account.logout",
            params: {
              channel: "telegram",
              accountId: "default",
            },
          },
          respond,
          context: {
            getRuntimeSnapshot: () => ({
              channels: {},
              channelAccounts: {},
            }),
            stopChannel,
            markChannelLoggedOut,
          } as unknown as GatewayRequestHandlerOptions["context"],
        },
      ),
    } as GatewayRequestHandlerOptions);

    expect(mocks.getChannelPlugin).not.toHaveBeenCalled();
    expect(stopChannel).toHaveBeenCalledWith("telegram", "default");
    expect(markChannelLoggedOut).toHaveBeenCalledWith("telegram", true, "default");
    expect(respond).toHaveBeenCalledWith(
      true,
      expect.objectContaining({
        channel: "telegram",
        accountId: "default",
        cleared: true,
        loggedOut: true,
        implementation: "rust-native",
      }),
      undefined,
    );
  });

  it("logs out native bundled channels without resolving TS channel plugins", async () => {
    mocks.shouldAllowBundledTsChannelRuntime.mockReturnValue(false);
    mocks.listBundledPluginMetadata.mockReturnValue([
      {
        manifest: {
          channels: ["telegram"],
        },
      },
    ]);
    mocks.getChannelPlugin.mockReturnValue(undefined);
    const stopChannel = vi.fn(async () => undefined);
    const markChannelLoggedOut = vi.fn();
    const respond = vi.fn();

    await channelsHandlers["channels.logout"]({
      ...createOptions(
        {
          channel: "telegram",
          accountId: "default",
        },
        {
          req: {
            type: "req",
            id: "req-native-channel-logout",
            method: "channels.logout",
            params: {
              channel: "telegram",
              accountId: "default",
            },
          },
          respond,
          context: {
            getRuntimeSnapshot: () => ({
              channels: {},
              channelAccounts: {},
            }),
            stopChannel,
            markChannelLoggedOut,
          } as unknown as GatewayRequestHandlerOptions["context"],
        },
      ),
    } as GatewayRequestHandlerOptions);

    expect(mocks.getChannelPlugin).not.toHaveBeenCalled();
    expect(stopChannel).toHaveBeenCalledWith("telegram", "default");
    expect(markChannelLoggedOut).toHaveBeenCalledWith("telegram", true, "default");
    expect(respond).toHaveBeenCalledWith(
      true,
      expect.objectContaining({
        channel: "telegram",
        accountId: "default",
        cleared: true,
        loggedOut: true,
        implementation: "rust-native",
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
