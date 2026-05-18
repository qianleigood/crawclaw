import {
  BUNDLED_AUTO_ENABLE_PROVIDER_PLUGIN_IDS as GENERATED_BUNDLED_AUTO_ENABLE_PROVIDER_PLUGIN_IDS,
  BUNDLED_LEGACY_PLUGIN_ID_ALIASES as GENERATED_BUNDLED_LEGACY_PLUGIN_ID_ALIASES,
  BUNDLED_NATIVE_SPEECH_PROVIDERS as GENERATED_BUNDLED_NATIVE_SPEECH_PROVIDERS,
  BUNDLED_NATIVE_WEB_FETCH_PROVIDERS as GENERATED_BUNDLED_NATIVE_WEB_FETCH_PROVIDERS,
  BUNDLED_NATIVE_WEB_SEARCH_PROVIDERS as GENERATED_BUNDLED_NATIVE_WEB_SEARCH_PROVIDERS,
  BUNDLED_PLUGIN_CONTRACT_SNAPSHOTS as GENERATED_BUNDLED_PLUGIN_CONTRACT_SNAPSHOTS,
} from "../generated/plugins/bundled-capability-metadata.generated.js";

export type BundledPluginContractSnapshot = {
  pluginId: string;
  providerIds: readonly string[];
  webFetchProviderIds: readonly string[];
  webSearchProviderIds: readonly string[];
  toolNames: readonly string[];
};

export type BundledNativeProviderInvocation = {
  pluginId: string;
  operation: string;
};

export type BundledNativeWebProviderMetadata = {
  pluginId: string;
  id: string;
  label: string;
  invocation: BundledNativeProviderInvocation;
};

export type BundledNativeSpeechProviderMetadata = {
  pluginId: string;
  id: string;
  label: string;
  voices: readonly string[];
  synthesize: BundledNativeProviderInvocation;
};

export const BUNDLED_PLUGIN_CONTRACT_SNAPSHOTS: readonly BundledPluginContractSnapshot[] =
  GENERATED_BUNDLED_PLUGIN_CONTRACT_SNAPSHOTS;

export const BUNDLED_NATIVE_WEB_SEARCH_PROVIDERS: readonly BundledNativeWebProviderMetadata[] =
  GENERATED_BUNDLED_NATIVE_WEB_SEARCH_PROVIDERS;

export const BUNDLED_NATIVE_WEB_FETCH_PROVIDERS: readonly BundledNativeWebProviderMetadata[] =
  GENERATED_BUNDLED_NATIVE_WEB_FETCH_PROVIDERS;

export const BUNDLED_NATIVE_SPEECH_PROVIDERS: readonly BundledNativeSpeechProviderMetadata[] =
  GENERATED_BUNDLED_NATIVE_SPEECH_PROVIDERS;

function collectPluginIds(
  pick: (entry: BundledPluginContractSnapshot) => readonly string[],
): readonly string[] {
  return BUNDLED_PLUGIN_CONTRACT_SNAPSHOTS.filter((entry) => pick(entry).length > 0)
    .map((entry) => entry.pluginId)
    .toSorted((left, right) => left.localeCompare(right));
}

export const BUNDLED_PROVIDER_PLUGIN_IDS = collectPluginIds((entry) => entry.providerIds);

export const BUNDLED_WEB_FETCH_PLUGIN_IDS = collectPluginIds((entry) => entry.webFetchProviderIds);

export const BUNDLED_WEB_FETCH_PROVIDER_PLUGIN_IDS = Object.fromEntries(
  BUNDLED_PLUGIN_CONTRACT_SNAPSHOTS.flatMap((entry) =>
    entry.webFetchProviderIds.map((providerId) => [providerId, entry.pluginId] as const),
  ).toSorted(([left], [right]) => left.localeCompare(right)),
) as Readonly<Record<string, string>>;

export const BUNDLED_RUNTIME_CONTRACT_PLUGIN_IDS = [
  ...new Set(
    BUNDLED_PLUGIN_CONTRACT_SNAPSHOTS.filter(
      (entry) =>
        entry.providerIds.length > 0 ||
        entry.webFetchProviderIds.length > 0 ||
        entry.webSearchProviderIds.length > 0,
    ).map((entry) => entry.pluginId),
  ),
].toSorted((left, right) => left.localeCompare(right));

export const BUNDLED_WEB_SEARCH_PLUGIN_IDS = collectPluginIds(
  (entry) => entry.webSearchProviderIds,
);

export const BUNDLED_WEB_SEARCH_PROVIDER_PLUGIN_IDS = Object.fromEntries(
  BUNDLED_PLUGIN_CONTRACT_SNAPSHOTS.flatMap((entry) =>
    entry.webSearchProviderIds.map((providerId) => [providerId, entry.pluginId] as const),
  ).toSorted(([left], [right]) => left.localeCompare(right)),
) as Readonly<Record<string, string>>;

export const BUNDLED_PROVIDER_PLUGIN_ID_ALIASES = Object.fromEntries(
  BUNDLED_PLUGIN_CONTRACT_SNAPSHOTS.flatMap((entry) =>
    entry.providerIds
      .filter((providerId) => providerId !== entry.pluginId)
      .map((providerId) => [providerId, entry.pluginId] as const),
  ).toSorted(([left], [right]) => left.localeCompare(right)),
) as Readonly<Record<string, string>>;

export const BUNDLED_LEGACY_PLUGIN_ID_ALIASES: Readonly<Record<string, string>> =
  GENERATED_BUNDLED_LEGACY_PLUGIN_ID_ALIASES;

export const BUNDLED_AUTO_ENABLE_PROVIDER_PLUGIN_IDS: Readonly<Record<string, string>> =
  GENERATED_BUNDLED_AUTO_ENABLE_PROVIDER_PLUGIN_IDS;
