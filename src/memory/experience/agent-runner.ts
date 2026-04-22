import type { AgentMessage } from "@mariozechner/pi-agent-core";
import { createConfiguredSpecialAgentObservability } from "../../agents/special/runtime/configured-observability.js";
import { createEmbeddedMemorySpecialAgentDefinition } from "../../agents/special/runtime/definition-presets.js";
import type { SpecialAgentParentForkContext } from "../../agents/special/runtime/parent-fork-context.js";
import { buildSpecialAgentCompletionDetail } from "../../agents/special/runtime/result-detail.js";
import { runSpecialAgentToCompletion } from "../../agents/special/runtime/run-once.js";
import {
  createDefaultSpecialAgentActionRuntimeDeps,
  type SpecialAgentActionRuntimeDeps,
} from "../../agents/special/runtime/runtime-deps.js";
import type { SpecialAgentDefinition } from "../../agents/special/runtime/types.js";
import type { DurableMemoryScope } from "../durable/scope.js";
import { readSessionSummaryFile } from "../session-summary/store.js";
import { readExperienceIndexEntries, type ExperienceIndexEntry } from "./index-store.js";

export const EXPERIENCE_SPAWN_SOURCE = "experience";
export const EXPERIENCE_TOOL_ALLOWLIST = ["write_experience_note"] as const;
export const EXPERIENCE_AGENT_DEFINITION: SpecialAgentDefinition =
  createEmbeddedMemorySpecialAgentDefinition({
    id: "experience",
    label: "experience",
    spawnSource: EXPERIENCE_SPAWN_SOURCE,
    allowlist: EXPERIENCE_TOOL_ALLOWLIST,
    defaultRunTimeoutSeconds: 90,
    defaultMaxTurns: 5,
  });

export type ExperienceExtractionRunParams = {
  runId: string;
  sessionId: string;
  sessionKey: string;
  sessionFile: string;
  workspaceDir: string;
  scope: DurableMemoryScope;
  parentRunId?: string;
  parentForkContext?: SpecialAgentParentForkContext;
  messageCursor: number;
  recentMessages: AgentMessage[];
  recentMessageLimit: number;
  maxNotes: number;
};

export type ExperienceExtractionRunResult = {
  status: "written" | "skipped" | "no_change" | "failed";
  summary?: string;
  writtenCount: number;
  updatedCount: number;
  deletedCount: number;
  touchedNotes?: string[];
  advanceCursor: boolean;
};

type ParsedExperienceExtractionResult = Partial<
  Omit<ExperienceExtractionRunResult, "advanceCursor">
>;

type ExperienceAgentDeps = SpecialAgentActionRuntimeDeps;

let deps: ExperienceAgentDeps | undefined;

function resolveExperienceAgentDeps(): ExperienceAgentDeps {
  if (!deps) {
    deps = createDefaultSpecialAgentActionRuntimeDeps();
  }
  return deps;
}

