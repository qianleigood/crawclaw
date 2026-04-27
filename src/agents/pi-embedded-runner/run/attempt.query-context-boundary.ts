import type { AgentMessage, StreamFn } from "@mariozechner/pi-agent-core";
import type { ModelContextBudget } from "../../context-window-guard.js";
import { compileQueryContextBudget } from "../../query-context/budget.js";
import {
  buildQueryContextProviderRequest,
  materializeQueryContextProviderRequest,
} from "../../query-context/render.js";
import type {
  QueryContext,
  QueryContextModelInput,
  QueryContextProviderRequest,
  QueryContextProviderRequestSnapshot,
} from "../../query-context/types.js";

function normalizeMetadataFromOptions(options: unknown): Record<string, unknown> {
  if (!options || typeof options !== "object") {
    return {};
  }
  const metadata = (options as { metadata?: unknown }).metadata;
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return {};
  }
  return metadata as Record<string, unknown>;
}

export function wrapStreamFnWithQueryContextBoundary(params: {
  streamFn: StreamFn;
  getQueryContext: () => QueryContext;
  getModelContextBudget?: () => ModelContextBudget | undefined;
  setQueryContext: (next: QueryContext) => void;
  onProviderRequestBuilt?: (
    request: QueryContextProviderRequest,
    modelInput: QueryContextModelInput,
    snapshot: QueryContextProviderRequestSnapshot,
  ) => void;
}): StreamFn {
  return (model, context, options) => {
    const contextMessages = Array.isArray((context as { messages?: unknown }).messages)
      ? ((context as { messages: AgentMessage[] }).messages ?? [])
      : params.getQueryContext().messages;
    let nextQueryContext = {
      ...params.getQueryContext(),
      messages: contextMessages,
    };
    const budget = params.getModelContextBudget?.();
    if (budget) {
      nextQueryContext = compileQueryContextBudget({
        context: nextQueryContext,
        budget,
      }).context;
    }
    params.setQueryContext(nextQueryContext);
    const providerRequest = buildQueryContextProviderRequest(nextQueryContext);
    const modelInput = materializeQueryContextProviderRequest(providerRequest);
    params.onProviderRequestBuilt?.(providerRequest, modelInput, providerRequest.snapshot);
    const nextContext = {
      ...(context as unknown as Record<string, unknown>),
      systemPrompt: modelInput.systemPrompt,
    } as typeof context;
    const metadata = normalizeMetadataFromOptions(options);
    const nextOptions = {
      ...(options as Record<string, unknown>),
      metadata: {
        ...metadata,
        crawclawQueryContext: {
          queryContextHash: providerRequest.snapshot.queryContextHash,
          ...(providerRequest.snapshot.cacheIdentity
            ? { cacheIdentity: providerRequest.snapshot.cacheIdentity }
            : {}),
          ...(providerRequest.snapshot.decisionCodes
            ? { decisionCodes: providerRequest.snapshot.decisionCodes }
            : {}),
          promptChars: providerRequest.snapshot.promptChars,
          systemPromptChars: providerRequest.snapshot.systemPromptChars,
          sectionTokenUsage: providerRequest.snapshot.sectionTokenUsage,
          ...(providerRequest.snapshot.contextBudget
            ? { contextBudget: providerRequest.snapshot.contextBudget }
            : {}),
        },
      },
    } as typeof options;
    return params.streamFn(model, nextContext, nextOptions);
  };
}
