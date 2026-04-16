import type { AgentMessage } from "@mariozechner/pi-agent-core";
import { emitSpecialAgentActionEvent } from "../../agents/special/runtime/action-feed.js";
import { createConfiguredSpecialAgentObservability } from "../../agents/special/runtime/configured-observability.js";
import { createEmbeddedMemorySpecialAgentDefinition } from "../../agents/special/runtime/definition-presets.js";
import {
  buildSpecialAgentCompletionDetail,
  buildSpecialAgentRunRefDetail,
  buildSpecialAgentWaitFailureDetail,
} from "../../agents/special/runtime/result-detail.js";
import { runSpecialAgentToCompletion } from "../../agents/special/runtime/run-once.js";
import {
  createDefaultSpecialAgentActionRuntimeDeps,
  type SpecialAgentActionRuntimeDeps,
} from "../../agents/special/runtime/runtime-deps.js";
import type { SpecialAgentDefinition } from "../../agents/special/runtime/types.js";
import { MEMORY_FILE_MAINTENANCE_TOOL_ALLOWLIST } from "../special-agent-toollists.js";
import { collectRecentDurableConversation } from "./extraction.js";
import type { DurableMemoryManifestEntry } from "./store.js";
import { scanDurableMemoryScopeEntries } from "./store.js";
import type { DurableExtractionRunParams, DurableExtractionRunResult } from "./worker-manager.js";

export const MEMORY_EXTRACTION_SPAWN_SOURCE = "memory-extraction";
export const MEMORY_EXTRACTION_TOOL_ALLOWLIST = MEMORY_FILE_MAINTENANCE_TOOL_ALLOWLIST;
export const MEMORY_EXTRACTION_AGENT_DEFINITION: SpecialAgentDefinition =
  createEmbeddedMemorySpecialAgentDefinition({
    id: "memory_extractor",
    label: "memory-extraction",
    spawnSource: MEMORY_EXTRACTION_SPAWN_SOURCE,
    allowlist: MEMORY_EXTRACTION_TOOL_ALLOWLIST,
    defaultRunTimeoutSeconds: 90,
    defaultMaxTurns: 5,
  });

type MemoryExtractionAgentDeps = SpecialAgentActionRuntimeDeps;

let memoryExtractionAgentDeps: MemoryExtractionAgentDeps | undefined;

function resolveMemoryExtractionAgentDeps(): MemoryExtractionAgentDeps {
  if (!memoryExtractionAgentDeps) {
    memoryExtractionAgentDeps = createDefaultSpecialAgentActionRuntimeDeps();
  }
  return memoryExtractionAgentDeps;
}

function normalizeOptionalString(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function decodeDurableScopeSegment(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) {
    return undefined;
  }
  try {
    return decodeURIComponent(trimmed);
  } catch {
    return trimmed;
  }
}

function trimStructuredField(value: string | undefined): string | undefined {
  const trimmed = value
    ?.trim()
    .replace(/^\*+\s*/, "")
    .replace(/\s*\*+$/, "")
    .trim();
  return trimmed ? trimmed : undefined;
}

type ParsedMemoryExtractorResult = {
  status?: "written" | "skipped" | "no_change" | "failed";
  summary?: string;
  writtenCount?: number;
  updatedCount?: number;
  deletedCount?: number;
};

function parseOptionalCount(text: string, label: string): number | undefined {
  const match = text.match(new RegExp(`^\\s*\\**\\s*${label}:\\s*(\\d+)\\s*\\**\\s*$`, "im"));
  return match ? Number.parseInt(match[1] ?? "", 10) : undefined;
}

export function parseMemoryExtractorResult(text: string): ParsedMemoryExtractorResult {
  const normalized = normalizeOptionalString(text);
  if (!normalized) {
    return {};
  }
  const statusMatch = normalized.match(
    /^\s*\**\s*STATUS:\s*(WRITTEN|SKIPPED|NO_CHANGE|FAILED)\s*\**\s*$/im,
  );
  const summaryMatch = normalized.match(/^\s*\**\s*SUMMARY:\s*(.+?)\s*\**\s*$/im);
  return {
    ...(statusMatch
      ? { status: statusMatch[1].trim().toLowerCase() as ParsedMemoryExtractorResult["status"] }
      : {}),
    ...(summaryMatch ? { summary: trimStructuredField(summaryMatch[1]) } : {}),
    ...(parseOptionalCount(normalized, "WRITTEN_COUNT") !== undefined
      ? { writtenCount: parseOptionalCount(normalized, "WRITTEN_COUNT") }
      : {}),
    ...(parseOptionalCount(normalized, "UPDATED_COUNT") !== undefined
      ? { updatedCount: parseOptionalCount(normalized, "UPDATED_COUNT") }
      : {}),
    ...(parseOptionalCount(normalized, "DELETED_COUNT") !== undefined
      ? { deletedCount: parseOptionalCount(normalized, "DELETED_COUNT") }
      : {}),
  };
}

