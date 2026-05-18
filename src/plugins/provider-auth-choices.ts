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
  groupId?: string;
  groupLabel?: string;
  groupHint?: string;
  onboardingScopes?: readonly "text-inference"[];
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
      ...(choice.groupId ? { groupId: choice.groupId } : {}),
      ...(choice.groupLabel ? { groupLabel: choice.groupLabel } : {}),
      ...(choice.groupHint ? { groupHint: choice.groupHint } : {}),
      ...(choice.onboardingScopes ? { onboardingScopes: choice.onboardingScopes } : {}),
    }));
  });

  return [...bundledChoices, ...manifestChoices];
}
