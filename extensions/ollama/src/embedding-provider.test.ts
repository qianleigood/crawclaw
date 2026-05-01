import { afterEach, describe, expect, it, vi } from "vitest";
import { createOllamaEmbeddingProvider } from "./embedding-provider.js";

const fetchWithSsrFGuardMock = vi.hoisted(() =>
  vi.fn(async (params: { url: string; init?: RequestInit }) => ({
    response: await fetch(params.url, params.init),
    finalUrl: params.url,
    release: vi.fn(async () => {}),
  })),
);

vi.mock("crawclaw/plugin-sdk/ssrf-runtime", () => ({
  fetchWithSsrFGuard: fetchWithSsrFGuardMock,
  formatErrorMessage: (err: unknown) => (err instanceof Error ? err.message : String(err)),
}));

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function requestUrl(input: string | URL | Request): string {
  if (typeof input === "string") {
    return input;
  }
  if (input instanceof URL) {
    return input.toString();
  }
  return input.url;
}

function requestBodyText(body: BodyInit | null | undefined): string {
  return typeof body === "string" ? body : "{}";
}

describe("ollama embedding provider", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    fetchWithSsrFGuardMock.mockClear();
  });

  it("pulls a missing embedding model before embedding", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = requestUrl(input);
      if (url.endsWith("/api/tags")) {
        return jsonResponse({ models: [] });
      }
      if (url.endsWith("/api/pull")) {
        return new Response('{"status":"success"}\n', { status: 200 });
      }
      if (url.endsWith("/api/embeddings")) {
        return jsonResponse({ embedding: [3, 4] });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const { provider } = await createOllamaEmbeddingProvider({
      config: {
        models: {
          providers: {
            ollama: {
              baseUrl: "http://127.0.0.1:11434",
              apiKey: "ollama-local",
              models: [],
            },
          },
        },
      },
      model: "qwen3-embedding:0.6b",
    });

    await expect(provider.embedQuery("skill discovery")).resolves.toEqual([0.6, 0.8]);

    expect(fetchMock.mock.calls.map((call) => requestUrl(call[0]))).toEqual([
      "http://127.0.0.1:11434/api/tags",
      "http://127.0.0.1:11434/api/pull",
      "http://127.0.0.1:11434/api/embeddings",
    ]);
    expect(JSON.parse(requestBodyText(fetchMock.mock.calls[1]?.[1]?.body))).toEqual({
      name: "qwen3-embedding:0.6b",
    });
  });

  it("does not pull when the model is already present as latest", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = requestUrl(input);
      if (url.endsWith("/api/tags")) {
        return jsonResponse({ models: [{ name: "nomic-embed-text:latest" }] });
      }
      if (url.endsWith("/api/embeddings")) {
        return jsonResponse({ embedding: [1, 0] });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const { provider } = await createOllamaEmbeddingProvider({
      config: {
        models: {
          providers: {
            ollama: {
              baseUrl: "http://127.0.0.1:11434",
              apiKey: "ollama-local",
              models: [],
            },
          },
        },
      },
      model: "nomic-embed-text",
    });

    await expect(provider.embedQuery("skill discovery")).resolves.toEqual([1, 0]);

    expect(fetchMock.mock.calls.map((call) => requestUrl(call[0]))).toEqual([
      "http://127.0.0.1:11434/api/tags",
      "http://127.0.0.1:11434/api/embeddings",
    ]);
  });
});
