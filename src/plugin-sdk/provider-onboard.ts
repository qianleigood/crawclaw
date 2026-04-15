// Keep provider onboarding helpers dependency-light so bundled provider plugins
// do not pull heavyweight runtime graphs at activation time.

import type { CrawClawConfig } from "../config/config.js";
import type { AgentModelEntryConfig } from "../config/types.agent-defaults.js";
import type {
  ModelApi,
  ModelDefinitionConfig,
  ModelProviderConfig,
} from "../config/types.models.js";
import {
  applyProviderConfigWithMergedModels,
  createProviderPresetAppliers,
  DEFAULT_PROVIDER,
  extractAgentDefaultModelFallbacks,
  normalizeAgentModelAliasEntry,
  resolveAllowlistModelKey,
  resolveProviderModelMergeState,
  type AgentModelAliasEntry,
  type ProviderModelMergeState,
  type ProviderOnboardPresetAppliers,
} from "./provider-onboard-helpers.js";

export type {
  CrawClawConfig,
  } from "../config/config.js";
export type {
ModelApi,
  ModelDefinitionConfig,
  ModelProviderConfig,
};
export type {
AgentModelAliasEntry,
ProviderOnboardPresetAppliers,
};
export {
  resolveAgentModelFallbackValues,
  resolveAgentModelPrimaryValue,
  } from "../config/model-input.js";

export function withAgentModelAliases(
  existing: Record<string,
  AgentModelEntryConfig> | undefined,
  aliases: readonly AgentModelAliasEntry[],
  ): Record<string,
  AgentModelEntryConfig> {
  const next = { ...existing,
};
  for (const entry of aliases) {
    const normalized = normalizeAgentModelAliasEntry(entry);
    next[normalized.modelRef] = {
      ...next[normalized.modelRef],
      ...(normalized.alias ? { alias: next[normalized.modelRef]?.alias ?? normalized.alias } : {}),
    };
  }
  return next;
}

export function applyOnboardAuthAgentModelsAndProviders(
  cfg: CrawClawConfig,
  params: {
    agentModels: Record<string, AgentModelEntryConfig>;
    providers: Record<string, ModelProviderConfig>;
  },
): CrawClawConfig {
  return {
    ...cfg,
    agents: {
      ...cfg.agents,
      defaults: {
        ...cfg.agents?.defaults,
        models: params.agentModels,
      },
    },
    models: {
      mode: cfg.models?.mode ?? "merge",
      providers: params.providers,
    },
  };
}

export function applyAgentDefaultModelPrimary(
  cfg: CrawClawConfig,
  primary: string,
): CrawClawConfig {
  const existingFallbacks = extractAgentDefaultModelFallbacks(cfg.agents?.defaults?.model);
  return {
    ...cfg,
    agents: {
      ...cfg.agents,
      defaults: {
        ...cfg.agents?.defaults,
        model: {
          ...(existingFallbacks ? { fallbacks: existingFallbacks } : undefined),
          primary,
        },
      },
    },
  };
}

export function applyProviderConfigWithDefaultModels(
  cfg: CrawClawConfig,
  params: {
    agentModels: Record<string, AgentModelEntryConfig>;
    providerId: string;
    api: ModelApi;
    baseUrl: string;
    defaultModels: ModelDefinitionConfig[];
    defaultModelId?: string;
  },
): CrawClawConfig {
  const providerState = resolveProviderModelMergeState(cfg, params.providerId);
  const defaultModels = params.defaultModels;
  const defaultModelId = params.defaultModelId ?? defaultModels[0]?.id;
  const hasDefaultModel = defaultModelId
    ? providerState.existingModels.some((model) => model.id === defaultModelId)
    : true;
  const mergedModels =
    providerState.existingModels.length > 0
      ? hasDefaultModel || defaultModels.length === 0
        ? providerState.existingModels
        : [...providerState.existingModels, ...defaultModels]
      : defaultModels;
  return applyProviderConfigWithMergedModels(cfg, {
    agentModels: params.agentModels,
    providerId: params.providerId,
    providerState,
    api: params.api,
    baseUrl: params.baseUrl,
    mergedModels,
    fallbackModels: defaultModels,
    applyOnboardAuthAgentModelsAndProviders,
  });
}

export function applyProviderConfigWithDefaultModel(
  cfg: CrawClawConfig,
  params: {
    agentModels: Record<string, AgentModelEntryConfig>;
    providerId: string;
    api: ModelApi;
    baseUrl: string;
    defaultModel: ModelDefinitionConfig;
    defaultModelId?: string;
  },
): CrawClawConfig {
  return applyProviderConfigWithDefaultModels(cfg, {
    agentModels: params.agentModels,
    providerId: params.providerId,
    api: params.api,
    baseUrl: params.baseUrl,
    defaultModels: [params.defaultModel],
    defaultModelId: params.defaultModelId ?? params.defaultModel.id,
  });
}

export function applyProviderConfigWithDefaultModelPreset(
  cfg: CrawClawConfig,
  params: {
    providerId: string;
    api: ModelApi;
    baseUrl: string;
    defaultModel: ModelDefinitionConfig;
    defaultModelId?: string;
    aliases?: readonly AgentModelAliasEntry[];
    primaryModelRef?: string;
  },
): CrawClawConfig {
  const next = applyProviderConfigWithDefaultModel(cfg, {
    agentModels: withAgentModelAliases(cfg.agents?.defaults?.models, params.aliases ?? []),
    providerId: params.providerId,
    api: params.api,
    baseUrl: params.baseUrl,
    defaultModel: params.defaultModel,
    defaultModelId: params.defaultModelId,
  });
  return params.primaryModelRef
    ? applyAgentDefaultModelPrimary(next, params.primaryModelRef)
    : next;
}

