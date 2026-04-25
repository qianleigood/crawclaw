import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { writeCliStartupMetadata } from "../../scripts/write-cli-startup-metadata.ts";

function createTempDir(prefix: string): string {
  return mkdtempSync(path.join(os.tmpdir(), prefix));
}

describe("write-cli-startup-metadata", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("writes startup metadata with precomputed channel options", async () => {
    const tempRoot = createTempDir("crawclaw-startup-metadata-");
    tempDirs.push(tempRoot);
    const distDir = path.join(tempRoot, "dist");
    const extensionsDir = path.join(tempRoot, "extensions");
    const outputPath = path.join(distDir, "cli-startup-metadata.json");

    mkdirSync(distDir, { recursive: true });
    mkdirSync(path.join(extensionsDir, "matrix"), { recursive: true });
    writeFileSync(
      path.join(extensionsDir, "matrix", "package.json"),
      JSON.stringify({
        crawclaw: {
          channel: {
            id: "matrix",
            order: 120,
            label: "Matrix",
          },
        },
      }),
      "utf8",
    );

    await writeCliStartupMetadata({ distDir, outputPath, extensionsDir });

    const written = JSON.parse(readFileSync(outputPath, "utf8")) as {
      channelOptions: string[];
    };
    expect(written.channelOptions).toContain("matrix");
    expect(written).not.toHaveProperty("rootHelpText");
  });

  it("writes precomputed plugin CLI descriptors from bundled plugin manifests", async () => {
    const tempRoot = createTempDir("crawclaw-startup-plugin-metadata-");
    tempDirs.push(tempRoot);
    const distDir = path.join(tempRoot, "dist");
    const extensionsDir = path.join(tempRoot, "extensions");
    const outputPath = path.join(distDir, "cli-startup-metadata.json");

    mkdirSync(distDir, { recursive: true });
    mkdirSync(path.join(extensionsDir, "matrix"), { recursive: true });
    writeFileSync(
      path.join(extensionsDir, "matrix", "package.json"),
      JSON.stringify({
        crawclaw: {
          cli: {
            descriptors: [
              {
                name: "matrix",
                description: "Matrix channel utilities",
                descriptionZhCN: "Matrix 渠道工具",
                hasSubcommands: true,
              },
            ],
          },
        },
      }),
      "utf8",
    );

    await writeCliStartupMetadata({ distDir, outputPath, extensionsDir });

    const written = JSON.parse(readFileSync(outputPath, "utf8")) as {
      pluginCliDescriptors?: Array<{
        pluginId: string;
        name: string;
        description: string;
        descriptionZhCN?: string;
        hasSubcommands: boolean;
      }>;
    };
    expect(written.pluginCliDescriptors).toEqual([
      {
        pluginId: "matrix",
        name: "matrix",
        description: "Matrix channel utilities",
        descriptionZhCN: "Matrix 渠道工具",
        hasSubcommands: true,
      },
    ]);
  });
});
