import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  resolveBrowserRuntimeBin,
  formatPluginRuntimeDoctorLines,
  readPluginRuntimeManifest,
  resolveOpenWebSearchRuntimeBin,
  resolvePluginRuntimeManifestPath,
  resolvePluginRuntimesRoot,
  resolveScraplingFetchRuntimePython,
  writePluginRuntimeManifest,
} from "./plugin-runtimes.js";

const tempRoots: string[] = [];

function makeEnv(): NodeJS.ProcessEnv {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "crawclaw-runtime-test-"));
  tempRoots.push(stateDir);
  return { ...process.env, CRAWCLAW_STATE_DIR: stateDir };
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("plugin-runtimes", () => {
  it("resolves runtime paths under the crawclaw state dir", () => {
    const env = makeEnv();
    expect(resolvePluginRuntimesRoot(env)).toBe(path.join(env.CRAWCLAW_STATE_DIR!, "runtimes"));
    expect(resolvePluginRuntimeManifestPath(env)).toBe(
      path.join(env.CRAWCLAW_STATE_DIR!, "runtimes", "manifest.json"),
    );
    expect(resolveOpenWebSearchRuntimeBin(env)).toContain(
      path.join("runtimes", "open-websearch", "node_modules", ".bin", "open-websearch"),
    );
    expect(resolveBrowserRuntimeBin(env)).toContain(
      path.join("runtimes", "browser", "node_modules", ".bin", "pinchtab"),
    );
    expect(resolveScraplingFetchRuntimePython(env)).toContain("scrapling-fetch");
  });

  it("writes and reads the runtime manifest", () => {
    const env = makeEnv();
    writePluginRuntimeManifest(
      {
        plugins: {
          browser: { state: "healthy", version: "1.2.3", package: "pinchtab@0.9.1" },
          "open-websearch": { state: "healthy", version: "2.1.5" },
          "scrapling-fetch": { state: "healthy", pythonVersion: "3.14.4" },
        },
      },
      env,
    );
    expect(readPluginRuntimeManifest(env)).toEqual({
      plugins: {
        browser: { state: "healthy", version: "1.2.3", package: "pinchtab@0.9.1" },
        "open-websearch": { state: "healthy", version: "2.1.5" },
        "scrapling-fetch": { state: "healthy", pythonVersion: "3.14.4" },
      },
    });
    expect(formatPluginRuntimeDoctorLines(env)).toEqual([
      "browser: healthy (pinchtab@0.9.1)",
      "open-websearch: healthy (version 2.1.5)",
      "scrapling-fetch: healthy (python 3.14.4)",
    ]);
  });

  it("formats unavailable runtime reasons", () => {
    const env = makeEnv();
    writePluginRuntimeManifest(
      {
        plugins: {
          "scrapling-fetch": { state: "unavailable", reason: "missing-python" },
        },
      },
      env,
    );

    expect(formatPluginRuntimeDoctorLines(env)).toEqual([
      "scrapling-fetch: unavailable (missing-python)",
    ]);
  });
});
