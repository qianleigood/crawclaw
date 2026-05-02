import { execFile as execFileCallback } from "node:child_process";
import type { NotebookLmConfig } from "../types/config.ts";
import { isNotebookLmNlmCommand, resolveNotebookLmCliCommand } from "./command.js";

type RuntimeLogger = { warn(message: string): void };
type RuntimeInfoLogger = RuntimeLogger & { info?(message: string): void };

export type NotebookLmProviderReason =
  | "disabled"
  | "missing_command"
  | "missing_notebook_id"
  | "profile_missing"
  | "auth_expired"
  | "cookie_file_missing"
  | "cookie_invalid"
  | "cli_missing"
  | "notebook_unreachable"
  | "unknown";

export interface NotebookLmProviderState {
  enabled: boolean;
  ready: boolean;
  lifecycle: "ready" | "degraded" | "refreshing" | "expired";
  reason: NotebookLmProviderReason | null;
  recommendedAction?:
    | "crawclaw memory status"
    | "crawclaw memory refresh"
    | "crawclaw memory login";
  profile: string;
  notebookId?: string;
  refreshAttempted: boolean;
  refreshSucceeded: boolean;
  authSource?: string;
  lastValidatedAt: string;
  lastRefreshAt?: string;
  nextProbeAt?: string;
  nextAllowedRefreshAt?: string;
  details?: string;
}

function resolveRecommendedAction(
  reason: NotebookLmProviderReason | null,
  lifecycle: NotebookLmProviderState["lifecycle"],
): NotebookLmProviderState["recommendedAction"] {
  if (lifecycle === "ready") {
    return "crawclaw memory status";
  }
  switch (reason) {
    case "auth_expired":
    case "profile_missing":
    case "cookie_file_missing":
    case "cookie_invalid":
      return "crawclaw memory login";
    case "missing_notebook_id":
    case "notebook_unreachable":
    case "cli_missing":
    case "missing_command":
    case "unknown":
    case "disabled":
    default:
      return "crawclaw memory status";
  }
}

type ProviderMode = "query" | "write";
type CachedLifecycleState = {
  state: NotebookLmProviderState;
  lastCheckedAt: number;
  nextProbeAt?: number;
  lastRefreshAt?: number;
  lastRefreshFailedAt?: number;
};

const providerStateCache = new Map<string, CachedLifecycleState>();
const refreshInFlight = new Map<string, Promise<NotebookLmProviderState>>();

export function clearNotebookLmProviderStateCache(): void {
  providerStateCache.clear();
  refreshInFlight.clear();
}

function renderTemplate(value: string, params: { notebookId: string; profile: string }): string {
  return value
    .replaceAll("{notebookId}", params.notebookId)
    .replaceAll("{profile}", params.profile);
}

function inferAuthArgs(config: NotebookLmConfig): string[] {
  const notebookId = (config.cli.notebookId || config.write.notebookId || "").trim();
  const profile = (config.auth.profile || "default").trim() || "default";
  return ["status", notebookId, profile];
}

function inferAuthCommand(config: NotebookLmConfig): { command: string; args: string[] } | null {
  const profile = (config.auth.profile || "default").trim() || "default";
  const command = resolveNotebookLmCliCommand(config.cli.command);
  if (isNotebookLmNlmCommand(command)) {
    return {
      command,
      args: ["login", "--check", ...(profile === "default" ? [] : ["--profile", profile])],
    };
  }
  if (config.write.command.trim()) {
    const firstArg = config.write.args[0]?.trim();
    if (firstArg && (/[/\\]/.test(firstArg) || /\.(py|js|mjs|cjs|ts)$/i.test(firstArg))) {
      return {
        command: config.write.command,
        args: [firstArg, ...inferAuthArgs(config)],
      };
    }
  }
  if (command.trim()) {
    const firstArg = config.cli.args[0]?.trim();
    if (firstArg && (/[/\\]/.test(firstArg) || /\.(py|js|mjs|cjs|ts)$/i.test(firstArg))) {
      return {
        command,
        args: [firstArg, ...inferAuthArgs(config)],
      };
    }
    return {
      command,
      args: inferAuthArgs(config),
    };
  }
  return null;
}

