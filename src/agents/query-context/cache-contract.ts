import { createHash } from "node:crypto";
import type { CacheGovernanceDescriptor } from "../../cache/governance-types.js";
import type { QueryContextModelInput } from "./types.js";

export type QueryLayerCacheSafeJsonPrimitive = string | number | boolean | null;

export type QueryLayerCacheSafeJsonValue =
  | QueryLayerCacheSafeJsonPrimitive
  | { [key: string]: QueryLayerCacheSafeJsonValue }
  | QueryLayerCacheSafeJsonValue[];

export type QueryLayerCacheContext = Record<string, unknown>;

export type QueryLayerCacheToolInventoryDigest = {
  toolCount: number;
  toolNames: string[];
  toolNamesHash: string;
  toolPayloadHash: string;
};

export type QueryLayerCacheIdentity = {
  queryContextHash: string;
  forkContextMessagesHash: string;
  envelopeHash: string;
};

export type QueryLayerCacheEnvelope = {
  systemPromptText: string;
  queryContextHash: string;
  toolPromptPayload: unknown[];
  toolInventoryDigest: QueryLayerCacheToolInventoryDigest;
  thinkingConfig: QueryLayerCacheContext;
  forkContextMessages: unknown[];
  cacheIdentity: QueryLayerCacheIdentity;
};

export const QUERY_LAYER_CACHE_IDENTITY_DESCRIPTOR: CacheGovernanceDescriptor = {
  id: "agents.query-context.identity",
  module: "src/agents/query-context/cache-contract.ts",
  category: "query_prompt_identity",
  owner: "agent-kernel/query-context",
  key: "queryContextHash + forkContextMessagesHash + envelopeHash",
  lifecycle:
    "Derived per prompt envelope and recomputed whenever system prompt, tool inventory, thinking config, or fork context changes.",
  invalidation: [
    "System prompt text changes",
    "Tool prompt payload or normalized tool names change",
    "Thinking config changes",
    "Fork-context messages change",
  ],
  observability: [
    "QueryLayerCacheEnvelope.cacheIdentity",
    "QueryLayerCacheEnvelope.toolInventoryDigest",
  ],
};

