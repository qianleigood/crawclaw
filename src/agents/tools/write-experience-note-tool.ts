import { Type } from "@sinclair/typebox";
import type { CrawClawConfig } from "../../config/config.js";
import { normalizeNotebookLmConfig } from "../../memory/config/notebooklm.ts";
import { getSharedMemoryPromptJournal } from "../../memory/diagnostics/prompt-journal.ts";
import type { DurableMemoryScope } from "../../memory/durable/scope.ts";
import {
  classifyExperienceNoteGuardIssue,
  normalizeExperienceConfidence,
  normalizeExperienceNoteType,
  type ExperienceNoteWriteInput,
} from "../../memory/experience/note.ts";
import {
  readExperienceOutboxEntries,
  type ExperienceOutboxEntry,
  upsertExperienceOutboxEntryFromNote,
  updateExperienceOutboxEntryStatus,
} from "../../memory/experience/outbox-store.ts";
import {
  deleteNotebookLmExperienceNoteViaCli,
  writeNotebookLmExperienceNoteViaCli,
} from "../../memory/notebooklm/notebooklm-write.ts";
import type { NotebookLmConfigInput } from "../../memory/types/config.ts";
import { stringEnum } from "../schema/typebox.js";
import {
  jsonResult,
  readStringArrayParam,
  readStringParam,
  ToolInputError,
  type AnyAgentTool,
} from "./common.js";

const EXPERIENCE_NOTE_TYPES = [
  "procedure",
  "decision",
  "runtime_pattern",
  "failure_pattern",
  "workflow_pattern",
  "reference",
] as const;

const EXPERIENCE_NOTE_OPERATIONS = ["upsert", "archive", "supersede"] as const;
const EXPERIENCE_CONFIDENCE_VALUES = ["low", "medium", "high"] as const;

const WriteExperienceNoteToolSchema = Type.Object({
  operation: Type.Optional(
    stringEnum(EXPERIENCE_NOTE_OPERATIONS, {
      description:
        "Maintenance operation. Use upsert to write/update a note, archive to remove an old note from recall, or supersede to mark it replaced by another note.",
    }),
  ),
  targetId: Type.Optional(
    Type.String({
      description:
        "Existing local outbox id, note id, dedupe key, or title. Required for archive and supersede.",
    }),
  ),
  supersededBy: Type.Optional(
    Type.String({
      description: "Replacement local outbox id or dedupe key. Required for supersede.",
    }),
  ),
  type: Type.Optional(
    stringEnum(EXPERIENCE_NOTE_TYPES, {
      description:
        "Experience note type for upsert. Must be one of procedure, decision, runtime_pattern, failure_pattern, workflow_pattern, or reference.",
    }),
  ),
  title: Type.Optional(
    Type.String({
      description: "Chinese-readable title for the experience note. Required for upsert.",
    }),
  ),
  summary: Type.Optional(
    Type.String({
      description: "Short Chinese summary for the reusable experience. Required for upsert.",
    }),
  ),
  context: Type.Optional(
    Type.String({
      description: "Situation where this experience was learned or should be considered.",
    }),
  ),
  trigger: Type.Optional(
    Type.String({
      description: "Signals that indicate this experience may apply.",
    }),
  ),
  action: Type.Optional(
    Type.String({
      description: "The action or workflow that worked in this situation.",
    }),
  ),
  result: Type.Optional(
    Type.String({
      description: "Observed outcome after applying the action.",
    }),
  ),
  lesson: Type.Optional(
    Type.String({
      description: "Reusable lesson or judgment extracted from the experience.",
    }),
  ),
  appliesWhen: Type.Optional(
    Type.String({
      description: "Boundary where this experience should be applied.",
    }),
  ),
  avoidWhen: Type.Optional(
    Type.String({
      description: "Boundary where this experience should not be applied.",
    }),
  ),
  evidence: Type.Optional(
    Type.Array(Type.String(), {
      description: "Evidence, validation, or source signals supporting the experience.",
    }),
  ),
  confidence: Type.Optional(
    stringEnum(EXPERIENCE_CONFIDENCE_VALUES, {
      description: "Confidence in the experience: low, medium, or high.",
    }),
  ),
  steps: Type.Optional(
    Type.Array(Type.String(), {
      description: "Detailed steps for procedure or workflow experience.",
    }),
  ),
  validation: Type.Optional(
    Type.Array(Type.String(), {
      description: "Validation steps or checks for the experience.",
    }),
  ),
  signals: Type.Optional(
    Type.Array(Type.String(), {
      description: "Additional symptoms or signals for runtime/failure experience.",
    }),
  ),
  references: Type.Optional(
    Type.Array(Type.String(), {
      description: "References, source locators, or entry points for this experience.",
    }),
  ),
  consequences: Type.Optional(
    Type.Array(Type.String(), {
      description: "Consequences or impacts for decision experience.",
    }),
  ),
  whenToRevisit: Type.Optional(
    Type.String({
      description: "When this experience should be revisited or re-evaluated.",
    }),
  ),
  aliases: Type.Optional(
    Type.Array(Type.String(), {
      description: "Optional aliases to improve future lookup.",
    }),
  ),
  tags: Type.Optional(
    Type.Array(Type.String(), {
      description: "Optional tags for notebook search and future recall.",
    }),
  ),
  dedupeKey: Type.Optional(
    Type.String({
      description:
        "Optional stable key used to update the same experience note instead of duplicating it.",
    }),
  ),
});

