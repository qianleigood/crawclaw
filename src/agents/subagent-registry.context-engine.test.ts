import { beforeEach, describe, expect, it, vi } from "vitest";

const noop = () => {};

const mocks = vi.hoisted(() => ({
  callGateway: vi.fn(async () => ({})),
  loadConfig: vi.fn(() => ({})),
  onAgentEvent: vi.fn(() => noop),
  persistSubagentRunsToDisk: vi.fn(),
  restoreSubagentRunsFromDisk: vi.fn(() => 0),
  getSubagentRunsSnapshotForRead: vi.fn((runs: Map<string, unknown>) => new Map(runs)),
}));

vi.mock("../gateway/call.js", () => ({
  callGateway: mocks.callGateway,
}));

vi.mock("../config/config.js", async () => {
  const actual = await vi.importActual<typeof import("../config/config.js")>("../config/config.js");
  return {
    ...actual,
    loadConfig: mocks.loadConfig,
  };
});

vi.mock("../infra/agent-events.js", () => ({
  onAgentEvent: mocks.onAgentEvent,
}));

vi.mock("./subagent-registry-state.js", () => ({
  getSubagentRunsSnapshotForRead: mocks.getSubagentRunsSnapshotForRead,
  persistSubagentRunsToDisk: mocks.persistSubagentRunsToDisk,
  restoreSubagentRunsFromDisk: mocks.restoreSubagentRunsFromDisk,
}));

vi.mock("./subagent-announce-queue.js", () => ({
  resetAnnounceQueuesForTests: vi.fn(),
}));

vi.mock("./timeout.js", () => ({
  resolveAgentTimeoutMs: vi.fn(() => 1_000),
}));

describe("subagent-registry memory runtime bootstrap", () => {
  let mod: typeof import("./subagent-registry.js");

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    mod = await import("./subagent-registry.js");
    mod.resetSubagentRegistryForTests({ persist: false });
  });

  it("notifies Rust memory when released subagent runs end", async () => {
    mod.addSubagentRunForTests({
      runId: "run-1",
      childSessionKey: "agent:main:session:child",
      controllerSessionKey: "agent:main:session:parent",
      requesterSessionKey: "agent:main:session:parent",
      requesterOrigin: undefined,
      requesterDisplayKey: "parent",
      task: "task",
      cleanup: "keep",
      expectsCompletionMessage: undefined,
      spawnMode: "run",
      workspaceDir: "/tmp/workspace",
      createdAt: 1,
      startedAt: 1,
      sessionStartedAt: 1,
      accumulatedRuntimeMs: 0,
      cleanupHandled: false,
    });

    mod.releaseSubagentRun("run-1");

    await vi.waitFor(() => {
      expect(mocks.callGateway).toHaveBeenCalledWith({
        method: "memory.onSubagentEnded",
        params: {
          childSessionKey: "agent:main:session:child",
          reason: "released",
          workspaceDir: "/tmp/workspace",
        },
        timeoutMs: 10_000,
      });
    });
  });
});
