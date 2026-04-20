import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync, type DatabaseSyncInstance } from "@photostructure/sqlite";
import type { MessageBlock, MessageMediaRef } from "../types/media.ts";
import type {
  AppendDeadLetterInput,
  AppendMessageInput,
  AppendCompactionAuditInput,
  AppendContextAssemblyAuditInput,
  AppendContextArchiveEventInput,
  AppendRawEventInput,
  AppendRecallFeedbackInput,
  AcquireDreamLockInput,
  CompactionAudit,
  ContextAssemblyAudit,
  ContextArchiveBlobRow,
  ContextArchiveEventRow,
  ContextArchiveRunRow,
  CreatePipelineJobInput,
  CreateContextArchiveRunInput,
  DreamLockAcquireResult,
  DreamStateRow,
  CreateExtractionJobInput,
  CreateExtractionJobIfAbsentResult,
  CreateMaintenanceRunInput,
  CreatePromotionCandidateInput,
  DeadLetter,
  DurableExtractionCursorRow,
  ExtractionJob,
  ExtractionWindow,
  ExtractionWindowInput,
  KnowledgeSyncState,
  GmMessageRow,
  MaintenanceRun,
  MergeAudit,
  MergeAuditInput,
  PipelineJob,
  PromotionCandidate,
  RecallFeedback,
  RecallTrace,
  RecallTraceInput,
  SessionCompactionStateRow,
  SessionSummaryStateRow,
  UpdatePipelineJobInput,
  UpdateContextArchiveRunInput,
  UpdateExtractionJobInput,
  UpdateMaintenanceRunInput,
  UpdatePromotionCandidateInput,
  ReleaseDreamLockInput,
  TouchDreamAttemptInput,
  UpsertMediaAssetInput,
  UpsertDurableExtractionCursorInput,
  UpsertSessionScopeInput,
  UpsertKnowledgeSyncStateInput,
  UpsertContextArchiveBlobInput,
  UpsertSessionCompactionStateInput,
  UpsertSessionSummaryStateInput,
  MessageRuntimeShapeBlock,
} from "../types/runtime.ts";
import { newId } from "../util/ids.ts";
import { ensureParentDir, resolveHome } from "../util/path.ts";
import type { RuntimeStore } from "./runtime-store.ts";

type SqliteCell = string | number | boolean | bigint | null | undefined;
type SqliteRow = Record<string, SqliteCell>;

function isSqliteRow(value: unknown): value is SqliteRow {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function toSqliteRow(value: unknown): SqliteRow | null {
  return isSqliteRow(value) ? value : null;
}

function requireSqliteRow(value: unknown, label: string): SqliteRow {
  const row = toSqliteRow(value);
  if (!row) {
    throw new Error(label);
  }
  return row;
}

function toSqliteRows(value: unknown): SqliteRow[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter(isSqliteRow);
}

function sqliteNullableString(value: unknown): string | null {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return String(value);
  }
  return null;
}

