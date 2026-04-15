import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createStorageMock } from "../test-helpers/storage.ts";
import {
  applyResolvedTheme,
  applySettings,
  applySettingsFromUrl,
  attachThemeListener,
  buildAttentionItems,
  setTabFromRoute,
  syncThemeWithSettings,
} from "./app-settings.ts";
import type { ThemeMode, ThemeName } from "./theme.ts";

type Tab =
  | "agents"
  | "overview"
  | "channels"
  | "instances"
  | "sessions"
  | "usage"
  | "cron"
  | "skills"
  | "workflows"
  | "nodes"
  | "chat"
  | "config"
  | "communications"
  | "appearance"
  | "automation"
  | "infrastructure"
  | "aiAgents"
  | "debug"
  | "logs";

type SettingsHost = {
  settings: {
    gatewayUrl: string;
    token: string;
    sessionKey: string;
    lastActiveSessionKey: string;
    theme: ThemeName;
    themeMode: ThemeMode;
    chatFocusMode: boolean;
    chatShowThinking: boolean;
    chatShowToolCalls: boolean;
    uiMode?: "simple" | "advanced";
    splitRatio: number;
    navCollapsed: boolean;
    navWidth: number;
    navGroupsCollapsed: Record<string, boolean>;
    borderRadius: number;
  };
  theme: ThemeName & ThemeMode;
  themeMode: ThemeMode;
  themeResolved: import("./theme.ts").ResolvedTheme;
  applySessionKey: string;
  sessionKey: string;
  tab: Tab;
  connected: boolean;
  chatHasAutoScrolled: boolean;
  logsAtBottom: boolean;
  eventLog: unknown[];
  eventLogBuffer: unknown[];
  basePath: string;
  updateComplete?: Promise<unknown>;
  querySelector?: (selectors: string) => Element | null;
  style?: CSSStyleDeclaration;
  themeMedia: MediaQueryList | null;
  themeMediaHandler: ((event: MediaQueryListEvent) => void) | null;
  logsPollInterval: number | null;
  debugPollInterval: number | null;
  inspectPollInterval: number | null;
  workflowPollInterval: number | null;
  agentsPanel?: "overview" | "inspect" | "files" | "tools" | "skills" | "channels" | "cron";
  agentsSelectedId?: string | null;
  chatRunId?: string | null;
  workflowSelectedExecutionId?: string | null;
  workflowSelectedExecution?: { executionId: string; status: string | null } | null;
  workflowStatusLoading?: boolean;
  pendingGatewayUrl?: string | null;
  pendingGatewayToken?: string | null;
  lastError?: string | null;
  hello?: { auth?: { role?: string; scopes?: string[] } } | null;
  skillsReport?: {
    skills?: Array<{
      name: string;
      disabled?: boolean;
      missing?: string[];
      blockedByAllowlist?: boolean;
    }>;
  } | null;
  cronJobs?: Array<{
    name: string;
    enabled?: boolean;
    state?: { lastStatus?: string; nextRunAtMs?: number | null } | null;
  }>;
  attentionItems?: Array<{
    title: string;
    description: string;
    severity: string;
    icon: string;
  }>;
  feishuCliSupported?: boolean | null;
  feishuCliStatus?: { authOk?: boolean; message?: string | null } | null;
  feishuCliError?: string | null;
};

function setTestWindowUrl(urlString: string) {
  const current = new URL(urlString);
  const history = {
    replaceState: vi.fn((_state: unknown, _title: string, nextUrl: string | URL) => {
      const next = new URL(String(nextUrl), current.toString());
      current.href = next.toString();
      current.protocol = next.protocol;
      current.host = next.host;
      current.pathname = next.pathname;
      current.search = next.search;
      current.hash = next.hash;
    }),
  };
  const locationLike = {
    get href() {
      return current.toString();
    },
    get protocol() {
      return current.protocol;
    },
    get host() {
      return current.host;
    },
    get pathname() {
      return current.pathname;
    },
    get search() {
      return current.search;
    },
    get hash() {
      return current.hash;
    },
  };
  vi.stubGlobal("window", {
    location: locationLike,
    history,
    setInterval,
    clearInterval,
  } as unknown as Window & typeof globalThis);
  vi.stubGlobal("location", locationLike as Location);
  return { history, location: locationLike };
}

