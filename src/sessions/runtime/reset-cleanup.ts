import { clearBootstrapSnapshot } from "../../agents/bootstrap-cache.js";
import type { CrawClawConfig } from "../../config/config.js";
import type { SessionEntry } from "../../config/sessions.js";
import { callGateway } from "../../gateway/call.js";
import { ErrorCodes, errorShape } from "../../gateway/protocol/index.js";
import { resolveGatewaySessionStoreTarget } from "../../gateway/session-utils.js";
import { logVerbose } from "../../globals.js";
import { closeTrackedBrowserTabsForSessions } from "../../internal-plugin-helpers/browser-maintenance.js";

const ACP_RUNTIME_CLEANUP_TIMEOUT_MS = 15_000;

type GatewaySessionStoreTarget = ReturnType<typeof resolveGatewaySessionStoreTarget>;

async function stopSubagentsForRequesterViaRust(params: {
  requesterSessionKey: string;
}): Promise<void> {
  try {
    await callGateway({
      method: "subagents.control",
      params: {
        action: "killAll",
        requesterSessionKey: params.requesterSessionKey,
      },
      timeoutMs: 10_000,
    });
  } catch (error) {
    logVerbose(
      `sessions.reset: Rust subagent cleanup failed for ${params.requesterSessionKey}: ${String(error)}`,
    );
  }
}

async function ensureSessionRuntimeCleanup(params: {
  cfg: CrawClawConfig;
  key: string;
  target: GatewaySessionStoreTarget;
  sessionId?: string;
}) {
  const closeTrackedBrowserTabs = async () => {
    const closeKeys = new Set<string>([
      params.key,
      params.target.canonicalKey,
      ...params.target.storeKeys,
      params.sessionId ?? "",
    ]);
    return await closeTrackedBrowserTabsForSessions({
      sessionKeys: [...closeKeys],
      onWarn: (message) => logVerbose(message),
    });
  };

  await stopSubagentsForRequesterViaRust({
    requesterSessionKey: params.target.canonicalKey,
  });
  if (!params.sessionId) {
    clearBootstrapSnapshot(params.target.canonicalKey);
    await closeTrackedBrowserTabs();
    return undefined;
  }
  clearBootstrapSnapshot(params.target.canonicalKey);
  await closeTrackedBrowserTabs();
  return undefined;
}

async function stopDurableExtractionWorkersForTarget(params: {
  key: string;
  target: GatewaySessionStoreTarget;
  legacyKey?: string;
  canonicalKey?: string;
}) {
  void params;
}

async function runAcpCleanupStep(params: {
  op: () => Promise<void>;
}): Promise<{ status: "ok" } | { status: "timeout" } | { status: "error"; error: unknown }> {
  let timer: NodeJS.Timeout | undefined;
  const timeoutPromise = new Promise<{ status: "timeout" }>((resolve) => {
    timer = setTimeout(() => resolve({ status: "timeout" }), ACP_RUNTIME_CLEANUP_TIMEOUT_MS);
  });
  const opPromise = params
    .op()
    .then(() => ({ status: "ok" as const }))
    .catch((error: unknown) => ({ status: "error" as const, error }));
  const outcome = await Promise.race([opPromise, timeoutPromise]);
  if (timer) {
    clearTimeout(timer);
  }
  return outcome;
}

async function closeAcpRuntimeForSession(params: {
  cfg: CrawClawConfig;
  sessionKey: string;
  entry?: SessionEntry;
  reason: "session-reset" | "session-delete";
}) {
  if (!params.entry?.acp) {
    return undefined;
  }
  const cancelOutcome = await runAcpCleanupStep({
    op: async () => {
      await callGateway({
        method: "acp.session.cancel",
        params: {
          sessionKey: params.sessionKey,
          reason: params.reason,
        },
        timeoutMs: ACP_RUNTIME_CLEANUP_TIMEOUT_MS,
      });
    },
  });
  if (cancelOutcome.status === "timeout") {
    return errorShape(
      ErrorCodes.UNAVAILABLE,
      `Session ${params.sessionKey} is still active; try again in a moment.`,
    );
  }
  if (cancelOutcome.status === "error") {
    logVerbose(
      `sessions.${params.reason}: ACP cancel failed for ${params.sessionKey}: ${String(cancelOutcome.error)}`,
    );
  }

  const closeOutcome = await runAcpCleanupStep({
    op: async () => {
      await callGateway({
        method: "acp.session.close",
        params: {
          sessionKey: params.sessionKey,
          reason: params.reason,
        },
        timeoutMs: ACP_RUNTIME_CLEANUP_TIMEOUT_MS,
      });
    },
  });
  if (closeOutcome.status === "timeout") {
    return errorShape(
      ErrorCodes.UNAVAILABLE,
      `Session ${params.sessionKey} is still active; try again in a moment.`,
    );
  }
  if (closeOutcome.status === "error") {
    logVerbose(
      `sessions.${params.reason}: ACP runtime close failed for ${params.sessionKey}: ${String(closeOutcome.error)}`,
    );
  }
  return undefined;
}

export async function cleanupSessionBeforeMutation(params: {
  cfg: CrawClawConfig;
  key: string;
  target: GatewaySessionStoreTarget;
  entry: SessionEntry | undefined;
  legacyKey?: string;
  canonicalKey?: string;
  reason: "session-reset" | "session-delete";
}) {
  await stopDurableExtractionWorkersForTarget({
    key: params.key,
    target: params.target,
    legacyKey: params.legacyKey,
    canonicalKey: params.canonicalKey,
  });
  const cleanupError = await ensureSessionRuntimeCleanup({
    cfg: params.cfg,
    key: params.key,
    target: params.target,
    sessionId: params.entry?.sessionId,
  });
  if (cleanupError) {
    return cleanupError;
  }
  return await closeAcpRuntimeForSession({
    cfg: params.cfg,
    sessionKey: params.legacyKey ?? params.canonicalKey ?? params.target.canonicalKey ?? params.key,
    entry: params.entry,
    reason: params.reason,
  });
}
