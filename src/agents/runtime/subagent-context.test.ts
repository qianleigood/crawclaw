import { describe, expect, it } from "vitest";
import {
  normalizeAgentSpawnContext,
  toAcpSpawnContext,
  toSubagentSpawnContext,
} from "./subagent-context.js";

describe("subagent-context", () => {
  it("normalizes spawn tool context and derives requester origin", () => {
    const normalized = normalizeAgentSpawnContext({
      agentSessionKey: " agent:main:main ",
      agentChannel: " discord ",
      agentAccountId: " acct ",
      agentTo: " channel:123 ",
      agentThreadId: " 456 ",
      agentGroupId: " group-1 ",
      agentGroupChannel: " group-channel ",
      agentGroupSpace: " group-space ",
      requesterAgentIdOverride: " child-agent ",
      sandboxed: true,
      workspaceDir: " /workspace/project ",
    });

    expect(normalized).toMatchObject({
      agentSessionKey: "agent:main:main",
      agentChannel: "discord",
      agentAccountId: "acct",
      agentTo: "channel:123",
      agentThreadId: "456",
      agentGroupId: "group-1",
      agentGroupChannel: "group-channel",
      agentGroupSpace: "group-space",
      requesterAgentIdOverride: "child-agent",
      sandboxed: true,
      workspaceDir: "/workspace/project",
      requesterOrigin: {
        channel: "discord",
        accountId: "acct",
        to: "channel:123",
        threadId: "456",
      },
    });
  });

  it("maps normalized context into ACP and subagent-specific shapes", () => {
    const normalized = normalizeAgentSpawnContext({
      agentSessionKey: "agent:main:main",
      agentChannel: "discord",
      agentAccountId: "acct",
      agentTo: "channel:123",
      agentThreadId: 456,
      agentGroupId: "group-1",
      agentGroupChannel: "group-channel",
      agentGroupSpace: "group-space",
      requesterAgentIdOverride: "child-agent",
      sandboxed: true,
      workspaceDir: "/workspace/project",
    });

    expect(toAcpSpawnContext(normalized)).toEqual({
      agentSessionKey: "agent:main:main",
      agentChannel: "discord",
      agentAccountId: "acct",
      agentTo: "channel:123",
      agentThreadId: 456,
      agentGroupId: "group-1",
      sandboxed: true,
    });
    expect(toSubagentSpawnContext(normalized)).toEqual({
      agentSessionKey: "agent:main:main",
      agentChannel: "discord",
      agentAccountId: "acct",
      agentTo: "channel:123",
      agentThreadId: 456,
      agentGroupId: "group-1",
      agentGroupChannel: "group-channel",
      agentGroupSpace: "group-space",
      requesterAgentIdOverride: "child-agent",
      workspaceDir: "/workspace/project",
    });
  });
});
