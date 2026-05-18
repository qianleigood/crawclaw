import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { resetDiagnosticEventsForTest } from "../infra/diagnostic-events.js";
import { withEnv } from "../test-utils/env.js";
import { clearPluginDiscoveryCache } from "./discovery.js";
import {
  __testing,
  clearPluginLoaderCache,
  loadCrawClawPlugins,
  resolveRuntimePluginRegistry,
} from "./loader.js";
import { clearPluginManifestRegistryCache } from "./manifest-registry.js";
import { createEmptyPluginRegistry } from "./registry.js";
import {
  getActivePluginRegistry,
  getActivePluginRegistryKey,
  resetPluginRuntimeStateForTest,
  setActivePluginRegistry,
} from "./runtime.js";

type TempPlugin = { dir: string; file: string; manifest: string; id: string };
type PluginLoadConfig = NonNullable<Parameters<typeof loadCrawClawPlugins>[0]>["config"];
type PluginRegistry = ReturnType<typeof loadCrawClawPlugins>;

function chmodSafeDir(dir: string) {
  if (process.platform === "win32") {
    return;
  }
  fs.chmodSync(dir, 0o755);
}

function mkdtempSafe(prefix: string) {
  const dir = fs.mkdtempSync(prefix);
  chmodSafeDir(dir);
  return dir;
}

function mkdirSafe(dir: string) {
  fs.mkdirSync(dir, { recursive: true });
  chmodSafeDir(dir);
}

const fixtureRoot = mkdtempSafe(path.join(os.tmpdir(), "crawclaw-plugin-"));
let tempDirIndex = 0;
const prevBundledDir = process.env.CRAWCLAW_BUNDLED_PLUGINS_DIR;
const EMPTY_PLUGIN_SCHEMA = { type: "object", additionalProperties: false, properties: {} };

function nativePluginDescriptor(id: string) {
  const binName = id.replace(/[^A-Za-z0-9._-]+/g, "-");
  return {
    protocol: "crawclaw-native-plugin-jsonrpc",
    schemaVersion: 1,
    bin: `${binName}-native`,
  };
}

function makeTempDir() {
  const dir = path.join(fixtureRoot, `case-${tempDirIndex++}`);
  mkdirSafe(dir);
  return dir;
}

function writePlugin(params: {
  id: string;
  body: string;
  dir?: string;
  filename?: string;
}): TempPlugin {
  const dir = params.dir ?? makeTempDir();
  const filename = params.filename ?? `${params.id}.cjs`;
  mkdirSafe(dir);
  const file = path.join(dir, filename);
  fs.writeFileSync(file, params.body, "utf-8");
  const manifest = path.join(dir, "crawclaw.plugin.json");
  fs.writeFileSync(
    manifest,
    JSON.stringify(
      {
        id: params.id,
        native: nativePluginDescriptor(params.id),
        configSchema: EMPTY_PLUGIN_SCHEMA,
      },
      null,
      2,
    ),
    "utf-8",
  );
  return { dir, file, manifest, id: params.id };
}

function simplePluginBody(id: string) {
  return `module.exports = { id: ${JSON.stringify(id)} };`;
}

function writeBundledPlugin(params: {
  id: string;
  body?: string;
  filename?: string;
  bundledDir?: string;
}) {
  const bundledDir = params.bundledDir ?? makeTempDir();
  const plugin = writePlugin({
    id: params.id,
    dir: path.join(bundledDir, params.id),
    filename: params.filename ?? "index.cjs",
    body: params.body ?? simplePluginBody(params.id),
  });
  process.env.CRAWCLAW_BUNDLED_PLUGINS_DIR = bundledDir;
  return { bundledDir, plugin };
}

function writeWorkspacePlugin(params: {
  id: string;
  body?: string;
  filename?: string;
  workspaceDir?: string;
}) {
  const workspaceDir = params.workspaceDir ?? makeTempDir();
  const workspacePluginDir = path.join(workspaceDir, ".crawclaw", "extensions", params.id);
  mkdirSafe(workspacePluginDir);
  const plugin = writePlugin({
    id: params.id,
    dir: workspacePluginDir,
    filename: params.filename ?? "index.cjs",
    body: params.body ?? simplePluginBody(params.id),
  });
  return { workspaceDir, workspacePluginDir, plugin };
}

function withStateDir<T>(run: (stateDir: string) => T) {
  const stateDir = makeTempDir();
  return withEnv({ CRAWCLAW_STATE_DIR: stateDir }, () => run(stateDir));
}

function useNoBundledPlugins() {
  process.env.CRAWCLAW_BUNDLED_PLUGINS_DIR = "/nonexistent/bundled/plugins";
}

function loadRegistryFromSinglePlugin(params: {
  plugin: TempPlugin;
  pluginConfig?: Record<string, unknown>;
  includeWorkspaceDir?: boolean;
  options?: Omit<Parameters<typeof loadCrawClawPlugins>[0], "cache" | "workspaceDir" | "config">;
}) {
  const pluginConfig = params.pluginConfig ?? {};
  return loadCrawClawPlugins({
    cache: false,
    ...(params.includeWorkspaceDir === false ? {} : { workspaceDir: params.plugin.dir }),
    ...params.options,
    config: {
      plugins: {
        load: { paths: [params.plugin.dir] },
        ...pluginConfig,
      },
    },
  });
}

function runRegistryScenarios<
  T extends { assert: (registry: PluginRegistry, scenario: T) => void },
>(scenarios: readonly T[], loadRegistry: (scenario: T) => PluginRegistry) {
  for (const scenario of scenarios) {
    scenario.assert(loadRegistry(scenario), scenario);
  }
}

function runScenarioCases<T>(scenarios: readonly T[], run: (scenario: T) => void) {
  for (const scenario of scenarios) {
    run(scenario);
  }
}

function expectOpenAllowWarnings(params: {
  warnings: string[];
  pluginId: string;
  expectedWarnings: number;
  label: string;
}) {
  const openAllowWarnings = params.warnings.filter((msg) => msg.includes("plugins.allow is empty"));
  expect(openAllowWarnings, params.label).toHaveLength(params.expectedWarnings);
  if (params.expectedWarnings > 0) {
    expect(
      openAllowWarnings.some((msg) => msg.includes(params.pluginId)),
      params.label,
    ).toBe(true);
  }
}

function expectLoadedPluginProvenance(params: {
  scenario: { label: string };
  registry: PluginRegistry;
  warnings: string[];
  pluginId: string;
  expectWarning: boolean;
  expectedSource?: string;
}) {
  const plugin = params.registry.plugins.find((entry) => entry.id === params.pluginId);
  expect(plugin?.status, params.scenario.label).toBe("loaded");
  if (params.expectedSource) {
    expect(plugin?.source, params.scenario.label).toBe(params.expectedSource);
  }
  expect(
    params.warnings.some(
      (msg) =>
        msg.includes(params.pluginId) &&
        msg.includes("loaded without install/load-path provenance"),
    ),
    params.scenario.label,
  ).toBe(params.expectWarning);
}

