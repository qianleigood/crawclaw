/* @vitest-environment jsdom */

import { render } from "lit";
import { describe, expect, it } from "vitest";
import { renderWorkflows, type WorkflowsProps } from "./workflows.ts";

function createProps(overrides: Partial<WorkflowsProps> = {}): WorkflowsProps {
  return {
    connected: true,
    loading: false,
    error: null,
    detailLoading: false,
    detailError: null,
    runsLoading: false,
    runsError: null,
    statusLoading: false,
    statusError: null,
    workflows: [
      {
        workflowId: "wf-main",
        name: "Main workflow",
        description: "Primary pipeline",
        tags: ["ops"],
        enabled: true,
        deploymentState: "deployed",
        requiresApproval: true,
        archivedAt: null,
        runCount: 4,
        scope: "workspace",
        recentExecution: null,
      } as never,
    ],
    filterQuery: "",
    filterState: "all",
    selectedWorkflowId: "wf-main",
    detail: {
      workflow: {
        workflowId: "wf-main",
        name: "Main workflow",
        description: "Primary pipeline",
        deploymentState: "deployed",
        enabled: true,
        archivedAt: null,
        scope: "workspace",
        deploymentVersion: 2,
        specVersion: 2,
        requiresApproval: true,
        safeForAutoRun: true,
        lastRunAt: null,
        tags: ["ops"],
      },
      spec: {
        goal: "Process input",
        inputs: [],
        outputs: [],
        steps: [],
      },
      specPath: "/tmp/workflows/wf-main/spec.json",
      storeRoot: "/tmp/workflows",
    } as never,
    runs: [],
    versionsLoading: false,
    versionsError: null,
    versions: null,
    diffLoading: false,
    diffError: null,
    diffSnapshot: {
      fromSpecVersion: 1,
      toSpecVersion: 2,
      diff: {
        summary: {
          basicChanged: true,
          policyChanged: false,
          stepsAdded: 1,
          stepsUpdated: 0,
        },
        changes: {
          basic: [],
          policy: [],
          inputs: [],
          outputs: [],
          steps: [],
        },
      },
    } as never,
    editorDraft: {
      name: "Main workflow",
      goal: "Process input",
      description: "",
      tags: "",
      topology: "linear_v1",
      safeForAutoRun: true,
      requiresApproval: true,
      inputsJson: "{}",
      outputsJson: "{}",
      stepsJson: "[]",
    },
    selectedExecutionId: "exec-1",
    selectedExecution: {
      executionId: "exec-1",
      status: "running",
      currentExecutor: "agent",
    } as never,
    resumeDraft: "",
    actionBusyKey: null,
    onRefresh: () => {},
    onFilterQueryChange: () => {},
    onFilterStateChange: () => {},
    onSelectWorkflow: () => {},
    onDeploy: () => {},
    onRepublish: () => {},
    onRun: () => {},
    onToggleEnabled: () => {},
    onSetArchived: () => {},
    onDeleteWorkflow: () => {},
    onCompareVersion: () => {},
    onEditorChange: () => {},
    onResetEditor: () => {},
    onSaveEditor: () => {},
    onRollbackVersion: () => {},
    onSelectExecution: () => {},
    onRefreshExecution: () => {},
    onCancelExecution: () => {},
    onResumeDraftChange: () => {},
    onResumeExecution: () => {},
    ...overrides,
  };
}

describe("renderWorkflows", () => {
  it("renders workflow runtime context strip", async () => {
    const container = document.createElement("div");
    render(renderWorkflows(createProps()), container);
    await Promise.resolve();

    expect(container.textContent).toContain("Workflow id");
    expect(container.textContent).toContain("wf-main");
    expect(container.textContent).toContain("Execution");
    expect(container.textContent).toContain("exec-1");
    expect(container.textContent).toContain("Editor");
    expect(container.textContent).toContain("Loaded");
    expect(container.textContent).toContain("Diff");
    expect(container.textContent).toContain("v1 -> v2");
  });
});
