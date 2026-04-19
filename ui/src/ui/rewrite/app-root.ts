import { LitElement, html, nothing } from "lit";
import { customElement, query, state } from "lit/decorators.js";
import { repeat } from "lit/directives/repeat.js";
import { i18n, t, isSupportedLocale, type Locale } from "../../i18n/index.ts";
import {
  CHAT_COMPOSER_ATTACHMENT_ACCEPT,
  getSupportedComposerAttachmentKind,
} from "../chat/attachment-support.ts";
import { extractText } from "../chat/message-extract.ts";
import {
  CATEGORY_LABELS,
  getSlashCommandCompletions,
  localizeSlashArgOptionLabel,
  localizeSlashCommandArgs,
  localizeSlashCommandDescription,
  SLASH_COMMANDS,
  type SlashCommandDef,
} from "../chat/slash-commands.ts";
import {
  cancelAgentRuntimeTask,
  loadAgentRuntime,
  selectAgentRuntimeTask,
  type AgentRuntimeState,
} from "../controllers/agent-runtime.ts";
import {
  loadAgents,
  loadAgentInspection,
  loadToolsCatalog,
  loadToolsEffective,
  type AgentsState,
} from "../controllers/agents.ts";
import {
  applyChannelConfig,
  loadChannelConfig,
  loadChannelConfigSchema,
  resetChannelConfigState,
  saveChannelConfig,
  updateChannelConfigFormValue,
  type ChannelConfigState,
} from "../controllers/channel-config.ts";
import {
  loadChannelSetupSurface,
  resetChannelSetupState,
  type ChannelSetupState,
} from "../controllers/channel-setup.ts";
import {
  loadChannels,
  logoutWhatsApp,
  reconnectChannelAccount,
  startWhatsAppLogin,
  verifyChannelAccount,
  waitWhatsAppLogin,
  type ChannelsState,
} from "../controllers/channels.ts";
import {
  abortChatRun,
  handleChatEvent,
  loadChatHistory,
  sendChatMessage,
  type ChatState,
} from "../controllers/chat.ts";
import {
  applyConfig,
  loadConfig,
  loadConfigSchema,
  saveConfig,
  type ConfigState,
} from "../controllers/config.ts";
import { callDebugMethod, loadDebug, type DebugState } from "../controllers/debug.ts";
import {
  loadExecApprovals,
  saveExecApprovals,
  type ExecApprovalsFile,
  type ExecApprovalsState,
} from "../controllers/exec-approvals.ts";
import { loadHealthState, type HealthState } from "../controllers/health.ts";
import {
  loadMemoryDreaming,
  loadMemoryPromptJournal,
  loadMemoryProvider,
  loadMemorySessionSummary,
  loginMemoryProvider,
  refreshMemoryProvider,
  refreshMemorySessionSummary,
  runMemoryDream,
  selectMemorySession,
  type MemoryProviderStatus,
  type MemorySection,
  type MemorySessionSummaryStatusResult,
  type MemoryState,
} from "../controllers/memory.ts";
import { loadSessions, type SessionsState } from "../controllers/sessions.ts";
import {
  loadSessionLogs,
  loadSessionTimeSeries,
  loadUsage,
  type UsageState,
} from "../controllers/usage.ts";
import {
  deployWorkflow,
  loadWorkflows,
  runWorkflow,
  setWorkflowEnabled,
  type WorkflowsState,
} from "../controllers/workflows.ts";
import type { GatewayHelloOk, GatewayEventFrame } from "../gateway.ts";
import { GatewayBrowserClient } from "../gateway.ts";
import { openExternalUrlSafe } from "../open-external-url.ts";
import {
  sessionDisplayName,
  sessionSurfaceKey,
  sessionSurfaceLabel,
  type SessionDisplayLike,
} from "../session-display.ts";
import { loadSettings, saveSettings, type UiSettings } from "../storage.ts";
import type {
  ChannelAccountSnapshot,
  ChannelControlCapabilities,
  ChannelUiMetaEntry,
  ChannelsStatusSnapshot,
  CostUsageSummary,
  GatewaySessionRow,
  PresenceEntry,
  StatusSummary,
} from "../types.ts";
import type { ChatAttachment } from "../ui-types.ts";
import { renderChannelConfigForm } from "../views/channels.config.ts";
import {
  controlPagesForLocale,
  metaForPage,
  pageFromPath,
  pathForPage,
  resolveBasePath,
  type ControlPage,
} from "./routes.ts";

type JsonRecord = Record<string, unknown>;
type ShellLocale = "en" | "zh-CN";

const SHELL_LOCALES = ["en", "zh-CN"] as const satisfies readonly Locale[];

const SHELL_COPY: Record<
  ShellLocale,
  {
    controlPlane: string;
    connected: string;
    connecting: string;
    disconnected: string;
    expandRail: string;
    collapseRail: string;
    language: string;
    gateway: string;
    methods: string;
    session: string;
    gatewayPending: string;
    reconnect: string;
    gatewayNotice: string;
  }
> = {
  en: {
    controlPlane: "control plane",
    connected: "Connected",
    connecting: "Connecting",
    disconnected: "Disconnected",
    expandRail: "Expand rail",
    collapseRail: "Collapse rail",
    language: "Language",
    gateway: "Gateway",
    methods: "Methods",
    session: "Session",
    gatewayPending: "Waiting for gateway",
    reconnect: "Reconnect",
    gatewayNotice: "Gateway notice",
  },
  "zh-CN": {
    controlPlane: "控制台",
    connected: "已连接",
    connecting: "连接中",
    disconnected: "已断开",
    expandRail: "展开侧栏",
    collapseRail: "收起侧栏",
    language: "语言",
    gateway: "网关",
    methods: "方法数",
    session: "会话",
    gatewayPending: "等待网关响应",
    reconnect: "重连",
    gatewayNotice: "网关提示",
  },
};

const APP_COPY = {
  en: {
    common: {
      yes: "yes",
      no: "no",
      live: "live",
      none: "No data",
      pending: "Loading",
      na: "Unavailable",
      auto: "auto",
      default: "default",
      idle: "idle",
      available: "available",
      hidden: "hidden",
      supported: "supported",
      notExposed: "not exposed",
      notLoaded: "Not loaded yet",
      notReported: "not reported",
      refresh: "Refresh",
      reload: "Reload",
      save: "Save",
      apply: "Apply",
      send: "Send",
      run: "Run",
      deploy: "Deploy",
      start: "Start",
      wait: "Wait",
      logout: "Logout",
      execute: "Execute",
      cancel: "Cancel",
      password: "Password",
      path: "Path",
      hash: "Hash",
      valid: "Valid",
      file: "File",
      dirty: "Dirty",
      model: "Model",
      provider: "Provider",
      status: "Status",
      updated: "Updated",
      connected: "Connected",
      reconnect: "Reconnect",
      account: "Account",
      surface: "Channel",
      session: "Session",
      key: "Key",
      kind: "Kind",
      tokens: "Tokens",
      workspace: "Workspace",
      cost: "Cost",
      schema: "Schema",
      methods: "Methods",
      sessions: "Sessions",
      accounts: "Accounts",
      messages: "Messages",
      selected: "Selected",
      execution: "Execution",
      range: "Range",
      heartbeat: "Heartbeat",
      recentActivity: "Recent activity",
      recentCheck: "Recent check",
      backgroundCheck: "Background check",
      notRecorded: "No record yet",
      lastProbe: "Last probe",
      connectedAccounts: "Connected accounts",
      defaultAgent: "Default agent",
      models: "Models",
      steps: "Steps",
      inputs: "Inputs",
      outputs: "Outputs",
      groups: "Groups",
      profiles: "Profiles",
      tools: "Tools",
      issues: "Issues",
      latest: "Latest",
      events: "Events",
      logs: "Logs",
      timeline: "Timeline",
      summary: "Summary",
      daily: "Daily",
      agent: "Agent",
      role: "Role",
      state: "State",
      exists: "Exists",
    },
    connection: {
      kicker: "Gateway endpoint",
      title: "Reconnect the control plane",
      endpoint: "WebSocket endpoint",
      token: "Gateway token",
      password: "Password",
    },
    overview: {
      approvals: "Approvals",
      healthy: "Healthy",
      recentSessions: "Recent sessions",
      channelAccounts: "Channel accounts",
      presenceClients: "Presence clients",
      agentsHint: "{count} agents",
      sessionStore: "session store",
      surfacesHint: "Across {count} channels",
      runtimeKicker: "System status",
      runtimeTitle: "How the gateway is doing right now",
      statusSummary: "Status summary",
      heartbeat: "Heartbeat",
      lastClose: "Last close",
      error: "Error",
      controlKicker: "Start here",
      controlTitle: "Most common next steps",
      openSessions: "Open chat and sessions",
      trackedSessions: "{count} tracked sessions",
      reviewConfig: "Review settings and approvals",
      manifestWorkbench: "settings page",
      inspectWorkflows: "Open workflows",
      workflowCount: "{count} workflow definitions",
      recentKicker: "Recent activity",
      recentTitle: "Recently active sessions",
      presenceKicker: "Connected clients",
      presenceTitle: "Connected clients",
      noPresence: "No live presence entries were returned.",
      controlUi: "control-ui",
      operator: "operator",
      attentionKicker: "Needs attention",
      attentionTitle: "Things to check now",
      everythingHealthy: "Nothing urgent needs action right now.",
      openChannels: "Check channel connections",
      openAgents: "Check connected user tools",
      openMemory: "Review memory status",
      memoryHealth: "Memory health",
      recommendedAction: "Recommended action",
    },
    sessions: {
      focusedSession: "Focused session",
      registryKicker: "Choose a session",
      registryTitle: "Recent sessions",
      searchPlaceholder: "Filter sessions by name, key or channel",
      noSessions: "No sessions returned by the gateway.",
      conversationKicker: "Current conversation",
      conversationTitle: "Chat and replies",
      refreshHistory: "Refresh history",
      abortRun: "Abort run",
      streaming: "streaming",
      runtimeKicker: "Running now",
      runtimeTitle: "Current session state",
      routingKicker: "Reply setup",
      routingTitle: "How this message will be sent",
      routingTarget: "Message target",
      routingChannel: "Delivery channel",
      routingMode: "Conversation type",
      routingModel: "Reply model",
      routingUsage: "Usage summary",
      routingTechnical: "Technical details",
      routingTechnicalHint: "Only open these fields when you need to troubleshoot routing.",
      activityKicker: "Latest reply",
      activityTitle: "Most recent message",
      composerKicker: "Send a message",
      composerTitle: "Write to this session",
      sendPlaceholder: "Type a message for this session...",
      attachFiles: "Add files",
      dragHint: "Drag images, text files, PDF files, or audio files here, or use the picker",
      imageAttachments: "Image attachments",
      attachments: "Attachments",
      maximize: "Maximize thread",
      restore: "Restore layout",
      clearAttachments: "Clear attachments",
      clearDraft: "Clear draft",
      preparingAttachments: "Preparing attachments",
      preparingAttachmentsHint: "{count} files are being prepared before send.",
      historyLoading: "Loading conversation",
      historyLoadingHint: "Recent messages are being loaded from the gateway.",
      sendingNow: "Sending now",
      sendingNowHint: "Your draft has been accepted and the reply is being prepared.",
      sendHint: "Enter sends · Shift+Enter adds a new line",
      commandHint: "Type / to browse commands",
      commandSuggestions: "Command suggestions",
      commandHelp: "Use Tab to fill · Enter to send · Shift+Enter for a new line",
      commandHelpArgs: "Use Tab to fill · Enter to run · Esc to close",
      commandEmptyTitle: "No matching command",
      commandEmptyHint: "Keep typing after /, or clear the filter to browse all commands.",
      commandEmptyArgsTitle: "No matching option",
      commandEmptyArgsHint: "Try a different option, or delete a few characters to see more.",
      commandStartTitle: "Start with a command",
      commandStartHint: "Type / to browse commands, then use Tab to fill and Enter to send.",
      commandInstant: "Runs now",
      commandOptions: "options",
      commandCategorySession: "Session",
      commandCategoryModel: "Model",
      commandCategoryTools: "Tools",
      commandCategoryAgents: "Agents",
      textFile: "Text file",
      pdfFile: "PDF file",
      audioFile: "Audio file",
      unsupportedAttachment:
        "Only images, text/code files, PDF files, and audio files are supported here.",
      fileTooLarge: "Some files were too large and were trimmed before send.",
      inspectorKicker: "Inspector",
      inspectorTitle: "Current session context",
      selectPrompt: "Choose a session to read messages and reply.",
      noMessages: "No messages loaded for the current session.",
      inventoryMatches: "{count} matching sessions",
      draftLength: "Draft length",
      blocks: "Blocks",
    },
    channels: {
      accounts: "Accounts",
      enabledSurfaces: "Enabled channels",
      accountsKicker: "Channels",
      inventoryTitle: "Manage channels",
      probeAgain: "Check again",
      running: "Running",
      lastError: "Last error",
      noAccounts: "No channel accounts were returned by the gateway.",
      directoryKicker: "Channel directory",
      directoryTitle: "Current channels",
      directoryHint:
        "Start from the channels you already have. Open one to edit it, or choose Add channel to set up a new one.",
      addChannel: "Add channel",
      addFlowKicker: "Add a channel",
      addFlowTitle: "Choose a channel to set up",
      addFlowHint:
        "Pick from every channel this gateway supports. We will take you into setup, editing, or the channel detail page based on what that channel can do.",
      addFlowEmpty: "No supported channels are available on this gateway right now.",
      configuredCatalogTitle: "Channels you already have",
      configuredCatalogHint:
        "Keep editing an existing channel here, or add another account when that channel supports it.",
      availableCatalogTitle: "Supported channels you can add",
      availableCatalogHint:
        "These channels are available on the gateway but not active yet. Start from the guide or package info.",
      startWithThisChannel: "Set up this channel",
      addAnotherAccount: "Add another account",
      addAnotherAccountHint:
        "This channel already exists. Add another account or instance here instead of reopening the current one.",
      viewChannelGuide: "View setup guide",
      detailKicker: "Selected channel",
      detailTitle: "Channel details",
      detailHint: "Review this channel, then edit it or work with its accounts when needed.",
      backToDirectory: "Back to channel list",
      backToWorkspace: "Back to channel workspace",
      workspaceKicker: "Channel workspace",
      workspaceTitle: "Choose what to do next",
      workspaceHint:
        "Handle one task at a time: set up the channel, connect an account, review accounts, or edit settings.",
      recommendedNext: "Recommended next step",
      stepGuideTitle: "Review channel status",
      stepGuideHint: "Start here if you want to understand this channel before changing anything.",
      stepSetupTitle: "Set up this channel",
      stepSetupHint:
        "Use the setup guide when the channel still needs credentials, a draft account, or docs.",
      stepConnectTitle: "Connect an account",
      stepConnectHint: "Use sign-in and repair actions only when this channel exposes them.",
      stepAccountsTitle: "Review accounts",
      stepAccountsHint:
        "Open the account list to inspect connection state, choose a default, or fix one account.",
      stepSettingsTitle: "Edit channel settings",
      stepSettingsHint:
        "Open the channel editor only when you know you need to change config values.",
      chooseStepKicker: "Next step",
      chooseStepTitle: "Pick one task",
      chooseStepHint:
        "This page stays focused on a single task so setup and repair are easier to follow.",
      openWorkspace: "Open channel workspace",
      accountsTitle: "Accounts for this channel",
      accountsHint: "Select an account to inspect connection state and next actions.",
      accountDetailsTitle: "Selected account",
      accountDetailsHint: "This area shows the real status returned for the selected account.",
      actionsTitle: "Available actions",
      actionsHint: "Only actions supported by the selected channel are shown here.",
      channelHealthy: "Healthy",
      channelAttention: "Needs attention",
      channelNotConfigured: "Not configured",
      channelAvailableToAdd: "Available to add",
      channelConnected: "Connected",
      channelConfigured: "Configured",
      issueCount: "Issues",
      supportedActions: "Supported actions",
      selectedChannel: "Selected channel",
      selectedAccount: "Selected account",
      browseChannels: "Select a channel to inspect accounts and available actions.",
      summaryTitle: "Current channel status",
      summaryHint:
        "This panel explains what this channel is doing now and what you are likely to do next.",
      noChannelAccounts: "This channel has no configured accounts yet.",
      verifyConnection: "Verify connection",
      openSettings: "Edit this channel",
      openSettingsHint:
        "Open a channel-specific editor here, then save or apply only the changes you intend.",
      settingsTitle: "Channel settings",
      settingsHint:
        "Edit the selected channel without leaving this page. Changes still use the same config write path underneath.",
      settingsReviewTitle: "Save and apply",
      settingsReviewHint:
        "Keep the main form focused on the channel itself. Save, apply, and reload from the side rail.",
      settingsStatusTitle: "Current status",
      settingsStatusHint:
        "See the current account count, default account, and whether you still have unsaved changes.",
      settingsReferenceTitle: "Commands and references",
      settingsReferenceHint:
        "Keep docs, install info, and quick commands here so the main form stays focused.",
      settingsReferenceEmpty: "No extra commands or docs were returned for this channel.",
      settingsTechnicalTitle: "Technical details",
      settingsTechnicalHint:
        "Only open this when you need the config path, schema version, or channel id.",
      settingsPageHint:
        "Change only what this channel needs. Keep the left side for form fields and the right side for actions and reference details.",
      settingsClosed: "Channel editor is closed. Open it when you need to change channel settings.",
      settingsUnavailable: "This channel does not expose editable settings on this gateway.",
      openChannelEditor: "Open channel editor",
      closeChannelEditor: "Close editor",
      saveChannelSettings: "Save channel changes",
      applyChannelSettings: "Apply now",
      reloadChannelSettings: "Reload channel settings",
      startQrLogin: "Start QR sign-in",
      checkLogin: "Check sign-in result",
      logoutAccount: "Sign out",
      qrLoginTitle: "Browser sign-in",
      qrLoginHint:
        "Use this only for channels that expose a browser QR sign-in flow on the gateway.",
      loginNotSupported: "This channel does not expose a browser sign-in flow on this gateway.",
      noActiveLogin: "No browser sign-in flow is active right now.",
      loginQr: "Scan QR code",
      loginMessage: "Current sign-in state",
      actionLogin: "Sign in",
      actionVerify: "Verify",
      actionLogout: "Sign out",
      actionEdit: "Edit settings",
      actionSetup: "Set up",
      actionNone: "No direct actions are exposed for this channel yet.",
      setupKicker: "Setup",
      setupTitle: "Get this channel ready",
      setupHint:
        "Use the shortest path to get this channel ready. Start with channel settings, then add an account only if this channel needs one.",
      setupMode: "Setup mode",
      setupModeWizard: "Guided setup",
      setupModeConfig: "Settings editor",
      setupModeNone: "Reference only",
      setupSelectionHint: "Current guidance",
      setupCommandsTitle: "Commands and references",
      setupDocs: "Docs",
      setupUnavailable: "This channel does not expose a dedicated setup surface on this gateway.",
      addAccountDraft: "Add account draft",
      addAccountDraftPlaceholder: "Leave blank to auto-pick an account id",
      addAccountDraftHint:
        "For multi-account channels, this creates a draft account entry in the channel editor so you can fill credentials before saving.",
      defaultAccount: "Default account",
      makeDefaultAccount: "Make default",
      catalogOnlyTitle: "This channel is supported, but not active on this gateway yet",
      catalogOnlyHint:
        "Use the package and docs below to add the channel first. After it is enabled, come back here to edit settings and accounts.",
      catalogDocs: "Docs path",
      catalogPackage: "Package",
    },
    workflows: {
      registry: "Registry",
      registryKicker: "Choose a workflow",
      registryTitle: "Available workflows",
      autoRun: "auto-run",
      manual: "manual",
      runs: "runs",
      detailKicker: "Selected workflow",
      selectTitle: "Select a workflow",
      disable: "Disable",
      enable: "Enable",
      registryDetail: "What this workflow is",
      approval: "Approval",
      required: "required",
      notRequired: "not required",
      archived: "Archived",
      currentExecution: "Current execution",
      noExecution: "No execution selected.",
      specification: "Definition summary",
      choosePrompt: "Choose a workflow to see what it does and what you can do next.",
      actionsTitle: "What you can do next",
      actionsHint: "Run it now, change whether it is enabled, or deploy the current definition.",
      recentRunsTitle: "Recent runs",
      recentRunsEmpty: "No runs have been returned for this workflow yet.",
      openWorkflow: "Open workflow",
      goal: "Goal",
      topology: "Topology",
      runWorkflow: "Run workflow",
      deployWorkflow: "Deploy current definition",
      enabledState: "Enabled",
    },
    agents: {
      registered: "Registered",
      registryKicker: "Choose an agent",
      registryTitle: "Available agents",
      connectedAccountsKicker: "Connected accounts",
      connectedAccountsTitle: "User tools and identities",
      connectedAccountsHint:
        "These tools use your own logged-in account. They are separate from bot channels.",
      connectedAccountsHidden: "Not enabled",
      connectedAccountsAttention: "Needs attention",
      feishuUserTools: "Feishu user tools",
      authState: "Auth state",
      checkCommand: "Check command",
      loginCommand: "Login command",
      introspectionKicker: "Current activity",
      detailTitle: "Selected agent",
      identity: "Who this agent is",
      primaryModel: "Primary model",
      inspectionSnapshot: "Current runtime check",
      toolsCatalog: "Available tools",
      effectiveTools: "Tools in this session",
      selectPrompt: "Choose an agent to review its model, status and tools.",
      runtimeSummary: "What it is doing now",
      workspaceHint: "Workspace",
      toolsHint: "Review both the full catalog and the tools currently active in this session.",
      catalogEmpty: "Open an agent to load the tool catalog.",
      effectiveToolsEmpty: "Open an agent to see the tools available in this session.",
    },
    memory: {
      provider: "Provider",
      dreaming: "Memory runs",
      sessionSummaries: "Session summaries",
      promptJournal: "Prompt activity",
      healthKicker: "Health rail",
      healthTitle: "Status and next steps",
      providerKicker: "Provider",
      providerTitle: "NotebookLM connection",
      refreshProvider: "Refresh provider",
      runLoginFlow: "Sign in again",
      recommendedAction: "Recommended action",
      details: "Details",
      dreamingKicker: "Durable memory",
      dreamingTitle: "Automatic memory updates",
      runNow: "Run now",
      dryRun: "Preview run",
      forceRun: "Force run",
      recentRuns: "Recent memory jobs",
      scope: "Scope",
      trigger: "Trigger",
      runId: "Run ID",
      profile: "Profile",
      notebookId: "Notebook ID",
      authSource: "Auth source",
      lastValidated: "Last validated",
      lastRefresh: "Last refresh",
      nextProbe: "Next check",
      nextRefresh: "Next refresh",
      lastSuccess: "Last success",
      lastAttempt: "Last attempt",
      lastFailure: "Last failure",
      lastSkipReason: "Last skip reason",
      lockOwner: "Lock owner",
      sessionId: "Session ID",
      lastSummarizedMessage: "Last summarized message",
      lastSummaryUpdate: "Last summary update",
      inProgress: "In progress",
      summariesKicker: "Session summary",
      summariesTitle: "Saved summary",
      refreshSummary: "Refresh summary",
      forceRefresh: "Force refresh",
      selectSession: "Choose a session to review its saved summary.",
      currentState: "Current State",
      taskSpecification: "Task Specification",
      keyResults: "Key Results",
      errorsAndCorrections: "Errors & Corrections",
      journalKicker: "Prompt journal",
      journalTitle: "Prompt activity summary",
      summarizeJournal: "Refresh prompt activity",
      topReasons: "Top extraction reasons",
      writeOutcomes: "Write outcomes",
      promptAssemblies: "Prompt assemblies",
      durableExtractions: "Durable extractions",
      knowledgeWrites: "Knowledge writes",
      noJournal: "Prompt journal is disabled or no files were found.",
    },
    runtime: {
      registryKicker: "Background work",
      registryTitle: "Runs that are active or need review",
      choosePrompt: "Choose a run to review its status, linked session and available actions.",
      categoryKicker: "Filter by kind",
      categoryTitle: "What should this list show?",
      statusKicker: "Filter by status",
      statusTitle: "Which runs matter right now?",
      queryKicker: "Find a specific run",
      queryTitle: "Filter by agent, session or run ID",
      refreshRuns: "Refresh runs",
      taskId: "Task ID",
      runId: "Run ID",
      parentSession: "Parent session",
      childSession: "Child session",
      updatedAt: "Updated",
      lastCompleted: "Last completed",
      currentRun: "Selected run",
      contractTitle: "How this run was created",
      detailsTitle: "Run details",
      actionsTitle: "Actions",
      openSession: "Open linked session",
      noRuns: "No background runs match the current filters.",
      running: "Running",
      failed: "Failed",
      waiting: "Waiting",
      completed: "Completed",
      attention: "Needs attention",
      all: "All",
      memory: "Memory",
      verification: "Verification",
      subagents: "Subagents",
      acp: "ACP",
      cron: "Cron",
      cli: "CLI",
    },
    usage: {
      queryKicker: "Choose a time range",
      queryTitle: "What period do you want to review?",
      startDate: "Start date",
      endDate: "End date",
      refreshUsage: "Refresh usage",
      sessionCostKicker: "Sessions using resources",
      sessionCostTitle: "Sessions in this range",
      timeSeries: "Time series",
      usageLogs: "Usage logs",
      totalsTitle: "Total cost and tokens",
      rangeSummaryTitle: "What this report includes",
      noSessions: "No sessions were returned for this date range.",
      totalsEmpty: "Refresh usage to load cost and token totals.",
      timeSeriesEmpty: "Refresh usage to load the recent trend.",
      logsEmpty: "Refresh usage to load the most recent session activity.",
    },
    config: {
      manifestKicker: "Current configuration file",
      manifestTitle: "Config file status",
      applySession: "Apply session",
      approvalsKicker: "Approval rules",
      approvalsTitle: "Execution policy file",
      manifestWorkbenchKicker: "Edit settings",
      manifestWorkbenchTitle: "Configuration",
      approvalWorkbenchKicker: "Edit approval rules",
      approvalWorkbenchTitle: "Approval rules",
      saveApprovals: "Save approval rules",
      configIssues: "Issues to fix",
      approvalSnapshot: "Current approval summary",
      issuesEmpty: "No configuration issues were reported.",
      issuesAction: "Recommended action",
      issuesReview: "Review this setting and save the updated configuration.",
      approvalsNotLoaded: "Approval rules have not been loaded yet.",
      saveAndApplyTitle: "Save first, then apply",
      saveAndApplyHint:
        "Saving writes the file. Applying tells the running gateway to reload the updated config.",
      approvalHint:
        "Approval rules are saved separately. Keep them in sync when you change security behavior.",
    },
    debug: {
      methodSurfaceKicker: "Available methods",
      methodSurfaceTitle: "Methods you can call from this page",
      preferredName: "recommended",
      surface: "available",
      statusSnapshot: "Current gateway status",
      healthSnapshot: "Recent health checks",
      manualKicker: "Manual call",
      manualTitle: "Call a method directly",
      method: "Method",
      params: "Params",
      noRequest: "No request executed yet.",
      snapshotEmpty: "Open or refresh diagnostics to load data here.",
      diagnosticsTitle: "When to use this page",
      diagnosticsHint:
        "Use Debug only when the normal product pages do not tell you enough or when you need to inspect raw gateway responses.",
    },
  },
  "zh-CN": {
    common: {
      yes: "是",
      no: "否",
      live: "在线",
      none: "暂无",
      pending: "加载中",
      na: "不可用",
      auto: "自动",
      default: "默认",
      idle: "空闲",
      available: "可用",
      hidden: "隐藏",
      supported: "支持",
      notExposed: "未暴露",
      notLoaded: "尚未加载",
      notReported: "未上报",
      refresh: "刷新",
      reload: "重新加载",
      save: "保存",
      apply: "应用",
      send: "发送",
      run: "运行",
      deploy: "部署",
      start: "开始",
      wait: "等待",
      logout: "退出登录",
      execute: "执行",
      cancel: "取消",
      password: "密码",
      path: "路径",
      hash: "哈希",
      valid: "有效",
      file: "文件",
      dirty: "未保存改动",
      model: "模型",
      provider: "提供方",
      status: "状态",
      updated: "更新时间",
      connected: "连接状态",
      reconnect: "重连",
      account: "账号",
      surface: "渠道",
      session: "会话",
      key: "键",
      kind: "类型",
      tokens: "Tokens",
      workspace: "工作区",
      cost: "成本",
      schema: "Schema",
      methods: "方法数",
      sessions: "会话数",
      accounts: "账号数",
      messages: "消息数",
      selected: "已选",
      execution: "执行",
      range: "范围",
      heartbeat: "心跳",
      recentActivity: "最近活动",
      recentCheck: "最近检查",
      backgroundCheck: "后台检查",
      notRecorded: "尚未记录",
      lastProbe: "最近探测",
      connectedAccounts: "已连接账号",
      defaultAgent: "默认代理",
      models: "模型数",
      steps: "步骤数",
      inputs: "输入",
      outputs: "输出",
      groups: "分组",
      profiles: "配置组",
      tools: "工具数",
      issues: "问题数",
      latest: "最近一条",
      events: "事件数",
      logs: "日志数",
      timeline: "时间线",
      summary: "摘要",
      daily: "按日",
      agent: "代理",
      role: "角色",
      state: "状态",
      exists: "存在",
    },
    connection: {
      kicker: "网关端点",
      title: "重连控制台",
      endpoint: "WebSocket 端点",
      token: "网关令牌",
      password: "密码",
    },
    overview: {
      approvals: "审批",
      healthy: "健康",
      recentSessions: "近期会话",
      channelAccounts: "渠道账号",
      presenceClients: "在线客户端",
      agentsHint: "{count} 个代理",
      sessionStore: "会话存储",
      surfacesHint: "来自 {count} 个渠道",
      runtimeKicker: "系统状态",
      runtimeTitle: "当前网关整体情况",
      statusSummary: "状态摘要",
      heartbeat: "心跳",
      lastClose: "上次关闭",
      error: "错误",
      controlKicker: "从这里开始",
      controlTitle: "最常见的下一步操作",
      openSessions: "打开聊天和会话",
      trackedSessions: "{count} 个跟踪会话",
      reviewConfig: "检查设置和审批",
      manifestWorkbench: "设置页面",
      inspectWorkflows: "打开工作流",
      workflowCount: "{count} 个工作流定义",
      recentKicker: "最近活动",
      recentTitle: "最近活跃的会话",
      presenceKicker: "已连接客户端",
      presenceTitle: "已连接客户端",
      noPresence: "当前没有返回在线客户端条目。",
      controlUi: "控制台",
      operator: "操作员",
      attentionKicker: "需要处理",
      attentionTitle: "当前建议先检查这些",
      everythingHealthy: "当前没有明显异常，可以继续正常使用。",
      openChannels: "检查渠道连接",
      openAgents: "检查已连接的用户工具",
      openMemory: "查看记忆状态",
      memoryHealth: "记忆状态",
      recommendedAction: "建议动作",
    },
    sessions: {
      focusedSession: "当前会话",
      registryKicker: "选择会话",
      registryTitle: "最近会话",
      searchPlaceholder: "按名称、key 或渠道过滤会话",
      noSessions: "网关没有返回会话。",
      conversationKicker: "当前对话",
      conversationTitle: "聊天与回复",
      refreshHistory: "刷新历史",
      abortRun: "中止运行",
      streaming: "流式输出中",
      runtimeKicker: "正在运行",
      runtimeTitle: "当前会话状态",
      routingKicker: "回复方式",
      routingTitle: "这条消息会如何发送",
      routingTarget: "发送对象",
      routingChannel: "发送渠道",
      routingMode: "会话类型",
      routingModel: "回复模型",
      routingUsage: "用量摘要",
      routingTechnical: "技术信息",
      routingTechnicalHint: "只有在排查路由问题时，才需要看这些字段。",
      activityKicker: "最近回复",
      activityTitle: "最新一条消息",
      composerKicker: "发送消息",
      composerTitle: "向当前会话发送消息",
      sendPlaceholder: "给当前会话输入一条消息…",
      attachFiles: "添加文件",
      dragHint: "把图片、文本文件、PDF 文件或音频文件拖到这里，或使用选择器",
      imageAttachments: "图片附件",
      attachments: "附件",
      maximize: "最大化对话",
      restore: "恢复布局",
      clearAttachments: "清空附件",
      clearDraft: "清空草稿",
      preparingAttachments: "正在整理附件",
      preparingAttachmentsHint: "还有 {count} 个文件正在发送前处理。",
      historyLoading: "正在加载对话",
      historyLoadingHint: "正在从网关读取最近消息。",
      sendingNow: "正在发送",
      sendingNowHint: "消息已经提交，正在等待回复开始生成。",
      sendHint: "回车发送 · Shift+Enter 换行",
      commandHint: "输入 / 查看可用指令",
      commandSuggestions: "指令提醒",
      commandHelp: "Tab 补全 · Enter 发送 · Shift+Enter 换行",
      commandHelpArgs: "Tab 补全 · Enter 执行 · Esc 关闭",
      commandEmptyTitle: "没有匹配的指令",
      commandEmptyHint: "继续在 / 后输入，或清空筛选查看全部指令。",
      commandEmptyArgsTitle: "没有匹配的选项",
      commandEmptyArgsHint: "试试其他选项，或删掉几个字符查看更多结果。",
      commandStartTitle: "先选择一个指令",
      commandStartHint: "输入 / 查看指令，再用 Tab 补全，Enter 发送。",
      commandInstant: "立即执行",
      commandOptions: "个选项",
      commandCategorySession: "会话",
      commandCategoryModel: "模型",
      commandCategoryTools: "工具",
      commandCategoryAgents: "代理",
      textFile: "文本文件",
      pdfFile: "PDF 文件",
      audioFile: "音频文件",
      unsupportedAttachment: "这里只支持图片、文本/代码文件、PDF 文件和音频文件。",
      fileTooLarge: "部分文件过大，发送前已自动截断。",
      inspectorKicker: "检查面板",
      inspectorTitle: "当前会话上下文",
      selectPrompt: "选择一个会话后查看消息并继续回复。",
      noMessages: "当前会话还没有加载到消息。",
      inventoryMatches: "{count} 个匹配会话",
      draftLength: "草稿长度",
      blocks: "块数",
    },
    channels: {
      accounts: "账号数",
      enabledSurfaces: "已启用渠道",
      accountsKicker: "渠道目录",
      inventoryTitle: "管理渠道",
      probeAgain: "重新检查",
      running: "运行中",
      lastError: "最近错误",
      noAccounts: "当前网关没有返回任何渠道账号。",
      directoryKicker: "渠道目录",
      directoryTitle: "当前渠道",
      directoryHint: "先看现在已经接入的渠道。要修改就打开它；要新增就点“新增渠道”。",
      addChannel: "新增渠道",
      addFlowKicker: "新增渠道",
      addFlowTitle: "选择一个要接入的渠道",
      addFlowHint:
        "这里会列出当前网关支持的所有渠道。选中后，会按这个渠道实际支持的能力带你进入配置、编辑或详情页。",
      addFlowEmpty: "当前网关上没有可用的渠道。",
      configuredCatalogTitle: "已接入的渠道",
      configuredCatalogHint: "继续编辑已有渠道；如果它支持多账号，也可以直接新增一个账号。",
      availableCatalogTitle: "可新增的渠道",
      availableCatalogHint:
        "这些渠道当前受支持，但还没在这台网关上启用。先看接入说明，再决定是否启用。",
      startWithThisChannel: "开始配置这个渠道",
      addAnotherAccount: "新增这个渠道的账号",
      addAnotherAccountHint:
        "这个渠道已经存在。这里直接为它新增一个账号或实例，不再只是打开当前渠道。",
      viewChannelGuide: "查看接入说明",
      detailKicker: "当前渠道",
      detailTitle: "渠道详情",
      detailHint: "先看这个渠道当前的状态；需要时再编辑渠道或处理账号。",
      backToDirectory: "返回渠道列表",
      backToWorkspace: "返回渠道工作页",
      workspaceKicker: "渠道工作页",
      workspaceTitle: "下一步要做什么",
      workspaceHint: "一次只做一件事：配置渠道、连接账号、检查账号，或编辑设置。",
      recommendedNext: "建议下一步",
      stepGuideTitle: "先看整体状态",
      stepGuideHint: "如果你还不确定该改什么，先看渠道状态和建议动作。",
      stepSetupTitle: "配置这个渠道",
      stepSetupHint: "当渠道还缺凭据、文档提示或账号草稿入口时，从这里开始。",
      stepConnectTitle: "连接账号",
      stepConnectHint: "只在这个渠道真的支持登录或修复动作时使用。",
      stepAccountsTitle: "查看账号",
      stepAccountsHint: "进入账号列表后，可以检查状态、切默认账号，或修复某一个账号。",
      stepSettingsTitle: "编辑渠道设置",
      stepSettingsHint: "只有确定要改配置时，再打开编辑器。",
      chooseStepKicker: "下一步",
      chooseStepTitle: "先选一件事",
      chooseStepHint: "这个页面一次只聚焦一件事，配置和修复会更容易理解。",
      openWorkspace: "进入渠道工作页",
      accountsTitle: "这个渠道下的账号",
      accountsHint: "选择一个账号后查看真实连接状态和下一步操作。",
      accountDetailsTitle: "当前账号",
      accountDetailsHint: "这里显示的是当前所选账号的真实状态。",
      actionsTitle: "可执行动作",
      actionsHint: "这里只显示当前渠道真正支持的动作。",
      channelHealthy: "正常",
      channelAttention: "需要处理",
      channelNotConfigured: "未配置",
      channelAvailableToAdd: "可接入",
      channelConnected: "已连接",
      channelConfigured: "已配置",
      issueCount: "问题数",
      supportedActions: "支持的动作",
      selectedChannel: "当前渠道",
      selectedAccount: "当前账号",
      browseChannels: "选择一个渠道后，再查看账号、状态和可执行动作。",
      summaryTitle: "当前渠道状态",
      summaryHint: "这里先说明这个渠道现在是什么状态，以及你下一步最可能要做什么。",
      noChannelAccounts: "这个渠道还没有配置任何账号。",
      verifyConnection: "验证连接",
      openSettings: "编辑这个渠道",
      openSettingsHint: "直接在当前页打开渠道级编辑面板，保存或应用你想改的内容。",
      settingsTitle: "渠道设置",
      settingsHint: "不用跳到总配置页，直接在这里编辑当前渠道。底层仍然走同一条配置写入链路。",
      settingsReviewTitle: "保存与应用",
      settingsReviewHint: "左边只改字段；右边处理保存、应用、重载和账号草稿。",
      settingsStatusTitle: "当前状态",
      settingsStatusHint: "这里显示账号数量、默认账号，以及当前有没有未保存改动。",
      settingsReferenceTitle: "命令与参考",
      settingsReferenceHint: "把文档、安装包和渠道自带命令收在这里，左侧表单只负责改设置。",
      settingsReferenceEmpty: "当前渠道没有返回额外命令或文档。",
      settingsTechnicalTitle: "技术详情",
      settingsTechnicalHint: "只有在排查问题或核对配置路径时，才需要看这里。",
      settingsPageHint: "只改这个渠道真正需要的内容。左边是表单，右边是动作和参考信息。",
      settingsClosed: "渠道编辑面板当前已关闭，需要时再打开。",
      settingsUnavailable: "当前渠道没有在这台网关上暴露可编辑的设置。",
      openChannelEditor: "打开渠道编辑",
      closeChannelEditor: "关闭编辑器",
      saveChannelSettings: "保存渠道改动",
      applyChannelSettings: "立即应用",
      reloadChannelSettings: "重新载入渠道设置",
      startQrLogin: "开始二维码登录",
      checkLogin: "检查登录结果",
      logoutAccount: "退出登录",
      qrLoginTitle: "浏览器登录",
      qrLoginHint: "只对在当前网关上暴露二维码登录流程的渠道可用。",
      loginNotSupported: "当前渠道没有在这台网关上暴露浏览器登录流程。",
      noActiveLogin: "当前没有激活的浏览器登录流程。",
      loginQr: "扫描二维码",
      loginMessage: "当前登录状态",
      actionLogin: "登录",
      actionVerify: "验证",
      actionLogout: "退出登录",
      actionEdit: "编辑设置",
      actionSetup: "开始配置",
      actionNone: "当前还没有给这个渠道暴露直接动作。",
      setupKicker: "配置引导",
      setupTitle: "把这个渠道准备好",
      setupHint: "先把这个渠道需要的基础设置填好。只有这个渠道真的需要账号时，再往下加账号。",
      setupMode: "配置方式",
      setupModeWizard: "引导式配置",
      setupModeConfig: "设置编辑器",
      setupModeNone: "仅参考说明",
      setupSelectionHint: "当前建议",
      setupCommandsTitle: "命令与参考",
      setupDocs: "文档",
      setupUnavailable: "这个渠道在当前网关上没有暴露专门的配置引导。",
      addAccountDraft: "新增账号草稿",
      addAccountDraftPlaceholder: "留空时自动生成账号 ID",
      addAccountDraftHint: "多账号渠道可以先在这里建一个账号草稿，再到下方编辑器里补全凭据和字段。",
      defaultAccount: "默认账号",
      makeDefaultAccount: "设为默认",
      catalogOnlyTitle: "这个渠道受支持，但当前还没有接入这台网关",
      catalogOnlyHint: "先按下面的包名和文档把渠道接进来。启用后再回到这里编辑设置和账号。",
      catalogDocs: "文档路径",
      catalogPackage: "安装包",
    },
    workflows: {
      registry: "注册表",
      registryKicker: "选择工作流",
      registryTitle: "可用工作流",
      autoRun: "自动运行",
      manual: "手动",
      runs: "次运行",
      detailKicker: "当前工作流",
      selectTitle: "选择一个工作流",
      disable: "禁用",
      enable: "启用",
      registryDetail: "这个工作流是做什么的",
      approval: "审批",
      required: "需要",
      notRequired: "不需要",
      archived: "已归档",
      currentExecution: "当前执行",
      noExecution: "当前没有选中的执行记录。",
      specification: "定义摘要",
      choosePrompt: "选择一个工作流后，再决定是否运行、启用或部署。",
      actionsTitle: "下一步可以做什么",
      actionsHint: "你可以立即运行、切换启用状态，或部署当前定义。",
      recentRunsTitle: "最近运行",
      recentRunsEmpty: "这个工作流当前还没有返回运行记录。",
      openWorkflow: "打开工作流",
      goal: "目标",
      topology: "拓扑",
      runWorkflow: "运行工作流",
      deployWorkflow: "部署当前定义",
      enabledState: "已启用",
    },
    agents: {
      registered: "已注册",
      registryKicker: "选择代理",
      registryTitle: "可用代理",
      connectedAccountsKicker: "已连接账号",
      connectedAccountsTitle: "用户工具与身份",
      connectedAccountsHint: "这里显示的是“以你本人身份”运行的用户工具，不是机器人渠道。",
      connectedAccountsHidden: "未启用",
      connectedAccountsAttention: "需要处理",
      feishuUserTools: "飞书用户工具",
      authState: "授权状态",
      checkCommand: "检查命令",
      loginCommand: "登录命令",
      introspectionKicker: "当前活动",
      detailTitle: "当前代理",
      identity: "这个代理是谁",
      primaryModel: "主模型",
      inspectionSnapshot: "当前运行检查",
      toolsCatalog: "可用工具",
      effectiveTools: "当前会话中可用的工具",
      selectPrompt: "选择一个代理后，可以查看它的模型、状态和工具。",
      runtimeSummary: "它现在在做什么",
      workspaceHint: "工作区",
      toolsHint: "同时查看工具总目录和当前会话实际可用的工具。",
      catalogEmpty: "先打开一个代理，再加载工具目录。",
      effectiveToolsEmpty: "先打开一个代理，再查看这个会话里可用的工具。",
    },
    memory: {
      provider: "提供方",
      dreaming: "记忆运行",
      sessionSummaries: "会话摘要",
      promptJournal: "提示词活动",
      healthKicker: "健康侧栏",
      healthTitle: "状态与下一步",
      providerKicker: "提供方",
      providerTitle: "NotebookLM 连接状态",
      refreshProvider: "刷新提供方",
      runLoginFlow: "重新登录",
      recommendedAction: "建议动作",
      details: "细节",
      dreamingKicker: "持久记忆",
      dreamingTitle: "自动记忆更新",
      runNow: "立即运行",
      dryRun: "试运行",
      forceRun: "强制运行",
      recentRuns: "最近记忆任务",
      scope: "范围",
      trigger: "触发来源",
      runId: "运行 ID",
      profile: "配置档",
      notebookId: "Notebook ID",
      authSource: "认证来源",
      lastValidated: "最近验证",
      lastRefresh: "最近刷新",
      nextProbe: "下次检查",
      nextRefresh: "下次刷新",
      lastSuccess: "最近成功",
      lastAttempt: "最近尝试",
      lastFailure: "最近失败",
      lastSkipReason: "最近跳过原因",
      lockOwner: "锁持有者",
      sessionId: "会话 ID",
      lastSummarizedMessage: "上次摘要消息",
      lastSummaryUpdate: "上次摘要更新时间",
      inProgress: "是否进行中",
      summariesKicker: "会话摘要",
      summariesTitle: "已保存摘要",
      refreshSummary: "刷新摘要",
      forceRefresh: "强制刷新",
      selectSession: "选择一个会话以查看它的已保存摘要。",
      currentState: "当前状态",
      taskSpecification: "任务规格",
      keyResults: "关键结果",
      errorsAndCorrections: "错误与修正",
      journalKicker: "提示词活动",
      journalTitle: "提示词活动摘要",
      summarizeJournal: "刷新提示词活动",
      topReasons: "主要提取原因",
      writeOutcomes: "写入结果",
      promptAssemblies: "Prompt 组装",
      durableExtractions: "持久提取",
      knowledgeWrites: "知识写入",
      noJournal: "Prompt journal 未启用，或没有找到文件。",
    },
    runtime: {
      registryKicker: "后台运行",
      registryTitle: "当前正在运行或需要处理的任务",
      choosePrompt: "选择一条运行后，可以查看状态、关联会话和可执行动作。",
      categoryKicker: "按类型过滤",
      categoryTitle: "当前列表要看哪类后台工作？",
      statusKicker: "按状态过滤",
      statusTitle: "现在最需要关注哪些运行？",
      queryKicker: "查找某条运行",
      queryTitle: "按代理、会话或运行 ID 过滤",
      refreshRuns: "刷新运行列表",
      taskId: "任务 ID",
      runId: "运行 ID",
      parentSession: "父会话",
      childSession: "子会话",
      updatedAt: "最近更新",
      lastCompleted: "最近完成",
      currentRun: "当前选中运行",
      contractTitle: "这条运行是如何创建的",
      detailsTitle: "运行详情",
      actionsTitle: "可执行动作",
      openSession: "打开关联会话",
      noRuns: "当前筛选条件下没有后台运行。",
      running: "运行中",
      failed: "失败",
      waiting: "等待中",
      completed: "已完成",
      attention: "需要处理",
      all: "全部",
      memory: "记忆",
      verification: "校验",
      subagents: "子代理",
      acp: "ACP",
      cron: "Cron",
      cli: "CLI",
    },
    usage: {
      queryKicker: "选择时间范围",
      queryTitle: "你想看哪一段时间的用量？",
      startDate: "开始日期",
      endDate: "结束日期",
      refreshUsage: "刷新用量",
      sessionCostKicker: "消耗资源的会话",
      sessionCostTitle: "当前范围内的会话",
      timeSeries: "时间序列",
      usageLogs: "用量日志",
      totalsTitle: "总成本与 Tokens",
      rangeSummaryTitle: "这份报告包含什么",
      noSessions: "这个时间范围内没有返回任何会话。",
      totalsEmpty: "刷新用量后，这里会显示成本和 Token 总览。",
      timeSeriesEmpty: "刷新用量后，这里会显示最近趋势。",
      logsEmpty: "刷新用量后，这里会显示最近的会话活动。",
    },
    config: {
      manifestKicker: "当前配置文件",
      manifestTitle: "配置文件状态",
      applySession: "应用会话",
      approvalsKicker: "审批规则",
      approvalsTitle: "执行策略文件",
      manifestWorkbenchKicker: "编辑设置",
      manifestWorkbenchTitle: "配置内容",
      approvalWorkbenchKicker: "编辑审批规则",
      approvalWorkbenchTitle: "审批规则",
      saveApprovals: "保存审批规则",
      configIssues: "需要修复的问题",
      approvalSnapshot: "当前审批摘要",
      issuesEmpty: "当前没有发现需要处理的配置问题。",
      issuesAction: "建议动作",
      issuesReview: "检查这个设置，修改后重新保存配置。",
      approvalsNotLoaded: "审批规则还没有加载到页面。",
      saveAndApplyTitle: "先保存，再应用",
      saveAndApplyHint: "保存会写入文件，应用会让当前运行中的网关重新读取最新配置。",
      approvalHint: "审批规则单独保存。修改安全行为时，记得一起检查这里。",
    },
    debug: {
      methodSurfaceKicker: "可用方法",
      methodSurfaceTitle: "这里可以直接调用的方法",
      preferredName: "推荐名称",
      surface: "可调用",
      statusSnapshot: "当前网关状态",
      healthSnapshot: "最近健康检查",
      manualKicker: "手动调用",
      manualTitle: "直接调用一个方法",
      method: "方法",
      params: "参数",
      noRequest: "尚未执行任何请求。",
      snapshotEmpty: "刷新或打开诊断后，这里会显示结果。",
      diagnosticsTitle: "什么时候来这里看",
      diagnosticsHint: "当普通页面解释不清问题，或者你需要直接看原始网关返回值时，再使用这里。",
    },
  },
} as const;

