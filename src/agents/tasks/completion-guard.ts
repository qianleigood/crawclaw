import type { AgentRuntimeStatus } from "../runtime/agent-runtime-state.js";
import type { CompletionEvidence, CompletionEvidenceKind } from "./completion-evidence.js";
import {
  resolveCompletionSpec,
  type CompletionTaskDescriptor,
  type CompletionSpec,
} from "./completion-spec.js";

export type CompletionGuardStatus =
  | "accepted"
  | "accepted_with_warnings"
  | "incomplete"
  | "waiting_user"
  | "waiting_external";
export type CompletionGuardBlockingState = "waiting_user" | "waiting_external" | "review_missing";

export type CompletionGuardResult = {
  version: 1;
  evaluatedAt: number;
  status: CompletionGuardStatus;
  summary: string;
  spec: CompletionSpec;
  satisfiedEvidence: CompletionEvidenceKind[];
  missingEvidence: CompletionEvidenceKind[];
  missingAnyOfEvidence?: CompletionEvidenceKind[];
  blockingState?: CompletionGuardBlockingState;
  relatedEvidenceCount?: number;
  warnings: string[];
};

const COMPLETION_GUARD_VERSION = 1 as const;

function formatEvidenceLabel(kind: CompletionEvidenceKind): string {
  switch (kind) {
    case "answer_provided":
      return "final answer";
    case "file_changed":
      return "file change";
    case "test_passed":
      return "passing test";
    case "assertion_met":
      return "assertion command";
    case "review_passed":
      return "passed review";
    case "user_confirmed":
      return "user confirmation";
    default:
      return kind;
  }
}

function joinLabels(kinds: CompletionEvidenceKind[]): string {
  return kinds.map((kind) => formatEvidenceLabel(kind)).join(", ");
}

function buildWarnings(params: {
  spec: CompletionSpec;
  evidenceKinds: Set<CompletionEvidenceKind>;
}): string[] {
  const warnings: string[] = [];
  for (const kind of params.spec.recommendedEvidence ?? []) {
    if (!params.evidenceKinds.has(kind)) {
      warnings.push(`Missing recommended evidence: ${formatEvidenceLabel(kind)}.`);
    }
  }
  return warnings;
}

export function evaluateCompletionGuard(params: {
  task?: CompletionTaskDescriptor | null;
  trajectory: {
    status: AgentRuntimeStatus;
    evidence: CompletionEvidence[];
  };
  relatedEvidence?: CompletionEvidence[];
  evaluatedAt?: number;
}): CompletionGuardResult {
  const relatedEvidence = params.relatedEvidence ?? [];
  const aggregateEvidence = [...params.trajectory.evidence, ...relatedEvidence];
  const spec = resolveCompletionSpec({
    task: params.task,
    evidence: aggregateEvidence,
  });
  const evidenceKinds = new Set(aggregateEvidence.map((entry) => entry.kind));
  const satisfiedEvidence = spec.requiredEvidence.filter((kind) => evidenceKinds.has(kind));
  const missingEvidence = spec.requiredEvidence.filter((kind) => !evidenceKinds.has(kind));
  const missingAnyOfEvidence =
    spec.requireAnyOfEvidence && !spec.requireAnyOfEvidence.some((kind) => evidenceKinds.has(kind))
      ? [...spec.requireAnyOfEvidence]
      : [];
  const warnings = buildWarnings({
    spec,
    evidenceKinds,
  });

  let status: CompletionGuardResult["status"];
  let summary: string;
  let blockingState: CompletionGuardBlockingState | undefined;
  if (spec.completionMode === "needs_user_confirmation" && !evidenceKinds.has("user_confirmed")) {
    status = "waiting_user";
    summary = "Task is waiting for explicit user confirmation before it can be completed.";
    blockingState = "waiting_user";
  } else if (
    spec.completionMode === "external_condition" &&
    !evidenceKinds.has("external_state_changed")
  ) {
    status = "waiting_external";
    summary = "Task is waiting for the external condition to be observed before completion.";
    blockingState = "waiting_external";
  } else if (params.trajectory.status !== "completed") {
    status = "incomplete";
    summary = "Agent terminated before reaching a completed state.";
  } else if (missingEvidence.length > 0 || missingAnyOfEvidence.length > 0) {
    status = "incomplete";
    const missingParts = [
      missingEvidence.length > 0 ? joinLabels(missingEvidence) : "",
      missingAnyOfEvidence.length > 0 ? `one of ${joinLabels(missingAnyOfEvidence)}` : "",
    ].filter(Boolean);
    summary = `Missing completion evidence: ${missingParts.join("; ")}.`;
    if (
      spec.taskType === "fix" &&
      missingAnyOfEvidence.some((kind) => kind === "test_passed" || kind === "assertion_met")
    ) {
      blockingState = "review_missing";
    }
  } else if (warnings.length > 0) {
    status = "accepted_with_warnings";
    summary = `Completion evidence satisfied with warnings for ${spec.taskType} task.`;
  } else {
    status = "accepted";
    summary = `Completion evidence satisfied for ${spec.taskType} task.`;
  }

  return {
    version: COMPLETION_GUARD_VERSION,
    evaluatedAt: params.evaluatedAt ?? Date.now(),
    status,
    summary,
    spec,
    satisfiedEvidence,
    missingEvidence,
    ...(missingAnyOfEvidence.length > 0 ? { missingAnyOfEvidence } : {}),
    ...(blockingState ? { blockingState } : {}),
    ...(relatedEvidence.length > 0 ? { relatedEvidenceCount: relatedEvidence.length } : {}),
    warnings,
  };
}
