import type { Api, Model } from "@mariozechner/pi-ai";
import type { CrawClawConfig } from "../../config/config.js";
import {
  applyAuthHeaderOverride,
  applyLocalNoAuthHeaderOverride,
  type ResolvedProviderAuth,
} from "../model-auth.js";

type CompleteFn = (system: string, user: string) => Promise<string>;
type SupportedMemoryApi =
  | "anthropic-messages"
  | "openai-completions"
  | "openai-responses"
  | "openai-codex-responses"
  | "azure-openai-responses";
type CompleteRoute = {
  api: SupportedMemoryApi;
  apiKey: string;
  baseURL: string;
  model: string;
  headers?: Record<string, string | null>;
};
type ProviderAuthStorage = {
  getApiKey: (
    provider: string,
    options?: { includeFallback?: boolean },
  ) => string | undefined | Promise<string | undefined>;
};

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

function extractTextContent(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content)) {
    return "";
  }
  return content
    .map((item) =>
      typeof item === "string"
        ? item
        : item && typeof item === "object" && typeof item.text === "string"
          ? item.text
          : "",
    )
    .filter(Boolean)
    .join("\n");
}

function hasHeader(headers: Record<string, string | null> | undefined, name: string): boolean {
  const target = name.toLowerCase();
  return Object.keys(headers ?? {}).some((key) => key.toLowerCase() === target);
}

function mergeHeaders(
  defaults: Record<string, string>,
  overrides?: Record<string, string | null>,
): Record<string, string> {
  const merged = new Map<string, { name: string; value: string }>();
  for (const [name, value] of Object.entries(defaults)) {
    merged.set(name.toLowerCase(), { name, value });
  }
  for (const [name, value] of Object.entries(overrides ?? {})) {
    const key = name.toLowerCase();
    if (value === null) {
      merged.delete(key);
    } else {
      merged.set(key, { name, value });
    }
  }
  return Object.fromEntries([...merged.values()].map((entry) => [entry.name, entry.value]));
}

function extractOpenAiResponsesText(data: unknown): string {
  const payload = data && typeof data === "object" ? (data as Record<string, unknown>) : {};
  if (typeof payload.output_text === "string" && payload.output_text.length > 0) {
    return payload.output_text;
  }
  if (!Array.isArray(payload.output)) {
    return "";
  }
  return payload.output
    .flatMap((item) =>
      item && typeof item === "object" && Array.isArray((item as { content?: unknown }).content)
        ? (item as { content: unknown[] }).content
        : [],
    )
    .map((content) => {
      const record =
        content && typeof content === "object" ? (content as Record<string, unknown>) : {};
      return typeof record.text === "string"
        ? record.text
        : typeof record.output_text === "string"
          ? record.output_text
          : "";
    })
    .filter(Boolean)
    .join("\n");
}

async function completeWithResolvedRoute(
  system: string,
  user: string,
  route: CompleteRoute,
): Promise<string> {
  const baseURL = route.baseURL.replace(/\/+$/, "");
  const timeoutMs = Number(process.env.GM_NEO4J_LLM_TIMEOUT_MS || 45000);
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new Error(`LLM timeout after ${timeoutMs}ms`)),
    timeoutMs,
  );
  try {
    const request =
      route.api === "anthropic-messages"
        ? {
            url: `${baseURL}/v1/messages`,
            init: {
              method: "POST",
              headers: mergeHeaders(
                {
                  "Content-Type": "application/json",
                  ...(hasHeader(route.headers, "x-api-key") ||
                  hasHeader(route.headers, "authorization")
                    ? {}
                    : { "x-api-key": route.apiKey }),
                  ...(hasHeader(route.headers, "anthropic-version")
                    ? {}
                    : { "anthropic-version": "2023-06-01" }),
                },
                route.headers,
              ),
              body: JSON.stringify({
                model: route.model,
                system: system.trim() || undefined,
                messages: [{ role: "user", content: [{ type: "text", text: user }] }],
                max_tokens: 1024,
                temperature: 0.1,
              }),
              signal: controller.signal,
            } satisfies RequestInit,
          }
        : route.api === "openai-responses" ||
            route.api === "openai-codex-responses" ||
            route.api === "azure-openai-responses"
          ? {
              url: `${baseURL}/responses`,
              init: {
                method: "POST",
                headers: mergeHeaders(
                  {
                    "Content-Type": "application/json",
                    ...(hasHeader(route.headers, "authorization")
                      ? {}
                      : { Authorization: `Bearer ${route.apiKey}` }),
                  },
                  route.headers,
                ),
                body: JSON.stringify({
                  model: route.model,
                  input: [
                    ...(system.trim()
                      ? [{ role: "system", content: [{ type: "input_text", text: system.trim() }] }]
                      : []),
                    { role: "user", content: [{ type: "input_text", text: user }] },
                  ],
                  temperature: 0.1,
                }),
                signal: controller.signal,
              } satisfies RequestInit,
            }
          : {
              url: `${baseURL}/chat/completions`,
              init: {
                method: "POST",
                headers: mergeHeaders(
                  {
                    "Content-Type": "application/json",
                    ...(hasHeader(route.headers, "authorization")
                      ? {}
                      : { Authorization: `Bearer ${route.apiKey}` }),
                  },
                  route.headers,
                ),
                body: JSON.stringify({
                  model: route.model,
                  messages: [
                    ...(system.trim() ? [{ role: "system", content: system.trim() }] : []),
                    { role: "user", content: user },
                  ],
                  temperature: 0.1,
                }),
                signal: controller.signal,
              } satisfies RequestInit,
            };
    const res = await fetch(request.url, request.init);
    const rawText = await res.text().catch(() => "");
    if (!res.ok) {
      throw new Error(`[memory] LLM API ${res.status}: ${rawText.slice(0, 200)}`);
    }
    const data = rawText ? JSON.parse(rawText) : {};
    return route.api === "anthropic-messages"
      ? extractTextContent(data.content)
      : route.api === "openai-responses" ||
          route.api === "openai-codex-responses" ||
          route.api === "azure-openai-responses"
        ? extractOpenAiResponsesText(data)
        : (data.choices?.[0]?.message?.content ?? "");
  } finally {
    clearTimeout(timer);
  }
}

function createResolvedRouteCompleteFn(
  defaultModel: string,
  resolveRoute: () => Promise<CompleteRoute>,
): CompleteFn {
  return async (system, user) => {
    const route = await resolveRoute();
    return await completeWithResolvedRoute(system, user, {
      ...route,
      model: route.model || defaultModel,
    });
  };
}

export function createRuntimeMemoryCompleteFn(params: {
  defaultModel: string;
  config?: CrawClawConfig;
  getAuthStorage(): ProviderAuthStorage | Promise<ProviderAuthStorage>;
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
      throw new Error(
        `[memory] No API key available for durable extraction provider "${provider}".`,
      );
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