function normalizeShellLocale(locale?: string): ShellLocale {
  return locale === "zh-CN" ? "zh-CN" : "en";
}

function shellText(locale: Locale, key: keyof (typeof SHELL_COPY)["en"]): string {
  return SHELL_COPY[normalizeShellLocale(locale)][key];
}

function uiText(locale: Locale) {
  return APP_COPY[normalizeShellLocale(locale)];
}

function localeLabel(locale: Locale): string {
  const key =
    locale === "zh-CN"
      ? "zhCN"
      : locale === "zh-TW"
        ? "zhTW"
        : locale === "pt-BR"
          ? "ptBR"
          : locale;
  return t(`languages.${key}`);
}

function syncDocumentLocale(locale: Locale) {
  if (typeof document === "undefined") {
    return;
  }
  document.documentElement.lang = locale;
}

function formatDateTime(value?: number | null, locale?: string): string {
  if (!value) {
    return uiText((locale as Locale) ?? "en").common.na;
  }
  return new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(value);
}

function formatAgo(value?: number | null, locale: Locale = "en"): string {
  if (!value) {
    return uiText(locale).common.na;
  }
  const diffSeconds = Math.round((Date.now() - value) / 1000);
  const isZh = normalizeShellLocale(locale) === "zh-CN";
  if (Math.abs(diffSeconds) < 60) {
    return isZh ? `${diffSeconds}秒前` : `${diffSeconds}s ago`;
  }
  const diffMinutes = Math.round(diffSeconds / 60);
  if (Math.abs(diffMinutes) < 60) {
    return isZh ? `${diffMinutes}分钟前` : `${diffMinutes}m ago`;
  }
  const diffHours = Math.round(diffMinutes / 60);
  if (Math.abs(diffHours) < 48) {
    return isZh ? `${diffHours}小时前` : `${diffHours}h ago`;
  }
  const diffDays = Math.round(diffHours / 24);
  return isZh ? `${diffDays}天前` : `${diffDays}d ago`;
}

function formatJson(value: unknown): string {
  if (value == null) {
    return "null";
  }
  if (typeof value === "string") {
    return value;
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return "[unserializable]";
  }
}

function readString(value: unknown, fallback = "Unavailable"): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function readUsageCost(summary: CostUsageSummary | null): number {
  if (!summary?.totals || typeof summary.totals !== "object") {
    return 0;
  }
  const totals = summary.totals as JsonRecord;
  const candidates = ["cost", "usd", "amountUsd", "totalCostUsd"];
  for (const key of candidates) {
    const value = totals[key];
    if (typeof value === "number") {
      return value;
    }
  }
  return 0;
}

function renderMessageText(message: unknown): string {
  const text = extractText(message);
  if (typeof text === "string" && text.trim()) {
    return text.trim();
  }
  return formatJson(message);
}

function readMessageTimestamp(message: unknown): number | null {
  if (!message || typeof message !== "object") {
    return null;
  }
  const candidate = (message as JsonRecord).timestamp;
  return typeof candidate === "number" ? candidate : null;
}

function readMessageRole(message: unknown): string {
  if (!message || typeof message !== "object") {
    return "assistant";
  }
  return readString((message as JsonRecord).role, "assistant");
}

function readMessageSenderLabel(message: unknown): string | null {
  if (!message || typeof message !== "object") {
    return null;
  }
  const candidate = (message as JsonRecord).senderLabel;
  return typeof candidate === "string" && candidate.trim() ? candidate.trim() : null;
}

function isControlUiSenderLabel(label: string | null | undefined): boolean {
  const normalized = (label ?? "").trim().toLowerCase();
  return normalized === "crawclaw-control-ui" || normalized === "crawclaw control ui";
}

function resolveSessionDisplayNameFromHistory(
  session: SessionDisplayLike,
  messages: unknown[],
): string {
  const persisted = sessionDisplayName(session);
  if (typeof session.origin?.label === "string" && session.origin.label.trim()) {
    return persisted;
  }
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (readMessageRole(message).toLowerCase() !== "user") {
      continue;
    }
    const senderLabel = readMessageSenderLabel(message);
    if (!senderLabel || isControlUiSenderLabel(senderLabel)) {
      continue;
    }
    const surface = sessionSurfaceLabel(session);
    return senderLabel.toLowerCase() === surface.toLowerCase()
      ? senderLabel
      : `${surface} · ${senderLabel}`;
  }
  return persisted;
}

function describeSessionKind(kind: string | null | undefined, locale: Locale): string {
  const normalized = (kind ?? "").trim().toLowerCase();
  if (!normalized) {
    return uiText(locale).common.na;
  }
  if (normalized === "direct" || normalized === "dm") {
    return locale === "zh-CN" ? "直接聊天" : "Direct chat";
  }
  if (normalized === "group") {
    return locale === "zh-CN" ? "群组会话" : "Group chat";
  }
  if (normalized === "channel") {
    return locale === "zh-CN" ? "频道会话" : "Channel thread";
  }
  if (normalized === "global") {
    return locale === "zh-CN" ? "全局会话" : "Global session";
  }
  return normalized;
}

function compactSessionTechnicalKey(key: string | null | undefined): string | null {
  const trimmed = key?.trim();
  if (!trimmed) {
    return null;
  }
  return trimmed.length > 88 ? `${trimmed.slice(0, 44)}…${trimmed.slice(-24)}` : trimmed;
}

function countMessageBlocks(message: unknown): number {
  if (!message || typeof message !== "object") {
    return 0;
  }
  const content = (message as JsonRecord).content;
  return Array.isArray(content) ? content.length : 0;
}

function summarizeMessage(message: unknown): string {
  const text = renderMessageText(message).replace(/\s+/g, " ").trim();
  if (!text) {
    return "No message text";
  }
  return text.length > 160 ? `${text.slice(0, 157)}...` : text;
}

function imageSourcesFromMessage(message: unknown): string[] {
  if (!message || typeof message !== "object") {
    return [];
  }
  const content = (message as JsonRecord).content;
  if (!Array.isArray(content)) {
    return [];
  }
  const sources: string[] = [];
  for (const block of content) {
    if (!block || typeof block !== "object") {
      continue;
    }
    const record = block as JsonRecord;
    if (record.type !== "image") {
      continue;
    }
    const source = record.source;
    if (!source || typeof source !== "object") {
      continue;
    }
    const sourceRecord = source as JsonRecord;
    const data = typeof sourceRecord.data === "string" ? sourceRecord.data : null;
    const mimeType =
      typeof sourceRecord.media_type === "string" ? sourceRecord.media_type : "image/png";
    const url = typeof sourceRecord.url === "string" ? sourceRecord.url : null;
    if (url) {
      sources.push(url);
      continue;
    }
    if (data) {
      const normalized = data.startsWith("data:") ? data : `data:${mimeType};base64,${data}`;
      sources.push(normalized);
    }
  }
  return sources;
}

type ChatSlashMenuState =
  | { open: false }
  | { open: true; mode: "command"; items: SlashCommandDef[] }
  | { open: true; mode: "args"; command: SlashCommandDef; items: string[] };

function findSlashCommandByToken(token: string): SlashCommandDef | null {
  const normalized = token.trim().toLowerCase();
  if (!normalized) {
    return null;
  }
  return (
    SLASH_COMMANDS.find(
      (entry) =>
        entry.name.toLowerCase() === normalized ||
        entry.aliases?.some((alias) => alias.toLowerCase() === normalized),
    ) ?? null
  );
}

function resolveChatSlashMenuState(draft: string): ChatSlashMenuState {
  const value = draft.trim();
  if (!value.startsWith("/")) {
    return { open: false };
  }
  const argMatch = value.match(/^\/(\S+)\s(.*)$/);
  if (argMatch) {
    const commandName = argMatch[1]?.toLowerCase() ?? "";
    const argFilter = argMatch[2]?.trim().toLowerCase() ?? "";
    const command = findSlashCommandByToken(commandName);
    if (!command?.argOptions?.length) {
      return { open: false };
    }
    const items = argFilter
      ? command.argOptions.filter((entry) => entry.toLowerCase().startsWith(argFilter))
      : command.argOptions;
    return items.length ? { open: true, mode: "args", command, items } : { open: false };
  }
  const match = value.match(/^\/(\S*)$/);
  if (!match) {
    return { open: false };
  }
  const items = getSlashCommandCompletions(match[1] ?? "");
  return items.length ? { open: true, mode: "command", items } : { open: false };
}

function chatAttachmentName(attachment: ChatAttachment, locale: Locale): string {
  if (attachment.fileName?.trim()) {
    return attachment.fileName.trim();
  }
  const sessionsCopy = uiText(locale).sessions;
  switch (attachment.kind) {
    case "text":
      return sessionsCopy.textFile;
    case "pdf":
      return sessionsCopy.pdfFile;
    case "audio":
      return sessionsCopy.audioFile;
    default:
      return sessionsCopy.imageAttachments;
  }
}

function chatAttachmentPreviewText(attachment: ChatAttachment): string | null {
  const text = attachment.textContent?.trim();
  if (!text) {
    return null;
  }
  return text.length > 140 ? `${text.slice(0, 137)}...` : text;
}

