import fs from "node:fs";
import path from "node:path";
import {
  buildChannelUiCatalog,
  listChannelPluginCatalogEntries,
  type ChannelPluginCatalogEntry,
} from "../../channels/plugins/catalog.js";
import { resolveChannelDefaultAccountId } from "../../channels/plugins/helpers.js";
import {
  type ChannelId,
  getChannelPlugin,
  listChannelPlugins,
  normalizeChannelId,
} from "../../channels/plugins/index.js";
import { buildChannelAccountSnapshot } from "../../channels/plugins/status.js";
import type { ChannelAccountSnapshot, ChannelPlugin } from "../../channels/plugins/types.js";
import { formatCliCommand } from "../../cli/command-format.js";
import { resolveChannelSetupWizardAdapterForPlugin } from "../../commands/channel-setup/registry.js";
import type { CrawClawConfig } from "../../config/config.js";
import { loadConfig, readConfigFileSnapshot } from "../../config/config.js";
import { applyPluginAutoEnable } from "../../config/plugin-auto-enable.js";
import { getChannelActivity } from "../../infra/channel-activity.js";
import { resolveCrawClawPackageRootSync } from "../../infra/crawclaw-root.js";
import { listRecentDiagnosticChannelStreamingDecisions } from "../../logging/diagnostic-session-state.js";
import { DEFAULT_ACCOUNT_ID } from "../../routing/session-key.js";
import { defaultRuntime } from "../../runtime.js";
import {
  ErrorCodes,
  errorShape,
  formatValidationErrors,
  validateChannelsAccountLoginStartParams,
  validateChannelsAccountLoginWaitParams,
  validateChannelsAccountReconnectParams,
  validateChannelsAccountLogoutParams,
  validateChannelsAccountVerifyParams,
  validateChannelsSetupSurfaceParams,
  validateChannelsLogoutParams,
  validateChannelsStatusParams,
} from "../protocol/index.js";
import { formatForLog } from "../ws-log.js";
import type { GatewayRequestContext, GatewayRequestHandlers } from "./types.js";

type ChannelLogoutPayload = {
  channel: ChannelId;
  accountId: string;
  cleared: boolean;
  [key: string]: unknown;
};

export async function logoutChannelAccount(params: {
  channelId: ChannelId;
  accountId?: string | null;
  cfg: CrawClawConfig;
  context: GatewayRequestContext;
  plugin: ChannelPlugin;
}): Promise<ChannelLogoutPayload> {
  const resolvedAccountId =
    params.accountId?.trim() ||
    params.plugin.config.defaultAccountId?.(params.cfg) ||
    params.plugin.config.listAccountIds(params.cfg)[0] ||
    DEFAULT_ACCOUNT_ID;
  const account = params.plugin.config.resolveAccount(params.cfg, resolvedAccountId);
  await params.context.stopChannel(params.channelId, resolvedAccountId);
  const result = await params.plugin.gateway?.logoutAccount?.({
    cfg: params.cfg,
    accountId: resolvedAccountId,
    account,
    runtime: defaultRuntime,
  });
  if (!result) {
    throw new Error(`Channel ${params.channelId} does not support logout`);
  }
  const cleared = result.cleared;
  const loggedOut = typeof result.loggedOut === "boolean" ? result.loggedOut : cleared;
  if (loggedOut) {
    params.context.markChannelLoggedOut(params.channelId, true, resolvedAccountId);
  }
  return {
    channel: params.channelId,
    accountId: resolvedAccountId,
    ...result,
    cleared,
  };
}

function resolveRequestedChannelId(params: unknown): ChannelId | null {
  const rawChannel = (params as { channel?: unknown }).channel;
  return typeof rawChannel === "string" ? normalizeChannelId(rawChannel) : null;
}

function resolveRequestedAccountId(params: unknown): string | undefined {
  const rawAccountId = (params as { accountId?: unknown }).accountId;
  return typeof rawAccountId === "string" && rawAccountId.trim() ? rawAccountId.trim() : undefined;
}

function loadChannelsConfig(): CrawClawConfig {
  return applyPluginAutoEnable({
    config: loadConfig(),
    env: process.env,
  }).config;
}

