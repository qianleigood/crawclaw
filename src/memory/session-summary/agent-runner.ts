import { emitSpecialAgentActionEvent } from "../../agents/special/runtime/action-feed.js";
import { createConfiguredSpecialAgentObservability } from "../../agents/special/runtime/configured-observability.js";
import { createEmbeddedMemorySpecialAgentDefinition } from "../../agents/special/runtime/definition-presets.js";
import { type SpecialAgentParentForkContext } from "../../agents/special/runtime/parent-fork-context.js";
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
import { ensureSessionSummaryFile, readSessionSummaryFile } from "./store.ts";
import {
  buildSessionSummaryTemplate,
  renderSessionSummaryDocument,
  type SessionSummaryDocument,
} from "./template.ts";
import {
  SESSION_SUMMARY_LIGHT_SECTION_ORDER,
  SESSION_SUMMARY_SECTION_ORDER,
  getSessionSummarySectionHeading,
  getSessionSummarySectionText,
  type SessionSummaryProfile,
} from "./template.ts";

export const SESSION_SUMMARY_SPAWN_SOURCE = "session-summary";
export const SESSION_SUMMARY_TOOL_ALLOWLIST = [
  "session_summary_file_read",
  "session_summary_file_edit",
] as const;
export const SESSION_SUMMARY_AGENT_DEFINITION: SpecialAgentDefinition = {
  ...createEmbeddedMemorySpecialAgentDefinition({
    id: "session_summary",
    label: "session-summary",
    spawnSource: SESSION_SUMMARY_SPAWN_SOURCE,
    allowlist: SESSION_SUMMARY_TOOL_ALLOWLIST,
    modelVisibility: "allowlist",
    defaultRunTimeoutSeconds: 90,
    defaultMaxTurns: 5,
  }),
  cachePolicy: {
    cacheRetention: "short",
  },
};

type RuntimeLogger = { info(msg: string): void; warn(msg: string): void; error(msg: string): void };

type SessionSummaryAgentDeps = SpecialAgentActionRuntimeDeps;

let sessionSummaryAgentDeps: SessionSummaryAgentDeps | undefined;

function resolveSessionSummaryAgentDeps(): SessionSummaryAgentDeps {
  if (!sessionSummaryAgentDeps) {
    sessionSummaryAgentDeps = createDefaultSpecialAgentActionRuntimeDeps();
  }
  return sessionSummaryAgentDeps;
}

const MAX_SECTION_LENGTH = 2_000;
const MAX_TOTAL_SESSION_MEMORY_TOKENS = 12_000;

