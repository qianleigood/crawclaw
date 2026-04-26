import { randomUUID } from "node:crypto";
import type { Component, SelectItem, TUI } from "@mariozechner/pi-tui";
import { normalizeGroupActivation } from "../auto-reply/group-activation.js";
import {
  formatThinkingLevels,
  normalizeUsageDisplay,
  resolveResponseUsageMode,
} from "../auto-reply/thinking.js";
import { formatTuiEnabledDisabled, formatTuiOnOff, translateTuiText } from "../cli/i18n/tui.js";
import type { SessionsPatchResult } from "../gateway/protocol/index.js";
import { normalizeAgentId } from "../routing/session-key.js";
import { helpText, parseCommand } from "./commands.js";
import type { ChatLog } from "./components/chat-log.js";
import {
  createFilterableSelectList,
  createSearchableSelectList,
  createSettingsList,
} from "./components/selectors.js";
import { StatusOverlayComponent } from "./components/status-overlay.js";
import type { GatewayChatClient } from "./gateway-chat.js";
import {
  formatDeliveryRoute,
  formatSessionPickerDescription,
  formatStatusOverlayLines,
  sanitizeRenderableText,
} from "./tui-formatters.js";
import {
  createDefaultTuiImprovementApi,
  ImprovementProposalOverlayComponent,
  type ImprovementOverlayAction,
  type TuiImprovementApi,
} from "./tui-improvement-center.js";
import type {
  AgentSummary,
  GatewayStatusSummary,
  TuiOptions,
  TuiStateAccess,
} from "./tui-types.js";

type CommandHandlerContext = {
  client: GatewayChatClient;
  chatLog: ChatLog;
  tui: TUI;
  opts: TuiOptions;
  state: TuiStateAccess;
  deliverDefault: boolean;
  openOverlay: (component: Component) => void;
  closeOverlay: () => void;
  refreshSessionInfo: () => Promise<void>;
  loadHistory: () => Promise<void>;
  setSession: (key: string) => Promise<void>;
  refreshAgents: () => Promise<void>;
  abortActive: () => Promise<void>;
  setActivityStatus: (text: string) => void;
  formatSessionKey: (key: string) => string;
  applySessionInfoFromPatch: (result: SessionsPatchResult) => void;
  noteLocalRunId: (runId: string) => void;
  noteLocalBtwRunId?: (runId: string) => void;
  forgetLocalRunId?: (runId: string) => void;
  forgetLocalBtwRunId?: (runId: string) => void;
  recordError?: (message: string) => void;
  improvements?: TuiImprovementApi;
  requestExit: () => void;
};

function isBtwCommand(text: string): boolean {
  return /^\/btw(?::|\s|$)/i.test(text.trim());
}

