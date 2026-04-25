import type { AcpRuntimeEvent } from "../../acp/runtime/types.js";
import { buildToolExecutionDisplayText } from "../../agents/tool-display.js";
import type {
  WorkflowExecutionStatus,
  WorkflowExecutionStepStatus,
} from "../../workflows/types.js";
import {
  buildWorkflowExecutionVisibilityProjection,
  type WorkflowVisibilityProjection,
} from "../../workflows/visibility.js";

export type ExecutionVisibilityMode = "off" | "summary" | "verbose" | "full";

export type ExecutionEventKind =
  | "tool"
  | "skill"
  | "workflow"
  | "system"
  | "artifact"
  | "reasoning";

export type ExecutionEventPhase = "start" | "update" | "end" | "error" | "waiting";

export type ExecutionIntent =
  | "search"
  | "read"
  | "browse"
  | "write"
  | "analyze"
  | "transform"
  | "send"
  | "generate"
  | "schedule"
  | "execute"
  | "fetch"
  | "sync"
  | "auth"
  | "wait_approval"
  | "deliver"
  | "unknown";

export type ToolCapabilityFamily =
  | "web"
  | "file"
  | "message"
  | "image"
  | "audio"
  | "workflow"
  | "auth"
  | "exec"
  | "memory"
  | "browser"
  | "calendar"
  | "unknown";

export type WorkflowExecutionMeta = {
  workflowId?: string;
  workflowName?: string;
  executionId?: string;
  stepId?: string;
  stepName?: string;
  stepType?: string;
  branchId?: string;
  waitingReason?: string;
};

export type ExecutionEvent = {
  kind: ExecutionEventKind;
  phase: ExecutionEventPhase;
  sourceName?: string;
  sourceType?: "tool" | "skill" | "workflow" | "agent" | "system";
  declaredIntent?: ExecutionIntent;
  family?: ToolCapabilityFamily;
  object?: string;
  message?: string;
  detail?: string;
  workflow?: WorkflowExecutionMeta;
  status?: string;
};

export type IntentResolutionResult = {
  intent: ExecutionIntent;
  confidence: "high" | "medium" | "low";
  source: "declared" | "family" | "heuristic" | "context" | "fallback";
};

const FAMILY_INTENT_MAP: Record<ToolCapabilityFamily, ExecutionIntent> = {
  web: "search",
  file: "read",
  message: "send",
  image: "generate",
  audio: "transform",
  workflow: "execute",
  auth: "auth",
  exec: "execute",
  memory: "analyze",
  browser: "browse",
  calendar: "schedule",
  unknown: "unknown",
};

const NAME_HEURISTICS: Array<{ pattern: RegExp; intent: ExecutionIntent }> = [
  { pattern: /\b(search|lookup|find|query)\b/i, intent: "search" },
  { pattern: /\b(read|open|load|view|inspect)\b/i, intent: "read" },
  { pattern: /\b(browse|navigate|visit|page)\b/i, intent: "browse" },
  { pattern: /\b(write|save|update|edit|patch)\b/i, intent: "write" },
  { pattern: /\b(analyze|summarize|reason|classify|rank)\b/i, intent: "analyze" },
  { pattern: /\b(transform|parse|extract|convert|compile|render)\b/i, intent: "transform" },
  { pattern: /\b(send|post|reply|notify|publish)\b/i, intent: "send" },
  { pattern: /\b(generate|draw|image|tts|audio|create)\b/i, intent: "generate" },
  { pattern: /\b(schedule|cron|plan)\b/i, intent: "schedule" },
  { pattern: /\b(exec|run|shell|bash|command)\b/i, intent: "execute" },
  { pattern: /\b(fetch|download|pull)\b/i, intent: "fetch" },
  { pattern: /\b(sync|refresh)\b/i, intent: "sync" },
  { pattern: /\b(auth|login|oauth|token|pair)\b/i, intent: "auth" },
];

const TERMINAL_TOOL_STATUSES = new Set(["completed", "failed", "cancelled", "done", "error"]);

function normalizeOptionalString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed || undefined;
}

function toTitleCase(input: string): string {
  return input
    .split(/[\s_-]+/g)
    .filter(Boolean)
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join(" ");
}

function simplifyObjectLabel(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  const stripped = value
    .replace(/\((in_progress|completed|failed|cancelled|done|error)\)/gi, "")
    .replace(/\b(status\s*=\s*)?(in_progress|completed|failed|cancelled|done|error)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!stripped) {
    return undefined;
  }
  if (/^call_[a-z0-9_-]+$/i.test(stripped)) {
    return undefined;
  }
  return stripped;
}

