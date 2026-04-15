import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => {
  const spawnSubagentDirectMock = vi.fn();
  const spawnAcpDirectMock = vi.fn();
  const registerSubagentRunMock = vi.fn();
  return {
    spawnSubagentDirectMock,
    spawnAcpDirectMock,
    registerSubagentRunMock,
  };
});

vi.mock("../subagent-spawn.js", () => ({
  spawnSubagentDirect: (...args: unknown[]) => hoisted.spawnSubagentDirectMock(...args),
}));

vi.mock("../acp-spawn.js", () => ({
  spawnAcpDirect: (...args: unknown[]) => hoisted.spawnAcpDirectMock(...args),
}));

vi.mock("../subagent-registry.js", () => ({
  registerSubagentRun: (...args: unknown[]) => hoisted.registerSubagentRunMock(...args),
}));

vi.mock("../../config/config.js", () => ({
  loadConfig: () => ({
    session: {
      mainKey: "main",
      scope: "per-sender",
    },
  }),
}));

vi.mock("../tools/sessions-helpers.js", () => ({
  resolveMainSessionAlias: () => ({ mainKey: "main", alias: "main" }),
  resolveInternalSessionKey: ({ key }: { key: string }) => key,
  resolveDisplaySessionKey: ({ key }: { key: string }) => key,
}));

let spawnAgentSessionDirect: typeof import("./spawn-session.js").spawnAgentSessionDirect;

describe("spawn-session seam", () => {
  beforeAll(async () => {
    ({ spawnAgentSessionDirect } = await import("./spawn-session.js"));
  });

  beforeEach(() => {
    hoisted.spawnSubagentDirectMock.mockReset().mockResolvedValue({
      status: "accepted",
      childSessionKey: "agent:main:subagent:1",
      runId: "run-subagent",
    });
    hoisted.spawnAcpDirectMock.mockReset().mockResolvedValue({
      status: "accepted",
      childSessionKey: "agent:codex:acp:1",
      runId: "run-acp",
      mode: "run",
    });
    hoisted.registerSubagentRunMock.mockReset();
  });

  it("routes subagent runtime through the normalized subagent context", async () => {
    const result = await spawnAgentSessionDirect(
      {
        task: "build feature",
        agentId: "main",
        model: "anthropic/claude-sonnet-4-6",
        thinking: "medium",
        runTimeoutSeconds: 5,
        maxTurns: 7,
        thread: true,
        mode: "session",
        cleanup: "keep",
        streamParams: {
          cacheRetention: "short",
          promptCacheKey: "special:agent:main:main",
          promptCacheRetention: "24h",
        },
      },
      {
        agentSessionKey: " agent:main:main ",
        agentChannel: " discord ",
        agentAccountId: " acct ",
        agentTo: " channel:123 ",
        agentThreadId: " 456 ",
        agentGroupId: " group-1 ",
        agentGroupChannel: " group-channel ",
        agentGroupSpace: " group-space ",
        requesterAgentIdOverride: " child-agent ",
        workspaceDir: " /workspace/project ",
      },
    );

    expect(result).toMatchObject({
      status: "accepted",
      childSessionKey: "agent:main:subagent:1",
      runId: "run-subagent",
    });
    expect(hoisted.spawnSubagentDirectMock).toHaveBeenCalledWith(
      expect.objectContaining({
        task: "build feature",
        agentId: "main",
        model: "anthropic/claude-sonnet-4-6",
        thinking: "medium",
        runTimeoutSeconds: 5,
        maxTurns: 7,
        thread: true,
        mode: "session",
        cleanup: "keep",
        streamParams: {
          cacheRetention: "short",
          promptCacheKey: "special:agent:main:main",
          promptCacheRetention: "24h",
        },
        expectsCompletionMessage: true,
      }),
      expect.objectContaining({
        agentSessionKey: "agent:main:main",
        agentChannel: "discord",
        agentAccountId: "acct",
        agentTo: "channel:123",
        agentThreadId: "456",
        agentGroupId: "group-1",
        agentGroupChannel: "group-channel",
        agentGroupSpace: "group-space",
        requesterAgentIdOverride: "child-agent",
        workspaceDir: "/workspace/project",
      }),
    );
    expect(hoisted.registerSubagentRunMock).not.toHaveBeenCalled();
  });

  it("routes ACP runtime and registers tracked runs when parent streaming is disabled", async () => {
    const result = await spawnAgentSessionDirect(
      {
        runtime: "acp",
        task: "investigate ci",
        label: "my-task",
        agentId: "codex",
        cwd: "/workspace",
        runTimeoutSeconds: 10,
        cleanup: "delete",
      },
      {
        agentSessionKey: "agent:main:main",
        agentChannel: "discord",
        agentAccountId: "acct",
        agentTo: "channel:123",
        agentThreadId: "456",
      },
    );

    expect(result).toMatchObject({
      status: "accepted",
      childSessionKey: "agent:codex:acp:1",
      runId: "run-acp",
    });
    expect(hoisted.spawnAcpDirectMock).toHaveBeenCalledWith(
      expect.objectContaining({
        task: "investigate ci",
        label: "my-task",
        agentId: "codex",
        cwd: "/workspace",
      }),
      expect.objectContaining({
        agentSessionKey: "agent:main:main",
        agentChannel: "discord",
        agentAccountId: "acct",
        agentTo: "channel:123",
        agentThreadId: "456",
      }),
    );
    expect(hoisted.registerSubagentRunMock).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: "run-acp",
        childSessionKey: "agent:codex:acp:1",
        requesterSessionKey: "agent:main:main",
        requesterDisplayKey: "agent:main:main",
        task: "investigate ci",
        taskRuntime: "acp",
        cleanup: "delete",
        label: "my-task",
        runTimeoutSeconds: 10,
        expectsCompletionMessage: true,
        spawnMode: "run",
      }),
    );
  });

  it('does not register ACP runs when streamTo is "parent"', async () => {
    await spawnAgentSessionDirect(
      {
        runtime: "acp",
        task: "stream to parent",
        streamTo: "parent",
      },
      {
        agentSessionKey: "agent:main:main",
      },
    );

    expect(hoisted.spawnAcpDirectMock).toHaveBeenCalledOnce();
    expect(hoisted.registerSubagentRunMock).not.toHaveBeenCalled();
  });
});
