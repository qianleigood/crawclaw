import fs from "node:fs";
import path from "node:path";
import { resolveStateDir } from "../../config/paths.js";
import {
  getAgentRunContext,
  onAgentEvent,
  type AgentEventPayload,
} from "../../infra/agent-events.js";
import { writeJsonAtomic } from "../../infra/json-files.js";
import { createSubsystemLogger } from "../../logging/subsystem.js";
import { resolveGlobalSingleton } from "../../shared/global-singleton.js";
import { getTaskById, listTasksForParentAgentId } from "../../tasks/runtime-internal.js";
import type { AgentTaskMode, TaskRuntime } from "../../tasks/task-registry.types.js";
import { emitAgentActionEvent } from "../action-feed/emit.js";
import {
  captureContextArchiveRunEvent,
  updateContextArchiveRunState,
} from "../context-archive/run-capture.js";
import {
  resolveAgentTaskTrajectoryPath,
  resolveAgentTaskTrajectoryRef,
} from "../runtime/agent-metadata-store.js";
import type { AgentProgressEvent } from "../runtime/agent-progress.js";
import type { AgentRuntimeStatus } from "../runtime/agent-runtime-state.js";
import { getAgentRuntimeState } from "../runtime/agent-runtime-state.js";
import { parseVerificationReport, VERIFICATION_SPAWN_SOURCE } from "../verification-agent.js";
import type { CompletionEvidence } from "./completion-evidence.js";
import { evaluateCompletionGuard, type CompletionGuardResult } from "./completion-guard.js";
import { buildCompletionActionVisibilityProjection } from "./completion-visibility.js";

const log = createSubsystemLogger("agents/task-trajectory");

export type TaskTrajectoryStepKind = "tool" | "assistant";
export type TaskTrajectoryStepStatus = "running" | "completed" | "failed";

export type TaskStepTrace = {
  stepId: string;
  kind: TaskTrajectoryStepKind;
  title: string;
  status: TaskTrajectoryStepStatus;
  startedAt: number;
  endedAt?: number;
  summary?: string;
  toolName?: string;
  toolCallId?: string;
  isError?: boolean;
};

export type TaskTrajectory = {
  version: 1;
  taskId: string;
  runId: string;
  runtime?: TaskRuntime;
  mode?: AgentTaskMode;
  agentId?: string;
  parentAgentId?: string;
  sessionId?: string;
  sessionKey?: string;
  status: AgentRuntimeStatus;
  startedAt: number;
  updatedAt: number;
  completedAt?: number;
  steps: TaskStepTrace[];
  evidence: CompletionEvidence[];
  completion?: CompletionGuardResult;
};

type TaskTrajectoryRunState = {
  activeToolInputs: Map<string, unknown>;
  lastAssistantText?: string;
  trajectory?: TaskTrajectory;
  persistQueue: Promise<void>;
};

type TaskTrajectoryState = {
  bridgeStop?: () => void;
  byRunId: Map<string, TaskTrajectoryRunState>;
};

const TASK_TRAJECTORY_STATE_KEY = Symbol.for("crawclaw.taskTrajectory.state");
const TASK_TRAJECTORY_VERSION = 1 as const;

const FILE_MUTATION_TOOL_NAMES = new Set([
  "apply_patch",
  "create_file",
  "delete_file",
  "edit",
  "multi_edit",
  "patch",
  "rename_file",
  "replace",
  "str_replace_editor",
  "write",
]);

function getTaskTrajectoryState(): TaskTrajectoryState {
  return resolveGlobalSingleton<TaskTrajectoryState>(TASK_TRAJECTORY_STATE_KEY, () => ({
    byRunId: new Map<string, TaskTrajectoryRunState>(),
  }));
}

function getRunState(runId: string): TaskTrajectoryRunState {
  const state = getTaskTrajectoryState();
  let existing = state.byRunId.get(runId);
  if (!existing) {
    existing = {
      activeToolInputs: new Map<string, unknown>(),
      persistQueue: Promise.resolve(),
    };
    state.byRunId.set(runId, existing);
  }
  return existing;
}