function parseNlmLoginCheckOutput(stdout: string): Record<string, unknown> | null {
  if (!/Authentication valid/i.test(stdout)) {
    return null;
  }
  const profile = stdout.match(/Profile:\s*([^\s]+)/i)?.[1];
  const account = stdout.match(/Account:\s*(\S+)/i)?.[1];
  return {
    status: "ok",
    ready: true,
    reason: null,
    profile,
    refreshAttempted: false,
    refreshSucceeded: false,
    authSource: "profile",
    ...(account ? { account } : {}),
  };
}

function parseProviderStdout(stdout: string): Record<string, unknown> {
  try {
    return JSON.parse(stdout) as Record<string, unknown>;
  } catch (error) {
    const parsed = parseNlmLoginCheckOutput(stdout);
    if (parsed) {
      return parsed;
    }
    throw error;
  }
}

function classifyExecFailure(message: string): NotebookLmProviderReason {
  if (/ENOENT/.test(message)) {
    return "cli_missing";
  }
  if (/profile .*not found|profile_missing/i.test(message)) {
    return "profile_missing";
  }
  if (/Authentication failed|auth.*expired|unauthorized|forbidden|401|403/i.test(message)) {
    return "auth_expired";
  }
  return "unknown";
}

function isTransientNotebookLmApiError(message: string): boolean {
  return /API error \(code 7\)|google\.rpc\.ErrorInfo/i.test(message);
}

async function waitForNotebookLmRetry(attempt: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, attempt * 500));
}

function normalizeReason(value: unknown): NotebookLmProviderReason {
  switch (value) {
    case "disabled":
    case "missing_command":
    case "missing_notebook_id":
    case "profile_missing":
    case "auth_expired":
    case "cookie_file_missing":
    case "cookie_invalid":
    case "cli_missing":
    case "notebook_unreachable":
      return value;
    default:
      return "unknown";
  }
}

function buildSkippedState(
  config: NotebookLmConfig,
  reason: NotebookLmProviderReason,
  details?: string,
): NotebookLmProviderState {
  const lifecycle =
    reason === "auth_expired" || reason === "profile_missing" ? "expired" : "degraded";
  return {
    enabled: config.enabled,
    ready: false,
    lifecycle,
    reason,
    recommendedAction: resolveRecommendedAction(reason, lifecycle),
    profile: (config.auth.profile || "default").trim() || "default",
    notebookId: (config.cli.notebookId || config.write.notebookId || "").trim() || undefined,
    refreshAttempted: false,
    refreshSucceeded: false,
    lastValidatedAt: new Date().toISOString(),
    details,
  };
}

function buildProviderCacheKey(config: NotebookLmConfig, mode: ProviderMode): string {
  return JSON.stringify({
    mode,
    profile: (config.auth.profile || "default").trim() || "default",
    notebookId: (mode === "write"
      ? config.write.notebookId || config.cli.notebookId || ""
      : (config.cli.notebookId ?? config.write.notebookId ?? "")
    ).trim(),
    command: config.cli.command,
    writeCommand: config.write.command,
  });
}

function shouldUseCachedState(
  cached: CachedLifecycleState | undefined,
  config: NotebookLmConfig,
): boolean {
  if (!cached) {
    return false;
  }
  const now = Date.now();
  if (cached.state.ready) {
    return now - cached.lastCheckedAt < Math.max(0, config.auth.statusTtlMs || 0);
  }
  return typeof cached.nextProbeAt === "number" && now < cached.nextProbeAt;
}

function classifyLifecycle(
  reason: NotebookLmProviderReason | null,
  ready: boolean,
): NotebookLmProviderState["lifecycle"] {
  if (ready) {
    return "ready";
  }
  if (
    reason === "auth_expired" ||
    reason === "profile_missing" ||
    reason === "cookie_file_missing" ||
    reason === "cookie_invalid"
  ) {
    return "expired";
  }
  return "degraded";
}

