import {
  PROVIDER_AUTH_ID_ALIASES,
  PROVIDER_ID_ALIASES,
} from "../generated/providers/runtime-constants.generated.js";

const providerIdAliases: Readonly<Record<string, string>> = PROVIDER_ID_ALIASES;
const providerAuthIdAliases: Readonly<Record<string, string>> = PROVIDER_AUTH_ID_ALIASES;

export function normalizeProviderId(provider: string): string {
  const normalized = provider.trim().toLowerCase();
  return providerIdAliases[normalized] ?? normalized;
}

/** Normalize provider ID for auth lookup. Coding-plan variants share auth with base. */
export function normalizeProviderIdForAuth(provider: string): string {
  const normalized = normalizeProviderId(provider);
  return providerAuthIdAliases[normalized] ?? normalized;
}

export function findNormalizedProviderValue<T>(
  entries: Record<string, T> | undefined,
  provider: string,
): T | undefined {
  if (!entries) {
    return undefined;
  }
  const providerKey = normalizeProviderId(provider);
  for (const [key, value] of Object.entries(entries)) {
    if (normalizeProviderId(key) === providerKey) {
      return value;
    }
  }
  return undefined;
}

export function findNormalizedProviderKey(
  entries: Record<string, unknown> | undefined,
  provider: string,
): string | undefined {
  if (!entries) {
    return undefined;
  }
  const providerKey = normalizeProviderId(provider);
  return Object.keys(entries).find((key) => normalizeProviderId(key) === providerKey);
}
