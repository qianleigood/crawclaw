import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CrawClawConfig } from "../../config/config.js";
import { handleCommands } from "./commands-core.js";
import { handleWorkflowCommand } from "./commands-workflow.js";
import { buildCommandTestParams } from "./commands.test-harness.js";

const mocks = vi.hoisted(() => ({
  requireWorkflowN8nRuntime: vi.fn(),
  readWorkflowExecutionStatus: vi.fn(),
  cancelWorkflowExecution: vi.fn(),
  resumeWorkflowExecution: vi.fn(),
}));

vi.mock("../../workflows/api.js", () => ({
  requireWorkflowN8nRuntime: mocks.requireWorkflowN8nRuntime,
  readWorkflowExecutionStatus: mocks.readWorkflowExecutionStatus,
  cancelWorkflowExecution: mocks.cancelWorkflowExecution,
  resumeWorkflowExecution: mocks.resumeWorkflowExecution,
  WorkflowOperationInputError: class WorkflowOperationInputError extends Error {},
  WorkflowOperationUnavailableError: class WorkflowOperationUnavailableError extends Error {},
}));

const baseCfg: CrawClawConfig = {
  commands: { text: true },
  workflow: {
    n8n: {
      baseUrl: "https://n8n.example.com",
      apiKey: "secret",
    },
  },
};

