import { describe, expect, it, vi } from "vitest";
import type { WorkflowExecutionView } from "../../../../src/workflows/types.js";
import {
  compareWorkflowVersion,
  loadWorkflows,
  republishWorkflow,
  resetWorkflowEditor,
  refreshWorkflowExecutionStatus,
  resumeWorkflowExecution,
  runWorkflow,
  saveWorkflowDefinitionUpdate,
  type WorkflowsState,
} from "./workflows.ts";

function createState(
  requestImpl: (method: string, params?: unknown) => Promise<unknown>,
): WorkflowsState {
  return {
    client: {
      request: vi.fn(requestImpl),
    } as unknown as WorkflowsState["client"],
    connected: true,
    workflowLoading: false,
    workflowError: null,
    workflowsList: [],
    workflowSelectedId: null,
    workflowDetailLoading: false,
    workflowDetailError: null,
    workflowDetail: null,
    workflowRunsLoading: false,
    workflowRunsError: null,
    workflowRuns: [],
    workflowVersionsLoading: false,
    workflowVersionsError: null,
    workflowVersions: null,
    workflowDiffLoading: false,
    workflowDiffError: null,
    workflowDiff: null,
    workflowEditorDraft: null,
    workflowSelectedExecutionId: null,
    workflowSelectedExecution: null,
    workflowStatusLoading: false,
    workflowStatusError: null,
    workflowActionBusyKey: null,
    workflowFilterQuery: "",
    workflowFilterState: "all",
    workflowResumeDraft: "",
  };
}