function expectPluginSourcePrecedence(
  registry: PluginRegistry,
  scenario: {
    pluginId: string;
    expectedLoadedOrigin: string;
    expectedDisabledOrigin: string;
    label: string;
    expectedDisabledError?: string;
  },
) {
  const entries = registry.plugins.filter((entry) => entry.id === scenario.pluginId);
  const loaded = entries.find((entry) => entry.status === "loaded");
  const overridden = entries.find((entry) => entry.status === "disabled");
  expect(loaded?.origin, scenario.label).toBe(scenario.expectedLoadedOrigin);
  expect(overridden?.origin, scenario.label).toBe(scenario.expectedDisabledOrigin);
  if (scenario.expectedDisabledError) {
    expect(overridden?.error, scenario.label).toContain(scenario.expectedDisabledError);
  }
}

function expectPluginOriginAndStatus(params: {
  registry: PluginRegistry;
  pluginId: string;
  origin: string;
  status: string;
  label: string;
  errorIncludes?: string;
}) {
  const plugin = params.registry.plugins.find((entry) => entry.id === params.pluginId);
  expect(plugin?.origin, params.label).toBe(params.origin);
  expect(plugin?.status, params.label).toBe(params.status);
  if (params.errorIncludes) {
    expect(plugin?.error, params.label).toContain(params.errorIncludes);
  }
}

function createWarningLogger(warnings: string[]) {
  return {
    info: () => {},
    warn: (msg: string) => warnings.push(msg),
    error: () => {},
  };
}

function loadBundleFixture(params: {
  pluginId: string;
  build: (bundleRoot: string) => void;
  env?: NodeJS.ProcessEnv;
  onlyPluginIds?: string[];
}) {
  useNoBundledPlugins();
  const workspaceDir = makeTempDir();
  const stateDir = makeTempDir();
  const bundleRoot = path.join(workspaceDir, ".crawclaw", "extensions", params.pluginId);
  params.build(bundleRoot);
  return withEnv({ CRAWCLAW_STATE_DIR: stateDir, ...params.env }, () =>
    loadCrawClawPlugins({
      workspaceDir,
      onlyPluginIds: params.onlyPluginIds ?? [params.pluginId],
      config: {
        plugins: {
          entries: {
            [params.pluginId]: {
              enabled: true,
            },
          },
        },
      },
      cache: false,
    }),
  );
}

function expectNoUnwiredBundleDiagnostic(
  registry: ReturnType<typeof loadCrawClawPlugins>,
  pluginId: string,
) {
  expect(
    registry.diagnostics.some(
      (diag) =>
        diag.pluginId === pluginId &&
        diag.message.includes("bundle capability detected but not wired"),
    ),
  ).toBe(false);
}

function resolveLoadedPluginSource(
  registry: ReturnType<typeof loadCrawClawPlugins>,
  pluginId: string,
) {
  return fs.realpathSync(registry.plugins.find((entry) => entry.id === pluginId)?.source ?? "");
}

function expectCachePartitionByPluginSource(params: {
  pluginId: string;
  loadFirst: () => ReturnType<typeof loadCrawClawPlugins>;
  loadSecond: () => ReturnType<typeof loadCrawClawPlugins>;
  expectedFirstSource: string;
  expectedSecondSource: string;
}) {
  const first = params.loadFirst();
  const second = params.loadSecond();

  expect(second).not.toBe(first);
  expect(resolveLoadedPluginSource(first, params.pluginId)).toBe(
    fs.realpathSync(params.expectedFirstSource),
  );
  expect(resolveLoadedPluginSource(second, params.pluginId)).toBe(
    fs.realpathSync(params.expectedSecondSource),
  );
}

function expectCacheMissThenHit(params: {
  loadFirst: () => ReturnType<typeof loadCrawClawPlugins>;
  loadVariant: () => ReturnType<typeof loadCrawClawPlugins>;
}) {
  const first = params.loadFirst();
  const second = params.loadVariant();
  const third = params.loadVariant();

  expect(second).not.toBe(first);
  expect(third).toBe(second);
}

function createEnvResolvedPluginFixture(pluginId: string) {
  useNoBundledPlugins();
  const crawclawHome = makeTempDir();
  const ignoredHome = makeTempDir();
  const stateDir = makeTempDir();
  const pluginDir = path.join(crawclawHome, "plugins", pluginId);
  mkdirSafe(pluginDir);
  const plugin = writePlugin({
    id: pluginId,
    dir: pluginDir,
    filename: "index.cjs",
    body: `module.exports = { id: ${JSON.stringify(pluginId)} };`,
  });
  const env = {
    ...process.env,
    CRAWCLAW_HOME: crawclawHome,
    HOME: ignoredHome,
    CRAWCLAW_STATE_DIR: stateDir,
    CRAWCLAW_BUNDLED_PLUGINS_DIR: "/nonexistent/bundled/plugins",
  };
  return { plugin, env };
}

afterEach(() => {
  clearPluginLoaderCache();
  clearPluginDiscoveryCache();
  clearPluginManifestRegistryCache();
  resetPluginRuntimeStateForTest();
  resetDiagnosticEventsForTest();
  if (prevBundledDir === undefined) {
    delete process.env.CRAWCLAW_BUNDLED_PLUGINS_DIR;
  } else {
    process.env.CRAWCLAW_BUNDLED_PLUGINS_DIR = prevBundledDir;
  }
});

