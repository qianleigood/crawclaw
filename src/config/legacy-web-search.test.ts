import { describe, expect, it } from "vitest";
import type { CrawClawConfig } from "./config.js";
import {
  listLegacyWebSearchConfigPaths,
  migrateLegacyWebSearchConfig,
} from "./legacy-web-search.js";

describe("legacy web search config", () => {
  it("migrates legacy global apiKey to brave plugin-owned config", () => {
    const res = migrateLegacyWebSearchConfig<CrawClawConfig>({
      tools: {
        web: {
          search: {
            provider: "grok",
            apiKey: "brave-key",
          },
        },
      },
    });

    expect(res.config.tools?.web?.search).toEqual({
      provider: "grok",
    });
    expect(res.config.plugins?.entries?.brave).toEqual({
      enabled: true,
      config: {
        webSearch: {
          apiKey: "brave-key",
        },
      },
    });
    expect(res.changes).toEqual([
      "Moved tools.web.search.apiKey → plugins.entries.brave.config.webSearch.apiKey.",
    ]);
  });

  it("lists legacy paths for metadata-owned provider config", () => {
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
});
