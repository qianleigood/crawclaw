import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  readConfigFileSnapshotForWrite: vi.fn(),
  resolveConfigSnapshotHash: vi.fn(),
  writeConfigFile: vi.fn(),
  enablePluginInConfig: vi.fn(),
  setPluginEnabledInConfig: vi.fn(),
  applySlotSelectionForPlugin: vi.fn(),
  installPluginFromNpmSpec: vi.fn(),
  installPluginFromPath: vi.fn(),
  installPluginFromClawHub: vi.fn(),
  recordPluginInstall: vi.fn(),
  clearPluginManifestRegistryCache: vi.fn(),
  buildPreferredClawHubSpec: vi.fn(),
  decidePreferredClawHubFallback: vi.fn(),
  resolveFileNpmSpecToLocalPath: vi.fn(),
}));

vi.mock("../config/config.js", () => ({
  readConfigFileSnapshotForWrite: mocks.readConfigFileSnapshotForWrite,
  resolveConfigSnapshotHash: mocks.resolveConfigSnapshotHash,
  writeConfigFile: mocks.writeConfigFile,
}));

vi.mock("./enable.js", () => ({
  enablePluginInConfig: mocks.enablePluginInConfig,
}));

vi.mock("./toggle-config.js", () => ({
  setPluginEnabledInConfig: mocks.setPluginEnabledInConfig,
}));

vi.mock("../cli/plugins-command-helpers.js", () => ({
  applySlotSelectionForPlugin: mocks.applySlotSelectionForPlugin,
  buildPreferredClawHubSpec: mocks.buildPreferredClawHubSpec,
  decidePreferredClawHubFallback: mocks.decidePreferredClawHubFallback,
  resolveFileNpmSpecToLocalPath: mocks.resolveFileNpmSpecToLocalPath,
}));

vi.mock("./install.js", () => ({
  installPluginFromNpmSpec: mocks.installPluginFromNpmSpec,
  installPluginFromPath: mocks.installPluginFromPath,
}));

vi.mock("./clawhub.js", async () => {
  const actual = await vi.importActual<typeof import("./clawhub.js")>("./clawhub.js");
  return {
    ...actual,
    installPluginFromClawHub: mocks.installPluginFromClawHub,
  };
});

vi.mock("./installs.js", () => ({
  recordPluginInstall: mocks.recordPluginInstall,
}));

vi.mock("./manifest-registry.js", () => ({
  clearPluginManifestRegistryCache: mocks.clearPluginManifestRegistryCache,
}));

import {
  disablePluginFromControlPlane,
  enablePluginFromControlPlane,
  installPluginFromControlPlane,
} from "./control-plane.js";

