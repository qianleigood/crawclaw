import {
  CombinedAutocompleteProvider,
  Container,
  Key,
  matchesKey,
  ProcessTerminal,
  Text,
  TUI,
} from "@mariozechner/pi-tui";
import { resolveAgentIdByWorkspacePath, resolveDefaultAgentId } from "../agents/agent-scope.js";
import { resolveCliLocale, setActiveCliLocale } from "../cli/i18n/index.js";
import { translateTuiText } from "../cli/i18n/tui.js";
import type { CliLocale } from "../cli/i18n/types.js";
import { loadConfig, type CrawClawConfig } from "../config/config.js";
import {
  buildAgentMainSessionKey,
  normalizeAgentId,
  normalizeMainKey,
  parseAgentSessionKey,
} from "../routing/session-key.js";
import { getSlashCommands } from "./commands.js";
import { ChatLog } from "./components/chat-log.js";
import { CustomEditor } from "./components/custom-editor.js";
import { ToolOverlayComponent } from "./components/tool-overlay.js";
import { GatewayChatClient } from "./gateway-chat.js";
import { editorTheme, theme } from "./theme/theme.js";
import { createCommandHandlers } from "./tui-command-handlers.js";
import { createEventHandlers } from "./tui-event-handlers.js";
import { formatTuiFooter } from "./tui-footer.js";
import { sanitizeRenderableText } from "./tui-formatters.js";
import { registerTuiKeybindings } from "./tui-keybindings.js";
import { createLocalShellRunner } from "./tui-local-shell.js";
import { createOverlayHandlers } from "./tui-overlays.js";
import { createSessionActions } from "./tui-session-actions.js";
import { createTuiStatusLineController } from "./tui-status-line.js";
import {
  createEditorSubmitHandler,
  createSubmitBurstCoalescer,
  shouldEnableWindowsGitBashPasteFallback,
} from "./tui-submit.js";
import type {
  AgentSummary,
  SessionInfo,
  SessionScope,
  TuiOptions,
  TuiStateAccess,
} from "./tui-types.js";

export { resolveFinalAssistantText } from "./tui-formatters.js";
export type { TuiOptions } from "./tui-types.js";
export {
  createEditorSubmitHandler,
  createSubmitBurstCoalescer,
  shouldEnableWindowsGitBashPasteFallback,
} from "./tui-submit.js";

export function resolveTuiSessionKey(params: {
  raw?: string;
  sessionScope: SessionScope;
  currentAgentId: string;
  sessionMainKey: string;
}) {
  const trimmed = (params.raw ?? "").trim();
  if (!trimmed) {
    if (params.sessionScope === "global") {
      return "global";
    }
    return buildAgentMainSessionKey({
      agentId: params.currentAgentId,
      mainKey: params.sessionMainKey,
    });
  }
  if (trimmed === "global" || trimmed === "unknown") {
    return trimmed;
  }
  if (trimmed.startsWith("agent:")) {
    return trimmed.toLowerCase();
  }
  return `agent:${params.currentAgentId}:${trimmed.toLowerCase()}`;
}

export function resolveInitialTuiAgentId(params: {
  cfg: CrawClawConfig;
  fallbackAgentId: string;
  initialSessionInput?: string;
  cwd?: string;
}) {
  const parsed = parseAgentSessionKey((params.initialSessionInput ?? "").trim());
  if (parsed?.agentId) {
    return normalizeAgentId(parsed.agentId);
  }

  const inferredFromWorkspace = resolveAgentIdByWorkspacePath(
    params.cfg,
    params.cwd ?? process.cwd(),
  );
  if (inferredFromWorkspace) {
    return inferredFromWorkspace;
  }

  return normalizeAgentId(params.fallbackAgentId);
}

