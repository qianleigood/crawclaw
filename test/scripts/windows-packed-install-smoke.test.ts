import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

type WindowsPackedInstallSmoke = {
  createSmokeEnv: (params: {
    env: NodeJS.ProcessEnv;
    prefixDir: string;
    stateDir: string;
    platform: NodeJS.Platform;
  }) => NodeJS.ProcessEnv;
  readTimeoutMsFromEnv: (env: NodeJS.ProcessEnv, key: string, fallbackMs: number) => number;
  resolveInstalledCrawClawBin: (params: { prefixDir: string; platform: NodeJS.Platform }) => string;
  resolvePackedTarball: (packOutput: string, packDir: string) => string;
  validateRuntimeManifest: (manifest: unknown) => void;
};

async function loadSmokeScript(): Promise<WindowsPackedInstallSmoke> {
  return (await import(
    pathToFileURL(path.join(process.cwd(), "scripts", "ci", "windows-packed-install-smoke.mjs"))
      .href
  )) as WindowsPackedInstallSmoke;
}

describe("windows packed install smoke helpers", () => {
  it("resolves npm global shims by platform", async () => {
    const script = await loadSmokeScript();

    expect(
      script.resolveInstalledCrawClawBin({
        prefixDir: "C:\\Users\\runner\\AppData\\Local\\Temp\\prefix",
        platform: "win32",
      }),
    ).toBe(path.win32.join("C:\\Users\\runner\\AppData\\Local\\Temp\\prefix", "crawclaw.cmd"));
    expect(
      script.resolveInstalledCrawClawBin({
        prefixDir: "/tmp/prefix",
        platform: "linux",
      }),
    ).toBe(path.posix.join("/tmp/prefix", "bin", "crawclaw"));
  });

  it("prepends the global install prefix to PATH on Windows", async () => {
    const script = await loadSmokeScript();
    const env = script.createSmokeEnv({
      env: { Path: "C:\\Windows\\System32", npm_config_prefix: "C:\\old" },
      prefixDir: "C:\\Temp\\prefix",
      stateDir: "C:\\Temp\\state",
      platform: "win32",
    });

    expect(env.Path).toBe(`C:\\Temp\\prefix${path.delimiter}C:\\Windows\\System32`);
    expect(env.CRAWCLAW_STATE_DIR).toBe("C:\\Temp\\state");
    expect(env.npm_config_prefix).toBeUndefined();
  });

  it("allows the packed install timeout to be configured from env", async () => {
    const script = await loadSmokeScript();

    expect(
      script.readTimeoutMsFromEnv(
        { CRAWCLAW_WINDOWS_PACKED_INSTALL_TIMEOUT_MS: "2700000" },
        "CRAWCLAW_WINDOWS_PACKED_INSTALL_TIMEOUT_MS",
        1800000,
      ),
    ).toBe(2700000);
    expect(
      script.readTimeoutMsFromEnv(
        { CRAWCLAW_WINDOWS_PACKED_INSTALL_TIMEOUT_MS: "invalid" },
        "CRAWCLAW_WINDOWS_PACKED_INSTALL_TIMEOUT_MS",
        1800000,
      ),
    ).toBe(1800000);
  });

  it("accepts a complete postinstall runtime manifest", async () => {
    const script = await loadSmokeScript();

    expect(() =>
      script.validateRuntimeManifest({
        plugins: {
          browser: { state: "healthy", binPath: "C:\\Temp\\pinchtab.cmd" },
          "open-websearch": { state: "healthy", binPath: "C:\\Temp\\open-websearch.cmd" },
          "scrapling-fetch": { state: "healthy", pythonVersion: "3.14.0" },
        },
      }),
    ).not.toThrow();
  });

  it("resolves plain npm pack output without requiring the large JSON file list", async () => {
    const script = await loadSmokeScript();
    const packDir = fs.mkdtempSync(path.join(os.tmpdir(), "crawclaw-pack-test-"));
    try {
      const tarballPath = path.join(packDir, "crawclaw-2026.4.15.tgz");
      fs.writeFileSync(tarballPath, "");
      expect(script.resolvePackedTarball("crawclaw-2026.4.15.tgz\n", packDir)).toBe(tarballPath);
    } finally {
      fs.rmSync(packDir, { recursive: true, force: true });
    }
  });

  it("rejects missing install-time runtime manifest entries", async () => {
    const script = await loadSmokeScript();

    expect(() =>
      script.validateRuntimeManifest({
        plugins: {
          browser: { state: "healthy" },
          "open-websearch": { state: "healthy" },
        },
      }),
    ).toThrow(/scrapling-fetch/);
  });
});
