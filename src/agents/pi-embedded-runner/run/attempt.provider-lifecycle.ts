import { randomUUID } from "node:crypto";
import type { StreamFn } from "@mariozechner/pi-agent-core";
import { streamSimple } from "@mariozechner/pi-ai";
import { deriveObservationChild } from "../../../infra/observation/context.js";
import type { ObservationContext } from "../../../infra/observation/types.js";
import { resolveProviderLifecycleDecisionCode } from "../../../shared/decision-codes.js";
import type { QueryContextProviderRequestSnapshot } from "../../query-context/types.js";
import { emitRunLoopLifecycleEvent } from "../../runtime/lifecycle/bus.js";

type ProviderLifecycleLogger = {
  warn?: (message: string, meta?: Record<string, unknown>) => void;
};

function stringifyError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function emitProviderLifecycleEvent(params: {
  phase: "provider_request_start" | "provider_request_stop" | "provider_request_error";
  runId: string;
  observation: ObservationContext;
  sessionId: string;
  sessionKey?: string;
  agentId?: string;
  parentSessionKey?: string;
  sessionFile?: string;
  isTopLevel: boolean;
  provider: string;
  modelId: string;
  modelApi?: string | null;
  transport?: string;
  requestId: string;
  snapshot: QueryContextProviderRequestSnapshot;
  messageCount?: number;
  durationMs?: number;
  error?: string;
  logger?: ProviderLifecycleLogger;
}): void {
  const decisionCode = resolveProviderLifecycleDecisionCode({
    phase: params.phase,
  });
  const observation = deriveObservationChild(params.observation, {
    source: "provider",
    spanId: `provider:${params.requestId}`,
    runtime: {
      runId: params.runId,
      sessionId: params.sessionId,
      ...(params.sessionKey ? { sessionKey: params.sessionKey } : {}),
      ...(params.agentId ? { agentId: params.agentId } : {}),
    },
    phase: params.phase,
    decisionCode,
    refs: {
      provider: params.provider,
      modelId: params.modelId,
      requestId: params.requestId,
    },
  });
  void emitRunLoopLifecycleEvent({
    phase: params.phase,
    observation,
    runId: params.runId,
    sessionId: params.sessionId,
    ...(params.sessionKey ? { sessionKey: params.sessionKey } : {}),
    ...(params.agentId ? { agentId: params.agentId } : {}),
    ...(params.parentSessionKey ? { parentSessionKey: params.parentSessionKey } : {}),
    isTopLevel: params.isTopLevel,
    ...(params.sessionFile ? { sessionFile: params.sessionFile } : {}),
    decision: {
      code: decisionCode,
      summary: `${params.provider}/${params.modelId}`,
      ...(params.error ? { details: { error: params.error } } : {}),
    },
    ...(params.error ? { error: params.error, stopReason: decisionCode } : {}),
    metrics: {
      promptChars: params.snapshot.promptChars,
      systemPromptChars: params.snapshot.systemPromptChars,
      sectionCount: params.snapshot.sectionOrder.length,
      ...(typeof params.messageCount === "number" ? { messageCount: params.messageCount } : {}),
      ...(typeof params.durationMs === "number" ? { durationMs: params.durationMs } : {}),
    },
    refs: {
      provider: params.provider,
      modelId: params.modelId,
      ...(params.modelApi ? { modelApi: params.modelApi } : {}),
      ...(params.transport ? { transport: params.transport } : {}),
      queryContextHash: params.snapshot.queryContextHash,
      requestId: params.requestId,
      isTopLevel: params.isTopLevel,
    },
    metadata: {
      ...(params.snapshot.cacheIdentity ? { cacheIdentity: params.snapshot.cacheIdentity } : {}),
      sectionTokenUsage: params.snapshot.sectionTokenUsage,
      sectionOrder: params.snapshot.sectionOrder.map((section) => ({
        id: section.id,
        role: section.role,
        sectionType: section.sectionType,
        estimatedTokens: section.estimatedTokens,
        ...(section.source ? { source: section.source } : {}),
      })),
      ...(params.transport ? { transport: params.transport } : {}),
    },
  }).catch((error) => {
    params.logger?.warn?.("provider lifecycle event emission failed", {
      phase: params.phase,
      decision: decisionCode,
      error: stringifyError(error),
      requestId: params.requestId,
    });
  });
}

