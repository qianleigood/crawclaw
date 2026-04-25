import {
  buildToolExecutionVisibilityText,
  type ExecutionEventPhase,
} from "../../auto-reply/reply/execution-visibility.js";
import { buildApprovalActionVisibilityProjection } from "../../infra/approval-visibility.js";
import { buildMemoryActionVisibilityProjection } from "../../memory/action-visibility.js";
import { buildWorkflowActionVisibilityProjection } from "../../workflows/visibility.js";
import { buildCompletionActionVisibilityProjection } from "../tasks/completion-visibility.js";
import type { AgentActionEventData, AgentActionKind, AgentActionStatus } from "./types.js";

function normalizeOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function resolveExecutionPhase(status: AgentActionStatus): ExecutionEventPhase {
  if (status === "waiting" || status === "blocked") {
    return "waiting";
  }
  if (status === "completed" || status === "cancelled") {
    return "end";
  }
  if (status === "failed") {
    return "error";
  }
  if (status === "started") {
    return "start";
  }
  return "update";
}

function resolveProjectedKind(params: {
  kind: AgentActionKind;
  toolName?: string;
  detail?: Record<string, unknown>;
  title?: string;
  summary?: string;
}): AgentActionKind {
  if (params.kind === "tool") {
    const toolName = normalizeOptionalString(params.toolName)?.toLowerCase();
    if (toolName === "workflow" || toolName === "workflowize") {
      return "workflow";
    }
  }
  if (params.kind === "completion") {
    const taskType = normalizeOptionalString(params.detail?.taskType);
    if (taskType?.toLowerCase() === "workflow") {
      return "workflow";
    }
    const haystack = `${params.title ?? ""} ${params.summary ?? ""}`;
    if (/\bworkflow\b/i.test(haystack)) {
      return "workflow";
    }
  }
  return params.kind;
}

function resolveProjectedSummary(params: {
  kind: AgentActionKind;
  summary?: string;
  projectedTitle?: string;
}): string | undefined {
  const summary = normalizeOptionalString(params.summary);
  if (!summary) {
    return undefined;
  }
  if (params.kind === "tool" || params.kind === "workflow" || params.kind === "completion") {
    if (params.projectedTitle && summary === params.projectedTitle) {
      return undefined;
    }
    return undefined;
  }
  if (params.kind === "approval" && summary === "no-approval-route") {
    return undefined;
  }
  return summary;
}

function normalizeToolSummaryToken(value: string | undefined): string | undefined {
  return normalizeOptionalString(value)?.replace(/[_-]+/g, " ").replace(/\s+/g, " ").toLowerCase();
}

function isLegacyToolLifecycleSummary(params: {
  summary: string;
  title?: string;
  toolName?: string;
}): boolean {
  const summary = normalizeToolSummaryToken(params.summary);
  if (!summary) {
    return false;
  }
  const title = normalizeToolSummaryToken(params.title);
  if (title && summary === title) {
    return true;
  }
  const tool = normalizeToolSummaryToken(params.toolName);
  if (!tool) {
    return /^(calling|running)\s+\S+$/i.test(summary) || /\S+\s+(completed|failed)$/i.test(summary);
  }
  return (
    summary === `calling ${tool}` ||
    summary === `running ${tool}` ||
    summary === `${tool} completed` ||
    summary === `${tool} failed`
  );
}

function resolveToolProjectionMeta(input: AgentActionEventData): string | undefined {
  const toolMeta = normalizeOptionalString(input.detail?.toolMeta);
  if (toolMeta) {
    return toolMeta;
  }
  const summary = normalizeOptionalString(input.summary);
  if (!summary) {
    return undefined;
  }
  return isLegacyToolLifecycleSummary({
    summary,
    title: input.title,
    toolName: input.toolName,
  })
    ? undefined
    : summary;
}

