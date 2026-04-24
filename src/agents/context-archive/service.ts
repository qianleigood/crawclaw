import fs from "node:fs/promises";
import path from "node:path";
import { writeJsonAtomic } from "../../infra/json-files.js";
import { indexObservationEvent } from "../../infra/observation/history-index.js";
import type { ObservationContext } from "../../infra/observation/types.js";
import {
  resolveContextArchiveEventPath,
  resolveContextArchiveRunRefs,
  resolveContextArchiveRunPath,
  sha256Hex,
  resolveContextArchiveRootDir,
} from "./archive-id.js";
import { createContextArchiveBlobStore, type ContextArchiveBlobStore } from "./blob-store.js";
import type {
  ContextArchiveBlobInput,
  ContextArchiveBlobRecord,
  ContextArchiveCleanupOptions,
  ContextArchiveCleanupReport,
  ContextArchiveEventInput,
  ContextArchiveEventRecord,
  ContextArchiveReadEventsOptions,
  ContextArchiveRunInput,
  ContextArchiveInspectionRun,
  ContextArchiveInspectionSnapshot,
  ContextArchiveRunRecord,
  ContextArchiveUsageSummary,
  ContextArchiveServiceOptions,
} from "./types.js";

type RunMetadataEnvelope = {
  version: 1;
  sessionKey?: string;
  label?: string;
  metadata?: Record<string, unknown>;
};

type EventPayloadEnvelope = {
  version: 1;
  payloadBlobKey?: string;
  payloadBlobHash?: string;
  payloadContentType?: string;
  blobKeys?: string[];
  metadata?: Record<string, unknown>;
};

type ArchiveBlobUsage = {
  sha256: string;
  path: string;
  metaPath: string;
  sizeBytes: number;
  refCount: number;
};

function parseJsonObject<T>(value: string | null | undefined): T | undefined {
  if (!value?.trim()) {
    return undefined;
  }
  try {
    return JSON.parse(value) as T;
  } catch {
    return undefined;
  }
}