describe("bundle plugins", () => {
  it("reports Codex bundles as loaded bundle plugins without importing runtime code", () => {
    useNoBundledPlugins();
    const workspaceDir = makeTempDir();
    const stateDir = makeTempDir();
    const bundleRoot = path.join(workspaceDir, ".crawclaw", "extensions", "sample-bundle");
    mkdirSafe(path.join(bundleRoot, ".codex-plugin"));
    mkdirSafe(path.join(bundleRoot, "skills"));
    fs.writeFileSync(
      path.join(bundleRoot, ".codex-plugin", "plugin.json"),
      JSON.stringify({
        name: "Sample Bundle",
        description: "Codex bundle fixture",
        skills: "skills",
      }),
      "utf-8",
    );
    fs.writeFileSync(
      path.join(bundleRoot, "skills", "SKILL.md"),
      "---\ndescription: fixture\n---\n",
    );

    const registry = withEnv({ CRAWCLAW_STATE_DIR: stateDir }, () =>
      loadCrawClawPlugins({
        workspaceDir,
        onlyPluginIds: ["sample-bundle"],
        config: {
          plugins: {
            entries: {
              "sample-bundle": {
                enabled: true,
              },
            },
          },
        },
        cache: false,
      }),
    );

    const plugin = registry.plugins.find((entry) => entry.id === "sample-bundle");
    expect(plugin?.status).toBe("loaded");
    expect(plugin?.format).toBe("bundle");
    expect(plugin?.bundleFormat).toBe("codex");
    expect(plugin?.bundleCapabilities).toContain("skills");
  });

  it.each([
    {
      name: "treats Claude command roots and settings as supported bundle surfaces",
      pluginId: "claude-skills",
      expectedFormat: "claude",
      expectedCapabilities: ["skills", "commands", "settings"],
      build: (bundleRoot: string) => {
        mkdirSafe(path.join(bundleRoot, "commands"));
        fs.writeFileSync(
          path.join(bundleRoot, "commands", "review.md"),
          "---\ndescription: fixture\n---\n",
        );
        fs.writeFileSync(
          path.join(bundleRoot, "settings.json"),
          '{"hideThinkingBlock":true}',
          "utf-8",
        );
      },
    },
    {
      name: "treats bundle MCP as a supported bundle surface",
      pluginId: "claude-mcp",
      expectedFormat: "claude",
      expectedCapabilities: ["mcpServers"],
      build: (bundleRoot: string) => {
        mkdirSafe(path.join(bundleRoot, ".claude-plugin"));
        fs.writeFileSync(
          path.join(bundleRoot, ".claude-plugin", "plugin.json"),
          JSON.stringify({
            name: "Claude MCP",
          }),
          "utf-8",
        );
        fs.writeFileSync(
          path.join(bundleRoot, ".mcp.json"),
          JSON.stringify({
            mcpServers: {
              probe: {
                command: "node",
                args: ["./probe.mjs"],
              },
            },
          }),
          "utf-8",
        );
      },
    },
    {
      name: "treats Cursor command roots as supported bundle skill surfaces",
      pluginId: "cursor-skills",
      expectedFormat: "cursor",
      expectedCapabilities: ["skills", "commands"],
      build: (bundleRoot: string) => {
        mkdirSafe(path.join(bundleRoot, ".cursor-plugin"));
        mkdirSafe(path.join(bundleRoot, ".cursor", "commands"));
        fs.writeFileSync(
          path.join(bundleRoot, ".cursor-plugin", "plugin.json"),
          JSON.stringify({
            name: "Cursor Skills",
          }),
          "utf-8",
        );
        fs.writeFileSync(
          path.join(bundleRoot, ".cursor", "commands", "review.md"),
          "---\ndescription: fixture\n---\n",
        );
      },
    },
  ])("$name", ({ pluginId, expectedFormat, expectedCapabilities, build }) => {
    const registry = loadBundleFixture({ pluginId, build });
    const plugin = registry.plugins.find((entry) => entry.id === pluginId);

    expect(plugin?.status).toBe("loaded");
    expect(plugin?.bundleFormat).toBe(expectedFormat);
    expect(plugin?.bundleCapabilities).toEqual(expect.arrayContaining(expectedCapabilities));
    expectNoUnwiredBundleDiagnostic(registry, pluginId);
  });

  it("warns when bundle MCP only declares unsupported non-stdio transports", () => {
    const stateDir = makeTempDir();
    const registry = loadBundleFixture({
      pluginId: "claude-mcp-url",
      env: {
        CRAWCLAW_HOME: stateDir,
      },
      build: (bundleRoot) => {
        mkdirSafe(path.join(bundleRoot, ".claude-plugin"));
        fs.writeFileSync(
          path.join(bundleRoot, ".claude-plugin", "plugin.json"),
          JSON.stringify({
            name: "Claude MCP URL",
          }),
          "utf-8",
        );
        fs.writeFileSync(
          path.join(bundleRoot, ".mcp.json"),
          JSON.stringify({
            mcpServers: {
              remoteProbe: {
                url: "http://127.0.0.1:8787/mcp",
              },
            },
          }),
          "utf-8",
        );
      },
    });

    const plugin = registry.plugins.find((entry) => entry.id === "claude-mcp-url");
    expect(plugin?.status).toBe("loaded");
    expect(plugin?.bundleCapabilities).toEqual(expect.arrayContaining(["mcpServers"]));
    expect(
      registry.diagnostics.some(
        (diag) =>
          diag.pluginId === "claude-mcp-url" &&
          diag.message.includes("stdio only today") &&
          diag.message.includes("remoteProbe"),
      ),
    ).toBe(true);
  });
});

afterAll(() => {
  try {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  } catch {
    // ignore cleanup failures
  }
});

