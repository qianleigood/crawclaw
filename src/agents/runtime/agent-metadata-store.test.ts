import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveStorePath } from "../../config/sessions/paths.js";
import { createRunningTaskRun } from "../../tasks/task-executor.js";
import { getTaskById, resetTaskRegistryForTests } from "../../tasks/task-registry.js";
import { withStateDirEnv } from "../../test-helpers/state-dir-env.js";
import {
  readAgentTaskCapabilitySnapshotSync,
  readAgentTaskRuntimeMetadataSync,
  resolveAgentTaskResumeTargetBySessionId,
  upsertAgentTaskRuntimeMetadata,
} from "./agent-metadata-store.js";

describe("agent-metadata-store", () => {
  afterEach(() => {
    resetTaskRegistryForTests({ persist: false });
  });

  it("persists runtime metadata and updates task transcript/runtime refs", async () => {
    await withStateDirEnv("crawclaw-agent-task-runtime-", async ({ stateDir }) => {
      const childSessionKey = "agent:worker:subagent:child-runtime";
      const storePath = resolveStorePath(undefined, { agentId: "worker" });
      await fs.mkdir(path.dirname(storePath), { recursive: true });
      await fs.writeFile(
        storePath,
        JSON.stringify(
          {
            [childSessionKey]: {
              sessionId: "sess-worker-runtime",
              updatedAt: Date.now(),
              sessionFile: "sess-worker-runtime.jsonl",
            },
          },
          null,
          2,
        ),
        "utf8",
      );

      const created = createRunningTaskRun({
        runtime: "subagent",
        ownerKey: "agent:main:main",
        scopeKind: "session",
        childSessionKey,
        agentId: "worker",
        agentMetadata: {
          parentAgentId: "main",
          mode: "background",
          spawnSource: "sessions_spawn",
        },
        runId: "run-worker-runtime",
        task: "Investigate worker issue",
      });

      const { task, metadata } = await upsertAgentTaskRuntimeMetadata({
        taskId: created.taskId,
        runtime: "subagent",
        agentId: "worker",
        parentAgentId: "main",
        mode: "background",
        spawnSource: "sessions_spawn",
        sessionKey: childSessionKey,
        storePath,
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
        runId: "run-worker-runtime",
        task: "Investigate worker issue",
      });

      expect(metadata).toMatchObject({
        taskId: created.taskId,
        runtime: "subagent",
        agentId: "worker",
        parentAgentId: "main",
        sessionKey: childSessionKey,
        sessionId: "sess-worker-runtime",
        storePath,
        transcriptRef: "agents/worker/sessions/sess-worker-runtime.jsonl",
        trajectoryRef: `agents/worker/tasks/${created.taskId}.trajectory.json`,
        capabilitySnapshotRef: `agents/worker/tasks/${created.taskId}.capabilities.json`,
      });
      expect(task?.agentMetadata).toMatchObject({
        parentAgentId: "main",
        mode: "background",
        spawnSource: "sessions_spawn",
        transcriptRef: "agents/worker/sessions/sess-worker-runtime.jsonl",
        runtimeStateRef: `agents/worker/tasks/${created.taskId}.json`,
        trajectoryRef: `agents/worker/tasks/${created.taskId}.trajectory.json`,
        capabilitySnapshotRef: `agents/worker/tasks/${created.taskId}.capabilities.json`,
      });

      const storedTask = getTaskById(created.taskId);
      expect(storedTask?.agentMetadata).toEqual(task?.agentMetadata);

      const runtimeMetadata = readAgentTaskRuntimeMetadataSync(
        task?.agentMetadata?.runtimeStateRef,
      );
      expect(runtimeMetadata).toMatchObject({
        taskId: created.taskId,
        runtime: "subagent",
        sessionId: "sess-worker-runtime",
        sessionKey: childSessionKey,
        capabilitySnapshotRef: `agents/worker/tasks/${created.taskId}.capabilities.json`,
      });
      const capabilitySnapshot = readAgentTaskCapabilitySnapshotSync(
        task?.agentMetadata?.capabilitySnapshotRef,
      );
      expect(capabilitySnapshot).toMatchObject({
        taskId: created.taskId,
        runtime: "subagent",
        agentId: "worker",
        parentAgentId: "main",
        mode: "background",
        model: "openai/gpt-5.4-mini",
        sandboxed: true,
        workspaceDir: "/workspace/worker",
        requesterSessionKey: "agent:main:main",
      });

      await expect(
        fs.access(path.join(stateDir, "agents", "worker", "tasks", `${created.taskId}.json`)),
      ).resolves.toBeUndefined();
      await expect(
        fs.access(
          path.join(stateDir, "agents", "worker", "tasks", `${created.taskId}.capabilities.json`),
        ),
      ).resolves.toBeUndefined();
    });
  });

  it("resolves resume targets from persisted agent task metadata", async () => {
    await withStateDirEnv("crawclaw-agent-task-resume-", async () => {
      const childSessionKey = "agent:worker:acp:child-resume";
      const storePath = resolveStorePath(undefined, { agentId: "worker" });
      await fs.mkdir(path.dirname(storePath), { recursive: true });
      await fs.writeFile(storePath, "{}\n", "utf8");

      const created = createRunningTaskRun({
        runtime: "acp",
        ownerKey: "agent:main:main",
        scopeKind: "session",
        childSessionKey,
        agentId: "worker",
        agentMetadata: {
          parentAgentId: "main",
          mode: "background",
          spawnSource: "sessions_spawn",
        },
        runId: "run-worker-resume",
        task: "Resume worker session",
      });

      await upsertAgentTaskRuntimeMetadata({
        taskId: created.taskId,
        runtime: "acp",
        agentId: "worker",
        parentAgentId: "main",
        mode: "background",
        spawnSource: "sessions_spawn",
        sessionKey: childSessionKey,
        sessionId: "sess-worker-resume",
        storePath,
        runId: "run-worker-resume",
        task: "Resume worker session",
      });

      expect(resolveAgentTaskResumeTargetBySessionId("sess-worker-resume")).toMatchObject({
        sessionKey: childSessionKey,
        agentId: "worker",
        storePath,
        metadata: {
          taskId: created.taskId,
          runtime: "acp",
          sessionId: "sess-worker-resume",
        },
      });
    });
  });
});
