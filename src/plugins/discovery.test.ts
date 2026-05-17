import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { bundledDistPluginFile } from "../../test/helpers/bundled-plugin-paths.js";
import { clearPluginDiscoveryCache, discoverCrawClawPlugins } from "./discovery.js";
import {
  cleanupTrackedTempDirs,
  makeTrackedTempDir,
  mkdirSafeDir,
} from "./test-helpers/fs-fixtures.js";

const tempDirs: string[] = [];

function makeTempDir() {
  return makeTrackedTempDir("crawclaw-plugins", tempDirs);
}

const mkdirSafe = mkdirSafeDir;

function normalizePathForAssertion(value: string | undefined): string | undefined {
  if (!value) {
    return value;
  }
  return value.replace(/\\/g, "/");
}

function hasDiagnosticSourceSuffix(
  diagnostics: Array<{ source?: string }>,
  suffix: string,
): boolean {
  const normalizedSuffix = normalizePathForAssertion(suffix);
  return diagnostics.some((entry) =>
    normalizePathForAssertion(entry.source)?.endsWith(normalizedSuffix ?? suffix),
  );
}

function buildDiscoveryEnv(stateDir: string): NodeJS.ProcessEnv {
  return {
    CRAWCLAW_STATE_DIR: stateDir,
    CRAWCLAW_HOME: undefined,
    CRAWCLAW_BUNDLED_PLUGINS_DIR: "/nonexistent/bundled/plugins",
  };
}

function buildCachedDiscoveryEnv(
  stateDir: string,
  overrides: Partial<NodeJS.ProcessEnv> = {},
): NodeJS.ProcessEnv {
  return {
    ...buildDiscoveryEnv(stateDir),
    CRAWCLAW_PLUGIN_DISCOVERY_CACHE_MS: "5000",
    ...overrides,
  };
}

async function discoverWithStateDir(
  stateDir: string,
  params: Parameters<typeof discoverCrawClawPlugins>[0],
) {
  return discoverCrawClawPlugins({ ...params, env: buildDiscoveryEnv(stateDir) });
}

function discoverWithCachedEnv(params: Parameters<typeof discoverCrawClawPlugins>[0]) {
  return discoverCrawClawPlugins(params);
}

function writePluginPackageManifest(params: {
  packageDir: string;
  packageName: string;
  extensions: string[];
}) {
  fs.writeFileSync(
    path.join(params.packageDir, "package.json"),
    JSON.stringify({
      name: params.packageName,
      crawclaw: { extensions: params.extensions },
    }),
    "utf-8",
  );
}

function writePluginManifest(params: { pluginDir: string; id: string }) {
  fs.writeFileSync(
    path.join(params.pluginDir, "crawclaw.plugin.json"),
    JSON.stringify({
      id: params.id,
      native: {
        protocol: "crawclaw-native-plugin-jsonrpc",
        schemaVersion: 1,
        bin: `${params.id}-native`,
      },
      configSchema: { type: "object" },
    }),
    "utf-8",
  );
}

function writePluginEntry(filePath: string) {
  fs.writeFileSync(filePath, "export default function () {}", "utf-8");
}

function writeStandalonePlugin(filePath: string, source = "export default function () {}") {
  const pluginId = path.basename(filePath, path.extname(filePath));
  const pluginDir = path.join(path.dirname(filePath), pluginId);
  mkdirSafe(pluginDir);
  writePluginManifest({ pluginDir, id: pluginId });
  fs.writeFileSync(path.join(pluginDir, "removed-entry.ts"), source, "utf-8");
  return path.join(pluginDir, "crawclaw.plugin.json");
}

function createPackagePlugin(params: {
  packageDir: string;
  packageName: string;
  extensions: string[];
  pluginId?: string;
}) {
  mkdirSafe(params.packageDir);
  writePluginPackageManifest({
    packageDir: params.packageDir,
    packageName: params.packageName,
    extensions: params.extensions,
  });
  if (params.pluginId) {
    writePluginManifest({ pluginDir: params.packageDir, id: params.pluginId });
  }
}