describe("workflow controllers", () => {
  it("loads workflows and hydrates selected detail + runs", async () => {
    const execution: WorkflowExecutionView = {
      executionId: "exec_1",
      workflowId: "wf_1",
      workflowName: "Publish Redbook",
      status: "running",
      currentStepId: "draft",
      currentExecutor: "crawclaw_agent",
      updatedAt: Date.now(),
      source: "local",
    };
    const state = createState(async (method, params) => {
      switch (method) {
        case "workflow.list":
          expect(params).toEqual({ includeDisabled: true });
          return {
            count: 1,
            workflows: [
              {
                workflowId: "wf_1",
                name: "Publish Redbook",
                scope: "workspace",
                target: "n8n",
                enabled: true,
                safeForAutoRun: false,
                requiresApproval: true,
                tags: ["redbook"],
                specVersion: 1,
                deploymentVersion: 0,
                deploymentState: "draft",
                createdAt: 1,
                updatedAt: 2,
                runCount: 1,
                recentExecution: execution,
              },
            ],
          };
        case "workflow.get":
          expect(params).toEqual({ workflow: "wf_1", recentRunsLimit: 12 });
          return {
            workflow: {
              workflowId: "wf_1",
              name: "Publish Redbook",
              scope: "workspace",
              target: "n8n",
              enabled: true,
              safeForAutoRun: false,
              requiresApproval: true,
              tags: ["redbook"],
              specVersion: 1,
              deploymentVersion: 0,
              deploymentState: "draft",
              createdAt: 1,
              updatedAt: 2,
            },
            spec: {
              workflowId: "wf_1",
              name: "Publish Redbook",
              goal: "publish",
              tags: ["redbook"],
              inputs: [],
              outputs: [],
              steps: [{ id: "draft", kind: "crawclaw_agent", goal: "write" }],
              createdAt: 1,
              updatedAt: 2,
            },
            specPath: "/tmp/spec.json",
            storeRoot: "/tmp/.crawclaw/workflows",
            recentExecutions: [execution],
          };
        case "workflow.runs":
          expect(params).toEqual({ workflow: "wf_1", limit: 25 });
          return {
            count: 1,
            executions: [execution],
          };
        case "workflow.versions":
          expect(params).toEqual({ workflow: "wf_1" });
          return {
            workflow: {
              workflowId: "wf_1",
              name: "Publish Redbook",
              scope: "workspace",
              target: "n8n",
              enabled: true,
              safeForAutoRun: false,
              requiresApproval: true,
              tags: ["redbook"],
              specVersion: 1,
              deploymentVersion: 0,
              deploymentState: "draft",
              createdAt: 1,
              updatedAt: 2,
            },
            specVersions: [
              {
                workflowId: "wf_1",
                specVersion: 1,
                savedAt: 2,
                reason: "create",
                name: "Publish Redbook",
                goal: "publish",
                topology: "linear_v1",
              },
            ],
            deployments: [],
            currentDeployment: null,
          };
        default:
          throw new Error(`unexpected method ${method}`);
      }
    });

    await loadWorkflows(state);

    expect(state.workflowsList).toHaveLength(1);
    expect(state.workflowSelectedId).toBe("wf_1");
    expect(state.workflowDetail?.workflow.workflowId).toBe("wf_1");
    expect(state.workflowRuns).toHaveLength(1);
    expect(state.workflowVersions?.specVersions).toHaveLength(1);
    expect(state.workflowEditorDraft?.name).toBe("Publish Redbook");
    expect(state.workflowSelectedExecutionId).toBe("exec_1");
    expect(state.workflowSelectedExecution?.executionId).toBe("exec_1");
  });

  it("refreshes selected execution status and patches collections", async () => {
    const state = createState(async (method) => {
      expect(method).toBe("workflow.status");
      return {
        execution: {
          executionId: "exec_9",
          workflowId: "wf_9",
          workflowName: "Workflow 9",
          status: "succeeded",
          currentStepId: "publish",
          currentExecutor: "n8n",
          updatedAt: 999,
          source: "local+n8n",
        } satisfies WorkflowExecutionView,
      };
    });
    state.workflowSelectedExecutionId = "exec_9";
    state.workflowSelectedExecution = {
      executionId: "exec_9",
      workflowId: "wf_9",
      status: "running",
      updatedAt: 100,
      source: "local",
    };
    state.workflowRuns = [state.workflowSelectedExecution];
    state.workflowsList = [
      {
        workflowId: "wf_9",
        name: "Workflow 9",
        scope: "workspace",
        target: "n8n",
        enabled: true,
        safeForAutoRun: true,
        requiresApproval: false,
        tags: [],
        specVersion: 1,
        deploymentVersion: 1,
        deploymentState: "deployed",
        createdAt: 1,
        updatedAt: 2,
        runCount: 1,
        recentExecution: state.workflowSelectedExecution,
      },
    ];

    await refreshWorkflowExecutionStatus(state, "exec_9");

    expect(state.workflowSelectedExecution?.status).toBe("succeeded");
    expect(state.workflowRuns[0]?.status).toBe("succeeded");
    expect(state.workflowsList[0]?.recentExecution?.status).toBe("succeeded");
  });

  it("runs a workflow then reloads list/detail around the new execution", async () => {
    const request = vi.fn(async (method, params) => {
      switch (method) {
        case "workflow.run":
          expect(params).toEqual({ workflow: "wf_run" });
          return {
            execution: {
              executionId: "exec_run_1",
              workflowId: "wf_run",
              workflowName: "Workflow Run",
              status: "queued",
              updatedAt: 10,
              source: "local+n8n",
            } satisfies WorkflowExecutionView,
          };
        case "workflow.list":
          return {
            count: 1,
            workflows: [
              {
                workflowId: "wf_run",
                name: "Workflow Run",
                scope: "workspace",
                target: "n8n",
                enabled: true,
                safeForAutoRun: true,
                requiresApproval: false,
                tags: [],
                specVersion: 1,
                deploymentVersion: 1,
                deploymentState: "deployed",
                createdAt: 1,
                updatedAt: 2,
                runCount: 1,
                recentExecution: {
                  executionId: "exec_run_1",
                  workflowId: "wf_run",
                  status: "queued",
                  updatedAt: 10,
                  source: "local",
                } satisfies WorkflowExecutionView,
              },
            ],
          };
        case "workflow.get":
          return {
            workflow: {
              workflowId: "wf_run",
              name: "Workflow Run",
              scope: "workspace",
              target: "n8n",
              enabled: true,
              safeForAutoRun: true,
              requiresApproval: false,
              tags: [],
              specVersion: 1,
              deploymentVersion: 1,
              deploymentState: "deployed",
              createdAt: 1,
              updatedAt: 2,
            },
            spec: {
              workflowId: "wf_run",
              name: "Workflow Run",
              goal: "run",
              tags: [],
              inputs: [],
              outputs: [],
              steps: [],
              createdAt: 1,
              updatedAt: 2,
            },
            specPath: "/tmp/workflow-run.json",
            storeRoot: "/tmp/.crawclaw/workflows",
            recentExecutions: [
              {
                executionId: "exec_run_1",
                workflowId: "wf_run",
                status: "queued",
                updatedAt: 10,
                source: "local",
              } satisfies WorkflowExecutionView,
            ],
          };
        case "workflow.runs":
          return {
            count: 1,
            executions: [
              {
                executionId: "exec_run_1",
                workflowId: "wf_run",
                status: "queued",
                updatedAt: 10,
                source: "local",
              } satisfies WorkflowExecutionView,
            ],
          };
        case "workflow.versions":
          return {
            workflow: {
              workflowId: "wf_run",
              name: "Workflow Run",
              scope: "workspace",
              target: "n8n",
              enabled: true,
              safeForAutoRun: true,
              requiresApproval: false,
              tags: [],
              specVersion: 1,
              deploymentVersion: 1,
              deploymentState: "deployed",
              createdAt: 1,
              updatedAt: 2,
            },
            specVersions: [
              {
                workflowId: "wf_run",
                specVersion: 1,
                savedAt: 2,
                reason: "create",
                name: "Workflow Run",
                goal: "run",
                topology: "linear_v1",
              },
            ],
            deployments: [
              {
                workflowId: "wf_run",
                deploymentVersion: 1,
                specVersion: 1,
                n8nWorkflowId: "wf_remote",
                publishedAt: 2,
              },
            ],
            currentDeployment: {
              workflowId: "wf_run",
              deploymentVersion: 1,
              specVersion: 1,
              n8nWorkflowId: "wf_remote",
              publishedAt: 2,
            },
          };
        case "workflow.diff":
          return {
            workflow: {
              workflowId: "wf_run",
              name: "Workflow Run",
            },
            fromSpecVersion: 1,
            toSpecVersion: 1,
            diff: {
              summary: {
                basicChanged: false,
                inputsChanged: false,
                outputsChanged: false,
                policyChanged: false,
                stepsAdded: 0,
                stepsRemoved: 0,
                stepsUpdated: 0,
              },
              changes: {
                basic: [],
                inputs: [],
                outputs: [],
                policy: [],
                steps: [],
              },
            },
          };
        default:
          throw new Error(`unexpected method ${method}`);
      }
    });
    const state = createState(async (method, params) => request(method, params));

    await runWorkflow(state, "wf_run");

    expect(state.workflowSelectedId).toBe("wf_run");
    expect(state.workflowSelectedExecutionId).toBe("exec_run_1");
    expect(state.workflowSelectedExecution?.executionId).toBe("exec_run_1");
    expect(request).toHaveBeenCalledWith("workflow.run", { workflow: "wf_run" });
  });

  it("loads versions, compares diffs, saves spec updates, and republishes", async () => {
    const request = vi.fn(async (method, params) => {
      switch (method) {
        case "workflow.versions":
          return {
            workflow: {
              workflowId: "wf_edit",
              name: "Workflow Edit",
              scope: "workspace",
              target: "n8n",
              enabled: true,
              safeForAutoRun: false,
              requiresApproval: true,
              tags: ["ops"],
              specVersion: 2,
              deploymentVersion: 1,
              deploymentState: "draft",
              createdAt: 1,
              updatedAt: 2,
            },
            specVersions: [
              {
                workflowId: "wf_edit",
                specVersion: 2,
                savedAt: 2,
                reason: "update",
                name: "Workflow Edit",
                goal: "edit",
                topology: "linear_v1",
              },
              {
                workflowId: "wf_edit",
                specVersion: 1,
                savedAt: 1,
                reason: "create",
                name: "Workflow Edit",
                goal: "edit",
                topology: "linear_v1",
              },
            ],
            deployments: [],
            currentDeployment: null,
          };
        case "workflow.diff":
          return {
            workflow: { workflowId: "wf_edit", name: "Workflow Edit" },
            fromSpecVersion: (params as { specVersion?: number }).specVersion ?? 1,
            toSpecVersion: 2,
            diff: {
              summary: {
                basicChanged: true,
                inputsChanged: false,
                outputsChanged: false,
                policyChanged: false,
                stepsAdded: 0,
                stepsRemoved: 0,
                stepsUpdated: 1,
              },
              changes: {
                basic: [{ field: "description", before: "before", after: "after" }],
                inputs: [],
                outputs: [],
                policy: [],
                steps: [],
              },
            },
          };
        case "workflow.update":
          expect(params).toMatchObject({
            workflow: "wf_edit",
            patch: {
              name: "Workflow Edit",
              goal: "edit",
            },
          });
          return { workflow: { workflowId: "wf_edit" } };
        case "workflow.republish":
          expect(params).toEqual({ workflow: "wf_edit" });
          return { workflow: { workflowId: "wf_edit" } };
        case "workflow.list":
          return { count: 0, workflows: [] };
        default:
          throw new Error(`unexpected method ${method}`);
      }
    });
    const state = createState(async (method, params) => request(method, params));
    state.workflowDetail = {
      workflow: {
        workflowId: "wf_edit",
        name: "Workflow Edit",
        scope: "workspace",
        target: "n8n",
        enabled: true,
        safeForAutoRun: false,
        requiresApproval: true,
        tags: ["ops"],
        specVersion: 2,
        deploymentVersion: 1,
        deploymentState: "draft",
        createdAt: 1,
        updatedAt: 2,
      },
      spec: {
        workflowId: "wf_edit",
        name: "Workflow Edit",
        goal: "edit",
        description: "desc",
        topology: "linear_v1",
        tags: ["ops"],
        inputs: [],
        outputs: [],
        steps: [{ id: "step_1", kind: "crawclaw_agent" }],
        createdAt: 1,
        updatedAt: 2,
      },
      specPath: "/tmp/workflow-edit.json",
      storeRoot: "/tmp/.crawclaw/workflows",
      recentExecutions: [],
    };
    resetWorkflowEditor(state);

    await compareWorkflowVersion(state, "wf_edit", 1);
    expect(state.workflowDiff?.fromSpecVersion).toBe(1);

    state.workflowEditorDraft = {
      ...state.workflowEditorDraft!,
      description: "updated",
      tags: "ops, edited",
      inputsJson: "[]",
      outputsJson: "[]",
      stepsJson: '[{"id":"step_1","kind":"crawclaw_agent"}]',
    };
    await saveWorkflowDefinitionUpdate(state, "wf_edit");
    await republishWorkflow(state, "wf_edit");

    expect(request).toHaveBeenCalledWith("workflow.update", expect.anything());
    expect(request).toHaveBeenCalledWith("workflow.republish", { workflow: "wf_edit" });
  });

  it("resumes a waiting workflow execution and clears draft input", async () => {
    const state = createState(async (method, params) => {
      expect(method).toBe("workflow.resume");
      expect(params).toEqual({ executionId: "exec_wait_1", input: '{"approved":true}' });
      return {
        execution: {
          executionId: "exec_wait_1",
          workflowId: "wf_wait",
          status: "running",
          updatedAt: 15,
          source: "local+n8n",
        } satisfies WorkflowExecutionView,
      };
    });
    state.workflowSelectedExecutionId = "exec_wait_1";
    state.workflowSelectedExecution = {
      executionId: "exec_wait_1",
      workflowId: "wf_wait",
      status: "waiting_input",
      updatedAt: 10,
      source: "local+n8n",
      waiting: {
        kind: "input",
        canResume: true,
        resumeUrl: "https://n8n.example.com/webhook-waiting/123",
      },
    };
    state.workflowResumeDraft = '{"approved":true}';

    await resumeWorkflowExecution(state, "exec_wait_1", state.workflowResumeDraft);

    expect(state.workflowSelectedExecution?.status).toBe("running");
    expect(state.workflowResumeDraft).toBe("");
  });
});
