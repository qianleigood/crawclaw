import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

type RuntimeInstallScript = {
  buildScraplingImportCheckScript: () => string;
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
  runNpmInstallWithRetry: (
    command: string,
    args: string[],
    options: Record<string, unknown>,
    deps?: {
      maxAttempts?: number;
      runImpl?: (
        command: string,
        args: string[],
        options: Record<string, unknown>,
      ) => Record<string, unknown>;
      sleepImpl?: (ms: number) => void;
    },
  ) => Record<string, unknown>;
  resolveScraplingRuntimePackages: (
    lockedPackages: readonly string[],
    platform?: NodeJS.Platform,
  ) => string[];
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
  listManagedPluginRuntimeInstallPlan: (params?: {
    arch?: NodeJS.Architecture;
    platform?: NodeJS.Platform;
  }) => Array<{
    id: string;
    installTime: boolean;
    localization?: {
      locale: string;
      source: string;
      url: string;
    };
    npmPackage?: string;
    platforms?: string[];
    python?: {
      candidates: string[];
      envOverrides: string[];
      minimumVersion: string;
      package?: string;
      requirementsLockPath?: string;
      windowsExtraPackages?: string[];
    };
  }>;
  resolveN8nChineseEditorUiUrl: (version?: string) => string;
  resolveScraplingVenvPython: (venvDir: string, platform?: NodeJS.Platform) => string;
  shouldRetryNpmInstallError: (error: unknown) => boolean;
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

  it("classifies transient npm network failures as retryable", async () => {
    const script = await loadRuntimeInstallScript();

    expect(
      script.shouldRetryNpmInstallError(
        new Error("npm error code ECONNRESET\nnpm error network aborted"),
      ),
    ).toBe(true);
    expect(script.shouldRetryNpmInstallError(new Error("open-websearch binary missing"))).toBe(
      false,
    );
  });

  it("retries transient npm runtime installs", async () => {
    const script = await loadRuntimeInstallScript();
    const calls: string[] = [];
    const sleeps: number[] = [];

    const result = script.runNpmInstallWithRetry(
      "npm",
      ["install", "open-websearch@2.1.5"],
      { env: { PATH: "/bin" } },
      {
        maxAttempts: 2,
        runImpl: (command, args) => {
          calls.push([command, ...args].join(" "));
          if (calls.length === 1) {
            throw new Error("npm error code ECONNRESET\nnpm error network aborted");
          }
          return { status: 0 };
        },
        sleepImpl: (ms) => sleeps.push(ms),
      },
    );

    expect(result).toEqual({ status: 0 });
    expect(calls).toEqual(["npm install open-websearch@2.1.5", "npm install open-websearch@2.1.5"]);
    expect(sleeps).toEqual([1000]);
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

  it("keeps platform-specific Python candidates scoped", async () => {
    const script = await loadRuntimeInstallScript();

    expect(script.resolvePythonCandidates({}, "darwin")).toEqual(
      expect.arrayContaining(["/opt/homebrew/bin/python3", "python3"]),
    );
    expect(script.resolvePythonCandidates({}, "linux")).not.toContain("/opt/homebrew/bin/python3");
    expect(script.resolvePythonCandidates({}, "linux")).not.toContain("py");
  });

  it("installs the app-local MSVC runtime for Windows Scrapling venvs", async () => {
    const script = await loadRuntimeInstallScript();

    expect(script.resolveScraplingRuntimePackages(["Scrapling==0.4.6"], "win32")).toEqual([
      "Scrapling==0.4.6",
      "msvc-runtime==14.44.35112",
    ]);
    expect(script.resolveScraplingRuntimePackages(["Scrapling==0.4.6"], "darwin")).toEqual([
      "Scrapling==0.4.6",
    ]);
  });

  it("adds Windows venv DLL directories before verifying Scrapling imports", async () => {
    const script = await loadRuntimeInstallScript();

    expect(script.buildScraplingImportCheckScript()).toContain("os.add_dll_directory(_path)");
    expect(script.buildScraplingImportCheckScript()).toContain(
      "os.path.join(sys.prefix, 'Scripts')",
    );
    expect(script.buildScraplingImportCheckScript()).toContain(
      "from scrapling.fetchers import Fetcher, StealthyFetcher, DynamicFetcher",
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

  it("exposes the managed runtime install plan with Python policy", async () => {
    const script = await loadRuntimeInstallScript();

    expect(script.listManagedPluginRuntimeInstallPlan({ platform: "win32" })).toEqual([
      {
        id: "browser",
        installTime: true,
        npmPackage: "pinchtab@0.9.1",
      },
      {
        id: "core-skills",
        installTime: true,
        python: {
          candidates: [
            "python3.14",
            "python3.13",
            "python3.12",
            "python3.11",
            "python3.10",
            "python3",
            "python",
            "py",
          ],
          envOverrides: ["CRAWCLAW_RUNTIME_PYTHON", "CRAWCLAW_CORE_SKILLS_PYTHON"],
          minimumVersion: "3.10",
          requirementsLockPath: path.join(
            process.cwd(),
            "skills",
            ".runtime",
            "requirements.lock.txt",
          ),
        },
      },
      {
        id: "n8n",
        installTime: true,
        localization: {
          locale: "zh-CN",
          source: "other-blowsnow/n8n-i18n-chinese",
          url: "https://github.com/other-blowsnow/n8n-i18n-chinese/releases/download/release%2F2.18.5/editor-ui.tar.gz",
        },
        npmPackage: "n8n@2.18.5",
      },
      {
        id: "open-websearch",
        installTime: true,
        npmPackage: "open-websearch@2.1.5",
      },
      {
        id: "scrapling-fetch",
        installTime: true,
        python: {
          candidates: [
            "python3.14",
            "python3.13",
            "python3.12",
            "python3.11",
            "python3.10",
            "python3",
            "python",
            "py",
          ],
          envOverrides: ["CRAWCLAW_RUNTIME_PYTHON", "CRAWCLAW_SCRAPLING_PYTHON"],
          minimumVersion: "3.10",
          requirementsLockPath: path.join(
            process.cwd(),
            "extensions",
            "scrapling-fetch",
            "runtime",
            "requirements.lock.txt",
          ),
          windowsExtraPackages: ["msvc-runtime==14.44.35112"],
        },
      },
      {
        id: "notebooklm-mcp-cli",
        installTime: true,
        python: {
          candidates: [
            "python3.14",
            "python3.13",
            "python3.12",
            "python3.11",
            "python3.10",
            "python3",
            "python",
            "py",
          ],
          envOverrides: ["CRAWCLAW_RUNTIME_PYTHON", "CRAWCLAW_NOTEBOOKLM_PYTHON"],
          minimumVersion: "3.11",
          package: "notebooklm-mcp-cli==0.6.1",
        },
      },
      {
        id: "skill-openai-whisper",
        installTime: false,
        platforms: ["darwin:arm64"],
        python: {
          candidates: [
            "python3.14",
            "python3.13",
            "python3.12",
            "python3.11",
            "python3.10",
            "python3",
            "python",
            "py",
          ],
          envOverrides: ["CRAWCLAW_RUNTIME_PYTHON", "CRAWCLAW_CORE_SKILLS_PYTHON"],
          minimumVersion: "3.10",
          requirementsLockPath: path.join(
            process.cwd(),
            "skills",
            "openai-whisper",
            "runtime",
            "requirements.macos-arm64.lock.txt",
          ),
        },
      },
    ]);
  });

  it("resolves the version-paired n8n Chinese editor UI archive", async () => {
    const script = await loadRuntimeInstallScript();

    expect(script.resolveN8nChineseEditorUiUrl("2.18.5")).toBe(
      "https://github.com/other-blowsnow/n8n-i18n-chinese/releases/download/release%2F2.18.5/editor-ui.tar.gz",
    );
  });

  it("only marks MLX Whisper install-time on Apple Silicon macOS", async () => {
    const script = await loadRuntimeInstallScript();

    const macArm = script
      .listManagedPluginRuntimeInstallPlan({ platform: "darwin", arch: "arm64" })
      .find((entry) => entry.id === "skill-openai-whisper");
    const macX64 = script
      .listManagedPluginRuntimeInstallPlan({ platform: "darwin", arch: "x64" })
      .find((entry) => entry.id === "skill-openai-whisper");
    const linuxX64 = script
      .listManagedPluginRuntimeInstallPlan({ platform: "linux", arch: "x64" })
      .find((entry) => entry.id === "skill-openai-whisper");

    expect(macArm?.installTime).toBe(true);
    expect(macArm?.platforms).toEqual(["darwin:arm64"]);
    expect(macX64?.installTime).toBe(false);
    expect(linuxX64?.installTime).toBe(false);
  });
});