function createPackagePluginWithEntry(params: {
  packageDir: string;
  packageName: string;
  pluginId?: string;
  entryPath?: string;
}) {
  const entryPath = params.entryPath ?? "src/plugin.ts";
  mkdirSafe(path.dirname(path.join(params.packageDir, entryPath)));
  createPackagePlugin({
    packageDir: params.packageDir,
    packageName: params.packageName,
    extensions: [`./${entryPath}`],
    ...(params.pluginId ? { pluginId: params.pluginId } : {}),
  });
  writePluginEntry(path.join(params.packageDir, entryPath));
}

function createBundleRoot(bundleDir: string, markerPath: string, manifest?: unknown) {
  mkdirSafe(path.dirname(path.join(bundleDir, markerPath)));
  if (manifest) {
    fs.writeFileSync(path.join(bundleDir, markerPath), JSON.stringify(manifest), "utf-8");
    return;
  }
  mkdirSafe(path.join(bundleDir, markerPath));
}

function expectCandidateIds(
  candidates: Array<{ idHint: string }>,
  params: { includes?: readonly string[]; excludes?: readonly string[] },
) {
  const ids = candidates.map((candidate) => candidate.idHint);
  if (params.includes?.length) {
    expect(ids).toEqual(expect.arrayContaining([...params.includes]));
  }
  params.excludes?.forEach((excludedId) => {
    expect(ids).not.toContain(excludedId);
  });
}

function findCandidateById<T extends { idHint?: string }>(candidates: T[], idHint: string) {
  return candidates.find((candidate) => candidate.idHint === idHint);
}

function expectCandidateSource(
  candidates: Array<{ idHint?: string; source?: string }>,
  idHint: string,
  source: string,
) {
  expect(findCandidateById(candidates, idHint)?.source).toBe(source);
}

function expectCandidatePresence(
  result: Awaited<ReturnType<typeof discoverCrawClawPlugins>>,
  params: { present?: readonly string[]; absent?: readonly string[] },
) {
  const ids = result.candidates.map((candidate) => candidate.idHint);
  params.present?.forEach((pluginId) => {
    expect(ids).toContain(pluginId);
  });
  params.absent?.forEach((pluginId) => {
    expect(ids).not.toContain(pluginId);
  });
}

function expectCandidateOrder(
  candidates: Array<{ idHint: string }>,
  expectedIds: readonly string[],
) {
  expect(candidates.map((candidate) => candidate.idHint)).toEqual(expectedIds);
}

function expectBundleCandidateMatch(params: {
  candidates: Array<{
    idHint?: string;
    format?: string;
    bundleFormat?: string;
    source?: string;
    rootDir?: string;
  }>;
  idHint: string;
  bundleFormat: string;
  source: string;
  expectRootDir?: boolean;
}) {
  const bundle = findCandidateById(params.candidates, params.idHint);
  expect(bundle).toBeDefined();
  expect(bundle).toEqual(
    expect.objectContaining({
      idHint: params.idHint,
      format: "bundle",
      bundleFormat: params.bundleFormat,
      source: params.source,
    }),
  );
  if (params.expectRootDir) {
    expect(normalizePathForAssertion(bundle?.rootDir)).toBe(
      normalizePathForAssertion(fs.realpathSync(params.source)),
    );
  }
}

function expectCachedDiscoveryPair(params: {
  first: ReturnType<typeof discoverWithCachedEnv>;
  second: ReturnType<typeof discoverWithCachedEnv>;
  assert: (
    first: ReturnType<typeof discoverWithCachedEnv>,
    second: ReturnType<typeof discoverWithCachedEnv>,
  ) => void;
}) {
  params.assert(params.first, params.second);
}

afterEach(() => {
  clearPluginDiscoveryCache();
  cleanupTrackedTempDirs(tempDirs);
});

