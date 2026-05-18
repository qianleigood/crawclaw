import type { Api, Model } from "@mariozechner/pi-ai";
import type { CrawClawConfig } from "../../config/config.js";
import type { ModelDefinitionConfig } from "../../config/types.js";
import { resolveCrawClawAgentDir } from "../agent-paths.js";
import { DEFAULT_CONTEXT_TOKENS } from "../defaults.js";
import { buildModelAliasLines } from "../model-alias-lines.js";
import { isSecretRefHeaderValueMarker } from "../model-auth-markers.js";
import { findNormalizedProviderValue, normalizeProviderId } from "../model-selection.js";
import {
  buildSuppressedBuiltInModelError,
  shouldSuppressBuiltInModel,
} from "../model-suppression.js";
import { discoverAuthStorage, discoverModels } from "../pi-model-discovery.js";
import { resolveProviderRequestConfig } from "../provider-request-config.js";
import { normalizeResolvedProviderModel } from "./model.provider-normalization.js";

type InlineModelEntry = Omit<ModelDefinitionConfig, "api"> & {
  api?: Api;
  provider: string;
  baseUrl?: string;
  headers?: Record<string, string>;
};
type InlineProviderConfig = {
  baseUrl?: string;
  api?: ModelDefinitionConfig["api"];
  models?: ModelDefinitionConfig[];
  headers?: unknown;
  authHeader?: boolean;
};

export type AuthStorage = {
  getApiKey: (
    provider: string,
    options?: { includeFallback?: boolean },
  ) => string | undefined | Promise<string | undefined>;
  setRuntimeApiKey: (provider: string, apiKey: string) => void;
};
export type ModelRegistry = {
  find: (provider: string, modelId: string) => Model<Api> | null | undefined;
};

function normalizeResolvedTransportApi(api: unknown): ModelDefinitionConfig["api"] | undefined {
  switch (api) {
    case "anthropic-messages":
    case "bedrock-converse-stream":
    case "github-copilot":
    case "google-generative-ai":
    case "ollama":
    case "openai-codex-responses":
    case "openai-completions":
    case "openai-responses":
    case "azure-openai-responses":
      return api;
    default:
      return undefined;
  }
}

function sanitizeModelHeaders(
  headers: unknown,
  opts?: { stripSecretRefMarkers?: boolean },
): Record<string, string> | undefined {
  if (!headers || typeof headers !== "object" || Array.isArray(headers)) {
    return undefined;
  }
  const next: Record<string, string> = {};
  for (const [headerName, headerValue] of Object.entries(headers)) {
    if (typeof headerValue !== "string") {
      continue;
    }
    if (opts?.stripSecretRefMarkers && isSecretRefHeaderValueMarker(headerValue)) {
      continue;
    }
    next[headerName] = headerValue;
  }
  return Object.keys(next).length > 0 ? next : undefined;
}

function normalizeResolvedModel(params: { provider: string; model: Model<Api> }): Model<Api> {
  const normalizedInputModel =
    Array.isArray(params.model.input) && params.model.input.length > 0
      ? params.model
      : ({
          ...params.model,
          input: ["text"],
        } as Model<Api>);
  return normalizeResolvedProviderModel({
    provider: params.provider,
    model: normalizedInputModel,
  });
}

function resolveProviderTransport(params: { api?: Api | null; baseUrl?: string }): {
  api?: Api;
  baseUrl?: string;
} {
  return {
    api: normalizeResolvedTransportApi(params.api),
    baseUrl: params.baseUrl,
  };
}

function findInlineModelMatch(params: {
  providers: Record<string, InlineProviderConfig>;
  provider: string;
  modelId: string;
}) {
  const inlineModels = buildInlineProviderModels(params.providers);
  const exact = inlineModels.find(
    (entry) => entry.provider === params.provider && entry.id === params.modelId,
  );
  if (exact) {
    return exact;
  }
  const normalizedProvider = normalizeProviderId(params.provider);
  return inlineModels.find(
    (entry) =>
      normalizeProviderId(entry.provider) === normalizedProvider && entry.id === params.modelId,
  );
}