function normalizeOptionalString(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function truncateText(value: string, maxChars = 240): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxChars) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(1, maxChars - 1)).trimEnd()}…`;
}

function normalizeTaskTrajectory(value: unknown): TaskTrajectory | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  if (record.version !== TASK_TRAJECTORY_VERSION) {
    return undefined;
  }
  const taskId = normalizeOptionalString(
    typeof record.taskId === "string" ? record.taskId : undefined,
  );
  const runId = normalizeOptionalString(
    typeof record.runId === "string" ? record.runId : undefined,
  );
  const status =
    record.status === "created" ||
    record.status === "running" ||
    record.status === "waiting" ||
    record.status === "completed" ||
    record.status === "failed" ||
    record.status === "cancelled"
      ? record.status
      : undefined;
  const startedAt =
    typeof record.startedAt === "number" && Number.isFinite(record.startedAt)
      ? record.startedAt
      : undefined;
  const updatedAt =
    typeof record.updatedAt === "number" && Number.isFinite(record.updatedAt)
      ? record.updatedAt
      : undefined;
  if (!taskId || !runId || !status || startedAt == null || updatedAt == null) {
    return undefined;
  }
  const steps = Array.isArray(record.steps)
    ? record.steps
        .map((entry) => normalizeTaskStepTrace(entry))
        .filter((entry): entry is TaskStepTrace => Boolean(entry))
    : [];
  const evidence = Array.isArray(record.evidence)
    ? record.evidence
        .map((entry) => normalizeCompletionEvidence(entry))
        .filter((entry): entry is CompletionEvidence => Boolean(entry))
    : [];
  const completion = normalizeCompletionGuardResult(record.completion);
  return {
    version: TASK_TRAJECTORY_VERSION,
    taskId,
    runId,
    ...(record.runtime === "subagent" ||
    record.runtime === "acp" ||
    record.runtime === "cli" ||
    record.runtime === "cron"
      ? { runtime: record.runtime }
      : {}),
    ...(record.mode === "foreground" || record.mode === "background" ? { mode: record.mode } : {}),
    ...(normalizeOptionalString(typeof record.agentId === "string" ? record.agentId : undefined)
      ? { agentId: normalizeOptionalString(record.agentId as string) }
      : {}),
    ...(normalizeOptionalString(
      typeof record.parentAgentId === "string" ? record.parentAgentId : undefined,
    )
      ? { parentAgentId: normalizeOptionalString(record.parentAgentId as string) }
      : {}),
    ...(normalizeOptionalString(typeof record.sessionId === "string" ? record.sessionId : undefined)
      ? { sessionId: normalizeOptionalString(record.sessionId as string) }
      : {}),
    ...(normalizeOptionalString(
      typeof record.sessionKey === "string" ? record.sessionKey : undefined,
    )
      ? { sessionKey: normalizeOptionalString(record.sessionKey as string) }
      : {}),
    status,
    startedAt,
    updatedAt,
    ...(typeof record.completedAt === "number" && Number.isFinite(record.completedAt)
      ? { completedAt: record.completedAt }
      : {}),
    steps,
    evidence,
    ...(completion ? { completion } : {}),
  };
}

function normalizeTaskStepTrace(value: unknown): TaskStepTrace | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const stepId = normalizeOptionalString(
    typeof record.stepId === "string" ? record.stepId : undefined,
  );
  const kind = record.kind === "tool" || record.kind === "assistant" ? record.kind : undefined;
  const title = normalizeOptionalString(
    typeof record.title === "string" ? record.title : undefined,
  );
  const status =
    record.status === "running" || record.status === "completed" || record.status === "failed"
      ? record.status
      : undefined;
  const startedAt =
    typeof record.startedAt === "number" && Number.isFinite(record.startedAt)
      ? record.startedAt
      : undefined;
  if (!stepId || !kind || !title || !status || startedAt == null) {
    return undefined;
  }
  return {
    stepId,
    kind,
    title,
    status,
    startedAt,
    ...(typeof record.endedAt === "number" && Number.isFinite(record.endedAt)
      ? { endedAt: record.endedAt }
      : {}),
    ...(normalizeOptionalString(typeof record.summary === "string" ? record.summary : undefined)
      ? { summary: normalizeOptionalString(record.summary as string) }
      : {}),
    ...(normalizeOptionalString(typeof record.toolName === "string" ? record.toolName : undefined)
      ? { toolName: normalizeOptionalString(record.toolName as string) }
      : {}),
    ...(normalizeOptionalString(
      typeof record.toolCallId === "string" ? record.toolCallId : undefined,
    )
      ? { toolCallId: normalizeOptionalString(record.toolCallId as string) }
      : {}),
    ...(record.isError === true ? { isError: true } : {}),
  };
}

function normalizeCompletionEvidence(value: unknown): CompletionEvidence | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const kind =
    record.kind === "answer_provided" ||
    record.kind === "file_changed" ||
    record.kind === "test_passed" ||
    record.kind === "assertion_met" ||
    record.kind === "external_state_changed" ||
    record.kind === "user_confirmed"
      ? record.kind
      : undefined;
  const at = typeof record.at === "number" && Number.isFinite(record.at) ? record.at : undefined;
  const summary = normalizeOptionalString(
    typeof record.summary === "string" ? record.summary : undefined,
  );
  if (!kind || at == null || !summary) {
    return undefined;
  }
  return {
    kind,
    at,
    summary,
    ...(normalizeOptionalString(typeof record.toolName === "string" ? record.toolName : undefined)
      ? { toolName: normalizeOptionalString(record.toolName as string) }
      : {}),
    ...(normalizeOptionalString(
      typeof record.toolCallId === "string" ? record.toolCallId : undefined,
    )
      ? { toolCallId: normalizeOptionalString(record.toolCallId as string) }
      : {}),
    ...(normalizeOptionalString(typeof record.path === "string" ? record.path : undefined)
      ? { path: normalizeOptionalString(record.path as string) }
      : {}),
    ...(normalizeOptionalString(typeof record.command === "string" ? record.command : undefined)
      ? { command: normalizeOptionalString(record.command as string) }
      : {}),
    ...(typeof record.confidence === "number" && Number.isFinite(record.confidence)
      ? { confidence: record.confidence }
      : {}),
    ...(record.source === "assistant" || record.source === "tool" || record.source === "user"
      ? { source: record.source }
      : {}),
  };
}

function normalizeCompletionGuardResult(value: unknown): CompletionGuardResult | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const version = record.version === 1 ? record.version : undefined;
  const evaluatedAt =
    typeof record.evaluatedAt === "number" && Number.isFinite(record.evaluatedAt)
      ? record.evaluatedAt
      : undefined;
  const status =
    record.status === "accepted" ||
    record.status === "accepted_with_warnings" ||
    record.status === "waiting_user" ||
    record.status === "waiting_external" ||
    record.status === "incomplete"
      ? record.status
      : undefined;
  const summary = normalizeOptionalString(
    typeof record.summary === "string" ? record.summary : undefined,
  );
  const specRecord = record.spec;
  if (
    !version ||
    evaluatedAt == null ||
    !status ||
    !summary ||
    !specRecord ||
    typeof specRecord !== "object"
  ) {
    return undefined;
  }
  const spec = normalizeCompletionSpec(specRecord);
  if (!spec) {
    return undefined;
  }
  const satisfiedEvidence = normalizeCompletionEvidenceKindArray(record.satisfiedEvidence);
  const missingEvidence = normalizeCompletionEvidenceKindArray(record.missingEvidence);
  const missingAnyOfEvidence = normalizeCompletionEvidenceKindArray(record.missingAnyOfEvidence);
  const warnings = Array.isArray(record.warnings)
    ? record.warnings
        .map((entry) => normalizeOptionalString(typeof entry === "string" ? entry : undefined))
        .filter((entry): entry is string => Boolean(entry))
    : [];
  return {
    version,
    evaluatedAt,
    status,
    summary,
    spec,
    satisfiedEvidence,
    missingEvidence,
    ...(missingAnyOfEvidence.length > 0 ? { missingAnyOfEvidence } : {}),
    ...(record.blockingState === "waiting_user" ||
    record.blockingState === "waiting_external" ||
    record.blockingState === "verification_missing"
      ? { blockingState: record.blockingState }
      : {}),
    ...(typeof record.relatedEvidenceCount === "number" &&
    Number.isFinite(record.relatedEvidenceCount)
      ? { relatedEvidenceCount: record.relatedEvidenceCount }
      : {}),
    warnings,
  };
}

function normalizeCompletionSpec(value: unknown): CompletionGuardResult["spec"] | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const version = record.version === 1 ? record.version : undefined;
  const taskType =
    record.taskType === "answer" ||
    record.taskType === "code" ||
    record.taskType === "fix" ||
    record.taskType === "fetch_search" ||
    record.taskType === "workflow" ||
    record.taskType === "poll"
      ? record.taskType
      : undefined;
  const completionMode =
    record.completionMode === "auto" ||
    record.completionMode === "needs_user_confirmation" ||
    record.completionMode === "external_condition"
      ? record.completionMode
      : undefined;
  const summary = normalizeOptionalString(
    typeof record.summary === "string" ? record.summary : undefined,
  );
  if (!version || !taskType || !completionMode || !summary) {
    return undefined;
  }
  const deliverables = Array.isArray(record.deliverables)
    ? record.deliverables
        .map((entry) => normalizeOptionalString(typeof entry === "string" ? entry : undefined))
        .filter((entry): entry is string => Boolean(entry))
    : [];
  const requiredEvidence = normalizeCompletionEvidenceKindArray(record.requiredEvidence);
  const requireAnyOfEvidence = normalizeCompletionEvidenceKindArray(record.requireAnyOfEvidence);
  const recommendedEvidence = normalizeCompletionEvidenceKindArray(record.recommendedEvidence);
  return {
    version,
    taskType,
    completionMode,
    summary,
    deliverables,
    requiredEvidence,
    ...(requireAnyOfEvidence.length > 0 ? { requireAnyOfEvidence } : {}),
    ...(recommendedEvidence.length > 0 ? { recommendedEvidence } : {}),
  };
}

function normalizeCompletionEvidenceKindArray(value: unknown): CompletionEvidence["kind"][] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter(
    (entry): entry is CompletionEvidence["kind"] =>
      entry === "answer_provided" ||
      entry === "file_changed" ||
      entry === "test_passed" ||
      entry === "assertion_met" ||
      entry === "external_state_changed" ||
      entry === "user_confirmed",
  );
}

function resolveTrajectoryIdentity(event: AgentEventPayload): {
  taskId: string;
  agentId?: string;
  parentAgentId?: string;
  runtime?: TaskRuntime;
  mode?: AgentTaskMode;
  sessionId?: string;
  sessionKey?: string;
  status?: AgentRuntimeStatus;
  startedAt?: number;
} | null {
  const runtimeState = getAgentRuntimeState(event.runId);
  const runContext = getAgentRunContext(event.runId);
  const taskId = normalizeOptionalString(runtimeState?.taskId ?? runContext?.taskId);
  if (!taskId) {
    return null;
  }
  return {
    taskId,
    ...(normalizeOptionalString(runtimeState?.agentId ?? runContext?.agentId)
      ? { agentId: normalizeOptionalString(runtimeState?.agentId ?? runContext?.agentId) }
      : {}),
    ...(normalizeOptionalString(runtimeState?.parentAgentId ?? runContext?.parentAgentId)
      ? {
          parentAgentId: normalizeOptionalString(
            runtimeState?.parentAgentId ?? runContext?.parentAgentId,
          ),
        }
      : {}),
    ...((runtimeState?.runtime ?? runContext?.taskRuntime)
      ? { runtime: runtimeState?.runtime ?? runContext?.taskRuntime }
      : {}),
    ...((runtimeState?.mode ?? runContext?.taskMode)
      ? { mode: runtimeState?.mode ?? runContext?.taskMode }
      : {}),
    ...(normalizeOptionalString(runtimeState?.sessionId ?? runContext?.sessionId)
      ? { sessionId: normalizeOptionalString(runtimeState?.sessionId ?? runContext?.sessionId) }
      : {}),
    ...(normalizeOptionalString(
      event.sessionKey ?? runtimeState?.sessionKey ?? runContext?.sessionKey,
    )
      ? {
          sessionKey: normalizeOptionalString(
            event.sessionKey ?? runtimeState?.sessionKey ?? runContext?.sessionKey,
          ),
        }
      : {}),
    ...(runtimeState?.status ? { status: runtimeState.status } : {}),
    ...(typeof runtimeState?.startedAt === "number" ? { startedAt: runtimeState.startedAt } : {}),
  };
}

function buildBaseTrajectory(params: {
  event: AgentEventPayload;
  taskId: string;
  agentId?: string;
  parentAgentId?: string;
  runtime?: TaskRuntime;
  mode?: AgentTaskMode;
  sessionId?: string;
  sessionKey?: string;
  status?: AgentRuntimeStatus;
  startedAt?: number;
}): TaskTrajectory {
  return {
    version: TASK_TRAJECTORY_VERSION,
    taskId: params.taskId,
    runId: params.event.runId,
    ...(params.runtime ? { runtime: params.runtime } : {}),
    ...(params.mode ? { mode: params.mode } : {}),
    ...(params.agentId ? { agentId: params.agentId } : {}),
    ...(params.parentAgentId ? { parentAgentId: params.parentAgentId } : {}),
    ...(params.sessionId ? { sessionId: params.sessionId } : {}),
    ...(params.sessionKey ? { sessionKey: params.sessionKey } : {}),
    status: params.status ?? "created",
    startedAt: params.startedAt ?? params.event.ts,
    updatedAt: params.event.ts,
    steps: [],
    evidence: [],
  };
}

function readTaskTrajectoryFromPath(filePath: string): TaskTrajectory | undefined {
  try {
    return normalizeTaskTrajectory(JSON.parse(fs.readFileSync(filePath, "utf8")));
  } catch {
    return undefined;
  }
}

function getOrCreateTrajectory(event: AgentEventPayload): {
  trajectory: TaskTrajectory;
  runState: TaskTrajectoryRunState;
  filePath: string;
} | null {
  const identity = resolveTrajectoryIdentity(event);
  if (!identity) {
    return null;
  }
  const runState = getRunState(event.runId);
  if (runState.trajectory?.taskId === identity.taskId) {
    return {
      trajectory: runState.trajectory,
      runState,
      filePath: resolveAgentTaskTrajectoryPath({
        taskId: identity.taskId,
        agentId: identity.agentId,
      }),
    };
  }
  const filePath = resolveAgentTaskTrajectoryPath({
    taskId: identity.taskId,
    agentId: identity.agentId,
  });
  const existing = readTaskTrajectoryFromPath(filePath);
  runState.trajectory =
    existing ??
    buildBaseTrajectory({
      event,
      ...identity,
    });
  return {
    trajectory: runState.trajectory,
    runState,
    filePath,
  };
}

function enqueueTrajectoryPersist(runState: TaskTrajectoryRunState, filePath: string): void {
  if (!runState.trajectory) {
    return;
  }
  const snapshot = JSON.parse(JSON.stringify(runState.trajectory)) as TaskTrajectory;
  runState.persistQueue = runState.persistQueue
    .catch(() => undefined)
    .then(async () => {
      await writeJsonAtomic(filePath, snapshot, {
        trailingNewline: true,
      });
    })
    .catch((error) => {
      log.warn("Failed to persist task trajectory", {
        runId: snapshot.runId,
        taskId: snapshot.taskId,
        error,
      });
    });
}

function buildStepId(toolCallId: string | undefined, seq: number): string {
  return toolCallId ? `tool:${toolCallId}` : `tool:seq:${seq}`;
}

function summarizeToolInput(toolName: string, args: unknown): string | undefined {
  if (!args || typeof args !== "object" || Array.isArray(args)) {
    return undefined;
  }
  const record = args as Record<string, unknown>;
  if (toolName === "exec") {
    const command = normalizeOptionalString(
      typeof record.command === "string" ? record.command : undefined,
    );
    return command ? truncateText(command) : undefined;
  }
  const pathValue =
    normalizeOptionalString(typeof record.path === "string" ? record.path : undefined) ??
    normalizeOptionalString(typeof record.file === "string" ? record.file : undefined) ??
    normalizeOptionalString(typeof record.filePath === "string" ? record.filePath : undefined);
  return pathValue ? truncateText(pathValue) : undefined;
}

function findMutableFilePath(args: unknown): string | undefined {
  if (!args || typeof args !== "object" || Array.isArray(args)) {
    return undefined;
  }
  const record = args as Record<string, unknown>;
  for (const key of ["path", "file", "filePath", "filepath", "targetPath", "destination"]) {
    const value = normalizeOptionalString(
      typeof record[key] === "string" ? record[key] : undefined,
    );
    if (value) {
      return value;
    }
  }
  return undefined;
}

function extractCommand(args: unknown): string | undefined {
  if (!args || typeof args !== "object" || Array.isArray(args)) {
    return undefined;
  }
  const record = args as Record<string, unknown>;
  return (
    normalizeOptionalString(typeof record.command === "string" ? record.command : undefined) ??
    normalizeOptionalString(typeof record.cmd === "string" ? record.cmd : undefined)
  );
}

function looksLikeTestCommand(command: string): boolean {
  return /\b(test|vitest|jest|pytest|go test|cargo test|pnpm test|npm test|bun test|ctest)\b/i.test(
    command,
  );
}

function looksLikeAssertionCommand(command: string): boolean {
  return /\b(tsc|lint|build|check|verify|smoke)\b/i.test(command);
}

function addEvidence(trajectory: TaskTrajectory, evidence: CompletionEvidence): void {
  const key = [evidence.kind, evidence.summary, evidence.path ?? "", evidence.command ?? ""].join(
    "\u001f",
  );
  const exists = trajectory.evidence.some(
    (entry) =>
      [entry.kind, entry.summary, entry.path ?? "", entry.command ?? ""].join("\u001f") === key,
  );
  if (!exists) {
    trajectory.evidence.push(evidence);
  }
}

function isVerificationTask(trajectory: TaskTrajectory): boolean {
  return getTaskById(trajectory.taskId)?.agentMetadata?.spawnSource === VERIFICATION_SPAWN_SOURCE;
}

function collectToolEvidence(params: {
  toolName: string;
  toolCallId?: string;
  args: unknown;
  result?: unknown;
  isError: boolean;
  at: number;
}): CompletionEvidence[] {
  if (params.isError) {
    return [];
  }
  const evidence: CompletionEvidence[] = [];
  if (FILE_MUTATION_TOOL_NAMES.has(params.toolName)) {
    const filePath = findMutableFilePath(params.args);
    if (filePath) {
      evidence.push({
        kind: "file_changed",
        at: params.at,
        summary: `Modified ${filePath}`,
        toolName: params.toolName,
        ...(params.toolCallId ? { toolCallId: params.toolCallId } : {}),
        path: filePath,
        source: "tool",
      });
    }
  }
  if (params.toolName === "exec") {
    const command = extractCommand(params.args);
    if (command) {
      if (looksLikeTestCommand(command)) {
        evidence.push({
          kind: "test_passed",
          at: params.at,
          summary: `Command passed: ${truncateText(command)}`,
          toolName: params.toolName,
          ...(params.toolCallId ? { toolCallId: params.toolCallId } : {}),
          command,
          source: "tool",
        });
      } else if (looksLikeAssertionCommand(command)) {
        evidence.push({
          kind: "assertion_met",
          at: params.at,
          summary: `Verification passed: ${truncateText(command)}`,
          toolName: params.toolName,
          ...(params.toolCallId ? { toolCallId: params.toolCallId } : {}),
          command,
          source: "tool",
        });
      }
    }
  }
  if (
    params.toolName === "process" &&
    params.result &&
    typeof params.result === "object" &&
    typeof (params.result as { details?: unknown }).details === "object" &&
    (params.result as { details?: { status?: unknown } }).details?.status === "completed"
  ) {
    evidence.push({
      kind: "external_state_changed",
      at: params.at,
      summary: "Observed external state transition via process polling.",
      toolName: params.toolName,
      ...(params.toolCallId ? { toolCallId: params.toolCallId } : {}),
      source: "tool",
    });
  }
  return evidence;
}

function upsertAssistantCompletion(
  trajectory: TaskTrajectory,
  runState: TaskTrajectoryRunState,
  at: number,
): void {
  const text = normalizeOptionalString(runState.lastAssistantText);
  if (!text) {
    return;
  }
  upsertAssistantCompletionFromText(trajectory, text, at);
}

function upsertAssistantCompletionFromText(
  trajectory: TaskTrajectory,
  text: string,
  at: number,
): void {
  const summary = truncateText(text);
  const existing = trajectory.steps.find((step) => step.stepId === "assistant:final");
  if (existing) {
    existing.status = "completed";
    existing.endedAt = at;
    existing.summary = summary;
  } else {
    trajectory.steps.push({
      stepId: "assistant:final",
      kind: "assistant",
      title: "Deliver final answer",
      status: "completed",
      startedAt: at,
      endedAt: at,
      summary,
    });
  }
  addEvidence(trajectory, {
    kind: "answer_provided",
    at,
    summary,
    confidence: 1,
    source: "assistant",
  });
  if (isVerificationTask(trajectory)) {
    const parsed = parseVerificationReport(text);
    if (parsed.verdict === "PASS") {
      addEvidence(trajectory, {
        kind: "assertion_met",
        at,
        summary: parsed.summary
          ? `Verification passed: ${parsed.summary}`
          : "Verification agent reported PASS.",
        confidence: 0.9,
        source: "assistant",
      });
    }
  }
}

function collectRelatedCompletionEvidence(trajectory: TaskTrajectory): CompletionEvidence[] {
  const parentAgentId = normalizeOptionalString(
    getTaskById(trajectory.taskId)?.agentId ?? trajectory.agentId,
  );
  if (!parentAgentId) {
    return [];
  }
  const relatedEvidence: CompletionEvidence[] = [];
  const inMemoryTrajectories = [...getTaskTrajectoryState().byRunId.values()]
    .map((entry) => entry.trajectory)
    .filter((entry): entry is TaskTrajectory => Boolean(entry));
  for (const childTask of listTasksForParentAgentId(parentAgentId)) {
    if (childTask.taskId === trajectory.taskId) {
      continue;
    }
    const childTrajectory =
      inMemoryTrajectories.find((entry) => entry.taskId === childTask.taskId) ??
      readTaskTrajectorySync(childTask.agentMetadata?.trajectoryRef);
    if (!childTrajectory) {
      continue;
    }
    relatedEvidence.push(...childTrajectory.evidence);
  }
  return relatedEvidence;
}

function evaluateTrajectoryCompletion(trajectory: TaskTrajectory, at: number): void {
  trajectory.completion = evaluateCompletionGuard({
    task: getTaskById(trajectory.taskId),
    trajectory,
    relatedEvidence: collectRelatedCompletionEvidence(trajectory),
    evaluatedAt: at,
  });
}

function captureTrajectoryCompletionDecision(params: {
  trajectory: TaskTrajectory;
  runState: TaskTrajectoryRunState;
  at: number;
}): void {
  const { trajectory, runState, at } = params;
  const completion = trajectory.completion;
  if (!completion || !trajectory.sessionId) {
    return;
  }
  const parsedVerification =
    isVerificationTask(trajectory) && runState.lastAssistantText
      ? parseVerificationReport(runState.lastAssistantText)
      : undefined;
  emitAgentActionEvent({
    runId: trajectory.runId,
    sessionKey: trajectory.sessionKey,
    data: (() => {
      const status =
        completion.status === "accepted" || completion.status === "accepted_with_warnings"
          ? "completed"
          : completion.status === "waiting_user" || completion.status === "waiting_external"
            ? "waiting"
            : "blocked";
      const detail = {
        completionStatus: completion.status,
        ...(completion.blockingState ? { blockingState: completion.blockingState } : {}),
        evidenceCount: trajectory.evidence.length,
        stepCount: trajectory.steps.length,
        ...(parsedVerification?.verdict
          ? {
              verificationVerdict: parsedVerification.verdict,
              verificationSummary: parsedVerification.summary ?? null,
              verificationChecks: parsedVerification.checks,
              verificationFailingCommands: parsedVerification.failingCommands,
              verificationWarnings: parsedVerification.warnings,
              verificationArtifacts: parsedVerification.artifacts,
            }
          : {}),
      };
      const projection = buildCompletionActionVisibilityProjection({
        status,
        summary: completion.summary,
        detail,
      });
      return {
        actionId: `completion:${trajectory.runId}`,
        kind: "completion" as const,
        status,
        title: projection.projectedTitle,
        summary: completion.summary,
        projectedTitle: projection.projectedTitle,
        ...(projection.projectedSummary ? { projectedSummary: projection.projectedSummary } : {}),
        detail,
      };
    })(),
  });
  void captureContextArchiveRunEvent({
    source: "task-trajectory",
    runId: trajectory.runId,
    sessionId: trajectory.sessionId,
    sessionKey: trajectory.sessionKey,
    taskId: trajectory.taskId,
    agentId: trajectory.agentId,
    parentAgentId: trajectory.parentAgentId,
    label: "task-trajectory",
    type: "turn.completion_decision",
    createdAt: at,
    payload: {
      taskId: trajectory.taskId,
      runtimeStatus: trajectory.status,
      completion,
      evidenceCount: trajectory.evidence.length,
      stepCount: trajectory.steps.length,
      ...(parsedVerification?.verdict
        ? {
            verification: {
              verdict: parsedVerification.verdict,
              summary: parsedVerification.summary ?? null,
              checks: parsedVerification.checks,
              failingCommands: parsedVerification.failingCommands,
              warnings: parsedVerification.warnings,
              artifacts: parsedVerification.artifacts,
            },
          }
        : {}),
    },
    metadata: {
      source: "task-trajectory",
    },
  }).catch((error) => {
    log.warn("Failed to capture completion decision in context archive", {
      runId: trajectory.runId,
      taskId: trajectory.taskId,
      error,
    });
  });
  const archiveStatus =
    trajectory.status === "completed"
      ? "complete"
      : trajectory.status === "cancelled"
        ? "cancelled"
        : "failed";
  void updateContextArchiveRunState({
    source: "task-trajectory",
    runId: trajectory.runId,
    sessionId: trajectory.sessionId,
    sessionKey: trajectory.sessionKey,
    taskId: trajectory.taskId,
    agentId: trajectory.agentId,
    parentAgentId: trajectory.parentAgentId,
    label: "task-trajectory",
    status: archiveStatus,
    summary: {
      completionStatus: completion.status,
      blockingState: completion.blockingState ?? null,
      evidenceCount: trajectory.evidence.length,
    },
    metadata: {
      source: "task-trajectory",
    },
  }).catch((error) => {
    log.warn("Failed to update task-trajectory archive run state", {
      runId: trajectory.runId,
      taskId: trajectory.taskId,
      error,
    });
  });
}

function looksLikeGenericTerminalSummary(summary: string): boolean {
  return /^(agent|subagent)\s+(completed|failed|cancelled|timed out)$/i.test(summary.trim());
}

function handleLifecycleEvent(event: AgentEventPayload): void {
  const phase = typeof event.data?.phase === "string" ? event.data.phase : undefined;
  if (!phase) {
    return;
  }
  const resolved = getOrCreateTrajectory(event);
  if (!resolved) {
    return;
  }
  const { trajectory, runState, filePath } = resolved;
  if (phase === "start") {
    trajectory.status = "running";
    trajectory.startedAt =
      typeof event.data?.startedAt === "number" ? event.data.startedAt : trajectory.startedAt;
    trajectory.updatedAt = event.ts;
    enqueueTrajectoryPersist(runState, filePath);
    return;
  }
  if (phase === "end") {
    upsertAssistantCompletion(trajectory, runState, event.ts);
    trajectory.status = "completed";
    trajectory.completedAt =
      typeof event.data?.endedAt === "number" ? event.data.endedAt : event.ts;
    evaluateTrajectoryCompletion(trajectory, event.ts);
    captureTrajectoryCompletionDecision({ trajectory, runState, at: event.ts });
    trajectory.updatedAt = event.ts;
    enqueueTrajectoryPersist(runState, filePath);
    return;
  }
  if (phase === "error") {
    trajectory.status = "failed";
    trajectory.completedAt =
      typeof event.data?.endedAt === "number" ? event.data.endedAt : event.ts;
    evaluateTrajectoryCompletion(trajectory, event.ts);
    captureTrajectoryCompletionDecision({ trajectory, runState, at: event.ts });
    trajectory.updatedAt = event.ts;
    enqueueTrajectoryPersist(runState, filePath);
  }
}

function handleToolEvent(event: AgentEventPayload): void {
  const phase = typeof event.data?.phase === "string" ? event.data.phase : undefined;
  const toolName = normalizeOptionalString(
    typeof event.data?.name === "string" ? event.data.name : undefined,
  );
  if (!phase || !toolName) {
    return;
  }
  const resolved = getOrCreateTrajectory(event);
  if (!resolved) {
    return;
  }
  const { trajectory, runState, filePath } = resolved;
  const toolCallId = normalizeOptionalString(
    typeof event.data?.toolCallId === "string" ? event.data.toolCallId : undefined,
  );
  if (phase === "start") {
    if (toolCallId) {
      runState.activeToolInputs.set(toolCallId, event.data?.args);
    }
    const stepId = buildStepId(toolCallId, event.seq);
    const existing = trajectory.steps.find((step) => step.stepId === stepId);
    if (!existing) {
      trajectory.steps.push({
        stepId,
        kind: "tool",
        title: `Call ${toolName}`,
        status: "running",
        startedAt: event.ts,
        toolName,
        ...(toolCallId ? { toolCallId } : {}),
        ...(summarizeToolInput(toolName, event.data?.args)
          ? { summary: summarizeToolInput(toolName, event.data?.args) }
          : {}),
      });
      trajectory.updatedAt = event.ts;
      enqueueTrajectoryPersist(runState, filePath);
    }
    return;
  }
  if (phase !== "result") {
    return;
  }
  const isError = event.data?.isError === true;
  const stepId = buildStepId(toolCallId, event.seq);
  const step =
    trajectory.steps.find((entry) => entry.stepId === stepId) ??
    trajectory.steps.find((entry) => entry.toolCallId === toolCallId && entry.status === "running");
  if (step) {
    step.status = isError ? "failed" : "completed";
    step.endedAt = event.ts;
    step.isError = isError;
    step.summary = isError ? `${toolName} failed` : (step.summary ?? `${toolName} completed`);
  } else {
    trajectory.steps.push({
      stepId,
      kind: "tool",
      title: `Call ${toolName}`,
      status: isError ? "failed" : "completed",
      startedAt: event.ts,
      endedAt: event.ts,
      summary: isError ? `${toolName} failed` : `${toolName} completed`,
      toolName,
      ...(toolCallId ? { toolCallId } : {}),
      ...(isError ? { isError: true } : {}),
    });
  }
  const args = toolCallId ? runState.activeToolInputs.get(toolCallId) : undefined;
  for (const evidence of collectToolEvidence({
    toolName,
    toolCallId,
    args,
    result: event.data?.result,
    isError,
    at: event.ts,
  })) {
    addEvidence(trajectory, evidence);
  }
  if (toolCallId) {
    runState.activeToolInputs.delete(toolCallId);
  }
  trajectory.updatedAt = event.ts;
  enqueueTrajectoryPersist(runState, filePath);
}

function handleAssistantEvent(event: AgentEventPayload): void {
  const text = normalizeOptionalString(
    typeof event.data?.text === "string" ? event.data.text : undefined,
  );
  if (!text) {
    return;
  }
  getRunState(event.runId).lastAssistantText = text;
}

function handleTaskTrajectoryEvent(event: AgentEventPayload): void {
  if (event.stream === "lifecycle") {
    handleLifecycleEvent(event);
    return;
  }
  if (event.stream === "tool") {
    handleToolEvent(event);
    return;
  }
  if (event.stream === "assistant") {
    handleAssistantEvent(event);
  }
}

export function ensureTaskTrajectoryBridge(): void {
  const state = getTaskTrajectoryState();
  if (state.bridgeStop) {
    return;
  }
  state.bridgeStop = onAgentEvent(handleTaskTrajectoryEvent);
}

function getOrCreateTrajectoryForProgress(event: AgentProgressEvent): {
  trajectory: TaskTrajectory;
  runState: TaskTrajectoryRunState;
  filePath: string;
} | null {
  const taskId = normalizeOptionalString(event.taskId);
  if (!taskId) {
    return null;
  }
  const agentId = normalizeOptionalString(event.agentId);
  const runState = getRunState(event.runId);
  if (runState.trajectory?.taskId === taskId) {
    return {
      trajectory: runState.trajectory,
      runState,
      filePath: resolveAgentTaskTrajectoryPath({
        taskId,
        agentId,
      }),
    };
  }
  const filePath = resolveAgentTaskTrajectoryPath({
    taskId,
    agentId,
  });
  const existing = readTaskTrajectoryFromPath(filePath);
  runState.trajectory =
    existing ??
    ({
      version: TASK_TRAJECTORY_VERSION,
      taskId,
      runId: event.runId,
      ...(event.runtime ? { runtime: event.runtime } : {}),
      ...(event.mode ? { mode: event.mode } : {}),
      ...(agentId ? { agentId } : {}),
      ...(normalizeOptionalString(event.parentAgentId)
        ? { parentAgentId: normalizeOptionalString(event.parentAgentId) }
        : {}),
      ...(normalizeOptionalString(event.sessionId)
        ? { sessionId: normalizeOptionalString(event.sessionId) }
        : {}),
      ...(normalizeOptionalString(event.sessionKey)
        ? { sessionKey: normalizeOptionalString(event.sessionKey) }
        : {}),
      status: event.status,
      startedAt: event.at,
      updatedAt: event.at,
      steps: [],
      evidence: [],
    } satisfies TaskTrajectory);
  return {
    trajectory: runState.trajectory,
    runState,
    filePath,
  };
}

export function recordTaskTrajectoryProgressEvent(event: AgentProgressEvent): void {
  if (
    event.kind !== "agent_started" &&
    event.kind !== "agent_completed" &&
    event.kind !== "agent_failed" &&
    event.kind !== "agent_cancelled"
  ) {
    return;
  }

  const resolved = getOrCreateTrajectoryForProgress(event);
  if (!resolved) {
    return;
  }
  const { trajectory, runState, filePath } = resolved;

  if (event.kind === "agent_started") {
    trajectory.status = "running";
    trajectory.startedAt = trajectory.startedAt || event.at;
    trajectory.updatedAt = event.at;
    enqueueTrajectoryPersist(runState, filePath);
    return;
  }

  if (
    event.kind === "agent_completed" &&
    normalizeOptionalString(event.summary) &&
    !runState.lastAssistantText &&
    !looksLikeGenericTerminalSummary(event.summary!)
  ) {
    upsertAssistantCompletionFromText(trajectory, event.summary!, event.at);
  }

  trajectory.status =
    event.kind === "agent_completed"
      ? "completed"
      : event.kind === "agent_cancelled"
        ? "cancelled"
        : "failed";
  trajectory.completedAt = event.at;
  trajectory.updatedAt = event.at;
  evaluateTrajectoryCompletion(trajectory, event.at);
  enqueueTrajectoryPersist(runState, filePath);
}

export function readTaskTrajectorySync(
  trajectoryRef: string | null | undefined,
): TaskTrajectory | undefined {
  const ref = normalizeOptionalString(trajectoryRef);
  if (!ref) {
    return undefined;
  }
  try {
    const filePath = path.isAbsolute(ref) ? ref : path.resolve(resolveStateDir(), ref);
    return normalizeTaskTrajectory(JSON.parse(fs.readFileSync(filePath, "utf8")));
  } catch {
    return undefined;
  }
}

export async function flushTaskTrajectoryWritesForTest(): Promise<void> {
  const pending = [...getTaskTrajectoryState().byRunId.values()].map((entry) => entry.persistQueue);
  await Promise.all(pending);
}

export function resetTaskTrajectoryBridgeForTest(): void {
  const state = getTaskTrajectoryState();
  state.bridgeStop?.();
  state.bridgeStop = undefined;
  state.byRunId.clear();
}

export function resolveTaskTrajectoryRefForTask(params: {
  taskId: string;
  agentId?: string | null;
}): string {
  return resolveAgentTaskTrajectoryRef(params);
}
