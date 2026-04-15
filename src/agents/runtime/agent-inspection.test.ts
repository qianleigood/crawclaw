import { beforeEach, describe, expect, it } from "vitest";
import {
  emitAgentEvent,
  registerAgentRunContext,
  resetAgentEventsForTest,
  resetAgentRunContextForTest,
} from "../../infra/agent-events.js";
import { writeJsonAtomic } from "../../infra/json-files.js";
import {
  resetDiagnosticSessionStateForTest,
  updateDiagnosticSessionState,
} from "../../logging/diagnostic-session-state.js";
import { createRunningTaskRun } from "../../tasks/task-executor.js";
import { resetTaskRegistryForTests } from "../../tasks/task-registry.js";
import { withStateDirEnv } from "../../test-helpers/state-dir-env.js";
import {
  flushTaskTrajectoryWritesForTest,
  resetTaskTrajectoryBridgeForTest,
} from "../tasks/task-trajectory.js";
import { inspectAgentRuntime } from "./agent-inspection.js";
import {
  resolveAgentTaskTrajectoryPath,
  upsertAgentTaskRuntimeMetadata,
} from "./agent-metadata-store.js";
import {
  markAgentRunCompleted,
  registerAgentRuntimeRun,
  resetAgentProgressEventsForTest,
} from "./agent-progress.js";
import { resetAgentRuntimeStateForTest } from "./agent-runtime-state.js";