function wrapProviderLifecycleStream(params: {
  stream: ReturnType<typeof streamSimple>;
  lifecycle: Omit<
    Parameters<typeof emitProviderLifecycleEvent>[0],
    "phase" | "durationMs" | "error"
  > & {
    startedAt: number;
    logger?: ProviderLifecycleLogger;
  };
}): ReturnType<typeof streamSimple> {
  let settled = false;
  const emitSettled = (
    phase: "provider_request_stop" | "provider_request_error",
    error?: unknown,
  ) => {
    if (settled) {
      return;
    }
    settled = true;
    emitProviderLifecycleEvent({
      ...params.lifecycle,
      phase,
      durationMs: Math.max(0, Date.now() - params.lifecycle.startedAt),
      ...(error ? { error: stringifyError(error) } : {}),
    });
  };

  const originalResult =
    typeof params.stream.result === "function"
      ? params.stream.result.bind(params.stream)
      : undefined;
  if (originalResult) {
    params.stream.result = async () => {
      try {
        const result = await originalResult();
        emitSettled("provider_request_stop");
        return result;
      } catch (error) {
        emitSettled("provider_request_error", error);
        throw error;
      }
    };
  }

  const originalAsyncIterator = params.stream[Symbol.asyncIterator].bind(params.stream);
  (params.stream as { [Symbol.asyncIterator]: typeof originalAsyncIterator })[
    Symbol.asyncIterator
  ] = function () {
    const iterator = originalAsyncIterator();
    return {
      async next() {
        try {
          const result = await iterator.next();
          if (result.done) {
            emitSettled("provider_request_stop");
          }
          return result;
        } catch (error) {
          emitSettled("provider_request_error", error);
          throw error;
        }
      },
      async return(value?: unknown) {
        try {
          const result = (await iterator.return?.(value)) ?? {
            done: true as const,
            value: undefined,
          };
          emitSettled("provider_request_stop");
          return result;
        } catch (error) {
          emitSettled("provider_request_error", error);
          throw error;
        }
      },
      async throw(error?: unknown) {
        emitSettled("provider_request_error", error);
        return iterator.throw?.(error) ?? Promise.reject(error);
      },
      [Symbol.asyncIterator]() {
        return this;
      },
    };
  };

  return params.stream;
}

export function wrapStreamFnWithProviderLifecycle(params: {
  streamFn: StreamFn;
  observation: ObservationContext;
  runId: string;
  sessionId: string;
  sessionKey?: string;
  agentId?: string;
  parentSessionKey?: string;
  sessionFile?: string;
  isTopLevel: boolean;
  provider: string;
  modelId: string;
  modelApi?: string | null;
  logger?: ProviderLifecycleLogger;
  getProviderRequestSnapshot: () => QueryContextProviderRequestSnapshot;
  getMessageCount?: () => number;
}): StreamFn {
  return (model, context, options) => {
    const requestId = randomUUID();
    const startedAt = Date.now();
    const snapshot = params.getProviderRequestSnapshot();
    const transport =
      options &&
      typeof options === "object" &&
      typeof (options as { transport?: unknown }).transport === "string"
        ? ((options as { transport?: string }).transport ?? undefined)
        : undefined;
    emitProviderLifecycleEvent({
      phase: "provider_request_start",
      runId: params.runId,
      observation: params.observation,
      sessionId: params.sessionId,
      ...(params.sessionKey ? { sessionKey: params.sessionKey } : {}),
      ...(params.agentId ? { agentId: params.agentId } : {}),
      ...(params.parentSessionKey ? { parentSessionKey: params.parentSessionKey } : {}),
      ...(params.sessionFile ? { sessionFile: params.sessionFile } : {}),
      isTopLevel: params.isTopLevel,
      provider: params.provider,
      modelId: params.modelId,
      modelApi: params.modelApi,
      transport,
      requestId,
      snapshot,
      ...(params.getMessageCount ? { messageCount: params.getMessageCount() } : {}),
      logger: params.logger,
    });

    const lifecycle = {
      runId: params.runId,
      observation: params.observation,
      sessionId: params.sessionId,
      ...(params.sessionKey ? { sessionKey: params.sessionKey } : {}),
      ...(params.agentId ? { agentId: params.agentId } : {}),
      ...(params.parentSessionKey ? { parentSessionKey: params.parentSessionKey } : {}),
      ...(params.sessionFile ? { sessionFile: params.sessionFile } : {}),
      isTopLevel: params.isTopLevel,
      provider: params.provider,
      modelId: params.modelId,
      modelApi: params.modelApi,
      transport,
      requestId,
      snapshot,
      ...(params.getMessageCount ? { messageCount: params.getMessageCount() } : {}),
      startedAt,
      logger: params.logger,
    } as const;

    try {
      const maybeStream = params.streamFn(model, context, options);
      if (maybeStream && typeof maybeStream === "object" && "then" in maybeStream) {
        return Promise.resolve(maybeStream).then(
          (stream) => wrapProviderLifecycleStream({ stream, lifecycle }),
          (error) => {
            emitProviderLifecycleEvent({
              ...lifecycle,
              phase: "provider_request_error",
              durationMs: Math.max(0, Date.now() - startedAt),
              error: stringifyError(error),
            });
            throw error;
          },
        );
      }
      return wrapProviderLifecycleStream({ stream: maybeStream, lifecycle });
    } catch (error) {
      emitProviderLifecycleEvent({
        ...lifecycle,
        phase: "provider_request_error",
        durationMs: Math.max(0, Date.now() - startedAt),
        error: stringifyError(error),
      });
      throw error;
    }
  };
}