export function createCommandHandlers(context: CommandHandlerContext) {
  const {
    client,
    chatLog,
    tui,
    opts,
    state,
    deliverDefault,
    openOverlay,
    closeOverlay,
    refreshSessionInfo,
    loadHistory,
    setSession,
    refreshAgents,
    abortActive,
    setActivityStatus,
    formatSessionKey,
    applySessionInfoFromPatch,
    noteLocalBtwRunId,
    forgetLocalRunId,
    forgetLocalBtwRunId,
    recordError,
    improvements = createDefaultTuiImprovementApi(),
    requestExit,
  } = context;

  const addErrorSystem = (message: string) => {
    recordError?.(message);
    chatLog.addSystem(message);
  };

  const setAgent = async (id: string) => {
    state.currentAgentId = normalizeAgentId(id);
    await setSession("");
  };

  const closeOverlayAndRender = () => {
    closeOverlay();
    tui.requestRender();
  };

  const openSelector = (
    selector: {
      onSelect?: (item: SelectItem) => void;
      onCancel?: () => void;
    },
    onSelect: (value: string) => Promise<void>,
  ) => {
    selector.onSelect = (item) => {
      void (async () => {
        await onSelect(item.value);
        closeOverlayAndRender();
      })();
    };
    selector.onCancel = closeOverlayAndRender;
    openOverlay(selector as Component);
    tui.requestRender();
  };

  const openModelSelector = async () => {
    try {
      const models = await client.listModels();
      if (models.length === 0) {
        chatLog.addSystem(translateTuiText("tui.message.noModelsAvailable"));
        tui.requestRender();
        return;
      }
      const items = models.map((model) => ({
        value: `${model.provider}/${model.id}`,
        label: `${model.provider}/${model.id}`,
        description: model.name && model.name !== model.id ? model.name : "",
      }));
      const selector = createSearchableSelectList(items, 9);
      openSelector(selector, async (value) => {
        try {
          const result = await client.patchSession({
            key: state.currentSessionKey,
            model: value,
          });
          chatLog.addSystem(translateTuiText("tui.message.modelSet", { value }));
          applySessionInfoFromPatch(result);
          await refreshSessionInfo();
        } catch (err) {
          addErrorSystem(translateTuiText("tui.error.modelSetFailed", { error: String(err) }));
        }
      });
    } catch (err) {
      addErrorSystem(translateTuiText("tui.error.modelListFailed", { error: String(err) }));
      tui.requestRender();
    }
  };

  const openAgentSelector = async () => {
    await refreshAgents();
    if (state.agents.length === 0) {
      chatLog.addSystem(translateTuiText("tui.message.noAgentsFound"));
      tui.requestRender();
      return;
    }
    const items = state.agents.map((agent: AgentSummary) => ({
      value: agent.id,
      label: agent.name ? `${agent.id} (${agent.name})` : agent.id,
      description: agent.id === state.agentDefaultId ? translateTuiText("tui.common.default") : "",
    }));
    const selector = createSearchableSelectList(items, 9);
    openSelector(selector, async (value) => {
      await setAgent(value);
    });
  };

  const openSessionSelector = async () => {
    try {
      const result = await client.listSessions({
        includeGlobal: false,
        includeUnknown: false,
        includeDerivedTitles: true,
        includeLastMessage: true,
        agentId: state.currentAgentId,
      });
      const items = result.sessions.map((session) => {
        const title = session.derivedTitle ?? session.displayName;
        const formattedKey = formatSessionKey(session.key);
        // Avoid redundant "title (key)" when title matches key
        const label = title && title !== formattedKey ? `${title} (${formattedKey})` : formattedKey;
        const description = formatSessionPickerDescription(session);
        return {
          value: session.key,
          label,
          description,
          searchText: [
            session.displayName,
            session.label,
            session.subject,
            session.sessionId,
            session.key,
            session.modelProvider,
            session.model,
            session.lastChannel,
            session.lastTo,
            session.lastAccountId,
            session.lastMessagePreview,
          ]
            .filter(Boolean)
            .join(" "),
        };
      });
      const selector = createFilterableSelectList(items, 9);
      openSelector(selector, async (value) => {
        await setSession(value);
      });
    } catch (err) {
      addErrorSystem(translateTuiText("tui.error.sessionsListFailed", { error: String(err) }));
      tui.requestRender();
    }
  };

  const openSettings = () => {
    const items = [
      {
        id: "deliver",
        label: translateTuiText("tui.settings.deliver"),
        currentValue: state.deliverEnabled ? "on" : "off",
        values: ["off", "on"],
      },
      {
        id: "tools",
        label: translateTuiText("tui.settings.toolOutput"),
        currentValue: state.toolsExpanded ? "expanded" : "collapsed",
        values: ["collapsed", "expanded"],
      },
      {
        id: "thinking",
        label: translateTuiText("tui.settings.showThinking"),
        currentValue: state.showThinking ? "on" : "off",
        values: ["off", "on"],
      },
    ];
    const settings = createSettingsList(
      items,
      (id, value) => {
        if (id === "tools") {
          state.toolsExpanded = value === "expanded";
          chatLog.setToolsExpanded(state.toolsExpanded);
        }
        if (id === "deliver") {
          state.deliverEnabled = value === "on";
          setActivityStatus(
            translateTuiText("tui.message.deliverToggled", {
              value: formatTuiEnabledDisabled(state.deliverEnabled),
            }),
          );
        }
        if (id === "thinking") {
          state.showThinking = value === "on";
          void loadHistory();
        }
        tui.requestRender();
      },
      () => {
        closeOverlay();
        tui.requestRender();
      },
    );
    openOverlay(settings);
    tui.requestRender();
  };

  const openStatusOverlay = async () => {
    try {
      const status = await client.getStatus();
      if (typeof status === "string") {
        chatLog.addSystem(status);
        return;
      }
      if (status && typeof status === "object") {
        const lines = formatStatusOverlayLines({
          summary: status as GatewayStatusSummary,
          connectionStatus: state.connectionStatus,
          activityStatus: state.activityStatus,
          activeRunId: state.activeChatRunId,
          agentLabel: state.currentAgentId,
          sessionLabel: formatSessionKey(state.currentSessionKey),
          modelProvider: state.sessionInfo.modelProvider,
          model: state.sessionInfo.model,
          totalTokens: state.sessionInfo.totalTokens ?? null,
          contextTokens: state.sessionInfo.contextTokens ?? null,
          deliverEnabled: state.deliverEnabled,
          deliveryRoute: formatDeliveryRoute(state.sessionInfo),
          lastError: state.lastError,
        });
        openOverlay(new StatusOverlayComponent(lines, closeOverlay));
        return;
      }
      chatLog.addSystem(translateTuiText("tui.message.statusUnknownResponse"));
    } catch (err) {
      addErrorSystem(translateTuiText("tui.error.statusFailed", { error: String(err) }));
    }
  };

  const openImprovementDetail = async (proposalId: string) => {
    try {
      const detail = await improvements.detail(proposalId);
      const runAction = async (action: ImprovementOverlayAction) => {
        try {
          if (action === "approve") {
            await improvements.review(proposalId, true);
          } else if (action === "reject") {
            await improvements.review(proposalId, false);
          } else if (action === "apply") {
            await improvements.apply(proposalId);
          } else if (action === "verify") {
            await improvements.verify(proposalId);
          } else {
            await improvements.rollback(proposalId);
          }
          chatLog.addSystem(
            translateTuiText("tui.message.improveAction", {
              action,
              id: proposalId,
            }),
          );
          closeOverlay();
          await openImprovementDetail(proposalId);
        } catch (err) {
          addErrorSystem(translateTuiText("tui.error.improveFailed", { error: String(err) }));
          tui.requestRender();
        }
      };
      openOverlay(
        new ImprovementProposalOverlayComponent(detail, {
          onClose: closeOverlayAndRender,
          onBack: () => {
            closeOverlay();
            void openImprovementInbox();
          },
          onAction: runAction,
        }),
      );
      tui.requestRender();
    } catch (err) {
      addErrorSystem(translateTuiText("tui.error.improveFailed", { error: String(err) }));
      tui.requestRender();
    }
  };

  const openImprovementInbox = async () => {
    try {
      const proposals = await improvements.list();
      if (proposals.length === 0) {
        chatLog.addSystem(translateTuiText("tui.message.noImprovementProposals"));
        tui.requestRender();
        return;
      }
      const selector = createFilterableSelectList(
        proposals.map((proposal) => ({
          value: proposal.id,
          label: `${proposal.kind} ${proposal.status} ${proposal.id}`,
          description: proposal.signalSummary,
          searchText: [
            proposal.id,
            proposal.kind,
            proposal.status,
            proposal.riskLevel,
            proposal.signalSummary,
          ].join(" "),
        })),
        9,
      );
      selector.onSelect = (item) => {
        void (async () => {
          closeOverlay();
          await openImprovementDetail(item.value);
        })();
      };
      selector.onCancel = closeOverlayAndRender;
      openOverlay(selector as Component);
      tui.requestRender();
    } catch (err) {
      addErrorSystem(translateTuiText("tui.error.improveFailed", { error: String(err) }));
      tui.requestRender();
    }
  };

  const runImprovementScanFromTui = async () => {
    try {
      const result = await improvements.run();
      chatLog.addSystem(
        translateTuiText("tui.message.improveRun", {
          status: result.run.status,
          id: result.proposal?.id ?? result.run.runId,
        }),
      );
      tui.requestRender();
    } catch (err) {
      addErrorSystem(translateTuiText("tui.error.improveFailed", { error: String(err) }));
      tui.requestRender();
    }
  };

  const handleCommand = async (raw: string) => {
    const { name, args } = parseCommand(raw);
    if (!name) {
      return;
    }
    switch (name) {
      case "help":
        chatLog.addSystem(
          helpText({
            provider: state.sessionInfo.modelProvider,
            model: state.sessionInfo.model,
          }),
        );
        break;
      case "status":
        await openStatusOverlay();
        break;
      case "improve":
        if (args === "run") {
          await runImprovementScanFromTui();
        } else if (args) {
          await openImprovementDetail(args);
        } else {
          await openImprovementInbox();
        }
        break;
      case "agent":
        if (!args) {
          await openAgentSelector();
        } else {
          await setAgent(args);
        }
        break;
      case "agents":
        await openAgentSelector();
        break;
      case "session":
        if (!args) {
          await openSessionSelector();
        } else {
          await setSession(args);
        }
        break;
      case "sessions":
        await openSessionSelector();
        break;
      case "model":
        if (!args) {
          await openModelSelector();
        } else {
          try {
            const result = await client.patchSession({
              key: state.currentSessionKey,
              model: args,
            });
            chatLog.addSystem(translateTuiText("tui.message.modelSet", { value: args }));
            applySessionInfoFromPatch(result);
            await refreshSessionInfo();
          } catch (err) {
            addErrorSystem(translateTuiText("tui.error.modelSetFailed", { error: String(err) }));
          }
        }
        break;
      case "models":
        await openModelSelector();
        break;
      case "think":
        if (!args) {
          const levels = formatThinkingLevels(
            state.sessionInfo.modelProvider,
            state.sessionInfo.model,
            "|",
          );
          chatLog.addSystem(translateTuiText("tui.usage.think", { levels }));
          break;
        }
        try {
          const result = await client.patchSession({
            key: state.currentSessionKey,
            thinkingLevel: args,
          });
          chatLog.addSystem(translateTuiText("tui.message.thinkingSet", { value: args }));
          applySessionInfoFromPatch(result);
          await refreshSessionInfo();
        } catch (err) {
          addErrorSystem(translateTuiText("tui.error.thinkPatchFailed", { error: String(err) }));
        }
        break;
      case "verbose":
        if (!args) {
          chatLog.addSystem(translateTuiText("tui.usage.verbose"));
          break;
        }
        try {
          const result = await client.patchSession({
            key: state.currentSessionKey,
            verboseLevel: args,
          });
          chatLog.addSystem(translateTuiText("tui.message.verboseSet", { value: args }));
          applySessionInfoFromPatch(result);
          await loadHistory();
        } catch (err) {
          addErrorSystem(translateTuiText("tui.error.verbosePatchFailed", { error: String(err) }));
        }
        break;
      case "fast":
        if (!args || args === "status") {
          chatLog.addSystem(
            translateTuiText("tui.message.fastMode", {
              value: formatTuiOnOff(Boolean(state.sessionInfo.fastMode)),
            }),
          );
          break;
        }
        if (args !== "on" && args !== "off") {
          chatLog.addSystem(translateTuiText("tui.usage.fast"));
          break;
        }
        try {
          const result = await client.patchSession({
            key: state.currentSessionKey,
            fastMode: args === "on",
          });
          chatLog.addSystem(
            translateTuiText("tui.message.fastModeToggled", {
              value: formatTuiEnabledDisabled(args === "on"),
            }),
          );
          applySessionInfoFromPatch(result);
          await refreshSessionInfo();
        } catch (err) {
          addErrorSystem(translateTuiText("tui.error.fastPatchFailed", { error: String(err) }));
        }
        break;
      case "reasoning":
        if (!args) {
          chatLog.addSystem(translateTuiText("tui.usage.reasoning"));
          break;
        }
        try {
          const result = await client.patchSession({
            key: state.currentSessionKey,
            reasoningLevel: args,
          });
          chatLog.addSystem(translateTuiText("tui.message.reasoningSet", { value: args }));
          applySessionInfoFromPatch(result);
          await refreshSessionInfo();
        } catch (err) {
          addErrorSystem(
            translateTuiText("tui.error.reasoningPatchFailed", { error: String(err) }),
          );
        }
        break;
      case "usage": {
        const normalized = args ? normalizeUsageDisplay(args) : undefined;
        if (args && !normalized) {
          chatLog.addSystem(translateTuiText("tui.usage.usage"));
          break;
        }
        const currentRaw = state.sessionInfo.responseUsage;
        const current = resolveResponseUsageMode(currentRaw);
        const next =
          normalized ?? (current === "off" ? "tokens" : current === "tokens" ? "full" : "off");
        try {
          const result = await client.patchSession({
            key: state.currentSessionKey,
            responseUsage: next === "off" ? null : next,
          });
          chatLog.addSystem(translateTuiText("tui.message.usageFooter", { value: next }));
          applySessionInfoFromPatch(result);
          await refreshSessionInfo();
        } catch (err) {
          addErrorSystem(translateTuiText("tui.error.usagePatchFailed", { error: String(err) }));
        }
        break;
      }
      case "elevated":
        if (!args) {
          chatLog.addSystem(translateTuiText("tui.usage.elevated"));
          break;
        }
        if (!["on", "off", "ask", "full"].includes(args)) {
          chatLog.addSystem(translateTuiText("tui.usage.elevated"));
          break;
        }
        try {
          const result = await client.patchSession({
            key: state.currentSessionKey,
            elevatedLevel: args,
          });
          chatLog.addSystem(translateTuiText("tui.message.elevatedSet", { value: args }));
          applySessionInfoFromPatch(result);
          await refreshSessionInfo();
        } catch (err) {
          addErrorSystem(translateTuiText("tui.error.elevatedPatchFailed", { error: String(err) }));
        }
        break;
      case "activation":
        if (!args) {
          chatLog.addSystem(translateTuiText("tui.usage.activation"));
          break;
        }
        const activation = normalizeGroupActivation(args);
        if (!activation) {
          chatLog.addSystem(translateTuiText("tui.usage.activation"));
          break;
        }
        try {
          const result = await client.patchSession({
            key: state.currentSessionKey,
            groupActivation: activation,
          });
          chatLog.addSystem(translateTuiText("tui.message.activationSet", { value: activation }));
          applySessionInfoFromPatch(result);
          await refreshSessionInfo();
        } catch (err) {
          addErrorSystem(
            translateTuiText("tui.error.activationPatchFailed", { error: String(err) }),
          );
        }
        break;
      case "deliver":
        if (!args || args === "status") {
          chatLog.addSystem(
            translateTuiText("tui.message.deliverStatus", {
              value: formatTuiOnOff(state.deliverEnabled),
            }),
          );
          break;
        }
        if (args !== "on" && args !== "off") {
          chatLog.addSystem(translateTuiText("tui.usage.deliver"));
          break;
        }
        state.deliverEnabled = args === "on";
        chatLog.addSystem(
          translateTuiText("tui.message.deliverToggled", {
            value: formatTuiEnabledDisabled(state.deliverEnabled),
          }),
        );
        setActivityStatus(
          translateTuiText("tui.message.deliverToggled", {
            value: formatTuiEnabledDisabled(state.deliverEnabled),
          }),
        );
        break;
      case "new":
        try {
          // Clear token counts immediately to avoid stale display (#1523)
          state.sessionInfo.inputTokens = null;
          state.sessionInfo.outputTokens = null;
          state.sessionInfo.totalTokens = null;
          tui.requestRender();

          // Generate unique session key to isolate this TUI client (#39217)
          // This ensures /new creates a fresh session that doesn't broadcast
          // to other connected TUI clients sharing the original session key.
          const uniqueKey = `tui-${randomUUID()}`;
          await setSession(uniqueKey);
          chatLog.addSystem(translateTuiText("tui.message.newSession", { key: uniqueKey }));
        } catch (err) {
          addErrorSystem(
            translateTuiText("tui.error.newSessionFailed", {
              error: sanitizeRenderableText(String(err)),
            }),
          );
        }
        break;
      case "abort":
        await abortActive();
        break;
      case "settings":
        openSettings();
        break;
      case "exit":
      case "quit":
        requestExit();
        break;
      default:
        await sendMessage(raw);
        break;
    }
    tui.requestRender();
  };

  const sendMessage = async (text: string) => {
    if (!state.isConnected) {
      chatLog.addSystem(translateTuiText("tui.message.notConnected"));
      setActivityStatus(translateTuiText("tui.common.disconnected"));
      tui.requestRender();
      return;
    }
    const isBtw = isBtwCommand(text);
    const runId = randomUUID();
    try {
      if (!isBtw) {
        chatLog.addUser(text);
        state.pendingOptimisticUserMessage = true;
        setActivityStatus("sending");
      } else {
        noteLocalBtwRunId?.(runId);
      }
      tui.requestRender();
      await client.sendChat({
        sessionKey: state.currentSessionKey,
        message: text,
        thinking: opts.thinking,
        deliver: state.deliverEnabled ?? deliverDefault,
        timeoutMs: opts.timeoutMs,
        runId,
      });
      if (!isBtw) {
        setActivityStatus("waiting");
        tui.requestRender();
      }
    } catch (err) {
      if (isBtw) {
        forgetLocalBtwRunId?.(runId);
      }
      if (!isBtw && state.activeChatRunId) {
        forgetLocalRunId?.(state.activeChatRunId);
      }
      if (!isBtw) {
        state.pendingOptimisticUserMessage = false;
        state.activeChatRunId = null;
      }
      addErrorSystem(
        isBtw
          ? translateTuiText("tui.error.btwFailed", { error: String(err) })
          : translateTuiText("tui.error.sendFailed", { error: String(err) }),
      );
      if (!isBtw) {
        setActivityStatus("error");
      }
      tui.requestRender();
    }
  };

  return {
    handleCommand,
    sendMessage,
    openModelSelector,
    openAgentSelector,
    openSessionSelector,
    openSettings,
    setAgent,
  };
}
