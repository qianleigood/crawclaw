import { LitElement, html, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";
import { repeat } from "lit/directives/repeat.js";
import { i18n, t, isSupportedLocale, type Locale } from "../../i18n/index.ts";
import {
  CHAT_ATTACHMENT_ACCEPT,
  isSupportedChatAttachmentMimeType,
} from "../chat/attachment-support.ts";
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
import type { ChatAttachment } from "../ui-types.ts";
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
      sessions: "Sessions",
      accounts: "Accounts",
      messages: "Messages",
      selected: "Selected",
      execution: "Execution",
      range: "Range",
      heartbeat: "Heartbeat",
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
      searchPlaceholder: "Filter sessions by name, key or surface",
      noSessions: "No sessions returned by the gateway.",
      conversationKicker: "Conversation thread",
      conversationTitle: "Sessions & chat console",
      refreshHistory: "Refresh history",
      abortRun: "Abort run",
      streaming: "streaming",
      runtimeKicker: "Runtime",
      runtimeTitle: "Current execution telemetry",
      routingKicker: "Routing",
      routingTitle: "Session routing & model",
      activityKicker: "Latest activity",
      activityTitle: "Most recent message",
      composerKicker: "Operator compose",
      composerTitle: "Deliver a session-scoped message",
      sendPlaceholder: "Send a session-scoped operator message...",
      attachImage: "Attach image",
      dragHint: "Drag images here or use the picker",
      imageAttachments: "Image attachments",
      inspectorKicker: "Inspector",
      inspectorTitle: "Current session context",
      selectPrompt: "Select a session to inspect.",
      noMessages: "No messages loaded for the current session.",
      inventoryMatches: "{count} matching sessions",
      draftLength: "Draft length",
      blocks: "Blocks",
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
      sessions: "会话数",
      accounts: "账号数",
      messages: "消息数",
      selected: "已选",
      execution: "执行",
      range: "范围",
      heartbeat: "心跳",
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
      searchPlaceholder: "按名称、key 或 surface 过滤会话",
      noSessions: "网关没有返回会话。",
      conversationKicker: "对话线程",
      conversationTitle: "会话与聊天控制台",
      refreshHistory: "刷新历史",
      abortRun: "中止运行",
      streaming: "流式输出中",
      runtimeKicker: "运行态",
      runtimeTitle: "当前执行遥测",
      routingKicker: "路由",
      routingTitle: "会话路由与模型",
      activityKicker: "最近活动",
      activityTitle: "最新一条消息",
      composerKicker: "操作输入",
      composerTitle: "发送绑定到当前会话的操作消息",
      sendPlaceholder: "发送一条绑定到当前会话的操作消息…",
      attachImage: "添加图片",
      dragHint: "把图片拖到这里，或使用选择器",
      imageAttachments: "图片附件",
      inspectorKicker: "检查面板",
      inspectorTitle: "当前会话上下文",
      selectPrompt: "选择一个会话后查看详情。",
      noMessages: "当前会话还没有加载到消息。",
      inventoryMatches: "{count} 个匹配会话",
      draftLength: "草稿长度",
      blocks: "块数",
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
    return "n/a";
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
  return "n/a";
}