export function applyTuiLocaleFromConfig(params: {
  cfg: CrawClawConfig;
  argv?: readonly string[];
  envLanguage?: string;
}): CliLocale {
  const locale = resolveCliLocale({
    argv: params.argv ?? process.argv,
    config: params.cfg.cli?.language,
    env: params.envLanguage ?? process.env.CRAWCLAW_LANG,
  });
  setActiveCliLocale(locale);
  return locale;
}

export function resolveGatewayDisconnectState(reason?: string): {
  connectionStatus: string;
  activityStatus: string;
  pairingHint?: string;
} {
  const reasonLabel = reason?.trim() ? reason.trim() : "closed";
  if (/pairing required/i.test(reasonLabel)) {
    return {
      connectionStatus: translateTuiText("tui.message.gatewayDisconnected", {
        reason: reasonLabel,
      }),
      activityStatus: translateTuiText("tui.pairing.activity"),
      pairingHint: translateTuiText("tui.pairing.hint"),
    };
  }
  return {
    connectionStatus: translateTuiText("tui.message.gatewayDisconnected", {
      reason: reasonLabel,
    }),
    activityStatus: "idle",
  };
}

export function createBackspaceDeduper(params?: { dedupeWindowMs?: number; now?: () => number }) {
  const dedupeWindowMs = Math.max(0, Math.floor(params?.dedupeWindowMs ?? 8));
  const now = params?.now ?? (() => Date.now());
  let lastBackspaceAt = -1;

  return (data: string): string => {
    if (!matchesKey(data, Key.backspace)) {
      return data;
    }
    const ts = now();
    if (lastBackspaceAt >= 0 && ts - lastBackspaceAt <= dedupeWindowMs) {
      return "";
    }
    lastBackspaceAt = ts;
    return data;
  };
}

export function isIgnorableTuiStopError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }
  const err = error as { code?: unknown; syscall?: unknown; message?: unknown };
  const code = typeof err.code === "string" ? err.code : "";
  const syscall = typeof err.syscall === "string" ? err.syscall : "";
  const message = typeof err.message === "string" ? err.message : "";
  if (code === "EBADF" && syscall === "setRawMode") {
    return true;
  }
  return /setRawMode/i.test(message) && /EBADF/i.test(message);
}

export function stopTuiSafely(stop: () => void): void {
  try {
    stop();
  } catch (error) {
    if (!isIgnorableTuiStopError(error)) {
      throw error;
    }
  }
}

type CtrlCAction = "clear" | "warn" | "exit";

export function resolveCtrlCAction(params: {
  hasInput: boolean;
  now: number;
  lastCtrlCAt: number;
  exitWindowMs?: number;
}): { action: CtrlCAction; nextLastCtrlCAt: number } {
  const exitWindowMs = Math.max(1, Math.floor(params.exitWindowMs ?? 1000));
  if (params.hasInput) {
    return {
      action: "clear",
      nextLastCtrlCAt: params.now,
    };
  }
  if (params.now - params.lastCtrlCAt <= exitWindowMs) {
    return {
      action: "exit",
      nextLastCtrlCAt: params.lastCtrlCAt,
    };
  }
  return {
    action: "warn",
    nextLastCtrlCAt: params.now,
  };
}

