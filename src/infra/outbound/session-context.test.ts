import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const resolveSessionAgentIdMock = vi.hoisted(() => vi.fn());

type SessionContextModule = typeof import("./session-context.js");

let buildOutboundSessionContext: SessionContextModule["buildOutboundSessionContext"];

vi.mock("../../agents/agent-scope.js", () => ({
  resolveSessionAgentId: (...args: unknown[]) => resolveSessionAgentIdMock(...args),
}));

beforeAll(async () => {
  ({ buildOutboundSessionContext } = await import("./session-context.js"));
});

beforeEach(() => {
  resolveSessionAgentIdMock.mockReset();
});

describe("buildOutboundSessionContext", () => {
  it("returns undefined when both session key and agent id are blank", () => {
    expect(
      buildOutboundSessionContext({
        cfg: {} as never,
        sessionKey: "  ",
        agentId: null,
      }),
    ).toBeUndefined();
    expect(resolveSessionAgentIdMock).not.toHaveBeenCalled();
  });

  it("returns only the explicit trimmed agent id when no session key is present", () => {
    expect(
      buildOutboundSessionContext({
        cfg: {} as never,
        sessionKey: "  ",
        agentId: "  explicit-agent  ",
      }),
    ).toEqual({
      agentId: "explicit-agent",
    });
    expect(resolveSessionAgentIdMock).not.toHaveBeenCalled();
  });

  it("derives the agent id from the trimmed session key when no explicit agent is given", () => {
    resolveSessionAgentIdMock.mockReturnValueOnce("derived-agent");

    expect(
      buildOutboundSessionContext({
        cfg: { agents: {} } as never,
        sessionKey: "  session:main:123  ",
      }),
    ).toEqual({
      key: "session:main:123",
      agentId: "derived-agent",
    });
    expect(resolveSessionAgentIdMock).toHaveBeenCalledWith({
      sessionKey: "session:main:123",
      config: { agents: {} },
    });
  });

  it("prefers an explicit trimmed agent id over the derived one", () => {
    resolveSessionAgentIdMock.mockReturnValueOnce("derived-agent");

    expect(
      buildOutboundSessionContext({
        cfg: {} as never,
        sessionKey: "session:main:123",
        agentId: "  explicit-agent  ",
      }),
    ).toEqual({
      key: "session:main:123",
      agentId: "explicit-agent",
    });
  });

  it("includes requester sender fields for media policy resolution", () => {
    expect(
      buildOutboundSessionContext({
        cfg: {} as never,
        sessionKey: "agent:main:forum:group:ops",
        requesterSenderId: "  id:forum:123  ",
        requesterSenderName: "  Alice  ",
        requesterSenderUsername: "  alice_u  ",
        requesterSenderE164: "  +15551234567  ",
      }),
    ).toMatchObject({
      key: "agent:main:forum:group:ops",
      requesterSenderId: "id:forum:123",
      requesterSenderName: "Alice",
      requesterSenderUsername: "alice_u",
      requesterSenderE164: "+15551234567",
    });
  });

  it("includes requester account and policy session key without replacing mirror key", () => {
    expect(
      buildOutboundSessionContext({
        cfg: {} as never,
        sessionKey: "agent:main:forum:dm:123456",
        policySessionKey: "agent:main:directchat:group:ops",
        requesterAccountId: "  work  ",
      }),
    ).toMatchObject({
      key: "agent:main:forum:dm:123456",
      policyKey: "agent:main:directchat:group:ops",
      requesterAccountId: "work",
    });
  });
});
