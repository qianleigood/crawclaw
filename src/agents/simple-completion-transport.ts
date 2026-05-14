import type { Api, Model } from "@mariozechner/pi-ai";
import type { CrawClawConfig } from "../config/config.js";
import { createAnthropicVertexStreamFnForModel } from "./anthropic-vertex-stream.js";
import { ensureCustomApiRegistered } from "./custom-api-registry.js";

function resolveAnthropicVertexSimpleApi(baseUrl?: string): Api {
  const suffix = baseUrl?.trim() ? encodeURIComponent(baseUrl.trim()) : "default";
  return `crawclaw-anthropic-vertex-simple:${suffix}`;
}

export function prepareModelForSimpleCompletion<TApi extends Api>(params: {
  model: Model<TApi>;
  cfg?: CrawClawConfig;
}): Model<Api> {
  const { model } = params;

  if (model.provider === "anthropic-vertex") {
    const api = resolveAnthropicVertexSimpleApi(model.baseUrl);
    ensureCustomApiRegistered(api, createAnthropicVertexStreamFnForModel(model));
    return { ...model, api };
  }

  return model;
}
