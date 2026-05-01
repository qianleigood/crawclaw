import type {
  NotebookLmAuthConfig,
  NotebookLmAutoLoginConfig,
  NotebookLmHeartbeatConfig,
  NotebookLmCliConfig,
  NotebookLmConfig,
  NotebookLmConfigInput,
  NotebookLmSourceConfig,
  NotebookLmWriteConfig,
} from "../types/config.ts";

export const DEFAULT_NOTEBOOKLM_HEARTBEAT: NotebookLmHeartbeatConfig = {
  enabled: true,
  minIntervalMs: 12 * 60_000,
  maxIntervalMs: 24 * 60_000,
};

export const DEFAULT_NOTEBOOKLM_AUTO_LOGIN: NotebookLmAutoLoginConfig = {
  enabled: true,
  intervalMs: 24 * 60 * 60_000,
  provider: "nlm_profile",
  cdpUrl: "",
};

export const DEFAULT_NOTEBOOKLM_AUTH: NotebookLmAuthConfig = {
  profile: "default",
  cookieFile: "",
  statusTtlMs: 5 * 60_000,
  degradedCooldownMs: 15 * 60_000,
  refreshCooldownMs: 30 * 60_000,
  heartbeat: {
    ...DEFAULT_NOTEBOOKLM_HEARTBEAT,
  },
  autoLogin: {
    ...DEFAULT_NOTEBOOKLM_AUTO_LOGIN,
  },
};

export const DEFAULT_NOTEBOOKLM_CLI: NotebookLmCliConfig = {
  enabled: false,
  command: "",
  args: [
    "notebook",
    "query",
    "{notebookId}",
    "{query}",
    "--json",
    "--timeout",
    "120",
    "--profile",
    "{profile}",
  ],
  timeoutMs: 130_000,
  limit: 8,
  notebookId: "",
  queryInstruction: [
    "请只基于当前 NotebookLM 笔记本中与问题直接相关的内容回答。",
    "使用简体中文。",
    "优先提炼成简短、可复用的经验卡片内容。",
    "步骤类问题优先给出操作流程；原因类问题优先给出决策说明；现象类问题优先给出运行规律。",
    "只保留 1 到 3 个最相关结论，不要长篇复述原文。",
    "不要输出学术综述式长段落，不要保留引用编号或 Markdown 强调格式。",
    "每条结论尽量控制在 2 到 4 句内，优先短卡片而不是长摘要。",
  ].join("\n"),
};

export const DEFAULT_NOTEBOOKLM_WRITE: NotebookLmWriteConfig = {
  enabled: true,
  command: "",
  args: ["{payloadFile}"],
  timeoutMs: 10_000,
  notebookId: "",
};

export const DEFAULT_NOTEBOOKLM_SOURCE: NotebookLmSourceConfig = {
  enabled: true,
  title: "CrawClaw Memory Index",
  timeoutMs: 120_000,
  maxEntries: 120,
  maxChars: 80_000,
  deletePrevious: true,
};

export const DEFAULT_NOTEBOOKLM_CONFIG: NotebookLmConfig = {
  enabled: false,
  auth: {
    ...DEFAULT_NOTEBOOKLM_AUTH,
  },
  cli: {
    ...DEFAULT_NOTEBOOKLM_CLI,
    args: [...DEFAULT_NOTEBOOKLM_CLI.args],
  },
  write: {
    ...DEFAULT_NOTEBOOKLM_WRITE,
    args: [...DEFAULT_NOTEBOOKLM_WRITE.args],
  },
  source: {
    ...DEFAULT_NOTEBOOKLM_SOURCE,
  },
};

