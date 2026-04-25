import { describe, expect, it } from "vitest";
import type { CrawClawConfig } from "./config.js";
import {
  findLegacyWebSearchConfigIssues,
  listLegacyWebSearchConfigPaths,
  migrateLegacyWebSearchConfig,
} from "./legacy-web-search.js";

describe("legacy web search config", () => {
  it("does not auto-migrate removed web search provider config", () => {
    const config = {
      tools: {
        web: {
          search: {
            provider: "grok",
            apiKey: "brave-key",
          },
        },
      },
    } as CrawClawConfig;

    expect(migrateLegacyWebSearchConfig(config)).toEqual({
      config,
      changes: [],
    });
  });

  it("lists legacy paths for removed provider config", () => {
    expect(
      listLegacyWebSearchConfigPaths({
        tools: {
          web: {
            search: {
              apiKey: "brave-key",
            },
          },
        },
      }),
    ).toEqual(["tools.web.search.apiKey"]);
  });

  it("reports legacy web search issues with the plugin-owned target path", () => {
    expect(
      findLegacyWebSearchConfigIssues({
        tools: {
          web: {
            search: {
              apiKey: "brave-key",
            },
          },
        },
      }),
    ).toEqual([
      {
        path: "tools.web.search.apiKey",
        message:
          "tools.web.search.apiKey was removed; use plugins.entries.brave.config.webSearch.apiKey instead.",
      },
    ]);
  });
});