function buildExistingManifestLines(
  entries: DurableMemoryManifestEntry[],
  limit: number,
): string[] {
  return entries.slice(0, Math.max(1, limit)).map((entry, index) => {
    const dedupeText = entry.dedupeKey ? ` | dedupeKey=${entry.dedupeKey}` : "";
    return `${index + 1}. type=${entry.durableType} | title=${entry.title} | description=${entry.description}${dedupeText}`;
  });
}

export function buildMemoryExtractionSystemPrompt(): string {
  return [
    "# Memory Extractor Agent",
    "",
    "You are a dedicated background memory maintenance agent.",
    "",
    "## Mission",
    "- Maintain file-based durable memory for the current scope only.",
    "- Extract only stable, future-useful durable notes from the provided recent model-visible messages.",
    "- Prefer updating an existing durable note over creating a duplicate.",
    "",
    "## Turn Budget",
    "- You have a hard turn budget of 5 turns.",
    "- Work like a small maintenance agent: decide quickly, act narrowly, and finish fast.",
    "- Use the provided manifest first. Do not spend turns rediscovering information that is already in the manifest.",
    "- If multiple existing notes might need changes, inspect all relevant candidates first, then perform the necessary durable memory tool calls in a tight batch.",
    "- Do NOT bounce between investigation and writing across many turns.",
    "",
    "## Constraints",
    "- Use only the scoped memory file tools for this run.",
    "- Do NOT inspect project source files, run shell commands, browse the web, or spawn other agents.",
    "- Do NOT write knowledge notes. This task is only for durable memory.",
    "- The recent messages are the source of truth for this run. Do not attempt to verify them against code, git state, or external systems.",
    "- Treat feedback as bidirectional: record both corrective guidance and non-obvious successful patterns explicitly confirmed by the user.",
    "",
    "## Durable Boundary",
    "- Only create durable memory of type user, feedback, project, or reference.",
    "- Do NOT save task progress, temporary plans, activity logs, code structure, or transient debugging state.",
    "- If nothing in the provided recent messages deserves durable memory, do not write anything.",
    "",
    "## Tooling Strategy",
    "- Start with memory_manifest_read unless the manifest is already sufficient in the task input.",
    "- Use memory_note_read to inspect the exact note files you may update, plus MEMORY.md when needed.",
    "- Use memory_note_write to create a new note or replace a file completely.",
    "- Use memory_note_edit to make targeted updates after reading a file.",
    "- Use memory_note_delete only when the recent messages clearly invalidate a durable note or explicitly ask to forget it.",
    "- Prefer updating an existing durable note over creating a new one when the manifest shows a likely match.",
    "- If multiple note changes are needed, read all relevant candidates first, then finish the writes/edits in a tight batch.",
    "- Keep MEMORY.md aligned with the note files you create, edit, or delete.",
    "- MEMORY.md is an index only: no frontmatter, one short pointer per line, about 150 characters per entry, and never memory body text.",
    "- Keep MEMORY.md under roughly 200 lines and 25KB by pruning stale pointers instead of stuffing detail into the index.",
    "",
    "## Output",
    "Return a final report in exactly this shape:",
    "STATUS: WRITTEN | SKIPPED | NO_CHANGE | FAILED",
    "SUMMARY: one-line conclusion",
    "WRITTEN_COUNT: <number>",
    "UPDATED_COUNT: <number>",
    "DELETED_COUNT: <number>",
  ].join("\n");
}

