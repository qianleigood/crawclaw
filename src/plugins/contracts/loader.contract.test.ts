import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { withBundledPluginAllowlistCompat } from "../bundled-compat.js";
import { resolveBundledWebSearchPluginIds } from "../bundled-web-search.js";
import { resolveBundledPluginWebSearchProviders } from "../web-search-providers.js";
import { uniqueSortedStrings } from "./testkit.js";

function expectPluginAllowlistContains(
  allow: string[] | undefined,
  pluginIds: string[],
  expectedExtraEntry?: string,
) {
  expect(allow).toEqual(expect.arrayContaining(pluginIds));
  if (expectedExtraEntry) {
    expect(allow).toContain(expectedExtraEntry);
  }
}

function createAllowlistCompatConfig(pluginIds: string[]) {
  return withBundledPluginAllowlistCompat({
    config: {
      plugins: {
        allow: [demoAllowEntry],
      },
    },
    pluginIds,
  });
}

const demoAllowEntry = "demo-allowed";

describe("plugin loader contract", () => {
  let webSearchPluginIds: string[] = [];
  let bundledWebSearchPluginIds: string[] = [];
  let webSearchAllowlistCompatConfig: ReturnType<typeof withBundledPluginAllowlistCompat>;

  beforeAll(() => {
    webSearchPluginIds = uniqueSortedStrings(
      resolveBundledPluginWebSearchProviders({}).map((entry) => entry.pluginId),
    );
    bundledWebSearchPluginIds = uniqueSortedStrings(resolveBundledWebSearchPluginIds({}));
    webSearchAllowlistCompatConfig = createAllowlistCompatConfig(webSearchPluginIds);
  });

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("keeps bundled web search loading scoped to the web search registry", () => {
    expect(webSearchPluginIds).toEqual([]);
    expect(bundledWebSearchPluginIds).toEqual(["searxng"]);
  });

  it("keeps bundled web search allowlist compatibility wired to the web search registry", () => {
    expectPluginAllowlistContains(
      webSearchAllowlistCompatConfig?.plugins?.allow,
      webSearchPluginIds,
      demoAllowEntry,
    );
  });
});
