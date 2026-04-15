import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createBundledBrowserPluginFixture } from "../../test/helpers/browser-bundled-plugin-fixture.js";
import type { CrawClawConfig } from "../config/config.js";
import { clearPluginDiscoveryCache } from "./discovery.js";
import { clearPluginLoaderCache, loadCrawClawPlugins } from "./loader.js";
import { clearPluginManifestRegistryCache } from "./manifest-registry.js";
import { resetPluginRuntimeStateForTest } from "./runtime.js";

function resetPluginState() {
  clearPluginLoaderCache();
  clearPluginDiscoveryCache();
  clearPluginManifestRegistryCache();
  resetPluginRuntimeStateForTest();
}

describe("registerPluginCliCommands browser plugin integration", () => {
  let bundledFixture: ReturnType<typeof createBundledBrowserPluginFixture> | null = null;

  beforeEach(() => {
    bundledFixture = createBundledBrowserPluginFixture();
    vi.stubEnv("CRAWCLAW_BUNDLED_PLUGINS_DIR", bundledFixture.rootDir);
    resetPluginState();
  });

  afterEach(() => {
    resetPluginState();
    vi.unstubAllEnvs();
    bundledFixture?.cleanup();
    bundledFixture = null;
  });

  it("does not register a legacy browser CLI command from the bundled browser plugin", () => {
    const registry = loadCrawClawPlugins({
      config: {
        plugins: {
          allow: ["browser"],
        },
      } as CrawClawConfig,
      cache: false,
      env: {
        ...process.env,
        CRAWCLAW_BUNDLED_PLUGINS_DIR:
          bundledFixture?.rootDir ?? path.join(process.cwd(), "extensions"),
      } as NodeJS.ProcessEnv,
    });

    expect(registry.cliRegistrars.flatMap((entry) => entry.commands)).not.toContain("browser");
  });

  it("still omits the legacy browser command when the bundled browser plugin is disabled", () => {
    const registry = loadCrawClawPlugins({
      config: {
        plugins: {
          allow: ["browser"],
          entries: {
            browser: {
              enabled: false,
            },
          },
        },
      } as CrawClawConfig,
      cache: false,
    });

    expect(registry.cliRegistrars.flatMap((entry) => entry.commands)).not.toContain("browser");
  });
});