describe("handleWorkflowCommand", () => {
  beforeEach(() => {
    mocks.requireWorkflowN8nRuntime.mockReset();
    mocks.readWorkflowExecutionStatus.mockReset();
    mocks.cancelWorkflowExecution.mockReset();
    mocks.resumeWorkflowExecution.mockReset();
    mocks.requireWorkflowN8nRuntime.mockReturnValue({
      client: { getExecution: vi.fn(), stopExecution: vi.fn(), resumeExecutionByUrl: vi.fn() },
      resolved: { baseUrl: "https://n8n.example.com" },
    });
  });

  it("returns usage for incomplete workflow commands", async () => {
    const params = buildCommandTestParams("/workflow", baseCfg);

    const result = await handleWorkflowCommand(params, true);

    expect(result).toEqual({
      shouldContinue: false,
      reply: expect.objectContaining({
        text: expect.stringContaining("Usage: /workflow"),
      }),
    });
  });

  it("builds telegram workflow status replies with inline buttons", async () => {
    mocks.readWorkflowExecutionStatus.mockResolvedValue({
      execution: {
        executionId: "exec_1234abcd",
        workflowId: "wf_publish_redbook_123",
        workflowName: "Publish Redbook Note",
        status: "waiting_external",
        currentStepId: "review",
        currentExecutor: "n8n_wait",
        remoteStatus: "waiting",
        waiting: {
          kind: "external",
          prompt: "Approve publish",
          canResume: true,
        },
        updatedAt: Date.now(),
        source: "local+n8n",
      },
      localExecution: {
        executionId: "exec_1234abcd",
        workflowId: "wf_publish_redbook_123",
        status: "waiting_external",
        startedAt: 1,
        updatedAt: 2,
      },
    });

    const params = buildCommandTestParams("/workflow status exec_1234abcd", baseCfg, {
      Provider: "telegram",
      Surface: "telegram",
    });

    const result = await handleWorkflowCommand(params, true);

    expect(mocks.readWorkflowExecutionStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        executionId: "exec_1234abcd",
      }),
    );
    expect(result?.reply?.text).toContain("Workflow waiting: Publish Redbook Note");
    expect(result?.reply?.text).toContain("Resume: /workflow resume exec_1234abcd <input>");
    expect(result?.reply?.channelData).toEqual({
      telegram: {
        buttons: [
          [
            {
              text: "Refresh",
              callback_data: "tgcmd:/workflow status exec_1234abcd",
              style: "primary",
            },
            {
              text: "Resume",
              callback_data: "tgcmd:/workflow resume exec_1234abcd",
              style: "success",
            },
            {
              text: "Cancel",
              callback_data: "tgcmd:/workflow cancel exec_1234abcd",
              style: "danger",
            },
          ],
        ],
      },
    });
  });

  it("builds discord workflow cancel replies with native components", async () => {
    mocks.cancelWorkflowExecution.mockResolvedValue({
      execution: {
        executionId: "exec_1234abcd",
        workflowId: "wf_publish_redbook_123",
        workflowName: "Publish Redbook Note",
        status: "cancelled",
        currentStepId: "review",
        currentExecutor: "n8n_wait",
        updatedAt: Date.now(),
        source: "local+n8n",
      },
      localExecution: {
        executionId: "exec_1234abcd",
        workflowId: "wf_publish_redbook_123",
        status: "cancelled",
        startedAt: 1,
        updatedAt: 2,
        endedAt: 3,
      },
    });

    const params = buildCommandTestParams("/workflow cancel exec_1234abcd", baseCfg, {
      Provider: "discord",
      Surface: "discord",
    });

    const result = await handleWorkflowCommand(params, true);

    expect(result?.reply?.text).toContain("Workflow cancelled: Publish Redbook Note");
    expect(result?.reply?.channelData).toEqual({
      discord: {
        components: {
          blocks: [
            {
              type: "actions",
              buttons: [
                {
                  label: "Refresh",
                  style: "primary",
                  callbackData: "/workflow status exec_1234abcd",
                },
              ],
            },
          ],
        },
      },
    });
  });

  it("adds a discord resume modal for waiting workflow status replies", async () => {
    mocks.readWorkflowExecutionStatus.mockResolvedValue({
      execution: {
        executionId: "exec_1234abcd",
        workflowId: "wf_publish_redbook_123",
        workflowName: "Publish Redbook Note",
        status: "waiting_external",
        updatedAt: Date.now(),
        source: "local+n8n",
      },
      localExecution: {
        executionId: "exec_1234abcd",
        workflowId: "wf_publish_redbook_123",
        status: "waiting_external",
        startedAt: 1,
        updatedAt: 2,
      },
    });

    const params = buildCommandTestParams("/workflow status exec_1234abcd", baseCfg, {
      Provider: "discord",
      Surface: "discord",
    });

    const result = await handleWorkflowCommand(params, true);

    expect(result?.reply?.channelData).toEqual({
      discord: {
        components: expect.objectContaining({
          blocks: [
            {
              type: "actions",
              buttons: [
                {
                  label: "Refresh",
                  style: "primary",
                  callbackData: "/workflow status exec_1234abcd",
                },
                {
                  label: "Cancel",
                  style: "danger",
                  callbackData: "/workflow cancel exec_1234abcd",
                },
              ],
            },
          ],
          modal: expect.objectContaining({
            title: "Resume workflow",
            triggerLabel: "Resume",
            triggerStyle: "success",
            callbackData: expect.stringMatching(/^workflow:resume:/),
          }),
        }),
      },
    });
  });

  it("routes /workflow through the top-level command dispatcher", async () => {
    mocks.readWorkflowExecutionStatus.mockResolvedValue({
      execution: {
        executionId: "exec_1234abcd",
        workflowId: "wf_publish_redbook_123",
        workflowName: "Publish Redbook Note",
        status: "waiting_external",
        updatedAt: Date.now(),
        source: "local+n8n",
      },
      localExecution: {
        executionId: "exec_1234abcd",
        workflowId: "wf_publish_redbook_123",
        status: "waiting_external",
        startedAt: 1,
        updatedAt: 2,
      },
    });

    const params = buildCommandTestParams("/workflow status exec_1234abcd", baseCfg, {
      Provider: "telegram",
      Surface: "telegram",
    });

    const result = await handleCommands(params);

    expect(result.shouldContinue).toBe(false);
    expect(result.reply?.text).toContain("Workflow waiting: Publish Redbook Note");
    expect(result.reply?.channelData).toEqual({
      telegram: {
        buttons: [
          [
            {
              text: "Refresh",
              callback_data: "tgcmd:/workflow status exec_1234abcd",
              style: "primary",
            },
            {
              text: "Resume",
              callback_data: "tgcmd:/workflow resume exec_1234abcd",
              style: "success",
            },
            {
              text: "Cancel",
              callback_data: "tgcmd:/workflow cancel exec_1234abcd",
              style: "danger",
            },
          ],
        ],
      },
    });
  });
});
