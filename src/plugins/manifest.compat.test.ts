import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  getPackageManifestMetadata,
  loadPluginManifest,
  resolvePluginManifestPath,
  type PackageManifest,
} from "./manifest.js";
import { cleanupTrackedTempDirs, makeTrackedTempDir } from "./test-helpers/fs-fixtures.js";

const tempDirs: string[] = [];

function makeTempDir() {
  return makeTrackedTempDir("crawclaw-manifest-compat", tempDirs);
}

function writeManifest(rootDir: string, filename: string, manifest: Record<string, unknown>) {
  fs.writeFileSync(path.join(rootDir, filename), JSON.stringify(manifest, null, 2), "utf-8");
}

afterEach(() => {
  cleanupTrackedTempDirs(tempDirs);
});

describe("plugin manifest canonical naming", () => {
  it("loads crawclaw.plugin.json when it exists", () => {
    const dir = makeTempDir();
    writeManifest(dir, "crawclaw.plugin.json", {
      id: "canonical-id",
      configSchema: { type: "object" },
    });

    expect(path.basename(resolvePluginManifestPath(dir))).toBe("crawclaw.plugin.json");
    const result = loadPluginManifest(dir, false);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.manifest.id).toBe("canonical-id");
      expect(path.basename(result.manifestPath)).toBe("crawclaw.plugin.json");
    }
  });

  it("resolves the canonical manifest path when no manifest exists yet", () => {
    const dir = makeTempDir();
    expect(path.basename(resolvePluginManifestPath(dir))).toBe("crawclaw.plugin.json");
  });

  it("reads package.json crawclaw metadata", () => {
    const canonical = getPackageManifestMetadata({
      crawclaw: { extensions: ["./dist/index.js"] },
    } as PackageManifest);
    expect(canonical?.extensions).toEqual(["./dist/index.js"]);
    expect(getPackageManifestMetadata({} as PackageManifest)).toBeUndefined();
  });
});
