import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { bundledDistPluginFile } from "../../test/helpers/bundled-plugin-paths.js";
import { BUNDLED_RUNTIME_SIDECAR_PATHS } from "../plugins/public-artifacts.js";
import { captureEnv } from "../test-utils/env.js";
import {
  canResolveRegistryVersionForPackageTarget,
  collectInstalledGlobalPackageErrors,
  cleanupGlobalRenameDirs,
  detectGlobalInstallManagerByPresence,
  detectGlobalInstallManagerForRoot,
  globalInstallArgs,
  globalInstallFallbackArgs,
  isExplicitPackageInstallSpec,
  isMainPackageTarget,
  CRAWCLAW_MAIN_PACKAGE_SPEC,
  resolveGlobalPackageRoot,
  resolveGlobalInstallSpec,
  resolveGlobalRoot,
  type CommandRunner,
} from "./update-global.js";

const MATRIX_HELPER_API = bundledDistPluginFile("matrix", "helper-api.js");

describe("update global helpers", () => {
  let envSnapshot: ReturnType<typeof captureEnv> | undefined;

  afterEach(() => {
    envSnapshot?.restore();
    envSnapshot = undefined;
  });

  it("prefers explicit package spec overrides", () => {
    envSnapshot = captureEnv(["CRAWCLAW_UPDATE_PACKAGE_SPEC"]);
    process.env.CRAWCLAW_UPDATE_PACKAGE_SPEC = "file:/tmp/crawclaw.tgz";

    expect(resolveGlobalInstallSpec({ packageName: "crawclaw", tag: "latest" })).toBe(
      "file:/tmp/crawclaw.tgz",
    );
    expect(
      resolveGlobalInstallSpec({
        packageName: "crawclaw",
        tag: "beta",
        env: { CRAWCLAW_UPDATE_PACKAGE_SPEC: "crawclaw@next" },
      }),
    ).toBe("crawclaw@next");
  });

  it("resolves global roots and package roots from runner output", async () => {
    const runCommand: CommandRunner = async (argv) => {
      if (argv[0] === "npm") {
        return { stdout: "/tmp/npm-root\n", stderr: "", code: 0 };
      }
      if (argv[0] === "pnpm") {
        return { stdout: "", stderr: "", code: 1 };
      }
      throw new Error(`unexpected command: ${argv.join(" ")}`);
    };

    await expect(resolveGlobalRoot("npm", runCommand, 1000)).resolves.toBe("/tmp/npm-root");
    await expect(resolveGlobalRoot("pnpm", runCommand, 1000)).resolves.toBeNull();
    await expect(resolveGlobalRoot("bun", runCommand, 1000)).resolves.toContain(
      path.join(".bun", "install", "global", "node_modules"),
    );
    await expect(resolveGlobalPackageRoot("npm", runCommand, 1000)).resolves.toBe(
      path.join("/tmp/npm-root", "crawclaw"),
    );
  });

  it("maps main and explicit install specs for global installs", () => {
    expect(resolveGlobalInstallSpec({ packageName: "crawclaw", tag: "main" })).toBe(
      CRAWCLAW_MAIN_PACKAGE_SPEC,
    );
    expect(
      resolveGlobalInstallSpec({
        packageName: "crawclaw",
        tag: "github:crawclaw/crawclaw#feature/my-branch",
      }),
    ).toBe("github:crawclaw/crawclaw#feature/my-branch");
    expect(
      resolveGlobalInstallSpec({
        packageName: "crawclaw",
        tag: "https://example.com/crawclaw-main.tgz",
      }),
    ).toBe("https://example.com/crawclaw-main.tgz");
  });

  it("classifies main and raw install specs separately from registry selectors", () => {
    expect(isMainPackageTarget("main")).toBe(true);
    expect(isMainPackageTarget(" MAIN ")).toBe(true);
    expect(isMainPackageTarget("beta")).toBe(false);

    expect(isExplicitPackageInstallSpec("github:crawclaw/crawclaw#main")).toBe(true);
    expect(isExplicitPackageInstallSpec("https://example.com/crawclaw-main.tgz")).toBe(true);
    expect(isExplicitPackageInstallSpec("file:/tmp/crawclaw-main.tgz")).toBe(true);
    expect(isExplicitPackageInstallSpec("beta")).toBe(false);

    expect(canResolveRegistryVersionForPackageTarget("latest")).toBe(true);
    expect(canResolveRegistryVersionForPackageTarget("2026.3.22")).toBe(true);
    expect(canResolveRegistryVersionForPackageTarget("main")).toBe(false);
    expect(canResolveRegistryVersionForPackageTarget("github:crawclaw/crawclaw#main")).toBe(false);
  });

  it("detects install managers from resolved roots and on-disk presence", async () => {
    const base = await fs.mkdtemp(path.join(os.tmpdir(), "crawclaw-update-global-"));
    const npmRoot = path.join(base, "npm-root");
    const pnpmRoot = path.join(base, "pnpm-root");
    const bunRoot = path.join(base, ".bun", "install", "global", "node_modules");
    const pkgRoot = path.join(pnpmRoot, "crawclaw");
    await fs.mkdir(pkgRoot, { recursive: true });
    await fs.mkdir(path.join(npmRoot, "crawclaw"), { recursive: true });
    await fs.mkdir(path.join(bunRoot, "crawclaw"), { recursive: true });

    envSnapshot = captureEnv(["BUN_INSTALL"]);
    process.env.BUN_INSTALL = path.join(base, ".bun");

    const runCommand: CommandRunner = async (argv) => {
      if (argv[0] === "npm") {
        return { stdout: `${npmRoot}\n`, stderr: "", code: 0 };
      }
      if (argv[0] === "pnpm") {
        return { stdout: `${pnpmRoot}\n`, stderr: "", code: 0 };
      }
      throw new Error(`unexpected command: ${argv.join(" ")}`);
    };

    await expect(detectGlobalInstallManagerForRoot(runCommand, pkgRoot, 1000)).resolves.toBe(
      "pnpm",
    );
    await expect(detectGlobalInstallManagerByPresence(runCommand, 1000)).resolves.toBe("npm");

    await fs.rm(path.join(npmRoot, "crawclaw"), { recursive: true, force: true });
    await fs.rm(path.join(pnpmRoot, "crawclaw"), { recursive: true, force: true });
    await expect(detectGlobalInstallManagerByPresence(runCommand, 1000)).resolves.toBe("bun");
  });

  it("builds install argv and npm fallback argv", () => {
    expect(globalInstallArgs("npm", "crawclaw@latest")).toEqual([
      "npm",
      "i",
      "-g",
      "crawclaw@latest",
      "--no-fund",
      "--no-audit",
      "--loglevel=error",
    ]);
    expect(globalInstallArgs("pnpm", "crawclaw@latest")).toEqual([
      "pnpm",
      "add",
      "-g",
      "crawclaw@latest",
    ]);
    expect(globalInstallArgs("bun", "crawclaw@latest")).toEqual([
      "bun",
      "add",
      "-g",
      "crawclaw@latest",
    ]);

    expect(globalInstallFallbackArgs("npm", "crawclaw@latest")).toEqual([
      "npm",
      "i",
      "-g",
      "crawclaw@latest",
      "--omit=optional",
      "--no-fund",
      "--no-audit",
      "--loglevel=error",
    ]);
    expect(globalInstallFallbackArgs("pnpm", "crawclaw@latest")).toBeNull();
  });

  it("cleans only renamed package directories", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "crawclaw-update-cleanup-"));
    await fs.mkdir(path.join(root, ".crawclaw-123"), { recursive: true });
    await fs.mkdir(path.join(root, ".crawclaw-456"), { recursive: true });
    await fs.writeFile(path.join(root, ".crawclaw-file"), "nope", "utf8");
    await fs.mkdir(path.join(root, "crawclaw"), { recursive: true });

    await expect(
      cleanupGlobalRenameDirs({
        globalRoot: root,
        packageName: "crawclaw",
      }),
    ).resolves.toEqual({
      removed: [".crawclaw-123", ".crawclaw-456"],
    });
    await expect(fs.stat(path.join(root, "crawclaw"))).resolves.toBeDefined();
    await expect(fs.stat(path.join(root, ".crawclaw-file"))).resolves.toBeDefined();
  });

  it("checks bundled runtime sidecars, including Matrix helper-api", async () => {
    const packageRoot = await fs.mkdtemp(path.join(os.tmpdir(), "crawclaw-update-global-pkg-"));
    await fs.writeFile(
      path.join(packageRoot, "package.json"),
      JSON.stringify({ name: "crawclaw", version: "1.0.0" }),
      "utf-8",
    );
    for (const relativePath of BUNDLED_RUNTIME_SIDECAR_PATHS) {
      const absolutePath = path.join(packageRoot, relativePath);
      await fs.mkdir(path.dirname(absolutePath), { recursive: true });
      await fs.writeFile(absolutePath, "export {};\n", "utf-8");
    }

    await expect(collectInstalledGlobalPackageErrors({ packageRoot })).resolves.toEqual([]);

    await fs.rm(path.join(packageRoot, MATRIX_HELPER_API));
    await expect(collectInstalledGlobalPackageErrors({ packageRoot })).resolves.toContain(
      `missing bundled runtime sidecar ${MATRIX_HELPER_API}`,
    );
  });
});
