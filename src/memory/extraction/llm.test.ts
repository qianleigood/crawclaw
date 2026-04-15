import { afterEach, describe, expect, it, vi } from "vitest";
import { createResolvedRouteCompleteFn } from "./llm.ts";

describe("createResolvedRouteCompleteFn", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("reads text from the OpenAI responses API output_text field", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({ output_text: "{\"notes\":[],\"reason\":\"ok\"}" }),
    });
    global.fetch = fetchMock as typeof fetch;
    const complete = createResolvedRouteCompleteFn("gpt-5.4", async () => ({
      api: "openai-responses",
      apiKey: "test-key",
      baseURL: "https://example.com/v1",
      model: "gpt-5.4",
    }));

    const result = await complete("system", "user");

    expect(result).toBe("{\"notes\":[],\"reason\":\"ok\"}");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://example.com/v1/responses",
      expect.objectContaining({
        method: "POST",
      }),
    );
  });

  it("honors explicit null auth headers when the caller needs to suppress Authorization", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({ choices: [{ message: { content: "{\"notes\":[]}" } }] }),
    });
    global.fetch = fetchMock as typeof fetch;
    const complete = createResolvedRouteCompleteFn("gpt-5.4", async () => ({
      api: "openai-completions",
      apiKey: "synthetic-local-key",
      baseURL: "http://localhost:1234/v1",
      model: "local-model",
      headers: {
        Authorization: null,
      },
    }));

    await complete("system", "user");

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.headers).toEqual({
      "Content-Type": "application/json",
    });
  });

  it("uses /v1/messages for anthropic-compatible routes", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({ content: [{ text: "{\"notes\":[],\"reason\":\"ok\"}" }] }),
    });
    global.fetch = fetchMock as typeof fetch;
    const complete = createResolvedRouteCompleteFn("claude", async () => ({
      api: "anthropic-messages",
      apiKey: "test-key",
      baseURL: "https://api.minimaxi.com/anthropic",
      model: "MiniMax-M2.7",
    }));

    await complete("system", "user");

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.minimaxi.com/anthropic/v1/messages",
      expect.objectContaining({
        method: "POST",
      }),
    );
  });
});