function normalizeOptionalString(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

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

export function parseExperienceExtractionResult(text: string): ParsedExperienceExtractionResult {
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
      ? {
          status: statusMatch[1].trim().toLowerCase() as ExperienceExtractionRunResult["status"],
        }
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

function stringifyMessageContent(content: unknown): string {
  if (typeof content === "string") {
    return content.replace(/\s+/g, " ").trim();
  }
  if (Array.isArray(content)) {
    return content
      .map((part) =>
        part && typeof part === "object" && typeof (part as { text?: unknown }).text === "string"
          ? (part as { text: string }).text
          : "",
      )
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
  }
  return "";
}

function formatRecentMessages(messages: AgentMessage[], limit: number): string[] {
  return messages.slice(-Math.max(1, limit)).flatMap((message) => {
    const rawRole = (message as { role?: unknown }).role;
    const role = typeof rawRole === "string" ? rawRole : "unknown";
    const text = stringifyMessageContent((message as { content?: unknown }).content);
    return text ? [`- ${role}: ${text}`] : [];
  });
}

function buildExperienceIndexLines(entries: ExperienceIndexEntry[], limit: number): string[] {
  return entries.slice(0, Math.max(1, limit)).map((entry, index) => {
    const dedupeText = entry.dedupeKey ? ` | dedupeKey=${entry.dedupeKey}` : "";
    return `${index + 1}. type=${entry.type} | title=${entry.title} | summary=${entry.summary}${dedupeText}`;
  });
}

export function buildExperienceExtractionSystemPrompt(): string {
  return [
    "# Experience Agent",
    "",
    "You are a dedicated background experience-memory agent.",
    "",
    "## Mission",
    "- Extract reusable, verified experience from the just-finished top-level task.",
    "- Capture context, trigger, action, result, lesson, applicability boundaries, evidence, confidence, and a stable dedupeKey.",
    "- Prefer updating an existing experience note over creating a duplicate.",
    "",
    "## Constraints",
    "- Use only write_experience_note.",
    "- Do NOT inspect project source files, run shell commands, browse the web, or spawn other agents.",
    "- Do NOT write durable memory. This task is only for experience memory.",
    "- Do NOT store user preferences, temporary progress, chat transcript fragments, or unverified guesses.",
    "- The provided recent messages and session summary are the source of truth.",
    "",
    "## Output",
    "Return a final report in exactly this shape:",
    "STATUS: WRITTEN | SKIPPED | NO_CHANGE | FAILED",
    "SUMMARY: one-line conclusion",
    "WRITTEN_COUNT: <number>",
    "UPDATED_COUNT: <number>",
    "DELETED_COUNT: <number>",
    "TOUCHED_NOTES: note1 | note2 | ...",
  ].join("\n");
}

export function buildExperienceExtractionTaskPrompt(params: {
  scopeKey: string;
  recentMessages: AgentMessage[];
  sessionSummary?: string | null;
  existingEntries: ExperienceIndexEntry[];
  maxNotes: number;
}): string {
  const recentLines = formatRecentMessages(params.recentMessages, 24);
  const indexLines = params.existingEntries.length
    ? buildExperienceIndexLines(params.existingEntries, 24)
    : ["(none)"];
  return [
    "Extract reusable experience from the completed task, then write only validated experience notes.",
    "",
    `Scope: ${params.scopeKey}`,
    `Max experience notes to create or update: ${Math.max(1, params.maxNotes)}`,
    "",
    "Session summary:",
    params.sessionSummary?.trim() || "(none)",
    "",
    "Recent model-visible messages:",
    ...(recentLines.length ? recentLines : ["(none)"]),
    "",
    "Existing experience index:",
    ...indexLines,
    "",
    "Write a note only when the task produced a reusable, validated procedure, decision, runtime pattern, failure pattern, workflow pattern, or reference.",
    "If the signal is only a user preference, task status, temporary workaround, or unverified thought, do nothing and return STATUS: NO_CHANGE.",
  ].join("\n");
}

export async function runExperienceExtractionAgentOnce(
  params: ExperienceExtractionRunParams,
): Promise<ExperienceExtractionRunResult> {
  const existingEntries = await readExperienceIndexEntries(80);
  const sessionSummary = await readSessionSummaryFile({
    agentId: params.scope.agentId,
    sessionId: params.sessionId,
  });
  const parentRunId =
    normalizeOptionalString(params.parentRunId) ??
    normalizeOptionalString(params.parentForkContext?.parentRunId);
  const { runtimeConfig, observability } = createConfiguredSpecialAgentObservability({
    definition: EXPERIENCE_AGENT_DEFINITION,
    sessionId: params.sessionId,
    sessionKey: params.sessionKey,
    ...(normalizeOptionalString(params.scope.agentId)
      ? { agentId: normalizeOptionalString(params.scope.agentId) }
      : {}),
    ...(parentRunId ? { parentRunId } : {}),
  });
  const run = await runSpecialAgentToCompletion(
    {
      definition: EXPERIENCE_AGENT_DEFINITION,
      task: buildExperienceExtractionTaskPrompt({
        scopeKey: params.scope.scopeKey ?? "experience",
        recentMessages: params.recentMessages,
        sessionSummary: sessionSummary.content,
        existingEntries,
        maxNotes: params.maxNotes,
      }),
      extraSystemPrompt: buildExperienceExtractionSystemPrompt(),
      ...(parentRunId ? { parentRunId } : {}),
      ...(params.parentForkContext ? { parentForkContext: params.parentForkContext } : {}),
      embeddedContext: {
        sessionId: params.sessionId,
        sessionKey: params.sessionKey,
        sessionFile: params.sessionFile,
        workspaceDir: params.workspaceDir,
        ...(normalizeOptionalString(params.scope.agentId)
          ? { agentId: normalizeOptionalString(params.scope.agentId) }
          : {}),
        ...(runtimeConfig ? { config: runtimeConfig } : {}),
      },
      spawnContext: {
        agentSessionKey: params.sessionKey,
      },
      spawnOverrides: {},
      hooks: observability.hooks,
    },
    resolveExperienceAgentDeps(),
  );
  if (run.status === "spawn_failed" || run.status === "wait_failed") {
    const summary = run.error ?? "experience extraction failed";
    await observability.recordResult({ result: run, status: "failed", summary });
    return {
      status: "failed",
      summary,
      writtenCount: 0,
      updatedCount: 0,
      deletedCount: 0,
      advanceCursor: false,
    };
  }
  const parsed = parseExperienceExtractionResult(run.reply);
  if (!parsed.status) {
    const summary = "experience agent completed without a STATUS line";
    await observability.recordResult({ result: run, status: "failed", summary });
    return {
      status: "failed",
      summary,
      writtenCount: 0,
      updatedCount: 0,
      deletedCount: 0,
      advanceCursor: false,
    };
  }
  const result = {
    status: parsed.status,
    summary: parsed.summary,
    writtenCount: parsed.writtenCount ?? 0,
    updatedCount: parsed.updatedCount ?? 0,
    deletedCount: parsed.deletedCount ?? 0,
    touchedNotes: parsed.touchedNotes ?? [],
    advanceCursor: parsed.status !== "failed",
  } satisfies ExperienceExtractionRunResult;
  await observability.recordResult({
    result: run,
    status: result.status === "failed" ? "failed" : "complete",
    summary: result.summary,
    detail: buildSpecialAgentCompletionDetail({
      result: run,
      detail: {
        writtenCount: result.writtenCount,
        updatedCount: result.updatedCount,
        deletedCount: result.deletedCount,
        touchedNotes: result.touchedNotes,
      },
    }),
  });
  return result;
}

export const __testing = {
  setDepsForTest(overrides?: Partial<ExperienceAgentDeps>) {
    deps = overrides
      ? {
          ...createDefaultSpecialAgentActionRuntimeDeps(),
          ...overrides,
        }
      : createDefaultSpecialAgentActionRuntimeDeps();
  },
};
