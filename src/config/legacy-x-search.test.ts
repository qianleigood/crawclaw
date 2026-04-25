import { describe, expect, it } from "vitest";
import type { CrawClawConfig } from "./config.js";
import {
  findLegacyXSearchConfigIssues,
  listLegacyXSearchConfigPaths,
  migrateLegacyXSearchConfig,
} from "./legacy-x-search.js";

describe("legacy x_search config", () => {
  it("does not auto-migrate removed x_search auth", () => {
    const config = {
      tools: {
        web: {
          x_search: {
            apiKey: "xai-legacy-key",
            enabled: true,
            model: "grok-4-1-fast",
          },
        } as Record<string, unknown>,
      },
    } as CrawClawConfig;

    expect(migrateLegacyXSearchConfig(config)).toEqual({
      config,
      changes: [],
    });
  });

  it("does nothing for knob-only x_search config without a legacy apiKey", () => {
    const config = {
      tools: {
        web: {
          x_search: {
            enabled: true,
            model: "grok-4-1-fast",
          },
        } as Record<string, unknown>,
      },
    } as CrawClawConfig;

    expect(migrateLegacyXSearchConfig(config)).toEqual({
      config,
      changes: [],
    });
  });

  it("lists legacy x_search paths", () => {
    expect(
      listLegacyXSearchConfigPaths({
        tools: {
          web: {
            x_search: {
              apiKey: "xai-legacy-key",
              enabled: false,
            },
          } as Record<string, unknown>,
        },
      } as CrawClawConfig),
    ).toEqual(["tools.web.x_search.apiKey"]);
  });

  it("reports legacy x_search issues with the plugin-owned target path", () => {
    expect(
      findLegacyXSearchConfigIssues({
        tools: {
          web: {
            x_search: {
              apiKey: "xai-legacy-key",
            },
          },
        },
      }),
    ).toEqual([
      {
        path: "tools.web.x_search.apiKey",
        message:
          "tools.web.x_search.apiKey was removed; use plugins.entries.xai.config.webSearch.apiKey instead.",
      },
    ]);
  });
});