export function buildMemoryExtractionTaskPrompt(params: {
  scopeKey: string;
  recentMessages: AgentMessage[];
  recentMessageLimit: number;
  existingEntries: DurableMemoryManifestEntry[];
  maxNotes: number;
}): string {
  const recentConversation = collectRecentDurableConversation(
    params.recentMessages,
    params.recentMessageLimit,
  );
  const existingManifestLines = params.existingEntries.length
    ? buildExistingManifestLines(params.existingEntries, 24)
    : ["(none)"];
  return [
    "Maintain durable memory for the current scope using only the provided recent messages and scoped memory file tools.",
    "",
    `Scope: ${params.scopeKey}`,
    `Max durable notes to create or update: ${Math.max(1, params.maxNotes)}`,
    "",
    "Recent model-visible messages since the last extraction cursor:",
    ...recentConversation.map((entry) => `- ${entry.role}: ${entry.text}`),
    "",
    "Existing durable memory manifest:",
    ...existingManifestLines,
    "",
    "Workflow:",
    "- First review the manifest and identify whether an existing note should be updated, removed, or left untouched.",
    "- Only create a new note when no existing note can be updated cleanly.",
    "- If several note changes are needed, read all relevant candidate notes first, then execute the writes/edits without stretching the work across many turns.",
    "- Use memory_note_read before memory_note_edit, use memory_note_write for full replacements or new files, and use memory_note_delete only when forgetting/removal is clearly warranted.",
    "- Update MEMORY.md whenever the note set changes, but keep it as a short index rather than a content dump.",
    "",
    "Use the scoped memory file tools only when a stable durable note is clearly warranted. If there is no durable memory to add, update, or delete, do nothing and return STATUS: NO_CHANGE.",
  ].join("\n");
}

function emitMemoryExtractionAction(params: {
  actionRunId: string;
  actionId: string;
  sessionKey: string;
  agentId?: string | null;
  status: "started" | "running" | "completed" | "blocked" | "failed";
  title: string;
  summary?: string;
  detail?: Record<string, unknown>;
}) {
  emitSpecialAgentActionEvent({
    emitAgentActionEvent: resolveMemoryExtractionAgentDeps().emitAgentActionEvent,
    runId: params.actionRunId,
    actionId: params.actionId,
    kind: "memory",
    sessionKey: params.sessionKey,
    agentId: params.agentId,
    status: params.status,
    title: params.title,
    summary: params.summary,
    detail: params.detail,
  });
}

