import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { syncPluginVersions } from "../../scripts/sync-plugin-versions.js";

const tempDirs: string[] = [];

function writeJson(filePath: string, value: unknown) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

describe("syncPluginVersions", () => {
  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("preserves workspace crawclaw devDependencies while bumping plugin host constraints", () => {
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "crawclaw-sync-plugin-versions-"));
    tempDirs.push(rootDir);

    writeJson(path.join(rootDir, "package.json"), {
      name: "crawclaw",
      version: "2026.4.1",
    });
    writeJson(path.join(rootDir, "extensions/bluebubbles/package.json"), {
      name: "@crawclaw/bluebubbles",
      version: "2026.3.30",
      devDependencies: {
        crawclaw: "workspace:*",
      },
      peerDependencies: {
        crawclaw: ">=2026.3.30",
      },
      crawclaw: {
        install: {
          minHostVersion: ">=2026.3.30",
        },
      },
    });

    const summary = syncPluginVersions(rootDir);
    const updatedPackage = JSON.parse(
      fs.readFileSync(path.join(rootDir, "extensions/bluebubbles/package.json"), "utf8"),
    ) as {
      version?: string;
      devDependencies?: Record<string, string>;
      peerDependencies?: Record<string, string>;
      crawclaw?: {
        install?: {
          minHostVersion?: string;
        };
      };
    };

    expect(summary.updated).toContain("@crawclaw/bluebubbles");
    expect(updatedPackage.version).toBe("2026.4.1");
    expect(updatedPackage.devDependencies?.crawclaw).toBe("workspace:*");
    expect(updatedPackage.peerDependencies?.crawclaw).toBe(">=2026.4.1");
    expect(updatedPackage.crawclaw?.install?.minHostVersion).toBe(">=2026.4.1");
  });
});
