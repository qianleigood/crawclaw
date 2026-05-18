import { isNonSecretApiKeyMarker } from "./model-auth-markers.js";
import type { ProviderConfig } from "./models-config.providers.secrets.js";

export type ExistingProviderConfig = ProviderConfig & {
  apiKey?: string;
  baseUrl?: string;
  api?: string;
};

function resolveProviderApi(entry: { api?: unknown } | undefined): string | undefined {
  if (typeof entry?.api !== "string") {
    return undefined;
  }
  const api = entry.api.trim();
  return api || undefined;
}

function resolveModelApiSurface(entry: { models?: unknown } | undefined): string | undefined {
  if (!Array.isArray(entry?.models)) {
    return undefined;
  }

  const apis = entry.models
    .flatMap((model) => {
      if (!model || typeof model !== "object") {
        return [];
      }
      const api = (model as { api?: unknown }).api;
      return typeof api === "string" && api.trim() ? [api.trim()] : [];
    })
    .toSorted();

  return apis.length > 0 ? JSON.stringify(apis) : undefined;
}

function resolveProviderApiSurface(
  entry: ExistingProviderConfig | ProviderConfig | undefined,
): string | undefined {
  return resolveProviderApi(entry) ?? resolveModelApiSurface(entry);
}

function shouldPreserveExistingApiKey(params: {
  providerKey: string;
  existing: ExistingProviderConfig;
  nextEntry: ProviderConfig;
  secretRefManagedProviders: ReadonlySet<string>;
}): boolean {
  const { providerKey, existing, nextEntry, secretRefManagedProviders } = params;
  const nextApiKey = typeof nextEntry.apiKey === "string" ? nextEntry.apiKey : "";
  if (nextApiKey && isNonSecretApiKeyMarker(nextApiKey)) {
    return false;
  }
  return (
    !secretRefManagedProviders.has(providerKey) &&
    typeof existing.apiKey === "string" &&
    existing.apiKey.length > 0 &&
    !isNonSecretApiKeyMarker(existing.apiKey, { includeEnvVarName: false })
  );
}

function shouldPreserveExistingBaseUrl(params: {
  providerKey: string;
  existing: ExistingProviderConfig;
  nextEntry: ProviderConfig;
  explicitBaseUrlProviders: ReadonlySet<string>;
}): boolean {
  const { providerKey, existing, nextEntry, explicitBaseUrlProviders } = params;
  if (
    explicitBaseUrlProviders.has(providerKey) ||
    typeof existing.baseUrl !== "string" ||
    existing.baseUrl.length === 0
  ) {
    return false;
  }

  const existingApi = resolveProviderApiSurface(existing);
  const nextApi = resolveProviderApiSurface(nextEntry);
  return !existingApi || !nextApi || existingApi === nextApi;
}

export function mergeWithExistingProviderSecrets(params: {
  nextProviders: Record<string, ProviderConfig>;
  existingProviders: Record<string, ExistingProviderConfig>;
  secretRefManagedProviders: ReadonlySet<string>;
  explicitBaseUrlProviders: ReadonlySet<string>;
}): Record<string, ProviderConfig> {
  const { nextProviders, existingProviders, secretRefManagedProviders, explicitBaseUrlProviders } =
    params;
  const mergedProviders: Record<string, ProviderConfig> = {};
  for (const [key, entry] of Object.entries(existingProviders)) {
    mergedProviders[key] = entry;
  }
  for (const [key, newEntry] of Object.entries(nextProviders)) {
    const existing = existingProviders[key];
    if (!existing) {
      mergedProviders[key] = newEntry;
      continue;
    }
    const preserved: Record<string, unknown> = {};
    if (
      shouldPreserveExistingApiKey({
        providerKey: key,
        existing,
        nextEntry: newEntry,
        secretRefManagedProviders,
      })
    ) {
      preserved.apiKey = existing.apiKey;
    }
    if (
      shouldPreserveExistingBaseUrl({
        providerKey: key,
        existing,
        nextEntry: newEntry,
        explicitBaseUrlProviders,
      })
    ) {
      preserved.baseUrl = existing.baseUrl;
    }
    mergedProviders[key] = { ...newEntry, ...preserved };
  }
  return mergedProviders;
}
