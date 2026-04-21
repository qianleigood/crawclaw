import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  emitAgentEvent,
  onAgentEvent,
  registerAgentRunContext,
  resetAgentEventsForTest,
  resetAgentRunContextForTest,
} from "../../infra/agent-events.js";
import { createRunningTaskRun } from "../../tasks/task-executor.js";
import { resetTaskRegistryForTests } from "../../tasks/task-registry.js";
import { withStateDirEnv } from "../../test-helpers/state-dir-env.js";
import { upsertAgentTaskRuntimeMetadata } from "../runtime/agent-metadata-store.js";
import {
  markAgentRunCompleted,
  registerAgentRuntimeRun,
  resetAgentProgressEventsForTest,
} from "../runtime/agent-progress.js";
import {
  flushTaskTrajectoryWritesForTest,
  readTaskTrajectorySync,
  resetTaskTrajectoryBridgeForTest,
} from "./task-trajectory.js";

describe("task-trajectory", () => {
  beforeEach(() => {
    resetAgentEventsForTest();
    resetAgentRunContextForTest();
    resetAgentProgressEventsForTest();
    resetTaskTrajectoryBridgeForTest();
  });

  afterEach(() => {
    resetTaskRegistryForTests({ persist: false });
  });

  it("records tool steps and completion evidence for task-backed agent runs", async () => {
    await withStateDirEnv("crawclaw-task-trajectory-", async () => {
      const actionEvents: Array<Record<string, unknown>> = [];
      const stopActions = onAgentEvent((event) => {
        if (event.runId === "run-trajectory" && event.stream === "action") {
          actionEvents.push(event.data);
        }
      });
      const created = createRunningTaskRun({
        runtime: "subagent",
        ownerKey: "agent:main:main",
        scopeKind: "session",
        childSessionKey: "agent:worker:subagent:trajectory",
        agentId: "worker",
        agentMetadata: {
          parentAgentId: "main",
          mode: "background",
          spawnSource: "sessions_spawn",
        },
        runId: "run-trajectory",
        task: "Investigate and patch the worker flow",
      });
      const { metadata } = await upsertAgentTaskRuntimeMetadata({
        taskId: created.taskId,
        runtime: "subagent",
        agentId: "worker",
        parentAgentId: "main",
        mode: "background",
        spawnSource: "sessions_spawn",
        sessionKey: "agent:worker:subagent:trajectory",
        sessionId: "sess-trajectory",
        runId: "run-trajectory",
        task: "Investigate and patch the worker flow",
      });

      registerAgentRunContext("run-trajectory", {
        sessionKey: "agent:worker:subagent:trajectory",
        sessionId: "sess-trajectory",
        agentId: "worker",
        parentAgentId: "main",
        taskId: created.taskId,
        taskRuntime: "subagent",
        taskMode: "background",
      });
      registerAgentRuntimeRun({
        runId: "run-trajectory",
        taskId: created.taskId,
        runtime: "subagent",
        mode: "background",
        agentId: "worker",
        parentAgentId: "main",
        sessionId: "sess-trajectory",
        sessionKey: "agent:worker:subagent:trajectory",
        status: "created",
        startedAt: 10,
        updatedAt: 10,
      });

      emitAgentEvent({
        runId: "run-trajectory",
        stream: "lifecycle",
        data: { phase: "start", startedAt: 10 },
      });
      emitAgentEvent({
        runId: "run-trajectory",
        stream: "tool",
        data: {
          phase: "start",
          name: "write",
          toolCallId: "tool-write",
          args: { path: "/tmp/worker.ts" },
        },
      });
      emitAgentEvent({
        runId: "run-trajectory",
        stream: "tool",
        data: {
          phase: "result",
          name: "write",
          toolCallId: "tool-write",
          isError: false,
          result: { details: { ok: true } },
        },
      });
      emitAgentEvent({
        runId: "run-trajectory",
        stream: "tool",
        data: {
          phase: "start",
          name: "exec",
          toolCallId: "tool-test",
          args: { command: "pnpm test --filter worker" },
        },
      });
      emitAgentEvent({
        runId: "run-trajectory",
        stream: "tool",
        data: {
          phase: "result",
          name: "exec",
          toolCallId: "tool-test",
          isError: false,
          result: { details: { status: "completed", exitCode: 0 } },
        },
      });
      emitAgentEvent({
        runId: "run-trajectory",
        stream: "tool",
        data: {
          phase: "start",
          name: "exec",
          toolCallId: "tool-verify",
          args: { command: "pnpm exec tsc --noEmit" },
        },
      });
      emitAgentEvent({
        runId: "run-trajectory",
        stream: "tool",
        data: {
          phase: "result",
          name: "exec",
          toolCallId: "tool-verify",
          isError: false,
          result: { details: { status: "completed", exitCode: 0 } },
        },
      });
      emitAgentEvent({
        runId: "run-trajectory",
        stream: "assistant",
        data: { text: "Patched /tmp/worker.ts and verified the fix with tests." },
      });
      emitAgentEvent({
        runId: "run-trajectory",
        stream: "lifecycle",
        data: { phase: "end", endedAt: 20 },
      });

      await flushTaskTrajectoryWritesForTest();
      stopActions();

      const trajectory = readTaskTrajectorySync(metadata.trajectoryRef);
      expect(trajectory).toMatchObject({
        taskId: created.taskId,
        runId: "run-trajectory",
        status: "completed",
      });
      expect(trajectory?.steps).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            stepId: "tool:tool-write",
            kind: "tool",
            status: "completed",
            toolName: "write",
            toolCallId: "tool-write",
          }),
          expect.objectContaining({
            stepId: "tool:tool-test",
            kind: "tool",
            status: "completed",
            toolName: "exec",
            toolCallId: "tool-test",
          }),
          expect.objectContaining({
            stepId: "assistant:final",
            kind: "assistant",
            status: "completed",
          }),
        ]),
      );
      expect(trajectory?.evidence).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            kind: "file_changed",
            path: "/tmp/worker.ts",
          }),
          expect.objectContaining({
            kind: "test_passed",
            command: "pnpm test --filter worker",
          }),
          expect.objectContaining({
            kind: "assertion_met",
            command: "pnpm exec tsc --noEmit",
          }),
          expect.objectContaining({
            kind: "answer_provided",
          }),
        ]),
      );
      expect(trajectory?.completion).toMatchObject({
        status: "accepted",
        spec: {
          taskType: "fix",
        },
      });
      expect(actionEvents).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            actionId: "completion:run-trajectory",
            kind: "completion",
            status: "completed",
            title: "Completion accepted",
            projectedTitle: "Completion accepted",
          }),
        ]),
      );
    });
  });

  it("persists a minimal trajectory from runtime progress terminal events", async () => {
    await withStateDirEnv("crawclaw-task-trajectory-progress-", async () => {
      const created = createRunningTaskRun({
        runtime: "subagent",
        ownerKey: "agent:main:main",
        scopeKind: "session",
        childSessionKey: "agent:worker:subagent:progress-fallback",
        agentId: "worker",
        agentMetadata: {
          parentAgentId: "main",
          mode: "background",
          spawnSource: "sessions_spawn",
        },
        runId: "run-progress-fallback",
        task: "Reply with exactly SUBAGENT_LIVE_OK and then stop.",
      });
      const { metadata } = await upsertAgentTaskRuntimeMetadata({
        taskId: created.taskId,
        runtime: "subagent",
        agentId: "worker",
        parentAgentId: "main",
        mode: "background",
        spawnSource: "sessions_spawn",
        sessionKey: "agent:worker:subagent:progress-fallback",
        sessionId: "sess-progress-fallback",
        runId: "run-progress-fallback",
        task: "Reply with exactly SUBAGENT_LIVE_OK and then stop.",
      });

      registerAgentRunContext("run-progress-fallback", {
        sessionKey: "agent:worker:subagent:progress-fallback",
        sessionId: "sess-progress-fallback",
        agentId: "worker",
        parentAgentId: "main",
        taskId: created.taskId,
        taskRuntime: "subagent",
        taskMode: "background",
      });
      registerAgentRuntimeRun({
        runId: "run-progress-fallback",
        taskId: created.taskId,
        runtime: "subagent",
        mode: "background",
        agentId: "worker",
        parentAgentId: "main",
        sessionId: "sess-progress-fallback",
        sessionKey: "agent:worker:subagent:progress-fallback",
        status: "created",
        startedAt: 10,
        updatedAt: 10,
      });

      markAgentRunCompleted({
        runId: "run-progress-fallback",
        endedAt: 20,
        summary: "SUBAGENT_LIVE_OK",
      });

      await flushTaskTrajectoryWritesForTest();

      const trajectory = readTaskTrajectorySync(metadata.trajectoryRef);
      expect(trajectory).toMatchObject({
        taskId: created.taskId,
        runId: "run-progress-fallback",
        status: "completed",
      });
      expect(trajectory?.steps).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            stepId: "assistant:final",
            kind: "assistant",
            status: "completed",
            summary: "SUBAGENT_LIVE_OK",
          }),
        ]),
      );
      expect(trajectory?.evidence).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            kind: "answer_provided",
            summary: "SUBAGENT_LIVE_OK",
          }),
        ]),
      );
    });
  });

  it("aggregates child trajectory evidence when evaluating parent workflow completion", async () => {
    await withStateDirEnv("crawclaw-task-trajectory-parent-child-", async () => {
      const parent = createRunningTaskRun({
        runtime: "subagent",
        ownerKey: "agent:planner:planner",
        scopeKind: "session",
        childSessionKey: "agent:planner:subagent:workflow-parent",
        agentId: "planner",
        runId: "run-workflow-parent",
        task: "Coordinate the worker workflow with a subagent and report the result.",
      });
      const child = createRunningTaskRun({
        runtime: "subagent",
        ownerKey: "agent:planner:planner",
        scopeKind: "session",
        childSessionKey: "agent:worker:subagent:workflow-child",
        agentId: "worker",
        agentMetadata: {
          parentAgentId: "planner",
          mode: "background",
          spawnSource: "sessions_spawn",
        },
        runId: "run-workflow-child",
        task: "Reply with exactly WORKFLOW_CHILD_OK and then stop.",
      });

      const parentMetadata = await upsertAgentTaskRuntimeMetadata({
        taskId: parent.taskId,
        runtime: "subagent",
        agentId: "planner",
        mode: "foreground",
        spawnSource: "sessions_spawn",
        sessionKey: "agent:planner:subagent:workflow-parent",
        sessionId: "sess-workflow-parent",
        runId: "run-workflow-parent",
        task: "Coordinate the worker workflow with a subagent and report the result.",
      });
      await upsertAgentTaskRuntimeMetadata({
        taskId: child.taskId,
        runtime: "subagent",
        agentId: "worker",
        parentAgentId: "planner",
        mode: "background",
        spawnSource: "sessions_spawn",
        sessionKey: "agent:worker:subagent:workflow-child",
        sessionId: "sess-workflow-child",
        runId: "run-workflow-child",
        task: "Reply with exactly WORKFLOW_CHILD_OK and then stop.",
      });

      registerAgentRunContext("run-workflow-child", {
        sessionKey: "agent:worker:subagent:workflow-child",
        sessionId: "sess-workflow-child",
        agentId: "worker",
        parentAgentId: "planner",
        taskId: child.taskId,
        taskRuntime: "subagent",
        taskMode: "background",
      });
      registerAgentRuntimeRun({
        runId: "run-workflow-child",
        taskId: child.taskId,
        runtime: "subagent",
        mode: "background",
        agentId: "worker",
        parentAgentId: "planner",
        sessionId: "sess-workflow-child",
        sessionKey: "agent:worker:subagent:workflow-child",
        status: "created",
        startedAt: 10,
        updatedAt: 10,
      });
      markAgentRunCompleted({
        runId: "run-workflow-child",
        endedAt: 15,
        summary: "WORKFLOW_CHILD_OK",
      });

      registerAgentRunContext("run-workflow-parent", {
        sessionKey: "agent:planner:subagent:workflow-parent",
        sessionId: "sess-workflow-parent",
        agentId: "planner",
        taskId: parent.taskId,
        taskRuntime: "subagent",
        taskMode: "foreground",
      });
      registerAgentRuntimeRun({
        runId: "run-workflow-parent",
        taskId: parent.taskId,
        runtime: "subagent",
        mode: "foreground",
        agentId: "planner",
        sessionId: "sess-workflow-parent",
        sessionKey: "agent:planner:subagent:workflow-parent",
        status: "created",
        startedAt: 20,
        updatedAt: 20,
      });
      markAgentRunCompleted({
        runId: "run-workflow-parent",
        endedAt: 25,
        summary: "Agent completed",
      });

      await flushTaskTrajectoryWritesForTest();

      const trajectory = readTaskTrajectorySync(parentMetadata.metadata.trajectoryRef);
      expect(trajectory?.completion).toMatchObject({
        status: "accepted",
        relatedEvidenceCount: 1,
        spec: {
          taskType: "workflow",
        },
      });
    });
  });

  it("records review_task REVIEW_PASS verdicts as review evidence for completion", async () => {
    await withStateDirEnv("crawclaw-task-trajectory-review-", async () => {
      const actionEvents: Array<{ runId: string; data: Record<string, unknown> }> = [];
      const stopActions = onAgentEvent((event) => {
        if (event.stream === "action") {
          actionEvents.push({
            runId: event.runId,
            data: event.data,
          });
        }
      });
      const parentTask = createRunningTaskRun({
        runtime: "cli",
        ownerKey: "agent:main:main",
        scopeKind: "session",
        childSessionKey: "agent:main:main",
        agentId: "main",
        agentMetadata: {
          mode: "foreground",
        },
        runId: "run-parent-fix",
        task: "Fix the worker failure on empty payload",
      });

      const parentMetadata = await upsertAgentTaskRuntimeMetadata({
        taskId: parentTask.taskId,
        runtime: "cli",
        agentId: "main",
        mode: "foreground",
        sessionKey: "agent:main:main",
        sessionId: "sess-parent-fix",
        runId: "run-parent-fix",
        task: "Fix the worker failure on empty payload",
      });

      registerAgentRunContext("run-parent-fix", {
        sessionKey: "agent:main:main",
        sessionId: "sess-parent-fix",
        agentId: "main",
        taskId: parentTask.taskId,
        taskRuntime: "cli",
        taskMode: "foreground",
      });
      registerAgentRuntimeRun({
        runId: "run-parent-fix",
        taskId: parentTask.taskId,
        runtime: "cli",
        mode: "foreground",
        agentId: "main",
        sessionId: "sess-parent-fix",
        sessionKey: "agent:main:main",
        status: "created",
        startedAt: 10,
        updatedAt: 10,
      });
      emitAgentEvent({
        runId: "run-parent-fix",
        stream: "tool",
        data: {
          phase: "start",
          name: "write",
          toolCallId: "tool-parent-write",
          args: { path: "/tmp/worker.ts" },
        },
      });
      emitAgentEvent({
        runId: "run-parent-fix",
        stream: "tool",
        data: {
          phase: "result",
          name: "write",
          toolCallId: "tool-parent-write",
          isError: false,
          result: { details: { ok: true } },
        },
      });
      emitAgentEvent({
        runId: "run-parent-fix",
        stream: "tool",
        data: {
          phase: "start",
          name: "review_task",
          toolCallId: "tool-parent-review",
          args: { task: "Review the worker fix" },
        },
      });
      emitAgentEvent({
        runId: "run-parent-fix",
        stream: "tool",
        data: {
          phase: "result",
          name: "review_task",
          toolCallId: "tool-parent-review",
          isError: false,
          result: {
            details: {
              verdict: "REVIEW_PASS",
              summary: "Spec and quality reviews passed.",
            },
          },
        },
      });
      emitAgentEvent({
        runId: "run-parent-fix",
        stream: "assistant",
        data: { text: "Patched the worker guard and completed review." },
      });
      emitAgentEvent({
        runId: "run-parent-fix",
        stream: "lifecycle",
        data: { phase: "end", endedAt: 12 },
      });

      await flushTaskTrajectoryWritesForTest();
      stopActions();

      const parentTrajectory = readTaskTrajectorySync(parentMetadata.metadata.trajectoryRef);
      expect(parentTrajectory?.evidence).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            kind: "review_passed",
            summary: expect.stringContaining("Review passed"),
            source: "tool",
          }),
        ]),
      );
      expect(parentTrajectory?.completion).toMatchObject({
        status: "accepted",
        spec: {
          taskType: "fix",
        },
      });
      expect(actionEvents).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            runId: "run-parent-fix",
            data: expect.objectContaining({
              actionId: "completion:run-parent-fix",
              kind: "completion",
              projectedTitle: "Completion accepted",
            }),
          }),
        ]),
      );
    });
  });
});
