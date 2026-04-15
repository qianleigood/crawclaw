import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ScraplingFetchClient,
  ScraplingFetchError,
  ScraplingFetchUnavailableError,
} from "./client.js";
import { createScraplingWebFetchProvider } from "./provider.js";

describe("createScraplingWebFetchProvider", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("registers the Scrapling web fetch provider metadata", () => {
    const provider = createScraplingWebFetchProvider();

    expect(provider.id).toBe("scrapling");
    expect(provider.label).toBe("Scrapling");
    expect(provider.credentialPath).toContain(
      "plugins.entries.scrapling-fetch.config.webFetch.apiKey",
    );
  });

  it("passes Phase 2 args through to the client", async () => {
    const fetchPageSpy = vi.spyOn(ScraplingFetchClient.prototype, "fetchPage").mockResolvedValue({
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
      html: null,
      content: "Example",
      text: "Example",
      metadata: {},
      externalContent: {
        untrusted: true,
        source: "web_fetch",
        provider: "scrapling",
        wrapped: true,
      },
      truncated: false,
      length: 7,
      rawLength: 7,
      wrappedLength: 7,
      fetchedAt: "2026-04-06T00:00:00+0800",
      tookMs: 12,
      warning: null,
      request: {},
    });
    const provider = createScraplingWebFetchProvider();
    const tool = provider.createTool({
      config: {
        plugins: {
          entries: {
            "scrapling-fetch": {
              config: {
                webFetch: {
                  onlyMainContent: true,
                  timeoutSeconds: 21,
                },
              },
            },
          },
        },
      },
    } as never);
    expect(tool).not.toBeNull();

    const result = await tool!.execute({
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

    expect(fetchPageSpy).toHaveBeenCalledWith({
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
      finalUrl: "https://example.com/article",
      contentType: "text/html",
    });
  });

  it("maps unavailable client failures to a clear payload", async () => {
    vi.spyOn(ScraplingFetchClient.prototype, "fetchPage").mockRejectedValue(
      new ScraplingFetchUnavailableError("package missing", {
        reason: "scrapling package is not installed",
      }),
    );
    const provider = createScraplingWebFetchProvider();
    const tool = provider.createTool({ config: {} } as never);
    expect(tool).not.toBeNull();

    const result = await tool!.execute({
      url: "https://example.com/",
      extractMode: "markdown",
    });

    expect(result).toMatchObject({
      provider: "scrapling",
      status: 503,
      code: "SCRAPLING_FETCH_UNAVAILABLE",
    });
    expect((result as Record<string, unknown>).error).toMatchObject({
      code: "SCRAPLING_FETCH_UNAVAILABLE",
    });
  });

  it("maps client errors to a clear payload", async () => {
    vi.spyOn(ScraplingFetchClient.prototype, "fetchPage").mockRejectedValue(
      new ScraplingFetchError("boom", { reason: "failure" }),
    );
    const provider = createScraplingWebFetchProvider();
    const tool = provider.createTool({ config: {} } as never);
    expect(tool).not.toBeNull();

    const result = await tool!.execute({
      url: "https://example.com/",
      extractMode: "markdown",
    });

    expect(result).toMatchObject({
      provider: "scrapling",
      status: 500,
      code: "SCRAPLING_FETCH_ERROR",
    });
    expect((result as Record<string, unknown>).error).toMatchObject({
      code: "SCRAPLING_FETCH_ERROR",
    });
  });
});
