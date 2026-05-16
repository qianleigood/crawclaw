import type { CliDeps } from "../terminal/deps.js";

export function shouldWakeFromRestartSentinel(): boolean {
  return false;
}

export async function scheduleRestartSentinelWake(_params: { deps: CliDeps }): Promise<void> {}