function formatMaybeDate(value: unknown, locale: Locale): string {
  return typeof value === "number" ? formatDateTime(value, locale) : uiText(locale).common.na;
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
    if (!this.chatState.chatMessage.trim() && this.chatState.chatAttachments.length === 0) {
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
    });
  }

  private async readChatAttachments(files: Iterable<File>) {
    const readers = Array.from(files).filter((file) =>
      isSupportedChatAttachmentMimeType(file.type),
    );
    if (!readers.length) {
      return;
    }
    const additions = await Promise.all(
      readers.map(
        (file) =>
          new Promise<ChatAttachment>((resolve, reject) => {
            const reader = new FileReader();
            reader.addEventListener("load", () => {
              resolve({
                id:
                  typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
                    ? crypto.randomUUID()
                    : `${Date.now()}-${Math.random().toString(36).slice(2)}`,
                dataUrl: reader.result as string,
                mimeType: file.type,
              });
            });
            reader.addEventListener("error", () => reject(reader.error));
            reader.readAsDataURL(file);
          }),
      ),
    );
    this.chatState.chatAttachments = [...this.chatState.chatAttachments, ...additions];
    this.requestUpdate();
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
        ? record.status.trim()
        : copy.common.pending;
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
        label: "ID",
        value: readString(record.executionId, readString(record.runId, copy.common.na)),
      },
      { label: copy.common.status, value: readString(record.status, copy.common.na) },
      { label: copy.common.state, value: readString(record.state, copy.common.na) },
      { label: copy.common.updated, value: formatMaybeDate(record.updatedAt, this.locale) },
      { label: copy.common.agent, value: readString(record.agentId, copy.common.na) },
      {
        label: copy.common.events,
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
      { label: copy.common.summary, value: readString(record.goal, copy.common.na) },
      { label: copy.common.state, value: readString(record.topology, copy.common.na) },
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
      { label: copy.common.execution, value: readString(record.runId, copy.common.na) },
      { label: "Task", value: readString(record.taskId, copy.common.na) },
      {
        label: copy.common.timeline,
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
      return html`<p class="cp-empty">${copy.common.notLoaded}</p>`;
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
    const result =
      this.agentsState.toolsEffectiveResult &&
      typeof this.agentsState.toolsEffectiveResult === "object"
        ? (this.agentsState.toolsEffectiveResult as JsonRecord)
        : null;
    if (!result) {
      return html`<p class="cp-empty">${copy.common.notLoaded}</p>`;
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
        value: this.settings.sessionKey,
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
      return html`<p class="cp-empty">${copy.common.notLoaded}</p>`;
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
      return html`<p class="cp-empty">${copy.common.notLoaded}</p>`;
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
      copy.common.notLoaded,
    );
  }

  private renderConfigIssuesPanel() {
    const copy = uiText(this.locale);
    const issues = Array.isArray(this.configState.configIssues)
      ? this.configState.configIssues
      : [];
    if (!issues.length) {
      return html`<p class="cp-empty">${copy.common.none}</p>`;
    }
    return html`
      <div class="cp-list cp-list--dense">
        ${issues.map((issue) => {
          const record = issue && typeof issue === "object" ? (issue as JsonRecord) : null;
          return html`
            <div class="cp-list-item">
              <strong>${readString(record?.path, copy.common.na)}</strong>
              <small>${readString(record?.message, copy.common.na)}</small>
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
      return html`<p class="cp-empty">${copy.common.notLoaded}</p>`;
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
      return html`<p class="cp-empty">${copy.common.notLoaded}</p>`;
    }
    const entries: Array<{ label: string; value: string; hint?: string }> = Object.entries(record)
      .filter(([, entry]) => ["string", "number", "boolean"].includes(typeof entry))
      .slice(0, 6)
      .map(([key, entry]) => ({
        label: key,
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
    const gatewayVersion = readString(
      this.hello?.server?.version,
      shellText(this.locale, "gatewayPending"),
    );
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
            label: copy.common.heartbeat,
            value: heartbeat.status,
            hint: heartbeat.ts ? formatAgo(heartbeat.ts, this.locale) : copy.common.pending,
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
                copy.common.updated,
                heartbeat.ts ? formatDateTime(heartbeat.ts, this.locale) : copy.common.pending,
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
                    <span>${copy.overview.heartbeat}</span><strong>${heartbeat.status}</strong>
                  </div>
                  <div>
                    <span>${copy.common.updated}</span
                    ><strong
                      >${heartbeat.ts
                        ? formatDateTime(heartbeat.ts, this.locale)
                        : copy.common.pending}</strong
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
    const query = this.sessionsQuery.trim().toLowerCase();
    const filteredSessions = query
      ? sessions.filter((session) => {
          const haystack = [
            session.key,
            session.displayName,
            session.label,
            session.surface,
            session.subject,
            session.room,
            session.space,
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
    const runtimeState = this.chatState.chatStream
      ? copy.sessions.streaming
      : this.chatState.chatSending
        ? copy.common.pending
        : (selected?.status ?? copy.common.idle);
    const selectedModel = selected?.model ?? this.sessionsState.sessionsResult?.defaults?.model;
    const selectedProvider =
      selected?.modelProvider ?? this.sessionsState.sessionsResult?.defaults?.modelProvider;
    return html`
      <section class="cp-page cp-page--sessions">
        ${this.renderPageHeader("sessions", [
          {
            label: copy.sessions.focusedSession,
            value: this.settings.sessionKey,
            hint: selected ? sessionDisplayName(selected) : undefined,
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
        <div class="cp-session-console">
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
                          <span>${session.key}</span>
                          <small>
                            ${(session.surface ?? session.kind).toUpperCase()} ·
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

            <article class="cp-panel cp-panel--fill cp-session-console__thread-panel">
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

              <div class="cp-chat-thread cp-chat-thread--console">
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
                <div class="cp-chat-composer__head">
                  <div>
                    <span class="cp-kicker">${copy.sessions.composerKicker}</span>
                    <h4>${copy.sessions.composerTitle}</h4>
                  </div>
                  <div class="cp-chat-composer__meta">
                    <span>
                      ${copy.sessions.draftLength}: ${this.chatState.chatMessage.trim().length}
                    </span>
                    <span>
                      ${copy.common.execution}: ${this.chatState.chatRunId ?? copy.common.none}
                    </span>
                    <span>
                      ${copy.sessions.imageAttachments}: ${this.chatState.chatAttachments.length}
                    </span>
                  </div>
                </div>
                <div class="cp-chat-attachments-toolbar">
                  <label class="cp-button cp-chat-attachments-toolbar__picker">
                    <input
                      type="file"
                      accept=${CHAT_ATTACHMENT_ACCEPT}
                      multiple
                      @change=${(event: Event) => void this.handleChatFileSelect(event)}
                    />
                    <span>${copy.sessions.attachImage}</span>
                  </label>
                  <span class="cp-chat-attachments-toolbar__hint">${copy.sessions.dragHint}</span>
                </div>
                ${this.chatState.chatAttachments.length
                  ? html`
                      <div class="cp-chat-attachments-preview">
                        ${repeat(
                          this.chatState.chatAttachments,
                          (attachment) => attachment.id,
                          (attachment) => html`
                            <div class="cp-chat-attachment-thumb">
                              <img
                                src=${attachment.dataUrl}
                                alt=${copy.sessions.imageAttachments}
                              />
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
                ? this.renderMetaEntries(
                    [
                      { label: copy.common.key, value: selected.key },
                      { label: copy.common.kind, value: selected.kind },
                      { label: copy.common.surface, value: selected.surface ?? copy.common.na },
                      {
                        label: copy.common.provider,
                        value: selectedProvider ?? copy.common.auto,
                      },
                      { label: copy.common.model, value: selectedModel ?? copy.common.default },
                      {
                        label: copy.common.tokens,
                        value: String(selected.totalTokens ?? 0),
                        hint:
                          selected.inputTokens != null || selected.outputTokens != null
                            ? `${selected.inputTokens ?? 0} in / ${selected.outputTokens ?? 0} out`
                            : undefined,
                      },
                    ],
                    copy.sessions.selectPrompt,
                  )
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
          </aside>
        </div>
      </section>
    `;
  }

  private renderChannels() {
    const copy = uiText(this.locale);
    const flattenedAccounts = flattenChannelAccounts(this.channelsState.channelsSnapshot);
    const connectedAccounts = flattenedAccounts.filter((entry) => entry.account.connected).length;
    return html`
      <section class="cp-page">
        ${this.renderPageHeader("channels", [
          {
            label: copy.channels.enabledSurfaces,
            value: String(this.channelsState.channelsSnapshot?.channelOrder.length ?? 0),
          },
          {
            label: copy.common.accounts,
            value: String(flattenedAccounts.length),
          },
          {
            label: copy.common.connectedAccounts,
            value: String(connectedAccounts),
          },
          {
            label: copy.common.lastProbe,
            value: this.channelsState.channelsLastSuccess
              ? formatDateTime(this.channelsState.channelsLastSuccess, this.locale)
              : copy.common.na,
            hint: this.channelsState.channelsLastSuccess
              ? formatAgo(this.channelsState.channelsLastSuccess, this.locale)
              : undefined,
          },
        ])}
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
    const selectedExecutionRecord =
      selectedExecution && typeof selectedExecution === "object"
        ? (selectedExecution as JsonRecord)
        : null;
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
                        ${this.renderWorkflowExecutionPanel(selectedExecution)}
                      </article>
                    </div>
                    <article class="cp-subpanel">
                      <h4>${copy.workflows.specification}</h4>
                      ${this.renderWorkflowSpecPanel(this.workflowsState.workflowDetail?.spec)}
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
                        ${this.renderAgentInspectionPanel(this.agentsState.agentInspectionSnapshot)}
                      </article>
                    </div>
                    <article class="cp-subpanel">
                      <h4>${copy.agents.toolsCatalog}</h4>
                      ${this.renderToolsCatalogPanel()}
                    </article>
                    <article class="cp-subpanel">
                      <h4>${copy.agents.effectiveTools}</h4>
                      ${this.renderToolsEffectivePanel()}
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
            hint: this.usageState.usageSelectedSessions[0] ?? undefined,
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
              ${this.renderUsageTotalsPanel()}
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
                ${this.renderUsageTimeSeriesPanel()}
              </article>
              <article class="cp-subpanel">
                <h4>${copy.usage.usageLogs}</h4>
                ${this.renderUsageLogsPanel()}
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
            label: copy.common.heartbeat,
            value: debugHeartbeat.status,
            hint: debugHeartbeat.ts
              ? formatDateTime(debugHeartbeat.ts, this.locale)
              : copy.common.pending,
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
