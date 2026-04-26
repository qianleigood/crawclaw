import path from "node:path";

export type ComfyUiResolvedConfig = {
  baseUrl: string;
  outputDir: string;
  workflowsDir: string;
  allowedInputDirs: string[];
  maxPlanRepairAttempts: number;
  requestTimeoutMs: number;
  runTimeoutMs: number;
};

export type ResolveComfyUiConfigParams = {
  workspaceDir?: string;
  pluginConfig?: Record<string, unknown>;
};

const DEFAULT_BASE_URL = "http://127.0.0.1:8188";
const DEFAULT_OUTPUT_DIR = ".crawclaw/comfyui/outputs";
const DEFAULT_WORKFLOWS_DIR = ".crawclaw/comfyui/workflows";

function readString(config: Record<string, unknown>, key: string): string | undefined {
  const value = config[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readNumber(config: Record<string, unknown>, key: string, fallback: number): number {
  const value = config[key];
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}

function readStringArray(config: Record<string, unknown>, key: string): string[] {
  const value = config[key];
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter(
    (entry): entry is string => typeof entry === "string" && entry.trim().length > 0,
  );
}

function isLoopbackHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return normalized === "localhost" || normalized === "127.0.0.1" || normalized === "::1";
}

function normalizeBaseUrl(raw: string, allowRemote: boolean): string {
  const url = new URL(raw);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`Invalid ComfyUI baseUrl protocol: ${url.protocol}`);
  }
  if (!allowRemote && !isLoopbackHost(url.hostname)) {
    throw new Error("ComfyUI non-loopback baseUrl requires allowRemote: true.");
  }
  url.pathname = url.pathname.replace(/\/+$/u, "");
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/u, "");
}

function resolveWorkspaceDir(workspaceDir?: string): string {
  return path.resolve(workspaceDir ?? process.cwd());
}

function resolveConfigPath(workspaceDir: string, value: string): string {
  return path.isAbsolute(value) ? path.resolve(value) : path.resolve(workspaceDir, value);
}

export function assertPathInside(root: string, candidate: string): void {
  const resolvedRoot = path.resolve(root);
  const resolvedCandidate = path.resolve(candidate);
  const rel = path.relative(resolvedRoot, resolvedCandidate);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error(`Path is outside allowed root: ${resolvedCandidate}`);
  }
}

export function resolveComfyUiConfig(
  params: ResolveComfyUiConfigParams = {},
): ComfyUiResolvedConfig {
  const pluginConfig = params.pluginConfig ?? {};
  const workspaceDir = resolveWorkspaceDir(params.workspaceDir);
  const allowRemote = pluginConfig.allowRemote === true;
  const baseUrl = normalizeBaseUrl(
    readString(pluginConfig, "baseUrl") ?? DEFAULT_BASE_URL,
    allowRemote,
  );
  const outputDir = resolveConfigPath(
    workspaceDir,
    readString(pluginConfig, "outputDir") ?? DEFAULT_OUTPUT_DIR,
  );
  const workflowsDir = resolveConfigPath(
    workspaceDir,
    readString(pluginConfig, "workflowsDir") ?? DEFAULT_WORKFLOWS_DIR,
  );
  return {
    baseUrl,
    outputDir,
    workflowsDir,
    allowedInputDirs: [
      workspaceDir,
      ...readStringArray(pluginConfig, "allowedInputDirs").map((entry) =>
        resolveConfigPath(workspaceDir, entry),
      ),
    ],
    maxPlanRepairAttempts: readNumber(pluginConfig, "maxPlanRepairAttempts", 3),
    requestTimeoutMs: readNumber(pluginConfig, "requestTimeoutMs", 30_000),
    runTimeoutMs: readNumber(pluginConfig, "runTimeoutMs", 900_000),
  };
}
