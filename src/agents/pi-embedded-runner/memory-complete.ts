import type { Api, Model } from "@mariozechner/pi-ai";
import type { AuthStorage } from "@mariozechner/pi-coding-agent";
import type { CrawClawConfig } from "../../config/config.js";
import {
  applyAuthHeaderOverride,
  applyLocalNoAuthHeaderOverride,
  type ResolvedProviderAuth,
} from "../model-auth.js";
import {
  createResolvedRouteCompleteFn,
  type CompleteFn,
  type CompleteRoute,
} from "../../memory/extraction/llm.js";

type SupportedMemoryApi = CompleteRoute["api"];

function resolveSupportedMemoryApi(api: unknown): SupportedMemoryApi | undefined {
  switch (api) {
    case "anthropic-messages":
    case "openai-completions":
    case "openai-responses":
    case "openai-codex-responses":
    case "azure-openai-responses":
      return api;
    default:
      return undefined;
  }
}

function sanitizeRouteHeaders(headers: unknown): Record<string, string | null> | undefined {
  if (!headers || typeof headers !== "object" || Array.isArray(headers)) {
    return undefined;
  }

  const next: Record<string, string | null> = {};
  for (const [name, value] of Object.entries(headers)) {
    if (typeof value === "string" || value === null) {
      next[name] = value;
    }
  }

  return Object.keys(next).length > 0 ? next : undefined;
}

export function createEmbeddedMemoryCompleteFn(params: {
  defaultModel: string;
  config?: CrawClawConfig;
  getAuthStorage(): AuthStorage | Promise<AuthStorage>;
  getRuntimeModel(): Model<Api> | Promise<Model<Api>>;
}): CompleteFn {
  return createResolvedRouteCompleteFn(params.defaultModel, async () => {
    const [runtimeModel, authStorage] = await Promise.all([
      params.getRuntimeModel(),
      params.getAuthStorage(),
    ]);
    const api = resolveSupportedMemoryApi(runtimeModel.api);
    const provider = typeof runtimeModel.provider === "string" ? runtimeModel.provider.trim() : "";
    const baseURL = typeof runtimeModel.baseUrl === "string" ? runtimeModel.baseUrl.trim() : "";
    const model = typeof runtimeModel.id === "string" ? runtimeModel.id.trim() : "";

    if (!provider || !api || !baseURL) {
      throw new Error(
        `[memory] Durable extraction cannot reuse provider route for ${provider || "unknown"} (api=${String(runtimeModel.api ?? "unknown")}).`,
      );
    }

    const apiKey = await authStorage.getApiKey(provider, { includeFallback: true });
    if (!apiKey) {
      throw new Error(`[memory] No API key available for durable extraction provider "${provider}".`);
    }

    const runtimeAuth: ResolvedProviderAuth = {
      apiKey,
      source: "runtime-auth-storage",
      mode: "api-key",
    };
    const modelWithHeaders = applyAuthHeaderOverride(
      applyLocalNoAuthHeaderOverride(runtimeModel, runtimeAuth),
      runtimeAuth,
      params.config,
    );

    return {
      api,
      apiKey,
      baseURL,
      model: model || params.defaultModel,
      headers: sanitizeRouteHeaders(modelWithHeaders.headers),
    };
  });
}
