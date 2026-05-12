import { describe, expect, it } from "vitest";
import type { CrawClawConfig } from "../config/config.js";
import { resolveGatewayStartupPluginIds } from "./channel-plugin-ids.js";
import { loadPluginManifestRegistry } from "./manifest-registry.js";
import { resolveBundledProviderCompatPluginIds } from "./providers.js";

describe("gateway startup bundled plugin guardrails", () => {
  it("keeps bundled provider plugins out of gateway startup even when explicitly enabled", () => {
    const providerPluginIds = resolveBundledProviderCompatPluginIds({
      config: {},
      env: process.env,
    });
    const cfg = {
      channels: {},
      plugins: {
        entries: Object.fromEntries(
          providerPluginIds.map((pluginId) => [pluginId, { enabled: true }]),
        ),
      },
    } satisfies CrawClawConfig;

    const startupPluginIds = resolveGatewayStartupPluginIds({
      config: cfg,
      env: process.env,
    });

    expect(providerPluginIds.length).toBeGreaterThan(0);
    expect(startupPluginIds.filter((pluginId) => providerPluginIds.includes(pluginId))).toEqual([]);
  });

  it("keeps bundled default tool plugins out of gateway startup even when explicitly enabled", () => {
    const bundledDefaultToolPluginIds = loadPluginManifestRegistry({
      config: {},
      env: process.env,
    })
      .plugins.filter(
        (plugin) =>
          plugin.origin === "bundled" &&
          plugin.enabledByDefault === true &&
          (plugin.contracts?.tools?.length ?? 0) > 0,
      )
      .map((plugin) => plugin.id);
    const cfg = {
      channels: {},
      plugins: {
        entries: Object.fromEntries(
          bundledDefaultToolPluginIds.map((pluginId) => [pluginId, { enabled: true }]),
        ),
      },
    } satisfies CrawClawConfig;

    const startupPluginIds = resolveGatewayStartupPluginIds({
      config: cfg,
      env: process.env,
    });

    expect(bundledDefaultToolPluginIds).toEqual(
      expect.arrayContaining(["browser", "comfyui", "turix-cua"]),
    );
    expect(
      startupPluginIds.filter((pluginId) => bundledDefaultToolPluginIds.includes(pluginId)),
    ).toEqual([]);
  });
});
