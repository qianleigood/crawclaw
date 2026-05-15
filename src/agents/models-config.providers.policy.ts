import type { ProviderConfig } from "./models-config.providers.secrets.js";

export function applyNativeStreamingUsageCompat(
  providers: Record<string, ProviderConfig>,
): Record<string, ProviderConfig> {
  return providers;
}

export function normalizeProviderSpecificConfig(
  providerKey: string,
  provider: ProviderConfig,
): ProviderConfig {
  void providerKey;
  return provider;
}

export function resolveProviderConfigApiKeyResolver(
  providerKey: string,
): ((env: NodeJS.ProcessEnv) => string | undefined) | undefined {
  void providerKey;
  return undefined;
}
