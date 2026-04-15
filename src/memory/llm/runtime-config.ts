import type { CrawClawPluginApi } from "crawclaw/plugin-sdk";
import type { LlmConfig } from "../types/config.ts";

type ConfigRecord = Record<string, unknown>;

function asConfigRecord(value: unknown): ConfigRecord {
  return value && typeof value === "object" ? (value as ConfigRecord) : {};
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function readApi(value: unknown): LlmConfig["api"] | undefined {
  return value === "openai-completions" ||
    value === "openai-responses" ||
    value === "openai-codex-responses" ||
    value === "azure-openai-responses" ||
    value === "anthropic-messages"
    ? value
    : undefined;
}

function splitModelRef(model?: string | null): { provider?: string; model?: string } {
  const raw = typeof model === "string" ? model.trim() : "";
  if (!raw) {
    return {};
  }
  if (!raw.includes("/")) {
    return { model: raw };
  }
  const [provider, modelId] = raw.split("/", 2);
  return {
    provider: provider?.trim() || undefined,
    model: modelId?.trim() || undefined,
  };
}

function pickProviderConfig(cfg: unknown, provider?: string): ConfigRecord | undefined {
  if (!provider) {
    return undefined;
  }
  const models = asConfigRecord(asConfigRecord(cfg).models);
  const providers = asConfigRecord(models.providers);
  return asConfigRecord(providers[provider]);
}

function pickPrimaryModelRef(cfg: unknown): string | undefined {
  const config = asConfigRecord(cfg);
  const agents = asConfigRecord(config.agents);
  const defaults = asConfigRecord(agents.defaults);
  const modelDefaults = asConfigRecord(defaults.model);
  const primary = readString(modelDefaults.primary);
  if (primary) {
    return primary;
  }
  const list = Array.isArray(agents.list) ? agents.list : [];
  const defaultAgent = list.find((agent) => asConfigRecord(agent).default === true);
  return readString(asConfigRecord(defaultAgent).model);
}

export async function resolveRuntimeLlmConfig(
  runtime: CrawClawPluginApi["runtime"],
  llmConfig?: LlmConfig,
): Promise<LlmConfig | undefined> {
  if (llmConfig?.apiKey && llmConfig?.baseURL) {
    return {
      ...llmConfig,
      authSource: llmConfig.authSource ?? "plugin-config",
    };
  }

  const cfg = runtime.config.loadConfig();
  const requested = llmConfig ?? {};
  const requestedRef = splitModelRef(requested.model);
  const fallbackRef = splitModelRef(pickPrimaryModelRef(cfg));

  const provider = requested.provider ?? requestedRef.provider ?? fallbackRef.provider;
  const model = requestedRef.model ?? requested.model ?? fallbackRef.model;
  const providerConfig = pickProviderConfig(cfg, provider);
  const api = requested.api ?? readApi(providerConfig?.api) ?? "openai-completions";
  const baseURL = requested.baseURL ?? readString(providerConfig?.baseUrl) ?? undefined;

  let apiKey = requested.apiKey;
  let authSource = requested.authSource;
  if (!apiKey && provider) {
    const resolved = await runtime.modelAuth.resolveApiKeyForProvider({ provider, cfg });
    apiKey = resolved.apiKey;
    authSource = resolved.source;
  }

  if (!model && !baseURL && !apiKey && !provider) {
    return undefined;
  }

  return {
    provider,
    api,
    apiKey,
    baseURL,
    model,
    authSource,
  };
}
