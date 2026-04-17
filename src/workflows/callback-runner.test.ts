import { afterEach, describe, expect, it } from "vitest";
import { createTrackedTempDirs } from "../test-utils/tracked-temp-dirs.js";
import { handleWorkflowAgentNodeCallback } from "./callback-runner.js";
import { createWorkflowExecutionRecord, getWorkflowExecution } from "./executions.js";

const tempDirs = createTrackedTempDirs();

afterEach(async () => {
  await tempDirs.cleanup();
});

describe("workflow callback runner", () => {
  it("runs workflow-step-agent callbacks and advances execution steps", async () => {
    const workspaceDir = await tempDirs.make("workflow-callback-");
    await createWorkflowExecutionRecord(
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

    const subagent = {
      run: async () => ({ runId: "run-1" }),
      waitForRun: async () => ({ status: "ok" as const }),
      getSessionMessages: async () => ({
        messages: [
          {
            role: "assistant",
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  status: "succeeded",
                  summary: "Draft completed",
                  output: { title: "AI workflow" },
                }),
              },
            ],
          },
        ],
      }),
      deleteSession: async () => {},
    };

    const handled = await handleWorkflowAgentNodeCallback(
      { workspaceDir },
      {
        subagent,
        request: {
          workflowId: "wf_publish_redbook_123",
          executionId: "exec_remote_1",
          stepId: "draft",
          goal: "Draft content",
        },
      },
    );

    expect(handled.result.status).toBe("succeeded");
    expect(handled.execution.status).toBe("running");
    expect(handled.execution.steps?.[0]?.status).toBe("succeeded");
    expect(handled.execution.steps?.[1]?.status).toBe("running");

    const persisted = await getWorkflowExecution({ workspaceDir }, "exec_remote_1");
    expect(persisted?.steps?.[0]?.summary).toBe("Draft completed");
  });

  it("marks callback execution failed when the subagent times out without a structured result", async () => {
    const workspaceDir = await tempDirs.make("workflow-callback-timeout-");
    await createWorkflowExecutionRecord(
      { workspaceDir },
      {
        workflowId: "wf_publish_redbook_123",
        workflowName: "Publish Redbook Note",
        spec: {
          workflowId: "wf_publish_redbook_123",
          name: "Publish Redbook Note",
          goal: "Generate and publish a redbook post",
          tags: [],
          inputs: [],
          outputs: [],
          steps: [
            { id: "draft", kind: "crawclaw_agent", title: "Draft content", goal: "Draft content" },
          ],
          createdAt: 0,
          updatedAt: 0,
        },
        remote: {
          executionId: "exec_remote_timeout",
          status: "running",
          finished: false,
        },
      },
    );

    const subagent = {
      run: async () => ({ runId: "run-timeout" }),
      waitForRun: async () => ({ status: "timeout" as const }),
      getSessionMessages: async () => ({ messages: [] }),
      deleteSession: async () => {},
    };

    const handled = await handleWorkflowAgentNodeCallback(
      { workspaceDir },
      {
        subagent,
        request: {
          workflowId: "wf_publish_redbook_123",
          executionId: "exec_remote_timeout",
          stepId: "draft",
          goal: "Draft content",
          timeoutMs: 1000,
        },
      },
    );

    expect(handled.result.status).toBe("failed");
    expect(handled.execution.status).toBe("failed");
    expect(handled.execution.steps?.[0]?.status).toBe("failed");
  });

  it("waits briefly for the local execution record before applying callback step updates", async () => {
    const workspaceDir = await tempDirs.make("workflow-callback-race-");

    const subagent = {
      run: async () => ({ runId: "run-race" }),
      waitForRun: async () => ({ status: "ok" as const }),
      getSessionMessages: async () => ({
        messages: [
          {
            role: "assistant",
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  status: "succeeded",
                  summary: "Draft completed after delayed record creation",
                }),
              },
            ],
          },
        ],
      }),
      deleteSession: async () => {},
    };

    const callbackPromise = handleWorkflowAgentNodeCallback(
      { workspaceDir },
      {
        subagent,
        request: {
          workflowId: "wf_publish_redbook_123",
          executionId: "exec_remote_delayed",
          stepId: "draft",
          goal: "Draft content",
        },
      },
    );

    await new Promise((resolve) => setTimeout(resolve, 50));

    await createWorkflowExecutionRecord(
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
          executionId: "exec_remote_delayed",
          status: "running",
          finished: false,
        },
      },
    );

    const handled = await callbackPromise;
    expect(handled.result.status).toBe("succeeded");
    expect(handled.execution.steps?.[0]?.status).toBe("succeeded");
    expect(handled.execution.steps?.[1]?.status).toBe("running");
  });

  it("runs compensation when a continue-policy fan_out branch fails", async () => {
    const workspaceDir = await tempDirs.make("workflow-callback-compensation-");
    await createWorkflowExecutionRecord(
      { workspaceDir },
      {
        workflowId: "wf_publish_redbook_123",
        workflowName: "Publish Redbook Note",
        spec: {
          workflowId: "wf_publish_redbook_123",
          name: "Publish Redbook Note",
          goal: "Generate and publish a redbook post",
          topology: "branch_v2",
          tags: [],
          inputs: [],
          outputs: [],
          steps: [
            {
              id: "draft",
              kind: "crawclaw_agent",
              title: "Draft content",
              goal: "Draft content",
              path: "draft",
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
                goal: "Compensate failed draft branch",
              },
            },
          ],
          createdAt: 0,
          updatedAt: 0,
        },
        remote: {
          executionId: "exec_remote_compensation",
          status: "running",
          finished: false,
        },
      },
    );

    let callIndex = 0;
    const subagent = {
      run: async () => ({ runId: `run-${++callIndex}` }),
      waitForRun: async () => ({ status: "ok" as const }),
      getSessionMessages: async ({ sessionKey }: { sessionKey: string }) => ({
        messages: [
          {
            role: "assistant",
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  sessionKey.includes("draft-compensation")
                    ? {
                        status: "succeeded",
                        summary: "Compensation completed",
                      }
                    : {
                        status: "failed",
                        summary: "Draft branch failed",
                        error: "branch exploded",
                      },
                ),
              },
            ],
          },
        ],
      }),
      deleteSession: async () => {},
    };

    const handled = await handleWorkflowAgentNodeCallback(
      { workspaceDir },
      {
        subagent,
        request: {
          workflowId: "wf_publish_redbook_123",
          executionId: "exec_remote_compensation",
          stepId: "draft",
          goal: "Draft content",
          branchGroup: "asset_bundle",
          stepPath: "draft",
          parallelFailurePolicy: "continue",
          parallelJoinPolicy: "best_effort",
          maxActiveBranches: 2,
          compensation: {
            mode: "crawclaw_agent",
            goal: "Compensate failed draft branch",
          },
          workspaceBinding: {
            workspaceDir,
          },
        },
      },
    );

    expect(handled.result.status).toBe("failed");
    expect(handled.compensation?.summary).toBe("Compensation completed");
    expect(handled.execution.status).toBe("running");
    expect(handled.execution.steps?.[0]).toMatchObject({
      status: "failed",
      compensationMode: "crawclaw_agent",
      compensationStatus: "succeeded",
      compensationSummary: "Compensation completed",
    });
  });
});
