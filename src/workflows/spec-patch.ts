import type {
  WorkflowDefinitionPatch,
  WorkflowFieldSpec,
  WorkflowRegistryEntry,
  WorkflowSpec,
  WorkflowStepSpec,
  WorkflowTopology,
} from "./types.js";

function normalizeStringList(values: string[] | undefined): string[] {
  return Array.from(new Set((values ?? []).map((value) => value.trim()).filter(Boolean)));
}

function hasBranchAwareMetadata(step: WorkflowStepSpec): boolean {
  return (
    (step.path?.trim() && step.path.trim() !== "main") ||
    Boolean(step.branchGroup?.trim()) ||
    Boolean(step.activation?.when?.trim()) ||
    Boolean(step.activation?.fromStepIds?.length) ||
    (step.activation?.mode !== undefined && step.activation.mode !== "sequential")
  );
}

function inferWorkflowTopology(
  explicitTopology: WorkflowTopology | undefined,
  steps: WorkflowStepSpec[],
): WorkflowTopology {
  const inferred = steps.some((step) => hasBranchAwareMetadata(step)) ? "branch_v2" : "linear_v1";
  if (explicitTopology === "linear_v1" && inferred === "branch_v2") {
    throw new Error(
      "Workflow steps include branch-aware metadata, but topology was forced to linear_v1.",
    );
  }
  return explicitTopology ?? inferred;
}

function normalizeFieldSpecs(
  fields: WorkflowFieldSpec[] | undefined,
): WorkflowFieldSpec[] | undefined {
  if (!fields) {
    return undefined;
  }
  return fields.map((field) => {
    const name = field.name.trim();
    if (!name) {
      throw new Error("Workflow field names must be non-empty.");
    }
    return {
      name,
      type: field.type?.trim() || "string",
      required: field.required,
      ...(field.description?.trim() ? { description: field.description.trim() } : {}),
    };
  });
}

function normalizeStepSpecs(steps: WorkflowStepSpec[] | undefined): WorkflowStepSpec[] | undefined {
  if (!steps) {
    return undefined;
  }
  if (steps.length === 0) {
    throw new Error("Workflow steps cannot be empty.");
  }
  return steps.map((step, index) => {
    const stepId = step.id.trim();
    if (!stepId) {
      throw new Error(`Workflow step at index ${index} is missing an id.`);
    }
    return {
      ...step,
      id: stepId,
      ...(step.title?.trim() ? { title: step.title.trim() } : {}),
      ...(step.goal?.trim() ? { goal: step.goal.trim() } : {}),
      ...(step.prompt?.trim() ? { prompt: step.prompt.trim() } : {}),
      ...(step.service?.trim() ? { service: step.service.trim() } : {}),
      ...(step.sourceSkill?.trim() ? { sourceSkill: step.sourceSkill.trim() } : {}),
      ...(step.tags ? { tags: normalizeStringList(step.tags) } : {}),
      ...(step.notes?.trim() ? { notes: step.notes.trim() } : {}),
      ...(step.path?.trim() ? { path: step.path.trim() } : {}),
      ...(step.branchGroup?.trim() ? { branchGroup: step.branchGroup.trim() } : {}),
      ...(step.activation
        ? {
            activation: {
              ...(step.activation.mode ? { mode: step.activation.mode } : {}),
              ...(step.activation.when?.trim() ? { when: step.activation.when.trim() } : {}),
              ...(step.activation.fromStepIds
                ? { fromStepIds: normalizeStringList(step.activation.fromStepIds) }
                : {}),
              ...(step.activation.parallel
                ? {
                    parallel: {
                      ...(step.activation.parallel.failurePolicy
                        ? { failurePolicy: step.activation.parallel.failurePolicy }
                        : {}),
                      ...(step.activation.parallel.joinPolicy
                        ? { joinPolicy: step.activation.parallel.joinPolicy }
                        : {}),
                      ...(typeof step.activation.parallel.maxActiveBranches === "number"
                        ? { maxActiveBranches: step.activation.parallel.maxActiveBranches }
                        : {}),
                      ...(typeof step.activation.parallel.retryOnFail === "boolean"
                        ? { retryOnFail: step.activation.parallel.retryOnFail }
                        : {}),
                      ...(typeof step.activation.parallel.maxTries === "number"
                        ? { maxTries: step.activation.parallel.maxTries }
                        : {}),
                      ...(typeof step.activation.parallel.waitBetweenTriesMs === "number"
                        ? { waitBetweenTriesMs: step.activation.parallel.waitBetweenTriesMs }
                        : {}),
                    },
                  }
                : {}),
            },
          }
        : {}),
      ...(step.compensation
        ? {
            compensation: {
              ...(step.compensation.mode ? { mode: step.compensation.mode } : {}),
              ...(step.compensation.goal?.trim() ? { goal: step.compensation.goal.trim() } : {}),
              ...(step.compensation.allowedTools
                ? { allowedTools: normalizeStringList(step.compensation.allowedTools) }
                : {}),
              ...(step.compensation.allowedSkills
                ? { allowedSkills: normalizeStringList(step.compensation.allowedSkills) }
                : {}),
              ...(typeof step.compensation.timeoutMs === "number"
                ? { timeoutMs: step.compensation.timeoutMs }
                : {}),
              ...(typeof step.compensation.maxSteps === "number"
                ? { maxSteps: step.compensation.maxSteps }
                : {}),
            },
          }
        : {}),
      ...(step.serviceRequest
        ? {
            serviceRequest: {
              ...step.serviceRequest,
              url: step.serviceRequest.url.trim(),
              ...(step.serviceRequest.headers
                ? { headers: { ...step.serviceRequest.headers } }
                : {}),
              ...(step.serviceRequest.body ? { body: { ...step.serviceRequest.body } } : {}),
            },
          }
        : {}),
      ...(step.agent
        ? {
            agent: {
              ...(step.agent.allowedTools
                ? { allowedTools: normalizeStringList(step.agent.allowedTools) }
                : {}),
              ...(step.agent.allowedSkills
                ? { allowedSkills: normalizeStringList(step.agent.allowedSkills) }
                : {}),
              ...(typeof step.agent.timeoutMs === "number"
                ? { timeoutMs: step.agent.timeoutMs }
                : {}),
              ...(typeof step.agent.maxSteps === "number" ? { maxSteps: step.agent.maxSteps } : {}),
              ...(step.agent.resultSchema ? { resultSchema: step.agent.resultSchema } : {}),
            },
          }
        : {}),
      ...(step.wait
        ? {
            wait: {
              ...(step.wait.kind ? { kind: step.wait.kind } : {}),
              ...(step.wait.prompt?.trim() ? { prompt: step.wait.prompt.trim() } : {}),
            },
          }
        : {}),
    };
  });
}