export { buildModelAliasLines };

function resolveConfiguredProviderConfig(
  cfg: CrawClawConfig | undefined,
  provider: string,
): InlineProviderConfig | undefined {
  const configuredProviders = cfg?.models?.providers;
  if (!configuredProviders) {
    return undefined;
  }
  const exactProviderConfig = configuredProviders[provider];
  if (exactProviderConfig) {
    return exactProviderConfig;
  }
  return findNormalizedProviderValue(configuredProviders, provider);
}

function applyConfiguredProviderOverrides(params: {
  provider: string;
  discoveredModel: Model<Api>;
  providerConfig?: InlineProviderConfig;
  modelId: string;
}): Model<Api> {
  const { discoveredModel, providerConfig, modelId } = params;
  if (!providerConfig) {
    return {
      ...discoveredModel,
      // Discovered models originate from models.json and may contain persistence markers.
      headers: sanitizeModelHeaders(discoveredModel.headers, { stripSecretRefMarkers: true }),
    };
  }
  const configuredModel = providerConfig.models?.find((candidate) => candidate.id === modelId);
  const discoveredHeaders = sanitizeModelHeaders(discoveredModel.headers, {
    stripSecretRefMarkers: true,
  });
  const providerHeaders = sanitizeModelHeaders(providerConfig.headers, {
    stripSecretRefMarkers: true,
  });
  const configuredHeaders = sanitizeModelHeaders(configuredModel?.headers, {
    stripSecretRefMarkers: true,
  });
  if (!configuredModel && !providerConfig.baseUrl && !providerConfig.api && !providerHeaders) {
    return {
      ...discoveredModel,
      headers: discoveredHeaders,
    };
  }
  const resolvedInput = configuredModel?.input ?? discoveredModel.input;
  const normalizedInput =
    Array.isArray(resolvedInput) && resolvedInput.length > 0
      ? resolvedInput.filter((item) => item === "text" || item === "image")
      : (["text"] as Array<"text" | "image">);

  const resolvedTransport = resolveProviderTransport({
    api: configuredModel?.api ?? providerConfig.api ?? discoveredModel.api,
    baseUrl: providerConfig.baseUrl ?? discoveredModel.baseUrl,
  });
  const requestConfig = resolveProviderRequestConfig({
    provider: params.provider,
    api:
      resolvedTransport.api ??
      normalizeResolvedTransportApi(discoveredModel.api) ??
      "openai-responses",
    baseUrl: resolvedTransport.baseUrl ?? discoveredModel.baseUrl,
    discoveredHeaders,
    providerHeaders,
    modelHeaders: configuredHeaders,
    authHeader: providerConfig.authHeader,
    capability: "llm",
    transport: "stream",
  });
  return {
    ...discoveredModel,
    api: requestConfig.api ?? "openai-responses",
    baseUrl: requestConfig.baseUrl ?? discoveredModel.baseUrl,
    reasoning: configuredModel?.reasoning ?? discoveredModel.reasoning,
    input: normalizedInput,
    cost: configuredModel?.cost ?? discoveredModel.cost,
    contextWindow: configuredModel?.contextWindow ?? discoveredModel.contextWindow,
    maxTokens: configuredModel?.maxTokens ?? discoveredModel.maxTokens,
    headers: requestConfig.headers,
    compat: configuredModel?.compat ?? discoveredModel.compat,
  };
}

