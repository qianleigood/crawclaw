import type { CrawClawConfig } from "crawclaw/plugin-sdk/provider-auth";
import { normalizeOptionalSecretInput } from "crawclaw/plugin-sdk/provider-auth";
import { resolveEnvApiKey } from "crawclaw/plugin-sdk/provider-auth-runtime";
import {
  hasConfiguredSecretInput,
  normalizeResolvedSecretInputString,
} from "crawclaw/plugin-sdk/secret-input";
import {
  fetchWithSsrFGuard,
  formatErrorMessage,
  type SsrFPolicy,
} from "crawclaw/plugin-sdk/ssrf-runtime";
import { resolveOllamaApiBase } from "./provider-models.js";

export type OllamaEmbeddingProvider = {
  id: string;
  model: string;
  maxInputTokens?: number;
  embedQuery: (text: string) => Promise<number[]>;
  embedBatch: (texts: string[]) => Promise<number[][]>;
};

type OllamaEmbeddingOptions = {
  config: CrawClawConfig;
  agentDir?: string;
  provider?: string;
  remote?: {
    baseUrl?: string;
    headers?: Record<string, string>;
  };
  providerApiKey?: string;
  model: string;
  fallback?: string;
  local?: unknown;
  outputDimensionality?: number;
  taskType?: unknown;
};

export type OllamaEmbeddingClient = {
  baseUrl: string;
  headers: Record<string, string>;
  ssrfPolicy?: SsrFPolicy;
  model: string;
  embedBatch: (texts: string[]) => Promise<number[][]>;
};

type OllamaEmbeddingClientConfig = Omit<OllamaEmbeddingClient, "embedBatch">;
type OllamaTagsResponse = {
  models?: Array<{ name?: string }>;
};
type OllamaPullChunk = {
  error?: string;
};

export const DEFAULT_OLLAMA_EMBEDDING_MODEL = "nomic-embed-text";

function sanitizeAndNormalizeEmbedding(vec: number[]): number[] {
  const sanitized = vec.map((value) => (Number.isFinite(value) ? value : 0));
  const magnitude = Math.sqrt(sanitized.reduce((sum, value) => sum + value * value, 0));
  if (magnitude < 1e-10) {
    return sanitized;
  }
  return sanitized.map((value) => value / magnitude);
}

function buildRemoteBaseUrlPolicy(baseUrl: string): SsrFPolicy | undefined {
  const trimmed = baseUrl.trim();
  if (!trimmed) {
    return undefined;
  }
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return undefined;
    }
    return { allowedHostnames: [parsed.hostname] };
  } catch {
    return undefined;
  }
}

async function withRemoteHttpResponse<T>(params: {
  url: string;
  init?: RequestInit;
  ssrfPolicy?: SsrFPolicy;
  onResponse: (response: Response) => Promise<T>;
}): Promise<T> {
  const { response, release } = await fetchWithSsrFGuard({
    url: params.url,
    init: params.init,
    policy: params.ssrfPolicy,
    auditContext: "memory-remote",
  });
  try {
    return await params.onResponse(response);
  } finally {
    await release();
  }
}

function normalizeEmbeddingModel(model: string): string {
  const trimmed = model.trim();
  if (!trimmed) {
    return DEFAULT_OLLAMA_EMBEDDING_MODEL;
  }
  return trimmed.startsWith("ollama/") ? trimmed.slice("ollama/".length) : trimmed;
}

function isOllamaCloudModel(model: string): boolean {
  return model.trim().toLowerCase().endsWith(":cloud");
}

function isOllamaModelAvailable(configuredModel: string, availableModel: string | undefined) {
  if (!availableModel) {
    return false;
  }
  if (availableModel === configuredModel) {
    return true;
  }
  return !configuredModel.includes(":") && availableModel === `${configuredModel}:latest`;
}

async function parsePullResponse(response: Response, model: string): Promise<void> {
  const text = await response.text();
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    try {
      const chunk = JSON.parse(trimmed) as OllamaPullChunk;
      if (chunk.error) {
        throw new Error(`Download failed: ${chunk.error}`);
      }
    } catch (err) {
      if (err instanceof Error && err.message.startsWith("Download failed:")) {
        throw err;
      }
      // Ignore malformed progress lines from Ollama.
    }
  }
  if (!text.trim()) {
    throw new Error(`Failed to download ${model} (empty response body)`);
  }
}