function loadFallbackChannelCatalogEntries(): ChannelPluginCatalogEntry[] {
  const packageRoot =
    resolveCrawClawPackageRootSync({ moduleUrl: import.meta.url }) ??
    resolveCrawClawPackageRootSync({ cwd: process.cwd() });
  if (!packageRoot) {
    return [];
  }
  const catalogPath = path.join(packageRoot, "dist", "channel-catalog.json");
  if (!fs.existsSync(catalogPath)) {
    return [];
  }
  try {
    const payload = JSON.parse(fs.readFileSync(catalogPath, "utf-8")) as {
      entries?: Array<{
        name?: string;
        crawclaw?: {
          channel?: {
            id?: string;
            label?: string;
            selectionLabel?: string;
            detailLabel?: string;
            docsPath?: string;
            systemImage?: string;
            order?: number;
          };
          install?: { npmSpec?: string; defaultChoice?: "npm" | "local"; localPath?: string };
        };
      }>;
    };
    const entries: ChannelPluginCatalogEntry[] = [];
    for (const entry of payload.entries ?? []) {
      const channel = entry.crawclaw?.channel;
      const install = entry.crawclaw?.install;
      const id = channel?.id?.trim();
      const label = channel?.label?.trim();
      const npmSpec = install?.npmSpec?.trim();
      if (!channel || !install || !id || !label || !npmSpec) {
        continue;
      }
      entries.push({
        id,
        meta: {
          id,
          label,
          selectionLabel: channel.selectionLabel?.trim() || label,
          detailLabel: channel.detailLabel?.trim() || channel.selectionLabel?.trim() || label,
          docsPath: channel.docsPath?.trim() || `/channels/${id}`,
          docsLabel: id,
          blurb: "",
          ...(channel.systemImage?.trim() ? { systemImage: channel.systemImage.trim() } : {}),
          ...(typeof channel.order === "number" ? { order: channel.order } : {}),
        },
        install: {
          npmSpec,
          ...(install.defaultChoice ? { defaultChoice: install.defaultChoice } : {}),
          ...(install.localPath?.trim() ? { localPath: install.localPath.trim() } : {}),
        },
      });
    }
    return entries;
  } catch {
    return [];
  }
}

function resolveSupportedChannelCatalog() {
  const entries = listChannelPluginCatalogEntries();
  return entries.length > 0 ? entries : loadFallbackChannelCatalogEntries();
}

function resolveChannelAccountTarget(params: unknown, cfg: CrawClawConfig) {
  const channelId = resolveRequestedChannelId(params);
  if (!channelId) {
    return {
      error: "invalid channel",
    } as const;
  }
  const plugin = getChannelPlugin(channelId);
  if (!plugin) {
    return {
      error: `channel ${channelId} is unavailable`,
    } as const;
  }
  const accountId =
    resolveRequestedAccountId(params) ||
    plugin.config.defaultAccountId?.(cfg) ||
    plugin.config.listAccountIds(cfg)[0] ||
    DEFAULT_ACCOUNT_ID;
  const account = plugin.config.resolveAccount(cfg, accountId);
  return {
    channelId,
    plugin,
    accountId,
    account,
  } as const;
}

function resolveRuntimeAccountSnapshot(params: {
  context: GatewayRequestContext;
  channelId: ChannelId;
  accountId: string;
  plugin: ChannelPlugin;
  cfg: CrawClawConfig;
}): ChannelAccountSnapshot | undefined {
  const runtime = params.context.getRuntimeSnapshot();
  const defaultAccountId =
    params.plugin.config.defaultAccountId?.(params.cfg) ||
    params.plugin.config.listAccountIds(params.cfg)[0] ||
    DEFAULT_ACCOUNT_ID;
  const accounts = runtime.channelAccounts[params.channelId];
  const defaultRuntime = runtime.channels[params.channelId];
  return (
    accounts?.[params.accountId] ??
    (params.accountId === defaultAccountId ? defaultRuntime : undefined)
  );
}

function asJsonRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function supportsChannelMultiAccount(plugin: ChannelPlugin, cfg: CrawClawConfig): boolean {
  const accountIds = plugin.config.listAccountIds(cfg);
  if (accountIds.length > 1) {
    return true;
  }
  const schema = asJsonRecord(plugin.configSchema?.schema);
  const properties = asJsonRecord(schema?.properties);
  return Boolean(properties?.accounts || properties?.defaultAccount);
}

