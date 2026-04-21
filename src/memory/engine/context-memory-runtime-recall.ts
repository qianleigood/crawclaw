import { getSettledDurableRecallPrefetch } from "../durable/prefetch.ts";
import { recallDurableMemory, type DurableRecallResult } from "../durable/read.ts";
import { resolveDurableMemoryScope } from "../durable/scope.ts";
import type { CompleteFn } from "../extraction/llm.ts";
import type { RuntimeLogger } from "./context-memory-runtime-deps.ts";
import {
  getDurableRecallPrefetchHandle,
  resolveDurablePrefetchWaitMs,
  waitForDurableRecallPrefetch,
  type DurableRecallSource,
} from "./context-memory-runtime-helpers.ts";
import type { MemoryRuntimeContext } from "./types.ts";

export async function resolveDurableRecallForAssembly(params: {
  sessionId: string;
  sessionKey?: string;
  promptText: string;
  recentMessages?: string[];
  runtimeContext?: MemoryRuntimeContext;
  logger: RuntimeLogger;
  complete?: CompleteFn;
}): Promise<{
  durableRecall: DurableRecallResult | null;
  durableRecallSource: DurableRecallSource;
}> {
  const durablePrefetchHandle = getDurableRecallPrefetchHandle(params.runtimeContext);
  const durableScope = resolveDurableMemoryScope({
    sessionKey: params.sessionKey,
    agentId:
      typeof params.runtimeContext?.agentId === "string"
        ? params.runtimeContext.agentId
        : undefined,
    channel:
      typeof params.runtimeContext?.messageChannel === "string"
        ? params.runtimeContext.messageChannel
        : undefined,
    userId:
      typeof params.runtimeContext?.senderId === "string"
        ? params.runtimeContext.senderId
        : undefined,
  });
  let durableRecallSource: DurableRecallSource = durablePrefetchHandle
    ? "prefetch_pending"
    : "prefetch_missing";

  const durableRecall = await (async () => {
    if (
      durablePrefetchHandle &&
      durablePrefetchHandle.sessionId === params.sessionId &&
      durablePrefetchHandle.prompt === params.promptText
    ) {
      const settled = getSettledDurableRecallPrefetch(durablePrefetchHandle);
      if (!settled.ready) {
        const waitMs = resolveDurablePrefetchWaitMs();
        const waited = await waitForDurableRecallPrefetch({
          handle: durablePrefetchHandle,
          waitMs,
        });
        if (waited.ready) {
          if (waited.status === "rejected") {
            durableRecallSource = "prefetch_error";
            params.logger.warn(
              `[memory] durable recall prefetch skipped after wait | ${
                waited.error instanceof Error ? waited.error.message : String(waited.error)
              }`,
            );
          } else {
            durableRecallSource = "prefetch_wait_hit";
            return waited.result ?? null;
          }
        } else if (durableScope) {
          durableRecallSource = "prefetch_pending_fallback";
          try {
            return await recallDurableMemory({
              scope: durableScope,
              prompt: params.promptText,
              recentMessages: params.recentMessages,
              complete: params.complete,
              limit: 5,
            });
          } catch (error) {
            durableRecallSource = "prefetch_pending_fallback_error";
            params.logger.warn(
              `[memory] durable recall fallback failed | ${
                error instanceof Error ? error.message : String(error)
              }`,
            );
          }
        }
        return null;
      }
      if (settled.status === "rejected") {
        durableRecallSource = "prefetch_error";
        params.logger.warn(
          `[memory] durable recall prefetch skipped | ${
            settled.error instanceof Error ? settled.error.message : String(settled.error)
          }`,
        );
        return null;
      }
      durableRecallSource = "prefetch_hit";
      return settled.result ?? null;
    }
    return null;
  })();

  return {
    durableRecall,
    durableRecallSource,
  };
}
