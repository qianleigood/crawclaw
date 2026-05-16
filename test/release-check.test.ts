import { describe, expect, it } from "vitest";
import { listBundledPluginPackArtifacts } from "../scripts/lib/bundled-plugin-build-entries.mjs";
import { listPluginSdkDistArtifacts } from "../scripts/lib/plugin-sdk-entries.mjs";
import {
  collectBundledExtensionManifestErrors,
  collectBundledExtensionRootDependencyMirrorErrors,
  collectForbiddenPackPaths,
  collectMissingPackPaths,
  collectPackUnpackedSizeErrors,
} from "../scripts/release-check.ts";
import { listStaticExtensionAssetOutputs } from "../scripts/runtime-postbuild.mjs";
import { bundledDistPluginFile, bundledPluginFile } from "./helpers/bundled-plugin-paths.js";

function makePackResult(filename: string, unpackedSize: number) {
  return { filename, unpackedSize };
}

const requiredPluginSdkPackPaths = [...listPluginSdkDistArtifacts()];
const requiredBundledPluginPackPaths = listBundledPluginPackArtifacts();
const requiredStaticExtensionAssetPaths = listStaticExtensionAssetOutputs().flat();

describe("collectBundledExtensionManifestErrors", () => {
  it("flags invalid bundled extension install metadata", () => {
    expect(
      collectBundledExtensionManifestErrors([
        {
          id: "broken",
          packageJson: {
            crawclaw: {
              install: { npmSpec: "   " },
            },
          },
        },
      ]),
    ).toEqual([
      "bundled extension 'broken' manifest invalid | crawclaw.install.npmSpec must be a non-empty string",
    ]);
  });

  it("flags invalid bundled extension minHostVersion metadata", () => {
    expect(
      collectBundledExtensionManifestErrors([
        {
          id: "broken",
          packageJson: {
            crawclaw: {
              install: { npmSpec: "@crawclaw/broken", minHostVersion: "2026.3.14" },
            },
          },
        },
      ]),
    ).toEqual([
      "bundled extension 'broken' manifest invalid | crawclaw.install.minHostVersion must use a semver floor in the form \">=x.y.z\"",
    ]);
  });

  it("allows install metadata without npmSpec when only non-publish metadata is present", () => {
    expect(
      collectBundledExtensionManifestErrors([
        {
          id: "feishu",
          packageJson: {
            crawclaw: {
              install: { minHostVersion: ">=2026.3.14" },
            },
          },
        },
      ]),
    ).toEqual([]);
  });

  it("flags non-object install metadata instead of throwing", () => {
    expect(
      collectBundledExtensionManifestErrors([
        {
          id: "broken",
          packageJson: {
            crawclaw: {
              install: 123,
            },
          },
        },
      ]),
    ).toEqual(["bundled extension 'broken' manifest invalid | crawclaw.install must be an object"]);
  });
});

describe("collectBundledExtensionRootDependencyMirrorErrors", () => {
  it("flags a non-array mirror allowlist", () => {
    expect(
      collectBundledExtensionRootDependencyMirrorErrors(
        [
          {
            id: "feishu",
            packageJson: {
              crawclaw: {
                releaseChecks: {
                  rootDependencyMirrorAllowlist: true,
                },
              },
            },
          },
        ],
        new Map(),
      ),
    ).toEqual([
      "bundled extension 'feishu' manifest invalid | crawclaw.releaseChecks.rootDependencyMirrorAllowlist must be an array",
    ]);
  });

  it("flags mirror entries missing from extension runtime dependencies", () => {
    expect(
      collectBundledExtensionRootDependencyMirrorErrors(
        [
          {
            id: "feishu",
            packageJson: {
              dependencies: {
                "feishu-js-sdk": "41.2.0",
              },
              crawclaw: {
                releaseChecks: {
                  rootDependencyMirrorAllowlist: ["@feishu-org/feishu-sdk-crypto-wasm"],
                },
              },
            },
          },
        ],
        new Map([["@feishu-org/feishu-sdk-crypto-wasm", "18.0.0"]]),
      ),
    ).toEqual([
      "bundled extension 'feishu' manifest invalid | crawclaw.releaseChecks.rootDependencyMirrorAllowlist entry '@feishu-org/feishu-sdk-crypto-wasm' must be declared in extension runtime dependencies",
    ]);
  });

  it("flags mirror entries missing from root runtime dependencies", () => {
    expect(
      collectBundledExtensionRootDependencyMirrorErrors(
        [
          {
            id: "feishu",
            packageJson: {
              dependencies: {
                "@feishu-org/feishu-sdk-crypto-wasm": "18.0.0",
              },
              crawclaw: {
                releaseChecks: {
                  rootDependencyMirrorAllowlist: ["@feishu-org/feishu-sdk-crypto-wasm"],
                },
              },
            },
          },
        ],
        new Map(),
      ),
    ).toEqual([
      "bundled extension 'feishu' manifest invalid | crawclaw.releaseChecks.rootDependencyMirrorAllowlist entry '@feishu-org/feishu-sdk-crypto-wasm' must be mirrored in root runtime dependencies",
    ]);
  });

  it("flags mirror entries whose root version drifts from the extension", () => {
    expect(
      collectBundledExtensionRootDependencyMirrorErrors(
        [
          {
            id: "feishu",
            packageJson: {
              dependencies: {
                "@feishu-org/feishu-sdk-crypto-wasm": "18.0.0",
              },
              crawclaw: {
                releaseChecks: {
                  rootDependencyMirrorAllowlist: ["@feishu-org/feishu-sdk-crypto-wasm"],
                },
              },
            },
          },
        ],
        new Map([["@feishu-org/feishu-sdk-crypto-wasm", "18.1.0"]]),
      ),
    ).toEqual([
      "bundled extension 'feishu' manifest invalid | crawclaw.releaseChecks.rootDependencyMirrorAllowlist entry '@feishu-org/feishu-sdk-crypto-wasm' must match root runtime dependency version (extension '18.0.0', root '18.1.0')",
    ]);
  });

  it("accepts mirror entries declared by both the extension and root package", () => {
    expect(
      collectBundledExtensionRootDependencyMirrorErrors(
        [
          {
            id: "feishu",
            packageJson: {
              dependencies: {
                "@feishu-org/feishu-sdk-crypto-wasm": "18.0.0",
              },
              crawclaw: {
                releaseChecks: {
                  rootDependencyMirrorAllowlist: ["@feishu-org/feishu-sdk-crypto-wasm"],
                },
              },
            },
          },
        ],
        new Map([["@feishu-org/feishu-sdk-crypto-wasm", "18.0.0"]]),
      ),
    ).toEqual([]);
  });
});

