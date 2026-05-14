import { describe, expect, it } from "vitest";
import {
  collectChangedExtensionIdsFromPaths,
  collectPublishablePluginPackageErrors,
  parsePluginReleaseArgs,
  parsePluginReleaseSelection,
  parsePluginReleaseSelectionMode,
  resolveChangedPublishablePluginPackages,
  resolveSelectedPublishablePluginPackages,
  type PublishablePluginPackage,
} from "../scripts/lib/plugin-npm-release.ts";
import { bundledPluginFile, bundledPluginRoot } from "./helpers/bundled-plugin-paths.js";

describe("parsePluginReleaseSelection", () => {
  it("returns an empty list for blank input", () => {
    expect(parsePluginReleaseSelection("")).toEqual([]);
    expect(parsePluginReleaseSelection("   ")).toEqual([]);
    expect(parsePluginReleaseSelection(undefined)).toEqual([]);
  });

  it("dedupes and sorts comma or whitespace separated package names", () => {
    expect(
      parsePluginReleaseSelection(" @crawclaw/demo-beta, @crawclaw/demo-alpha  @crawclaw/demo-beta "),
    ).toEqual(["@crawclaw/demo-alpha", "@crawclaw/demo-beta"]);
  });
});

describe("parsePluginReleaseSelectionMode", () => {
  it("accepts the supported explicit selection modes", () => {
    expect(parsePluginReleaseSelectionMode("selected")).toBe("selected");
    expect(parsePluginReleaseSelectionMode("all-publishable")).toBe("all-publishable");
  });

  it("rejects unsupported selection modes", () => {
    expect(() => parsePluginReleaseSelectionMode("all")).toThrowError(
      'Unknown selection mode: all. Expected "selected" or "all-publishable".',
    );
  });
});

describe("parsePluginReleaseArgs", () => {
  it("rejects blank explicit plugin selections", () => {
    expect(() => parsePluginReleaseArgs(["--plugins", "   "])).toThrowError(
      "`--plugins` must include at least one package name.",
    );
  });

  it("requires plugin names for selected explicit publish mode", () => {
    expect(() => parsePluginReleaseArgs(["--selection-mode", "selected"])).toThrowError(
      "`--selection-mode selected` requires `--plugins`.",
    );
  });

  it("rejects plugin names when all-publishable mode is selected", () => {
    expect(() =>
      parsePluginReleaseArgs([
        "--selection-mode",
        "all-publishable",
        "--plugins",
        "@crawclaw/zalo",
      ]),
    ).toThrowError("`--selection-mode all-publishable` must not be combined with `--plugins`.");
  });

  it("parses explicit all-publishable mode", () => {
    expect(parsePluginReleaseArgs(["--selection-mode", "all-publishable"])).toMatchObject({
      selectionMode: "all-publishable",
      selection: [],
      pluginsFlagProvided: false,
    });
  });
});

describe("collectPublishablePluginPackageErrors", () => {
  it("accepts a valid publishable plugin package candidate", () => {
    expect(
      collectPublishablePluginPackageErrors({
      extensionId: "demo-alpha",
      packageDir: bundledPluginRoot("demo-alpha"),
      packageJson: {
          name: "@crawclaw/demo-alpha",
          version: "2026.3.15",
          crawclaw: {
            extensions: ["./index.ts"],
            release: {
              publishToNpm: true,
            },
          },
        },
      }),
    ).toEqual([]);
  });

  it("flags invalid publishable plugin metadata", () => {
    expect(
      collectPublishablePluginPackageErrors({
        extensionId: "broken",
        packageDir: bundledPluginRoot("broken"),
        packageJson: {
          name: "broken",
          version: "latest",
          private: true,
          crawclaw: {
            extensions: [""],
            release: {
              publishToNpm: true,
            },
          },
        },
      }),
    ).toEqual([
      'package name must start with "@crawclaw/"; found "broken".',
      "package.json private must not be true.",
      'package.json version must match YYYY.M.D, YYYY.M.D-N, or YYYY.M.D-beta.N; found "latest".',
      "crawclaw.extensions must contain only non-empty strings.",
    ]);
  });
});

describe("resolveSelectedPublishablePluginPackages", () => {
  const publishablePlugins: PublishablePluginPackage[] = [
    {
      extensionId: "demo-alpha",
      packageDir: bundledPluginRoot("demo-alpha"),
      packageName: "@crawclaw/demo-alpha",
      version: "2026.3.15",
      channel: "stable",
      publishTag: "latest",
    },
    {
      extensionId: "demo-beta",
      packageDir: bundledPluginRoot("demo-beta"),
      packageName: "@crawclaw/demo-beta",
      version: "2026.3.15-beta.1",
      channel: "beta",
      publishTag: "beta",
    },
  ];

  it("returns all publishable plugins when no selection is provided", () => {
    expect(
      resolveSelectedPublishablePluginPackages({
        plugins: publishablePlugins,
        selection: [],
      }),
    ).toEqual(publishablePlugins);
  });

  it("filters by selected publishable package names", () => {
    expect(
      resolveSelectedPublishablePluginPackages({
        plugins: publishablePlugins,
        selection: ["@crawclaw/demo-beta"],
      }),
    ).toEqual([publishablePlugins[1]]);
  });

  it("throws when the selection contains an unknown package name", () => {
    expect(() =>
      resolveSelectedPublishablePluginPackages({
        plugins: publishablePlugins,
        selection: ["@crawclaw/missing"],
      }),
    ).toThrowError("Unknown or non-publishable plugin package selection: @crawclaw/missing.");
  });
});

describe("collectChangedExtensionIdsFromPaths", () => {
  it("extracts unique extension ids from changed extension paths", () => {
    expect(
      collectChangedExtensionIdsFromPaths([
        bundledPluginFile("demo-beta", "index.ts"),
        bundledPluginFile("demo-beta", "package.json"),
        bundledPluginFile("demo-alpha", "src/client.ts"),
        "docs/reference/RELEASING.md",
      ]),
    ).toEqual(["demo-alpha", "demo-beta"]);
  });
});

describe("resolveChangedPublishablePluginPackages", () => {
  const publishablePlugins: PublishablePluginPackage[] = [
    {
      extensionId: "demo-alpha",
      packageDir: bundledPluginRoot("demo-alpha"),
      packageName: "@crawclaw/demo-alpha",
      version: "2026.3.15",
      channel: "stable",
      publishTag: "latest",
    },
    {
      extensionId: "demo-beta",
      packageDir: bundledPluginRoot("demo-beta"),
      packageName: "@crawclaw/demo-beta",
      version: "2026.3.15-beta.1",
      channel: "beta",
      publishTag: "beta",
    },
  ];

  it("returns only changed publishable plugins", () => {
    expect(
      resolveChangedPublishablePluginPackages({
        plugins: publishablePlugins,
        changedExtensionIds: ["demo-beta"],
      }),
    ).toEqual([publishablePlugins[1]]);
  });

  it("returns an empty list when no publishable plugins changed", () => {
    expect(
      resolveChangedPublishablePluginPackages({
        plugins: publishablePlugins,
        changedExtensionIds: [],
      }),
    ).toEqual([]);
  });
});
