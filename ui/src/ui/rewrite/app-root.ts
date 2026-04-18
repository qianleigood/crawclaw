import { LitElement, html, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";
import { repeat } from "lit/directives/repeat.js";
import { i18n, t, isSupportedLocale, type Locale } from "../../i18n/index.ts";
import { extractText } from "../chat/message-extract.ts";
import {
  loadAgents,
  loadAgentInspection,
  loadToolsCatalog,
  loadToolsEffective,
  type AgentsState,
} from "../controllers/agents.ts";
import {
  loadChannels,
  logoutWhatsApp,
  startWhatsAppLogin,
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
import { loadSettings, saveSettings, type UiSettings } from "../storage.ts";
import type {
  ChannelAccountSnapshot,
  ChannelsStatusSnapshot,
  CostUsageSummary,
  GatewaySessionRow,
  PresenceEntry,
  StatusSummary,
} from "../types.ts";
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
    gatewayPending: "gateway pending",
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
    gatewayPending: "网关待握手",
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
      none: "none",
      pending: "pending",
      na: "n/a",
      auto: "auto",
      default: "default",
      idle: "idle",
      available: "available",
      hidden: "hidden",
      supported: "supported",
      notExposed: "not exposed",
      notLoaded: "not loaded",
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
      account: "Account",
      surface: "Surface",
      session: "Session",
      key: "Key",
      kind: "Kind",
      tokens: "Tokens",
      workspace: "Workspace",
      cost: "Cost",
      schema: "Schema",
      methods: "Methods",
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
      surfacesHint: "{count} surfaces",
      runtimeKicker: "Runtime",
      runtimeTitle: "System heartbeat",
      statusSummary: "Status summary",
      heartbeat: "Heartbeat",
      lastClose: "Last close",
      error: "Error",
      controlKicker: "Control surface",
      controlTitle: "High-value tasks",
      openSessions: "Open sessions & chat",
      trackedSessions: "{count} tracked sessions",
      reviewConfig: "Review config & approvals",
      manifestWorkbench: "manifest workbench",
      inspectWorkflows: "Inspect workflow deployments",
      workflowCount: "{count} workflow definitions",
      recentKicker: "Recent operator surface",
      recentTitle: "Hot sessions",
      presenceKicker: "Presence rail",
      presenceTitle: "Connected clients",
      noPresence: "No live presence entries were returned.",
      controlUi: "control-ui",
      operator: "operator",
    },
    sessions: {
      focusedSession: "Focused session",
      registryKicker: "Registry rail",
      registryTitle: "Session inventory",
      noSessions: "No sessions returned by the gateway.",
      conversationKicker: "Conversation thread",
      conversationTitle: "Sessions & chat console",
      refreshHistory: "Refresh history",
      abortRun: "Abort run",
      streaming: "streaming",
      sendPlaceholder: "Send a session-scoped operator message...",
      inspectorKicker: "Inspector",
      inspectorTitle: "Current session context",
      selectPrompt: "Select a session to inspect.",
    },
    channels: {
      accounts: "Accounts",
      enabledSurfaces: "Enabled surfaces",
      feishuCli: "Feishu CLI",
      whatsappLogin: "WhatsApp login",
      accountsKicker: "Accounts & probes",
      inventoryTitle: "Channel inventory",
      probeAgain: "Probe again",
      running: "Running",
      lastError: "Last error",
      optionalKicker: "Optional flow",
      optionalTitle: "WhatsApp login",
      noActiveLogin: "No active login flow.",
    },
    workflows: {
      registry: "Registry",
      registryKicker: "Registry rail",
      registryTitle: "Workflow definitions",
      autoRun: "auto-run",
      manual: "manual",
      runs: "runs",
      detailKicker: "Deployment detail",
      selectTitle: "Select a workflow",
      disable: "Disable",
      enable: "Enable",
      registryDetail: "Registry detail",
      approval: "Approval",
      required: "required",
      notRequired: "not required",
      archived: "Archived",
      currentExecution: "Current execution",
      noExecution: "No execution selected.",
      specification: "Specification",
      choosePrompt: "Choose a workflow from the rail.",
    },
    agents: {
      registered: "Registered",
      registryKicker: "Registry rail",
      registryTitle: "Agent inventory",
      introspectionKicker: "Introspection",
      detailTitle: "Agent detail",
      identity: "Identity",
      primaryModel: "Primary model",
      inspectionSnapshot: "Inspection snapshot",
      toolsCatalog: "Tools catalog",
      effectiveTools: "Effective tools",
      selectPrompt: "Select an agent to inspect tools and runtime metadata.",
    },
    usage: {
      queryKicker: "Query rail",
      queryTitle: "Usage window",
      startDate: "Start date",
      endDate: "End date",
      refreshUsage: "Refresh usage",
      sessionCostKicker: "Session cost map",
      sessionCostTitle: "Usage sessions",
      timeSeries: "Time series",
      usageLogs: "Usage logs",
    },
    config: {
      manifestKicker: "Manifest rail",
      manifestTitle: "Config runtime parity",
      applySession: "Apply session",
      approvalsKicker: "Approvals rail",
      approvalsTitle: "Execution policy",
      manifestWorkbenchKicker: "Manifest workbench",
      manifestWorkbenchTitle: "Config raw editor",
      approvalWorkbenchKicker: "Approval workbench",
      approvalWorkbenchTitle: "Exec approvals raw editor",
      saveApprovals: "Save approvals",
      configIssues: "Config issues",
      approvalSnapshot: "Approval snapshot",
    },
    debug: {
      methodSurfaceKicker: "Method surface",
      methodSurfaceTitle: "Advertised methods",
      preferredName: "preferred name",
      surface: "surface",
      statusSnapshot: "Status snapshot",
      healthSnapshot: "Health snapshot",
      manualKicker: "Manual RPC",
      manualTitle: "Raw request workbench",
      method: "Method",
      params: "Params",
      noRequest: "No request executed yet.",
    },
  },
  "zh-CN": {
    common: {
      yes: "是",
      no: "否",
      live: "在线",
      none: "无",
      pending: "等待中",
      na: "无",
      auto: "自动",
      default: "默认",
      idle: "空闲",
      available: "可用",
      hidden: "隐藏",
      supported: "支持",
      notExposed: "未暴露",
      notLoaded: "未加载",
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
      account: "账号",
      surface: "表面",
      session: "会话",
      key: "键",
      kind: "类型",
      tokens: "Tokens",
      workspace: "工作区",
      cost: "成本",
      schema: "Schema",
      methods: "方法数",
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
      surfacesHint: "{count} 个表面",
      runtimeKicker: "运行态",
      runtimeTitle: "系统心跳",
      statusSummary: "状态摘要",
      heartbeat: "心跳",
      lastClose: "上次关闭",
      error: "错误",
      controlKicker: "控制面",
      controlTitle: "高价值操作",
      openSessions: "打开会话与聊天",
      trackedSessions: "{count} 个跟踪会话",
      reviewConfig: "查看配置与审批",
      manifestWorkbench: "配置工作台",
      inspectWorkflows: "检查工作流部署",
      workflowCount: "{count} 个工作流定义",
      recentKicker: "近期操作面",
      recentTitle: "热点会话",
      presenceKicker: "在线侧栏",
      presenceTitle: "已连接客户端",
      noPresence: "当前没有返回在线客户端条目。",
      controlUi: "控制台",
      operator: "操作员",
    },
    sessions: {
      focusedSession: "当前会话",
      registryKicker: "注册表侧栏",
      registryTitle: "会话清单",
      noSessions: "网关没有返回会话。",
      conversationKicker: "对话线程",
      conversationTitle: "会话与聊天控制台",
      refreshHistory: "刷新历史",
      abortRun: "中止运行",
      streaming: "流式输出中",
      sendPlaceholder: "发送一条绑定到当前会话的操作消息…",
      inspectorKicker: "检查面板",
      inspectorTitle: "当前会话上下文",
      selectPrompt: "选择一个会话后查看详情。",
    },
    channels: {
      accounts: "账号数",
      enabledSurfaces: "已启用表面",
      feishuCli: "飞书 CLI",
      whatsappLogin: "WhatsApp 登录",
      accountsKicker: "账号与探测",
      inventoryTitle: "渠道清单",
      probeAgain: "再次探测",
      running: "运行中",
      lastError: "最近错误",
      optionalKicker: "可选流程",
      optionalTitle: "WhatsApp 登录",
      noActiveLogin: "当前没有激活的登录流程。",
    },
    workflows: {
      registry: "注册表",
      registryKicker: "注册表侧栏",
      registryTitle: "工作流定义",
      autoRun: "自动运行",
      manual: "手动",
      runs: "次运行",
      detailKicker: "部署详情",
      selectTitle: "选择一个工作流",
      disable: "禁用",
      enable: "启用",
      registryDetail: "注册详情",
      approval: "审批",
      required: "需要",
      notRequired: "不需要",
      archived: "已归档",
      currentExecution: "当前执行",
      noExecution: "当前没有选中的执行记录。",
      specification: "规格定义",
      choosePrompt: "从左侧选择一个工作流。",
    },
    agents: {
      registered: "已注册",
      registryKicker: "注册表侧栏",
      registryTitle: "代理清单",
      introspectionKicker: "运行检查",
      detailTitle: "代理详情",
      identity: "身份信息",
      primaryModel: "主模型",
      inspectionSnapshot: "检查快照",
      toolsCatalog: "工具目录",
      effectiveTools: "实际生效工具",
      selectPrompt: "选择一个代理以检查工具和运行元数据。",
    },
    usage: {
      queryKicker: "查询侧栏",
      queryTitle: "用量窗口",
      startDate: "开始日期",
      endDate: "结束日期",
      refreshUsage: "刷新用量",
      sessionCostKicker: "会话成本图",
      sessionCostTitle: "会话用量",
      timeSeries: "时间序列",
      usageLogs: "用量日志",
    },
    config: {
      manifestKicker: "配置侧栏",
      manifestTitle: "配置运行一致性",
      applySession: "应用会话",
      approvalsKicker: "审批侧栏",
      approvalsTitle: "执行策略",
      manifestWorkbenchKicker: "配置工作台",
      manifestWorkbenchTitle: "配置原始编辑器",
      approvalWorkbenchKicker: "审批工作台",
      approvalWorkbenchTitle: "执行审批原始编辑器",
      saveApprovals: "保存审批",
      configIssues: "配置问题",
      approvalSnapshot: "审批快照",
    },
    debug: {
      methodSurfaceKicker: "方法面",
      methodSurfaceTitle: "已发布方法",
      preferredName: "首选名称",
      surface: "接口面",
      statusSnapshot: "状态快照",
      healthSnapshot: "健康快照",
      manualKicker: "手动 RPC",
      manualTitle: "原始请求工作台",
      method: "方法",
      params: "参数",
      noRequest: "尚未执行任何请求。",
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
    return "n/a";
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

function readString(value: unknown, fallback = "n/a"): string {
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

function sessionDisplayName(session: GatewaySessionRow): string {
  return (
    session.displayName ||
    session.label ||
    session.subject ||
    session.room ||
    session.space ||
    session.key
  );
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
  @state() systemStatus: StatusSummary | null = null;
  @state() systemPresence: PresenceEntry[] = [];
  @state() systemHeartbeat: unknown = null;
  @state() systemStatusLoading = false;
  @state() systemStatusError: string | null = null;
  @state() approvalsRaw = "{}";
  @state() approvalsError: string | null = null;

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
  }

  firstUpdated() {
    void this.connectGateway();
  }

  disconnectedCallback() {
    window.removeEventListener("popstate", this.handlePopState);
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
      await loadAgents(this.agentsState);
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
    await this.safeCall(async () => {
      await loadChatHistory(this.chatState);
    });
  }

  private async handleSendMessage(event: Event) {
    event.preventDefault();
    if (!this.chatState.chatMessage.trim()) {
      return;
    }
    await this.safeCall(async () => {
      await sendChatMessage(this.chatState, this.chatState.chatMessage);
      this.chatState.chatMessage = "";
    });
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

  private renderPageHeader(page: ControlPage, extra?: unknown) {
    const meta = metaForPage(page, this.locale);
    return html`
      <header class="cp-page-head">
        <div class="cp-page-head__copy">
          <span class="cp-page-head__eyebrow">${meta.eyebrow}</span>
          <h1>${meta.label}</h1>
          <p>${meta.headline}</p>
          <small>${meta.subheadline}</small>
        </div>
        <div class="cp-page-head__stats">
          ${this.renderMetric(
            shellText(this.locale, "gateway"),
            readString(this.hello?.server?.version, uiText(this.locale).common.pending),
          )}
          ${this.renderMetric(
            shellText(this.locale, "methods"),
            String(this.hello?.features?.methods?.length ?? 0),
          )}
          ${this.renderMetric(shellText(this.locale, "session"), this.settings.sessionKey)}
          ${extra ?? nothing}
        </div>
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
    const approvalsPath =
      this.execApprovalsState.execApprovalsSnapshot?.path ?? copy.common.notLoaded;
    return html`
      <section class="cp-page cp-page--overview">
        ${this.renderPageHeader(
          "overview",
          this.renderMetric(copy.overview.approvals, approvalsPath),
        )}
        <div class="cp-stage cp-stage--overview">
          <div class="cp-stage__main">
            <section class="cp-band">
              ${this.renderMetric(
                copy.overview.healthy,
                this.healthState.healthResult?.ok ? copy.common.yes : copy.common.no,
                copy.overview.agentsHint.replace(
                  "{count}",
                  String(this.healthState.healthResult?.agents.length ?? 0),
                ),
              )}
              ${this.renderMetric(
                copy.overview.recentSessions,
                String(this.healthState.healthResult?.sessions.count ?? 0),
                this.healthState.healthResult?.sessions.path ?? copy.overview.sessionStore,
              )}
              ${this.renderMetric(
                copy.overview.channelAccounts,
                String(channels.length),
                copy.overview.surfacesHint.replace(
                  "{count}",
                  String(this.channelsState.channelsSnapshot?.channelOrder.length ?? 0),
                ),
              )}
              ${this.renderMetric(
                copy.overview.presenceClients,
                String(this.systemPresence.length),
                this.connected ? copy.common.live : t("common.offline"),
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
                    <span>${copy.overview.statusSummary}</span
                    ><strong
                      >${readString(
                        this.systemStatus && JSON.stringify(this.systemStatus).slice(0, 80),
                        copy.common.pending,
                      )}</strong
                    >
                  </div>
                  <div>
                    <span>${copy.overview.heartbeat}</span
                    ><strong>${formatJson(this.systemHeartbeat)}</strong>
                  </div>
                  <div>
                    <span>${copy.overview.lastClose}</span
                    ><strong>${this.reconnectReason ?? copy.common.none}</strong>
                  </div>
                  <div>
                    <span>${copy.overview.error}</span
                    ><strong>${this.lastError ?? copy.common.none}</strong>
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
                    ${repeat(
                      sessions.slice(0, 10),
                      (session) => session.key,
                      (session) => html`
                        <tr @click=${() => void this.handleSelectSession(session.key)}>
                          <td>
                            <strong>${sessionDisplayName(session)}</strong>
                            <small>${session.key}</small>
                          </td>
                          <td>${session.kind}</td>
                          <td>${session.status ?? copy.common.idle}</td>
                          <td>${formatAgo(session.updatedAt, this.locale)}</td>
                        </tr>
                      `,
                    )}
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
    return html`
      <section class="cp-page cp-page--sessions">
        ${this.renderPageHeader(
          "sessions",
          this.renderMetric(copy.sessions.focusedSession, this.settings.sessionKey),
        )}
        <div class="cp-stage cp-stage--three">
          <aside class="cp-stage__rail cp-stage__rail--wide">
            <article class="cp-panel cp-panel--fill">
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
              <div class="cp-list cp-list--dense">
                ${sessions.length
                  ? repeat(
                      sessions,
                      (session) => session.key,
                      (session) => html`
                        <button
                          class="cp-session-item ${session.key === this.settings.sessionKey
                            ? "is-active"
                            : ""}"
                          @click=${() => void this.handleSelectSession(session.key)}
                        >
                          <strong>${sessionDisplayName(session)}</strong>
                          <span>${session.key}</span>
                          <small
                            >${session.status ?? copy.common.idle} ·
                            ${formatAgo(session.updatedAt, this.locale)}</small
                          >
                        </button>
                      `,
                    )
                  : html`<p class="cp-empty">${copy.sessions.noSessions}</p>`}
              </div>
            </article>
          </aside>

          <main class="cp-stage__main">
            <article class="cp-panel cp-panel--fill">
              <div class="cp-panel__head">
                <div>
                  <span class="cp-kicker">${copy.sessions.conversationKicker}</span>
                  <h3>${copy.sessions.conversationTitle}</h3>
                </div>
                <div class="cp-inline-actions">
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
              <div class="cp-chat-thread">
                ${repeat(
                  this.chatState.chatMessages,
                  (_, index) => index,
                  (message) => html`
                    <article
                      class="cp-chat-bubble cp-chat-bubble--${readString(
                        (message as JsonRecord).role,
                        "assistant",
                      )}"
                    >
                      <header>
                        <strong>${readString((message as JsonRecord).role, "assistant")}</strong>
                        <small
                          >${formatDateTime(
                            (message as JsonRecord).timestamp as number | null,
                            this.locale,
                          )}</small
                        >
                      </header>
                      <p>${renderMessageText(message)}</p>
                    </article>
                  `,
                )}
                ${this.chatState.chatStream
                  ? html`
                      <article class="cp-chat-bubble cp-chat-bubble--stream">
                        <header>
                          <strong>assistant</strong>
                          <small>${copy.sessions.streaming}</small>
                        </header>
                        <p>${this.chatState.chatStream}</p>
                      </article>
                    `
                  : nothing}
              </div>
              <form
                class="cp-chat-composer"
                @submit=${(event: Event) => this.handleSendMessage(event)}
              >
                <textarea
                  .value=${this.chatState.chatMessage}
                  placeholder=${copy.sessions.sendPlaceholder}
                  @input=${(event: Event) => {
                    this.chatState.chatMessage = (event.target as HTMLTextAreaElement).value;
                    this.requestUpdate();
                  }}
                ></textarea>
                <div class="cp-form__actions">
                  <button class="cp-button cp-button--primary" type="submit">
                    ${copy.common.send}
                  </button>
                </div>
              </form>
            </article>
          </main>

          <aside class="cp-stage__rail">
            <article class="cp-panel cp-panel--fill">
              <div class="cp-panel__head">
                <div>
                  <span class="cp-kicker">${copy.sessions.inspectorKicker}</span>
                  <h3>${copy.sessions.inspectorTitle}</h3>
                </div>
              </div>
              ${selected
                ? html`
                    <div class="cp-meta-list">
                      <div><span>${copy.common.key}</span><strong>${selected.key}</strong></div>
                      <div><span>${copy.common.kind}</span><strong>${selected.kind}</strong></div>
                      <div>
                        <span>${copy.common.status}</span
                        ><strong>${selected.status ?? copy.common.idle}</strong>
                      </div>
                      <div>
                        <span>${copy.common.provider}</span
                        ><strong>${selected.modelProvider ?? copy.common.auto}</strong>
                      </div>
                      <div>
                        <span>${copy.common.model}</span
                        ><strong>${selected.model ?? copy.common.default}</strong>
                      </div>
                      <div>
                        <span>${copy.common.tokens}</span
                        ><strong>${selected.totalTokens ?? 0}</strong>
                      </div>
                    </div>
                  `
                : html`<p class="cp-empty">${copy.sessions.selectPrompt}</p>`}
            </article>
          </aside>
        </div>
      </section>
    `;
  }

  private renderChannels() {
    const copy = uiText(this.locale);
    const flattenedAccounts = flattenChannelAccounts(this.channelsState.channelsSnapshot);
    return html`
      <section class="cp-page">
        ${this.renderPageHeader(
          "channels",
          this.renderMetric(copy.channels.accounts, String(flattenedAccounts.length)),
        )}
        <div class="cp-stage cp-stage--overview">
          <div class="cp-stage__main">
            <section class="cp-band">
              ${this.renderMetric(
                copy.channels.enabledSurfaces,
                String(this.channelsState.channelsSnapshot?.channelOrder.length ?? 0),
              )}
              ${this.renderMetric(
                copy.channels.feishuCli,
                this.channelsState.feishuCliSupported ? copy.common.available : copy.common.hidden,
                this.channelsState.feishuCliStatus?.status ?? copy.common.na,
              )}
              ${this.renderMetric(
                copy.channels.whatsappLogin,
                this.client?.hasCapability("channels.login")
                  ? copy.common.supported
                  : copy.common.notExposed,
              )}
            </section>
            <article class="cp-panel">
              <div class="cp-panel__head">
                <div>
                  <span class="cp-kicker">${copy.channels.accountsKicker}</span>
                  <h3>${copy.channels.inventoryTitle}</h3>
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
              <div class="cp-table-wrap">
                <table class="cp-table">
                  <thead>
                    <tr>
                      <th>${copy.common.surface}</th>
                      <th>${copy.common.account}</th>
                      <th>${copy.channels.running}</th>
                      <th>${copy.common.connected}</th>
                      <th>${copy.channels.lastError}</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${repeat(
                      flattenedAccounts,
                      (entry) => `${entry.channelId}:${entry.account.accountId}`,
                      (entry) => html`
                        <tr>
                          <td><strong>${entry.label}</strong><small>${entry.channelId}</small></td>
                          <td>${entry.account.name ?? entry.account.accountId}</td>
                          <td>${entry.account.running ? copy.common.yes : copy.common.no}</td>
                          <td>${entry.account.connected ? copy.common.yes : copy.common.no}</td>
                          <td>${entry.account.lastError ?? copy.common.none}</td>
                        </tr>
                      `,
                    )}
                  </tbody>
                </table>
              </div>
            </article>
          </div>
          <aside class="cp-stage__rail">
            <article class="cp-panel">
              <div class="cp-panel__head">
                <div>
                  <span class="cp-kicker">${copy.channels.optionalKicker}</span>
                  <h3>${copy.channels.optionalTitle}</h3>
                </div>
              </div>
              <div class="cp-inline-actions cp-inline-actions--stack">
                <button
                  class="cp-button"
                  @click=${() =>
                    void this.safeCall(async () => {
                      await startWhatsAppLogin(this.channelsState, true);
                    })}
                >
                  ${copy.common.start}
                </button>
                <button
                  class="cp-button"
                  @click=${() =>
                    void this.safeCall(async () => {
                      await waitWhatsAppLogin(this.channelsState);
                    })}
                >
                  ${copy.common.wait}
                </button>
                <button
                  class="cp-button cp-button--danger"
                  @click=${() =>
                    void this.safeCall(async () => {
                      await logoutWhatsApp(this.channelsState);
                    })}
                >
                  ${copy.common.logout}
                </button>
              </div>
              <pre class="cp-code">
${this.channelsState.whatsappLoginMessage ?? copy.channels.noActiveLogin}</pre
              >
            </article>
          </aside>
        </div>
      </section>
    `;
  }

  private renderWorkflows() {
    const copy = uiText(this.locale);
    const selectedWorkflow = this.workflowsState.workflowDetail?.workflow;
    const selectedExecution = this.workflowsState.workflowSelectedExecution;
    return html`
      <section class="cp-page">
        ${this.renderPageHeader(
          "workflows",
          this.renderMetric(
            copy.workflows.registry,
            String(this.workflowsState.workflowsList.length),
          ),
        )}
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
                            <span>${copy.workflows.enable}</span
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
                        </div>
                      </article>
                      <article class="cp-subpanel">
                        <h4>${copy.workflows.currentExecution}</h4>
                        <pre class="cp-code">
${selectedExecution ? formatJson(selectedExecution) : copy.workflows.noExecution}</pre
                        >
                      </article>
                    </div>
                    <article class="cp-subpanel">
                      <h4>${copy.workflows.specification}</h4>
                      <pre class="cp-code">
${formatJson(this.workflowsState.workflowDetail?.spec)}</pre
                      >
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
    return html`
      <section class="cp-page">
        ${this.renderPageHeader(
          "agents",
          this.renderMetric(copy.agents.registered, String(agents.length)),
        )}
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
                        </div>
                      </article>
                      <article class="cp-subpanel">
                        <h4>${copy.agents.inspectionSnapshot}</h4>
                        <pre class="cp-code">
${formatJson(this.agentsState.agentInspectionSnapshot)}</pre
                        >
                      </article>
                    </div>
                    <article class="cp-subpanel">
                      <h4>${copy.agents.toolsCatalog}</h4>
                      <pre class="cp-code">${formatJson(this.agentsState.toolsCatalogResult)}</pre>
                    </article>
                    <article class="cp-subpanel">
                      <h4>${copy.agents.effectiveTools}</h4>
                      <pre class="cp-code">
${formatJson(this.agentsState.toolsEffectiveResult)}</pre
                      >
                    </article>
                  `
                : html`<p class="cp-empty">${copy.agents.selectPrompt}</p>`}
            </article>
          </main>
        </div>
      </section>
    `;
  }

  private renderUsage() {
    const copy = uiText(this.locale);
    const sessions = this.usageState.usageResult?.sessions ?? [];
    return html`
      <section class="cp-page">
        ${this.renderPageHeader(
          "usage",
          this.renderMetric(
            copy.common.cost,
            `$${readUsageCost(this.usageState.usageCostSummary).toFixed(2)}`,
          ),
        )}
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
              <pre class="cp-code">${formatJson(this.usageState.usageCostSummary?.totals)}</pre>
            </article>
          </aside>
          <main class="cp-stage__main">
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
                    ${repeat(
                      sessions,
                      (session) => session.key,
                      (session) => html`
                        <tr @click=${() => void this.handleSelectUsageSession(session.key)}>
                          <td>
                            <strong>${session.label ?? session.key}</strong>
                            <small>${session.key}</small>
                          </td>
                          <td>${session.modelProvider ?? copy.common.na}</td>
                          <td>${session.model ?? copy.common.na}</td>
                          <td>${formatDateTime(session.updatedAt, this.locale)}</td>
                        </tr>
                      `,
                    )}
                  </tbody>
                </table>
              </div>
            </article>
            <section class="cp-grid cp-grid--double">
              <article class="cp-subpanel">
                <h4>${copy.usage.timeSeries}</h4>
                <pre class="cp-code">${formatJson(this.usageState.usageTimeSeries)}</pre>
              </article>
              <article class="cp-subpanel">
                <h4>${copy.usage.usageLogs}</h4>
                <pre class="cp-code">${formatJson(this.usageState.usageSessionLogs)}</pre>
              </article>
            </section>
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
        ${this.renderPageHeader(
          "config",
          this.renderMetric(
            copy.common.schema,
            this.configState.configSchemaVersion ?? copy.common.na,
          ),
        )}
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
          </aside>
          <main class="cp-stage__main">
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
                <pre class="cp-code">${formatJson(this.configState.configIssues)}</pre>
              </article>
              <article class="cp-subpanel">
                <h4>${copy.config.approvalSnapshot}</h4>
                <pre class="cp-code">
${this.approvalsError ?? formatJson(this.execApprovalsState.execApprovalsSnapshot)}</pre
                >
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
    return html`
      <section class="cp-page">
        ${this.renderPageHeader(
          "debug",
          this.renderMetric(copy.common.methods, String(methodList.length)),
        )}
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
          </aside>
          <main class="cp-stage__main">
            <section class="cp-grid cp-grid--double">
              <article class="cp-subpanel">
                <h4>${copy.debug.statusSnapshot}</h4>
                <pre class="cp-code">${formatJson(this.debugState.debugStatus)}</pre>
              </article>
              <article class="cp-subpanel">
                <h4>${copy.debug.healthSnapshot}</h4>
                <pre class="cp-code">${formatJson(this.debugState.debugHealth)}</pre>
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
      <div class="cp-shell ${this.onboarding ? "cp-shell--onboarding" : ""}">
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
