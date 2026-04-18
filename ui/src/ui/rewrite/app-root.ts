import { LitElement, html, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";
import { repeat } from "lit/directives/repeat.js";
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
  CONTROL_PAGES,
  metaForPage,
  pageFromPath,
  pathForPage,
  resolveBasePath,
  type ControlPage,
} from "./routes.ts";

type JsonRecord = Record<string, unknown>;

function formatDateTime(value?: number | null): string {
  if (!value) {
    return "n/a";
  }
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(value);
}

function formatAgo(value?: number | null): string {
  if (!value) {
    return "n/a";
  }
  const diffSeconds = Math.round((Date.now() - value) / 1000);
  if (Math.abs(diffSeconds) < 60) {
    return `${diffSeconds}s ago`;
  }
  const diffMinutes = Math.round(diffSeconds / 60);
  if (Math.abs(diffMinutes) < 60) {
    return `${diffMinutes}m ago`;
  }
  const diffHours = Math.round(diffMinutes / 60);
  if (Math.abs(diffHours) < 48) {
    return `${diffHours}h ago`;
  }
  const diffDays = Math.round(diffHours / 24);
  return `${diffDays}d ago`;
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
    window.addEventListener("popstate", this.handlePopState);
  }

  firstUpdated() {
    void this.connectGateway();
  }

  disconnectedCallback() {
    window.removeEventListener("popstate", this.handlePopState);
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
        this.lastError = info.error?.message ?? info.reason ?? "Gateway disconnected";
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
      return html`<span class="cp-badge cp-badge--ok">Connected</span>`;
    }
    if (this.connecting) {
      return html`<span class="cp-badge cp-badge--warn">Connecting</span>`;
    }
    return html`<span class="cp-badge cp-badge--danger">Disconnected</span>`;
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
    const meta = metaForPage(page);
    return html`
      <header class="cp-page-head">
        <div class="cp-page-head__copy">
          <span class="cp-page-head__eyebrow">${meta.eyebrow}</span>
          <h1>${meta.label}</h1>
          <p>${meta.headline}</p>
          <small>${meta.subheadline}</small>
        </div>
        <div class="cp-page-head__stats">
          ${this.renderMetric("Gateway", readString(this.hello?.server?.version, "pending"))}
          ${this.renderMetric("Methods", String(this.hello?.features?.methods?.length ?? 0))}
          ${this.renderMetric("Session", this.settings.sessionKey)} ${extra ?? nothing}
        </div>
      </header>
    `;
  }

  private renderConnectionWorkbench() {
    return html`
      <section class="cp-panel cp-panel--hero">
        <div class="cp-panel__head">
          <div>
            <span class="cp-kicker">Gateway endpoint</span>
            <h3>Reconnect the control plane</h3>
          </div>
        </div>
        <form class="cp-form" @submit=${(event: Event) => this.handleGatewayFormSubmit(event)}>
          <label>
            <span>WebSocket endpoint</span>
            <input
              .value=${this.gatewayUrlDraft}
              @input=${(event: Event) => {
                this.gatewayUrlDraft = (event.target as HTMLInputElement).value;
              }}
            />
          </label>
          <label>
            <span>Gateway token</span>
            <input
              .value=${this.gatewayTokenDraft}
              @input=${(event: Event) => {
                this.gatewayTokenDraft = (event.target as HTMLInputElement).value;
              }}
            />
          </label>
          <label>
            <span>Password</span>
            <input
              type="password"
              .value=${this.password}
              @input=${(event: Event) => {
                this.password = (event.target as HTMLInputElement).value;
              }}
            />
          </label>
          <div class="cp-form__actions">
            <button class="cp-button cp-button--primary" type="submit">Reconnect</button>
          </div>
        </form>
      </section>
    `;
  }

  private renderOverview() {
    const sessions = this.sessionsState.sessionsResult?.sessions ?? [];
    const channels = flattenChannelAccounts(this.channelsState.channelsSnapshot);
    const approvalsPath = this.execApprovalsState.execApprovalsSnapshot?.path ?? "not loaded";
    return html`
      <section class="cp-page cp-page--overview">
        ${this.renderPageHeader("overview", this.renderMetric("Approvals", approvalsPath))}
        <div class="cp-stage cp-stage--overview">
          <div class="cp-stage__main">
            <section class="cp-band">
              ${this.renderMetric(
                "Healthy",
                this.healthState.healthResult?.ok ? "yes" : "no",
                `${this.healthState.healthResult?.agents.length ?? 0} agents`,
              )}
              ${this.renderMetric(
                "Recent sessions",
                String(this.healthState.healthResult?.sessions.count ?? 0),
                this.healthState.healthResult?.sessions.path ?? "session store",
              )}
              ${this.renderMetric(
                "Channel accounts",
                String(channels.length),
                `${this.channelsState.channelsSnapshot?.channelOrder.length ?? 0} surfaces`,
              )}
              ${this.renderMetric(
                "Presence clients",
                String(this.systemPresence.length),
                this.connected ? "live" : "offline",
              )}
            </section>

            <section class="cp-grid cp-grid--double">
              <article class="cp-panel">
                <div class="cp-panel__head">
                  <div>
                    <span class="cp-kicker">Runtime</span>
                    <h3>System heartbeat</h3>
                  </div>
                  <button class="cp-button" @click=${() => void this.refreshSystemOverview()}>
                    Refresh
                  </button>
                </div>
                <div class="cp-meta-list">
                  <div>
                    <span>Status summary</span
                    ><strong
                      >${readString(
                        this.systemStatus && JSON.stringify(this.systemStatus).slice(0, 80),
                        "pending",
                      )}</strong
                    >
                  </div>
                  <div>
                    <span>Heartbeat</span><strong>${formatJson(this.systemHeartbeat)}</strong>
                  </div>
                  <div>
                    <span>Last close</span><strong>${this.reconnectReason ?? "none"}</strong>
                  </div>
                  <div><span>Error</span><strong>${this.lastError ?? "none"}</strong></div>
                </div>
              </article>

              <article class="cp-panel">
                <div class="cp-panel__head">
                  <div>
                    <span class="cp-kicker">Control surface</span>
                    <h3>High-value tasks</h3>
                  </div>
                </div>
                <div class="cp-action-stack">
                  <button class="cp-action-card" @click=${() => this.navigate("sessions")}>
                    <span>Open sessions & chat</span>
                    <small>${sessions.length} tracked sessions</small>
                  </button>
                  <button class="cp-action-card" @click=${() => this.navigate("config")}>
                    <span>Review config & approvals</span>
                    <small>${this.configState.configSnapshot?.path ?? "manifest workbench"}</small>
                  </button>
                  <button class="cp-action-card" @click=${() => this.navigate("workflows")}>
                    <span>Inspect workflow deployments</span>
                    <small>${this.workflowsState.workflowsList.length} workflow definitions</small>
                  </button>
                </div>
              </article>
            </section>

            <article class="cp-panel">
              <div class="cp-panel__head">
                <div>
                  <span class="cp-kicker">Recent operator surface</span>
                  <h3>Hot sessions</h3>
                </div>
              </div>
              <div class="cp-table-wrap">
                <table class="cp-table">
                  <thead>
                    <tr>
                      <th>Session</th>
                      <th>Kind</th>
                      <th>Status</th>
                      <th>Updated</th>
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
                          <td>${session.status ?? "idle"}</td>
                          <td>${formatAgo(session.updatedAt)}</td>
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
                  <span class="cp-kicker">Presence rail</span>
                  <h3>Connected clients</h3>
                </div>
              </div>
              <div class="cp-list">
                ${this.systemPresence.length
                  ? repeat(
                      this.systemPresence,
                      (_, index) => index,
                      (entry) => html`
                        <div class="cp-list-item">
                          <strong>${entry.instanceId ?? entry.host ?? "control-ui"}</strong>
                          <small>${entry.text ?? entry.mode ?? "operator"}</small>
                        </div>
                      `,
                    )
                  : html`<p class="cp-empty">No live presence entries were returned.</p>`}
              </div>
            </article>
            ${!this.connected ? this.renderConnectionWorkbench() : nothing}
          </aside>
        </div>
      </section>
    `;
  }

  private renderSessions() {
    const sessions = this.sessionsState.sessionsResult?.sessions ?? [];
    const selected = sessions.find((entry) => entry.key === this.settings.sessionKey) ?? null;
    return html`
      <section class="cp-page cp-page--sessions">
        ${this.renderPageHeader(
          "sessions",
          this.renderMetric("Focused session", this.settings.sessionKey),
        )}
        <div class="cp-stage cp-stage--three">
          <aside class="cp-stage__rail cp-stage__rail--wide">
            <article class="cp-panel cp-panel--fill">
              <div class="cp-panel__head">
                <div>
                  <span class="cp-kicker">Registry rail</span>
                  <h3>Session inventory</h3>
                </div>
                <button
                  class="cp-button"
                  @click=${() =>
                    void this.safeCall(async () => {
                      await loadSessions(this.sessionsState, { limit: 60 });
                    })}
                >
                  Reload
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
                            >${session.status ?? "idle"} · ${formatAgo(session.updatedAt)}</small
                          >
                        </button>
                      `,
                    )
                  : html`<p class="cp-empty">No sessions returned by the gateway.</p>`}
              </div>
            </article>
          </aside>

          <main class="cp-stage__main">
            <article class="cp-panel cp-panel--fill">
              <div class="cp-panel__head">
                <div>
                  <span class="cp-kicker">Conversation thread</span>
                  <h3>Sessions & chat console</h3>
                </div>
                <div class="cp-inline-actions">
                  <button
                    class="cp-button"
                    @click=${() =>
                      void this.safeCall(async () => {
                        await loadChatHistory(this.chatState);
                      })}
                  >
                    Refresh history
                  </button>
                  <button
                    class="cp-button cp-button--danger"
                    @click=${() => void this.handleAbortRun()}
                  >
                    Abort run
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
                          <small>streaming</small>
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
                  placeholder="Send a session-scoped operator message..."
                  @input=${(event: Event) => {
                    this.chatState.chatMessage = (event.target as HTMLTextAreaElement).value;
                    this.requestUpdate();
                  }}
                ></textarea>
                <div class="cp-form__actions">
                  <button class="cp-button cp-button--primary" type="submit">Send</button>
                </div>
              </form>
            </article>
          </main>

          <aside class="cp-stage__rail">
            <article class="cp-panel cp-panel--fill">
              <div class="cp-panel__head">
                <div>
                  <span class="cp-kicker">Inspector</span>
                  <h3>Current session context</h3>
                </div>
              </div>
              ${selected
                ? html`
                    <div class="cp-meta-list">
                      <div><span>Key</span><strong>${selected.key}</strong></div>
                      <div><span>Kind</span><strong>${selected.kind}</strong></div>
                      <div><span>Status</span><strong>${selected.status ?? "idle"}</strong></div>
                      <div>
                        <span>Provider</span><strong>${selected.modelProvider ?? "auto"}</strong>
                      </div>
                      <div><span>Model</span><strong>${selected.model ?? "default"}</strong></div>
                      <div><span>Tokens</span><strong>${selected.totalTokens ?? 0}</strong></div>
                    </div>
                  `
                : html`<p class="cp-empty">Select a session to inspect.</p>`}
            </article>
          </aside>
        </div>
      </section>
    `;
  }

  private renderChannels() {
    const flattenedAccounts = flattenChannelAccounts(this.channelsState.channelsSnapshot);
    return html`
      <section class="cp-page">
        ${this.renderPageHeader(
          "channels",
          this.renderMetric("Accounts", String(flattenedAccounts.length)),
        )}
        <div class="cp-stage cp-stage--overview">
          <div class="cp-stage__main">
            <section class="cp-band">
              ${this.renderMetric(
                "Enabled surfaces",
                String(this.channelsState.channelsSnapshot?.channelOrder.length ?? 0),
              )}
              ${this.renderMetric(
                "Feishu CLI",
                this.channelsState.feishuCliSupported ? "available" : "hidden",
                this.channelsState.feishuCliStatus?.status ?? "n/a",
              )}
              ${this.renderMetric(
                "WhatsApp login",
                this.client?.hasCapability("channels.login") ? "supported" : "not exposed",
              )}
            </section>
            <article class="cp-panel">
              <div class="cp-panel__head">
                <div>
                  <span class="cp-kicker">Accounts & probes</span>
                  <h3>Channel inventory</h3>
                </div>
                <button
                  class="cp-button"
                  @click=${() =>
                    void this.safeCall(async () => {
                      await loadChannels(this.channelsState, true);
                    })}
                >
                  Probe again
                </button>
              </div>
              <div class="cp-table-wrap">
                <table class="cp-table">
                  <thead>
                    <tr>
                      <th>Surface</th>
                      <th>Account</th>
                      <th>Running</th>
                      <th>Connected</th>
                      <th>Last error</th>
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
                          <td>${entry.account.running ? "yes" : "no"}</td>
                          <td>${entry.account.connected ? "yes" : "no"}</td>
                          <td>${entry.account.lastError ?? "none"}</td>
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
                  <span class="cp-kicker">Optional flow</span>
                  <h3>WhatsApp login</h3>
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
                  Start
                </button>
                <button
                  class="cp-button"
                  @click=${() =>
                    void this.safeCall(async () => {
                      await waitWhatsAppLogin(this.channelsState);
                    })}
                >
                  Wait
                </button>
                <button
                  class="cp-button cp-button--danger"
                  @click=${() =>
                    void this.safeCall(async () => {
                      await logoutWhatsApp(this.channelsState);
                    })}
                >
                  Logout
                </button>
              </div>
              <pre class="cp-code">
