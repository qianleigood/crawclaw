import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

type WindowsPackedInstallSmoke = {
  cleanupTempRoot: (
    root: string,
    options?: {
      fsImpl?: Pick<typeof fs, "rmSync">;
      retryDelaysMs?: number[];
      sleepImpl?: (ms: number) => void;
      warn?: (message: string) => void;
    },
  ) => boolean;
  createSmokeEnv: (params: {
    env: NodeJS.ProcessEnv;
    prefixDir: string;
    stateDir: string;
    platform: NodeJS.Platform;
  }) => NodeJS.ProcessEnv;
  readTimeoutMsFromEnv: (env: NodeJS.ProcessEnv, key: string, fallbackMs: number) => number;
  resolveInstalledCrawClawBin: (params: { prefixDir: string; platform: NodeJS.Platform }) => string;
  resolvePackedTarball: (packOutput: string, packDir: string) => string;
  resolveRuntimeBinaryProbeArgs: (pluginId: string) => string[];
  validateRuntimeManifest: (manifest: unknown) => void;
  waitForGatewayRpcStatus: (
    crawclawBin: string,
    smokeEnv: NodeJS.ProcessEnv,
    options?: {
      now?: () => number;
      retryDelayMs?: number;
      run?: (
        crawclawBin: string,
        args: string[],
        options?: { env?: NodeJS.ProcessEnv; timeoutMs?: number },
      ) => unknown;
      sleep?: (ms: number) => void;
      timeoutMs?: number;
    },
  ) => unknown;
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
    expect(env.CRAWCLAW_RESTART_HEALTH_TIMEOUT_MS).toBe("360000");
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
    expect(
      script.readTimeoutMsFromEnv(
        { CRAWCLAW_WINDOWS_PACKED_GATEWAY_TIMEOUT_MS: "360000" },
        "CRAWCLAW_WINDOWS_PACKED_GATEWAY_TIMEOUT_MS",
        180000,
      ),
    ).toBe(360000);
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

  it("uses runtime-compatible binary probes", async () => {
    const script = await loadSmokeScript();

    expect(script.resolveRuntimeBinaryProbeArgs("browser")).toEqual(["--version"]);
    expect(script.resolveRuntimeBinaryProbeArgs("open-websearch")).toEqual(["--help"]);
  });

  it("retries gateway RPC status while the Windows task is still starting", async () => {
    const script = await loadSmokeScript();
    let now = 0;
    const sleeps: number[] = [];
    const attempts: string[][] = [];
    const result = script.waitForGatewayRpcStatus(
      "crawclaw.cmd",
      { CRAWCLAW_STATE_DIR: "state" },
      {
        now: () => now,
        retryDelayMs: 50,
        timeoutMs: 500,
        sleep: (ms) => {
          sleeps.push(ms);
          now += ms;
        },
        run: (_bin, args) => {
          attempts.push(args);
          if (attempts.length < 3) {
            throw new Error("gateway port is still free");
          }
          return { stdout: '{"health":{"healthy":true}}' };
        },
      },
    );

    expect(result).toEqual({ stdout: '{"health":{"healthy":true}}' });
    expect(attempts).toEqual([
      ["gateway", "status", "--deep", "--require-rpc", "--json"],
      ["gateway", "status", "--deep", "--require-rpc", "--json"],
      ["gateway", "status", "--deep", "--require-rpc", "--json"],
    ]);
    expect(sleeps).toEqual([50, 50]);
  });

  it("reports the last gateway RPC status error after the retry budget expires", async () => {
    const script = await loadSmokeScript();
    let now = 0;

    expect(() =>
      script.waitForGatewayRpcStatus(
        "crawclaw.cmd",
        {},
        {
          now: () => now,
          retryDelayMs: 40,
          timeoutMs: 100,
          sleep: (ms) => {
            now += ms;
          },
          run: () => {
            throw new Error(`not ready at ${now}`);
          },
        },
      ),
    ).toThrow(/not ready at 100/);
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

  it("treats persistent Windows cleanup locks as non-fatal after retries", async () => {
    const script = await loadSmokeScript();
    const calls: string[] = [];
    const sleeps: number[] = [];
    const warnings: string[] = [];
    const fsImpl = {
      rmSync: () => {
        calls.push("rm");
        throw Object.assign(new Error("locked"), { code: "EPERM" });
      },
    };

    expect(
      script.cleanupTempRoot("C:\\Temp\\crawclaw-smoke", {
        fsImpl,
        retryDelaysMs: [1, 2],
        sleepImpl: (ms) => sleeps.push(ms),
        warn: (message) => warnings.push(message),
      }),
    ).toBe(false);
    expect(calls).toEqual(["rm", "rm", "rm"]);
    expect(sleeps).toEqual([1, 2]);
    expect(warnings[0]).toContain("leaving temp root");
  });

  it("still fails on unexpected cleanup errors", async () => {
    const script = await loadSmokeScript();
    const fsImpl = {
      rmSync: () => {
        throw Object.assign(new Error("bad path"), { code: "EINVAL" });
      },
    };

    expect(() =>
      script.cleanupTempRoot("C:\\Temp\\crawclaw-smoke", {
        fsImpl,
        retryDelaysMs: [1],
        sleepImpl: () => {},
      }),
    ).toThrow(/bad path/);
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
