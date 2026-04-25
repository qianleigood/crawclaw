import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, describe, expect, it, vi } from "vitest";
import {
  bundledDistPluginFile,
  bundledPluginFile,
  bundledPluginRoot,
} from "../../test/helpers/bundled-plugin-paths.js";
import { withEnv } from "../test-utils/env.js";
import {
  buildPluginLoaderAliasMap,
  buildPluginLoaderJitiOptions,
  listPluginSdkAliasCandidates,
  listPluginSdkExportedSubpaths,
  resolvePluginRuntimeModulePath,
  resolvePluginSdkAliasFile,
  shouldPreferNativeJiti,
} from "./sdk-alias.js";
import { makeTrackedTempDir, mkdirSafeDir } from "./test-helpers/fs-fixtures.js";

type CreateJiti = typeof import("jiti").createJiti;

let createJitiPromise: Promise<CreateJiti> | undefined;

async function getCreateJiti() {
  createJitiPromise ??= import("jiti").then(({ createJiti }) => createJiti);
  return createJitiPromise;
}

const fixtureTempDirs: string[] = [];
const fixtureRoot = makeTrackedTempDir("crawclaw-sdk-alias-root", fixtureTempDirs);
let tempDirIndex = 0;

function makeTempDir() {
  const dir = path.join(fixtureRoot, `case-${tempDirIndex++}`);
  mkdirSafeDir(dir);
  return dir;
}

function withCwd<T>(cwd: string, run: () => T): T {
  const cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(cwd);
  try {
    return run();
  } finally {
    cwdSpy.mockRestore();
  }
}

function createPluginSdkFixture(params?: {
  trustedRootIndicatorMode?: "bin+marker" | "cli-entry-only" | "none";
  packageExports?: Record<string, unknown>;
  entries?: Record<string, { src?: string; dist?: string }>;
}) {
  const root = makeTempDir();
  const trustedRootIndicatorMode = params?.trustedRootIndicatorMode ?? "bin+marker";
  const packageJson: Record<string, unknown> = {
    name: "crawclaw",
    type: "module",
  };
  if (trustedRootIndicatorMode === "bin+marker") {
    packageJson.bin = { crawclaw: "crawclaw.mjs" };
  }
  packageJson.exports = {
    ...(trustedRootIndicatorMode === "cli-entry-only"
      ? { "./cli-entry": { default: "./dist/cli-entry.js" } }
      : {}),
    "./plugin-sdk/core": { default: "./dist/plugin-sdk/core.js" },
    "./plugin-sdk/channel-id": { default: "./dist/plugin-sdk/channel-id.js" },
    ...params?.packageExports,
  };
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify(packageJson, null, 2), "utf-8");
  if (trustedRootIndicatorMode === "bin+marker") {
    fs.writeFileSync(path.join(root, "crawclaw.mjs"), "export {};\n", "utf-8");
  }

  const entries = params?.entries ?? {
    core: { src: "export const core = 'src';\n", dist: "export const core = 'dist';\n" },
    "channel-id": {
      src: "export const normalizeChannelId = () => 'src';\n",
      dist: "export const normalizeChannelId = () => 'dist';\n",
    },
  };

  const createdEntries = Object.fromEntries(
    Object.entries(entries).map(([name, value]) => {
      const srcFile = path.join(root, "src", "plugin-sdk", `${name}.ts`);
      const distFile = path.join(root, "dist", "plugin-sdk", `${name}.js`);
      mkdirSafeDir(path.dirname(srcFile));
      mkdirSafeDir(path.dirname(distFile));
      fs.writeFileSync(srcFile, value.src ?? "export {};\n", "utf-8");
      fs.writeFileSync(distFile, value.dist ?? "export {};\n", "utf-8");
      return [name, { srcFile, distFile }];
    }),
  ) as Record<string, { srcFile: string; distFile: string }>;

  return { root, entries: createdEntries };
}

