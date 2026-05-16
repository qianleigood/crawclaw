import type { CrawClawConfig } from "../config/config.js";
import type { SessionMaintenanceWarning } from "../config/sessions/store-maintenance.js";
import type { SessionEntry } from "../config/sessions/types.js";
import { enqueueSystemEvent } from "./system-events.js";

type WarningParams = {
  cfg: CrawClawConfig;
  sessionKey: string;
  entry: SessionEntry;
  warning: SessionMaintenanceWarning;
};

const warnedContexts = new Map<string, string>();

function resetSessionMaintenanceWarningForTests() {
  warnedContexts.clear();
}

export const __testing = {
  resetSessionMaintenanceWarningForTests,
} as const;

function shouldSendWarning(): boolean {
  return !process.env.VITEST && process.env.NODE_ENV !== "test";
}

function buildWarningContext(params: WarningParams): string {
  const { warning } = params;
  return [
    warning.activeSessionKey,
    warning.pruneAfterMs,
    warning.maxEntries,
    warning.wouldPrune ? "prune" : "",
    warning.wouldCap ? "cap" : "",
  ]
    .filter(Boolean)
    .join("|");
}

function formatDuration(ms: number): string {
  if (ms >= 86_400_000) {
    const days = Math.round(ms / 86_400_000);
    return `${days} day${days === 1 ? "" : "s"}`;
  }
  if (ms >= 3_600_000) {
    const hours = Math.round(ms / 3_600_000);
    return `${hours} hour${hours === 1 ? "" : "s"}`;
  }
  if (ms >= 60_000) {
    const mins = Math.round(ms / 60_000);
    return `${mins} minute${mins === 1 ? "" : "s"}`;
  }
  const secs = Math.round(ms / 1000);
  return `${secs} second${secs === 1 ? "" : "s"}`;
}

function buildWarningText(warning: SessionMaintenanceWarning): string {
  const reasons: string[] = [];
  if (warning.wouldPrune) {
    reasons.push(`older than ${formatDuration(warning.pruneAfterMs)}`);
  }
  if (warning.wouldCap) {
    reasons.push(`not in the most recent ${warning.maxEntries} sessions`);
  }
  const reasonText = reasons.length > 0 ? reasons.join(" and ") : "over maintenance limits";
  return (
    `⚠️ Session maintenance warning: this active session would be evicted (${reasonText}). ` +
    `Maintenance is set to warn-only, so nothing was reset. ` +
    `To enforce cleanup, set \`session.maintenance.mode: "enforce"\` or increase the limits.`
  );
}

export async function deliverSessionMaintenanceWarning(params: WarningParams): Promise<void> {
  if (!shouldSendWarning()) {
    return;
  }

  const contextKey = buildWarningContext(params);
  if (warnedContexts.get(params.sessionKey) === contextKey) {
    return;
  }
  warnedContexts.set(params.sessionKey, contextKey);

  const text = buildWarningText(params.warning);
  void params.cfg;
  void params.entry;
  enqueueSystemEvent(text, { sessionKey: params.sessionKey });
}
