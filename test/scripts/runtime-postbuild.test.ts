import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  copyStaticExtensionAssets,
  listStaticExtensionAssetOutputs,
  writeStableRootRuntimeAliases,
} from "../../scripts/runtime-postbuild.mjs";

const cleanupDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    cleanupDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })),
  );
});

async function createTempRoot() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "crawclaw-runtime-postbuild-"));
  cleanupDirs.push(dir);
  return dir;
}

describe("runtime postbuild static assets", () => {
  it("tracks plugin-owned static assets that release packaging must ship", () => {
    expect(listStaticExtensionAssetOutputs()).toContain(
      "dist/extensions/qwen3-tts/python/qwen3_tts_sidecar.py",
    );
    expect(listStaticExtensionAssetOutputs()).toContain(
      "dist/extensions/searxng/runtime/settings.yml",
    );
    expect(listStaticExtensionAssetOutputs()).toContain(
      "dist/extensions/searxng/runtime/source.lock.json",
    );
  });

  it("does not require legacy TS sqlite memory migrations after Rust memory cutover", () => {
    expect(listStaticExtensionAssetOutputs()).not.toContain("dist/migrations/001_init_runtime.sql");
  });

  it("copies declared static assets into dist", async () => {
    const rootDir = await createTempRoot();
    const src = "extensions/demo/runtime/asset.txt";
    const dest = "dist/extensions/demo/runtime/asset.txt";
    const sourcePath = path.join(rootDir, src);
    const destPath = path.join(rootDir, dest);
    await fs.mkdir(path.dirname(sourcePath), { recursive: true });
    await fs.writeFile(sourcePath, "proxy-data\n", "utf8");

    copyStaticExtensionAssets({
      rootDir,
      assets: [{ src, dest }],
    });

    expect(await fs.readFile(destPath, "utf8")).toBe("proxy-data\n");
  });

  it("warns when a declared static asset is missing", async () => {
    const rootDir = await createTempRoot();
    const warn = vi.fn();

    copyStaticExtensionAssets({
      rootDir,
      assets: [{ src: "missing/file.mjs", dest: "dist/file.mjs" }],
      warn,
    });

    expect(warn).toHaveBeenCalledWith(
      "[runtime-postbuild] static asset not found, skipping: missing/file.mjs",
    );
  });

  it("writes stable aliases for hashed root runtime modules", async () => {
    const rootDir = await createTempRoot();
    const distDir = path.join(rootDir, "dist");
    await fs.mkdir(distDir, { recursive: true });
    await fs.writeFile(
      path.join(distDir, "auth-profiles.runtime-XyZ987.js"),
      "export const auth = true;\n",
      "utf8",
    );
    await fs.writeFile(
      path.join(distDir, "status.summary.runtime-AbCd1234.js"),
      "export const status = true;\n",
      "utf8",
    );
    await fs.writeFile(
      path.join(distDir, "library-Other123.js"),
      "export const x = true;\n",
      "utf8",
    );

    writeStableRootRuntimeAliases({ rootDir });

    expect(await fs.readFile(path.join(distDir, "auth-profiles.runtime.js"), "utf8")).toBe(
      'export * from "./auth-profiles.runtime-XyZ987.js";\n',
    );
    expect(await fs.readFile(path.join(distDir, "status.summary.runtime.js"), "utf8")).toBe(
      'export * from "./status.summary.runtime-AbCd1234.js";\n',
    );
    await expect(fs.stat(path.join(distDir, "library.js"))).rejects.toThrow();
  });
});
