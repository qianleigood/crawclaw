import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GatewayRequestHandlerOptions } from "./types.js";

const mocks = vi.hoisted(() => ({
  loadConfig: vi.fn(() => ({})),
  killSubagentRunAdmin: vi.fn(async () => ({ found: true, killed: true })),
}));

vi.mock("../../config/config.js", async () => {
  const actual =
    await vi.importActual<typeof import("../../config/config.js")>("../../config/config.js");
  return {
    ...actual,
    loadConfig: mocks.loadConfig,
  };
});

vi.mock("../../agents/subagent-control.js", () => ({
  killSubagentRunAdmin: mocks.killSubagentRunAdmin,
}));

import {
  createTaskRecord,
  getTaskById,
  resetTaskRegistryForTests,
} from "../../tasks/task-registry.js";
import { agentRuntimeHandlers } from "./agent-runtime.js";

function createOptions(
  method: string,
  params: Record<string, unknown>,
  overrides?: Partial<GatewayRequestHandlerOptions>,
): GatewayRequestHandlerOptions {
  return {
    req: { type: "req", id: "req-1", method, params },
    params,
    client: null,
    isWebchatConnect: () => false,
    respond: vi.fn(),
    context: {} as GatewayRequestHandlerOptions["context"],
    ...overrides,
  } as GatewayRequestHandlerOptions;
}

describe("agentRuntimeHandlers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetTaskRegistryForTests({ persist: false });
  });

  it("summarizes and lists runtime tasks by category", async () => {
    createTaskRecord({
      runtime: "subagent",
      requesterSessionKey: "agent:main:parent-1",
      childSessionKey: "agent:main:child-1",
      runId: "run-memory-1",
      status: "running",
      label: "memory-extraction",
      task: "memory extraction for latest session",
      agentMetadata: {
        spawnSource: "memory-extraction",
        mode: "background",
      },
      progressSummary: "Writing durable memory",
    });
    createTaskRecord({
      runtime: "subagent",
      requesterSessionKey: "agent:main:parent-2",
      childSessionKey: "agent:main:child-2",
      runId: "run-verify-1",
      status: "failed",
      label: "verification",
      task: "verification for workflow output",
      agentMetadata: {
        spawnSource: "verification",
        mode: "background",
      },
      terminalSummary: "Verification failed",
    });
    const acpTask = createTaskRecord({
      runtime: "acp",
      requesterSessionKey: "agent:main:parent-3",
      childSessionKey: "agent:main:child-3",
      runId: "run-acp-1",
      status: "queued",
      task: "acp follow-up",
    });

    const respondSummary = vi.fn();
    await agentRuntimeHandlers["agentRuntime.summary"](
      createOptions("agentRuntime.summary", {}, { respond: respondSummary }),
    );
    expect(respondSummary).toHaveBeenCalledWith(
      true,
      expect.objectContaining({
        running: 1,
        failed: 1,
        waiting: 1,
        byCategory: expect.objectContaining({
          memory: 1,
          verification: 1,
          acp: 1,
        }),
      }),
      undefined,
    );

    const respondList = vi.fn();
    await agentRuntimeHandlers["agentRuntime.list"](
      createOptions("agentRuntime.list", { limit: 10 }, { respond: respondList }),
    );
    expect(respondList).toHaveBeenCalledWith(
      true,
      expect.objectContaining({
        count: 3,
        runs: expect.arrayContaining([
          expect.objectContaining({
            taskId: acpTask.taskId,
            category: "acp",
            title: "ACP background task",
          }),
          expect.objectContaining({
            category: "memory",
            title: "Durable memory update",
            summary: "Writing durable memory",
          }),
          expect.objectContaining({
            category: "verification",
            title: "Verification run",
            summary: "Verification failed",
          }),
        ]),
      }),
      undefined,
    );
  });

  it("returns runtime detail with special-agent contract metadata", async () => {
    const task = createTaskRecord({
      runtime: "subagent",
      requesterSessionKey: "agent:main:parent-1",
      childSessionKey: "agent:main:child-1",
      runId: "run-summary-1",
      status: "running",
      task: "session summary refresh",
      agentMetadata: {
        spawnSource: "session-summary",
        mode: "background",
      },
    });
    const respond = vi.fn();

    await agentRuntimeHandlers["agentRuntime.get"](
      createOptions("agentRuntime.get", { taskId: task.taskId }, { respond }),
    );

    expect(respond).toHaveBeenCalledWith(
      true,
      expect.objectContaining({
        run: expect.objectContaining({
          taskId: task.taskId,
          category: "memory",
        }),
        contract: expect.objectContaining({
          definitionId: "session_summary",
          spawnSource: "session-summary",
        }),
        availableActions: expect.objectContaining({
          openSession: true,
          cancel: true,
        }),
      }),
      undefined,
    );
  });

  it("cancels cancellable runtime tasks", async () => {
    const task = createTaskRecord({
      runtime: "subagent",
      requesterSessionKey: "agent:main:parent-9",
      childSessionKey: "agent:main:child-9",
      runId: "run-runtime-9",
      status: "running",
      task: "background subagent task",
    });
    const respond = vi.fn();

    await agentRuntimeHandlers["agentRuntime.cancel"](
      createOptions("agentRuntime.cancel", { taskId: task.taskId }, { respond }),
    );

    expect(mocks.killSubagentRunAdmin).toHaveBeenCalledWith({
      cfg: {},
      sessionKey: "agent:main:child-9",
    });
    expect(getTaskById(task.taskId)?.status).toBe("cancelled");
    expect(respond).toHaveBeenCalledWith(
      true,
      expect.objectContaining({
        found: true,
        cancelled: true,
        task: expect.objectContaining({
          taskId: task.taskId,
          status: "cancelled",
        }),
      }),
      undefined,
    );
  });
});
