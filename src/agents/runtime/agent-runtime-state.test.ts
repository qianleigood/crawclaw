import { beforeEach, describe, expect, it } from "vitest";
import { registerAgentRunContext, resetAgentRunContextForTest } from "../../infra/agent-events.js";
import {
  getAgentRuntimeState,
  incrementAgentRuntimeToolCall,
  markAgentRuntimeStateTerminal,
  registerAgentRuntimeState,
  resetAgentRuntimeStateForTest,
  updateAgentRuntimeState,
} from "./agent-runtime-state.js";

describe("agent-runtime-state", () => {
  beforeEach(() => {
    resetAgentRunContextForTest();
    resetAgentRuntimeStateForTest();
  });

  it("hydrates runtime state from registered run context", () => {
    registerAgentRunContext("run-1", {
      sessionKey: "agent:main:session-1",
      sessionId: "session-1",
      agentId: "main",
      parentAgentId: "planner",
      taskId: "task-1",
      taskRuntime: "subagent",
      taskMode: "background",
      label: "Research",
      task: "Inspect docs",
    });

    const state = registerAgentRuntimeState({
      runId: "run-1",
      status: "created",
    });

    expect(state).toMatchObject({
      runId: "run-1",
      sessionKey: "agent:main:session-1",
      sessionId: "session-1",
      agentId: "main",
      parentAgentId: "planner",
      taskId: "task-1",
      runtime: "subagent",
      mode: "background",
      label: "Research",
      task: "Inspect docs",
      status: "created",
      toolCallCount: 0,
    });
  });

  it("tracks tool progress and preserves terminal state", () => {
    registerAgentRuntimeState({
      runId: "run-2",
      status: "running",
    });

    incrementAgentRuntimeToolCall({
      runId: "run-2",
      toolName: "web_fetch",
      updatedAt: 100,
    });
    const terminal = markAgentRuntimeStateTerminal({
      runId: "run-2",
      status: "completed",
      endedAt: 200,
    });
    updateAgentRuntimeState("run-2", {
      status: "running",
      currentStep: "tool:write_file",
      updatedAt: 300,
    });

    expect(terminal.changed).toBe(true);
    expect(getAgentRuntimeState("run-2")).toMatchObject({
      runId: "run-2",
      status: "completed",
      toolCallCount: 1,
      lastToolName: "web_fetch",
      endedAt: 200,
    });
  });
});
