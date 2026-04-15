import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as ssrf from "../../infra/net/ssrf.js";
import { withFetchPreconnect } from "../../test-utils/fetch-mock.js";
import { makeFetchHeaders } from "./web-fetch.test-harness.js";
import { createWebFetchTool } from "./web-tools.js";

describe("web_fetch detail shaping", () => {
  const priorFetch = global.fetch;

  beforeEach(() => {
    vi.spyOn(ssrf, "resolvePinnedHostnameWithPolicy").mockImplementation(async (hostname) => {
      const normalized = hostname.trim().toLowerCase().replace(/\.$/, "");
      const addresses = ["93.184.216.34", "93.184.216.35"];
      return {
        hostname: normalized,
        addresses,
        lookup: ssrf.createPinnedLookup({ hostname: normalized, addresses }),
      };
    });
  });

  afterEach(() => {
    global.fetch = priorFetch;
    vi.restoreAllMocks();
  });

  it("defaults to brief detail with summary and preview fields", async () => {
    global.fetch = withFetchPreconnect(
      vi.fn(async () => {
        return {
          ok: true,
          status: 200,
          headers: makeFetchHeaders({ "content-type": "text/plain; charset=utf-8" }),
          text: async () =>
            [
              "CrawClaw adds a context budget to web fetch responses.",
              "This keeps the default tool output compact.",
              "Agents can request standard or full detail later.",
            ].join(" "),
          url: "https://example.com/article",
        } as Response;
      }),
    );

    const tool = createWebFetchTool({
      config: {
        plugins: {
          entries: {
            "scrapling-fetch": {
              enabled: false,
            },
          },
        },
        tools: {
          web: {
            fetch: {
              cacheTtlMinutes: 0,
            },
          },
        },
      },
      sandboxed: false,
    });

    const result = await tool?.execute?.("call", { url: "https://example.com/article" });
    const details = result?.details as {
      detail?: string;
      output?: string;
      summary?: string;
      contentPreview?: string;
      content?: string;
      contentOmitted?: boolean;
      text?: string;
      estimatedTokens?: number;
    };

    expect(details.detail).toBe("brief");
    expect(details.output).toBe("markdown");
    expect(details.summary).toContain("CrawClaw adds a context budget");
    expect(details.contentPreview).toContain("standard or full detail later");
    expect(details.content).toBeUndefined();
    expect(details.contentOmitted).toBe(true);
    expect(details.text).toContain("context budget");
    expect(details.estimatedTokens).toBeGreaterThan(0);
  });

  it("returns content for standard detail and preserves raw html when requested", async () => {
    const html = `<!doctype html><html><head><title>Doc</title></head><body><main><article><h1>Doc</h1><p>Alpha paragraph.</p><p>Beta paragraph.</p></article></main></body></html>`;
    global.fetch = withFetchPreconnect(
      vi.fn(async () => {
        return {
          ok: true,
          status: 200,
          headers: makeFetchHeaders({ "content-type": "text/html; charset=utf-8" }),
          text: async () => html,
          url: "https://example.com/doc",
        } as Response;
      }),
    );

    const tool = createWebFetchTool({
      config: {
        plugins: {
          entries: {
            "scrapling-fetch": {
              enabled: false,
            },
          },
        },
        tools: {
          web: {
            fetch: {
              cacheTtlMinutes: 0,
            },
          },
        },
      },
      sandboxed: false,
    });

    const result = await tool?.execute?.("call", {
      url: "https://example.com/doc",
      detail: "standard",
      output: "html",
    });
    const details = result?.details as {
      detail?: string;
      output?: string;
      content?: string;
      contentOmitted?: boolean;
      headings?: string[];
      title?: string;
    };

    expect(details.detail).toBe("standard");
    expect(details.output).toBe("html");
    expect(details.content).toContain("<article>");
    expect(details.contentOmitted).toBe(false);
    expect(details.headings?.[0]).toContain("Doc");
    expect(details.title).toContain("Doc");
  });
});