function normalizeOptionalString(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function parseOptionalCount(text: string, label: string): number | undefined {
  const match = text.match(new RegExp(`^\\s*\\**\\s*${label}:\\s*(\\d+)\\s*\\**\\s*$`, "im"));
  return match ? Number.parseInt(match[1] ?? "", 10) : undefined;
}

function analyzeSectionSizes(
  document: SessionSummaryDocument | null | undefined,
): Record<string, number> {
  const sizes: Record<string, number> = {};
  for (const key of SESSION_SUMMARY_SECTION_ORDER) {
    const text = getSessionSummarySectionText(document, key);
    if (!text.trim()) {
      continue;
    }
    sizes[getSessionSummarySectionHeading(key)] = Math.max(0, Math.ceil(text.length / 4));
  }
  return sizes;
}

function buildSessionSummaryBudgetReminder(
  document: SessionSummaryDocument | null | undefined,
): string {
  const rendered = document ? renderSessionSummaryDocument(document) : "";
  const totalTokens = Math.max(0, Math.ceil(rendered.length / 4));
  const sectionSizes = analyzeSectionSizes(document);
  const oversizedSections = Object.entries(sectionSizes)
    .filter(([, tokens]) => tokens > MAX_SECTION_LENGTH)
    .toSorted(([, left], [, right]) => right - left)
    .map(
      ([heading, tokens]) => `- "${heading}" is ~${tokens} tokens (limit: ${MAX_SECTION_LENGTH})`,
    );

  if (!oversizedSections.length && totalTokens <= MAX_TOTAL_SESSION_MEMORY_TOKENS) {
    return "";
  }

  const parts: string[] = [];
  if (totalTokens > MAX_TOTAL_SESSION_MEMORY_TOKENS) {
    parts.push(
      `CRITICAL: The summary file is currently ~${totalTokens} tokens, which exceeds the maximum of ${MAX_TOTAL_SESSION_MEMORY_TOKENS} tokens. You MUST condense it while preserving the highest-value details, especially Current State and Errors & Corrections.`,
    );
  }
  if (oversizedSections.length) {
    parts.push(
      [
        "IMPORTANT: The following sections exceed the per-section limit and MUST be condensed:",
        ...oversizedSections,
      ].join("\n"),
    );
  }
  return parts.join("\n\n");
}

type ParsedSessionSummaryResult = {
  status?: "written" | "skipped" | "no_change" | "failed";
  summary?: string;
  writtenCount?: number;
  updatedCount?: number;
};

function trimStructuredField(value: string | undefined): string | undefined {
  const trimmed = value
    ?.trim()
    .replace(/^\*+\s*/, "")
    .replace(/\s*\*+$/, "")
    .trim();
  return trimmed ? trimmed : undefined;
}

export type SessionSummaryRunResult = {
  status: "written" | "skipped" | "no_change" | "failed";
  summary?: string;
  writtenCount: number;
  updatedCount: number;
  reason?: string;
  childSessionKey?: string;
  runId?: string;
};

export function parseSessionSummaryResult(text: string): ParsedSessionSummaryResult {
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
      ? { status: statusMatch[1].trim().toLowerCase() as ParsedSessionSummaryResult["status"] }
      : {}),
    ...(summaryMatch ? { summary: trimStructuredField(summaryMatch[1]) } : {}),
    ...(parseOptionalCount(normalized, "WRITTEN_COUNT") !== undefined
      ? { writtenCount: parseOptionalCount(normalized, "WRITTEN_COUNT") }
      : {}),
    ...(parseOptionalCount(normalized, "UPDATED_COUNT") !== undefined
      ? { updatedCount: parseOptionalCount(normalized, "UPDATED_COUNT") }
      : {}),
  };
}

function emitSessionSummaryAction(params: {
  actionRunId: string;
  actionId: string;
  sessionKey: string;
  agentId?: string | null;
  status: "started" | "running" | "completed" | "blocked" | "failed";
  title: string;
  summary?: string;
  phase: "scheduled" | "running" | "failed_to_start" | "wait_failed" | "invalid_report" | "final";
  resultStatus?: "written" | "skipped" | "no_change" | "failed";
  detail?: Record<string, unknown>;
}) {
  const projection = buildMemoryActionVisibilityProjection({
    kind: "session_summary",
    phase: params.phase,
    summary: params.summary,
    resultStatus: params.resultStatus,
  });
  emitSpecialAgentActionEvent({
    emitAgentActionEvent: resolveSessionSummaryAgentDeps().emitAgentActionEvent,
    runId: params.actionRunId,
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
      memoryKind: "session_summary",
      memoryPhase: params.phase,
      ...(params.resultStatus ? { memoryResultStatus: params.resultStatus } : {}),
      ...params.detail,
    },
  });
}