async function buildChannelsSetupSurface(params: {
  channelId: ChannelId;
  plugin: ChannelPlugin;
  cfg: CrawClawConfig;
}) {
  const accountIds = params.plugin.config.listAccountIds(params.cfg);
  const defaultAccountId = resolveChannelDefaultAccountId({
    plugin: params.plugin,
    cfg: params.cfg,
    accountIds,
  });
  const adapter = resolveChannelSetupWizardAdapterForPlugin(params.plugin);
  const canEdit = params.plugin.configSchema != null;
  const canSetup = params.plugin.setupWizard != null || params.plugin.setup != null;
  const loginMode =
    params.plugin.gateway?.loginWithQrStart && params.plugin.gateway?.loginWithQrWait
      ? "qr"
      : "none";

  let configured = false;
  let statusLines: string[] = [];
  let selectionHint: string | undefined;
  let quickstartScore: number | undefined;
  if (adapter) {
    const status = await adapter.getStatus({
      cfg: params.cfg,
      accountOverrides: {},
    });
    configured = status.configured;
    statusLines = [...status.statusLines];
    selectionHint = status.selectionHint;
    quickstartScore = status.quickstartScore;
  } else {
    const account = params.plugin.config.resolveAccount(params.cfg, defaultAccountId);
    configured = params.plugin.config.isConfigured
      ? await params.plugin.config.isConfigured(account, params.cfg)
      : accountIds.length > 0;
    statusLines = [
      `${params.plugin.meta.label}: ${configured ? "configured" : canEdit ? "ready to configure" : "needs setup"}`,
    ];
    selectionHint = configured
      ? "configured"
      : canEdit
        ? "open channel settings"
        : canSetup
          ? "run setup"
          : "follow docs";
  }

  const commands = [
    formatCliCommand("crawclaw channels status --probe"),
    formatCliCommand(
      accountIds.length > 0 || params.plugin.config.defaultAccountId != null
        ? `crawclaw channels add --channel ${params.channelId} --account <id>`
        : `crawclaw channels add --channel ${params.channelId}`,
    ),
    ...(loginMode === "qr"
      ? [formatCliCommand(`crawclaw channels login --channel ${params.channelId}`)]
      : []),
  ];

  return {
    channel: params.channelId,
    label: params.plugin.meta.label,
    detailLabel: params.plugin.meta.detailLabel ?? params.plugin.meta.label,
    docsPath: params.plugin.meta.docsPath,
    configured,
    mode: adapter ? "wizard" : canEdit ? "config" : "none",
    selectionHint,
    quickstartScore,
    statusLines,
    accountIds,
    defaultAccountId,
    canSetup,
    canEdit,
    multiAccount: supportsChannelMultiAccount(params.plugin, params.cfg),
    loginMode,
    commands,
  } as const;
}

