import type { Component } from "@mariozechner/pi-tui";
import { afterEach, describe, expect, it, vi } from "vitest";
import { setActiveCliLocale } from "../cli/i18n/index.js";
import { createCommandHandlers } from "./tui-command-handlers.js";

type LoadHistoryMock = ReturnType<typeof vi.fn> & (() => Promise<void>);
type SetActivityStatusMock = ReturnType<typeof vi.fn> & ((text: string) => void);
type SetSessionMock = ReturnType<typeof vi.fn> & ((key: string) => Promise<void>);
type OpenOverlayMock = ReturnType<typeof vi.fn> & ((component: Component) => void);
type RecordErrorMock = ReturnType<typeof vi.fn> & ((message: string) => void);

function createHarness(params?: {
  sendChat?: ReturnType<typeof vi.fn>;
  patchSession?: ReturnType<typeof vi.fn>;
  resetSession?: ReturnType<typeof vi.fn>;
  setSession?: SetSessionMock;
  loadHistory?: LoadHistoryMock;
  refreshSessionInfo?: ReturnType<typeof vi.fn>;
  applySessionInfoFromPatch?: ReturnType<typeof vi.fn>;
  setActivityStatus?: SetActivityStatusMock;
  getStatus?: ReturnType<typeof vi.fn>;
  listSessions?: ReturnType<typeof vi.fn>;
  openOverlay?: OpenOverlayMock;
  recordError?: RecordErrorMock;
  isConnected?: boolean;
  activeChatRunId?: string | null;
}) {
  const sendChat = params?.sendChat ?? vi.fn().mockResolvedValue({ runId: "r1" });
  const patchSession = params?.patchSession ?? vi.fn().mockResolvedValue({});
  const resetSession = params?.resetSession ?? vi.fn().mockResolvedValue({ ok: true });
  const setSession = params?.setSession ?? (vi.fn().mockResolvedValue(undefined) as SetSessionMock);
  const addUser = vi.fn();
  const addSystem = vi.fn();
  const requestRender = vi.fn();
  const noteLocalRunId = vi.fn();
  const noteLocalBtwRunId = vi.fn();
  const loadHistory =
    params?.loadHistory ?? (vi.fn().mockResolvedValue(undefined) as LoadHistoryMock);
  const refreshSessionInfo = params?.refreshSessionInfo ?? vi.fn().mockResolvedValue(undefined);
  const applySessionInfoFromPatch = params?.applySessionInfoFromPatch ?? vi.fn();
  const setActivityStatus = params?.setActivityStatus ?? (vi.fn() as SetActivityStatusMock);
  const getStatus = params?.getStatus ?? vi.fn().mockResolvedValue("ok");
  const listSessions =
    params?.listSessions ??
    vi.fn().mockResolvedValue({
      sessions: [],
    });
  const openOverlay = params?.openOverlay ?? (vi.fn() as OpenOverlayMock);
  const recordError = params?.recordError ?? (vi.fn() as RecordErrorMock);
  const state = {
    currentSessionKey: "agent:main:main",
    currentAgentId: "main",
    activeChatRunId: params?.activeChatRunId ?? null,
    pendingOptimisticUserMessage: false,
    isConnected: params?.isConnected ?? true,
    deliverEnabled: false,
    sessionInfo: {},
    connectionStatus: "connected",
    activityStatus: "idle",
    lastError: null,
  };

  const { handleCommand, openSessionSelector } = createCommandHandlers({
    client: { sendChat, patchSession, resetSession, getStatus, listSessions } as never,
    chatLog: { addUser, addSystem } as never,
    tui: { requestRender } as never,
    opts: {},
    state: state as never,
    deliverDefault: false,
    openOverlay,
    closeOverlay: vi.fn(),
    refreshSessionInfo: refreshSessionInfo as never,
    loadHistory,
    setSession,
    refreshAgents: vi.fn(),
    abortActive: vi.fn(),
    setActivityStatus,
    formatSessionKey: vi.fn(),
    applySessionInfoFromPatch: applySessionInfoFromPatch as never,
    noteLocalRunId,
    noteLocalBtwRunId,
    forgetLocalRunId: vi.fn(),
    forgetLocalBtwRunId: vi.fn(),
    recordError,
    requestExit: vi.fn(),
  });

  return {
    handleCommand,
    openSessionSelector,
    sendChat,
    patchSession,
    resetSession,
    getStatus,
    listSessions,
    setSession,
    addUser,
    addSystem,
    requestRender,
    openOverlay,
    recordError,
    loadHistory,
    refreshSessionInfo,
    applySessionInfoFromPatch,
    setActivityStatus,
    noteLocalRunId,
    noteLocalBtwRunId,
    state,
  };
}