function createPluginRuntimeFixture(params?: { srcBody?: string; distBody?: string }) {
  const root = makeTempDir();
  const srcFile = path.join(root, "src", "plugins", "runtime", "index.ts");
  const distFile = path.join(root, "dist", "plugins", "runtime", "index.js");
  mkdirSafeDir(path.dirname(srcFile));
  mkdirSafeDir(path.dirname(distFile));
  fs.writeFileSync(
    path.join(root, "package.json"),
    JSON.stringify({ name: "crawclaw", type: "module" }, null, 2),
    "utf-8",
  );
  fs.writeFileSync(path.join(root, "crawclaw.mjs"), "export {};\n", "utf-8");
  fs.writeFileSync(
    srcFile,
    params?.srcBody ?? "export const createPluginRuntime = () => ({});\n",
    "utf-8",
  );
  fs.writeFileSync(
    distFile,
    params?.distBody ?? "export const createPluginRuntime = () => ({});\n",
    "utf-8",
  );
  return { root, srcFile, distFile };
}

function writePluginEntry(root: string, relativePath: string) {
  const pluginEntry = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(pluginEntry), { recursive: true });
  fs.writeFileSync(pluginEntry, 'export const plugin = "demo";\n', "utf-8");
  return pluginEntry;
}

function createUserInstalledPluginFixture() {
  const fixture = createPluginSdkFixture();
  const externalPluginRoot = path.join(makeTempDir(), ".crawclaw", "extensions", "demo");
  const externalPluginEntry = path.join(externalPluginRoot, "index.ts");
  mkdirSafeDir(externalPluginRoot);
  fs.writeFileSync(externalPluginEntry, 'export const plugin = "demo";\n', "utf-8");
  return { fixture, externalPluginRoot, externalPluginEntry };
}

afterAll(() => {
  fs.rmSync(fixtureRoot, { recursive: true, force: true });
});

