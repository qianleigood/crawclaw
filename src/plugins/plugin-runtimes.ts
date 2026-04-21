import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export type PluginRuntimeManifestEntry = {
  state?: string;
  installedAt?: string;
  [key: string]: unknown;
};

export type PluginRuntimeManifest = {
  plugins?: Record<string, PluginRuntimeManifestEntry>;
};

export function resolvePluginRuntimesRoot(env: NodeJS.ProcessEnv = process.env): string {
  const override = env.CRAWCLAW_STATE_DIR?.trim();
  const stateDir = override || path.join(os.homedir(), ".crawclaw");
  return path.join(stateDir, "runtimes");
}

export function resolvePluginRuntimeManifestPath(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(resolvePluginRuntimesRoot(env), "manifest.json");
}

export function readPluginRuntimeManifest(
  env: NodeJS.ProcessEnv = process.env,
): PluginRuntimeManifest {
  const manifestPath = resolvePluginRuntimeManifestPath(env);
  try {
    return JSON.parse(fs.readFileSync(manifestPath, "utf8")) as PluginRuntimeManifest;
  } catch {
    return { plugins: {} };
  }
}

export function writePluginRuntimeManifest(
  manifest: PluginRuntimeManifest,
  env: NodeJS.ProcessEnv = process.env,
): void {
  const manifestPath = resolvePluginRuntimeManifestPath(env);
  fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

export function resolveOpenWebSearchRuntimeDir(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(resolvePluginRuntimesRoot(env), "open-websearch");
}

export function resolveBrowserRuntimeDir(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(resolvePluginRuntimesRoot(env), "browser");
}

export function resolveBrowserRuntimeBin(env: NodeJS.ProcessEnv = process.env): string {
  return process.platform === "win32"
    ? path.join(resolveBrowserRuntimeDir(env), "node_modules", ".bin", "pinchtab.cmd")
    : path.join(resolveBrowserRuntimeDir(env), "node_modules", ".bin", "pinchtab");
}

export function resolveOpenWebSearchRuntimeBin(env: NodeJS.ProcessEnv = process.env): string {
  return process.platform === "win32"
    ? path.join(resolveOpenWebSearchRuntimeDir(env), "node_modules", ".bin", "open-websearch.cmd")
    : path.join(resolveOpenWebSearchRuntimeDir(env), "node_modules", ".bin", "open-websearch");
}

export function resolveScraplingFetchRuntimeDir(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(resolvePluginRuntimesRoot(env), "scrapling-fetch");
}

export function resolveScraplingFetchRuntimeVenvDir(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(resolveScraplingFetchRuntimeDir(env), "venv");
}

export function resolveScraplingFetchRuntimePython(env: NodeJS.ProcessEnv = process.env): string {
  return process.platform === "win32"
    ? path.join(resolveScraplingFetchRuntimeVenvDir(env), "Scripts", "python.exe")
    : path.join(resolveScraplingFetchRuntimeVenvDir(env), "bin", "python");
}

export function getPluginRuntimeStatus(
  pluginId: string,
  env: NodeJS.ProcessEnv = process.env,
): PluginRuntimeManifestEntry | null {
  return readPluginRuntimeManifest(env).plugins?.[pluginId] ?? null;
}

export function isPluginRuntimeHealthy(
  pluginId: string,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return getPluginRuntimeStatus(pluginId, env)?.state === "healthy";
}

export async function runPluginRuntimeInstall(
  params: {
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    stdio?: "inherit" | "pipe";
  } = {},
): Promise<void> {
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  let packageRoot = moduleDir;
  while (true) {
    const candidate = path.join(packageRoot, "scripts", "install-plugin-runtimes.mjs");
    if (fs.existsSync(candidate)) {
      break;
    }
    const parent = path.dirname(packageRoot);
    if (parent === packageRoot) {
      throw new Error("Could not locate scripts/install-plugin-runtimes.mjs from runtime module");
    }
    packageRoot = parent;
  }
  const cwd = params.cwd ?? packageRoot;
  const env = params.env ?? process.env;
  const scriptPath = path.join(packageRoot, "scripts", "install-plugin-runtimes.mjs");
  await new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, [scriptPath], {
      cwd,
      env,
      stdio: params.stdio ?? "inherit",
    });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`plugin runtime install failed with exit code ${code ?? "unknown"}`));
    });
  });
}

export function formatPluginRuntimeDoctorLines(env: NodeJS.ProcessEnv = process.env): string[] {
  const manifest = readPluginRuntimeManifest(env);
  const plugins = manifest.plugins ?? {};
  return Object.entries(plugins)
    .toSorted(([a], [b]) => a.localeCompare(b))
    .map(([pluginId, entry]) => {
      const state = entry.state ?? "unknown";
      const detail =
        typeof entry.pythonVersion === "string"
          ? `python ${entry.pythonVersion}`
          : typeof entry.package === "string" && entry.package.startsWith("pinchtab@")
            ? entry.package
            : typeof entry.reason === "string"
              ? entry.reason
              : typeof entry.error === "string"
                ? entry.error
                : typeof entry.version === "string"
                  ? `version ${entry.version}`
                  : "runtime metadata recorded";
      return `${pluginId}: ${state} (${detail})`;
    });
}