export async function runTui(opts: TuiOptions) {
  const config = loadConfig();
  applyTuiLocaleFromConfig({ cfg: config });
  const initialSessionInput = (opts.session ?? "").trim();
  let sessionScope: SessionScope = (config.session?.scope ?? "per-sender") as SessionScope;
  let sessionMainKey = normalizeMainKey(config.session?.mainKey);
  let agentDefaultId = resolveDefaultAgentId(config);
  let currentAgentId = resolveInitialTuiAgentId({
    cfg: config,
    fallbackAgentId: agentDefaultId,
    initialSessionInput,
    cwd: process.cwd(),
  });
  let agents: AgentSummary[] = [];
  const agentNames = new Map<string, string>();
  let currentSessionKey = "";
  let initialSessionApplied = false;
  let currentSessionId: string | null = null;
  let activeChatRunId: string | null = null;
  let pendingOptimisticUserMessage = false;
  let historyLoaded = false;
  let isConnected = false;
  let wasDisconnected = false;
  let toolsExpanded = false;
  let showThinking = false;
  let pairingHintShown = false;
  let deliverEnabled = opts.deliver ?? false;
  const localRunIds = new Set<string>();
  const localBtwRunIds = new Set<string>();

  const deliverDefault = deliverEnabled;
  const autoMessage = opts.message?.trim();
  let autoMessageSent = false;
  let sessionInfo: SessionInfo = {};
  let lastCtrlCAt = 0;
  let exitRequested = false;
  let activityStatus = "idle";
  let connectionStatus = "connecting";
  let lastError: string | null = null;
  let statusTimeout: NodeJS.Timeout | null = null;

  const state: TuiStateAccess = {
    get agentDefaultId() {
      return agentDefaultId;
    },
    set agentDefaultId(value) {
      agentDefaultId = value;
    },
    get sessionMainKey() {
      return sessionMainKey;
    },
    set sessionMainKey(value) {
      sessionMainKey = value;
    },
    get sessionScope() {
      return sessionScope;
    },
    set sessionScope(value) {
      sessionScope = value;
    },
    get agents() {
      return agents;
    },
    set agents(value) {
      agents = value;
    },
    get currentAgentId() {
      return currentAgentId;
    },
    set currentAgentId(value) {
      currentAgentId = value;
    },
    get currentSessionKey() {
      return currentSessionKey;
    },
    set currentSessionKey(value) {
      currentSessionKey = value;
    },
    get currentSessionId() {
      return currentSessionId;
    },
    set currentSessionId(value) {
      currentSessionId = value;
    },
    get activeChatRunId() {
      return activeChatRunId;
    },
    set activeChatRunId(value) {
      activeChatRunId = value;
    },
    get pendingOptimisticUserMessage() {
      return pendingOptimisticUserMessage;
    },
    set pendingOptimisticUserMessage(value) {
      pendingOptimisticUserMessage = value;
    },
    get historyLoaded() {
      return historyLoaded;
    },
    set historyLoaded(value) {
      historyLoaded = value;
    },
    get sessionInfo() {
      return sessionInfo;
    },
    set sessionInfo(value) {
      sessionInfo = value;
    },
    get initialSessionApplied() {
      return initialSessionApplied;
    },
    set initialSessionApplied(value) {
      initialSessionApplied = value;
    },
    get isConnected() {
      return isConnected;
    },
    set isConnected(value) {
      isConnected = value;
    },
    get autoMessageSent() {
      return autoMessageSent;
    },
    set autoMessageSent(value) {
      autoMessageSent = value;
    },
    get deliverEnabled() {
      return deliverEnabled;
    },
    set deliverEnabled(value) {
      deliverEnabled = value;
    },
    get toolsExpanded() {
      return toolsExpanded;
    },
    set toolsExpanded(value) {
      toolsExpanded = value;
    },
    get showThinking() {
      return showThinking;
    },
    set showThinking(value) {
      showThinking = value;
    },
    get connectionStatus() {
      return connectionStatus;
    },
    set connectionStatus(value) {
      connectionStatus = value;
    },
    get activityStatus() {
      return activityStatus;
    },
    set activityStatus(value) {
      activityStatus = value;
    },
    get lastError() {
      return lastError;
    },
    set lastError(value) {
      lastError = value;
    },
    get statusTimeout() {
      return statusTimeout;
    },
    set statusTimeout(value) {
      statusTimeout = value;
    },
    get lastCtrlCAt() {
      return lastCtrlCAt;
    },
    set lastCtrlCAt(value) {
      lastCtrlCAt = value;
    },
  };

  const noteLocalRunId = (runId: string) => {
    if (!runId) {
      return;
    }
    localRunIds.add(runId);
    if (localRunIds.size > 200) {
      const [first] = localRunIds;
      if (first) {
        localRunIds.delete(first);
      }
    }
  };

  const forgetLocalRunId = (runId: string) => {
    localRunIds.delete(runId);
  };

  const isLocalRunId = (runId: string) => localRunIds.has(runId);

  const clearLocalRunIds = () => {
    localRunIds.clear();
  };

  const noteLocalBtwRunId = (runId: string) => {
    if (!runId) {
      return;
    }
    localBtwRunIds.add(runId);
    if (localBtwRunIds.size > 200) {
      const [first] = localBtwRunIds;
      if (first) {
        localBtwRunIds.delete(first);
      }
    }
  };

  const forgetLocalBtwRunId = (runId: string) => {
    localBtwRunIds.delete(runId);
  };

  const isLocalBtwRunId = (runId: string) => localBtwRunIds.has(runId);

  const clearLocalBtwRunIds = () => {
    localBtwRunIds.clear();
  };

  const client = await GatewayChatClient.connect({
    url: opts.url,
    token: opts.token,
    password: opts.password,
  });

  const tui = new TUI(new ProcessTerminal());
  const dedupeBackspace = createBackspaceDeduper();
  tui.addInputListener((data) => {
    const next = dedupeBackspace(data);
    if (next.length === 0) {
      return { consume: true };
    }
    return { data: next };
  });
  const header = new Text("", 1, 0);
  const statusContainer = new Container();
  const footer = new Text("", 1, 0);
  const chatLog = new ChatLog();
  const editor = new CustomEditor(tui, editorTheme);
  const root = new Container();
  root.addChild(header);
  root.addChild(chatLog);
  root.addChild(statusContainer);
  root.addChild(footer);
  root.addChild(editor);

  const updateAutocompleteProvider = () => {
    editor.setAutocompleteProvider(
      new CombinedAutocompleteProvider(
        getSlashCommands({
          cfg: config,
          provider: sessionInfo.modelProvider,
          model: sessionInfo.model,
        }),
        process.cwd(),
      ),
    );
  };

  tui.addChild(root);
  tui.setFocus(editor);

  const formatSessionKey = (key: string) => {
    if (key === "global" || key === "unknown") {
      return key;
    }
    const parsed = parseAgentSessionKey(key);
    return parsed?.rest ?? key;
  };

  const formatAgentLabel = (id: string) => {
    const name = agentNames.get(id);
    return name ? `${id} (${name})` : id;
  };

  const resolveSessionKey = (raw?: string) => {
    return resolveTuiSessionKey({
      raw,
      sessionScope,
      currentAgentId,
      sessionMainKey,
    });
  };

  currentSessionKey = resolveSessionKey(initialSessionInput);

  const updateHeader = () => {
    const sessionLabel = formatSessionKey(currentSessionKey);
    const agentLabel = formatAgentLabel(currentAgentId);
    header.setText(
      theme.header(
        translateTuiText("tui.header.title", {
          url: client.connection.url,
          agent: agentLabel,
          session: sessionLabel,
        }),
      ),
    );
  };

  const statusLine = createTuiStatusLineController({
    tui,
    statusContainer,
    getConnectionStatus: () => connectionStatus,
    setConnectionStatusValue: (value) => {
      connectionStatus = value;
    },
    getActivityStatus: () => activityStatus,
    setActivityStatusValue: (value) => {
      activityStatus = value;
    },
    getIsConnected: () => isConnected,
    getStatusTimeout: () => statusTimeout,
    setStatusTimeout: (value) => {
      statusTimeout = value;
    },
  });

  const setConnectionStatus = statusLine.setConnectionStatus;
  const setActivityStatus = statusLine.setActivityStatus;

  const recordError = (message: string) => {
    lastError = sanitizeRenderableText(message);
  };

  const updateFooter = () => {
    footer.setText(
      theme.dim(
        formatTuiFooter({
          currentAgentId,
          currentSessionKey,
          sessionInfo,
          deliverEnabled,
          formatAgentLabel,
          formatSessionKey,
        }),
      ),
    );
  };

  const { openOverlay, closeOverlay } = createOverlayHandlers(tui, editor);
  const btw = {
    showResult: (params: { question: string; text: string; isError?: boolean }) => {
      chatLog.showBtw(params);
    },
    clear: () => {
      chatLog.dismissBtw();
    },
  };

  const initialSessionAgentId = (() => {
    if (!initialSessionInput) {
      return null;
    }
    const parsed = parseAgentSessionKey(initialSessionInput);
    return parsed ? normalizeAgentId(parsed.agentId) : null;
  })();

  const sessionActions = createSessionActions({
    client,
    chatLog,
    btw,
    tui,
    opts,
    state,
    agentNames,
    initialSessionInput,
    initialSessionAgentId,
    resolveSessionKey,
    updateHeader,
    updateFooter,
    updateAutocompleteProvider,
    setActivityStatus,
    clearLocalRunIds,
    recordError,
  });
  const {
    refreshAgents,
    refreshSessionInfo,
    applySessionInfoFromPatch,
    loadHistory,
    setSession,
    abortActive,
  } = sessionActions;

  const { handleChatEvent, handleAgentEvent, handleBtwEvent } = createEventHandlers({
    chatLog,
    btw,
    tui,
    state,
    setActivityStatus,
    refreshSessionInfo,
    loadHistory,
    noteLocalRunId,
    isLocalRunId,
    forgetLocalRunId,
    clearLocalRunIds,
    isLocalBtwRunId,
    forgetLocalBtwRunId,
    clearLocalBtwRunIds,
  });

  const requestExit = () => {
    if (exitRequested) {
      return;
    }
    exitRequested = true;
    client.stop();
    stopTuiSafely(() => tui.stop());
    process.exit(0);
  };

  const { handleCommand, sendMessage, openModelSelector, openAgentSelector, openSessionSelector } =
    createCommandHandlers({
      client,
      chatLog,
      tui,
      opts,
      state,
      deliverDefault,
      openOverlay,
      closeOverlay,
      refreshSessionInfo,
      applySessionInfoFromPatch,
      loadHistory,
      setSession,
      refreshAgents,
      abortActive,
      setActivityStatus,
      formatSessionKey,
      noteLocalRunId,
      noteLocalBtwRunId,
      forgetLocalRunId,
      forgetLocalBtwRunId,
      recordError,
      requestExit,
    });

  const { runLocalShellLine } = createLocalShellRunner({
    chatLog,
    tui,
    openOverlay,
    closeOverlay,
  });
  updateAutocompleteProvider();
  const submitHandler = createEditorSubmitHandler({
    editor,
    handleCommand,
    sendMessage,
    handleBangLine: runLocalShellLine,
  });
  editor.onSubmit = createSubmitBurstCoalescer({
    submit: submitHandler,
    enabled: shouldEnableWindowsGitBashPasteFallback(),
  });

  editor.onEscape = () => {
    if (chatLog.hasVisibleBtw()) {
      chatLog.dismissBtw();
      tui.requestRender();
      return;
    }
    void abortActive();
  };
  const handleCtrlC = () => {
    const now = Date.now();
    const decision = resolveCtrlCAction({
      hasInput: editor.getText().trim().length > 0,
      now,
      lastCtrlCAt,
    });
    lastCtrlCAt = decision.nextLastCtrlCAt;
    if (decision.action === "clear") {
      editor.setText("");
      setActivityStatus(translateTuiText("tui.message.clearedInput"));
      tui.requestRender();
      return;
    }
    if (decision.action === "exit") {
      requestExit();
      return;
    }
    setActivityStatus(translateTuiText("tui.message.pressCtrlCAgain"));
    tui.requestRender();
  };

  const openToolOverlay = () => {
    if (!chatLog.hasTools()) {
      setActivityStatus(translateTuiText("tui.message.noToolOutputYet"));
      tui.requestRender();
      return;
    }
    const overlay = new ToolOverlayComponent({
      getTools: () => chatLog.listTools(),
      onToggleTool: (toolCallId) => {
        const expanded = chatLog.toggleToolExpanded(toolCallId);
        const tool = chatLog.listTools().find((entry) => entry.id === toolCallId);
        setActivityStatus(
          translateTuiText("tui.message.toolToggled", {
            tool: tool?.toolName ?? "tool",
            value: expanded
              ? translateTuiText("tui.common.expanded")
              : translateTuiText("tui.common.collapsed"),
          }),
        );
        tui.requestRender();
      },
      onToggleAll: () => {
        toolsExpanded = chatLog.toggleAllToolsExpanded();
        setActivityStatus(
          translateTuiText("tui.message.toolsToggled", {
            value: toolsExpanded
              ? translateTuiText("tui.common.expanded")
              : translateTuiText("tui.common.collapsed"),
          }),
        );
        tui.requestRender();
      },
      onClose: closeOverlay,
    });
    openOverlay(overlay);
    tui.requestRender();
  };

  registerTuiKeybindings({
    editor,
    handleCtrlC,
    requestExit,
    openToolOverlay,
    openModelSelector,
    openAgentSelector,
    openSessionSelector,
    toggleThinking: () => {
      showThinking = !showThinking;
      void loadHistory();
    },
  });

  tui.addInputListener((data) => {
    if (!chatLog.hasVisibleBtw()) {
      return undefined;
    }
    if (editor.getText().length > 0) {
      return undefined;
    }
    if (matchesKey(data, "enter")) {
      chatLog.dismissBtw();
      tui.requestRender();
      return { consume: true };
    }
    return undefined;
  });

  client.onEvent = (evt) => {
    if (evt.event === "chat") {
      handleChatEvent(evt.payload);
    }
    if (evt.event === "chat.side_result") {
      handleBtwEvent(evt.payload);
    }
    if (evt.event === "agent") {
      handleAgentEvent(evt.payload);
    }
  };

  client.onConnected = () => {
    isConnected = true;
    pairingHintShown = false;
    const reconnected = wasDisconnected;
    wasDisconnected = false;
    setConnectionStatus("connected");
    void (async () => {
      await refreshAgents();
      updateHeader();
      await loadHistory();
      setConnectionStatus(
        reconnected
          ? translateTuiText("tui.message.gatewayReconnected")
          : translateTuiText("tui.message.gatewayConnected"),
        4000,
      );
      tui.requestRender();
      if (!autoMessageSent && autoMessage) {
        autoMessageSent = true;
        await sendMessage(autoMessage);
      }
      updateFooter();
      tui.requestRender();
    })();
  };

  client.onDisconnected = (reason) => {
    isConnected = false;
    wasDisconnected = true;
    historyLoaded = false;
    const disconnectState = resolveGatewayDisconnectState(reason);
    setConnectionStatus(disconnectState.connectionStatus, 5000);
    setActivityStatus(disconnectState.activityStatus);
    if (disconnectState.pairingHint && !pairingHintShown) {
      pairingHintShown = true;
      chatLog.addSystem(disconnectState.pairingHint);
    }
    updateFooter();
    tui.requestRender();
  };

  client.onGap = (info) => {
    setConnectionStatus(`event gap: expected ${info.expected}, got ${info.received}`, 5000);
    tui.requestRender();
  };

  updateHeader();
  setConnectionStatus("connecting");
  updateFooter();
  const sigintHandler = () => {
    handleCtrlC();
  };
  const sigtermHandler = () => {
    requestExit();
  };
  process.on("SIGINT", sigintHandler);
  process.on("SIGTERM", sigtermHandler);
  tui.start();
  client.start();
  await new Promise<void>((resolve) => {
    const finish = () => {
      process.removeListener("SIGINT", sigintHandler);
      process.removeListener("SIGTERM", sigtermHandler);
      resolve();
    };
    process.once("exit", finish);
  });
}
