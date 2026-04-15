import {
  applyProviderConfigWithModelCatalogPreset,
  type CrawClawConfig,
} from "crawclaw/plugin-sdk/provider-onboard";
import {
  buildZaiModelDefinition,
  resolveZaiBaseUrl,
  ZAI_DEFAULT_MODEL_ID,
} from "./model-definitions.js";

export const ZAI_DEFAULT_MODEL_REF = `zai/${ZAI_DEFAULT_MODEL_ID}`;

const ZAI_DEFAULT_MODELS = [
  buildZaiModelDefinition({ id: "glm-5.1" }),
  buildZaiModelDefinition({ id: "glm-5" }),
  buildZaiModelDefinition({ id: "glm-5-turbo" }),
  buildZaiModelDefinition({ id: "glm-5v-turbo" }),
  buildZaiModelDefinition({ id: "glm-4.7" }),
  buildZaiModelDefinition({ id: "glm-4.7-flash" }),
  buildZaiModelDefinition({ id: "glm-4.7-flashx" }),
  buildZaiModelDefinition({ id: "glm-4.6" }),
  buildZaiModelDefinition({ id: "glm-4.6v" }),
  buildZaiModelDefinition({ id: "glm-4.5" }),
  buildZaiModelDefinition({ id: "glm-4.5-air" }),
  buildZaiModelDefinition({ id: "glm-4.5-flash" }),
  buildZaiModelDefinition({ id: "glm-4.5v" }),
];

function resolveZaiPresetBaseUrl(cfg: CrawClawConfig, endpoint?: string): string {
  const existingProvider = cfg.models?.providers?.zai;
  const existingBaseUrl =
    typeof existingProvider?.baseUrl === "string" ? existingProvider.baseUrl.trim() : "";
  return endpoint ? resolveZaiBaseUrl(endpoint) : existingBaseUrl || resolveZaiBaseUrl();
}

function applyZaiPreset(
  cfg: CrawClawConfig,
  params?: { endpoint?: string; modelId?: string },
  primaryModelRef?: string,
): CrawClawConfig {
  const modelId = params?.modelId?.trim() || ZAI_DEFAULT_MODEL_ID;
  const modelRef = `zai/${modelId}`;
  return applyProviderConfigWithModelCatalogPreset(cfg, {
    providerId: "zai",
    api: "openai-completions",
    baseUrl: resolveZaiPresetBaseUrl(cfg, params?.endpoint),
    catalogModels: ZAI_DEFAULT_MODELS,
    aliases: [{ modelRef, alias: "GLM" }],
    primaryModelRef,
  });
}

export function applyZaiProviderConfig(
  cfg: CrawClawConfig,
  params?: { endpoint?: string; modelId?: string },
): CrawClawConfig {
  return applyZaiPreset(cfg, params);
}

export function applyZaiConfig(
  cfg: CrawClawConfig,
  params?: { endpoint?: string; modelId?: string },
): CrawClawConfig {
  const modelId = params?.modelId?.trim() || ZAI_DEFAULT_MODEL_ID;
  const modelRef = modelId === ZAI_DEFAULT_MODEL_ID ? ZAI_DEFAULT_MODEL_REF : `zai/${modelId}`;
  return applyZaiPreset(cfg, params, modelRef);
}
