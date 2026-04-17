import { afterEach, describe, expect, it, vi } from "vitest";
import { runTaskInFlowForOwner } from "../../tasks/task-executor.js";
import {
  createManagedTaskFlow,
  resetTaskFlowRegistryForTests,
} from "../../tasks/task-flow-registry.js";
import { resetTaskRegistryForTests } from "../../tasks/task-registry.js";
import { createRuntimeTaskFlows, createRuntimeTaskRuns } from "./runtime-tasks.js";

const hoisted = vi.hoisted(() => {
  const sendMessageMock = vi.fn();
  const cancelSessionMock = vi.fn();
  const killSubagentRunAdminMock = vi.fn();
  return {
    sendMessageMock,
    cancelSessionMock,
    killSubagentRunAdminMock,
  };
});

vi.mock("../../tasks/task-registry-delivery-runtime.js", () => ({
  sendMessage: hoisted.sendMessageMock,
}));

vi.mock("../../acp/control-plane/manager.js", () => ({
  getAcpSessionManager: () => ({
    cancelSession: hoisted.cancelSessionMock,
  }),
}));

vi.mock("../../agents/subagent-control.js", () => ({
  killSubagentRunAdmin: (params: unknown) => hoisted.killSubagentRunAdminMock(params),
}));

afterEach(() => {
  resetTaskRegistryForTests();
  resetTaskFlowRegistryForTests({ persist: false });
  vi.clearAllMocks();
});

describe("runtime tasks", () => {
  it("exposes canonical task and TaskFlow DTOs without leaking raw registry fields", () => {
    const created = createManagedTaskFlow({
      ownerKey: "agent:main:main",
      controllerId: "tests/runtime-tasks",
      requesterOrigin: {
        channel: "telegram",
        to: "telegram:123",
      },
      goal: "Review inbox",
      currentStep: "triage",
      stateJson: { lane: "priority" },
    });
    const taskFlows = createRuntimeTaskFlows().bindSession({
      sessionKey: "agent:main:main",
    });
    const taskRuns = createRuntimeTaskRuns().bindSession({
      sessionKey: "agent:main:main",
    });
    const otherTaskFlows = createRuntimeTaskFlows().bindSession({
      sessionKey: "agent:main:other",
    });
    const otherTaskRuns = createRuntimeTaskRuns().bindSession({
      sessionKey: "agent:main:other",
    });

    const child = runTaskInFlowForOwner({
      flowId: created.flowId,
      callerOwnerKey: "agent:main:main",
      runtime: "acp",
      childSessionKey: "agent:main:subagent:child",
      runId: "runtime-task-run",
      label: "Inbox triage",
      task: "Review PR 1",
      status: "running",
      startedAt: 10,
      lastEventAt: 11,
      progressSummary: "Inspecting",
    });
    if (!child.created || !child.task) {
      throw new Error("expected child task creation to succeed");
    }
    const createdTask = child.task;

    expect(taskFlows.list()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: created.flowId,
          ownerKey: "agent:main:main",
          goal: "Review inbox",
          currentStep: "triage",
        }),
      ]),
    );
    expect(taskFlows.get(created.flowId)).toMatchObject({
      id: created.flowId,
      ownerKey: "agent:main:main",
      goal: "Review inbox",
      currentStep: "triage",
      state: { lane: "priority" },
      taskSummary: {
        total: 1,
        active: 1,
      },
      tasks: [
        expect.objectContaining({
          id: createdTask.taskId,
          flowId: created.flowId,
          title: "Review PR 1",
          label: "Inbox triage",
          runId: "runtime-task-run",
        }),
      ],
    });
    expect(taskRuns.list()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: createdTask.taskId,
          flowId: created.flowId,
          sessionKey: "agent:main:main",
          title: "Review PR 1",
          status: "running",
        }),
      ]),
    );
    expect(taskRuns.get(createdTask.taskId)).toMatchObject({
      id: createdTask.taskId,
      flowId: created.flowId,
      title: "Review PR 1",
      progressSummary: "Inspecting",
    });
    expect(taskRuns.findLatest()?.id).toBe(createdTask.taskId);
    expect(taskRuns.resolve("runtime-task-run")?.id).toBe(createdTask.taskId);
    expect(taskFlows.getTaskSummary(created.flowId)).toMatchObject({
      total: 1,
      active: 1,
    });

    expect(otherTaskFlows.get(created.flowId)).toBeUndefined();
    expect(otherTaskRuns.get(createdTask.taskId)).toBeUndefined();

    const flowDetail = taskFlows.get(created.flowId);
    expect(flowDetail).not.toHaveProperty("revision");
    expect(flowDetail).not.toHaveProperty("controllerId");
    expect(flowDetail).not.toHaveProperty("syncMode");

    const taskDetail = taskRuns.get(createdTask.taskId);
    expect(taskDetail).not.toHaveProperty("taskId");
    expect(taskDetail).not.toHaveProperty("requesterSessionKey");
    expect(taskDetail).not.toHaveProperty("scopeKind");
  });

  it("maps task cancellation results onto canonical task DTOs", async () => {
    const created = createManagedTaskFlow({
      ownerKey: "agent:main:main",
      controllerId: "tests/runtime-tasks",
      goal: "Cancel active task",
    });
    const taskRuns = createRuntimeTaskRuns().bindSession({
      sessionKey: "agent:main:main",
    });

    const child = runTaskInFlowForOwner({
      flowId: created.flowId,
      callerOwnerKey: "agent:main:main",
      runtime: "acp",
      childSessionKey: "agent:main:subagent:child",
      runId: "runtime-task-cancel",
      task: "Cancel me",
      status: "running",
      startedAt: 20,
      lastEventAt: 21,
    });
    if (!child.created || !child.task) {
      throw new Error("expected child task creation to succeed");
    }
    const createdTask = child.task;

    const result = await taskRuns.cancel({
      taskId: createdTask.taskId,
      cfg: {} as never,
    });

    expect(hoisted.cancelSessionMock).toHaveBeenCalledWith({
      cfg: {},
      sessionKey: "agent:main:subagent:child",
      reason: "task-cancel",
    });
    expect(result).toMatchObject({
      found: true,
      cancelled: true,
      task: {
        id: createdTask.taskId,
        title: "Cancel me",
        status: "cancelled",
      },
    });
  });

  it("does not allow cross-owner task cancellation or leak task details", async () => {
    const created = createManagedTaskFlow({
      ownerKey: "agent:main:main",
      controllerId: "tests/runtime-tasks",
      goal: "Keep owner isolation",
    });
    const otherTaskRuns = createRuntimeTaskRuns().bindSession({
      sessionKey: "agent:main:other",
    });

    const child = runTaskInFlowForOwner({
      flowId: created.flowId,
      callerOwnerKey: "agent:main:main",
      runtime: "acp",
      childSessionKey: "agent:main:subagent:child",
      runId: "runtime-task-isolation",
      task: "Do not cancel me",
      status: "running",
      startedAt: 30,
      lastEventAt: 31,
    });
    if (!child.created || !child.task) {
      throw new Error("expected child task creation to succeed");
    }
    const createdTask = child.task;

    const result = await otherTaskRuns.cancel({
      taskId: createdTask.taskId,
      cfg: {} as never,
    });

    expect(hoisted.cancelSessionMock).not.toHaveBeenCalled();
    expect(result).toEqual({
      found: false,
      cancelled: false,
      reason: "Task not found.",
    });
    expect(otherTaskRuns.get(createdTask.taskId)).toBeUndefined();
  });
});
