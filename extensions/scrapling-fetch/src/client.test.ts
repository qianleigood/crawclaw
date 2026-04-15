import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ScraplingFetchClient,
  ScraplingFetchError,
  ScraplingFetchUnavailableError,
} from "./client.js";

describe("ScraplingFetchClient", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    vi.restoreAllMocks();
    globalThis.fetch = originalFetch;
  });

  it("posts Phase 2 params to the sidecar and normalizes a successful response", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toContain("/fetch");
      expect(init?.method).toBe("POST");
      const body = JSON.parse(String(init?.body));
      expect(body).toMatchObject({
        url: "https://example.com/article",
        output: "html",
        extractMode: "text",
        detail: "full",
        render: "stealth",
        extract: "links",
        mainContentOnly: false,
        maxChars: 1_234,
        timeoutSeconds: 9,
        waitUntil: "load",
        waitFor: "#content",
        sessionId: "session-1",
      });
      return new Response(
        JSON.stringify({
          status: "ok",
          provider: "scrapling",
          fetcher: "scrapling-sidecar:urllib",
          rendered: false,
          usedFallback: true,
          blockedDetected: false,
          url: "https://example.com/article",
          finalUrl: "https://example.com/article",
          statusCode: 200,
          contentType: "text/html",
          title: "Example article",
          summary: "Summary",
          keyPoints: ["Point 1"],
          headings: ["Heading 1"],
          contentPreview: "Preview",
          html: "<html><body>Example</body></html>",
          content: "Example",
          text: "Example",
          metadata: { engine: "urllib" },
          fetchedAt: "2026-04-06T00:00:00+0800",
          tookMs: 12,
          warning: null,
          truncated: false,
          length: 7,
          rawLength: 7,
          wrappedLength: 7,
        }),
        { status: 200 },
      );
    });

    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const client = new ScraplingFetchClient({
      webFetch: {
        timeoutSeconds: 30,
        onlyMainContent: true,
      },
      service: {
        enabled: true,
        mode: "python-http",
        baseUrl: "http://127.0.0.1:32119",
        command: "python3",
        args: [],
        bootstrap: true,
        bootstrapPackages: ["Scrapling==0.4.4"],
        startupTimeoutMs: 15_000,
        healthcheckPath: "/health",
        fetchPath: "/fetch",
      },
    });

    const result = await client.fetchPage({
      url: "https://example.com/article",
      output: "html",
      extractMode: "text",
      detail: "full",
      render: "stealth",
      extract: "links",
      mainContentOnly: false,
      maxChars: 1_234,
      timeoutSeconds: 9,
      waitUntil: "load",
      waitFor: "#content",
      sessionId: "session-1",
    });

    expect(result).toMatchObject({
      status: "ok",
      provider: "scrapling",
      fetcher: "scrapling-sidecar:urllib",
      finalUrl: "https://example.com/article",
      contentType: "text/html",
      title: "Example article",
      truncated: false,
      length: 7,
      rawLength: 7,
      wrappedLength: 7,
    });
  });

  it("maps an unavailable response to ScraplingFetchUnavailableError", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            status: "unavailable",
            provider: "scrapling",
            code: "SCRAPLING_FETCH_UNAVAILABLE",
            message: "package missing",
            details: { reason: "scrapling package is not installed" },
          }),
          { status: 503 },
        ),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const client = new ScraplingFetchClient({
      webFetch: {
        timeoutSeconds: 30,
        onlyMainContent: true,
      },
      service: {
        enabled: true,
        mode: "python-http",
        baseUrl: "http://127.0.0.1:32119",
        command: "python3",
        args: [],
        bootstrap: true,
        bootstrapPackages: ["Scrapling==0.4.4"],
        startupTimeoutMs: 15_000,
        healthcheckPath: "/health",
        fetchPath: "/fetch",
      },
    });

    await expect(
      client.fetchPage({
        url: "https://example.com/",
      }),
    ).rejects.toBeInstanceOf(ScraplingFetchUnavailableError);
  });

  it("maps an error response to ScraplingFetchError", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            status: "error",
            provider: "scrapling",
            code: "SCRAPLING_FETCH_ERROR",
            message: "sidecar exploded",
            details: { reason: "boom" },
          }),
          { status: 500 },
        ),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const client = new ScraplingFetchClient({
      webFetch: {
        timeoutSeconds: 30,
        onlyMainContent: true,
      },
      service: {
        enabled: true,
        mode: "python-http",
        baseUrl: "http://127.0.0.1:32119",
        command: "python3",
        args: [],
        bootstrap: true,
        bootstrapPackages: ["Scrapling==0.4.4"],
        startupTimeoutMs: 15_000,
        healthcheckPath: "/health",
        fetchPath: "/fetch",
      },
    });

    await expect(
      client.fetchPage({
        url: "https://example.com/",
      }),
    ).rejects.toBeInstanceOf(ScraplingFetchError);
  });
});
