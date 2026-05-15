import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as bundledSources from "../../../plugins/bundled-sources.js";
import type { PluginManifestRecord } from "../../../plugins/manifest-registry.js";
import * as manifestRegistry from "../../../plugins/manifest-registry.js";
import { collectDoctorPreviewWarnings } from "./preview-warnings.js";

function manifest(id: string): PluginManifestRecord {
  return {
    id,
    channels: [],
    providers: [],
    cliBackends: [],
    skills: [],
    hooks: [],
    origin: "bundled",
    rootDir: `/plugins/${id}`,
    source: `/plugins/${id}`,
    manifestPath: `/plugins/${id}/crawclaw.plugin.json`,
  };
}

describe("doctor preview warnings", () => {
  beforeEach(() => {
    vi.spyOn(manifestRegistry, "loadPluginManifestRegistry").mockReturnValue({
      plugins: [manifest("qqbot")],
      diagnostics: [],
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("includes stale plugin config warnings", () => {
    const warnings = collectDoctorPreviewWarnings({
      cfg: {
        plugins: {
          allow: ["acpx"],
          entries: {
            acpx: { enabled: true },
          },
        },
      },
      doctorFixCommand: "crawclaw doctor --fix",
    });

    expect(warnings).toEqual([
      expect.stringContaining('plugins.allow: stale plugin reference "acpx"'),
    ]);
    expect(warnings[0]).toContain("plugins.entries.acpx");
    expect(warnings[0]).toContain('Run "crawclaw doctor --fix"');
    expect(warnings[0]).not.toContain("Auto-removal is paused");
  });

  it("includes bundled plugin load path migration warnings", () => {
    const packageRoot = path.resolve("app-node-modules", "crawclaw");
    const legacyPath = path.join(packageRoot, "extensions", "acpx");
    const bundledPath = path.join(packageRoot, "dist", "extensions", "acpx");
    vi.spyOn(manifestRegistry, "loadPluginManifestRegistry").mockReturnValue({
      plugins: [manifest("acpx")],
      diagnostics: [],
    });
    vi.spyOn(bundledSources, "resolveBundledPluginSources").mockReturnValue(
      new Map([
        [
          "acpx",
          {
            pluginId: "acpx",
            localPath: bundledPath,
            npmSpec: "@crawclaw/acpx",
          },
        ],
      ]),
    );

    const warnings = collectDoctorPreviewWarnings({
      cfg: {
        plugins: {
          load: {
            paths: [legacyPath],
          },
        },
      },
      doctorFixCommand: "crawclaw doctor --fix",
    });

    expect(warnings).toEqual([
      expect.stringContaining(`plugins.load.paths: legacy bundled plugin path "${legacyPath}"`),
    ]);
    expect(warnings[0]).toContain('Run "crawclaw doctor --fix"');
  });

  it("warns but skips auto-removal when plugin discovery has errors", () => {
    vi.spyOn(manifestRegistry, "loadPluginManifestRegistry").mockReturnValue({
      plugins: [],
      diagnostics: [
        { level: "error", message: "plugin path not found: /missing", source: "/missing" },
      ],
    });

    const warnings = collectDoctorPreviewWarnings({
      cfg: {
        plugins: {
          allow: ["acpx"],
          entries: {
            acpx: { enabled: true },
          },
        },
      },
      doctorFixCommand: "crawclaw doctor --fix",
    });

    expect(warnings).toEqual([
      expect.stringContaining('plugins.allow: stale plugin reference "acpx"'),
    ]);
    expect(warnings[0]).toContain("Auto-removal is paused");
    expect(warnings[0]).toContain('rerun "crawclaw doctor --fix"');
  });
});
