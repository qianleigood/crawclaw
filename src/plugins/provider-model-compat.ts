import type { Api, Model } from "@mariozechner/pi-ai";
import { resolveProviderRequestCapabilities } from "../agents/provider-attribution.js";
import type { ModelCompatConfig } from "../config/types.models.js";

const CRAWCLAW_MODEL_COMPAT_KEYS = [
  "supportsStore",
  "supportsDeveloperRole",
  "supportsReasoningEffort",
  "supportsUsageInStreaming",
  "supportsStrictMode",
  "maxTokensField",
  "requiresToolResultName",
  "requiresAssistantAfterToolResult",
  "requiresThinkingAsText",
  "thinkingFormat",
  "supportsTools",
  "toolSchemaProfile",
  "unsupportedToolSchemaKeywords",
  "nativeWebSearchTool",
  "toolCallArgumentsEncoding",
  "requiresMistralToolIds",
  "requiresOpenAiAnthropicToolPayload",
] as const satisfies readonly (keyof ModelCompatConfig)[];

export function coerceModelCompatConfig(value: unknown): ModelCompatConfig | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const compat: Record<string, unknown> = {};
  for (const key of CRAWCLAW_MODEL_COMPAT_KEYS) {
    if (key in record) {
      compat[key] = record[key];
    }
  }
  return Object.keys(compat).length > 0 ? (compat as ModelCompatConfig) : undefined;
}

function extractModelCompat(
  modelOrCompat: { compat?: unknown } | ModelCompatConfig | undefined,
): ModelCompatConfig | undefined {
  if (!modelOrCompat || typeof modelOrCompat !== "object") {
    return undefined;
  }
  if ("compat" in modelOrCompat) {
    return coerceModelCompatConfig((modelOrCompat as { compat?: unknown }).compat);
  }
  return coerceModelCompatConfig(modelOrCompat);
}

export function applyModelCompatPatch<T extends { compat?: ModelCompatConfig }>(
  model: T,
  patch: ModelCompatConfig,
): T {
  const nextCompat = { ...model.compat, ...patch };
  if (
    model.compat &&
    Object.entries(patch).every(
      ([key, value]) => model.compat?.[key as keyof ModelCompatConfig] === value,
    )
  ) {
    return model;
  }
  return {
    ...model,
    compat: nextCompat,
  };
}

export function hasToolSchemaProfile(
  modelOrCompat: { compat?: unknown } | ModelCompatConfig | undefined,
  profile: string,
): boolean {
  return extractModelCompat(modelOrCompat)?.toolSchemaProfile === profile;
}

export function hasNativeWebSearchTool(
  modelOrCompat: { compat?: unknown } | ModelCompatConfig | undefined,
): boolean {
  return extractModelCompat(modelOrCompat)?.nativeWebSearchTool === true;
}

export function resolveToolCallArgumentsEncoding(
  modelOrCompat: { compat?: unknown } | ModelCompatConfig | undefined,
): ModelCompatConfig["toolCallArgumentsEncoding"] | undefined {
  return extractModelCompat(modelOrCompat)?.toolCallArgumentsEncoding;
}

export function resolveUnsupportedToolSchemaKeywords(
  modelOrCompat: { compat?: unknown } | ModelCompatConfig | undefined,
): ReadonlySet<string> {
  const keywords = extractModelCompat(modelOrCompat)?.unsupportedToolSchemaKeywords ?? [];
  return new Set(
    keywords
      .filter((keyword): keyword is string => typeof keyword === "string")
      .map((keyword) => keyword.trim())
      .filter(Boolean),
  );
}

function isOpenAiCompletionsModel(model: Model<Api>): model is Model<"openai-completions"> {
  return model.api === "openai-completions";
}

function isAnthropicMessagesModel(model: Model<Api>): model is Model<"anthropic-messages"> {
  return model.api === "anthropic-messages";
}

function normalizeAnthropicBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/v1\/?$/, "");
}

export function normalizeModelCompat(model: Model<Api>): Model<Api> {
  const baseUrl = model.baseUrl ?? "";

  if (isAnthropicMessagesModel(model) && baseUrl) {
    const normalized = normalizeAnthropicBaseUrl(baseUrl);
    if (normalized !== baseUrl) {
      return { ...model, baseUrl: normalized } as Model<"anthropic-messages">;
    }
  }

  if (!isOpenAiCompletionsModel(model)) {
    return model;
  }

  const compat = model.compat ?? undefined;
  const needsForce = baseUrl
    ? resolveProviderRequestCapabilities({
        provider: typeof model.provider === "string" ? model.provider : undefined,
        api: model.api,
        baseUrl,
        capability: "llm",
        transport: "stream",
      }).endpointClass !== "openai-public"
    : false;
  if (!needsForce) {
    return model;
  }
  const forcedDeveloperRole = compat?.supportsDeveloperRole === true;
  const hasStreamingUsageOverride = compat?.supportsUsageInStreaming !== undefined;
  const targetStrictMode = compat?.supportsStrictMode ?? false;
  if (
    compat?.supportsDeveloperRole !== undefined &&
    hasStreamingUsageOverride &&
    compat?.supportsStrictMode !== undefined
  ) {
    return model;
  }

  return {
    ...model,
    compat: compat
      ? {
          ...compat,
          supportsDeveloperRole: forcedDeveloperRole || false,
          ...(hasStreamingUsageOverride ? {} : { supportsUsageInStreaming: false }),
          supportsStrictMode: targetStrictMode,
        }
      : {
          supportsDeveloperRole: false,
          supportsUsageInStreaming: false,
          supportsStrictMode: false,
        },
  } as typeof model;
}