export function buildSessionSummaryTaskPrompt(params: {
  sessionId: string;
  summaryPath: string;
  currentSummary: SessionSummaryDocument | null;
  profile?: SessionSummaryProfile;
  maxSectionsToChange?: number;
}): string {
  const profile = params.profile ?? "full";
  const prioritizedSections =
    profile === "light"
      ? SESSION_SUMMARY_LIGHT_SECTION_ORDER
      : SESSION_SUMMARY_SECTION_ORDER.filter((key) => key !== "sessionTitle");
  const currentSummaryText = params.currentSummary
    ? renderSessionSummaryDocument(params.currentSummary)
    : buildSessionSummaryTemplate({ sessionId: params.sessionId });
  const budgetReminder = buildSessionSummaryBudgetReminder(params.currentSummary);
  const sectionCount = params.currentSummary
    ? Object.values(params.currentSummary.sections).filter((value) => (value ?? []).length > 0)
        .length
    : 0;

  return [
    "IMPORTANT: This message and these instructions are NOT part of the actual user conversation.",
    'Do NOT include any references to "note-taking", "session summary extraction", or these update instructions in the summary content.',
    "",
    "Use the forked parent conversation that is already available in this agent run to update the session summary file.",
    "",
    `Session ID: ${params.sessionId}`,
    `Summary profile: ${profile.toUpperCase()}`,
    `Summary file: ${params.summaryPath}`,
    `Current populated sections: ${sectionCount}`,
    `Max sections to change: ${Math.max(1, params.maxSectionsToChange ?? 4)}`,
    `Prioritized sections: ${prioritizedSections.map((key) => getSessionSummarySectionHeading(key)).join(", ")}`,
    "",
    "The file has already been read for you. Here are its current contents:",
    "<current_summary_content>",
    currentSummaryText.trimEnd(),
    "</current_summary_content>",
    "",
    "Your ONLY task is to use the session_summary_file_edit tool to update the summary file, then stop.",
    "You can make multiple edits. If multiple sections need updates, make all edit calls in parallel in a single message.",
    "Do not call any other tools.",
    "",
    ...(profile === "light"
      ? [
          "LIGHT profile runs:",
          "- Prioritize only these sections during this run: Current State, Open Loops, Task specification, Key results.",
          "- Leave the other sections unchanged unless they contain a materially misleading stale statement that must be corrected now.",
          "",
        ]
      : [
          "FULL profile runs:",
          "- Maintain the full structured working-memory document.",
          "- Prioritize Current State, Open Loops, Workflow, Errors & Corrections, Files and Functions, and Key results when the conversation context justifies updates.",
          "",
        ]),
    "CRITICAL RULES FOR EDITING:",
    "- The file must maintain its exact structure with all sections, headers, and italic descriptions intact.",
    "- NEVER modify, delete, or add section headers.",
    "- NEVER modify or delete the italic section description lines.",
    "- The italic section description lines are TEMPLATE INSTRUCTIONS and must be preserved exactly as-is.",
    "- ONLY update the actual content that appears BELOW the italic section description lines within each existing section.",
    "- Do NOT add any new sections, summaries, or information outside the existing structure.",
    "- Do NOT reference this note-taking process or these instructions anywhere in the summary.",
    "- It is OK to skip updating a section if there are no substantial new insights to add. Do not add filler content.",
    "- Write DETAILED, INFO-DENSE content for each section, including specifics like file paths, function names, error messages, exact commands, and technical details.",
    '- For "Key results", include the complete, exact output the user requested when that matters.',
    "- Keep each section under control by condensing lower-value detail while preserving the most critical information.",
    "- Focus on actionable, specific information that would help someone understand or recreate the work discussed in the conversation.",
    '- IMPORTANT: Always update "Current State" to reflect the most recent work.',
    "",
    "STRUCTURE PRESERVATION REMINDER:",
    "Each section has TWO parts that must be preserved exactly as they appear in the current file:",
    "1. The section header line",
    "2. The italic description line immediately after the header",
    "",
    "You ONLY update the actual content that comes AFTER these two preserved lines.",
    "If there is no substantial update from the conversation context, return STATUS: NO_CHANGE.",
    ...(budgetReminder ? ["", budgetReminder] : []),
  ].join("\n");
}

