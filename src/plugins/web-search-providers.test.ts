import { describe, expect, it } from "vitest";
import { resolveBundledWebSearchPluginIds } from "./bundled-web-search.js";
import { resolveBundledPluginWebSearchProviders } from "./web-search-providers.js";

describe("resolveBundledPluginWebSearchProviders", () => {
  it("loads bundled web search providers from Rust-generated native metadata", () => {
    expect(resolveBundledPluginWebSearchProviders({}).map((entry) => entry.pluginId)).toEqual([
      "searxng",
    ]);
    expect(resolveBundledWebSearchPluginIds({})).toEqual(["searxng"]);
  });
});
