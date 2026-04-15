import type {
  WorkflowDefinitionDiff,
  WorkflowDeploymentRecord,
  WorkflowExecutionView,
  WorkflowRegistryEntry,
  WorkflowSpec,
} from "../../../../src/workflows/types.js";
import type { GatewayBrowserClient } from "../gateway.ts";
import {
  formatMissingOperatorReadScopeMessage,
  isMissingOperatorReadScopeError,
} from "./scope-errors.ts";

export type WorkflowListEntry = WorkflowRegistryEntry & {
  runCount: number;
  recentExecution: WorkflowExecutionView | null;
};

export type WorkflowDetailSnapshot = {
  agentId?: string;
  workflow: WorkflowRegistryEntry;
  spec: WorkflowSpec;
  specPath: string;
  storeRoot: string;
  recentExecutions: WorkflowExecutionView[];
};

export type WorkflowVersionSummary = {
  workflowId: string;
  specVersion: number;
  savedAt: number;
  savedBySessionKey?: string;
  reason: string;
  name: string;
  goal: string;
  topology?: string;
};

export type WorkflowVersionsSnapshot = {
  agentId?: string;
  workflow: WorkflowRegistryEntry;
  specVersions: WorkflowVersionSummary[];
  deployments: WorkflowDeploymentRecord[];
  currentDeployment: WorkflowDeploymentRecord | null;
};

export type WorkflowDiffSnapshot = {
  agentId?: string;
  workflow: {
    workflowId: string;
    name: string;
  };
  fromSpecVersion: number;
  toSpecVersion: number;
  diff: WorkflowDefinitionDiff;
};

export type WorkflowEditorDraft = {
  name: string;
  goal: string;
  description: string;
  tags: string;
  topology: string;
  safeForAutoRun: boolean;
  requiresApproval: boolean;
  inputsJson: string;
  outputsJson: string;
  stepsJson: string;
};

export type WorkflowsState = {
  client: GatewayBrowserClient | null;
  connected: boolean;
  workflowLoading: boolean;
  workflowError: string | null;
  workflowsList: WorkflowListEntry[];
  workflowSelectedId: string | null;
  workflowDetailLoading: boolean;
  workflowDetailError: string | null;
  workflowDetail: WorkflowDetailSnapshot | null;
  workflowRunsLoading: boolean;
  workflowRunsError: string | null;
  workflowRuns: WorkflowExecutionView[];
  workflowVersionsLoading: boolean;
  workflowVersionsError: string | null;
  workflowVersions: WorkflowVersionsSnapshot | null;
  workflowDiffLoading: boolean;
  workflowDiffError: string | null;
  workflowDiff: WorkflowDiffSnapshot | null;
  workflowEditorDraft: WorkflowEditorDraft | null;
  workflowSelectedExecutionId: string | null;
  workflowSelectedExecution: WorkflowExecutionView | null;
  workflowStatusLoading: boolean;
  workflowStatusError: string | null;
  workflowActionBusyKey: string | null;
  workflowFilterQuery: string;
  workflowFilterState: "all" | "enabled" | "disabled" | "deployed" | "approval";
  workflowResumeDraft: string;
};

type WorkflowListPayload = {
  agentId?: string;
  count: number;
  workflows: WorkflowListEntry[];
};

type WorkflowGetPayload = {
  agentId?: string;
  workflow: WorkflowRegistryEntry;
  spec: WorkflowSpec;
  specPath: string;
  storeRoot: string;
  recentExecutions: WorkflowExecutionView[];
};

type WorkflowRunsPayload = {
  agentId?: string;
  count: number;
  executions: WorkflowExecutionView[];
};

type WorkflowExecutionActionPayload = {
  agentId?: string;
  workflow?: WorkflowRegistryEntry;
  execution: WorkflowExecutionView;
};

type WorkflowMutationPayload = {
  agentId?: string;
  workflow: WorkflowRegistryEntry;
};

type WorkflowDeletePayload = {
  agentId?: string;
  deleted: boolean;
  workflowId?: string;
  removedExecutions?: number;
};

type WorkflowVersionsPayload = WorkflowVersionsSnapshot;

type WorkflowDiffPayload = WorkflowDiffSnapshot;

type LoadWorkflowOptions = {
  selectWorkflow?: string | null;
  selectedExecutionId?: string | null;
};

function toErrorMessage(err: unknown): string {
  if (isMissingOperatorReadScopeError(err)) {
    return formatMissingOperatorReadScopeMessage("workflows");
  }
  if (err instanceof Error && err.message.trim()) {
    return err.message;
  }
  return String(err);
}