export function buildInlineProviderModels(
  providers: Record<string, InlineProviderConfig>,
): InlineModelEntry[] {
  return Object.entries(providers).flatMap(([providerId, entry]) => {
    const trimmed = providerId.trim();
    if (!trimmed) {
      return [];
    }
    const providerHeaders = sanitizeModelHeaders(entry?.headers, {
      stripSecretRefMarkers: true,
    });
    return (entry?.models ?? []).map((model) => {
      const transport = resolveProviderTransport({
        api: model.api ?? entry?.api,
        baseUrl: entry?.baseUrl,
      });
      const modelHeaders = sanitizeModelHeaders((model as InlineModelEntry).headers, {
        stripSecretRefMarkers: true,
      });
      const requestConfig = resolveProviderRequestConfig({
        provider: trimmed,
        api: transport.api ?? model.api,
        baseUrl: transport.baseUrl,
        providerHeaders,
        modelHeaders,
        authHeader: entry?.authHeader,
        capability: "llm",
        transport: "stream",
      });
      return {
        ...model,
        provider: trimmed,
        baseUrl: requestConfig.baseUrl,
        api: requestConfig.api ?? model.api,
        headers: requestConfig.headers,
      };
    });
  });
}

function resolveExplicitModelWithRegistry(params: {
  provider: string;
  modelId: string;
  modelRegistry: ModelRegistry;
  cfg?: CrawClawConfig;
}): { kind: "resolved"; model: Model<Api> } | { kind: "suppressed" } | undefined {
  const { provider, modelId, modelRegistry, cfg } = params;
  if (shouldSuppressBuiltInModel({ provider, id: modelId })) {
    return { kind: "suppressed" };
  }
  const providerConfig = resolveConfiguredProviderConfig(cfg, provider);
  const inlineMatch = findInlineModelMatch({
    providers: cfg?.models?.providers ?? {},
    provider,
    modelId,
  });
  if (inlineMatch?.api) {
    return {
      kind: "resolved",
      model: normalizeResolvedModel({
        provider,
        model: inlineMatch as Model<Api>,
      }),
    };
  }
  const model = modelRegistry.find(provider, modelId) as Model<Api> | null;

  if (model) {
    return {
      kind: "resolved",
      model: normalizeResolvedModel({
        provider,
        model: applyConfiguredProviderOverrides({
          provider,
          discoveredModel: model,
          providerConfig,
          modelId,
        }),
      }),
    };
  }

  const providers = cfg?.models?.providers ?? {};
  const fallbackInlineMatch = findInlineModelMatch({
    providers,
    provider,
    modelId,
  });
  if (fallbackInlineMatch?.api) {
    return {
      kind: "resolved",
      model: normalizeResolvedModel({
        provider,
        model: fallbackInlineMatch as Model<Api>,
      }),
    };
  }

  return undefined;
}

function resolveConfiguredFallbackModel(params: {
  provider: string;
  modelId: string;
  cfg?: CrawClawConfig;
}): Model<Api> | undefined {
  const { provider, modelId, cfg } = params;
  const providerConfig = resolveConfiguredProviderConfig(cfg, provider);
  const configuredModel = providerConfig?.models?.find((candidate) => candidate.id === modelId);
  const providerHeaders = sanitizeModelHeaders(providerConfig?.headers, {
    stripSecretRefMarkers: true,
  });
  const modelHeaders = sanitizeModelHeaders(configuredModel?.headers, {
    stripSecretRefMarkers: true,
  });
  if (!providerConfig && !modelId.startsWith("mock-")) {
    return undefined;
  }
  const fallbackTransport = resolveProviderTransport({
    api: providerConfig?.api ?? "openai-responses",
    baseUrl: providerConfig?.baseUrl,
  });
  const requestConfig = resolveProviderRequestConfig({
    provider,
    api: fallbackTransport.api ?? "openai-responses",
    baseUrl: fallbackTransport.baseUrl,
    providerHeaders,
    modelHeaders,
    authHeader: providerConfig?.authHeader,
    capability: "llm",
    transport: "stream",
  });
  return normalizeResolvedModel({
    provider,
    model: {
      id: modelId,
      name: modelId,
      api: requestConfig.api ?? "openai-responses",
      provider,
      baseUrl: requestConfig.baseUrl,
      reasoning: configuredModel?.reasoning ?? false,
      input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow:
        configuredModel?.contextWindow ??
        providerConfig?.models?.[0]?.contextWindow ??
        DEFAULT_CONTEXT_TOKENS,
      maxTokens:
        configuredModel?.maxTokens ??
        providerConfig?.models?.[0]?.maxTokens ??
        DEFAULT_CONTEXT_TOKENS,
      headers: requestConfig.headers,
    } as Model<Api>,
  });
}

