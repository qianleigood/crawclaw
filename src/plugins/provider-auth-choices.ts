import { normalizeProviderIdForAuth } from "../agents/model-selection.js";
import type { CrawClawConfig } from "../config/config.js";
import { BUNDLED_PROVIDER_AUTH_CHOICES as GENERATED_BUNDLED_PROVIDER_AUTH_CHOICES } from "../generated/providers/auth-choices.generated.js";
import { loadPluginManifestRegistry } from "./manifest-registry.js";

export type ProviderAuthChoiceMetadata = {
  pluginId: string;
  providerId: string;
  methodId: string;
  choiceId: string;
  choiceLabel: string;
  choiceHint?: string;
  deprecatedChoiceIds?: readonly string[];
  groupId?: string;
  groupLabel?: string;
  groupHint?: string;
  optionKey?: string;
  cliFlag?: string;
  cliOption?: string;
  cliDescription?: string;
  onboardingScopes?: readonly "text-inference"[];
};

export type ProviderOnboardAuthFlag = {
  optionKey: string;
  authChoice: string;
  cliFlag: string;
  cliOption: string;
  description: string;
};

export function resolveManifestProviderAuthChoices(params?: {
  config?: CrawClawConfig;
  workspaceDir?: string;
  env?: NodeJS.ProcessEnv;
}): ProviderAuthChoiceMetadata[] {
  const registry = loadPluginManifestRegistry({
    config: params?.config,
    workspaceDir: params?.workspaceDir,
    env: params?.env,
  });

  const bundledPluginIds = new Set(
    registry.plugins.filter((plugin) => plugin.origin === "bundled").map((plugin) => plugin.id),
  );
  const bundledChoices: readonly ProviderAuthChoiceMetadata[] =
    GENERATED_BUNDLED_PROVIDER_AUTH_CHOICES.filter((choice) =>
      bundledPluginIds.has(choice.pluginId),
    );
  const manifestChoices = registry.plugins.flatMap((plugin) => {
    if (plugin.origin === "bundled") {
      return [];
    }
    return (plugin.providerAuthChoices ?? []).map((choice) => ({
      pluginId: plugin.id,
      providerId: choice.provider,
      methodId: choice.method,
      choiceId: choice.choiceId,
      choiceLabel: choice.choiceLabel ?? choice.choiceId,
      ...(choice.choiceHint ? { choiceHint: choice.choiceHint } : {}),
      ...(choice.deprecatedChoiceIds ? { deprecatedChoiceIds: choice.deprecatedChoiceIds } : {}),
      ...(choice.groupId ? { groupId: choice.groupId } : {}),
      ...(choice.groupLabel ? { groupLabel: choice.groupLabel } : {}),
      ...(choice.groupHint ? { groupHint: choice.groupHint } : {}),
      ...(choice.optionKey ? { optionKey: choice.optionKey } : {}),
      ...(choice.cliFlag ? { cliFlag: choice.cliFlag } : {}),
      ...(choice.cliOption ? { cliOption: choice.cliOption } : {}),
      ...(choice.cliDescription ? { cliDescription: choice.cliDescription } : {}),
      ...(choice.onboardingScopes ? { onboardingScopes: choice.onboardingScopes } : {}),
    }));
  });

  return [...bundledChoices, ...manifestChoices];
}

export function resolveManifestProviderAuthChoice(
  choiceId: string,
  params?: {
    config?: CrawClawConfig;
    workspaceDir?: string;
    env?: NodeJS.ProcessEnv;
  },
): ProviderAuthChoiceMetadata | undefined {
  const normalized = choiceId.trim();
  if (!normalized) {
    return undefined;
  }
  return resolveManifestProviderAuthChoices(params).find(
    (choice) => choice.choiceId === normalized,
  );
}

export function resolveManifestProviderApiKeyChoice(params: {
  providerId: string;
  config?: CrawClawConfig;
  workspaceDir?: string;
  env?: NodeJS.ProcessEnv;
}): ProviderAuthChoiceMetadata | undefined {
  const normalizedProviderId = normalizeProviderIdForAuth(params.providerId);
  if (!normalizedProviderId) {
    return undefined;
  }

  return resolveManifestProviderAuthChoices(params).find((choice) => {
    if (!choice.optionKey) {
      return false;
    }
    return normalizeProviderIdForAuth(choice.providerId) === normalizedProviderId;
  });
}

export function resolveManifestDeprecatedProviderAuthChoice(
  choiceId: string,
  params?: {
    config?: CrawClawConfig;
    workspaceDir?: string;
    env?: NodeJS.ProcessEnv;
  },
): ProviderAuthChoiceMetadata | undefined {
  const normalized = choiceId.trim();
  if (!normalized) {
    return undefined;
  }
  return resolveManifestProviderAuthChoices(params).find((choice) =>
    choice.deprecatedChoiceIds?.includes(normalized),
  );
}

export function resolveManifestProviderOnboardAuthFlags(params?: {
  config?: CrawClawConfig;
  workspaceDir?: string;
  env?: NodeJS.ProcessEnv;
}): ProviderOnboardAuthFlag[] {
  const flags: ProviderOnboardAuthFlag[] = [];
  const seen = new Set<string>();

  for (const choice of resolveManifestProviderAuthChoices(params)) {
    if (!choice.optionKey || !choice.cliFlag || !choice.cliOption) {
      continue;
    }
    const dedupeKey = `${choice.optionKey}::${choice.cliFlag}`;
    if (seen.has(dedupeKey)) {
      continue;
    }
    seen.add(dedupeKey);
    flags.push({
      optionKey: choice.optionKey,
      authChoice: choice.choiceId,
      cliFlag: choice.cliFlag,
      cliOption: choice.cliOption,
      description: choice.cliDescription ?? choice.choiceLabel,
    });
  }

  return flags;
}
