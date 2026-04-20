import { SCREEN_COPY, type SupportedShellLocale } from "./screen-copy.ts";

export type ControlPage =
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

export type ControlPageMeta = {
  id: ControlPage;
  icon: string;
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

const CONTROL_PAGE_IDS = [
  "sessions",
  "channels",
  "workflows",
  "agents",
  "memory",
  "runtime",
  "usage",
  "config",
  "debug",
] as const satisfies readonly ControlPage[];

function normalizeUiLocale(locale?: string): SupportedShellLocale {
  return locale === "zh-CN" ? "zh-CN" : "en";
}

export function controlPagesForLocale(locale?: string): ControlPageMeta[] {
  const normalizedLocale = normalizeUiLocale(locale);
  return CONTROL_PAGE_IDS.map((id) => ({
    id,
    ...SCREEN_COPY[normalizedLocale][id],
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
  runtime: "/runtime",
  usage: "/usage",
  config: "/config",
  debug: "/debug",
};

const LEGACY_ROUTE_ALIASES: Record<string, ControlPage> = {
  "/": "sessions",
  "/overview": "sessions",
  "/chat": "sessions",
  "/channels": "channels",
  "/workflows": "workflows",
  "/agents": "agents",
  "/memory": "memory",
  "/runtime": "runtime",
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
  return LEGACY_ROUTE_ALIASES[normalized] ?? "sessions";
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