function toCachedState(
  state: NotebookLmProviderState,
  config: NotebookLmConfig,
  now = Date.now(),
  previous?: CachedLifecycleState,
): CachedLifecycleState {
  const nextProbeAt = state.ready
    ? now + Math.max(0, config.auth.statusTtlMs || 0)
    : now + Math.max(0, config.auth.degradedCooldownMs || 0);
  const nextAllowedRefreshAt = previous?.lastRefreshFailedAt
    ? previous.lastRefreshFailedAt + Math.max(0, config.auth.refreshCooldownMs || 0)
    : undefined;
  return {
    state: {
      ...state,
      lifecycle: classifyLifecycle(state.reason, state.ready),
      recommendedAction: resolveRecommendedAction(
        state.ready ? null : state.reason,
        classifyLifecycle(state.reason, state.ready),
      ),
      nextProbeAt: nextProbeAt > now ? new Date(nextProbeAt).toISOString() : undefined,
      nextAllowedRefreshAt: nextAllowedRefreshAt
        ? new Date(nextAllowedRefreshAt).toISOString()
        : undefined,
    },
    lastCheckedAt: now,
    nextProbeAt,
    lastRefreshAt: state.refreshSucceeded ? now : previous?.lastRefreshAt,
    lastRefreshFailedAt: previous?.lastRefreshFailedAt,
  };
}

function normalizeStateFromWrapper(
  parsed: Record<string, unknown>,
  config: NotebookLmConfig,
  notebookId: string,
  previous?: CachedLifecycleState,
): NotebookLmProviderState {
  const ready = parsed.ready === true;
  const lifecycle = classifyLifecycle(ready ? null : normalizeReason(parsed.reason), ready);
  return {
    enabled: true,
    ready,
    lifecycle,
    reason: ready ? null : normalizeReason(parsed.reason),
    recommendedAction: resolveRecommendedAction(
      ready ? null : normalizeReason(parsed.reason),
      lifecycle,
    ),
    profile: typeof parsed.profile === "string" ? parsed.profile : config.auth.profile || "default",
    notebookId,
    refreshAttempted: parsed.refreshAttempted === true,
    refreshSucceeded: parsed.refreshSucceeded === true,
    authSource: typeof parsed.authSource === "string" ? parsed.authSource : undefined,
    lastValidatedAt: new Date().toISOString(),
    lastRefreshAt:
      parsed.refreshSucceeded === true ? new Date().toISOString() : previous?.state.lastRefreshAt,
    nextProbeAt: previous?.state.nextProbeAt,
    nextAllowedRefreshAt: previous?.state.nextAllowedRefreshAt,
    details: typeof parsed.error === "string" ? parsed.error : undefined,
  };
}

async function execNotebookLmProvider(
  config: NotebookLmConfig,
  commandArgs: string[],
  _logger?: RuntimeLogger,
): Promise<Record<string, unknown>> {
  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const stdout = await new Promise<string>((resolve, reject) => {
        execFileCallback(
          commandArgs[0],
          commandArgs.slice(1),
          {
            timeout: Math.max(config.cli.timeoutMs || 0, config.write.timeoutMs || 0, 5_000),
            maxBuffer: 1024 * 1024,
            env: {
              ...process.env,
              ...(config.auth.cookieFile?.trim()
                ? { CRAWCLAW_NOTEBOOKLM_COOKIE_FILE: config.auth.cookieFile.trim() }
                : {}),
            },
          },
          (error, nextStdout, nextStderr) => {
            if (error) {
              const output = [
                error instanceof Error ? error.message : "NotebookLM command failed",
                nextStdout,
                nextStderr,
              ]
                .filter((value) => typeof value === "string" && value.trim().length > 0)
                .join("\n");
              reject(new Error(output));
              return;
            }
            resolve(nextStdout);
          },
        );
      });
      return parseProviderStdout(stdout);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (attempt < maxAttempts && isTransientNotebookLmApiError(message)) {
        await waitForNotebookLmRetry(attempt);
        continue;
      }
      throw error;
    }
  }
  throw new Error("NotebookLM provider command failed");
}

