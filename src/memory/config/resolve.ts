import fs from "node:fs/promises";
import path from "node:path";
import type { MemoryRuntimeConfig, LlmConfig, NotebookLmConfigInput } from "../types/config.ts";
import { DEFAULT_CONFIG } from "./defaults.ts";
import { normalizeNotebookLmConfig } from "./notebooklm.ts";

const DEFAULT_CONTEXT_ARCHIVE = DEFAULT_CONFIG.contextArchive!;

type RawMemoryConfig = Record<string, unknown>;

function asConfigRecord(value: unknown): RawMemoryConfig {
  return value && typeof value === "object" ? (value as RawMemoryConfig) : {};
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function readConfigRecord(value: unknown): RawMemoryConfig {
  return asConfigRecord(value);
}

function mergeConfig(raw: RawMemoryConfig): MemoryRuntimeConfig {
  const runtimeStore = readConfigRecord(raw.runtimeStore);
  const llm = readConfigRecord(raw.llm);
  const llms = readConfigRecord(raw.llms);
  const extractionLlm = readConfigRecord(llms.extraction);
  const governanceLlm = readConfigRecord(llms.governance);
  const answerLlm = readConfigRecord(llms.answer);
  const dedup = readConfigRecord(raw.dedup);
  const governance = readConfigRecord(raw.governance);
  const durableExtraction = readConfigRecord(raw.durableExtraction);
  const dreaming = readConfigRecord(raw.dreaming);
  const sessionSummary = readConfigRecord(raw.sessionSummary);
  const automation = asConfigRecord(raw.automation);
  const multimodal = asConfigRecord(raw.multimodal);
  const skillRouting = asConfigRecord(raw.skillRouting);
  const contextArchive = normalizeContextArchiveConfig(raw.contextArchive);
  const merged = {
    runtimeStore: { ...DEFAULT_CONFIG.runtimeStore, ...runtimeStore },
    contextArchive: { ...DEFAULT_CONFIG.contextArchive, ...readConfigRecord(raw.contextArchive) },
    automation: {
      ...DEFAULT_CONFIG.automation,
      ...automation,
      stages: {
        ...DEFAULT_CONFIG.automation.stages,
        ...asConfigRecord(automation.stages),
      },
    },
    multimodal: {
      ...DEFAULT_CONFIG.multimodal,
      ...multimodal,
      storage: {
        ...DEFAULT_CONFIG.multimodal.storage,
        ...asConfigRecord(multimodal.storage),
      },
    },
    llm: Object.keys(llm).length > 0 ? { ...llm } : DEFAULT_CONFIG.llm,
    llms:
      Object.keys(llms).length > 0
        ? {
            extraction: Object.keys(extractionLlm).length > 0 ? { ...extractionLlm } : undefined,
            governance: Object.keys(governanceLlm).length > 0 ? { ...governanceLlm } : undefined,
            answer: Object.keys(answerLlm).length > 0 ? { ...answerLlm } : undefined,
          }
        : DEFAULT_CONFIG.llms,
    dedup: { ...DEFAULT_CONFIG.dedup, ...dedup },
    governance: { ...DEFAULT_CONFIG.governance, ...governance },
    skillRouting: {
      ...DEFAULT_CONFIG.skillRouting,
      ...skillRouting,
      extraRoots: Array.isArray(skillRouting.extraRoots)
        ? skillRouting.extraRoots.filter(
            (value): value is string => typeof value === "string" && value.trim().length > 0,
          )
        : DEFAULT_CONFIG.skillRouting.extraRoots,
    },
    durableExtraction: {
      ...DEFAULT_CONFIG.durableExtraction,
      ...durableExtraction,
    },
    dreaming: {
      ...DEFAULT_CONFIG.dreaming,
      ...dreaming,
    },
    sessionSummary: {
      ...DEFAULT_CONFIG.sessionSummary,
      ...sessionSummary,
    },
    notebooklm: normalizeNotebookLmConfig(
      readConfigRecord(raw.notebooklm) as NotebookLmConfigInput,
    ),
    ...(contextArchive ? { contextArchive } : {}),
  };
  return merged;
}

type ResolvedContextArchiveConfig = {
  enabled: boolean;
  mode: "off" | "replay" | "full";
  rootDir: string | undefined;
  compress: boolean;
  redactSecrets: boolean;
  retentionDays: number | null;
  maxBlobBytes: number;
  maxTotalBytes: number | null;
};

function normalizeContextArchiveConfig(raw: unknown): ResolvedContextArchiveConfig | undefined {
  if (!raw || typeof raw !== "object") {
    return undefined;
  }
  const obj = raw as Record<string, unknown>;
  const enabled = typeof obj.enabled === "boolean" ? obj.enabled : true;
  const mode =
    obj.mode === "off" || obj.mode === "replay" || obj.mode === "full" ? obj.mode : "replay";
  return {
    enabled,
    mode: !enabled ? "off" : enabled && mode === "off" ? "replay" : mode,
    rootDir:
      typeof obj.rootDir === "string" && obj.rootDir.trim().length > 0 ? obj.rootDir : undefined,
    compress: typeof obj.compress === "boolean" ? obj.compress : true,
    redactSecrets: typeof obj.redactSecrets === "boolean" ? obj.redactSecrets : true,
    retentionDays:
      typeof obj.retentionDays === "number" && Number.isFinite(obj.retentionDays)
        ? obj.retentionDays
        : (DEFAULT_CONTEXT_ARCHIVE.retentionDays ?? 30),
    maxBlobBytes:
      typeof obj.maxBlobBytes === "number" && Number.isFinite(obj.maxBlobBytes)
        ? obj.maxBlobBytes
        : (DEFAULT_CONTEXT_ARCHIVE.maxBlobBytes ?? 4 * 1024 * 1024),
    maxTotalBytes:
      typeof obj.maxTotalBytes === "number" && Number.isFinite(obj.maxTotalBytes)
        ? obj.maxTotalBytes
        : (DEFAULT_CONTEXT_ARCHIVE.maxTotalBytes ?? 512 * 1024 * 1024),
  };
}

export function resolveMemoryConfig(raw: unknown): MemoryRuntimeConfig {
  const obj = asConfigRecord(raw);
  return mergeConfig(obj);
}

async function readJsonIfExists(filePath: string): Promise<unknown> {
  try {
    const text = await fs.readFile(filePath, "utf8");
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function envLlm(): LlmConfig | undefined {
  if (
    !process.env.LLM_API_KEY &&
    !process.env.LLM_BASE_URL &&
    !process.env.LLM_MODEL &&
    !process.env.LLM_PROVIDER &&
    !process.env.LLM_API
  ) {
    return undefined;
  }
  return {
    provider: process.env.LLM_PROVIDER,
    api: process.env.LLM_API as LlmConfig["api"],
    apiKey: process.env.LLM_API_KEY,
    baseURL: process.env.LLM_BASE_URL,
    model: process.env.LLM_MODEL,
  };
}

function envRoleLlm(prefix: string): LlmConfig | undefined {
  const provider = process.env[`${prefix}_PROVIDER`];
  const api = process.env[`${prefix}_API`] as LlmConfig["api"] | undefined;
  const apiKey = process.env[`${prefix}_API_KEY`];
  const baseURL = process.env[`${prefix}_BASE_URL`];
  const model = process.env[`${prefix}_MODEL`];
  if (!provider && !api && !apiKey && !baseURL && !model) {
    return undefined;
  }
  return { provider, api, apiKey, baseURL, model };
}

export function isUsableLlm(llm?: LlmConfig | null): llm is LlmConfig {
  return Boolean(llm?.apiKey && llm?.baseURL && llm.apiKey !== "YOUR_API_KEY");
}

function pickGlobalModelLlm(crawclawConfig: unknown): LlmConfig | undefined {
  const config = asConfigRecord(crawclawConfig);
  const agents = asConfigRecord(config.agents);
  const defaults = asConfigRecord(agents.defaults);
  const modelDefaults = asConfigRecord(defaults.model);
  const primary = readString(modelDefaults.primary);
  if (!primary) {
    return undefined;
  }
  const [providerName, modelName] = primary.includes("/")
    ? primary.split("/", 2)
    : [primary, undefined];
  const models = asConfigRecord(config.models);
  const providers = asConfigRecord(models.providers);
  const provider = asConfigRecord(providers[providerName]);
  const providerModels = Array.isArray(provider.models) ? provider.models : [];
  const firstProviderModel = providerModels.find((entry) => entry && typeof entry === "object") as
    | Record<string, unknown>
    | undefined;
  return {
    provider: providerName,
    api: provider.api as LlmConfig["api"] | undefined,
    apiKey: readString(provider.apiKey),
    baseURL: readString(provider.baseUrl),
    model: modelName || readString(firstProviderModel?.id),
  };
}

function envTruthy(value: string): boolean {
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

function pickEnv(...names: string[]): string | undefined {
  for (const name of names) {
    const value = process.env[name];
    if (value != null && value !== "") {
      return value;
    }
  }
  return undefined;
}

function setBooleanFromEnv(current: boolean, ...names: string[]): boolean {
  const value = pickEnv(...names);
  return value == null ? current : envTruthy(value);
}

function setNumberFromEnv(current: number, ...names: string[]): number {
  const value = pickEnv(...names);
  if (value == null) {
    return current;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : current;
}

export async function resolveCliConfig(): Promise<{
  config: MemoryRuntimeConfig;
  source: string;
  globalLlm?: LlmConfig;
}> {
  const crawclawConfigPath = path.resolve(process.env.HOME || "", ".crawclaw/crawclaw.json");
  const crawclawConfig = await readJsonIfExists(crawclawConfigPath);
  const crawclawConfigRecord = asConfigRecord(crawclawConfig);
  const memoryConfig = asConfigRecord(crawclawConfigRecord.memory);
  const rawMemoryConfig = {
    notebooklm: memoryConfig.notebooklm ?? {},
    durableExtraction: memoryConfig.durableExtraction ?? {},
    dreaming: memoryConfig.dreaming ?? {},
    sessionSummary: memoryConfig.sessionSummary ?? {},
    contextArchive: memoryConfig.contextArchive ?? undefined,
  };
  const config = resolveMemoryConfig(rawMemoryConfig);
  const contextArchive: ResolvedContextArchiveConfig = {
    enabled: config.contextArchive?.enabled ?? true,
    mode: config.contextArchive?.mode ?? DEFAULT_CONTEXT_ARCHIVE.mode ?? "replay",
    rootDir: config.contextArchive?.rootDir ?? DEFAULT_CONTEXT_ARCHIVE.rootDir,
    compress: config.contextArchive?.compress ?? DEFAULT_CONTEXT_ARCHIVE.compress ?? true,
    redactSecrets:
      config.contextArchive?.redactSecrets ?? DEFAULT_CONTEXT_ARCHIVE.redactSecrets ?? true,
    retentionDays:
      config.contextArchive?.retentionDays ?? DEFAULT_CONTEXT_ARCHIVE.retentionDays ?? 30,
    maxBlobBytes:
      config.contextArchive?.maxBlobBytes ??
      DEFAULT_CONTEXT_ARCHIVE.maxBlobBytes ??
      4 * 1024 * 1024,
    maxTotalBytes:
      config.contextArchive?.maxTotalBytes ??
      DEFAULT_CONTEXT_ARCHIVE.maxTotalBytes ??
      512 * 1024 * 1024,
  };
  config.contextArchive = contextArchive;

  config.runtimeStore.dbPath = process.env.RUNTIME_DB_PATH ?? config.runtimeStore.dbPath;
  contextArchive.mode =
    (pickEnv("GM_CONTEXT_ARCHIVE_MODE", "CRAWCLAW_CONTEXT_ARCHIVE_MODE") as
      | ResolvedContextArchiveConfig["mode"]
      | undefined) ?? contextArchive.mode;
  contextArchive.rootDir =
    pickEnv("GM_CONTEXT_ARCHIVE_ROOT_DIR", "CRAWCLAW_CONTEXT_ARCHIVE_ROOT_DIR") ??
    contextArchive.rootDir;
  contextArchive.compress = setBooleanFromEnv(
    contextArchive.compress,
    "GM_CONTEXT_ARCHIVE_COMPRESS",
    "CRAWCLAW_CONTEXT_ARCHIVE_COMPRESS",
  );
  contextArchive.redactSecrets = setBooleanFromEnv(
    contextArchive.redactSecrets,
    "GM_CONTEXT_ARCHIVE_REDACT_SECRETS",
    "CRAWCLAW_CONTEXT_ARCHIVE_REDACT_SECRETS",
  );
  contextArchive.maxBlobBytes = setNumberFromEnv(
    contextArchive.maxBlobBytes,
    "GM_CONTEXT_ARCHIVE_MAX_BLOB_BYTES",
    "CRAWCLAW_CONTEXT_ARCHIVE_MAX_BLOB_BYTES",
  );
  {
    const rawMaxTotalBytes = pickEnv(
      "GM_CONTEXT_ARCHIVE_MAX_TOTAL_BYTES",
      "CRAWCLAW_CONTEXT_ARCHIVE_MAX_TOTAL_BYTES",
    );
    if (rawMaxTotalBytes) {
      const parsedMaxTotalBytes = Number(rawMaxTotalBytes);
      contextArchive.maxTotalBytes =
        Number.isFinite(parsedMaxTotalBytes) && parsedMaxTotalBytes > 0
          ? Math.floor(parsedMaxTotalBytes)
          : null;
    }
  }
  {
    const rawRetentionDays = pickEnv(
      "GM_CONTEXT_ARCHIVE_RETENTION_DAYS",
      "CRAWCLAW_CONTEXT_ARCHIVE_RETENTION_DAYS",
    );
    if (rawRetentionDays) {
      const parsedRetentionDays = Number(rawRetentionDays);
      contextArchive.retentionDays =
        Number.isFinite(parsedRetentionDays) && parsedRetentionDays > 0
          ? Math.floor(parsedRetentionDays)
          : null;
    }
  }
  config.automation.enabled = process.env.GM_AUTOMATION_ENABLED
    ? envTruthy(process.env.GM_AUTOMATION_ENABLED)
    : config.automation.enabled;
  config.automation.maxJobAttempts = process.env.GM_AUTOMATION_MAX_JOB_ATTEMPTS
    ? Number(process.env.GM_AUTOMATION_MAX_JOB_ATTEMPTS)
    : config.automation.maxJobAttempts;
  config.automation.schedulerPollIntervalMs = process.env.GM_AUTOMATION_SCHEDULER_POLL_MS
    ? Number(process.env.GM_AUTOMATION_SCHEDULER_POLL_MS)
    : config.automation.schedulerPollIntervalMs;
  config.automation.extractionJobTimeoutMs = process.env.GM_EXTRACTION_JOB_TIMEOUT_MS
    ? Number(process.env.GM_EXTRACTION_JOB_TIMEOUT_MS)
    : config.automation.extractionJobTimeoutMs;
  config.multimodal.storage.cacheDir =
    process.env.GM_MULTIMODAL_CACHE_DIR ?? config.multimodal.storage.cacheDir;
  config.multimodal.storage.maxAssetBytes = process.env.GM_MULTIMODAL_MAX_ASSET_BYTES
    ? Number(process.env.GM_MULTIMODAL_MAX_ASSET_BYTES)
    : config.multimodal.storage.maxAssetBytes;
  config.dreaming.enabled = setBooleanFromEnv(
    config.dreaming.enabled,
    "GM_DREAMING_ENABLED",
    "CRAWCLAW_DREAMING_ENABLED",
  );
  config.dreaming.minHours = setNumberFromEnv(
    config.dreaming.minHours,
    "GM_DREAMING_MIN_HOURS",
    "CRAWCLAW_DREAMING_MIN_HOURS",
  );
  config.dreaming.minSessions = setNumberFromEnv(
    config.dreaming.minSessions,
    "GM_DREAMING_MIN_SESSIONS",
    "CRAWCLAW_DREAMING_MIN_SESSIONS",
  );
  config.dreaming.scanThrottleMs = setNumberFromEnv(
    config.dreaming.scanThrottleMs,
    "GM_DREAMING_SCAN_THROTTLE_MS",
    "CRAWCLAW_DREAMING_SCAN_THROTTLE_MS",
  );
  config.dreaming.lockStaleAfterMs = setNumberFromEnv(
    config.dreaming.lockStaleAfterMs,
    "GM_DREAMING_LOCK_STALE_AFTER_MS",
    "CRAWCLAW_DREAMING_LOCK_STALE_AFTER_MS",
  );

  config.notebooklm.enabled = setBooleanFromEnv(
    config.notebooklm.enabled,
    "GM_NOTEBOOKLM_ENABLED",
    "NOTEBOOKLM_ENABLED",
  );
  config.notebooklm.auth.profile =
    pickEnv("GM_NOTEBOOKLM_PROFILE", "NOTEBOOKLM_PROFILE") ?? config.notebooklm.auth.profile;
  config.notebooklm.auth.cookieFile =
    pickEnv("GM_NOTEBOOKLM_COOKIE_FILE", "NOTEBOOKLM_COOKIE_FILE") ??
    config.notebooklm.auth.cookieFile;
  config.notebooklm.auth.autoRefresh = setBooleanFromEnv(
    config.notebooklm.auth.autoRefresh,
    "GM_NOTEBOOKLM_AUTO_REFRESH",
    "NOTEBOOKLM_AUTO_REFRESH",
  );
  config.notebooklm.auth.statusTtlMs = setNumberFromEnv(
    config.notebooklm.auth.statusTtlMs,
    "GM_NOTEBOOKLM_STATUS_TTL_MS",
    "NOTEBOOKLM_STATUS_TTL_MS",
  );
  config.notebooklm.auth.degradedCooldownMs = setNumberFromEnv(
    config.notebooklm.auth.degradedCooldownMs,
    "GM_NOTEBOOKLM_DEGRADED_COOLDOWN_MS",
    "NOTEBOOKLM_DEGRADED_COOLDOWN_MS",
  );
  config.notebooklm.auth.refreshCooldownMs = setNumberFromEnv(
    config.notebooklm.auth.refreshCooldownMs,
    "GM_NOTEBOOKLM_REFRESH_COOLDOWN_MS",
    "NOTEBOOKLM_REFRESH_COOLDOWN_MS",
  );
  config.notebooklm.auth.heartbeat.enabled = setBooleanFromEnv(
    config.notebooklm.auth.heartbeat.enabled,
    "GM_NOTEBOOKLM_HEARTBEAT_ENABLED",
    "NOTEBOOKLM_HEARTBEAT_ENABLED",
  );
  config.notebooklm.auth.heartbeat.minIntervalMs = setNumberFromEnv(
    config.notebooklm.auth.heartbeat.minIntervalMs,
    "GM_NOTEBOOKLM_HEARTBEAT_MIN_INTERVAL_MS",
    "NOTEBOOKLM_HEARTBEAT_MIN_INTERVAL_MS",
  );
  config.notebooklm.auth.heartbeat.maxIntervalMs = setNumberFromEnv(
    config.notebooklm.auth.heartbeat.maxIntervalMs,
    "GM_NOTEBOOKLM_HEARTBEAT_MAX_INTERVAL_MS",
    "NOTEBOOKLM_HEARTBEAT_MAX_INTERVAL_MS",
  );
  config.notebooklm.cli.enabled = setBooleanFromEnv(
    config.notebooklm.cli.enabled,
    "GM_NOTEBOOKLM_CLI_ENABLED",
    "NOTEBOOKLM_CLI_ENABLED",
  );
  config.notebooklm.cli.command =
    pickEnv("GM_NOTEBOOKLM_CLI_COMMAND", "NOTEBOOKLM_CLI_COMMAND") ?? config.notebooklm.cli.command;
  config.notebooklm.cli.timeoutMs = setNumberFromEnv(
    config.notebooklm.cli.timeoutMs,
    "GM_NOTEBOOKLM_CLI_TIMEOUT_MS",
    "NOTEBOOKLM_CLI_TIMEOUT_MS",
  );
  config.notebooklm.cli.limit = setNumberFromEnv(
    config.notebooklm.cli.limit,
    "GM_NOTEBOOKLM_CLI_LIMIT",
    "NOTEBOOKLM_CLI_LIMIT",
  );
  config.notebooklm.cli.notebookId =
    pickEnv("GM_NOTEBOOKLM_NOTEBOOK_ID", "NOTEBOOKLM_NOTEBOOK_ID") ??
    config.notebooklm.cli.notebookId;
  config.notebooklm.write.enabled = setBooleanFromEnv(
    config.notebooklm.write?.enabled ?? false,
    "GM_NOTEBOOKLM_WRITE_ENABLED",
    "NOTEBOOKLM_WRITE_ENABLED",
  );
  config.notebooklm.write.command =
    pickEnv("GM_NOTEBOOKLM_WRITE_COMMAND", "NOTEBOOKLM_WRITE_COMMAND") ??
    config.notebooklm.write?.command ??
    "";
  config.notebooklm.write.timeoutMs =
    setNumberFromEnv(
      config.notebooklm.write?.timeoutMs ?? 0,
      "GM_NOTEBOOKLM_WRITE_TIMEOUT_MS",
      "NOTEBOOKLM_WRITE_TIMEOUT_MS",
    ) ||
    (config.notebooklm.write?.timeoutMs ?? 0);
  config.notebooklm.write.notebookId =
    pickEnv("GM_NOTEBOOKLM_WRITE_NOTEBOOK_ID", "NOTEBOOKLM_WRITE_NOTEBOOK_ID") ??
    config.notebooklm.write?.notebookId ??
    config.notebooklm.cli.notebookId;

  const globalLlm = pickGlobalModelLlm(crawclawConfig);
  config.llm = envLlm() ?? (isUsableLlm(config.llm) ? config.llm : undefined) ?? globalLlm;
  config.llms = {
    extraction: envRoleLlm("EXTRACTION_LLM") ?? config.llms?.extraction ?? config.llm,
    governance: envRoleLlm("GOVERNANCE_LLM") ?? config.llms?.governance ?? config.llm,
    answer: envRoleLlm("ANSWER_LLM") ?? config.llms?.answer ?? config.llm,
  };

  return {
    config,
    source: crawclawConfigPath,
    globalLlm,
  };
}