describe("loadCrawClawPlugins", () => {
  it("disables bundled plugins by default", () => {
    writeBundledPlugin({
      id: "bundled",
      body: `module.exports = { id: "bundled" };`,
      filename: "bundled.cjs",
    });

    const registry = loadCrawClawPlugins({
      cache: false,
      config: {
        plugins: {
          allow: ["bundled"],
        },
      },
    });

    const bundled = registry.plugins.find((entry) => entry.id === "bundled");
    expect(bundled?.status).toBe("disabled");
  });

  it("keeps explicit plugin enablement distinct from derived activation", () => {
    const { bundledDir } = writeBundledPlugin({
      id: "demo",
    });
    const config = {
      plugins: {
        entries: {
          demo: {
            enabled: true,
          },
        },
      },
    } satisfies PluginLoadConfig;

    const registry = loadCrawClawPlugins({
      cache: false,
      workspaceDir: bundledDir,
      config,
      activationSourceConfig: config,
    });

    expect(registry.plugins.find((entry) => entry.id === "demo")).toMatchObject({
      explicitlyEnabled: true,
      activated: true,
      activationSource: "explicit",
      activationReason: "enabled in config",
    });
  });

  it.each([
    {
      label: "loads plugins from config paths",
      run: () => {
        process.env.CRAWCLAW_BUNDLED_PLUGINS_DIR = "/nonexistent/bundled/plugins";
        const plugin = writePlugin({
          id: "allowed-config-path",
          filename: "allowed-config-path.cjs",
          body: `module.exports = {
  id: "allowed-config-path",
};`,
        });

        const registry = loadCrawClawPlugins({
          cache: false,
          workspaceDir: plugin.dir,
          config: {
            plugins: {
              load: { paths: [plugin.dir] },
              allow: ["allowed-config-path"],
            },
          },
        });

        const loaded = registry.plugins.find((entry) => entry.id === "allowed-config-path");
        expect(loaded?.status).toBe("loaded");
        expect(registry.plugins.map((entry) => entry.id)).toContain("allowed-config-path");
      },
    },
    {
      label: "limits imports to the requested plugin ids",
      run: () => {
        useNoBundledPlugins();
        const allowed = writePlugin({
          id: "allowed-scoped-only",
          filename: "allowed-scoped-only.cjs",
          body: `module.exports = { id: "allowed-scoped-only" };`,
        });
        const skippedMarker = path.join(makeTempDir(), "skipped-loaded.txt");
        const skipped = writePlugin({
          id: "skipped-scoped-only",
          filename: "skipped-scoped-only.cjs",
          body: `require("node:fs").writeFileSync(${JSON.stringify(skippedMarker)}, "loaded", "utf-8");
module.exports = { id: "skipped-scoped-only" };`,
        });

        const registry = loadCrawClawPlugins({
          cache: false,
          config: {
            plugins: {
              load: { paths: [allowed.dir, skipped.dir] },
              allow: ["allowed-scoped-only", "skipped-scoped-only"],
            },
          },
          onlyPluginIds: ["allowed-scoped-only"],
        });

        expect(registry.plugins.map((entry) => entry.id)).toEqual(["allowed-scoped-only"]);
        expect(fs.existsSync(skippedMarker)).toBe(false);
      },
    },
    {
      label: "can build a manifest-only snapshot without importing plugin modules",
      run: () => {
        useNoBundledPlugins();
        const importedMarker = path.join(makeTempDir(), "manifest-only-imported.txt");
        const plugin = writePlugin({
          id: "manifest-only-plugin",
          filename: "manifest-only-plugin.cjs",
          body: `require("node:fs").writeFileSync(${JSON.stringify(importedMarker)}, "loaded", "utf-8");
module.exports = { id: "manifest-only-plugin" };`,
        });

        const registry = loadCrawClawPlugins({
          cache: false,
          activate: false,
          loadModules: false,
          config: {
            plugins: {
              load: { paths: [plugin.dir] },
              allow: ["manifest-only-plugin"],
              entries: {
                "manifest-only-plugin": { enabled: true },
              },
            },
          },
        });

        expect(fs.existsSync(importedMarker)).toBe(false);
        expect(registry.plugins).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              id: "manifest-only-plugin",
              status: "loaded",
            }),
          ]),
        );
      },
    },
    {
      label: "marks a selected memory slot as matched during manifest-only snapshots",
      run: () => {
        useNoBundledPlugins();
        const memoryPlugin = writePlugin({
          id: "memory-demo",
          filename: "memory-demo.cjs",
          body: `module.exports = {
  id: "memory-demo",
  kind: "memory",
};`,
        });
        fs.writeFileSync(
          path.join(memoryPlugin.dir, "crawclaw.plugin.json"),
          JSON.stringify(
            {
              id: "memory-demo",
              kind: "memory",
              native: nativePluginDescriptor("memory-demo"),
              configSchema: EMPTY_PLUGIN_SCHEMA,
            },
            null,
            2,
          ),
          "utf-8",
        );

        const registry = loadCrawClawPlugins({
          cache: false,
          activate: false,
          loadModules: false,
          config: {
            plugins: {
              load: { paths: [memoryPlugin.dir] },
              allow: ["memory-demo"],
              slots: { memory: "memory-demo" },
              entries: {
                "memory-demo": { enabled: true },
              },
            },
          },
        });

        expect(
          registry.diagnostics.some(
            (entry) =>
              entry.message === "memory slot plugin not found or not marked as memory: memory-demo",
          ),
        ).toBe(false);
        expect(registry.plugins).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              id: "memory-demo",
              memorySlotSelected: true,
            }),
          ]),
        );
      },
    },
    {
      label: "keeps scoped plugin loads in a separate cache entry",
      run: () => {
        useNoBundledPlugins();
        const allowed = writePlugin({
          id: "allowed-cache-scope",
          filename: "allowed-cache-scope.cjs",
          body: `module.exports = { id: "allowed-cache-scope" };`,
        });
        const extra = writePlugin({
          id: "extra-cache-scope",
          filename: "extra-cache-scope.cjs",
          body: `module.exports = { id: "extra-cache-scope" };`,
        });
        const options = {
          config: {
            plugins: {
              load: { paths: [allowed.dir, extra.dir] },
              allow: ["allowed-cache-scope", "extra-cache-scope"],
            },
          },
        };

        const full = loadCrawClawPlugins(options);
        const scoped = loadCrawClawPlugins({
          ...options,
          onlyPluginIds: ["allowed-cache-scope"],
        });
        const scopedAgain = loadCrawClawPlugins({
          ...options,
          onlyPluginIds: ["allowed-cache-scope"],
        });

        expect(full.plugins.map((entry) => entry.id).toSorted()).toEqual([
          "allowed-cache-scope",
          "extra-cache-scope",
        ]);
        expect(scoped).not.toBe(full);
        expect(scoped.plugins.map((entry) => entry.id)).toEqual(["allowed-cache-scope"]);
        expect(scopedAgain).toBe(scoped);
      },
    },
    {
      label: "can load a scoped registry without replacing the active global registry",
      run: () => {
        useNoBundledPlugins();
        const plugin = writePlugin({
          id: "allowed-nonactivating-scope",
          filename: "allowed-nonactivating-scope.cjs",
          body: `module.exports = { id: "allowed-nonactivating-scope" };`,
        });
        const previousRegistry = createEmptyPluginRegistry();
        setActivePluginRegistry(previousRegistry, "existing-registry");
        const scoped = loadCrawClawPlugins({
          cache: false,
          activate: false,
          workspaceDir: plugin.dir,
          config: {
            plugins: {
              load: { paths: [plugin.dir] },
              allow: ["allowed-nonactivating-scope"],
            },
          },
          onlyPluginIds: ["allowed-nonactivating-scope"],
        });

        expect(scoped.plugins.map((entry) => entry.id)).toEqual(["allowed-nonactivating-scope"]);
        expect(getActivePluginRegistry()).toBe(previousRegistry);
        expect(getActivePluginRegistryKey()).toBe("existing-registry");
      },
    },
  ] as const)("handles config-path and scoped plugin loads: $label", ({ run }) => {
    run();
  });

  it("can scope bundled provider plugin metadata to deepseek without using TS provider hooks", () => {
    if (prevBundledDir === undefined) {
      delete process.env.CRAWCLAW_BUNDLED_PLUGINS_DIR;
    } else {
      process.env.CRAWCLAW_BUNDLED_PLUGINS_DIR = prevBundledDir;
    }

    const scoped = loadCrawClawPlugins({
      cache: false,
      activate: false,
      config: {
        plugins: {
          enabled: true,
          allow: ["deepseek"],
        },
      },
      onlyPluginIds: ["deepseek"],
    });

    expect(scoped.plugins.map((entry) => entry.id)).toEqual(["deepseek"]);
    expect(scoped.plugins[0]?.status).toBe("loaded");
    expect(scoped.plugins[0]?.providerIds).toEqual(["deepseek"]);
  });

  it("throws when activate:false is used without cache:false", () => {
    expect(() => loadCrawClawPlugins({ activate: false })).toThrow(
      "activate:false requires cache:false",
    );
    expect(() => loadCrawClawPlugins({ activate: false, cache: true })).toThrow(
      "activate:false requires cache:false",
    );
  });

  it.each([
    {
      name: "does not reuse cached bundled plugin registries across env changes",
      pluginId: "cache-root",
      setup: () => {
        const bundledA = makeTempDir();
        const bundledB = makeTempDir();
        const pluginA = writePlugin({
          id: "cache-root",
          dir: path.join(bundledA, "cache-root"),
          filename: "index.cjs",
          body: `module.exports = { id: "cache-root" };`,
        });
        const pluginB = writePlugin({
          id: "cache-root",
          dir: path.join(bundledB, "cache-root"),
          filename: "index.cjs",
          body: `module.exports = { id: "cache-root" };`,
        });

        const options = {
          config: {
            plugins: {
              allow: ["cache-root"],
              entries: {
                "cache-root": { enabled: true },
              },
            },
          },
        };

        return {
          expectedFirstSource: pluginA.manifest,
          expectedSecondSource: pluginB.manifest,
          loadFirst: () =>
            loadCrawClawPlugins({
              ...options,
              env: {
                ...process.env,
                CRAWCLAW_BUNDLED_PLUGINS_DIR: bundledA,
              },
            }),
          loadSecond: () =>
            loadCrawClawPlugins({
              ...options,
              env: {
                ...process.env,
                CRAWCLAW_BUNDLED_PLUGINS_DIR: bundledB,
              },
            }),
        };
      },
    },
    {
      name: "does not reuse cached load-path plugin registries across env home changes",
      pluginId: "demo",
      setup: () => {
        const homeA = makeTempDir();
        const homeB = makeTempDir();
        const stateDir = makeTempDir();
        const bundledDir = makeTempDir();
        const pluginA = writePlugin({
          id: "demo",
          dir: path.join(homeA, "plugins", "demo"),
          filename: "index.cjs",
          body: `module.exports = { id: "demo" };`,
        });
        const pluginB = writePlugin({
          id: "demo",
          dir: path.join(homeB, "plugins", "demo"),
          filename: "index.cjs",
          body: `module.exports = { id: "demo" };`,
        });

        const options = {
          config: {
            plugins: {
              allow: ["demo"],
              entries: {
                demo: { enabled: true },
              },
              load: {
                paths: ["~/plugins/demo"],
              },
            },
          },
        };

        return {
          expectedFirstSource: pluginA.manifest,
          expectedSecondSource: pluginB.manifest,
          loadFirst: () =>
            loadCrawClawPlugins({
              ...options,
              env: {
                ...process.env,
                HOME: homeA,
                CRAWCLAW_HOME: undefined,
                CRAWCLAW_STATE_DIR: stateDir,
                CRAWCLAW_BUNDLED_PLUGINS_DIR: bundledDir,
              },
            }),
          loadSecond: () =>
            loadCrawClawPlugins({
              ...options,
              env: {
                ...process.env,
                HOME: homeB,
                CRAWCLAW_HOME: undefined,
                CRAWCLAW_STATE_DIR: stateDir,
                CRAWCLAW_BUNDLED_PLUGINS_DIR: bundledDir,
              },
            }),
        };
      },
    },
  ])("$name", ({ pluginId, setup }) => {
    const { expectedFirstSource, expectedSecondSource, loadFirst, loadSecond } = setup();
    expectCachePartitionByPluginSource({
      pluginId,
      loadFirst,
      loadSecond,
      expectedFirstSource,
      expectedSecondSource,
    });
  });

  it.each([
    {
      name: "does not reuse cached registries when env-resolved install paths change",
      setup: () => {
        useNoBundledPlugins();
        const crawclawHome = makeTempDir();
        const ignoredHome = makeTempDir();
        const stateDir = makeTempDir();
        const pluginDir = path.join(crawclawHome, "plugins", "tracked-install-cache");
        mkdirSafe(pluginDir);
        const plugin = writePlugin({
          id: "tracked-install-cache",
          dir: pluginDir,
          filename: "index.cjs",
          body: `module.exports = { id: "tracked-install-cache" };`,
        });

        const options = {
          config: {
            plugins: {
              load: { paths: [plugin.dir] },
              allow: ["tracked-install-cache"],
              installs: {
                "tracked-install-cache": {
                  source: "path" as const,
                  installPath: "~/plugins/tracked-install-cache",
                  sourcePath: "~/plugins/tracked-install-cache",
                },
              },
            },
          },
        };

        const secondHome = makeTempDir();
        return {
          loadFirst: () =>
            loadCrawClawPlugins({
              ...options,
              env: {
                ...process.env,
                CRAWCLAW_HOME: crawclawHome,
                HOME: ignoredHome,
                CRAWCLAW_STATE_DIR: stateDir,
                CRAWCLAW_BUNDLED_PLUGINS_DIR: "/nonexistent/bundled/plugins",
              },
            }),
          loadVariant: () =>
            loadCrawClawPlugins({
              ...options,
              env: {
                ...process.env,
                CRAWCLAW_HOME: secondHome,
                HOME: ignoredHome,
                CRAWCLAW_STATE_DIR: stateDir,
                CRAWCLAW_BUNDLED_PLUGINS_DIR: "/nonexistent/bundled/plugins",
              },
            }),
        };
      },
    },
  ])("$name", ({ setup }) => {
    expectCacheMissThenHit(setup());
  });

  it("evicts least recently used registries when the loader cache exceeds its cap", () => {
    useNoBundledPlugins();
    const plugin = writePlugin({
      id: "cache-eviction",
      filename: "cache-eviction.cjs",
      body: `module.exports = { id: "cache-eviction" };`,
    });
    const previousCacheCap = __testing.maxPluginRegistryCacheEntries;
    __testing.setMaxPluginRegistryCacheEntriesForTest(4);
    const stateDirs = Array.from({ length: __testing.maxPluginRegistryCacheEntries + 1 }, () =>
      makeTempDir(),
    );

    const loadWithStateDir = (stateDir: string) =>
      loadCrawClawPlugins({
        env: {
          ...process.env,
          CRAWCLAW_STATE_DIR: stateDir,
          CRAWCLAW_BUNDLED_PLUGINS_DIR: "/nonexistent/bundled/plugins",
        },
        config: {
          plugins: {
            allow: ["cache-eviction"],
            load: {
              paths: [plugin.dir],
            },
          },
        },
      });

    try {
      const first = loadWithStateDir(stateDirs[0] ?? makeTempDir());
      const second = loadWithStateDir(stateDirs[1] ?? makeTempDir());

      expect(loadWithStateDir(stateDirs[0] ?? makeTempDir())).toBe(first);

      for (const stateDir of stateDirs.slice(2)) {
        loadWithStateDir(stateDir);
      }

      expect(loadWithStateDir(stateDirs[0] ?? makeTempDir())).toBe(first);
      expect(loadWithStateDir(stateDirs[1] ?? makeTempDir())).not.toBe(second);
    } finally {
      __testing.setMaxPluginRegistryCacheEntriesForTest(previousCacheCap);
    }
  });

  it("normalizes bundled plugin env overrides against the provided env", () => {
    const bundledDir = makeTempDir();
    const homeDir = path.dirname(bundledDir);
    const override = `~/${path.basename(bundledDir)}`;
    const plugin = writePlugin({
      id: "tilde-bundled",
      dir: path.join(bundledDir, "tilde-bundled"),
      filename: "index.cjs",
      body: `module.exports = { id: "tilde-bundled" };`,
    });

    const registry = loadCrawClawPlugins({
      env: {
        ...process.env,
        HOME: homeDir,
        CRAWCLAW_HOME: undefined,
        CRAWCLAW_BUNDLED_PLUGINS_DIR: override,
      },
      config: {
        plugins: {
          allow: ["tilde-bundled"],
          entries: {
            "tilde-bundled": { enabled: true },
          },
        },
      },
    });

    expect(
      fs.realpathSync(registry.plugins.find((entry) => entry.id === "tilde-bundled")?.source ?? ""),
    ).toBe(fs.realpathSync(plugin.manifest));
  });

  it("prefers CRAWCLAW_HOME over HOME for env-expanded load paths", () => {
    const ignoredHome = makeTempDir();
    const crawclawHome = makeTempDir();
    const stateDir = makeTempDir();
    const bundledDir = makeTempDir();
    const plugin = writePlugin({
      id: "crawclaw-home-demo",
      dir: path.join(crawclawHome, "plugins", "crawclaw-home-demo"),
      filename: "index.cjs",
      body: `module.exports = { id: "crawclaw-home-demo" };`,
    });

    const registry = loadCrawClawPlugins({
      env: {
        ...process.env,
        HOME: ignoredHome,
        CRAWCLAW_HOME: crawclawHome,
        CRAWCLAW_STATE_DIR: stateDir,
        CRAWCLAW_BUNDLED_PLUGINS_DIR: bundledDir,
      },
      config: {
        plugins: {
          allow: ["crawclaw-home-demo"],
          entries: {
            "crawclaw-home-demo": { enabled: true },
          },
          load: {
            paths: ["~/plugins/crawclaw-home-demo"],
          },
        },
      },
    });

    expect(
      fs.realpathSync(
        registry.plugins.find((entry) => entry.id === "crawclaw-home-demo")?.source ?? "",
      ),
    ).toBe(fs.realpathSync(plugin.manifest));
  });

  it("loads plugins when source and root differ only by realpath alias", () => {
    useNoBundledPlugins();
    const plugin = writePlugin({
      id: "alias-safe",
      filename: "alias-safe.cjs",
      body: `module.exports = { id: "alias-safe" };`,
    });
    const realRoot = fs.realpathSync(plugin.dir);
    if (realRoot === plugin.dir) {
      return;
    }

    const registry = loadRegistryFromSinglePlugin({
      plugin,
      pluginConfig: {
        allow: ["alias-safe"],
      },
    });

    const loaded = registry.plugins.find((entry) => entry.id === "alias-safe");
    expect(loaded?.status).toBe("loaded");
  });

  it("denylist disables plugins even if allowed", () => {
    useNoBundledPlugins();
    const plugin = writePlugin({
      id: "blocked",
      body: `module.exports = { id: "blocked" };`,
    });

    const registry = loadRegistryFromSinglePlugin({
      plugin,
      pluginConfig: {
        allow: ["blocked"],
        deny: ["blocked"],
      },
    });

    const blocked = registry.plugins.find((entry) => entry.id === "blocked");
    expect(blocked?.status).toBe("disabled");
  });

  it("fails fast on invalid plugin config", () => {
    useNoBundledPlugins();
    const plugin = writePlugin({
      id: "configurable",
      filename: "configurable.cjs",
      body: `module.exports = { id: "configurable" };`,
    });

    const registry = loadRegistryFromSinglePlugin({
      plugin,
      pluginConfig: {
        entries: {
          configurable: {
            config: "nope" as unknown as Record<string, unknown>,
          },
        },
      },
    });

    const configurable = registry.plugins.find((entry) => entry.id === "configurable");
    expect(configurable?.status).toBe("error");
    expect(registry.diagnostics.some((d) => d.level === "error")).toBe(true);
  });

  it("throws when strict plugin loading sees plugin errors", () => {
    useNoBundledPlugins();
    const plugin = writePlugin({
      id: "configurable",
      filename: "configurable.cjs",
      body: `module.exports = { id: "configurable" };`,
    });

    expect(() =>
      loadCrawClawPlugins({
        cache: false,
        throwOnLoadError: true,
        config: {
          plugins: {
            enabled: true,
            load: { paths: [plugin.dir] },
            allow: ["configurable"],
            entries: {
              configurable: {
                enabled: true,
                config: "nope" as unknown as Record<string, unknown>,
              },
            },
          },
        },
      }),
    ).toThrow("plugin load failed: configurable: invalid config: <root>: must be object");
  });

  it("respects explicit disable in config", () => {
    process.env.CRAWCLAW_BUNDLED_PLUGINS_DIR = "/nonexistent/bundled/plugins";
    const plugin = writePlugin({
      id: "config-disable",
      body: `module.exports = { id: "config-disable" };`,
    });

    const registry = loadCrawClawPlugins({
      cache: false,
      config: {
        plugins: {
          load: { paths: [plugin.dir] },
          entries: {
            "config-disable": { enabled: false },
          },
        },
      },
    });

    const disabled = registry.plugins.find((entry) => entry.id === "config-disable");
    expect(disabled?.status).toBe("disabled");
  });

  it("resolves duplicate plugin ids by source precedence", () => {
    const scenarios = [
      {
        label: "config load overrides bundled",
        pluginId: "shadow",
        bundledFilename: "shadow.cjs",
        loadRegistry: () => {
          writeBundledPlugin({
            id: "shadow",
            body: simplePluginBody("shadow"),
            filename: "shadow.cjs",
          });

          const override = writePlugin({
            id: "shadow",
            body: simplePluginBody("shadow"),
          });

          return loadCrawClawPlugins({
            cache: false,
            config: {
              plugins: {
                load: { paths: [override.dir] },
                entries: {
                  shadow: { enabled: true },
                },
              },
            },
          });
        },
        expectedLoadedOrigin: "config",
        expectedDisabledOrigin: "bundled",
        assert: expectPluginSourcePrecedence,
      },
      {
        label: "bundled beats auto-discovered global duplicate",
        pluginId: "demo-bundled-duplicate",
        bundledFilename: "index.cjs",
        loadRegistry: () => {
          writeBundledPlugin({
            id: "demo-bundled-duplicate",
            body: simplePluginBody("demo-bundled-duplicate"),
          });
          return withStateDir((stateDir) => {
            const globalDir = path.join(stateDir, "extensions", "demo-bundled-duplicate");
            mkdirSafe(globalDir);
            writePlugin({
              id: "demo-bundled-duplicate",
              body: simplePluginBody("demo-bundled-duplicate"),
              dir: globalDir,
              filename: "index.cjs",
            });

            return loadCrawClawPlugins({
              cache: false,
              config: {
                plugins: {
                  allow: ["demo-bundled-duplicate"],
                  entries: {
                    "demo-bundled-duplicate": { enabled: true },
                  },
                },
              },
            });
          });
        },
        expectedLoadedOrigin: "bundled",
        expectedDisabledOrigin: "global",
        expectedDisabledError: "overridden by bundled plugin",
        assert: expectPluginSourcePrecedence,
      },
      {
        label: "installed global beats bundled duplicate",
        pluginId: "demo-installed-duplicate",
        bundledFilename: "index.cjs",
        loadRegistry: () => {
          writeBundledPlugin({
            id: "demo-installed-duplicate",
            body: simplePluginBody("demo-installed-duplicate"),
          });
          return withStateDir((stateDir) => {
            const globalDir = path.join(stateDir, "extensions", "demo-installed-duplicate");
            mkdirSafe(globalDir);
            writePlugin({
              id: "demo-installed-duplicate",
              body: simplePluginBody("demo-installed-duplicate"),
              dir: globalDir,
              filename: "index.cjs",
            });

            return loadCrawClawPlugins({
              cache: false,
              config: {
                plugins: {
                  allow: ["demo-installed-duplicate"],
                  installs: {
                    "demo-installed-duplicate": {
                      source: "npm",
                      installPath: globalDir,
                    },
                  },
                  entries: {
                    "demo-installed-duplicate": { enabled: true },
                  },
                },
              },
            });
          });
        },
        expectedLoadedOrigin: "global",
        expectedDisabledOrigin: "bundled",
        expectedDisabledError: "overridden by global plugin",
        assert: expectPluginSourcePrecedence,
      },
    ] as const;

    runRegistryScenarios(scenarios, (scenario) => scenario.loadRegistry());
  });

  it("warns about open allowlists only for auto-discovered plugins", () => {
    useNoBundledPlugins();
    clearPluginLoaderCache();
    const scenarios = [
      {
        label: "explicit config path stays quiet",
        pluginId: "warn-open-allow-config",
        loads: 1,
        expectedWarnings: 0,
        loadRegistry: (warnings: string[]) => {
          const plugin = writePlugin({
            id: "warn-open-allow-config",
            body: simplePluginBody("warn-open-allow-config"),
          });
          return loadCrawClawPlugins({
            cache: false,
            logger: createWarningLogger(warnings),
            config: {
              plugins: {
                load: { paths: [plugin.dir] },
              },
            },
          });
        },
      },
      {
        label: "workspace discovery warns once",
        pluginId: "warn-open-allow-workspace",
        loads: 2,
        expectedWarnings: 1,
        loadRegistry: (() => {
          const { workspaceDir } = writeWorkspacePlugin({
            id: "warn-open-allow-workspace",
          });
          return (warnings: string[]) =>
            loadCrawClawPlugins({
              cache: false,
              workspaceDir,
              logger: createWarningLogger(warnings),
              config: {
                plugins: {
                  enabled: true,
                },
              },
            });
        })(),
      },
    ] as const;

    runScenarioCases(scenarios, (scenario) => {
      const warnings: string[] = [];

      for (let index = 0; index < scenario.loads; index += 1) {
        scenario.loadRegistry(warnings);
      }

      expectOpenAllowWarnings({
        warnings,
        pluginId: scenario.pluginId,
        expectedWarnings: scenario.expectedWarnings,
        label: scenario.label,
      });
    });
  });

  it("handles workspace-discovered plugins according to trust and precedence", () => {
    useNoBundledPlugins();
    const scenarios = [
      {
        label: "untrusted workspace plugins stay disabled",
        pluginId: "workspace-helper",
        loadRegistry: () => {
          const { workspaceDir } = writeWorkspacePlugin({
            id: "workspace-helper",
          });

          return loadCrawClawPlugins({
            cache: false,
            workspaceDir,
            config: {
              plugins: {
                enabled: true,
              },
            },
          });
        },
        assert: (registry: ReturnType<typeof loadCrawClawPlugins>) => {
          expectPluginOriginAndStatus({
            registry,
            pluginId: "workspace-helper",
            origin: "workspace",
            status: "disabled",
            label: "untrusted workspace plugins stay disabled",
            errorIncludes: "workspace plugin (disabled by default)",
          });
        },
      },
      {
        label: "trusted workspace plugins load",
        pluginId: "workspace-helper",
        loadRegistry: () => {
          const { workspaceDir } = writeWorkspacePlugin({
            id: "workspace-helper",
          });

          return loadCrawClawPlugins({
            cache: false,
            workspaceDir,
            config: {
              plugins: {
                enabled: true,
                allow: ["workspace-helper"],
              },
            },
          });
        },
        assert: (registry: ReturnType<typeof loadCrawClawPlugins>) => {
          expectPluginOriginAndStatus({
            registry,
            pluginId: "workspace-helper",
            origin: "workspace",
            status: "loaded",
            label: "trusted workspace plugins load",
          });
        },
      },
      {
        label: "bundled plugins stay ahead of trusted workspace duplicates",
        pluginId: "shadowed",
        expectedLoadedOrigin: "bundled",
        expectedDisabledOrigin: "workspace",
        expectedDisabledError: "overridden by bundled plugin",
        loadRegistry: () => {
          writeBundledPlugin({
            id: "shadowed",
          });
          const { workspaceDir } = writeWorkspacePlugin({
            id: "shadowed",
          });

          return loadCrawClawPlugins({
            cache: false,
            workspaceDir,
            config: {
              plugins: {
                enabled: true,
                allow: ["shadowed"],
                entries: {
                  shadowed: { enabled: true },
                },
              },
            },
          });
        },
        assert: (registry: PluginRegistry) => {
          expectPluginSourcePrecedence(registry, {
            pluginId: "shadowed",
            expectedLoadedOrigin: "bundled",
            expectedDisabledOrigin: "workspace",
            expectedDisabledError: "overridden by bundled plugin",
            label: "bundled plugins stay ahead of trusted workspace duplicates",
          });
        },
      },
    ] as const;

    runRegistryScenarios(scenarios, (scenario) => scenario.loadRegistry());
  });

  it("loads bundled plugins when manifest metadata opts into default enablement", () => {
    const { bundledDir, plugin } = writeBundledPlugin({
      id: "profile-aware",
      body: simplePluginBody("profile-aware"),
    });
    fs.writeFileSync(
      path.join(plugin.dir, "crawclaw.plugin.json"),
      JSON.stringify(
        {
          id: "profile-aware",
          enabledByDefault: true,
          native: nativePluginDescriptor("profile-aware"),
          configSchema: EMPTY_PLUGIN_SCHEMA,
        },
        null,
        2,
      ),
      "utf-8",
    );

    const registry = loadCrawClawPlugins({
      cache: false,
      workspaceDir: bundledDir,
      config: {
        plugins: {
          enabled: true,
        },
      },
    });

    const bundledPlugin = registry.plugins.find((entry) => entry.id === "profile-aware");
    expect(bundledPlugin?.origin).toBe("bundled");
    expect(bundledPlugin?.status).toBe("loaded");
  });

  it("keeps scoped and unscoped plugin ids distinct", () => {
    useNoBundledPlugins();
    const scoped = writePlugin({
      id: "@team/shadowed",
      body: simplePluginBody("@team/shadowed"),
      filename: "scoped.cjs",
    });
    const unscoped = writePlugin({
      id: "shadowed",
      body: simplePluginBody("shadowed"),
      filename: "unscoped.cjs",
    });

    const registry = loadCrawClawPlugins({
      cache: false,
      config: {
        plugins: {
          load: { paths: [scoped.dir, unscoped.dir] },
          allow: ["@team/shadowed", "shadowed"],
        },
      },
    });

    expect(registry.plugins.find((entry) => entry.id === "@team/shadowed")?.status).toBe("loaded");
    expect(registry.plugins.find((entry) => entry.id === "shadowed")?.status).toBe("loaded");
    expect(registry.diagnostics.some((diag) => diag.message.includes("duplicate plugin id"))).toBe(
      false,
    );
  });

  it("evaluates load-path provenance warnings", () => {
    useNoBundledPlugins();
    const scenarios = [
      {
        label: "does not warn when loaded non-bundled plugin is in plugins.allow",
        loadRegistry: () => {
          return withStateDir((stateDir) => {
            const globalDir = path.join(stateDir, "extensions", "rogue");
            mkdirSafe(globalDir);
            writePlugin({
              id: "rogue",
              body: simplePluginBody("rogue"),
              dir: globalDir,
              filename: "index.cjs",
            });

            const warnings: string[] = [];
            const registry = loadCrawClawPlugins({
              cache: false,
              logger: createWarningLogger(warnings),
              config: {
                plugins: {
                  allow: ["rogue"],
                },
              },
            });

            return { registry, warnings, pluginId: "rogue", expectWarning: false };
          });
        },
      },
      {
        label: "warns when loaded non-bundled plugin has no provenance and no allowlist is set",
        loadRegistry: () => {
          const stateDir = makeTempDir();
          return withEnv({ CRAWCLAW_STATE_DIR: stateDir }, () => {
            const globalDir = path.join(stateDir, "extensions", "rogue");
            mkdirSafe(globalDir);
            writePlugin({
              id: "rogue",
              body: `module.exports = { id: "rogue" };`,
              dir: globalDir,
              filename: "index.cjs",
            });

            const warnings: string[] = [];
            const registry = loadCrawClawPlugins({
              cache: false,
              logger: createWarningLogger(warnings),
              config: {
                plugins: {
                  enabled: true,
                },
              },
            });

            return { registry, warnings, pluginId: "rogue", expectWarning: true };
          });
        },
      },
      {
        label: "does not warn about missing provenance for env-resolved load paths",
        loadRegistry: () => {
          const { plugin, env } = createEnvResolvedPluginFixture("tracked-load-path");
          const warnings: string[] = [];
          const registry = loadCrawClawPlugins({
            cache: false,
            logger: createWarningLogger(warnings),
            env,
            config: {
              plugins: {
                load: { paths: ["~/plugins/tracked-load-path"] },
                allow: [plugin.id],
              },
            },
          });

          return {
            registry,
            warnings,
            pluginId: plugin.id,
            expectWarning: false,
            expectedSource: plugin.manifest,
          };
        },
      },
      {
        label: "does not warn about missing provenance for env-resolved install paths",
        loadRegistry: () => {
          const { plugin, env } = createEnvResolvedPluginFixture("tracked-install-path");
          const warnings: string[] = [];
          const registry = loadCrawClawPlugins({
            cache: false,
            logger: createWarningLogger(warnings),
            env,
            config: {
              plugins: {
                load: { paths: [plugin.dir] },
                allow: [plugin.id],
                installs: {
                  [plugin.id]: {
                    source: "path",
                    installPath: `~/plugins/${plugin.id}`,
                    sourcePath: `~/plugins/${plugin.id}`,
                  },
                },
              },
            },
          });

          return {
            registry,
            warnings,
            pluginId: plugin.id,
            expectWarning: false,
            expectedSource: plugin.manifest,
          };
        },
      },
    ] as const;

    runScenarioCases(scenarios, (scenario) => {
      const loadedScenario = scenario.loadRegistry();
      const expectedSource =
        "expectedSource" in loadedScenario && typeof loadedScenario.expectedSource === "string"
          ? loadedScenario.expectedSource
          : undefined;
      expectLoadedPluginProvenance({
        scenario,
        ...loadedScenario,
        expectedSource,
      });
    });
  });

  it("allows bundled plugin manifests that are hardlinked aliases", () => {
    if (process.platform === "win32") {
      return;
    }
    const bundledDir = makeTempDir();
    const pluginDir = path.join(bundledDir, "hardlinked-bundled");
    mkdirSafe(pluginDir);

    const outsideDir = makeTempDir();
    const outsideManifest = path.join(outsideDir, "crawclaw.plugin.json");
    fs.writeFileSync(
      outsideManifest,
      JSON.stringify({
        id: "hardlinked-bundled",
        native: nativePluginDescriptor("hardlinked-bundled"),
        configSchema: EMPTY_PLUGIN_SCHEMA,
      }),
      "utf-8",
    );
    const plugin = writePlugin({
      id: "hardlinked-bundled",
      body: 'module.exports = { id: "hardlinked-bundled" };',
      dir: pluginDir,
      filename: "index.cjs",
    });
    fs.rmSync(plugin.manifest);
    try {
      fs.linkSync(outsideManifest, plugin.manifest);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "EXDEV") {
        return;
      }
      throw err;
    }

    process.env.CRAWCLAW_BUNDLED_PLUGINS_DIR = bundledDir;
    const registry = loadCrawClawPlugins({
      cache: false,
      workspaceDir: bundledDir,
      config: {
        plugins: {
          entries: {
            "hardlinked-bundled": { enabled: true },
          },
          allow: ["hardlinked-bundled"],
        },
      },
    });

    const record = registry.plugins.find((entry) => entry.id === "hardlinked-bundled");
    expect(record?.status).toBe("loaded");
    expect(registry.diagnostics.some((entry) => entry.message.includes("unsafe plugin path"))).toBe(
      false,
    );
  });
});

