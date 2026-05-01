import { flushPendingExperienceNotes } from "../experience/sync-outbox.ts";
import type { NotebookLmConfig } from "../types/config.ts";
import { inferNotebookLmAutoLoginCommand, runNotebookLmLoginCommand } from "./login.ts";
import { emitNotebookLmNotification } from "./notification.ts";
import { clearNotebookLmProviderStateCache, getNotebookLmProviderState } from "./provider-state.ts";

type RuntimeLogger = { info(message: string): void; warn(message: string): void };

type HeartbeatStateProbe = typeof getNotebookLmProviderState;
type HeartbeatAutoLogin = (config: NotebookLmConfig) => Promise<void>;
type HeartbeatFlushPending = (config: NotebookLmConfig) => Promise<unknown>;

type HeartbeatEntry = {
  key: string;
  stop: () => void;
};

let activeHeartbeat: HeartbeatEntry | null = null;

function buildHeartbeatKey(config: NotebookLmConfig): string {
  return JSON.stringify({
    command: config.cli.command,
    args: config.cli.args,
    profile: config.auth.profile,
    cookieFile: config.auth.cookieFile ?? "",
    notebookId: config.cli.notebookId || config.write.notebookId || "",
    enabled: config.auth.heartbeat.enabled,
    minIntervalMs: config.auth.heartbeat.minIntervalMs,
    maxIntervalMs: config.auth.heartbeat.maxIntervalMs,
    autoLoginEnabled: config.auth.autoLogin?.enabled ?? false,
    autoLoginProvider: config.auth.autoLogin?.provider ?? "nlm_profile",
    autoLoginIntervalMs: config.auth.autoLogin?.intervalMs ?? 0,
    autoLoginCdpUrl: config.auth.autoLogin?.cdpUrl ?? "",
  });
}

function computeNextDelay(config: NotebookLmConfig): number {
  const min = Math.max(60_000, config.auth.heartbeat.minIntervalMs || 0);
  const max = Math.max(min, config.auth.heartbeat.maxIntervalMs || min);
  if (max === min) {
    return min;
  }
  return min + Math.floor(Math.random() * (max - min + 1));
}

function maybeUnref(timer: ReturnType<typeof setTimeout>): void {
  if (typeof (timer as { unref?: () => void }).unref === "function") {
    (timer as { unref: () => void }).unref();
  }
}

async function runConfiguredAutoLogin(config: NotebookLmConfig): Promise<void> {
  if (!config.auth.autoLogin?.enabled) {
    return;
  }
  const command = inferNotebookLmAutoLoginCommand(config);
  if (!command) {
    throw new Error("NotebookLM auto login command is not configured");
  }
  await runNotebookLmLoginCommand(command.command, command.args);
  clearNotebookLmProviderStateCache();
}

async function flushConfiguredPendingExperience(config: NotebookLmConfig): Promise<void> {
  await flushPendingExperienceNotes({ config });
}

export function stopNotebookLmHeartbeatForTests(): void {
  activeHeartbeat?.stop();
  activeHeartbeat = null;
}

export function startNotebookLmHeartbeat(params: {
  config?: NotebookLmConfig;
  logger: RuntimeLogger;
  probe?: HeartbeatStateProbe;
  autoLogin?: HeartbeatAutoLogin;
  flushPending?: HeartbeatFlushPending;
}): void {
  const config = params.config;
  if (!config?.enabled || !config.cli.enabled || !config.auth.heartbeat.enabled) {
    return;
  }

  const notebookId = (config.cli.notebookId || config.write.notebookId || "").trim();
  if (!notebookId) {
    return;
  }

  const key = buildHeartbeatKey(config);
  if (activeHeartbeat?.key === key) {
    return;
  }

  activeHeartbeat?.stop();

  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let running = false;
  let lastReady: boolean | null = null;
  let lastAutoLoginAt = 0;
  const probe = params.probe ?? getNotebookLmProviderState;
  const autoLogin = params.autoLogin ?? runConfiguredAutoLogin;
  const flushPending = params.flushPending ?? flushConfiguredPendingExperience;

  const scheduleNext = () => {
    if (stopped) {
      return;
    }
    timer = setTimeout(async () => {
      if (stopped || running) {
        scheduleNext();
        return;
      }
      running = true;
      try {
        let autoLoginRan = false;
        const autoLoginConfig = config.auth.autoLogin;
        const autoLoginInterval = Math.max(60_000, autoLoginConfig?.intervalMs || 0);
        if (autoLoginConfig?.enabled && Date.now() - lastAutoLoginAt >= autoLoginInterval) {
          try {
            await autoLogin(config);
            lastAutoLoginAt = Date.now();
            autoLoginRan = true;
          } catch (error) {
            params.logger.warn(
              `[memory] notebooklm auth auto login failed | ${
                error instanceof Error ? error.message : String(error)
              }`,
            );
          }
        }
        const state = await probe({ config, mode: "query", logger: params.logger });
        if (!state.ready) {
          emitNotebookLmNotification({
            state,
            logger: params.logger,
            scope: { source: "heartbeat" },
          });
          params.logger.warn(
            `[memory] notebooklm auth heartbeat degraded | reason=${state.reason ?? "unknown"}${
              state.refreshAttempted ? ` refresh=${state.refreshSucceeded ? "ok" : "failed"}` : ""
            }${state.details ? ` | ${state.details}` : ""}`,
          );
        } else if (lastReady === false || state.refreshSucceeded) {
          params.logger.info(
            `[memory] notebooklm auth heartbeat healthy | profile=${state.profile} notebook=${state.notebookId ?? notebookId}`,
          );
        }
        if (state.ready && (autoLoginRan || lastReady === false || state.refreshSucceeded)) {
          await flushPending(config);
        }
        lastReady = state.ready;
      } catch (error) {
        params.logger.warn(
          `[memory] notebooklm auth heartbeat failed | ${error instanceof Error ? error.message : String(error)}`,
        );
      } finally {
        running = false;
        scheduleNext();
      }
    }, computeNextDelay(config));
    maybeUnref(timer);
  };

  scheduleNext();

  activeHeartbeat = {
    key,
    stop: () => {
      stopped = true;
      if (timer) {
        clearTimeout(timer);
      }
    },
  };
}
