export type ControlPage =
  | "overview"
  | "sessions"
  | "channels"
  | "workflows"
  | "agents"
  | "memory"
  | "usage"
  | "config"
  | "debug";

export type ControlPageMeta = {
  id: ControlPage;
  label: string;
  eyebrow: string;
  headline: string;
  subheadline: string;
};

type SupportedShellLocale = "en" | "zh-CN";

type LocalizedPageMeta = Record<SupportedShellLocale, Omit<ControlPageMeta, "id">>;

declare global {
  interface Window {
    __CRAWCLAW_CONTROL_UI_BASE_PATH__?: string;
  }
}

const CONTROL_PAGE_IDS = [
  "overview",
  "sessions",
  "channels",
  "workflows",
  "agents",
  "memory",
  "usage",
  "config",
  "debug",
] as const satisfies readonly ControlPage[];

const LOCALIZED_CONTROL_PAGE_META: Record<ControlPage, LocalizedPageMeta> = {
  overview: {
    en: {
      label: "Overview",
      eyebrow: "Start here",
      headline: "See what needs attention before you do anything else.",
      subheadline: "Gateway health, recent activity and the next actions are all in one place.",
    },
    "zh-CN": {
      label: "概览",
      eyebrow: "从这里开始",
      headline: "先看系统现在有没有问题，再决定下一步要做什么。",
      subheadline: "把网关健康、最近活动和下一步操作收在同一个起始页里。",
    },
  },
  sessions: {
    en: {
      label: "Sessions",
      eyebrow: "Chat and conversations",
      headline: "Open a session, read the thread, and send the next message.",
      subheadline: "Recent sessions stay on the left, the live conversation stays in the center.",
    },
    "zh-CN": {
      label: "会话",
      eyebrow: "聊天与会话",
      headline: "打开一个会话，查看对话，再发送下一条消息。",
      subheadline: "左侧是最近会话，中间是当前对话，右侧补充运行与路由信息。",
    },
  },
  channels: {
    en: {
      label: "Channels",
      eyebrow: "Connections and logins",
      headline: "Check which channels are connected and fix the ones that are not.",
      subheadline: "Use this page to verify accounts, rerun probes, and complete login flows.",
    },
    "zh-CN": {
      label: "渠道",
      eyebrow: "连接与登录",
      headline: "检查哪些渠道已经连上，哪些还需要处理。",
      subheadline: "在这里查看账号状态、重新探测健康情况，并完成登录流程。",
    },
  },
  workflows: {
    en: {
      label: "Workflows",
      eyebrow: "Workflow library",
      headline: "Choose a workflow, see its state, and run or deploy it.",
      subheadline:
        "The left side lists what exists, the right side explains what the selected workflow is doing.",
    },
    "zh-CN": {
      label: "工作流",
      eyebrow: "工作流库",
      headline: "选择一个工作流，查看状态，然后运行或部署它。",
      subheadline: "左侧列出可用工作流，右侧解释当前选中项正在做什么。",
    },
  },
  agents: {
    en: {
      label: "Agents",
      eyebrow: "Agents and tools",
      headline: "See which agents exist, what model they use, and which tools they can access.",
      subheadline: "Choose an agent on the left and inspect its runtime details on the right.",
    },
    "zh-CN": {
      label: "代理",
      eyebrow: "代理与工具",
      headline: "查看有哪些代理、它们用什么模型、能访问哪些工具。",
      subheadline: "左侧选择代理，右侧查看它的运行详情和工具可用性。",
    },
  },
  memory: {
    en: {
      label: "Memory",
      eyebrow: "Memory and knowledge",
      headline: "Check whether memory is ready and what the system has already summarized.",
      subheadline:
        "Provider status, dream runs, session summaries and prompt journal live in one place.",
    },
    "zh-CN": {
      label: "记忆",
      eyebrow: "记忆与知识",
      headline: "检查记忆能力是否可用，以及系统已经总结了什么。",
      subheadline: "提供方状态、dream 运行、会话摘要和 prompt journal 都在这里查看。",
    },
  },
  usage: {
    en: {
      label: "Usage",
      eyebrow: "Cost and usage",
      headline: "Track cost, tokens and which sessions are using the most resources.",
      subheadline: "Start with totals, then drill into sessions, trends and logs.",
    },
    "zh-CN": {
      label: "用量",
      eyebrow: "成本与用量",
      headline: "查看成本、tokens，以及哪些会话最耗资源。",
      subheadline: "先看总览，再下钻到会话、趋势和日志。",
    },
  },
  config: {
    en: {
      label: "Config",
      eyebrow: "Settings and approvals",
      headline: "Edit configuration safely and keep approval rules in sync.",
      subheadline: "Use this page to save config changes, apply them, and review policy files.",
    },
    "zh-CN": {
      label: "配置",
      eyebrow: "设置与审批",
      headline: "安全地编辑配置，并保持审批规则同步。",
      subheadline: "在这里保存配置、应用改动，并查看审批策略文件。",
    },
  },
  debug: {
    en: {
      label: "Debug",
      eyebrow: "Advanced diagnostics",
      headline:
        "Inspect raw status and call methods directly when the normal pages are not enough.",
      subheadline: "This is the engineering fallback page for deeper troubleshooting.",
    },
    "zh-CN": {
      label: "调试",
      eyebrow: "高级诊断",
      headline: "当普通页面不够用时，在这里查看原始状态并直接调用方法。",
      subheadline: "这里是更偏工程排障的兜底页。",
    },
  },
} as const;

