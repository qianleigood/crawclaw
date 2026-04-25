import { beforeEach, describe, expect, it } from "vitest";
import {
  emitAgentEvent,
  onAgentEvent,
  registerAgentRunContext,
  resetAgentEventsForTest,
  resetAgentRunContextForTest,
} from "../../infra/agent-events.js";
import {
  getAgentRuntimeState,
  markAgentRunCancelled,
  onAgentProgressEvent,
  registerAgentRuntimeRun,
  resetAgentProgressEventsForTest,
} from "./agent-progress.js";

describe("agent-progress", () => {
  beforeEach(() => {
    resetAgentEventsForTest();
    resetAgentRunContextForTest();
    resetAgentProgressEventsForTest();
  });

  it("bridges lifecycle and tool events into runtime progress", () => {
    registerAgentRunContext("run-1", {
      sessionKey: "agent:main:session-1",
      sessionId: "session-1",
      agentId: "main",
      taskId: "task-1",
      taskRuntime: "subagent",
      taskMode: "background",
    });
    registerAgentRuntimeRun({
      runId: "run-1",
      status: "created",
    });

    const kinds: string[] = [];
    const stop = onAgentProgressEvent((event) => {
      kinds.push(event.kind);
    });

    emitAgentEvent({
      runId: "run-1",
      stream: "lifecycle",
      data: { phase: "start", startedAt: 10 },
    });
    emitAgentEvent({
      runId: "run-1",
      stream: "tool",
      data: { phase: "start", name: "web_fetch", toolCallId: "tool-1" },
    });
    emitAgentEvent({
      runId: "run-1",
      stream: "tool",
      data: { phase: "result", name: "web_fetch", toolCallId: "tool-1", isError: false },
    });
    emitAgentEvent({
      runId: "run-1",
      stream: "lifecycle",
      data: { phase: "end", endedAt: 20 },
    });

    stop();

    expect(kinds).toEqual([
      "agent_started",
      "tool_called",
      "tool_completed",
      "agent_progressed",
      "agent_completed",
    ]);
    expect(getAgentRuntimeState("run-1")).toMatchObject({
      runId: "run-1",
      status: "completed",
      toolCallCount: 1,
      lastToolName: "web_fetch",
      endedAt: 20,
    });
  });

  it("emits normalized action events for live progress", () => {
    registerAgentRunContext("run-action", {
      sessionKey: "agent:main:session-action",
      sessionId: "session-action",
      agentId: "main",
      taskId: "task-action",
      taskRuntime: "subagent",
      taskMode: "background",
    });
    registerAgentRuntimeRun({
      runId: "run-action",
      status: "created",
    });

    const actions: Array<{ stream: string; data: Record<string, unknown> }> = [];
    const stop = onAgentEvent((event) => {
      if (event.runId === "run-action" && event.stream === "action") {
        actions.push({ stream: event.stream, data: event.data });
      }
    });

    emitAgentEvent({
      runId: "run-action",
      stream: "lifecycle",
      data: { phase: "start", startedAt: 10 },
    });
    emitAgentEvent({
      runId: "run-action",
      stream: "tool",
      data: {
        phase: "start",
        name: "web_fetch",
        toolCallId: "tool-action-1",
        args: { url: "https://docs.crawclaw.ai/plugins" },
      },
    });
    emitAgentEvent({
      runId: "run-action",
      stream: "tool",
      data: { phase: "result", name: "web_fetch", toolCallId: "tool-action-1", isError: false },
    });
    emitAgentEvent({
      runId: "run-action",
      stream: "lifecycle",
      data: { phase: "end", endedAt: 20 },
    });

    stop();

    expect(actions.map((entry) => entry.data.actionId)).toEqual([
      "run:run-action",
      "tool:tool-action-1",
      "tool:tool-action-1",
      "run:run-action",
    ]);
    expect(actions.map((entry) => entry.data.status)).toEqual([
      "started",
      "running",
      "completed",
      "completed",
    ]);
    expect(actions[1]?.data).toMatchObject({
      projectedTitle: "Fetching from https://docs.crawclaw.ai/plugins",
    });
  });

  it("emits workflow action kind for workflow tools", () => {
    registerAgentRunContext("run-workflow-action", {
      sessionKey: "agent:main:session-workflow",
      sessionId: "session-workflow",
      agentId: "main",
    });
    registerAgentRuntimeRun({
      runId: "run-workflow-action",
      status: "created",
    });

    const actions: Array<Record<string, unknown>> = [];
    const stop = onAgentEvent((event) => {
      if (event.runId === "run-workflow-action" && event.stream === "action") {
        actions.push(event.data);
      }
    });

    emitAgentEvent({
      runId: "run-workflow-action",
      stream: "tool",
      data: { phase: "start", name: "workflow", toolCallId: "tool-wf-1" },
    });
    emitAgentEvent({
      runId: "run-workflow-action",
      stream: "tool",
      data: { phase: "result", name: "workflow", toolCallId: "tool-wf-1", isError: false },
    });

    stop();

    expect(actions.map((entry) => entry.kind)).toEqual(["workflow", "workflow"]);
  });

  it("emits manual cancel once for runs without lifecycle end events", () => {
    registerAgentRuntimeRun({
      runId: "run-cancel",
      agentId: "ops",
      runtime: "subagent",
      mode: "background",
      status: "running",
    });

    const kinds: string[] = [];
    const stop = onAgentProgressEvent((event) => {
      if (event.runId === "run-cancel") {
        kinds.push(event.kind);
      }
    });

    markAgentRunCancelled({
      runId: "run-cancel",
      endedAt: 42,
      summary: "killed",
    });
    markAgentRunCancelled({
      runId: "run-cancel",
      endedAt: 43,
      summary: "killed again",
    });

    stop();

    expect(kinds).toEqual(["agent_cancelled"]);
    expect(getAgentRuntimeState("run-cancel")).toMatchObject({
      runId: "run-cancel",
      status: "cancelled",
      endedAt: 42,
      lastError: "killed",
    });
  });
});