describe("plugin sdk alias helpers", () => {
  it("prefers dist or src subpath files based on the caller runtime", () => {
    const fixture = createPluginSdkFixture();
    const channelIdEntry = fixture.entries["channel-id"];

    const distResolved = withEnv({ NODE_ENV: "production", VITEST: undefined }, () =>
      resolvePluginSdkAliasFile({
        srcFile: "channel-id.ts",
        distFile: "channel-id.js",
        modulePath: path.join(fixture.root, "dist", "plugins", "loader.js"),
      }),
    );
    expect(distResolved).toBe(channelIdEntry.distFile);

    const srcResolved = withEnv({ NODE_ENV: undefined }, () =>
      resolvePluginSdkAliasFile({
        srcFile: "channel-id.ts",
        distFile: "channel-id.js",
        modulePath: path.join(fixture.root, "src", "plugins", "loader.ts"),
      }),
    );
    expect(srcResolved).toBe(channelIdEntry.srcFile);
  });

  it("orders alias candidates based on runtime preference", () => {
    const fixture = createPluginSdkFixture();
    const channelIdEntry = fixture.entries["channel-id"];
    const candidates = withEnv({ NODE_ENV: "production", VITEST: undefined }, () =>
      listPluginSdkAliasCandidates({
        srcFile: "channel-id.ts",
        distFile: "channel-id.js",
        modulePath: path.join(fixture.root, "src", "plugins", "loader.ts"),
      }),
    );

    expect(candidates.indexOf(channelIdEntry.distFile)).toBeLessThan(
      candidates.indexOf(channelIdEntry.srcFile),
    );
  });

  it("derives exported subpaths only from safe plugin-sdk package exports", () => {
    const fixture = createPluginSdkFixture({
      packageExports: {
        "./plugin-sdk/nested/value": { default: "./dist/plugin-sdk/nested/value.js" },
        "./plugin-sdk/..\\..\\evil": { default: "./dist/plugin-sdk/evil.js" },
        "./plugin-sdk/.hidden": { default: "./dist/plugin-sdk/hidden.js" },
      },
    });

    const subpaths = listPluginSdkExportedSubpaths({
      modulePath: path.join(fixture.root, "src", "plugins", "loader.ts"),
    });
    expect(subpaths).toEqual(["channel-id", "core"]);
  });

  it("requires a trusted CrawClaw root for cwd fallback subpath discovery", () => {
    const untrustedFixture = createPluginSdkFixture({
      trustedRootIndicatorMode: "none",
    });
    const untrusted = withCwd(untrustedFixture.root, () =>
      listPluginSdkExportedSubpaths({ modulePath: "/tmp/tsx-cache/crawclaw-loader.js" }),
    );
    expect(untrusted).toEqual([]);

    const trustedFixture = createPluginSdkFixture({
      trustedRootIndicatorMode: "cli-entry-only",
    });
    const trusted = withCwd(trustedFixture.root, () =>
      listPluginSdkExportedSubpaths({ modulePath: "/tmp/tsx-cache/crawclaw-loader.js" }),
    );
    expect(trusted).toEqual(["channel-id", "core"]);
  });

  it("builds only scoped plugin-sdk aliases for the module being loaded", () => {
    const fixture = createPluginSdkFixture();
    const sourcePluginEntry = writePluginEntry(
      fixture.root,
      bundledPluginFile("demo", "src/index.ts"),
    );
    const distPluginEntry = writePluginEntry(
      fixture.root,
      bundledDistPluginFile("demo", "index.js"),
    );

    const srcAliases = withEnv({ NODE_ENV: undefined }, () =>
      buildPluginLoaderAliasMap(sourcePluginEntry),
    );
    expect(srcAliases["crawclaw/plugin-sdk"]).toBeUndefined();
    expect(srcAliases["crawclaw/extension-api"]).toBeUndefined();
    expect(srcAliases["crawclaw/plugin-sdk/channel-id"]).toBe(
      fixture.entries["channel-id"].srcFile,
    );
    expect(srcAliases["crawclaw/plugin-sdk/core"]).toBe(fixture.entries.core.srcFile);

    const distAliases = withEnv({ NODE_ENV: undefined }, () =>
      buildPluginLoaderAliasMap(distPluginEntry),
    );
    expect(distAliases["crawclaw/plugin-sdk/channel-id"]).toBe(
      fixture.entries["channel-id"].distFile,
    );
    expect(distAliases["crawclaw/plugin-sdk/core"]).toBe(fixture.entries.core.distFile);
  });

  it("resolves scoped aliases for user-installed plugins via argv and moduleUrl hints", () => {
    const { fixture, externalPluginRoot, externalPluginEntry } = createUserInstalledPluginFixture();

    const viaArgv = withCwd(externalPluginRoot, () =>
      withEnv({ NODE_ENV: undefined }, () =>
        buildPluginLoaderAliasMap(externalPluginEntry, path.join(fixture.root, "crawclaw.mjs")),
      ),
    );
    expect(viaArgv["crawclaw/plugin-sdk/channel-id"]).toBe(fixture.entries["channel-id"].srcFile);

    const loaderModuleUrl = pathToFileURL(path.join(fixture.root, "crawclaw.mjs")).href;
    const viaModuleUrl = withCwd(externalPluginRoot, () =>
      withEnv({ NODE_ENV: undefined }, () =>
        buildPluginLoaderAliasMap(externalPluginEntry, "", loaderModuleUrl),
      ),
    );
    expect(viaModuleUrl["crawclaw/plugin-sdk/channel-id"]).toBe(
      fixture.entries["channel-id"].srcFile,
    );
  });

  it("configures the plugin loader jiti boundary to prefer native dist modules", () => {
    const options = buildPluginLoaderJitiOptions({});

    expect(options.tryNative).toBe(true);
    expect(options.interopDefault).toBe(true);
    expect(options.extensions).toContain(".js");
    expect(options.extensions).toContain(".ts");
    expect("alias" in options).toBe(false);
  });

  it("uses transpiled Jiti loads for source TypeScript plugin entries", () => {
    expect(shouldPreferNativeJiti("/repo/dist/plugins/runtime/index.js")).toBe(true);
    expect(
      shouldPreferNativeJiti(`/repo/${bundledPluginFile("discord", "src/channel.runtime.ts")}`),
    ).toBe(false);
  });

  it("disables native Jiti loads under Bun even for built JavaScript entries", () => {
    const originalVersions = process.versions;
    Object.defineProperty(process, "versions", {
      configurable: true,
      value: {
        ...originalVersions,
        bun: "1.2.0",
      },
    });

    try {
      expect(shouldPreferNativeJiti("/repo/dist/plugins/runtime/index.js")).toBe(false);
      expect(shouldPreferNativeJiti(`/repo/${bundledDistPluginFile("browser", "index.js")}`)).toBe(
        false,
      );
    } finally {
      Object.defineProperty(process, "versions", {
        configurable: true,
        value: originalVersions,
      });
    }
  });

  it("loads source runtime shims through scoped plugin-sdk aliases", async () => {
    const copiedExtensionRoot = path.join(makeTempDir(), bundledPluginRoot("discord"));
    const copiedSourceDir = path.join(copiedExtensionRoot, "src");
    const copiedPluginSdkDir = path.join(copiedExtensionRoot, "plugin-sdk");
    mkdirSafeDir(copiedSourceDir);
    mkdirSafeDir(copiedPluginSdkDir);
    const jitiBaseFile = path.join(copiedSourceDir, "__jiti-base__.mjs");
    fs.writeFileSync(jitiBaseFile, "export {};\n", "utf-8");
    fs.writeFileSync(
      path.join(copiedSourceDir, "channel.runtime.ts"),
      `import { resolveOutboundSendDep } from "crawclaw/plugin-sdk/infra-runtime";

export const syntheticRuntimeMarker = {
  resolveOutboundSendDep,
};
`,
      "utf-8",
    );
    const copiedInfraRuntimeShim = path.join(copiedPluginSdkDir, "infra-runtime.ts");
    fs.writeFileSync(
      copiedInfraRuntimeShim,
      `export function resolveOutboundSendDep() {
  return "shimmed";
}
`,
      "utf-8",
    );
    const copiedChannelRuntime = path.join(copiedExtensionRoot, "src", "channel.runtime.ts");
    const jitiBaseUrl = pathToFileURL(jitiBaseFile).href;

    const createJiti = await getCreateJiti();
    const withoutAlias = createJiti(jitiBaseUrl, {
      ...buildPluginLoaderJitiOptions({}),
      tryNative: false,
    });
    expect(() => withoutAlias(copiedChannelRuntime)).toThrow();

    const withAlias = createJiti(jitiBaseUrl, {
      ...buildPluginLoaderJitiOptions({
        "crawclaw/plugin-sdk/infra-runtime": copiedInfraRuntimeShim,
      }),
      tryNative: false,
    });
    expect(withAlias(copiedChannelRuntime)).toMatchObject({
      syntheticRuntimeMarker: {
        resolveOutboundSendDep: expect.any(Function),
      },
    });
  }, 240_000);

  it("resolves plugin runtime modules from dist or source roots", () => {
    const fixture = createPluginRuntimeFixture();

    const distResolved = resolvePluginRuntimeModulePath({
      modulePath: path.join(fixture.root, "dist", "plugins", "loader.js"),
    });
    expect(distResolved).toBe(fixture.distFile);

    const srcResolved = withEnv({ NODE_ENV: undefined }, () =>
      resolvePluginRuntimeModulePath({
        modulePath: "/tmp/tsx-cache/crawclaw-loader.js",
        argv1: path.join(fixture.root, "crawclaw.mjs"),
      }),
    );
    expect(srcResolved).toBe(fixture.srcFile);
  });
});