function resolveWorkflowRef(state: WorkflowsState, workflow?: string | null): string | null {
  const explicit = typeof workflow === "string" && workflow.trim() ? workflow.trim() : null;
  if (explicit) {
    return explicit;
  }
  return state.workflowSelectedId;
}

function resolveSelectedExecutionId(
  state: WorkflowsState,
  runs: WorkflowExecutionView[],
  recentExecutions: WorkflowExecutionView[],
  explicitExecutionId?: string | null,
): string | null {
  const desired = explicitExecutionId?.trim() || state.workflowSelectedExecutionId;
  const available = [...runs, ...recentExecutions];
  if (desired && available.some((entry) => entry.executionId === desired)) {
    return desired;
  }
  return available[0]?.executionId ?? null;
}

function findExecution(
  runs: WorkflowExecutionView[],
  recentExecutions: WorkflowExecutionView[],
  executionId: string | null | undefined,
): WorkflowExecutionView | null {
  if (!executionId) {
    return null;
  }
  return (
    runs.find((entry) => entry.executionId === executionId) ??
    recentExecutions.find((entry) => entry.executionId === executionId) ??
    null
  );
}

function toEditorDraft(detail: WorkflowDetailSnapshot): WorkflowEditorDraft {
  return {
    name: detail.spec.name,
    goal: detail.spec.goal,
    description: detail.spec.description ?? "",
    tags: detail.spec.tags.join(", "),
    topology: detail.spec.topology ?? "linear_v1",
    safeForAutoRun: detail.workflow.safeForAutoRun,
    requiresApproval: detail.workflow.requiresApproval,
    inputsJson: JSON.stringify(detail.spec.inputs, null, 2),
    outputsJson: JSON.stringify(detail.spec.outputs, null, 2),
    stepsJson: JSON.stringify(detail.spec.steps, null, 2),
  };
}

async function loadWorkflowVersionsAndDiff(state: WorkflowsState, workflowRef: string) {
  if (!state.client || !state.connected) {
    return;
  }
  state.workflowVersionsLoading = true;
  state.workflowDiffLoading = true;
  state.workflowVersionsError = null;
  state.workflowDiffError = null;
  try {
    const versionsPayload = await state.client.request<WorkflowVersionsPayload>(
      "workflow.versions",
      {
        workflow: workflowRef,
      },
    );
    state.workflowVersions = versionsPayload;
    if (
      versionsPayload.workflow.deploymentVersion > 0 ||
      versionsPayload.workflow.specVersion > 1
    ) {
      try {
        state.workflowDiff = await state.client.request<WorkflowDiffPayload>("workflow.diff", {
          workflow: workflowRef,
        });
      } catch (err) {
        state.workflowDiff = null;
        state.workflowDiffError = toErrorMessage(err);
      }
    } else {
      state.workflowDiff = null;
      state.workflowDiffError = null;
    }
  } catch (err) {
    state.workflowVersions = null;
    state.workflowVersionsError = toErrorMessage(err);
    state.workflowDiff = null;
  } finally {
    state.workflowVersionsLoading = false;
    state.workflowDiffLoading = false;
  }
}

function parseWorkflowJsonArray<T>(raw: string, label: string): T[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      throw new Error(`${label} must be a JSON array.`);
    }
    return parsed as T[];
  } catch (error) {
    const message =
      error instanceof Error && error.message.trim() ? error.message : `${label} is invalid JSON.`;
    throw new Error(message, { cause: error });
  }
}

function patchExecutionCollections(state: WorkflowsState, execution: WorkflowExecutionView) {
  state.workflowRuns = state.workflowRuns.map((entry) =>
    entry.executionId === execution.executionId ? execution : entry,
  );
  if (state.workflowDetail) {
    state.workflowDetail = {
      ...state.workflowDetail,
      recentExecutions: state.workflowDetail.recentExecutions.map((entry) =>
        entry.executionId === execution.executionId ? execution : entry,
      ),
    };
  }
  if (execution.workflowId) {
    state.workflowsList = state.workflowsList.map((entry) =>
      entry.workflowId === execution.workflowId ? { ...entry, recentExecution: execution } : entry,
    );
  }
  if (state.workflowSelectedExecutionId === execution.executionId) {
    state.workflowSelectedExecution = execution;
  }
}

