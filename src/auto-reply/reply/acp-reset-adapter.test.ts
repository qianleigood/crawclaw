import { beforeEach, describe, expect, it, vi } from "vitest";
import type { HandleCommandsParams } from "./commands-types.js";

const acpResetAdapterMocks = vi.hoisted(() => ({
  resetConfiguredBindingTargetInPlace: vi.fn(),
  resolveBoundAcpThreadSessionKey: vi.fn(),
}));

vi.mock("../../channels/plugins/binding-targets.js", () => ({
  resetConfiguredBindingTargetInPlace: acpResetAdapterMocks.resetConfiguredBindingTargetInPlace,
}));

vi.mock("./commands-acp/targets.js", () => ({
  resolveBoundAcpThreadSessionKey: acpResetAdapterMocks.resolveBoundAcpThreadSessionKey,
}));

const { handleAcpResetInPlace } = await import("./acp-reset-adapter.js");

function buildCommandParams(
  commandBodyNormalized: string,
  overrides: {
    ctx?: Record<string, unknown>;
    rootCtx?: Record<string, unknown>;
    sessionKey?: string;
    sessionEntry?: HandleCommandsParams["sessionEntry"];
    previousSessionEntry?: HandleCommandsParams["previousSessionEntry"];
    sessionStore?: Record<string, NonNullable<HandleCommandsParams["sessionEntry"]>>;
  } = {},
): HandleCommandsParams {
  const ctx = {
    Body: commandBodyNormalized,
    RawBody: commandBodyNormalized,
    CommandBody: commandBodyNormalized,
    BodyForCommands: commandBodyNormalized,
    BodyForAgent: commandBodyNormalized,
    BodyStripped: commandBodyNormalized,
    ...overrides.ctx,
  };
  const rootCtx = {
    Body: commandBodyNormalized,
    RawBody: commandBodyNormalized,
    CommandBody: commandBodyNormalized,
    BodyForCommands: commandBodyNormalized,
    BodyForAgent: commandBodyNormalized,
    BodyStripped: commandBodyNormalized,
    ...overrides.rootCtx,
  };
  return {
    ctx: ctx as HandleCommandsParams["ctx"],
    rootCtx: rootCtx as HandleCommandsParams["rootCtx"],
    cfg: {
      commands: { text: true },
      channels: { telegram: { allowFrom: ["*"] } },
    } as HandleCommandsParams["cfg"],
    command: {
      surface: "telegram",
      channel: "telegram",
      ownerList: [],
      senderIsOwner: false,
      isAuthorizedSender: true,
      senderId: "123",
      rawBodyNormalized: commandBodyNormalized,
      commandBodyNormalized,
      from: "telegram:123",
      to: "telegram:bot",
      resetHookTriggered: false,
    },
    directives: {} as HandleCommandsParams["directives"],
    elevated: {
      enabled: false,
      allowed: true,
      failures: [],
    },
    sessionKey: overrides.sessionKey ?? "agent:main:telegram:direct:123",
    sessionEntry: overrides.sessionEntry,
    previousSessionEntry: overrides.previousSessionEntry,
    sessionStore: overrides.sessionStore,
    workspaceDir: "/tmp/crawclaw-workspace",
    defaultGroupActivation: () => "mention",
    resolvedVerboseLevel: "off",
    resolvedReasoningLevel: "off",
    resolveDefaultThinkingLevel: async () => undefined,
    provider: "openai",
    model: "gpt-5.4-mini",
    contextTokens: 0,
    isGroup: false,
  } as HandleCommandsParams;
}

describe("handleAcpResetInPlace", () => {
  beforeEach(() => {
    acpResetAdapterMocks.resetConfiguredBindingTargetInPlace.mockReset();
    acpResetAdapterMocks.resolveBoundAcpThreadSessionKey.mockReset();
  });

  it("returns null when no bound ACP session exists", async () => {
    acpResetAdapterMocks.resolveBoundAcpThreadSessionKey.mockReturnValue(undefined);

    const emitResetCommandHooks = vi.fn(async () => {});
    const result = await handleAcpResetInPlace({
      commandAction: "new",
      commandParams: buildCommandParams("/new"),
      resetTail: "",
      emitResetCommandHooks,
    });

    expect(result).toBeNull();
    expect(acpResetAdapterMocks.resetConfiguredBindingTargetInPlace).not.toHaveBeenCalled();
    expect(emitResetCommandHooks).not.toHaveBeenCalled();
  });

  it("resets the bound ACP session in place and rewrites tail context", async () => {
    acpResetAdapterMocks.resolveBoundAcpThreadSessionKey.mockReturnValue("acp:session:123");
    acpResetAdapterMocks.resetConfiguredBindingTargetInPlace.mockResolvedValue({
      ok: true,
      skipped: false,
    });

    const sessionStore = {
      "acp:session:123": {
        sessionId: "prev-session",
        updatedAt: Date.now(),
      },
    } as Record<string, NonNullable<HandleCommandsParams["sessionEntry"]>>;
    const params = buildCommandParams("/new continue", {
      sessionKey: "agent:main:telegram:direct:123",
      sessionStore,
    });
    const emitResetCommandHooks = vi.fn(async () => {});

    const result = await handleAcpResetInPlace({
      commandAction: "new",
      commandParams: params,
      resetTail: "continue",
      emitResetCommandHooks,
    });

    expect(result).toEqual({ shouldContinue: false });
    expect(emitResetCommandHooks).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "new",
        sessionKey: "acp:session:123",
        sessionEntry: sessionStore["acp:session:123"],
        previousSessionEntry: sessionStore["acp:session:123"],
      }),
    );
    expect(params.ctx).toMatchObject({
      Body: "continue",
      RawBody: "continue",
      CommandBody: "continue",
      BodyForCommands: "continue",
      BodyForAgent: "continue",
      BodyStripped: "continue",
      AcpDispatchTailAfterReset: true,
    });
    expect(params.rootCtx).toMatchObject({
      Body: "continue",
      RawBody: "continue",
      CommandBody: "continue",
      BodyForCommands: "continue",
      BodyForAgent: "continue",
      BodyStripped: "continue",
      AcpDispatchTailAfterReset: true,
    });
  });

  it("maps skipped ACP resets to the unavailable reply", async () => {
    acpResetAdapterMocks.resolveBoundAcpThreadSessionKey.mockReturnValue("acp:session:123");
    acpResetAdapterMocks.resetConfiguredBindingTargetInPlace.mockResolvedValue({
      ok: false,
      skipped: true,
    });

    const result = await handleAcpResetInPlace({
      commandAction: "new",
      commandParams: buildCommandParams("/new"),
      resetTail: "",
      emitResetCommandHooks: vi.fn(async () => {}),
    });

    expect(result).toEqual({
      shouldContinue: false,
      reply: {
        text: "⚠️ ACP session reset unavailable for this bound conversation. Rebind with /acp bind or /acp spawn.",
      },
    });
  });
});
