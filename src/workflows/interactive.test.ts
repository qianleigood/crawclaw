import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  __testing,
  buildWorkflowDiscordResumeCallbackData,
  handleWorkflowDiscordInteractive,
} from "./interactive.js";

const mocks = vi.hoisted(() => ({
  loadConfig: vi.fn(),
  requireWorkflowN8nRuntime: vi.fn(),
  resumeWorkflowExecution: vi.fn(),
}));

vi.mock("../config/config.js", () => ({
  loadConfig: mocks.loadConfig,
}));

vi.mock("./api.js", () => ({
  requireWorkflowN8nRuntime: mocks.requireWorkflowN8nRuntime,
  resumeWorkflowExecution: mocks.resumeWorkflowExecution,
  WorkflowOperationInputError: class WorkflowOperationInputError extends Error {},
  WorkflowOperationUnavailableError: class WorkflowOperationUnavailableError extends Error {},
}));

describe("workflow discord interactive handler", () => {
  beforeEach(() => {
    mocks.loadConfig.mockReset().mockReturnValue({});
    mocks.requireWorkflowN8nRuntime.mockReset().mockReturnValue({
      client: { getExecution: vi.fn(), resumeExecutionByUrl: vi.fn() },
      resolved: { baseUrl: "https://n8n.example.com" },
    });
    mocks.resumeWorkflowExecution.mockReset();
  });

  it("serializes resume callback payloads with workflow context", () => {
    const callbackData = buildWorkflowDiscordResumeCallbackData({
      executionId: "exec_123",
      workspaceDir: "/tmp/workspace",
      agentDir: "/tmp/agent-home",
    });

    expect(callbackData).toMatch(/^workflow:resume:/);
    expect(
      __testing.parseWorkflowInteractiveActionPayload(
        callbackData?.slice("workflow:".length) ?? "",
      ),
    ).toEqual({
      action: "resume",
      executionId: "exec_123",
      workspaceDir: "/tmp/workspace",
      agentDir: "/tmp/agent-home",
    });
  });

  it("resumes workflows from discord modal input", async () => {
    mocks.resumeWorkflowExecution.mockResolvedValue({
      execution: {
        executionId: "exec_123",
        workflowId: "wf_publish_redbook_123",
        workflowName: "Publish Redbook Note",
        currentStepId: "review",
      },
    });

    const reply = vi.fn(async () => undefined);
    const followUp = vi.fn(async () => undefined);
    const clearComponents = vi.fn(async () => undefined);
    const callbackData = buildWorkflowDiscordResumeCallbackData({
      executionId: "exec_123",
      workspaceDir: "/tmp/workspace",
      agentDir: "/tmp/agent-home",
    });
    if (!callbackData) {
      throw new Error("Expected callbackData");
    }

    const result = await handleWorkflowDiscordInteractive({
      channel: "discord",
      accountId: "discord-main",
      interactionId: "interaction-1",
      conversationId: "channel:123",
      auth: {
        isAuthorizedSender: true,
      },
      interaction: {
        kind: "modal",
        data: callbackData,
        namespace: "workflow",
        payload: callbackData.slice("workflow:".length),
        fields: [
          {
            id: "field-1",
            name: "input",
            values: ["approved"],
          },
        ],
      },
      respond: {
        acknowledge: vi.fn(async () => undefined),
        reply,
        followUp,
        editMessage: vi.fn(async () => undefined),
        clearComponents,
      },
      requestConversationBinding: vi.fn(async () => ({
        status: "error",
        message: "not used",
      })),
      detachConversationBinding: vi.fn(async () => ({ removed: false })),
      getCurrentConversationBinding: vi.fn(async () => null),
    });

    expect(result).toEqual({ handled: true });
    expect(mocks.resumeWorkflowExecution).toHaveBeenCalledWith({
      context: {
        workspaceDir: "/tmp/workspace",
        agentDir: "/tmp/agent-home",
      },
      client: expect.any(Object),
      n8nBaseUrl: "https://n8n.example.com",
      executionId: "exec_123",
      input: "approved",
      actorLabel: "discord workflow control",
    });
    expect(clearComponents).toHaveBeenCalledWith({
      text: "Workflow resume requested: Publish Redbook Note\nExecution: exec_123\nCurrent step: review",
    });
    expect(followUp).toHaveBeenCalledWith({
      text: "Workflow resume requested: Publish Redbook Note\nExecution: exec_123\nCurrent step: review",
      ephemeral: true,
    });
    expect(reply).not.toHaveBeenCalled();
  });
});
