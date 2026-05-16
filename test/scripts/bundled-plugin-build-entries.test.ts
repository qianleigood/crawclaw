import { describe, expect, it } from "vitest";
import {
  listBundledPluginBuildEntries,
  listBundledPluginPackArtifacts,
} from "../../scripts/lib/bundled-plugin-build-entries.mjs";

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
});
