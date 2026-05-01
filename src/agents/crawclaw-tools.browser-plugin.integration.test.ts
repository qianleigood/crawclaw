import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createBundledBrowserPluginFixture } from "../../test/helpers/browser-bundled-plugin-fixture.js";
import { applyLocalSetupWorkspaceConfig } from "../commands/onboard-config.js";
import type { CrawClawConfig } from "../config/config.js";
import { clearPluginDiscoveryCache } from "../plugins/discovery.js";
import { clearPluginLoaderCache } from "../plugins/loader.js";
import { clearPluginManifestRegistryCache } from "../plugins/manifest-registry.js";
import { resetPluginRuntimeStateForTest } from "../plugins/runtime.js";
import { createCrawClawTools } from "./crawclaw-tools.js";
import { createCrawClawCodingTools } from "./pi-tools.js";

function resetPluginState() {
  clearPluginLoaderCache();
  clearPluginDiscoveryCache();
  clearPluginManifestRegistryCache();
  resetPluginRuntimeStateForTest();
}

describe("createCrawClawTools browser plugin integration", () => {
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

  it("loads the bundled browser plugin through normal plugin resolution", () => {
    const tools = createCrawClawTools({
      config: {
        plugins: {
          allow: ["browser"],
        },
      } as CrawClawConfig,
    });

    expect(tools.map((tool) => tool.name)).toContain("browser");
  });

  it.each(["minimal", "coding", "messaging", "full"] as const)(
    "keeps browser available to the onboarded main agent through the %s profile",
    (profile) => {
      const config = applyLocalSetupWorkspaceConfig(
        { plugins: { allow: ["browser"] }, tools: { profile } },
        "/tmp/workspace",
      );
      const tools = createCrawClawCodingTools({
        config,
        sessionKey: "agent:main:main",
        workspaceDir: "/tmp/workspace",
        agentDir: "/tmp/agent",
      });

      expect(tools.map((tool) => tool.name)).toContain("browser");
    },
  );

  it("keeps browser available to the onboarded main agent when profile is unset", () => {
    const config = applyLocalSetupWorkspaceConfig(
      { plugins: { allow: ["browser"] } },
      "/tmp/workspace",
    );
    const tools = createCrawClawCodingTools({
      config,
      sessionKey: "agent:main:main",
      workspaceDir: "/tmp/workspace",
      agentDir: "/tmp/agent",
    });

    expect(tools.map((tool) => tool.name)).toContain("browser");
  });

  it("omits the browser tool when the bundled browser plugin is disabled", () => {
    const tools = createCrawClawTools({
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
    });

    expect(tools.map((tool) => tool.name)).not.toContain("browser");
  });
});
