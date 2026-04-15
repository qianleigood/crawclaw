import type { ChannelAllowlistAdapter } from "../channels/plugins/types.adapters.js";
import type { ChannelId } from "../channels/plugins/types.js";
import {
  applyAccountScopedAllowlistConfigEdit,
  readConfiguredAllowlistEntries,
  type AllowlistAccountResolver,
  type AllowlistConfigPaths,
  type AllowlistGroupOverride,
  type AllowlistNormalizer,
} from "./allowlist-config-edit-helpers.js";
export {
  collectAllowlistOverridesFromRecord,
  collectNestedAllowlistOverridesFromRecord,
  createAccountScopedAllowlistNameResolver,
  createFlatAllowlistOverrideResolver,
  createNestedAllowlistOverrideResolver,
  readConfiguredAllowlistEntries,
} from "./allowlist-config-edit-helpers.js";
export type { AllowlistGroupOverride, AllowlistNameResolution } from "./allowlist-config-edit-helpers.js";

const DM_ALLOWLIST_CONFIG_PATHS: AllowlistConfigPaths = {
  readPaths: [["allowFrom"]],
  writePath: ["allowFrom"],
};

const GROUP_ALLOWLIST_CONFIG_PATHS: AllowlistConfigPaths = {
  readPaths: [["groupAllowFrom"]],
  writePath: ["groupAllowFrom"],
};

const LEGACY_DM_ALLOWLIST_CONFIG_PATHS: AllowlistConfigPaths = {
  readPaths: [["allowFrom"], ["dm", "allowFrom"]],
  writePath: ["allowFrom"],
  cleanupPaths: [["dm", "allowFrom"]],
};

export function resolveDmGroupAllowlistConfigPaths(scope: "dm" | "group") {
  return scope === "dm" ? DM_ALLOWLIST_CONFIG_PATHS : GROUP_ALLOWLIST_CONFIG_PATHS;
}

export function resolveLegacyDmAllowlistConfigPaths(scope: "dm" | "group") {
  return scope === "dm" ? LEGACY_DM_ALLOWLIST_CONFIG_PATHS : null;
}

/** Build the default account-scoped allowlist editor used by channel plugins with config-backed lists. */
export function buildAccountScopedAllowlistConfigEditor(params: {
  channelId: ChannelId;
  normalize: AllowlistNormalizer;
  resolvePaths: (scope: "dm" | "group") => AllowlistConfigPaths | null;
}): NonNullable<ChannelAllowlistAdapter["applyConfigEdit"]> {
  return ({ cfg, parsedConfig, accountId, scope, action, entry }) => {
    const paths = params.resolvePaths(scope);
    if (!paths) {
      return null;
    }
    return applyAccountScopedAllowlistConfigEdit({
      parsedConfig,
      channelId: params.channelId,
      accountId,
      action,
      entry,
      normalize: (values) => params.normalize({ cfg, accountId, values }),
      paths,
    });
  };
}

function buildAccountAllowlistAdapter<ResolvedAccount>(params: {
  channelId: ChannelId;
  resolveAccount: AllowlistAccountResolver<ResolvedAccount>;
  normalize: AllowlistNormalizer;
  supportsScope: NonNullable<ChannelAllowlistAdapter["supportsScope"]>;
  resolvePaths: (scope: "dm" | "group") => AllowlistConfigPaths | null;
  readConfig: (
    account: ResolvedAccount,
  ) => Awaited<ReturnType<NonNullable<ChannelAllowlistAdapter["readConfig"]>>>;
}): Pick<ChannelAllowlistAdapter, "supportsScope" | "readConfig" | "applyConfigEdit"> {
  return {
    supportsScope: params.supportsScope,
    readConfig: ({ cfg, accountId }) =>
      params.readConfig(params.resolveAccount({ cfg, accountId })),
    applyConfigEdit: buildAccountScopedAllowlistConfigEditor({
      channelId: params.channelId,
      normalize: params.normalize,
      resolvePaths: params.resolvePaths,
    }),
  };
}

/** Build the common DM/group allowlist adapter used by channels that store both lists in config. */
export function buildDmGroupAccountAllowlistAdapter<ResolvedAccount>(params: {
  channelId: ChannelId;
  resolveAccount: AllowlistAccountResolver<ResolvedAccount>;
  normalize: AllowlistNormalizer;
  resolveDmAllowFrom: (account: ResolvedAccount) => Array<string | number> | null | undefined;
  resolveGroupAllowFrom: (account: ResolvedAccount) => Array<string | number> | null | undefined;
  resolveDmPolicy?: (account: ResolvedAccount) => string | null | undefined;
  resolveGroupPolicy?: (account: ResolvedAccount) => string | null | undefined;
  resolveGroupOverrides?: (account: ResolvedAccount) => AllowlistGroupOverride[] | undefined;
}): Pick<ChannelAllowlistAdapter, "supportsScope" | "readConfig" | "applyConfigEdit"> {
  return buildAccountAllowlistAdapter({
    channelId: params.channelId,
    resolveAccount: params.resolveAccount,
    normalize: params.normalize,
    supportsScope: ({ scope }) => scope === "dm" || scope === "group" || scope === "all",
    resolvePaths: resolveDmGroupAllowlistConfigPaths,
    readConfig: (account) => ({
      dmAllowFrom: readConfiguredAllowlistEntries(params.resolveDmAllowFrom(account)),
      groupAllowFrom: readConfiguredAllowlistEntries(params.resolveGroupAllowFrom(account)),
      dmPolicy: params.resolveDmPolicy?.(account) ?? undefined,
      groupPolicy: params.resolveGroupPolicy?.(account) ?? undefined,
      groupOverrides: params.resolveGroupOverrides?.(account),
    }),
  });
}

/** Build the common DM-only allowlist adapter for channels with legacy dm.allowFrom fallback paths. */
export function buildLegacyDmAccountAllowlistAdapter<ResolvedAccount>(params: {
  channelId: ChannelId;
  resolveAccount: AllowlistAccountResolver<ResolvedAccount>;
  normalize: AllowlistNormalizer;
  resolveDmAllowFrom: (account: ResolvedAccount) => Array<string | number> | null | undefined;
  resolveGroupPolicy?: (account: ResolvedAccount) => string | null | undefined;
  resolveGroupOverrides?: (account: ResolvedAccount) => AllowlistGroupOverride[] | undefined;
}): Pick<ChannelAllowlistAdapter, "supportsScope" | "readConfig" | "applyConfigEdit"> {
  return buildAccountAllowlistAdapter({
    channelId: params.channelId,
    resolveAccount: params.resolveAccount,
    normalize: params.normalize,
    supportsScope: ({ scope }) => scope === "dm",
    resolvePaths: resolveLegacyDmAllowlistConfigPaths,
    readConfig: (account) => ({
      dmAllowFrom: readConfiguredAllowlistEntries(params.resolveDmAllowFrom(account)),
      groupPolicy: params.resolveGroupPolicy?.(account) ?? undefined,
      groupOverrides: params.resolveGroupOverrides?.(account),
    }),
  });
}
