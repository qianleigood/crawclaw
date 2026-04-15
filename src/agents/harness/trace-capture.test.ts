import fs from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { createRunningTaskRun } from "../../tasks/task-executor.js";
import { resetTaskRegistryForTests } from "../../tasks/task-registry.js";
import { withStateDirEnv } from "../../test-helpers/state-dir-env.js";
import {
  resolveAgentTaskTrajectoryPath,
  upsertAgentTaskRuntimeMetadata,
} from "../runtime/agent-metadata-store.js";
import { captureTaskHarnessTrace } from "./trace-capture.js";

describe("trace-capture", () => {
  afterEach(() => {
    resetTaskRegistryForTests({ persist: false });
  });

  it("captures task snapshots and trajectory data for task-backed runs", async () => {
    await withStateDirEnv("crawclaw-harness-trace-", async () => {
      const created = createRunningTaskRun({
        runtime: "subagent",
        ownerKey: "agent:main:main",
        scopeKind: "session",
        childSessionKey: "agent:worker:subagent:harness",
        agentId: "worker",
        agentMetadata: {
          parentAgentId: "main",
          mode: "background",
          spawnSource: "sessions_spawn",
        },
        runId: "run-harness",
        task: "Fix the worker regression",
      });
      const { metadata } = await upsertAgentTaskRuntimeMetadata({
        taskId: created.taskId,
        runtime: "subagent",
        agentId: "worker",
        parentAgentId: "main",
        mode: "background",
        spawnSource: "sessions_spawn",
        sessionKey: "agent:worker:subagent:harness",
        sessionId: "sess-harness",
        runId: "run-harness",
        task: "Fix the worker regression",
      });

      const trajectoryPath = resolveAgentTaskTrajectoryPath({
        taskId: created.taskId,
        agentId: "worker",
      });
      fs.writeFileSync(
        trajectoryPath,
        JSON.stringify(
          {
            version: 1,
            taskId: created.taskId,
            runId: "run-harness",
            runtime: "subagent",
            mode: "background",
            status: "completed",
            startedAt: 1,
            updatedAt: 2,
            completedAt: 2,
            steps: [],
            evidence: [
              {
                kind: "answer_provided",
                at: 2,
                summary: "Patched and verified the worker flow.",
                source: "assistant",
                confidence: 1,
              },
            ],
          },
          null,
          2,
        ),
      );

      const trace = captureTaskHarnessTrace({
        taskId: created.taskId,
      });

      expect(trace).toMatchObject({
        version: 1,
        task: {
          taskId: created.taskId,
          runtime: "subagent",
          task: "Fix the worker regression",
        },
        trajectory: {
          taskId: created.taskId,
          runId: "run-harness",
          status: "completed",
        },
      });
      expect(trace?.refs.runtimeStateRef).toEqual(expect.any(String));
      expect(trace?.refs.trajectoryRef).toBe(metadata.trajectoryRef);
      expect(trace?.progress).toEqual([]);
    });
  });
});
