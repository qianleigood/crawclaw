import { beforeEach, describe, expect, it, vi } from "vitest";
import { __testing, ensurePluginRegistryLoaded } from "./plugin-registry.js";

const mocks = vi.hoisted(() => ({
  applyPluginAutoEnable: vi.fn(),
  resolveAgentWorkspaceDir: vi.fn(() => "/tmp/workspace"),
  resolveDefaultAgentId: vi.fn(() => "main"),
  loadConfig: vi.fn(),
  loadCrawClawPlugins: vi.fn(),
}));

vi.mock("../agents/agent-scope.js", () => ({
  resolveAgentWorkspaceDir: mocks.resolveAgentWorkspaceDir,
  resolveDefaultAgentId: mocks.resolveDefaultAgentId,
}));

vi.mock("../config/config.js", () => ({
  loadConfig: mocks.loadConfig,
}));

vi.mock("../config/plugin-auto-enable.js", () => ({
  applyPluginAutoEnable: mocks.applyPluginAutoEnable,
}));

vi.mock("../plugins/loader.js", () => ({
  loadCrawClawPlugins: mocks.loadCrawClawPlugins,
}));

describe("ensurePluginRegistryLoaded", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __testing.resetPluginRegistryLoadedForTests();
  });

  it("loads the full plugin registry once", () => {
    const baseConfig = { plugins: { enabled: true } };
    const autoEnabledConfig = {
      plugins: {
        enabled: true,
        entries: { "demo-provider": { enabled: true } },
      },
    };

    mocks.loadConfig.mockReturnValue(baseConfig);
    mocks.applyPluginAutoEnable.mockReturnValue({
      config: autoEnabledConfig,
      changes: [],
      autoEnabledReasons: {
        "demo-provider": ["provider configured"],
      },
    });

    ensurePluginRegistryLoaded();
    ensurePluginRegistryLoaded();

    expect(mocks.applyPluginAutoEnable).toHaveBeenCalledWith({
      config: baseConfig,
      env: process.env,
    });
    expect(mocks.resolveDefaultAgentId).toHaveBeenCalledWith(autoEnabledConfig);
    expect(mocks.resolveAgentWorkspaceDir).toHaveBeenCalledWith(autoEnabledConfig, "main");
    expect(mocks.loadCrawClawPlugins).toHaveBeenCalledTimes(1);
    expect(mocks.loadCrawClawPlugins).toHaveBeenCalledWith(
      expect.objectContaining({
        config: autoEnabledConfig,
        activationSourceConfig: baseConfig,
        autoEnabledReasons: {
          "demo-provider": ["provider configured"],
        },
        throwOnLoadError: true,
        workspaceDir: "/tmp/workspace",
      }),
    );
  });
});