export function projectAgentActionEventData(input: AgentActionEventData): AgentActionEventData {
  const projectedKind = resolveProjectedKind({
    kind: input.kind,
    toolName: input.toolName,
    detail: input.detail,
    title: input.title,
    summary: input.summary,
  });
  const explicitProjectedTitle = normalizeOptionalString(input.projectedTitle);
  const explicitProjectedSummary = normalizeOptionalString(input.projectedSummary);
  if (explicitProjectedTitle || explicitProjectedSummary) {
    return {
      ...input,
      kind: projectedKind,
      ...(explicitProjectedTitle ? { projectedTitle: explicitProjectedTitle } : {}),
      ...(explicitProjectedSummary ? { projectedSummary: explicitProjectedSummary } : {}),
    };
  }
  const phase = resolveExecutionPhase(input.status);

  let projectedTitle: string | undefined;
  let projectedSummary: string | undefined;
  if (projectedKind === "tool" || projectedKind === "workflow") {
    if (projectedKind === "workflow") {
      const workflowProjection = buildWorkflowActionVisibilityProjection({
        status: input.status,
        detail: input.detail,
        summary: input.summary,
      });
      projectedTitle = workflowProjection?.projectedTitle;
      projectedSummary = workflowProjection?.projectedSummary;
    }
    if (!projectedTitle) {
      projectedTitle = buildToolExecutionVisibilityText({
        toolName: input.toolName ?? (projectedKind === "workflow" ? "workflow" : undefined),
        args: input.detail?.toolArgs,
        meta: resolveToolProjectionMeta(input),
        phase,
        mode: "summary",
        status: input.status,
      });
      if (
        projectedKind === "workflow" &&
        projectedTitle &&
        /^workflow:\s*workflow(?:ize)?$/i.test(projectedTitle)
      ) {
        projectedTitle = undefined;
      }
    }
  } else if (projectedKind === "approval") {
    const approvalProjection = buildApprovalActionVisibilityProjection({
      status: input.status,
      title: input.title,
      summary: input.summary,
      detail: input.detail,
    });
    projectedTitle = approvalProjection.projectedTitle;
    projectedSummary = approvalProjection.projectedSummary;
  } else if (projectedKind === "completion") {
    const completionProjection = buildCompletionActionVisibilityProjection({
      status: input.status,
      summary: input.summary,
      detail: input.detail,
    });
    projectedTitle = completionProjection.projectedTitle;
    projectedSummary = completionProjection.projectedSummary;
  } else if (projectedKind === "memory") {
    const memoryKind = normalizeOptionalString(input.detail?.memoryKind);
    const memoryPhase = normalizeOptionalString(input.detail?.memoryPhase);
    if (
      (memoryKind === "extraction" || memoryKind === "session_summary" || memoryKind === "dream") &&
      (memoryPhase === "scheduled" ||
        memoryPhase === "running" ||
        memoryPhase === "failed_to_start" ||
        memoryPhase === "wait_failed" ||
        memoryPhase === "invalid_report" ||
        memoryPhase === "orient" ||
        memoryPhase === "gather" ||
        memoryPhase === "final")
    ) {
      const memoryResultStatus = normalizeOptionalString(input.detail?.memoryResultStatus);
      const memoryProjection = buildMemoryActionVisibilityProjection({
        kind: memoryKind,
        phase: memoryPhase,
        summary: input.summary,
        ...(memoryResultStatus === "written" ||
        memoryResultStatus === "skipped" ||
        memoryResultStatus === "no_change" ||
        memoryResultStatus === "failed"
          ? { resultStatus: memoryResultStatus }
          : {}),
      });
      projectedTitle = memoryProjection.projectedTitle;
      projectedSummary = memoryProjection.projectedSummary;
    }
  }

  projectedSummary ??= resolveProjectedSummary({
    kind: projectedKind,
    summary: input.summary,
    projectedTitle,
  });

  return {
    ...input,
    kind: projectedKind,
    ...(projectedTitle ? { projectedTitle } : {}),
    ...(projectedSummary ? { projectedSummary } : {}),
  };
}
