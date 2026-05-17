import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  listBundledPluginBuildEntries,
  listBundledPluginPackArtifacts,
} from "../../scripts/lib/bundled-plugin-build-entries.mjs";

function makeRepoRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "crawclaw-bundled-plugin-build-"));
}

function writeJson(filePath: string, value: unknown) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

describe("bundled plugin build entries", () => {
  it("includes manifest-less runtime core support packages in dist build entries", () => {
    const entries = listBundledPluginBuildEntries();

    expect(entries).toMatchObject({
      "extensions/speech-core/api": "extensions/speech-core/api.ts",
      "extensions/speech-core/runtime-api": "extensions/speech-core/runtime-api.ts",
    });
  });

  it("packs runtime core support packages without requiring plugin manifests", () => {
    const artifacts = listBundledPluginPackArtifacts();

    expect(artifacts).not.toContain(
      "dist/extensions/media-understanding-core/crawclaw.plugin.json",
    );
    expect(artifacts).toContain("dist/extensions/speech-core/runtime-api.js");
    expect(artifacts).not.toContain("dist/extensions/speech-core/crawclaw.plugin.json");
  });

  it("ignores removed executable plugin entry metadata when collecting build entries", () => {
    const cwd = makeRepoRoot();
    writeJson(path.join(cwd, "extensions", "demo", "crawclaw.plugin.json"), {
      id: "demo",
    });
    writeJson(path.join(cwd, "extensions", "demo", "package.json"), {
      crawclaw: {
        extensions: ["./index.ts"],
        setupEntry: "./setup-entry.ts",
      },
      name: "@crawclaw/demo",
    });
    fs.writeFileSync(path.join(cwd, "extensions", "demo", "index.ts"), "export default {};\n");
    fs.writeFileSync(
      path.join(cwd, "extensions", "demo", "setup-entry.ts"),
      "export default {};\n",
    );

    expect(listBundledPluginBuildEntries({ cwd })).toEqual({});
    expect(listBundledPluginPackArtifacts({ cwd })).not.toContain(
      "dist/extensions/demo/setup-entry.js",
    );
  });
});
