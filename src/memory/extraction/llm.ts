import type { LlmConfig } from "../types/config.ts";

export type CompleteFn = (system: string, user: string) => Promise<string>;
export type CompleteRoute = {
  api: NonNullable<LlmConfig["api"]>;
  apiKey: string;
  baseURL: string;
  model: string;
  headers?: Record<string, string | null>;
};

function extractTextContent(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content)) {
    return "";
  }
  return content
    .map((item) => {
      if (typeof item === "string") {
        return item;
      }
      if (!item || typeof item !== "object") {
        return "";
      }
      const text = item.text;
      return typeof text === "string" ? text : "";
    })
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
      continue;
    }
    merged.set(key, { name, value });
  }

  return Object.fromEntries([...merged.values()].map((entry) => [entry.name, entry.value]));
}

type OpenAiResponsesContent = {
  text?: unknown;
  output_text?: unknown;
};

type OpenAiResponsesItem = {
  content?: unknown;
};

type OpenAiResponsesPayload = {
  output_text?: unknown;
  output?: unknown;
};

function extractOpenAiResponsesText(data: unknown): string {
  const payload = data && typeof data === "object" ? (data as OpenAiResponsesPayload) : {};
  if (typeof payload.output_text === "string" && payload.output_text.length > 0) {
    return payload.output_text;
  }

  if (!Array.isArray(payload.output)) {
    return "";
  }

  return payload.output
    .flatMap((item) => {
      const record = item && typeof item === "object" ? (item as OpenAiResponsesItem) : {};
      return Array.isArray(record.content) ? record.content : [];
    })
    .map((content) => {
      const record =
        content && typeof content === "object" ? (content as OpenAiResponsesContent) : {};
      if (typeof record.text === "string") {
        return record.text;
      }
      if (typeof record.output_text === "string") {
        return record.output_text;
      }
      return "";
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
                messages: [
                  {
                    role: "user",
                    content: [{ type: "text", text: user }],
                  },
                ],
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
    if (route.api === "anthropic-messages") {
      return extractTextContent(data.content);
    }
    if (
      route.api === "openai-responses" ||
      route.api === "openai-codex-responses" ||
      route.api === "azure-openai-responses"
    ) {
      return extractOpenAiResponsesText(data);
    }
    return data.choices?.[0]?.message?.content ?? "";
  } finally {
    clearTimeout(timer);
  }
}

export function createResolvedRouteCompleteFn(
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

export function createCompleteFn(defaultModel: string, llmConfig?: LlmConfig): CompleteFn {
  return async (system, user) => {
    if (llmConfig?.apiKey && llmConfig?.baseURL) {
      return await completeWithResolvedRoute(system, user, {
        api: llmConfig.api ?? "openai-completions",
        apiKey: llmConfig.apiKey,
        baseURL: llmConfig.baseURL,
        model: llmConfig.model ?? defaultModel,
      });
    }
    throw new Error(
      "[memory] No LLM configured. Set llm provider/auth or llm.apiKey + llm.baseURL.",
    );
  };
}
