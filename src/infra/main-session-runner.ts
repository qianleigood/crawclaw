import type { AgentDefaultsConfig } from "../config/types.agent-defaults.js";
import { type MainSessionWakeDeps, runMainSessionWakeOnce } from "./main-session-wake-runner.js";
import { requestMainSessionWakeNow } from "./main-session-wake.js";

type MainSessionWakeConfig = AgentDefaultsConfig["heartbeat"];

export type MainSessionRunResult = Awaited<ReturnType<typeof runMainSessionWakeOnce>>;

export type MainSessionRunOptions = {
  cfg?: Parameters<typeof runMainSessionWakeOnce>[0]["cfg"];
  agentId?: string;
  sessionKey?: string;
  reason?: string;
  deps?: MainSessionWakeDeps;
  session?: Pick<NonNullable<MainSessionWakeConfig>, "target">;
};

export async function runMainSessionOnce(
  opts: MainSessionRunOptions = {},
): Promise<MainSessionRunResult> {
  return await runMainSessionWakeOnce({
    cfg: opts.cfg,
    agentId: opts.agentId,
    sessionKey: opts.sessionKey,
    reason: opts.reason,
    deps: opts.deps,
    heartbeat: opts.session,
  });
}

export function requestMainSessionWake(opts?: {
  reason?: string;
  coalesceMs?: number;
  agentId?: string;
  sessionKey?: string;
}) {
  requestMainSessionWakeNow(opts);
}