describe("agent-inspection", () => {
  beforeEach(() => {
    resetAgentEventsForTest();
    resetAgentRunContextForTest();
    resetAgentProgressEventsForTest();
    resetAgentRuntimeStateForTest();
    resetTaskTrajectoryBridgeForTest();
    resetDiagnosticSessionStateForTest();
    resetTaskRegistryForTests({ persist: false });
  });

  it("aggregates runtime, capability, trajectory, guard, and loop state for a task-backed run", async () => {
    await withStateDirEnv("crawclaw-agent-inspection-run-", async () => {
      const created = createRunningTaskRun({
        runtime: "subagent",
        ownerKey: "agent:main:main",
        scopeKind: "session",
        childSessionKey: "agent:worker:subagent:inspection",
        agentId: "worker",
        agentMetadata: {
          parentAgentId: "main",
          mode: "background",
          spawnSource: "sessions_spawn",
        },
        runId: "inspect-run",
        task: "Reply with a concise status update",
      });

      const { metadata } = await upsertAgentTaskRuntimeMetadata({
        taskId: created.taskId,
        runtime: "subagent",
        agentId: "worker",
        parentAgentId: "main",
        mode: "background",
        spawnSource: "sessions_spawn",
        sessionKey: "agent:worker:subagent:inspection",
        sessionId: "sess-inspection",
        capabilitySnapshot: {
          runtime: "subagent",
          agentId: "worker",
          parentAgentId: "main",
          mode: "background",
          spawnSource: "sessions_spawn",
          model: "openai/gpt-5.4-mini",
          sandboxed: true,
          workspaceDir: "/workspace/worker",
          requesterSessionKey: "agent:main:main",
        },
        runId: "inspect-run",
        task: "Reply with a concise status update",
      });

      registerAgentRunContext("inspect-run", {
        sessionKey: "agent:worker:subagent:inspection",
        sessionId: "sess-inspection",
        agentId: "worker",
        parentAgentId: "main",
        taskId: created.taskId,
        taskRuntime: "subagent",
        taskMode: "background",
        label: "Inspection worker",
        task: "Reply with a concise status update",
      });
      registerAgentRuntimeRun({
        runId: "inspect-run",
        taskId: created.taskId,
        runtime: "subagent",
        mode: "background",
        agentId: "worker",
        parentAgentId: "main",
        sessionId: "sess-inspection",
        sessionKey: "agent:worker:subagent:inspection",
        status: "running",
        startedAt: 10,
        updatedAt: 10,
      });

      emitAgentEvent({
        runId: "inspect-run",
        stream: "lifecycle",
        data: { phase: "start", startedAt: 10 },
      });
      emitAgentEvent({
        runId: "inspect-run",
        stream: "tool",
        data: {
          phase: "start",
          name: "exec",
          toolCallId: "tool-test",
          args: { command: "printf ready" },
        },
      });
      emitAgentEvent({
        runId: "inspect-run",
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
        runId: "inspect-run",
        stream: "assistant",
        data: { text: "Status: worker checks passed." },
      });
      markAgentRunCompleted({
        runId: "inspect-run",
        endedAt: 20,
        summary: "Status: worker checks passed.",
      });

      const diagnosticState = updateDiagnosticSessionState(
        {
          sessionKey: "agent:worker:subagent:inspection",
          sessionId: "sess-inspection",
        },
        {
          lastActivity: 20,
          state: "idle",
          queueDepth: 0,
        },
      );
      diagnosticState.loopProgressHistory = [
        {
          toolName: "exec",
          toolCategory: "exec",
          inputFingerprint: "fingerprint:exec:worker-test",
          toolCallId: "tool-test",
          outputFingerprint: "fingerprint:result:ok",
          outcomeClass: "success",
          stateDelta: "new_result",
          timestamp: 15,
        },
      ];
      diagnosticState.toolLoopWarningBuckets = new Map([["known_poll_no_progress", 2]]);
      diagnosticState.commandPollCounts = new Map([
        ["process:worker", { count: 3, lastPollAt: 18 }],
      ]);
      diagnosticState.recentChannelStreamingDecisions = [
        {
          ts: 19,
          channel: "feishu",
          accountId: "primary",
          chatId: "chat-1",
          enabled: false,
          surface: "none",
          reason: "disabled_for_thread_reply",
        },
      ];

      await flushTaskTrajectoryWritesForTest();

      const inspection = inspectAgentRuntime({ runId: "inspect-run" });
      expect(inspection).toMatchObject({
        runId: "inspect-run",
        taskId: created.taskId,
        runtimeState: {
          runId: "inspect-run",
          taskId: created.taskId,
          runtime: "subagent",
          mode: "background",
          agentId: "worker",
          parentAgentId: "main",
          sessionId: "sess-inspection",
          sessionKey: "agent:worker:subagent:inspection",
        },
        runContext: {
          taskId: created.taskId,
          taskRuntime: "subagent",
          taskMode: "background",
          agentId: "worker",
          parentAgentId: "main",
        },
        runtimeMetadata: {
          taskId: created.taskId,
          runtime: "subagent",
          sessionId: "sess-inspection",
          trajectoryRef: metadata.trajectoryRef,
          capabilitySnapshotRef: metadata.capabilitySnapshotRef,
        },
        capabilitySnapshot: {
          taskId: created.taskId,
          model: "openai/gpt-5.4-mini",
          sandboxed: true,
          workspaceDir: "/workspace/worker",
        },
        guard: {
          interactiveApprovalBlocker: "background",
          interactiveApprovalAvailable: false,
          sandboxed: true,
        },
        loop: {
          progressCount: 1,
          lastProgressTool: "exec",
          lastProgressStateDelta: "new_result",
          warningBuckets: [{ key: "known_poll_no_progress", count: 2 }],
          commandPolls: [{ key: "process:worker", count: 3, lastPollAt: 18 }],
        },
        channelStreaming: {
          recentDecisions: [
            {
              ts: 19,
              channel: "feishu",
              accountId: "primary",
              chatId: "chat-1",
              enabled: false,
              surface: "none",
              reason: "disabled_for_thread_reply",
            },
          ],
        },
        refs: {
          runtimeStateRef: `agents/worker/tasks/${created.taskId}.json`,
          trajectoryRef: `agents/worker/tasks/${created.taskId}.trajectory.json`,
          capabilitySnapshotRef: `agents/worker/tasks/${created.taskId}.capabilities.json`,
          transcriptRef: "agents/worker/sessions/sess-inspection.jsonl",
        },
      });
      expect(inspection?.trajectory?.steps).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            stepId: "tool:tool-test",
            toolName: "exec",
            status: "completed",
          }),
          expect.objectContaining({
            stepId: "assistant:final",
            kind: "assistant",
            status: "completed",
          }),
        ]),
      );
      expect(inspection?.completion).toBeDefined();
      expect(inspection?.warnings).toEqual([]);
    });
  });

  it("falls back to persisted task metadata when runtime state is absent", async () => {
    await withStateDirEnv("crawclaw-agent-inspection-task-", async () => {
      const created = createRunningTaskRun({
        runtime: "acp",
        ownerKey: "agent:main:main",
        scopeKind: "session",
        childSessionKey: "agent:worker:acp:inspection",
        agentId: "worker",
        agentMetadata: {
          parentAgentId: "main",
          mode: "background",
          spawnSource: "sessions_spawn",
        },
        runId: "inspect-task-only",
        task: "Wait for downstream ACP workflow",
      });

      const { metadata } = await upsertAgentTaskRuntimeMetadata({
        taskId: created.taskId,
        runtime: "acp",
        agentId: "worker",
        parentAgentId: "main",
        mode: "background",
        spawnSource: "sessions_spawn",
        sessionKey: "agent:worker:acp:inspection",
        sessionId: "sess-task-only",
        capabilitySnapshot: {
          runtime: "acp",
          agentId: "worker",
          parentAgentId: "main",
          mode: "background",
          spawnSource: "sessions_spawn",
          requesterSessionKey: "agent:main:main",
        },
        runId: "inspect-task-only",
        task: "Wait for downstream ACP workflow",
      });

      await writeJsonAtomic(
        resolveAgentTaskTrajectoryPath({
          taskId: created.taskId,
          agentId: "worker",
        }),
        {
          version: 1,
          taskId: created.taskId,
          runId: "inspect-task-only",
          runtime: "acp",
          mode: "background",
          agentId: "worker",
          parentAgentId: "main",
          sessionId: "sess-task-only",
          sessionKey: "agent:worker:acp:inspection",
          status: "completed",
          startedAt: 10,
          updatedAt: 20,
          completedAt: 20,
          steps: [],
          evidence: [
            {
              kind: "external_state_changed",
              at: 20,
              summary: "Observed external completion",
              source: "tool",
            },
          ],
          completion: {
            version: 1,
            evaluatedAt: 20,
            status: "waiting_external",
            summary: "Waiting for downstream ACP workflow.",
            spec: {
              version: 1,
              taskType: "poll",
              completionMode: "external_condition",
              summary: "Wait for downstream ACP workflow",
              deliverables: ["Observe external status change"],
              requiredEvidence: [],
              requireAnyOfEvidence: ["external_state_changed"],
              recommendedEvidence: [],
            },
            satisfiedEvidence: ["external_state_changed"],
            missingEvidence: [],
            warnings: [],
          },
        },
        { trailingNewline: true },
      );

      const inspection = inspectAgentRuntime({ taskId: created.taskId });
      expect(inspection).toMatchObject({
        taskId: created.taskId,
        runtimeMetadata: {
          taskId: created.taskId,
          runtime: "acp",
          runId: "inspect-task-only",
          trajectoryRef: metadata.trajectoryRef,
        },
        capabilitySnapshot: {
          taskId: created.taskId,
          runtime: "acp",
        },
        completion: {
          status: "waiting_external",
        },
        refs: {
          runtimeStateRef: `agents/worker/tasks/${created.taskId}.json`,
          trajectoryRef: `agents/worker/tasks/${created.taskId}.trajectory.json`,
          capabilitySnapshotRef: `agents/worker/tasks/${created.taskId}.capabilities.json`,
        },
      });
      expect(inspection?.runtimeState).toBeUndefined();
      expect(inspection?.warnings).toContain("Runtime state not found");
      expect(inspection?.warnings).not.toContain(
        `Task trajectory missing or unreadable: ${metadata.trajectoryRef}`,
      );
    });
  });
});