function resolveFamily(input: ExecutionEvent): ToolCapabilityFamily {
  if (input.family) {
    return input.family;
  }
  const sourceName = `${input.sourceName ?? ""} ${input.object ?? ""} ${input.message ?? ""}`;
  if (/\bworkflow\b/i.test(sourceName)) {
    return "workflow";
  }
  if (/\b(search|lookup|query|fetch|download|browse|navigate|open_url|web)\b/i.test(sourceName)) {
    return "web";
  }
  if (/\b(read|open|load|file|files|fs|edit|write|patch|save|directory|dir)\b/i.test(sourceName)) {
    return "file";
  }
  if (/\b(send|reply|notify|message|post|publish)\b/i.test(sourceName)) {
    return "message";
  }
  if (/\b(image|draw|vision)\b/i.test(sourceName)) {
    return "image";
  }
  if (/\b(audio|tts|transcribe)\b/i.test(sourceName)) {
    return "audio";
  }
  if (/\b(auth|login|oauth|token|pair)\b/i.test(sourceName)) {
    return "auth";
  }
  if (/\b(exec|run|shell|bash|command)\b/i.test(sourceName)) {
    return "exec";
  }
  if (/\b(memory|recall)\b/i.test(sourceName)) {
    return "memory";
  }
  if (/\b(browser|tab|page)\b/i.test(sourceName)) {
    return "browser";
  }
  if (/\b(calendar|event|meeting)\b/i.test(sourceName)) {
    return "calendar";
  }
  return "unknown";
}

function resolveIntentVerb(intent: ExecutionIntent, phase: ExecutionEventPhase): string {
  const past = phase === "end";
  switch (intent) {
    case "search":
      return past ? "Searched" : "Searching";
    case "read":
      return past ? "Read" : "Reading";
    case "browse":
      return past ? "Browsed" : "Browsing";
    case "write":
      return past ? "Saved" : "Updating";
    case "analyze":
      return past ? "Analyzed" : "Analyzing";
    case "transform":
      return past ? "Transformed" : "Transforming";
    case "send":
      return past ? "Sent" : "Sending";
    case "generate":
      return past ? "Generated" : "Generating";
    case "schedule":
      return past ? "Scheduled" : "Scheduling";
    case "execute":
      return past ? "Executed" : "Running";
    case "fetch":
      return past ? "Fetched" : "Fetching";
    case "sync":
      return past ? "Synced" : "Syncing";
    case "auth":
      return past ? "Authenticated" : "Authenticating";
    case "wait_approval":
      return "Waiting for approval";
    case "deliver":
      return past ? "Delivered" : "Delivering";
    case "unknown":
      return past ? "Completed" : "Working";
  }
  return past ? "Completed" : "Working";
}

function resolveExecutionNoun(kind: ExecutionEventKind): string {
  if (kind === "workflow") {
    return "Workflow";
  }
  if (kind === "skill") {
    return "Skill";
  }
  if (kind === "system") {
    return "System";
  }
  if (kind === "artifact") {
    return "Artifact";
  }
  if (kind === "reasoning") {
    return "Reasoning";
  }
  return "Tool Call";
}

function resolveObjectLabel(input: ExecutionEvent): string | undefined {
  const workflowLabel = simplifyObjectLabel(
    input.workflow?.workflowName ?? input.workflow?.stepName,
  );
  if (workflowLabel) {
    return workflowLabel;
  }
  const explicitObject = simplifyObjectLabel(input.object);
  if (explicitObject) {
    return explicitObject;
  }
  const sourceName = simplifyObjectLabel(input.sourceName);
  if (sourceName) {
    return sourceName;
  }
  return simplifyObjectLabel(input.message);
}

function resolveWorkflowExecutionStatusFromEvent(event: ExecutionEvent): WorkflowExecutionStatus {
  const normalizedStatus = normalizeOptionalString(event.status)?.toLowerCase();
  switch (normalizedStatus) {
    case "queued":
    case "pending":
      return "queued";
    case "running":
    case "in_progress":
      return "running";
    case "waiting":
    case "blocked":
    case "waiting_input":
      return "waiting_input";
    case "waiting_external":
      return "waiting_external";
    case "completed":
    case "succeeded":
    case "done":
      return "succeeded";
    case "failed":
    case "error":
      return "failed";
    case "cancelled":
    case "canceled":
      return "cancelled";
  }

  switch (event.phase) {
    case "waiting":
      return "waiting_external";
    case "end":
      return "succeeded";
    case "error":
      return "failed";
    case "start":
    case "update":
      return "running";
  }
  return "running";
}