${this.channelsState.whatsappLoginMessage ?? "No active login flow."}</pre
              >
            </article>
          </aside>
        </div>
      </section>
    `;
  }

  private renderWorkflows() {
    const selectedWorkflow = this.workflowsState.workflowDetail?.workflow;
    const selectedExecution = this.workflowsState.workflowSelectedExecution;
    return html`
      <section class="cp-page">
        ${this.renderPageHeader(
          "workflows",
          this.renderMetric("Registry", String(this.workflowsState.workflowsList.length)),
        )}
        <div class="cp-stage cp-stage--two">
          <aside class="cp-stage__rail cp-stage__rail--wide">
            <article class="cp-panel cp-panel--fill">
              <div class="cp-panel__head">
                <div>
                  <span class="cp-kicker">Registry rail</span>
                  <h3>Workflow definitions</h3>
                </div>
                <button
                  class="cp-button"
                  @click=${() =>
                    void this.safeCall(async () => {
                      await loadWorkflows(this.workflowsState);
                    })}
                >
                  Reload
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
                        >${workflow.safeForAutoRun ? "auto-run" : "manual"} · ${workflow.runCount}
                        runs</small
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
                  <span class="cp-kicker">Deployment detail</span>
                  <h3>${selectedWorkflow?.name ?? "Select a workflow"}</h3>
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
                          Run
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
                          ${selectedWorkflow.enabled ? "Disable" : "Enable"}
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
                          Deploy
                        </button>
                      </div>
                    `
                  : nothing}
              </div>
              ${selectedWorkflow
                ? html`
                    <div class="cp-grid cp-grid--double">
                      <article class="cp-subpanel">
                        <h4>Registry detail</h4>
                        <div class="cp-meta-list">
                          <div><span>ID</span><strong>${selectedWorkflow.workflowId}</strong></div>
                          <div>
                            <span>Enabled</span
                            ><strong>${selectedWorkflow.enabled ? "yes" : "no"}</strong>
                          </div>
                          <div>
                            <span>Approval</span
                            ><strong
                              >${selectedWorkflow.requiresApproval
                                ? "required"
                                : "not required"}</strong
                            >
                          </div>
                          <div>
                            <span>Archived</span
                            ><strong>${selectedWorkflow.archivedAt ? "yes" : "no"}</strong>
                          </div>
                        </div>
                      </article>
                      <article class="cp-subpanel">
                        <h4>Current execution</h4>
                        <pre class="cp-code">