function normalizeOptionalString(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function hashText(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function normalizeQueryLayerToolNames(toolNames: string[] | undefined): string[] {
  return [...new Set((toolNames ?? []).map((value) => value.trim()).filter(Boolean))].toSorted();
}

function normalizeJsonValue(value: unknown): QueryLayerCacheSafeJsonValue | undefined {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (Array.isArray(value)) {
    const normalized = value
      .map((entry) => normalizeJsonValue(entry))
      .filter((entry): entry is QueryLayerCacheSafeJsonValue => entry !== undefined);
    return normalized;
  }
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const normalized: Record<string, QueryLayerCacheSafeJsonValue> = {};
  for (const key of Object.keys(record).toSorted()) {
    const next = normalizeJsonValue(record[key]);
    if (next !== undefined) {
      normalized[key] = next;
    }
  }
  return normalized;
}

export function normalizeQueryLayerJsonRecord(value: unknown): QueryLayerCacheContext {
  const normalized = normalizeJsonValue(value);
  if (!normalized || Array.isArray(normalized) || typeof normalized !== "object") {
    return {};
  }
  return normalized as QueryLayerCacheContext;
}

export function normalizeQueryLayerJsonArray(value: unknown): unknown[] {
  const normalized = normalizeJsonValue(value);
  if (!Array.isArray(normalized)) {
    return [];
  }
  return normalized;
}

export function hashQueryLayerJsonValue(value: unknown): string {
  const normalized = normalizeJsonValue(value);
  return hashText(JSON.stringify(normalized ?? null));
}

function extractToolNameFromPayloadEntry(entry: unknown): string {
  if (!entry || typeof entry !== "object") {
    return "";
  }
  const name = (entry as { name?: unknown }).name;
  return typeof name === "string" ? name.trim() : "";
}

export function buildQueryLayerToolInventoryDigest(input: {
  toolNames: string[];
  toolPromptPayload: unknown[];
}): QueryLayerCacheToolInventoryDigest {
  const normalizedToolNames = normalizeQueryLayerToolNames(
    input.toolNames.length > 0
      ? input.toolNames
      : input.toolPromptPayload
          .map((entry) => extractToolNameFromPayloadEntry(entry))
          .filter(Boolean),
  );
  return {
    toolCount: normalizedToolNames.length,
    toolNames: normalizedToolNames,
    toolNamesHash: hashText(normalizedToolNames.join("\u0000")),
    toolPayloadHash: hashQueryLayerJsonValue(input.toolPromptPayload),
  };
}

export function buildQueryLayerCacheQueryContextHash(input: {
  systemPromptText: string;
  toolInventoryDigest: QueryLayerCacheToolInventoryDigest;
  thinkingConfig: QueryLayerCacheContext;
}): string {
  return hashQueryLayerJsonValue({
    systemPromptText: input.systemPromptText,
    toolInventoryDigest: {
      toolCount: input.toolInventoryDigest.toolCount,
      toolNamesHash: input.toolInventoryDigest.toolNamesHash,
      toolPayloadHash: input.toolInventoryDigest.toolPayloadHash,
    },
    thinkingConfig: input.thinkingConfig,
  });
}

export function buildQueryLayerCacheIdentity(input: {
  queryContextHash?: string | null;
  systemPromptText: string;
  toolInventoryDigest: QueryLayerCacheToolInventoryDigest;
  thinkingConfig: QueryLayerCacheContext;
  forkContextMessages: unknown[];
}): QueryLayerCacheIdentity {
  const queryContextHash =
    normalizeOptionalString(input.queryContextHash) ??
    buildQueryLayerCacheQueryContextHash({
      systemPromptText: input.systemPromptText,
      toolInventoryDigest: input.toolInventoryDigest,
      thinkingConfig: input.thinkingConfig,
    });
  const forkContextMessagesHash = hashQueryLayerJsonValue(input.forkContextMessages);
  return {
    queryContextHash,
    forkContextMessagesHash,
    envelopeHash: hashQueryLayerJsonValue({
      queryContextHash,
      forkContextMessagesHash,
    }),
  };
}

export function buildQueryLayerCacheToolPromptPayload(
  tools: Array<Record<string, unknown>>,
): Record<string, unknown>[] {
  return tools.map((tool) => {
    const payload: Record<string, unknown> = {};
    const name = typeof tool.name === "string" ? tool.name.trim() : "";
    if (name) {
      payload.name = name;
    }
    const description = typeof tool.description === "string" ? tool.description.trim() : "";
    if (description) {
      payload.description = description;
    }
    const type = typeof tool.type === "string" ? tool.type.trim() : "";
    if (type) {
      payload.type = type;
    }
    if (tool.parameters !== undefined) {
      payload.parameters = tool.parameters;
    }
    if (tool.inputSchema !== undefined) {
      payload.inputSchema = tool.inputSchema;
    }
    if (tool.schema !== undefined) {
      payload.schema = tool.schema;
    }
    return payload;
  });
}

export function buildQueryLayerCacheEnvelope(input: {
  systemPromptText: string;
  queryContextHash?: string | null;
  toolNames?: string[];
  toolPromptPayload?: unknown[] | null;
  thinkingConfig?: QueryLayerCacheContext | null;
  forkContextMessages?: unknown[] | null;
}): QueryLayerCacheEnvelope {
  const toolPromptPayload = normalizeQueryLayerJsonArray(input.toolPromptPayload);
  const toolInventoryDigest = buildQueryLayerToolInventoryDigest({
    toolNames: normalizeQueryLayerToolNames(input.toolNames),
    toolPromptPayload,
  });
  const thinkingConfig = normalizeQueryLayerJsonRecord(input.thinkingConfig);
  const forkContextMessages = normalizeQueryLayerJsonArray(input.forkContextMessages);
  const cacheIdentity = buildQueryLayerCacheIdentity({
    queryContextHash: input.queryContextHash,
    systemPromptText: input.systemPromptText,
    toolInventoryDigest,
    thinkingConfig,
    forkContextMessages,
  });
  return {
    systemPromptText: input.systemPromptText,
    queryContextHash: cacheIdentity.queryContextHash,
    toolPromptPayload,
    toolInventoryDigest,
    thinkingConfig,
    forkContextMessages,
    cacheIdentity,
  };
}

export function buildQueryLayerCacheEnvelopeFromModelInput(input: {
  modelInput: Pick<
    QueryContextModelInput,
    "systemPrompt" | "toolContext" | "thinkingConfig" | "queryContextHash"
  >;
  forkContextMessages?: unknown[] | null;
}): QueryLayerCacheEnvelope {
  return buildQueryLayerCacheEnvelope({
    systemPromptText: input.modelInput.systemPrompt,
    queryContextHash: input.modelInput.queryContextHash,
    toolNames: input.modelInput.toolContext.toolNames,
    toolPromptPayload: input.modelInput.toolContext.toolPromptPayload,
    thinkingConfig: input.modelInput.thinkingConfig,
    forkContextMessages: input.forkContextMessages,
  });
}