function summarizeAttachmentKinds(params: {
  locale: Locale;
  attachments: readonly ChatAttachment[];
}): string | undefined {
  const sessionsCopy = uiText(params.locale).sessions;
  const images = params.attachments.filter((attachment) => attachment.kind === "image").length;
  const texts = params.attachments.filter((attachment) => attachment.kind === "text").length;
  const pdfs = params.attachments.filter((attachment) => attachment.kind === "pdf").length;
  const audio = params.attachments.filter((attachment) => attachment.kind === "audio").length;
  const parts = [
    images ? `${images} ${sessionsCopy.imageAttachments.toLowerCase()}` : null,
    texts ? `${texts} ${sessionsCopy.textFile.toLowerCase()}` : null,
    pdfs ? `${pdfs} ${sessionsCopy.pdfFile.toLowerCase()}` : null,
    audio ? `${audio} ${sessionsCopy.audioFile.toLowerCase()}` : null,
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : undefined;
}

function slashCategoryLabel(locale: Locale, category: string | undefined): string {
  const sessionsCopy = uiText(locale).sessions;
  switch (category) {
    case "session":
      return sessionsCopy.commandCategorySession;
    case "model":
      return sessionsCopy.commandCategoryModel;
    case "tools":
      return sessionsCopy.commandCategoryTools;
    case "agents":
      return sessionsCopy.commandCategoryAgents;
    default:
      return CATEGORY_LABELS.session;
  }
}

function resolveSessionRowByKey<T extends SessionDisplayLike>(
  sessions: readonly T[] | null | undefined,
  sessionKey?: string | null,
): T | null {
  const normalized = sessionKey?.trim();
  if (!normalized) {
    return null;
  }
  return sessions?.find((session) => session.key === normalized) ?? null;
}

function sessionReferenceDisplay(
  sessionKey: string | null | undefined,
  sessions: readonly SessionDisplayLike[] | null | undefined,
): string {
  const session = resolveSessionRowByKey(sessions, sessionKey);
  if (session) {
    return sessionDisplayName(session);
  }
  return sessionKey?.trim() || "Session";
}

function sessionReferenceHint(
  sessionKey: string | null | undefined,
  sessions: readonly SessionDisplayLike[] | null | undefined,
): string | undefined {
  const normalized = sessionKey?.trim();
  if (!normalized) {
    return undefined;
  }
  return resolveSessionRowByKey(sessions, normalized) ? normalized : undefined;
}

function flattenChannelAccounts(snapshot: ChannelsStatusSnapshot | null) {
  if (!snapshot) {
    return [] as Array<{ channelId: string; label: string; account: ChannelAccountSnapshot }>;
  }
  return snapshot.channelOrder.flatMap((channelId) =>
    (snapshot.channelAccounts[channelId] ?? []).map((account) => ({
      channelId,
      label: snapshot.channelLabels[channelId] ?? channelId,
      account,
    })),
  );
}

function resolveChannelCatalogMeta(
  snapshot: ChannelsStatusSnapshot | null | undefined,
  channelId: string | null | undefined,
): ChannelUiMetaEntry | null {
  if (!snapshot || !channelId) {
    return null;
  }
  return (
    snapshot.catalogMeta?.find((entry) => entry.id === channelId) ??
    snapshot.channelMeta?.find((entry) => entry.id === channelId) ??
    null
  );
}

function resolveChannelControls(
  snapshot: ChannelsStatusSnapshot | null | undefined,
  channelId: string | null | undefined,
): ChannelControlCapabilities {
  const controls = channelId ? snapshot?.channelControls?.[channelId] : null;
  return (
    controls ?? {
      loginMode: "none",
      actions: [],
      canReconnect: false,
      canVerify: false,
      canLogout: false,
      canEdit: false,
      canSetup: false,
      multiAccount: false,
    }
  );
}

function resolveChannelAccounts(
  snapshot: ChannelsStatusSnapshot | null | undefined,
  channelId: string | null | undefined,
): ChannelAccountSnapshot[] {
  if (!snapshot || !channelId) {
    return [];
  }
  return snapshot.channelAccounts[channelId] ?? [];
}

function resolveDefaultChannelAccount(
  snapshot: ChannelsStatusSnapshot | null | undefined,
  channelId: string | null | undefined,
): ChannelAccountSnapshot | null {
  const accounts = resolveChannelAccounts(snapshot, channelId);
  if (!channelId) {
    return accounts[0] ?? null;
  }
  const defaultAccountId = snapshot?.channelDefaultAccountId[channelId];
  return (
    (defaultAccountId
      ? accounts.find((account) => account.accountId === defaultAccountId)
      : undefined) ??
    accounts[0] ??
    null
  );
}

function asJsonRecord(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : null;
}

function resolveChannelSchemaProperty(schema: unknown, key: string): JsonRecord | null {
  const root = asJsonRecord(schema);
  const properties = asJsonRecord(root?.properties);
  return asJsonRecord(properties?.[key]);
}

function channelConfigSupportsAccountsDraft(schema: unknown): boolean {
  const accounts = resolveChannelSchemaProperty(schema, "accounts");
  const type = accounts?.type;
  return type === "object" || (Array.isArray(type) && type.includes("object"));
}

function channelConfigSupportsDefaultAccount(schema: unknown): boolean {
  return resolveChannelSchemaProperty(schema, "defaultAccount") != null;
}

function resolveNextChannelDraftAccountId(params: {
  accounts: readonly ChannelAccountSnapshot[];
  configForm: Record<string, unknown> | null;
  input: string;
}) {
  const preferred = params.input.trim();
  if (preferred) {
    return preferred;
  }
  const configAccounts = asJsonRecord(params.configForm?.accounts);
  const used = new Set([
    ...params.accounts.map((account) => account.accountId),
    ...Object.keys(configAccounts ?? {}),
  ]);
  if (!used.has("default")) {
    return "default";
  }
  let index = 2;
  let candidate = `account-${index}`;
  while (used.has(candidate)) {
    index += 1;
    candidate = `account-${index}`;
  }
  return candidate;
}

function countChannelAttentionIssues(accounts: readonly ChannelAccountSnapshot[]): number {
  return accounts.filter(
    (account) =>
      Boolean(account.lastError) ||
      account.configured === false ||
      (account.running === true && account.connected === false),
  ).length;
}

function primitiveSummary(value: unknown): string {
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (Array.isArray(value)) {
    return `${value.length}`;
  }
  if (value && typeof value === "object") {
    return `${Object.keys(value as JsonRecord).length}`;
  }
  return "Unavailable";
}

function formatMaybeDate(value: unknown, locale: Locale): string {
  return typeof value === "number" ? formatDateTime(value, locale) : uiText(locale).common.na;
}

function formatIsoDateTime(value: unknown, locale: Locale): string {
  if (typeof value !== "string" || !value.trim()) {
    return uiText(locale).common.na;
  }
  const ts = Date.parse(value);
  return Number.isFinite(ts) ? formatDateTime(ts, locale) : value;
}

function isRecentIsoDate(value: unknown, maxAgeMs: number): boolean {
  if (typeof value !== "string" || !value.trim()) {
    return false;
  }
  const ts = Date.parse(value);
  if (!Number.isFinite(ts)) {
    return false;
  }
  return Date.now() - ts <= maxAgeMs;
}

function summarizeMemoryProviderLifecycle(
  status: MemoryProviderStatus | null,
  locale: Locale = "en",
): string {
  if (!status) {
    return uiText(locale).common.pending;
  }
  if (!status.enabled) {
    return "disabled";
  }
  return status.lifecycle;
}

function summarizeMemorySummaryState(
  summary: MemorySessionSummaryStatusResult | null,
  locale: Locale,
): string {
  if (!summary?.exists) {
    return uiText(locale).common.none;
  }
  return isRecentIsoDate(summary.updatedAt, 7 * 24 * 60 * 60 * 1000) ? "active" : "stale";
}

function summarizeDreamRunReason(run: {
  status: string;
  summary?: string | null;
  error?: string | null;
}): string | null {
  if (run.status === "failed") {
    return run.error ?? run.summary ?? "failed";
  }
  return run.summary ?? null;
}

function configIssueSeverity(issue: JsonRecord | null): "error" | "warning" | "info" {
  const candidate = readString(
    issue?.severity ?? issue?.level ?? issue?.kind,
    "warning",
  ).toLowerCase();
  if (candidate.includes("error") || candidate.includes("fatal")) {
    return "error";
  }
  if (candidate.includes("info") || candidate.includes("notice")) {
    return "info";
  }
  return "warning";
}

function configIssueAction(issue: JsonRecord | null, locale: Locale): string {
  const copy = uiText(locale);
  const candidate =
    issue?.recommendedAction ??
    issue?.recommendation ??
    issue?.action ??
    issue?.fix ??
    issue?.suggestion;
  return readString(candidate, copy.config.issuesReview);
}

function debugFieldLabel(field: string, locale: Locale): string {
  const copy = uiText(locale);
  const labels: Record<string, string> = {
    ok: copy.common.status,
    status: copy.common.status,
    state: copy.common.state,
    version: shellText(locale, "gateway"),
    connected: copy.common.connected,
    heartbeat: copy.common.recentCheck,
    lastHeartbeatAt: copy.common.recentCheck,
    durationMs: copy.common.updated,
    ts: copy.common.updated,
    agentId: copy.common.agent,
    sessionKey: copy.common.session,
    modelId: copy.common.model,
    provider: copy.common.provider,
  };
  return labels[field] ?? field;
}

function heartbeatStatusLabel(status: string, locale: Locale): string {
  const normalized = status.trim().toLowerCase();
  if (locale === "zh-CN") {
    switch (normalized) {
      case "sent":
        return "已发送检查";
      case "ok-empty":
      case "ok-token":
        return "正常";
      case "skipped":
        return "已跳过";
      case "failed":
        return "失败";
      default:
        return status;
    }
  }
  switch (normalized) {
    case "sent":
      return "Check sent";
    case "ok-empty":
    case "ok-token":
      return "Healthy";
    case "skipped":
      return "Skipped";
    case "failed":
      return "Failed";
    default:
      return status;
  }
}

function countObjectKeys(value: unknown): number {
  return value && typeof value === "object" && !Array.isArray(value)
    ? Object.keys(value as JsonRecord).length
    : 0;
}

function resolvePresenceEntries(payload: unknown): PresenceEntry[] {
  if (Array.isArray(payload)) {
    return payload as PresenceEntry[];
  }
  if (
    payload &&
    typeof payload === "object" &&
    Array.isArray((payload as { entries?: unknown[] }).entries)
  ) {
    return (payload as { entries: PresenceEntry[] }).entries;
  }
  return [];
}

function pageFromCurrentLocation(basePath: string): ControlPage {
  return pageFromPath(window.location.pathname, basePath);
}

function initialRange(daysBack: number) {
  const end = new Date();
  const start = new Date();
  start.setDate(end.getDate() - daysBack);
  return {
    startDate: start.toISOString().slice(0, 10),
    endDate: end.toISOString().slice(0, 10),
  };
}

type ChannelWorkspaceMode = "guide" | "setup" | "connect" | "accounts" | "settings" | "add";

@customElement("crawclaw-app")
export class CrawClawApp extends LitElement {
  createRenderRoot() {
    return this;
  }

  @state() settings: UiSettings = loadSettings();
  @state() locale: Locale = isSupportedLocale(this.settings.locale)
    ? this.settings.locale
    : i18n.getLocale();
  @state() basePath = resolveBasePath(window.location.pathname);
  @state() tab: ControlPage = pageFromCurrentLocation(this.basePath);
  @state() onboarding = false;
  @state() connected = false;
  @state() connecting = false;
  @state() hello: GatewayHelloOk | null = null;
  @state() lastError: string | null = null;
  @state() password = "";
  @state() gatewayUrlDraft = this.settings.gatewayUrl;
  @state() gatewayTokenDraft = this.settings.token;
  @state() sidebarCollapsed = false;
  @state() sessionsQuery = "";
  @state() sessionsMaximized = false;
  @state() channelsSelectedChannelId = "";
  @state() channelsSelectedAccountId = "";
  @state() channelsAddSelectedChannelId = "";
  @state() channelsWorkspaceMode: ChannelWorkspaceMode = "guide";
  @state() channelsWorkspaceReturnMode: ChannelWorkspaceMode = "guide";
  @state() channelsEditorOpen = false;
  @state() channelsDraftAccountId = "";
  @state() systemStatus: StatusSummary | null = null;
  @state() systemPresence: PresenceEntry[] = [];
  @state() systemHeartbeat: unknown = null;
  @state() systemStatusLoading = false;
  @state() systemStatusError: string | null = null;
  @state() approvalsRaw = "{}";
  @state() approvalsError: string | null = null;
  @state() memorySessionQuery = "";
  @state() chatSlashIndex = 0;
  @state() chatSlashSuppressed = false;
  @query(".cp-chat-composer__textarea") private chatComposerTextarea!: HTMLTextAreaElement | null;

  client: GatewayBrowserClient | null = null;
  private reconnectReason: string | null = null;
  private unsubscribeLocale: (() => void) | null = null;

  readonly healthState: HealthState = {
    client: null,
    connected: false,
    healthLoading: false,
    healthResult: null,
    healthError: null,
  };

  readonly sessionsState: SessionsState = {
    client: null,
    connected: false,
    sessionsLoading: false,
    sessionsResult: null,
    sessionsError: null,
    sessionsFilterActive: "0",
    sessionsFilterLimit: "60",
    sessionsIncludeGlobal: true,
    sessionsIncludeUnknown: true,
  };

  readonly chatState: ChatState = {
    client: null,
    connected: false,
    sessionKey: this.settings.sessionKey,
    chatLoading: false,
    chatMessages: [],
    chatThinkingLevel: null,
    chatSending: false,
    chatAttachmentLoadingCount: 0,
    chatMessage: "",
    chatAttachments: [],
    chatRunId: null,
    chatStream: null,
    chatStreamStartedAt: null,
    lastError: null,
  };

  readonly channelsState: ChannelsState = {
    client: null,
    connected: false,
    channelsLoading: false,
    channelsSnapshot: null,
    channelsError: null,
    channelsLastSuccess: null,
    feishuCliStatus: null,
    feishuCliError: null,
    feishuCliLastSuccess: null,
    feishuCliSupported: null,
    whatsappLoginMessage: null,
    whatsappLoginQrDataUrl: null,
    whatsappLoginConnected: null,
    whatsappBusy: false,
  };

  readonly channelConfigState: ChannelConfigState = {
    client: null,
    connected: false,
    applySessionKey: this.settings.sessionKey,
    selectedChannelId: null,
    configLoading: false,
    configSaving: false,
    configApplying: false,
    configSnapshot: null,
    configSchema: null,
    configSchemaVersion: null,
    configSchemaLoading: false,
    configUiHints: {},
    configForm: null,
    configFormOriginal: null,
    configFormDirty: false,
    lastError: null,
  };

  readonly channelSetupState: ChannelSetupState = {
    client: null,
    connected: false,
    selectedChannelId: null,
    loading: false,
    surface: null,
    lastError: null,
  };

  readonly configState: ConfigState = {
    client: null,
    connected: false,
    applySessionKey: this.settings.sessionKey,
    configLoading: false,
    configRaw: "{\n}\n",
    configRawOriginal: "",
    configValid: null,
    configIssues: [],
    configSaving: false,
    configApplying: false,
    updateRunning: false,
    configSnapshot: null,
    configSchema: null,
    configSchemaVersion: null,
    configSchemaLoading: false,
    configUiHints: {},
    configForm: null,
    configFormOriginal: null,
    configFormDirty: false,
    configFormMode: "raw",
    configSearchQuery: "",
    configActiveSection: null,
    configActiveSubsection: null,
    lastError: null,
  };

  readonly execApprovalsState: ExecApprovalsState = {
    client: null,
    connected: false,
    execApprovalsLoading: false,
    execApprovalsSaving: false,
    execApprovalsDirty: false,
    execApprovalsSnapshot: null,
    execApprovalsForm: null,
    execApprovalsSelectedAgent: null,
    lastError: null,
  };

  readonly agentsState: AgentsState = {
    client: null,
    connected: false,
    agentsLoading: false,
    agentsError: null,
    agentsList: null,
    agentsSelectedId: null,
    toolsCatalogLoading: false,
    toolsCatalogError: null,
    toolsCatalogResult: null,
    toolsEffectiveLoading: false,
    toolsEffectiveError: null,
    toolsEffectiveResult: null,
    sessionKey: this.settings.sessionKey,
    sessionsResult: null,
    chatModelOverrides: {},
    chatModelCatalog: [],
    agentsPanel: "overview",
    chatRunId: null,
    agentInspectionLoading: false,
    agentInspectionError: null,
    agentInspectionSnapshot: null,
    agentInspectionRunId: null,
    agentInspectionTaskId: null,
  };

  readonly memoryState: MemoryState = {
    client: null,
    connected: false,
    activeSection: "provider",
    providerLoading: false,
    providerRefreshing: false,
    providerLoginBusy: false,
    providerStatus: null,
    providerError: null,
    providerActionMessage: null,
    dreamLoading: false,
    dreamError: null,
    dreamStatus: null,
    dreamActionBusy: false,
    dreamActionMessage: null,
    dreamAgent: "",
    dreamChannel: "",
    dreamUser: "",
    dreamScopeKey: "",
    summariesLoading: false,
    summariesError: null,
    summariesStatus: null,
    summariesRefreshBusy: false,
    summariesRefreshResult: null,
    summariesSelectedSessionKey: "",
    summariesSelectedSessionId: "",
    summariesAgentId: "",
    journalLoading: false,
    journalError: null,
    journalSummary: null,
    journalDays: "1",
  };

  readonly agentRuntimeState: AgentRuntimeState = {
    client: null,
    connected: false,
    runtimeLoading: false,
    runtimeError: null,
    runtimeSummary: null,
    runtimeRuns: [],
    runtimeSelectedTaskId: "",
    runtimeSelectedDetail: null,
    runtimeCategory: "all",
    runtimeStatus: "all",
    runtimeAgent: "",
    runtimeSessionKey: "",
    runtimeTaskQuery: "",
    runtimeRunQuery: "",
    runtimeActionBusy: false,
    runtimeActionMessage: null,
  };

  readonly workflowsState: WorkflowsState = {
    client: null,
    connected: false,
    workflowLoading: false,
    workflowError: null,
    workflowsList: [],
    workflowSelectedId: null,
    workflowDetailLoading: false,
    workflowDetailError: null,
    workflowDetail: null,
    workflowRunsLoading: false,
    workflowRunsError: null,
    workflowRuns: [],
    workflowVersionsLoading: false,
    workflowVersionsError: null,
    workflowVersions: null,
    workflowDiffLoading: false,
    workflowDiffError: null,
    workflowDiff: null,
    workflowEditorDraft: null,
    workflowSelectedExecutionId: null,
    workflowSelectedExecution: null,
    workflowStatusLoading: false,
    workflowStatusError: null,
    workflowActionBusyKey: null,
    workflowFilterQuery: "",
    workflowFilterState: "all",
    workflowResumeDraft: "",
  };

  readonly usageState: UsageState = {
    client: null,
    connected: false,
    usageLoading: false,
    usageResult: null,
    usageCostSummary: null,
    usageError: null,
    usageSelectedSessions: [],
    usageSelectedDays: [],
    usageTimeSeries: null,
    usageTimeSeriesLoading: false,
    usageTimeSeriesCursorStart: null,
    usageTimeSeriesCursorEnd: null,
    usageSessionLogs: null,
    usageSessionLogsLoading: false,
    usageTimeZone: "local",
    settings: { gatewayUrl: this.settings.gatewayUrl },
    usageStartDate: initialRange(7).startDate,
    usageEndDate: initialRange(7).endDate,
  };

  readonly debugState: DebugState = {
    client: null,
    connected: false,
    debugLoading: false,
    debugStatus: null,
    debugHealth: null,
    debugModels: [],
    debugHeartbeat: null,
    debugCallMethod: "system.status",
    debugCallParams: "{}",
    debugCallResult: null,
    debugCallError: null,
  };

  get sessionKey() {
    return this.settings.sessionKey;
  }

  connectedCallback() {
    super.connectedCallback();
    const preferredLocale = isSupportedLocale(this.settings.locale)
      ? this.settings.locale
      : i18n.getLocale();
    this.locale = preferredLocale;
    syncDocumentLocale(preferredLocale);
    this.unsubscribeLocale = i18n.subscribe((locale) => {
      this.locale = locale;
      syncDocumentLocale(locale);
      this.requestUpdate();
    });
    if (i18n.getLocale() !== preferredLocale) {
      void i18n.setLocale(preferredLocale);
    }
    window.addEventListener("popstate", this.handlePopState);
    document.addEventListener("pointerdown", this.handleDocumentPointerDown, true);
  }

  firstUpdated() {
    void this.connectGateway();
  }

  disconnectedCallback() {
    window.removeEventListener("popstate", this.handlePopState);
    document.removeEventListener("pointerdown", this.handleDocumentPointerDown, true);
    this.unsubscribeLocale?.();
    this.unsubscribeLocale = null;
    this.stopClient();
    super.disconnectedCallback();
  }

  applySettings(next: UiSettings) {
    const previousUrl = this.settings.gatewayUrl;
    const previousToken = this.settings.token;
    this.settings = next;
    this.gatewayUrlDraft = next.gatewayUrl;
    this.gatewayTokenDraft = next.token;
    saveSettings(next);
    this.syncControllerSlices();
    this.requestUpdate();
    if (next.gatewayUrl !== previousUrl || next.token !== previousToken) {
      void this.connectGateway();
    }
  }

  private handleLocaleChange(event: Event) {
    const nextLocale = (event.target as HTMLSelectElement).value;
    if (!isSupportedLocale(nextLocale) || nextLocale === this.locale) {
      return;
    }
    this.applySettings({ ...this.settings, locale: nextLocale });
    void i18n.setLocale(nextLocale);
  }

  private handlePopState = () => {
    this.tab = pageFromCurrentLocation(this.basePath);
    const params = new URLSearchParams(window.location.search);
    const sessionKey = params.get("session")?.trim();
    if (sessionKey && sessionKey !== this.settings.sessionKey) {
      this.applySettings({ ...this.settings, sessionKey, lastActiveSessionKey: sessionKey });
    }
    void this.loadActivePage();
  };

  private syncControllerSlices() {
    const client = this.client;
    const connected = this.connected;
    this.healthState.client = client;
    this.healthState.connected = connected;
    this.sessionsState.client = client;
    this.sessionsState.connected = connected;
    this.chatState.client = client;
    this.chatState.connected = connected;
    this.chatState.sessionKey = this.settings.sessionKey;
    this.channelsState.client = client;
    this.channelsState.connected = connected;
    this.channelConfigState.client = client;
    this.channelConfigState.connected = connected;
    this.channelConfigState.applySessionKey = this.settings.sessionKey;
    this.channelSetupState.client = client;
    this.channelSetupState.connected = connected;
    this.configState.client = client;
    this.configState.connected = connected;
    this.configState.applySessionKey = this.settings.sessionKey;
    this.execApprovalsState.client = client;
    this.execApprovalsState.connected = connected;
    this.agentsState.client = client;
    this.agentsState.connected = connected;
    this.agentsState.sessionKey = this.settings.sessionKey;
    this.agentsState.sessionsResult = this.sessionsState.sessionsResult;
    this.agentsState.chatRunId = this.chatState.chatRunId;
    this.memoryState.client = client;
    this.memoryState.connected = connected;
    this.agentRuntimeState.client = client;
    this.agentRuntimeState.connected = connected;
    this.workflowsState.client = client;
    this.workflowsState.connected = connected;
    this.usageState.client = client;
    this.usageState.connected = connected;
    this.usageState.settings = { gatewayUrl: this.settings.gatewayUrl };
    this.debugState.client = client;
    this.debugState.connected = connected;
  }

  private stopClient() {
    this.client?.stop();
    this.client = null;
    this.connected = false;
    this.connecting = false;
    this.hello = null;
    this.syncControllerSlices();
  }

  private async connectGateway() {
    this.stopClient();
    this.connecting = true;
    this.lastError = null;
    const client = new GatewayBrowserClient({
      url: this.settings.gatewayUrl,
      token: this.settings.token.trim() || undefined,
      password: this.password.trim() || undefined,
      clientName: "crawclaw-control-ui",
      clientVersion: "rewrite",
      mode: "webchat",
      onHello: (hello) => {
        if (this.client !== client) {
          return;
        }
        this.connecting = false;
        this.connected = true;
        this.hello = hello;
        this.lastError = null;
        this.syncControllerSlices();
        void this.bootstrapAfterConnect();
        this.requestUpdate();
      },
      onClose: (info) => {
        if (this.client !== client) {
          return;
        }
        this.connected = false;
        this.connecting = false;
        this.hello = null;
        this.lastError =
          info.error?.message ?? info.reason ?? shellText(this.locale, "disconnected");
        this.reconnectReason = info.reason || null;
        this.syncControllerSlices();
        this.requestUpdate();
      },
      onEvent: (evt) => {
        void this.handleGatewayEvent(evt);
      },
    });
    this.client = client;
    this.syncControllerSlices();
    client.start();
    this.requestUpdate();
  }

  private async bootstrapAfterConnect() {
    await Promise.all([
      this.refreshSystemOverview(),
      this.loadActivePage(),
      this.safeCall(async () => {
        await loadSessions(this.sessionsState, { limit: 40 });
      }),
    ]);
  }

  private async safeCall(task: () => Promise<void>) {
    try {
      await task();
    } finally {
      this.requestUpdate();
    }
  }

  private async refreshSystemOverview() {
    const client = this.client;
    if (!client || !this.connected) {
      return;
    }
    this.systemStatusLoading = true;
    this.systemStatusError = null;
    await this.safeCall(async () => {
      await loadHealthState(this.healthState);
      const statusMethod = client.hasMethod("system.status") ? "system.status" : "status";
      const heartbeatMethod = client.hasMethod("system.heartbeat.last")
        ? "system.heartbeat.last"
        : "last-heartbeat";
      const presenceMethod = client.hasMethod("system-presence") ? "system-presence" : null;
      const [status, presence, heartbeat] = await Promise.all([
        client.request<StatusSummary>(statusMethod, {}),
        presenceMethod ? client.request(presenceMethod, {}) : Promise.resolve<unknown>([]),
        client.request(heartbeatMethod, {}),
      ]);
      this.systemStatus = status ?? null;
      this.systemPresence = resolvePresenceEntries(presence);
      this.systemHeartbeat = heartbeat ?? null;
      this.systemStatusLoading = false;
    });
  }

  private async loadActivePage() {
    switch (this.tab) {
      case "overview":
        await Promise.all([
          this.refreshSystemOverview(),
          this.safeCall(async () => {
            await loadChannels(this.channelsState, false);
          }),
          this.safeCall(async () => {
            await loadSessions(this.sessionsState, { limit: 12, includeGlobal: true });
          }),
        ]);
        break;
      case "sessions":
        await Promise.all([
          this.safeCall(async () => {
            await loadSessions(this.sessionsState, { limit: 60, includeGlobal: true });
          }),
          this.safeCall(async () => {
            await loadChatHistory(this.chatState);
          }),
        ]);
        break;
      case "channels":
        await this.safeCall(async () => {
          await loadChannels(this.channelsState, true);
          const snapshot = this.channelsState.channelsSnapshot;
          const activeChannelIds = snapshot?.channelOrder ?? [];
          const catalogChannelIds = snapshot?.catalogOrder?.length
            ? snapshot.catalogOrder
            : activeChannelIds;
          const selectedChannelId = catalogChannelIds.includes(this.channelsSelectedChannelId)
            ? this.channelsSelectedChannelId
            : "";
          if (selectedChannelId && activeChannelIds.includes(selectedChannelId)) {
            await loadChannelSetupSurface(this.channelSetupState, selectedChannelId);
          } else {
            resetChannelSetupState(this.channelSetupState);
          }
        });
        break;
      case "workflows":
        await this.safeCall(async () => {
          await loadWorkflows(this.workflowsState);
        });
        break;
      case "agents":
        await this.loadAgentsSurface();
        break;
      case "memory":
        await this.loadMemorySurface();
        break;
      case "runtime":
        await this.loadAgentRuntimeSurface();
        break;
      case "usage":
        await this.safeCall(async () => {
          await loadUsage(this.usageState);
        });
        break;
      case "config":
        await Promise.all([
          this.safeCall(async () => {
            await loadConfigSchema(this.configState);
          }),
          this.safeCall(async () => {
            await loadConfig(this.configState);
          }),
          this.safeCall(async () => {
            await loadExecApprovals(this.execApprovalsState);
            this.syncApprovalsText();
          }),
        ]);
        break;
      case "debug":
        await this.safeCall(async () => {
          await loadDebug(this.debugState);
        });
        break;
    }
  }

  private async loadAgentsSurface() {
    await this.safeCall(async () => {
      await Promise.all([loadAgents(this.agentsState), loadChannels(this.channelsState, false)]);
      if (this.agentsState.agentsSelectedId) {
        await loadToolsCatalog(this.agentsState, this.agentsState.agentsSelectedId);
        await loadToolsEffective(this.agentsState, {
          agentId: this.agentsState.agentsSelectedId,
          sessionKey: this.settings.sessionKey,
        });
        if (this.chatState.chatRunId) {
          await loadAgentInspection(this.agentsState, { runId: this.chatState.chatRunId });
        }
      }
    });
  }

  private async loadMemorySurface() {
    await this.safeCall(async () => {
      await Promise.all([
        loadMemoryProvider(this.memoryState),
        loadMemoryDreaming(this.memoryState),
        loadMemoryPromptJournal(this.memoryState),
      ]);
      if (!this.sessionsState.sessionsResult) {
        await loadSessions(this.sessionsState, { limit: 40, includeGlobal: true });
      }
      const firstSession = this.sessionsState.sessionsResult?.sessions.find(
        (session) => session.key && session.kind !== "global",
      );
      if (!this.memoryState.summariesSelectedSessionKey && firstSession) {
        selectMemorySession(this.memoryState, firstSession);
      }
      if (this.memoryState.summariesSelectedSessionId) {
        await loadMemorySessionSummary(this.memoryState);
      }
    });
  }

  private async loadAgentRuntimeSurface() {
    await this.safeCall(async () => {
      await loadAgentRuntime(this.agentRuntimeState);
    });
  }

  private async handleGatewayEvent(evt: GatewayEventFrame) {
    if (evt.event === "chat") {
      handleChatEvent(this.chatState, evt.payload as Parameters<typeof handleChatEvent>[1]);
      this.requestUpdate();
      return;
    }
    if (evt.event === "presence" || evt.event === "health" || evt.event === "system.status") {
      await this.refreshSystemOverview();
      return;
    }
    if (evt.event === "sessions.changed" || evt.event === "sessions") {
      await this.safeCall(async () => {
        await loadSessions(this.sessionsState, { limit: 60, includeGlobal: true });
      });
    }
  }

  private navigate(page: ControlPage) {
    this.tab = page;
    const next = new URL(window.location.href);
    next.pathname = pathForPage(page, this.basePath);
    if (page === "sessions") {
      next.searchParams.set("session", this.settings.sessionKey);
    } else {
      next.searchParams.delete("session");
    }
    window.history.pushState({}, "", `${next.pathname}${next.search}${next.hash}`);
    void this.loadActivePage();
  }

  private async refreshChannelSetupSurface(channelId: string) {
    await this.safeCall(async () => {
      await loadChannelSetupSurface(this.channelSetupState, channelId);
    });
  }

  private async ensureChannelEditorReady(channelId: string) {
    this.channelsSelectedChannelId = channelId;
    this.channelsWorkspaceMode = "settings";
    this.channelsWorkspaceReturnMode = "settings";
    this.channelsEditorOpen = true;
    const needsReload =
      this.channelConfigState.selectedChannelId !== channelId ||
      this.channelConfigState.configSchema == null ||
      this.channelConfigState.configSnapshot == null;
    if (!needsReload) {
      return;
    }
    await Promise.all([
      loadChannelConfigSchema(this.channelConfigState, channelId),
      loadChannelConfig(this.channelConfigState, channelId),
    ]);
  }

  private openChannelSettings(
    channelId: string,
    _accountId?: string | null,
    returnMode: ChannelWorkspaceMode = this.channelsWorkspaceMode,
  ) {
    this.channelsAddSelectedChannelId = "";
    this.channelsSelectedChannelId = channelId;
    this.channelsWorkspaceMode = "settings";
    this.channelsWorkspaceReturnMode = returnMode;
    this.channelsEditorOpen = true;
    void this.safeCall(async () => {
      await Promise.all([
        loadChannelConfigSchema(this.channelConfigState, channelId),
        loadChannelConfig(this.channelConfigState, channelId),
      ]);
    });
  }

  private closeChannelSettings() {
    this.channelsEditorOpen = false;
    resetChannelConfigState(this.channelConfigState);
  }

  private leaveChannelWorkspace() {
    this.channelsAddSelectedChannelId = "";
    this.channelsSelectedChannelId = "";
    this.channelsSelectedAccountId = "";
    this.channelsWorkspaceMode = "guide";
    this.channelsWorkspaceReturnMode = "guide";
    this.channelsEditorOpen = false;
    resetChannelConfigState(this.channelConfigState);
    resetChannelSetupState(this.channelSetupState);
  }

  private selectChannel(channelId: string) {
    this.channelsAddSelectedChannelId = "";
    this.channelsSelectedChannelId = channelId;
    this.channelsSelectedAccountId = "";
    this.channelsWorkspaceMode = "guide";
    this.channelsWorkspaceReturnMode = "guide";
    this.channelsEditorOpen = false;
    resetChannelConfigState(this.channelConfigState);
    if (this.channelsState.channelsSnapshot?.channelOrder.includes(channelId)) {
      void this.refreshChannelSetupSurface(channelId);
    } else {
      resetChannelSetupState(this.channelSetupState);
    }
  }

  private selectChannelAccount(channelId: string, accountId: string) {
    this.channelsAddSelectedChannelId = "";
    this.channelsSelectedChannelId = channelId;
    this.channelsSelectedAccountId = accountId;
    this.channelsWorkspaceMode = "accounts";
  }

  private async addChannelAccountDraft(
    channelId: string,
    accounts: readonly ChannelAccountSnapshot[],
  ) {
    await this.safeCall(async () => {
      await this.ensureChannelEditorReady(channelId);
      if (!channelConfigSupportsAccountsDraft(this.channelConfigState.configSchema)) {
        this.channelSetupState.lastError =
          "This channel does not expose an accounts map for draft entries.";
        return;
      }
      const accountId = resolveNextChannelDraftAccountId({
        accounts,
        configForm: this.channelConfigState.configForm,
        input: this.channelsDraftAccountId,
      });
      const existing = asJsonRecord(this.channelConfigState.configForm?.accounts);
      if (existing?.[accountId]) {
        this.channelSetupState.lastError = `Account "${accountId}" already exists in the draft config.`;
        return;
      }
      updateChannelConfigFormValue(this.channelConfigState, ["accounts", accountId], {});
      this.channelSetupState.lastError = null;
      this.channelsDraftAccountId = "";
    });
  }

  private async makeChannelAccountDefault(channelId: string, accountId: string) {
    await this.safeCall(async () => {
      await this.ensureChannelEditorReady(channelId);
      if (!channelConfigSupportsDefaultAccount(this.channelConfigState.configSchema)) {
        this.channelSetupState.lastError =
          "This channel does not expose a default account selector in config.";
        return;
      }
      updateChannelConfigFormValue(this.channelConfigState, ["defaultAccount"], accountId);
      await applyChannelConfig(this.channelConfigState);
      await Promise.all([
        loadChannels(this.channelsState, true),
        loadChannelSetupSurface(this.channelSetupState, channelId),
      ]);
      this.channelSetupState.lastError = null;
    });
  }

  private handleGatewayFormSubmit(event: Event) {
    event.preventDefault();
    this.applySettings({
      ...this.settings,
      gatewayUrl: this.gatewayUrlDraft.trim() || this.settings.gatewayUrl,
      token: this.gatewayTokenDraft.trim(),
    });
  }

  private async handleSelectSession(key: string) {
    const nextSettings = {
      ...this.settings,
      sessionKey: key,
      lastActiveSessionKey: key,
    };
    this.applySettings(nextSettings);
    const session =
      this.sessionsState.sessionsResult?.sessions.find((entry) => entry.key === key) ?? null;
    if (session) {
      selectMemorySession(this.memoryState, session);
    }
    await this.safeCall(async () => {
      await loadChatHistory(this.chatState);
    });
  }

  private async submitCurrentChatDraft() {
    if (
      this.chatState.chatAttachmentLoadingCount > 0 ||
      (!this.chatState.chatMessage.trim() && this.chatState.chatAttachments.length === 0)
    ) {
      return;
    }
    await this.safeCall(async () => {
      await sendChatMessage(
        this.chatState,
        this.chatState.chatMessage,
        this.chatState.chatAttachments,
      );
      this.chatState.chatMessage = "";
      this.chatState.chatAttachments = [];
      this.chatSlashIndex = 0;
      this.chatSlashSuppressed = false;
    });
  }

  private async handleSendMessage(event: Event) {
    event.preventDefault();
    await this.submitCurrentChatDraft();
  }

  private readonly handleDocumentPointerDown = (event: PointerEvent) => {
    if (!this.getChatSlashMenuState().open) {
      return;
    }
    const target = event.target;
    if (!(target instanceof Element)) {
      return;
    }
    if (target.closest(".cp-chat-composer__input-shell")) {
      return;
    }
    this.chatSlashSuppressed = true;
    this.chatSlashIndex = 0;
    this.requestUpdate();
  };

  private async focusChatComposerAtEnd() {
    await this.updateComplete;
    const textarea = this.chatComposerTextarea;
    if (!textarea) {
      return;
    }
    textarea.focus({ preventScroll: true });
    const caret = textarea.value.length;
    textarea.setSelectionRange(caret, caret);
  }

  private getChatSlashMenuState(): ChatSlashMenuState {
    if (this.chatSlashSuppressed) {
      return { open: false };
    }
    return resolveChatSlashMenuState(this.chatState.chatMessage);
  }

  private async applySlashCommandSelection(command: SlashCommandDef, execute = false) {
    if (command.argOptions?.length) {
      this.chatState.chatMessage = `/${command.name} `;
      this.chatSlashSuppressed = true;
      this.chatSlashIndex = 0;
      this.requestUpdate();
      await this.focusChatComposerAtEnd();
      return;
    }
    this.chatState.chatMessage = command.args ? `/${command.name} ` : `/${command.name}`;
    this.chatSlashSuppressed = true;
    this.chatSlashIndex = 0;
    this.requestUpdate();
    if (execute && !command.args) {
      await this.submitCurrentChatDraft();
      await this.focusChatComposerAtEnd();
      return;
    }
    await this.focusChatComposerAtEnd();
  }

  private async applySlashArgumentSelection(
    command: SlashCommandDef,
    arg: string,
    execute = false,
  ) {
    this.chatState.chatMessage = `/${command.name} ${arg}`;
    this.chatSlashSuppressed = true;
    this.chatSlashIndex = 0;
    this.requestUpdate();
    if (execute) {
      await this.submitCurrentChatDraft();
      await this.focusChatComposerAtEnd();
      return;
    }
    await this.focusChatComposerAtEnd();
  }

  private async handleChatComposerKeydown(event: KeyboardEvent) {
    const slashMenu = this.getChatSlashMenuState();
    if (slashMenu.open && event.key === "Escape") {
      event.preventDefault();
      this.chatSlashSuppressed = true;
      this.chatSlashIndex = 0;
      this.requestUpdate();
      return;
    }
    if (slashMenu.open && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
      event.preventDefault();
      const direction = event.key === "ArrowDown" ? 1 : -1;
      const count = slashMenu.items.length;
      this.chatSlashIndex = (this.chatSlashIndex + direction + count) % count;
      this.requestUpdate();
      return;
    }
    if (slashMenu.open && event.key === "Tab") {
      if (slashMenu.items.length === 0) {
        return;
      }
      event.preventDefault();
      const index = Math.max(0, Math.min(this.chatSlashIndex, slashMenu.items.length - 1));
      if (slashMenu.mode === "command") {
        await this.applySlashCommandSelection(slashMenu.items[index], false);
      } else {
        await this.applySlashArgumentSelection(slashMenu.command, slashMenu.items[index], false);
      }
      return;
    }
    if (event.key === "Enter" && !event.shiftKey) {
      if (slashMenu.open) {
        if (slashMenu.items.length === 0) {
          event.preventDefault();
          return;
        }
        event.preventDefault();
        const index = Math.max(0, Math.min(this.chatSlashIndex, slashMenu.items.length - 1));
        if (slashMenu.mode === "command") {
          await this.applySlashCommandSelection(slashMenu.items[index], true);
        } else {
          await this.applySlashArgumentSelection(slashMenu.command, slashMenu.items[index], true);
        }
        return;
      }
      event.preventDefault();
      await this.submitCurrentChatDraft();
    }
  }

  private async readChatAttachments(files: Iterable<File>) {
    const candidates = Array.from(files);
    const oversizedTextFiles = new Set<string>();
    const readers = candidates
      .map((file) => ({ file, kind: getSupportedComposerAttachmentKind(file) }))
      .filter(
        (
          entry,
        ): entry is {
          file: File;
          kind: NonNullable<ReturnType<typeof getSupportedComposerAttachmentKind>>;
        } => entry.kind !== null,
      );
    if (!readers.length) {
      this.chatState.lastError = uiText(this.locale).sessions.unsupportedAttachment;
      this.requestUpdate();
      return;
    }
    this.chatState.chatAttachmentLoadingCount = readers.length;
    this.requestUpdate();
    try {
      const additions = await Promise.all(
        readers.map(
          ({ file, kind }) =>
            new Promise<ChatAttachment>((resolve, reject) => {
              const reader = new FileReader();
              reader.addEventListener("load", () => {
                const id =
                  typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
                    ? crypto.randomUUID()
                    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
                if (kind === "text") {
                  const maxChars = 40_000;
                  const rawText = typeof reader.result === "string" ? reader.result : "";
                  const truncated = rawText.length > maxChars;
                  if (truncated) {
                    oversizedTextFiles.add(file.name);
                  }
                  resolve({
                    id,
                    kind: "text",
                    dataUrl: "",
                    mimeType: file.type || "text/plain",
                    fileName: file.name,
                    textContent: truncated ? rawText.slice(0, maxChars) : rawText,
                    sizeBytes: file.size,
                    truncated,
                  });
                  return;
                }
                resolve({
                  id,
                  kind,
                  dataUrl: reader.result as string,
                  mimeType: file.type,
                  fileName: file.name,
                  sizeBytes: file.size,
                });
              });
              reader.addEventListener("error", () => reject(reader.error));
              if (kind === "text") {
                reader.readAsText(file);
                return;
              }
              reader.readAsDataURL(file);
            }),
        ),
      );
      this.chatState.chatAttachments = [...this.chatState.chatAttachments, ...additions];
      this.chatState.lastError = oversizedTextFiles.size
        ? uiText(this.locale).sessions.fileTooLarge
        : null;
    } catch (err) {
      this.chatState.lastError = err instanceof Error ? err.message : String(err);
    } finally {
      this.chatState.chatAttachmentLoadingCount = 0;
      this.requestUpdate();
    }
  }

  private async handleChatFileSelect(event: Event) {
    const input = event.target as HTMLInputElement;
    if (!input.files?.length) {
      return;
    }
    await this.readChatAttachments(input.files);
    input.value = "";
  }

  private async handleChatDrop(event: DragEvent) {
    event.preventDefault();
    if (!event.dataTransfer?.files?.length) {
      return;
    }
    await this.readChatAttachments(event.dataTransfer.files);
  }

  private async handleAbortRun() {
    await this.safeCall(async () => {
      await abortChatRun(this.chatState);
    });
  }

  private async handleSaveConfig() {
    this.configState.configFormMode = "raw";
    await this.safeCall(async () => {
      await saveConfig(this.configState);
    });
  }

  private async handleApplyConfig() {
    this.configState.configFormMode = "raw";
    await this.safeCall(async () => {
      await applyConfig(this.configState);
    });
  }

  private syncApprovalsText() {
    this.approvalsRaw = JSON.stringify(
      this.execApprovalsState.execApprovalsForm ??
        this.execApprovalsState.execApprovalsSnapshot?.file ??
        {},
      null,
      2,
    );
  }

  private async handleSaveApprovals() {
    try {
      const next = JSON.parse(this.approvalsRaw) as ExecApprovalsFile;
      this.execApprovalsState.execApprovalsForm = next;
      this.execApprovalsState.execApprovalsDirty = true;
      this.approvalsError = null;
    } catch (error) {
      this.approvalsError = String(error);
      this.requestUpdate();
      return;
    }
    await this.safeCall(async () => {
      await saveExecApprovals(this.execApprovalsState);
      this.syncApprovalsText();
    });
  }

  private async handleSelectWorkflow(workflowId: string) {
    this.workflowsState.workflowSelectedId = workflowId;
    await this.safeCall(async () => {
      await loadWorkflows(this.workflowsState, { selectWorkflow: workflowId });
    });
  }

  private async handleSelectAgent(agentId: string) {
    this.agentsState.agentsSelectedId = agentId;
    await this.loadAgentsSurface();
  }

  private async handleSelectUsageSession(sessionKey: string) {
    this.usageState.usageSelectedSessions = [sessionKey];
    await Promise.all([
      this.safeCall(async () => {
        await loadSessionTimeSeries(this.usageState, sessionKey);
      }),
      this.safeCall(async () => {
        await loadSessionLogs(this.usageState, sessionKey);
      }),
    ]);
  }

  private async activateMemorySection(section: MemorySection) {
    this.memoryState.activeSection = section;
    await this.safeCall(async () => {
      if (section === "provider") {
        await loadMemoryProvider(this.memoryState);
        return;
      }
      if (section === "dreaming") {
        await loadMemoryDreaming(this.memoryState);
        return;
      }
      if (section === "summaries") {
        if (this.memoryState.summariesSelectedSessionId) {
          await loadMemorySessionSummary(this.memoryState);
        }
        return;
      }
      await loadMemoryPromptJournal(this.memoryState);
    });
  }

  private async handleSelectMemorySession(session: GatewaySessionRow) {
    selectMemorySession(this.memoryState, session);
    this.memorySessionQuery = "";
    await this.activateMemorySection("summaries");
  }

  private async openRuntimeSession(sessionKey?: string | null) {
    const normalized = sessionKey?.trim();
    if (!normalized) {
      return;
    }
    this.applySettings({
      ...this.settings,
      sessionKey: normalized,
      lastActiveSessionKey: normalized,
    });
    this.navigate("sessions");
  }

  private renderRuntimeStatusBadge(status: string) {
    const normalized = status.trim().toLowerCase();
    const tone =
      normalized === "running"
        ? "ok"
        : normalized === "queued"
          ? "warn"
          : normalized === "failed" ||
              normalized === "timed_out" ||
              normalized === "lost" ||
              normalized === "cancelled"
            ? "danger"
            : "ok";
    return html`<span class="cp-badge cp-badge--${tone}">${status}</span>`;
  }

  private renderConnectionBadge() {
    if (this.connected) {
      return html`<span class="cp-badge cp-badge--ok"
        >${shellText(this.locale, "connected")}</span
      >`;
    }
    if (this.connecting) {
      return html`<span class="cp-badge cp-badge--warn"
        >${shellText(this.locale, "connecting")}</span
      >`;
    }
    return html`<span class="cp-badge cp-badge--danger"
      >${shellText(this.locale, "disconnected")}</span
    >`;
  }

  private renderMetric(label: string, value: string, hint?: string) {
    return html`
      <article class="cp-metric">
        <span class="cp-metric__label">${label}</span>
        <strong class="cp-metric__value">${value}</strong>
        ${hint ? html`<span class="cp-metric__hint">${hint}</span>` : nothing}
      </article>
    `;
  }

  private renderPageMetrics(metrics: Array<{ label: string; value: string; hint?: string }>) {
    return metrics.map((metric) => this.renderMetric(metric.label, metric.value, metric.hint));
  }

  private resolveHeartbeatMeta(value: unknown) {
    const copy = uiText(this.locale);
    const record = value && typeof value === "object" ? (value as JsonRecord) : null;
    const status =
      typeof record?.status === "string" && record.status.trim()
        ? heartbeatStatusLabel(record.status.trim(), this.locale)
        : copy.common.notRecorded;
    const ts = typeof record?.ts === "number" ? record.ts : null;
    const scopeParts = [record?.channel, record?.accountId].filter(
      (entry): entry is string => typeof entry === "string" && entry.trim().length > 0,
    );
    return {
      status,
      ts,
      scope: scopeParts.join(" / ") || copy.common.na,
    };
  }

  private renderMetaEntries(
    entries: Array<{ label: string; value: unknown; hint?: string }>,
    empty?: string,
  ) {
    const visible = entries.filter((entry) => entry.value !== undefined && entry.value !== null);
    if (!visible.length) {
      return empty ? html`<p class="cp-empty">${empty}</p>` : nothing;
    }
    return html`
      <div class="cp-meta-list">
        ${visible.map(
          (entry) => html`
            <div>
              <span>${entry.label}</span>
              <strong
                >${typeof entry.value === "string" ? entry.value : String(entry.value)}</strong
              >
              ${entry.hint ? html`<small>${entry.hint}</small>` : nothing}
            </div>
          `,
        )}
      </div>
    `;
  }

  private renderWorkflowExecutionPanel(execution: unknown) {
    const copy = uiText(this.locale);
    const record = execution && typeof execution === "object" ? (execution as JsonRecord) : null;
    if (!record) {
      return html`<p class="cp-empty">${copy.workflows.noExecution}</p>`;
    }
    return this.renderMetaEntries([
      {
        label: "Run ID",
        value: readString(record.executionId, readString(record.runId, copy.common.na)),
      },
      { label: copy.common.status, value: readString(record.status, copy.common.na) },
      { label: copy.common.state, value: readString(record.state, copy.common.na) },
      { label: copy.common.updated, value: formatMaybeDate(record.updatedAt, this.locale) },
      { label: "Current agent", value: readString(record.agentId, copy.common.na) },
      {
        label: "Events captured",
        value: Array.isArray(record.events) ? record.events.length : 0,
      },
    ]);
  }

  private renderWorkflowSpecPanel(spec: unknown) {
    const copy = uiText(this.locale);
    const record = spec && typeof spec === "object" ? (spec as JsonRecord) : null;
    if (!record) {
      return html`<p class="cp-empty">${copy.workflows.choosePrompt}</p>`;
    }
    return this.renderMetaEntries([
      { label: copy.workflows.goal, value: readString(record.goal, copy.common.na) },
      { label: copy.workflows.topology, value: readString(record.topology, copy.common.na) },
      { label: copy.common.steps, value: Array.isArray(record.steps) ? record.steps.length : 0 },
      {
        label: copy.common.inputs,
        value: Array.isArray(record.inputs) ? record.inputs.length : countObjectKeys(record.inputs),
      },
      {
        label: copy.common.outputs,
        value: Array.isArray(record.outputs)
          ? record.outputs.length
          : countObjectKeys(record.outputs),
      },
      {
        label: "Tags",
        value: Array.isArray(record.tags) ? record.tags.length : 0,
        hint: Array.isArray(record.tags) ? record.tags.join(", ") || undefined : undefined,
      },
    ]);
  }

  private renderAgentInspectionPanel(snapshot: unknown) {
    const copy = uiText(this.locale);
    const record = snapshot && typeof snapshot === "object" ? (snapshot as JsonRecord) : null;
    if (!record) {
      return html`<p class="cp-empty">${copy.agents.selectPrompt}</p>`;
    }
    return this.renderMetaEntries([
      { label: copy.common.agent, value: readString(record.agentId, copy.common.na) },
      { label: copy.common.model, value: readString(record.modelId, copy.common.na) },
      { label: copy.common.provider, value: readString(record.provider, copy.common.na) },
      { label: "Current run", value: readString(record.runId, copy.common.na) },
      { label: "Current task", value: readString(record.taskId, copy.common.na) },
      {
        label: "Recent events",
        value: Array.isArray(record.timeline) ? record.timeline.length : 0,
      },
    ]);
  }

  private renderToolsCatalogPanel() {
    const copy = uiText(this.locale);
    const result =
      this.agentsState.toolsCatalogResult && typeof this.agentsState.toolsCatalogResult === "object"
        ? (this.agentsState.toolsCatalogResult as JsonRecord)
        : null;
    if (!result) {
      return html`<p class="cp-empty">${copy.agents.catalogEmpty}</p>`;
    }
    const groups = Array.isArray(result.groups) ? result.groups : [];
    const profiles = Array.isArray(result.profiles) ? result.profiles : [];
    const tools = groups.reduce((sum, group) => {
      const toolsList =
        group && typeof group === "object" && Array.isArray((group as JsonRecord).tools)
          ? ((group as JsonRecord).tools as unknown[])
          : [];
      return sum + toolsList.length;
    }, 0);
    return this.renderMetaEntries([
      { label: copy.common.groups, value: groups.length },
      { label: copy.common.profiles, value: profiles.length },
      { label: copy.common.tools, value: tools },
      {
        label: copy.common.latest,
        value:
          groups[0] && typeof groups[0] === "object"
            ? readString((groups[0] as JsonRecord).label, copy.common.na)
            : copy.common.na,
      },
    ]);
  }

  private renderToolsEffectivePanel() {
    const copy = uiText(this.locale);
    const sessionRows = this.sessionsState.sessionsResult?.sessions ?? [];
    const result =
      this.agentsState.toolsEffectiveResult &&
      typeof this.agentsState.toolsEffectiveResult === "object"
        ? (this.agentsState.toolsEffectiveResult as JsonRecord)
        : null;
    if (!result) {
      return html`<p class="cp-empty">${copy.agents.effectiveToolsEmpty}</p>`;
    }
    const groups = Array.isArray(result.groups) ? result.groups : [];
    const tools = groups.reduce((sum, group) => {
      const toolsList =
        group && typeof group === "object" && Array.isArray((group as JsonRecord).tools)
          ? ((group as JsonRecord).tools as unknown[])
          : [];
      return sum + toolsList.length;
    }, 0);
    return this.renderMetaEntries([
      { label: copy.common.groups, value: groups.length },
      { label: copy.common.tools, value: tools },
      {
        label: copy.common.session,
        value: sessionReferenceDisplay(this.settings.sessionKey, sessionRows),
        hint: sessionReferenceHint(this.settings.sessionKey, sessionRows),
      },
      {
        label: copy.common.latest,
        value:
          groups[0] && typeof groups[0] === "object"
            ? readString((groups[0] as JsonRecord).label, copy.common.na)
            : copy.common.na,
      },
    ]);
  }

  private renderUsageTotalsPanel() {
    const copy = uiText(this.locale);
    const totals =
      this.usageState.usageCostSummary?.totals &&
      typeof this.usageState.usageCostSummary.totals === "object"
        ? (this.usageState.usageCostSummary.totals as JsonRecord)
        : null;
    if (!totals) {
      return html`<p class="cp-empty">${copy.usage.totalsEmpty}</p>`;
    }
    return this.renderMetaEntries([
      {
        label: copy.common.cost,
        value: `$${readUsageCost(this.usageState.usageCostSummary).toFixed(2)}`,
      },
      {
        label: copy.common.tokens,
        value: primitiveSummary(totals.totalTokens ?? totals.total_tokens),
      },
      { label: "Input", value: primitiveSummary(totals.inputTokens ?? totals.input_tokens) },
      { label: "Output", value: primitiveSummary(totals.outputTokens ?? totals.output_tokens) },
      {
        label: copy.common.daily,
        value: Array.isArray(this.usageState.usageCostSummary?.daily)
          ? this.usageState.usageCostSummary?.daily.length
          : 0,
      },
    ]);
  }

  private renderUsageTimeSeriesPanel() {
    const copy = uiText(this.locale);
    const series =
      this.usageState.usageTimeSeries && typeof this.usageState.usageTimeSeries === "object"
        ? (this.usageState.usageTimeSeries as JsonRecord)
        : null;
    if (!series) {
      return html`<p class="cp-empty">${copy.usage.timeSeriesEmpty}</p>`;
    }
    const points = Array.isArray(series.points)
      ? series.points
      : Array.isArray(series.entries)
        ? series.entries
        : [];
    const latest = points.at(-1);
    return this.renderMetaEntries([
      { label: copy.common.timeline, value: points.length },
      {
        label: copy.common.latest,
        value:
          latest && typeof latest === "object"
            ? readString(
                (latest as JsonRecord).day,
                readString((latest as JsonRecord).ts, copy.common.na),
              )
            : copy.common.na,
      },
      {
        label: copy.common.tokens,
        value:
          latest && typeof latest === "object"
            ? primitiveSummary(
                (latest as JsonRecord).totalTokens ?? (latest as JsonRecord).total_tokens,
              )
            : copy.common.na,
      },
    ]);
  }

  private renderUsageLogsPanel() {
    const copy = uiText(this.locale);
    const logs = Array.isArray(this.usageState.usageSessionLogs)
      ? this.usageState.usageSessionLogs
      : [];
    const latest = logs[0] && typeof logs[0] === "object" ? (logs[0] as JsonRecord) : null;
    return this.renderMetaEntries(
      [
        { label: copy.common.logs, value: logs.length },
        {
          label: copy.common.latest,
          value: latest ? formatMaybeDate(latest.ts, this.locale) : copy.common.na,
        },
        {
          label: copy.common.session,
          value: latest ? readString(latest.sessionKey, copy.common.na) : copy.common.na,
        },
        {
          label: copy.common.role,
          value: latest ? readString(latest.role, copy.common.na) : copy.common.na,
        },
      ],
      copy.usage.logsEmpty,
    );
  }

  private renderConfigIssuesPanel() {
    const copy = uiText(this.locale);
    const issues = Array.isArray(this.configState.configIssues)
      ? this.configState.configIssues
      : [];
    if (!issues.length) {
      return html`<p class="cp-empty">${copy.config.issuesEmpty}</p>`;
    }
    return html`
      <div class="cp-list cp-list--dense cp-issue-list">
        ${issues.map((issue) => {
          const record = issue && typeof issue === "object" ? (issue as JsonRecord) : null;
          const severity = configIssueSeverity(record);
          return html`
            <div class="cp-list-item cp-issue-item">
              <div class="cp-issue-item__head">
                <strong>${readString(record?.path, copy.common.na)}</strong>
                <span class="cp-issue-badge cp-issue-badge--${severity}">${severity}</span>
              </div>
              <small>${readString(record?.message, copy.common.na)}</small>
              <small
                ><span>${copy.config.issuesAction}: </span>${configIssueAction(
                  record,
                  this.locale,
                )}</small
              >
            </div>
          `;
        })}
      </div>
    `;
  }

  private renderApprovalsSnapshotPanel() {
    const copy = uiText(this.locale);
    if (this.approvalsError) {
      return html`<p class="cp-empty">${this.approvalsError}</p>`;
    }
    const snapshot = this.execApprovalsState.execApprovalsSnapshot;
    if (!snapshot) {
      return html`<p class="cp-empty">${copy.config.approvalsNotLoaded}</p>`;
    }
    return this.renderMetaEntries([
      { label: copy.common.path, value: snapshot.path },
      { label: copy.common.hash, value: snapshot.hash },
      { label: copy.common.exists, value: snapshot.exists ? copy.common.yes : copy.common.no },
      {
        label: copy.common.agent,
        value: countObjectKeys(snapshot.file?.agents),
      },
      {
        label: copy.common.defaultAgent,
        value: readString(snapshot.file?.defaults?.security, copy.common.na),
      },
    ]);
  }

  private renderDebugSnapshotPanel(value: unknown, titleFallback: string) {
    const copy = uiText(this.locale);
    const record = value && typeof value === "object" ? (value as JsonRecord) : null;
    if (!record) {
      return html`<p class="cp-empty">${copy.debug.snapshotEmpty}</p>`;
    }
    const entries: Array<{ label: string; value: string; hint?: string }> = Object.entries(record)
      .filter(([, entry]) => ["string", "number", "boolean"].includes(typeof entry))
      .slice(0, 6)
      .map(([key, entry]) => ({
        label: debugFieldLabel(key, this.locale),
        value: primitiveSummary(entry),
      }));
    if (!entries.length) {
      entries.push({
        label: copy.common.summary,
        value: titleFallback,
        hint: `${Object.keys(record).length} keys`,
      });
    }
    return this.renderMetaEntries(entries);
  }

  private renderPageHeader(
    page: ControlPage,
    metrics: Array<{ label: string; value: string; hint?: string }> = [],
  ) {
    const meta = metaForPage(page, this.locale);
    return html`
      <header class="cp-page-head">
        <div class="cp-page-head__copy">
          <span class="cp-page-head__eyebrow">${meta.eyebrow}</span>
          <h1>${meta.label}</h1>
          <p>${meta.headline}</p>
          <small>${meta.subheadline}</small>
        </div>
        <div class="cp-page-head__stats">${this.renderPageMetrics(metrics)}</div>
      </header>
    `;
  }

  private renderConnectionWorkbench() {
    const copy = uiText(this.locale);
    return html`
      <section class="cp-panel cp-panel--hero">
        <div class="cp-panel__head">
          <div>
            <span class="cp-kicker">${copy.connection.kicker}</span>
            <h3>${copy.connection.title}</h3>
          </div>
        </div>
        <form class="cp-form" @submit=${(event: Event) => this.handleGatewayFormSubmit(event)}>
          <label>
            <span>${copy.connection.endpoint}</span>
            <input
              .value=${this.gatewayUrlDraft}
              @input=${(event: Event) => {
                this.gatewayUrlDraft = (event.target as HTMLInputElement).value;
              }}
            />
          </label>
          <label>
            <span>${copy.connection.token}</span>
            <input
              .value=${this.gatewayTokenDraft}
              @input=${(event: Event) => {
                this.gatewayTokenDraft = (event.target as HTMLInputElement).value;
              }}
            />
          </label>
          <label>
            <span>${copy.connection.password}</span>
            <input
              type="password"
              .value=${this.password}
              @input=${(event: Event) => {
                this.password = (event.target as HTMLInputElement).value;
              }}
            />
          </label>
          <div class="cp-form__actions">
            <button class="cp-button cp-button--primary" type="submit">
              ${shellText(this.locale, "reconnect")}
            </button>
          </div>
        </form>
      </section>
    `;
  }

  private renderOverview() {
    const copy = uiText(this.locale);
    const sessions = this.sessionsState.sessionsResult?.sessions ?? [];
    const channels = flattenChannelAccounts(this.channelsState.channelsSnapshot);
    const heartbeat = this.resolveHeartbeatMeta(this.systemHeartbeat);
    const providerStatus = this.memoryState.providerStatus;
    const memoryLifecycle = summarizeMemoryProviderLifecycle(providerStatus, this.locale);
    const memoryAction = providerStatus?.recommendedAction ?? copy.common.none;
    const gatewayVersion = readString(
      this.hello?.server?.version,
      shellText(this.locale, "gatewayPending"),
    );
    const attentionItems: Array<{ title: string; detail: string; page?: ControlPage }> = [];
    if (this.channelsState.channelsError) {
      attentionItems.push({
        title: copy.overview.openChannels,
        detail: this.channelsState.channelsError,
        page: "channels",
      });
    }
    if (this.configState.configFormDirty || this.execApprovalsState.execApprovalsDirty) {
      attentionItems.push({
        title: copy.overview.reviewConfig,
        detail: this.execApprovalsState.execApprovalsDirty
          ? copy.config.approvalsTitle
          : copy.config.manifestTitle,
        page: "config",
      });
    }
    if (providerStatus && (!providerStatus.ready || providerStatus.recommendedAction)) {
      attentionItems.push({
        title: copy.overview.openMemory,
        detail: memoryAction,
        page: "memory",
      });
    }
    if (this.channelsState.feishuCliError || this.channelsState.feishuCliStatus?.authOk === false) {
      attentionItems.push({
        title: copy.overview.openAgents,
        detail:
          this.channelsState.feishuCliError ??
          this.channelsState.feishuCliStatus?.message ??
          this.channelsState.feishuCliStatus?.status ??
          copy.common.none,
        page: "agents",
      });
    }
    return html`
      <section class="cp-page cp-page--overview">
        ${this.renderPageHeader("overview", [
          {
            label: copy.overview.healthy,
            value: this.healthState.healthResult?.ok ? copy.common.yes : copy.common.no,
            hint:
              this.healthState.healthResult?.durationMs != null
                ? `${this.healthState.healthResult.durationMs}ms`
                : undefined,
          },
          {
            label: copy.common.sessions,
            value: String(this.healthState.healthResult?.sessions.count ?? sessions.length),
            hint: this.healthState.healthResult?.sessions.path ?? copy.overview.sessionStore,
          },
          {
            label: copy.common.accounts,
            value: String(channels.length),
            hint: copy.overview.surfacesHint.replace(
              "{count}",
              String(this.channelsState.channelsSnapshot?.channelOrder.length ?? 0),
            ),
          },
          {
            label: copy.common.recentActivity,
            value: heartbeat.status,
            hint: heartbeat.ts ? formatAgo(heartbeat.ts, this.locale) : copy.common.notRecorded,
          },
        ])}
        <div class="cp-stage cp-stage--overview">
          <div class="cp-stage__main">
            <section class="cp-band">
              ${this.renderMetric(
                shellText(this.locale, "gateway"),
                gatewayVersion,
                this.connected ? copy.common.live : t("common.offline"),
              )}
              ${this.renderMetric(
                copy.common.methods,
                String(this.hello?.features?.methods?.length ?? 0),
              )}
              ${this.renderMetric(
                copy.overview.presenceClients,
                String(this.systemPresence.length),
                this.connected ? copy.common.live : t("common.offline"),
              )}
              ${this.renderMetric(
                copy.common.recentActivity,
                heartbeat.ts ? formatAgo(heartbeat.ts, this.locale) : copy.common.notRecorded,
                heartbeat.scope,
              )}
            </section>

            <section class="cp-grid cp-grid--double">
              <article class="cp-panel">
                <div class="cp-panel__head">
                  <div>
                    <span class="cp-kicker">${copy.overview.runtimeKicker}</span>
                    <h3>${copy.overview.runtimeTitle}</h3>
                  </div>
                  <button class="cp-button" @click=${() => void this.refreshSystemOverview()}>
                    ${copy.common.refresh}
                  </button>
                </div>
                <div class="cp-meta-list">
                  <div>
                    <span>${shellText(this.locale, "gateway")}</span
                    ><strong>${gatewayVersion}</strong>
                  </div>
                  <div>
                    <span>${copy.common.backgroundCheck}</span><strong>${heartbeat.status}</strong>
                  </div>
                  <div>
                    <span>${copy.common.updated}</span
                    ><strong
                      >${heartbeat.ts
                        ? formatDateTime(heartbeat.ts, this.locale)
                        : copy.common.notRecorded}</strong
                    >
                  </div>
                  <div>
                    <span>${copy.overview.error}</span
                    ><strong>${this.lastError ?? this.reconnectReason ?? copy.common.none}</strong>
                  </div>
                </div>
              </article>

              <article class="cp-panel">
                <div class="cp-panel__head">
                  <div>
                    <span class="cp-kicker">${copy.overview.controlKicker}</span>
                    <h3>${copy.overview.controlTitle}</h3>
                  </div>
                </div>
                <div class="cp-action-stack">
                  <button class="cp-action-card" @click=${() => this.navigate("sessions")}>
                    <span>${copy.overview.openSessions}</span>
                    <small>
                      ${copy.overview.trackedSessions.replace("{count}", String(sessions.length))}
                    </small>
                  </button>
                  <button class="cp-action-card" @click=${() => this.navigate("config")}>
                    <span>${copy.overview.reviewConfig}</span>
                    <small>
                      ${this.configState.configSnapshot?.path ?? copy.overview.manifestWorkbench}
                    </small>
                  </button>
                  <button class="cp-action-card" @click=${() => this.navigate("channels")}>
                    <span>${copy.overview.openChannels}</span>
                    <small>
                      ${copy.overview.surfacesHint.replace(
                        "{count}",
                        String(this.channelsState.channelsSnapshot?.channelOrder.length ?? 0),
                      )}
                    </small>
                  </button>
                  <button class="cp-action-card" @click=${() => this.navigate("memory")}>
                    <span>${copy.overview.openMemory}</span>
                    <small>${memoryAction}</small>
                  </button>
                  <button class="cp-action-card" @click=${() => this.navigate("workflows")}>
                    <span>${copy.overview.inspectWorkflows}</span>
                    <small>
                      ${copy.overview.workflowCount.replace(
                        "{count}",
                        String(this.workflowsState.workflowsList.length),
                      )}
                    </small>
                  </button>
                </div>
              </article>

              <article class="cp-panel">
                <div class="cp-panel__head">
                  <div>
                    <span class="cp-kicker">${copy.overview.attentionKicker}</span>
                    <h3>${copy.overview.attentionTitle}</h3>
                  </div>
                </div>
                ${attentionItems.length
                  ? html`
                      <div class="cp-action-stack">
                        ${attentionItems.map(
                          (item) => html`
                            <button
                              class="cp-action-card"
                              ?disabled=${!item.page}
                              @click=${() => {
                                if (item.page) {
                                  this.navigate(item.page);
                                }
                              }}
                            >
                              <span>${item.title}</span>
                              <small>${item.detail}</small>
                            </button>
                          `,
                        )}
                      </div>
                    `
                  : html`<p class="cp-empty">${copy.overview.everythingHealthy}</p>`}
              </article>

              <article class="cp-panel">
                <div class="cp-panel__head">
                  <div>
                    <span class="cp-kicker">${copy.overview.memoryHealth}</span>
                    <h3>${copy.overview.openMemory}</h3>
                  </div>
                </div>
                <div class="cp-meta-list">
                  <div><span>${copy.memory.provider}</span><strong>${memoryLifecycle}</strong></div>
                  <div>
                    <span>${copy.memory.sessionSummaries}</span
                    ><strong
                      >${summarizeMemorySummaryState(
                        this.memoryState.summariesStatus,
                        this.locale,
                      )}</strong
                    >
                  </div>
                  <div>
                    <span>${copy.overview.recommendedAction}</span><strong>${memoryAction}</strong>
                  </div>
                  <div>
                    <span>${copy.common.updated}</span
                    ><strong
                      >${formatIsoDateTime(providerStatus?.lastValidatedAt, this.locale)}</strong
                    >
                  </div>
                </div>
              </article>
            </section>

            <article class="cp-panel">
              <div class="cp-panel__head">
                <div>
                  <span class="cp-kicker">${copy.overview.recentKicker}</span>
                  <h3>${copy.overview.recentTitle}</h3>
                </div>
              </div>
              <div class="cp-table-wrap">
                <table class="cp-table">
                  <thead>
                    <tr>
                      <th>${copy.common.session}</th>
                      <th>${copy.common.kind}</th>
                      <th>${copy.common.status}</th>
                      <th>${copy.common.updated}</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${sessions.length
                      ? repeat(
                          sessions.slice(0, 10),
                          (session) => session.key,
                          (session) => html`
                            <tr @click=${() => void this.handleSelectSession(session.key)}>
                              <td>
                                <strong>${sessionDisplayName(session)}</strong>
                                <small>${sessionSurfaceLabel(session)} · ${session.kind}</small>
                              </td>
                              <td>${session.kind}</td>
                              <td>${session.status ?? copy.common.idle}</td>
                              <td>${formatAgo(session.updatedAt, this.locale)}</td>
                            </tr>
                          `,
                        )
                      : html`
                          <tr>
                            <td colspan="4"><p class="cp-empty">${copy.sessions.noSessions}</p></td>
                          </tr>
                        `}
                  </tbody>
                </table>
              </div>
            </article>
          </div>

          <aside class="cp-stage__rail">
            <article class="cp-panel">
              <div class="cp-panel__head">
                <div>
                  <span class="cp-kicker">${copy.overview.presenceKicker}</span>
                  <h3>${copy.overview.presenceTitle}</h3>
                </div>
              </div>
              <div class="cp-list">
                ${this.systemPresence.length
                  ? repeat(
                      this.systemPresence,
                      (_, index) => index,
                      (entry) => html`
                        <div class="cp-list-item">
                          <strong
                            >${entry.instanceId ?? entry.host ?? copy.overview.controlUi}</strong
                          >
                          <small>${entry.text ?? entry.mode ?? copy.overview.operator}</small>
                        </div>
                      `,
                    )
                  : html`<p class="cp-empty">${copy.overview.noPresence}</p>`}
              </div>
            </article>
            ${!this.connected ? this.renderConnectionWorkbench() : nothing}
          </aside>
        </div>
      </section>
    `;
  }

  private renderSessions() {
    const copy = uiText(this.locale);
    const sessions = this.sessionsState.sessionsResult?.sessions ?? [];
    const selected = sessions.find((entry) => entry.key === this.settings.sessionKey) ?? null;
    const query = this.sessionsQuery.trim().toLowerCase();
    const filteredSessions = query
      ? sessions.filter((session) => {
          const haystack = [
            session.key,
            session.channel,
            session.origin?.label,
            session.origin?.surface,
            session.origin?.provider,
            session.displayName,
            session.label,
            session.surface,
            session.subject,
            session.room,
            session.space,
            sessionDisplayName(session),
          ]
            .filter(
              (value): value is string => typeof value === "string" && value.trim().length > 0,
            )
            .join(" ")
            .toLowerCase();
          return haystack.includes(query);
        })
      : sessions;
    const lastMessage = this.chatState.chatMessages.at(-1) ?? null;
    const lastMessageTimestamp = readMessageTimestamp(lastMessage);
    const lastMessageRole = readMessageRole(lastMessage);
    const lastMessageSummary = lastMessage ? summarizeMessage(lastMessage) : copy.common.none;
    const runtimeState = this.chatState.chatStream
      ? copy.sessions.streaming
      : this.chatState.chatSending
        ? copy.common.pending
        : (selected?.status ?? copy.common.idle);
    const historyBusy = this.chatState.chatLoading;
    const attachmentsBusy = this.chatState.chatAttachmentLoadingCount > 0;
    const sendBusy = this.chatState.chatSending;
    const composerBusy = attachmentsBusy || sendBusy;
    const selectedModel = selected?.model ?? this.sessionsState.sessionsResult?.defaults?.model;
    const selectedProvider =
      selected?.modelProvider ?? this.sessionsState.sessionsResult?.defaults?.modelProvider;
    const draftLength = this.chatState.chatMessage.trim().length;
    const attachmentCount = this.chatState.chatAttachments.length;
    const attachmentSummaryHint = summarizeAttachmentKinds({
      locale: this.locale,
      attachments: this.chatState.chatAttachments,
    });
    const slashMenu = this.getChatSlashMenuState();
    const normalizedSlashIndex =
      slashMenu.open && slashMenu.items.length > 0
        ? Math.max(0, Math.min(this.chatSlashIndex, slashMenu.items.length - 1))
        : 0;
    const slashMenuGroups =
      slashMenu.open && slashMenu.mode === "command"
        ? Array.from(
            slashMenu.items.reduce((map, item, index) => {
              const category = item.category ?? "session";
              const entries = map.get(category) ?? [];
              entries.push({ item, index });
              map.set(category, entries);
              return map;
            }, new Map<string, Array<{ item: SlashCommandDef; index: number }>>()),
          )
        : [];
    const selectedDisplayName = selected
      ? resolveSessionDisplayNameFromHistory(selected, this.chatState.chatMessages)
      : this.settings.sessionKey;
    const selectedKindLabel = selected
      ? describeSessionKind(selected.chatType ?? selected.kind, this.locale)
      : copy.common.na;
    const selectedSurfaceLabel = selected ? sessionSurfaceLabel(selected) : copy.common.na;
    const selectedSurfaceRaw = selected ? sessionSurfaceKey(selected) : null;
    const selectedSurfaceHint =
      selected && selectedSurfaceRaw
        ? selectedSurfaceRaw.trim().toLowerCase() === selectedSurfaceLabel.trim().toLowerCase()
          ? undefined
          : selectedSurfaceRaw
        : undefined;
    const selectedUsageHint =
      selected?.inputTokens != null || selected?.outputTokens != null
        ? `${selected.inputTokens ?? 0} in / ${selected.outputTokens ?? 0} out`
        : selected?.totalTokensFresh
          ? copy.common.live
          : copy.common.summary;
    const selectedTechnicalKey = compactSessionTechnicalKey(selected?.key);
    return html`
      <section class="cp-page cp-page--sessions">
        ${this.renderPageHeader("sessions", [
          {
            label: copy.sessions.focusedSession,
            value: selectedDisplayName,
            hint: selected?.key,
          },
          {
            label: copy.common.sessions,
            value: String(sessions.length),
          },
          {
            label: copy.common.messages,
            value: String(this.chatState.chatMessages.length),
            hint: this.chatState.chatStream ? copy.sessions.streaming : undefined,
          },
          {
            label: copy.common.execution,
            value: this.chatState.chatRunId ?? copy.common.none,
            hint: selected?.status ?? copy.common.idle,
          },
        ])}
        <div class="cp-session-console ${this.sessionsMaximized ? "is-maximized" : ""}">
          <aside class="cp-session-console__rail">
            <article class="cp-panel cp-panel--fill cp-panel--rail">
              <div class="cp-panel__head">
                <div>
                  <span class="cp-kicker">${copy.sessions.registryKicker}</span>
                  <h3>${copy.sessions.registryTitle}</h3>
                </div>
                <button
                  class="cp-button"
                  @click=${() =>
                    void this.safeCall(async () => {
                      await loadSessions(this.sessionsState, { limit: 60 });
                    })}
                >
                  ${copy.common.reload}
                </button>
              </div>
              <label class="cp-session-console__search">
                <span
                  >${copy.sessions.inventoryMatches.replace(
                    "{count}",
                    String(filteredSessions.length),
                  )}</span
                >
                <input
                  .value=${this.sessionsQuery}
                  placeholder=${copy.sessions.searchPlaceholder}
                  @input=${(event: Event) => {
                    this.sessionsQuery = (event.target as HTMLInputElement).value;
                  }}
                />
              </label>
              <div class="cp-list cp-list--dense cp-session-console__list">
                ${filteredSessions.length
                  ? repeat(
                      filteredSessions,
                      (session) => session.key,
                      (session) => html`
                        <button
                          class="cp-session-item ${session.key === this.settings.sessionKey
                            ? "is-active"
                            : ""}"
                          @click=${() => void this.handleSelectSession(session.key)}
                        >
                          <strong>${sessionDisplayName(session)}</strong>
                          <span>${sessionSurfaceLabel(session)}</span>
                          <small>
                            ${session.status ?? copy.common.idle} ·
                            ${formatAgo(session.updatedAt, this.locale)}
                          </small>
                        </button>
                      `,
                    )
                  : html`<p class="cp-empty">${copy.sessions.noSessions}</p>`}
              </div>
            </article>
          </aside>

          <main class="cp-session-console__main">
            <section class="cp-band cp-band--sessions">
              ${this.renderMetric(copy.common.status, runtimeState, selected?.status ?? undefined)}
              ${this.renderMetric(
                copy.common.provider,
                selectedProvider ?? copy.common.auto,
                selectedModel ?? copy.common.default,
              )}
              ${this.renderMetric(
                copy.common.tokens,
                String(selected?.totalTokens ?? 0),
                selected?.totalTokensFresh ? copy.common.live : copy.common.summary,
              )}
              ${this.renderMetric(
                copy.common.updated,
                selected?.updatedAt
                  ? formatDateTime(selected.updatedAt, this.locale)
                  : copy.common.pending,
                selected?.updatedAt ? formatAgo(selected.updatedAt, this.locale) : undefined,
              )}
            </section>

            <section class="cp-session-signal-strip">
              <article class="cp-session-signal-card">
                <span>${copy.common.session}</span>
                <strong>${selected ? selectedDisplayName : copy.common.none}</strong>
                <small
                  >${selected ? sessionSurfaceLabel(selected) : this.settings.sessionKey}</small
                >
              </article>
              <article class="cp-session-signal-card">
                <span>${copy.common.latest}</span>
                <strong>${lastMessageRole ?? copy.common.none}</strong>
                <small>
                  ${lastMessageTimestamp
                    ? formatAgo(lastMessageTimestamp, this.locale)
                    : copy.common.pending}
                </small>
              </article>
              <article class="cp-session-signal-card">
                <span>${copy.common.summary}</span>
                <strong
                  >${lastMessage ? countMessageBlocks(lastMessage) : 0}
                  ${copy.sessions.blocks}</strong
                >
                <small>${lastMessageSummary}</small>
              </article>
              <article class="cp-session-signal-card">
                <span>${copy.common.execution}</span>
                <strong>${this.chatState.chatRunId ?? copy.common.none}</strong>
                <small>${draftLength} / ${attachmentCount} ${copy.sessions.attachments}</small>
              </article>
            </section>

            <article class="cp-panel cp-panel--fill cp-session-console__thread-panel">
              <div class="cp-panel__head">
                <div>
                  <span class="cp-kicker">${copy.sessions.conversationKicker}</span>
                  <h3>${copy.sessions.conversationTitle}</h3>
                  <p class="cp-panel__subcopy">
                    ${selected
                      ? `${selectedDisplayName} · ${selected.status ?? copy.common.idle}`
                      : this.settings.sessionKey}
                  </p>
                </div>
                <div class="cp-inline-actions">
                  <button
                    class="cp-button"
                    type="button"
                    @click=${() => {
                      this.sessionsMaximized = !this.sessionsMaximized;
                    }}
                  >
                    ${this.sessionsMaximized ? copy.sessions.restore : copy.sessions.maximize}
                  </button>
                  <button
                    class="cp-button"
                    @click=${() =>
                      void this.safeCall(async () => {
                        await loadChatHistory(this.chatState);
                      })}
                  >
                    ${copy.sessions.refreshHistory}
                  </button>
                  <button
                    class="cp-button cp-button--danger"
                    @click=${() => void this.handleAbortRun()}
                  >
                    ${copy.sessions.abortRun}
                  </button>
                </div>
              </div>

              <div class="cp-chat-thread cp-chat-thread--console">
                ${historyBusy
                  ? html`
                      <div class="cp-chat-loading-strip" role="status" aria-live="polite">
                        <span class="cp-chat-loading-strip__dot" aria-hidden="true"></span>
                        <div>
                          <strong>${copy.sessions.historyLoading}</strong>
                          <small>${copy.sessions.historyLoadingHint}</small>
                        </div>
                      </div>
                    `
                  : nothing}
                ${this.chatState.chatMessages.length
                  ? repeat(
                      this.chatState.chatMessages,
                      (_, index) => index,
                      (message) => html`
                        <article class="cp-chat-entry cp-chat-entry--${readMessageRole(message)}">
                          <div class="cp-chat-entry__meta">
                            <strong>${readMessageRole(message)}</strong>
                            <span>
                              ${readMessageTimestamp(message)
                                ? formatDateTime(readMessageTimestamp(message), this.locale)
                                : copy.common.pending}
                            </span>
                            ${countMessageBlocks(message)
                              ? html`
                                  <small>
                                    ${countMessageBlocks(message)} ${copy.sessions.blocks}
                                  </small>
                                `
                              : nothing}
                          </div>
                          <div class="cp-chat-entry__body">
                            ${imageSourcesFromMessage(message).length
                              ? html`
                                  <div class="cp-chat-entry__images">
                                    ${repeat(
                                      imageSourcesFromMessage(message),
                                      (source) => source,
                                      (source) => html`
                                        <img src=${source} alt=${copy.sessions.imageAttachments} />
                                      `,
                                    )}
                                  </div>
                                `
                              : nothing}
                            <p>${renderMessageText(message)}</p>
                          </div>
                        </article>
                      `,
                    )
                  : historyBusy
                    ? html`
                        <div class="cp-chat-thread__skeletons" aria-hidden="true">
                          <div class="cp-chat-skeleton cp-chat-skeleton--assistant"></div>
                          <div class="cp-chat-skeleton cp-chat-skeleton--user"></div>
                          <div class="cp-chat-skeleton cp-chat-skeleton--assistant"></div>
                        </div>
                      `
                    : html`<p class="cp-empty">${copy.sessions.noMessages}</p>`}
                ${this.chatState.chatStream
                  ? html`
                      <article class="cp-chat-entry cp-chat-entry--stream">
                        <div class="cp-chat-entry__meta">
                          <strong>assistant</strong>
                          <span>${copy.sessions.streaming}</span>
                          ${this.chatState.chatStreamStartedAt
                            ? html`
                                <small>
                                  ${formatAgo(this.chatState.chatStreamStartedAt, this.locale)}
                                </small>
                              `
                            : nothing}
                        </div>
                        <div class="cp-chat-entry__body">
                          <p>${this.chatState.chatStream}</p>
                        </div>
                      </article>
                    `
                  : nothing}
              </div>

              <form
                class="cp-chat-composer cp-chat-composer--console"
                @submit=${(event: Event) => this.handleSendMessage(event)}
                @drop=${(event: DragEvent) => void this.handleChatDrop(event)}
                @dragover=${(event: DragEvent) => event.preventDefault()}
              >
                <div class="cp-chat-composer__surface">
                  <div class="cp-chat-composer__head">
                    <div>
                      <span class="cp-kicker">${copy.sessions.composerKicker}</span>
                      <h4>${copy.sessions.composerTitle}</h4>
                    </div>
                    <div class="cp-chat-composer__meta">
                      <span> ${copy.sessions.draftLength}: ${draftLength} </span>
                      <span>
                        ${copy.common.execution}: ${this.chatState.chatRunId ?? copy.common.none}
                      </span>
                      <span> ${copy.sessions.attachments}: ${attachmentCount} </span>
                    </div>
                  </div>
                  ${composerBusy
                    ? html`
                        <div
                          class="cp-chat-loading-strip cp-chat-loading-strip--composer"
                          role="status"
                          aria-live="polite"
                        >
                          <span class="cp-chat-loading-strip__dot" aria-hidden="true"></span>
                          <div>
                            <strong>
                              ${attachmentsBusy
                                ? copy.sessions.preparingAttachments
                                : copy.sessions.sendingNow}
                            </strong>
                            <small>
                              ${attachmentsBusy
                                ? copy.sessions.preparingAttachmentsHint.replace(
                                    "{count}",
                                    String(this.chatState.chatAttachmentLoadingCount),
                                  )
                                : copy.sessions.sendingNowHint}
                            </small>
                          </div>
                        </div>
                      `
                    : nothing}
                  <div class="cp-chat-attachments-toolbar">
                    <label class="cp-button cp-button--ghost cp-chat-attachments-toolbar__picker">
                      <input
                        type="file"
                        accept=${CHAT_COMPOSER_ATTACHMENT_ACCEPT}
                        multiple
                        ?disabled=${composerBusy}
                        @change=${(event: Event) => void this.handleChatFileSelect(event)}
                      />
                      <span>
                        ${attachmentsBusy
                          ? copy.sessions.preparingAttachments
                          : copy.sessions.attachFiles}
                      </span>
                    </label>
                    <span class="cp-chat-attachments-toolbar__hint">${copy.sessions.dragHint}</span>
                    ${this.chatState.chatAttachments.length
                      ? html`
                          <button
                            class="cp-button cp-button--ghost"
                            type="button"
                            @click=${() => {
                              this.chatState.chatAttachments = [];
                              this.requestUpdate();
                            }}
                          >
                            ${copy.sessions.clearAttachments}
                          </button>
                        `
                      : nothing}
                  </div>
                  ${this.chatState.chatAttachments.length
                    ? html`
                        <div class="cp-chat-attachments-preview">
                          ${repeat(
                            this.chatState.chatAttachments,
                            (attachment) => attachment.id,
                            (attachment) => html`
                              <div class="cp-chat-attachment-thumb">
                                ${attachment.kind === "image"
                                  ? html`
                                      <img
                                        src=${attachment.dataUrl}
                                        alt=${copy.sessions.imageAttachments}
                                      />
                                    `
                                  : html`
                                      <div class="cp-chat-attachment-thumb__file">
                                        <span>
                                          ${attachment.kind === "text"
                                            ? copy.sessions.textFile
                                            : attachment.kind === "pdf"
                                              ? copy.sessions.pdfFile
                                              : copy.sessions.audioFile}
                                        </span>
                                        <strong
                                          >${chatAttachmentName(attachment, this.locale)}</strong
                                        >
                                        <small>
                                          ${attachment.sizeBytes != null
                                            ? `${Math.max(1, Math.round(attachment.sizeBytes / 1024))} KB`
                                            : attachment.mimeType}
                                        </small>
                                        ${attachment.kind === "text" &&
                                        chatAttachmentPreviewText(attachment)
                                          ? html` <p>${chatAttachmentPreviewText(attachment)}</p> `
                                          : html`<p>${attachment.mimeType}</p>`}
                                      </div>
                                    `}
                                <button
                                  class="cp-chat-attachment-thumb__remove"
                                  type="button"
                                  @click=${() => {
                                    this.chatState.chatAttachments =
                                      this.chatState.chatAttachments.filter(
                                        (entry) => entry.id !== attachment.id,
                                      );
                                    this.requestUpdate();
                                  }}
                                >
                                  ×
                                </button>
                              </div>
                            `,
                          )}
                        </div>
                      `
                    : nothing}
                  <div
                    class="cp-chat-composer__input-shell ${slashMenu.open ? "is-menu-open" : ""}"
                  >
                    <textarea
                      class="cp-chat-composer__textarea"
                      .value=${this.chatState.chatMessage}
                      placeholder=${copy.sessions.sendPlaceholder}
                      aria-expanded=${slashMenu.open ? "true" : "false"}
                      ?disabled=${attachmentsBusy}
                      @keydown=${(event: KeyboardEvent) =>
                        void this.handleChatComposerKeydown(event)}
                      @input=${(event: Event) => {
                        this.chatState.chatMessage = (event.target as HTMLTextAreaElement).value;
                        this.chatSlashSuppressed = false;
                        this.chatSlashIndex = 0;
                        this.requestUpdate();
                      }}
                    ></textarea>
                    ${slashMenu.open
                      ? html`
                          <div
                            class="cp-chat-slash-menu"
                            role="listbox"
                            aria-label=${copy.sessions.commandSuggestions}
                          >
                            <div class="cp-chat-slash-menu__head">
                              <span>${copy.sessions.commandSuggestions}</span>
                              <small>
                                ${slashMenu.items.length === 0
                                  ? slashMenu.mode === "args"
                                    ? copy.sessions.commandEmptyArgsHint
                                    : copy.sessions.commandEmptyHint
                                  : slashMenu.mode === "args"
                                    ? copy.sessions.commandHelpArgs
                                    : copy.sessions.commandHelp}
                              </small>
                            </div>
                            ${slashMenu.mode === "command"
                              ? html`
                                  <div class="cp-chat-slash-menu__groups">
                                    ${slashMenuGroups.length
                                      ? repeat(
                                          slashMenuGroups,
                                          ([category]) => category,
                                          ([category, entries]) => html`
                                            <div class="cp-chat-slash-menu__group">
                                              <span class="cp-chat-slash-menu__group-label">
                                                ${slashCategoryLabel(this.locale, category)}
                                              </span>
                                              <div class="cp-chat-slash-menu__list">
                                                ${repeat(
                                                  entries,
                                                  ({ item }) => item.key,
                                                  ({ item, index }) => html`
                                                    <button
                                                      class="cp-chat-slash-menu__item ${index ===
                                                      normalizedSlashIndex
                                                        ? "is-active"
                                                        : ""}"
                                                      type="button"
                                                      @click=${() =>
                                                        void this.applySlashCommandSelection(
                                                          item,
                                                          true,
                                                        )}
                                                    >
                                                      <div class="cp-chat-slash-menu__row">
                                                        <strong>/${item.name}</strong>
                                                        <div class="cp-chat-slash-menu__badges">
                                                          ${item.argOptions?.length
                                                            ? html`
                                                                <small
                                                                  class="cp-chat-slash-menu__badge"
                                                                >
                                                                  ${item.argOptions.length}
                                                                  ${copy.sessions.commandOptions}
                                                                </small>
                                                              `
                                                            : nothing}
                                                          ${item.executeLocal && !item.args
                                                            ? html`
                                                                <small
                                                                  class="cp-chat-slash-menu__badge"
                                                                >
                                                                  ${copy.sessions.commandInstant}
                                                                </small>
                                                              `
                                                            : nothing}
                                                        </div>
                                                      </div>
                                                      <span>
                                                        ${localizeSlashCommandDescription(
                                                          item,
                                                          normalizeShellLocale(this.locale),
                                                        )}
                                                      </span>
                                                      <div class="cp-chat-slash-menu__meta">
                                                        ${localizeSlashCommandArgs(
                                                          item,
                                                          normalizeShellLocale(this.locale),
                                                        )
                                                          ? html`<small
                                                              >${localizeSlashCommandArgs(
                                                                item,
                                                                normalizeShellLocale(this.locale),
                                                              )}</small
                                                            >`
                                                          : nothing}
                                                        ${item.aliases?.length
                                                          ? html`
                                                              <small>
                                                                ${item.aliases
                                                                  .map((alias) => `/${alias}`)
                                                                  .join(" · ")}
                                                              </small>
                                                            `
                                                          : nothing}
                                                      </div>
                                                    </button>
                                                  `,
                                                )}
                                              </div>
                                            </div>
                                          `,
                                        )
                                      : html`
                                          <div class="cp-chat-slash-menu__empty">
                                            <strong>${copy.sessions.commandEmptyTitle}</strong>
                                            <span>${copy.sessions.commandEmptyHint}</span>
                                          </div>
                                        `}
                                  </div>
                                `
                              : html`
                                  <div class="cp-chat-slash-menu__group">
                                    <span class="cp-chat-slash-menu__group-label">
                                      /${slashMenu.command.name}
                                    </span>
                                    <div class="cp-chat-slash-menu__list">
                                      ${slashMenu.items.length
                                        ? repeat(
                                            slashMenu.items,
                                            (item) => item,
                                            (item, index) => html`
                                              <button
                                                class="cp-chat-slash-menu__item ${index ===
                                                normalizedSlashIndex
                                                  ? "is-active"
                                                  : ""}"
                                                type="button"
                                                @click=${() =>
                                                  void this.applySlashArgumentSelection(
                                                    slashMenu.command,
                                                    item,
                                                    true,
                                                  )}
                                              >
                                                <div class="cp-chat-slash-menu__row">
                                                  <strong>
                                                    ${localizeSlashArgOptionLabel(
                                                      item,
                                                      normalizeShellLocale(this.locale),
                                                    )}
                                                  </strong>
                                                  <small class="cp-chat-slash-menu__badge">
                                                    ${copy.sessions.commandInstant}
                                                  </small>
                                                </div>
                                                <span>
                                                  ${localizeSlashCommandDescription(
                                                    slashMenu.command,
                                                    normalizeShellLocale(this.locale),
                                                  )}
                                                </span>
                                                <small>/${slashMenu.command.name} ${item}</small>
                                              </button>
                                            `,
                                          )
                                        : html`
                                            <div class="cp-chat-slash-menu__empty">
                                              <strong
                                                >${copy.sessions.commandEmptyArgsTitle}</strong
                                              >
                                              <span>${copy.sessions.commandEmptyArgsHint}</span>
                                            </div>
                                          `}
                                    </div>
                                  </div>
                                `}
                          </div>
                        `
                      : nothing}
                  </div>
                  <div class="cp-form__actions cp-form__actions--composer">
                    <span class="cp-chat-composer__hint">
                      ${copy.sessions.sendHint}
                      ${slashMenu.open ? ` · ${copy.sessions.commandHint}` : ""}
                    </span>
                    <div class="cp-inline-actions cp-inline-actions--composer">
                      <button
                        class="cp-button cp-button--ghost"
                        type="button"
                        ?disabled=${composerBusy || (draftLength === 0 && attachmentCount === 0)}
                        @click=${() => {
                          this.chatState.chatMessage = "";
                          this.chatState.chatAttachments = [];
                          this.requestUpdate();
                        }}
                      >
                        ${copy.sessions.clearDraft}
                      </button>
                      <button
                        class="cp-button cp-button--primary"
                        type="submit"
                        ?disabled=${composerBusy || (draftLength === 0 && attachmentCount === 0)}
                      >
                        ${sendBusy ? copy.sessions.sendingNow : copy.common.send}
                      </button>
                    </div>
                  </div>
                </div>
              </form>
            </article>
          </main>

          <aside class="cp-session-console__inspector">
            <article class="cp-panel">
              <div class="cp-panel__head">
                <div>
                  <span class="cp-kicker">${copy.sessions.runtimeKicker}</span>
                  <h3>${copy.sessions.runtimeTitle}</h3>
                </div>
              </div>
              ${selected
                ? this.renderMetaEntries(
                    [
                      { label: copy.common.status, value: selected.status ?? copy.common.idle },
                      {
                        label: copy.common.execution,
                        value: this.chatState.chatRunId ?? copy.common.none,
                      },
                      {
                        label: copy.common.updated,
                        value: selected.updatedAt
                          ? formatDateTime(selected.updatedAt, this.locale)
                          : copy.common.pending,
                        hint: selected.updatedAt
                          ? formatAgo(selected.updatedAt, this.locale)
                          : undefined,
                      },
                      {
                        label: copy.common.timeline,
                        value:
                          selected.runtimeMs != null ? `${selected.runtimeMs}ms` : copy.common.na,
                      },
                      {
                        label: copy.common.messages,
                        value: String(this.chatState.chatMessages.length),
                        hint: this.chatState.chatStream ? copy.sessions.streaming : undefined,
                      },
                    ],
                    copy.sessions.selectPrompt,
                  )
                : html`<p class="cp-empty">${copy.sessions.selectPrompt}</p>`}
            </article>

            <article class="cp-panel">
              <div class="cp-panel__head">
                <div>
                  <span class="cp-kicker">${copy.sessions.routingKicker}</span>
                  <h3>${copy.sessions.routingTitle}</h3>
                </div>
              </div>
              ${selected
                ? html`
                    <div class="cp-routing-card">
                      <div class="cp-routing-card__hero">
                        <span>${copy.sessions.routingTarget}</span>
                        <strong>${selectedDisplayName}</strong>
                        <small>${selectedSurfaceLabel} · ${selectedKindLabel}</small>
                      </div>
                      <div class="cp-routing-card__grid">
                        <div class="cp-routing-card__item">
                          <span>${copy.sessions.routingChannel}</span>
                          <strong>${selectedSurfaceLabel}</strong>
                          ${selectedSurfaceHint
                            ? html`<small>${selectedSurfaceHint}</small>`
                            : nothing}
                        </div>
                        <div class="cp-routing-card__item">
                          <span>${copy.sessions.routingMode}</span>
                          <strong>${selectedKindLabel}</strong>
                          <small>${selected.chatType ?? selected.kind ?? copy.common.na}</small>
                        </div>
                        <div class="cp-routing-card__item">
                          <span>${copy.sessions.routingModel}</span>
                          <strong>${selectedModel ?? copy.common.default}</strong>
                          <small>${selectedProvider ?? copy.common.auto}</small>
                        </div>
                        <div class="cp-routing-card__item">
                          <span>${copy.sessions.routingUsage}</span>
                          <strong
                            >${String(selected.totalTokens ?? 0)} ${copy.common.tokens}</strong
                          >
                          <small>${selectedUsageHint}</small>
                        </div>
                      </div>
                      <div class="cp-routing-card__technical">
                        <span>${copy.sessions.routingTechnical}</span>
                        <small>${copy.sessions.routingTechnicalHint}</small>
                        ${selectedTechnicalKey
                          ? html`<code>${selectedTechnicalKey}</code>`
                          : nothing}
                      </div>
                    </div>
                  `
                : html`<p class="cp-empty">${copy.sessions.selectPrompt}</p>`}
            </article>

            <article class="cp-panel">
              <div class="cp-panel__head">
                <div>
                  <span class="cp-kicker">${copy.sessions.activityKicker}</span>
                  <h3>${copy.sessions.activityTitle}</h3>
                </div>
              </div>
              ${lastMessage
                ? html`
                    ${this.renderMetaEntries([
                      { label: copy.common.role, value: lastMessageRole ?? copy.common.na },
                      {
                        label: copy.common.updated,
                        value: lastMessageTimestamp
                          ? formatDateTime(lastMessageTimestamp, this.locale)
                          : copy.common.pending,
                        hint: lastMessageTimestamp
                          ? formatAgo(lastMessageTimestamp, this.locale)
                          : undefined,
                      },
                      {
                        label: copy.sessions.blocks,
                        value: String(countMessageBlocks(lastMessage)),
                      },
                    ])}
                    <pre class="cp-code cp-code--compact">${summarizeMessage(lastMessage)}</pre>
                  `
                : html`<p class="cp-empty">${copy.sessions.noMessages}</p>`}
            </article>

            <article class="cp-panel">
              <div class="cp-panel__head">
                <div>
                  <span class="cp-kicker">${copy.sessions.composerKicker}</span>
                  <h3>${copy.sessions.composerTitle}</h3>
                </div>
              </div>
              ${this.renderMetaEntries([
                {
                  label: copy.sessions.draftLength,
                  value: String(draftLength),
                  hint: draftLength ? copy.common.live : copy.common.idle,
                },
                {
                  label: copy.sessions.attachments,
                  value: String(attachmentCount),
                  hint: attachmentSummaryHint,
                },
                {
                  label: copy.common.execution,
                  value: this.chatState.chatRunId ?? copy.common.none,
                },
              ])}
              <pre class="cp-code cp-code--compact">
${draftLength ? this.chatState.chatMessage.trim() : copy.sessions.sendHint}</pre
              >
            </article>
          </aside>
        </div>
      </section>
    `;
  }

  private renderChannels() {
    const copy = uiText(this.locale);
    const snapshot = this.channelsState.channelsSnapshot;
    const flattenedAccounts = flattenChannelAccounts(snapshot);
    const channelIds = snapshot?.channelOrder ?? [];
    const catalogChannelIds = snapshot?.catalogOrder?.length ? snapshot.catalogOrder : channelIds;
    const configuredCatalogIds = catalogChannelIds.filter((channelId) =>
      channelIds.includes(channelId),
    );
    const availableCatalogIds = catalogChannelIds.filter(
      (channelId) => !channelIds.includes(channelId),
    );
    const connectedAccounts = flattenedAccounts.filter((entry) => entry.account.connected).length;
    const channelsNeedingAttention = channelIds.filter(
      (channelId) => countChannelAttentionIssues(resolveChannelAccounts(snapshot, channelId)) > 0,
    ).length;
    const selectedChannelId = catalogChannelIds.includes(this.channelsSelectedChannelId)
      ? this.channelsSelectedChannelId
      : "";
    const selectedChannelAvailable = selectedChannelId
      ? channelIds.includes(selectedChannelId)
      : false;
    const selectedChannelMeta = resolveChannelCatalogMeta(snapshot, selectedChannelId);
    const selectedChannelLabel = selectedChannelId
      ? (snapshot?.catalogLabels?.[selectedChannelId] ??
        snapshot?.channelLabels[selectedChannelId] ??
        selectedChannelMeta?.label ??
        selectedChannelId)
      : copy.common.none;
    const selectedChannelDetail = selectedChannelId
      ? (snapshot?.catalogDetailLabels?.[selectedChannelId] ??
        snapshot?.channelDetailLabels?.[selectedChannelId] ??
        selectedChannelMeta?.detailLabel ??
        selectedChannelLabel)
      : copy.channels.browseChannels;
    const selectedControls = resolveChannelControls(snapshot, selectedChannelId);
    const selectedAccounts = resolveChannelAccounts(snapshot, selectedChannelId);
    const selectedDefaultAccount = resolveDefaultChannelAccount(snapshot, selectedChannelId);
    const resolvedDefaultAccountId = selectedDefaultAccount?.accountId ?? null;
    const selectedAccountId = selectedAccounts.some(
      (account) => account.accountId === this.channelsSelectedAccountId,
    )
      ? this.channelsSelectedAccountId
      : (resolvedDefaultAccountId ?? selectedAccounts[0]?.accountId ?? "");
    const selectedAccount =
      selectedAccounts.find((account) => account.accountId === selectedAccountId) ??
      selectedDefaultAccount;
    const selectedConnectedCount = selectedAccounts.filter((account) => account.connected).length;
    const selectedIssueCount = countChannelAttentionIssues(selectedAccounts);
    const channelEditorAvailable = selectedControls.canEdit;
    const setupSurface =
      this.channelSetupState.selectedChannelId === selectedChannelId
        ? this.channelSetupState.surface
        : null;
    const setupLoading =
      this.channelSetupState.loading &&
      this.channelSetupState.selectedChannelId === selectedChannelId;
    const channelEditorBusy =
      this.channelConfigState.configLoading ||
      this.channelConfigState.configSchemaLoading ||
      this.channelConfigState.configSaving ||
      this.channelConfigState.configApplying;
    const currentDefaultAccountId =
      setupSurface?.defaultAccountId ?? resolvedDefaultAccountId ?? null;
    const selectedIsDefaultAccount =
      Boolean(selectedAccount?.accountId) &&
      Boolean(currentDefaultAccountId) &&
      selectedAccount?.accountId === currentDefaultAccountId;
    const showSetupPanel = Boolean(
      selectedChannelId &&
      (selectedControls.canSetup ||
        channelEditorAvailable ||
        selectedControls.multiAccount ||
        !selectedAccounts.length ||
        setupSurface?.statusLines.length),
    );
    const loginSupported =
      this.client?.hasMethod("channels.account.login.start") === true ||
      this.client?.hasMethod("channels.login.start") === true ||
      this.client?.hasMethod("web.login.start") === true;
    const qrLoginAvailable = selectedControls.loginMode === "qr" && loginSupported;
    const loginMessage =
      this.channelsState.whatsappLoginMessage ??
      (qrLoginAvailable ? copy.channels.noActiveLogin : copy.channels.loginNotSupported);
    const loginState =
      this.channelsState.whatsappLoginConnected === true
        ? copy.common.connected
        : this.channelsState.whatsappBusy
          ? copy.common.pending
          : qrLoginAvailable
            ? copy.common.available
            : copy.common.notExposed;

    const channelStatusTone = (channelId: string) => {
      const accounts = resolveChannelAccounts(snapshot, channelId);
      const issues = countChannelAttentionIssues(accounts);
      if (issues > 0) {
        return { label: copy.channels.channelAttention, className: "cp-badge--warn" };
      }
      if (accounts.some((account) => account.connected)) {
        return { label: copy.channels.channelHealthy, className: "cp-badge--ok" };
      }
      if (accounts.some((account) => account.configured)) {
        return { label: copy.channels.channelConfigured, className: "" };
      }
      return { label: copy.channels.channelNotConfigured, className: "" };
    };

    const selectedLatestProbeAt = selectedAccounts
      .map((account) => account.lastProbeAt)
      .filter((value): value is number => typeof value === "number")
      .toSorted((left, right) => left - right)
      .at(-1);
    const recommendedLabel =
      !selectedAccounts.length && showSetupPanel
        ? copy.channels.stepSetupTitle
        : selectedAccounts.length
          ? copy.channels.stepAccountsTitle
          : qrLoginAvailable
            ? copy.channels.stepConnectTitle
            : channelEditorAvailable
              ? copy.channels.stepSettingsTitle
              : copy.channels.stepGuideTitle;
    const activeMode: ChannelWorkspaceMode =
      this.channelsWorkspaceMode === "settings" || this.channelsWorkspaceMode === "add"
        ? this.channelsWorkspaceMode
        : "guide";
    const addChannelIds = catalogChannelIds;

    const openAddChannel = () => {
      this.channelsAddSelectedChannelId = "";
      this.channelsWorkspaceMode = "add";
    };

    const renderDirectoryCard = (channelId: string) => {
      const accounts = resolveChannelAccounts(snapshot, channelId);
      const connectedCount = accounts.filter((account) => account.connected).length;
      const issueCount = countChannelAttentionIssues(accounts);
      const statusTone = channelStatusTone(channelId);
      const meta = resolveChannelCatalogMeta(snapshot, channelId);
      return html`
        <button
          class="cp-action-card cp-channel-card"
          @click=${() => this.selectChannel(channelId)}
        >
          <div class="cp-channel-card__head">
            <div>
              <strong>${snapshot?.channelLabels[channelId] ?? meta?.label ?? channelId}</strong>
              <small>
                ${snapshot?.channelDetailLabels?.[channelId] ??
                snapshot?.channelLabels[channelId] ??
                snapshot?.catalogDetailLabels?.[channelId] ??
                meta?.detailLabel ??
                meta?.label ??
                channelId}
              </small>
            </div>
            <span class=${`cp-badge ${statusTone.className}`}>${statusTone.label}</span>
          </div>
          <div class="cp-channel-card__stats">
            <span>${copy.common.accounts}: ${accounts.length}</span>
            <span>${copy.common.connectedAccounts}: ${connectedCount}</span>
            <span>${copy.channels.issueCount}: ${issueCount}</span>
          </div>
          <div class="cp-channel-card__summary">
            <span>${copy.common.status}</span>
            <strong>${statusTone.label}</strong>
            <small
              >${snapshot?.channelDetailLabels?.[channelId] ??
              snapshot?.channelLabels[channelId] ??
              snapshot?.catalogDetailLabels?.[channelId] ??
              meta?.detailLabel ??
              meta?.label ??
              channelId}</small
            >
          </div>
        </button>
      `;
    };

    const renderSummaryPanel = () => html`
      <section class="cp-grid cp-grid--double">
        <article class="cp-panel">
          <div class="cp-panel__head">
            <div>
              <span class="cp-kicker">${copy.channels.detailKicker}</span>
              <h3>${copy.channels.summaryTitle}</h3>
            </div>
          </div>
          <p class="cp-panel__subcopy">${copy.channels.summaryHint}</p>
          ${this.renderMetaEntries(
            [
              {
                label: copy.channels.selectedChannel,
                value: selectedChannelLabel,
              },
              {
                label: copy.common.summary,
                value: selectedChannelDetail,
              },
              {
                label: copy.common.accounts,
                value: String(selectedAccounts.length),
              },
              {
                label: copy.common.connectedAccounts,
                value: String(selectedConnectedCount),
              },
              {
                label: copy.channels.issueCount,
                value: String(selectedIssueCount),
              },
              {
                label: copy.common.recentCheck,
                value: selectedLatestProbeAt
                  ? formatDateTime(selectedLatestProbeAt, this.locale)
                  : copy.common.notRecorded,
              },
              {
                label: copy.channels.recommendedNext,
                value: recommendedLabel,
              },
            ],
            this.channelsState.channelsError ?? undefined,
          )}
        </article>
        <article class="cp-panel">
          <div class="cp-panel__head">
            <div>
              <span class="cp-kicker">${copy.channels.recommendedNext}</span>
              <h3>${recommendedLabel}</h3>
            </div>
          </div>
          <p class="cp-panel__subcopy">${copy.channels.detailHint}</p>
          <div class="cp-inline-actions">
            ${channelEditorAvailable
              ? html`
                  <button
                    class="cp-button"
                    @click=${() =>
                      this.openChannelSettings(
                        selectedChannelId,
                        selectedAccount?.accountId ?? null,
                        "guide",
                      )}
                  >
                    ${copy.channels.openSettings}
                  </button>
                `
              : nothing}
            ${addChannelIds.length
              ? html`
                  <button class="cp-button" @click=${openAddChannel}>
                    ${copy.channels.addChannel}
                  </button>
                `
              : nothing}
          </div>
        </article>
      </section>
    `;

    const renderCatalogOnlyPanel = () => {
      const docsPath = selectedChannelMeta?.docsPath?.trim() || null;
      const installNpmSpec = selectedChannelMeta?.installNpmSpec?.trim() || null;
      const installCommand = installNpmSpec ? `pnpm add ${installNpmSpec}` : null;
      return html`
        <section class="cp-grid cp-grid--double">
          <article class="cp-panel">
            <div class="cp-panel__head">
              <div>
                <span class="cp-kicker">${copy.channels.addFlowKicker}</span>
                <h3>${copy.channels.catalogOnlyTitle}</h3>
              </div>
            </div>
            <p class="cp-panel__subcopy">${copy.channels.catalogOnlyHint}</p>
            ${this.renderMetaEntries([
              {
                label: copy.channels.catalogDocs,
                value: docsPath ?? copy.common.na,
              },
              {
                label: copy.channels.catalogPackage,
                value: installNpmSpec ?? copy.common.na,
              },
            ])}
            ${installCommand
              ? html`<pre class="cp-code cp-code--compact">${installCommand}</pre>`
              : nothing}
          </article>
          <article class="cp-panel">
            <div class="cp-panel__head">
              <div>
                <span class="cp-kicker">${copy.channels.recommendedNext}</span>
                <h3>${copy.channels.viewChannelGuide}</h3>
              </div>
            </div>
            <p class="cp-panel__subcopy">${copy.channels.catalogOnlyHint}</p>
            <div class="cp-inline-actions">
              ${docsPath
                ? html`
                    <button
                      class="cp-button"
                      @click=${() => {
                        openExternalUrlSafe(docsPath);
                      }}
                    >
                      ${copy.channels.viewChannelGuide}
                    </button>
                  `
                : nothing}
              <button class="cp-button" @click=${openAddChannel}>
                ${copy.channels.addChannel}
              </button>
            </div>
          </article>
        </section>
      `;
    };

    const renderConfiguredCatalogCard = (channelId: string) => {
      const accounts = resolveChannelAccounts(snapshot, channelId);
      const controls = resolveChannelControls(snapshot, channelId);
      const meta = resolveChannelCatalogMeta(snapshot, channelId);
      const configuredCount = accounts.filter((account) => account.configured).length;
      const connectedCount = accounts.filter((account) => account.connected).length;
      const issueCount = countChannelAttentionIssues(accounts);
      const statusTone = channelStatusTone(channelId);
      const canAddAnotherAccount = configuredCount > 0 && controls.multiAccount && controls.canEdit;
      return html`
        <article class="cp-action-card cp-channel-card cp-channel-card--catalog">
          <div class="cp-channel-card__head">
            <div>
              <strong>
                ${snapshot?.catalogLabels?.[channelId] ??
                snapshot?.channelLabels[channelId] ??
                meta?.label ??
                channelId}
              </strong>
              <small>
                ${snapshot?.catalogDetailLabels?.[channelId] ??
                snapshot?.channelDetailLabels?.[channelId] ??
                meta?.detailLabel ??
                snapshot?.catalogLabels?.[channelId] ??
                snapshot?.channelLabels[channelId] ??
                meta?.label ??
                channelId}
              </small>
            </div>
            <span class=${`cp-badge ${statusTone.className}`}>${statusTone.label}</span>
          </div>
          <div class="cp-channel-card__stats">
            <span>${copy.common.accounts}: ${accounts.length}</span>
            <span>${copy.common.connectedAccounts}: ${connectedCount}</span>
            <span>${copy.channels.issueCount}: ${issueCount}</span>
          </div>
          <div class="cp-channel-card__summary">
            <span>${copy.channels.recommendedNext}</span>
            <strong>
              ${canAddAnotherAccount ? copy.channels.addAnotherAccount : copy.channels.openSettings}
            </strong>
            <small>
              ${canAddAnotherAccount
                ? copy.channels.addAnotherAccountHint
                : copy.channels.stepSettingsHint}
            </small>
          </div>
          <div class="cp-inline-actions">
            ${canAddAnotherAccount
              ? html`
                  <button
                    class="cp-button cp-button--primary"
                    @click=${() => void this.addChannelAccountDraft(channelId, accounts)}
                  >
                    ${copy.channels.addAnotherAccount}
                  </button>
                `
              : nothing}
            <button
              class="cp-button"
              @click=${() => this.openChannelSettings(channelId, null, "guide")}
            >
              ${copy.channels.openSettings}
            </button>
          </div>
        </article>
      `;
    };

    const renderAvailableCatalogCard = (channelId: string) => {
      const meta = resolveChannelCatalogMeta(snapshot, channelId);
      const docsPath = meta?.docsPath?.trim() || null;
      const installNpmSpec = meta?.installNpmSpec?.trim() || null;
      return html`
        <article class="cp-action-card cp-channel-card cp-channel-card--catalog">
          <div class="cp-channel-card__head">
            <div>
              <strong>
                ${snapshot?.catalogLabels?.[channelId] ??
                snapshot?.channelLabels[channelId] ??
                meta?.label ??
                channelId}
              </strong>
              <small>
                ${snapshot?.catalogDetailLabels?.[channelId] ??
                snapshot?.channelDetailLabels?.[channelId] ??
                meta?.detailLabel ??
                snapshot?.catalogLabels?.[channelId] ??
                snapshot?.channelLabels[channelId] ??
                meta?.label ??
                channelId}
              </small>
            </div>
            <span class="cp-badge">${copy.channels.channelAvailableToAdd}</span>
          </div>
          <div class="cp-channel-card__stats">
            <span>${copy.channels.catalogPackage}: ${installNpmSpec ?? copy.common.na}</span>
            <span
              >${copy.channels.catalogDocs}:
              ${docsPath ? copy.common.available : copy.common.na}</span
            >
          </div>
          <div class="cp-channel-card__summary">
            <span>${copy.channels.recommendedNext}</span>
            <strong>${copy.channels.viewChannelGuide}</strong>
            <small>${copy.channels.catalogOnlyHint}</small>
          </div>
          <div class="cp-inline-actions">
            ${docsPath
              ? html`
                  <button
                    class="cp-button cp-button--primary"
                    @click=${() => {
                      openExternalUrlSafe(docsPath);
                    }}
                  >
                    ${copy.channels.viewChannelGuide}
                  </button>
                `
              : nothing}
          </div>
        </article>
      `;
    };

    const renderAddSelectionPage = () => html`
      <div class="cp-channel-directory-page">
        <article class="cp-panel">
          <div class="cp-panel__head">
            <div>
              <span class="cp-kicker">${copy.channels.addFlowKicker}</span>
              <h3>${copy.channels.addFlowTitle}</h3>
            </div>
            <button class="cp-button" @click=${() => (this.channelsWorkspaceMode = "guide")}>
              ${copy.channels.backToDirectory}
            </button>
          </div>
          <p class="cp-panel__subcopy">${copy.channels.addFlowHint}</p>
          ${!addChannelIds.length
            ? html`<p class="cp-empty">${copy.channels.addFlowEmpty}</p>`
            : html`
                <section class="cp-channel-catalog-block">
                  <div class="cp-channel-catalog-block__head">
                    <div>
                      <span class="cp-kicker">${copy.channels.directoryKicker}</span>
                      <h4>${copy.channels.configuredCatalogTitle}</h4>
                    </div>
                    <p>${copy.channels.configuredCatalogHint}</p>
                  </div>
                  <div class="cp-channel-directory-grid">
                    ${configuredCatalogIds.length
                      ? repeat(
                          configuredCatalogIds,
                          (channelId) => channelId,
                          (channelId) => renderConfiguredCatalogCard(channelId),
                        )
                      : html`<p class="cp-empty">${copy.channels.noAccounts}</p>`}
                  </div>
                </section>
                <section class="cp-channel-catalog-block">
                  <div class="cp-channel-catalog-block__head">
                    <div>
                      <span class="cp-kicker">${copy.channels.addFlowKicker}</span>
                      <h4>${copy.channels.availableCatalogTitle}</h4>
                    </div>
                    <p>${copy.channels.availableCatalogHint}</p>
                  </div>
                  <div class="cp-channel-directory-grid">
                    ${availableCatalogIds.length
                      ? repeat(
                          availableCatalogIds,
                          (channelId) => channelId,
                          (channelId) => renderAvailableCatalogCard(channelId),
                        )
                      : html`<p class="cp-empty">${copy.channels.channelConfigured}</p>`}
                  </div>
                </section>
              `}
        </article>
      </div>
    `;

    const renderSetupPanel = () =>
      !showSetupPanel
        ? html`<article class="cp-panel">
            <p class="cp-empty">${copy.channels.setupUnavailable}</p>
          </article>`
        : html`
            <article class="cp-panel cp-panel--fill">
              <div class="cp-panel__head">
                <div>
                  <span class="cp-kicker">${copy.channels.setupKicker}</span>
                  <h3>${copy.channels.setupTitle}</h3>
                </div>
                <div class="cp-inline-actions">
                  ${channelEditorAvailable
                    ? html`
                        <button
                          class="cp-button"
                          @click=${() => this.openChannelSettings(selectedChannelId, null, "setup")}
                        >
                          ${copy.channels.openSettings}
                        </button>
                      `
                    : nothing}
                  ${selectedControls.multiAccount && channelEditorAvailable
                    ? html`
                        <button
                          class="cp-button"
                          @click=${() =>
                            void this.addChannelAccountDraft(selectedChannelId, selectedAccounts)}
                        >
                          ${copy.channels.addAccountDraft}
                        </button>
                      `
                    : nothing}
                </div>
              </div>
              <p class="cp-panel__subcopy">${copy.channels.setupHint}</p>
              ${setupLoading
                ? html`<p class="cp-empty">${copy.common.pending}</p>`
                : setupSurface
                  ? html`
                      ${this.renderMetaEntries(
                        [
                          {
                            label: copy.common.status,
                            value: setupSurface.configured
                              ? copy.channels.channelConfigured
                              : copy.channels.channelNotConfigured,
                          },
                          {
                            label: copy.channels.setupDocs,
                            value: setupSurface.docsPath ?? copy.common.na,
                          },
                        ],
                        this.channelSetupState.lastError ?? undefined,
                      )}
                      ${setupSurface.statusLines.length
                        ? html`
                            <div class="cp-list cp-list--dense">
                              ${setupSurface.statusLines.map(
                                (line) => html`<div class="cp-list-item">${line}</div>`,
                              )}
                            </div>
                          `
                        : nothing}
                      ${selectedControls.multiAccount && channelEditorAvailable
                        ? html`
                            <div class="cp-form">
                              <label>
                                <span>${copy.channels.addAccountDraft}</span>
                                <input
                                  type="text"
                                  .value=${this.channelsDraftAccountId}
                                  placeholder=${copy.channels.addAccountDraftPlaceholder}
                                  @input=${(event: Event) => {
                                    this.channelsDraftAccountId = (
                                      event.target as HTMLInputElement
                                    ).value;
                                  }}
                                />
                              </label>
                              <small class="cp-panel__subcopy">
                                ${copy.channels.addAccountDraftHint}
                              </small>
                            </div>
                          `
                        : nothing}
                      ${setupSurface.commands.length
                        ? html`
                            <details class="cp-panel__details">
                              <summary>${copy.channels.setupCommandsTitle}</summary>
                              <div class="cp-list cp-list--dense">
                                ${setupSurface.commands.map(
                                  (command) =>
                                    html`<pre class="cp-code cp-code--compact">${command}</pre>`,
                                )}
                              </div>
                            </details>
                          `
                        : nothing}
                    `
                  : channelEditorAvailable
                    ? html` <p class="cp-empty">${copy.channels.openSettingsHint}</p> `
                    : html`<p class="cp-empty">${copy.channels.setupUnavailable}</p>`}
            </article>
          `;

    const renderConnectPanel = () => html`
      <article class="cp-channel-login-panel">
        <span class="cp-kicker">${copy.channels.qrLoginTitle}</span>
        <strong>${qrLoginAvailable ? loginState : copy.common.notExposed}</strong>
        <p class="cp-panel__subcopy">
          ${qrLoginAvailable ? copy.channels.qrLoginHint : loginMessage}
        </p>
        ${qrLoginAvailable
          ? html`
              <div class="cp-inline-actions">
                <button
                  class="cp-button"
                  @click=${() =>
                    void this.safeCall(async () => {
                      await startWhatsAppLogin(
                        this.channelsState,
                        true,
                        selectedChannelId,
                        selectedAccount?.accountId,
                      );
                    })}
                >
                  ${copy.channels.startQrLogin}
                </button>
                <button
                  class="cp-button"
                  @click=${() =>
                    void this.safeCall(async () => {
                      await waitWhatsAppLogin(
                        this.channelsState,
                        selectedChannelId,
                        selectedAccount?.accountId,
                      );
                    })}
                >
                  ${copy.channels.checkLogin}
                </button>
                <button
                  class="cp-button cp-button--danger"
                  @click=${() =>
                    void this.safeCall(async () => {
                      await logoutWhatsApp(
                        this.channelsState,
                        selectedChannelId,
                        selectedAccount?.accountId,
                      );
                    })}
                >
                  ${copy.channels.logoutAccount}
                </button>
              </div>
              ${this.channelsState.whatsappLoginQrDataUrl
                ? html`
                    <div class="cp-qr-card">
                      <span class="cp-kicker">${copy.channels.loginQr}</span>
                      <img
                        src=${this.channelsState.whatsappLoginQrDataUrl}
                        alt=${copy.channels.loginQr}
                      />
                    </div>
                  `
                : nothing}
              <pre class="cp-code">${loginMessage}</pre>
            `
          : nothing}
      </article>
    `;

    const renderAccountsPanel = () => html`
      <section class="cp-grid cp-grid--double">
        <article class="cp-panel cp-panel--fill">
          <div class="cp-panel__head">
            <div>
              <span class="cp-kicker">${copy.channels.accountsTitle}</span>
              <h3>${copy.channels.accountsTitle}</h3>
            </div>
            <button
              class="cp-button"
              @click=${() =>
                void this.safeCall(async () => {
                  await loadChannels(this.channelsState, true);
                })}
            >
              ${copy.channels.probeAgain}
            </button>
          </div>
          <p class="cp-panel__subcopy">${copy.channels.accountsHint}</p>
          <div class="cp-list cp-list--dense">
            ${selectedAccounts.length
              ? repeat(
                  selectedAccounts,
                  (account) => `${selectedChannelId}:${account.accountId}`,
                  (account) => html`
                    <button
                      class="cp-session-item ${selectedAccount?.accountId === account.accountId
                        ? "is-active"
                        : ""}"
                      @click=${() =>
                        this.selectChannelAccount(selectedChannelId, account.accountId)}
                    >
                      <strong>${account.name ?? account.accountId}</strong>
                      <span>
                        ${account.connected
                          ? copy.channels.channelConnected
                          : account.configured
                            ? copy.channels.channelConfigured
                            : copy.channels.channelNotConfigured}
                      </span>
                      <small>${account.lastError ?? copy.common.recentCheck}</small>
                    </button>
                  `,
                )
              : html`<p class="cp-empty">${copy.channels.noChannelAccounts}</p>`}
          </div>
        </article>
        <article class="cp-panel cp-panel--fill">
          <div class="cp-panel__head">
            <div>
              <span class="cp-kicker">${copy.channels.actionsTitle}</span>
              <h3>${copy.channels.actionsTitle}</h3>
            </div>
          </div>
          <p class="cp-panel__subcopy">${copy.channels.actionsHint}</p>
          ${selectedAccount
            ? this.renderMetaEntries([
                {
                  label: copy.channels.selectedAccount,
                  value: selectedAccount.name ?? selectedAccount.accountId,
                },
                {
                  label: copy.channels.defaultAccount,
                  value: selectedIsDefaultAccount
                    ? copy.common.yes
                    : (currentDefaultAccountId ?? copy.common.none),
                },
                {
                  label: copy.common.status,
                  value: selectedAccount.connected
                    ? copy.channels.channelConnected
                    : selectedAccount.configured
                      ? copy.channels.channelConfigured
                      : copy.channels.channelNotConfigured,
                },
                {
                  label: copy.common.reconnect,
                  value: selectedControls.canReconnect
                    ? selectedAccount.configured
                      ? copy.common.available
                      : copy.channels.channelNotConfigured
                    : copy.common.notExposed,
                },
              ])
            : html`<p class="cp-empty">${copy.channels.noChannelAccounts}</p>`}
          <div class="cp-inline-actions">
            <button
              class="cp-button"
              ?disabled=${!selectedControls.canReconnect || !selectedAccount?.configured}
              @click=${() =>
                void this.safeCall(async () => {
                  await reconnectChannelAccount(
                    this.channelsState,
                    selectedChannelId,
                    selectedAccount?.accountId,
                  );
                })}
            >
              ${copy.common.reconnect}
            </button>
            <button
              class="cp-button"
              ?disabled=${!selectedControls.canVerify}
              @click=${() =>
                void this.safeCall(async () => {
                  await verifyChannelAccount(
                    this.channelsState,
                    selectedChannelId,
                    selectedAccount?.accountId,
                  );
                })}
            >
              ${copy.channels.verifyConnection}
            </button>
            <button
              class="cp-button"
              ?disabled=${!selectedControls.multiAccount ||
              !channelEditorAvailable ||
              !selectedAccount ||
              selectedIsDefaultAccount}
              @click=${() =>
                selectedAccount
                  ? void this.makeChannelAccountDefault(
                      selectedChannelId,
                      selectedAccount.accountId,
                    )
                  : undefined}
            >
              ${copy.channels.makeDefaultAccount}
            </button>
            <button
              class="cp-button"
              ?disabled=${!channelEditorAvailable}
              @click=${() =>
                this.openChannelSettings(selectedChannelId, selectedAccount?.accountId, "accounts")}
            >
              ${copy.channels.openSettings}
            </button>
          </div>
        </article>
      </section>
    `;

    const renderSettingsPanel = () => html`
      <div class="cp-channel-settings-page">
        <section class="cp-channel-settings-page__nav">
          <div>
            <span class="cp-kicker">${copy.channels.settingsTitle}</span>
            <strong>${selectedChannelLabel}</strong>
            <small>${selectedChannelDetail}</small>
          </div>
          <div class="cp-inline-actions">
            <button
              class="cp-button"
              @click=${() => {
                this.closeChannelSettings();
                this.channelsWorkspaceMode = this.channelsWorkspaceReturnMode;
              }}
            >
              ${copy.channels.backToWorkspace}
            </button>
          </div>
        </section>
        <article class="cp-panel cp-panel--fill">
          <div class="cp-panel__head">
            <div>
              <span class="cp-kicker">${copy.channels.settingsTitle}</span>
              <h3>${selectedChannelLabel}</h3>
            </div>
          </div>
          <p class="cp-panel__subcopy">
            ${channelEditorAvailable
              ? copy.channels.settingsPageHint
              : copy.channels.settingsUnavailable}
          </p>
          ${this.channelConfigState.lastError
            ? html`
                <section class="cp-banner cp-banner--danger">
                  <strong>${this.channelConfigState.lastError}</strong>
                </section>
              `
            : nothing}
          ${channelEditorAvailable && this.channelsEditorOpen
            ? html`
                <div class="cp-channel-settings-layout">
                  <div class="cp-channel-settings-layout__main">
                    ${channelEditorBusy
                      ? html`<p class="cp-empty">${copy.common.pending}</p>`
                      : renderChannelConfigForm({
                          channelId: selectedChannelId,
                          configValue: this.channelConfigState.configForm,
                          schema: this.channelConfigState.configSchema,
                          uiHints: this.channelConfigState.configUiHints,
                          disabled: channelEditorBusy,
                          scoped: true,
                          onPatch: (path, value) =>
                            updateChannelConfigFormValue(this.channelConfigState, path, value),
                        })}
                  </div>
                  <aside class="cp-channel-settings-layout__side">
                    <section class="cp-panel cp-panel--fill">
                      <div class="cp-panel__head">
                        <div>
                          <span class="cp-kicker">${copy.channels.settingsReviewTitle}</span>
                          <h3>${copy.channels.settingsReviewTitle}</h3>
                        </div>
                      </div>
                      <p class="cp-panel__subcopy">${copy.channels.settingsReviewHint}</p>
                      <div class="cp-channel-settings-actions">
                        <button
                          class="cp-button"
                          ?disabled=${channelEditorBusy || !this.channelConfigState.configFormDirty}
                          @click=${() =>
                            void this.safeCall(async () => {
                              await saveChannelConfig(this.channelConfigState);
                              await Promise.all([
                                loadChannels(this.channelsState, true),
                                loadChannelSetupSurface(this.channelSetupState, selectedChannelId),
                              ]);
                            })}
                        >
                          ${copy.channels.saveChannelSettings}
                        </button>
                        <button
                          class="cp-button"
                          ?disabled=${channelEditorBusy || !this.channelConfigState.configFormDirty}
                          @click=${() =>
                            void this.safeCall(async () => {
                              await applyChannelConfig(this.channelConfigState);
                              await Promise.all([
                                loadChannels(this.channelsState, true),
                                loadChannelSetupSurface(this.channelSetupState, selectedChannelId),
                              ]);
                            })}
                        >
                          ${copy.channels.applyChannelSettings}
                        </button>
                        <button
                          class="cp-button"
                          ?disabled=${channelEditorBusy}
                          @click=${() =>
                            void this.safeCall(async () => {
                              await Promise.all([
                                loadChannelConfigSchema(this.channelConfigState, selectedChannelId),
                                loadChannelConfig(this.channelConfigState, selectedChannelId),
                              ]);
                              await loadChannelSetupSurface(
                                this.channelSetupState,
                                selectedChannelId,
                              );
                            })}
                        >
                          ${copy.channels.reloadChannelSettings}
                        </button>
                        ${selectedControls.multiAccount
                          ? html`
                              <button
                                class="cp-button"
                                ?disabled=${channelEditorBusy}
                                @click=${() =>
                                  void this.addChannelAccountDraft(
                                    selectedChannelId,
                                    selectedAccounts,
                                  )}
                              >
                                ${copy.channels.addAccountDraft}
                              </button>
                            `
                          : nothing}
                      </div>
                    </section>
                    <section class="cp-panel cp-panel--fill">
                      <div class="cp-panel__head">
                        <div>
                          <span class="cp-kicker">${copy.channels.settingsStatusTitle}</span>
                          <h3>${copy.channels.settingsStatusTitle}</h3>
                        </div>
                      </div>
                      <p class="cp-panel__subcopy">${copy.channels.settingsStatusHint}</p>
                      ${this.renderMetaEntries([
                        {
                          label: copy.common.selected,
                          value: selectedChannelLabel,
                        },
                        {
                          label: copy.common.accounts,
                          value: String(selectedAccounts.length),
                        },
                        {
                          label: copy.common.connectedAccounts,
                          value: String(selectedConnectedCount),
                        },
                        {
                          label: copy.channels.issueCount,
                          value: String(selectedIssueCount),
                        },
                        {
                          label: copy.channels.defaultAccount,
                          value: currentDefaultAccountId ?? copy.common.none,
                        },
                        {
                          label: copy.common.dirty,
                          value: this.channelConfigState.configFormDirty
                            ? copy.common.yes
                            : copy.common.no,
                        },
                      ])}
                    </section>
                    <section class="cp-panel cp-panel--fill">
                      <div class="cp-panel__head">
                        <div>
                          <span class="cp-kicker">${copy.channels.settingsReferenceTitle}</span>
                          <h3>${copy.channels.settingsReferenceTitle}</h3>
                        </div>
                      </div>
                      <p class="cp-panel__subcopy">${copy.channels.settingsReferenceHint}</p>
                      ${setupSurface?.commands?.length
                        ? html`
                            <div class="cp-list cp-list--dense">
                              ${setupSurface.commands.map(
                                (command) =>
                                  html`<pre class="cp-code cp-code--compact">${command}</pre>`,
                              )}
                            </div>
                          `
                        : html`<p class="cp-empty">${copy.channels.settingsReferenceEmpty}</p>`}
                      ${this.renderMetaEntries([
                        {
                          label: copy.channels.catalogDocs,
                          value: selectedChannelMeta?.docsPath ?? copy.common.na,
                        },
                        {
                          label: copy.channels.catalogPackage,
                          value: selectedChannelMeta?.installNpmSpec ?? copy.common.na,
                        },
                      ])}
                    </section>
                    <section class="cp-panel cp-panel--fill">
                      <details class="cp-channel-settings-technical">
                        <summary>${copy.channels.settingsTechnicalTitle}</summary>
                        <p class="cp-panel__subcopy">${copy.channels.settingsTechnicalHint}</p>
                        ${this.renderMetaEntries([
                          {
                            label: copy.common.path,
                            value: `channels.${selectedChannelId}`,
                          },
                          {
                            label: copy.common.schema,
                            value: this.channelConfigState.configSchemaVersion ?? copy.common.na,
                          },
                        ])}
                      </details>
                    </section>
                  </aside>
                </div>
              `
            : html`<p class="cp-empty">${copy.channels.settingsClosed}</p>`}
        </article>
      </div>
    `;

    return html`
      <section class="cp-page">
        ${activeMode === "settings"
          ? nothing
          : this.renderPageHeader("channels", [
              {
                label: copy.channels.enabledSurfaces,
                value: String(channelIds.length),
              },
              {
                label: copy.common.accounts,
                value: String(flattenedAccounts.length),
              },
              {
                label: copy.channels.issueCount,
                value: String(channelsNeedingAttention),
              },
              {
                label: copy.common.recentCheck,
                value: this.channelsState.channelsLastSuccess
                  ? formatDateTime(this.channelsState.channelsLastSuccess, this.locale)
                  : copy.common.notRecorded,
                hint: this.channelsState.channelsLastSuccess
                  ? formatAgo(this.channelsState.channelsLastSuccess, this.locale)
                  : undefined,
              },
            ])}
        ${activeMode === "add"
          ? renderAddSelectionPage()
          : !selectedChannelId
            ? html`
                <div class="cp-channel-directory-page">
                  <section class="cp-band">
                    ${this.renderMetric(copy.channels.enabledSurfaces, String(channelIds.length))}
                    ${this.renderMetric(copy.common.accounts, String(flattenedAccounts.length))}
                    ${this.renderMetric(copy.common.connectedAccounts, String(connectedAccounts))}
                    ${this.renderMetric(copy.channels.issueCount, String(channelsNeedingAttention))}
                  </section>
                  <article class="cp-panel">
                    <div class="cp-panel__head">
                      <div>
                        <span class="cp-kicker">${copy.channels.directoryKicker}</span>
                        <h3>${copy.channels.directoryTitle}</h3>
                      </div>
                      <button class="cp-button" @click=${openAddChannel}>
                        ${copy.channels.addChannel}
                      </button>
                    </div>
                    <p class="cp-panel__subcopy">${copy.channels.directoryHint}</p>
                    <div class="cp-channel-directory-grid">
                      ${channelIds.length
                        ? repeat(channelIds, (channelId) => channelId, renderDirectoryCard)
                        : html`<p class="cp-empty">${copy.channels.noAccounts}</p>`}
                    </div>
                  </article>
                </div>
              `
            : activeMode === "settings"
              ? renderSettingsPanel()
              : !selectedChannelAvailable
                ? html`
                    <div class="cp-channel-workspace">
                      <section class="cp-channel-workspace__nav">
                        <div>
                          <span class="cp-kicker">${copy.channels.detailKicker}</span>
                          <strong>${selectedChannelLabel}</strong>
                          <small>${selectedChannelDetail}</small>
                        </div>
                        <div class="cp-inline-actions">
                          <button class="cp-button" @click=${openAddChannel}>
                            ${copy.channels.addChannel}
                          </button>
                          <button class="cp-button" @click=${() => this.leaveChannelWorkspace()}>
                            ${copy.channels.backToDirectory}
                          </button>
                        </div>
                      </section>

                      <section class="cp-band">
                        ${this.renderMetric(copy.common.accounts, "0")}
                        ${this.renderMetric(copy.common.connectedAccounts, "0")}
                        ${this.renderMetric(copy.channels.issueCount, "0")}
                        ${this.renderMetric(
                          copy.channels.recommendedNext,
                          copy.channels.viewChannelGuide,
                        )}
                      </section>

                      <div class="cp-workspace-stack">
                        ${renderSummaryPanel()} ${renderCatalogOnlyPanel()}
                      </div>
                    </div>
                  `
                : html`
                    <div class="cp-channel-workspace">
                      <section class="cp-channel-workspace__nav">
                        <div>
                          <span class="cp-kicker">${copy.channels.detailKicker}</span>
                          <strong>${selectedChannelLabel}</strong>
                          <small>${selectedChannelDetail}</small>
                        </div>
                        <div class="cp-inline-actions">
                          ${channelEditorAvailable
                            ? html`
                                <button
                                  class="cp-button"
                                  @click=${() =>
                                    this.openChannelSettings(
                                      selectedChannelId,
                                      selectedAccount?.accountId ?? null,
                                      "guide",
                                    )}
                                >
                                  ${copy.channels.openSettings}
                                </button>
                              `
                            : nothing}
                          ${addChannelIds.length
                            ? html`
                                <button class="cp-button" @click=${openAddChannel}>
                                  ${copy.channels.addChannel}
                                </button>
                              `
                            : nothing}
                          <button class="cp-button" @click=${() => this.leaveChannelWorkspace()}>
                            ${copy.channels.backToDirectory}
                          </button>
                        </div>
                      </section>

                      <section class="cp-band">
                        ${this.renderMetric(copy.common.accounts, String(selectedAccounts.length))}
                        ${this.renderMetric(
                          copy.common.connectedAccounts,
                          String(selectedConnectedCount),
                        )}
                        ${this.renderMetric(copy.channels.issueCount, String(selectedIssueCount))}
                        ${this.renderMetric(copy.channels.recommendedNext, recommendedLabel)}
                      </section>

                      <div class="cp-workspace-stack">
                        ${renderSummaryPanel()}
                        ${!selectedAccounts.length || showSetupPanel ? renderSetupPanel() : nothing}
                        ${selectedAccounts.length ? renderAccountsPanel() : nothing}
                        ${qrLoginAvailable ? renderConnectPanel() : nothing}
                      </div>
                    </div>
                  `}
      </section>
    `;
  }

  private renderWorkflows() {
    const copy = uiText(this.locale);
    const selectedWorkflow = this.workflowsState.workflowDetail?.workflow;
    const selectedSpec = this.workflowsState.workflowDetail?.spec;
    const selectedExecution = this.workflowsState.workflowSelectedExecution;
    const selectedExecutionRecord =
      selectedExecution && typeof selectedExecution === "object"
        ? (selectedExecution as JsonRecord)
        : null;
    const recentExecutions =
      this.workflowsState.workflowRuns.length > 0
        ? this.workflowsState.workflowRuns
        : (this.workflowsState.workflowDetail?.recentExecutions ?? []);
    return html`
      <section class="cp-page">
        ${this.renderPageHeader("workflows", [
          {
            label: copy.workflows.registry,
            value: String(this.workflowsState.workflowsList.length),
          },
          {
            label: copy.common.selected,
            value: selectedWorkflow?.workflowId ?? copy.common.none,
            hint: selectedWorkflow?.name ?? undefined,
          },
          {
            label: copy.common.execution,
            value:
              readString(selectedExecutionRecord?.executionId, "") ||
              readString(selectedExecutionRecord?.runId, copy.common.none),
            hint: readString(selectedExecutionRecord?.status, copy.common.na),
          },
          {
            label: copy.workflows.runs,
            value: String(this.workflowsState.workflowRuns.length),
          },
        ])}
        <div class="cp-stage cp-stage--two">
          <aside class="cp-stage__rail cp-stage__rail--wide">
            <article class="cp-panel cp-panel--fill">
              <div class="cp-panel__head">
                <div>
                  <span class="cp-kicker">${copy.workflows.registryKicker}</span>
                  <h3>${copy.workflows.registryTitle}</h3>
                </div>
                <button
                  class="cp-button"
                  @click=${() =>
                    void this.safeCall(async () => {
                      await loadWorkflows(this.workflowsState);
                    })}
                >
                  ${copy.common.reload}
                </button>
              </div>
              <div class="cp-list cp-list--dense">
                ${repeat(
                  this.workflowsState.workflowsList,
                  (workflow) => workflow.workflowId,
                  (workflow) => html`
                    <button
                      class="cp-session-item ${workflow.workflowId ===
                      this.workflowsState.workflowSelectedId
                        ? "is-active"
                        : ""}"
                      @click=${() => void this.handleSelectWorkflow(workflow.workflowId)}
                    >
                      <strong>${workflow.name}</strong>
                      <span>${workflow.workflowId}</span>
                      <small
                        >${workflow.safeForAutoRun ? copy.workflows.autoRun : copy.workflows.manual}
                        · ${workflow.runCount} ${copy.workflows.runs}</small
                      >
                    </button>
                  `,
                )}
              </div>
            </article>
          </aside>
          <main class="cp-stage__main">
            <article class="cp-panel cp-panel--fill">
              <div class="cp-panel__head">
                <div>
                  <span class="cp-kicker">${copy.workflows.detailKicker}</span>
                  <h3>${selectedWorkflow?.name ?? copy.workflows.selectTitle}</h3>
                </div>
                ${selectedWorkflow
                  ? html`
                      <div class="cp-inline-actions">
                        <button
                          class="cp-button"
                          @click=${() =>
                            void this.safeCall(async () => {
                              await runWorkflow(this.workflowsState, selectedWorkflow.workflowId);
                            })}
                        >
                          ${copy.common.run}
                        </button>
                        <button
                          class="cp-button"
                          @click=${() =>
                            void this.safeCall(async () => {
                              await setWorkflowEnabled(
                                this.workflowsState,
                                selectedWorkflow.workflowId,
                                !selectedWorkflow.enabled,
                              );
                            })}
                        >
                          ${selectedWorkflow.enabled
                            ? copy.workflows.disable
                            : copy.workflows.enable}
                        </button>
                        <button
                          class="cp-button"
                          @click=${() =>
                            void this.safeCall(async () => {
                              await deployWorkflow(
                                this.workflowsState,
                                selectedWorkflow.workflowId,
                              );
                            })}
                        >
                          ${copy.common.deploy}
                        </button>
                      </div>
                    `
                  : nothing}
              </div>
              ${selectedWorkflow
                ? html`
                    <div class="cp-grid cp-grid--double">
                      <article class="cp-subpanel">
                        <h4>${copy.workflows.registryDetail}</h4>
                        <div class="cp-meta-list">
                          <div><span>ID</span><strong>${selectedWorkflow.workflowId}</strong></div>
                          <div>
                            <span>${copy.workflows.enabledState}</span
                            ><strong
                              >${selectedWorkflow.enabled
                                ? copy.common.yes
                                : copy.common.no}</strong
                            >
                          </div>
                          <div>
                            <span>${copy.workflows.approval}</span
                            ><strong
                              >${selectedWorkflow.requiresApproval
                                ? copy.workflows.required
                                : copy.workflows.notRequired}</strong
                            >
                          </div>
                          <div>
                            <span>${copy.workflows.archived}</span
                            ><strong
                              >${selectedWorkflow.archivedAt
                                ? copy.common.yes
                                : copy.common.no}</strong
                            >
                          </div>
                          <div>
                            <span>${copy.workflows.goal}</span
                            ><strong>${selectedSpec?.goal ?? copy.common.na}</strong>
                          </div>
                          <div>
                            <span>${copy.workflows.topology}</span
                            ><strong>${selectedSpec?.topology ?? copy.common.default}</strong>
                          </div>
                        </div>
                      </article>
                      <article class="cp-subpanel">
                        <h4>${copy.workflows.actionsTitle}</h4>
                        <div class="cp-action-stack">
                          <button
                            class="cp-action-card"
                            @click=${() =>
                              void this.safeCall(async () => {
                                await runWorkflow(this.workflowsState, selectedWorkflow.workflowId);
                              })}
                          >
                            <span>${copy.workflows.runWorkflow}</span>
                            <small>${copy.common.execution}</small>
                          </button>
                          <button
                            class="cp-action-card"
                            @click=${() =>
                              void this.safeCall(async () => {
                                await setWorkflowEnabled(
                                  this.workflowsState,
                                  selectedWorkflow.workflowId,
                                  !selectedWorkflow.enabled,
                                );
                              })}
                          >
                            <span>
                              ${selectedWorkflow.enabled
                                ? copy.workflows.disable
                                : copy.workflows.enable}
                            </span>
                            <small>${copy.workflows.enabledState}</small>
                          </button>
                          <button
                            class="cp-action-card"
                            @click=${() =>
                              void this.safeCall(async () => {
                                await deployWorkflow(
                                  this.workflowsState,
                                  selectedWorkflow.workflowId,
                                );
                              })}
                          >
                            <span>${copy.workflows.deployWorkflow}</span>
                            <small>${copy.workflows.actionsHint}</small>
                          </button>
                        </div>
                        <p class="cp-panel__subcopy">${copy.workflows.actionsHint}</p>
                      </article>
                    </div>
                    <section class="cp-grid cp-grid--double">
                      <article class="cp-subpanel">
                        <h4>${copy.workflows.currentExecution}</h4>
                        ${this.renderWorkflowExecutionPanel(selectedExecution)}
                      </article>
                      <article class="cp-subpanel">
                        <h4>${copy.workflows.recentRunsTitle}</h4>
                        ${recentExecutions.length
                          ? html`
                              <div class="cp-list cp-list--dense">
                                ${recentExecutions.slice(0, 5).map(
                                  (execution) => html`
                                    <div class="cp-list-item">
                                      <strong>${execution.executionId ?? copy.common.none}</strong>
                                      <small>
                                        ${execution.status ?? copy.common.na} ·
                                        ${execution.updatedAt
                                          ? formatDateTime(execution.updatedAt, this.locale)
                                          : copy.common.pending}
                                      </small>
                                    </div>
                                  `,
                                )}
                              </div>
                            `
                          : html`<p class="cp-empty">${copy.workflows.recentRunsEmpty}</p>`}
                      </article>
                    </section>
                    <article class="cp-subpanel">
                      <h4>${copy.workflows.specification}</h4>
                      ${this.renderWorkflowSpecPanel(selectedSpec)}
                    </article>
                  `
                : html`<p class="cp-empty">${copy.workflows.choosePrompt}</p>`}
            </article>
          </main>
        </div>
      </section>
    `;
  }

  private renderAgents() {
    const copy = uiText(this.locale);
    const agents = this.agentsState.agentsList?.agents ?? [];
    const selected = agents.find((agent) => agent.id === this.agentsState.agentsSelectedId) ?? null;
    const inspectionRef =
      this.agentsState.agentInspectionRunId ??
      this.agentsState.agentInspectionTaskId ??
      copy.common.none;
    const feishuCliStatus = this.channelsState.feishuCliStatus;
    const feishuCliState =
      this.channelsState.feishuCliSupported === false
        ? copy.agents.connectedAccountsHidden
        : this.channelsState.feishuCliError
          ? copy.agents.connectedAccountsAttention
          : feishuCliStatus?.authOk
            ? copy.common.available
            : feishuCliStatus
              ? copy.common.pending
              : copy.common.notLoaded;
    const feishuCliAuth =
      this.channelsState.feishuCliSupported === false
        ? copy.agents.connectedAccountsHidden
        : !feishuCliStatus?.installed
          ? copy.common.na
          : feishuCliStatus.authOk
            ? copy.common.yes
            : copy.common.no;
    const feishuCliHint =
      this.channelsState.feishuCliError ??
      feishuCliStatus?.message ??
      copy.agents.connectedAccountsHint;
    return html`
      <section class="cp-page">
        ${this.renderPageHeader("agents", [
          {
            label: copy.agents.registered,
            value: String(agents.length),
          },
          {
            label: copy.common.defaultAgent,
            value: this.agentsState.agentsList?.defaultId ?? copy.common.none,
          },
          {
            label: copy.common.selected,
            value: selected?.id ?? copy.common.none,
            hint: selected?.name ?? selected?.workspace ?? undefined,
          },
          {
            label: copy.common.execution,
            value: inspectionRef,
          },
        ])}
        <div class="cp-stage cp-stage--two">
          <aside class="cp-stage__rail cp-stage__rail--wide">
            <article class="cp-panel cp-panel--fill">
              <div class="cp-panel__head">
                <div>
                  <span class="cp-kicker">${copy.agents.registryKicker}</span>
                  <h3>${copy.agents.registryTitle}</h3>
                </div>
                <button class="cp-button" @click=${() => void this.loadAgentsSurface()}>
                  ${copy.common.reload}
                </button>
              </div>
              <div class="cp-list cp-list--dense">
                ${repeat(
                  agents,
                  (agent) => agent.id,
                  (agent) => html`
                    <button
                      class="cp-session-item ${agent.id === this.agentsState.agentsSelectedId
                        ? "is-active"
                        : ""}"
                      @click=${() => void this.handleSelectAgent(agent.id)}
                    >
                      <strong>${agent.name ?? agent.id}</strong>
                      <span>${agent.id}</span>
                      <small>${agent.workspace ?? copy.common.notReported}</small>
                    </button>
                  `,
                )}
              </div>
            </article>
          </aside>
          <main class="cp-stage__main">
            <article class="cp-panel cp-panel--fill">
              <div class="cp-panel__head">
                <div>
                  <span class="cp-kicker">${copy.agents.introspectionKicker}</span>
                  <h3>${selected?.name ?? copy.agents.detailTitle}</h3>
                </div>
              </div>
              <article class="cp-subpanel">
                <h4>${copy.agents.connectedAccountsTitle}</h4>
                ${this.renderMetaEntries([
                  {
                    label: copy.agents.feishuUserTools,
                    value: feishuCliState,
                    hint: feishuCliHint,
                  },
                  {
                    label: copy.agents.authState,
                    value: feishuCliAuth,
                    hint: feishuCliStatus?.identity ?? undefined,
                  },
                  {
                    label: copy.common.profiles,
                    value: feishuCliStatus?.profile ?? copy.common.default,
                    hint: feishuCliStatus?.command ?? "lark-cli",
                  },
                  {
                    label: copy.common.updated,
                    value: this.channelsState.feishuCliLastSuccess
                      ? formatDateTime(this.channelsState.feishuCliLastSuccess, this.locale)
                      : copy.common.notRecorded,
                    hint: this.channelsState.feishuCliLastSuccess
                      ? formatAgo(this.channelsState.feishuCliLastSuccess, this.locale)
                      : undefined,
                  },
                  {
                    label: copy.agents.checkCommand,
                    value: "crawclaw feishu-cli status --verify",
                  },
                  {
                    label: copy.agents.loginCommand,
                    value: "crawclaw feishu-cli auth login",
                  },
                ])}
                <p class="cp-panel__subcopy">${copy.agents.connectedAccountsHint}</p>
              </article>
              ${selected
                ? html`
                    <div class="cp-grid cp-grid--double">
                      <article class="cp-subpanel">
                        <h4>${copy.agents.identity}</h4>
                        <div class="cp-meta-list">
                          <div><span>ID</span><strong>${selected.id}</strong></div>
                          <div>
                            <span>${copy.common.workspace}</span
                            ><strong>${selected.workspace ?? copy.common.na}</strong>
                          </div>
                          <div>
                            <span>${copy.agents.primaryModel}</span
                            ><strong>${selected.model?.primary ?? copy.common.default}</strong>
                          </div>
                          <div>
                            <span>${copy.agents.workspaceHint}</span
                            ><strong>${selected.workspace ?? copy.common.notReported}</strong>
                          </div>
                        </div>
                      </article>
                      <article class="cp-subpanel">
                        <h4>${copy.agents.inspectionSnapshot}</h4>
                        ${this.renderAgentInspectionPanel(this.agentsState.agentInspectionSnapshot)}
                      </article>
                    </div>
                    <article class="cp-subpanel">
                      <h4>${copy.agents.runtimeSummary}</h4>
                      ${this.renderMetaEntries([
                        {
                          label: copy.common.execution,
                          value: inspectionRef,
                        },
                        {
                          label: copy.common.session,
                          value: sessionReferenceDisplay(
                            this.settings.sessionKey,
                            this.sessionsState.sessionsResult?.sessions ?? [],
                          ),
                          hint: sessionReferenceHint(
                            this.settings.sessionKey,
                            this.sessionsState.sessionsResult?.sessions ?? [],
                          ),
                        },
                        {
                          label: copy.common.groups,
                          value: primitiveSummary(
                            (this.agentsState.toolsCatalogResult as JsonRecord | null)?.groups
                              ? Array.isArray(
                                  (this.agentsState.toolsCatalogResult as JsonRecord).groups,
                                )
                                ? (
                                    (this.agentsState.toolsCatalogResult as JsonRecord)
                                      .groups as unknown[]
                                  ).length
                                : 0
                              : 0,
                          ),
                        },
                        {
                          label: copy.common.tools,
                          value: primitiveSummary(
                            (this.agentsState.toolsEffectiveResult as JsonRecord | null)?.groups
                              ? Array.isArray(
                                  (this.agentsState.toolsEffectiveResult as JsonRecord).groups,
                                )
                                ? (
                                    (this.agentsState.toolsEffectiveResult as JsonRecord)
                                      .groups as unknown[]
                                  ).length
                                : 0
                              : 0,
                          ),
                        },
                      ])}
                    </article>
                    <section class="cp-grid cp-grid--double">
                      <article class="cp-subpanel">
                        <h4>${copy.agents.toolsCatalog}</h4>
                        ${this.renderToolsCatalogPanel()}
                      </article>
                      <article class="cp-subpanel">
                        <h4>${copy.agents.effectiveTools}</h4>
                        ${this.renderToolsEffectivePanel()}
                      </article>
                    </section>
                    <p class="cp-panel__subcopy">${copy.agents.toolsHint}</p>
                  `
                : html`<p class="cp-empty">${copy.agents.selectPrompt}</p>`}
            </article>
          </main>
        </div>
      </section>
    `;
  }

  private renderMemory() {
    const copy = uiText(this.locale);
    const providerStatus = this.memoryState.providerStatus;
    const dreamStatus = this.memoryState.dreamStatus;
    const summaryStatus = this.memoryState.summariesStatus;
    const journalSummary = this.memoryState.journalSummary;
    const lifecycle = summarizeMemoryProviderLifecycle(providerStatus, this.locale);
    const summaryState = summarizeMemorySummaryState(summaryStatus, this.locale);
    const recommendedAction = providerStatus?.recommendedAction ?? copy.common.none;
    const sessions = (this.sessionsState.sessionsResult?.sessions ?? []).filter(
      (session) => session.kind !== "global",
    );
    const selectedSummarySession = resolveSessionRowByKey(
      sessions,
      this.memoryState.summariesSelectedSessionKey,
    );
    const filteredSessions = sessions.filter((session) => {
      if (!this.memorySessionQuery.trim()) {
        return true;
      }
      const query = this.memorySessionQuery.trim().toLowerCase();
      return [session.displayName, session.label, session.key, session.sessionId, session.surface]
        .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
        .some((value) => value.toLowerCase().includes(query));
    });

    let mainPanel: ReturnType<typeof html> | typeof nothing = nothing;
    if (this.memoryState.activeSection === "provider") {
      mainPanel = html`
        <article class="cp-panel">
          <div class="cp-panel__head">
            <div>
              <span class="cp-kicker">${copy.memory.providerKicker}</span>
              <h3>${copy.memory.providerTitle}</h3>
            </div>
            <div class="cp-inline-actions">
              <button
                class="cp-button"
                ?disabled=${this.memoryState.providerRefreshing}
                @click=${() =>
                  void this.safeCall(async () => refreshMemoryProvider(this.memoryState))}
              >
                ${copy.memory.refreshProvider}
              </button>
              <button
                class="cp-button cp-button--primary"
                ?disabled=${this.memoryState.providerLoginBusy}
                @click=${() =>
                  void this.safeCall(async () => loginMemoryProvider(this.memoryState))}
              >
                ${copy.memory.runLoginFlow}
              </button>
            </div>
          </div>
          ${this.renderMetaEntries(
            [
              { label: copy.common.status, value: lifecycle },
              { label: copy.common.provider, value: providerStatus?.provider ?? copy.common.na },
              {
                label: copy.common.valid,
                value: providerStatus?.ready ? copy.common.yes : copy.common.no,
              },
              { label: copy.memory.recommendedAction, value: recommendedAction },
              { label: copy.memory.profile, value: providerStatus?.profile ?? copy.common.na },
              {
                label: copy.memory.notebookId,
                value: providerStatus?.notebookId ?? copy.common.na,
              },
              {
                label: copy.memory.authSource,
                value: providerStatus?.authSource ?? copy.common.na,
              },
              {
                label: copy.memory.lastValidated,
                value: formatIsoDateTime(providerStatus?.lastValidatedAt, this.locale),
              },
              {
                label: copy.memory.lastRefresh,
                value: formatIsoDateTime(providerStatus?.lastRefreshAt, this.locale),
              },
              {
                label: copy.memory.nextProbe,
                value: formatIsoDateTime(providerStatus?.nextProbeAt, this.locale),
              },
              {
                label: copy.memory.nextRefresh,
                value: formatIsoDateTime(providerStatus?.nextAllowedRefreshAt, this.locale),
              },
              { label: copy.memory.details, value: providerStatus?.details ?? copy.common.none },
            ],
            this.memoryState.providerError ?? copy.common.notLoaded,
          )}
        </article>
      `;
    } else if (this.memoryState.activeSection === "dreaming") {
      const runs = dreamStatus?.runs ?? [];
      mainPanel = html`
        <article class="cp-panel">
          <div class="cp-panel__head">
            <div>
              <span class="cp-kicker">${copy.memory.dreamingKicker}</span>
              <h3>${copy.memory.dreamingTitle}</h3>
            </div>
            <div class="cp-inline-actions">
              <button
                class="cp-button cp-button--primary"
                ?disabled=${this.memoryState.dreamActionBusy}
                @click=${() => void this.safeCall(async () => runMemoryDream(this.memoryState))}
              >
                ${copy.memory.runNow}
              </button>
              <button
                class="cp-button"
                ?disabled=${this.memoryState.dreamActionBusy}
                @click=${() =>
                  void this.safeCall(async () =>
                    runMemoryDream(this.memoryState, { dryRun: true }),
                  )}
              >
                ${copy.memory.dryRun}
              </button>
              <button
                class="cp-button"
                ?disabled=${this.memoryState.dreamActionBusy}
                @click=${() =>
                  void this.safeCall(async () => runMemoryDream(this.memoryState, { force: true }))}
              >
                ${copy.memory.forceRun}
              </button>
            </div>
          </div>
          ${this.renderMetaEntries(
            [
              {
                label: copy.common.status,
                value: dreamStatus?.enabled ? copy.common.yes : copy.common.no,
              },
              { label: copy.memory.scope, value: dreamStatus?.scopeKey ?? copy.common.none },
              { label: "minHours", value: dreamStatus?.config.minHours ?? copy.common.na },
              { label: "minSessions", value: dreamStatus?.config.minSessions ?? copy.common.na },
              {
                label: "scanThrottleMs",
                value: dreamStatus?.config.scanThrottleMs ?? copy.common.na,
              },
              {
                label: copy.memory.lastSuccess,
                value: formatIsoDateTime(dreamStatus?.state?.lastSuccessAt, this.locale),
              },
              {
                label: copy.memory.lastAttempt,
                value: formatIsoDateTime(dreamStatus?.state?.lastAttemptAt, this.locale),
              },
              {
                label: copy.memory.lastFailure,
                value: formatIsoDateTime(dreamStatus?.state?.lastFailureAt, this.locale),
              },
              {
                label: copy.memory.lastSkipReason,
                value: dreamStatus?.state?.lastSkipReason ?? copy.common.none,
              },
              {
                label: copy.memory.lockOwner,
                value: dreamStatus?.state?.lockOwner ?? copy.common.none,
              },
            ],
            this.memoryState.dreamError ?? copy.common.notLoaded,
          )}
          ${this.memoryState.dreamActionMessage
            ? html`<p class="cp-panel__subcopy">${this.memoryState.dreamActionMessage}</p>`
            : nothing}
        </article>
        <article class="cp-panel">
          <div class="cp-panel__head">
            <div>
              <span class="cp-kicker">${copy.memory.dreamingKicker}</span>
              <h3>${copy.memory.recentRuns}</h3>
            </div>
          </div>
          ${runs.length
            ? html`
                <div class="cp-table-wrap">
                  <table class="cp-table">
                    <thead>
                      <tr>
                        <th>${copy.common.status}</th>
                        <th>${copy.memory.scope}</th>
                        <th>${copy.memory.trigger}</th>
                        <th>${copy.memory.runId}</th>
                        <th>${copy.common.summary}</th>
                        <th>${copy.common.updated}</th>
                      </tr>
                    </thead>
                    <tbody>
                      ${runs.map(
                        (run) => html`
                          <tr>
                            <td>${run.status}</td>
                            <td>${run.scope ?? copy.common.none}</td>
                            <td>${run.triggerSource ?? copy.common.none}</td>
                            <td>${run.runId ?? copy.common.none}</td>
                            <td>${summarizeDreamRunReason(run) ?? copy.common.none}</td>
                            <td>${formatIsoDateTime(run.createdAt, this.locale)}</td>
                          </tr>
                        `,
                      )}
                    </tbody>
                  </table>
                </div>
              `
            : html`<p class="cp-empty">${copy.common.notLoaded}</p>`}
        </article>
      `;
    } else if (this.memoryState.activeSection === "summaries") {
      mainPanel = html`
        <article class="cp-panel">
          <div class="cp-panel__head">
            <div>
              <span class="cp-kicker">${copy.memory.summariesKicker}</span>
              <h3>${copy.memory.summariesTitle}</h3>
            </div>
            <div class="cp-inline-actions">
              <button
                class="cp-button cp-button--primary"
                ?disabled=${this.memoryState.summariesRefreshBusy ||
                !this.memoryState.summariesSelectedSessionId}
                @click=${() =>
                  void this.safeCall(async () => refreshMemorySessionSummary(this.memoryState))}
              >
                ${copy.memory.forceRefresh}
              </button>
            </div>
          </div>
          ${summaryStatus
            ? this.renderMetaEntries([
                { label: copy.common.agent, value: summaryStatus.agentId },
                { label: copy.memory.sessionId, value: summaryStatus.sessionId },
                { label: copy.common.path, value: summaryStatus.summaryPath },
                {
                  label: copy.common.exists,
                  value: summaryStatus.exists ? copy.common.yes : copy.common.no,
                },
                {
                  label: copy.common.updated,
                  value: formatIsoDateTime(summaryStatus.updatedAt, this.locale),
                },
                {
                  label: copy.memory.lastSummarizedMessage,
                  value: summaryStatus.state?.lastSummarizedMessageId ?? copy.common.none,
                },
                {
                  label: copy.memory.lastSummaryUpdate,
                  value: formatIsoDateTime(summaryStatus.state?.lastSummaryUpdatedAt, this.locale),
                },
                {
                  label: copy.common.tokens,
                  value: summaryStatus.state?.tokensAtLastSummary ?? 0,
                },
                {
                  label: copy.memory.inProgress,
                  value: summaryStatus.state?.summaryInProgress ? copy.common.yes : copy.common.no,
                },
              ])
            : html`<p class="cp-empty">
                ${this.memoryState.summariesError ?? copy.memory.selectSession}
              </p>`}
        </article>
        <section class="cp-grid cp-grid--double">
          <article class="cp-subpanel">
            <h4>${copy.memory.currentState}</h4>
            <pre class="cp-code cp-code--compact">
${summaryStatus?.sections.currentState || copy.common.none}</pre
            >
          </article>
          <article class="cp-subpanel">
            <h4>${copy.memory.taskSpecification}</h4>
            <pre class="cp-code cp-code--compact">
${summaryStatus?.sections.taskSpecification || copy.common.none}</pre
            >
          </article>
          <article class="cp-subpanel">
            <h4>${copy.memory.keyResults}</h4>
            <pre class="cp-code cp-code--compact">
${summaryStatus?.sections.keyResults || copy.common.none}</pre
            >
          </article>
          <article class="cp-subpanel">
            <h4>${copy.memory.errorsAndCorrections}</h4>
            <pre class="cp-code cp-code--compact">
${summaryStatus?.sections.errorsAndCorrections || copy.common.none}</pre
            >
          </article>
        </section>
      `;
    } else {
      mainPanel = html`
        <article class="cp-panel">
          <div class="cp-panel__head">
            <div>
              <span class="cp-kicker">${copy.memory.journalKicker}</span>
              <h3>${copy.memory.journalTitle}</h3>
            </div>
            <button
              class="cp-button cp-button--primary"
              ?disabled=${this.memoryState.journalLoading}
              @click=${() =>
                void this.safeCall(async () => loadMemoryPromptJournal(this.memoryState))}
            >
              ${copy.memory.summarizeJournal}
            </button>
          </div>
          ${journalSummary
            ? html`
                <section class="cp-band">
                  ${this.renderMetric(
                    copy.memory.promptAssemblies,
                    String(journalSummary.promptAssembly.count),
                  )}
                  ${this.renderMetric(
                    copy.memory.durableExtractions,
                    String(journalSummary.durableExtraction.count),
                  )}
                  ${this.renderMetric(
                    copy.memory.knowledgeWrites,
                    String(countObjectKeys(journalSummary.knowledgeWrite.statusCounts)),
                  )}
                  ${this.renderMetric(copy.common.sessions, String(journalSummary.uniqueSessions))}
                </section>
                <section class="cp-grid cp-grid--double">
                  <article class="cp-subpanel">
                    <h4>${copy.memory.topReasons}</h4>
                    ${journalSummary.durableExtraction.topReasons.length
                      ? html`
                          <div class="cp-list cp-list--dense">
                            ${journalSummary.durableExtraction.topReasons.map(
                              (entry) => html`
                                <div class="cp-list-item">
                                  <strong>${entry.reason}</strong>
                                  <small>${entry.count}</small>
                                </div>
                              `,
                            )}
                          </div>
                        `
                      : html`<p class="cp-empty">${copy.common.none}</p>`}
                  </article>
                  <article class="cp-subpanel">
                    <h4>${copy.memory.writeOutcomes}</h4>
                    ${this.renderMetaEntries([
                      { label: "Files", value: journalSummary.files.length },
                      { label: "Events", value: journalSummary.totalEvents },
                      {
                        label: "Save rate",
                        value: journalSummary.durableExtraction.saveRate ?? copy.common.na,
                      },
                      {
                        label: "Statuses",
                        value: countObjectKeys(journalSummary.knowledgeWrite.statusCounts),
                      },
                      {
                        label: "Actions",
                        value: countObjectKeys(journalSummary.knowledgeWrite.actionCounts),
                      },
                    ])}
                  </article>
                </section>
              `
            : html`<p class="cp-empty">
                ${this.memoryState.journalError ?? copy.memory.noJournal}
              </p>`}
        </article>
      `;
    }

    return html`
      <section class="cp-page">
        ${this.renderPageHeader("memory", [
          { label: copy.memory.provider, value: lifecycle },
          {
            label: copy.memory.dreaming,
            value: dreamStatus?.enabled ? copy.common.yes : copy.common.no,
          },
          {
            label: copy.memory.sessionSummaries,
            value: summaryState,
            hint: selectedSummarySession
              ? sessionDisplayName(selectedSummarySession)
              : (summaryStatus?.sessionId ?? undefined),
          },
          {
            label: copy.memory.recommendedAction,
            value: recommendedAction,
          },
        ])}
        <div class="cp-stage cp-stage--three">
          <aside class="cp-stage__rail">
            <article class="cp-panel">
              <div class="cp-panel__head">
                <div>
                  <span class="cp-kicker">${copy.memory.provider}</span>
                  <h3>${metaForPage("memory", this.locale).label}</h3>
                </div>
              </div>
              <div class="cp-action-stack">
                ${(
                  [
                    ["provider", copy.memory.provider],
                    ["dreaming", copy.memory.dreaming],
                    ["summaries", copy.memory.sessionSummaries],
                    ["journal", copy.memory.promptJournal],
                  ] as const
                ).map(
                  ([section, label]) => html`
                    <button
                      class="cp-action-card ${this.memoryState.activeSection === section
                        ? "is-active"
                        : ""}"
                      @click=${() => void this.activateMemorySection(section)}
                    >
                      <span>${label}</span>
                      <small>${section}</small>
                    </button>
                  `,
                )}
              </div>
            </article>
            ${this.memoryState.activeSection === "dreaming"
              ? html`
                  <article class="cp-panel">
                    <div class="cp-panel__head">
                      <div>
                        <span class="cp-kicker">${copy.memory.dreamingKicker}</span>
                        <h3>Scope filters</h3>
                      </div>
                    </div>
                    <form
                      class="cp-form"
                      @submit=${(event: Event) => {
                        event.preventDefault();
                        void this.safeCall(async () => loadMemoryDreaming(this.memoryState));
                      }}
                    >
                      <label>
                        <span>${copy.common.agent}</span>
                        <input
                          .value=${this.memoryState.dreamAgent}
                          @input=${(event: Event) => {
                            this.memoryState.dreamAgent = (event.target as HTMLInputElement).value;
                            this.requestUpdate();
                          }}
                        />
                      </label>
                      <label>
                        <span>${copy.common.surface}</span>
                        <input
                          .value=${this.memoryState.dreamChannel}
                          @input=${(event: Event) => {
                            this.memoryState.dreamChannel = (
                              event.target as HTMLInputElement
                            ).value;
                            this.requestUpdate();
                          }}
                        />
                      </label>
                      <label>
                        <span>User</span>
                        <input
                          .value=${this.memoryState.dreamUser}
                          @input=${(event: Event) => {
                            this.memoryState.dreamUser = (event.target as HTMLInputElement).value;
                            this.requestUpdate();
                          }}
                        />
                      </label>
                      <label>
                        <span>Scope key</span>
                        <input
                          .value=${this.memoryState.dreamScopeKey}
                          @input=${(event: Event) => {
                            this.memoryState.dreamScopeKey = (
                              event.target as HTMLInputElement
                            ).value;
                            this.requestUpdate();
                          }}
                        />
                      </label>
                      <div class="cp-form__actions">
                        <button class="cp-button cp-button--primary" type="submit">
                          ${copy.common.refresh}
                        </button>
                      </div>
                    </form>
                  </article>
                `
              : nothing}
            ${this.memoryState.activeSection === "summaries"
              ? html`
                  <article class="cp-panel cp-panel--fill">
                    <div class="cp-panel__head">
                      <div>
                        <span class="cp-kicker">${copy.memory.summariesKicker}</span>
                        <h3>${copy.memory.sessionSummaries}</h3>
                      </div>
                    </div>
                    <div class="cp-session-console__search">
                      <span>${copy.common.session}</span>
                      <input
                        .value=${this.memorySessionQuery}
                        placeholder=${copy.memory.selectSession}
                        @input=${(event: Event) => {
                          this.memorySessionQuery = (event.target as HTMLInputElement).value;
                          this.requestUpdate();
                        }}
                      />
                    </div>
                    <div class="cp-session-console__list">
                      <div class="cp-list">
                        ${filteredSessions.length
                          ? filteredSessions.map(
                              (session) => html`
                                <button
                                  class="cp-session-item ${this.memoryState
                                    .summariesSelectedSessionKey === session.key
                                    ? "is-active"
                                    : ""}"
                                  @click=${() => void this.handleSelectMemorySession(session)}
                                >
                                  <strong>${sessionDisplayName(session)}</strong>
                                  <span>${sessionSurfaceLabel(session)}</span>
                                  <small>
                                    ${session.kind} ·
                                    ${formatMaybeDate(session.updatedAt, this.locale)}
                                  </small>
                                </button>
                              `,
                            )
                          : html`<p class="cp-empty">${copy.memory.selectSession}</p>`}
                      </div>
                    </div>
                  </article>
                `
              : nothing}
            ${this.memoryState.activeSection === "journal"
              ? html`
                  <article class="cp-panel">
                    <div class="cp-panel__head">
                      <div>
                        <span class="cp-kicker">${copy.memory.journalKicker}</span>
                        <h3>${copy.memory.promptJournal}</h3>
                      </div>
                    </div>
                    <form
                      class="cp-form"
                      @submit=${(event: Event) => {
                        event.preventDefault();
                        void this.safeCall(async () => loadMemoryPromptJournal(this.memoryState));
                      }}
                    >
                      <label>
                        <span>Days</span>
                        <input
                          type="number"
                          min="1"
                          .value=${this.memoryState.journalDays}
                          @input=${(event: Event) => {
                            this.memoryState.journalDays = (event.target as HTMLInputElement).value;
                            this.requestUpdate();
                          }}
                        />
                      </label>
                      <div class="cp-form__actions">
                        <button class="cp-button cp-button--primary" type="submit">
                          ${copy.memory.summarizeJournal}
                        </button>
                      </div>
                    </form>
                  </article>
                `
              : nothing}
          </aside>
          <main class="cp-stage__main">${mainPanel}</main>
          <aside class="cp-stage__rail">
            <article class="cp-panel">
              <div class="cp-panel__head">
                <div>
                  <span class="cp-kicker">${copy.memory.healthKicker}</span>
                  <h3>${copy.memory.healthTitle}</h3>
                </div>
              </div>
              ${this.renderMetaEntries([
                { label: copy.memory.provider, value: lifecycle },
                {
                  label: copy.memory.dreaming,
                  value: dreamStatus?.enabled ? copy.common.yes : copy.common.no,
                },
                { label: copy.memory.sessionSummaries, value: summaryState },
                { label: copy.memory.recommendedAction, value: recommendedAction },
              ])}
            </article>
            <article class="cp-panel">
              <div class="cp-panel__head">
                <div>
                  <span class="cp-kicker">${copy.common.latest}</span>
                  <h3>${copy.common.summary}</h3>
                </div>
              </div>
              ${this.renderMetaEntries(
                [
                  {
                    label: "Provider validated",
                    value: formatIsoDateTime(providerStatus?.lastValidatedAt, this.locale),
                  },
                  {
                    label: "Dream run",
                    value: dreamStatus?.runs[0]?.status ?? copy.common.none,
                    hint: formatIsoDateTime(dreamStatus?.runs[0]?.createdAt, this.locale),
                  },
                  {
                    label: "Summary session",
                    value: selectedSummarySession
                      ? sessionDisplayName(selectedSummarySession)
                      : (summaryStatus?.sessionId ?? copy.common.none),
                    hint: sessionReferenceHint(
                      this.memoryState.summariesSelectedSessionKey,
                      sessions,
                    ),
                  },
                  {
                    label: "Journal files",
                    value: journalSummary?.files.length ?? 0,
                  },
                ],
                copy.common.notLoaded,
              )}
              ${this.memoryState.providerActionMessage
                ? html`<p class="cp-panel__subcopy">${this.memoryState.providerActionMessage}</p>`
                : nothing}
            </article>
          </aside>
        </div>
      </section>
    `;
  }

  private renderAgentRuntime() {
    const copy = uiText(this.locale);
    const summary = this.agentRuntimeState.runtimeSummary;
    const selected = this.agentRuntimeState.runtimeSelectedDetail;
    const runtimeSessions = this.sessionsState.sessionsResult?.sessions ?? [];
    const runtimeSessionDisplay = (sessionKey?: string | null) =>
      sessionReferenceDisplay(sessionKey, runtimeSessions);
    const runtimeSessionHint = (sessionKey?: string | null) =>
      sessionReferenceHint(sessionKey, runtimeSessions);
    const totalRuns = summary
      ? Object.values(summary.byCategory).reduce((sum, count) => sum + count, 0)
      : 0;
    const categoryButtons = [
      { id: "all", label: copy.runtime.all, count: totalRuns },
      { id: "memory", label: copy.runtime.memory, count: summary?.byCategory.memory ?? 0 },
      {
        id: "verification",
        label: copy.runtime.verification,
        count: summary?.byCategory.verification ?? 0,
      },
      {
        id: "subagents",
        label: copy.runtime.subagents,
        count: summary?.byCategory.subagents ?? 0,
      },
      { id: "acp", label: copy.runtime.acp, count: summary?.byCategory.acp ?? 0 },
      { id: "cron", label: copy.runtime.cron, count: summary?.byCategory.cron ?? 0 },
      { id: "cli", label: copy.runtime.cli, count: summary?.byCategory.cli ?? 0 },
    ] as const;
    const statusButtons = [
      { id: "all", label: copy.runtime.all, count: totalRuns },
      { id: "running", label: copy.runtime.running, count: summary?.running ?? 0 },
      { id: "waiting", label: copy.runtime.waiting, count: summary?.waiting ?? 0 },
      { id: "failed", label: copy.runtime.failed, count: summary?.failed ?? 0 },
      { id: "completed", label: copy.runtime.completed, count: summary?.completed ?? 0 },
      {
        id: "attention",
        label: copy.runtime.attention,
        count: summary?.failed ?? 0,
      },
    ] as const;

    return html`
      <section class="cp-page">
        ${this.renderPageHeader("runtime", [
          { label: copy.runtime.running, value: String(summary?.running ?? 0) },
          { label: copy.runtime.failed, value: String(summary?.failed ?? 0) },
          { label: copy.runtime.waiting, value: String(summary?.waiting ?? 0) },
          {
            label: copy.runtime.lastCompleted,
            value: summary?.lastCompletedAt
              ? formatIsoDateTime(summary.lastCompletedAt, this.locale)
              : copy.common.none,
          },
        ])}
        <div class="cp-stage cp-stage--three">
          <aside class="cp-stage__rail">
            <article class="cp-panel">
              <div class="cp-panel__head">
                <div>
                  <span class="cp-kicker">${copy.runtime.categoryKicker}</span>
                  <h3>${copy.runtime.categoryTitle}</h3>
                </div>
              </div>
              <div class="cp-action-stack">
                ${categoryButtons.map(
                  (entry) => html`
                    <button
                      class="cp-action-card ${this.agentRuntimeState.runtimeCategory === entry.id
                        ? "is-active"
                        : ""}"
                      @click=${() => {
                        this.agentRuntimeState.runtimeCategory = entry.id;
                        void this.loadAgentRuntimeSurface();
                      }}
                    >
                      <span>${entry.label}</span>
                      <small>${entry.count}</small>
                    </button>
                  `,
                )}
              </div>
            </article>
            <article class="cp-panel">
              <div class="cp-panel__head">
                <div>
                  <span class="cp-kicker">${copy.runtime.statusKicker}</span>
                  <h3>${copy.runtime.statusTitle}</h3>
                </div>
              </div>
              <div class="cp-action-stack">
                ${statusButtons.map(
                  (entry) => html`
                    <button
                      class="cp-action-card ${this.agentRuntimeState.runtimeStatus === entry.id
                        ? "is-active"
                        : ""}"
                      @click=${() => {
                        this.agentRuntimeState.runtimeStatus = entry.id;
                        void this.loadAgentRuntimeSurface();
                      }}
                    >
                      <span>${entry.label}</span>
                      <small>${entry.count}</small>
                    </button>
                  `,
                )}
              </div>
            </article>
            <article class="cp-panel">
              <div class="cp-panel__head">
                <div>
                  <span class="cp-kicker">${copy.runtime.queryKicker}</span>
                  <h3>${copy.runtime.queryTitle}</h3>
                </div>
              </div>
              <form
                class="cp-form"
                @submit=${(event: Event) => {
                  event.preventDefault();
                  void this.loadAgentRuntimeSurface();
                }}
              >
                <label>
                  <span>${copy.common.agent}</span>
                  <input
                    .value=${this.agentRuntimeState.runtimeAgent}
                    @input=${(event: Event) => {
                      this.agentRuntimeState.runtimeAgent = (
                        event.target as HTMLInputElement
                      ).value;
                      this.requestUpdate();
                    }}
                  />
                </label>
                <label>
                  <span>${copy.runtime.parentSession}</span>
                  <input
                    .value=${this.agentRuntimeState.runtimeSessionKey}
                    @input=${(event: Event) => {
                      this.agentRuntimeState.runtimeSessionKey = (
                        event.target as HTMLInputElement
                      ).value;
                      this.requestUpdate();
                    }}
                  />
                </label>
                <label>
                  <span>${copy.runtime.taskId}</span>
                  <input
                    .value=${this.agentRuntimeState.runtimeTaskQuery}
                    @input=${(event: Event) => {
                      this.agentRuntimeState.runtimeTaskQuery = (
                        event.target as HTMLInputElement
                      ).value;
                      this.requestUpdate();
                    }}
                  />
                </label>
                <label>
                  <span>${copy.runtime.runId}</span>
                  <input
                    .value=${this.agentRuntimeState.runtimeRunQuery}
                    @input=${(event: Event) => {
                      this.agentRuntimeState.runtimeRunQuery = (
                        event.target as HTMLInputElement
                      ).value;
                      this.requestUpdate();
                    }}
                  />
                </label>
                <div class="cp-form__actions">
                  <button class="cp-button cp-button--primary" type="submit">
                    ${copy.runtime.refreshRuns}
                  </button>
                </div>
              </form>
            </article>
          </aside>

          <main class="cp-stage__main">
            <article class="cp-panel cp-panel--fill">
              <div class="cp-panel__head">
                <div>
                  <span class="cp-kicker">${copy.runtime.registryKicker}</span>
                  <h3>${copy.runtime.registryTitle}</h3>
                </div>
                <button class="cp-button" @click=${() => void this.loadAgentRuntimeSurface()}>
                  ${copy.common.refresh}
                </button>
              </div>
              ${this.agentRuntimeState.runtimeError
                ? html`<p class="cp-empty">${this.agentRuntimeState.runtimeError}</p>`
                : this.agentRuntimeState.runtimeRuns.length
                  ? html`
                      <div class="cp-table-wrap">
                        <table class="cp-table">
                          <thead>
                            <tr>
                              <th>${copy.common.kind}</th>
                              <th>${copy.common.status}</th>
                              <th>${copy.runtime.updatedAt}</th>
                              <th>${copy.runtime.parentSession}</th>
                              <th>${copy.runtime.taskId}</th>
                              <th>${copy.common.summary}</th>
                            </tr>
                          </thead>
                          <tbody>
                            ${repeat(
                              this.agentRuntimeState.runtimeRuns,
                              (run) => run.taskId,
                              (run) => html`
                                <tr
                                  class=${this.agentRuntimeState.runtimeSelectedTaskId ===
                                  run.taskId
                                    ? "is-active"
                                    : ""}
                                  @click=${() =>
                                    void this.safeCall(async () => {
                                      await selectAgentRuntimeTask(
                                        this.agentRuntimeState,
                                        run.taskId,
                                      );
                                    })}
                                >
                                  <td>
                                    <strong>${run.title}</strong>
                                    <small>${run.category} · ${run.runtime}</small>
                                  </td>
                                  <td>${this.renderRuntimeStatusBadge(run.status)}</td>
                                  <td>
                                    <strong>${formatDateTime(run.updatedAt, this.locale)}</strong>
                                    <small>${formatAgo(run.updatedAt, this.locale)}</small>
                                  </td>
                                  <td>
                                    <strong>${runtimeSessionDisplay(run.sessionKey)}</strong>
                                    <small>
                                      ${run.childSessionKey
                                        ? runtimeSessionDisplay(run.childSessionKey)
                                        : copy.common.none}
                                    </small>
                                  </td>
                                  <td>
                                    <strong>${run.taskId}</strong>
                                    <small>${run.runId ?? copy.common.none}</small>
                                  </td>
                                  <td>${run.summary ?? copy.common.none}</td>
                                </tr>
                              `,
                            )}
                          </tbody>
                        </table>
                      </div>
                    `
                  : html`<p class="cp-empty">${copy.runtime.noRuns}</p>`}
            </article>
          </main>

          <aside class="cp-stage__rail">
            <article class="cp-panel">
              <div class="cp-panel__head">
                <div>
                  <span class="cp-kicker">${copy.runtime.detailsTitle}</span>
                  <h3>${copy.runtime.currentRun}</h3>
                </div>
              </div>
              ${selected
                ? this.renderMetaEntries([
                    { label: copy.common.kind, value: selected.run.title },
                    { label: copy.common.status, value: selected.run.status },
                    { label: copy.runtime.taskId, value: selected.run.taskId },
                    { label: copy.runtime.runId, value: selected.run.runId ?? copy.common.none },
                    { label: copy.common.agent, value: selected.run.agentId ?? copy.common.none },
                    {
                      label: copy.runtime.parentSession,
                      value: runtimeSessionDisplay(selected.run.sessionKey),
                      hint: runtimeSessionHint(selected.run.sessionKey),
                    },
                    {
                      label: copy.runtime.childSession,
                      value: selected.run.childSessionKey
                        ? runtimeSessionDisplay(selected.run.childSessionKey)
                        : copy.common.none,
                      hint: runtimeSessionHint(selected.run.childSessionKey),
                    },
                    {
                      label: copy.common.updated,
                      value: formatDateTime(selected.run.updatedAt, this.locale),
                    },
                    {
                      label: copy.runtime.lastCompleted,
                      value: selected.run.endedAt
                        ? formatDateTime(selected.run.endedAt, this.locale)
                        : copy.common.none,
                    },
                  ])
                : html`<p class="cp-empty">${copy.runtime.choosePrompt}</p>`}
            </article>
            <article class="cp-panel">
              <div class="cp-panel__head">
                <div>
                  <span class="cp-kicker">${copy.common.summary}</span>
                  <h3>${copy.runtime.contractTitle}</h3>
                </div>
              </div>
              ${selected
                ? this.renderMetaEntries([
                    {
                      label: "Definition",
                      value: selected.contract.definitionLabel ?? copy.common.none,
                    },
                    {
                      label: "Spawn source",
                      value: selected.contract.spawnSource ?? copy.common.none,
                    },
                    {
                      label: "Execution mode",
                      value: selected.contract.executionMode ?? copy.common.none,
                    },
                    {
                      label: "Transcript policy",
                      value: selected.contract.transcriptPolicy ?? copy.common.none,
                    },
                    { label: "Cleanup", value: selected.contract.cleanup ?? copy.common.none },
                    { label: "Sandbox", value: selected.contract.sandbox ?? copy.common.none },
                    {
                      label: "Tool allowlist",
                      value: selected.contract.toolAllowlistCount ?? copy.common.none,
                    },
                  ])
                : html`<p class="cp-empty">${copy.runtime.choosePrompt}</p>`}
            </article>
            <article class="cp-panel">
              <div class="cp-panel__head">
                <div>
                  <span class="cp-kicker">${copy.common.summary}</span>
                  <h3>${copy.runtime.actionsTitle}</h3>
                </div>
              </div>
              ${selected
                ? html`
                    <div class="cp-form__actions">
                      <button
                        class="cp-button"
                        ?disabled=${!selected.availableActions.openSession}
                        @click=${() =>
                          void this.openRuntimeSession(
                            selected.run.childSessionKey ?? selected.run.sessionKey,
                          )}
                      >
                        ${copy.runtime.openSession}
                      </button>
                      <button
                        class="cp-button cp-button--danger"
                        ?disabled=${!selected.availableActions.cancel ||
                        this.agentRuntimeState.runtimeActionBusy}
                        @click=${() =>
                          void this.safeCall(async () => {
                            await cancelAgentRuntimeTask(this.agentRuntimeState);
                          })}
                      >
                        ${copy.common.cancel}
                      </button>
                    </div>
                  `
                : html`<p class="cp-empty">${copy.runtime.choosePrompt}</p>`}
              ${this.agentRuntimeState.runtimeActionMessage
                ? html`<p class="cp-panel__subcopy">
                    ${this.agentRuntimeState.runtimeActionMessage}
                  </p>`
                : nothing}
            </article>
          </aside>
        </div>
      </section>
    `;
  }

  private renderUsage() {
    const copy = uiText(this.locale);
    const sessions = this.usageState.usageResult?.sessions ?? [];
    const selectedUsageSession = resolveSessionRowByKey(
      sessions,
      this.usageState.usageSelectedSessions[0],
    );
    const usageRange = `${this.usageState.usageStartDate} → ${this.usageState.usageEndDate}`;
    return html`
      <section class="cp-page">
        ${this.renderPageHeader("usage", [
          {
            label: copy.common.cost,
            value: `$${readUsageCost(this.usageState.usageCostSummary).toFixed(2)}`,
          },
          {
            label: copy.common.sessions,
            value: String(sessions.length),
          },
          {
            label: copy.common.range,
            value: usageRange,
          },
          {
            label: copy.common.selected,
            value: String(this.usageState.usageSelectedSessions.length),
            hint: selectedUsageSession
              ? sessionDisplayName(selectedUsageSession)
              : (this.usageState.usageSelectedSessions[0] ?? undefined),
          },
        ])}
        <div class="cp-stage cp-stage--two">
          <aside class="cp-stage__rail cp-stage__rail--wide">
            <article class="cp-panel cp-panel--fill">
              <div class="cp-panel__head">
                <div>
                  <span class="cp-kicker">${copy.usage.queryKicker}</span>
                  <h3>${copy.usage.queryTitle}</h3>
                </div>
              </div>
              <form
                class="cp-form"
                @submit=${(event: Event) => {
                  event.preventDefault();
                  void this.safeCall(async () => {
                    await loadUsage(this.usageState);
                  });
                }}
              >
                <label>
                  <span>${copy.usage.startDate}</span>
                  <input
                    type="date"
                    .value=${this.usageState.usageStartDate}
                    @input=${(event: Event) => {
                      this.usageState.usageStartDate = (event.target as HTMLInputElement).value;
                      this.requestUpdate();
                    }}
                  />
                </label>
                <label>
                  <span>${copy.usage.endDate}</span>
                  <input
                    type="date"
                    .value=${this.usageState.usageEndDate}
                    @input=${(event: Event) => {
                      this.usageState.usageEndDate = (event.target as HTMLInputElement).value;
                      this.requestUpdate();
                    }}
                  />
                </label>
                <div class="cp-form__actions">
                  <button class="cp-button cp-button--primary" type="submit">
                    ${copy.usage.refreshUsage}
                  </button>
                </div>
              </form>
            </article>
            <article class="cp-panel">
              <div class="cp-panel__head">
                <div>
                  <span class="cp-kicker">${copy.common.summary}</span>
                  <h3>${copy.usage.rangeSummaryTitle}</h3>
                </div>
              </div>
              ${this.renderMetaEntries([
                { label: copy.common.range, value: usageRange },
                { label: copy.common.sessions, value: sessions.length },
                {
                  label: copy.common.selected,
                  value: this.usageState.usageSelectedSessions.length,
                  hint: selectedUsageSession
                    ? sessionDisplayName(selectedUsageSession)
                    : (this.usageState.usageSelectedSessions[0] ?? undefined),
                },
                { label: copy.common.logs, value: this.usageState.usageSessionLogs?.length ?? 0 },
              ])}
            </article>
          </aside>
          <main class="cp-stage__main">
            <section class="cp-grid cp-grid--double">
              <article class="cp-subpanel">
                <h4>${copy.usage.totalsTitle}</h4>
                ${this.renderUsageTotalsPanel()}
              </article>
              <article class="cp-subpanel">
                <h4>${copy.usage.timeSeries}</h4>
                ${this.renderUsageTimeSeriesPanel()}
              </article>
            </section>
            <article class="cp-panel">
              <div class="cp-panel__head">
                <div>
                  <span class="cp-kicker">${copy.usage.sessionCostKicker}</span>
                  <h3>${copy.usage.sessionCostTitle}</h3>
                </div>
              </div>
              <div class="cp-table-wrap">
                <table class="cp-table">
                  <thead>
                    <tr>
                      <th>${copy.common.session}</th>
                      <th>${copy.common.provider}</th>
                      <th>${copy.common.model}</th>
                      <th>${copy.common.updated}</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${sessions.length
                      ? repeat(
                          sessions,
                          (session) => session.key,
                          (session) => html`
                            <tr @click=${() => void this.handleSelectUsageSession(session.key)}>
                              <td>
                                <strong>${sessionDisplayName(session)}</strong>
                                <small>${sessionSurfaceLabel(session)}</small>
                              </td>
                              <td>${session.modelProvider ?? copy.common.na}</td>
                              <td>${session.model ?? copy.common.na}</td>
                              <td>${formatDateTime(session.updatedAt, this.locale)}</td>
                            </tr>
                          `,
                        )
                      : html`
                          <tr>
                            <td colspan="4"><p class="cp-empty">${copy.usage.noSessions}</p></td>
                          </tr>
                        `}
                  </tbody>
                </table>
              </div>
            </article>
            <article class="cp-subpanel">
              <h4>${copy.usage.usageLogs}</h4>
              ${this.renderUsageLogsPanel()}
            </article>
          </main>
        </div>
      </section>
    `;
  }

  private renderConfig() {
    const copy = uiText(this.locale);
    const snapshot = this.configState.configSnapshot;
    return html`
      <section class="cp-page">
        ${this.renderPageHeader("config", [
          {
            label: copy.common.schema,
            value: this.configState.configSchemaVersion ?? copy.common.na,
          },
          {
            label: copy.common.hash,
            value: snapshot?.hash ?? copy.common.na,
            hint: snapshot?.path ?? undefined,
          },
          {
            label: copy.config.manifestTitle,
            value: this.configState.configFormDirty ? copy.common.yes : copy.common.no,
          },
          {
            label: copy.config.approvalsTitle,
            value: this.execApprovalsState.execApprovalsDirty ? copy.common.yes : copy.common.no,
            hint: this.execApprovalsState.execApprovalsSnapshot?.path ?? undefined,
          },
        ])}
        <div class="cp-stage cp-stage--two">
          <aside class="cp-stage__rail cp-stage__rail--wide">
            <article class="cp-panel">
              <div class="cp-panel__head">
                <div>
                  <span class="cp-kicker">${copy.config.manifestKicker}</span>
                  <h3>${copy.config.manifestTitle}</h3>
                </div>
              </div>
              <div class="cp-meta-list">
                <div>
                  <span>${copy.common.path}</span
                  ><strong>${snapshot?.path ?? copy.common.na}</strong>
                </div>
                <div>
                  <span>${copy.common.hash}</span
                  ><strong>${snapshot?.hash ?? copy.common.na}</strong>
                </div>
                <div>
                  <span>${copy.common.valid}</span
                  ><strong>${snapshot?.valid === false ? copy.common.no : copy.common.yes}</strong>
                </div>
                <div>
                  <span>${copy.config.applySession}</span
                  ><strong>${this.configState.applySessionKey}</strong>
                </div>
              </div>
            </article>
            <article class="cp-panel">
              <div class="cp-panel__head">
                <div>
                  <span class="cp-kicker">${copy.config.approvalsKicker}</span>
                  <h3>${copy.config.approvalsTitle}</h3>
                </div>
              </div>
              <div class="cp-meta-list">
                <div>
                  <span>${copy.common.file}</span>
                  <strong
                    >${this.execApprovalsState.execApprovalsSnapshot?.path ??
                    copy.common.notLoaded}</strong
                  >
                </div>
                <div>
                  <span>${copy.common.dirty}</span>
                  <strong
                    >${this.execApprovalsState.execApprovalsDirty
                      ? copy.common.yes
                      : copy.common.no}</strong
                  >
                </div>
              </div>
            </article>
            <article class="cp-panel">
              <div class="cp-panel__head">
                <div>
                  <span class="cp-kicker">${copy.common.summary}</span>
                  <h3>${copy.config.saveAndApplyTitle}</h3>
                </div>
              </div>
              <p class="cp-panel__subcopy">${copy.config.saveAndApplyHint}</p>
              <p class="cp-panel__subcopy">${copy.config.approvalHint}</p>
            </article>
          </aside>
          <main class="cp-stage__main">
            <section class="cp-grid cp-grid--double">
              <article class="cp-subpanel">
                <h4>${copy.config.manifestTitle}</h4>
                ${this.renderMetaEntries([
                  { label: copy.common.path, value: snapshot?.path ?? copy.common.na },
                  { label: copy.common.hash, value: snapshot?.hash ?? copy.common.na },
                  {
                    label: copy.common.valid,
                    value: snapshot?.valid === false ? copy.common.no : copy.common.yes,
                  },
                  {
                    label: copy.common.dirty,
                    value: this.configState.configFormDirty ? copy.common.yes : copy.common.no,
                  },
                ])}
              </article>
              <article class="cp-subpanel">
                <h4>${copy.config.approvalsTitle}</h4>
                ${this.renderMetaEntries([
                  {
                    label: copy.common.file,
                    value:
                      this.execApprovalsState.execApprovalsSnapshot?.path ?? copy.common.notLoaded,
                  },
                  {
                    label: copy.common.dirty,
                    value: this.execApprovalsState.execApprovalsDirty
                      ? copy.common.yes
                      : copy.common.no,
                  },
                  {
                    label: copy.common.exists,
                    value: this.execApprovalsState.execApprovalsSnapshot?.exists
                      ? copy.common.yes
                      : copy.common.no,
                  },
                ])}
              </article>
            </section>
            <section class="cp-grid cp-grid--double">
              <article class="cp-panel cp-panel--fill">
                <div class="cp-panel__head">
                  <div>
                    <span class="cp-kicker">${copy.config.manifestWorkbenchKicker}</span>
                    <h3>${copy.config.manifestWorkbenchTitle}</h3>
                  </div>
                  <div class="cp-inline-actions">
                    <button class="cp-button" @click=${() => void this.handleSaveConfig()}>
                      ${copy.common.save}
                    </button>
                    <button
                      class="cp-button cp-button--primary"
                      @click=${() => void this.handleApplyConfig()}
                    >
                      ${copy.common.apply}
                    </button>
                  </div>
                </div>
                <textarea
                  class="cp-code-editor"
                  .value=${this.configState.configRaw}
                  @input=${(event: Event) => {
                    this.configState.configRaw = (event.target as HTMLTextAreaElement).value;
                    this.configState.configFormDirty = true;
                    this.requestUpdate();
                  }}
                ></textarea>
              </article>
              <article class="cp-panel cp-panel--fill">
                <div class="cp-panel__head">
                  <div>
                    <span class="cp-kicker">${copy.config.approvalWorkbenchKicker}</span>
                    <h3>${copy.config.approvalWorkbenchTitle}</h3>
                  </div>
                  <button
                    class="cp-button cp-button--primary"
                    @click=${() => void this.handleSaveApprovals()}
                  >
                    ${copy.config.saveApprovals}
                  </button>
                </div>
                <p class="cp-panel__subcopy">${copy.config.approvalHint}</p>
                <textarea
                  class="cp-code-editor"
                  .value=${this.approvalsRaw}
                  @input=${(event: Event) => {
                    this.approvalsRaw = (event.target as HTMLTextAreaElement).value;
                  }}
                ></textarea>
              </article>
            </section>
            <section class="cp-grid cp-grid--double">
              <article class="cp-subpanel">
                <h4>${copy.config.configIssues}</h4>
                ${this.renderConfigIssuesPanel()}
              </article>
              <article class="cp-subpanel">
                <h4>${copy.config.approvalSnapshot}</h4>
                ${this.renderApprovalsSnapshotPanel()}
              </article>
            </section>
          </main>
        </div>
      </section>
    `;
  }

  private renderDebug() {
    const copy = uiText(this.locale);
    const methodList = this.hello?.features?.methods ?? [];
    const debugHeartbeat = this.resolveHeartbeatMeta(this.debugState.debugHeartbeat);
    return html`
      <section class="cp-page">
        ${this.renderPageHeader("debug", [
          {
            label: copy.common.methods,
            value: String(methodList.length),
          },
          {
            label: copy.common.models,
            value: String(this.debugState.debugModels.length),
          },
          {
            label: copy.common.selected,
            value: this.debugState.debugCallMethod || copy.common.none,
          },
          {
            label: copy.common.recentCheck,
            value: debugHeartbeat.status,
            hint: debugHeartbeat.ts
              ? formatDateTime(debugHeartbeat.ts, this.locale)
              : copy.common.notRecorded,
          },
        ])}
        <div class="cp-stage cp-stage--two">
          <aside class="cp-stage__rail cp-stage__rail--wide">
            <article class="cp-panel cp-panel--fill">
              <div class="cp-panel__head">
                <div>
                  <span class="cp-kicker">${copy.debug.methodSurfaceKicker}</span>
                  <h3>${copy.debug.methodSurfaceTitle}</h3>
                </div>
              </div>
              <div class="cp-list cp-list--dense">
                ${repeat(
                  methodList,
                  (method) => method,
                  (method) => html`
                    <button
                      class="cp-session-item"
                      @click=${() => {
                        this.debugState.debugCallMethod = method;
                        this.requestUpdate();
                      }}
                    >
                      <strong>${method}</strong>
                      <small>
                        ${method.startsWith("system.")
                          ? copy.debug.preferredName
                          : copy.debug.surface}
                      </small>
                    </button>
                  `,
                )}
              </div>
            </article>
            <article class="cp-panel">
              <div class="cp-panel__head">
                <div>
                  <span class="cp-kicker">${copy.common.summary}</span>
                  <h3>${copy.debug.diagnosticsTitle}</h3>
                </div>
              </div>
              <p class="cp-panel__subcopy">${copy.debug.diagnosticsHint}</p>
              ${this.renderMetaEntries([
                { label: copy.common.methods, value: methodList.length },
                { label: copy.common.models, value: this.debugState.debugModels.length },
                { label: copy.common.recentCheck, value: debugHeartbeat.status },
                {
                  label: copy.common.selected,
                  value: this.debugState.debugCallMethod || copy.common.none,
                },
              ])}
            </article>
          </aside>
          <main class="cp-stage__main">
            <section class="cp-grid cp-grid--double">
              <article class="cp-subpanel">
                <h4>${copy.debug.statusSnapshot}</h4>
                ${this.renderDebugSnapshotPanel(
                  this.debugState.debugStatus,
                  copy.debug.statusSnapshot,
                )}
              </article>
              <article class="cp-subpanel">
                <h4>${copy.debug.healthSnapshot}</h4>
                ${this.renderDebugSnapshotPanel(
                  this.debugState.debugHealth,
                  copy.debug.healthSnapshot,
                )}
              </article>
            </section>
            <article class="cp-panel">
              <div class="cp-panel__head">
                <div>
                  <span class="cp-kicker">${copy.debug.manualKicker}</span>
                  <h3>${copy.debug.manualTitle}</h3>
                </div>
                <button
                  class="cp-button cp-button--primary"
                  @click=${() =>
                    void this.safeCall(async () => {
                      await callDebugMethod(this.debugState);
                    })}
                >
                  ${copy.common.execute}
                </button>
              </div>
              <div class="cp-form cp-form--rpc">
                <label>
                  <span>${copy.debug.method}</span>
                  <input
                    .value=${this.debugState.debugCallMethod}
                    @input=${(event: Event) => {
                      this.debugState.debugCallMethod = (event.target as HTMLInputElement).value;
                      this.requestUpdate();
                    }}
                  />
                </label>
                <label>
                  <span>${copy.debug.params}</span>
                  <textarea
                    class="cp-code-editor cp-code-editor--compact"
                    .value=${this.debugState.debugCallParams}
                    @input=${(event: Event) => {
                      this.debugState.debugCallParams = (event.target as HTMLTextAreaElement).value;
                    }}
                  ></textarea>
                </label>
              </div>
              <pre class="cp-code">
${this.debugState.debugCallError ?? this.debugState.debugCallResult ?? copy.debug.noRequest}</pre
              >
            </article>
          </main>
        </div>
      </section>
    `;
  }

  private renderActivePage() {
    switch (this.tab) {
      case "overview":
        return this.renderOverview();
      case "sessions":
        return this.renderSessions();
      case "channels":
        return this.renderChannels();
      case "workflows":
        return this.renderWorkflows();
      case "agents":
        return this.renderAgents();
      case "memory":
        return this.renderMemory();
      case "runtime":
        return this.renderAgentRuntime();
      case "usage":
        return this.renderUsage();
      case "config":
        return this.renderConfig();
      case "debug":
        return this.renderDebug();
      default:
        return this.renderOverview();
    }
  }

  render() {
    const activeMeta = metaForPage(this.tab, this.locale);
    const localizedPages = controlPagesForLocale(this.locale);
    return html`
      <div
        class="cp-shell ${this.onboarding ? "cp-shell--onboarding" : ""} ${this.sidebarCollapsed
          ? "is-nav-collapsed"
          : ""}"
      >
        <aside class="cp-nav ${this.sidebarCollapsed ? "is-collapsed" : ""}">
          <div class="cp-nav__brand">
            <span class="cp-nav__logo">CC</span>
            <div class="cp-nav__copy">
              <strong>CrawClaw</strong>
              <small>${shellText(this.locale, "controlPlane")}</small>
            </div>
          </div>
          <nav class="cp-nav__stack">
            ${repeat(
              localizedPages,
              (page) => page.id,
              (page) => html`
                <a
                  href=${pathForPage(page.id, this.basePath)}
                  class="cp-nav__item nav-item ${this.tab === page.id ? "is-active" : ""}"
                  @click=${(event: MouseEvent) => {
                    event.preventDefault();
                    this.navigate(page.id);
                  }}
                >
                  <span>${page.label}</span>
                  <small>${page.eyebrow}</small>
                </a>
              `,
            )}
          </nav>
          <div class="cp-nav__footer">
            ${this.renderConnectionBadge()}
            <button
              class="cp-button"
              @click=${() => {
                this.sidebarCollapsed = !this.sidebarCollapsed;
              }}
            >
              ${this.sidebarCollapsed
                ? shellText(this.locale, "expandRail")
                : shellText(this.locale, "collapseRail")}
            </button>
          </div>
        </aside>

        <div class="cp-main">
          <header class="cp-topbar">
            <div class="cp-topbar__copy">
              <span class="cp-topbar__eyebrow">${activeMeta.eyebrow}</span>
              <strong>${activeMeta.label}</strong>
              <small>
                ${readString(this.hello?.server?.version, shellText(this.locale, "gatewayPending"))}
              </small>
            </div>
            <div class="cp-topbar__actions">
              <label class="cp-topbar__locale">
                <span>${shellText(this.locale, "language")}</span>
                <select
                  class="cp-select"
                  .value=${this.locale}
                  @change=${(event: Event) => this.handleLocaleChange(event)}
                >
                  ${SHELL_LOCALES.map(
                    (locale) => html` <option value=${locale}>${localeLabel(locale)}</option> `,
                  )}
                </select>
              </label>
              ${this.renderConnectionBadge()}
              <button class="cp-button" @click=${() => void this.refreshSystemOverview()}>
                ${t("common.refresh")}
              </button>
              <button class="cp-button" @click=${() => void this.connectGateway()}>
                ${shellText(this.locale, "reconnect")}
              </button>
            </div>
          </header>

          <main class="cp-content">
            ${this.lastError
              ? html`
                  <section class="cp-banner cp-banner--danger">
                    <strong>${shellText(this.locale, "gatewayNotice")}</strong>
                    <span>${this.lastError}</span>
                  </section>
                `
              : nothing}
            ${this.renderActivePage()}
          </main>
        </div>
      </div>
    `;
  }
}