export async function runSessionSummaryAgentOnce(params: {
  sessionId: string;
  sessionKey: string;
  sessionFile: string;
  workspaceDir: string;
  agentId: string;
  parentForkContext?: SpecialAgentParentForkContext;
  currentSummary?: SessionSummaryDocument | null;
  profile?: SessionSummaryProfile;
  runTimeoutSeconds?: number;
  maxTurns?: number;
  logger?: RuntimeLogger;
}): Promise<SessionSummaryRunResult> {
  const logger = params.logger ?? console;
  const summaryFileSnapshot = await ensureSessionSummaryFile({
    agentId: params.agentId,
    sessionId: params.sessionId,
  });
  const summarySnapshot = params.currentSummary ?? summaryFileSnapshot.document;
  const parentPromptEnvelope = params.parentForkContext?.promptEnvelope;
  if (!parentPromptEnvelope?.forkContextMessages.length) {
    const reason = "session summary requires a parent fork context";
    logger.warn(`[memory] session summary skipped sessionId=${params.sessionId} reason=${reason}`);
    return {
      status: "failed",
      writtenCount: 0,
      updatedCount: 0,
      reason,
    };
  }
  const taskPrompt = buildSessionSummaryTaskPrompt({
    sessionId: params.sessionId,
    summaryPath: summaryFileSnapshot.summaryPath,
    currentSummary: summarySnapshot,
    profile: params.profile,
    maxSectionsToChange: params.profile === "light" ? 4 : 6,
  });
  const { runtimeConfig, observability } = createConfiguredSpecialAgentObservability({
    definition: SESSION_SUMMARY_AGENT_DEFINITION,
    sessionId: params.sessionId,
    sessionKey: params.sessionKey,
    agentId: params.agentId,
    ...(normalizeOptionalString(params.parentForkContext?.parentRunId)
      ? { parentRunId: normalizeOptionalString(params.parentForkContext?.parentRunId) }
      : {}),
  });
  const actionRunId = `session-summary:${params.sessionId}`;
  const actionId = `session-summary:${params.sessionId}`;
  emitSessionSummaryAction({
    actionRunId,
    actionId,
    sessionKey: params.sessionKey,
    agentId: params.agentId,
    status: "started",
    title: "Session summary scheduled",
    summary: params.sessionId,
    phase: "scheduled",
    detail: {
      modelVisibleMessageCount: parentPromptEnvelope.forkContextMessages.length,
    },
  });

  const run = await runSpecialAgentToCompletion(
    {
      definition: SESSION_SUMMARY_AGENT_DEFINITION,
      task: taskPrompt,
      ...(normalizeOptionalString(params.parentForkContext?.parentRunId)
        ? { parentRunId: params.parentForkContext?.parentRunId }
        : {}),
      parentForkContext: params.parentForkContext,
      embeddedContext: {
        sessionId: params.sessionId,
        sessionKey: params.sessionKey,
        sessionFile: params.sessionFile,
        workspaceDir: params.workspaceDir,
        agentId: params.agentId,
        ...(runtimeConfig ? { config: runtimeConfig } : {}),
        specialAgentContext: {
          sessionSummaryTarget: {
            agentId: params.agentId,
            sessionId: params.sessionId,
          },
        },
      },
      spawnContext: {
        agentSessionKey: params.sessionKey,
        requesterAgentIdOverride: params.agentId,
      },
      spawnOverrides: {
        runTimeoutSeconds: params.runTimeoutSeconds,
        maxTurns: params.maxTurns,
      },
      hooks: observability.hooks,
    },
    resolveSessionSummaryAgentDeps(),
  );

  if (run.status === "spawn_failed") {
    const error = run.error;
    await observability.recordResult({
      result: run,
      status: "failed",
      summary: error,
    });
    emitSessionSummaryAction({
      actionRunId,
      actionId,
      sessionKey: params.sessionKey,
      agentId: params.agentId,
      status: "failed",
      title: "Session summary failed to start",
      summary: error,
      phase: "failed_to_start",
      detail: buildSpecialAgentRunRefDetail(run),
    });
    return {
      status: "failed",
      writtenCount: 0,
      updatedCount: 0,
      reason: error,
    };
  }

  emitSessionSummaryAction({
    actionRunId,
    actionId,
    sessionKey: params.sessionKey,
    agentId: params.agentId,
    status: "running",
    title: "Session summary running",
    summary: params.sessionId,
    phase: "running",
    detail: buildSpecialAgentRunRefDetail(run),
  });

  if (run.status === "wait_failed") {
    const error = run.error;
    await observability.recordResult({
      result: run,
      status: "failed",
      summary: error,
    });
    emitSessionSummaryAction({
      actionRunId,
      actionId,
      sessionKey: params.sessionKey,
      agentId: params.agentId,
      status: "failed",
      title: "Session summary did not complete",
      summary: error,
      phase: "wait_failed",
      detail: buildSpecialAgentWaitFailureDetail(run),
    });
    return {
      status: "failed",
      writtenCount: 0,
      updatedCount: 0,
      reason: error,
      childSessionKey: run.childSessionKey,
      runId: run.runId,
    };
  }

  const parsed = parseSessionSummaryResult(run.reply);
  if (!parsed.status) {
    const refreshedSummary = await readSessionSummaryFile({
      agentId: params.agentId,
      sessionId: params.sessionId,
    });
    if ((refreshedSummary.content ?? "") !== (summaryFileSnapshot.content ?? "")) {
      parsed.status = "written";
      parsed.summary = "summary file updated";
      parsed.writtenCount = 1;
      parsed.updatedCount = 0;
    }
  }
  if (!parsed.status) {
    const error = "session summary agent completed without a STATUS line";
    await observability.recordResult({
      result: run,
      status: "failed",
      summary: error,
    });
    emitSessionSummaryAction({
      actionRunId,
      actionId,
      sessionKey: params.sessionKey,
      agentId: params.agentId,
      status: "failed",
      title: "Session summary report invalid",
      summary: error,
      phase: "invalid_report",
      detail: buildSpecialAgentRunRefDetail(run),
    });
    return {
      status: "failed",
      writtenCount: 0,
      updatedCount: 0,
      reason: error,
      childSessionKey: run.childSessionKey,
      runId: run.runId,
    };
  }

  const writtenCount = parsed.writtenCount ?? 0;
  const updatedCount = parsed.updatedCount ?? 0;
  const status =
    parsed.status === "failed"
      ? "failed"
      : parsed.status === "skipped"
        ? "skipped"
        : parsed.status === "no_change"
          ? "no_change"
          : "written";

  emitSessionSummaryAction({
    actionRunId,
    actionId,
    sessionKey: params.sessionKey,
    agentId: params.agentId,
    status: status === "failed" ? "failed" : "completed",
    title:
      status === "written"
        ? "Session summary updated"
        : status === "skipped"
          ? "Session summary skipped"
          : status === "no_change"
            ? "Session summary unchanged"
            : "Session summary failed",
    summary: parsed.summary,
    phase: "final",
    resultStatus: status === "written" ? "written" : status,
    detail: buildSpecialAgentCompletionDetail({
      result: run,
      detail: {
        writtenCount,
        updatedCount,
      },
    }),
  });

  await observability.recordResult({
    result: run,
    status: status === "failed" ? "failed" : "complete",
    summary: parsed.summary,
    detail: {
      writtenCount,
      updatedCount,
    },
  });

  logger.info(
    `[memory] session summary run sessionId=${params.sessionId} status=${status} ` +
      `written=${writtenCount} updated=${updatedCount}`,
  );

  return {
    status,
    summary: parsed.summary,
    writtenCount,
    updatedCount,
    reason: parsed.summary,
    childSessionKey: run.childSessionKey,
    runId: run.runId,
  };
}

export const __testing = {
  setDepsForTest(overrides?: Partial<SessionSummaryAgentDeps>) {
    sessionSummaryAgentDeps = overrides
      ? {
          ...createDefaultSpecialAgentActionRuntimeDeps(),
          ...overrides,
        }
      : createDefaultSpecialAgentActionRuntimeDeps();
  },
  resetDepsForTest() {
    sessionSummaryAgentDeps = undefined;
  },
};
