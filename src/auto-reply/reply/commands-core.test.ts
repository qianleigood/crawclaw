import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HookRunner } from "../../plugins/hooks.js";
import type { HandleCommandsParams } from "./commands-types.js";

const fsMocks = vi.hoisted(() => ({
  readFile: vi.fn(),
  readdir: vi.fn(),
}));

const hookRunnerMocks = vi.hoisted(() => ({
  hasHooks: vi.fn<HookRunner["hasHooks"]>(),
  runBeforeReset: vi.fn<HookRunner["runBeforeReset"]>(),
}));

const bindingTargetMocks = vi.hoisted(() => ({
  resetConfiguredBindingTargetInPlace: vi.fn(),
}));

const acpTargetMocks = vi.hoisted(() => ({
  resolveBoundAcpThreadSessionKey: vi.fn(),
}));

const commandHandlersRuntimeMocks = vi.hoisted(() => ({
  loadCommandHandlers: vi.fn(() => []),
}));

vi.mock("node:fs/promises", () => ({
  default: {
    readFile: fsMocks.readFile,
    readdir: fsMocks.readdir,
  },
}));

vi.mock("../../channels/plugins/binding-targets.js", () => ({
  resetConfiguredBindingTargetInPlace: bindingTargetMocks.resetConfiguredBindingTargetInPlace,
}));

vi.mock("../../plugins/hook-runner-global.js", () => ({
  getGlobalHookRunner: () =>
    ({
      hasHooks: hookRunnerMocks.hasHooks,
      runBeforeReset: hookRunnerMocks.runBeforeReset,
    }) as unknown as HookRunner,
}));

vi.mock("./commands-acp/targets.js", () => ({
  resolveBoundAcpThreadSessionKey: acpTargetMocks.resolveBoundAcpThreadSessionKey,
}));

vi.mock("./commands-handlers.runtime.js", () => ({
  loadCommandHandlers: commandHandlersRuntimeMocks.loadCommandHandlers,
}));

const { __resetCommandHandlersForTests, emitResetCommandHooks, handleCommands } =
  await import("./commands-core.js");

describe("emitResetCommandHooks", () => {
  async function runBeforeResetContext(sessionKey?: string) {
    const command = {
      surface: "discord",
      senderId: "rai",
      channel: "discord",
      from: "discord:rai",
      to: "discord:bot",
      resetHookTriggered: false,
    } as HandleCommandsParams["command"];

    await emitResetCommandHooks({
      action: "new",
      ctx: {} as HandleCommandsParams["ctx"],
      cfg: {} as HandleCommandsParams["cfg"],
      command,
      sessionKey,
      previousSessionEntry: {
        sessionId: "prev-session",
      } as HandleCommandsParams["previousSessionEntry"],
      workspaceDir: "/tmp/crawclaw-workspace",
    });

    await vi.waitFor(() => expect(hookRunnerMocks.runBeforeReset).toHaveBeenCalledTimes(1));
    const [, ctx] = hookRunnerMocks.runBeforeReset.mock.calls[0] ?? [];
    return ctx;
  }

  beforeEach(() => {
    __resetCommandHandlersForTests();
    fsMocks.readFile.mockReset();
    fsMocks.readdir.mockReset();
    hookRunnerMocks.hasHooks.mockReset();
    hookRunnerMocks.runBeforeReset.mockReset();
    bindingTargetMocks.resetConfiguredBindingTargetInPlace.mockReset();
    acpTargetMocks.resolveBoundAcpThreadSessionKey.mockReset();
    commandHandlersRuntimeMocks.loadCommandHandlers.mockReset();
    hookRunnerMocks.hasHooks.mockImplementation((hookName) => hookName === "before_reset");
    hookRunnerMocks.runBeforeReset.mockResolvedValue(undefined);
    commandHandlersRuntimeMocks.loadCommandHandlers.mockReturnValue([]);
    fsMocks.readFile.mockResolvedValue("");
    fsMocks.readdir.mockResolvedValue([]);
  });

  afterEach(() => {
    __resetCommandHandlersForTests();
    vi.restoreAllMocks();
  });

  it("passes the bound agent id to before_reset hooks for multi-agent session keys", async () => {
    const ctx = await runBeforeResetContext("agent:navi:main");
    expect(ctx).toMatchObject({
      agentId: "navi",
      sessionKey: "agent:navi:main",
      sessionId: "prev-session",
      workspaceDir: "/tmp/crawclaw-workspace",
    });
  });

  it("falls back to main when the reset hook has no session key", async () => {
    const ctx = await runBeforeResetContext(undefined);
    expect(ctx).toMatchObject({
      agentId: "main",
      sessionKey: undefined,
      sessionId: "prev-session",
      workspaceDir: "/tmp/crawclaw-workspace",
    });
  });

  it("keeps the main-agent path on the main agent workspace", async () => {
    const ctx = await runBeforeResetContext("agent:main:main");
    expect(ctx).toMatchObject({
      agentId: "main",
      sessionKey: "agent:main:main",
      sessionId: "prev-session",
      workspaceDir: "/tmp/crawclaw-workspace",
    });
  });

  it("recovers the archived transcript when the original reset transcript path is gone", async () => {
    fsMocks.readFile.mockRejectedValueOnce(Object.assign(new Error("ENOENT"), { code: "ENOENT" }));
    fsMocks.readdir.mockResolvedValueOnce(["prev-session.jsonl.reset.2026-02-16T22-26-33.000Z"]);
    fsMocks.readFile.mockResolvedValueOnce(
      `${JSON.stringify({
        type: "message",
        id: "m1",
        message: { role: "user", content: "Recovered from archive" },
      })}\n`,
    );
    const command = {
      surface: "telegram",
      senderId: "vac",
      channel: "telegram",
      from: "telegram:vac",
      to: "telegram:bot",
      resetHookTriggered: false,
    } as HandleCommandsParams["command"];

    await emitResetCommandHooks({
      action: "new",
      ctx: {} as HandleCommandsParams["ctx"],
      cfg: {} as HandleCommandsParams["cfg"],
      command,
      sessionKey: "agent:main:telegram:group:-1003826723328:topic:8428",
      previousSessionEntry: {
        sessionId: "prev-session",
        sessionFile: "/tmp/prev-session.jsonl",
      } as HandleCommandsParams["previousSessionEntry"],
      workspaceDir: "/tmp/crawclaw-workspace",
    });

    await vi.waitFor(() => expect(hookRunnerMocks.runBeforeReset).toHaveBeenCalledTimes(1));
    expect(hookRunnerMocks.runBeforeReset).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionFile: "/tmp/prev-session.jsonl.reset.2026-02-16T22-26-33.000Z",
        messages: [{ role: "user", content: "Recovered from archive" }],
        reason: "new",
      }),
      expect.objectContaining({
        sessionId: "prev-session",
      }),
    );
  });
});