function normalizeUiLocale(locale?: string): SupportedShellLocale {
  return locale === "zh-CN" ? "zh-CN" : "en";
}

export function controlPagesForLocale(locale?: string): ControlPageMeta[] {
  const normalizedLocale = normalizeUiLocale(locale);
  return CONTROL_PAGE_IDS.map((id) => ({
    id,
    ...LOCALIZED_CONTROL_PAGE_META[id][normalizedLocale],
  }));
}

export const CONTROL_PAGES = controlPagesForLocale("en");

const PRIMARY_ROUTE_SEGMENTS: Record<ControlPage, string> = {
  overview: "/overview",
  sessions: "/sessions",
  channels: "/channels",
  workflows: "/workflows",
  agents: "/agents",
  memory: "/memory",
  usage: "/usage",
  config: "/config",
  debug: "/debug",
};

const LEGACY_ROUTE_ALIASES: Record<string, ControlPage> = {
  "/": "overview",
  "/chat": "sessions",
  "/channels": "channels",
  "/workflows": "workflows",
  "/agents": "agents",
  "/memory": "memory",
  "/usage": "usage",
  "/config": "config",
  "/debug": "debug",
  "/logs": "debug",
  "/sessions": "sessions",
  "/cron": "workflows",
  "/skills": "agents",
  "/instances": "channels",
  "/nodes": "config",
  "/communications": "config",
  "/appearance": "config",
  "/automation": "workflows",
  "/infrastructure": "channels",
  "/ai-agents": "agents",
};

function normalizePath(pathname: string): string {
  if (!pathname) {
    return "/";
  }
  let normalized = pathname.trim();
  if (!normalized.startsWith("/")) {
    normalized = `/${normalized}`;
  }
  if (normalized.length > 1 && normalized.endsWith("/")) {
    normalized = normalized.slice(0, -1);
  }
  return normalized;
}

function normalizeBasePath(basePath: string): string {
  const normalized = normalizePath(basePath);
  return normalized === "/" ? "" : normalized;
}

export function inferBasePath(pathname: string): string {
  const normalized = normalizePath(pathname);
  const segments = normalized.split("/").filter(Boolean);
  if (segments.length === 0) {
    return "";
  }
  for (let index = 0; index < segments.length; index += 1) {
    const candidate = `/${segments.slice(index).join("/")}`.toLowerCase();
    if (candidate in LEGACY_ROUTE_ALIASES) {
      const prefix = segments.slice(0, index);
      return prefix.length ? `/${prefix.join("/")}` : "";
    }
  }
  return "";
}

export function resolveBasePath(pathname: string): string {
  const configured =
    typeof window !== "undefined" &&
    typeof window.__CRAWCLAW_CONTROL_UI_BASE_PATH__ === "string" &&
    window.__CRAWCLAW_CONTROL_UI_BASE_PATH__.trim();
  if (configured) {
    return normalizeBasePath(configured);
  }
  return inferBasePath(pathname);
}

export function pageFromPath(pathname: string, basePath = ""): ControlPage {
  const normalizedBasePath = normalizeBasePath(basePath);
  let normalized = normalizePath(pathname).toLowerCase();
  if (normalizedBasePath && normalized.startsWith(`${normalizedBasePath}/`)) {
    normalized = normalized.slice(normalizedBasePath.length);
  } else if (normalized === normalizedBasePath) {
    normalized = "/";
  }
  if (normalized.endsWith("/index.html")) {
    normalized = "/";
  }
  return LEGACY_ROUTE_ALIASES[normalized] ?? "overview";
}

export function pathForPage(page: ControlPage, basePath = ""): string {
  const normalizedBasePath = normalizeBasePath(basePath);
  const segment = PRIMARY_ROUTE_SEGMENTS[page];
  return normalizedBasePath ? `${normalizedBasePath}${segment}` : segment;
}

export function metaForPage(page: ControlPage, locale?: string): ControlPageMeta {
  const pages = controlPagesForLocale(locale);
  return pages.find((entry) => entry.id === page) ?? pages[0];
}