describe("getCompatibleActivePluginRegistry", () => {
  it("reuses the active registry only when the load context cache key matches", () => {
    const registry = createEmptyPluginRegistry();
    const loadOptions = {
      config: {
        plugins: {
          allow: ["demo"],
          load: { paths: ["/tmp/demo.js"] },
        },
      },
      workspaceDir: "/tmp/workspace-a",
    };
    const { cacheKey } = __testing.resolvePluginLoadCacheContext(loadOptions);
    setActivePluginRegistry(registry, cacheKey);

    expect(__testing.getCompatibleActivePluginRegistry(loadOptions)).toBe(registry);
    expect(
      __testing.getCompatibleActivePluginRegistry({
        ...loadOptions,
        workspaceDir: "/tmp/workspace-b",
      }),
    ).toBeUndefined();
    expect(
      __testing.getCompatibleActivePluginRegistry({
        ...loadOptions,
        onlyPluginIds: ["demo"],
      }),
    ).toBeUndefined();
  });

  it("does not embed activation secrets in the loader cache key", () => {
    const { cacheKey } = __testing.resolvePluginLoadCacheContext({
      config: {
        plugins: {
          allow: ["feishu"],
        },
      },
      activationSourceConfig: {
        plugins: {
          entries: {
            feishu: {
              config: {
                botToken: "secret-token",
              },
            },
          },
        },
      },
      autoEnabledReasons: {
        feishu: ["feishu configured"],
      },
    });

    expect(cacheKey).not.toContain("secret-token");
    expect(cacheKey).not.toContain("botToken");
    expect(cacheKey).not.toContain("feishu configured");
  });

  it("falls back to the current active runtime when no compatibility-shaping inputs are supplied", () => {
    const registry = createEmptyPluginRegistry();
    setActivePluginRegistry(registry, "startup-registry");

    expect(__testing.getCompatibleActivePluginRegistry()).toBe(registry);
  });

  it("reuses the active registry when compatibility-shaping inputs match", () => {
    const registry = createEmptyPluginRegistry();
    const loadOptions = {
      config: {
        plugins: {
          allow: ["demo"],
          load: { paths: ["/tmp/demo.js"] },
        },
      },
      workspaceDir: "/tmp/workspace-a",
    };
    const { cacheKey } = __testing.resolvePluginLoadCacheContext(loadOptions);
    setActivePluginRegistry(registry, cacheKey);

    expect(__testing.getCompatibleActivePluginRegistry(loadOptions)).toBe(registry);
  });
});

describe("resolveRuntimePluginRegistry", () => {
  it("reuses the compatible active registry before attempting a fresh load", () => {
    const registry = createEmptyPluginRegistry();
    const loadOptions = {
      config: {
        plugins: {
          allow: ["demo"],
        },
      },
      workspaceDir: "/tmp/workspace-a",
    };
    const { cacheKey } = __testing.resolvePluginLoadCacheContext(loadOptions);
    setActivePluginRegistry(registry, cacheKey);

    expect(resolveRuntimePluginRegistry(loadOptions)).toBe(registry);
  });

  it("falls back to the current active runtime when no explicit load context is provided", () => {
    const registry = createEmptyPluginRegistry();
    setActivePluginRegistry(registry, "startup-registry");

    expect(resolveRuntimePluginRegistry()).toBe(registry);
  });
});

describe("clearPluginLoaderCache", () => {
  it("clears cached registries without throwing", () => {
    expect(() => clearPluginLoaderCache()).not.toThrow();
  });
});
