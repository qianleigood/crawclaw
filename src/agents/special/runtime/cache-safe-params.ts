import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { CacheGovernanceDescriptor } from "../../../cache/governance-types.js";
import { resolveStateDir } from "../../../config/paths.js";
import { readJsonFile, writeJsonAtomic } from "../../../infra/json-files.js";
import type { AgentStreamParams } from "../../command/types.js";
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
  hashQueryLayerJsonValue,
  normalizeQueryLayerJsonArray,
  normalizeQueryLayerJsonRecord,
  normalizeQueryLayerToolNames,
} from "../../query-context/cache-contract.js";
import type { QueryContextModelInput } from "../../query-context/types.js";

const SPECIAL_AGENT_CACHE_SAFE_PARAMS_VERSION = 5;
const DEFAULT_CACHE_SAFE_PARAMS_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const DEFAULT_CACHE_SAFE_PARAMS_MAX_FILES = 200;
const MIN_CACHE_SAFE_PARAMS_MAX_FILES = 20;
const MAX_CACHE_SAFE_PARAMS_MAX_FILES = 5_000;

export const SPECIAL_AGENT_CACHE_SAFE_PARAMS_STORE_DESCRIPTOR: CacheGovernanceDescriptor = {
  id: "agents.special.cache-safe-params",
  module: "src/agents/special/runtime/cache-safe-params.ts",
  category: "special_agent_snapshot",
  owner: "agent-kernel/special-agent-substrate",
  key: "runId -> cache-safe snapshot JSON file",
  lifecycle:
    "Disk-backed special-agent snapshot store retained until TTL expiry, max-file pruning, explicit file deletion, or state directory reset.",
  invalidation: [
    "TTL pruning via CRAWCLAW_SPECIAL_CACHE_SAFE_PARAMS_TTL_MS",
    "Max-file pruning via CRAWCLAW_SPECIAL_CACHE_SAFE_PARAMS_MAX_FILES",
    "Snapshot file overwrite on same runId",
  ],
  observability: [
    "resolveSpecialAgentCacheSafeParamsPath(runId)",
    "getSpecialAgentCacheSafeParamsStoreConfig()",
  ],
};

export type SpecialAgentCacheSafeJsonPrimitive = string | number | boolean | null;

export type SpecialAgentCacheSafeJsonValue =
  | SpecialAgentCacheSafeJsonPrimitive
  | { [key: string]: SpecialAgentCacheSafeJsonValue }
  | SpecialAgentCacheSafeJsonValue[];

export type SpecialAgentCacheSafeStreamParams = {
  cacheRetention?: AgentStreamParams["cacheRetention"];
  skipCacheWrite?: boolean;
  promptCacheKey?: string;
  promptCacheRetention?: string;
};

export type SpecialAgentCacheSafeContext = QueryLayerCacheContext;
export type SpecialAgentCacheSafeToolInventoryDigest = QueryLayerCacheToolInventoryDigest;
export type SpecialAgentCacheSafeIdentity = QueryLayerCacheIdentity;
export type SpecialAgentCacheEnvelope = QueryLayerCacheEnvelope;

export type SpecialAgentCacheSafeParamsSnapshot = {
  version: 5;
  runId: string;
  sessionId: string;
  sessionKey?: string;
  agentId?: string;
  provider: string;
  modelId: string;
  modelApi?: string;
  capturedAt: number;
  systemPromptText: string;
  systemPromptHash: string;
  queryContextHash: string;
  promptHash: string;
  promptLength: number;
  toolNames: string[];
  userContext: SpecialAgentCacheSafeContext;
  systemContext: SpecialAgentCacheSafeContext;
  toolPromptPayload: unknown[];
  toolInventoryDigest: SpecialAgentCacheSafeToolInventoryDigest;
  thinkingConfig: SpecialAgentCacheSafeContext;
  forkContextMessages: unknown[];
  cacheIdentity: SpecialAgentCacheSafeIdentity;
  transcriptLeafId?: string | null;
  messageCount: number;
  streamParams: SpecialAgentCacheSafeStreamParams;
};

export type SpecialAgentInheritedPromptEnvelope = SpecialAgentCacheEnvelope;

