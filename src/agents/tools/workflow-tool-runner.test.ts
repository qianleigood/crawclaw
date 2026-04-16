import { beforeEach, describe, expect, it, vi } from "vitest";
import { executeWorkflowToolAction } from "./workflow-tool-runner.js";

const mocks = vi.hoisted(() => ({
  getAgentRunContext: vi.fn(),
  peekToolCallRuntimeContext: vi.fn(),
  resolveRunnableWorkflowForExecution: vi.fn(),
  requireWorkflowN8nRuntime: vi.fn(),
  startWorkflowExecution: vi.fn(),
}));

vi.mock("../../infra/agent-events.js", () => ({
  getAgentRunContext: mocks.getAgentRunContext,
}));

vi.mock("../pi-tools.before-tool-call.js", () => ({
  peekToolCallRuntimeContext: mocks.peekToolCallRuntimeContext,
}));

vi.mock("../../workflows/api.js", () => ({
  buildWorkflowCatalogPayload: vi.fn(),
  buildWorkflowDiffPayload: vi.fn(),
  buildWorkflowMatchPayload: vi.fn(),
  buildWorkflowRunsPayload: vi.fn(),
  buildWorkflowVersionsPayload: vi.fn(),
  cancelWorkflowExecution: vi.fn(),
  deleteWorkflowPayload: vi.fn(),
  describeWorkflowWithRecentExecutions: vi.fn(),
  deployWorkflowDefinition: vi.fn(),
  readWorkflowExecutionStatus: vi.fn(),
  requireWorkflowN8nRuntime: mocks.requireWorkflowN8nRuntime,
  resolveRunnableWorkflowForExecution: mocks.resolveRunnableWorkflowForExecution,
  rollbackWorkflowWithOptionalRepublish: vi.fn(),
  resumeWorkflowExecution: vi.fn(),
  setWorkflowArchivedPayload: vi.fn(),
  setWorkflowEnabledPayload: vi.fn(),
  startWorkflowExecution: mocks.startWorkflowExecution,
  updateWorkflowDefinitionPayload: vi.fn(),
  WorkflowOperationInputError: class WorkflowOperationInputError extends Error {},
  WorkflowOperationUnavailableError: class WorkflowOperationUnavailableError extends Error {},
}));

describe("workflow tool runner", () => {
  beforeEach(() => {
    mocks.getAgentRunContext.mockReset();
    mocks.peekToolCallRuntimeContext.mockReset();
    mocks.resolveRunnableWorkflowForExecution.mockReset();
    mocks.requireWorkflowN8nRuntime.mockReset();
    mocks.startWorkflowExecution.mockReset();
  });

  it("passes execution visibility mode into workflow origin metadata", async () => {
    mocks.peekToolCallRuntimeContext.mockReturnValue({
      runId: "run-1",
      sessionKey: "agent:main:main",
      sessionId: "session-1",
      agentId: "main",
    });
    mocks.getAgentRunContext.mockReturnValue({
      taskId: "task-1",
      parentAgentId: "parent-1",
      verboseLevel: "full",
    });
    mocks.resolveRunnableWorkflowForExecution.mockResolvedValue({
      entry: {
        workflowId: "wf_publish_redbook_123",
        name: "Publish Redbook Note",
        n8nWorkflowId: "wf_remote",
      },
      spec: {
        workflowId: "wf_publish_redbook_123",
        name: "Publish Redbook Note",
        goal: "Publish a note",
        tags: [],
        inputs: [],
        outputs: [],
        steps: [],
        createdAt: 0,
        updatedAt: 0,
      },
    });
    mocks.requireWorkflowN8nRuntime.mockReturnValue({
      client: { triggerWebhook: vi.fn(), listExecutions: vi.fn() },
      resolved: { baseUrl: "https://n8n.example.com" },
    });
    mocks.startWorkflowExecution.mockResolvedValue({
      execution: {
        executionId: "exec_123",
      },
    });

    await executeWorkflowToolAction(
      {
        workspaceDir: "/tmp/workspace",
        sessionKey: "agent:main:main",
        sessionId: "session-1",
        config: {} as never,
      },
      "tool-wf-1",
      {
        action: "run",
        workflow: "Publish Redbook Note",
      },
    );

    expect(mocks.startWorkflowExecution).toHaveBeenCalledWith(
      expect.objectContaining({
        origin: expect.objectContaining({
          runId: "run-1",
          workspaceDir: "/tmp/workspace",
          sessionKey: "agent:main:main",
          sessionId: "session-1",
          agentId: "main",
          taskId: "task-1",
          parentAgentId: "parent-1",
          toolCallId: "tool-wf-1",
          visibilityMode: "full",
        }),
      }),
    );
  });
});
