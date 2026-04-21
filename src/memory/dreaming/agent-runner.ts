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
import { buildMemoryActionVisibilityProjection } from "../action-visibility.js";
import type { DurableMemoryScope } from "../durable/scope.js";
import type { DurableMemoryManifestEntry } from "../durable/store.js";
import { scanDurableMemoryScopeEntries } from "../durable/store.js";
import { DREAM_MEMORY_MAINTENANCE_TOOL_ALLOWLIST } from "../special-agent-toollists.js";

export const DREAM_SPAWN_SOURCE = "dream";
export const DREAM_AGENT_DEFINITION: SpecialAgentDefinition =
  createEmbeddedMemorySpecialAgentDefinition({
    id: "dream",
    label: "dream",
    spawnSource: DREAM_SPAWN_SOURCE,
    allowlist: DREAM_MEMORY_MAINTENANCE_TOOL_ALLOWLIST,
    defaultRunTimeoutSeconds: 120,
    defaultMaxTurns: 8,
  });

type RuntimeLogger = { info(msg: string): void; warn(msg: string): void; error(msg: string): void };

export type DreamSessionSummary = {
  sessionId: string;
  summaryText: string;
  lastSummarizedTurn: number;
  updatedAt: number;
};

export type DreamSignal = {
  sessionId: string;
  kind: "archive_actions" | "maintenance_runs" | "recent_durable_changes";
  text: string;
};

export type DreamTranscriptFallbackPlan = {
  enabled: boolean;
  reasons: string[];
  sessionIds: string[];
  limits: {
    maxSessions: number;
    maxMatchesPerSession: number;
    maxTotalBytes: number;
    maxExcerptChars: number;
  };
};

export type DreamRunParams = {
  runId: string;
  sessionId: string;
  sessionFile: string;
  workspaceDir: string;
  parentRunId?: string;
  scope: DurableMemoryScope;
  sessionKey?: string;
  triggerSource: string;
  lastSuccessAt?: number | null;
  recentSessions: DreamSessionSummary[];
  recentSignals?: DreamSignal[];
  transcriptFallback?: DreamTranscriptFallbackPlan;
  dryRun?: boolean;
};

export type DreamRunResult = {
  status: "written" | "skipped" | "no_change" | "failed";
  summary?: string;
  writtenCount: number;
  updatedCount: number;
  deletedCount: number;
  touchedNotes?: string[];
};

type DreamAgentDeps = SpecialAgentActionRuntimeDeps;

let deps: DreamAgentDeps | undefined;

function resolveDreamAgentDeps(): DreamAgentDeps {
  if (!deps) {
    deps = createDefaultSpecialAgentActionRuntimeDeps();
  }
  return deps;
}

