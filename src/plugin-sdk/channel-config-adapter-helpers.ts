import {
  deleteAccountFromConfigSection as deleteAccountFromConfigSectionInSection,
  setAccountEnabledInConfigSection as setAccountEnabledInConfigSectionInSection,
} from "../channels/plugins/config-helpers.js";
import type { ChannelConfigAdapter } from "../channels/plugins/types.adapters.js";
import type { CrawClawConfig } from "../config/config.js";
import { normalizeAccountId } from "../routing/session-key.js";

export type ChannelCrudConfigAdapter<ResolvedAccount> = Pick<
  ChannelConfigAdapter<ResolvedAccount>,
  | "listAccountIds"
  | "resolveAccount"
  | "inspectAccount"
  | "defaultAccountId"
  | "setAccountEnabled"
  | "deleteAccount"
>;

export type ChannelConfigAdapterWithAccessors<ResolvedAccount> = Pick<
  ChannelConfigAdapter<ResolvedAccount>,
  | "listAccountIds"
  | "resolveAccount"
  | "inspectAccount"
  | "defaultAccountId"
  | "setAccountEnabled"
  | "deleteAccount"
  | "resolveAllowFrom"
  | "formatAllowFrom"
  | "resolveDefaultTo"
>;

export type ChannelConfigAccessorParams<Config extends CrawClawConfig = CrawClawConfig> = {
  cfg: Config;
  accountId?: string | null;
};

export function createNamedAccountConfigBase<
  ResolvedAccount,
  Config extends CrawClawConfig = CrawClawConfig,
>(params: {
  listAccountIds: (cfg: Config) => string[];
  resolveAccount: (cfg: Config, accountId?: string | null) => ResolvedAccount;
  inspectAccount?: (cfg: Config, accountId?: string | null) => unknown;
  defaultAccountId: (cfg: Config) => string;
  setAccountEnabled: (params: {
    cfg: CrawClawConfig;
    accountId: string;
    enabled: boolean;
  }) => CrawClawConfig;
  deleteAccount: (params: { cfg: CrawClawConfig; accountId: string }) => CrawClawConfig;
}): ChannelCrudConfigAdapter<ResolvedAccount> {
  return {
    listAccountIds(cfg) {
      return params.listAccountIds(cfg as Config);
    },
    resolveAccount(cfg, accountId) {
      return params.resolveAccount(cfg as Config, accountId);
    },
    inspectAccount: params.inspectAccount
      ? (cfg, accountId) => params.inspectAccount?.(cfg as Config, accountId)
      : undefined,
    defaultAccountId(cfg) {
      return params.defaultAccountId(cfg as Config);
    },
    setAccountEnabled({ cfg, accountId, enabled }) {
      return params.setAccountEnabled({
        cfg,
        accountId: normalizeAccountId(accountId),
        enabled,
      }) as Config;
    },
    deleteAccount({ cfg, accountId }) {
      return params.deleteAccount({
        cfg,
        accountId: normalizeAccountId(accountId),
      }) as Config;
    },
  };
}

function resolveAccessorAccountWithFallback<
  AccessorAccount,
  Config extends CrawClawConfig = CrawClawConfig,
>(
  resolveAccessorAccount:
    | ((params: ChannelConfigAccessorParams<Config>) => AccessorAccount)
    | undefined,
  fallbackResolveAccessorAccount: (params: ChannelConfigAccessorParams<Config>) => AccessorAccount,
): (params: ChannelConfigAccessorParams<Config>) => AccessorAccount {
  return resolveAccessorAccount ?? fallbackResolveAccessorAccount;
}

function createChannelConfigAdapterWithAccessors<
  ResolvedAccount,
  AccessorAccount,
  Config extends CrawClawConfig = CrawClawConfig,