export async function getNotebookLmProviderState(params: {
  config?: NotebookLmConfig;
  mode: ProviderMode;
  logger?: RuntimeInfoLogger;
}): Promise<NotebookLmProviderState> {
  const config = params.config;
  if (!config?.enabled) {
    return buildSkippedState(
      config ?? {
        enabled: false,
        auth: {
          profile: "default",
          cookieFile: "",
          statusTtlMs: 5 * 60_000,
          degradedCooldownMs: 15 * 60_000,
          refreshCooldownMs: 30 * 60_000,
          heartbeat: { enabled: true, minIntervalMs: 12 * 60_000, maxIntervalMs: 24 * 60_000 },
        },
        cli: { enabled: false, command: "", args: [], timeoutMs: 0, limit: 0, notebookId: "" },
        write: { command: "", args: [], timeoutMs: 0, notebookId: "" },
      },
      "disabled",
    );
  }

  if (params.mode === "query" && !config.cli.enabled) {
    return buildSkippedState(config, "disabled");
  }
  const rawNotebookId =
    params.mode === "write"
      ? config.write.notebookId || config.cli.notebookId || ""
      : (config.cli.notebookId ?? config.write.notebookId ?? "");
  const notebookId = rawNotebookId.trim();
  if (!notebookId) {
    return buildSkippedState(config, "missing_notebook_id");
  }

  const resolved = inferAuthCommand(config);
  if (!resolved?.command.trim()) {
    return buildSkippedState(config, "missing_command");
  }

  const cacheKey = buildProviderCacheKey(config, params.mode);
  const cached = providerStateCache.get(cacheKey);
  if (shouldUseCachedState(cached, config)) {
    return cached!.state;
  }

  try {
    const parsed = await execNotebookLmProvider(
      config,
      [
        resolved.command,
        ...resolved.args.map((value) =>
          renderTemplate(value, {
            notebookId,
            profile: (config.auth.profile || "default").trim() || "default",
          }),
        ),
      ],
      params.logger,
    );
    const state = normalizeStateFromWrapper(parsed, config, notebookId, cached);
    providerStateCache.set(cacheKey, toCachedState(state, config, Date.now(), cached));
    return providerStateCache.get(cacheKey)!.state;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    params.logger?.warn(`[memory] notebooklm provider status check failed | ${message}`);
    const state = buildSkippedState(config, classifyExecFailure(message), message);
    providerStateCache.set(cacheKey, toCachedState(state, config, Date.now(), cached));
    return providerStateCache.get(cacheKey)!.state;
  }
}

