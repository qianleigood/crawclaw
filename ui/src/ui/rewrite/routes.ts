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

declare global {
  interface Window {
    __CRAWCLAW_CONTROL_UI_BASE_PATH__?: string;
  }
}

export const CONTROL_PAGES: ControlPageMeta[] = [
  {
    id: "overview",
    label: "Overview",
    eyebrow: "System overview",
    headline: "Mission control for the current gateway.",
    subheadline: "Health, presence, channels, workflows and approvals at a glance.",
  },
  {
    id: "sessions",
    label: "Sessions",
    eyebrow: "Sessions & chat console",
    headline: "Operate live sessions, messages and current runs.",
    subheadline: "The left rail tracks session inventory, the main pane stays on the thread.",
  },
  {
    id: "channels",
    label: "Channels",
    eyebrow: "Channels management console",
    headline: "Watch every linked surface and its current operator state.",
    subheadline: "Probe health, account readiness and optional login flows from one surface.",
  },
  {
    id: "workflows",
    label: "Workflows",
    eyebrow: "Workflow deployment console",
    headline: "Track definitions, versions, deploy state and current executions.",
    subheadline: "Registry rail on the left, execution-grade detail on the right.",
  },
  {
    id: "agents",
    label: "Agents",
    eyebrow: "Agents & introspection",
    headline: "Inspect runtime identity, tools and live execution context.",
    subheadline: "Use the rail for registry selection and the main pane for deep inspection.",
  },
  {
    id: "usage",
    label: "Usage",
    eyebrow: "Usage & observability",
    headline: "Follow tokens, cost and session-level traces.",
    subheadline: "Summary on top, session drilldowns and time-series below.",
  },
  {
    id: "config",
    label: "Config",
    eyebrow: "Approvals & config console",
    headline: "Edit the manifest, review runtime parity and keep approval policy in sync.",
    subheadline: "One workbench for config raw editing and execution approval controls.",
  },
  {
    id: "debug",
    label: "Debug",
    eyebrow: "Debug & RPC console",
    headline: "Inspect method surface, current status and raw RPC traffic.",
    subheadline: "Use this page as the engineering backstop when a product surface looks wrong.",
  },
] as const;

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

export function metaForPage(page: ControlPage): ControlPageMeta {
  return CONTROL_PAGES.find((entry) => entry.id === page) ?? CONTROL_PAGES[0];
}
