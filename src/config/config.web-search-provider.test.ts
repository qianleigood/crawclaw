import { beforeAll, describe, expect, it, vi } from "vitest";
import { buildWebSearchProviderConfig } from "./test-helpers.js";

vi.mock("../runtime.js", () => ({
  defaultRuntime: { log: vi.fn(), error: vi.fn() },
}));

let validateConfigObjectWithPlugins: typeof import("./config.js").validateConfigObjectWithPlugins;

beforeAll(async () => {
  ({ validateConfigObjectWithPlugins } = await import("./config.js"));
});

describe("web search provider config", () => {
  it("rejects removed legacy API-key config", () => {
    const res = validateConfigObjectWithPlugins({
      tools: {
        web: {
          search: {
            enabled: true,
            apiKey: "test-search-key", // pragma: allowlist secret
          },
        },
      },
    });

    expect(res.ok).toBe(false);
    if (res.ok) {
      throw new Error("expected legacy web search API key config to be rejected");
    }
    expect(res.issues).toContainEqual(
      expect.objectContaining({
        path: "tools.web.search",
      }),
    );
  });

  it("accepts searxng provider config on the plugin-owned path", () => {
    const res = validateConfigObjectWithPlugins(
      buildWebSearchProviderConfig({
        enabled: true,
        provider: "searxng",
        providerConfig: {
          baseUrl: {
            source: "env",
            provider: "default",
            id: "SEARXNG_BASE_URL",
          },
        },
      }),
    );

    expect(res.ok).toBe(true);
  });
});
