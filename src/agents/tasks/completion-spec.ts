import type { CompletionEvidence, CompletionEvidenceKind } from "./completion-evidence.js";

export type CompletionTaskType = "answer" | "code" | "fix" | "fetch_search" | "workflow" | "poll";

export type CompletionMode = "auto" | "needs_user_confirmation" | "external_condition";

export type CompletionSpec = {
  version: 1;
  taskType: CompletionTaskType;
  completionMode: CompletionMode;
  summary: string;
  deliverables: string[];
  requiredEvidence: CompletionEvidenceKind[];
  requireAnyOfEvidence?: CompletionEvidenceKind[];
  recommendedEvidence?: CompletionEvidenceKind[];
};

export type CompletionTaskDescriptor = {
  task?: string;
  label?: string;
};

const COMPLETION_SPEC_VERSION = 1 as const;

function normalizeOptionalString(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function collectEvidenceKinds(
  evidence: CompletionEvidence[] | undefined,
): Set<CompletionEvidenceKind> {
  return new Set((evidence ?? []).map((entry) => entry.kind));
}

function resolveTaskText(task: CompletionTaskDescriptor | null | undefined): string {
  const primary = normalizeOptionalString(task?.task);
  if (primary) {
    return primary.toLowerCase();
  }
  return (normalizeOptionalString(task?.label) ?? "").toLowerCase();
}

function looksLikeFixTask(taskText: string): boolean {
  return /\b(fix|bug|regress|regression|broken|failing|failure|error|repair|patch|root cause|diagnos)\b/i.test(
    taskText,
  );
}

function looksLikeCodeTask(taskText: string): boolean {
  return /\b(implement|add|update|edit|refactor|create|write|modify|rename|delete|remove|clean up)\b/i.test(
    taskText,
  );
}

function looksLikeFetchTask(taskText: string): boolean {
  return /\b(search|find|lookup|look up|fetch|read|open|inspect|review|research|browse|summarize|investigate)\b/i.test(
    taskText,
  );
}

function looksLikePollingTask(taskText: string): boolean {
  return /\b(wait(?:ing)?\s+for|wait\s+until|poll|monitor|keep checking|watch|until .*?(ready|done|complete|finished|healthy))\b/i.test(
    taskText,
  );
}

function looksLikeConfirmationTask(taskText: string): boolean {
  return /\b(confirm|confirmation|approve|approval|sign off|user confirmation|review and confirm|decide whether)\b/i.test(
    taskText,
  );
}

function looksLikeWorkflowTask(taskText: string): boolean {
  return /\b(workflow|coordinate|orchestrate|delegate|subagent|parallel|handoff)\b/i.test(taskText);
}

export function resolveCompletionSpec(params: {
  task?: CompletionTaskDescriptor | null;
  evidence?: CompletionEvidence[];
}): CompletionSpec {
  const taskText = resolveTaskText(params.task);
  const evidenceKinds = collectEvidenceKinds(params.evidence);
  const hasFileChange = evidenceKinds.has("file_changed");
  const hasValidation = evidenceKinds.has("test_passed") || evidenceKinds.has("assertion_met");
  const hasExternalStateChange = evidenceKinds.has("external_state_changed");
  const hasUserConfirmation = evidenceKinds.has("user_confirmed");

  if (looksLikeConfirmationTask(taskText) || hasUserConfirmation) {
    return {
      version: COMPLETION_SPEC_VERSION,
      taskType: "workflow",
      completionMode: "needs_user_confirmation",
      summary: "This task requires explicit user confirmation before it can be considered done.",
      deliverables: ["Captured explicit user confirmation"],
      requiredEvidence: ["user_confirmed"],
      recommendedEvidence: ["answer_provided"],
    };
  }

  if (looksLikePollingTask(taskText) || hasExternalStateChange) {
    return {
      version: COMPLETION_SPEC_VERSION,
      taskType: "poll",
      completionMode: "external_condition",
      summary: "Polling tasks should not complete until the external condition is observed.",
      deliverables: ["Observed the target external state"],
      requiredEvidence: ["external_state_changed"],
      recommendedEvidence: ["answer_provided"],
    };
  }

  if (looksLikeFixTask(taskText) || (hasFileChange && hasValidation)) {
    return {
      version: COMPLETION_SPEC_VERSION,
      taskType: "fix",
      completionMode: "auto",
      summary: "Code fix tasks should leave a code change and at least one verification signal.",
      deliverables: ["Applied the fix", "Captured a verification signal"],
      requiredEvidence: ["file_changed"],
      requireAnyOfEvidence: ["test_passed", "assertion_met"],
      recommendedEvidence: ["answer_provided"],
    };
  }

  if (looksLikeCodeTask(taskText) || hasFileChange) {
    return {
      version: COMPLETION_SPEC_VERSION,
      taskType: "code",
      completionMode: "auto",
      summary:
        "Code tasks should leave a concrete file mutation and ideally a final completion note.",
      deliverables: ["Changed a target file"],
      requiredEvidence: ["file_changed"],
      recommendedEvidence: ["answer_provided"],
    };
  }

  if (looksLikeFetchTask(taskText)) {
    return {
      version: COMPLETION_SPEC_VERSION,
      taskType: "fetch_search",
      completionMode: "auto",
      summary: "Fetch/search tasks should conclude with a final answer that packages the findings.",
      deliverables: ["Produced a final answer"],
      requiredEvidence: ["answer_provided"],
    };
  }

  if (looksLikeWorkflowTask(taskText)) {
    return {
      version: COMPLETION_SPEC_VERSION,
      taskType: "workflow",
      completionMode: "auto",
      summary:
        "Workflow tasks should aggregate at least one concrete completion signal from the delegated path.",
      deliverables: ["Produced a concrete completion signal"],
      requiredEvidence: [],
      requireAnyOfEvidence: [
        "answer_provided",
        "file_changed",
        "test_passed",
        "assertion_met",
        "external_state_changed",
        "user_confirmed",
      ],
      recommendedEvidence: ["answer_provided"],
    };
  }

  return {
    version: COMPLETION_SPEC_VERSION,
    taskType: "answer",
    completionMode: "auto",
    summary: "Answer tasks should conclude with a final response.",
    deliverables: ["Produced a final answer"],
    requiredEvidence: ["answer_provided"],
  };
}