>(params: {
  base: ChannelCrudConfigAdapter<ResolvedAccount>;
  resolveAccessorAccount?: (params: ChannelConfigAccessorParams<Config>) => AccessorAccount;
  fallbackResolveAccessorAccount: (params: ChannelConfigAccessorParams<Config>) => AccessorAccount;
  createAccessors: (params: {
    resolveAccount: (params: ChannelConfigAccessorParams<Config>) => AccessorAccount;
  }) => Pick<
    ChannelConfigAdapter<AccessorAccount>,
    "resolveAllowFrom" | "formatAllowFrom" | "resolveDefaultTo"
  >;
}): ChannelConfigAdapterWithAccessors<ResolvedAccount> {
  return {
    ...params.base,
    ...params.createAccessors({
      resolveAccount: resolveAccessorAccountWithFallback(
        params.resolveAccessorAccount,
        params.fallbackResolveAccessorAccount,
      ),
    }),
  };
}

export function createChannelConfigAdapterFromBase<
  ResolvedAccount,
  AccessorAccount,
  Config extends CrawClawConfig = CrawClawConfig,
>(params: {
  base: ChannelCrudConfigAdapter<ResolvedAccount>;
  resolveAccessorAccount?: (params: ChannelConfigAccessorParams<Config>) => AccessorAccount;
  resolveAccountForAccessors: (params: ChannelConfigAccessorParams<Config>) => AccessorAccount;
  createAccessors: (params: {
    resolveAccount: (params: ChannelConfigAccessorParams<Config>) => AccessorAccount;
  }) => Pick<
    ChannelConfigAdapter<AccessorAccount>,
    "resolveAllowFrom" | "formatAllowFrom" | "resolveDefaultTo"
  >;
}): ChannelConfigAdapterWithAccessors<ResolvedAccount> {
  return createChannelConfigAdapterWithAccessors<ResolvedAccount, AccessorAccount, Config>({
    base: params.base,
    resolveAccessorAccount: params.resolveAccessorAccount,
    fallbackResolveAccessorAccount: params.resolveAccountForAccessors,
    createAccessors: params.createAccessors,
  });
}

export function setTopLevelChannelEnabledInConfigSection<Config extends CrawClawConfig>(params: {
  cfg: Config;
  sectionKey: string;
  enabled: boolean;
}): Config {
  const section = params.cfg.channels?.[params.sectionKey] as Record<string, unknown> | undefined;
  return {
    ...params.cfg,
    channels: {
      ...params.cfg.channels,
      [params.sectionKey]: {
        ...section,
        enabled: params.enabled,
      },
    },
  } as Config;
}

export function removeTopLevelChannelConfigSection<Config extends CrawClawConfig>(params: {
  cfg: Config;
  sectionKey: string;
}): Config {
  const nextChannels = { ...params.cfg.channels } as Record<string, unknown>;
  delete nextChannels[params.sectionKey];
  const nextCfg = { ...params.cfg };
  if (Object.keys(nextChannels).length > 0) {
    nextCfg.channels = nextChannels as Config["channels"];
  } else {
    delete nextCfg.channels;
  }
  return nextCfg;
}

export function clearTopLevelChannelConfigFields<Config extends CrawClawConfig>(params: {
  cfg: Config;
  sectionKey: string;
  clearBaseFields: string[];
}): Config {
  const section = params.cfg.channels?.[params.sectionKey] as Record<string, unknown> | undefined;
  if (!section) {
    return params.cfg;
  }
  const nextSection = { ...section };
  for (const field of params.clearBaseFields) {
    delete nextSection[field];
  }
  return {
    ...params.cfg,
    channels: {
      ...params.cfg.channels,
      [params.sectionKey]: nextSection,
    },
  } as Config;
}

export function setScopedChannelAccountEnabled<Config extends CrawClawConfig>(params: {
  cfg: Config;
  sectionKey: string;
  accountId: string;
  enabled: boolean;
  allowTopLevel?: boolean;
}): Config {
  return setAccountEnabledInConfigSectionInSection({
    cfg: params.cfg,
    sectionKey: params.sectionKey,
    accountId: params.accountId,
    enabled: params.enabled,
    allowTopLevel: params.allowTopLevel ?? true,
  }) as Config;
}

export function deleteScopedChannelAccount<Config extends CrawClawConfig>(params: {
  cfg: Config;
  sectionKey: string;
  accountId: string;
  clearBaseFields: string[];
}): Config {
  return deleteAccountFromConfigSectionInSection({
    cfg: params.cfg,
    sectionKey: params.sectionKey,
    accountId: params.accountId,
    clearBaseFields: params.clearBaseFields,
  }) as Config;
}