export function createDefaultModelPresetAppliers<TArgs extends unknown[]>(params: {
  resolveParams: (
    cfg: CrawClawConfig,
    ...args: TArgs
  ) =>
    | Omit<Parameters<typeof applyProviderConfigWithDefaultModelPreset>[1], "primaryModelRef">
    | null
    | undefined;
  primaryModelRef: string;
}): ProviderOnboardPresetAppliers<TArgs> {
  return createProviderPresetAppliers({
    resolveParams: params.resolveParams,
    applyPreset: applyProviderConfigWithDefaultModelPreset,
    primaryModelRef: params.primaryModelRef,
  });
}

export function applyProviderConfigWithDefaultModelsPreset(
  cfg: CrawClawConfig,
  params: {
    providerId: string;
    api: ModelApi;
    baseUrl: string;
    defaultModels: ModelDefinitionConfig[];
    defaultModelId?: string;
    aliases?: readonly AgentModelAliasEntry[];
    primaryModelRef?: string;
  },
): CrawClawConfig {
  const next = applyProviderConfigWithDefaultModels(cfg, {
    agentModels: withAgentModelAliases(cfg.agents?.defaults?.models, params.aliases ?? []),
    providerId: params.providerId,
    api: params.api,
    baseUrl: params.baseUrl,
    defaultModels: params.defaultModels,
    defaultModelId: params.defaultModelId,
  });
  return params.primaryModelRef
    ? applyAgentDefaultModelPrimary(next, params.primaryModelRef)
    : next;
}

export function createDefaultModelsPresetAppliers<TArgs extends unknown[]>(params: {
  resolveParams: (
    cfg: CrawClawConfig,
    ...args: TArgs
  ) =>
    | Omit<Parameters<typeof applyProviderConfigWithDefaultModelsPreset>[1], "primaryModelRef">
    | null
    | undefined;
  primaryModelRef: string;
}): ProviderOnboardPresetAppliers<TArgs> {
  return createProviderPresetAppliers({
    resolveParams: params.resolveParams,
    applyPreset: applyProviderConfigWithDefaultModelsPreset,
    primaryModelRef: params.primaryModelRef,
  });
}

export function applyProviderConfigWithModelCatalog(
  cfg: CrawClawConfig,
  params: {
    agentModels: Record<string, AgentModelEntryConfig>;
    providerId: string;
    api: ModelApi;
    baseUrl: string;
    catalogModels: ModelDefinitionConfig[];
  },
): CrawClawConfig {
  const providerState = resolveProviderModelMergeState(cfg, params.providerId);
  const catalogModels = params.catalogModels;
  const mergedModels =
    providerState.existingModels.length > 0
      ? [
          ...providerState.existingModels,
          ...catalogModels.filter(
            (model) => !providerState.existingModels.some((existing) => existing.id === model.id),
          ),
        ]
      : catalogModels;
  return applyProviderConfigWithMergedModels(cfg, {
    agentModels: params.agentModels,
    providerId: params.providerId,
    providerState,
    api: params.api,
    baseUrl: params.baseUrl,
    mergedModels,
    fallbackModels: catalogModels,
    applyOnboardAuthAgentModelsAndProviders,
  });
}

export function applyProviderConfigWithModelCatalogPreset(
  cfg: CrawClawConfig,
  params: {
    providerId: string;
    api: ModelApi;
    baseUrl: string;
    catalogModels: ModelDefinitionConfig[];
    aliases?: readonly AgentModelAliasEntry[];
    primaryModelRef?: string;
  },
): CrawClawConfig {
  const next = applyProviderConfigWithModelCatalog(cfg, {
    agentModels: withAgentModelAliases(cfg.agents?.defaults?.models, params.aliases ?? []),
    providerId: params.providerId,
    api: params.api,
    baseUrl: params.baseUrl,
    catalogModels: params.catalogModels,
  });
  return params.primaryModelRef
    ? applyAgentDefaultModelPrimary(next, params.primaryModelRef)
    : next;
}

export function createModelCatalogPresetAppliers<TArgs extends unknown[]>(params: {
  resolveParams: (
    cfg: CrawClawConfig,
    ...args: TArgs
  ) =>
    | Omit<Parameters<typeof applyProviderConfigWithModelCatalogPreset>[1], "primaryModelRef">
    | null
    | undefined;
  primaryModelRef: string;
}): ProviderOnboardPresetAppliers<TArgs> {
  return createProviderPresetAppliers({
    resolveParams: params.resolveParams,
    applyPreset: applyProviderConfigWithModelCatalogPreset,
    primaryModelRef: params.primaryModelRef,
  });
}

export function ensureModelAllowlistEntry(params: {
  cfg: CrawClawConfig;
  modelRef: string;
  defaultProvider?: string;
}): CrawClawConfig {
  const rawModelRef = params.modelRef.trim();
  if (!rawModelRef) {
    return params.cfg;
  }

  const models = { ...params.cfg.agents?.defaults?.models };
  const keySet = new Set<string>([rawModelRef]);
  const canonicalKey = resolveAllowlistModelKey(
    rawModelRef,
    params.defaultProvider ?? DEFAULT_PROVIDER,
  );
  if (canonicalKey) {
    keySet.add(canonicalKey);
  }

  for (const key of keySet) {
    models[key] = {
      ...models[key],
    };
  }

  return {
    ...params.cfg,
    agents: {
      ...params.cfg.agents,
      defaults: {
        ...params.cfg.agents?.defaults,
        models,
      },
    },
  };
}
