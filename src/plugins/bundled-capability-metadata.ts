import {
  BUNDLED_AUTO_ENABLE_PROVIDER_PLUGIN_IDS as GENERATED_BUNDLED_AUTO_ENABLE_PROVIDER_PLUGIN_IDS,
  BUNDLED_LEGACY_PLUGIN_ID_ALIASES as GENERATED_BUNDLED_LEGACY_PLUGIN_ID_ALIASES,
  BUNDLED_PLUGIN_CONTRACT_SNAPSHOTS as GENERATED_BUNDLED_PLUGIN_CONTRACT_SNAPSHOTS,
} from "../generated/plugins/bundled-capability-metadata.generated.js";

export type BundledPluginContractSnapshot = {
  pluginId: string;
  providerIds: readonly string[];
  speechProviderIds: readonly string[];
  webFetchProviderIds: readonly string[];
  webSearchProviderIds: readonly string[];
  toolNames: readonly string[];
};

export const BUNDLED_PLUGIN_CONTRACT_SNAPSHOTS: readonly BundledPluginContractSnapshot[] =
  GENERATED_BUNDLED_PLUGIN_CONTRACT_SNAPSHOTS;

function collectPluginIds(
  pick: (entry: BundledPluginContractSnapshot) => readonly string[],
): readonly string[] {
  return BUNDLED_PLUGIN_CONTRACT_SNAPSHOTS.filter((entry) => pick(entry).length > 0)
    .map((entry) => entry.pluginId)
    .toSorted((left, right) => left.localeCompare(right));
}

export const BUNDLED_PROVIDER_PLUGIN_IDS = collectPluginIds((entry) => entry.providerIds);

export const BUNDLED_SPEECH_PLUGIN_IDS = collectPluginIds((entry) => entry.speechProviderIds);

export const BUNDLED_WEB_FETCH_PLUGIN_IDS = collectPluginIds((entry) => entry.webFetchProviderIds);

export const BUNDLED_RUNTIME_CONTRACT_PLUGIN_IDS = [
  ...new Set(
    BUNDLED_PLUGIN_CONTRACT_SNAPSHOTS.filter(
      (entry) =>
        entry.providerIds.length > 0 ||
        entry.speechProviderIds.length > 0 ||
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
