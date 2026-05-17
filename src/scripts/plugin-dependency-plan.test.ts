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
      setupEntry: "./setup-entry.ts",
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
  await fs.mkdir(path.join(repoRoot, "extensions", "qwen3-tts", "runtime"), {
    recursive: true,
  });
  await fs.writeFile(
    path.join(repoRoot, "extensions", "qwen3-tts", "runtime", "requirements.python.lock.txt"),
    "qwen-tts==0.1.1\n",
    "utf8",
  );
  return repoRoot;
}

describe("plugin dependency plan", () => {
  it("renders root and bundled plugin dependencies without managed runtime installers", async () => {
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
          entryPoints: [],
          npmSpec: "@crawclaw/sample",
          stageRuntimeDependencies: true,
        }),
        providerIds: ["sample"],
      }),
    ]);
    expect(plan.managedRuntimes).toEqual([]);
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
