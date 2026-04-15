import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => {
  const spawnAgentSessionDirectMock = vi.fn();
  return {
    spawnAgentSessionDirectMock,
  };
});

vi.mock("../runtime/spawn-session.js", () => ({
  spawnAgentSessionDirect: (...args: unknown[]) => hoisted.spawnAgentSessionDirectMock(...args),
}));

let createSessionsSpawnTool: typeof import("./sessions-spawn-tool.js").createSessionsSpawnTool;

describe("sessions_spawn tool", () => {
  beforeAll(async () => {
    ({ createSessionsSpawnTool } = await import("./sessions-spawn-tool.js"));
  });

  beforeEach(() => {
    hoisted.spawnAgentSessionDirectMock.mockReset().mockResolvedValue({
      status: "accepted",
      childSessionKey: "agent:main:subagent:1",
      runId: "run-subagent",
    });
  });

  it("uses subagent runtime by default", async () => {
    const tool = createSessionsSpawnTool({
      agentSessionKey: "agent:main:main",
      agentChannel: "discord",
      agentAccountId: "default",
      agentTo: "channel:123",
      agentThreadId: "456",
    });

    const result = await tool.execute("call-1", {
      task: "build feature",
      agentId: "main",
      model: "anthropic/claude-sonnet-4-6",
      thinking: "medium",
      runTimeoutSeconds: 5,
      thread: true,
      mode: "session",
      cleanup: "keep",
    });

    expect(result.details).toMatchObject({
      status: "accepted",
      childSessionKey: "agent:main:subagent:1",
      runId: "run-subagent",
    });
    expect(hoisted.spawnAgentSessionDirectMock).toHaveBeenCalledWith(
      expect.objectContaining({
        runtime: "subagent",
        task: "build feature",
        agentId: "main",
        model: "anthropic/claude-sonnet-4-6",
        thinking: "medium",
        runTimeoutSeconds: 5,
        thread: true,
        mode: "session",
        cleanup: "keep",
      }),
      expect.objectContaining({
        agentSessionKey: "agent:main:main",
      }),
    );
  });

  it("passes inherited workspaceDir from tool context, not from tool args", async () => {
    const tool = createSessionsSpawnTool({
      agentSessionKey: "agent:main:main",
      workspaceDir: "/parent/workspace",
    });

    await tool.execute("call-ws", {
      task: "inspect AGENTS",
      workspaceDir: "/tmp/attempted-override",
    });

    expect(hoisted.spawnAgentSessionDirectMock).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        workspaceDir: "/parent/workspace",
      }),
    );
  });

  it("routes to ACP runtime when runtime=acp", async () => {
    hoisted.spawnAgentSessionDirectMock.mockResolvedValueOnce({
      status: "accepted",
      childSessionKey: "agent:codex:acp:1",
      runId: "run-acp",
    });
    const tool = createSessionsSpawnTool({
      agentSessionKey: "agent:main:main",
      agentChannel: "discord",
      agentAccountId: "default",
      agentTo: "channel:123",
      agentThreadId: "456",
    });

    const result = await tool.execute("call-2", {
      runtime: "acp",
      task: "investigate the failing CI run",
      agentId: "codex",
      cwd: "/workspace",
      thread: true,
      mode: "session",
      streamTo: "parent",
    });

    expect(result.details).toMatchObject({
      status: "accepted",
      childSessionKey: "agent:codex:acp:1",
      runId: "run-acp",
    });
    expect(hoisted.spawnAgentSessionDirectMock).toHaveBeenCalledWith(
      expect.objectContaining({
        runtime: "acp",
        task: "investigate the failing CI run",
        agentId: "codex",
        cwd: "/workspace",
        thread: true,
        mode: "session",
        streamTo: "parent",
      }),
      expect.objectContaining({
        agentSessionKey: "agent:main:main",
      }),
    );
  });

  it("forwards ACP sandbox options and requester sandbox context", async () => {
    const tool = createSessionsSpawnTool({
      agentSessionKey: "agent:main:subagent:parent",
      sandboxed: true,
    });

    await tool.execute("call-2b", {
      runtime: "acp",
      task: "investigate",
      agentId: "codex",
      sandbox: "require",
    });

    expect(hoisted.spawnAgentSessionDirectMock).toHaveBeenCalledWith(
      expect.objectContaining({
        runtime: "acp",
        task: "investigate",
        sandbox: "require",
      }),
      expect.objectContaining({
        agentSessionKey: "agent:main:subagent:parent",
        sandboxed: true,
      }),
    );
  });

  it("passes resumeSessionId through to ACP spawns", async () => {
    const tool = createSessionsSpawnTool({
      agentSessionKey: "agent:main:main",
    });

    await tool.execute("call-2c", {
      runtime: "acp",
      task: "resume prior work",
      agentId: "codex",
      resumeSessionId: "7f4a78e0-f6be-43fe-855c-c1c4fd229bc4",
    });

    expect(hoisted.spawnAgentSessionDirectMock).toHaveBeenCalledWith(
      expect.objectContaining({
        runtime: "acp",
        task: "resume prior work",
        agentId: "codex",
        resumeSessionId: "7f4a78e0-f6be-43fe-855c-c1c4fd229bc4",
      }),
      expect.any(Object),
    );
  });

  it("rejects resumeSessionId without runtime=acp", async () => {
    const tool = createSessionsSpawnTool({
      agentSessionKey: "agent:main:main",
    });

    const result = await tool.execute("call-guard", {
      task: "resume prior work",
      resumeSessionId: "7f4a78e0-f6be-43fe-855c-c1c4fd229bc4",
    });

    expect(JSON.stringify(result)).toContain("resumeSessionId is only supported for runtime=acp");
    expect(hoisted.spawnAgentSessionDirectMock).not.toHaveBeenCalled();
  });

  it("rejects attachments for ACP runtime", async () => {
    const tool = createSessionsSpawnTool({
      agentSessionKey: "agent:main:main",
      agentChannel: "discord",
      agentAccountId: "default",
      agentTo: "channel:123",
      agentThreadId: "456",
    });

    const result = await tool.execute("call-3", {
      runtime: "acp",
      task: "analyze file",
      attachments: [{ name: "a.txt", content: "hello", encoding: "utf8" }],
    });

    expect(result.details).toMatchObject({
      status: "error",
    });
    const details = result.details as { error?: string };
    expect(details.error).toContain("attachments are currently unsupported for runtime=acp");
    expect(hoisted.spawnAgentSessionDirectMock).not.toHaveBeenCalled();
  });

  it('rejects streamTo when runtime is not "acp"', async () => {
    const tool = createSessionsSpawnTool({
      agentSessionKey: "agent:main:main",
    });

    const result = await tool.execute("call-3b", {
      runtime: "subagent",
      task: "analyze file",
      streamTo: "parent",
    });

    expect(result.details).toMatchObject({
      status: "error",
    });
    const details = result.details as { error?: string };
    expect(details.error).toContain("streamTo is only supported for runtime=acp");
    expect(hoisted.spawnAgentSessionDirectMock).not.toHaveBeenCalled();
  });

  it("keeps attachment content schema unconstrained for llama.cpp grammar safety", () => {
    const tool = createSessionsSpawnTool();
    const schema = tool.parameters as {
      properties?: {
        attachments?: {
          items?: {
            properties?: {
              content?: {
                type?: string;
                maxLength?: number;
              };
            };
          };
        };
      };
    };

    const contentSchema = schema.properties?.attachments?.items?.properties?.content;
    expect(contentSchema?.type).toBe("string");
    expect(contentSchema?.maxLength).toBeUndefined();
  });
});
