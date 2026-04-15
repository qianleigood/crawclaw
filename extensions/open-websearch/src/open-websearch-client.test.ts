import { describe, expect, it } from "vitest";
import { __testing } from "./open-websearch-client.js";

describe("open-websearch client", () => {
  it("builds the local daemon search endpoint", () => {
    expect(__testing.buildSearchUrl("http://127.0.0.1:3000")).toBe("http://127.0.0.1:3000/search");
    expect(__testing.buildSearchUrl("https://search.example.com/base/")).toBe(
      "https://search.example.com/base/search",
    );
  });

  it("normalizes array and wrapped result payloads", () => {
    expect(
      __testing.normalizeResults(
        [
          {
            title: "Example",
            url: "https://example.com",
            description: "Snippet",
            engine: "duckduckgo",
          },
        ],
        5,
      ),
    ).toEqual([
      {
        title: "Example",
        url: "https://example.com",
        description: "Snippet",
        snippet: undefined,
        content: undefined,
        engine: "duckduckgo",
        source: undefined,
      },
    ]);

    expect(
      __testing.normalizeResults(
        {
          results: [
            {
              title: "Wrapped",
              url: "https://example.org",
              snippet: "Hello",
            },
          ],
        },
        5,
      ),
    ).toHaveLength(1);

    expect(
      __testing.normalizeResults(
        {
          status: "ok",
          data: {
            results: [
              {
                title: "Daemon wrapped",
                url: "https://example.net",
                description: "From data.results",
              },
            ],
          },
        },
        5,
      ),
    ).toEqual([
      {
        title: "Daemon wrapped",
        url: "https://example.net",
        description: "From data.results",
        snippet: undefined,
        content: undefined,
        engine: undefined,
        source: undefined,
      },
    ]);
  });

  it("accepts loopback http urls and rejects unsupported protocols", async () => {
    await expect(__testing.validateBaseUrl("http://127.0.0.1:3000")).resolves.toBeUndefined();
    await expect(__testing.validateBaseUrl("https://search.example.com")).resolves.toBeUndefined();
    await expect(__testing.validateBaseUrl("ftp://example.com")).rejects.toThrow(
      "Open-WebSearch base URL must use http:// or https://.",
    );
  });
});
