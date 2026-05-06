import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  resolveBrowserRuntimeBin,
  getPluginRuntimeManifestHealth,
  formatPluginRuntimeDoctorLines,
  createN8nRuntimeEnv,
  normalizeN8nLocale,
  readPluginRuntimeManifest,
  resolveN8nRuntimeBin,
  resolveOpenWebSearchRuntimeBin,
  resolvePluginRuntimeManifestPath,
  resolvePluginRuntimesRoot,
  resolveQwen3TtsRuntimePython,
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
    expect(resolvePluginRuntimesRoot(env)).toBe(
      path.join(env.CRAWCLAW_STATE_DIR!, "runtimes", `node-${process.versions.node.split(".")[0]}`),
    );
    expect(resolvePluginRuntimeManifestPath(env)).toBe(
      path.join(env.CRAWCLAW_STATE_DIR!, "runtimes", "manifest.json"),
    );
    expect(resolveOpenWebSearchRuntimeBin(env)).toContain(
      path.join(
        "runtimes",
        `node-${process.versions.node.split(".")[0]}`,
        "open-websearch",
        "node_modules",
        ".bin",
        "open-websearch",
      ),
    );
    expect(resolveBrowserRuntimeBin(env)).toContain(
      path.join(
        "runtimes",
        `node-${process.versions.node.split(".")[0]}`,
        "browser",
        "node_modules",
        ".bin",
        "pinchtab",
      ),
    );
    expect(resolveN8nRuntimeBin(env)).toContain(
      path.join(
        "runtimes",
        `node-${process.versions.node.split(".")[0]}`,
        "n8n",
        "node_modules",
        ".bin",
        "n8n",
      ),
    );
    expect(resolveScraplingFetchRuntimePython(env)).toContain("scrapling-fetch");
    expect(resolveQwen3TtsRuntimePython(env)).toContain("qwen3-tts");
  });

  it("maps CrawClaw locales into n8n startup env", () => {
    expect(normalizeN8nLocale("zh-CN")).toBe("zh-CN");
    expect(normalizeN8nLocale("zh_Hans_CN.UTF-8")).toBe("zh-CN");
    expect(normalizeN8nLocale("en-US")).toBe("en");
    expect(normalizeN8nLocale("fr-FR")).toBe("en");

    expect(
      createN8nRuntimeEnv({
        env: { PATH: "/bin" },
        locale: "zh-CN",
      }),
    ).toMatchObject({
      PATH: "/bin",
      N8N_DEFAULT_LOCALE: "zh-CN",
    });
    expect(createN8nRuntimeEnv({ env: {}, locale: "en-US" }).N8N_DEFAULT_LOCALE).toBe("en");
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
      node: {
        abi: process.versions.modules,
        major: Number.parseInt(process.versions.node.split(".")[0] ?? "0", 10),
        supportLevel: "stable",
        version: process.versions.node,
      },
      runtimeRoot: resolvePluginRuntimesRoot(env),
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

  it("reports manifest mismatch when runtime metadata targets another node major", () => {
    const env: NodeJS.ProcessEnv = {
      ...makeEnv(),
      CRAWCLAW_RUNTIME_NODE_VERSION: "25.0.0",
      CRAWCLAW_RUNTIME_NODE_ABI: "141",
    };
    writePluginRuntimeManifest(
      {
        node: {
          major: 24,
          version: "24.14.1",
          abi: "137",
          supportLevel: "stable",
        },
        runtimeRoot: path.join(env.CRAWCLAW_STATE_DIR!, "runtimes", "node-24"),
        plugins: {
          browser: { state: "healthy", package: "pinchtab@0.9.1" },
        },
      },
      env,
    );
    expect(getPluginRuntimeManifestHealth(env).mismatchReason).toContain(
      "manifest targets Node 24",
    );
    expect(formatPluginRuntimeDoctorLines(env)[0]).toContain("manifest mismatch");
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
