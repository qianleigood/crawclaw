export { isRecord } from "../channels/plugins/status-issues/shared.js";
export {
  appendMatchMetadata,
  asString,
  collectIssuesForEnabledAccounts,
  formatMatchMetadata,
  resolveEnabledConfiguredAccountId,
} from "../channels/plugins/status-issues/shared.js";
export {
  buildBaseAccountStatusSnapshot,
  buildComputedAccountStatusSnapshot,
  buildRuntimeAccountStatusSnapshot,
  collectStatusIssuesFromLastError,
  createAsyncComputedAccountStatusAdapter,
  createComputedAccountStatusAdapter,
  createDefaultChannelRuntimeState,
  createDependentCredentialStatusIssueCollector,
} from "./status-helpers-runtime.js";

type StatusSnapshotExtra = Record<string, unknown>;

/** Normalize a channel-level status summary so missing lifecycle fields become explicit nulls. */
export function buildBaseChannelStatusSummary<TExtra extends StatusSnapshotExtra>(
  snapshot: {
    configured?: boolean | null;
    running?: boolean | null;
    lastStartAt?: number | null;
    lastStopAt?: number | null;
    lastError?: string | null;
  },
  extra?: TExtra,
) {
  return {
    configured: snapshot.configured ?? false,
    ...(extra ?? ({} as TExtra)),
    running: snapshot.running ?? false,
    lastStartAt: snapshot.lastStartAt ?? null,
    lastStopAt: snapshot.lastStopAt ?? null,
    lastError: snapshot.lastError ?? null,
  };
}

/** Extend the base summary with probe fields while preserving stable null defaults. */
export function buildProbeChannelStatusSummary<TExtra extends Record<string, unknown>>(
  snapshot: {
    configured?: boolean | null;
    running?: boolean | null;
    lastStartAt?: number | null;
    lastStopAt?: number | null;
    lastError?: string | null;
    probe?: unknown;
    lastProbeAt?: number | null;
  },
  extra?: TExtra,
) {
  return {
    ...buildBaseChannelStatusSummary(snapshot, extra),
    probe: snapshot.probe,
    lastProbeAt: snapshot.lastProbeAt ?? null,
  };
}

/** Build webhook channel summaries with a stable default mode. */
export function buildWebhookChannelStatusSummary<TExtra extends StatusSnapshotExtra>(
  snapshot: {
    configured?: boolean | null;
    mode?: string | null;
    running?: boolean | null;
    lastStartAt?: number | null;
    lastStopAt?: number | null;
    lastError?: string | null;
  },
  extra?: TExtra,
) {
  return buildBaseChannelStatusSummary(snapshot, {
    mode: snapshot.mode ?? "webhook",
    ...(extra ?? ({} as TExtra)),
  });
}

/** Build token-based channel status summaries with optional mode reporting. */
export function buildTokenChannelStatusSummary(
  snapshot: {
    configured?: boolean | null;
    tokenSource?: string | null;
    running?: boolean | null;
    mode?: string | null;
    lastStartAt?: number | null;
    lastStopAt?: number | null;
    lastError?: string | null;
    probe?: unknown;
    lastProbeAt?: number | null;
  },
  opts?: { includeMode?: boolean },
) {
  const base = {
    ...buildBaseChannelStatusSummary(snapshot),
    tokenSource: snapshot.tokenSource ?? "none",
    probe: snapshot.probe,
    lastProbeAt: snapshot.lastProbeAt ?? null,
  };
  if (opts?.includeMode === false) {
    return base;
  }
  return {
    ...base,
    mode: snapshot.mode ?? null,
  };
}
