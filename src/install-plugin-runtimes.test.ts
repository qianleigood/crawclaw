import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

type RuntimeInstallScript = {
  createUnavailableRuntimeEntry: (error: unknown) => {
    error: string;
    installedAt: string;
    reason: string;
    state: string;
  };
  installRuntimeOrUnavailable: (
    pluginId: string,
    installer: (env: NodeJS.ProcessEnv) => Record<string, unknown>,
    env: NodeJS.ProcessEnv,
    log: {
      log: (message: string) => void;
      warn: (message: string) => void;
    },
  ) => Record<string, unknown>;
  createLocalPrefixNpmInstallArgs: (runtimeDir: string, packageSpec: string) => string[];
  createNestedNpmInstallEnv: (env: NodeJS.ProcessEnv) => NodeJS.ProcessEnv;
  resolvePythonCandidates: (env: NodeJS.ProcessEnv, platform?: NodeJS.Platform) => string[];
  resolveRuntimeSpawn: (
    command: string,
    args: string[],
    params?: { comSpec?: string; env?: NodeJS.ProcessEnv; platform?: NodeJS.Platform },
  ) => {
    args: string[];
    command: string;
    shell?: boolean;
    windowsVerbatimArguments?: boolean;
  };
  resolveScraplingVenvPython: (venvDir: string, platform?: NodeJS.Platform) => string;
};

async function loadRuntimeInstallScript(): Promise<RuntimeInstallScript> {
  return (await import(
    pathToFileURL(path.join(process.cwd(), "scripts", "install-plugin-runtimes.mjs")).href
  )) as RuntimeInstallScript;
}

describe("install-plugin-runtimes", () => {
  it("forces nested npm installs into local prefix mode", async () => {
    const script = await loadRuntimeInstallScript();

    expect(script.createLocalPrefixNpmInstallArgs("C:\\runtime", "pinchtab@0.9.1")).toEqual([
      "install",
      "--global=false",
      "--prefix",
      "C:\\runtime",
      "--no-save",
      "--package-lock=false",
      "pinchtab@0.9.1",
    ]);

    expect(
      script.createNestedNpmInstallEnv({
        PATH: "C:\\node",
        npm_config_global: "true",
        npm_config_location: "global",
        NPM_CONFIG_PREFIX: "C:\\node",
      }),
    ).toEqual({ PATH: "C:\\node" });
  });

  it("resolves scrapling venv python paths by platform", async () => {
    const script = await loadRuntimeInstallScript();

    expect(script.resolveScraplingVenvPython("C:\\runtime\\venv", "win32")).toBe(
      path.win32.join("C:\\runtime\\venv", "Scripts", "python.exe"),
    );
    expect(script.resolveScraplingVenvPython("/tmp/runtime/venv", "darwin")).toBe(
      path.posix.join("/tmp/runtime/venv", "bin", "python"),
    );
  });

  it("includes Windows Python launcher candidates", async () => {
    const script = await loadRuntimeInstallScript();

    expect(script.resolvePythonCandidates({}, "win32")).toEqual(
      expect.arrayContaining(["python", "py"]),
    );
  });

  it("wraps Windows cmd shims before spawning them", async () => {
    const script = await loadRuntimeInstallScript();

    expect(
      script.resolveRuntimeSpawn("C:\\Program Files\\PinchTab\\pinchtab.cmd", ["--version"], {
        comSpec: "C:\\Windows\\System32\\cmd.exe",
        platform: "win32",
      }),
    ).toEqual({
      command: "C:\\Windows\\System32\\cmd.exe",
      args: ["/d", "/s", "/c", '"C:\\Program Files\\PinchTab\\pinchtab.cmd" --version'],
      shell: false,
      windowsVerbatimArguments: true,
    });
  });

  it("records missing Python as an unavailable runtime", async () => {
    const script = await loadRuntimeInstallScript();

    expect(
      script.createUnavailableRuntimeEntry(
        new Error(
          "No supported Python interpreter found for scrapling-fetch; requires Python >= 3.10.",
        ),
      ),
    ).toMatchObject({
      error: "No supported Python interpreter found for scrapling-fetch; requires Python >= 3.10.",
      reason: "missing-python",
      state: "unavailable",
    });
  });

  it("logs each runtime install phase", async () => {
    const script = await loadRuntimeInstallScript();
    const messages: string[] = [];
    const warnings: string[] = [];

    const result = script.installRuntimeOrUnavailable(
      "browser",
      () => ({ state: "healthy", version: "pinchtab 0.9.1" }),
      {},
      {
        log: (message) => messages.push(message),
        warn: (message) => warnings.push(message),
      },
    );

    expect(result).toMatchObject({ state: "healthy", version: "pinchtab 0.9.1" });
    expect(messages[0]).toBe("[postinstall] installing plugin runtime: browser");
    expect(messages[1]).toMatch(/^\[postinstall\] plugin runtime ready: browser \(\d+ms\)$/);
    expect(warnings).toEqual([]);
  });

  it("logs unavailable runtime phases", async () => {
    const script = await loadRuntimeInstallScript();
    const messages: string[] = [];
    const warnings: string[] = [];

    const result = script.installRuntimeOrUnavailable(
      "scrapling-fetch",
      () => {
        throw new Error(
          "No supported Python interpreter found for scrapling-fetch; requires Python >= 3.10.",
        );
      },
      {},
      {
        log: (message) => messages.push(message),
        warn: (message) => warnings.push(message),
      },
    );

    expect(result).toMatchObject({ state: "unavailable", reason: "missing-python" });
    expect(messages).toEqual(["[postinstall] installing plugin runtime: scrapling-fetch"]);
    expect(warnings).toEqual([
      "[postinstall] plugin runtime unavailable: scrapling-fetch (missing-python)",
    ]);
  });
});
