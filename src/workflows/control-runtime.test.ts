import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CrawClawConfig } from "../config/config.js";

const scopeMocks = vi.hoisted(() => ({
  listAgentIds: vi.fn(),
  resolveAgentDir: vi.fn(),
  resolveAgentWorkspaceDir: vi.fn(),
  resolveDefaultAgentId: vi.fn(),
}));

const workflowErrors = vi.hoisted(() => ({
  WorkflowOperationInputError: class WorkflowOperationInputError extends Error {},
  WorkflowOperationUnavailableError: class WorkflowOperationUnavailableError extends Error {},
}));

const apiMocks = vi.hoisted(() => ({
  cancelWorkflowExecution: vi.fn(),
  readWorkflowExecutionStatus: vi.fn(),
  requireWorkflowN8nRuntime: vi.fn(),
  resumeWorkflowExecution: vi.fn(),
}));

vi.mock("../agents/agent-scope.js", () => scopeMocks);
vi.mock("./api.js", () => ({
  cancelWorkflowExecution: apiMocks.cancelWorkflowExecution,
  readWorkflowExecutionStatus: apiMocks.readWorkflowExecutionStatus,
  requireWorkflowN8nRuntime: apiMocks.requireWorkflowN8nRuntime,
  resumeWorkflowExecution: apiMocks.resumeWorkflowExecution,
  WorkflowOperationInputError: workflowErrors.WorkflowOperationInputError,
  WorkflowOperationUnavailableError: workflowErrors.WorkflowOperationUnavailableError,
}));

import {
  executeWorkflowControlAction,
  requireWorkflowN8nRuntimeOrThrowUnavailable,
  resolveWorkflowControlContext,
} from "./control-runtime.js";

const baseCfg = {} as CrawClawConfig;

describe("resolveWorkflowControlContext", () => {
  beforeEach(() => {
    scopeMocks.listAgentIds.mockReset();
    scopeMocks.resolveAgentDir.mockReset();
    scopeMocks.resolveAgentWorkspaceDir.mockReset();
    scopeMocks.resolveDefaultAgentId.mockReset();
    scopeMocks.listAgentIds.mockReturnValue(["default", "writer"]);
    scopeMocks.resolveDefaultAgentId.mockReturnValue("default");
    scopeMocks.resolveAgentWorkspaceDir.mockReturnValue("/tmp/workspace-default");
    scopeMocks.resolveAgentDir.mockReturnValue("/tmp/agent-default");
  });

  it("uses explicit workspace and agent paths when provided", () => {
    const resolved = resolveWorkflowControlContext({
      cfg: baseCfg,
      agentId: "writer",
      workspaceDir: "/tmp/workspace-writer",
      agentDir: "/tmp/agent-writer",
    });

    expect(resolved).toEqual({
      cfg: baseCfg,
      agentId: "writer",
      workspaceDir: "/tmp/workspace-writer",
      agentDir: "/tmp/agent-writer",
    });
  });

  it("falls back to the default agent and resolved paths", () => {
    const resolved = resolveWorkflowControlContext({
      cfg: baseCfg,
    });

    expect(resolved).toEqual({
      cfg: baseCfg,
      agentId: "default",
      workspaceDir: "/tmp/workspace-default",
      agentDir: "/tmp/agent-default",
    });
  });

  it("rejects unknown agent ids as invalid input", () => {
    expect(() =>
      resolveWorkflowControlContext({
        cfg: baseCfg,
        agentId: "missing",
      }),
    ).toThrow('unknown agent id "missing"');
  });
});

describe("requireWorkflowN8nRuntimeOrThrowUnavailable", () => {
  beforeEach(() => {
    apiMocks.requireWorkflowN8nRuntime.mockReset();
  });

  it("maps missing n8n config into an unavailable workflow error", () => {
    apiMocks.requireWorkflowN8nRuntime.mockImplementation(() => {
      throw new Error("n8n is not configured. Set workflow.n8n.baseUrl/apiKey.");
    });

    expect(() => requireWorkflowN8nRuntimeOrThrowUnavailable(baseCfg)).toThrow(
      workflowErrors.WorkflowOperationUnavailableError,
    );
  });
});

describe("executeWorkflowControlAction", () => {
  beforeEach(() => {
    apiMocks.requireWorkflowN8nRuntime.mockReset();
    apiMocks.readWorkflowExecutionStatus.mockReset();
    apiMocks.cancelWorkflowExecution.mockReset();
    apiMocks.resumeWorkflowExecution.mockReset();
    apiMocks.requireWorkflowN8nRuntime.mockReturnValue({
      client: { marker: "client" },
      resolved: { baseUrl: "https://n8n.example.com" },
    });
  });

  it("dispatches workflow status through the shared runtime", async () => {
    apiMocks.readWorkflowExecutionStatus.mockResolvedValue({
      execution: { executionId: "exec_1" },
    });

    const result = await executeWorkflowControlAction({
      action: "status",
      context: { workspaceDir: "/tmp/workspace", agentDir: "/tmp/agent" },
      config: baseCfg,
      executionId: "  exec_1  ",
    });

    expect(apiMocks.readWorkflowExecutionStatus).toHaveBeenCalledWith({
      context: { workspaceDir: "/tmp/workspace", agentDir: "/tmp/agent" },
      client: { marker: "client" },
      n8nBaseUrl: "https://n8n.example.com",
      executionId: "exec_1",
    });
    expect(result).toEqual({ execution: { executionId: "exec_1" } });
  });

  it("dispatches workflow resume with normalized input and actor label", async () => {
    apiMocks.resumeWorkflowExecution.mockResolvedValue({
      execution: { executionId: "exec_2" },
      resumeAccepted: true,
    });

    const result = await executeWorkflowControlAction({
      action: "resume",
      context: { workspaceDir: "/tmp/workspace", agentDir: "/tmp/agent" },
      config: baseCfg,
      executionId: "exec_2",
      input: "  approved  ",
      actorLabel: "chat command",
    });

    expect(apiMocks.resumeWorkflowExecution).toHaveBeenCalledWith({
      context: { workspaceDir: "/tmp/workspace", agentDir: "/tmp/agent" },
      client: { marker: "client" },
      n8nBaseUrl: "https://n8n.example.com",
      executionId: "exec_2",
      input: "approved",
      actorLabel: "chat command",
    });
    expect(result).toEqual({
      execution: { executionId: "exec_2" },
      resumeAccepted: true,
    });
  });

  it("defaults workflow resume actor labels when the caller does not provide one", async () => {
    apiMocks.resumeWorkflowExecution.mockResolvedValue({
      execution: { executionId: "exec_3" },
      resumeAccepted: true,
    });

    await executeWorkflowControlAction({
      action: "resume",
      context: { workspaceDir: "/tmp/workspace", agentDir: "/tmp/agent" },
      config: baseCfg,
      executionId: "exec_3",
    });

    expect(apiMocks.resumeWorkflowExecution).toHaveBeenCalledWith({
      context: { workspaceDir: "/tmp/workspace", agentDir: "/tmp/agent" },
      client: { marker: "client" },
      n8nBaseUrl: "https://n8n.example.com",
      executionId: "exec_3",
      input: undefined,
      actorLabel: "workflow control",
    });
  });
});