function resolveWorkflowStepStatus(status: WorkflowExecutionStatus): WorkflowExecutionStepStatus {
  switch (status) {
    case "queued":
      return "pending";
    case "running":
      return "running";
    case "waiting_input":
    case "waiting_external":
      return "waiting";
    case "succeeded":
      return "succeeded";
    case "failed":
      return "failed";
    case "cancelled":
      return "cancelled";
  }
  return "running";
}

function buildWorkflowVisibilitySummaryProjection(
  event: ExecutionEvent,
): WorkflowVisibilityProjection | undefined {
  const workflowName = normalizeOptionalString(event.workflow?.workflowName);
  const workflowId = normalizeOptionalString(event.workflow?.workflowId);
  if (!workflowName && !workflowId) {
    return undefined;
  }
  const status = resolveWorkflowExecutionStatusFromEvent(event);
  const stepName = normalizeOptionalString(event.workflow?.stepName);
  const stepId = normalizeOptionalString(event.workflow?.stepId) ?? stepName;
  const errorMessage =
    status === "failed" ? simplifyObjectLabel(event.detail ?? event.message) : undefined;
  return buildWorkflowExecutionVisibilityProjection({
    workflowId: workflowId ?? workflowName ?? "workflow",
    ...(workflowName ? { workflowName } : {}),
    status,
    ...(stepId ? { currentStepId: stepId } : {}),
    ...(stepId
      ? {
          steps: [
            {
              stepId,
              ...(stepName ? { title: stepName } : {}),
              status: resolveWorkflowStepStatus(status),
              updatedAt: 0,
            },
          ],
        }
      : {}),
    ...(errorMessage ? { errorMessage } : {}),
  });
}

function buildWorkflowToolVisibilityTitle(params: {
  label: string;
  phase: ExecutionEventPhase;
  status?: string;
}): string {
  return buildWorkflowExecutionVisibilityProjection({
    workflowId: params.label,
    workflowName: params.label,
    status: resolveWorkflowExecutionStatusFromEvent({
      kind: "workflow",
      phase: params.phase,
      status: normalizeOptionalString(params.status),
      workflow: {
        workflowName: params.label,
      },
    }),
  }).projectedTitle;
}

export function normalizeExecutionVisibilityMode(
  raw?: string | null,
): ExecutionVisibilityMode | undefined {
  if (!raw) {
    return undefined;
  }
  const key = raw.trim().toLowerCase();
  if (["off", "false", "none", "0"].includes(key)) {
    return "off";
  }
  if (["summary", "on", "minimal"].includes(key)) {
    return "summary";
  }
  if (["verbose", "detail", "detailed"].includes(key)) {
    return "verbose";
  }
  if (["full", "all", "everything"].includes(key)) {
    return "full";
  }
  return undefined;
}

export function resolveExecutionVisibilityMode(params: {
  requested?: string | null;
  shouldDisplay: boolean;
  fallback?: ExecutionVisibilityMode;
}): ExecutionVisibilityMode {
  if (!params.shouldDisplay) {
    return "off";
  }
  return normalizeExecutionVisibilityMode(params.requested) ?? params.fallback ?? "summary";
}

export function resolveExecutionIntent(input: ExecutionEvent): IntentResolutionResult {
  if (input.declaredIntent) {
    return { intent: input.declaredIntent, confidence: "high", source: "declared" };
  }
  if (
    input.phase === "waiting" ||
    normalizeOptionalString(input.status) === "waiting" ||
    /\bapproval|approve|confirm|resume|input required\b/i.test(
      `${input.message ?? ""} ${input.detail ?? ""} ${input.workflow?.waitingReason ?? ""}`,
    )
  ) {
    return { intent: "wait_approval", confidence: "high", source: "context" };
  }
  if (input.kind === "artifact") {
    return { intent: "deliver", confidence: "high", source: "context" };
  }
  const family = resolveFamily(input);
  if (family !== "unknown") {
    return {
      intent: FAMILY_INTENT_MAP[family],
      confidence: family === "workflow" || family === "auth" ? "high" : "medium",
      source: "family",
    };
  }
  const haystack = [input.sourceName, input.object, input.message, input.detail]
    .filter(Boolean)
    .join(" ");
  for (const candidate of NAME_HEURISTICS) {
    if (candidate.pattern.test(haystack)) {
      return { intent: candidate.intent, confidence: "medium", source: "heuristic" };
    }
  }
  return { intent: "unknown", confidence: "low", source: "fallback" };
}

