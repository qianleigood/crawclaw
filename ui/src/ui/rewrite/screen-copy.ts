export type SupportedShellLocale = "en" | "zh-CN";

type ControlPageId =
  | "overview"
  | "sessions"
  | "channels"
  | "workflows"
  | "agents"
  | "memory"
  | "runtime"
  | "usage"
  | "config"
  | "debug";

type ScreenCopyEntry = {
  icon: string;
  label: string;
  eyebrow: string;
  headline: string;
  subheadline: string;
};

type ScreenCopyMap = Record<SupportedShellLocale, Record<ControlPageId, ScreenCopyEntry>>;

export const SCREEN_COPY: ScreenCopyMap = {
  en: {
    overview: {
      icon: "dashboard",
      label: "System Overview",
      eyebrow: "OPERATIONS DASHBOARD",
      headline: "Review system health, recent activity, and the next operator actions.",
      subheadline: "SYS_ID: CRAWCLAW_OVERVIEW // gateway health, activity ledger, memory state",
    },
    sessions: {
      icon: "group",
      label: "Sessions & Chat",
      eyebrow: "OPERATIONS / LIVE THREADS",
      headline: "Open a live thread, inspect the conversation, and send the next message.",
      subheadline: "ACTIVE_SESSIONS // queue, live thread, routing and runtime telemetry",
    },
    channels: {
      icon: "hub",
      label: "Channels",
      eyebrow: "CHANNELS MANAGEMENT CONSOLE",
      headline: "Review connected channels, add new transports, and repair unhealthy accounts.",
      subheadline:
        "CHANNEL_REGISTRY // configured channels, catalog, account controls, setup status",
    },
    workflows: {
      icon: "account_tree",
      label: "Workflows",
      eyebrow: "WORKFLOW DEPLOYMENT",
      headline: "Inspect registry definitions, current execution, and deployment actions.",
      subheadline: "RUNTIME OPS CONSOLE // registry rail, execution detail, spec and recent runs",
    },
    agents: {
      icon: "psychology",
      label: "Agents",
      eyebrow: "AGENTS & INTROSPECTION",
      headline: "Inspect registered agents, connected operator tools, and runtime details.",
      subheadline: "AGENT_REGISTRY // list rail, inspection center, tools and capability panels",
    },
    memory: {
      icon: "neurology",
      label: "Memory",
      eyebrow: "MEMORY CONSOLE",
      headline: "Inspect provider readiness, dream runs, summaries, and prompt journal output.",
      subheadline: "MEMORY_CONSOLE // provider state, dream ledger, summaries and journal",
    },
    runtime: {
      icon: "developer_board",
      label: "Agent Runtime",
      eyebrow: "AGENT RUNTIME",
      headline: "Inspect background work, long-running tasks, and runs that need intervention.",
      subheadline: "RUNTIME_LEDGER // task list, detail rail, lifecycle and cancel controls",
    },
    usage: {
      icon: "monitoring",
      label: "Usage",
      eyebrow: "USAGE & OBSERVABILITY",
      headline: "Track cost, token usage, session load, and detailed logs.",
      subheadline: "USAGE_LEDGER // totals, timeseries, session detail and log slices",
    },
    config: {
      icon: "settings_input_component",
      label: "Config",
      eyebrow: "APPROVALS & CONFIG",
      headline: "Edit system configuration, keep approvals in sync, and apply safely.",
      subheadline: "CONTROL_MANIFEST // config editor, policy files, issues and apply state",
    },
    debug: {
      icon: "terminal",
      label: "Debug",
      eyebrow: "DEBUG & RPC",
      headline: "Inspect raw status snapshots, method surface, and direct RPC controls.",
      subheadline: "DEBUG_CONSOLE // status payloads, heartbeat snapshots and manual method calls",
    },
  },
  "zh-CN": {
    overview: {
      icon: "dashboard",
      label: "系统概览",
      eyebrow: "操作总览",
      headline: "先看系统健康、最近活动和待处理事项，再决定下一步操作。",
      subheadline: "CRAWCLAW_OVERVIEW // 网关健康、活动台账、记忆状态",
    },
    sessions: {
      icon: "group",
      label: "会话控制台",
      eyebrow: "实时会话",
      headline: "打开一个活动会话，查看对话流，再发送下一条消息。",
      subheadline: "ACTIVE_SESSIONS // 左侧队列，中间对话，右侧路由与运行遥测",
    },
    channels: {
      icon: "hub",
      label: "渠道管理",
      eyebrow: "渠道管理台",
      headline: "检查已接入渠道，新增渠道，并修复不健康账号。",
      subheadline: "CHANNEL_REGISTRY // 当前渠道、目录、账号动作、配置状态",
    },
    workflows: {
      icon: "account_tree",
      label: "工作流运行",
      eyebrow: "工作流部署",
      headline: "查看注册工作流、当前执行和部署动作。",
      subheadline: "RUNTIME OPS CONSOLE // 左侧注册表，中间执行详情，右侧规格与最近运行",
    },
    agents: {
      icon: "psychology",
      label: "智能体自省",
      eyebrow: "智能体与自省",
      headline: "查看已注册智能体、已连接工具以及运行时详情。",
      subheadline: "AGENT_REGISTRY // 左侧列表，中间检查面板，右侧工具与能力区",
    },
    memory: {
      icon: "neurology",
      label: "记忆",
      eyebrow: "记忆控制台",
      headline: "检查记忆提供方是否就绪，以及系统已经总结了什么。",
      subheadline: "MEMORY_CONSOLE // 提供方状态、dream 台账、摘要与 prompt 日志",
    },
    runtime: {
      icon: "developer_board",
      label: "后台运行",
      eyebrow: "后台运行",
      headline: "查看系统后台正在运行什么，以及哪些任务需要处理。",
      subheadline: "RUNTIME_LEDGER // 任务列表、详情侧栏、生命周期与取消动作",
    },
    usage: {
      icon: "monitoring",
      label: "用量与观察",
      eyebrow: "用量与观察",
      headline: "查看成本、tokens、会话负载和详细日志。",
      subheadline: "USAGE_LEDGER // 总览、时序、会话细节和日志切片",
    },
    config: {
      icon: "settings_input_component",
      label: "审批与配置",
      eyebrow: "审批与配置",
      headline: "安全地编辑系统配置，并保持审批规则同步。",
      subheadline: "CONTROL_MANIFEST // 配置编辑器、策略文件、问题列表与应用状态",
    },
    debug: {
      icon: "terminal",
      label: "RPC 调试",
      eyebrow: "调试与 RPC",
      headline: "当普通页面不够用时，在这里查看原始状态和直接调用方法。",
      subheadline: "DEBUG_CONSOLE // 状态快照、心跳记录和手动 RPC 调用",
    },
  },
};
