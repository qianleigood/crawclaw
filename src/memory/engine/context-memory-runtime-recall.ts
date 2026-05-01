import {
  recallDurableMemory,
  type DurableRecallResult,
  type RecentDreamTouchedNote,
} from "../durable/read.ts";
import { resolveDurableMemoryScope } from "../durable/scope.ts";
import type { CompleteFn } from "../extraction/llm.ts";
import type { RuntimeStore } from "../runtime/runtime-store.ts";
import type { RuntimeLogger } from "./context-memory-runtime-deps.ts";
import {
  resolveMemoryMessageChannel,
  type DurableRecallSource,
} from "./context-memory-runtime-helpers.ts";
import type { MemoryRuntimeContext } from "./types.ts";

function collectRecentDreamTouchedNotes(params: {
  scopeKey: string;
  runs: Array<{
    kind: string;
    status: string;
    scope: string | null;
    metricsJson: string | null;
    createdAt?: number;
    updatedAt?: number;
    finishedAt?: number | null;
  }>;
  limit?: number;
}): RecentDreamTouchedNote[] {
  const touched = new Map<string, RecentDreamTouchedNote>();
  for (const run of params.runs) {
    if (run.kind !== "dream" || run.status !== "done" || run.scope !== params.scopeKey) {
      continue;
    }
    try {
      const parsed = JSON.parse(run.metricsJson ?? "{}") as Record<string, unknown>;
      const touchedNotes = Array.isArray(parsed.touchedNotes)
        ? parsed.touchedNotes.filter(
            (value): value is string => typeof value === "string" && value.trim().length > 0,
          )
        : [];
      const touchedAt = run.finishedAt ?? run.updatedAt ?? run.createdAt ?? Date.now();
      for (const notePath of touchedNotes) {
        const normalized = notePath.trim();
        touched.set(normalized, { notePath: normalized, touchedAt });
        if (touched.size >= Math.max(1, params.limit ?? 8)) {
          return [...touched.values()];
        }
      }
    } catch {
      continue;
    }
  }
  return [...touched.values()];
}

export async function resolveDurableRecallForAssembly(params: {
  sessionId: string;
  sessionKey?: string;
  promptText: string;
  recentMessages?: string[];
  runtimeContext?: MemoryRuntimeContext;
  runtimeStore: RuntimeStore;
  logger: RuntimeLogger;
  complete?: CompleteFn;
}): Promise<{
  durableRecall: DurableRecallResult | null;
  durableRecallSource: DurableRecallSource;
}> {
  const durableScope = resolveDurableMemoryScope({
    sessionKey: params.sessionKey,
    agentId:
      typeof params.runtimeContext?.agentId === "string"
        ? params.runtimeContext.agentId
        : undefined,
    channel: resolveMemoryMessageChannel(params.runtimeContext),
    userId:
      typeof params.runtimeContext?.senderId === "string"
        ? params.runtimeContext.senderId
        : undefined,
  });
  let durableRecallSource: DurableRecallSource = "sync";
  if (!durableScope) {
    return {
      durableRecall: null,
      durableRecallSource,
    };
  }
  let durableRecall: DurableRecallResult | null = null;
  try {
    const recentMaintenanceRuns =
      typeof params.runtimeStore.listRecentMaintenanceRuns === "function"
        ? await params.runtimeStore.listRecentMaintenanceRuns(20).catch(() => [])
        : [];
    durableRecall = await recallDurableMemory({
      scope: durableScope,
      prompt: params.promptText,
      recentMessages: params.recentMessages,
      recentDreamTouchedNotes:
        typeof durableScope.scopeKey === "string" && durableScope.scopeKey
          ? collectRecentDreamTouchedNotes({
              scopeKey: durableScope.scopeKey,
              runs: recentMaintenanceRuns,
            })
          : [],
      complete: params.complete,
      limit: 5,
    });
  } catch (error) {
    durableRecallSource = "sync_error";
    params.logger.warn(
      `[memory] durable recall failed | ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  return {
    durableRecall,
    durableRecallSource,
  };
}