const createHost = (tab: Tab): SettingsHost => ({
  settings: {
    gatewayUrl: "",
    token: "",
    sessionKey: "main",
    lastActiveSessionKey: "main",
    theme: "claw",
    themeMode: "system",
    chatFocusMode: false,
    chatShowThinking: true,
    chatShowToolCalls: true,
    uiMode: "advanced",
    splitRatio: 0.6,
    navCollapsed: false,
    navWidth: 220,
    navGroupsCollapsed: {},
    borderRadius: 50,
  },
  theme: "claw" as unknown as ThemeName & ThemeMode,
  themeMode: "system",
  themeResolved: "dark",
  applySessionKey: "main",
  sessionKey: "main",
  tab,
  connected: false,
  chatHasAutoScrolled: false,
  logsAtBottom: false,
  eventLog: [],
  eventLogBuffer: [],
  basePath: "",
  updateComplete: Promise.resolve(),
  querySelector: () => null,
  style: document.documentElement.style,
  themeMedia: null,
  themeMediaHandler: null,
  logsPollInterval: null,
  debugPollInterval: null,
  inspectPollInterval: null,
  workflowPollInterval: null,
  agentsPanel: "overview",
  agentsSelectedId: null,
  chatRunId: null,
  workflowSelectedExecutionId: null,
  workflowSelectedExecution: null,
  workflowStatusLoading: false,
  pendingGatewayUrl: null,
  pendingGatewayToken: null,
  lastError: null,
  hello: null,
  skillsReport: null,
  cronJobs: [],
  attentionItems: [],
  feishuCliSupported: null,
  feishuCliStatus: null,
  feishuCliError: null,
});

describe("setTabFromRoute", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", createStorageMock());
    vi.stubGlobal("navigator", { language: "en-US" } as Navigator);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("starts and stops log polling based on the tab", () => {
    const host = createHost("chat");

    setTabFromRoute(host, "logs");
    expect(host.logsPollInterval).not.toBeNull();
    expect(host.debugPollInterval).toBeNull();

    setTabFromRoute(host, "chat");
    expect(host.logsPollInterval).toBeNull();
  });

  it("starts and stops debug polling based on the tab", () => {
    const host = createHost("chat");

    setTabFromRoute(host, "debug");
    expect(host.debugPollInterval).not.toBeNull();
    expect(host.logsPollInterval).toBeNull();

    setTabFromRoute(host, "chat");
    expect(host.debugPollInterval).toBeNull();
  });

  it("starts and stops inspect polling only for agent inspect on the active run", () => {
    const host = createHost("chat");
    host.connected = true;
    host.agentsPanel = "inspect";
    host.agentsSelectedId = "main";
    host.chatRunId = "run-123";

    setTabFromRoute(host, "agents");
    expect(host.inspectPollInterval).not.toBeNull();

    host.connected = false;
    setTabFromRoute(host, "chat");
    expect(host.inspectPollInterval).toBeNull();
  });

  it("starts and stops workflow polling only for active workflow executions", () => {
    const host = createHost("chat");
    host.connected = true;
    host.workflowSelectedExecutionId = "exec_123";
    host.workflowSelectedExecution = { executionId: "exec_123", status: "running" };

    setTabFromRoute(host, "workflows");
    expect(host.workflowPollInterval).not.toBeNull();

    host.workflowSelectedExecution = { executionId: "exec_123", status: "succeeded" };
    host.connected = false;
    setTabFromRoute(host, "chat");
    expect(host.workflowPollInterval).toBeNull();
  });

  it("re-resolves the active palette when only themeMode changes", () => {
    const host = createHost("chat");
    host.settings.theme = "knot";
    host.settings.themeMode = "dark";
    host.theme = "knot" as unknown as ThemeName & ThemeMode;
    host.themeMode = "dark";
    host.themeResolved = "openknot";

    applySettings(host, {
      ...host.settings,
      themeMode: "light",
    });

    expect(host.theme).toBe("knot");
    expect(host.themeMode).toBe("light");
    expect(host.themeResolved).toBe("openknot-light");
  });

  it("syncs both theme family and mode from persisted settings", () => {
    const host = createHost("chat");
    host.settings.theme = "dash";
    host.settings.themeMode = "light";

    syncThemeWithSettings(host);

    expect(host.theme).toBe("dash");
    expect(host.themeMode).toBe("light");
    expect(host.themeResolved).toBe("dash-light");
  });

  it("applies named system themes on OS preference changes", () => {
    const listeners: Array<(event: MediaQueryListEvent) => void> = [];
    const matchMedia = vi.fn().mockReturnValue({
      matches: false,
      addEventListener: (_name: string, handler: (event: MediaQueryListEvent) => void) => {
        listeners.push(handler);
      },
      removeEventListener: vi.fn(),
    });
    vi.stubGlobal("matchMedia", matchMedia);
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: matchMedia,
    });

    const host = createHost("chat");
    host.theme = "knot" as unknown as ThemeName & ThemeMode;
    host.themeMode = "system";

    attachThemeListener(host);
    listeners[0]?.({ matches: true } as MediaQueryListEvent);
    expect(host.themeResolved).toBe("openknot");

    listeners[0]?.({ matches: false } as MediaQueryListEvent);
    expect(host.themeResolved).toBe("openknot");
  });

  it("normalizes light family themes to the shared light CSS token", () => {
    const root = {
      dataset: {} as DOMStringMap,
      style: { colorScheme: "" } as CSSStyleDeclaration & { colorScheme: string },
    };
    vi.stubGlobal("document", { documentElement: root } as Document);

    const host = createHost("chat");
    applyResolvedTheme(host, "dash-light");

    expect(host.themeResolved).toBe("dash-light");
    expect(root.dataset.theme).toBe("dash-light");
    expect(root.style.colorScheme).toBe("light");
  });

  it("adds an attention item when Feishu user tools are not loaded", () => {
    const host = createHost("overview");
    host.connected = true;
    host.feishuCliSupported = false;

    buildAttentionItems(host as never);

    expect(host.attentionItems?.map((item) => item.title)).toContain("Feishu user tools not loaded");
  });

  it("adds an attention item when Feishu user auth is missing", () => {
    const host = createHost("overview");
    host.connected = true;
    host.feishuCliSupported = true;
    host.feishuCliStatus = {
      authOk: false,
      message: "Run crawclaw feishu-cli auth login first.",
    };

    buildAttentionItems(host as never);

    expect(host.attentionItems?.map((item) => item.title)).toContain("Feishu user auth required");
    expect(host.attentionItems?.[0]?.description).toContain(
      "Run crawclaw feishu-cli auth login first.",
    );
  });
});

