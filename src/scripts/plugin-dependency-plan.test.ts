import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

type PluginDependencyPlanScript = {
  renderPluginDependencyPlan: (params: { repoRoot: string }) => Promise<{
    json: string;
    jsonl: string;
    plan: Record<string, unknown>;
  }>;
  writePluginDependencyPlanStatefile: (params: {
    check?: boolean;
    jsonPath?: string;
    repoRoot: string;
    statefilePath?: string;
  }) => Promise<{
    changed: boolean;
    jsonPath: string;
    statefilePath: string;
    wrote: boolean;
  }>;
};

async function loadPluginDependencyPlanScript(): Promise<PluginDependencyPlanScript> {
  return (await import(
    pathToFileURL(path.join(process.cwd(), "scripts", "lib", "plugin-dependency-plan.mjs")).href
  )) as PluginDependencyPlanScript;
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function createFixtureRepo(): Promise<string> {
  const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "crawclaw-plugin-deps-"));
  await writeJson(path.join(repoRoot, "package.json"), {
    dependencies: {
      zod: "^4.3.6",
    },
    devDependencies: {
      vitest: "^4.1.2",
    },
    engines: {
      node: ">=24.0.0 <26",
    },
    optionalDependencies: {
      openshell: "0.1.0",
    },
    packageManager: "pnpm@10.32.1",
    pnpm: {
      ignoredBuiltDependencies: ["koffi"],
      onlyBuiltDependencies: ["sharp"],
      overrides: {
        tar: "7.5.13",
      },
    },
  });
  await fs.writeFile(
    path.join(repoRoot, "pnpm-workspace.yaml"),
    [
      "packages:",
      "  - .",
      "  - extensions/*",
      "minimumReleaseAge: 2880",
      "onlyBuiltDependencies:",
      "  - esbuild",
      "ignoredBuiltDependencies:",
      "  - '@discordjs/opus'",
      "",
    ].join("\n"),
    "utf8",
  );
  await writeJson(path.join(repoRoot, "extensions", "sample", "crawclaw.plugin.json"), {
    id: "sample",
    enabledByDefault: true,
    providers: ["sample"],
    contracts: {
      modelProviders: ["sample"],
    },
  });
  await writeJson(path.join(repoRoot, "extensions", "sample", "package.json"), {
    crawclaw: {
      bundle: {
        stageRuntimeDependencies: true,
      },
      extensions: ["./index.ts"],
      install: {
        npmSpec: "@crawclaw/sample",
      },
    },
    dependencies: {
      "https-proxy-agent": "^9.0.0",
    },
    devDependencies: {
      crawclaw: "workspace:*",
    },
    name: "@crawclaw/sample",
    peerDependencies: {
      crawclaw: "2026.4.1-beta.1",
    },
    version: "0.0.0",
  });
  await fs.mkdir(path.join(repoRoot, "scripts"), { recursive: true });
  await fs.writeFile(
    path.join(repoRoot, "scripts", "install-plugin-runtimes.mjs"),
    [
      'const OPEN_WEBSEARCH_VERSION = "2.1.5";',
      'const PINCHTAB_VERSION = "0.9.1";',
      'const WINDOWS_SCRAPLING_RUNTIME_PACKAGES = ["msvc-runtime==14.44.35112"];',
      '"No supported Python interpreter found for scrapling-fetch; requires Python >= 3.10.";',
      "env.CRAWCLAW_RUNTIME_PYTHON;",
      "env.CRAWCLAW_SCRAPLING_PYTHON;",
      '"python3.13";',
      '"python3.12";',
      '"python3.10";',
      '"python3";',
      '"python";',
      '"py";',
      "",
    ].join("\n"),
    "utf8",
  );
  await fs.mkdir(path.join(repoRoot, "extensions", "scrapling-fetch", "runtime"), {
    recursive: true,
  });
  await fs.writeFile(
    path.join(repoRoot, "extensions", "scrapling-fetch", "runtime", "requirements.lock.txt"),
    "Scrapling==0.4.6\ncurl-cffi==0.13.0\n",
    "utf8",
  );
  return repoRoot;
}

