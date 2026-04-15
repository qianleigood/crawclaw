import type {
  MemoryRuntime,
  MemoryMaintenanceResult,
  MemoryRuntimeContext,
} from "../../memory/index.js";
import { log } from "./logger.js";
import {
  rewriteTranscriptEntriesInSessionFile,
  rewriteTranscriptEntriesInSessionManager,
} from "./transcript-rewrite.js";

/**
 * Attach runtime-owned transcript rewrite helpers to an existing
 * memory-runtime context payload.
 */
export function buildMemoryRuntimeMaintenanceRuntimeContext(params: {
  sessionId: string;
  sessionKey?: string;
  sessionFile: string;
  sessionManager?: Parameters<typeof rewriteTranscriptEntriesInSessionManager>[0]["sessionManager"];
  runtimeContext?: MemoryRuntimeContext;
}): MemoryRuntimeContext {
  return {
    ...params.runtimeContext,
    rewriteTranscriptEntries: async (request) => {
      if (params.sessionManager) {
        return rewriteTranscriptEntriesInSessionManager({
          sessionManager: params.sessionManager,
          replacements: request.replacements,
        });
      }
      return await rewriteTranscriptEntriesInSessionFile({
        sessionFile: params.sessionFile,
        sessionId: params.sessionId,
        sessionKey: params.sessionKey,
        request,
      });
    },
  };
}

/**
 * Run optional memory-runtime transcript maintenance and normalize the result.
 */
export async function runMemoryRuntimeMaintenance(params: {
  memoryRuntime?: MemoryRuntime;
  sessionId: string;
  sessionKey?: string;
  sessionFile: string;
  reason: "bootstrap" | "compaction" | "turn";
  sessionManager?: Parameters<typeof rewriteTranscriptEntriesInSessionManager>[0]["sessionManager"];
  runtimeContext?: MemoryRuntimeContext;
}): Promise<MemoryMaintenanceResult | undefined> {
  if (typeof params.memoryRuntime?.maintain !== "function") {
    return undefined;
  }

  try {
    const result = await params.memoryRuntime.maintain({
      sessionId: params.sessionId,
      sessionKey: params.sessionKey,
      sessionFile: params.sessionFile,
      runtimeContext: buildMemoryRuntimeMaintenanceRuntimeContext({
        sessionId: params.sessionId,
        sessionKey: params.sessionKey,
        sessionFile: params.sessionFile,
        sessionManager: params.sessionManager,
        runtimeContext: params.runtimeContext,
      }),
    });
    if (result.changed) {
      log.info(
        `[memory-runtime] maintenance(${params.reason}) changed transcript ` +
          `rewrittenEntries=${result.rewrittenEntries} bytesFreed=${result.bytesFreed} ` +
          `sessionKey=${params.sessionKey ?? params.sessionId ?? "unknown"}`,
      );
    }
    return result;
  } catch (err) {
    log.warn(`memory runtime maintain failed (${params.reason}): ${String(err)}`);
    return undefined;
  }
}