describe("collectForbiddenPackPaths", () => {
  it("allows bundled plugin runtime deps under dist/extensions but still blocks other node_modules", () => {
    expect(
      collectForbiddenPackPaths([
        "dist/index.js",
        bundledDistPluginFile("qqbot", "node_modules/@buape/carbon/index.js"),
        bundledPluginFile("feishu", "node_modules/.bin/feishu"),
        "node_modules/.bin/crawclaw",
      ]),
    ).toEqual([
      bundledPluginFile("feishu", "node_modules/.bin/feishu"),
      "node_modules/.bin/crawclaw",
    ]);
  });
});

describe("collectMissingPackPaths", () => {
  it("requires the shipped runtime surface and optional bundled metadata", () => {
    const missing = collectMissingPackPaths([
      "dist/index.js",
      "dist/native/crawclaw-runtime",
      "dist/native/crawclaw-gateway",
      "dist/native/crawclaw-native-plugins",
      "dist/plugin-sdk/core.js",
      "dist/plugin-sdk/core.d.ts",
      "dist/build-info.json",
    ]);

    expect(missing).toEqual(
      expect.arrayContaining([
        "docs/reference/templates/AGENTS.md",
        "extensions/scrapling-fetch/runtime/requirements.lock.txt",
        "scripts/npm-runner.mjs",
        "scripts/postinstall-bundled-plugins.mjs",
        "skills/coding-agent/SKILL.md",
        bundledDistPluginFile("speech-core", "runtime-api.js"),
      ]),
    );
  });

  it("accepts the shipped upgrade surface when optional bundled metadata is present", () => {
    expect(
      collectMissingPackPaths([
        "dist/index.js",
        "dist/native/crawclaw-runtime",
        "dist/native/crawclaw-gateway",
        "dist/native/crawclaw-native-plugins",
        ...requiredBundledPluginPackPaths,
        ...requiredPluginSdkPackPaths,
        "extensions/scrapling-fetch/runtime/requirements.lock.txt",
        "scripts/npm-runner.mjs",
        "scripts/postinstall-bundled-plugins.mjs",
        "skills/coding-agent/SKILL.md",
        "docs/reference/templates/AGENTS.md",
        "dist/build-info.json",
        ...requiredStaticExtensionAssetPaths,
      ]),
    ).toEqual([]);
  });

  it("does not require legacy bundled plugin runtime sidecars after native cutover", () => {
    expect(requiredBundledPluginPackPaths).toEqual(
      expect.not.arrayContaining([
        bundledDistPluginFile("acpx", "runtime-api.js"),
        bundledDistPluginFile("diffs", "runtime-api.js"),
        bundledDistPluginFile("ollama", "runtime-api.js"),
      ]),
    );
  });
});

describe("collectPackUnpackedSizeErrors", () => {
  it("accepts pack results within the unpacked size budget", () => {
    expect(
      collectPackUnpackedSizeErrors([makePackResult("crawclaw-2026.3.14.tgz", 120_354_302)]),
    ).toEqual([]);
  });

  it("flags oversized pack results that risk low-memory startup failures", () => {
    expect(
      collectPackUnpackedSizeErrors([makePackResult("crawclaw-2026.3.12.tgz", 224_002_564)]),
    ).toEqual([
      "crawclaw-2026.3.12.tgz unpackedSize 224002564 bytes (213.6 MiB) exceeds budget 200278016 bytes (191.0 MiB). Investigate duplicate channel shims, copied extension trees, or other accidental pack bloat before release.",
    ]);
  });

  it("fails closed when npm pack output omits unpackedSize for every result", () => {
    expect(
      collectPackUnpackedSizeErrors([
        { filename: "crawclaw-2026.3.14.tgz" },
        { filename: "crawclaw-extra.tgz", unpackedSize: Number.NaN },
      ]),
    ).toEqual([
      "npm pack --dry-run produced no unpackedSize data; pack size budget was not verified.",
    ]);
  });
});