export function normalizeNotebookLmConfig(raw?: NotebookLmConfigInput | null): NotebookLmConfig {
  return {
    enabled: typeof raw?.enabled === "boolean" ? raw.enabled : DEFAULT_NOTEBOOKLM_CONFIG.enabled,
    auth: {
      profile:
        typeof raw?.auth?.profile === "string" ? raw.auth.profile : DEFAULT_NOTEBOOKLM_AUTH.profile,
      cookieFile:
        typeof raw?.auth?.cookieFile === "string"
          ? raw.auth.cookieFile
          : DEFAULT_NOTEBOOKLM_AUTH.cookieFile,
      statusTtlMs:
        typeof raw?.auth?.statusTtlMs === "number"
          ? raw.auth.statusTtlMs
          : DEFAULT_NOTEBOOKLM_AUTH.statusTtlMs,
      degradedCooldownMs:
        typeof raw?.auth?.degradedCooldownMs === "number"
          ? raw.auth.degradedCooldownMs
          : DEFAULT_NOTEBOOKLM_AUTH.degradedCooldownMs,
      refreshCooldownMs:
        typeof raw?.auth?.refreshCooldownMs === "number"
          ? raw.auth.refreshCooldownMs
          : DEFAULT_NOTEBOOKLM_AUTH.refreshCooldownMs,
      heartbeat: {
        enabled:
          typeof raw?.auth?.heartbeat?.enabled === "boolean"
            ? raw.auth.heartbeat.enabled
            : DEFAULT_NOTEBOOKLM_AUTH.heartbeat.enabled,
        minIntervalMs:
          typeof raw?.auth?.heartbeat?.minIntervalMs === "number"
            ? raw.auth.heartbeat.minIntervalMs
            : DEFAULT_NOTEBOOKLM_AUTH.heartbeat.minIntervalMs,
        maxIntervalMs:
          typeof raw?.auth?.heartbeat?.maxIntervalMs === "number"
            ? raw.auth.heartbeat.maxIntervalMs
            : DEFAULT_NOTEBOOKLM_AUTH.heartbeat.maxIntervalMs,
      },
      autoLogin: normalizeNotebookLmAutoLoginConfig(raw?.auth?.autoLogin),
    },
    cli: {
      enabled:
        typeof raw?.cli?.enabled === "boolean" ? raw.cli.enabled : DEFAULT_NOTEBOOKLM_CLI.enabled,
      command:
        typeof raw?.cli?.command === "string" ? raw.cli.command : DEFAULT_NOTEBOOKLM_CLI.command,
      args: Array.isArray(raw?.cli?.args)
        ? raw.cli.args.filter(
            (value): value is string => typeof value === "string" && value.trim().length > 0,
          )
        : [...DEFAULT_NOTEBOOKLM_CLI.args],
      timeoutMs:
        typeof raw?.cli?.timeoutMs === "number"
          ? raw.cli.timeoutMs
          : DEFAULT_NOTEBOOKLM_CLI.timeoutMs,
      limit: typeof raw?.cli?.limit === "number" ? raw.cli.limit : DEFAULT_NOTEBOOKLM_CLI.limit,
      notebookId:
        typeof raw?.cli?.notebookId === "string"
          ? raw.cli.notebookId
          : DEFAULT_NOTEBOOKLM_CLI.notebookId,
      queryInstruction:
        typeof raw?.cli?.queryInstruction === "string"
          ? raw.cli.queryInstruction
          : DEFAULT_NOTEBOOKLM_CLI.queryInstruction,
    },
    write: {
      enabled:
        typeof raw?.write?.enabled === "boolean"
          ? raw.write.enabled
          : DEFAULT_NOTEBOOKLM_WRITE.enabled,
      command:
        typeof raw?.write?.command === "string"
          ? raw.write.command
          : DEFAULT_NOTEBOOKLM_WRITE.command,
      args: Array.isArray(raw?.write?.args)
        ? raw.write.args.filter(
            (value): value is string => typeof value === "string" && value.trim().length > 0,
          )
        : [...DEFAULT_NOTEBOOKLM_WRITE.args],
      timeoutMs:
        typeof raw?.write?.timeoutMs === "number"
          ? raw.write.timeoutMs
          : DEFAULT_NOTEBOOKLM_WRITE.timeoutMs,
      notebookId:
        typeof raw?.write?.notebookId === "string"
          ? raw.write.notebookId
          : DEFAULT_NOTEBOOKLM_WRITE.notebookId,
    },
    source: {
      enabled:
        typeof raw?.source?.enabled === "boolean"
          ? raw.source.enabled
          : DEFAULT_NOTEBOOKLM_SOURCE.enabled,
      title:
        typeof raw?.source?.title === "string" && raw.source.title.trim()
          ? raw.source.title.trim()
          : DEFAULT_NOTEBOOKLM_SOURCE.title,
      timeoutMs:
        typeof raw?.source?.timeoutMs === "number"
          ? raw.source.timeoutMs
          : DEFAULT_NOTEBOOKLM_SOURCE.timeoutMs,
      maxEntries:
        typeof raw?.source?.maxEntries === "number"
          ? raw.source.maxEntries
          : DEFAULT_NOTEBOOKLM_SOURCE.maxEntries,
      maxChars:
        typeof raw?.source?.maxChars === "number"
          ? raw.source.maxChars
          : DEFAULT_NOTEBOOKLM_SOURCE.maxChars,
      deletePrevious:
        typeof raw?.source?.deletePrevious === "boolean"
          ? raw.source.deletePrevious
          : DEFAULT_NOTEBOOKLM_SOURCE.deletePrevious,
    },
  };
}

export function normalizeNotebookLmAutoLoginConfig(
  raw?: Partial<NotebookLmAutoLoginConfig> | null,
): NotebookLmAutoLoginConfig {
  const provider =
    raw?.provider === "openclaw_cdp" || raw?.provider === "nlm_profile"
      ? raw.provider
      : DEFAULT_NOTEBOOKLM_AUTO_LOGIN.provider;
  return {
    enabled:
      typeof raw?.enabled === "boolean" ? raw.enabled : DEFAULT_NOTEBOOKLM_AUTO_LOGIN.enabled,
    intervalMs:
      typeof raw?.intervalMs === "number" && Number.isFinite(raw.intervalMs)
        ? Math.max(60_000, raw.intervalMs)
        : DEFAULT_NOTEBOOKLM_AUTO_LOGIN.intervalMs,
    provider,
    cdpUrl: typeof raw?.cdpUrl === "string" ? raw.cdpUrl : DEFAULT_NOTEBOOKLM_AUTO_LOGIN.cdpUrl,
  };
}
