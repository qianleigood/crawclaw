import fs from "node:fs";
import { describe, expect, it } from "vitest";

type FeishuPackageManifest = {
  dependencies?: Record<string, string>;
  crawclaw?: {
    bundle?: {
      stageRuntimeDependencies?: boolean;
    };
    startup?: {
      deferConfiguredChannelFullLoadUntilAfterListen?: boolean;
    };
  };
};

describe("feishu package manifest", () => {
  it("keeps startup deferral without staging bundled runtime dependencies", () => {
    const packageJson = JSON.parse(
      fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"),
    ) as FeishuPackageManifest;

    expect(packageJson.dependencies?.["@larksuiteoapi/node-sdk"]).toBeDefined();
    expect(packageJson.crawclaw?.bundle?.stageRuntimeDependencies).not.toBe(true);
    expect(packageJson.crawclaw?.startup?.deferConfiguredChannelFullLoadUntilAfterListen).toBe(
      true,
    );
  });
});
