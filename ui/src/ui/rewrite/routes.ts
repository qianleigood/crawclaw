export type ControlPage =
  | "overview"
  | "sessions"
  | "channels"
  | "workflows"
  | "agents"
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
  "usage",
  "config",
  "debug",
] as const satisfies readonly ControlPage[];

const LOCALIZED_CONTROL_PAGE_META: Record<ControlPage, LocalizedPageMeta> = {
  overview: {
    en: {
      label: "Overview",
      eyebrow: "System overview",
      headline: "Mission control for the current gateway.",
      subheadline: "Health, presence, channels, workflows and approvals at a glance.",
    },
    "zh-CN": {
      label: "概览",
      eyebrow: "系统总览",
      headline: "当前网关的任务控制台。",
      subheadline: "在一个页面里看健康状态、在线客户端、渠道、工作流和审批面。",
    },
  },
  sessions: {
    en: {
      label: "Sessions",
      eyebrow: "Sessions & chat console",
      headline: "Operate live sessions, messages and current runs.",
      subheadline: "The left rail tracks session inventory, the main pane stays on the thread.",
    },
    "zh-CN": {
      label: "会话",
      eyebrow: "会话与聊天控制台",
      headline: "直接操作实时会话、消息和当前运行。",
      subheadline: "左侧是会话清单，中间保持在线对话线程，右侧做检查与原始输出。",
    },
  },
  channels: {
    en: {
      label: "Channels",
      eyebrow: "Channels management console",
      headline: "Watch every linked surface and its current operator state.",
      subheadline: "Probe health, account readiness and optional login flows from one surface.",
    },
    "zh-CN": {
      label: "渠道",
      eyebrow: "渠道管理控制台",
      headline: "统一查看所有已接入表面和当前运行状态。",
      subheadline: "在一个页面里完成健康探测、账号就绪检查和可选登录流程。",
    },
  },
  workflows: {
    en: {
      label: "Workflows",
      eyebrow: "Workflow deployment console",
      headline: "Track definitions, versions, deploy state and current executions.",
      subheadline: "Registry rail on the left, execution-grade detail on the right.",
    },
    "zh-CN": {
      label: "工作流",
      eyebrow: "工作流部署控制台",
      headline: "追踪定义、版本、部署状态和当前执行。",
      subheadline: "左侧是注册表，右侧是面向执行的详细面板。",
    },
  },
  agents: {
    en: {
      label: "Agents",
      eyebrow: "Agents & introspection",
      headline: "Inspect runtime identity, tools and live execution context.",
      subheadline: "Use the rail for registry selection and the main pane for deep inspection.",
    },
    "zh-CN": {
      label: "代理",
      eyebrow: "代理与运行检查",
      headline: "检查运行身份、工具面和实时执行上下文。",
      subheadline: "左侧用于选择注册代理，右侧用于深度检查当前运行面。",
    },
  },
  usage: {
    en: {
      label: "Usage",
      eyebrow: "Usage & observability",
      headline: "Follow tokens, cost and session-level traces.",
      subheadline: "Summary on top, session drilldowns and time-series below.",
    },
    "zh-CN": {
      label: "用量",
      eyebrow: "用量与观测",
      headline: "追踪 tokens、成本和会话级别明细。",
      subheadline: "上面是摘要，下面是会话钻取和时间序列分析。",
    },
  },
  config: {
    en: {
      label: "Config",
      eyebrow: "Approvals & config console",
      headline: "Edit the manifest, review runtime parity and keep approval policy in sync.",
      subheadline: "One workbench for config raw editing and execution approval controls.",
    },
    "zh-CN": {
      label: "配置",
      eyebrow: "审批与配置控制台",
      headline: "编辑配置清单、检查运行一致性，并保持审批策略同步。",
      subheadline: "把原始配置编辑和执行审批控制收在同一个工作台里。",
    },
  },
  debug: {
    en: {
      label: "Debug",
      eyebrow: "Debug & RPC console",
      headline: "Inspect method surface, current status and raw RPC traffic.",
      subheadline: "Use this page as the engineering backstop when a product surface looks wrong.",
    },
    "zh-CN": {
      label: "调试",
      eyebrow: "调试与 RPC 控制台",
      headline: "检查方法面、当前状态和原始 RPC 流量。",
      subheadline: "当产品页面表现异常时，把这里当作工程兜底面板。",
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
