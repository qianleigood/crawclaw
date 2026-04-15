import type {
  WorkflowDefinitionDiff,
  WorkflowFieldDiff,
  WorkflowRegistryEntry,
  WorkflowSpec,
  WorkflowStepDiff,
  WorkflowStepSpec,
  WorkflowVersionSnapshot,
} from "./types.js";

type WorkflowDiffComparable = {
  spec: WorkflowSpec;
  policy: Pick<
    WorkflowRegistryEntry,
    "description" | "enabled" | "safeForAutoRun" | "requiresApproval" | "tags" | "archivedAt"
  >;
};

function valuesEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function pushFieldDiff(
  target: WorkflowFieldDiff[],
  field: string,
  before: unknown,
  after: unknown,
): void {
  if (valuesEqual(before, after)) {
    return;
  }
  target.push({
    field,
    ...(before !== undefined ? { before } : {}),
    ...(after !== undefined ? { after } : {}),
  });
}

function diffNamedFieldSpecs(
  before: WorkflowSpec["inputs"],
  after: WorkflowSpec["inputs"],
): WorkflowFieldDiff[] {
  const target: WorkflowFieldDiff[] = [];
  const names = new Set<string>([
    ...before.map((field) => field.name),
    ...after.map((field) => field.name),
  ]);
  for (const name of [...names].toSorted()) {
    const beforeField = before.find((field) => field.name === name);
    const afterField = after.find((field) => field.name === name);
    if (!beforeField || !afterField) {
      pushFieldDiff(target, name, beforeField, afterField);
      continue;
    }
    if (!valuesEqual(beforeField, afterField)) {
      pushFieldDiff(target, name, beforeField, afterField);
    }
  }
  return target;
}

function diffSteps(before: WorkflowStepSpec[], after: WorkflowStepSpec[]): WorkflowStepDiff[] {
  const target: WorkflowStepDiff[] = [];
  const stepIds = new Set<string>([
    ...before.map((step) => step.id),
    ...after.map((step) => step.id),
  ]);
  for (const stepId of [...stepIds].toSorted()) {
    const beforeStep = before.find((step) => step.id === stepId);
    const afterStep = after.find((step) => step.id === stepId);
    if (!beforeStep && afterStep) {
      target.push({
        stepId,
        change: "added",
        after: afterStep,
      });
      continue;
    }
    if (beforeStep && !afterStep) {
      target.push({
        stepId,
        change: "removed",
        before: beforeStep,
      });
      continue;
    }
    if (!beforeStep || !afterStep || valuesEqual(beforeStep, afterStep)) {
      continue;
    }
    const fields: WorkflowFieldDiff[] = [];
    const keys = new Set<string>([...Object.keys(beforeStep), ...Object.keys(afterStep)]);
    for (const key of [...keys].toSorted()) {
      pushFieldDiff(
        fields,
        key,
        (beforeStep as Record<string, unknown>)[key],
        (afterStep as Record<string, unknown>)[key],
      );
    }
    target.push({
      stepId,
      change: "updated",
      before: beforeStep,
      after: afterStep,
      fields,
    });
  }
  return target;
}

export function createWorkflowDefinitionDiff(
  before: WorkflowDiffComparable,
  after: WorkflowDiffComparable,
): WorkflowDefinitionDiff {
  const basic: WorkflowFieldDiff[] = [];
  pushFieldDiff(basic, "name", before.spec.name, after.spec.name);
  pushFieldDiff(basic, "goal", before.spec.goal, after.spec.goal);
  pushFieldDiff(basic, "description", before.spec.description, after.spec.description);
  pushFieldDiff(basic, "sourceSummary", before.spec.sourceSummary, after.spec.sourceSummary);
  pushFieldDiff(basic, "topology", before.spec.topology, after.spec.topology);

  const policy: WorkflowFieldDiff[] = [];
  pushFieldDiff(policy, "policy.description", before.policy.description, after.policy.description);
  pushFieldDiff(policy, "policy.tags", before.policy.tags, after.policy.tags);
  pushFieldDiff(policy, "policy.enabled", before.policy.enabled, after.policy.enabled);
  pushFieldDiff(
    policy,
    "policy.safeForAutoRun",
    before.policy.safeForAutoRun,
    after.policy.safeForAutoRun,
  );
  pushFieldDiff(
    policy,
    "policy.requiresApproval",
    before.policy.requiresApproval,
    after.policy.requiresApproval,
  );
  pushFieldDiff(policy, "policy.archivedAt", before.policy.archivedAt, after.policy.archivedAt);

  const inputs = diffNamedFieldSpecs(before.spec.inputs, after.spec.inputs);
  const outputs = diffNamedFieldSpecs(before.spec.outputs, after.spec.outputs);
  const steps = diffSteps(before.spec.steps, after.spec.steps);

  return {
    summary: {
      basicChanged: basic.length > 0,
      inputsChanged: inputs.length > 0,
      outputsChanged: outputs.length > 0,
      policyChanged: policy.length > 0,
      stepsAdded: steps.filter((step) => step.change === "added").length,
      stepsRemoved: steps.filter((step) => step.change === "removed").length,
      stepsUpdated: steps.filter((step) => step.change === "updated").length,
    },
    changes: {
      basic,
      inputs,
      outputs,
      policy,
      steps,
    },
  };
}

export function createWorkflowDefinitionDiffFromSnapshots(
  before: WorkflowVersionSnapshot,
  after: WorkflowVersionSnapshot,
): WorkflowDefinitionDiff {
  return createWorkflowDefinitionDiff(
    {
      spec: before.spec,
      policy: before.policy,
    },
    {
      spec: after.spec,
      policy: after.policy,
    },
  );
}
