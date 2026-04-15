import type { CrawClawConfig } from "../config/config.js";
import type { AgentModelEntryConfig } from "../config/types.agent-defaults.js";
import type {
  ModelApi,
  ModelDefinitionConfig,
  ModelProviderConfig,
} from "../config/types.models.js";

export const DEFAULT_PROVIDER = "anthropic";

type NormalizedModelRef = {
  provider: string;
  model: string;
};

export type AgentModelAliasEntry =
  | string
  | {
      modelRef: string;
      alias?: string;
    };

export type ProviderOnboardPresetAppliers<TArgs extends unknown[]> = {
  applyProviderConfig: (cfg: CrawClawConfig, ...args: TArgs) => CrawClawConfig;
  applyConfig: (cfg: CrawClawConfig, ...args: TArgs) => CrawClawConfig;
};

export type ProviderModelMergeState = {
  providers: Record<string, ModelProviderConfig>;
  existingProvider?: ModelProviderConfig;
  existingModels: ModelDefinitionConfig[];
};

export function normalizeProviderId(provider: string): string {
  const normalized = provider.trim().toLowerCase();
  if (normalized === "z.ai" || normalized === "z-ai") {
    return "zai";
  }
  if (normalized === "opencode-zen") {
    return "opencode";
  }
  if (normalized === "opencode-go-auth") {
    return "opencode-go";
  }
  if (normalized === "kimi" || normalized === "kimi-code" || normalized === "kimi-coding") {
    return "kimi";
  }
  if (normalized === "bedrock" || normalized === "aws-bedrock") {
    return "amazon-bedrock";
  }
  if (normalized === "bytedance" || normalized === "doubao") {
    return "volcengine";
  }
  return normalized;
}

function findNormalizedProviderKey(
  entries: Record<string, unknown> | undefined,
  provider: string,
): string | undefined {
  if (!entries) {
    return undefined;
  }
  const providerKey = normalizeProviderId(provider);
  return Object.keys(entries).find((key) => normalizeProviderId(key) === providerKey);
}

function modelKey(provider: string, model: string): string {
  const providerId = provider.trim();
  const modelId = model.trim();
  if (!providerId) {
    return modelId;
  }
  if (!modelId) {
    return providerId;
  }
  return modelId.toLowerCase().startsWith(`${providerId.toLowerCase()}/`)
    ? modelId
    : `${providerId}/${modelId}`;
}

function parseModelRef(raw: string, defaultProvider: string): NormalizedModelRef | null {
  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }
  const slash = trimmed.indexOf("/");
  if (slash === -1) {
    return { provider: normalizeProviderId(defaultProvider), model: trimmed };
  }
  const providerRaw = trimmed.slice(0, slash).trim();
  const model = trimmed.slice(slash + 1).trim();
  if (!providerRaw || !model) {
    return null;
  }
  return { provider: normalizeProviderId(providerRaw), model };
}

export function resolveAllowlistModelKey(raw: string, defaultProvider: string): string | null {
  const parsed = parseModelRef(raw, defaultProvider);
  if (!parsed) {
    return null;
  }
  return modelKey(parsed.provider, parsed.model);
}

export function extractAgentDefaultModelFallbacks(model: unknown): string[] | undefined {
  if (!model || typeof model !== "object") {
    return undefined;
  }
  if (!("fallbacks" in model)) {
    return undefined;
  }
  const fallbacks = (model as { fallbacks?: unknown }).fallbacks;
  return Array.isArray(fallbacks) ? fallbacks.map((value) => String(value)) : undefined;
}

export function normalizeAgentModelAliasEntry(entry: AgentModelAliasEntry): {
  modelRef: string;
  alias?: string;
} {
  if (typeof entry === "string") {
    return { modelRef: entry };
  }
  return entry;
}

export function resolveProviderModelMergeState(
  cfg: CrawClawConfig,
  providerId: string,
): ProviderModelMergeState {
  const providers = { ...cfg.models?.providers } as Record<string, ModelProviderConfig>;
  const existingProviderKey = findNormalizedProviderKey(providers, providerId);
  const existingProvider =
    existingProviderKey !== undefined
      ? (providers[existingProviderKey] as ModelProviderConfig | undefined)
      : undefined;
  const existingModels: ModelDefinitionConfig[] = Array.isArray(existingProvider?.models)
    ? existingProvider.models
    : [];
  if (existingProviderKey && existingProviderKey !== providerId) {
    delete providers[existingProviderKey];
  }
  return { providers, existingProvider, existingModels };
}

function buildProviderConfig(params: {
  existingProvider: ModelProviderConfig | undefined;
  api: ModelApi;
  baseUrl: string;
  mergedModels: ModelDefinitionConfig[];
  fallbackModels: ModelDefinitionConfig[];
}): ModelProviderConfig {
  const { apiKey: existingApiKey, ...existingProviderRest } = (params.existingProvider ?? {}) as {
    apiKey?: string;
  };
  const normalizedApiKey = typeof existingApiKey === "string" ? existingApiKey.trim() : undefined;

  return {
    ...existingProviderRest,
    baseUrl: params.baseUrl,
    api: params.api,
    ...(normalizedApiKey ? { apiKey: normalizedApiKey } : {}),
    models: params.mergedModels.length > 0 ? params.mergedModels : params.fallbackModels,
  };
}

export function applyProviderConfigWithMergedModels(
  cfg: CrawClawConfig,
  params: {
    agentModels: Record<string, AgentModelEntryConfig>;
    providerId: string;
    providerState: ProviderModelMergeState;
    api: ModelApi;
    baseUrl: string;
    mergedModels: ModelDefinitionConfig[];
    fallbackModels: ModelDefinitionConfig[];
    applyOnboardAuthAgentModelsAndProviders: (
      cfg: CrawClawConfig,
      params: {
        agentModels: Record<string, AgentModelEntryConfig>;
        providers: Record<string, ModelProviderConfig>;
      },
    ) => CrawClawConfig;
  },
): CrawClawConfig {
  params.providerState.providers[params.providerId] = buildProviderConfig({
    existingProvider: params.providerState.existingProvider,
    api: params.api,
    baseUrl: params.baseUrl,
    mergedModels: params.mergedModels,
    fallbackModels: params.fallbackModels,
  });
  return params.applyOnboardAuthAgentModelsAndProviders(cfg, {
    agentModels: params.agentModels,
    providers: params.providerState.providers,
  });
}

export function createProviderPresetAppliers<
  TArgs extends unknown[],
  TParams extends {
    primaryModelRef?: string;
  },
>(params: {
  resolveParams: (
    cfg: CrawClawConfig,
    ...args: TArgs
  ) => Omit<TParams, "primaryModelRef"> | null | undefined;
  applyPreset: (cfg: CrawClawConfig, preset: TParams) => CrawClawConfig;
  primaryModelRef: string;
}): ProviderOnboardPresetAppliers<TArgs> {
  return {
    applyProviderConfig(cfg, ...args) {
      const resolved = params.resolveParams(cfg, ...args);
      return resolved ? params.applyPreset(cfg, resolved as TParams) : cfg;
    },
    applyConfig(cfg, ...args) {
      const resolved = params.resolveParams(cfg, ...args);
      if (!resolved) {
        return cfg;
      }
      return params.applyPreset(cfg, {
        ...(resolved as TParams),
        primaryModelRef: params.primaryModelRef,
      });
    },
  };
}