function normalizeMetadata(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function isObservationContext(value: unknown): value is ObservationContext {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  const trace = record.trace as Record<string, unknown> | undefined;
  const runtime = record.runtime as Record<string, unknown> | undefined;
  return (
    Boolean(trace && runtime) &&
    typeof trace?.traceId === "string" &&
    typeof trace.spanId === "string" &&
    (typeof trace.parentSpanId === "string" || trace.parentSpanId === null) &&
    typeof record.source === "string"
  );
}

function resolveArchiveObservation(params: {
  run: ContextArchiveRunRecord;
  payload?: unknown;
  metadata?: Record<string, unknown>;
}): ObservationContext | undefined {
  const payload = normalizeMetadata(params.payload);
  if (isObservationContext(payload?.observation)) {
    return payload.observation;
  }
  if (isObservationContext(params.metadata?.observation)) {
    return params.metadata.observation;
  }
  if (isObservationContext(params.run.metadata?.observation)) {
    return params.run.metadata.observation;
  }
  return undefined;
}

function normalizeOptionalString(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function serializeArchiveEventMirror(event: ContextArchiveEventRecord): string {
  const payload = { ...event };
  if ("payload" in payload) {
    delete (payload as Record<string, unknown>).payload;
  }
  return JSON.stringify({
    version: 1,
    ...payload,
  });
}

function resolveRetentionCutoffAt(now: number, retentionDays?: number | null): number | undefined {
  if (retentionDays == null) {
    return undefined;
  }
  const normalizedDays = Math.max(0, Math.floor(retentionDays));
  return now - normalizedDays * 24 * 60 * 60 * 1000;
}

function buildRunMetadataEnvelope(input: ContextArchiveRunInput): RunMetadataEnvelope | undefined {
  const envelope: RunMetadataEnvelope = {
    version: 1,
    ...(input.sessionKey?.trim() ? { sessionKey: input.sessionKey.trim() } : {}),
    ...(input.label?.trim() ? { label: input.label.trim() } : {}),
    ...(normalizeMetadata(input.metadata) ? { metadata: normalizeMetadata(input.metadata) } : {}),
  };
  return envelope.sessionKey || envelope.label || envelope.metadata ? envelope : undefined;
}

function mapRunRecord(row: {
  id: string;
  sessionId: string;
  conversationUid: string;
  runKind: ContextArchiveRunRecord["kind"];
  archiveMode: ContextArchiveRunRecord["archiveMode"];
  status: ContextArchiveRunRecord["status"];
  turnIndex: number | null;
  taskId: string | null;
  agentId: string | null;
  parentAgentId: string | null;
  summaryJson: string | null;
  metadataJson: string | null;
  createdAt: number;
  updatedAt: number;
}): ContextArchiveRunRecord {
  const meta = parseJsonObject<RunMetadataEnvelope>(row.metadataJson);
  return {
    id: row.id,
    sessionId: row.sessionId,
    conversationUid: row.conversationUid,
    kind: row.runKind,
    archiveMode: row.archiveMode,
    status: row.status,
    ...(typeof row.turnIndex === "number" ? { turnIndex: row.turnIndex } : {}),
    ...(row.taskId ? { taskId: row.taskId } : {}),
    ...(row.agentId ? { agentId: row.agentId } : {}),
    ...(row.parentAgentId ? { parentAgentId: row.parentAgentId } : {}),
    ...(meta?.sessionKey ? { sessionKey: meta.sessionKey } : {}),
    ...(meta?.label ? { label: meta.label } : {}),
    ...(meta?.metadata ? { metadata: meta.metadata } : {}),
    ...(row.summaryJson ? { summary: parseJsonObject<unknown>(row.summaryJson) } : {}),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

async function hydrateBlobPayload(
  blobStore: ContextArchiveBlobStore,
  blobHash: string,
  contentType?: string,
): Promise<unknown> {
  if (contentType?.startsWith("application/json")) {
    return await blobStore.readBlobJson(blobHash);
  }
  return await blobStore.readBlobText(blobHash);
}

export type ContextArchiveService = ReturnType<typeof createContextArchiveService>;

export function createContextArchiveService(options: ContextArchiveServiceOptions) {
  const rootDir = resolveContextArchiveRootDir({
    rootDir: options.rootDir,
    baseDir: options.baseDir,
    env: options.env,
  });
  const blobStore = createContextArchiveBlobStore({ rootDir, env: options.env });
  const retentionDays = options.retentionDays ?? null;
  const maxBlobBytes = options.maxBlobBytes ?? null;
  const maxTotalBytes = options.maxTotalBytes ?? null;
  const sequenceState = new Map<string, number>();
  let cleanupQueue: Promise<ContextArchiveCleanupReport | undefined> = Promise.resolve(undefined);

  async function persistRunMirror(run: ContextArchiveRunRecord): Promise<void> {
    const runPath = resolveContextArchiveRunPath(rootDir, run.id);
    await writeJsonAtomic(
      runPath,
      {
        version: 1,
        ...run,
      },
      { mode: 0o600 },
    );
  }

  async function appendEventMirror(event: ContextArchiveEventRecord): Promise<void> {
    const eventPath = resolveContextArchiveEventPath(rootDir, event.runId);
    await fs.mkdir(path.dirname(eventPath), { recursive: true, mode: 0o700 });
    await fs.appendFile(eventPath, `${serializeArchiveEventMirror(event)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
  }

  async function removeRunMirror(runId: string): Promise<void> {
    await Promise.all([
      fs.rm(resolveContextArchiveRunPath(rootDir, runId), { force: true }).catch(() => undefined),
      fs.rm(resolveContextArchiveEventPath(rootDir, runId), { force: true }).catch(() => undefined),
    ]);
  }

  async function createRun(input: ContextArchiveRunInput): Promise<ContextArchiveRunRecord> {
    const id = await options.runtimeStore.createContextArchiveRun({
      sessionId: input.sessionId,
      conversationUid: input.conversationUid?.trim() || input.sessionKey?.trim() || input.sessionId,
      runKind: input.kind ?? (input.taskId || input.agentId ? "task" : "session"),
      archiveMode: input.archiveMode ?? options.defaultArchiveMode ?? "replay",
      status: input.status ?? "recording",
      turnIndex: input.turnIndex ?? null,
      taskId: input.taskId ?? null,
      agentId: input.agentId ?? null,
      parentAgentId: input.parentAgentId ?? null,
      summaryJson: input.summary !== undefined ? JSON.stringify(input.summary) : null,
      metadataJson: (() => {
        const envelope = buildRunMetadataEnvelope(input);
        return envelope ? JSON.stringify(envelope) : null;
      })(),
      createdAt: input.createdAt,
      updatedAt: input.updatedAt,
    });
    const row = await options.runtimeStore.getContextArchiveRun(id);
    if (!row) {
      throw new Error(`failed to create context archive run: ${id}`);
    }
    const run = mapRunRecord(row);
    await persistRunMirror(run);
    await cleanupRetention();
    return run;
  }

  async function readRun(runId: string): Promise<ContextArchiveRunRecord | null> {
    const row = await options.runtimeStore.getContextArchiveRun(runId);
    return row ? mapRunRecord(row) : null;
  }

  async function updateRun(params: {
    runId: string;
    status: ContextArchiveRunRecord["status"];
    summary?: unknown;
    metadata?: Record<string, unknown>;
  }): Promise<ContextArchiveRunRecord | null> {
    const current = await options.runtimeStore.getContextArchiveRun(params.runId);
    if (!current) {
      return null;
    }
    const currentMeta = parseJsonObject<RunMetadataEnvelope>(current.metadataJson);
    const nextMeta: RunMetadataEnvelope = {
      version: 1,
      ...(currentMeta?.sessionKey ? { sessionKey: currentMeta.sessionKey } : {}),
      ...(currentMeta?.label ? { label: currentMeta.label } : {}),
      ...(currentMeta?.metadata || params.metadata
        ? {
            metadata: {
              ...currentMeta?.metadata,
              ...params.metadata,
            },
          }
        : {}),
    };
    await options.runtimeStore.updateContextArchiveRun({
      id: params.runId,
      status: params.status,
      summaryJson: params.summary !== undefined ? JSON.stringify(params.summary) : null,
      metadataJson:
        nextMeta.sessionKey || nextMeta.label || nextMeta.metadata
          ? JSON.stringify(nextMeta)
          : null,
    });
    const updated = await readRun(params.runId);
    if (updated) {
      await persistRunMirror(updated);
    }
    await cleanupRetention();
    return updated;
  }

  async function listRunIds(limit = 200): Promise<string[]> {
    const rows = await options.runtimeStore.listRecentContextArchiveRuns(limit);
    return rows.map((row) => row.id);
  }

  async function listAllRuns(): Promise<ContextArchiveRunRecord[]> {
    const rows = await options.runtimeStore.listAllContextArchiveRuns();
    return rows.map((row) => mapRunRecord(row));
  }

  async function listRuns(limit = 200): Promise<ContextArchiveRunRecord[]> {
    const rows = await options.runtimeStore.listRecentContextArchiveRuns(limit);
    return rows.map((row) => mapRunRecord(row));
  }

  async function findRuns(params: {
    runId?: string;
    taskId?: string;
    sessionId?: string;
    agentId?: string;
    limit?: number;
  }): Promise<ContextArchiveRunRecord[]> {
    const rows = await options.runtimeStore.listRecentContextArchiveRuns(
      params.limit ?? 200,
      params.sessionId,
    );
    const runId = params.runId?.trim();
    const taskId = params.taskId?.trim();
    const agentId = params.agentId?.trim();
    return rows
      .map((row) => mapRunRecord(row))
      .filter((run) => {
        if (runId) {
          const metadataRunId = normalizeOptionalString(
            typeof run.metadata?.runId === "string" ? run.metadata.runId : undefined,
          );
          if (run.id !== runId && metadataRunId !== runId) {
            return false;
          }
        }
        if (taskId && run.taskId !== taskId) {
          return false;
        }
        if (agentId && run.agentId !== agentId) {
          return false;
        }
        return true;
      });
  }

  async function listRunBlobs(runId: string): Promise<ContextArchiveBlobRecord[]> {
    const rows = await options.runtimeStore.listContextArchiveBlobs(runId, 10_000);
    const blobs = await Promise.all(rows.map((row) => readBlobRecord(row.runId, row.blobKey)));
    return blobs.filter((blob): blob is ContextArchiveBlobRecord => Boolean(blob));
  }

  async function collectUsage(): Promise<{
    runs: ContextArchiveRunRecord[];
    blobsByRunId: Map<string, ContextArchiveBlobRecord[]>;
    blobUsageByHash: Map<string, ArchiveBlobUsage>;
    usage: ContextArchiveUsageSummary;
  }> {
    const runs = await listAllRuns();
    const blobsByRunId = new Map<string, ContextArchiveBlobRecord[]>();
    const blobUsageByHash = new Map<string, ArchiveBlobUsage>();
    let totalBytes = 0;
    let blobCount = 0;
    let eventCount = 0;

    for (const run of runs) {
      const blobs = await listRunBlobs(run.id);
      const events = await options.runtimeStore.listContextArchiveEvents(run.id, 10_000);
      blobsByRunId.set(run.id, blobs);
      eventCount += events.length;
      for (const blob of blobs) {
        blobCount += 1;
        const usage = blobUsageByHash.get(blob.sha256);
        if (usage) {
          usage.refCount += 1;
          continue;
        }
        const nextUsage: ArchiveBlobUsage = {
          sha256: blob.sha256,
          path: blob.path,
          metaPath: blob.metaPath,
          sizeBytes: blob.sizeBytes,
          refCount: 1,
        };
        blobUsageByHash.set(blob.sha256, nextUsage);
        totalBytes += blob.sizeBytes;
      }
    }

    return {
      runs,
      blobsByRunId,
      blobUsageByHash,
      usage: {
        runCount: runs.length,
        blobCount,
        eventCount,
        totalBytes,
        ...(runs.length > 0 ? { oldestCreatedAt: runs.at(-1)?.createdAt } : {}),
        ...(runs.length > 0 ? { newestCreatedAt: runs[0]?.createdAt } : {}),
      },
    };
  }

  async function deleteRunAndReclaim(
    run: ContextArchiveRunRecord,
    context: {
      blobsByRunId: Map<string, ContextArchiveBlobRecord[]>;
      blobUsageByHash: Map<string, ArchiveBlobUsage>;
    },
    dryRun: boolean,
  ): Promise<{ reclaimedBytes: number; prunedBlobHashes: string[] }> {
    const blobs = context.blobsByRunId.get(run.id) ?? [];
    const prunedBlobHashes: string[] = [];
    let reclaimedBytes = 0;

    for (const blob of blobs) {
      const usage = context.blobUsageByHash.get(blob.sha256);
      if (!usage) {
        continue;
      }
      usage.refCount -= 1;
      if (usage.refCount > 0) {
        continue;
      }
      prunedBlobHashes.push(blob.sha256);
      reclaimedBytes += usage.sizeBytes;
      if (!dryRun) {
        await blobStore.deleteBlob(usage.sha256);
      }
    }
    if (!dryRun) {
      await options.runtimeStore.deleteContextArchiveRun(run.id);
      await removeRunMirror(run.id);
    }

    return { reclaimedBytes, prunedBlobHashes };
  }

  async function pruneRetention(
    input?: ContextArchiveCleanupOptions,
  ): Promise<ContextArchiveCleanupReport> {
    const now = input?.now ?? Date.now();
    const effectiveRetentionDays = input?.retentionDays ?? retentionDays;
    const effectiveMaxBlobBytes = input?.maxBlobBytes ?? maxBlobBytes;
    const effectiveMaxTotalBytes = input?.maxTotalBytes ?? maxTotalBytes;
    const dryRun = input?.dryRun ?? false;
    const retentionCutoffAt = resolveRetentionCutoffAt(now, effectiveRetentionDays);
    const state = await collectUsage();
    const sortedRuns = [...state.runs].toSorted(
      (left, right) =>
        left.createdAt - right.createdAt ||
        left.updatedAt - right.updatedAt ||
        left.id.localeCompare(right.id),
    );
    let totalBytes = state.usage.totalBytes;
    let prunedRunCount = 0;
    let reclaimedBytes = 0;
    const deletedRunIds: string[] = [];
    const deletedBlobHashes: string[] = [];

    for (const run of sortedRuns) {
      const ageExpired = retentionCutoffAt != null && run.createdAt <= retentionCutoffAt;
      const overBudget = effectiveMaxTotalBytes != null && totalBytes > effectiveMaxTotalBytes;
      if (!ageExpired && !overBudget) {
        continue;
      }
      prunedRunCount += 1;
      const result = await deleteRunAndReclaim(run, state, dryRun);
      reclaimedBytes += result.reclaimedBytes;
      totalBytes = Math.max(0, totalBytes - result.reclaimedBytes);
      deletedRunIds.push(run.id);
      deletedBlobHashes.push(...result.prunedBlobHashes);
    }

    return {
      checkedRunCount: state.runs.length,
      prunedRunCount,
      reclaimedBytes,
      totalBytesBefore: state.usage.totalBytes,
      totalBytesAfter: dryRun ? state.usage.totalBytes : Math.max(0, totalBytes),
      retainedRunCount: Math.max(0, state.runs.length - prunedRunCount),
      deletedRunIds,
      deletedBlobHashes: [...new Set(deletedBlobHashes)],
      ...(retentionCutoffAt != null ? { retentionCutoffAt } : {}),
      ...(effectiveMaxBlobBytes != null ? { maxBlobBytes: effectiveMaxBlobBytes } : {}),
      ...(effectiveMaxTotalBytes != null ? { maxTotalBytes: effectiveMaxTotalBytes } : {}),
      dryRun,
    };
  }

  async function cleanupRetention(): Promise<ContextArchiveCleanupReport | undefined> {
    if (retentionDays == null && maxBlobBytes == null && maxTotalBytes == null) {
      return undefined;
    }
    cleanupQueue = cleanupQueue.then(async () => await pruneRetention()).catch(() => undefined);
    return await cleanupQueue;
  }

  async function putBlob(input: ContextArchiveBlobInput): Promise<ContextArchiveBlobRecord> {
    const run = await readRun(input.runId);
    if (!run) {
      throw new Error(`unknown context archive run: ${input.runId}`);
    }
    let stored = await blobStore.putBlob({
      runId: input.runId,
      blobKey: input.blobKey,
      content: input.content,
      ...(input.blobKind ? { blobKind: input.blobKind } : {}),
      ...(input.contentType ? { contentType: input.contentType } : {}),
      ...(input.metadata ? { metadata: input.metadata } : {}),
      createdAt: input.createdAt,
    });
    if (maxBlobBytes != null && stored.sizeBytes > maxBlobBytes) {
      await blobStore.deleteBlob(stored.sha256);
      stored = await blobStore.putBlob({
        runId: input.runId,
        blobKey: input.blobKey,
        blobKind: input.blobKind,
        content: {
          omitted: true,
          reason: "max_blob_bytes_exceeded",
          originalSizeBytes: stored.sizeBytes,
          maxBlobBytes,
          contentType: input.contentType?.trim() || stored.contentType,
        },
        metadata: {
          ...input.metadata,
          archiveOmitted: true,
          originalSizeBytes: stored.sizeBytes,
        },
        createdAt: input.createdAt,
      });
    }
    const updatedAt = input.createdAt ?? Date.now();
    await options.runtimeStore.upsertContextArchiveBlob({
      runId: input.runId,
      blobKey: input.blobKey,
      blobHash: stored.sha256,
      blobKind: input.blobKind,
      storagePath: stored.path,
      contentType: stored.contentType,
      byteLength: stored.sizeBytes,
      metadataJson: input.metadata ? JSON.stringify(input.metadata) : null,
      createdAt: stored.createdAt,
      updatedAt,
    });
    const blobRecord = {
      ...stored,
      runId: input.runId,
      blobKey: input.blobKey,
      ...(input.blobKind ? { blobKind: input.blobKind } : {}),
      updatedAt,
    };
    await cleanupRetention();
    return blobRecord;
  }

  async function readBlobRecord(
    runId: string,
    blobKey: string,
  ): Promise<ContextArchiveBlobRecord | null> {
    const row = await options.runtimeStore.getContextArchiveBlob(runId, blobKey);
    if (!row) {
      return null;
    }
    const blobRecord = await blobStore.readBlobRecord(row.blobHash);
    if (!blobRecord) {
      return null;
    }
    const metadata = parseJsonObject<Record<string, unknown>>(row.metadataJson);
    return {
      ...blobRecord,
      runId: row.runId,
      blobKey: row.blobKey,
      ...(row.blobKind ? { blobKind: row.blobKind } : {}),
      contentType: row.contentType ?? blobRecord.contentType,
      sizeBytes: row.byteLength ?? blobRecord.sizeBytes,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      ...(metadata ? { metadata } : {}),
    };
  }

  async function reserveSequence(runId: string): Promise<number> {
    const current = sequenceState.get(runId);
    if (typeof current === "number") {
      const next = current + 1;
      sequenceState.set(runId, next);
      return next;
    }
    const existing = await options.runtimeStore.listContextArchiveEvents(runId, 10_000);
    const last = existing.at(-1)?.sequence ?? 0;
    const next = last + 1;
    sequenceState.set(runId, next);
    return next;
  }

  async function appendEvent(input: ContextArchiveEventInput): Promise<ContextArchiveEventRecord> {
    const run = await readRun(input.runId);
    if (!run) {
      throw new Error(`unknown context archive run: ${input.runId}`);
    }
    const sequence = await reserveSequence(input.runId);
    let payloadBlobKey: string | undefined;
    let payloadBlobHash: string | undefined;
    let payloadContentType: string | undefined;
    if (input.payload !== undefined) {
      payloadBlobKey = `event.${String(sequence)}.payload`;
      const payloadBlob = await putBlob({
        runId: input.runId,
        blobKey: payloadBlobKey,
        blobKind: "event-payload",
        content: input.payload,
        ...(input.payloadContentType ? { contentType: input.payloadContentType } : {}),
        createdAt: input.createdAt,
      });
      payloadBlobHash = payloadBlob.sha256;
      payloadContentType = payloadBlob.contentType;
    }
    const envelope: EventPayloadEnvelope = {
      version: 1,
      ...(payloadBlobKey ? { payloadBlobKey } : {}),
      ...(payloadBlobHash ? { payloadBlobHash } : {}),
      ...(payloadContentType ? { payloadContentType } : {}),
      ...(input.blobKeys?.length ? { blobKeys: [...new Set(input.blobKeys)] } : {}),
      ...(normalizeMetadata(input.metadata) ? { metadata: normalizeMetadata(input.metadata) } : {}),
    };
    const payloadJson = JSON.stringify(envelope);
    const id = await options.runtimeStore.appendContextArchiveEvent({
      runId: input.runId,
      eventKind: input.type.trim() || "event",
      sequence,
      turnIndex: input.turnIndex ?? null,
      payloadJson,
      payloadHash: payloadBlobHash ?? sha256Hex(payloadJson),
      createdAt: input.createdAt,
    });
    const event = {
      id,
      runId: input.runId,
      type: input.type.trim() || "event",
      sequence,
      ...(typeof input.turnIndex === "number" ? { turnIndex: input.turnIndex } : {}),
      ...(input.payload !== undefined ? { payload: input.payload } : {}),
      ...(payloadBlobKey ? { payloadBlobKey } : {}),
      ...(payloadBlobHash ? { payloadBlobHash } : {}),
      ...(payloadContentType ? { payloadContentType } : {}),
      blobKeys: [...new Set(input.blobKeys ?? [])],
      ...(normalizeMetadata(input.metadata) ? { metadata: normalizeMetadata(input.metadata) } : {}),
      createdAt: input.createdAt ?? Date.now(),
    };
    await appendEventMirror(event);
    const observation = resolveArchiveObservation({
      run,
      payload: input.payload,
      metadata: normalizeMetadata(input.metadata),
    });
    if (observation) {
      const payload = normalizeMetadata(input.payload);
      await indexObservationEvent({
        store: options.runtimeStore,
        eventKey: `archive:${input.runId}:${id}`,
        eventId: `archive:${id}`,
        observation,
        source: "archive",
        type: event.type,
        phase: typeof payload?.phase === "string" ? payload.phase : undefined,
        status:
          run.status === "complete" ? "archived" : run.status === "failed" ? "error" : undefined,
        summary:
          typeof payload?.phase === "string"
            ? payload.phase
            : typeof input.type === "string"
              ? input.type
              : "archive event",
        metrics:
          payload?.metrics && typeof payload.metrics === "object" && !Array.isArray(payload.metrics)
            ? (payload.metrics as Record<string, number>)
            : undefined,
        refs:
          payload?.refs && typeof payload.refs === "object" && !Array.isArray(payload.refs)
            ? (payload.refs as Record<string, unknown>)
            : undefined,
        payloadRef: {
          archiveRunId: input.runId,
          archiveEventId: id,
        },
        createdAt: event.createdAt,
      });
    }
    await cleanupRetention();
    return event;
  }

  async function readEvents(
    runId: string,
    optionsOrUndefined?: ContextArchiveReadEventsOptions,
  ): Promise<ContextArchiveEventRecord[]> {
    const rows = await options.runtimeStore.listContextArchiveEvents(
      runId,
      optionsOrUndefined?.limit ?? 200,
    );
    const events: ContextArchiveEventRecord[] = [];
    for (const row of rows) {
      const envelope = parseJsonObject<EventPayloadEnvelope>(row.payloadJson);
      let payload: unknown;
      if (optionsOrUndefined?.hydratePayload && envelope?.payloadBlobHash) {
        payload = await hydrateBlobPayload(
          blobStore,
          envelope.payloadBlobHash,
          envelope.payloadContentType,
        );
      }
      events.push({
        id: row.id,
        runId: row.runId,
        type: row.eventKind,
        sequence: row.sequence,
        ...(typeof row.turnIndex === "number" ? { turnIndex: row.turnIndex } : {}),
        ...(envelope?.payloadBlobKey ? { payloadBlobKey: envelope.payloadBlobKey } : {}),
        ...(envelope?.payloadBlobHash ? { payloadBlobHash: envelope.payloadBlobHash } : {}),
        ...(envelope?.payloadContentType
          ? { payloadContentType: envelope.payloadContentType }
          : {}),
        blobKeys: envelope?.blobKeys ?? [],
        ...(envelope?.metadata ? { metadata: envelope.metadata } : {}),
        ...(payload !== undefined ? { payload } : {}),
        createdAt: row.createdAt,
      });
    }
    return events;
  }

  async function listBlobs(runId: string, limit = 200): Promise<ContextArchiveBlobRecord[]> {
    const rows = await options.runtimeStore.listContextArchiveBlobs(runId, limit);
    const blobs = await Promise.all(rows.map((row) => readBlobRecord(row.runId, row.blobKey)));
    return blobs.filter((blob): blob is ContextArchiveBlobRecord => Boolean(blob));
  }

  async function describeRun(runId: string): Promise<ContextArchiveInspectionRun | null> {
    const run = await readRun(runId);
    if (!run) {
      return null;
    }
    const blobs = await listBlobs(runId);
    return {
      ...run,
      refs: resolveContextArchiveRunRefs({
        rootDir,
        runId,
        blobHashes: blobs.map((blob) => blob.sha256),
      }),
    };
  }

  async function inspect(params: {
    runId?: string;
    taskId?: string;
    sessionId?: string;
    agentId?: string;
    limit?: number;
  }): Promise<ContextArchiveInspectionSnapshot> {
    const runs = await findRuns(params);
    const inspectedRuns = await Promise.all(runs.map(async (run) => describeRun(run.id)));
    return {
      runs: inspectedRuns.filter((run): run is ContextArchiveInspectionRun => run != null),
    };
  }

  async function getUsage(): Promise<ContextArchiveUsageSummary> {
    const state = await collectUsage();
    return state.usage;
  }

  return {
    rootDir,
    blobDir: blobStore.blobDir,
    blobStore,
    createRun,
    readRun,
    updateRun,
    listRunIds,
    appendEvent,
    readEvents,
    putBlob,
    readBlobRecord,
    readBlobBytes: async (runId: string, blobKey: string) => {
      const record = await readBlobRecord(runId, blobKey);
      if (!record) {
        return null;
      }
      return blobStore.readBlobBytes(record.sha256);
    },
    readBlobText: async (runId: string, blobKey: string) => {
      const record = await readBlobRecord(runId, blobKey);
      if (!record) {
        return null;
      }
      return blobStore.readBlobText(record.sha256);
    },
    readBlobJson: async <T>(runId: string, blobKey: string) => {
      const record = await readBlobRecord(runId, blobKey);
      if (!record) {
        return null;
      }
      return blobStore.readBlobJson<T>(record.sha256);
    },
    listBlobs,
    listRuns,
    listAllRuns,
    findRuns,
    describeRun,
    inspect,
    getUsage,
    pruneRetention,
    cleanupRetention,
  };
}