export function buildExecutionVisibilityText(params: {
  event: ExecutionEvent;
  mode: ExecutionVisibilityMode;
}): string | undefined {
  if (params.mode === "off") {
    return undefined;
  }
  const { event, mode } = params;
  const noun = resolveExecutionNoun(event.kind);
  const objectLabel = resolveObjectLabel(event);
  const intent = resolveExecutionIntent(event).intent;
  const status = normalizeOptionalString(event.status);

  if (mode === "summary") {
    if (event.kind === "workflow") {
      const workflowProjection = buildWorkflowVisibilitySummaryProjection(event);
      if (workflowProjection?.projectedTitle) {
        return workflowProjection.projectedTitle;
      }
      if (objectLabel) {
        return buildWorkflowToolVisibilityTitle({
          label: objectLabel,
          phase: event.phase,
          status: event.status,
        });
      }
      if (event.phase === "waiting") {
        return "Workflow waiting";
      }
      return noun;
    }
    if (event.phase === "error") {
      if (objectLabel) {
        return `${noun} failed: ${objectLabel}`;
      }
      return `${noun} failed`;
    }
    if (intent !== "unknown" && objectLabel) {
      return `${resolveIntentVerb(intent, event.phase)} ${objectLabel}`;
    }
    if (intent === "unknown") {
      const sourceLabel = normalizeOptionalString(event.sourceName);
      if (sourceLabel && objectLabel && sourceLabel.toLowerCase() !== objectLabel.toLowerCase()) {
        return `${toTitleCase(sourceLabel)}: ${objectLabel}`;
      }
      if (sourceLabel) {
        return toTitleCase(sourceLabel);
      }
    }
    if (objectLabel) {
      return `${noun}: ${objectLabel}`;
    }
    return noun;
  }

  const detailParts: string[] = [];
  if (objectLabel) {
    detailParts.push(objectLabel);
  }
  if (mode === "full") {
    const detail = simplifyObjectLabel(event.detail ?? event.message);
    if (detail && detail !== objectLabel) {
      detailParts.push(detail);
    }
  }
  if (status && (mode === "full" || event.phase !== "end" || TERMINAL_TOOL_STATUSES.has(status))) {
    detailParts.push(`status=${status}`);
  }
  return detailParts.length > 0 ? `${noun}: ${detailParts.join(" · ")}` : noun;
}

function resolveExecutionKindFromToolName(toolName?: string): ExecutionEventKind {
  const normalized = normalizeOptionalString(toolName)?.toLowerCase();
  if (!normalized) {
    return "tool";
  }
  if (normalized === "workflow" || normalized === "workflowize") {
    return "workflow";
  }
  return "tool";
}

export function buildToolExecutionVisibilityText(params: {
  toolName?: string;
  args?: unknown;
  meta?: string;
  phase: ExecutionEventPhase;
  mode: ExecutionVisibilityMode;
  status?: string;
}): string | undefined {
  const kind = resolveExecutionKindFromToolName(params.toolName);
  if (kind === "workflow") {
    const workflowLabel = simplifyObjectLabel(params.meta);
    if (workflowLabel) {
      return buildWorkflowToolVisibilityTitle({
        label: workflowLabel,
        phase: params.phase,
        status: params.status,
      });
    }
  }
  return buildToolExecutionDisplayText({
    toolName: params.toolName,
    args: params.args,
    meta: params.meta,
    phase: params.phase,
    mode: params.mode,
    status: params.status,
  });
}

export function projectAcpToolCallEvent(params: {
  event: Extract<AcpRuntimeEvent, { type: "tool_call" }>;
  mode: ExecutionVisibilityMode;
}): string | undefined {
  const status = normalizeOptionalString(params.event.status);
  const phase: ExecutionEventPhase =
    status && TERMINAL_TOOL_STATUSES.has(status)
      ? status === "error" || status === "failed"
        ? "error"
        : "end"
      : status === "waiting"
        ? "waiting"
        : params.event.tag === "tool_call"
          ? "start"
          : "update";
  const rawLabel =
    simplifyObjectLabel(params.event.title) ?? simplifyObjectLabel(params.event.text) ?? undefined;
  const family = resolveFamily({
    kind: /\bworkflow\b/i.test(rawLabel ?? "") ? "workflow" : "tool",
    phase,
    sourceName: rawLabel,
    object: rawLabel,
    message: params.event.text,
  });
  const kind: ExecutionEventKind = family === "workflow" ? "workflow" : "tool";
  if (kind === "workflow" && params.mode === "summary" && rawLabel) {
    return buildWorkflowToolVisibilityTitle({
      label: rawLabel,
      phase,
      status,
    });
  }
  return buildExecutionVisibilityText({
    mode: params.mode,
    event: {
      kind,
      phase,
      sourceType: kind === "workflow" ? "workflow" : "tool",
      sourceName: rawLabel,
      object: rawLabel,
      message: params.event.text,
      status,
      family,
    },
  });
}

export const __testing = {
  resolveFamily,
  resolveObjectLabel,
  simplifyObjectLabel,
  resolveIntentVerb,
  toTitleCase,
};