describe("handleCommands ACP reset-in-place", () => {
  function buildHandleCommandsParams(
    commandBodyNormalized: string,
    overrides: {
      command?: Partial<HandleCommandsParams["command"]>;
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
        ...overrides.command,
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

  function expectTailContext(ctx: Record<string, unknown>, expectedTail: string) {
    expect(ctx).toMatchObject({
      Body: expectedTail,
      RawBody: expectedTail,
      CommandBody: expectedTail,
      BodyForCommands: expectedTail,
      BodyForAgent: expectedTail,
      BodyStripped: expectedTail,
      AcpDispatchTailAfterReset: true,
    });
  }

  it("localizes handler reply text through the centralized command exit path", async () => {
    commandHandlersRuntimeMocks.loadCommandHandlers.mockReturnValue([
      async () => ({
        shouldContinue: false,
        reply: { text: "Usage: /tasks" },
      }),
    ] as never);

    const params = buildHandleCommandsParams("/tasks");
    params.cfg = {
      ...(params.cfg as object),
      cli: { language: "zh-CN" },
    } as HandleCommandsParams["cfg"];

    const result = await handleCommands(params);

    expect(result).toEqual({
      shouldContinue: false,
      reply: { text: "用法：/tasks" },
    });
  });

  it("resets the bound ACP session in place and returns the success reply for bare /new", async () => {
    hookRunnerMocks.hasHooks.mockReturnValue(false);
    acpTargetMocks.resolveBoundAcpThreadSessionKey.mockReturnValue("acp:bound-thread");
    bindingTargetMocks.resetConfiguredBindingTargetInPlace.mockResolvedValue({
      ok: true,
      skipped: false,
    });

    const params = buildHandleCommandsParams("/new");
    const result = await handleCommands(params);

    expect(bindingTargetMocks.resetConfiguredBindingTargetInPlace).toHaveBeenCalledWith({
      cfg: params.cfg,
      sessionKey: "acp:bound-thread",
      reason: "new",
    });
    expect(result).toEqual({
      shouldContinue: false,
      reply: { text: "✅ ACP session reset in place." },
    });
    expect(params.command.resetHookTriggered).toBe(true);
  });

  it("replaces ctx and rootCtx with the /new tail after a successful ACP reset-in-place", async () => {
    hookRunnerMocks.hasHooks.mockReturnValue(false);
    acpTargetMocks.resolveBoundAcpThreadSessionKey.mockReturnValue("acp:bound-thread");
    bindingTargetMocks.resetConfiguredBindingTargetInPlace.mockResolvedValue({
      ok: true,
      skipped: false,
    });

    const params = buildHandleCommandsParams("/new summarize the latest diff");
    const result = await handleCommands(params);

    expect(result).toEqual({ shouldContinue: false });
    expectTailContext(
      params.ctx as unknown as Record<string, unknown>,
      "summarize the latest diff",
    );
    expectTailContext(
      params.rootCtx as unknown as Record<string, unknown>,
      "summarize the latest diff",
    );
  });
});