export const channelsHandlers: GatewayRequestHandlers = {
  "channels.status": async ({ params, respond, context }) => {
    if (!validateChannelsStatusParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid channels.status params: ${formatValidationErrors(validateChannelsStatusParams.errors)}`,
        ),
      );
      return;
    }
    const probe = (params as { probe?: boolean }).probe === true;
    const timeoutMsRaw = (params as { timeoutMs?: unknown }).timeoutMs;
    const timeoutMs = typeof timeoutMsRaw === "number" ? Math.max(1000, timeoutMsRaw) : 10_000;
    const cfg = applyPluginAutoEnable({
      config: loadConfig(),
      env: process.env,
    }).config;
    const runtime = context.getRuntimeSnapshot();
    const plugins = listChannelPlugins();
    const pluginMap = new Map<ChannelId, ChannelPlugin>(
      plugins.map((plugin) => [plugin.id, plugin]),
    );

    const resolveRuntimeSnapshot = (
      channelId: ChannelId,
      accountId: string,
      defaultAccountId: string,
    ): ChannelAccountSnapshot | undefined => {
      const accounts = runtime.channelAccounts[channelId];
      const defaultRuntime = runtime.channels[channelId];
      const raw =
        accounts?.[accountId] ?? (accountId === defaultAccountId ? defaultRuntime : undefined);
      if (!raw) {
        return undefined;
      }
      return raw;
    };

    const isAccountEnabled = (plugin: ChannelPlugin, account: unknown) =>
      plugin.config.isEnabled
        ? plugin.config.isEnabled(account, cfg)
        : !account ||
          typeof account !== "object" ||
          (account as { enabled?: boolean }).enabled !== false;

    const buildChannelAccounts = async (channelId: ChannelId) => {
      const plugin = pluginMap.get(channelId);
      if (!plugin) {
        return {
          accounts: [] as ChannelAccountSnapshot[],
          defaultAccountId: DEFAULT_ACCOUNT_ID,
          defaultAccount: undefined as ChannelAccountSnapshot | undefined,
          resolvedAccounts: {} as Record<string, unknown>,
        };
      }
      const accountIds = plugin.config.listAccountIds(cfg);
      const defaultAccountId = resolveChannelDefaultAccountId({
        plugin,
        cfg,
        accountIds,
      });
      const accounts: ChannelAccountSnapshot[] = [];
      const resolvedAccounts: Record<string, unknown> = {};
      for (const accountId of accountIds) {
        const account = plugin.config.resolveAccount(cfg, accountId);
        const enabled = isAccountEnabled(plugin, account);
        resolvedAccounts[accountId] = account;
        let probeResult: unknown;
        let lastProbeAt: number | null = null;
        if (probe && enabled && plugin.status?.probeAccount) {
          let configured = true;
          if (plugin.config.isConfigured) {
            configured = await plugin.config.isConfigured(account, cfg);
          }
          if (configured) {
            probeResult = await plugin.status.probeAccount({
              account,
              timeoutMs,
              cfg,
            });
            lastProbeAt = Date.now();
          }
        }
        let auditResult: unknown;
        if (probe && enabled && plugin.status?.auditAccount) {
          let configured = true;
          if (plugin.config.isConfigured) {
            configured = await plugin.config.isConfigured(account, cfg);
          }
          if (configured) {
            auditResult = await plugin.status.auditAccount({
              account,
              timeoutMs,
              cfg,
              probe: probeResult,
            });
          }
        }
        const runtimeSnapshot = resolveRuntimeSnapshot(channelId, accountId, defaultAccountId);
        const snapshot = await buildChannelAccountSnapshot({
          plugin,
          cfg,
          accountId,
          runtime: runtimeSnapshot,
          probe: probeResult,
          audit: auditResult,
        });
        if (lastProbeAt) {
          snapshot.lastProbeAt = lastProbeAt;
        }
        const activity = getChannelActivity({
          channel: channelId as never,
          accountId,
        });
        if (snapshot.lastInboundAt == null) {
          snapshot.lastInboundAt = activity.inboundAt;
        }
        if (snapshot.lastOutboundAt == null) {
          snapshot.lastOutboundAt = activity.outboundAt;
        }
        const latestStreamingDecision = listRecentDiagnosticChannelStreamingDecisions({
          channel: channelId,
          accountId,
          limit: 1,
        })[0];
        if (latestStreamingDecision) {
          snapshot.streaming = {
            ts: latestStreamingDecision.ts,
            surface: latestStreamingDecision.surface,
            enabled: latestStreamingDecision.enabled,
            reason: latestStreamingDecision.reason,
            ...(latestStreamingDecision.chatId !== undefined
              ? { chatId: latestStreamingDecision.chatId }
              : {}),
          };
        }
        accounts.push(snapshot);
      }
      const defaultAccount =
        accounts.find((entry) => entry.accountId === defaultAccountId) ?? accounts[0];
      return { accounts, defaultAccountId, defaultAccount, resolvedAccounts };
    };

    const uiCatalog = buildChannelUiCatalog(plugins);
    const supportedCatalog = buildChannelUiCatalog(
      resolveSupportedChannelCatalog().map((entry) => ({
        id: entry.id,
        meta: entry.meta,
        installNpmSpec: entry.install.npmSpec,
      })),
    );
    const payload: Record<string, unknown> = {
      ts: Date.now(),
      channelOrder: uiCatalog.order,
      channelLabels: uiCatalog.labels,
      channelDetailLabels: uiCatalog.detailLabels,
      channelSystemImages: uiCatalog.systemImages,
      channelMeta: uiCatalog.entries,
      catalogOrder: supportedCatalog.order,
      catalogLabels: supportedCatalog.labels,
      catalogDetailLabels: supportedCatalog.detailLabels,
      catalogSystemImages: supportedCatalog.systemImages,
      catalogMeta: supportedCatalog.entries,
      channels: {} as Record<string, unknown>,
      channelControls: {} as Record<string, unknown>,
      channelAccounts: {} as Record<string, unknown>,
      channelDefaultAccountId: {} as Record<string, unknown>,
    };
    const channelsMap = payload.channels as Record<string, unknown>;
    const controlsMap = payload.channelControls as Record<string, unknown>;
    const accountsMap = payload.channelAccounts as Record<string, unknown>;
    const defaultAccountIdMap = payload.channelDefaultAccountId as Record<string, unknown>;
    for (const plugin of plugins) {
      const { accounts, defaultAccountId, defaultAccount, resolvedAccounts } =
        await buildChannelAccounts(plugin.id);
      const fallbackAccount =
        resolvedAccounts[defaultAccountId] ?? plugin.config.resolveAccount(cfg, defaultAccountId);
      const summary = plugin.status?.buildChannelSummary
        ? await plugin.status.buildChannelSummary({
            account: fallbackAccount,
            cfg,
            defaultAccountId,
            snapshot:
              defaultAccount ??
              ({
                accountId: defaultAccountId,
              } as ChannelAccountSnapshot),
          })
        : {
            configured: defaultAccount?.configured ?? false,
          };
      channelsMap[plugin.id] = summary;
      const loginMode =
        plugin.gateway?.loginWithQrStart && plugin.gateway?.loginWithQrWait ? "qr" : "none";
      const canReconnect = accounts.some((account) => account.configured);
      const actions = [
        ...(loginMode === "qr" ? ["login"] : []),
        ...(canReconnect ? ["reconnect"] : []),
        ...(plugin.status?.probeAccount || plugin.status?.auditAccount ? ["verify"] : []),
        ...(plugin.gateway?.logoutAccount ? ["logout"] : []),
        ...(plugin.configSchema ? ["edit"] : []),
        ...(plugin.setupWizard || plugin.setup ? ["setup"] : []),
      ];
      controlsMap[plugin.id] = {
        loginMode,
        actions,
        canReconnect,
        canVerify: plugin.status?.probeAccount != null || plugin.status?.auditAccount != null,
        canLogout: plugin.gateway?.logoutAccount != null,
        canEdit: plugin.configSchema != null,
        canSetup: plugin.setupWizard != null || plugin.setup != null,
        multiAccount: supportsChannelMultiAccount(plugin, cfg),
      };
      accountsMap[plugin.id] = accounts;
      defaultAccountIdMap[plugin.id] = defaultAccountId;
    }

    respond(true, payload, undefined);
  },
  "channels.setup.surface": async ({ params, respond }) => {
    if (!validateChannelsSetupSurfaceParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid channels.setup.surface params: ${formatValidationErrors(validateChannelsSetupSurfaceParams.errors)}`,
        ),
      );
      return;
    }
    const cfg = loadChannelsConfig();
    const target = resolveChannelAccountTarget(params, cfg);
    if ("error" in target) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, target.error ?? "invalid channel"),
      );
      return;
    }
    try {
      respond(
        true,
        await buildChannelsSetupSurface({
          channelId: target.channelId,
          plugin: target.plugin,
          cfg,
        }),
        undefined,
      );
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, formatForLog(err)));
    }
  },
  "channels.account.login.start": async ({ params, respond, context }) => {
    if (!validateChannelsAccountLoginStartParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid channels.account.login.start params: ${formatValidationErrors(validateChannelsAccountLoginStartParams.errors)}`,
        ),
      );
      return;
    }
    try {
      const cfg = loadChannelsConfig();
      const target = resolveChannelAccountTarget(params, cfg);
      if ("error" in target) {
        const message = target.error ?? "invalid channel";
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, message));
        return;
      }
      if (!target.plugin.gateway?.loginWithQrStart) {
        respond(
          false,
          undefined,
          errorShape(
            ErrorCodes.INVALID_REQUEST,
            `channel ${target.channelId} does not support QR login`,
          ),
        );
        return;
      }
      await context.stopChannel(target.channelId, target.accountId);
      const result = await target.plugin.gateway.loginWithQrStart({
        accountId: target.accountId,
        force: Boolean((params as { force?: boolean }).force),
        timeoutMs:
          typeof (params as { timeoutMs?: unknown }).timeoutMs === "number"
            ? (params as { timeoutMs?: number }).timeoutMs
            : undefined,
        verbose: Boolean((params as { verbose?: boolean }).verbose),
      });
      respond(
        true,
        {
          channel: target.channelId,
          accountId: target.accountId,
          ...result,
        },
        undefined,
      );
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, formatForLog(err)));
    }
  },
  "channels.account.login.wait": async ({ params, respond, context }) => {
    if (!validateChannelsAccountLoginWaitParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid channels.account.login.wait params: ${formatValidationErrors(validateChannelsAccountLoginWaitParams.errors)}`,
        ),
      );
      return;
    }
    try {
      const cfg = loadChannelsConfig();
      const target = resolveChannelAccountTarget(params, cfg);
      if ("error" in target) {
        const message = target.error ?? "invalid channel";
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, message));
        return;
      }
      if (!target.plugin.gateway?.loginWithQrWait) {
        respond(
          false,
          undefined,
          errorShape(
            ErrorCodes.INVALID_REQUEST,
            `channel ${target.channelId} does not support QR login`,
          ),
        );
        return;
      }
      const result = await target.plugin.gateway.loginWithQrWait({
        accountId: target.accountId,
        timeoutMs:
          typeof (params as { timeoutMs?: unknown }).timeoutMs === "number"
            ? (params as { timeoutMs?: number }).timeoutMs
            : undefined,
      });
      if (result.connected) {
        await context.startChannel(target.channelId, target.accountId);
      }
      respond(
        true,
        {
          channel: target.channelId,
          accountId: target.accountId,
          ...result,
        },
        undefined,
      );
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, formatForLog(err)));
    }
  },
  "channels.account.reconnect": async ({ params, respond, context }) => {
    if (!validateChannelsAccountReconnectParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid channels.account.reconnect params: ${formatValidationErrors(validateChannelsAccountReconnectParams.errors)}`,
        ),
      );
      return;
    }
    try {
      const cfg = loadChannelsConfig();
      const target = resolveChannelAccountTarget(params, cfg);
      if ("error" in target) {
        const message = target.error ?? "invalid channel";
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, message));
        return;
      }
      const configured = target.plugin.config.isConfigured
        ? await target.plugin.config.isConfigured(target.account, cfg)
        : true;
      if (!configured) {
        respond(
          false,
          undefined,
          errorShape(
            ErrorCodes.INVALID_REQUEST,
            `channel ${target.channelId} account ${target.accountId} is not configured`,
          ),
        );
        return;
      }
      await context.stopChannel(target.channelId, target.accountId);
      await context.startChannel(target.channelId, target.accountId);
      const restartedAt = Date.now();
      const snapshot = await buildChannelAccountSnapshot({
        plugin: target.plugin,
        cfg,
        accountId: target.accountId,
        runtime: resolveRuntimeAccountSnapshot({
          context,
          channelId: target.channelId,
          accountId: target.accountId,
          plugin: target.plugin,
          cfg,
        }),
      });
      snapshot.lastStartAt ??= restartedAt;
      respond(
        true,
        {
          channel: target.channelId,
          accountId: target.accountId,
          restartedAt,
          snapshot,
        },
        undefined,
      );
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, formatForLog(err)));
    }
  },
  "channels.account.verify": async ({ params, respond, context }) => {
    if (!validateChannelsAccountVerifyParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid channels.account.verify params: ${formatValidationErrors(validateChannelsAccountVerifyParams.errors)}`,
        ),
      );
      return;
    }
    try {
      const cfg = loadChannelsConfig();
      const target = resolveChannelAccountTarget(params, cfg);
      if ("error" in target) {
        const message = target.error ?? "invalid channel";
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, message));
        return;
      }
      if (!target.plugin.status?.probeAccount && !target.plugin.status?.auditAccount) {
        respond(
          false,
          undefined,
          errorShape(
            ErrorCodes.INVALID_REQUEST,
            `channel ${target.channelId} does not support account verification`,
          ),
        );
        return;
      }
      const timeoutMsRaw = (params as { timeoutMs?: unknown }).timeoutMs;
      const timeoutMs = typeof timeoutMsRaw === "number" ? Math.max(1000, timeoutMsRaw) : 10_000;
      const configured = target.plugin.config.isConfigured
        ? await target.plugin.config.isConfigured(target.account, cfg)
        : true;
      let probe: unknown;
      let audit: unknown;
      let verifiedAt = Date.now();
      if (configured && target.plugin.status?.probeAccount) {
        probe = await target.plugin.status.probeAccount({
          account: target.account,
          timeoutMs,
          cfg,
        });
        verifiedAt = Date.now();
      }
      if (configured && target.plugin.status?.auditAccount) {
        audit = await target.plugin.status.auditAccount({
          account: target.account,
          timeoutMs,
          cfg,
          probe,
        });
      }
      const snapshot = await buildChannelAccountSnapshot({
        plugin: target.plugin,
        cfg,
        accountId: target.accountId,
        runtime: resolveRuntimeAccountSnapshot({
          context,
          channelId: target.channelId,
          accountId: target.accountId,
          plugin: target.plugin,
          cfg,
        }),
        probe,
        audit,
      });
      snapshot.lastProbeAt = verifiedAt;
      respond(
        true,
        {
          channel: target.channelId,
          accountId: target.accountId,
          verifiedAt,
          snapshot,
          ...(probe !== undefined ? { probe } : {}),
          ...(audit !== undefined ? { audit } : {}),
        },
        undefined,
      );
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, formatForLog(err)));
    }
  },
  "channels.account.logout": async ({ params, respond, context }) => {
    if (!validateChannelsAccountLogoutParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid channels.account.logout params: ${formatValidationErrors(validateChannelsAccountLogoutParams.errors)}`,
        ),
      );
      return;
    }
    const snapshot = await readConfigFileSnapshot();
    if (!snapshot.valid) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "config invalid; fix it before logging out"),
      );
      return;
    }
    try {
      const target = resolveChannelAccountTarget(params, snapshot.runtimeConfig);
      if ("error" in target) {
        const message = target.error ?? "invalid channel";
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, message));
        return;
      }
      if (!target.plugin.gateway?.logoutAccount) {
        respond(
          false,
          undefined,
          errorShape(
            ErrorCodes.INVALID_REQUEST,
            `channel ${target.channelId} does not support logout`,
          ),
        );
        return;
      }
      const payload = await logoutChannelAccount({
        channelId: target.channelId,
        accountId: target.accountId,
        cfg: snapshot.runtimeConfig,
        context,
        plugin: target.plugin,
      });
      respond(true, payload, undefined);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, formatForLog(err)));
    }
  },
  "channels.logout": async ({ params, respond, context }) => {
    if (!validateChannelsLogoutParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid channels.logout params: ${formatValidationErrors(validateChannelsLogoutParams.errors)}`,
        ),
      );
      return;
    }
    const rawChannel = (params as { channel?: unknown }).channel;
    const channelId = typeof rawChannel === "string" ? normalizeChannelId(rawChannel) : null;
    if (!channelId) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "invalid channels.logout channel"),
      );
      return;
    }
    const plugin = getChannelPlugin(channelId);
    if (!plugin?.gateway?.logoutAccount) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, `channel ${channelId} does not support logout`),
      );
      return;
    }
    const accountIdRaw = (params as { accountId?: unknown }).accountId;
    const accountId = typeof accountIdRaw === "string" ? accountIdRaw.trim() : undefined;
    const snapshot = await readConfigFileSnapshot();
    if (!snapshot.valid) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "config invalid; fix it before logging out"),
      );
      return;
    }
    try {
      const payload = await logoutChannelAccount({
        channelId,
        accountId,
        cfg: snapshot.runtimeConfig,
        context,
        plugin,
      });
      respond(true, payload, undefined);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, formatForLog(err)));
    }
  },
};
