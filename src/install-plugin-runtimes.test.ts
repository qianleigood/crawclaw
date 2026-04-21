import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

type RuntimeInstallScript = {
  createLocalPrefixNpmInstallArgs: (runtimeDir: string, packageSpec: string) => string[];
  createNestedNpmInstallEnv: (env: NodeJS.ProcessEnv) => NodeJS.ProcessEnv;
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
});