describe("discoverCrawClawPlugins", () => {
  it("discovers global and workspace extensions", async () => {
    const stateDir = makeTempDir();
    const workspaceDir = path.join(stateDir, "workspace");

    const globalExt = path.join(stateDir, "extensions");
    mkdirSafe(globalExt);
    writeStandalonePlugin(path.join(globalExt, "alpha.ts"));

    const workspaceExt = path.join(workspaceDir, ".crawclaw", "extensions");
    mkdirSafe(workspaceExt);
    writeStandalonePlugin(path.join(workspaceExt, "beta.ts"));

    const { candidates } = await discoverWithStateDir(stateDir, { workspaceDir });
    expectCandidateIds(candidates, { includes: ["alpha", "beta"] });
  });

  it("resolves tilde workspace dirs against the provided env", () => {
    const stateDir = makeTempDir();
    const homeDir = makeTempDir();
    const workspaceRoot = path.join(homeDir, "workspace");
    const workspaceExt = path.join(workspaceRoot, ".crawclaw", "extensions");
    mkdirSafe(workspaceExt);
    writeStandalonePlugin(path.join(workspaceExt, "tilde-workspace.ts"), "export default {}");

    const result = discoverCrawClawPlugins({
      workspaceDir: "~/workspace",
      env: {
        ...buildDiscoveryEnv(stateDir),
        HOME: homeDir,
      },
    });

    expectCandidatePresence(result, { present: ["tilde-workspace"] });
  });

  it("ignores backup and disabled plugin directories in scanned roots", async () => {
    const stateDir = makeTempDir();
    const globalExt = path.join(stateDir, "extensions");
    mkdirSafe(globalExt);

    const backupDir = path.join(globalExt, "feishu.backup-20260222");
    mkdirSafe(backupDir);
    writePluginManifest({ pluginDir: backupDir, id: "feishu.backup-20260222" });

    const disabledDir = path.join(globalExt, "feishu.disabled.20260222");
    mkdirSafe(disabledDir);
    writePluginManifest({ pluginDir: disabledDir, id: "feishu.disabled.20260222" });

    const bakDir = path.join(globalExt, "qqbot.bak");
    mkdirSafe(bakDir);
    writePluginManifest({ pluginDir: bakDir, id: "qqbot.bak" });

    const liveDir = path.join(globalExt, "live");
    mkdirSafe(liveDir);
    writePluginManifest({ pluginDir: liveDir, id: "live" });

    const { candidates } = await discoverWithStateDir(stateDir, {});
    expectCandidateIds(candidates, {
      includes: ["live"],
      excludes: ["feishu.backup-20260222", "feishu.disabled.20260222", "qqbot.bak"],
    });
  });

  it("ignores removed package extension entry packs", async () => {
    const stateDir = makeTempDir();
    const globalExt = path.join(stateDir, "extensions", "pack");
    mkdirSafe(path.join(globalExt, "src"));

    writePluginPackageManifest({
      packageDir: globalExt,
      packageName: "pack",
      extensions: ["./src/one.ts", "./src/two.ts"],
    });
    writePluginEntry(path.join(globalExt, "src", "one.ts"));
    writePluginEntry(path.join(globalExt, "src", "two.ts"));

    const { candidates } = await discoverWithStateDir(stateDir, {});
    expectCandidateIds(candidates, { excludes: ["pack/one", "pack/two"] });
  });

  it("does not discover nested node_modules copies under installed plugins", async () => {
    const stateDir = makeTempDir();
    const pluginDir = path.join(stateDir, "extensions", "opik-crawclaw");
    const nestedDiffsDir = path.join(
      pluginDir,
      "node_modules",
      "crawclaw",
      "dist",
      "extensions",
      "diffs",
    );
    mkdirSafe(path.join(pluginDir, "src"));
    mkdirSafe(nestedDiffsDir);

    writePluginPackageManifest({
      packageDir: pluginDir,
      packageName: "@opik/opik-crawclaw",
      extensions: ["./src/plugin.ts"],
    });
    writePluginManifest({ pluginDir, id: "opik-crawclaw" });
    fs.writeFileSync(
      path.join(pluginDir, "src", "plugin.ts"),
      "export default function () {}",
      "utf-8",
    );

    writePluginPackageManifest({
      packageDir: path.join(pluginDir, "node_modules", "crawclaw"),
      packageName: "crawclaw",
      extensions: [`./${bundledDistPluginFile("diffs", "index.js")}`],
    });
    writePluginManifest({ pluginDir: nestedDiffsDir, id: "diffs" });
    fs.writeFileSync(
      path.join(nestedDiffsDir, "index.js"),
      "module.exports = { id: 'diffs' };",
      "utf-8",
    );

    const { candidates } = await discoverWithStateDir(stateDir, {});
    expectCandidateOrder(candidates, ["opik-crawclaw"]);
  });

  it.each([
    {
      name: "uses native manifest ids for scoped packages",
      setup: (stateDir: string) => {
        const packageDir = path.join(stateDir, "extensions", "demo-plugin-pack");
        createPackagePluginWithEntry({
          packageDir,
          packageName: "@crawclaw/demo-plugin",
          pluginId: "demo-plugin",
          entryPath: "src/plugin.ts",
        });
        return {};
      },
      includes: ["demo-plugin"],
    },
    {
      name: "uses native manifest ids instead of package-derived provider ids",
      setup: (stateDir: string) => {
        const packageDir = path.join(stateDir, "extensions", "ollama-provider-pack");
        createPackagePluginWithEntry({
          packageDir,
          packageName: "@crawclaw/ollama-provider",
          pluginId: "ollama",
          entryPath: "src/plugin.ts",
        });
        return {};
      },
      includes: ["ollama"],
      excludes: ["ollama-provider"],
    },
    {
      name: "uses native manifest ids for bundled speech package ids",
      setup: (stateDir: string) => {
        for (const [dirName, packageName, pluginId] of [
          ["elevenlabs-speech-pack", "@crawclaw/elevenlabs-speech", "elevenlabs"],
          ["microsoft-speech-pack", "@crawclaw/microsoft-speech", "microsoft"],
        ] as const) {
          const packageDir = path.join(stateDir, "extensions", dirName);
          createPackagePluginWithEntry({
            packageDir,
            packageName,
            pluginId,
            entryPath: "src/plugin.ts",
          });
        }
        return {};
      },
      includes: ["elevenlabs", "microsoft"],
      excludes: ["elevenlabs-speech", "microsoft-speech"],
    },
    {
      name: "treats configured directory paths as plugin packages",
      setup: (stateDir: string) => {
        const packageDir = path.join(stateDir, "packs", "demo-plugin-dir");
        createPackagePluginWithEntry({
          packageDir,
          packageName: "@crawclaw/demo-plugin-dir",
          pluginId: "demo-plugin-dir",
          entryPath: "index.js",
        });
        return { extraPaths: [packageDir] };
      },
      includes: ["demo-plugin-dir"],
    },
  ] as const)("$name", async ({ setup, includes, excludes }) => {
    const stateDir = makeTempDir();
    const discoverParams = setup(stateDir);
    const { candidates } = await discoverWithStateDir(stateDir, discoverParams);
    expectCandidateIds(candidates, { includes, excludes });
  });

  it("skips package default index discovery when crawclaw extensions is explicitly empty", async () => {
    const stateDir = makeTempDir();
    const packageDir = path.join(stateDir, "extensions", "retired-speech");
    mkdirSafe(packageDir);
    writePluginPackageManifest({
      packageDir,
      packageName: "@crawclaw/retired-speech",
      extensions: [],
    });
    writePluginEntry(path.join(packageDir, "index.ts"));

    const { candidates } = await discoverWithStateDir(stateDir, {});

    expect(candidates.map((candidate) => candidate.idHint)).not.toContain("retired-speech");
  });

  it.each([
    {
      name: "auto-detects Codex bundles as bundle candidates",
      idHint: "sample-bundle",
      bundleFormat: "codex",
      setup: (stateDir: string) => {
        const bundleDir = path.join(stateDir, "extensions", "sample-bundle");
        createBundleRoot(bundleDir, ".codex-plugin/plugin.json", {
          name: "Sample Bundle",
          skills: "skills",
        });
        mkdirSafe(path.join(bundleDir, "skills"));
        return bundleDir;
      },
      expectRootDir: true,
    },
    {
      name: "auto-detects manifestless Claude bundles from the default layout",
      idHint: "claude-bundle",
      bundleFormat: "claude",
      setup: (stateDir: string) => {
        const bundleDir = path.join(stateDir, "extensions", "claude-bundle");
        mkdirSafe(path.join(bundleDir, "commands"));
        fs.writeFileSync(
          path.join(bundleDir, "settings.json"),
          '{"hideThinkingBlock":true}',
          "utf-8",
        );
        return bundleDir;
      },
    },
    {
      name: "auto-detects Cursor bundles as bundle candidates",
      idHint: "cursor-bundle",
      bundleFormat: "cursor",
      setup: (stateDir: string) => {
        const bundleDir = path.join(stateDir, "extensions", "cursor-bundle");
        createBundleRoot(bundleDir, ".cursor-plugin/plugin.json", {
          name: "Cursor Bundle",
        });
        mkdirSafe(path.join(bundleDir, ".cursor", "commands"));
        return bundleDir;
      },
    },
  ] as const)("$name", async ({ idHint, bundleFormat, setup, expectRootDir }) => {
    const stateDir = makeTempDir();
    const bundleDir = setup(stateDir);
    const { candidates } = await discoverWithStateDir(stateDir, {});

    expectBundleCandidateMatch({
      candidates,
      idHint,
      bundleFormat,
      source: bundleDir,
      expectRootDir,
    });
  });

  it.each([
    {
      name: "does not fall back to removed index discovery when a scanned bundle sidecar is malformed",
      bundleMarker: ".claude-plugin/plugin.json",
      setup: (stateDir: string) => {
        const pluginDir = path.join(stateDir, "extensions", "legacy-with-bad-bundle");
        mkdirSafe(path.dirname(path.join(pluginDir, ".claude-plugin", "plugin.json")));
        fs.writeFileSync(path.join(pluginDir, "index.ts"), "export default {}", "utf-8");
        fs.writeFileSync(path.join(pluginDir, ".claude-plugin", "plugin.json"), "{", "utf-8");
        return {};
      },
    },
    {
      name: "does not fall back to removed index discovery for configured paths with malformed bundle sidecars",
      bundleMarker: ".codex-plugin/plugin.json",
      setup: (stateDir: string) => {
        const pluginDir = path.join(stateDir, "plugins", "legacy-with-bad-bundle");
        mkdirSafe(path.dirname(path.join(pluginDir, ".codex-plugin", "plugin.json")));
        fs.writeFileSync(path.join(pluginDir, "index.ts"), "export default {}", "utf-8");
        fs.writeFileSync(path.join(pluginDir, ".codex-plugin", "plugin.json"), "{", "utf-8");
        return { extraPaths: [pluginDir] };
      },
    },
  ] as const)("$name", async ({ setup, bundleMarker }) => {
    const stateDir = makeTempDir();
    const result = await discoverWithStateDir(stateDir, setup(stateDir));
    const legacy = findCandidateById(result.candidates, "legacy-with-bad-bundle");

    expect(legacy).toBeUndefined();
    expect(hasDiagnosticSourceSuffix(result.diagnostics, bundleMarker)).toBe(true);
  });

  it("ignores removed package extension entries without resolving their paths", async () => {
    const stateDir = makeTempDir();
    const globalExt = path.join(stateDir, "extensions", "escape-pack");
    mkdirSafe(globalExt);
    writePluginPackageManifest({
      packageDir: globalExt,
      packageName: "@crawclaw/escape-pack",
      extensions: ["../../outside.js"],
    });

    const result = await discoverWithStateDir(stateDir, {});

    expect(result.candidates).toHaveLength(0);
    expect(result.diagnostics).toEqual([]);
  });

  it("ignores package manifests that are hardlinked aliases", async () => {
    if (process.platform === "win32") {
      return;
    }
    const stateDir = makeTempDir();
    const globalExt = path.join(stateDir, "extensions", "pack");
    const outsideDir = path.join(stateDir, "outside");
    const outsideManifest = path.join(outsideDir, "package.json");
    const linkedManifest = path.join(globalExt, "package.json");
    mkdirSafe(globalExt);
    mkdirSafe(outsideDir);
    fs.writeFileSync(path.join(globalExt, "entry.ts"), "export default {}", "utf-8");
    fs.writeFileSync(
      outsideManifest,
      JSON.stringify({
        name: "@crawclaw/pack",
        crawclaw: { extensions: ["./entry.ts"] },
      }),
      "utf-8",
    );
    try {
      fs.linkSync(outsideManifest, linkedManifest);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "EXDEV") {
        return;
      }
      throw err;
    }

    const { candidates } = await discoverWithStateDir(stateDir, {});

    expect(candidates.some((candidate) => candidate.idHint === "pack")).toBe(false);
  });

  it.runIf(process.platform !== "win32")("blocks world-writable plugin paths", async () => {
    const stateDir = makeTempDir();
    const globalExt = path.join(stateDir, "extensions");
    mkdirSafe(globalExt);
    const pluginPath = path.join(globalExt, "world-open");
    mkdirSafe(pluginPath);
    writePluginManifest({ pluginDir: pluginPath, id: "world-open" });
    fs.chmodSync(pluginPath, 0o777);

    const result = await discoverWithStateDir(stateDir, {});

    expect(result.candidates).toHaveLength(0);
    expect(result.diagnostics.some((diag) => diag.message.includes("world-writable path"))).toBe(
      true,
    );
  });

  it.runIf(process.platform !== "win32")(
    "repairs world-writable bundled plugin dirs before loading them",
    async () => {
      const stateDir = makeTempDir();
      const bundledDir = path.join(stateDir, "bundled");
      const packDir = path.join(bundledDir, "demo-pack");
      mkdirSafe(packDir);
      writePluginManifest({ pluginDir: packDir, id: "demo-pack" });
      fs.chmodSync(packDir, 0o777);

      const result = discoverCrawClawPlugins({
        env: {
          ...process.env,
          CRAWCLAW_STATE_DIR: stateDir,
          CRAWCLAW_BUNDLED_PLUGINS_DIR: bundledDir,
        },
      });

      expect(result.candidates.some((candidate) => candidate.idHint === "demo-pack")).toBe(true);
      expect(
        result.diagnostics.some(
          (diag) => diag.source === packDir && diag.message.includes("world-writable path"),
        ),
      ).toBe(false);
      expect(fs.statSync(packDir).mode & 0o777).toBe(0o755);
    },
  );

  it.runIf(process.platform !== "win32" && typeof process.getuid === "function")(
    "blocks suspicious ownership when uid mismatch is detected",
    async () => {
      const stateDir = makeTempDir();
      const globalExt = path.join(stateDir, "extensions");
      mkdirSafe(globalExt);
      const pluginPath = path.join(globalExt, "owner-mismatch");
      mkdirSafe(pluginPath);
      writePluginManifest({ pluginDir: pluginPath, id: "owner-mismatch" });

      const actualUid = (process as NodeJS.Process & { getuid: () => number }).getuid();
      const result = await discoverWithStateDir(stateDir, { ownershipUid: actualUid + 1 });
      const shouldBlockForMismatch = actualUid !== 0;
      expect(result.candidates).toHaveLength(shouldBlockForMismatch ? 0 : 1);
      expect(result.diagnostics.some((diag) => diag.message.includes("suspicious ownership"))).toBe(
        shouldBlockForMismatch,
      );
    },
  );

  it("reuses discovery results from cache until cleared", async () => {
    const stateDir = makeTempDir();
    const globalExt = path.join(stateDir, "extensions");
    mkdirSafe(globalExt);
    const pluginPath = path.join(globalExt, "cached");
    mkdirSafe(pluginPath);
    writePluginManifest({ pluginDir: pluginPath, id: "cached" });

    const cachedEnv = buildCachedDiscoveryEnv(stateDir);
    const first = discoverWithCachedEnv({ env: cachedEnv });
    expect(first.candidates.some((candidate) => candidate.idHint === "cached")).toBe(true);

    fs.rmSync(pluginPath, { force: true, recursive: true });

    const second = discoverWithCachedEnv({ env: cachedEnv });
    expect(second.candidates.some((candidate) => candidate.idHint === "cached")).toBe(true);

    clearPluginDiscoveryCache();

    const third = discoverWithCachedEnv({ env: cachedEnv });
    expect(third.candidates.some((candidate) => candidate.idHint === "cached")).toBe(false);
  });

  it.each([
    {
      name: "does not reuse discovery results across env root changes",
      setup: () => {
        const stateDirA = makeTempDir();
        const stateDirB = makeTempDir();
        writeStandalonePlugin(path.join(stateDirA, "extensions", "alpha.ts"));
        writeStandalonePlugin(path.join(stateDirB, "extensions", "beta.ts"));
        return {
          first: discoverWithCachedEnv({ env: buildCachedDiscoveryEnv(stateDirA) }),
          second: discoverWithCachedEnv({ env: buildCachedDiscoveryEnv(stateDirB) }),
          assert: (
            first: ReturnType<typeof discoverWithCachedEnv>,
            second: ReturnType<typeof discoverWithCachedEnv>,
          ) => {
            expectCandidatePresence(first, { present: ["alpha"], absent: ["beta"] });
            expectCandidatePresence(second, { present: ["beta"], absent: ["alpha"] });
          },
        };
      },
    },
    {
      name: "does not reuse extra-path discovery across env home changes",
      setup: () => {
        const stateDir = makeTempDir();
        const homeA = makeTempDir();
        const homeB = makeTempDir();
        const pluginA = path.join(homeA, "plugins", "demo");
        const pluginB = path.join(homeB, "plugins", "demo");
        const manifestA = writeStandalonePlugin(pluginA, "export default {}");
        const manifestB = writeStandalonePlugin(pluginB, "export default {}");
        return {
          first: discoverWithCachedEnv({
            extraPaths: ["~/plugins/demo"],
            env: buildCachedDiscoveryEnv(stateDir, { HOME: homeA }),
          }),
          second: discoverWithCachedEnv({
            extraPaths: ["~/plugins/demo"],
            env: buildCachedDiscoveryEnv(stateDir, { HOME: homeB }),
          }),
          assert: (
            first: ReturnType<typeof discoverWithCachedEnv>,
            second: ReturnType<typeof discoverWithCachedEnv>,
          ) => {
            expectCandidateSource(first.candidates, "demo", manifestA);
            expectCandidateSource(second.candidates, "demo", manifestB);
          },
        };
      },
    },
  ] as const)("$name", ({ setup }) => {
    const { first, second, assert } = setup();
    expectCachedDiscoveryPair({ first, second, assert });
  });

  it("treats configured load-path order as cache-significant", () => {
    const stateDir = makeTempDir();
    const pluginA = path.join(stateDir, "plugins", "alpha");
    const pluginB = path.join(stateDir, "plugins", "beta");
    writeStandalonePlugin(pluginA, "export default {}");
    writeStandalonePlugin(pluginB, "export default {}");

    const env = buildCachedDiscoveryEnv(stateDir);

    const first = discoverWithCachedEnv({
      extraPaths: [pluginA, pluginB],
      env,
    });
    const second = discoverWithCachedEnv({
      extraPaths: [pluginB, pluginA],
      env,
    });

    expectCandidateOrder(first.candidates, ["alpha", "beta"]);
    expectCandidateOrder(second.candidates, ["beta", "alpha"]);
  });
});