${selectedExecution ? formatJson(selectedExecution) : "No execution selected."}</pre
                        >
                      </article>
                    </div>
                    <article class="cp-subpanel">
                      <h4>Specification</h4>
                      <pre class="cp-code">
${formatJson(this.workflowsState.workflowDetail?.spec)}</pre
                      >
                    </article>
                  `
                : html`<p class="cp-empty">Choose a workflow from the rail.</p>`}
            </article>
          </main>
        </div>
      </section>
    `;
  }

  private renderAgents() {
    const agents = this.agentsState.agentsList?.agents ?? [];
    const selected = agents.find((agent) => agent.id === this.agentsState.agentsSelectedId) ?? null;
    return html`
      <section class="cp-page">
        ${this.renderPageHeader("agents", this.renderMetric("Registered", String(agents.length)))}
        <div class="cp-stage cp-stage--two">
          <aside class="cp-stage__rail cp-stage__rail--wide">
            <article class="cp-panel cp-panel--fill">
              <div class="cp-panel__head">
                <div>
                  <span class="cp-kicker">Registry rail</span>
                  <h3>Agent inventory</h3>
                </div>
                <button class="cp-button" @click=${() => void this.loadAgentsSurface()}>
                  Reload
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
                      <small>${agent.workspace ?? "workspace not reported"}</small>
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
                  <span class="cp-kicker">Introspection</span>
                  <h3>${selected?.name ?? "Agent detail"}</h3>
                </div>
              </div>
              ${selected
                ? html`
                    <div class="cp-grid cp-grid--double">
                      <article class="cp-subpanel">
                        <h4>Identity</h4>
                        <div class="cp-meta-list">
                          <div><span>ID</span><strong>${selected.id}</strong></div>
                          <div>
                            <span>Workspace</span><strong>${selected.workspace ?? "n/a"}</strong>
                          </div>
                          <div>
                            <span>Primary model</span
                            ><strong>${selected.model?.primary ?? "default"}</strong>
                          </div>
                        </div>
                      </article>
                      <article class="cp-subpanel">
                        <h4>Inspection snapshot</h4>
                        <pre class="cp-code">
${formatJson(this.agentsState.agentInspectionSnapshot)}</pre
                        >
                      </article>
                    </div>
                    <article class="cp-subpanel">
                      <h4>Tools catalog</h4>
                      <pre class="cp-code">${formatJson(this.agentsState.toolsCatalogResult)}</pre>
                    </article>
                    <article class="cp-subpanel">
                      <h4>Effective tools</h4>
                      <pre class="cp-code">
${formatJson(this.agentsState.toolsEffectiveResult)}</pre
                      >
                    </article>
                  `
                : html`<p class="cp-empty">
                    Select an agent to inspect tools and runtime metadata.
                  </p>`}
            </article>
          </main>
        </div>
      </section>
    `;
  }

  private renderUsage() {
    const sessions = this.usageState.usageResult?.sessions ?? [];
    return html`
      <section class="cp-page">
        ${this.renderPageHeader(
          "usage",
          this.renderMetric(
            "Cost",
            `$${readUsageCost(this.usageState.usageCostSummary).toFixed(2)}`,
          ),
        )}
        <div class="cp-stage cp-stage--two">
          <aside class="cp-stage__rail cp-stage__rail--wide">
            <article class="cp-panel cp-panel--fill">
              <div class="cp-panel__head">
                <div>
                  <span class="cp-kicker">Query rail</span>
                  <h3>Usage window</h3>
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
                  <span>Start date</span>
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
                  <span>End date</span>
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
                  <button class="cp-button cp-button--primary" type="submit">Refresh usage</button>
                </div>
              </form>
              <pre class="cp-code">${formatJson(this.usageState.usageCostSummary?.totals)}</pre>
            </article>
          </aside>
          <main class="cp-stage__main">
            <article class="cp-panel">
              <div class="cp-panel__head">
                <div>
                  <span class="cp-kicker">Session cost map</span>
                  <h3>Usage sessions</h3>
                </div>
              </div>
              <div class="cp-table-wrap">
                <table class="cp-table">
                  <thead>
                    <tr>
                      <th>Session</th>
                      <th>Provider</th>
                      <th>Model</th>
                      <th>Updated</th>
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
                          <td>${session.modelProvider ?? "n/a"}</td>
                          <td>${session.model ?? "n/a"}</td>
                          <td>${formatDateTime(session.updatedAt)}</td>
                        </tr>
                      `,
                    )}
                  </tbody>
                </table>
              </div>
            </article>
            <section class="cp-grid cp-grid--double">
              <article class="cp-subpanel">
                <h4>Time series</h4>
                <pre class="cp-code">${formatJson(this.usageState.usageTimeSeries)}</pre>
              </article>
              <article class="cp-subpanel">
                <h4>Usage logs</h4>
                <pre class="cp-code">${formatJson(this.usageState.usageSessionLogs)}</pre>
              </article>
            </section>
          </main>
        </div>
      </section>
    `;
  }

  private renderConfig() {
    const snapshot = this.configState.configSnapshot;
    return html`
      <section class="cp-page">
        ${this.renderPageHeader(
          "config",
          this.renderMetric("Schema", this.configState.configSchemaVersion ?? "n/a"),
        )}
        <div class="cp-stage cp-stage--two">
          <aside class="cp-stage__rail cp-stage__rail--wide">
            <article class="cp-panel">
              <div class="cp-panel__head">
                <div>
                  <span class="cp-kicker">Manifest rail</span>
                  <h3>Config runtime parity</h3>
                </div>
              </div>
              <div class="cp-meta-list">
                <div><span>Path</span><strong>${snapshot?.path ?? "n/a"}</strong></div>
                <div><span>Hash</span><strong>${snapshot?.hash ?? "n/a"}</strong></div>
                <div>
                  <span>Valid</span><strong>${snapshot?.valid === false ? "no" : "yes"}</strong>
                </div>
                <div>
                  <span>Apply session</span><strong>${this.configState.applySessionKey}</strong>
                </div>
              </div>
            </article>
            <article class="cp-panel">
              <div class="cp-panel__head">
                <div>
                  <span class="cp-kicker">Approvals rail</span>
                  <h3>Execution policy</h3>
                </div>
              </div>
              <div class="cp-meta-list">
                <div>
                  <span>File</span>
                  <strong
                    >${this.execApprovalsState.execApprovalsSnapshot?.path ?? "not loaded"}</strong
                  >
                </div>
                <div>
                  <span>Dirty</span>
                  <strong>${this.execApprovalsState.execApprovalsDirty ? "yes" : "no"}</strong>
                </div>
              </div>
            </article>
          </aside>
          <main class="cp-stage__main">
            <section class="cp-grid cp-grid--double">
              <article class="cp-panel cp-panel--fill">
                <div class="cp-panel__head">
                  <div>
                    <span class="cp-kicker">Manifest workbench</span>
                    <h3>Config raw editor</h3>
                  </div>
                  <div class="cp-inline-actions">
                    <button class="cp-button" @click=${() => void this.handleSaveConfig()}>
                      Save
                    </button>
                    <button
                      class="cp-button cp-button--primary"
                      @click=${() => void this.handleApplyConfig()}
                    >
                      Apply
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
                    <span class="cp-kicker">Approval workbench</span>
                    <h3>Exec approvals raw editor</h3>
                  </div>
                  <button
                    class="cp-button cp-button--primary"
                    @click=${() => void this.handleSaveApprovals()}
                  >
                    Save approvals
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
                <h4>Config issues</h4>
                <pre class="cp-code">${formatJson(this.configState.configIssues)}</pre>
              </article>
              <article class="cp-subpanel">
                <h4>Approval snapshot</h4>
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
    const methodList = this.hello?.features?.methods ?? [];
    return html`
      <section class="cp-page">
        ${this.renderPageHeader("debug", this.renderMetric("Methods", String(methodList.length)))}
        <div class="cp-stage cp-stage--two">
          <aside class="cp-stage__rail cp-stage__rail--wide">
            <article class="cp-panel cp-panel--fill">
              <div class="cp-panel__head">
                <div>
                  <span class="cp-kicker">Method surface</span>
                  <h3>Advertised methods</h3>
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
                      <small>${method.startsWith("system.") ? "preferred name" : "surface"}</small>
                    </button>
                  `,
                )}
              </div>
            </article>
          </aside>
          <main class="cp-stage__main">
            <section class="cp-grid cp-grid--double">
              <article class="cp-subpanel">
                <h4>Status snapshot</h4>
                <pre class="cp-code">${formatJson(this.debugState.debugStatus)}</pre>
              </article>
              <article class="cp-subpanel">
                <h4>Health snapshot</h4>
                <pre class="cp-code">${formatJson(this.debugState.debugHealth)}</pre>
              </article>
            </section>
            <article class="cp-panel">
              <div class="cp-panel__head">
                <div>
                  <span class="cp-kicker">Manual RPC</span>
                  <h3>Raw request workbench</h3>
                </div>
                <button
                  class="cp-button cp-button--primary"
                  @click=${() =>
                    void this.safeCall(async () => {
                      await callDebugMethod(this.debugState);
                    })}
                >
                  Execute
                </button>
              </div>
              <div class="cp-form cp-form--rpc">
                <label>
                  <span>Method</span>
                  <input
                    .value=${this.debugState.debugCallMethod}
                    @input=${(event: Event) => {
                      this.debugState.debugCallMethod = (event.target as HTMLInputElement).value;
                      this.requestUpdate();
                    }}
                  />
                </label>
                <label>
                  <span>Params</span>
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
${this.debugState.debugCallError ??
                this.debugState.debugCallResult ??
                "No request executed yet."}</pre
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
    const activeMeta = metaForPage(this.tab);
    return html`
      <div class="cp-shell ${this.onboarding ? "cp-shell--onboarding" : ""}">
        <aside class="cp-nav ${this.sidebarCollapsed ? "is-collapsed" : ""}">
          <div class="cp-nav__brand">
            <span class="cp-nav__logo">CC</span>
            <div class="cp-nav__copy">
              <strong>CrawClaw</strong>
              <small>control plane</small>
            </div>
          </div>
          <nav class="cp-nav__stack">
            ${repeat(
              CONTROL_PAGES,
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
              ${this.sidebarCollapsed ? "Expand rail" : "Collapse rail"}
            </button>
          </div>
        </aside>

        <div class="cp-main">
          <header class="cp-topbar">
            <div class="cp-topbar__copy">
              <span class="cp-topbar__eyebrow">${activeMeta.eyebrow}</span>
              <strong>${activeMeta.label}</strong>
              <small>${readString(this.hello?.server?.version, "gateway pending")}</small>
            </div>
            <div class="cp-topbar__actions">
              ${this.renderConnectionBadge()}
              <button class="cp-button" @click=${() => void this.refreshSystemOverview()}>
                Refresh
              </button>
              <button class="cp-button" @click=${() => void this.connectGateway()}>
                Reconnect
              </button>
            </div>
          </header>

          <main class="cp-content">
            ${this.lastError
              ? html`
                  <section class="cp-banner cp-banner--danger">
                    <strong>Gateway notice</strong>
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