describe("plugin dependency plan", () => {
  it("renders root, bundled plugin, and managed runtime dependencies", async () => {
    const script = await loadPluginDependencyPlanScript();
    const repoRoot = await createFixtureRepo();

    const rendered = await script.renderPluginDependencyPlan({ repoRoot });
    const plan = rendered.plan as {
      bundledPlugins: Array<{
        dependencies: Record<string, string>;
        enabledByDefault: boolean;
        id: string;
        install: { npmSpec?: string; stageRuntimeDependencies: boolean };
        providerIds: string[];
      }>;
      managedRuntimes: Array<{
        id: string;
        installTime: boolean;
        npmPackage?: string;
        platforms?: string[];
        source?: string;
        python?: {
          candidates: string[];
          envOverrides: string[];
          minimumVersion: string;
          requirements: string[];
          windowsExtraPackages: string[];
        };
      }>;
      root: {
        dependencies: Record<string, string>;
        engines: Record<string, string>;
        packageManager: string;
        pnpm: {
          packageJsonOnlyBuiltDependencies: string[];
          workspaceOnlyBuiltDependencies: string[];
        };
      };
    };

    expect(plan.root).toMatchObject({
      dependencies: { zod: "^4.3.6" },
      engines: { node: ">=24.0.0 <26" },
      packageManager: "pnpm@10.32.1",
      pnpm: {
        packageJsonOnlyBuiltDependencies: ["sharp"],
        workspaceOnlyBuiltDependencies: ["esbuild"],
      },
    });
    expect(plan.bundledPlugins).toEqual([
      expect.objectContaining({
        dependencies: { "https-proxy-agent": "^9.0.0" },
        enabledByDefault: true,
        id: "sample",
        install: expect.objectContaining({
          npmSpec: "@crawclaw/sample",
          stageRuntimeDependencies: true,
        }),
        providerIds: ["sample"],
      }),
    ]);
    expect(plan.managedRuntimes).toEqual([
      expect.objectContaining({
        id: "browser",
        installTime: true,
        npmPackage: "pinchtab@0.9.1",
        source: "scripts/install-plugin-runtimes.mjs",
      }),
      expect.objectContaining({
        id: "core-skills",
        installTime: true,
        source: "scripts/install-plugin-runtimes.mjs",
        python: expect.objectContaining({
          candidates: expect.arrayContaining([
            "python3.14",
            "python3.13",
            "python3.12",
            "python3.11",
            "python3.10",
            "python3",
            "python",
            "py",
          ]),
          envOverrides: ["CRAWCLAW_RUNTIME_PYTHON", "CRAWCLAW_CORE_SKILLS_PYTHON"],
          minimumVersion: "3.10",
          requirements: ["PyYAML==6.0.3"],
        }),
      }),
      expect.objectContaining({
        id: "n8n",
        installTime: true,
        npmPackage: "n8n@2.18.5",
        source: "scripts/install-plugin-runtimes.mjs",
      }),
      expect.objectContaining({
        id: "notebooklm-mcp-cli",
        installTime: true,
        source: "scripts/install-plugin-runtimes.mjs",
        python: expect.objectContaining({
          envOverrides: ["CRAWCLAW_RUNTIME_PYTHON", "CRAWCLAW_NOTEBOOKLM_PYTHON"],
          minimumVersion: "3.11",
          package: "notebooklm-mcp-cli==0.6.1",
        }),
      }),
      expect.objectContaining({
        id: "open-websearch",
        installTime: true,
        npmPackage: "open-websearch@2.1.5",
        source: "scripts/install-plugin-runtimes.mjs",
      }),
      expect.objectContaining({
        id: "qwen3-tts",
        installTime: true,
        platforms: [
          "darwin:arm64",
          "darwin:x64",
          "linux:x64",
          "linux:arm64",
          "win32:x64",
          "win32:arm64",
        ],
        source: "scripts/install-plugin-runtimes.mjs",
        python: expect.objectContaining({
          candidates: expect.arrayContaining([
            "python3.14",
            "python3.13",
            "python3.12",
            "python3.11",
            "python3.10",
            "python3",
            "python",
            "py",
          ]),
          envOverrides: ["CRAWCLAW_RUNTIME_PYTHON", "CRAWCLAW_QWEN3_TTS_PYTHON"],
          minimumVersion: "3.10",
          requirements: ["qwen-tts==0.1.1"],
        }),
      }),
      expect.objectContaining({
        id: "scrapling-fetch",
        installTime: true,
        source: "scripts/install-plugin-runtimes.mjs",
        python: expect.objectContaining({
          candidates: expect.arrayContaining([
            "python3.14",
            "python3.13",
            "python3.12",
            "python3.11",
            "python3.10",
            "python3",
            "python",
            "py",
          ]),
          envOverrides: ["CRAWCLAW_RUNTIME_PYTHON", "CRAWCLAW_SCRAPLING_PYTHON"],
          minimumVersion: "3.10",
          requirements: expect.arrayContaining([
            "Scrapling==0.4.6",
            "curl-cffi==0.15.0",
            "playwright==1.58.0",
            "browserforge==1.2.4",
            "patchright==1.58.2",
            "msgspec==0.20.0",
          ]),
          windowsExtraPackages: ["msvc-runtime==14.44.35112"],
        }),
      }),
      expect.objectContaining({
        id: "skill-openai-whisper",
        installTime: false,
        platforms: ["darwin:arm64"],
        source: "scripts/install-plugin-runtimes.mjs",
        python: expect.objectContaining({
          envOverrides: ["CRAWCLAW_RUNTIME_PYTHON", "CRAWCLAW_CORE_SKILLS_PYTHON"],
          minimumVersion: "3.10",
          requirements: ["mlx-whisper==0.4.3"],
        }),
      }),
    ]);
    expect(rendered.json).toContain('"generatedBy": "scripts/generate-plugin-dependency-plan.mjs"');
    expect(rendered.jsonl).toContain('"kind":"bundled-plugin"');
  });

  it("does not write baseline files in check mode", async () => {
    const script = await loadPluginDependencyPlanScript();
    const repoRoot = await createFixtureRepo();
    const jsonPath = path.join(repoRoot, "docs", ".generated", "plugin-dependency-plan.json");
    const statefilePath = path.join(repoRoot, "docs", ".generated", "plugin-dependency-plan.jsonl");

    const result = await script.writePluginDependencyPlanStatefile({
      check: true,
      jsonPath,
      repoRoot,
      statefilePath,
    });

    expect(result).toMatchObject({
      changed: true,
      wrote: false,
    });
    await expect(fs.stat(jsonPath)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(fs.stat(statefilePath)).rejects.toMatchObject({ code: "ENOENT" });
  });
});