describe("plugin control-plane helpers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveConfigSnapshotHash.mockReturnValue("cfg-1");
    mocks.resolveFileNpmSpecToLocalPath.mockReturnValue(null);
    mocks.buildPreferredClawHubSpec.mockReturnValue(null);
    mocks.decidePreferredClawHubFallback.mockReturnValue("fallback_to_npm");
  });

  it("enables a plugin and persists slot warnings", async () => {
    mocks.readConfigFileSnapshotForWrite.mockResolvedValue({
      snapshot: {
        path: "/tmp/crawclaw.json",
        sourceConfig: { plugins: {} },
        runtimeConfig: { plugins: {} },
      },
      writeOptions: { expectedConfigPath: "/tmp/crawclaw.json" },
    });
    mocks.enablePluginInConfig.mockReturnValue({
      enabled: true,
      config: { plugins: { entries: { browser: { enabled: true } } } },
    });
    mocks.applySlotSelectionForPlugin.mockReturnValue({
      config: { plugins: { entries: { browser: { enabled: true } } }, slots: { tools: "browser" } },
      warnings: ["browser selected as the active slot"],
    });

    const result = await enablePluginFromControlPlane({ pluginId: "browser", baseHash: "cfg-1" });

    expect(mocks.enablePluginInConfig).toHaveBeenCalledWith({ plugins: {} }, "browser");
    expect(mocks.writeConfigFile).toHaveBeenCalledWith(
      { plugins: { entries: { browser: { enabled: true } } }, slots: { tools: "browser" } },
      { expectedConfigPath: "/tmp/crawclaw.json" },
    );
    expect(result).toEqual({
      pluginId: "browser",
      warnings: ["browser selected as the active slot"],
      requiresRestart: true,
    });
  });

  it("disables a plugin by writing a disabled config entry", async () => {
    mocks.readConfigFileSnapshotForWrite.mockResolvedValue({
      snapshot: {
        path: "/tmp/crawclaw.json",
        sourceConfig: { plugins: { entries: { browser: { enabled: true } } } },
        runtimeConfig: { plugins: { entries: { browser: { enabled: true } } } },
      },
      writeOptions: {},
    });
    mocks.setPluginEnabledInConfig.mockReturnValue({
      plugins: { entries: { browser: { enabled: false } } },
    });

    const result = await disablePluginFromControlPlane({ pluginId: "browser", baseHash: "cfg-1" });

    expect(mocks.setPluginEnabledInConfig).toHaveBeenCalledWith(
      { plugins: { entries: { browser: { enabled: true } } } },
      "browser",
      false,
    );
    expect(mocks.writeConfigFile).toHaveBeenCalledWith(
      { plugins: { entries: { browser: { enabled: false } } } },
      {},
    );
    expect(result).toEqual({
      pluginId: "browser",
      warnings: [],
      requiresRestart: true,
    });
  });

  it("installs a plugin from npm and records the install metadata", async () => {
    mocks.readConfigFileSnapshotForWrite
      .mockResolvedValueOnce({
        snapshot: {
          path: "/tmp/crawclaw.json",
          sourceConfig: { plugins: {} },
          runtimeConfig: { plugins: {} },
        },
        writeOptions: {},
      })
      .mockResolvedValueOnce({
        snapshot: {
          path: "/tmp/crawclaw.json",
          sourceConfig: { plugins: {} },
          runtimeConfig: { plugins: {} },
        },
        writeOptions: { expectedConfigPath: "/tmp/crawclaw.json" },
      });
    mocks.installPluginFromNpmSpec.mockResolvedValue({
      ok: true,
      pluginId: "acpx",
      targetDir: "/tmp/extensions/acpx",
      version: "1.2.3",
      npmResolution: {
        resolvedName: "@crawclaw/acpx",
        resolvedVersion: "1.2.3",
        resolvedSpec: "@crawclaw/acpx@1.2.3",
      },
    });
    mocks.enablePluginInConfig.mockReturnValue({
      enabled: true,
      config: { plugins: { entries: { acpx: { enabled: true } } } },
    });
    mocks.recordPluginInstall.mockReturnValue({
      plugins: {
        entries: { acpx: { enabled: true } },
        installs: {
          acpx: {
            source: "npm",
            spec: "@crawclaw/acpx",
            installPath: "/tmp/extensions/acpx",
            version: "1.2.3",
          },
        },
      },
    });
    mocks.applySlotSelectionForPlugin.mockReturnValue({
      config: {
        plugins: {
          entries: { acpx: { enabled: true } },
          installs: {
            acpx: {
              source: "npm",
              spec: "@crawclaw/acpx",
              installPath: "/tmp/extensions/acpx",
              version: "1.2.3",
            },
          },
        },
      },
      warnings: [],
    });

    const result = await installPluginFromControlPlane({
      raw: "@crawclaw/acpx",
      baseHash: "cfg-1",
    });

    expect(mocks.installPluginFromNpmSpec).toHaveBeenCalledWith({ spec: "@crawclaw/acpx" });
    expect(mocks.clearPluginManifestRegistryCache).toHaveBeenCalledTimes(1);
    expect(mocks.recordPluginInstall).toHaveBeenCalledWith(
      { plugins: { entries: { acpx: { enabled: true } } } },
      expect.objectContaining({
        pluginId: "acpx",
        source: "npm",
        spec: "@crawclaw/acpx",
        installPath: "/tmp/extensions/acpx",
        version: "1.2.3",
      }),
    );
    expect(mocks.writeConfigFile).toHaveBeenCalledWith(
      expect.objectContaining({
        plugins: expect.objectContaining({
          installs: expect.objectContaining({
            acpx: expect.objectContaining({
              source: "npm",
              spec: "@crawclaw/acpx",
              installPath: "/tmp/extensions/acpx",
              version: "1.2.3",
            }),
          }),
        }),
      }),
      { expectedConfigPath: "/tmp/crawclaw.json" },
    );
    expect(result).toEqual({
      pluginId: "acpx",
      warnings: [],
      requiresRestart: true,
      installSource: "npm",
    });
  });

  it("rejects stale config hashes before writing", async () => {
    mocks.readConfigFileSnapshotForWrite.mockResolvedValue({
      snapshot: {
        path: "/tmp/crawclaw.json",
        sourceConfig: { plugins: {} },
        runtimeConfig: { plugins: {} },
      },
      writeOptions: {},
    });
    mocks.resolveConfigSnapshotHash.mockReturnValue("cfg-2");

    await expect(
      enablePluginFromControlPlane({ pluginId: "browser", baseHash: "cfg-1" }),
    ).rejects.toMatchObject({
      kind: "invalid-request",
      message: "config changed since last load; re-run config.get and retry",
    });

    expect(mocks.writeConfigFile).not.toHaveBeenCalled();
  });
});
