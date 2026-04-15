import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CrawClawConfig } from "../config/config.js";

const listPotentialConfiguredChannelIds = vi.hoisted(() => vi.fn());
const loadPluginManifestRegistry = vi.hoisted(() => vi.fn());
const bundledWebSearchPluginIds = vi.hoisted(() => ["open-websearch"]);
const bundledWebFetchPluginIds = vi.hoisted(() => ["scrapling-fetch"]);

vi.mock("../channels/config-presence.js", () => ({
  listPotentialConfiguredChannelIds,
}));

vi.mock("./manifest-registry.js", () => ({
  loadPluginManifestRegistry,
}));

vi.mock("./bundled-web-search-ids.js", () => ({
  BUNDLED_WEB_SEARCH_PLUGIN_IDS: bundledWebSearchPluginIds,
}));

vi.mock("./bundled-web-fetch-ids.js", () => ({
  BUNDLED_WEB_FETCH_PLUGIN_IDS: bundledWebFetchPluginIds,
}));

import { resolveGatewayStartupPluginIds } from "./channel-plugin-ids.js";

function createManifestRegistryFixture() {
  return {
    plugins: [
      {
        id: "demo-channel",
        channels: ["demo-channel"],
        origin: "bundled",
        enabledByDefault: undefined,
        providers: [],
        cliBackends: [],
      },
      {
        id: "demo-other-channel",
        channels: ["demo-other-channel"],
        origin: "bundled",
        enabledByDefault: undefined,
        providers: [],
        cliBackends: [],
      },
      {
        id: "browser",
        channels: [],
        origin: "bundled",
        enabledByDefault: true,
        providers: [],
        cliBackends: [],
      },
      {
        id: "demo-provider-plugin",
        channels: [],
        origin: "bundled",
        enabledByDefault: undefined,
        providers: ["demo-provider"],
        cliBackends: ["demo-cli"],
      },
      {
        id: "voice-call",
        channels: [],
        origin: "bundled",
        enabledByDefault: undefined,
        providers: [],
        cliBackends: [],
      },
      {
        id: "open-websearch",
        channels: [],
        origin: "bundled",
        enabledByDefault: true,
        providers: [],
        cliBackends: [],
        contracts: {
          webSearchProviders: ["open-websearch"],
        },
      },
      {
        id: "scrapling-fetch",
        channels: [],
        origin: "bundled",
        enabledByDefault: true,
        providers: [],
        cliBackends: [],
        contracts: {
          webFetchProviders: ["scrapling"],
        },
      },
      {
        id: "demo-global-sidecar",
        channels: [],
        origin: "global",
        enabledByDefault: undefined,
        providers: [],
        cliBackends: [],
      },
    ],
    diagnostics: [],
  };
}

function expectStartupPluginIds(config: CrawClawConfig, expected: readonly string[]) {
  expect(
    resolveGatewayStartupPluginIds({
      config,
      workspaceDir: "/tmp",
      env: process.env,
    }),
  ).toEqual(expected);
  expect(loadPluginManifestRegistry).toHaveBeenCalled();
}

function expectStartupPluginIdsCase(params: {
  config: CrawClawConfig;
  expected: readonly string[];
}) {
  expectStartupPluginIds(params.config, params.expected);
}

function createStartupConfig(params: {
  enabledPluginIds?: string[];
  providerIds?: string[];
  modelId?: string;
  channelIds?: string[];
  allowPluginIds?: string[];
  noConfiguredChannels?: boolean;
}) {
  return {
    ...(params.noConfiguredChannels
      ? {
          channels: {},
        }
      : params.channelIds?.length
        ? {
            channels: Object.fromEntries(
              params.channelIds.map((channelId) => [channelId, { enabled: true }]),
            ),
          }
        : {}),
    ...(params.enabledPluginIds?.length
      ? {
          plugins: {
            ...(params.allowPluginIds?.length ? { allow: params.allowPluginIds } : {}),
            entries: Object.fromEntries(
              params.enabledPluginIds.map((pluginId) => [pluginId, { enabled: true }]),
            ),
          },
        }
      : params.allowPluginIds?.length
        ? {
            plugins: {
              allow: params.allowPluginIds,
            },
          }
        : {}),
    ...(params.providerIds?.length
      ? {
          models: {
            providers: Object.fromEntries(
              params.providerIds.map((providerId) => [
                providerId,
                {
                  baseUrl: "https://example.com",
                  models: [],
                },
              ]),
            ),
          },
        }
      : {}),
    ...(params.modelId
      ? {
          agents: {
            defaults: {
              model: { primary: params.modelId },
              models: {
                [params.modelId]: {},
              },
            },
          },
        }
      : {}),
  } as CrawClawConfig;
}

describe("resolveGatewayStartupPluginIds", () => {
  beforeEach(() => {
    listPotentialConfiguredChannelIds.mockReset().mockImplementation((config: CrawClawConfig) => {
      if (Object.prototype.hasOwnProperty.call(config, "channels")) {
        return Object.keys(config.channels ?? {});
      }
      return ["demo-channel"];
    });
    loadPluginManifestRegistry.mockReset().mockReturnValue(createManifestRegistryFixture());
  });

  it.each([
    [
      "includes only configured channel plugins at idle startup",
      createStartupConfig({
        enabledPluginIds: ["voice-call"],
        modelId: "demo-cli/demo-model",
      }),
      ["demo-channel", "browser", "voice-call", "open-websearch", "scrapling-fetch"],
    ],
    [
      "keeps bundled startup sidecars with enabledByDefault at idle startup",
      {} as CrawClawConfig,
      ["demo-channel", "browser", "open-websearch", "scrapling-fetch"],
    ],
    [
      "keeps provider plugins out of idle startup when only provider config references them",
      createStartupConfig({
        providerIds: ["demo-provider"],
      }),
      ["demo-channel", "browser", "open-websearch", "scrapling-fetch"],
    ],
    [
      "includes explicitly enabled non-channel sidecars in startup scope",
      createStartupConfig({
        enabledPluginIds: ["demo-global-sidecar", "voice-call"],
      }),
      [
        "demo-channel",
        "browser",
        "voice-call",
        "open-websearch",
        "scrapling-fetch",
        "demo-global-sidecar",
      ],
    ],
    [
      "keeps default-enabled startup sidecars when a restrictive allowlist permits them",
      createStartupConfig({
        allowPluginIds: ["browser", "open-websearch"],
        noConfiguredChannels: true,
      }),
      ["browser", "open-websearch"],
    ],
    [
      "includes explicitly enabled bundled web-fetch runtime plugins",
      createStartupConfig({
        enabledPluginIds: ["scrapling-fetch"],
      }),
      ["demo-channel", "browser", "open-websearch", "scrapling-fetch"],
    ],
    [
      "includes every configured channel plugin and excludes other channels",
      createStartupConfig({
        channelIds: ["demo-channel", "demo-other-channel"],
      }),
      ["demo-channel", "demo-other-channel", "browser", "open-websearch", "scrapling-fetch"],
    ],
  ] as const)("%s", (_name, config, expected) => {
    expectStartupPluginIdsCase({ config, expected });
  });
});
