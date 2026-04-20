import type { AgentDefaultsConfig } from "../config/types.agent-defaults.js";
import { type HeartbeatDeps, runHeartbeatOnce } from "./heartbeat-runner.js";
import { requestHeartbeatNow } from "./heartbeat-wake.js";

type HeartbeatConfig = AgentDefaultsConfig["heartbeat"];

export type MainSessionRunResult = Awaited<ReturnType<typeof runHeartbeatOnce>>;

export type MainSessionRunOptions = {
  cfg?: Parameters<typeof runHeartbeatOnce>[0]["cfg"];
  agentId?: string;
  sessionKey?: string;
  reason?: string;
  deps?: HeartbeatDeps;
  session?: Pick<NonNullable<HeartbeatConfig>, "target">;
};

export async function runMainSessionOnce(
  opts: MainSessionRunOptions = {},
): Promise<MainSessionRunResult> {
  return await runHeartbeatOnce({
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
  requestHeartbeatNow(opts);
}
