import fs from "node:fs";
import { describe, expect, it } from "vitest";

type DiffsPackageManifest = {
  dependencies?: Record<string, string>;
  crawclaw?: {
    bundle?: {
      stageRuntimeDependencies?: boolean;
    };
    releaseChecks?: {
      rootDependencyMirrorAllowlist?: unknown;
    };
  };
};

describe("diffs package manifest", () => {
  it("mirrors runtime deps needed by the bundled host graph", () => {
    const packageJson = JSON.parse(
      fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"),
    ) as DiffsPackageManifest;

    expect(packageJson.dependencies?.["@pierre/diffs"]).toBeDefined();
    expect(packageJson.crawclaw?.bundle?.stageRuntimeDependencies).not.toBe(true);
    expect(packageJson.crawclaw?.releaseChecks?.rootDependencyMirrorAllowlist).toEqual(
      expect.arrayContaining(["@pierre/diffs"]),
    );
  });
});
