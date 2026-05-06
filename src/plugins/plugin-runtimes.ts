import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveNodeSupportLevel, type NodeSupportLevel } from "../infra/runtime-guard.js";

export type PluginRuntimeManifestEntry = {
  state?: string;
  installedAt?: string;
  [key: string]: unknown;
};

export type PluginRuntimeManifestNode = {
  major?: number;
  version?: string;
  abi?: string;
  supportLevel?: NodeSupportLevel;
};

export type PluginRuntimeManifest = {
  node?: PluginRuntimeManifestNode;
  runtimeRoot?: string;
  plugins?: Record<string, PluginRuntimeManifestEntry>;
};

export function resolvePluginRuntimeStateRoot(env: NodeJS.ProcessEnv = process.env): string {
  const override = env.CRAWCLAW_STATE_DIR?.trim();
  const stateDir = override || path.join(os.homedir(), ".crawclaw");
  return path.join(stateDir, "runtimes");
}

export function resolveCurrentNodeMajor(
  env: NodeJS.ProcessEnv = process.env,
  version = env.CRAWCLAW_RUNTIME_NODE_VERSION?.trim() || process.versions.node || "",
): number {
  const match = version.match(/^v?(\d+)\./);
  return Number.parseInt(match?.[1] ?? "", 10) || 0;
}

export function resolvePluginRuntimesRoot(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(resolvePluginRuntimeStateRoot(env), `node-${resolveCurrentNodeMajor(env)}`);
}

export function resolvePluginRuntimeManifestPath(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(resolvePluginRuntimeStateRoot(env), "manifest.json");
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
  const nodeVersion =
    env.CRAWCLAW_RUNTIME_NODE_VERSION?.trim() || process.versions.node || undefined;
  fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
  const nextManifest: PluginRuntimeManifest = {
    ...manifest,
    node: {
      major: resolveCurrentNodeMajor(env, nodeVersion ?? ""),
      version: nodeVersion,
      abi: env.CRAWCLAW_RUNTIME_NODE_ABI?.trim() || process.versions.modules || undefined,
      supportLevel: resolveNodeSupportLevel(nodeVersion ?? null) ?? undefined,
      ...manifest.node,
    },
    runtimeRoot: manifest.runtimeRoot ?? resolvePluginRuntimesRoot(env),
  };
  fs.writeFileSync(manifestPath, `${JSON.stringify(nextManifest, null, 2)}\n`, "utf8");
}

export type PluginRuntimeManifestHealth = {
  currentAbi: string | null;
  currentNodeMajor: number;
  currentNodeVersion: string | null;
  currentRuntimeRoot: string;
  manifestAbi: string | null;
  manifestNodeMajor: number | null;
  manifestNodeVersion: string | null;
  manifestRuntimeRoot: string | null;
  mismatchReason: string | null;
  supportLevel: NodeSupportLevel | null;
};

export function getPluginRuntimeManifestHealth(
  env: NodeJS.ProcessEnv = process.env,
): PluginRuntimeManifestHealth {
  const manifest = readPluginRuntimeManifest(env);
  const currentNodeVersion =
    env.CRAWCLAW_RUNTIME_NODE_VERSION?.trim() || process.versions.node || null;
  const currentNodeMajor = resolveCurrentNodeMajor(env, currentNodeVersion ?? "");
  const currentAbi = env.CRAWCLAW_RUNTIME_NODE_ABI?.trim() || process.versions.modules || null;
  const currentRuntimeRoot = resolvePluginRuntimesRoot(env);
  const manifestNodeMajor = typeof manifest.node?.major === "number" ? manifest.node.major : null;
  const manifestNodeVersion =
    typeof manifest.node?.version === "string" ? manifest.node.version : null;
  const manifestAbi = typeof manifest.node?.abi === "string" ? manifest.node.abi : null;
  const manifestRuntimeRoot =
    typeof manifest.runtimeRoot === "string" ? manifest.runtimeRoot : null;
  let mismatchReason: string | null = null;
  if (manifestNodeMajor !== null && manifestNodeMajor !== currentNodeMajor) {
    mismatchReason = `manifest targets Node ${manifestNodeMajor}, current runtime is Node ${currentNodeMajor}`;
  } else if (manifestAbi && currentAbi && manifestAbi !== currentAbi) {
    mismatchReason = `manifest ABI ${manifestAbi} does not match current ABI ${currentAbi}`;
  } else if (manifestRuntimeRoot && manifestRuntimeRoot !== currentRuntimeRoot) {
    mismatchReason = `manifest runtime root ${manifestRuntimeRoot} does not match current runtime root ${currentRuntimeRoot}`;
  }
  return {
    currentAbi,
    currentNodeMajor,
    currentNodeVersion,
    currentRuntimeRoot,
    manifestAbi,
    manifestNodeMajor,
    manifestNodeVersion,
    manifestRuntimeRoot,
    mismatchReason,
    supportLevel: resolveNodeSupportLevel(currentNodeVersion),
  };
}

