import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CrawClawConfig } from "../../config/config.js";
import {
  emitAgentEvent,
  registerAgentRunContext,
  resetAgentEventsForTest,
  resetAgentRunContextForTest,
} from "../../infra/agent-events.js";
import { resetDiagnosticSessionStateForTest, updateDiagnosticSessionState } from "../../logging/diagnostic-session-state.js";
import { createRunningTaskRun } from "../../tasks/task-executor.js";
import { resetTaskRegistryForTests } from "../../tasks/task-registry.js";
import { withStateDirEnv } from "../../test-helpers/state-dir-env.js";
import {
  flushTaskTrajectoryWritesForTest,
  resetTaskTrajectoryBridgeForTest,
} from "../tasks/task-trajectory.js";
import {
  markAgentRunCompleted,
  registerAgentRuntimeRun,
  resetAgentProgressEventsForTest,
} from "./agent-progress.js";
import { upsertAgentTaskRuntimeMetadata } from "./agent-metadata-store.js";
import { resetAgentRuntimeStateForTest } from "./agent-runtime-state.js";
import { buildAgentOpsSummary } from "./agent-ops-summary.js";

const NOW = Date.UTC(2026, 3, 7, 12, 0, 0);

describe("agent-ops-summary", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    resetAgentEventsForTest();
    resetAgentRunContextForTest();
    resetAgentProgressEventsForTest();
    resetAgentRuntimeStateForTest();
    resetTaskTrajectoryBridgeForTest();
    resetDiagnosticSessionStateForTest();
    resetTaskRegistryForTests({ persist: false });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("aggregates runtime, completion, guard, and loop signals per agent", async () => {
    await withStateDirEnv("crawclaw-agent-ops-", async () => {
      const cfg = {
        session: { mainKey: "main" },
        agents: {
          list: [{ id: "main" }, { id: "worker", name: "Worker" }],
        },
      } as CrawClawConfig;

      const created = createRunningTaskRun({
        runtime: "subagent",
        ownerKey: "agent:main:main",
        scopeKind: "session",
        childSessionKey: "agent:worker:subagent:status",
        agentId: "worker",
        agentMetadata: {
          parentAgentId: "main",
          mode: "background",
          spawnSource: "sessions_spawn",
        },
        runId: "worker-run",
        task: "Wait until downstream ACP workflow is ready",
      });

      const { metadata } = await upsertAgentTaskRuntimeMetadata({
        taskId: created.taskId,
        runtime: "subagent",
        agentId: "worker",
        parentAgentId: "main",
        mode: "background",
        spawnSource: "sessions_spawn",
        sessionKey: "agent:worker:subagent:status",
        sessionId: "sess-worker",
        runId: "worker-run",
        task: "Wait until downstream ACP workflow is ready",
      });

      registerAgentRunContext("worker-run", {
        sessionKey: "agent:worker:subagent:status",
        sessionId: "sess-worker",
        agentId: "worker",
        parentAgentId: "main",
        taskId: created.taskId,
        taskRuntime: "subagent",
        taskMode: "background",
        task: "Wait until downstream ACP workflow is ready",
      });
      registerAgentRuntimeRun({
        runId: "worker-run",
        taskId: created.taskId,
        runtime: "subagent",
        mode: "background",
        agentId: "worker",
        parentAgentId: "main",
        sessionId: "sess-worker",
        sessionKey: "agent:worker:subagent:status",
        status: "running",
        startedAt: NOW - 10_000,
        lastHeartbeat: NOW - 60_000,
        updatedAt: NOW - 60_000,
      });
      updateDiagnosticSessionState(
        { sessionKey: "agent:worker:subagent:status", sessionId: "sess-worker" },
        { lastActivity: NOW - 1000, queueDepth: 0, state: "idle" },
      ).toolLoopWarningBuckets = new Map([["known_poll_no_progress", 3]]);

      emitAgentEvent({
        runId: "worker-run",
        stream: "lifecycle",
        data: { phase: "start", startedAt: NOW - 10_000 },
      });
      emitAgentEvent({
        runId: "worker-run",
        stream: "assistant",
        data: { text: "Still waiting for downstream ACP workflow." },
      });
      emitAgentEvent({
        runId: "worker-run",
        stream: "lifecycle",
        data: { phase: "end", endedAt: NOW - 1000 },
      });
      markAgentRunCompleted({
        runId: "worker-run",
        endedAt: NOW - 1000,
        summary: "Waiting for downstream ACP workflow.",
      });
      await flushTaskTrajectoryWritesForTest();

      const summary = await buildAgentOpsSummary(cfg);
      const row = summary.agents.find((entry) => entry.id === "worker");
      expect(row).toMatchObject({
        id: "worker",
        name: "Worker",
        runtimeSummary: {
          total: 1,
          stale: 0,
        },
        completionBlockers: [{ key: "waiting_external", count: 1 }],
        loopWarnings: [{ key: "known_poll_no_progress", count: 3 }],
      });
      expect(row?.guardBlockers).toEqual([{ key: "background", count: 1 }]);
      expect(row?.taskSummary.total).toBe(1);
      expect(metadata.trajectoryRef).toContain(`${created.taskId}.trajectory.json`);
      expect(summary.taskSummary.total).toBe(1);
    });
  });
});
