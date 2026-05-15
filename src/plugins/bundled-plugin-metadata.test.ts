import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  clearBundledPluginMetadataCache,
  listBundledPluginMetadata,
  resolveBundledPluginGeneratedPath,
} from "./bundled-plugin-metadata.js";
import {
  createGeneratedPluginTempRoot,
  installGeneratedPluginTempRootCleanup,
  pluginTestRepoRoot as repoRoot,
  writeJson,
} from "./generated-plugin-test-helpers.js";

const BUNDLED_PLUGIN_METADATA_TEST_TIMEOUT_MS = 300_000;

installGeneratedPluginTempRootCleanup();

function expectTestOnlyArtifactsExcluded(artifacts: readonly string[]) {
  artifacts.forEach((artifact) => {
    expect(artifact).not.toMatch(/^test-/);
    expect(artifact).not.toContain(".test-");
    expect(artifact).not.toMatch(/\.test\.js$/);
  });
}

function expectGeneratedPathResolution(tempRoot: string, expectedRelativePath: string) {
  expect(
    resolveBundledPluginGeneratedPath(tempRoot, {
      source: "plugin/index.ts",
      built: "plugin/index.js",
    }),
  ).toBe(path.join(tempRoot, expectedRelativePath));
}

describe("bundled plugin metadata", () => {
  it(
    "matches the runtime metadata snapshot",
    { timeout: BUNDLED_PLUGIN_METADATA_TEST_TIMEOUT_MS },
    () => {
      expect(listBundledPluginMetadata({ rootDir: repoRoot })).toEqual(listBundledPluginMetadata());
    },
  );

  it("captures native-only bundled plugins without TS entrypoints", () => {
    const lobster = listBundledPluginMetadata().find((entry) => entry.dirName === "lobster");
    expect(lobster?.source).toEqual({
      source: "./crawclaw.plugin.json",
      built: "crawclaw.plugin.json",
    });
    expect(lobster?.publicSurfaceArtifacts).toBeUndefined();
    expect(lobster?.manifest.contracts?.tools).toEqual(["lobster"]);
  });

  it("excludes test-only public surface artifacts", () => {
    listBundledPluginMetadata().forEach((entry) =>
      expectTestOnlyArtifactsExcluded(entry.publicSurfaceArtifacts ?? []),
    );
  });

  it("prefers built generated paths when present and falls back to source paths", () => {
    const tempRoot = createGeneratedPluginTempRoot("crawclaw-bundled-plugin-metadata-");

    fs.mkdirSync(path.join(tempRoot, "plugin"), { recursive: true });
    fs.writeFileSync(path.join(tempRoot, "plugin", "index.ts"), "export {};\n", "utf8");
    expectGeneratedPathResolution(tempRoot, path.join("plugin", "index.ts"));

    fs.writeFileSync(path.join(tempRoot, "plugin", "index.js"), "export {};\n", "utf8");
    expectGeneratedPathResolution(tempRoot, path.join("plugin", "index.js"));
  });

  it("merges runtime channel schema metadata with manifest-owned channel config fields", () => {
    const tempRoot = createGeneratedPluginTempRoot("crawclaw-bundled-plugin-channel-configs-");

    writeJson(path.join(tempRoot, "extensions", "alpha", "package.json"), {
      name: "@crawclaw/alpha",
      version: "0.0.1",
      crawclaw: {
        extensions: ["./index.ts"],
        channel: {
          id: "alpha",
          label: "Alpha Root Label",
          blurb: "Alpha Root Description",
          preferOver: ["alpha-legacy"],
        },
      },
    });
    writeJson(path.join(tempRoot, "extensions", "alpha", "crawclaw.plugin.json"), {
      id: "alpha",
      channels: ["alpha"],
      configSchema: { type: "object" },
      channelConfigs: {
        alpha: {
          schema: { type: "object", properties: { stale: { type: "boolean" } } },
          label: "Manifest Label",
          uiHints: {
            "channels.alpha.explicitOnly": {
              help: "manifest hint",
            },
          },
        },
      },
    });
    fs.writeFileSync(
      path.join(tempRoot, "extensions", "alpha", "index.ts"),
      "export {};\n",
      "utf8",
    );
    fs.mkdirSync(path.join(tempRoot, "extensions", "alpha", "src"), { recursive: true });
    fs.writeFileSync(
      path.join(tempRoot, "extensions", "alpha", "src", "config-schema.js"),
      [
        "export const AlphaChannelConfigSchema = {",
        "  schema: {",
        "    type: 'object',",
        "    properties: { generated: { type: 'string' } },",
        "  },",
        "  uiHints: {",
        "    'channels.alpha.generatedOnly': { help: 'generated hint' },",
        "  },",
        "};",
        "",
      ].join("\n"),
      "utf8",
    );

    clearBundledPluginMetadataCache();
    const entries = listBundledPluginMetadata({ rootDir: tempRoot });
    const channelConfigs = entries[0]?.manifest.channelConfigs as
      | Record<string, unknown>
      | undefined;
    expect(channelConfigs?.alpha).toEqual({
      schema: {
        type: "object",
        properties: {
          generated: { type: "string" },
        },
      },
      label: "Manifest Label",
      description: "Alpha Root Description",
      preferOver: ["alpha-legacy"],
      uiHints: {
        "channels.alpha.generatedOnly": { help: "generated hint" },
        "channels.alpha.explicitOnly": { help: "manifest hint" },
      },
    });
  });

  it("captures top-level public surface artifacts without duplicating the primary entrypoints", () => {
    const tempRoot = createGeneratedPluginTempRoot("crawclaw-bundled-plugin-public-artifacts-");

    writeJson(path.join(tempRoot, "extensions", "alpha", "package.json"), {
      name: "@crawclaw/alpha",
      version: "0.0.1",
      crawclaw: {
        extensions: ["./index.ts"],
        setupEntry: "./setup-entry.ts",
      },
    });
    writeJson(path.join(tempRoot, "extensions", "alpha", "crawclaw.plugin.json"), {
      id: "alpha",
      configSchema: { type: "object" },
    });
    fs.writeFileSync(
      path.join(tempRoot, "extensions", "alpha", "index.ts"),
      "export {};\n",
      "utf8",
    );
    fs.writeFileSync(
      path.join(tempRoot, "extensions", "alpha", "setup-entry.ts"),
      "export {};\n",
      "utf8",
    );
    fs.writeFileSync(path.join(tempRoot, "extensions", "alpha", "api.ts"), "export {};\n", "utf8");
    fs.writeFileSync(
      path.join(tempRoot, "extensions", "alpha", "runtime-api.ts"),
      "export {};\n",
      "utf8",
    );

    clearBundledPluginMetadataCache();
    const entries = listBundledPluginMetadata({ rootDir: tempRoot });
    const firstEntry = entries[0] as
      | {
          publicSurfaceArtifacts?: string[];
          runtimeSidecarArtifacts?: string[];
        }
      | undefined;
    expect(firstEntry?.publicSurfaceArtifacts).toEqual(["api.js", "runtime-api.js"]);
    expect(firstEntry?.runtimeSidecarArtifacts).toEqual(["runtime-api.js"]);
  });

  it("loads channel config metadata from built public surfaces in dist-only roots", () => {
    const tempRoot = createGeneratedPluginTempRoot("crawclaw-bundled-plugin-dist-config-");
    const distRoot = path.join(tempRoot, "dist");

    writeJson(path.join(distRoot, "extensions", "alpha", "package.json"), {
      name: "@crawclaw/alpha",
      version: "0.0.1",
      crawclaw: {
        extensions: ["./index.ts"],
        channel: {
          id: "alpha",
          label: "Alpha Root Label",
          blurb: "Alpha Root Description",
        },
      },
    });
    writeJson(path.join(distRoot, "extensions", "alpha", "crawclaw.plugin.json"), {
      id: "alpha",
      configSchema: {
        type: "object",
        properties: {},
      },
      channels: ["alpha"],
      channelConfigs: {
        alpha: {
          schema: { type: "object", properties: { stale: { type: "boolean" } } },
          uiHints: {
            "channels.alpha.explicitOnly": {
              help: "manifest hint",
            },
          },
        },
      },
    });
    fs.writeFileSync(
      path.join(distRoot, "extensions", "alpha", "index.js"),
      "export {};\n",
      "utf8",
    );
    fs.writeFileSync(
      path.join(distRoot, "extensions", "alpha", "channel-config-api.js"),
      [
        "export const AlphaChannelConfigSchema = {",
        "  schema: {",
        "    type: 'object',",
        "    properties: { built: { type: 'string' } },",
        "  },",
        "  uiHints: {",
        "    'channels.alpha.generatedOnly': { help: 'built hint' },",
        "  },",
        "};",
        "",
      ].join("\n"),
      "utf8",
    );

    clearBundledPluginMetadataCache();
    const entries = listBundledPluginMetadata({ rootDir: distRoot });
    const channelConfigs = entries[0]?.manifest.channelConfigs as
      | Record<string, unknown>
      | undefined;
    expect(channelConfigs?.alpha).toEqual({
      schema: {
        type: "object",
        properties: {
          built: { type: "string" },
        },
      },
      label: "Alpha Root Label",
      description: "Alpha Root Description",
      uiHints: {
        "channels.alpha.generatedOnly": { help: "built hint" },
        "channels.alpha.explicitOnly": { help: "manifest hint" },
      },
    });
  });
});