export async function refreshNotebookLmProviderState(params: {
  config?: NotebookLmConfig;
  mode: ProviderMode;
  logger?: RuntimeInfoLogger;
  force?: boolean;
}): Promise<NotebookLmProviderState> {
  const config = params.config;
  if (!config?.enabled) {
    return buildSkippedState(
      config ?? {
        enabled: false,
        auth: {
          profile: "default",
          cookieFile: "",
          statusTtlMs: 5 * 60_000,
          degradedCooldownMs: 15 * 60_000,
          refreshCooldownMs: 30 * 60_000,
          heartbeat: { enabled: true, minIntervalMs: 12 * 60_000, maxIntervalMs: 24 * 60_000 },
        },
        cli: { enabled: false, command: "", args: [], timeoutMs: 0, limit: 0, notebookId: "" },
        write: { command: "", args: [], timeoutMs: 0, notebookId: "" },
      },
      "disabled",
    );
  }
  const rawNotebookId =
    params.mode === "write"
      ? config.write.notebookId || config.cli.notebookId || ""
      : (config.cli.notebookId ?? config.write.notebookId ?? "");
  const notebookId = rawNotebookId.trim();
  if (!notebookId) {
    return buildSkippedState(config, "missing_notebook_id");
  }
  const resolved = inferAuthCommand(config);
  if (!resolved?.command.trim()) {
    return buildSkippedState(config, "missing_command");
  }

  const cacheKey = buildProviderCacheKey(config, params.mode);
  const cached = providerStateCache.get(cacheKey);
  const now = Date.now();
  if (
    !params.force &&
    cached?.lastRefreshFailedAt &&
    now < cached.lastRefreshFailedAt + Math.max(0, config.auth.refreshCooldownMs || 0)
  ) {
    const nextAllowedAt =
      cached.lastRefreshFailedAt + Math.max(0, config.auth.refreshCooldownMs || 0);
    return {
      ...cached.state,
      lifecycle: "expired",
      nextAllowedRefreshAt: new Date(nextAllowedAt).toISOString(),
      details: cached.state.details
        ? `${cached.state.details} | refresh cooldown active`
        : "refresh cooldown active",
    };
  }

  const existingFlight = refreshInFlight.get(cacheKey);
  if (existingFlight) {
    return existingFlight;
  }

  const refreshPromise = (async (): Promise<NotebookLmProviderState> => {
    providerStateCache.set(
      cacheKey,
      toCachedState(
        {
          ...(cached?.state ?? buildSkippedState(config, "unknown")),
          enabled: true,
          ready: false,
          lifecycle: "refreshing",
          reason: cached?.state.reason ?? "unknown",
          profile: (config.auth.profile || "default").trim() || "default",
          notebookId,
          refreshAttempted: true,
          refreshSucceeded: false,
          authSource: "cookie_file",
          lastValidatedAt: new Date().toISOString(),
          details: "refreshing NotebookLM profile from cookie fallback",
        },
        config,
        now,
        cached,
      ),
    );
    try {
      const firstArg = resolved.args[0]?.trim();
      const commandArgs = isNotebookLmNlmCommand(resolved.command)
        ? [resolved.command, ...resolved.args]
        : [
            resolved.command,
            ...(firstArg && (/[/\\]/.test(firstArg) || /\.(py|js|mjs|cjs|ts)$/i.test(firstArg))
              ? [
                  firstArg,
                  "refresh",
                  notebookId,
                  (config.auth.profile || "default").trim() || "default",
                ]
              : ["refresh", notebookId, (config.auth.profile || "default").trim() || "default"]),
          ];
      const parsed = await execNotebookLmProvider(config, commandArgs, params.logger);
      const state = normalizeStateFromWrapper(parsed, config, notebookId, cached);
      const nextCached = toCachedState(state, config, Date.now(), cached);
      nextCached.lastRefreshAt = Date.now();
      if (!state.ready) {
        nextCached.lastRefreshFailedAt = Date.now();
        nextCached.state.nextAllowedRefreshAt = new Date(
          nextCached.lastRefreshFailedAt + Math.max(0, config.auth.refreshCooldownMs || 0),
        ).toISOString();
      } else {
        nextCached.lastRefreshFailedAt = undefined;
      }
      providerStateCache.set(cacheKey, nextCached);
      return nextCached.state;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      params.logger?.warn(`[memory] notebooklm provider refresh failed | ${message}`);
      const state = buildSkippedState(config, classifyExecFailure(message), message);
      const nextCached = toCachedState(
        {
          ...state,
          refreshAttempted: true,
          refreshSucceeded: false,
          lifecycle: "expired",
          authSource: "cookie_file",
        },
        config,
        Date.now(),
        cached,
      );
      nextCached.lastRefreshFailedAt = Date.now();
      nextCached.state.nextAllowedRefreshAt = new Date(
        nextCached.lastRefreshFailedAt + Math.max(0, config.auth.refreshCooldownMs || 0),
      ).toISOString();
      providerStateCache.set(cacheKey, nextCached);
      return nextCached.state;
    } finally {
      refreshInFlight.delete(cacheKey);
    }
  })();
  refreshInFlight.set(cacheKey, refreshPromise);
  return refreshPromise;
}
