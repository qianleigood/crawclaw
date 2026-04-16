import {
  buildExecutionVisibilityText,
  buildToolExecutionVisibilityText,
  type ExecutionEventPhase,
} from "../../auto-reply/reply/execution-visibility.js";
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
  return summary;
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
  if (projectedKind === "tool" || projectedKind === "workflow") {
    projectedTitle = buildToolExecutionVisibilityText({
      toolName: input.toolName ?? (projectedKind === "workflow" ? "workflow" : undefined),
      meta: normalizeOptionalString(input.summary),
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
  } else if (projectedKind === "approval") {
    projectedTitle = buildExecutionVisibilityText({
      mode: "summary",
      event: {
        kind: "system",
        phase,
        sourceType: "system",
        declaredIntent: "wait_approval",
        object: normalizeOptionalString(input.summary),
        message: normalizeOptionalString(input.title),
        status: input.status,
      },
    });
  }

  const projectedSummary = resolveProjectedSummary({
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