type ExperienceWriteToolOptions = {
  config?: CrawClawConfig;
  scope?: DurableMemoryScope | null;
};

type ExperienceNoteOperation = (typeof EXPERIENCE_NOTE_OPERATIONS)[number];

function normalizeExperienceNoteOperation(
  value: string | undefined,
): ExperienceNoteOperation | null {
  if (value === undefined) {
    return "upsert";
  }
  return (EXPERIENCE_NOTE_OPERATIONS as readonly string[]).includes(value)
    ? (value as ExperienceNoteOperation)
    : null;
}

function findExperienceOutboxEntry(
  entries: readonly ExperienceOutboxEntry[],
  target: string,
): ExperienceOutboxEntry | null {
  const normalized = target.trim();
  if (!normalized) {
    return null;
  }
  const lower = normalized.toLowerCase();
  return (
    entries.find(
      (entry) =>
        entry.id === normalized ||
        entry.noteId === normalized ||
        entry.dedupeKey === normalized ||
        entry.title === normalized,
    ) ??
    entries.find(
      (entry) =>
        entry.id.toLowerCase() === lower ||
        entry.noteId?.toLowerCase() === lower ||
        entry.dedupeKey?.toLowerCase() === lower ||
        entry.title.toLowerCase() === lower,
    ) ??
    null
  );
}

function resolveNotebookLmExperienceWriteConfig(config?: CrawClawConfig) {
  const notebooklm = normalizeNotebookLmConfig(config?.memory?.notebooklm as NotebookLmConfigInput);
  return notebooklm;
}

function isNotebookLmPendingSyncError(message: string | null): boolean {
  return Boolean(
    message &&
    /NotebookLM provider not ready|auth_expired|profile_missing|cookie_file_missing|cookie_invalid|Authentication failed|unauthorized|forbidden|401|403/i.test(
      message,
    ),
  );
}

function recommendedActionForSyncError(message: string | null): string | null {
  if (!message) {
    return null;
  }
  return isNotebookLmPendingSyncError(message) ? "crawclaw memory login" : "crawclaw memory sync";
}

async function runExperienceLifecycleOperation(params: {
  operation: Exclude<ExperienceNoteOperation, "upsert">;
  targetId: string;
  supersededBy?: string;
  notebooklm: ReturnType<typeof normalizeNotebookLmConfig>;
  scope?: DurableMemoryScope | null;
}) {
  const entries = await readExperienceOutboxEntries(200, {
    scope: params.scope?.scopeKey ? { scopeKey: params.scope.scopeKey } : null,
  });
  const target = findExperienceOutboxEntry(entries, params.targetId);
  if (!target) {
    throw new ToolInputError(`experience note not found: ${params.targetId}`);
  }
  const replacement =
    params.operation === "supersede"
      ? findExperienceOutboxEntry(entries, params.supersededBy ?? "")
      : null;
  if (params.operation === "supersede" && !replacement) {
    throw new ToolInputError(`replacement experience note not found: ${params.supersededBy ?? ""}`);
  }

  const nextStatus = params.operation === "archive" ? "archived" : "superseded";
  const updated = await updateExperienceOutboxEntryStatus({
    id: target.id,
    status: nextStatus,
    supersededBy: replacement?.id,
  });
  if (!updated) {
    throw new ToolInputError(`experience note not found: ${target.id}`);
  }

  getSharedMemoryPromptJournal()?.recordStage("experience_write", {
    payload: {
      status: "ok",
      action: params.operation,
      noteId: updated.noteId,
      notebookId: updated.notebookId,
      title: updated.title,
      noteType: updated.type,
      summary: updated.summary,
      dedupeKey: updated.dedupeKey,
      targetId: updated.id,
      supersededBy: updated.supersededBy,
      storage: "experience_pending_outbox",
    },
  });

  let remoteDeleteStatus: "ok" | "missing" | "skipped" | "failed" = "skipped";
  let remoteDeleteError: string | null = null;
  if (target.noteId && target.notebookId !== "local" && params.notebooklm.enabled) {
    try {
      const deleted = await deleteNotebookLmExperienceNoteViaCli({
        config: params.notebooklm,
        notebookId: target.notebookId,
        noteId: target.noteId,
      });
      remoteDeleteStatus = deleted?.status ?? "skipped";
    } catch (error) {
      remoteDeleteStatus = "failed";
      remoteDeleteError = error instanceof Error ? error.message : String(error);
    }
  }

  return jsonResult({
    status: "ok",
    action: params.operation,
    targetId: updated.id,
    noteId: updated.noteId ?? updated.id,
    notebookId: updated.notebookId,
    title: updated.title,
    type: updated.type,
    outboxStatus: updated.status,
    supersededBy: updated.supersededBy,
    remoteDeleteStatus,
    remoteDeleteError,
  });
}