export async function loadWorkflowDetail(
  state: WorkflowsState,
  workflow?: string | null,
  options?: { selectedExecutionId?: string | null },
) {
  if (!state.client || !state.connected) {
    return;
  }
  const workflowRef = resolveWorkflowRef(state, workflow);
  if (!workflowRef) {
    state.workflowDetail = null;
    state.workflowVersions = null;
    state.workflowDiff = null;
    state.workflowEditorDraft = null;
    state.workflowRuns = [];
    state.workflowSelectedExecutionId = null;
    state.workflowSelectedExecution = null;
    return;
  }
  state.workflowSelectedId = workflowRef;
  state.workflowDetailLoading = true;
  state.workflowRunsLoading = true;
  state.workflowDetailError = null;
  state.workflowRunsError = null;
  try {
    const [detailPayload, runsPayload] = await Promise.all([
      state.client.request<WorkflowGetPayload>("workflow.get", {
        workflow: workflowRef,
        recentRunsLimit: 12,
      }),
      state.client.request<WorkflowRunsPayload>("workflow.runs", {
        workflow: workflowRef,
        limit: 25,
      }),
    ]);
    state.workflowDetail = {
      agentId: detailPayload.agentId,
      workflow: detailPayload.workflow,
      spec: detailPayload.spec,
      specPath: detailPayload.specPath,
      storeRoot: detailPayload.storeRoot,
      recentExecutions: detailPayload.recentExecutions ?? [],
    };
    state.workflowEditorDraft = toEditorDraft(state.workflowDetail);
    state.workflowRuns = runsPayload.executions ?? [];
    const selectedExecutionId = resolveSelectedExecutionId(
      state,
      state.workflowRuns,
      state.workflowDetail.recentExecutions,
      options?.selectedExecutionId,
    );
    state.workflowSelectedExecutionId = selectedExecutionId;
    state.workflowSelectedExecution = findExecution(
      state.workflowRuns,
      state.workflowDetail.recentExecutions,
      selectedExecutionId,
    );
    await loadWorkflowVersionsAndDiff(state, workflowRef);
  } catch (err) {
    const message = toErrorMessage(err);
    state.workflowDetailError = message;
    state.workflowRunsError = message;
  } finally {
    state.workflowDetailLoading = false;
    state.workflowRunsLoading = false;
  }
}

export async function loadWorkflows(state: WorkflowsState, options?: LoadWorkflowOptions) {
  if (!state.client || !state.connected) {
    return;
  }
  if (state.workflowLoading) {
    return;
  }
  state.workflowLoading = true;
  state.workflowError = null;
  try {
    const payload = await state.client.request<WorkflowListPayload>("workflow.list", {
      includeDisabled: true,
    });
    state.workflowsList = payload.workflows ?? [];
    const selectedWorkflow =
      resolveWorkflowRef(state, options?.selectWorkflow) ??
      state.workflowsList[0]?.workflowId ??
      null;
    if (!selectedWorkflow) {
      state.workflowSelectedId = null;
      state.workflowDetail = null;
      state.workflowRuns = [];
      state.workflowSelectedExecutionId = null;
      state.workflowSelectedExecution = null;
      return;
    }
    await loadWorkflowDetail(state, selectedWorkflow, {
      selectedExecutionId: options?.selectedExecutionId ?? null,
    });
  } catch (err) {
    state.workflowError = toErrorMessage(err);
  } finally {
    state.workflowLoading = false;
  }
}

export async function refreshWorkflowExecutionStatus(
  state: WorkflowsState,
  executionId?: string | null,
) {
  if (!state.client || !state.connected) {
    return;
  }
  const resolvedExecutionId = executionId?.trim() || state.workflowSelectedExecutionId;
  if (!resolvedExecutionId) {
    return;
  }
  state.workflowStatusLoading = true;
  state.workflowStatusError = null;
  try {
    const payload = await state.client.request<WorkflowExecutionActionPayload>("workflow.status", {
      executionId: resolvedExecutionId,
    });
    state.workflowSelectedExecutionId = payload.execution.executionId;
    state.workflowSelectedExecution = payload.execution;
    patchExecutionCollections(state, payload.execution);
  } catch (err) {
    state.workflowStatusError = toErrorMessage(err);
  } finally {
    state.workflowStatusLoading = false;
  }
}

export async function setWorkflowEnabled(
  state: WorkflowsState,
  workflow: string,
  enabled: boolean,
) {
  if (!state.client || !state.connected) {
    return;
  }
  state.workflowActionBusyKey = `${enabled ? "enable" : "disable"}:${workflow}`;
  state.workflowStatusError = null;
  try {
    await state.client.request<WorkflowMutationPayload>(
      enabled ? "workflow.enable" : "workflow.disable",
      {
        workflow,
      },
    );
    await loadWorkflows(state, {
      selectWorkflow: workflow,
      selectedExecutionId: state.workflowSelectedExecutionId,
    });
  } catch (err) {
    state.workflowStatusError = toErrorMessage(err);
  } finally {
    state.workflowActionBusyKey = null;
  }
}

