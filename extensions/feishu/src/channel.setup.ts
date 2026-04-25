import { describeAccountSnapshot } from "crawclaw/plugin-sdk/account-helpers";
import { formatAllowFromLowercase } from "crawclaw/plugin-sdk/allow-from";
import {
  adaptScopedAccountAccessor,
  createHybridChannelConfigAdapter,
} from "crawclaw/plugin-sdk/channel-config-helpers";
import { createChannelPluginBase } from "crawclaw/plugin-sdk/core";
import type { ChannelMeta, ChannelPlugin, CrawClawConfig } from "../runtime-api.js";
import { buildChannelConfigSchema, DEFAULT_ACCOUNT_ID } from "../runtime-api.js";
import {
  listFeishuAccountIds,
  resolveDefaultFeishuAccountId,
  resolveFeishuAccount,
} from "./accounts.js";
import { FeishuConfigSchema } from "./config-schema.js";
import { feishuSetupAdapter, setFeishuNamedAccountEnabled } from "./setup-core.js";
import { feishuSetupWizard } from "./setup-surface.js";
import type { FeishuConfig, FeishuProbeResult, ResolvedFeishuAccount } from "./types.js";

const meta: ChannelMeta = {
  id: "feishu",
  label: "Feishu",
  selectionLabel: "Feishu/Lark (飞书)",
  docsPath: "/channels/feishu",
  docsLabel: "feishu",
  blurb: "飞书/Lark enterprise messaging.",
  aliases: ["lark"],
  order: 35,
  profile: "primary-cn",
};

const feishuConfigAdapter = createHybridChannelConfigAdapter<
  ResolvedFeishuAccount,
  ResolvedFeishuAccount,
  CrawClawConfig
>({
  sectionKey: "feishu",
  listAccountIds: listFeishuAccountIds,
  resolveAccount: adaptScopedAccountAccessor(resolveFeishuAccount),
  defaultAccountId: resolveDefaultFeishuAccountId,
  clearBaseFields: [],
  resolveAllowFrom: (account) => account.config.allowFrom,
  formatAllowFrom: (allowFrom) => formatAllowFromLowercase({ allowFrom }),
});

function deleteFeishuAccount(cfg: CrawClawConfig, accountId: string): CrawClawConfig {
  const isDefault = accountId === DEFAULT_ACCOUNT_ID;
  if (isDefault) {
    const next = { ...cfg } as CrawClawConfig;
    const nextChannels = { ...cfg.channels };
    delete (nextChannels as Record<string, unknown>).feishu;
    if (Object.keys(nextChannels).length > 0) {
      next.channels = nextChannels;
    } else {
      delete next.channels;
    }
    return next;
  }

  const feishuCfg = cfg.channels?.feishu as FeishuConfig | undefined;
  const accounts = { ...feishuCfg?.accounts };
  delete accounts[accountId];

  return {
    ...cfg,
    channels: {
      ...cfg.channels,
      feishu: {
        ...feishuCfg,
        accounts: Object.keys(accounts).length > 0 ? accounts : undefined,
      },
    },
  };
}

export const feishuSetupPlugin: ChannelPlugin<ResolvedFeishuAccount, FeishuProbeResult> =
  createChannelPluginBase({
    id: "feishu",
    meta,
    setupWizard: feishuSetupWizard,
    capabilities: {
      chatTypes: ["direct", "channel"],
      threads: true,
      media: true,
      reactions: true,
      edit: true,
      reply: true,
    },
    reload: { configPrefixes: ["channels.feishu"] },
    configSchema: buildChannelConfigSchema(FeishuConfigSchema),
    config: {
      ...feishuConfigAdapter,
      setAccountEnabled: ({ cfg, accountId, enabled }) => {
        if (accountId === DEFAULT_ACCOUNT_ID) {
          return {
            ...cfg,
            channels: {
              ...cfg.channels,
              feishu: {
                ...cfg.channels?.feishu,
                enabled,
              },
            },
          };
        }
        return setFeishuNamedAccountEnabled(cfg, accountId, enabled);
      },
      deleteAccount: ({ cfg, accountId }) => deleteFeishuAccount(cfg, accountId),
      isConfigured: (account) => account.configured,
      describeAccount: (account) =>
        describeAccountSnapshot({
          account,
          configured: account.configured,
          extra: {
            appId: account.appId,
            domain: account.domain,
          },
        }),
    },
    setup: feishuSetupAdapter,
  }) as ChannelPlugin<ResolvedFeishuAccount, FeishuProbeResult>;