export async function runDurableExtractionAgentOnce(
  params: DurableExtractionRunParams,
): Promise<DurableExtractionRunResult> {
  const existingEntries = await scanDurableMemoryScopeEntries(params.scope);
  const { runtimeConfig, observability } = createConfiguredSpecialAgentObservability({
    definition: MEMORY_EXTRACTION_AGENT_DEFINITION,
    sessionId: params.sessionId,
    sessionKey: params.sessionKey,
    ...(normalizeOptionalString(params.scope.agentId)
      ? { agentId: normalizeOptionalString(params.scope.agentId) }
      : {}),
    ...(normalizeOptionalString(params.parentRunId)
      ? { parentRunId: normalizeOptionalString(params.parentRunId) }
      : {}),
  });
  const taskPrompt = buildMemoryExtractionTaskPrompt({
    scopeKey: params.scope.scopeKey ?? "durable-memory",
    recentMessages: params.recentMessages,
    recentMessageLimit: params.recentMessageLimit,
    existingEntries,
    maxNotes: params.maxNotes,
  });
  const actionRunId = `memory-extraction:${params.sessionId}:${params.messageCursor}`;
  const actionId = `memory-extraction:${params.sessionId}:${params.messageCursor}`;
  emitMemoryExtractionAction({
    actionRunId,
    actionId,
    sessionKey: params.sessionKey,
    agentId: params.scope.agentId,
    status: "started",
    title: "Memory extraction scheduled",
    summary: params.scope.scopeKey,
    detail: {
      messageCursor: params.messageCursor,
      recentMessageLimit: params.recentMessageLimit,
      candidateMessageCount: collectRecentDurableConversation(
        params.recentMessages,
        params.recentMessageLimit,
      ).length,
    },
  });

  const run = await runSpecialAgentToCompletion(
    {
      definition: MEMORY_EXTRACTION_AGENT_DEFINITION,
      task: taskPrompt,
      extraSystemPrompt: buildMemoryExtractionSystemPrompt(),
      ...(normalizeOptionalString(params.parentRunId) ? { parentRunId: params.parentRunId } : {}),
      embeddedContext: {
        sessionId: params.sessionId,
        sessionKey: params.sessionKey,
        sessionFile: params.sessionFile,
        workspaceDir: params.workspaceDir,
        ...(normalizeOptionalString(params.scope.agentId)
          ? { agentId: normalizeOptionalString(params.scope.agentId) }
          : {}),
        ...(runtimeConfig ? { config: runtimeConfig } : {}),
        specialAgentContext: {
          durableMemoryScope: {
            agentId: params.scope.agentId,
            channel: decodeDurableScopeSegment(params.scope.channel) ?? null,
            userId: decodeDurableScopeSegment(params.scope.userId) ?? null,
          },
        },
      },
      spawnContext: {
        agentSessionKey: params.sessionKey,
        ...(normalizeOptionalString(params.scope.channel)
          ? { agentChannel: normalizeOptionalString(params.scope.channel) }
          : {}),
        ...(normalizeOptionalString(params.scope.agentId)
          ? { requesterAgentIdOverride: normalizeOptionalString(params.scope.agentId) }
          : {}),
      },
      spawnOverrides: {},
      hooks: observability.hooks,
    },
    resolveMemoryExtractionAgentDeps(),
  );

  if (run.status === "spawn_failed") {
    const error = run.error;
    await observability.recordResult({
      result: run,
      status: "failed",
      summary: error,
    });
    emitMemoryExtractionAction({
      actionRunId,
      actionId,
      sessionKey: params.sessionKey,
      agentId: params.scope.agentId,
      status: "failed",
      title: "Memory extraction failed to start",
      summary: error,
      detail: buildSpecialAgentRunRefDetail(run),
    });
    return {
      status: "failed",
      notesSaved: 0,
      reason: error,
      advanceCursor: false,
    };
  }

  emitMemoryExtractionAction({
    actionRunId,
    actionId,
    sessionKey: params.sessionKey,
    agentId: params.scope.agentId,
    status: "running",
    title: "Memory extraction running",
    summary: params.scope.scopeKey,
    detail: buildSpecialAgentRunRefDetail(run),
  });

  if (run.status === "wait_failed") {
    const error = run.error;
    await observability.recordResult({
      result: run,
      status: "failed",
      summary: error,
    });
    emitMemoryExtractionAction({
      actionRunId,
      actionId,
      sessionKey: params.sessionKey,
      agentId: params.scope.agentId,
      status: "failed",
      title: "Memory extraction did not complete",
      summary: error,
      detail: buildSpecialAgentWaitFailureDetail(run),
    });
    return {
      status: "failed",
      notesSaved: 0,
      reason: error,
      advanceCursor: false,
    };
  }

  const parsed = parseMemoryExtractorResult(run.reply);
  if (!parsed.status) {
    const error = "memory extraction agent completed without a STATUS line";
    await observability.recordResult({
      result: run,
      status: "failed",
      summary: error,
    });
    emitMemoryExtractionAction({
      actionRunId,
      actionId,
      sessionKey: params.sessionKey,
      agentId: params.scope.agentId,
      status: "failed",
      title: "Memory extraction report invalid",
      summary: error,
      detail: buildSpecialAgentRunRefDetail(run),
    });
    return {
      status: "failed",
      notesSaved: 0,
      reason: error,
      advanceCursor: false,
    };
  }

  const notesSaved =
    (parsed.writtenCount ?? 0) + (parsed.updatedCount ?? 0) + (parsed.deletedCount ?? 0);
  const status =
    parsed.status === "written" ? "completed" : parsed.status === "failed" ? "failed" : "completed";
  emitMemoryExtractionAction({
    actionRunId,
    actionId,
    sessionKey: params.sessionKey,
    agentId: params.scope.agentId,
    status,
    title:
      parsed.status === "written"
        ? "Memory extraction wrote durable notes"
        : parsed.status === "skipped"
          ? "Memory extraction skipped"
          : parsed.status === "no_change"
            ? "Memory extraction found no durable changes"
            : "Memory extraction failed",
    summary: parsed.summary,
    detail: buildSpecialAgentCompletionDetail({
      result: run,
      detail: {
        writtenCount: parsed.writtenCount ?? 0,
        updatedCount: parsed.updatedCount ?? 0,
        deletedCount: parsed.deletedCount ?? 0,
      },
    }),
  });

  await observability.recordResult({
    result: run,
    status: parsed.status === "failed" ? "failed" : "complete",
    summary: parsed.summary,
    detail: {
      writtenCount: parsed.writtenCount ?? 0,
      updatedCount: parsed.updatedCount ?? 0,
      deletedCount: parsed.deletedCount ?? 0,
    },
  });

  return {
    status: parsed.status,
    notesSaved,
    reason: parsed.summary,
    advanceCursor: parsed.status !== "failed",
  };
}

export const __testing = {
  setDepsForTest(overrides?: Partial<MemoryExtractionAgentDeps>) {
    memoryExtractionAgentDeps = overrides
      ? {
          ...createDefaultSpecialAgentActionRuntimeDeps(),
          ...overrides,
        }
      : createDefaultSpecialAgentActionRuntimeDeps();
  },
};