export function createExperienceWriteTool(
  options?: ExperienceWriteToolOptions,
): AnyAgentTool | null {
  const notebooklm = resolveNotebookLmExperienceWriteConfig(options?.config);
  return {
    label: "Write Experience Note",
    name: "write_experience_note",
    description:
      "Write a Chinese-readable experience note to NotebookLM first; if NotebookLM is unavailable, keep it in the local pending outbox for later sync. Use this for reusable procedures, decisions, runtime/failure patterns, collaboration workflows, or references. Update existing notes instead of duplicating them.",
    parameters: WriteExperienceNoteToolSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const operation = normalizeExperienceNoteOperation(readStringParam(params, "operation"));
      if (!operation) {
        throw new ToolInputError("operation must be one of: upsert, archive, supersede");
      }
      if (operation === "archive" || operation === "supersede") {
        return await runExperienceLifecycleOperation({
          operation,
          targetId: readStringParam(params, "targetId", { required: true }),
          supersededBy: readStringParam(params, "supersededBy"),
          notebooklm,
          scope: options?.scope,
        });
      }

      const type = normalizeExperienceNoteType(readStringParam(params, "type", { required: true }));
      if (!type) {
        throw new ToolInputError(
          "type must be one of: procedure, decision, runtime_pattern, failure_pattern, workflow_pattern, reference",
        );
      }
      const title = readStringParam(params, "title", { required: true });
      const summary = readStringParam(params, "summary", { required: true });
      const context = readStringParam(params, "context");
      const trigger = readStringParam(params, "trigger");
      const action = readStringParam(params, "action");
      const resultText = readStringParam(params, "result");
      const lesson = readStringParam(params, "lesson");
      const appliesWhen = readStringParam(params, "appliesWhen");
      const avoidWhen = readStringParam(params, "avoidWhen");
      const whenToRevisit = readStringParam(params, "whenToRevisit");
      const confidence = normalizeExperienceConfidence(readStringParam(params, "confidence"));
      const dedupeKey = readStringParam(params, "dedupeKey");
      const evidence = readStringArrayParam(params, "evidence");
      const steps = readStringArrayParam(params, "steps");
      const validation = readStringArrayParam(params, "validation");
      const signals = readStringArrayParam(params, "signals");
      const references = readStringArrayParam(params, "references");
      const consequences = readStringArrayParam(params, "consequences");
      const aliases = readStringArrayParam(params, "aliases");
      const tags = readStringArrayParam(params, "tags");

      const note: ExperienceNoteWriteInput = {
        type,
        title,
        summary,
        context,
        trigger,
        action,
        result: resultText,
        lesson,
        appliesWhen,
        avoidWhen,
        evidence,
        confidence,
        steps,
        validation,
        signals,
        references,
        consequences,
        whenToRevisit,
        aliases,
        tags,
        dedupeKey,
      };

      const guardIssue = classifyExperienceNoteGuardIssue(note);
      if (guardIssue) {
        throw new ToolInputError(guardIssue);
      }

      let result = null;
      let syncError: string | null = null;
      if (notebooklm.enabled) {
        try {
          result = await writeNotebookLmExperienceNoteViaCli({
            config: notebooklm,
            note,
          });
        } catch (error) {
          syncError = error instanceof Error ? error.message : String(error);
        }
      }

      if (result?.status === "ok") {
        return jsonResult({
          status: "ok",
          action: result.action ?? "upsert",
          notebookId: result.notebookId,
          noteId: result.noteId ?? null,
          title: result.title,
          type,
          dedupeKey: dedupeKey ?? null,
          syncStatus: "synced",
          syncError: null,
          recommendedAction: null,
          payloadFile: result.payloadFile ?? null,
        });
      }

      const syncStatus =
        syncError && !isNotebookLmPendingSyncError(syncError) ? "failed" : "pending_sync";
      const localOutboxEntry = await upsertExperienceOutboxEntryFromNote({
        note,
        notebookId: "local",
        syncStatus,
        syncError,
        scope: options?.scope,
      });
      getSharedMemoryPromptJournal()?.recordStage("experience_write", {
        payload: {
          status: "ok",
          action: "upsert",
          noteId: localOutboxEntry.noteId,
          notebookId: localOutboxEntry.notebookId,
          title: localOutboxEntry.title,
          noteType: note.type,
          summary: note.summary,
          dedupeKey: dedupeKey ?? null,
          storage: "experience_pending_outbox",
          syncStatus,
          syncError,
        },
      });

      return jsonResult({
        status: "ok",
        action: "upsert",
        notebookId: localOutboxEntry.notebookId,
        noteId: localOutboxEntry.id,
        title: localOutboxEntry.title ?? title,
        type,
        dedupeKey: dedupeKey ?? null,
        syncStatus,
        syncError,
        recommendedAction: recommendedActionForSyncError(syncError),
        payloadFile: null,
      });
    },
  };
}