export async function deployWorkflow(state: WorkflowsState, workflow: string) {
  if (!state.client || !state.connected) {
    return;
  }
  state.workflowActionBusyKey = `deploy:${workflow}`;
  state.workflowStatusError = null;
  try {
    await state.client.request("workflow.deploy", {
      workflow,
    });
    await loadWorkflows(state, {
      selectWorkflow: workflow,
      selectedExecutionId: state.workflowSelectedExecutionId,
    });
  } catch (err) {
    state.workflowStatusError = toErrorMessage(err);
  } finally {
    state.workflowActionBusyKey = null;
  }
}

export async function republishWorkflow(state: WorkflowsState, workflow: string) {
  if (!state.client || !state.connected) {
    return;
  }
  state.workflowActionBusyKey = `republish:${workflow}`;
  state.workflowStatusError = null;
  try {
    await state.client.request("workflow.republish", {
      workflow,
    });
    await loadWorkflows(state, {
      selectWorkflow: workflow,
      selectedExecutionId: state.workflowSelectedExecutionId,
    });
  } catch (err) {
    state.workflowStatusError = toErrorMessage(err);
  } finally {
    state.workflowActionBusyKey = null;
  }
}

export async function compareWorkflowVersion(
  state: WorkflowsState,
  workflow: string,
  fromSpecVersion: number,
) {
  if (!state.client || !state.connected) {
    return;
  }
  state.workflowDiffLoading = true;
  state.workflowDiffError = null;
  try {
    state.workflowDiff = await state.client.request<WorkflowDiffPayload>("workflow.diff", {
      workflow,
      specVersion: fromSpecVersion,
    });
  } catch (err) {
    state.workflowDiffError = toErrorMessage(err);
  } finally {
    state.workflowDiffLoading = false;
  }
}

export async function saveWorkflowDefinitionUpdate(state: WorkflowsState, workflow: string) {
  if (!state.client || !state.connected || !state.workflowEditorDraft) {
    return;
  }
  state.workflowActionBusyKey = `update:${workflow}`;
  state.workflowStatusError = null;
  try {
    const patch = {
      name: state.workflowEditorDraft.name.trim(),
      goal: state.workflowEditorDraft.goal.trim(),
      description: state.workflowEditorDraft.description.trim(),
      tags: state.workflowEditorDraft.tags
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean),
      topology: state.workflowEditorDraft.topology.trim(),
      safeForAutoRun: state.workflowEditorDraft.safeForAutoRun,
      requiresApproval: state.workflowEditorDraft.requiresApproval,
      inputs: parseWorkflowJsonArray(state.workflowEditorDraft.inputsJson, "Inputs"),
      outputs: parseWorkflowJsonArray(state.workflowEditorDraft.outputsJson, "Outputs"),
      steps: parseWorkflowJsonArray(state.workflowEditorDraft.stepsJson, "Steps"),
    };
    await state.client.request("workflow.update", {
      workflow,
      patch,
    });
    await loadWorkflows(state, {
      selectWorkflow: workflow,
      selectedExecutionId: state.workflowSelectedExecutionId,
    });
  } catch (err) {
    state.workflowStatusError = toErrorMessage(err);
  } finally {
    state.workflowActionBusyKey = null;
  }
}

export async function rollbackWorkflowVersion(
  state: WorkflowsState,
  workflow: string,
  specVersion: number,
  republish = false,
) {
  if (!state.client || !state.connected) {
    return;
  }
  state.workflowActionBusyKey = `${republish ? "rollback-republish" : "rollback"}:${workflow}:${specVersion}`;
  state.workflowStatusError = null;
  try {
    await state.client.request("workflow.rollback", {
      workflow,
      specVersion,
      ...(republish ? { republish: true } : {}),
    });
    await loadWorkflows(state, {
      selectWorkflow: workflow,
      selectedExecutionId: state.workflowSelectedExecutionId,
    });
  } catch (err) {
    state.workflowStatusError = toErrorMessage(err);
  } finally {
    state.workflowActionBusyKey = null;
  }
}

export function resetWorkflowEditor(state: WorkflowsState) {
  if (!state.workflowDetail) {
    state.workflowEditorDraft = null;
    return;
  }
  state.workflowEditorDraft = toEditorDraft(state.workflowDetail);
}

