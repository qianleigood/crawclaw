import os from "node:os";
import path from "node:path";

export type TurixRuntimeMode = "managed" | "external";
export type TurixModelRole = "brain" | "actor" | "planner" | "memory";

export type TurixModelConfig = {
  provider: string;
  modelName: string;
  baseUrl?: string;
  apiKeyEnv?: string;
  maxTokens?: number;
  timeout?: number;
};

export type TurixResolvedConfig = {
  runtime: {
    mode: TurixRuntimeMode;
    projectDir: string;
    pythonPath: string;
    ref?: string;
  };
  outputRoot: string;
  defaultMaxSteps: number;
  defaultTimeoutMs: number;
  retainRunsDays: number;
  allowRemoteRequests: boolean;
  stripReasoningTags: boolean;
  usePlan: boolean;
  useSkills: boolean;
  skillsDir?: string;
  maxActionsPerStep: number;
  forceStopHotkey: string;
  models: Record<TurixModelRole, TurixModelConfig>;
};

export type ResolveTurixConfigParams = {
  workspaceDir?: string;
  pluginConfig?: Record<string, unknown>;
  env?: Record<string, string | undefined>;
  platform?: NodeJS.Platform;
};

const PLUGIN_ID = "turix-cua";
const DEFAULT_TIMEOUT_MS = 600_000;
const DEFAULT_MAX_STEPS = 40;
const DEFAULT_RETAIN_RUNS_DAYS = 7;
const DEFAULT_FORCE_STOP_HOTKEY = "command+shift+2";

const DEFAULT_MODELS: Record<TurixModelRole, TurixModelConfig> = {
  brain: {
    provider: "turix",
    modelName: "turix-brain",
    baseUrl: "https://turixapi.io/v1",
    apiKeyEnv: "TURIX_API_KEY",
  },
  actor: {
    provider: "turix",
    modelName: "turix-actor",
    baseUrl: "https://turixapi.io/v1",
    apiKeyEnv: "TURIX_API_KEY",
  },
  planner: {
    provider: "turix",
    modelName: "turix-brain",
    baseUrl: "https://turixapi.io/v1",
    apiKeyEnv: "TURIX_API_KEY",
  },
  memory: {
    provider: "turix",
    modelName: "turix-brain",
    baseUrl: "https://turixapi.io/v1",
    apiKeyEnv: "TURIX_API_KEY",
  },
};

const MODEL_ROLES: TurixModelRole[] = ["brain", "actor", "planner", "memory"];

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readBoolean(record: Record<string, unknown>, key: string, fallback: boolean): boolean {
  const value = record[key];
  return typeof value === "boolean" ? value : fallback;
}

function readPositiveNumber(
  record: Record<string, unknown>,
  key: string,
  fallback: number,
): number {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}

function resolveWorkspaceDir(workspaceDir?: string): string {
  return path.resolve(workspaceDir ?? process.cwd());
}

export function resolveStateDir(env: Record<string, string | undefined> = process.env): string {
  const override = env.CRAWCLAW_STATE_DIR?.trim();
  return override ? path.resolve(override) : path.join(os.homedir(), ".crawclaw");
}

function resolvePath(workspaceDir: string, value: string): string {
  if (!value.includes("/") && !value.includes("\\") && !path.isAbsolute(value)) {
    return value;
  }
  return path.isAbsolute(value) ? path.resolve(value) : path.resolve(workspaceDir, value);
}

function resolveManagedPython(runtimeRoot: string, platform: NodeJS.Platform): string {
  return platform === "win32"
    ? path.join(runtimeRoot, "venv", "Scripts", "python.exe")
    : path.join(runtimeRoot, "venv", "bin", "python");
}

