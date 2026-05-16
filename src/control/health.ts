import type { CrawClawConfig } from "../config/config.js";
import type { RuntimeEnv } from "../runtime.js";

export type HealthSummary = Record<string, unknown> & { ok?: boolean; durationMs?: number };

export async function healthCommand(
  _opts: {
    json?: boolean;
    timeoutMs?: number;
    config?: CrawClawConfig;
  },
  _runtime: RuntimeEnv,
): Promise<HealthSummary> {
  return { ok: true };
}

export async function getHealthSnapshot(_opts?: { probe?: boolean }): Promise<HealthSummary> {
  return { ok: true };
}