export async function setWorkflowArchived(
  state: WorkflowsState,
  workflow: string,
  archived: boolean,
) {
  if (!state.client || !state.connected) {
    return;
  }
  state.workflowActionBusyKey = `${archived ? "archive" : "unarchive"}:${workflow}`;
  state.workflowStatusError = null;
  try {
    await state.client.request<WorkflowMutationPayload>(
      archived ? "workflow.archive" : "workflow.unarchive",
      {
        workflow,
      },
    );
    await loadWorkflows(state, {
      selectWorkflow: workflow,
      selectedExecutionId: state.workflowSelectedExecutionId,
    });
  } catch (err) {
    state.workflowStatusError = toErrorMessage(err);
  } finally {
    state.workflowActionBusyKey = null;
  }
}

export async function deleteWorkflowDefinition(state: WorkflowsState, workflow: string) {
  if (!state.client || !state.connected) {
    return;
  }
  state.workflowActionBusyKey = `delete:${workflow}`;
  state.workflowStatusError = null;
  try {
    const payload = await state.client.request<WorkflowDeletePayload>("workflow.delete", {
      workflow,
    });
    const deletedWorkflowId = payload.workflowId ?? workflow;
    state.workflowsList = state.workflowsList.filter(
      (entry) => entry.workflowId !== deletedWorkflowId,
    );
    if (
      state.workflowSelectedId === workflow ||
      state.workflowDetail?.workflow.workflowId === deletedWorkflowId
    ) {
      state.workflowSelectedId = state.workflowsList[0]?.workflowId ?? null;
      state.workflowDetail = null;
      state.workflowRuns = [];
      state.workflowSelectedExecutionId = null;
      state.workflowSelectedExecution = null;
    }
    await loadWorkflows(state, {
      selectWorkflow: state.workflowSelectedId,
    });
  } catch (err) {
    state.workflowStatusError = toErrorMessage(err);
  } finally {
    state.workflowActionBusyKey = null;
  }
}

export async function runWorkflow(state: WorkflowsState, workflow: string) {
  if (!state.client || !state.connected) {
    return;
  }
  state.workflowActionBusyKey = `run:${workflow}`;
  state.workflowStatusError = null;
  try {
    const payload = await state.client.request<WorkflowExecutionActionPayload>("workflow.run", {
      workflow,
    });
    await loadWorkflows(state, {
      selectWorkflow: workflow,
      selectedExecutionId: payload.execution.executionId,
    });
  } catch (err) {
    state.workflowStatusError = toErrorMessage(err);
  } finally {
    state.workflowActionBusyKey = null;
  }
}

export async function cancelWorkflowExecution(state: WorkflowsState, executionId?: string | null) {
  if (!state.client || !state.connected) {
    return;
  }
  const resolvedExecutionId = executionId?.trim() || state.workflowSelectedExecutionId;
  if (!resolvedExecutionId) {
    return;
  }
  state.workflowActionBusyKey = `cancel:${resolvedExecutionId}`;
  state.workflowStatusError = null;
  try {
    const payload = await state.client.request<WorkflowExecutionActionPayload>("workflow.cancel", {
      executionId: resolvedExecutionId,
    });
    state.workflowSelectedExecutionId = payload.execution.executionId;
    state.workflowSelectedExecution = payload.execution;
    patchExecutionCollections(state, payload.execution);
  } catch (err) {
    state.workflowStatusError = toErrorMessage(err);
  } finally {
    state.workflowActionBusyKey = null;
  }
}

export async function resumeWorkflowExecution(
  state: WorkflowsState,
  executionId?: string | null,
  input?: string | null,
) {
  if (!state.client || !state.connected) {
    return;
  }
  const resolvedExecutionId = executionId?.trim() || state.workflowSelectedExecutionId;
  if (!resolvedExecutionId) {
    return;
  }
  state.workflowActionBusyKey = `resume:${resolvedExecutionId}`;
  state.workflowStatusError = null;
  try {
    const payload = await state.client.request<WorkflowExecutionActionPayload>("workflow.resume", {
      executionId: resolvedExecutionId,
      ...(input?.trim() ? { input: input.trim() } : {}),
    });
    state.workflowSelectedExecutionId = payload.execution.executionId;
    state.workflowSelectedExecution = payload.execution;
    state.workflowResumeDraft = "";
    patchExecutionCollections(state, payload.execution);
  } catch (err) {
    state.workflowStatusError = toErrorMessage(err);
  } finally {
    state.workflowActionBusyKey = null;
  }
}