function resolveRuntimeConfig(params: {
  workspaceDir: string;
  stateDir: string;
  pluginConfig: Record<string, unknown>;
  platform: NodeJS.Platform;
}): TurixResolvedConfig["runtime"] {
  const runtime = readRecord(params.pluginConfig.runtime);
  const rawMode = readString(runtime, "mode") ?? "managed";
  if (rawMode !== "managed" && rawMode !== "external") {
    throw new Error(`Invalid TuriX runtime mode: ${rawMode}`);
  }
  const runtimeRoot = path.join(params.stateDir, "runtimes", PLUGIN_ID);
  const defaultProjectDir =
    rawMode === "managed" ? path.join(runtimeRoot, "source") : params.workspaceDir;
  const rawProjectDir = readString(runtime, "projectDir") ?? defaultProjectDir;
  const rawPythonPath =
    readString(runtime, "pythonPath") ??
    (rawMode === "managed" ? resolveManagedPython(runtimeRoot, params.platform) : "python3");
  return {
    mode: rawMode,
    projectDir: resolvePath(params.workspaceDir, rawProjectDir),
    pythonPath: resolvePath(params.workspaceDir, rawPythonPath),
    ...(readString(runtime, "ref") ? { ref: readString(runtime, "ref") } : {}),
  };
}

function readModelConfig(
  modelsRecord: Record<string, unknown>,
  role: TurixModelRole,
): TurixModelConfig {
  const model = readRecord(modelsRecord[role]);
  const fallback = DEFAULT_MODELS[role];
  const provider = readString(model, "provider") ?? fallback.provider;
  const modelName = readString(model, "modelName") ?? fallback.modelName;
  return {
    provider,
    modelName,
    ...((readString(model, "baseUrl") ?? fallback.baseUrl)
      ? { baseUrl: readString(model, "baseUrl") ?? fallback.baseUrl }
      : {}),
    ...((readString(model, "apiKeyEnv") ?? fallback.apiKeyEnv)
      ? { apiKeyEnv: readString(model, "apiKeyEnv") ?? fallback.apiKeyEnv }
      : {}),
    ...(readPositiveNumber(model, "maxTokens", 0)
      ? { maxTokens: readPositiveNumber(model, "maxTokens", 0) }
      : {}),
    ...(readPositiveNumber(model, "timeout", 0)
      ? { timeout: readPositiveNumber(model, "timeout", 0) }
      : {}),
  };
}

export function resolveTurixConfig(params: ResolveTurixConfigParams = {}): TurixResolvedConfig {
  const pluginConfig = params.pluginConfig ?? {};
  const workspaceDir = resolveWorkspaceDir(params.workspaceDir);
  const stateDir = resolveStateDir(params.env);
  const runtime = resolveRuntimeConfig({
    workspaceDir,
    stateDir,
    pluginConfig,
    platform: params.platform ?? process.platform,
  });
  const modelsRecord = readRecord(pluginConfig.models);
  const models = Object.fromEntries(
    MODEL_ROLES.map((role) => [role, readModelConfig(modelsRecord, role)]),
  ) as Record<TurixModelRole, TurixModelConfig>;
  const rawOutputRoot = readString(pluginConfig, "outputRoot");
  return {
    runtime,
    outputRoot: rawOutputRoot
      ? resolvePath(workspaceDir, rawOutputRoot)
      : path.join(stateDir, PLUGIN_ID),
    defaultMaxSteps: readPositiveNumber(pluginConfig, "defaultMaxSteps", DEFAULT_MAX_STEPS),
    defaultTimeoutMs: readPositiveNumber(pluginConfig, "defaultTimeoutMs", DEFAULT_TIMEOUT_MS),
    retainRunsDays: readPositiveNumber(pluginConfig, "retainRunsDays", DEFAULT_RETAIN_RUNS_DAYS),
    allowRemoteRequests: readBoolean(pluginConfig, "allowRemoteRequests", false),
    stripReasoningTags: readBoolean(pluginConfig, "stripReasoningTags", true),
    usePlan: readBoolean(pluginConfig, "usePlan", true),
    useSkills: readBoolean(pluginConfig, "useSkills", false),
    ...(readString(pluginConfig, "skillsDir")
      ? { skillsDir: resolvePath(workspaceDir, readString(pluginConfig, "skillsDir")!) }
      : {}),
    maxActionsPerStep: readPositiveNumber(pluginConfig, "maxActionsPerStep", 5),
    forceStopHotkey: readString(pluginConfig, "forceStopHotkey") ?? DEFAULT_FORCE_STOP_HOTKEY,
    models,
  };
}
