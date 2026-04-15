import { afterEach, describe, expect, it } from "vitest";
import { createTrackedTempDirs } from "../test-utils/tracked-temp-dirs.js";
import {
  createWorkflowExecutionRecord,
  getWorkflowExecution,
  listWorkflowExecutions,
  syncWorkflowExecutionFromN8n,
  updateWorkflowExecutionStep,
} from "./executions.js";
import { buildWorkflowExecutionView } from "./status-view.js";

const tempDirs = createTrackedTempDirs();

afterEach(async () => {
  await tempDirs.cleanup();
});

describe("workflow executions", () => {
  it("creates, lists, syncs, and presents execution records", async () => {
    const workspaceDir = await tempDirs.make("workflow-executions-");

    const created = await createWorkflowExecutionRecord(
      { workspaceDir },
      {
        workflowId: "wf_publish_redbook_123",
        workflowName: "Publish Redbook Note",
        n8nWorkflowId: "wf_remote",
        spec: {
          workflowId: "wf_publish_redbook_123",
          name: "Publish Redbook Note",
          goal: "Generate and publish a redbook post",
          tags: [],
          inputs: [],
          outputs: [],
          steps: [
            { id: "draft", kind: "crawclaw_agent", title: "Draft content", goal: "Draft content" },
            { id: "review", kind: "human_wait", title: "Review", prompt: "Approve" },
          ],
          createdAt: 0,
          updatedAt: 0,
        },
        remote: {
          executionId: "exec_remote_1",
          status: "running",
          finished: false,
        },
      },
    );

    expect(created.executionId).toMatch(/^exec_/);
    expect(created.n8nExecutionId).toBe("exec_remote_1");
    expect(created.status).toBe("running");
    expect(created.steps).toHaveLength(2);
    expect(created.steps?.[0]?.status).toBe("running");
    expect(created.steps?.[1]?.status).toBe("pending");
    expect(created.steps?.[0]).toMatchObject({
      path: "main",
      activationMode: "sequential",
    });

    const advanced = await updateWorkflowExecutionStep({ workspaceDir }, created.executionId, {
      stepId: "draft",
      status: "succeeded",
      executor: "crawclaw_agent",
      summary: "Draft completed",
    });
    expect(advanced?.steps?.[0]?.status).toBe("succeeded");
    expect(advanced?.steps?.[1]?.status).toBe("running");

    const listed = await listWorkflowExecutions(
      { workspaceDir },
      { workflowId: "wf_publish_redbook_123" },
    );
    expect(listed).toHaveLength(1);
    expect(listed[0]?.workflowName).toBe("Publish Redbook Note");

    const synced = await syncWorkflowExecutionFromN8n({ workspaceDir }, created.executionId, {
      id: "exec_remote_1",
      status: "success",
      finished: true,
    });
    expect(synced?.status).toBe("succeeded");
    expect(synced?.remoteFinished).toBe(true);

    const fetched = await getWorkflowExecution({ workspaceDir }, "exec_remote_1");
    expect(fetched?.executionId).toBe(created.executionId);

    const view = buildWorkflowExecutionView({
      local: fetched,
      remote: {
        id: "exec_remote_1",
        status: "success",
        finished: true,
      },
    });
    expect(view.executionId).toBe(created.executionId);
    expect(view.n8nExecutionId).toBe("exec_remote_1");
    expect(view.status).toBe("succeeded");
    expect(view.source).toBe("local+n8n");
    expect(view.steps?.[0]?.status).toBe("succeeded");
  });

  it("derives wait resume URLs from n8n execution ids and resume tokens", () => {
    const view = buildWorkflowExecutionView({
      local: {
        executionId: "exec_local_1",
        workflowId: "wf_publish_redbook_123",
        workflowName: "Publish Redbook Note",
        n8nWorkflowId: "wf_remote",
        n8nExecutionId: "18",
        status: "waiting_external",
        currentStepId: "review",
        currentExecutor: "n8n_wait",
        startedAt: 1,
        updatedAt: 2,
        steps: [
          {
            stepId: "review",
            title: "Review",
            kind: "human_wait",
            status: "waiting",
            executor: "n8n_wait",
            updatedAt: 2,
            summary: "Approve publish",
          },
        ],
      },
      remote: {
        id: "18",
        status: "waiting",
        finished: false,
        data: {
          resumeToken: "resume-token-123",
        },
      },
      n8nBaseUrl: "https://n8n.example.com",
    });

    expect(view.waiting).toEqual({
      kind: "external",
      prompt: "Approve publish",
      resumeUrl: "https://n8n.example.com/webhook-waiting/18?signature=resume-token-123",
      canResume: true,
    });
  });

  it("does not mark waiting executions as ended when n8n provides stoppedAt", async () => {
    const workspaceDir = await tempDirs.make("workflow-executions-waiting-");

    const created = await createWorkflowExecutionRecord(
      { workspaceDir },
      {
        workflowId: "wf_publish_redbook_123",
        workflowName: "Publish Redbook Note",
        spec: {
          workflowId: "wf_publish_redbook_123",
          name: "Publish Redbook Note",
          goal: "Generate and publish a redbook post",
          topology: "linear_v1",
          tags: [],
          inputs: [],
          outputs: [],
          steps: [
            { id: "draft", kind: "crawclaw_agent", title: "Draft content", goal: "Draft content" },
            { id: "review", kind: "human_wait", prompt: "Approve" },
          ],
          createdAt: 0,
          updatedAt: 0,
        },
      },
    );

    await updateWorkflowExecutionStep({ workspaceDir }, created.executionId, {
      stepId: "draft",
      status: "succeeded",
      executor: "crawclaw_agent",
    });

    const synced = await syncWorkflowExecutionFromN8n({ workspaceDir }, created.executionId, {
      id: "exec_remote_waiting",
      status: "waiting",
      finished: false,
      stoppedAt: "2026-04-11T10:00:00.000Z",
      data: {
        resumeToken: "resume-token-456",
      },
    });

    expect(synced?.status).toBe("waiting_external");
    expect(synced?.endedAt).toBeUndefined();

    const view = buildWorkflowExecutionView({
      local: synced,
      remote: {
        id: "exec_remote_waiting",
        status: "waiting",
        finished: false,
        stoppedAt: "2026-04-11T10:00:00.000Z",
        data: {
          resumeToken: "resume-token-456",
        },
      },
      n8nBaseUrl: "https://n8n.example.com",
    });

    expect(view.status).toBe("waiting_external");
    expect(view.endedAt).toBeUndefined();
    expect(view.waiting?.canResume).toBe(true);
  });

  it("prepares branch-aware execution records without auto-succeeding untouched branch steps", async () => {
    const workspaceDir = await tempDirs.make("workflow-executions-branch-aware-");

    const created = await createWorkflowExecutionRecord(
      { workspaceDir },
      {
        workflowId: "wf_branching_123",
        workflowName: "Branching Draft",
        spec: {
          workflowId: "wf_branching_123",
          name: "Branching Draft",
          goal: "Prepare a future branch-aware workflow",
          topology: "branch_v2" as const,
          tags: [],
          inputs: [],
          outputs: [],
          steps: [
            {
              id: "prepare",
              kind: "native",
              title: "Prepare",
            },
            {
              id: "approve",
              kind: "human_wait",
              title: "Approval",
              path: "approval",
              branchGroup: "review",
              activation: {
                mode: "conditional",
                when: "{{ $json.requiresApproval === true }}",
              },
            },
            {
              id: "publish",
              kind: "service",
              title: "Publish",
              path: "publish",
              branchGroup: "review",
              activation: {
                mode: "conditional",
                when: "{{ $json.requiresApproval !== true }}",
              },
            },
          ],
          createdAt: 0,
          updatedAt: 0,
        },
        remote: {
          executionId: "exec_remote_branch_1",
          status: "running",
          finished: false,
        },
      },
    );

    expect(created.topology).toBe("branch_v2");
    expect(created.steps?.[1]).toMatchObject({
      path: "approval",
      branchGroup: "review",
      activationMode: "conditional",
      activationWhen: "{{ $json.requiresApproval === true }}",
    });

    const synced = await syncWorkflowExecutionFromN8n({ workspaceDir }, created.executionId, {
      id: "exec_remote_branch_1",
      status: "success",
      finished: true,
    });

    expect(synced?.status).toBe("succeeded");
    expect(synced?.steps?.[0]?.status).toBe("succeeded");
    expect(synced?.steps?.[1]?.status).toBe("pending");
    expect(synced?.steps?.[2]?.status).toBe("pending");
  });

  it("projects branch-aware runData into waiting and skipped step states", async () => {
    const workspaceDir = await tempDirs.make("workflow-executions-branch-run-data-");

    const created = await createWorkflowExecutionRecord(
      { workspaceDir },
      {
        workflowId: "wf_branching_run_data_123",
        workflowName: "Branching Run Data",
        spec: {
          workflowId: "wf_branching_run_data_123",
          name: "Branching Run Data",
          goal: "Project branch state from n8n runData",
          topology: "branch_v2",
          tags: [],
          inputs: [],
          outputs: [],
          steps: [
            {
              id: "prepare",
              kind: "native",
              title: "Prepare",
            },
            {
              id: "approval_path",
              kind: "human_wait",
              title: "Approval Path",
              path: "approval",
              branchGroup: "review",
              activation: {
                mode: "conditional",
                when: "{{ $json.requiresApproval === true }}",
                fromStepIds: ["prepare"],
              },
            },
            {
              id: "fast_path",
              kind: "service",
              title: "Fast Path",
              path: "fast",
              branchGroup: "review",
              activation: {
                mode: "conditional",
                when: "{{ $json.requiresApproval !== true }}",
                fromStepIds: ["prepare"],
              },
            },
            {
              id: "publish",
              kind: "service",
              title: "Publish",
              activation: {
                mode: "fan_in",
                fromStepIds: ["approval_path", "fast_path"],
              },
            },
          ],
          createdAt: 0,
          updatedAt: 0,
        },
        remote: {
          executionId: "exec_remote_branch_run_data_1",
          status: "running",
          finished: false,
        },
      },
    );

    const synced = await syncWorkflowExecutionFromN8n({ workspaceDir }, created.executionId, {
      id: "exec_remote_branch_run_data_1",
      status: "waiting",
      finished: false,
      data: {
        resultData: {
          lastNodeExecuted: "2. approval_path · Approval Path",
          runData: {
            "1. prepare · Prepare": [{}],
            "2. approval_path · Approval Path": [{}],
          },
        },
        resumeToken: "resume-branch-token-1",
      },
    });

    expect(synced?.status).toBe("waiting_external");
    expect(synced?.currentStepId).toBe("approval_path");
    expect(synced?.steps?.[0]?.status).toBe("succeeded");
    expect(synced?.steps?.[1]?.status).toBe("waiting");
    expect(synced?.steps?.[2]?.status).toBe("skipped");
    expect(synced?.steps?.[2]?.skippedReason).toContain("Branch group");
    expect(synced?.steps?.[3]?.status).toBe("pending");
  });

  it("keeps sibling fan_out branches pending instead of skipping them", async () => {
    const workspaceDir = await tempDirs.make("workflow-executions-fan-out-run-data-");

    const created = await createWorkflowExecutionRecord(
      { workspaceDir },
      {
        workflowId: "wf_branching_fan_out_123",
        workflowName: "Branching Fan Out",
        spec: {
          workflowId: "wf_branching_fan_out_123",
          name: "Branching Fan Out",
          goal: "Project fan_out state from n8n runData",
          topology: "branch_v2",
          tags: [],
          inputs: [],
          outputs: [],
          steps: [
            {
              id: "prepare",
              kind: "native",
              title: "Prepare",
            },
            {
              id: "title_path",
              kind: "crawclaw_agent",
              title: "Draft Title",
              path: "title",
              branchGroup: "draft_assets",
              activation: {
                mode: "fan_out",
                fromStepIds: ["prepare"],
              },
            },
            {
              id: "cover_path",
              kind: "service",
              title: "Draft Cover",
              path: "cover",
              branchGroup: "draft_assets",
              activation: {
                mode: "fan_out",
                fromStepIds: ["prepare"],
              },
            },
            {
              id: "publish",
              kind: "service",
              title: "Publish",
              activation: {
                mode: "fan_in",
                fromStepIds: ["title_path", "cover_path"],
              },
            },
          ],
          createdAt: 0,
          updatedAt: 0,
        },
        remote: {
          executionId: "exec_remote_fan_out_run_data_1",
          status: "running",
          finished: false,
        },
      },
    );

    const synced = await syncWorkflowExecutionFromN8n({ workspaceDir }, created.executionId, {
      id: "exec_remote_fan_out_run_data_1",
      status: "running",
      finished: false,
      data: {
        resultData: {
          lastNodeExecuted: "2. title_path · Draft Title",
          runData: {
            "1. prepare · Prepare": [{}],
            "2. title_path · Draft Title": [{}],
          },
        },
      },
    });

    expect(synced?.steps?.[0]).toMatchObject({
      status: "succeeded",
    });
    expect(synced?.steps?.[1]).toMatchObject({
      status: "running",
      branchResolution: "parallel",
    });
    expect(synced?.steps?.[2]).toMatchObject({
      status: "pending",
      branchResolution: "parallel",
    });
    expect(synced?.steps?.[2]?.skippedReason).toBeUndefined();
    expect(synced?.steps?.[3]?.status).toBe("pending");
  });

  it("keeps workflow running when a fan_out branch fails with continue policy", async () => {
    const workspaceDir = await tempDirs.make("workflow-executions-fan-out-continue-");

    const created = await createWorkflowExecutionRecord(
      { workspaceDir },
      {
        workflowId: "wf_branching_fan_out_continue_123",
        workflowName: "Branching Fan Out Continue",
        spec: {
          workflowId: "wf_branching_fan_out_continue_123",
          name: "Branching Fan Out Continue",
          goal: "Keep workflow alive after a parallel branch failure",
          topology: "branch_v2",
          tags: [],
          inputs: [],
          outputs: [],
          steps: [
            {
              id: "prepare",
              kind: "native",
              title: "Prepare",
            },
            {
              id: "title_path",
              kind: "crawclaw_agent",
              title: "Draft Title",
              path: "title",
              branchGroup: "asset_bundle",
              activation: {
                mode: "fan_out",
                fromStepIds: ["prepare"],
                parallel: {
                  failurePolicy: "continue",
                  joinPolicy: "best_effort",
                  maxActiveBranches: 2,
                },
              },
              compensation: {
                mode: "crawclaw_agent",
                goal: "Compensate failed title branch",
              },
            },
            {
              id: "cover_path",
              kind: "native",
              title: "Draft Cover",
              path: "cover",
              branchGroup: "asset_bundle",
              activation: {
                mode: "fan_out",
                fromStepIds: ["prepare"],
                parallel: {
                  failurePolicy: "continue",
                  joinPolicy: "best_effort",
                  maxActiveBranches: 2,
                },
              },
            },
            {
              id: "publish",
              kind: "native",
              title: "Publish",
              activation: {
                mode: "fan_in",
                fromStepIds: ["title_path", "cover_path"],
                parallel: {
                  joinPolicy: "best_effort",
                },
              },
            },
          ],
          createdAt: 0,
          updatedAt: 0,
        },
        remote: {
          executionId: "exec_remote_fan_out_continue_1",
          status: "running",
          finished: false,
        },
      },
    );

    const failed = await updateWorkflowExecutionStep({ workspaceDir }, created.executionId, {
      stepId: "title_path",
      status: "failed",
      executor: "crawclaw_agent",
      summary: "Draft title failed",
      error: "branch exploded",
    });

    expect(failed?.status).toBe("running");
    expect(failed?.endedAt).toBeUndefined();
    expect(failed?.steps?.find((step) => step.stepId === "title_path")).toMatchObject({
      status: "failed",
      parallelFailurePolicy: "continue",
      maxActiveBranches: 2,
      compensationMode: "crawclaw_agent",
    });
  });
});
