import { beforeEach, describe, expect, it } from "vitest";
import { registerAgentRunContext, resetAgentRunContextForTest } from "../../infra/agent-events.js";
import { createRunningTaskRun } from "../../tasks/task-executor.js";
import { resetTaskRegistryForTests } from "../../tasks/task-registry.js";
import { withStateDirEnv } from "../../test-helpers/state-dir-env.js";
import { resolveAgentGuardContext } from "./agent-guard-context.js";
import { upsertAgentTaskRuntimeMetadata } from "./agent-metadata-store.js";
import { registerAgentRuntimeRun, resetAgentProgressEventsForTest } from "./agent-progress.js";

describe("agent-guard-context", () => {
  beforeEach(() => {
    resetAgentRunContextForTest();
    resetAgentProgressEventsForTest();
    resetTaskRegistryForTests({ persist: false });
  });

  it("marks background runs as ineligible for interactive approvals", () => {
    registerAgentRuntimeRun({
      runId: "bg-run",
      sessionKey: "agent:bg",
      sessionId: "session-bg",
      agentId: "worker",
      runtime: "subagent",
      mode: "background",
      status: "running",
      updatedAt: Date.now(),
    });

    expect(resolveAgentGuardContext({ runId: "bg-run" })).toMatchObject({
      runId: "bg-run",
      agentId: "worker",
      sessionKey: "agent:bg",
      sessionId: "session-bg",
      runtime: "subagent",
      mode: "background",
      interactiveApprovalBlocker: "background",
      interactiveApprovalAvailable: false,
      controlUiVisible: true,
      heartbeat: false,
    });
  });

  it("marks hidden-control-ui runs as ineligible for interactive approvals", () => {
    registerAgentRunContext("hidden-run", {
      sessionKey: "agent:hidden",
      sessionId: "session-hidden",
      agentId: "main",
      taskRuntime: "cli",
      taskMode: "foreground",
      isControlUiVisible: false,
    });
    registerAgentRuntimeRun({
      runId: "hidden-run",
      sessionKey: "agent:hidden",
      sessionId: "session-hidden",
      agentId: "main",
      runtime: "cli",
      mode: "foreground",
      status: "running",
      updatedAt: Date.now(),
    });

    expect(resolveAgentGuardContext({ runId: "hidden-run" })).toMatchObject({
      runId: "hidden-run",
      agentId: "main",
      sessionKey: "agent:hidden",
      sessionId: "session-hidden",
      runtime: "cli",
      mode: "foreground",
      interactiveApprovalBlocker: "hidden-control-ui",
      interactiveApprovalAvailable: false,
      controlUiVisible: false,
      heartbeat: false,
    });
  });

  it("hydrates capability details from persisted task snapshots", async () => {
    await withStateDirEnv("crawclaw-agent-guard-capabilities-", async () => {
      const created = createRunningTaskRun({
        runtime: "subagent",
        ownerKey: "agent:main:main",
        scopeKind: "session",
        childSessionKey: "agent:worker:subagent:guard-capabilities",
        agentId: "worker",
        agentMetadata: {
          parentAgentId: "main",
          mode: "background",
          spawnSource: "sessions_spawn",
        },
        runId: "guard-capabilities-run",
        task: "Inspect capabilities",
      });

      await upsertAgentTaskRuntimeMetadata({
        taskId: created.taskId,
        runtime: "subagent",
        agentId: "worker",
        parentAgentId: "main",
        mode: "background",
        spawnSource: "sessions_spawn",
        sessionKey: "agent:worker:subagent:guard-capabilities",
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
          requesterAgentIdOverride: "worker",
        },
        runId: "guard-capabilities-run",
        task: "Inspect capabilities",
      });

      registerAgentRuntimeRun({
        runId: "guard-capabilities-run",
        taskId: created.taskId,
        sessionKey: "agent:worker:subagent:guard-capabilities",
        sessionId: "session-capabilities",
        agentId: "worker",
        runtime: "subagent",
        mode: "background",
        status: "running",
        updatedAt: Date.now(),
      });

      expect(resolveAgentGuardContext({ runId: "guard-capabilities-run" })).toMatchObject({
        runId: "guard-capabilities-run",
        agentId: "worker",
        runtime: "subagent",
        mode: "background",
        sandboxed: true,
        capability: {
          snapshotRef: `agents/worker/tasks/${created.taskId}.capabilities.json`,
          model: "openai/gpt-5.4-mini",
          sandboxed: true,
          workspaceDir: "/workspace/worker",
          spawnSource: "sessions_spawn",
          requesterSessionKey: "agent:main:main",
          requesterAgentIdOverride: "worker",
        },
        interactiveApprovalBlocker: "background",
      });
    });
  });
});