export function applyWorkflowDefinitionPatch(params: {
  spec: WorkflowSpec;
  entry: WorkflowRegistryEntry;
  patch: WorkflowDefinitionPatch;
  specVersion: number;
  updatedAt?: number;
}): { spec: WorkflowSpec; entry: WorkflowRegistryEntry } {
  const updatedAt = params.updatedAt ?? Date.now();
  const normalizedSteps = normalizeStepSpecs(params.patch.steps);
  const topology = inferWorkflowTopology(
    params.patch.topology,
    normalizedSteps ?? params.spec.steps,
  );
  const nextSpec: WorkflowSpec = {
    ...params.spec,
    ...(params.patch.name?.trim() ? { name: params.patch.name.trim() } : {}),
    ...(params.patch.goal?.trim() ? { goal: params.patch.goal.trim() } : {}),
    ...(params.patch.description !== undefined
      ? params.patch.description?.trim()
        ? { description: params.patch.description.trim() }
        : { description: undefined }
      : {}),
    ...(params.patch.sourceSummary !== undefined
      ? params.patch.sourceSummary?.trim()
        ? { sourceSummary: params.patch.sourceSummary.trim() }
        : { sourceSummary: undefined }
      : {}),
    ...(params.patch.tags ? { tags: normalizeStringList(params.patch.tags) } : {}),
    ...(params.patch.inputs ? { inputs: normalizeFieldSpecs(params.patch.inputs) ?? [] } : {}),
    ...(params.patch.outputs ? { outputs: normalizeFieldSpecs(params.patch.outputs) ?? [] } : {}),
    ...(normalizedSteps ? { steps: normalizedSteps } : {}),
    topology,
    updatedAt,
  };

  const nextEntry: WorkflowRegistryEntry = {
    ...params.entry,
    name: nextSpec.name,
    description: nextSpec.description,
    ...(params.patch.tags ? { tags: [...nextSpec.tags] } : {}),
    ...(typeof params.patch.safeForAutoRun === "boolean"
      ? { safeForAutoRun: params.patch.safeForAutoRun }
      : {}),
    ...(typeof params.patch.requiresApproval === "boolean"
      ? { requiresApproval: params.patch.requiresApproval }
      : {}),
    specVersion: params.specVersion,
    deploymentState: params.entry.deploymentVersion > 0 ? "draft" : params.entry.deploymentState,
    updatedAt,
  };

  return {
    spec: nextSpec,
    entry: nextEntry,
  };
}
