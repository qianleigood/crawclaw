import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTrackedTempDirs } from "../test-utils/tracked-temp-dirs.js";
import {
  createWorkflowExecutionRecord,
  syncWorkflowExecutionFromN8n,
  updateWorkflowExecutionStep,
} from "./executions.js";

const tempDirs = createTrackedTempDirs();
const mocks = vi.hoisted(() => ({
  emitAgentActionEvent: vi.fn(),
}));

vi.mock("../agents/action-feed/emit.js", () => ({
  emitAgentActionEvent: mocks.emitAgentActionEvent,
}));

describe("workflow action feed integration", () => {
  beforeEach(() => {
    mocks.emitAgentActionEvent.mockReset();
  });

  afterEach(async () => {
    await tempDirs.cleanup();
  });

  it("emits root and step workflow actions for agent-originated executions", async () => {
    const workspaceDir = await tempDirs.make("workflow-action-feed-");

    const created = await createWorkflowExecutionRecord(
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
            { id: "review", kind: "human_wait", title: "Review", prompt: "Approve" },
          ],
          createdAt: 0,
          updatedAt: 0,
        },
        initialStatus: "running",
        origin: {
          runId: "run-1",
          sessionKey: "main",
          sessionId: "session-1",
          taskId: "task-1",
          agentId: "main",
          parentAgentId: "root",
          toolCallId: "tool-wf-1",
        },
      },
    );

    expect(mocks.emitAgentActionEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: "run-1",
        sessionKey: "main",
        sessionId: "session-1",
        taskId: "task-1",
        agentId: "main",
        parentAgentId: "root",
        data: expect.objectContaining({
          actionId: `workflow:${created.executionId}`,
          kind: "workflow",
          status: "running",
          projectedTitle: "Running workflow: Publish Redbook Note",
          projectedSummary: "Current step: Draft content",
          toolCallId: "tool-wf-1",
        }),
      }),
    );
    expect(mocks.emitAgentActionEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: "run-1",
        data: expect.objectContaining({
          actionId: `workflow:${created.executionId}:step:draft`,
          parentActionId: `workflow:${created.executionId}`,
          status: "running",
          projectedTitle: "Running workflow step: Draft content",
        }),
      }),
    );
  });

  it("emits waiting workflow and step actions when n8n sync moves the run into wait state", async () => {
    const workspaceDir = await tempDirs.make("workflow-action-feed-wait-");

    const created = await createWorkflowExecutionRecord(
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
            { id: "review", kind: "human_wait", title: "Review", prompt: "Approve publish" },
          ],
          createdAt: 0,
          updatedAt: 0,
        },
        initialStatus: "running",
        origin: {
          runId: "run-1",
          sessionKey: "main",
        },
      },
    );

    await updateWorkflowExecutionStep({ workspaceDir }, created.executionId, {
      stepId: "draft",
      status: "succeeded",
      executor: "crawclaw_agent",
      summary: "Draft completed",
    });
    mocks.emitAgentActionEvent.mockClear();

    await syncWorkflowExecutionFromN8n({ workspaceDir }, created.executionId, {
      id: "exec_remote_waiting",
      status: "waiting",
      finished: false,
    });

    expect(mocks.emitAgentActionEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: "run-1",
        data: expect.objectContaining({
          actionId: `workflow:${created.executionId}`,
          status: "waiting",
          projectedTitle: "Workflow waiting: Publish Redbook Note",
          projectedSummary: "Current step: Review",
        }),
      }),
    );
    expect(mocks.emitAgentActionEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: "run-1",
        data: expect.objectContaining({
          actionId: `workflow:${created.executionId}:step:review`,
          status: "waiting",
          projectedTitle: "Workflow step waiting: Review",
          projectedSummary: "Approve publish",
        }),
      }),
    );
  });
});
