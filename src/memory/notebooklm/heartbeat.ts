import type { NotebookLmConfig } from "../types/config.ts";
import { emitNotebookLmNotification } from "./notification.ts";
import { getNotebookLmProviderState } from "./provider-state.ts";

type RuntimeLogger = { info(message: string): void; warn(message: string): void };

type HeartbeatStateProbe = typeof getNotebookLmProviderState;

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
    autoRefresh: config.auth.autoRefresh,
    notebookId: config.cli.notebookId || config.write.notebookId || "",
    enabled: config.auth.heartbeat.enabled,
    minIntervalMs: config.auth.heartbeat.minIntervalMs,
    maxIntervalMs: config.auth.heartbeat.maxIntervalMs,
  });
}

function computeNextDelay(config: NotebookLmConfig): number {
  const min = Math.max(60_000, config.auth.heartbeat.minIntervalMs || 0);
  const max = Math.max(min, config.auth.heartbeat.maxIntervalMs || min);
  if (max === min) {return min;}
  return min + Math.floor(Math.random() * (max - min + 1));
}

function maybeUnref(timer: ReturnType<typeof setTimeout>): void {
  if (typeof (timer as { unref?: () => void }).unref === "function") {
    (timer as { unref: () => void }).unref();
  }
}

export function stopNotebookLmHeartbeatForTests(): void {
  activeHeartbeat?.stop();
  activeHeartbeat = null;
}

export function startNotebookLmHeartbeat(params: {
  config?: NotebookLmConfig;
  logger: RuntimeLogger;
  probe?: HeartbeatStateProbe;
}): void {
  const config = params.config;
  if (!config?.enabled || !config.cli.enabled || !config.auth.heartbeat.enabled) {return;}

  const notebookId = (config.cli.notebookId || config.write.notebookId || "").trim();
  if (!notebookId) {return;}

  const key = buildHeartbeatKey(config);
  if (activeHeartbeat?.key === key) {return;}

  activeHeartbeat?.stop();

  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let running = false;
  let lastReady: boolean | null = null;
  const probe = params.probe ?? getNotebookLmProviderState;

  const scheduleNext = () => {
    if (stopped) {return;}
    timer = setTimeout(async () => {
      if (stopped || running) {
        scheduleNext();
        return;
      }
      running = true;
      try {
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
      if (timer) {clearTimeout(timer);}
    },
  };
}
