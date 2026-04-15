import {
  applyAgentDefaultModelPrimary,
  applyOnboardAuthAgentModelsAndProviders,
  type ModelProviderConfig,
  type CrawClawConfig,
} from "crawclaw/plugin-sdk/provider-onboard";
import {
  buildMinimaxApiModelDefinition,
  MINIMAX_API_BASE_URL,
  MINIMAX_CN_API_BASE_URL,
} from "./model-definitions.js";

type MinimaxApiProviderConfigParams = {
  providerId: string;
  modelId: string;
  baseUrl: string;
};

function applyMinimaxApiProviderConfigWithBaseUrl(
  cfg: CrawClawConfig,
  params: MinimaxApiProviderConfigParams,
): CrawClawConfig {
  const providers = { ...cfg.models?.providers } as Record<string, ModelProviderConfig>;
  const existingProvider = providers[params.providerId];
  const existingModels = existingProvider?.models ?? [];
  const apiModel = buildMinimaxApiModelDefinition(params.modelId);
  const hasApiModel = existingModels.some((model) => model.id === params.modelId);
  const mergedModels = hasApiModel ? existingModels : [...existingModels, apiModel];
  const { apiKey: existingApiKey, ...existingProviderRest } = existingProvider ?? {
    baseUrl: params.baseUrl,
    models: [],
  };
  const resolvedApiKey = typeof existingApiKey === "string" ? existingApiKey : undefined;
  const normalizedApiKey = resolvedApiKey?.trim() === "minimax" ? "" : resolvedApiKey;
  providers[params.providerId] = {
    ...existingProviderRest,
    baseUrl: params.baseUrl,
    api: "anthropic-messages",
    authHeader: true,
    ...(normalizedApiKey?.trim() ? { apiKey: normalizedApiKey } : {}),
    models: mergedModels.length > 0 ? mergedModels : [apiModel],
  };

  const models = { ...cfg.agents?.defaults?.models };
  const modelRef = `${params.providerId}/${params.modelId}`;
  models[modelRef] = {
    ...models[modelRef],
    alias: "Minimax",
  };

  return applyOnboardAuthAgentModelsAndProviders(cfg, { agentModels: models, providers });
}

function applyMinimaxApiConfigWithBaseUrl(
  cfg: CrawClawConfig,
  params: MinimaxApiProviderConfigParams,
): CrawClawConfig {
  const next = applyMinimaxApiProviderConfigWithBaseUrl(cfg, params);
  return applyAgentDefaultModelPrimary(next, `${params.providerId}/${params.modelId}`);
}

export function applyMinimaxApiProviderConfig(
  cfg: CrawClawConfig,
  modelId: string = "MiniMax-M2.7",
): CrawClawConfig {
  return applyMinimaxApiProviderConfigWithBaseUrl(cfg, {
    providerId: "minimax",
    modelId,
    baseUrl: MINIMAX_API_BASE_URL,
  });
}

export function applyMinimaxApiConfig(
  cfg: CrawClawConfig,
  modelId: string = "MiniMax-M2.7",
): CrawClawConfig {
  return applyMinimaxApiConfigWithBaseUrl(cfg, {
    providerId: "minimax",
    modelId,
    baseUrl: MINIMAX_API_BASE_URL,
  });
}

export function applyMinimaxApiProviderConfigCn(
  cfg: CrawClawConfig,
  modelId: string = "MiniMax-M2.7",
): CrawClawConfig {
  return applyMinimaxApiProviderConfigWithBaseUrl(cfg, {
    providerId: "minimax",
    modelId,
    baseUrl: MINIMAX_CN_API_BASE_URL,
  });
}

export function applyMinimaxApiConfigCn(
  cfg: CrawClawConfig,
  modelId: string = "MiniMax-M2.7",
): CrawClawConfig {
  return applyMinimaxApiConfigWithBaseUrl(cfg, {
    providerId: "minimax",
    modelId,
    baseUrl: MINIMAX_CN_API_BASE_URL,
  });
}