describe("applySettingsFromUrl", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", createStorageMock());
    vi.stubGlobal("sessionStorage", createStorageMock());
    vi.stubGlobal("navigator", { language: "en-US" } as Navigator);
    setTestWindowUrl("https://control.example/ui/overview");
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("hydrates query token params and strips them from the URL", () => {
    setTestWindowUrl("https://control.example/ui/overview?token=abc123");
    const host = createHost("overview");
    host.settings.gatewayUrl = "wss://control.example/crawclaw";

    applySettingsFromUrl(host);

    expect(host.settings.token).toBe("abc123");
    expect(window.location.search).toBe("");
  });

  it("keeps query token params pending when a gatewayUrl confirmation is required", () => {
    setTestWindowUrl(
      "https://control.example/ui/overview?gatewayUrl=wss://other-gateway.example/crawclaw&token=abc123",
    );
    const host = createHost("overview");
    host.settings.gatewayUrl = "wss://control.example/crawclaw";

    applySettingsFromUrl(host);

    expect(host.settings.token).toBe("");
    expect(host.pendingGatewayUrl).toBe("wss://other-gateway.example/crawclaw");
    expect(host.pendingGatewayToken).toBe("abc123");
    expect(window.location.search).toBe("");
  });

  it("prefers fragment tokens over legacy query tokens when both are present", () => {
    setTestWindowUrl("https://control.example/ui/overview?token=query-token#token=hash-token");
    const host = createHost("overview");
    host.settings.gatewayUrl = "wss://control.example/crawclaw";

    applySettingsFromUrl(host);

    expect(host.settings.token).toBe("hash-token");
    expect(window.location.search).toBe("");
    expect(window.location.hash).toBe("");
  });

  it("resets stale persisted session selection to main when a token is supplied without a session", () => {
    setTestWindowUrl("https://control.example/chat#token=test-token");
    const host = createHost("chat");
    host.settings = {
      ...host.settings,
      gatewayUrl: "ws://localhost:18789",
      token: "",
      sessionKey: "agent:test_old:main",
      lastActiveSessionKey: "agent:test_old:main",
    };
    host.sessionKey = "agent:test_old:main";

    applySettingsFromUrl(host);

    expect(host.sessionKey).toBe("main");
    expect(host.settings.sessionKey).toBe("main");
    expect(host.settings.lastActiveSessionKey).toBe("main");
  });

  it("preserves an explicit session from the URL when token and session are both supplied", () => {
    setTestWindowUrl(
      "https://control.example/chat?session=agent%3Atest_new%3Amain#token=test-token",
    );
    const host = createHost("chat");
    host.settings = {
      ...host.settings,
      gatewayUrl: "ws://localhost:18789",
      token: "",
      sessionKey: "agent:test_old:main",
      lastActiveSessionKey: "agent:test_old:main",
    };
    host.sessionKey = "agent:test_old:main";

    applySettingsFromUrl(host);

    expect(host.sessionKey).toBe("agent:test_new:main");
    expect(host.settings.sessionKey).toBe("agent:test_new:main");
    expect(host.settings.lastActiveSessionKey).toBe("agent:test_new:main");
  });

  it("does not reset the current gateway session when a different gateway is pending confirmation", () => {
    setTestWindowUrl(
      "https://control.example/chat?gatewayUrl=ws%3A%2F%2Fgateway-b.example%3A18789#token=test-token",
    );
    const host = createHost("chat");
    host.settings = {
      ...host.settings,
      gatewayUrl: "ws://gateway-a.example:18789",
      token: "",
      sessionKey: "agent:test_old:main",
      lastActiveSessionKey: "agent:test_old:main",
    };
    host.sessionKey = "agent:test_old:main";

    applySettingsFromUrl(host);

    expect(host.sessionKey).toBe("agent:test_old:main");
    expect(host.settings.sessionKey).toBe("agent:test_old:main");
    expect(host.settings.lastActiveSessionKey).toBe("agent:test_old:main");
    expect(host.pendingGatewayUrl).toBe("ws://gateway-b.example:18789");
    expect(host.pendingGatewayToken).toBe("test-token");
  });
});
