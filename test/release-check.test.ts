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
          id: "irc",
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
            id: "matrix",
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
      "bundled extension 'matrix' manifest invalid | crawclaw.releaseChecks.rootDependencyMirrorAllowlist must be an array",
    ]);
  });

  it("flags mirror entries missing from extension runtime dependencies", () => {
    expect(
      collectBundledExtensionRootDependencyMirrorErrors(
        [
          {
            id: "matrix",
            packageJson: {
              dependencies: {
                "matrix-js-sdk": "41.2.0",
              },
              crawclaw: {
                releaseChecks: {
                  rootDependencyMirrorAllowlist: ["@matrix-org/matrix-sdk-crypto-wasm"],
                },
              },
            },
          },
        ],
        new Map([["@matrix-org/matrix-sdk-crypto-wasm", "18.0.0"]]),
      ),
    ).toEqual([
      "bundled extension 'matrix' manifest invalid | crawclaw.releaseChecks.rootDependencyMirrorAllowlist entry '@matrix-org/matrix-sdk-crypto-wasm' must be declared in extension runtime dependencies",
    ]);
  });

  it("flags mirror entries missing from root runtime dependencies", () => {
    expect(
      collectBundledExtensionRootDependencyMirrorErrors(
        [
          {
            id: "matrix",
            packageJson: {
              dependencies: {
                "@matrix-org/matrix-sdk-crypto-wasm": "18.0.0",
              },
              crawclaw: {
                releaseChecks: {
                  rootDependencyMirrorAllowlist: ["@matrix-org/matrix-sdk-crypto-wasm"],
                },
              },
            },
          },
        ],
        new Map(),
      ),
    ).toEqual([
      "bundled extension 'matrix' manifest invalid | crawclaw.releaseChecks.rootDependencyMirrorAllowlist entry '@matrix-org/matrix-sdk-crypto-wasm' must be mirrored in root runtime dependencies",
    ]);
  });

  it("flags mirror entries whose root version drifts from the extension", () => {
    expect(
      collectBundledExtensionRootDependencyMirrorErrors(
        [
          {
            id: "matrix",
            packageJson: {
              dependencies: {
                "@matrix-org/matrix-sdk-crypto-wasm": "18.0.0",
              },
              crawclaw: {
                releaseChecks: {
                  rootDependencyMirrorAllowlist: ["@matrix-org/matrix-sdk-crypto-wasm"],
                },
              },
            },
          },
        ],
        new Map([["@matrix-org/matrix-sdk-crypto-wasm", "18.1.0"]]),
      ),
    ).toEqual([
      "bundled extension 'matrix' manifest invalid | crawclaw.releaseChecks.rootDependencyMirrorAllowlist entry '@matrix-org/matrix-sdk-crypto-wasm' must match root runtime dependency version (extension '18.0.0', root '18.1.0')",
    ]);
  });

  it("accepts mirror entries declared by both the extension and root package", () => {
    expect(
      collectBundledExtensionRootDependencyMirrorErrors(
        [
          {
            id: "matrix",
            packageJson: {
              dependencies: {
                "@matrix-org/matrix-sdk-crypto-wasm": "18.0.0",
              },
              crawclaw: {
                releaseChecks: {
                  rootDependencyMirrorAllowlist: ["@matrix-org/matrix-sdk-crypto-wasm"],
                },
              },
            },
          },
        ],
        new Map([["@matrix-org/matrix-sdk-crypto-wasm", "18.0.0"]]),
      ),
    ).toEqual([]);
  });
});

describe("collectForbiddenPackPaths", () => {
  it("allows bundled plugin runtime deps under dist/extensions but still blocks other node_modules", () => {
    expect(
      collectForbiddenPackPaths([
        "dist/index.js",
        bundledDistPluginFile("discord", "node_modules/@buape/carbon/index.js"),
        bundledPluginFile("tlon", "node_modules/.bin/tlon"),
        "node_modules/.bin/crawclaw",
      ]),
    ).toEqual([bundledPluginFile("tlon", "node_modules/.bin/tlon"), "node_modules/.bin/crawclaw"]);
  });
});

describe("collectMissingPackPaths", () => {
  it("requires the shipped channel catalog and optional bundled metadata", () => {
    const missing = collectMissingPackPaths([
      "dist/index.js",
      "dist/entry.js",
      "dist/plugin-sdk/index.js",
      "dist/plugin-sdk/index.d.ts",
      "dist/plugin-sdk/root-alias.cjs",
      "dist/build-info.json",
    ]);

    expect(missing).toEqual(
      expect.arrayContaining([
        "dist/channel-catalog.json",
        "extensions/scrapling-fetch/runtime/requirements.lock.txt",
        "scripts/install-plugin-runtimes.mjs",
        "scripts/npm-runner.mjs",
        "scripts/postinstall-bundled-plugins.mjs",
        bundledDistPluginFile("diffs", "assets/viewer-runtime.js"),
        bundledDistPluginFile("matrix", "helper-api.js"),
        bundledDistPluginFile("matrix", "runtime-api.js"),
        bundledDistPluginFile("matrix", "thread-bindings-runtime.js"),
        bundledDistPluginFile("matrix", "crawclaw.plugin.json"),
        bundledDistPluginFile("matrix", "package.json"),
        bundledDistPluginFile("whatsapp", "light-runtime-api.js"),
        bundledDistPluginFile("whatsapp", "runtime-api.js"),
        bundledDistPluginFile("whatsapp", "crawclaw.plugin.json"),
        bundledDistPluginFile("whatsapp", "package.json"),
      ]),
    );
  });

  it("accepts the shipped upgrade surface when optional bundled metadata is present", () => {
    expect(
      collectMissingPackPaths([
        "dist/index.js",
        "dist/entry.js",
        "dist/extensions/acpx/mcp-proxy.mjs",
        bundledDistPluginFile("diffs", "assets/viewer-runtime.js"),
        ...requiredBundledPluginPackPaths,
        ...requiredPluginSdkPackPaths,
        "extensions/scrapling-fetch/runtime/requirements.lock.txt",
        "scripts/install-plugin-runtimes.mjs",
        "scripts/npm-runner.mjs",
        "scripts/postinstall-bundled-plugins.mjs",
        "dist/plugin-sdk/root-alias.cjs",
        "dist/build-info.json",
        "dist/channel-catalog.json",
        ...requiredStaticExtensionAssetPaths,
      ]),
    ).toEqual([]);
  });

  it("requires bundled plugin runtime sidecars that dynamic plugin boundaries resolve at runtime", () => {
    expect(requiredBundledPluginPackPaths).toEqual(
      expect.arrayContaining([
        bundledDistPluginFile("matrix", "helper-api.js"),
        bundledDistPluginFile("matrix", "runtime-api.js"),
        bundledDistPluginFile("matrix", "thread-bindings-runtime.js"),
        bundledDistPluginFile("whatsapp", "light-runtime-api.js"),
        bundledDistPluginFile("whatsapp", "runtime-api.js"),
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
