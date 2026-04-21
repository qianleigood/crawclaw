import {
  type QueryLayerCacheContext,
  type QueryLayerCacheEnvelope,
  type QueryLayerCacheIdentity,
  type QueryLayerCacheToolInventoryDigest,
  buildQueryLayerCacheEnvelope,
  buildQueryLayerCacheEnvelopeFromModelInput,
  buildQueryLayerCacheIdentity,
  buildQueryLayerCacheQueryContextHash,
  buildQueryLayerCacheToolPromptPayload,
  buildQueryLayerToolInventoryDigest,
} from "../../query-context/cache-contract.js";
import type { QueryContextModelInput } from "../../query-context/types.js";

export type SpecialAgentCacheContext = QueryLayerCacheContext;
export type SpecialAgentCacheToolInventoryDigest = QueryLayerCacheToolInventoryDigest;
export type SpecialAgentCacheIdentity = QueryLayerCacheIdentity;
export type SpecialAgentCacheEnvelope = QueryLayerCacheEnvelope;

export type SpecialAgentParentForkContext = {
  parentRunId: string;
  provider: string;
  modelId: string;
  modelApi?: string;
  promptEnvelope: SpecialAgentCacheEnvelope;
};

function normalizeOptionalString(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export function buildSpecialAgentCacheToolInventoryDigest(input: {
  toolNames: string[];
  toolPromptPayload: unknown[];
}): SpecialAgentCacheToolInventoryDigest {
  return buildQueryLayerToolInventoryDigest({
    toolNames: input.toolNames,
    toolPromptPayload: input.toolPromptPayload,
  });
}

export function buildSpecialAgentCacheIdentity(input: {
  queryContextHash?: string | null;
  systemPromptText: string;
  toolInventoryDigest: SpecialAgentCacheToolInventoryDigest;
  thinkingConfig: SpecialAgentCacheContext;
  forkContextMessages: unknown[];
}): SpecialAgentCacheIdentity {
  return buildQueryLayerCacheIdentity({
    queryContextHash: input.queryContextHash,
    systemPromptText: input.systemPromptText,
    toolInventoryDigest: input.toolInventoryDigest,
    thinkingConfig: input.thinkingConfig,
    forkContextMessages: input.forkContextMessages,
  });
}

export function buildSpecialAgentCacheQueryContextHash(input: {
  systemPromptText: string;
  toolInventoryDigest: SpecialAgentCacheToolInventoryDigest;
  thinkingConfig: SpecialAgentCacheContext;
}): string {
  return buildQueryLayerCacheQueryContextHash({
    systemPromptText: input.systemPromptText,
    toolInventoryDigest: input.toolInventoryDigest,
    thinkingConfig: input.thinkingConfig,
  });
}

export function buildSpecialAgentCacheToolPromptPayload(
  tools: Array<Record<string, unknown>>,
): Record<string, unknown>[] {
  return buildQueryLayerCacheToolPromptPayload(tools);
}

export function buildSpecialAgentCacheEnvelope(input: {
  systemPromptText: string;
  queryContextHash?: string | null;
  toolNames?: string[];
  toolPromptPayload?: unknown[] | null;
  thinkingConfig?: SpecialAgentCacheContext | null;
  forkContextMessages?: unknown[] | null;
}): SpecialAgentCacheEnvelope {
  return buildQueryLayerCacheEnvelope({
    systemPromptText: input.systemPromptText,
    queryContextHash: input.queryContextHash,
    toolNames: input.toolNames,
    toolPromptPayload: input.toolPromptPayload,
    thinkingConfig: input.thinkingConfig,
    forkContextMessages: input.forkContextMessages,
  });
}

export function resolveSpecialAgentParentForkContext(
  value: unknown,
): SpecialAgentParentForkContext | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const record = value as Partial<SpecialAgentParentForkContext>;
  const parentRunId = normalizeOptionalString(record.parentRunId);
  const provider = normalizeOptionalString(record.provider);
  const modelId = normalizeOptionalString(record.modelId);
  const promptEnvelope = record.promptEnvelope;
  if (
    !parentRunId ||
    !provider ||
    !modelId ||
    !promptEnvelope ||
    typeof promptEnvelope.systemPromptText !== "string" ||
    !promptEnvelope.systemPromptText.trim() ||
    !Array.isArray(promptEnvelope.forkContextMessages)
  ) {
    return undefined;
  }
  const modelApi = normalizeOptionalString(record.modelApi);
  return {
    parentRunId,
    provider,
    modelId,
    ...(modelApi ? { modelApi } : {}),
    promptEnvelope,
  };
}

export function buildSpecialAgentCacheEnvelopeFromModelInput(input: {
  modelInput: Pick<
    QueryContextModelInput,
    "systemPrompt" | "toolContext" | "thinkingConfig" | "queryContextHash"
  >;
  forkContextMessages?: unknown[] | null;
}): SpecialAgentCacheEnvelope {
  return buildQueryLayerCacheEnvelopeFromModelInput({
    modelInput: input.modelInput,
    forkContextMessages: input.forkContextMessages,
  });
}

export function buildSpecialAgentParentForkContextFromModelInput(input: {
  parentRunId: string;
  provider: string;
  modelId: string;
  modelApi?: string | null;
  modelInput: Pick<
    QueryContextModelInput,
    "systemPrompt" | "toolContext" | "thinkingConfig" | "queryContextHash"
  >;
  forkContextMessages?: unknown[] | null;
}): SpecialAgentParentForkContext {
  const modelApi = normalizeOptionalString(input.modelApi);
  return {
    parentRunId: input.parentRunId,
    provider: input.provider,
    modelId: input.modelId,
    ...(modelApi ? { modelApi } : {}),
    promptEnvelope: buildSpecialAgentCacheEnvelopeFromModelInput({
      modelInput: input.modelInput,
      forkContextMessages: input.forkContextMessages,
    }),
  };
}
