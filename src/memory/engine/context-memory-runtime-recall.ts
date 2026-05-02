import { recallDurableMemory, type DurableRecallResult } from "../durable/read.ts";
import { resolveDurableMemoryScope } from "../durable/scope.ts";
import type { CompleteFn } from "../extraction/llm.ts";
import type { RuntimeStore } from "../runtime/runtime-store.ts";
import type { RuntimeLogger } from "./context-memory-runtime-deps.ts";
import {
  resolveMemoryMessageChannel,
  type DurableRecallSource,
} from "./context-memory-runtime-helpers.ts";
import type { MemoryRuntimeContext } from "./types.ts";

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
    durableRecall = await recallDurableMemory({
      scope: durableScope,
      prompt: params.promptText,
      recentMessages: params.recentMessages,
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
