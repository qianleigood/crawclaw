import { describe, expect, it } from "vitest";
import { resolveBundledWebSearchPluginIds } from "./bundled-web-search.js";
import { resolveBundledPluginWebSearchProviders } from "./web-search-providers.js";

describe("resolveBundledPluginWebSearchProviders", () => {
  it("keeps bundled web search provider objects out of the TypeScript registry", () => {
    expect(resolveBundledPluginWebSearchProviders({})).toEqual([]);
    expect(resolveBundledWebSearchPluginIds({})).toEqual(["searxng"]);
  });
});