function resolveOllamaApiKey(options: OllamaEmbeddingOptions): string | undefined {
  if (options.providerApiKey) {
    return options.providerApiKey;
  }
  const configuredProviderApiKey = options.config.models?.providers?.ollama?.apiKey;
  const providerApiKey = hasConfiguredSecretInput(configuredProviderApiKey)
    ? normalizeResolvedSecretInputString({
        value: configuredProviderApiKey,
        path: "models.providers.ollama.apiKey",
      })
    : normalizeOptionalSecretInput(configuredProviderApiKey);
  if (providerApiKey) {
    return providerApiKey;
  }
  return resolveEnvApiKey("ollama")?.apiKey;
}

function resolveOllamaEmbeddingClient(
  options: OllamaEmbeddingOptions,
): OllamaEmbeddingClientConfig {
  const providerConfig = options.config.models?.providers?.ollama;
  const rawBaseUrl = options.remote?.baseUrl?.trim() || providerConfig?.baseUrl?.trim();
  const baseUrl = resolveOllamaApiBase(rawBaseUrl);
  const model = normalizeEmbeddingModel(options.model);
  const headerOverrides = Object.assign({}, providerConfig?.headers, options.remote?.headers);
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...headerOverrides,
  };
  const apiKey = resolveOllamaApiKey(options);
  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }
  return {
    baseUrl,
    headers,
    ssrfPolicy: buildRemoteBaseUrlPolicy(baseUrl),
    model,
  };
}

export async function createOllamaEmbeddingProvider(
  options: OllamaEmbeddingOptions,
): Promise<{ provider: OllamaEmbeddingProvider; client: OllamaEmbeddingClient }> {
  const client = resolveOllamaEmbeddingClient(options);
  const baseUrl = client.baseUrl.replace(/\/$/, "");
  const tagsUrl = `${baseUrl}/api/tags`;
  const pullUrl = `${baseUrl}/api/pull`;
  const embedUrl = `${baseUrl}/api/embeddings`;
  let modelReadyPromise: Promise<void> | null = null;

  const ensureModelReady = async (): Promise<void> => {
    if (isOllamaCloudModel(client.model)) {
      return;
    }
    modelReadyPromise ??= (async () => {
      const tags = await withRemoteHttpResponse({
        url: tagsUrl,
        ssrfPolicy: client.ssrfPolicy,
        init: { headers: client.headers },
        onResponse: async (response) => {
          if (!response.ok) {
            throw new Error(`Ollama tags HTTP ${response.status}: ${await response.text()}`);
          }
          return (await response.json()) as OllamaTagsResponse;
        },
      });
      if ((tags.models ?? []).some((model) => isOllamaModelAvailable(client.model, model.name))) {
        return;
      }
      await withRemoteHttpResponse({
        url: pullUrl,
        ssrfPolicy: client.ssrfPolicy,
        init: {
          method: "POST",
          headers: client.headers,
          body: JSON.stringify({ name: client.model }),
        },
        onResponse: async (response) => {
          if (!response.ok) {
            throw new Error(`Failed to download ${client.model} (HTTP ${response.status})`);
          }
          await parsePullResponse(response, client.model);
        },
      });
    })().catch((err) => {
      modelReadyPromise = null;
      throw err;
    });
    await modelReadyPromise;
  };

  const embedOne = async (text: string): Promise<number[]> => {
    await ensureModelReady();
    const json = await withRemoteHttpResponse({
      url: embedUrl,
      ssrfPolicy: client.ssrfPolicy,
      init: {
        method: "POST",
        headers: client.headers,
        body: JSON.stringify({ model: client.model, prompt: text }),
      },
      onResponse: async (response) => {
        if (!response.ok) {
          throw new Error(`Ollama embeddings HTTP ${response.status}: ${await response.text()}`);
        }
        return (await response.json()) as { embedding?: number[] };
      },
    });
    if (!Array.isArray(json.embedding)) {
      throw new Error("Ollama embeddings response missing embedding[]");
    }
    return sanitizeAndNormalizeEmbedding(json.embedding);
  };

  const provider: OllamaEmbeddingProvider = {
    id: "ollama",
    model: client.model,
    embedQuery: embedOne,
    embedBatch: async (texts) => {
      return await Promise.all(texts.map(embedOne));
    },
  };

  return {
    provider,
    client: {
      ...client,
      embedBatch: async (texts) => {
        try {
          return await provider.embedBatch(texts);
        } catch (err) {
          throw new Error(formatErrorMessage(err), { cause: err });
        }
      },
    },
  };
}