export function resolveOpenWebSearchRuntimeDir(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(resolvePluginRuntimesRoot(env), "open-websearch");
}

export function resolveBrowserRuntimeDir(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(resolvePluginRuntimesRoot(env), "browser");
}

export function resolveN8nRuntimeDir(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(resolvePluginRuntimesRoot(env), "n8n");
}

export function resolveBrowserRuntimeBin(env: NodeJS.ProcessEnv = process.env): string {
  return process.platform === "win32"
    ? path.join(resolveBrowserRuntimeDir(env), "node_modules", ".bin", "pinchtab.cmd")
    : path.join(resolveBrowserRuntimeDir(env), "node_modules", ".bin", "pinchtab");
}

export function resolveN8nRuntimeBin(env: NodeJS.ProcessEnv = process.env): string {
  return process.platform === "win32"
    ? path.join(resolveN8nRuntimeDir(env), "node_modules", ".bin", "n8n.cmd")
    : path.join(resolveN8nRuntimeDir(env), "node_modules", ".bin", "n8n");
}

export function resolveOpenWebSearchRuntimeBin(env: NodeJS.ProcessEnv = process.env): string {
  return process.platform === "win32"
    ? path.join(resolveOpenWebSearchRuntimeDir(env), "node_modules", ".bin", "open-websearch.cmd")
    : path.join(resolveOpenWebSearchRuntimeDir(env), "node_modules", ".bin", "open-websearch");
}

export function normalizeN8nLocale(locale?: string | null): "en" | "zh-CN" {
  const normalized = locale?.trim().toLowerCase().replace(/_/g, "-") ?? "";
  return normalized.startsWith("zh") ? "zh-CN" : "en";
}

export function createN8nRuntimeEnv(params: {
  env?: NodeJS.ProcessEnv;
  locale?: string | null;
}): NodeJS.ProcessEnv {
  const env = params.env ?? process.env;
  return {
    ...env,
    N8N_DEFAULT_LOCALE: normalizeN8nLocale(
      params.locale ?? env.CRAWCLAW_LANG ?? env.LC_ALL ?? env.LC_MESSAGES ?? env.LANG,
    ),
  };
}

export function resolveScraplingFetchRuntimeDir(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(resolvePluginRuntimesRoot(env), "scrapling-fetch");
}

export function resolveScraplingFetchRuntimeVenvDir(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(resolveScraplingFetchRuntimeDir(env), "venv");
}

export function resolveNotebookLmRuntimeDir(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(resolvePluginRuntimesRoot(env), "notebooklm-mcp-cli");
}

export function resolveQwen3TtsRuntimeDir(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(resolvePluginRuntimesRoot(env), "qwen3-tts");
}

export function resolveQwen3TtsRuntimeVenvDir(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(resolveQwen3TtsRuntimeDir(env), "venv");
}

export function resolveNotebookLmRuntimeVenvDir(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(resolveNotebookLmRuntimeDir(env), "venv");
}

export function resolveScraplingFetchRuntimePython(env: NodeJS.ProcessEnv = process.env): string {
  return process.platform === "win32"
    ? path.join(resolveScraplingFetchRuntimeVenvDir(env), "Scripts", "python.exe")
    : path.join(resolveScraplingFetchRuntimeVenvDir(env), "bin", "python");
}

export function resolveQwen3TtsRuntimePython(env: NodeJS.ProcessEnv = process.env): string {
  return process.platform === "win32"
    ? path.join(resolveQwen3TtsRuntimeVenvDir(env), "Scripts", "python.exe")
    : path.join(resolveQwen3TtsRuntimeVenvDir(env), "bin", "python");
}

export function resolveNotebookLmRuntimePython(env: NodeJS.ProcessEnv = process.env): string {
  return process.platform === "win32"
    ? path.join(resolveNotebookLmRuntimeVenvDir(env), "Scripts", "python.exe")
    : path.join(resolveNotebookLmRuntimeVenvDir(env), "bin", "python");
}

export function resolveNotebookLmRuntimeBin(env: NodeJS.ProcessEnv = process.env): string {
  return process.platform === "win32"
    ? path.join(resolveNotebookLmRuntimeVenvDir(env), "Scripts", "nlm.exe")
    : path.join(resolveNotebookLmRuntimeVenvDir(env), "bin", "nlm");
}

export function resolveNotebookLmMcpRuntimeBin(env: NodeJS.ProcessEnv = process.env): string {
  return process.platform === "win32"
    ? path.join(resolveNotebookLmRuntimeVenvDir(env), "Scripts", "notebooklm-mcp.exe")
    : path.join(resolveNotebookLmRuntimeVenvDir(env), "bin", "notebooklm-mcp");
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
  const health = getPluginRuntimeManifestHealth(env);
  const manifest = readPluginRuntimeManifest(env);
  const plugins = manifest.plugins ?? {};
  const lines = Object.entries(plugins)
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
  if (health.mismatchReason) {
    lines.unshift(`manifest mismatch (${health.mismatchReason})`);
  }
  return lines;
}