function sqliteNumber(value: unknown, fallback = 0): number {
  if (typeof value === "number") {
    return value;
  }
  if (typeof value === "bigint") {
    return Number(value);
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  return fallback;
}

function sqliteNullableNumber(value: unknown): number | null {
  if (value == null) {
    return null;
  }
  const parsed = sqliteNumber(value, Number.NaN);
  return Number.isNaN(parsed) ? null : parsed;
}

const CONTEXT_ASSEMBLY_AUDIT_SESSION_SUMMARY_TOKENS_COLUMN = "session_summary_tokens";
const CONTEXT_ASSEMBLY_AUDIT_LEGACY_SESSION_MEMORY_TOKENS_COLUMN = "session_memory_tokens";
const CONTEXT_ASSEMBLY_AUDIT_SYSTEM_CONTEXT_TOKENS_COLUMN = "system_context_tokens";
const CONTEXT_ASSEMBLY_AUDIT_LEGACY_SYSTEM_PROMPT_ADDITION_TOKENS_COLUMN =
  "system_prompt_addition_tokens";

export class SqliteRuntimeStore implements RuntimeStore {
  private db: DatabaseSyncInstance | null = null;

  constructor(private readonly dbPath: string) {}

  async init(): Promise<void> {
    const resolved = resolveHome(this.dbPath);
    ensureParentDir(resolved);
    this.db = new DatabaseSync(resolved);
    this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec("PRAGMA foreign_keys = ON");
    const migrationsDir = (() => {
      const candidates = [
        join(import.meta.dirname, "migrations"),
        join(import.meta.dirname, "..", "src", "memory", "runtime", "migrations"),
        join(import.meta.dirname, "..", "src", "runtime", "migrations"),
        join(import.meta.dirname, "..", "..", "..", "src", "memory", "runtime", "migrations"),
        join(import.meta.dirname, "..", "..", "..", "src", "runtime", "migrations"),
      ];
      const found = candidates.find((candidate) => existsSync(candidate));
      if (!found) {
        throw new Error(
          `No sqlite runtime migrations directory found. Tried: ${candidates.join(", ")}`,
        );
      }
      return found;
    })();
    const migrationFiles = readdirSync(migrationsDir)
      .filter((name) => /^\d+_.*\.sql$/.test(name))
      .toSorted();
    for (const file of migrationFiles) {
      const migration = readFileSync(join(migrationsDir, file), "utf8");
      this.db.exec(migration);
    }
    this.ensureCanonicalMessageSchema();
    this.ensureAutomationMultimodalRuntimeSchema();
    this.ensureKnowledgeSyncColumns();
    this.ensureDreamStateColumns();
    this.ensureMessageRuntimeMetaColumns();
    this.ensureMessageRuntimeShapeColumns();
    this.ensureSessionCompactionStateColumns();
    this.ensureContextAssemblyAuditColumns();
    this.ensureExtractionJobColumns();
  }

  async appendMessage(input: AppendMessageInput): Promise<void> {
    const db = this.getDb();
    const id = newId("msg");
    const contentText = input.contentText ?? input.content;
    const contentBlocks = input.contentBlocks ?? [
      { type: "text", text: contentText } satisfies MessageBlock,
    ];
    const hasMedia =
      input.hasMedia ??
      Boolean(
        input.primaryMediaId ||
        input.mediaRefs?.length ||
        contentBlocks.some((block) => block.type !== "text"),
      );
    db.prepare(`INSERT INTO gm_messages
      (id, session_id, conversation_uid, role, content, content_text, content_blocks_json, runtime_meta_json, runtime_shape_json, has_media, primary_media_id, turn_index, extracted, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`).run(
      id,
      input.sessionId,
      input.conversationUid,
      input.role,
      input.content,
      contentText,
      JSON.stringify(contentBlocks),
      input.runtimeMeta ? JSON.stringify(input.runtimeMeta) : null,
      input.runtimeShape ? JSON.stringify(input.runtimeShape) : null,
      hasMedia ? 1 : 0,
      input.primaryMediaId ?? null,
      input.turnIndex,
      input.createdAt ?? Date.now(),
    );
    if (input.mediaRefs?.length) {
      const stmt =
        db.prepare(`INSERT INTO gm_message_media_refs (id, message_id, media_id, ordinal, role, created_at)
        VALUES (?, ?, ?, ?, ?, ?)`);
      const createdAt = input.createdAt ?? Date.now();
      for (const ref of input.mediaRefs) {
        stmt.run(newId("mref"), id, ref.mediaId, ref.ordinal, ref.role ?? null, createdAt);
      }
    }
  }

  async appendRawEvent(input: AppendRawEventInput): Promise<string> {
    const db = this.getDb();
    const id = newId("revent");
    db.prepare(`INSERT INTO gm_raw_events
      (id, source_type, session_id, conversation_uid, turn_index, content_text, content_blocks_json, has_media, primary_media_id, source_ref, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      id,
      input.sourceType,
      input.sessionId ?? null,
      input.conversationUid ?? null,
      input.turnIndex ?? null,
      input.contentText,
      JSON.stringify(input.contentBlocks),
      input.hasMedia ? 1 : 0,
      input.primaryMediaId ?? null,
      input.sourceRef ?? null,
      input.status ?? "pending",
      input.createdAt ?? Date.now(),
    );
    return id;
  }

  async upsertMediaAsset(input: UpsertMediaAssetInput): Promise<void> {
    const db = this.getDb();
    const createdAt = input.createdAt ?? Date.now();
    const updatedAt = input.updatedAt ?? createdAt;
    db.prepare(`INSERT INTO gm_media_assets
      (media_id, kind, source_type, original_url, local_path, vault_path, mime_type, file_name, sha256, size_bytes, width, height, alt, caption, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(media_id) DO UPDATE SET
        kind = excluded.kind,
        source_type = excluded.source_type,
        original_url = excluded.original_url,
        local_path = excluded.local_path,
        vault_path = excluded.vault_path,
        mime_type = excluded.mime_type,
        file_name = excluded.file_name,
        sha256 = excluded.sha256,
        size_bytes = excluded.size_bytes,
        width = excluded.width,
        height = excluded.height,
        alt = excluded.alt,
        caption = excluded.caption,
        status = excluded.status,
        updated_at = excluded.updated_at`).run(
      input.mediaId,
      input.kind,
      input.sourceType,
      input.originalUrl ?? null,
      input.localPath ?? null,
      input.vaultPath ?? null,
      input.mimeType ?? null,
      input.fileName ?? null,
      input.sha256 ?? null,
      input.sizeBytes ?? null,
      input.width ?? null,
      input.height ?? null,
      input.alt ?? null,
      input.caption ?? null,
      input.status ?? "active",
      createdAt,
      updatedAt,
    );
  }

  async listUnextractedMessages(sessionId: string, limit: number): Promise<GmMessageRow[]> {
    const db = this.getDb();
    const rows = db
      .prepare(`SELECT id, session_id, conversation_uid, role, content, content_text, content_blocks_json, runtime_meta_json, runtime_shape_json, has_media, primary_media_id, turn_index, extracted, created_at
      FROM gm_messages WHERE session_id = ? AND extracted = 0 ORDER BY turn_index ASC LIMIT ?`)
      .all(sessionId, limit);
    return this.mapMessageRows(rows);
  }

  async listMessagesByTurnRange(
    sessionId: string,
    startTurn: number,
    endTurn: number,
  ): Promise<GmMessageRow[]> {
    const db = this.getDb();
    const rows = db
      .prepare(`SELECT id, session_id, conversation_uid, role, content, content_text, content_blocks_json, runtime_meta_json, runtime_shape_json, has_media, primary_media_id, turn_index, extracted, created_at
      FROM gm_messages
      WHERE session_id = ? AND turn_index >= ? AND turn_index <= ?
      ORDER BY turn_index ASC`)
      .all(sessionId, startTurn, endTurn);
    return this.mapMessageRows(rows);
  }

  async listMessagesByCreatedAtRange(
    startTime: number,
    endTime: number,
    limit: number,
    sessionId?: string,
  ): Promise<GmMessageRow[]> {
    const db = this.getDb();
    const rows = sessionId
      ? db
          .prepare(`SELECT id, session_id, conversation_uid, role, content, content_text, content_blocks_json, runtime_meta_json, runtime_shape_json, has_media, primary_media_id, turn_index, extracted, created_at
          FROM gm_messages
          WHERE session_id = ? AND created_at >= ? AND created_at <= ?
          ORDER BY created_at ASC, turn_index ASC
          LIMIT ?`)
          .all(sessionId, startTime, endTime, limit)
      : db
          .prepare(`SELECT id, session_id, conversation_uid, role, content, content_text, content_blocks_json, runtime_meta_json, runtime_shape_json, has_media, primary_media_id, turn_index, extracted, created_at
          FROM gm_messages
          WHERE created_at >= ? AND created_at <= ?
          ORDER BY created_at ASC, turn_index ASC
          LIMIT ?`)
          .all(startTime, endTime, limit);
    return this.mapMessageRows(rows);
  }

  async listSessionIdsByCreatedAtRange(
    startTime: number,
    endTime: number,
    limit: number,
  ): Promise<string[]> {
    const db = this.getDb();
    const rows = db
      .prepare(`SELECT session_id, MAX(created_at) AS max_created_at
      FROM gm_messages
      WHERE created_at >= ? AND created_at <= ?
      GROUP BY session_id
      ORDER BY max_created_at DESC
      LIMIT ?`)
      .all(startTime, endTime, limit) as Array<{ session_id: string }>;
    return rows.map((row) => row.session_id).filter(Boolean);
  }

  async markMessagesExtracted(messageIds: string[]): Promise<void> {
    if (!messageIds.length) {
      return;
    }
    const db = this.getDb();
    const stmt = db.prepare("UPDATE gm_messages SET extracted = 1 WHERE id = ?");
    for (const id of messageIds) {
      stmt.run(id);
    }
  }

  async createPipelineJob(input: CreatePipelineJobInput): Promise<string> {
    const db = this.getDb();
    const id = newId("pjob");
    const now = input.createdAt ?? Date.now();
    db.prepare(`INSERT INTO gm_pipeline_jobs
      (id, job_kind, target_ref, status, payload_json, error, attempts, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      id,
      input.jobKind,
      input.targetRef ?? null,
      input.status ?? "pending",
      input.payloadJson ?? null,
      input.error ?? null,
      input.attempts ?? 0,
      now,
      input.updatedAt ?? now,
    );
    return id;
  }

  async claimPipelineJob(jobKinds?: string[]): Promise<PipelineJob | null> {
    const db = this.getDb();
    const statuses = ["pending", "retryable"];
    const row = jobKinds?.length
      ? db
          .prepare(`SELECT * FROM gm_pipeline_jobs
        WHERE status IN (${statuses.map(() => "?").join(", ")})
          AND job_kind IN (${jobKinds.map(() => "?").join(", ")})
        ORDER BY created_at ASC
        LIMIT 1`)
          .get(...statuses, ...jobKinds)
      : db
          .prepare(`SELECT * FROM gm_pipeline_jobs
        WHERE status IN ('pending', 'retryable')
        ORDER BY created_at ASC
        LIMIT 1`)
          .get();
    if (!row) {
      return null;
    }
    const rec = requireSqliteRow(row, "Invalid pipeline job row");
    const now = Date.now();
    db.prepare(
      `UPDATE gm_pipeline_jobs SET status = 'running', attempts = attempts + 1, updated_at = ? WHERE id = ?`,
    ).run(now, rec.id);
    const claimed = db.prepare(`SELECT * FROM gm_pipeline_jobs WHERE id = ?`).get(rec.id);
    return claimed ? this.mapPipelineJobRow(claimed) : null;
  }

  async updatePipelineJob(input: UpdatePipelineJobInput): Promise<void> {
    const db = this.getDb();
    db.prepare(`UPDATE gm_pipeline_jobs
      SET status = ?, payload_json = COALESCE(?, payload_json), error = ?, attempts = COALESCE(?, attempts), updated_at = ?
      WHERE id = ?`).run(
      input.status,
      input.payloadJson ?? null,
      input.error ?? null,
      input.attempts ?? null,
      input.updatedAt ?? Date.now(),
      input.id,
    );
  }

  async getPipelineJob(id: string): Promise<PipelineJob | null> {
    const db = this.getDb();
    const row = db.prepare(`SELECT * FROM gm_pipeline_jobs WHERE id = ?`).get(id);
    return row ? this.mapPipelineJobRow(row) : null;
  }

  async listRecentPipelineJobs(limit: number): Promise<PipelineJob[]> {
    const db = this.getDb();
    const rows = db
      .prepare(`SELECT * FROM gm_pipeline_jobs ORDER BY created_at DESC LIMIT ?`)
      .all(limit);
    return rows.map((row) => this.mapPipelineJobRow(row));
  }

  async appendDeadLetter(input: AppendDeadLetterInput): Promise<string> {
    const db = this.getDb();
    const id = newId("dead");
    db.prepare(`INSERT INTO gm_dead_letters
      (id, source_job_id, job_kind, payload_json, error, created_at)
      VALUES (?, ?, ?, ?, ?, ?)`).run(
      id,
      input.sourceJobId ?? null,
      input.jobKind,
      input.payloadJson ?? null,
      input.error ?? null,
      input.createdAt ?? Date.now(),
    );
    return id;
  }

  async listRecentDeadLetters(limit: number): Promise<DeadLetter[]> {
    const db = this.getDb();
    const rows = db
      .prepare(`SELECT * FROM gm_dead_letters ORDER BY created_at DESC LIMIT ?`)
      .all(limit);
    return rows.map((row) => this.mapDeadLetterRow(row));
  }

  async appendRecallFeedback(input: AppendRecallFeedbackInput): Promise<string> {
    const db = this.getDb();
    const id = newId("rfb");
    db.prepare(`INSERT INTO gm_recall_feedback
      (id, trace_id, item_id, selected, rank, used_in_answer, followup_supported, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
      id,
      input.traceId,
      input.itemId,
      input.selected ? 1 : 0,
      input.rank ?? null,
      input.usedInAnswer ? 1 : 0,
      input.followupSupported ? 1 : 0,
      input.createdAt ?? Date.now(),
    );
    return id;
  }

  async listRecallFeedbackByTrace(traceId: string, limit = 50): Promise<RecallFeedback[]> {
    const db = this.getDb();
    const rows = db
      .prepare(
        `SELECT * FROM gm_recall_feedback WHERE trace_id = ? ORDER BY created_at DESC LIMIT ?`,
      )
      .all(traceId, limit);
    return rows.map((row) => this.mapRecallFeedbackRow(row));
  }

  async appendCompactionAudit(input: AppendCompactionAuditInput): Promise<string> {
    const db = this.getDb();
    const id = newId("caudit");
    db.prepare(`INSERT INTO gm_compaction_audits
      (id, session_id, kind, trigger, reason, token_budget, current_token_count, tokens_before, tokens_after, preserved_tail_start_turn, summarized_messages, kept_messages, rewritten_entries, bytes_freed, skipped_already_compacted, skipped_short, details_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      id,
      input.sessionId,
      input.kind,
      input.trigger ?? null,
      input.reason ?? null,
      input.tokenBudget ?? null,
      input.currentTokenCount ?? null,
      input.tokensBefore ?? null,
      input.tokensAfter ?? null,
      input.preservedTailStartTurn ?? null,
      input.summarizedMessages ?? null,
      input.keptMessages ?? null,
      input.rewrittenEntries ?? null,
      input.bytesFreed ?? null,
      input.skippedAlreadyCompacted ?? null,
      input.skippedShort ?? null,
      input.detailsJson ?? null,
      input.createdAt ?? Date.now(),
    );
    return id;
  }

  async listRecentCompactionAudits(limit: number, sessionId?: string): Promise<CompactionAudit[]> {
    const db = this.getDb();
    const rows = sessionId
      ? db
          .prepare(
            `SELECT * FROM gm_compaction_audits WHERE session_id = ? ORDER BY created_at DESC LIMIT ?`,
          )
          .all(sessionId, limit)
      : db
          .prepare(`SELECT * FROM gm_compaction_audits ORDER BY created_at DESC LIMIT ?`)
          .all(limit);
    return rows.map((row) => this.mapCompactionAuditRow(row));
  }

  async appendContextAssemblyAudit(input: AppendContextAssemblyAuditInput): Promise<string> {
    const db = this.getDb();
    const id = newId("aaudit");
    db.prepare(`INSERT INTO gm_context_assembly_audits
      (id, session_id, prompt, raw_message_count, compacted_message_count, raw_message_tokens, compacted_message_tokens, ${CONTEXT_ASSEMBLY_AUDIT_SESSION_SUMMARY_TOKENS_COLUMN}, recall_tokens, ${CONTEXT_ASSEMBLY_AUDIT_SYSTEM_CONTEXT_TOKENS_COLUMN}, ${CONTEXT_ASSEMBLY_AUDIT_LEGACY_SYSTEM_PROMPT_ADDITION_TOKENS_COLUMN}, preserved_tail_start_turn, compaction_state_present, compaction_mode, details_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      id,
      input.sessionId,
      input.prompt ?? null,
      input.rawMessageCount,
      input.compactedMessageCount,
      input.rawMessageTokens,
      input.compactedMessageTokens,
      input.sessionSummaryTokens ?? null,
      input.recallTokens ?? null,
      input.systemContextTokens ?? null,
      input.systemContextTokens ?? null,
      input.preservedTailStartTurn ?? null,
      input.compactionStatePresent ? 1 : 0,
      input.compactionMode ?? null,
      input.detailsJson ?? null,
      input.createdAt ?? Date.now(),
    );
    return id;
  }

  async listRecentContextAssemblyAudits(
    limit: number,
    sessionId?: string,
  ): Promise<ContextAssemblyAudit[]> {
    const db = this.getDb();
    const rows = sessionId
      ? db
          .prepare(
            `SELECT * FROM gm_context_assembly_audits WHERE session_id = ? ORDER BY created_at DESC LIMIT ?`,
          )
          .all(sessionId, limit)
      : db
          .prepare(`SELECT * FROM gm_context_assembly_audits ORDER BY created_at DESC LIMIT ?`)
          .all(limit);
    return rows.map((row) => this.mapContextAssemblyAuditRow(row));
  }

  async createContextArchiveRun(input: CreateContextArchiveRunInput): Promise<string> {
    const db = this.getDb();
    const id = newId("carun");
    const now = input.createdAt ?? Date.now();
    db.prepare(`INSERT INTO gm_context_archive_runs
      (id, session_id, conversation_uid, run_kind, archive_mode, status, turn_index, task_id, agent_id, parent_agent_id, summary_json, metadata_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      id,
      input.sessionId,
      input.conversationUid,
      input.runKind,
      input.archiveMode ?? "replay",
      input.status ?? "pending",
      input.turnIndex ?? null,
      input.taskId ?? null,
      input.agentId ?? null,
      input.parentAgentId ?? null,
      input.summaryJson ?? null,
      input.metadataJson ?? null,
      now,
      input.updatedAt ?? now,
    );
    return id;
  }

  async updateContextArchiveRun(input: UpdateContextArchiveRunInput): Promise<void> {
    const db = this.getDb();
    db.prepare(`UPDATE gm_context_archive_runs
      SET status = ?, summary_json = COALESCE(?, summary_json), metadata_json = COALESCE(?, metadata_json), updated_at = ?
      WHERE id = ?`).run(
      input.status,
      input.summaryJson ?? null,
      input.metadataJson ?? null,
      input.updatedAt ?? Date.now(),
      input.id,
    );
  }

  async getContextArchiveRun(id: string): Promise<ContextArchiveRunRow | null> {
    const db = this.getDb();
    const row = db.prepare(`SELECT * FROM gm_context_archive_runs WHERE id = ? LIMIT 1`).get(id);
    return row ? this.mapContextArchiveRunRow(row) : null;
  }

  async listAllContextArchiveRuns(sessionId?: string): Promise<ContextArchiveRunRow[]> {
    const db = this.getDb();
    const rows = sessionId
      ? db
          .prepare(
            `SELECT * FROM gm_context_archive_runs WHERE session_id = ? ORDER BY created_at DESC`,
          )
          .all(sessionId)
      : db.prepare(`SELECT * FROM gm_context_archive_runs ORDER BY created_at DESC`).all();
    return rows.map((row) => this.mapContextArchiveRunRow(row));
  }

  async listRecentContextArchiveRuns(
    limit: number,
    sessionId?: string,
  ): Promise<ContextArchiveRunRow[]> {
    const db = this.getDb();
    const rows = sessionId
      ? db
          .prepare(
            `SELECT * FROM gm_context_archive_runs WHERE session_id = ? ORDER BY created_at DESC LIMIT ?`,
          )
          .all(sessionId, limit)
      : db
          .prepare(`SELECT * FROM gm_context_archive_runs ORDER BY created_at DESC LIMIT ?`)
          .all(limit);
    return rows.map((row) => this.mapContextArchiveRunRow(row));
  }

  async deleteContextArchiveRun(id: string): Promise<void> {
    const db = this.getDb();
    db.prepare(`DELETE FROM gm_context_archive_runs WHERE id = ?`).run(id);
  }

  async appendContextArchiveEvent(input: AppendContextArchiveEventInput): Promise<string> {
    const db = this.getDb();
    const id = newId("caevt");
    const sequence = input.sequence ?? Date.now();
    db.prepare(`INSERT INTO gm_context_archive_events
      (id, run_id, event_kind, sequence, turn_index, payload_json, payload_hash, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
      id,
      input.runId,
      input.eventKind,
      sequence,
      input.turnIndex ?? null,
      input.payloadJson,
      input.payloadHash ?? null,
      input.createdAt ?? Date.now(),
    );
    return id;
  }

  async listContextArchiveEvents(runId: string, limit = 200): Promise<ContextArchiveEventRow[]> {
    const db = this.getDb();
    const rows = db
      .prepare(
        `SELECT * FROM gm_context_archive_events WHERE run_id = ? ORDER BY sequence ASC, created_at ASC LIMIT ?`,
      )
      .all(runId, limit);
    return rows.map((row) => this.mapContextArchiveEventRow(row));
  }

  async upsertContextArchiveBlob(input: UpsertContextArchiveBlobInput): Promise<void> {
    const db = this.getDb();
    const now = input.createdAt ?? Date.now();
    db.prepare(`INSERT INTO gm_context_archive_blobs
      (id, run_id, blob_key, blob_hash, blob_kind, storage_path, content_type, byte_length, metadata_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(run_id, blob_key) DO UPDATE SET
        blob_hash = excluded.blob_hash,
        blob_kind = excluded.blob_kind,
        storage_path = excluded.storage_path,
        content_type = excluded.content_type,
        byte_length = excluded.byte_length,
        metadata_json = excluded.metadata_json,
        updated_at = excluded.updated_at`).run(
      newId("cablob"),
      input.runId,
      input.blobKey,
      input.blobHash,
      input.blobKind ?? null,
      input.storagePath ?? null,
      input.contentType ?? null,
      input.byteLength ?? null,
      input.metadataJson ?? null,
      now,
      input.updatedAt ?? now,
    );
  }

  async getContextArchiveBlob(
    runId: string,
    blobKey: string,
  ): Promise<ContextArchiveBlobRow | null> {
    const db = this.getDb();
    const row = db
      .prepare(`SELECT * FROM gm_context_archive_blobs WHERE run_id = ? AND blob_key = ? LIMIT 1`)
      .get(runId, blobKey);
    return row ? this.mapContextArchiveBlobRow(row) : null;
  }

  async listContextArchiveBlobs(runId: string, limit = 200): Promise<ContextArchiveBlobRow[]> {
    const db = this.getDb();
    const rows = db
      .prepare(
        `SELECT * FROM gm_context_archive_blobs WHERE run_id = ? ORDER BY created_at DESC LIMIT ?`,
      )
      .all(runId, limit);
    return rows.map((row) => this.mapContextArchiveBlobRow(row));
  }

  async getSessionSummaryState(sessionId: string): Promise<SessionSummaryStateRow | null> {
    const db = this.getDb();
    const row = db
      .prepare(`SELECT * FROM gm_session_summary_state WHERE session_id = ? LIMIT 1`)
      .get(sessionId);
    return row ? this.mapSessionSummaryStateRow(row) : null;
  }

  async upsertSessionSummaryState(input: UpsertSessionSummaryStateInput): Promise<void> {
    const db = this.getDb();
    db.prepare(`INSERT INTO gm_session_summary_state
      (session_id, last_summarized_message_id, last_summary_updated_at, tokens_at_last_summary, summary_in_progress, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(session_id) DO UPDATE SET
        last_summarized_message_id = excluded.last_summarized_message_id,
        last_summary_updated_at = excluded.last_summary_updated_at,
        tokens_at_last_summary = excluded.tokens_at_last_summary,
        summary_in_progress = excluded.summary_in_progress,
        updated_at = excluded.updated_at`).run(
      input.sessionId,
      input.lastSummarizedMessageId ?? null,
      input.lastSummaryUpdatedAt ?? null,
      input.tokensAtLastSummary ?? 0,
      input.summaryInProgress ? 1 : 0,
      input.updatedAt ?? Date.now(),
    );
  }

  async getDurableExtractionCursor(sessionId: string): Promise<DurableExtractionCursorRow | null> {
    const db = this.getDb();
    const row = db
      .prepare(`SELECT * FROM gm_durable_extraction_cursor WHERE session_id = ? LIMIT 1`)
      .get(sessionId);
    return row ? this.mapDurableExtractionCursorRow(row) : null;
  }

  async upsertDurableExtractionCursor(input: UpsertDurableExtractionCursorInput): Promise<void> {
    const db = this.getDb();
    db.prepare(`INSERT INTO gm_durable_extraction_cursor
      (session_id, session_key, last_extracted_turn, last_extracted_message_id, last_run_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(session_id) DO UPDATE SET
        session_key = excluded.session_key,
        last_extracted_turn = excluded.last_extracted_turn,
        last_extracted_message_id = excluded.last_extracted_message_id,
        last_run_at = excluded.last_run_at,
        updated_at = excluded.updated_at`).run(
      input.sessionId,
      input.sessionKey ?? null,
      input.lastExtractedTurn,
      input.lastExtractedMessageId ?? null,
      input.lastRunAt ?? null,
      input.updatedAt ?? Date.now(),
    );
  }

  async upsertSessionScope(input: UpsertSessionScopeInput): Promise<void> {
    const db = this.getDb();
    const now = input.updatedAt ?? Date.now();
    db.prepare(`INSERT INTO gm_session_scope
      (session_id, session_key, scope_key, agent_id, channel, user_id, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(session_id) DO UPDATE SET
        session_key = excluded.session_key,
        scope_key = excluded.scope_key,
        agent_id = excluded.agent_id,
        channel = excluded.channel,
        user_id = excluded.user_id,
        updated_at = excluded.updated_at`).run(
      input.sessionId,
      input.sessionKey ?? null,
      input.scopeKey,
      input.agentId ?? null,
      input.channel ?? null,
      input.userId ?? null,
      now,
    );
  }

  async listScopedSessionIdsTouchedSince(
    scopeKey: string,
    sinceTime: number,
    excludeSessionId?: string | null,
    limit = 100,
  ): Promise<string[]> {
    const db = this.getDb();
    const rows = excludeSessionId
      ? (db
          .prepare(`SELECT m.session_id AS session_id, MAX(m.created_at) AS max_created_at
          FROM gm_messages m
          JOIN gm_session_scope s ON s.session_id = m.session_id
          WHERE s.scope_key = ? AND m.created_at > ? AND m.session_id <> ?
          GROUP BY m.session_id
          ORDER BY max_created_at DESC
          LIMIT ?`)
          .all(scopeKey, sinceTime, excludeSessionId, limit) as Array<{ session_id: string }>)
      : (db
          .prepare(`SELECT m.session_id AS session_id, MAX(m.created_at) AS max_created_at
          FROM gm_messages m
          JOIN gm_session_scope s ON s.session_id = m.session_id
          WHERE s.scope_key = ? AND m.created_at > ?
          GROUP BY m.session_id
          ORDER BY max_created_at DESC
          LIMIT ?`)
          .all(scopeKey, sinceTime, limit) as Array<{ session_id: string }>);
    return rows.map((row) => row.session_id).filter(Boolean);
  }

  async getDreamState(scopeKey: string): Promise<DreamStateRow | null> {
    const db = this.getDb();
    const row = db
      .prepare(`SELECT * FROM gm_dream_state WHERE scope_key = ? LIMIT 1`)
      .get(scopeKey);
    return row ? this.mapDreamStateRow(row) : null;
  }

  async touchDreamAttempt(input: TouchDreamAttemptInput): Promise<void> {
    const db = this.getDb();
    const now = input.now ?? Date.now();
    db.prepare(`INSERT INTO gm_dream_state
      (scope_key, last_attempt_at, last_skip_reason, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(scope_key) DO UPDATE SET
        last_attempt_at = excluded.last_attempt_at,
        last_skip_reason = excluded.last_skip_reason,
        updated_at = excluded.updated_at`).run(input.scopeKey, now, input.reason ?? null, now);
  }

  async acquireDreamLock(input: AcquireDreamLockInput): Promise<DreamLockAcquireResult> {
    const db = this.getDb();
    const now = input.now ?? Date.now();
    db.exec("BEGIN IMMEDIATE");
    try {
      const current = db
        .prepare(`SELECT * FROM gm_dream_state WHERE scope_key = ? LIMIT 1`)
        .get(input.scopeKey);
      const currentState = current
        ? this.mapDreamStateRow(current)
        : ({
            scopeKey: input.scopeKey,
            lastSuccessAt: null,
            lastAttemptAt: null,
            lastFailureAt: null,
            lastSkipReason: null,
            lockOwner: null,
            lockAcquiredAt: null,
            lastRunId: null,
            updatedAt: now,
          } satisfies DreamStateRow);
      const lockHeld = Boolean(
        currentState.lockOwner &&
        currentState.lockAcquiredAt != null &&
        now - currentState.lockAcquiredAt < Math.max(1, input.staleAfterMs),
      );
      if (lockHeld && currentState.lockOwner !== input.owner) {
        db.prepare(`INSERT INTO gm_dream_state
          (scope_key, last_success_at, last_attempt_at, last_failure_at, last_skip_reason, lock_owner, lock_acquired_at, last_run_id, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(scope_key) DO UPDATE SET
            last_attempt_at = excluded.last_attempt_at,
            last_skip_reason = excluded.last_skip_reason,
            updated_at = excluded.updated_at`).run(
          input.scopeKey,
          currentState.lastSuccessAt,
          now,
          currentState.lastFailureAt,
          "lock_held",
          currentState.lockOwner,
          currentState.lockAcquiredAt,
          currentState.lastRunId,
          now,
        );
        db.exec("COMMIT");
        return {
          acquired: false,
          state: {
            ...currentState,
            lastAttemptAt: now,
            lastSkipReason: "lock_held",
            updatedAt: now,
          },
        };
      }
      db.prepare(`INSERT INTO gm_dream_state
        (scope_key, last_success_at, last_attempt_at, last_failure_at, last_skip_reason, lock_owner, lock_acquired_at, last_run_id, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(scope_key) DO UPDATE SET
          last_attempt_at = excluded.last_attempt_at,
          last_skip_reason = excluded.last_skip_reason,
          lock_owner = excluded.lock_owner,
          lock_acquired_at = excluded.lock_acquired_at,
          updated_at = excluded.updated_at`).run(
        input.scopeKey,
        currentState.lastSuccessAt,
        now,
        currentState.lastFailureAt,
        null,
        input.owner,
        now,
        currentState.lastRunId,
        now,
      );
      const next = db
        .prepare(`SELECT * FROM gm_dream_state WHERE scope_key = ? LIMIT 1`)
        .get(input.scopeKey);
      db.exec("COMMIT");
      return {
        acquired: true,
        state: this.mapDreamStateRow(next),
      };
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }

  async releaseDreamLock(input: ReleaseDreamLockInput): Promise<void> {
    const db = this.getDb();
    const now = input.now ?? Date.now();
    db.prepare(`UPDATE gm_dream_state
      SET last_success_at = CASE WHEN ? = 'succeeded' THEN ? ELSE last_success_at END,
          last_failure_at = CASE WHEN ? = 'failed' THEN ? ELSE last_failure_at END,
          last_skip_reason = NULL,
          lock_owner = NULL,
          lock_acquired_at = NULL,
          last_run_id = COALESCE(?, last_run_id),
          updated_at = ?
      WHERE scope_key = ? AND (lock_owner IS NULL OR lock_owner = ?)`).run(
      input.status,
      now,
      input.status,
      now,
      input.runId ?? null,
      now,
      input.scopeKey,
      input.owner,
    );
  }

  async listModelVisibleMessagesForDurableExtraction(
    sessionId: string,
    afterTurnExclusive: number,
    upToTurnInclusive: number,
    limit: number,
  ): Promise<GmMessageRow[]> {
    const db = this.getDb();
    const rows = db
      .prepare(`SELECT id, session_id, conversation_uid, role, content, content_text, content_blocks_json, runtime_meta_json, runtime_shape_json, has_media, primary_media_id, turn_index, extracted, created_at
      FROM (
        SELECT id, session_id, conversation_uid, role, content, content_text, content_blocks_json, runtime_meta_json, runtime_shape_json, has_media, primary_media_id, turn_index, extracted, created_at
        FROM gm_messages
        WHERE session_id = ?
          AND role IN ('user', 'assistant', 'toolResult')
          AND turn_index > ?
          AND turn_index <= ?
        ORDER BY turn_index DESC
        LIMIT ?
      ) recent
      ORDER BY turn_index ASC`)
      .all(
        sessionId,
        Math.max(0, afterTurnExclusive),
        Math.max(0, upToTurnInclusive),
        Math.max(1, limit),
      );
    return this.mapMessageRows(rows);
  }

  async getSessionCompactionState(sessionId: string): Promise<SessionCompactionStateRow | null> {
    const db = this.getDb();
    const row = db
      .prepare(`SELECT * FROM gm_session_compaction_state WHERE session_id = ? LIMIT 1`)
      .get(sessionId);
    return row ? this.mapSessionCompactionStateRow(row) : null;
  }

  async upsertSessionCompactionState(input: UpsertSessionCompactionStateInput): Promise<void> {
    const db = this.getDb();
    db.prepare(`INSERT INTO gm_session_compaction_state
      (session_id, preserved_tail_start_turn, preserved_tail_message_id, summarized_through_message_id, mode, summary_override_text, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(session_id) DO UPDATE SET
        preserved_tail_start_turn = excluded.preserved_tail_start_turn,
        preserved_tail_message_id = excluded.preserved_tail_message_id,
        summarized_through_message_id = excluded.summarized_through_message_id,
        mode = excluded.mode,
        summary_override_text = excluded.summary_override_text,
        updated_at = excluded.updated_at`).run(
      input.sessionId,
      input.preservedTailStartTurn,
      input.preservedTailMessageId ?? null,
      input.summarizedThroughMessageId ?? null,
      input.mode ?? null,
      input.summaryOverrideText ?? null,
      input.updatedAt ?? Date.now(),
    );
  }

  async clearSessionCompactionState(sessionId: string): Promise<void> {
    const db = this.getDb();
    db.prepare(`DELETE FROM gm_session_compaction_state WHERE session_id = ?`).run(sessionId);
  }

  async createExtractionJob(input: CreateExtractionJobInput): Promise<string> {
    const db = this.getDb();
    const id = newId("job");
    const now = Date.now();
    db.prepare(`INSERT INTO gm_extraction_jobs
      (id, session_id, conversation_uid, start_turn, end_turn, window_hash, trigger_reason, stage, status, attempts, error, heartbeat_at, claimed_at, finished_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'queued', 'pending', 0, NULL, NULL, NULL, NULL, ?, ?)`).run(
      id,
      input.sessionId,
      input.conversationUid,
      input.startTurn,
      input.endTurn,
      input.windowHash ?? null,
      input.triggerReason ?? null,
      now,
      now,
    );
    return id;
  }

  async createExtractionJobIfAbsent(
    input: CreateExtractionJobInput,
  ): Promise<CreateExtractionJobIfAbsentResult> {
    const db = this.getDb();
    if (!input.windowHash) {
      return { jobId: await this.createExtractionJob(input), created: true };
    }
    const now = Date.now();
    const existing = db
      .prepare(`SELECT * FROM gm_extraction_jobs
      WHERE session_id = ? AND window_hash = ? AND status IN ('pending', 'running', 'done')
      ORDER BY created_at DESC
      LIMIT 1`)
      .get(input.sessionId, input.windowHash);
    if (existing) {
      const rec = requireSqliteRow(existing, "Invalid extraction job row");
      return {
        jobId: String(rec.id),
        created: false,
        existingStatus: String(
          rec.status ?? "pending",
        ) as CreateExtractionJobIfAbsentResult["existingStatus"],
      };
    }

    const id = newId("job");
    const result = db
      .prepare(`INSERT INTO gm_extraction_jobs
      (id, session_id, conversation_uid, start_turn, end_turn, window_hash, trigger_reason, stage, status, attempts, error, heartbeat_at, claimed_at, finished_at, created_at, updated_at)
      SELECT ?, ?, ?, ?, ?, ?, ?, 'queued', 'pending', 0, NULL, NULL, NULL, NULL, ?, ?
      WHERE NOT EXISTS (
        SELECT 1 FROM gm_extraction_jobs
        WHERE session_id = ? AND window_hash = ? AND status IN ('pending', 'running', 'done')
      )`)
      .run(
        id,
        input.sessionId,
        input.conversationUid,
        input.startTurn,
        input.endTurn,
        input.windowHash,
        input.triggerReason ?? null,
        now,
        now,
        input.sessionId,
        input.windowHash,
      ) as { changes?: number };

    if (result.changes) {
      return { jobId: id, created: true };
    }

    const claimed = db
      .prepare(`SELECT * FROM gm_extraction_jobs
      WHERE session_id = ? AND window_hash = ? AND status IN ('pending', 'running', 'done')
      ORDER BY created_at DESC
      LIMIT 1`)
      .get(input.sessionId, input.windowHash);
    if (!claimed) {
      return { jobId: id, created: true };
    }
    const claimedRow = requireSqliteRow(claimed, "Invalid extraction job row");
    return {
      jobId: String(claimedRow.id),
      created: false,
      existingStatus: String(
        claimedRow.status ?? "pending",
      ) as CreateExtractionJobIfAbsentResult["existingStatus"],
    };
  }

  async claimExtractionJob(): Promise<ExtractionJob | null> {
    const db = this.getDb();
    const row = db
      .prepare(
        `SELECT * FROM gm_extraction_jobs WHERE status = 'pending' ORDER BY created_at ASC LIMIT 1`,
      )
      .get();
    if (!row) {
      return null;
    }
    return this.claimPendingJobRow(row);
  }

  async claimExtractionJobById(jobId: string): Promise<ExtractionJob | null> {
    const db = this.getDb();
    const row = db
      .prepare(`SELECT * FROM gm_extraction_jobs WHERE id = ? AND status = 'pending' LIMIT 1`)
      .get(jobId);
    if (!row) {
      return null;
    }
    return this.claimPendingJobRow(row);
  }

  async findExtractionJobByWindow(
    sessionId: string,
    windowHash: string,
    statuses?: ExtractionJob["status"][],
  ): Promise<ExtractionJob | null> {
    const db = this.getDb();
    const effectiveStatuses = statuses?.length ? statuses : ["pending", "running", "done"];
    const placeholders = effectiveStatuses.map(() => "?").join(", ");
    const row = db
      .prepare(`SELECT * FROM gm_extraction_jobs
      WHERE session_id = ? AND window_hash = ? AND status IN (${placeholders})
      ORDER BY created_at DESC
      LIMIT 1`)
      .get(sessionId, windowHash, ...effectiveStatuses);
    return row ? this.mapJobRow(row) : null;
  }

  async updateExtractionJob(input: UpdateExtractionJobInput): Promise<void> {
    const db = this.getDb();
    db.prepare(`UPDATE gm_extraction_jobs
      SET status = ?,
          error = ?,
          stage = COALESCE(?, stage),
          heartbeat_at = COALESCE(?, heartbeat_at),
          claimed_at = COALESCE(?, claimed_at),
          finished_at = COALESCE(?, finished_at),
          updated_at = ?
      WHERE id = ?`).run(
      input.status,
      input.error ?? null,
      input.stage ?? null,
      input.heartbeatAt ?? null,
      input.claimedAt ?? null,
      input.finishedAt ?? null,
      Date.now(),
      input.id,
    );
  }

  async createMaintenanceRun(input: CreateMaintenanceRunInput): Promise<string> {
    const db = this.getDb();
    const id = newId("maint");
    const now = Date.now();
    db.prepare(`INSERT INTO gm_maintenance_runs
      (id, kind, status, scope, trigger_source, summary, metrics_json, error, created_at, updated_at, finished_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      id,
      input.kind,
      input.status ?? "pending",
      input.scope ?? null,
      input.triggerSource ?? null,
      input.summary ?? null,
      input.metricsJson ?? null,
      input.error ?? null,
      now,
      now,
      input.finishedAt ?? null,
    );
    return id;
  }

  async updateMaintenanceRun(input: UpdateMaintenanceRunInput): Promise<void> {
    const db = this.getDb();
    db.prepare(`UPDATE gm_maintenance_runs
      SET status = ?, summary = ?, metrics_json = ?, error = ?, updated_at = ?, finished_at = ?
      WHERE id = ?`).run(
      input.status,
      input.summary ?? null,
      input.metricsJson ?? null,
      input.error ?? null,
      Date.now(),
      input.finishedAt ?? null,
      input.id,
    );
  }

  async appendMergeAudit(input: MergeAuditInput): Promise<string> {
    const db = this.getDb();
    const id = newId("merge");
    const now = Date.now();
    db.prepare(`INSERT INTO gm_merge_audits
      (id, run_id, canonical_node_id, merged_node_ids_json, score, reason, mode, before_snapshot_json, after_snapshot_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      id,
      input.runId ?? null,
      input.canonicalNodeId,
      input.mergedNodeIdsJson,
      input.score ?? null,
      input.reason ?? null,
      input.mode,
      input.beforeSnapshotJson ?? null,
      input.afterSnapshotJson ?? null,
      now,
    );
    return id;
  }

  async appendRecallTrace(input: RecallTraceInput): Promise<string> {
    const db = this.getDb();
    const id = newId("trace");
    const now = Date.now();
    db.prepare(`INSERT INTO gm_recall_traces
      (id, query, query_hash, mode, memory_layer, trace_json, top_results_json, source, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      id,
      input.query,
      input.queryHash,
      input.mode,
      input.memoryLayer,
      input.traceJson,
      input.topResultsJson ?? null,
      input.source ?? null,
      now,
    );
    return id;
  }

  async appendExtractionWindow(input: ExtractionWindowInput): Promise<string> {
    const db = this.getDb();
    const id = newId("window");
    const now = Date.now();
    db.prepare(`INSERT INTO gm_extraction_windows
      (id, session_id, start_turn, end_turn, window_hash, decision, reason, message_count, char_count, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      id,
      input.sessionId,
      input.startTurn,
      input.endTurn,
      input.windowHash,
      input.decision,
      input.reason,
      input.messageCount,
      input.charCount,
      now,
    );
    return id;
  }

  async createPromotionCandidate(input: CreatePromotionCandidateInput): Promise<string> {
    const db = this.getDb();
    const id = newId("pcand");
    const createdAt = input.createdAt ?? Date.now();
    const updatedAt = input.updatedAt ?? createdAt;
    db.prepare(`INSERT INTO gm_promotion_candidates
      (id, session_id, source_type, source_refs_json, candidate_json, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
      id,
      input.sessionId,
      input.sourceType,
      input.sourceRefsJson,
      input.candidateJson,
      input.status ?? "pending",
      createdAt,
      updatedAt,
    );
    return id;
  }

  async updatePromotionCandidate(input: UpdatePromotionCandidateInput): Promise<void> {
    const db = this.getDb();
    const assignments = ["status = ?", "updated_at = ?"];
    const values: Array<string | number> = [input.status, input.updatedAt ?? Date.now()];

    if (input.sourceRefsJson !== undefined) {
      assignments.push("source_refs_json = ?");
      values.push(input.sourceRefsJson);
    }
    if (input.candidateJson !== undefined) {
      assignments.push("candidate_json = ?");
      values.push(input.candidateJson);
    }

    values.push(input.id);
    db.prepare(`UPDATE gm_promotion_candidates SET ${assignments.join(", ")} WHERE id = ?`).run(
      ...values,
    );
  }

  async getPromotionCandidate(id: string): Promise<PromotionCandidate | null> {
    const db = this.getDb();
    const row = db.prepare(`SELECT * FROM gm_promotion_candidates WHERE id = ? LIMIT 1`).get(id);
    return row ? this.mapPromotionCandidateRow(row) : null;
  }

  async listRecentPromotionCandidates(limit: number): Promise<PromotionCandidate[]> {
    const db = this.getDb();
    const rows = db
      .prepare(`SELECT * FROM gm_promotion_candidates ORDER BY created_at DESC LIMIT ?`)
      .all(limit);
    return rows.map((row) => this.mapPromotionCandidateRow(row));
  }

  async upsertKnowledgeSyncState(input: UpsertKnowledgeSyncStateInput): Promise<void> {
    const db = this.getDb();
    db.prepare(`INSERT INTO gm_knowledge_sync_state
      (id, note_path, note_id, content_hash, indexed_at, last_error, sync_json, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(note_path) DO UPDATE SET
        note_id = excluded.note_id,
        content_hash = excluded.content_hash,
        indexed_at = excluded.indexed_at,
        last_error = excluded.last_error,
        sync_json = excluded.sync_json,
        status = excluded.status`).run(
      newId("osync"),
      input.notePath,
      input.noteId ?? null,
      input.contentHash ?? null,
      input.indexedAt ?? Date.now(),
      input.lastError ?? null,
      input.syncJson ?? null,
      input.status,
    );
  }

  async listRecentKnowledgeSyncStates(limit: number): Promise<KnowledgeSyncState[]> {
    const db = this.getDb();
    const rows = db
      .prepare(`SELECT * FROM gm_knowledge_sync_state ORDER BY indexed_at DESC LIMIT ?`)
      .all(limit);
    return rows.map((row) => this.mapKnowledgeSyncStateRow(row));
  }

  async listRecentMaintenanceRuns(limit: number): Promise<MaintenanceRun[]> {
    const db = this.getDb();
    const rows = db
      .prepare(`SELECT * FROM gm_maintenance_runs ORDER BY created_at DESC LIMIT ?`)
      .all(limit);
    return rows.map((row) => {
      const rec = requireSqliteRow(row, "Invalid maintenance run row");
      return {
        id: String(rec.id ?? ""),
        kind: String(rec.kind ?? ""),
        status: String(rec.status ?? "") as MaintenanceRun["status"],
        scope: sqliteNullableString(rec.scope),
        triggerSource: sqliteNullableString(rec.trigger_source),
        summary: sqliteNullableString(rec.summary),
        metricsJson: sqliteNullableString(rec.metrics_json),
        error: sqliteNullableString(rec.error),
        createdAt: sqliteNumber(rec.created_at),
        updatedAt: sqliteNumber(rec.updated_at),
        finishedAt: sqliteNullableString(rec.finished_at) ? sqliteNumber(rec.finished_at) : null,
      };
    });
  }

  private mapDreamStateRow(row: unknown): DreamStateRow {
    const rec = requireSqliteRow(row, "Invalid dream state row");
    return {
      scopeKey: String(rec.scope_key ?? ""),
      lastSuccessAt: sqliteNullableString(rec.last_success_at)
        ? sqliteNumber(rec.last_success_at)
        : null,
      lastAttemptAt: sqliteNullableString(rec.last_attempt_at)
        ? sqliteNumber(rec.last_attempt_at)
        : null,
      lastFailureAt: sqliteNullableString(rec.last_failure_at)
        ? sqliteNumber(rec.last_failure_at)
        : null,
      lastSkipReason: sqliteNullableString(rec.last_skip_reason),
      lockOwner: sqliteNullableString(rec.lock_owner),
      lockAcquiredAt: sqliteNullableString(rec.lock_acquired_at)
        ? sqliteNumber(rec.lock_acquired_at)
        : null,
      lastRunId: sqliteNullableString(rec.last_run_id),
      updatedAt: sqliteNumber(rec.updated_at),
    };
  }

  async listRecentMergeAudits(limit: number): Promise<MergeAudit[]> {
    const db = this.getDb();
    const rows = db
      .prepare(`SELECT * FROM gm_merge_audits ORDER BY created_at DESC LIMIT ?`)
      .all(limit);
    return rows.map((row) => {
      const rec = requireSqliteRow(row, "Invalid merge audit row");
      return {
        id: String(rec.id ?? ""),
        runId: sqliteNullableString(rec.run_id),
        canonicalNodeId: String(rec.canonical_node_id ?? ""),
        mergedNodeIdsJson: String(rec.merged_node_ids_json ?? ""),
        score: sqliteNullableString(rec.score) ? sqliteNumber(rec.score) : null,
        reason: sqliteNullableString(rec.reason),
        mode: String(rec.mode ?? "") as MergeAudit["mode"],
        beforeSnapshotJson: sqliteNullableString(rec.before_snapshot_json),
        afterSnapshotJson: sqliteNullableString(rec.after_snapshot_json),
        createdAt: sqliteNumber(rec.created_at),
      };
    });
  }

  async listRecentRecallTraces(limit: number): Promise<RecallTrace[]> {
    const db = this.getDb();
    const rows = db
      .prepare(`SELECT * FROM gm_recall_traces ORDER BY created_at DESC LIMIT ?`)
      .all(limit);
    return rows.map((row) => {
      const rec = requireSqliteRow(row, "Invalid recall trace row");
      return {
        id: String(rec.id ?? ""),
        query: String(rec.query ?? ""),
        queryHash: String(rec.query_hash ?? ""),
        mode: String(rec.mode ?? ""),
        memoryLayer: String(rec.memory_layer ?? ""),
        traceJson: String(rec.trace_json ?? ""),
        topResultsJson: sqliteNullableString(rec.top_results_json),
        source: sqliteNullableString(rec.source),
        createdAt: sqliteNumber(rec.created_at),
      };
    });
  }

  async listRecentExtractionJobs(limit: number): Promise<ExtractionJob[]> {
    const db = this.getDb();
    const rows = db
      .prepare(`SELECT * FROM gm_extraction_jobs ORDER BY created_at DESC LIMIT ?`)
      .all(limit);
    return rows.map((row) => this.mapJobRow(row));
  }

  async listRecentExtractionWindows(limit: number): Promise<ExtractionWindow[]> {
    const db = this.getDb();
    const rows = db
      .prepare(`SELECT * FROM gm_extraction_windows ORDER BY created_at DESC LIMIT ?`)
      .all(limit);
    return rows.map((row) => {
      const rec = requireSqliteRow(row, "Invalid extraction window row");
      return {
        id: String(rec.id ?? ""),
        sessionId: String(rec.session_id ?? ""),
        startTurn: sqliteNumber(rec.start_turn),
        endTurn: sqliteNumber(rec.end_turn),
        windowHash: String(rec.window_hash ?? ""),
        decision: rec.decision === "skip" ? "skip" : "run",
        reason: sqliteNullableString(rec.reason) ?? "",
        messageCount: sqliteNumber(rec.message_count),
        charCount: sqliteNumber(rec.char_count),
        createdAt: sqliteNumber(rec.created_at),
      };
    });
  }

  async close(): Promise<void> {
    this.db?.close();
    this.db = null;
  }

  private getDb(): DatabaseSyncInstance {
    if (!this.db) {
      throw new Error("RuntimeStore not initialized");
    }
    return this.db;
  }

  private ensureKnowledgeSyncColumns() {
    this.ensureColumn("gm_knowledge_sync_state", "sync_json", "TEXT");
  }

  private ensureDreamStateColumns() {
    this.ensureColumn("gm_dream_state", "last_skip_reason", "TEXT");
  }

  private ensureMessageRuntimeMetaColumns() {
    this.ensureColumn("gm_messages", "runtime_meta_json", "TEXT");
  }

  private ensureMessageRuntimeShapeColumns() {
    this.ensureColumn("gm_messages", "runtime_shape_json", "TEXT");
  }

  private ensureSessionCompactionStateColumns() {
    this.ensureColumn("gm_session_compaction_state", "preserved_tail_message_id", "TEXT");
    this.ensureColumn("gm_session_compaction_state", "summarized_through_message_id", "TEXT");
    this.ensureColumn("gm_session_compaction_state", "mode", "TEXT");
    this.ensureColumn("gm_session_compaction_state", "summary_override_text", "TEXT");
  }

  private ensureContextAssemblyAuditColumns() {
    const db = this.getDb();
    const columns = db.prepare("PRAGMA table_info(gm_context_assembly_audits)").all() as Array<{
      name?: string;
    }>;
    const names = new Set(columns.map((column) => column.name ?? ""));
    if (
      names.has(CONTEXT_ASSEMBLY_AUDIT_LEGACY_SESSION_MEMORY_TOKENS_COLUMN) &&
      !names.has(CONTEXT_ASSEMBLY_AUDIT_SESSION_SUMMARY_TOKENS_COLUMN)
    ) {
      db.exec(
        `ALTER TABLE gm_context_assembly_audits RENAME COLUMN ${CONTEXT_ASSEMBLY_AUDIT_LEGACY_SESSION_MEMORY_TOKENS_COLUMN} TO ${CONTEXT_ASSEMBLY_AUDIT_SESSION_SUMMARY_TOKENS_COLUMN}`,
      );
    }
    this.ensureColumn(
      "gm_context_assembly_audits",
      CONTEXT_ASSEMBLY_AUDIT_SESSION_SUMMARY_TOKENS_COLUMN,
      "INTEGER",
    );
    this.ensureColumn("gm_context_assembly_audits", "compaction_mode", "TEXT");
    this.ensureColumn(
      "gm_context_assembly_audits",
      CONTEXT_ASSEMBLY_AUDIT_SYSTEM_CONTEXT_TOKENS_COLUMN,
      "INTEGER",
    );
    db.exec(`UPDATE gm_context_assembly_audits
      SET ${CONTEXT_ASSEMBLY_AUDIT_SYSTEM_CONTEXT_TOKENS_COLUMN} = COALESCE(
        ${CONTEXT_ASSEMBLY_AUDIT_SYSTEM_CONTEXT_TOKENS_COLUMN},
        ${CONTEXT_ASSEMBLY_AUDIT_LEGACY_SYSTEM_PROMPT_ADDITION_TOKENS_COLUMN}
      )
      WHERE ${CONTEXT_ASSEMBLY_AUDIT_SYSTEM_CONTEXT_TOKENS_COLUMN} IS NULL`);
  }

  private ensureExtractionJobColumns() {
    const db = this.getDb();
    this.ensureColumn("gm_extraction_jobs", "window_hash", "TEXT");
    this.ensureColumn("gm_extraction_jobs", "trigger_reason", "TEXT");
    this.ensureColumn("gm_extraction_jobs", "stage", "TEXT");
    this.ensureColumn("gm_extraction_jobs", "heartbeat_at", "INTEGER");
    this.ensureColumn("gm_extraction_jobs", "claimed_at", "INTEGER");
    this.ensureColumn("gm_extraction_jobs", "finished_at", "INTEGER");
    db.exec(
      "CREATE INDEX IF NOT EXISTS ix_gm_extraction_jobs_session_window_status ON gm_extraction_jobs(session_id, window_hash, status, created_at DESC)",
    );
  }

  private ensureAutomationMultimodalRuntimeSchema() {
    const db = this.getDb();
    this.ensureColumn("gm_messages", "content_text", "TEXT");
    this.ensureColumn("gm_messages", "content_blocks_json", "TEXT");
    this.ensureColumn("gm_messages", "runtime_meta_json", "TEXT");
    this.ensureColumn("gm_messages", "runtime_shape_json", "TEXT");
    this.ensureColumn("gm_messages", "has_media", "INTEGER NOT NULL DEFAULT 0");
    this.ensureColumn("gm_messages", "primary_media_id", "TEXT");
    db.exec(
      `UPDATE gm_messages SET content_text = COALESCE(content_text, content) WHERE content_text IS NULL OR content_text = ''`,
    );
    db.exec(`UPDATE gm_messages SET has_media = COALESCE(has_media, 0)`);
    db.exec(`
      CREATE INDEX IF NOT EXISTS ix_gm_messages_created_turn
      ON gm_messages(created_at, turn_index)
    `);
    db.exec(`
      CREATE INDEX IF NOT EXISTS ix_gm_messages_primary_media
      ON gm_messages(primary_media_id)
    `);
  }

  private ensureCanonicalMessageSchema() {
    const db = this.getDb();
    const columns = db.prepare("PRAGMA table_info(gm_messages)").all() as Array<{ name?: string }>;
    const names = new Set(columns.map((column) => column.name ?? ""));
    if (!names.has("bot_id") && !names.has("user_id")) {
      return;
    }

    db.exec(`
      BEGIN IMMEDIATE;
      ALTER TABLE gm_messages RENAME TO gm_messages_old;
      CREATE TABLE gm_messages (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        conversation_uid TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        content_text TEXT,
        content_blocks_json TEXT,
        runtime_meta_json TEXT,
        runtime_shape_json TEXT,
        has_media INTEGER NOT NULL DEFAULT 0,
        primary_media_id TEXT,
        turn_index INTEGER NOT NULL,
        extracted INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL
      );
      INSERT INTO gm_messages
        (id, session_id, conversation_uid, role, content, content_text, content_blocks_json, runtime_meta_json, runtime_shape_json, has_media, primary_media_id, turn_index, extracted, created_at)
      SELECT
        id, session_id, conversation_uid, role, content, content, NULL, NULL, NULL, 0, NULL, turn_index, extracted, created_at
      FROM gm_messages_old;
      DROP TABLE gm_messages_old;
      DROP INDEX IF EXISTS ix_gm_messages_bot_user;
      CREATE INDEX IF NOT EXISTS ix_gm_messages_session_turn ON gm_messages(session_id, turn_index);
      CREATE INDEX IF NOT EXISTS ix_gm_messages_created_turn ON gm_messages(created_at, turn_index);
      CREATE INDEX IF NOT EXISTS ix_gm_messages_primary_media ON gm_messages(primary_media_id);
      COMMIT;
    `);
  }

  private ensureColumn(tableName: string, columnName: string, columnDef: string) {
    const db = this.getDb();
    const columns = db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>;
    if (columns.some((column) => column.name === columnName)) {
      return;
    }
    db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${columnDef}`);
  }

  private parseRuntimeMeta(value: unknown): GmMessageRow["runtimeMeta"] {
    if (typeof value !== "string" || !value.trim()) {
      return null;
    }
    try {
      const parsed = JSON.parse(value) as Record<string, unknown>;
      const toStringArray = (input: unknown): string[] | undefined => {
        if (!Array.isArray(input)) {
          return undefined;
        }
        const out = input.filter(
          (entry): entry is string => typeof entry === "string" && entry.trim().length > 0,
        );
        return out.length ? out : undefined;
      };
      const providerMessageId =
        typeof parsed.providerMessageId === "string" && parsed.providerMessageId.trim()
          ? parsed.providerMessageId.trim()
          : undefined;
      const toolUseIds = toStringArray(parsed.toolUseIds);
      const toolResultIds = toStringArray(parsed.toolResultIds);
      const thinkingSignatures = toStringArray(parsed.thinkingSignatures);
      if (!providerMessageId && !toolUseIds && !toolResultIds && !thinkingSignatures) {
        return null;
      }
      return {
        ...(providerMessageId ? { providerMessageId } : {}),
        ...(toolUseIds ? { toolUseIds } : {}),
        ...(toolResultIds ? { toolResultIds } : {}),
        ...(thinkingSignatures ? { thinkingSignatures } : {}),
      };
    } catch {
      return null;
    }
  }

  private parseRuntimeShape(value: unknown): GmMessageRow["runtimeShape"] {
    if (typeof value !== "string" || !value.trim()) {
      return null;
    }
    try {
      const parsed = JSON.parse(value) as Record<string, unknown>;
      const content = Array.isArray(parsed.content)
        ? parsed.content.filter((entry): entry is MessageRuntimeShapeBlock => {
            return (
              Boolean(entry) &&
              typeof entry === "object" &&
              typeof (entry as { type?: unknown }).type === "string"
            );
          })
        : undefined;
      const messageId =
        typeof parsed.messageId === "string" && parsed.messageId.trim()
          ? parsed.messageId.trim()
          : undefined;
      const messageUuid =
        typeof parsed.messageUuid === "string" && parsed.messageUuid.trim()
          ? parsed.messageUuid.trim()
          : undefined;
      const stopReason =
        typeof parsed.stopReason === "string" && parsed.stopReason.trim()
          ? parsed.stopReason.trim()
          : undefined;
      const toolCallId =
        typeof parsed.toolCallId === "string" && parsed.toolCallId.trim()
          ? parsed.toolCallId.trim()
          : undefined;
      const toolName =
        typeof parsed.toolName === "string" && parsed.toolName.trim()
          ? parsed.toolName.trim()
          : undefined;
      const isError = typeof parsed.isError === "boolean" ? parsed.isError : undefined;
      if (
        !messageId &&
        !messageUuid &&
        !stopReason &&
        !toolCallId &&
        !toolName &&
        isError === undefined &&
        !content?.length
      ) {
        return null;
      }
      return {
        ...(messageId ? { messageId } : {}),
        ...(messageUuid ? { messageUuid } : {}),
        ...(stopReason ? { stopReason } : {}),
        ...(toolCallId ? { toolCallId } : {}),
        ...(toolName ? { toolName } : {}),
        ...(isError !== undefined ? { isError } : {}),
        ...(content?.length ? { content } : {}),
      };
    } catch {
      return null;
    }
  }

  private claimPendingJobRow(row: unknown): ExtractionJob {
    const rec = requireSqliteRow(row, "Invalid extraction job row");
    const db = this.getDb();
    const updatedAt = Date.now();
    const result = db
      .prepare(`UPDATE gm_extraction_jobs
      SET status = 'running',
          stage = 'claimed',
          attempts = attempts + 1,
          claimed_at = ?,
          heartbeat_at = ?,
          updated_at = ?
      WHERE id = ? AND status = 'pending'`)
      .run(updatedAt, updatedAt, updatedAt, rec.id) as { changes?: number };
    if (!result.changes) {
      throw new Error(`Failed to claim pending extraction job: ${rec.id}`);
    }
    const updated = db.prepare(`SELECT * FROM gm_extraction_jobs WHERE id = ?`).get(rec.id);
    return this.mapJobRow(updated);
  }

  private mapMessageRows(rows: unknown[]): GmMessageRow[] {
    const refsByMessageId = this.loadMessageMediaRefs(
      rows.map((row) => String(requireSqliteRow(row, "Invalid message row").id ?? "")),
    );
    return rows.map((row) =>
      this.mapMessageRow(
        row,
        refsByMessageId.get(String(requireSqliteRow(row, "Invalid message row").id ?? "")) ?? [],
      ),
    );
  }

  private mapMessageRow(row: unknown, mediaRefs: MessageMediaRef[]): GmMessageRow {
    const rec = requireSqliteRow(row, "Invalid message row");
    const contentText =
      typeof rec.content_text === "string" && rec.content_text.trim()
        ? rec.content_text
        : String(rec.content ?? "");
    const contentBlocks = this.parseMessageBlocks(rec.content_blocks_json, contentText ?? "");
    const runtimeMeta = this.parseRuntimeMeta(rec.runtime_meta_json);
    const runtimeShape = this.parseRuntimeShape(rec.runtime_shape_json);
    return {
      id: String(rec.id ?? ""),
      sessionId: String(rec.session_id ?? ""),
      conversationUid: String(rec.conversation_uid ?? ""),
      role: String(rec.role ?? ""),
      content: String(rec.content ?? ""),
      contentText,
      contentBlocks,
      hasMedia: Boolean(rec.has_media),
      primaryMediaId: sqliteNullableString(rec.primary_media_id),
      mediaRefs,
      runtimeMeta,
      runtimeShape,
      turnIndex: sqliteNumber(rec.turn_index),
      extracted: Boolean(rec.extracted),
      createdAt: sqliteNumber(rec.created_at),
    } satisfies GmMessageRow;
  }

  private loadMessageMediaRefs(messageIds: string[]): Map<string, MessageMediaRef[]> {
    const out = new Map<string, MessageMediaRef[]>();
    if (!messageIds.length) {
      return out;
    }
    const db = this.getDb();
    const placeholders = messageIds.map(() => "?").join(", ");
    const rows = toSqliteRows(
      db
        .prepare(`SELECT message_id, media_id, ordinal, role
      FROM gm_message_media_refs
      WHERE message_id IN (${placeholders})
      ORDER BY message_id ASC, ordinal ASC`)
        .all(...messageIds),
    );
    for (const row of rows) {
      const bucket = out.get(String(row.message_id ?? "")) ?? [];
      bucket.push({
        mediaId: String(row.media_id ?? ""),
        ordinal: Number(row.ordinal ?? 0),
        role:
          typeof row.role === "string" && (row.role === "primary" || row.role === "supporting")
            ? (row.role as MessageMediaRef["role"])
            : undefined,
      });
      out.set(String(row.message_id ?? ""), bucket);
    }
    return out;
  }

  private parseMessageBlocks(raw: unknown, fallbackText: string): MessageBlock[] {
    if (typeof raw === "string" && raw.trim()) {
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          return parsed.filter(
            (item) =>
              item &&
              typeof item === "object" &&
              typeof (item as { type?: unknown }).type === "string",
          ) as MessageBlock[];
        }
      } catch {
        // ignore malformed historical payloads
      }
    }
    return [{ type: "text", text: fallbackText }];
  }

  private mapJobRow(row: unknown): ExtractionJob {
    const rec = requireSqliteRow(row, "Invalid extraction job row");
    return {
      id: String(rec.id ?? ""),
      sessionId: String(rec.session_id ?? ""),
      conversationUid: String(rec.conversation_uid ?? ""),
      startTurn: sqliteNumber(rec.start_turn),
      endTurn: sqliteNumber(rec.end_turn),
      windowHash: sqliteNullableString(rec.window_hash),
      triggerReason: sqliteNullableString(rec.trigger_reason),
      stage: sqliteNullableString(rec.stage),
      status: rec.status as ExtractionJob["status"],
      attempts: sqliteNumber(rec.attempts),
      error: sqliteNullableString(rec.error),
      heartbeatAt: sqliteNullableNumber(rec.heartbeat_at),
      claimedAt: sqliteNullableNumber(rec.claimed_at),
      finishedAt: sqliteNullableNumber(rec.finished_at),
      createdAt: sqliteNumber(rec.created_at),
      updatedAt: sqliteNumber(rec.updated_at),
    };
  }

  private mapPipelineJobRow(row: unknown): PipelineJob {
    const rec = requireSqliteRow(row, "Invalid pipeline job row");
    return {
      id: String(rec.id ?? ""),
      jobKind: String(rec.job_kind ?? ""),
      targetRef: sqliteNullableString(rec.target_ref),
      status: rec.status as PipelineJob["status"],
      payloadJson: sqliteNullableString(rec.payload_json),
      error: sqliteNullableString(rec.error),
      attempts: sqliteNumber(rec.attempts),
      createdAt: sqliteNumber(rec.created_at),
      updatedAt: sqliteNumber(rec.updated_at),
    };
  }

  private mapDeadLetterRow(row: unknown): DeadLetter {
    const rec = requireSqliteRow(row, "Invalid dead letter row");
    return {
      id: String(rec.id ?? ""),
      sourceJobId: sqliteNullableString(rec.source_job_id),
      jobKind: String(rec.job_kind ?? ""),
      payloadJson: sqliteNullableString(rec.payload_json),
      error: sqliteNullableString(rec.error),
      createdAt: sqliteNumber(rec.created_at),
    };
  }

  private mapRecallFeedbackRow(row: unknown): RecallFeedback {
    const rec = requireSqliteRow(row, "Invalid recall feedback row");
    return {
      id: String(rec.id ?? ""),
      traceId: String(rec.trace_id ?? ""),
      itemId: String(rec.item_id ?? ""),
      selected: Boolean(rec.selected),
      rank: sqliteNullableNumber(rec.rank),
      usedInAnswer: Boolean(rec.used_in_answer),
      followupSupported: Boolean(rec.followup_supported),
      createdAt: sqliteNumber(rec.created_at),
    };
  }

  private mapCompactionAuditRow(row: unknown): CompactionAudit {
    const rec = requireSqliteRow(row, "Invalid compaction audit row");
    return {
      id: String(rec.id ?? ""),
      sessionId: String(rec.session_id ?? ""),
      kind: rec.kind as CompactionAudit["kind"],
      trigger: sqliteNullableString(rec.trigger),
      reason: sqliteNullableString(rec.reason),
      tokenBudget: sqliteNullableNumber(rec.token_budget),
      currentTokenCount: sqliteNullableNumber(rec.current_token_count),
      tokensBefore: sqliteNullableNumber(rec.tokens_before),
      tokensAfter: sqliteNullableNumber(rec.tokens_after),
      preservedTailStartTurn: sqliteNullableNumber(rec.preserved_tail_start_turn),
      summarizedMessages: sqliteNullableNumber(rec.summarized_messages),
      keptMessages: sqliteNullableNumber(rec.kept_messages),
      rewrittenEntries: sqliteNullableNumber(rec.rewritten_entries),
      bytesFreed: sqliteNullableNumber(rec.bytes_freed),
      skippedAlreadyCompacted: sqliteNullableNumber(rec.skipped_already_compacted),
      skippedShort: sqliteNullableNumber(rec.skipped_short),
      detailsJson: sqliteNullableString(rec.details_json),
      createdAt: sqliteNumber(rec.created_at),
    };
  }

  private mapSessionSummaryStateRow(row: unknown): SessionSummaryStateRow {
    const rec = requireSqliteRow(row, "Invalid session summary state row");
    return {
      sessionId: String(rec.session_id ?? ""),
      lastSummarizedMessageId: sqliteNullableString(rec.last_summarized_message_id),
      lastSummaryUpdatedAt: sqliteNullableNumber(rec.last_summary_updated_at),
      tokensAtLastSummary: sqliteNumber(rec.tokens_at_last_summary),
      summaryInProgress: Boolean(rec.summary_in_progress),
      updatedAt: sqliteNumber(rec.updated_at),
    };
  }

  private mapDurableExtractionCursorRow(row: unknown): DurableExtractionCursorRow {
    const rec = requireSqliteRow(row, "Invalid durable extraction cursor row");
    return {
      sessionId: String(rec.session_id ?? ""),
      sessionKey: sqliteNullableString(rec.session_key),
      lastExtractedTurn: sqliteNumber(rec.last_extracted_turn),
      lastExtractedMessageId: sqliteNullableString(rec.last_extracted_message_id),
      lastRunAt: sqliteNullableNumber(rec.last_run_at),
      updatedAt: sqliteNumber(rec.updated_at),
    };
  }

  private mapSessionCompactionStateRow(row: unknown): SessionCompactionStateRow {
    const rec = requireSqliteRow(row, "Invalid session compaction state row");
    return {
      sessionId: String(rec.session_id ?? ""),
      preservedTailStartTurn: sqliteNumber(rec.preserved_tail_start_turn),
      preservedTailMessageId: sqliteNullableString(rec.preserved_tail_message_id),
      summarizedThroughMessageId: sqliteNullableString(rec.summarized_through_message_id),
      mode: sqliteNullableString(rec.mode),
      summaryOverrideText: sqliteNullableString(rec.summary_override_text),
      updatedAt: sqliteNumber(rec.updated_at),
    };
  }

  private mapContextAssemblyAuditRow(row: unknown): ContextAssemblyAudit {
    const rec = requireSqliteRow(row, "Invalid context assembly audit row");
    return {
      id: String(rec.id ?? ""),
      sessionId: String(rec.session_id ?? ""),
      prompt: sqliteNullableString(rec.prompt),
      rawMessageCount: sqliteNumber(rec.raw_message_count),
      compactedMessageCount: sqliteNumber(rec.compacted_message_count),
      rawMessageTokens: sqliteNumber(rec.raw_message_tokens),
      compactedMessageTokens: sqliteNumber(rec.compacted_message_tokens),
      sessionSummaryTokens: sqliteNullableNumber(
        rec[CONTEXT_ASSEMBLY_AUDIT_SESSION_SUMMARY_TOKENS_COLUMN],
      ),
      recallTokens: sqliteNullableNumber(rec.recall_tokens),
      systemContextTokens: sqliteNullableNumber(
        rec[CONTEXT_ASSEMBLY_AUDIT_SYSTEM_CONTEXT_TOKENS_COLUMN] ??
          rec[CONTEXT_ASSEMBLY_AUDIT_LEGACY_SYSTEM_PROMPT_ADDITION_TOKENS_COLUMN],
      ),
      preservedTailStartTurn: sqliteNullableNumber(rec.preserved_tail_start_turn),
      compactionStatePresent: Boolean(rec.compaction_state_present),
      compactionMode: sqliteNullableString(rec.compaction_mode),
      detailsJson: sqliteNullableString(rec.details_json),
      createdAt: sqliteNumber(rec.created_at),
    };
  }

  private mapContextArchiveRunRow(row: unknown): ContextArchiveRunRow {
    const rec = requireSqliteRow(row, "Invalid context archive run row");
    return {
      id: String(rec.id ?? ""),
      sessionId: String(rec.session_id ?? ""),
      conversationUid: String(rec.conversation_uid ?? ""),
      runKind: String(rec.run_kind ?? "") as ContextArchiveRunRow["runKind"],
      archiveMode: String(rec.archive_mode ?? "") as ContextArchiveRunRow["archiveMode"],
      status: String(rec.status ?? "") as ContextArchiveRunRow["status"],
      turnIndex: sqliteNullableNumber(rec.turn_index),
      taskId: sqliteNullableString(rec.task_id),
      agentId: sqliteNullableString(rec.agent_id),
      parentAgentId: sqliteNullableString(rec.parent_agent_id),
      summaryJson: sqliteNullableString(rec.summary_json),
      metadataJson: sqliteNullableString(rec.metadata_json),
      createdAt: sqliteNumber(rec.created_at),
      updatedAt: sqliteNumber(rec.updated_at),
    };
  }

  private mapContextArchiveEventRow(row: unknown): ContextArchiveEventRow {
    const rec = requireSqliteRow(row, "Invalid context archive event row");
    return {
      id: String(rec.id ?? ""),
      runId: String(rec.run_id ?? ""),
      eventKind: String(rec.event_kind ?? ""),
      sequence: sqliteNumber(rec.sequence),
      turnIndex: sqliteNullableNumber(rec.turn_index),
      payloadJson: String(rec.payload_json ?? ""),
      payloadHash: sqliteNullableString(rec.payload_hash),
      createdAt: sqliteNumber(rec.created_at),
    };
  }

  private mapContextArchiveBlobRow(row: unknown): ContextArchiveBlobRow {
    const rec = requireSqliteRow(row, "Invalid context archive blob row");
    return {
      id: String(rec.id ?? ""),
      runId: String(rec.run_id ?? ""),
      blobKey: String(rec.blob_key ?? ""),
      blobHash: String(rec.blob_hash ?? ""),
      blobKind: sqliteNullableString(rec.blob_kind),
      storagePath: sqliteNullableString(rec.storage_path),
      contentType: sqliteNullableString(rec.content_type),
      byteLength: sqliteNullableNumber(rec.byte_length),
      metadataJson: sqliteNullableString(rec.metadata_json),
      createdAt: sqliteNumber(rec.created_at),
      updatedAt: sqliteNumber(rec.updated_at),
    };
  }

  private mapPromotionCandidateRow(row: unknown): PromotionCandidate {
    const rec = requireSqliteRow(row, "Invalid promotion candidate row");
    return {
      id: String(rec.id ?? ""),
      sessionId: String(rec.session_id ?? ""),
      sourceType: String(rec.source_type ?? ""),
      sourceRefsJson: String(rec.source_refs_json ?? ""),
      candidateJson: String(rec.candidate_json ?? ""),
      status: String(rec.status ?? "") as PromotionCandidate["status"],
      createdAt: sqliteNumber(rec.created_at),
      updatedAt: sqliteNumber(rec.updated_at),
    };
  }

  private mapKnowledgeSyncStateRow(row: unknown): KnowledgeSyncState {
    const rec = requireSqliteRow(row, "Invalid knowledge sync state row");
    return {
      id: String(rec.id ?? ""),
      notePath: String(rec.note_path ?? ""),
      noteId: sqliteNullableString(rec.note_id),
      contentHash: sqliteNullableString(rec.content_hash),
      indexedAt: sqliteNumber(rec.indexed_at),
      lastError: sqliteNullableString(rec.last_error),
      syncJson: sqliteNullableString(rec.sync_json),
      status: String(rec.status ?? "") as KnowledgeSyncState["status"],
    };
  }
}