type WriteSpecialAgentCacheSafeParamsSnapshotInput = {
  runId: string;
  sessionId: string;
  sessionKey?: string | null;
  agentId?: string | null;
  provider: string;
  modelId: string;
  modelApi?: string | null;
  systemPromptText: string;
  queryContextHash?: string | null;
  prompt: string;
  toolNames?: string[];
  userContext?: SpecialAgentCacheSafeContext | null;
  systemContext?: SpecialAgentCacheSafeContext | null;
  toolPromptPayload?: unknown[] | null;
  thinkingConfig?: SpecialAgentCacheSafeContext | null;
  forkContextMessages?: unknown[] | null;
  transcriptLeafId?: string | null;
  messageCount?: number;
  streamParams?: SpecialAgentCacheSafeStreamParams | null;
  capturedAt?: number;
};

function normalizeOptionalString(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function hashText(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function normalizeStreamParams(
  value: SpecialAgentCacheSafeStreamParams | null | undefined,
): SpecialAgentCacheSafeStreamParams {
  return {
    ...(value?.cacheRetention ? { cacheRetention: value.cacheRetention } : {}),
    ...(value?.skipCacheWrite === true ? { skipCacheWrite: true } : {}),
    ...(normalizeOptionalString(value?.promptCacheKey)
      ? { promptCacheKey: normalizeOptionalString(value?.promptCacheKey) }
      : {}),
    ...(normalizeOptionalString(value?.promptCacheRetention)
      ? { promptCacheRetention: normalizeOptionalString(value?.promptCacheRetention) }
      : {}),
  };
}

function resolveCacheSafeParamsTtlMs(): number {
  const raw = process.env.CRAWCLAW_SPECIAL_CACHE_SAFE_PARAMS_TTL_MS?.trim();
  if (!raw) {
    return DEFAULT_CACHE_SAFE_PARAMS_TTL_MS;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return DEFAULT_CACHE_SAFE_PARAMS_TTL_MS;
  }
  return parsed;
}

function resolveCacheSafeParamsMaxFiles(): number {
  const raw = process.env.CRAWCLAW_SPECIAL_CACHE_SAFE_PARAMS_MAX_FILES?.trim();
  if (!raw) {
    return DEFAULT_CACHE_SAFE_PARAMS_MAX_FILES;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) {
    return DEFAULT_CACHE_SAFE_PARAMS_MAX_FILES;
  }
  return Math.max(
    MIN_CACHE_SAFE_PARAMS_MAX_FILES,
    Math.min(MAX_CACHE_SAFE_PARAMS_MAX_FILES, parsed),
  );
}

export function getSpecialAgentCacheSafeParamsStoreConfig(): {
  version: number;
  ttlMs: number;
  maxFiles: number;
} {
  return {
    version: SPECIAL_AGENT_CACHE_SAFE_PARAMS_VERSION,
    ttlMs: resolveCacheSafeParamsTtlMs(),
    maxFiles: resolveCacheSafeParamsMaxFiles(),
  };
}

async function pruneSpecialAgentCacheSafeParamsSnapshots(params: {
  keepRunId: string;
}): Promise<void> {
  const keepPath = resolveSpecialAgentCacheSafeParamsPath(params.keepRunId);
  const storeDir = path.dirname(keepPath);
  let entries: Array<{
    runId: string;
    filePath: string;
    mtimeMs: number;
    size: number;
  }> = [];
  try {
    const files = await fs.readdir(storeDir, { withFileTypes: true });
    entries = await Promise.all(
      files
        .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
        .map(async (entry) => {
          const filePath = path.join(storeDir, entry.name);
          const stat = await fs.stat(filePath);
          return {
            runId: entry.name.slice(0, -".json".length),
            filePath,
            mtimeMs: stat.mtimeMs,
            size: stat.size,
          };
        }),
    );
  } catch {
    return;
  }

  const ttlMs = resolveCacheSafeParamsTtlMs();
  const maxFiles = resolveCacheSafeParamsMaxFiles();
  const now = Date.now();
  const stale = entries
    .filter((entry) => entry.runId !== params.keepRunId)
    .filter((entry) => now - entry.mtimeMs > ttlMs);

  await Promise.all(
    stale.map(async (entry) => {
      await fs.unlink(entry.filePath).catch(() => undefined);
    }),
  );

  let retained = entries.filter(
    (entry) => entry.runId === params.keepRunId || now - entry.mtimeMs <= ttlMs,
  );
  if (retained.length <= maxFiles) {
    return;
  }

  retained = retained.toSorted(
    (left, right) => left.mtimeMs - right.mtimeMs || left.size - right.size,
  );
  const deleteCandidates = retained
    .filter((entry) => entry.runId !== params.keepRunId)
    .slice(0, Math.max(0, retained.length - maxFiles));
  await Promise.all(
    deleteCandidates.map(async (entry) => {
      await fs.unlink(entry.filePath).catch(() => undefined);
    }),
  );
}

export function buildSpecialAgentCacheToolInventoryDigest(input: {
  toolNames: string[];
  toolPromptPayload: unknown[];
}): SpecialAgentCacheSafeToolInventoryDigest {
  return buildQueryLayerToolInventoryDigest({
    toolNames: input.toolNames,
    toolPromptPayload: input.toolPromptPayload,
  });
}

export function buildSpecialAgentCacheIdentity(input: {
  queryContextHash?: string | null;
  systemPromptText: string;
  toolInventoryDigest: SpecialAgentCacheSafeToolInventoryDigest;
  thinkingConfig: SpecialAgentCacheSafeContext;
  forkContextMessages: unknown[];
}): SpecialAgentCacheSafeIdentity {
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
  toolInventoryDigest: SpecialAgentCacheSafeToolInventoryDigest;
  thinkingConfig: SpecialAgentCacheSafeContext;
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
  thinkingConfig?: SpecialAgentCacheSafeContext | null;
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

export function resolveSpecialAgentCacheSafeParamsPath(runId: string): string {
  return path.join(resolveStateDir(), "agents", "special", "cache-safe-params", `${runId}.json`);
}

function normalizeSpecialAgentCacheSafeParamsSnapshot(
  value: unknown,
): SpecialAgentCacheSafeParamsSnapshot | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const record = value as Record<string, unknown>;
  const version =
    typeof record.version === "number" && Number.isFinite(record.version)
      ? Math.floor(record.version)
      : undefined;
  if (
    version !== 1 &&
    version !== 2 &&
    version !== 3 &&
    version !== 4 &&
    version !== SPECIAL_AGENT_CACHE_SAFE_PARAMS_VERSION
  ) {
    return null;
  }
  const runId = normalizeOptionalString(
    typeof record.runId === "string" ? record.runId : undefined,
  );
  const sessionId = normalizeOptionalString(
    typeof record.sessionId === "string" ? record.sessionId : undefined,
  );
  const provider = normalizeOptionalString(
    typeof record.provider === "string" ? record.provider : undefined,
  );
  const modelId = normalizeOptionalString(
    typeof record.modelId === "string" ? record.modelId : undefined,
  );
  const systemPromptText =
    typeof record.systemPromptText === "string" ? record.systemPromptText : undefined;
  const systemPromptHash =
    typeof record.systemPromptHash === "string" ? record.systemPromptHash : undefined;
  const queryContextHashRaw =
    typeof record.queryContextHash === "string" ? record.queryContextHash : undefined;
  const promptHash = typeof record.promptHash === "string" ? record.promptHash : undefined;
  const promptLength =
    typeof record.promptLength === "number" && Number.isFinite(record.promptLength)
      ? Math.max(0, Math.floor(record.promptLength))
      : undefined;
  const capturedAt =
    typeof record.capturedAt === "number" && Number.isFinite(record.capturedAt)
      ? record.capturedAt
      : undefined;
  const messageCount =
    typeof record.messageCount === "number" && Number.isFinite(record.messageCount)
      ? Math.max(0, Math.floor(record.messageCount))
      : undefined;
  if (
    !runId ||
    !sessionId ||
    !provider ||
    !modelId ||
    systemPromptText === undefined ||
    !systemPromptHash ||
    !promptHash ||
    promptLength === undefined ||
    capturedAt === undefined ||
    messageCount === undefined
  ) {
    return null;
  }
  const rawStreamParams =
    record.streamParams && typeof record.streamParams === "object"
      ? (record.streamParams as Record<string, unknown>)
      : null;
  const toolNames = Array.isArray(record.toolNames)
    ? normalizeQueryLayerToolNames(
        record.toolNames.filter((entry): entry is string => typeof entry === "string"),
      )
    : [];
  const toolPromptPayload =
    version >= 3 ? normalizeQueryLayerJsonArray(record.toolPromptPayload) : [];
  const digestRecord =
    version >= 3 && record.toolInventoryDigest && typeof record.toolInventoryDigest === "object"
      ? (record.toolInventoryDigest as Record<string, unknown>)
      : undefined;
  const userContext = version >= 2 ? normalizeQueryLayerJsonRecord(record.userContext) : {};
  const systemContext = version >= 2 ? normalizeQueryLayerJsonRecord(record.systemContext) : {};
  const toolInventoryDigest = digestRecord
    ? {
        toolCount:
          typeof digestRecord.toolCount === "number" && Number.isFinite(digestRecord.toolCount)
            ? Math.max(0, Math.floor(digestRecord.toolCount))
            : toolNames.length,
        toolNames: Array.isArray(digestRecord.toolNames)
          ? normalizeQueryLayerToolNames(
              digestRecord.toolNames.filter((entry): entry is string => typeof entry === "string"),
            )
          : toolNames,
        toolNamesHash:
          typeof digestRecord.toolNamesHash === "string"
            ? digestRecord.toolNamesHash
            : hashText(toolNames.join("\u0000")),
        toolPayloadHash:
          typeof digestRecord.toolPayloadHash === "string"
            ? digestRecord.toolPayloadHash
            : hashQueryLayerJsonValue(toolPromptPayload),
      }
    : buildSpecialAgentCacheToolInventoryDigest({ toolNames, toolPromptPayload });
  const thinkingConfig = version >= 2 ? normalizeQueryLayerJsonRecord(record.thinkingConfig) : {};
  const forkContextMessages =
    version >= 2 && Array.isArray(record.forkContextMessages)
      ? normalizeQueryLayerJsonArray(record.forkContextMessages)
      : [];
  const cacheIdentityRecord =
    version === SPECIAL_AGENT_CACHE_SAFE_PARAMS_VERSION &&
    record.cacheIdentity &&
    typeof record.cacheIdentity === "object"
      ? (record.cacheIdentity as Record<string, unknown>)
      : undefined;
  const computedCacheIdentity = buildSpecialAgentCacheIdentity({
    queryContextHash: queryContextHashRaw,
    systemPromptText,
    toolInventoryDigest,
    thinkingConfig,
    forkContextMessages,
  });
  const cacheIdentity = cacheIdentityRecord
    ? {
        queryContextHash:
          typeof cacheIdentityRecord.queryContextHash === "string"
            ? cacheIdentityRecord.queryContextHash
            : computedCacheIdentity.queryContextHash,
        forkContextMessagesHash:
          typeof cacheIdentityRecord.forkContextMessagesHash === "string"
            ? cacheIdentityRecord.forkContextMessagesHash
            : computedCacheIdentity.forkContextMessagesHash,
        envelopeHash:
          typeof cacheIdentityRecord.envelopeHash === "string"
            ? cacheIdentityRecord.envelopeHash
            : computedCacheIdentity.envelopeHash,
      }
    : computedCacheIdentity;

  return {
    version: SPECIAL_AGENT_CACHE_SAFE_PARAMS_VERSION,
    runId,
    sessionId,
    ...(normalizeOptionalString(
      typeof record.sessionKey === "string" ? record.sessionKey : undefined,
    )
      ? { sessionKey: normalizeOptionalString(record.sessionKey as string) }
      : {}),
    ...(normalizeOptionalString(typeof record.agentId === "string" ? record.agentId : undefined)
      ? { agentId: normalizeOptionalString(record.agentId as string) }
      : {}),
    provider,
    modelId,
    ...(normalizeOptionalString(typeof record.modelApi === "string" ? record.modelApi : undefined)
      ? { modelApi: normalizeOptionalString(record.modelApi as string) }
      : {}),
    capturedAt,
    systemPromptText,
    systemPromptHash,
    queryContextHash:
      normalizeOptionalString(queryContextHashRaw) ?? computedCacheIdentity.queryContextHash,
    promptHash,
    promptLength,
    toolNames,
    userContext,
    systemContext,
    toolPromptPayload,
    toolInventoryDigest,
    thinkingConfig,
    forkContextMessages,
    cacheIdentity,
    ...(normalizeOptionalString(
      typeof record.transcriptLeafId === "string" ? record.transcriptLeafId : undefined,
    ) || record.transcriptLeafId === null
      ? { transcriptLeafId: (record.transcriptLeafId as string | null | undefined) ?? null }
      : {}),
    messageCount,
    streamParams: normalizeStreamParams({
      cacheRetention:
        rawStreamParams?.cacheRetention === "short" ||
        rawStreamParams?.cacheRetention === "long" ||
        rawStreamParams?.cacheRetention === "none"
          ? rawStreamParams.cacheRetention
          : undefined,
      skipCacheWrite: rawStreamParams?.skipCacheWrite === true,
      promptCacheKey:
        typeof rawStreamParams?.promptCacheKey === "string"
          ? rawStreamParams.promptCacheKey
          : undefined,
      promptCacheRetention:
        typeof rawStreamParams?.promptCacheRetention === "string"
          ? rawStreamParams.promptCacheRetention
          : undefined,
    }),
  };
}

export async function writeSpecialAgentCacheSafeParamsSnapshot(
  input: WriteSpecialAgentCacheSafeParamsSnapshotInput,
): Promise<SpecialAgentCacheSafeParamsSnapshot> {
  const userContext = normalizeQueryLayerJsonRecord(input.userContext);
  const systemContext = normalizeQueryLayerJsonRecord(input.systemContext);
  const envelope = buildSpecialAgentCacheEnvelope({
    systemPromptText: input.systemPromptText,
    queryContextHash: input.queryContextHash,
    toolNames: input.toolNames,
    toolPromptPayload: input.toolPromptPayload,
    thinkingConfig: input.thinkingConfig,
    forkContextMessages: input.forkContextMessages,
  });
  const snapshot: SpecialAgentCacheSafeParamsSnapshot = {
    version: SPECIAL_AGENT_CACHE_SAFE_PARAMS_VERSION,
    runId: input.runId,
    sessionId: input.sessionId,
    ...(normalizeOptionalString(input.sessionKey)
      ? { sessionKey: normalizeOptionalString(input.sessionKey) }
      : {}),
    ...(normalizeOptionalString(input.agentId)
      ? { agentId: normalizeOptionalString(input.agentId) }
      : {}),
    provider: input.provider,
    modelId: input.modelId,
    ...(normalizeOptionalString(input.modelApi)
      ? { modelApi: normalizeOptionalString(input.modelApi) }
      : {}),
    capturedAt:
      typeof input.capturedAt === "number" && Number.isFinite(input.capturedAt)
        ? input.capturedAt
        : Date.now(),
    systemPromptText: input.systemPromptText,
    systemPromptHash: hashText(input.systemPromptText),
    queryContextHash: envelope.queryContextHash,
    promptHash: hashText(input.prompt),
    promptLength: input.prompt.length,
    toolNames: envelope.toolInventoryDigest.toolNames,
    userContext,
    systemContext,
    toolPromptPayload: envelope.toolPromptPayload,
    toolInventoryDigest: envelope.toolInventoryDigest,
    thinkingConfig: envelope.thinkingConfig,
    forkContextMessages: envelope.forkContextMessages,
    cacheIdentity: envelope.cacheIdentity,
    ...(normalizeOptionalString(input.transcriptLeafId) || input.transcriptLeafId === null
      ? { transcriptLeafId: input.transcriptLeafId ?? null }
      : {}),
    messageCount:
      typeof input.messageCount === "number" && Number.isFinite(input.messageCount)
        ? Math.max(0, Math.floor(input.messageCount))
        : 0,
    streamParams: normalizeStreamParams(input.streamParams),
  };
  await writeJsonAtomic(resolveSpecialAgentCacheSafeParamsPath(input.runId), snapshot, {
    trailingNewline: true,
  });
  await pruneSpecialAgentCacheSafeParamsSnapshots({ keepRunId: input.runId });
  return snapshot;
}

export async function readSpecialAgentCacheSafeParamsSnapshot(
  runId: string,
): Promise<SpecialAgentCacheSafeParamsSnapshot | null> {
  const raw = await readJsonFile<unknown>(resolveSpecialAgentCacheSafeParamsPath(runId));
  return normalizeSpecialAgentCacheSafeParamsSnapshot(raw);
}