export function resolveModelWithRegistry(params: {
  provider: string;
  modelId: string;
  modelRegistry: ModelRegistry;
  cfg?: CrawClawConfig;
}): Model<Api> | undefined {
  const explicitModel = resolveExplicitModelWithRegistry(params);
  if (explicitModel?.kind === "suppressed") {
    return undefined;
  }
  if (explicitModel?.kind === "resolved") {
    return explicitModel.model;
  }

  return resolveConfiguredFallbackModel(params);
}

export function resolveModel(
  provider: string,
  modelId: string,
  agentDir?: string,
  cfg?: CrawClawConfig,
  options?: {
    authStorage?: AuthStorage;
    modelRegistry?: ModelRegistry;
  },
): {
  model?: Model<Api>;
  error?: string;
  authStorage: AuthStorage;
  modelRegistry: ModelRegistry;
} {
  const resolvedAgentDir = agentDir ?? resolveCrawClawAgentDir();
  const authStorage = options?.authStorage ?? discoverAuthStorage(resolvedAgentDir);
  const modelRegistry =
    options?.modelRegistry ?? discoverModels(authStorage as never, resolvedAgentDir);
  const model = resolveModelWithRegistry({
    provider,
    modelId,
    modelRegistry,
    cfg,
  });
  if (model) {
    return { model, authStorage, modelRegistry };
  }

  return {
    error: buildUnknownModelError({
      provider,
      modelId,
    }),
    authStorage,
    modelRegistry,
  };
}

export async function resolveModelAsync(
  provider: string,
  modelId: string,
  agentDir?: string,
  cfg?: CrawClawConfig,
  options?: {
    authStorage?: AuthStorage;
    modelRegistry?: ModelRegistry;
  },
): Promise<{
  model?: Model<Api>;
  error?: string;
  authStorage: AuthStorage;
  modelRegistry: ModelRegistry;
}> {
  const resolvedAgentDir = agentDir ?? resolveCrawClawAgentDir();
  const authStorage = options?.authStorage ?? discoverAuthStorage(resolvedAgentDir);
  const modelRegistry =
    options?.modelRegistry ?? discoverModels(authStorage as never, resolvedAgentDir);
  const explicitModel = resolveExplicitModelWithRegistry({
    provider,
    modelId,
    modelRegistry,
    cfg,
  });
  if (explicitModel?.kind === "suppressed") {
    return {
      error: buildUnknownModelError({
        provider,
        modelId,
      }),
      authStorage,
      modelRegistry,
    };
  }
  const model =
    explicitModel?.kind === "resolved"
      ? explicitModel.model
      : resolveModelWithRegistry({
          provider,
          modelId,
          modelRegistry,
          cfg,
        });
  if (model) {
    return { model, authStorage, modelRegistry };
  }

  return {
    error: buildUnknownModelError({
      provider,
      modelId,
    }),
    authStorage,
    modelRegistry,
  };
}

/**
 * Build a more helpful error when the model is not found.
 *
 * Provider-specific suppression messages are resolved from Rust-owned provider
 * metadata before falling back to the generic unknown-model text.
 */
function buildUnknownModelError(params: { provider: string; modelId: string }): string {
  const suppressed = buildSuppressedBuiltInModelError({
    provider: params.provider,
    id: params.modelId,
  });
  if (suppressed) {
    return suppressed;
  }
  const base = `Unknown model: ${params.provider}/${params.modelId}`;
  return base;
}
