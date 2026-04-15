import type { DurableRecallResult } from "./read.ts";
import { recallDurableMemory } from "./read.ts";
import type { DurableMemoryScope } from "./scope.ts";

type CompleteFn = ReturnType<typeof import("../extraction/llm.ts").createCompleteFn>;

export type DurableRecallPrefetchHandle = {
  readonly sessionId: string;
  readonly sessionKey?: string;
  readonly prompt: string;
  readonly scopeKey: string;
  readonly startedAt: number;
  status: "pending" | "fulfilled" | "rejected";
  result?: DurableRecallResult | null;
  error?: unknown;
  promise: Promise<void>;
};

export function startDurableRecallPrefetch(params: {
  sessionId: string;
  sessionKey?: string;
  prompt: string;
  recentMessages?: string[];
  scope: DurableMemoryScope;
  complete?: CompleteFn;
  limit?: number;
}): DurableRecallPrefetchHandle {
  const handle: DurableRecallPrefetchHandle = {
    sessionId: params.sessionId,
    sessionKey: params.sessionKey,
    prompt: params.prompt,
    scopeKey: params.scope.scopeKey ?? `${params.scope.agentId}:${params.scope.channel}:${params.scope.userId}`,
    startedAt: Date.now(),
    status: "pending",
    promise: Promise.resolve(),
  };

  handle.promise = (async () => {
    try {
      handle.result = await recallDurableMemory({
        scope: params.scope,
        prompt: params.prompt,
        recentMessages: params.recentMessages,
        complete: params.complete,
        limit: params.limit,
      });
      handle.status = "fulfilled";
    } catch (error) {
      handle.error = error;
      handle.status = "rejected";
    }
  })();

  return handle;
}

export function getSettledDurableRecallPrefetch(
  handle?: DurableRecallPrefetchHandle | null,
):
  | { ready: false }
  | {
      ready: true;
      status: "fulfilled" | "rejected";
      result?: DurableRecallResult | null;
      error?: unknown;
    } {
  if (!handle || handle.status === "pending") {
    return { ready: false };
  }
  if (handle.status === "rejected") {
    return {
      ready: true,
      status: "rejected",
      error: handle.error,
    };
  }
  return {
    ready: true,
    status: "fulfilled",
    result: handle.result,
  };
}