describe("tui command handlers", () => {
  afterEach(() => {
    setActiveCliLocale("en");
  });

  it("renders the sending indicator before chat.send resolves", async () => {
    let resolveSend: (value: { runId: string }) => void = () => {
      throw new Error("sendChat promise resolver was not initialized");
    };
    const sendPromise = new Promise<{ runId: string }>((resolve) => {
      resolveSend = (value) => resolve(value);
    });
    const sendChat = vi.fn(() => sendPromise);
    const setActivityStatus = vi.fn();

    const { handleCommand, requestRender } = createHarness({
      sendChat,
      setActivityStatus,
    });

    const pending = handleCommand("/context");
    await Promise.resolve();

    expect(setActivityStatus).toHaveBeenCalledWith("sending");
    const sendingOrder = setActivityStatus.mock.invocationCallOrder[0] ?? 0;
    const renderOrders = requestRender.mock.invocationCallOrder;
    expect(renderOrders.some((order) => order > sendingOrder)).toBe(true);

    resolveSend({ runId: "r1" });
    await pending;
    expect(setActivityStatus).toHaveBeenCalledWith("waiting");
  });

  it("forwards unknown slash commands to the gateway", async () => {
    const { handleCommand, sendChat, addUser, addSystem, requestRender } = createHarness();

    await handleCommand("/context");

    expect(addSystem).not.toHaveBeenCalled();
    expect(addUser).toHaveBeenCalledWith("/context");
    expect(sendChat).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionKey: "agent:main:main",
        message: "/context",
      }),
    );
    expect(requestRender).toHaveBeenCalled();
  });

  it("uses the current deliver toggle for sends", async () => {
    const { handleCommand, sendChat, state } = createHarness();
    state.deliverEnabled = true;

    await handleCommand("hello from tui");

    expect(sendChat).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "hello from tui",
        deliver: true,
      }),
    );
  });

  it("toggles delivery without forwarding /deliver to the gateway", async () => {
    const { handleCommand, sendChat, addSystem, state } = createHarness();

    await handleCommand("/deliver on");
    await handleCommand("/deliver status");
    await handleCommand("/deliver off");

    expect(sendChat).not.toHaveBeenCalled();
    expect(state.deliverEnabled).toBe(false);
    expect(addSystem).toHaveBeenCalledWith("deliver enabled");
    expect(addSystem).toHaveBeenCalledWith("deliver: on");
    expect(addSystem).toHaveBeenCalledWith("deliver disabled");
  });

  it("opens a status overlay for structured gateway status", async () => {
    const openOverlay = vi.fn();
    const { handleCommand, addSystem } = createHarness({
      openOverlay,
      getStatus: vi.fn().mockResolvedValue({
        runtimeVersion: "2026.4.22",
        linkChannel: { label: "Discord", linked: true, authAgeMs: 60_000 },
        queuedSystemEvents: ["queued wake"],
      }),
    });

    await handleCommand("/status");

    expect(addSystem).not.toHaveBeenCalledWith(expect.stringContaining("Gateway status"));
    expect(openOverlay).toHaveBeenCalledTimes(1);
    expect(openOverlay.mock.calls[0]?.[0].render(120).join("\n")).toContain("Gateway status");
    expect(openOverlay.mock.calls[0]?.[0].render(120).join("\n")).toContain("Discord: linked");
  });

  it("records status failures and falls back to chat log output", async () => {
    const recordError = vi.fn();
    const { handleCommand, addSystem, openOverlay } = createHarness({
      recordError,
      getStatus: vi.fn().mockRejectedValue(new Error("auth rejected")),
    });

    await handleCommand("/status");

    expect(openOverlay).not.toHaveBeenCalled();
    expect(addSystem).toHaveBeenCalledWith("status failed: Error: auth rejected");
    expect(recordError).toHaveBeenCalledWith("status failed: Error: auth rejected");
  });

  it("uses dense session picker descriptions", async () => {
    const openOverlay = vi.fn();
    const { openSessionSelector } = createHarness({
      openOverlay,
      listSessions: vi.fn().mockResolvedValue({
        sessions: [
          {
            key: "agent:main:main",
            derivedTitle: "Main work",
            updatedAt: Date.now(),
            modelProvider: "openai",
            model: "gpt-5.4",
            totalTokens: 12_345,
            contextTokens: 200_000,
            fastMode: true,
            verboseLevel: "on",
            sendPolicy: "deny",
            lastChannel: "discord",
            lastTo: "channel:C123",
            lastMessagePreview: "Latest assistant reply",
          },
        ],
      }),
    });

    await openSessionSelector();

    const rendered = openOverlay.mock.calls[0]?.[0].render(220).join("\n") ?? "";
    expect(rendered).toContain("Main work");
    expect(rendered).toContain("openai/gpt-5.4");
    expect(rendered).toContain("tokens 12k/200k (6%)");
    expect(rendered).toContain("fast");
    expect(rendered).toContain("send deny");
    expect(rendered).toContain("deliver discord:channel:C123");
  });

  it("defers local run binding until gateway events provide a real run id", async () => {
    const { handleCommand, noteLocalRunId, state } = createHarness();

    await handleCommand("/context");

    expect(noteLocalRunId).not.toHaveBeenCalled();
    expect(state.activeChatRunId).toBeNull();
    expect(state.pendingOptimisticUserMessage).toBe(true);
  });

  it("sends /btw without hijacking the active main run", async () => {
    const setActivityStatus = vi.fn();
    const { handleCommand, sendChat, addUser, noteLocalRunId, noteLocalBtwRunId, state } =
      createHarness({
        activeChatRunId: "run-main",
        setActivityStatus,
      });

    await handleCommand("/btw what changed?");

    expect(addUser).not.toHaveBeenCalled();
    expect(noteLocalRunId).not.toHaveBeenCalled();
    expect(noteLocalBtwRunId).toHaveBeenCalledTimes(1);
    expect(state.activeChatRunId).toBe("run-main");
    expect(setActivityStatus).not.toHaveBeenCalledWith("sending");
    expect(setActivityStatus).not.toHaveBeenCalledWith("waiting");
    expect(sendChat).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "/btw what changed?",
      }),
    );
  });

  it("creates a unique isolated session for /new", async () => {
    const setSessionMock = vi.fn().mockResolvedValue(undefined) as SetSessionMock;
    const { handleCommand, resetSession } = createHarness({
      setSession: setSessionMock,
    });

    await handleCommand("/new");

    // /new creates a unique session key (isolates TUI client) (#39217)
    expect(setSessionMock).toHaveBeenCalledTimes(1);
    expect(setSessionMock).toHaveBeenCalledWith(
      expect.stringMatching(/^tui-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/),
    );
    expect(resetSession).not.toHaveBeenCalled();
  });

  it("reports send failures and marks activity status as error", async () => {
    const setActivityStatus = vi.fn();
    const { handleCommand, addSystem, state } = createHarness({
      sendChat: vi.fn().mockRejectedValue(new Error("gateway down")),
      setActivityStatus,
    });

    await handleCommand("/context");

    expect(addSystem).toHaveBeenCalledWith("send failed: Error: gateway down");
    expect(setActivityStatus).toHaveBeenLastCalledWith("error");
    expect(state.pendingOptimisticUserMessage).toBe(false);
  });

  it("sanitizes control sequences in /new failures", async () => {
    const setSession = vi.fn().mockRejectedValue(new Error("\u001b[31mboom\u001b[0m"));
    const { handleCommand, addSystem } = createHarness({
      setSession,
    });

    await handleCommand("/new");

    expect(addSystem).toHaveBeenNthCalledWith(1, "new session failed: Error: boom");
  });

  it("reports disconnected status and skips gateway send when offline", async () => {
    const { handleCommand, sendChat, addUser, addSystem, setActivityStatus } = createHarness({
      isConnected: false,
    });

    await handleCommand("/context");

    expect(sendChat).not.toHaveBeenCalled();
    expect(addUser).not.toHaveBeenCalled();
    expect(addSystem).toHaveBeenCalledWith("not connected to gateway - message not sent");
    expect(setActivityStatus).toHaveBeenLastCalledWith("disconnected");
  });

  it("rejects invalid /activation values before patching the session", async () => {
    const { handleCommand, patchSession, addSystem } = createHarness();

    await handleCommand("/activation sometimes");

    expect(patchSession).not.toHaveBeenCalled();
    expect(addSystem).toHaveBeenCalledWith("usage: /activation <mention|always>");
  });

  it("localizes command usage and patch failures in zh-CN", async () => {
    setActiveCliLocale("zh-CN");
    const { handleCommand, patchSession, addSystem } = createHarness({
      patchSession: vi.fn().mockRejectedValue(new Error("bad model")),
    });

    await handleCommand("/verbose");
    await handleCommand("/fast maybe");
    await handleCommand("/think high");

    expect(addSystem).toHaveBeenCalledWith("用法：/verbose <on|off>");
    expect(addSystem).toHaveBeenCalledWith("用法：/fast <status|on|off>");
    expect(addSystem).toHaveBeenCalledWith("思考设置失败：Error: bad model");
    expect(patchSession).toHaveBeenCalledWith({
      key: "agent:main:main",
      thinkingLevel: "high",
    });
  });

  it("patches the session for valid /activation values", async () => {
    const refreshSessionInfo = vi.fn().mockResolvedValue(undefined);
    const applySessionInfoFromPatch = vi.fn();
    const patchSession = vi.fn().mockResolvedValue({ groupActivation: "always" });
    const { handleCommand, addSystem } = createHarness({
      patchSession,
      refreshSessionInfo,
      applySessionInfoFromPatch,
    });

    await handleCommand("/activation always");

    expect(patchSession).toHaveBeenCalledWith({
      key: "agent:main:main",
      groupActivation: "always",
    });
    expect(addSystem).toHaveBeenCalledWith("activation set to always");
    expect(applySessionInfoFromPatch).toHaveBeenCalledWith({ groupActivation: "always" });
    expect(refreshSessionInfo).toHaveBeenCalledTimes(1);
  });
});