function normalizeOptionalString(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function decodeScopeSegment(value: string | null | undefined): string | undefined {
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

type ParsedDreamResult = {
  status?: DreamRunResult["status"];
  summary?: string;
  writtenCount?: number;
  updatedCount?: number;
  deletedCount?: number;
  touchedNotes?: string[];
};

function trimStructuredField(value: string | undefined): string | undefined {
  const trimmed = value
    ?.trim()
    .replace(/^\*+\s*/, "")
    .replace(/\s*\*+$/, "")
    .trim();
  return trimmed ? trimmed : undefined;
}

function parseOptionalCount(text: string, label: string): number | undefined {
  const match = text.match(new RegExp(`^\\s*\\**\\s*${label}:\\s*(\\d+)\\s*\\**\\s*$`, "im"));
  return match ? Number.parseInt(match[1] ?? "", 10) : undefined;
}

export function parseDreamResult(text: string): ParsedDreamResult {
  const normalized = normalizeOptionalString(text);
  if (!normalized) {
    return {};
  }
  const statusMatch = normalized.match(
    /^\s*\**\s*STATUS:\s*(WRITTEN|SKIPPED|NO_CHANGE|FAILED)\s*\**\s*$/im,
  );
  const summaryMatch = normalized.match(/^\s*\**\s*SUMMARY:\s*(.+?)\s*\**\s*$/im);
  const touchedMatch = normalized.match(/^\s*\**\s*TOUCHED_NOTES:\s*(.+?)\s*\**\s*$/im);
  return {
    ...(statusMatch
      ? { status: statusMatch[1].trim().toLowerCase() as DreamRunResult["status"] }
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
    ...(touchedMatch
      ? {
          touchedNotes:
            touchedMatch[1]
              ?.split("|")
              .map((value) => trimStructuredField(value))
              .filter((value): value is string => Boolean(value)) ?? [],
        }
      : {}),
  };
}

function buildManifestLines(entries: DurableMemoryManifestEntry[], limit: number): string[] {
  return entries.slice(0, Math.max(1, limit)).map((entry, index) => {
    const dedupeText = entry.dedupeKey ? ` | dedupeKey=${entry.dedupeKey}` : "";
    return `${index + 1}. type=${entry.durableType} | title=${entry.title} | description=${entry.description}${dedupeText}`;
  });
}

function formatAgeLine(lastSuccessAt?: number | null): string {
  if (lastSuccessAt == null) {
    return "No previous dream run has succeeded for this scope.";
  }
  const ageHours = Math.max(0, Math.floor((Date.now() - lastSuccessAt) / 3_600_000));
  return `Last successful dream run was ${ageHours}h ago.`;
}

function buildTranscriptFallbackLines(plan?: DreamTranscriptFallbackPlan): string[] {
  if (!plan?.enabled || plan.sessionIds.length === 0) {
    return [
      "Transcript fallback:",
      "- unavailable; rely on session summaries, structured signals, and scoped durable notes.",
    ];
  }
  return [
    "Transcript fallback:",
    `- available: reasons=${plan.reasons.length ? plan.reasons.join(",") : "unspecified"}`,
    `- allowed sessionIds=${plan.sessionIds.join(",")}`,
    `- limits: maxSessions=${plan.limits.maxSessions}, maxMatchesPerSession=${plan.limits.maxMatchesPerSession}, maxTotalBytes=${plan.limits.maxTotalBytes}, maxExcerptChars=${plan.limits.maxExcerptChars}`,
    "- Use memory_transcript_search only as a fallback for targeted clarification, never as the primary consolidation workflow.",
    "- Do not search sessions outside the allowed sessionIds list.",
  ];
}

export function buildDreamSystemPrompt(): string {
  return [
    "# Dream Agent",
    "",
    "You are a dedicated background dream agent.",
    "",
    "## Mission",
    "- Consolidate file-based durable memory for the current scope only.",
    "- Review the provided recent session summaries and existing durable memory manifest.",
    "- Merge duplicate notes, correct stale or contradicted notes, and keep MEMORY.md aligned and short.",
    "",
    "## Turn Budget",
    "- You have a hard turn budget of 8 turns.",
    "- Work like a compact maintenance agent: inspect the manifest first, read only the candidate note files you may touch, then perform a tight batch of changes.",
    "- Do NOT bounce between investigation and writing across many turns.",
    "- Prefer an Orient -> Gather -> Consolidate -> Prune workflow and finish each phase before moving on.",
    "",
    "## Constraints",
    "- Use only the scoped memory file tools for this run.",
    "- Do NOT inspect project source files, run shell commands, browse the web, or spawn other agents.",
    "- Do NOT write NotebookLM experience notes. This task is only for durable memory.",
    "- The provided recent session summaries are the primary signal. Do not grep transcripts as a primary workflow.",
    "- memory_transcript_search is fallback only: use it only when the task says transcript fallback is available and only for the allowed session ids.",
    "",
    "## Consolidation Rules",
    "- Durable memory still only allows: user, feedback, project, reference.",
    "- Feedback is bidirectional: preserve corrective guidance and explicitly confirmed successful patterns.",
    "- Convert relative dates into absolute dates when you rewrite notes.",
    "- Remove or rewrite clearly stale, superseded, or contradicted durable notes.",
    "- Prefer updating existing notes over creating duplicates.",
    "- Keep MEMORY.md as a short index of current durable notes only.",
    "- MEMORY.md must not have frontmatter. Each entry should stay on one line, around 150 characters or less, and should only point to note files.",
    "- Keep MEMORY.md under roughly 200 lines and 25KB by pruning stale pointers and moving detail back into topic notes.",
    "- When you touch a note, keep the note description, any dedupeKey, and the MEMORY.md index hook aligned so recall sees the same stable intent from index and note metadata.",
    "- Treat recent sessions and structured signals as point-in-time observations. If they conflict, rewrite the durable note to the most stable conclusion or leave the durable memory unchanged.",
    "",
    "## Phase Discipline",
    "- Orient: understand the current manifest and the small set of candidate note files.",
    "- Gather: read only the note files you may touch and extract stable signal from the provided summaries/signals.",
    "- Consolidate: create, rewrite, merge, or delete durable notes in a tight batch.",
    "- Prune: make sure MEMORY.md only points at the current durable notes and remove stale index entries.",
    "",
    "## Tooling Strategy",
    "- Start with memory_manifest_read unless the task input already provides enough manifest detail.",
    "- Use memory_note_read to inspect the exact note files you may update, plus MEMORY.md when needed.",
    "- Use memory_note_write to create a new note or replace a file completely.",
    "- Use memory_note_edit for targeted changes after reading a file.",
    "- Use memory_note_delete only when a durable note is clearly invalid, stale, superseded, or explicitly should be forgotten.",
    "- Use memory_transcript_search only to recover missing or stale summary signal, and keep queries targeted to the suspected durable fact.",
    "- If several note changes are needed, read all relevant candidates first, then finish the writes/edits in a tight batch.",
    "",
    "## Output",
    "Return a final report in exactly this shape:",
    "STATUS: WRITTEN | SKIPPED | NO_CHANGE | FAILED",
    "SUMMARY: one-line conclusion",
    "WRITTEN_COUNT: <number>",
    "UPDATED_COUNT: <number>",
    "DELETED_COUNT: <number>",
    "TOUCHED_NOTES: path1 | path2 | ...",
  ].join("\n");
}

export function buildDreamTaskPrompt(params: {
  scopeKey: string;
  triggerSource: string;
  lastSuccessAt?: number | null;
  recentSessions: DreamSessionSummary[];
  recentSignals?: DreamSignal[];
  transcriptFallback?: DreamTranscriptFallbackPlan;
  existingEntries: DurableMemoryManifestEntry[];
  dryRun?: boolean;
}): string {
  const manifestLines = params.existingEntries.length
    ? buildManifestLines(params.existingEntries, 32)
    : ["(none)"];
  const sessionLines = params.recentSessions.length
    ? params.recentSessions.map((entry, index) => {
        const summary = entry.summaryText.trim() || "(empty summary)";
        return `${index + 1}. session=${entry.sessionId} | updatedAt=${new Date(entry.updatedAt).toISOString()} | lastTurn=${entry.lastSummarizedTurn}\n   ${summary}`;
      })
    : ["(none)"];
  const signalLines = params.recentSignals?.length
    ? params.recentSignals.map(
        (entry, index) => `${index + 1}. session=${entry.sessionId} | ${entry.kind}: ${entry.text}`,
      )
    : ["(none)"];

  return [
    "Consolidate durable memory for the current scope using recent session summaries and scoped memory file tools only.",
    "",
    `Scope: ${params.scopeKey}`,
    `Trigger: ${params.triggerSource}`,
    `Mode: ${params.dryRun ? "dry-run preview (do not write files)" : "write"}`,
    formatAgeLine(params.lastSuccessAt),
    "",
    "Recent session summaries since the last successful dream run:",
    ...sessionLines,
    "",
    "Recent structured signals:",
    ...signalLines,
    "",
    ...buildTranscriptFallbackLines(params.transcriptFallback),
    "",
    "Existing durable memory manifest:",
    ...manifestLines,
    "",
    "Workflow:",
    "- Orient on the current manifest and identify the small set of note files that may need changes.",
    "- Gather recent signal from the provided session summaries first, then use the structured signals to confirm or sharpen consolidation candidates.",
    "- If transcript fallback is available and those inputs are insufficient, call memory_transcript_search with a narrow query and only the listed sessionIds.",
    "- Consolidate: merge duplicates, refine durable wording, prune stale or contradicted notes, and preserve durable categories.",
    "- Prune and index: keep MEMORY.md aligned with the current durable note set and short enough to scan quickly.",
    "- If Mode is dry-run preview, do not call any write/edit/delete tool; instead describe the intended changes and return STATUS: NO_CHANGE.",
    "",
    "If the recent signal does not justify any durable change, return STATUS: NO_CHANGE.",
  ].join("\n");
}

function emitDreamAction(params: {
  runId: string;
  actionId: string;
  sessionKey?: string;
  agentId?: string | null;
  status: "started" | "running" | "completed" | "failed";
  title: string;
  summary?: string;
  phase:
    | "orient"
    | "gather"
    | "running"
    | "failed_to_start"
    | "wait_failed"
    | "invalid_report"
    | "final";
  resultStatus?: "written" | "skipped" | "no_change" | "failed";
  detail?: Record<string, unknown>;
}) {
  const projection = buildMemoryActionVisibilityProjection({
    kind: "dream",
    phase: params.phase,
    summary: params.summary,
    resultStatus: params.resultStatus,
  });
  emitSpecialAgentActionEvent({
    emitAgentActionEvent: resolveDreamAgentDeps().emitAgentActionEvent,
    runId: params.runId,
    actionId: params.actionId,
    kind: "memory",
    sessionKey: params.sessionKey,
    agentId: params.agentId,
    status: params.status,
    title: params.title,
    summary: params.summary,
    projectedTitle: projection.projectedTitle,
    projectedSummary: projection.projectedSummary,
    detail: {
      memoryKind: "dream",
      memoryPhase: params.phase,
      ...(params.resultStatus ? { memoryResultStatus: params.resultStatus } : {}),
      ...params.detail,
    },
  });
}

export async function runDreamAgentOnce(
  params: DreamRunParams,
  logger?: RuntimeLogger,
): Promise<DreamRunResult> {
  const existingEntries = await scanDurableMemoryScopeEntries(params.scope);
  const { runtimeConfig, observability } = createConfiguredSpecialAgentObservability({
    definition: DREAM_AGENT_DEFINITION,
    sessionId: params.sessionId,
    ...(normalizeOptionalString(params.sessionKey)
      ? { sessionKey: normalizeOptionalString(params.sessionKey) }
      : {}),
    ...(normalizeOptionalString(params.scope.agentId)
      ? { agentId: normalizeOptionalString(params.scope.agentId) }
      : {}),
    ...(normalizeOptionalString(params.parentRunId)
      ? { parentRunId: normalizeOptionalString(params.parentRunId) }
      : {}),
  });
  const taskPrompt = buildDreamTaskPrompt({
    scopeKey: params.scope.scopeKey ?? "durable-memory",
    triggerSource: params.triggerSource,
    lastSuccessAt: params.lastSuccessAt,
    recentSessions: params.recentSessions,
    recentSignals: params.recentSignals,
    transcriptFallback: params.transcriptFallback,
    existingEntries,
    dryRun: params.dryRun,
  });

  const actionRunId = params.runId;
  const actionId = `${params.runId}:action`;
  emitDreamAction({
    runId: actionRunId,
    actionId: `${actionId}:orient`,
    sessionKey: params.sessionKey,
    agentId: params.scope.agentId,
    status: "started",
    title: "Dream orienting",
    summary: params.scope.scopeKey,
    phase: "orient",
    detail: {
      triggerSource: params.triggerSource,
      recentSessionCount: params.recentSessions.length,
      transcriptFallbackEnabled: params.transcriptFallback?.enabled === true,
    },
  });
  emitDreamAction({
    runId: actionRunId,
    actionId: `${actionId}:gather`,
    sessionKey: params.sessionKey,
    agentId: params.scope.agentId,
    status: "running",
    title: "Dream gathering signal",
    summary: params.scope.scopeKey,
    phase: "gather",
    detail: {
      recentSessionCount: params.recentSessions.length,
      recentSignalCount: params.recentSignals?.length ?? 0,
      transcriptFallbackEnabled: params.transcriptFallback?.enabled === true,
      transcriptFallbackSessionCount: params.transcriptFallback?.sessionIds.length ?? 0,
    },
  });

  const run = await runSpecialAgentToCompletion(
    {
      definition: DREAM_AGENT_DEFINITION,
      task: taskPrompt,
      extraSystemPrompt: buildDreamSystemPrompt(),
      ...(normalizeOptionalString(params.parentRunId) ? { parentRunId: params.parentRunId } : {}),
      embeddedContext: {
        sessionId: params.sessionId,
        ...(normalizeOptionalString(params.sessionKey)
          ? { sessionKey: normalizeOptionalString(params.sessionKey) }
          : {}),
        sessionFile: params.sessionFile,
        workspaceDir: params.workspaceDir,
        ...(normalizeOptionalString(params.scope.agentId)
          ? { agentId: normalizeOptionalString(params.scope.agentId) }
          : {}),
        ...(runtimeConfig ? { config: runtimeConfig } : {}),
        specialAgentContext: {
          durableMemoryScope: {
            agentId: params.scope.agentId,
            channel: decodeScopeSegment(params.scope.channel) ?? null,
            userId: decodeScopeSegment(params.scope.userId) ?? null,
          },
          ...(params.transcriptFallback?.enabled
            ? {
                transcriptSearch: {
                  sessionIds: params.transcriptFallback.sessionIds,
                  ...params.transcriptFallback.limits,
                },
              }
            : {}),
        },
      },
      spawnContext: params.sessionKey
        ? {
            agentSessionKey: params.sessionKey,
            ...(normalizeOptionalString(params.scope.channel)
              ? { agentChannel: normalizeOptionalString(params.scope.channel) }
              : {}),
            ...(normalizeOptionalString(params.scope.agentId)
              ? { requesterAgentIdOverride: normalizeOptionalString(params.scope.agentId) }
              : {}),
          }
        : undefined,
      spawnOverrides: {},
      hooks: observability.hooks,
    },
    resolveDreamAgentDeps(),
  );

  if (run.status === "spawn_failed") {
    const error = run.error;
    await observability.recordResult({
      result: run,
      status: "failed",
      summary: error,
    });
    emitDreamAction({
      runId: actionRunId,
      actionId,
      sessionKey: params.sessionKey,
      agentId: params.scope.agentId,
      status: "failed",
      title: "Dream failed to start",
      summary: error,
      phase: "failed_to_start",
      detail: buildSpecialAgentRunRefDetail(run),
    });
    return { status: "failed", summary: error, writtenCount: 0, updatedCount: 0, deletedCount: 0 };
  }

  emitDreamAction({
    runId: actionRunId,
    actionId: `${actionId}:consolidate`,
    sessionKey: params.sessionKey,
    agentId: params.scope.agentId,
    status: "running",
    title: "Dream running",
    summary: params.scope.scopeKey,
    phase: "running",
    detail: {
      ...buildSpecialAgentRunRefDetail(run),
      recentSessionCount: params.recentSessions.length,
      transcriptFallbackEnabled: params.transcriptFallback?.enabled === true,
    },
  });

  if (run.status === "wait_failed") {
    const error = run.error;
    await observability.recordResult({
      result: run,
      status: "failed",
      summary: error,
    });
    emitDreamAction({
      runId: actionRunId,
      actionId: `${actionId}:consolidate`,
      sessionKey: params.sessionKey,
      agentId: params.scope.agentId,
      status: "failed",
      title: "Dream did not complete",
      summary: error,
      phase: "wait_failed",
      detail: buildSpecialAgentWaitFailureDetail(run),
    });
    return { status: "failed", summary: error, writtenCount: 0, updatedCount: 0, deletedCount: 0 };
  }

  const parsed = parseDreamResult(run.reply);
  if (!parsed.status) {
    const error = "dream agent completed without a STATUS line";
    await observability.recordResult({
      result: run,
      status: "failed",
      summary: error,
    });
    emitDreamAction({
      runId: actionRunId,
      actionId: `${actionId}:consolidate`,
      sessionKey: params.sessionKey,
      agentId: params.scope.agentId,
      status: "failed",
      title: "Dream report invalid",
      summary: error,
      phase: "invalid_report",
    });
    return { status: "failed", summary: error, writtenCount: 0, updatedCount: 0, deletedCount: 0 };
  }

  const result: DreamRunResult = {
    status: parsed.status,
    summary: parsed.summary,
    writtenCount: parsed.writtenCount ?? 0,
    updatedCount: parsed.updatedCount ?? 0,
    deletedCount: parsed.deletedCount ?? 0,
    touchedNotes: parsed.touchedNotes ?? [],
  };

  emitDreamAction({
    runId: actionRunId,
    actionId: `${actionId}:prune`,
    sessionKey: params.sessionKey,
    agentId: params.scope.agentId,
    status: parsed.status === "failed" ? "failed" : "completed",
    title:
      parsed.status === "written"
        ? "Dream updated durable notes"
        : parsed.status === "skipped"
          ? "Dream skipped"
          : parsed.status === "no_change"
            ? "Dream found no changes"
            : "Dream failed",
    summary: parsed.summary,
    phase: "final",
    resultStatus: parsed.status,
    detail: buildSpecialAgentCompletionDetail({
      result: run,
      detail: {
        writtenCount: result.writtenCount,
        updatedCount: result.updatedCount,
        deletedCount: result.deletedCount,
        touchedNotes: result.touchedNotes ?? [],
        recentSessionCount: params.recentSessions.length,
        transcriptFallbackEnabled: params.transcriptFallback?.enabled === true,
        transcriptFallbackSessionCount: params.transcriptFallback?.sessionIds.length ?? 0,
      },
    }),
  });

  await observability.recordResult({
    result: run,
    status: parsed.status === "failed" ? "failed" : "complete",
    summary: parsed.summary,
    detail: {
      writtenCount: result.writtenCount,
      updatedCount: result.updatedCount,
      deletedCount: result.deletedCount,
      touchedNotes: result.touchedNotes ?? [],
      recentSessionCount: params.recentSessions.length,
      transcriptFallbackEnabled: params.transcriptFallback?.enabled === true,
      transcriptFallbackSessionCount: params.transcriptFallback?.sessionIds.length ?? 0,
    },
  });

  logger?.info(
    `[memory] dream status=${result.status} scope=${params.scope.scopeKey ?? "durable-memory"} written=${result.writtenCount} updated=${result.updatedCount} deleted=${result.deletedCount}`,
  );
  return result;
}

export const __testing = {
  setDepsForTest(overrides?: Partial<DreamAgentDeps>) {
    deps = overrides
      ? { ...createDefaultSpecialAgentActionRuntimeDeps(), ...overrides }
      : createDefaultSpecialAgentActionRuntimeDeps();
  },
};
