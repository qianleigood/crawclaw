import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MsgContext } from "../templating.js";

const targetContextMocks = vi.hoisted(() => ({
  resolveConversationBindingContextFromMessage: vi.fn(),
  resolveEffectiveResetTargetSessionKey: vi.fn(),
  resolveByConversation: vi.fn(),
  touch: vi.fn(),
}));

vi.mock("./conversation-binding-input.js", () => ({
  resolveConversationBindingContextFromMessage:
    targetContextMocks.resolveConversationBindingContextFromMessage,
}));

vi.mock("./acp-reset-target.js", () => ({
  resolveEffectiveResetTargetSessionKey: targetContextMocks.resolveEffectiveResetTargetSessionKey,
}));

vi.mock("../../infra/outbound/session-binding-service.js", () => ({
  getSessionBindingService: () => ({
    resolveByConversation: targetContextMocks.resolveByConversation,
    touch: targetContextMocks.touch,
  }),
}));

const { resolveSessionTargetContext } = await import("./session-target-context.js");

describe("resolveSessionTargetContext", () => {
  function buildCtx(overrides: Partial<MsgContext> = {}): MsgContext {
    return {
      Provider: "discord",
      Surface: "discord",
      SessionKey: "agent:main:discord:channel:raw",
      To: "channel:raw",
      ...overrides,
    } as MsgContext;
  }

  beforeEach(() => {
    targetContextMocks.resolveConversationBindingContextFromMessage.mockReset();
    targetContextMocks.resolveEffectiveResetTargetSessionKey.mockReset();
    targetContextMocks.resolveByConversation.mockReset();
    targetContextMocks.touch.mockReset();
    targetContextMocks.resolveConversationBindingContextFromMessage.mockReturnValue(null);
    targetContextMocks.resolveEffectiveResetTargetSessionKey.mockReturnValue(undefined);
    targetContextMocks.resolveByConversation.mockReturnValue(null);
  });

  it("uses the bound conversation session key as the target session and touches the binding", () => {
    targetContextMocks.resolveConversationBindingContextFromMessage.mockReturnValue({
      channel: "discord",
      accountId: "default",
      conversationId: "channel:bound",
    });
    targetContextMocks.resolveByConversation.mockReturnValue({
      bindingId: "binding-1",
      targetSessionKey: "agent:main:discord:channel:bound",
    });
    targetContextMocks.resolveEffectiveResetTargetSessionKey.mockReturnValue(
      "agent:codex:acp:binding:discord:default:feedface",
    );

    const result = resolveSessionTargetContext({
      cfg: {} as never,
      ctx: buildCtx({
        CommandSource: "native",
        CommandTargetSessionKey: "agent:main:discord:channel:slash",
      }),
    });

    expect(result.bindingContext).toEqual({
      channel: "discord",
      accountId: "default",
      conversationId: "channel:bound",
    });
    expect(result.targetSessionKey).toBe("agent:main:discord:channel:bound");
    expect(result.sessionCtxForState.SessionKey).toBe("agent:main:discord:channel:bound");
    expect(result.boundAcpSessionKey).toBe("agent:codex:acp:binding:discord:default:feedface");
    expect(result.shouldUseAcpInPlaceReset).toBe(true);
    expect(targetContextMocks.touch).toHaveBeenCalledWith("binding-1");
  });

  it("falls back to CommandTargetSessionKey for native commands when no conversation binding exists", () => {
    const result = resolveSessionTargetContext({
      cfg: {} as never,
      ctx: buildCtx({
        CommandSource: "native",
        CommandTargetSessionKey: "agent:main:discord:channel:slash",
      }),
    });

    expect(result.targetSessionKey).toBe("agent:main:discord:channel:slash");
    expect(result.sessionCtxForState.SessionKey).toBe("agent:main:discord:channel:slash");
    expect(result.shouldUseAcpInPlaceReset).toBe(false);
  });

  it("keeps the original session key when neither binding nor command target rewrites it", () => {
    const ctx = buildCtx();

    const result = resolveSessionTargetContext({
      cfg: {} as never,
      ctx,
    });

    expect(result.targetSessionKey).toBeUndefined();
    expect(result.sessionCtxForState).toBe(ctx);
    expect(result.boundAcpSessionKey).toBeUndefined();
    expect(result.shouldUseAcpInPlaceReset).toBe(false);
  });
});
