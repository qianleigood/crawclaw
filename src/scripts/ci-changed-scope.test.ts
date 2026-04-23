import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { bundledPluginFile } from "../../test/helpers/bundled-plugin-paths.js";

const { detectChangedScope, listChangedPaths } =
  (await import("../../scripts/ci-changed-scope.mjs")) as unknown as {
    detectChangedScope: (paths: string[]) => {
      runNode: boolean;
      runWindows: boolean;
      runSkillsPython: boolean;
      runChangedSmoke: boolean;
    };
    listChangedPaths: (base: string, head?: string) => string[];
  };

const markerPaths: string[] = [];

afterEach(() => {
  for (const markerPath of markerPaths) {
    try {
      fs.unlinkSync(markerPath);
    } catch {}
  }
  markerPaths.length = 0;
});

describe("detectChangedScope", () => {
  it("fails safe when no paths are provided", () => {
    expect(detectChangedScope([])).toEqual({
      runNode: true,
      runWindows: true,
      runSkillsPython: true,
      runChangedSmoke: true,
    });
  });

  it("keeps all lanes off for docs-only changes", () => {
    expect(detectChangedScope(["docs/ci.md", "README.md"])).toEqual({
      runNode: false,
      runWindows: false,
      runSkillsPython: false,
      runChangedSmoke: false,
    });
  });

  it("enables node lane for node-relevant files", () => {
    expect(detectChangedScope(["src/plugins/runtime/index.ts"])).toEqual({
      runNode: true,
      runWindows: true,
      runSkillsPython: false,
      runChangedSmoke: false,
    });
  });

  it("enables node lane for non-native non-doc files by fallback", () => {
    expect(detectChangedScope(["README.md"])).toEqual({
      runNode: false,
      runWindows: false,
      runSkillsPython: false,
      runChangedSmoke: false,
    });

    expect(detectChangedScope(["assets/icon.png"])).toEqual({
      runNode: true,
      runWindows: false,
      runSkillsPython: false,
      runChangedSmoke: false,
    });
  });

  it("keeps windows lane off for non-runtime GitHub metadata files", () => {
    expect(detectChangedScope([".github/labeler.yml"])).toEqual({
      runNode: true,
      runWindows: false,
      runSkillsPython: false,
      runChangedSmoke: false,
    });
  });

  it("runs Python skill tests when skills change", () => {
    expect(detectChangedScope(["skills/skill-creator/scripts/test_quick_validate.py"])).toEqual({
      runNode: true,
      runWindows: false,
      runSkillsPython: true,
      runChangedSmoke: false,
    });
  });

  it("runs Python skill tests when shared Python config changes", () => {
    expect(detectChangedScope(["pyproject.toml"])).toEqual({
      runNode: true,
      runWindows: false,
      runSkillsPython: true,
      runChangedSmoke: false,
    });
  });

  it("runs platform lanes when the CI workflow changes", () => {
    expect(detectChangedScope([".github/workflows/ci.yml"])).toEqual({
      runNode: true,
      runWindows: true,
      runSkillsPython: true,
      runChangedSmoke: false,
    });
  });

  it("runs Windows lane when the native Windows smoke workflow changes", () => {
    expect(detectChangedScope([".github/workflows/windows-native-smoke.yml"])).toEqual({
      runNode: true,
      runWindows: true,
      runSkillsPython: false,
      runChangedSmoke: false,
    });
  });

  it("runs changed-smoke for install and packaging surfaces", () => {
    expect(detectChangedScope(["scripts/install.sh"])).toEqual({
      runNode: true,
      runWindows: true,
      runSkillsPython: false,
      runChangedSmoke: true,
    });
    expect(detectChangedScope(["scripts/install.ps1"])).toEqual({
      runNode: true,
      runWindows: true,
      runSkillsPython: false,
      runChangedSmoke: true,
    });
    expect(detectChangedScope(["scripts/ci/windows-packed-install-smoke.mjs"])).toEqual({
      runNode: true,
      runWindows: true,
      runSkillsPython: false,
      runChangedSmoke: true,
    });
    expect(detectChangedScope(["scripts/postinstall-bundled-plugins.mjs"])).toEqual({
      runNode: true,
      runWindows: true,
      runSkillsPython: false,
      runChangedSmoke: true,
    });
    expect(detectChangedScope(["scripts/ci-changed-scope.mjs"])).toEqual({
      runNode: true,
      runWindows: true,
      runSkillsPython: false,
      runChangedSmoke: true,
    });
    expect(detectChangedScope(["scripts/ci-write-manifest-outputs.mjs"])).toEqual({
      runNode: true,
      runWindows: true,
      runSkillsPython: false,
      runChangedSmoke: true,
    });
    expect(detectChangedScope(["scripts/test-planner/planner.mjs"])).toEqual({
      runNode: true,
      runWindows: true,
      runSkillsPython: false,
      runChangedSmoke: true,
    });
    expect(detectChangedScope([bundledPluginFile("matrix", "package.json")])).toEqual({
      runNode: true,
      runWindows: true,
      runSkillsPython: false,
      runChangedSmoke: true,
    });
    expect(detectChangedScope([".github/workflows/install-smoke.yml"])).toEqual({
      runNode: true,
      runWindows: false,
      runSkillsPython: false,
      runChangedSmoke: true,
    });
  });

  it("treats base and head as literal git args", () => {
    const markerPath = path.join(
      os.tmpdir(),
      `crawclaw-ci-changed-scope-${Date.now()}-${Math.random().toString(16).slice(2)}.tmp`,
    );
    markerPaths.push(markerPath);

    const injectedBase =
      process.platform === "win32"
        ? `HEAD & echo injected > "${markerPath}" & rem`
        : `HEAD; touch "${markerPath}" #`;

    expect(() => listChangedPaths(injectedBase, "HEAD")).toThrow();
    expect(fs.existsSync(markerPath)).toBe(false);
  });
});
