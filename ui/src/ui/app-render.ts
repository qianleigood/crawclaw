import { html, nothing } from "lit";
import {
  buildAgentMainSessionKey,
  parseAgentSessionKey,
  resolveAgentIdFromSessionKey,
} from "../../../src/routing/session-key.js";
import { t } from "../i18n/index.ts";
import { getSafeLocalStorage } from "../local-storage.ts";
import { refreshChatAvatar } from "./app-chat.ts";
import { renderUsageTab } from "./app-render-usage-tab.ts";
import {
  renderChatControls,
  renderChatMobileToggle,
  renderChatSessionSelect,
  renderTab,
  renderSidebarConnectionStatus,
  renderTopbarThemeModeToggle,
  renderUiModeToggle,
  switchChatSession,
} from "./app-render.helpers.ts";
import type { AppViewState } from "./app-view-state.ts";
import { loadAgentFileContent, loadAgentFiles, saveAgentFile } from "./controllers/agent-files.ts";
import { loadAgentIdentities, loadAgentIdentity } from "./controllers/agent-identity.ts";
import { loadAgentSkills } from "./controllers/agent-skills.ts";
import {
  loadAgentInspection,
  buildToolsEffectiveRequestKey,
  loadAgents,
  loadToolsCatalog,
  loadToolsEffective,
  resetAgentInspectionState,
  refreshVisibleToolsEffectiveForCurrentSession,
  saveAgentsConfig,
} from "./controllers/agents.ts";
import { loadChannels } from "./controllers/channels.ts";
import { loadChatHistory } from "./controllers/chat.ts";
import {
  applyConfig,
  ensureAgentConfigEntry,
  findAgentConfigEntryIndex,
  loadConfig,
  openConfigFile,
  runUpdate,
  saveConfig,
  updateConfigFormValue,
  removeConfigFormValue,
} from "./controllers/config.ts";
import {
  loadCronRuns,
  loadMoreCronJobs,
  loadMoreCronRuns,
  reloadCronJobs,
  toggleCronJob,
  runCronJob,
  removeCronJob,
  addCronJob,
  startCronEdit,
  startCronClone,
  cancelCronEdit,
  validateCronForm,
  hasCronFormErrors,
  normalizeCronFormState,
  getVisibleCronJobs,
  updateCronJobsFilter,
  updateCronRunsFilter,
} from "./controllers/cron.ts";
import { loadDebug, callDebugMethod } from "./controllers/debug.ts";
import {
  approveDevicePairing,
  loadDevices,
  rejectDevicePairing,
  revokeDeviceToken,
  rotateDeviceToken,
} from "./controllers/devices.ts";
import {
  loadExecApprovals,
  removeExecApprovalsFormValue,
  saveExecApprovals,
  updateExecApprovalsFormValue,
} from "./controllers/exec-approvals.ts";
import { loadLogs } from "./controllers/logs.ts";
import { loadNodes } from "./controllers/nodes.ts";
import { loadPresence } from "./controllers/presence.ts";
import { deleteSessionsAndRefresh, loadSessions, patchSession } from "./controllers/sessions.ts";
import {
  installSkill,
  loadSkills,
  saveSkillApiKey,
  updateSkillEdit,
  updateSkillEnabled,
} from "./controllers/skills.ts";
import {
  cancelWorkflowExecution,
  compareWorkflowVersion,
  deleteWorkflowDefinition,
  deployWorkflow,
  loadWorkflowDetail,
  loadWorkflows,
  republishWorkflow,
  resetWorkflowEditor,
  refreshWorkflowExecutionStatus,
  rollbackWorkflowVersion,
  resumeWorkflowExecution,
  runWorkflow,
  saveWorkflowDefinitionUpdate,
  setWorkflowArchived,
  setWorkflowEnabled,
} from "./controllers/workflows.ts";
import "./components/dashboard-header.ts";
import { buildExternalLinkRel, EXTERNAL_LINK_TARGET } from "./external-link.ts";
import { icons } from "./icons.ts";
import { normalizeBasePath, subtitleForTab, tabGroupsForMode, titleForTab } from "./navigation.ts";
import { agentLogoUrl } from "./views/agents-utils.ts";
import {
  resolveAgentConfig,
  resolveConfiguredCronModelSuggestions,
  resolveEffectiveModelFallbacks,
  resolveModelPrimary,
  sortLocaleStrings,
} from "./views/agents-utils.ts";
import { renderChat } from "./views/chat.ts";
import { renderCommandPalette } from "./views/command-palette.ts";
import { renderConfig } from "./views/config.ts";
import { renderExecApprovalPrompt } from "./views/exec-approval.ts";
import { renderGatewayUrlConfirmation } from "./views/gateway-url-confirmation.ts";
import { renderLoginGate } from "./views/login-gate.ts";
import { renderOverview } from "./views/overview.ts";

// Lazy-loaded view modules – deferred so the initial bundle stays small.
// Each loader resolves once; subsequent calls return the cached module.
type LazyState<T> = { mod: T | null; promise: Promise<T> | null };

let _pendingUpdate: (() => void) | undefined;

function createLazy<T>(loader: () => Promise<T>): () => T | null {
  const s: LazyState<T> = { mod: null, promise: null };
  return () => {
    if (s.mod) {
      return s.mod;
    }
    if (!s.promise) {
      s.promise = loader().then((m) => {
        s.mod = m;
        _pendingUpdate?.();
        return m;
      });
    }
    return null;
  };
}

const lazyAgents = createLazy(() => import("./views/agents.ts"));
const lazyChannels = createLazy(() => import("./views/channels.ts"));
const lazyCron = createLazy(() => import("./views/cron.ts"));
const lazyDebug = createLazy(() => import("./views/debug.ts"));
const lazyInstances = createLazy(() => import("./views/instances.ts"));
const lazyLogs = createLazy(() => import("./views/logs.ts"));
const lazyNodes = createLazy(() => import("./views/nodes.ts"));
const lazySessions = createLazy(() => import("./views/sessions.ts"));
const lazySkills = createLazy(() => import("./views/skills.ts"));
const lazyWorkflows = createLazy(() => import("./views/workflows.ts"));

function lazyRender<M>(getter: () => M | null, render: (mod: M) => unknown) {
  const mod = getter();
  return mod ? render(mod) : nothing;
}

const UPDATE_BANNER_DISMISS_KEY = "crawclaw:control-ui:update-banner-dismissed:v1";
const CRON_THINKING_SUGGESTIONS = ["off", "minimal", "low", "medium", "high"];
const CRON_TIMEZONE_SUGGESTIONS = [
  "UTC",
  "America/Los_Angeles",
  "America/Denver",
  "America/Chicago",
  "America/New_York",
  "Europe/London",
  "Europe/Berlin",
  "Asia/Tokyo",
];

function isHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value.trim());
}

function normalizeSuggestionValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function uniquePreserveOrder(values: string[]): string[] {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const value of values) {
    const normalized = value.trim();
    if (!normalized) {
      continue;
    }
    const key = normalized.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    output.push(normalized);
  }
  return output;
}

type DismissedUpdateBanner = {
  latestVersion: string;
  channel: string | null;
  dismissedAtMs: number;
};

function loadDismissedUpdateBanner(): DismissedUpdateBanner | null {
  try {
    const raw = getSafeLocalStorage()?.getItem(UPDATE_BANNER_DISMISS_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as Partial<DismissedUpdateBanner>;
    if (!parsed || typeof parsed.latestVersion !== "string") {
      return null;
    }
    return {
      latestVersion: parsed.latestVersion,
      channel: typeof parsed.channel === "string" ? parsed.channel : null,
      dismissedAtMs: typeof parsed.dismissedAtMs === "number" ? parsed.dismissedAtMs : Date.now(),
    };
  } catch {
    return null;
  }
}

function isUpdateBannerDismissed(updateAvailable: unknown): boolean {
  const dismissed = loadDismissedUpdateBanner();
  if (!dismissed) {
    return false;
  }
  const info = updateAvailable as { latestVersion?: unknown; channel?: unknown };
  const latestVersion = info && typeof info.latestVersion === "string" ? info.latestVersion : null;
  const channel = info && typeof info.channel === "string" ? info.channel : null;
  return Boolean(
    latestVersion && dismissed.latestVersion === latestVersion && dismissed.channel === channel,
  );
}

function dismissUpdateBanner(updateAvailable: unknown) {
  const info = updateAvailable as { latestVersion?: unknown; channel?: unknown };
  const latestVersion = info && typeof info.latestVersion === "string" ? info.latestVersion : null;
  if (!latestVersion) {
    return;
  }
  const channel = info && typeof info.channel === "string" ? info.channel : null;
  const payload: DismissedUpdateBanner = {
    latestVersion,
    channel,
    dismissedAtMs: Date.now(),
  };
  try {
    getSafeLocalStorage()?.setItem(UPDATE_BANNER_DISMISS_KEY, JSON.stringify(payload));
  } catch {
    // ignore
  }
}

const AVATAR_DATA_RE = /^data:/i;
const AVATAR_HTTP_RE = /^https?:\/\//i;
const BASIC_SECTION_KEYS = [
  "env",
  "update",
  "meta",
  "gateway",
  "web",
  "__appearance__",
  "ui",
  "wizard",
] as const;
const CHANNELS_AND_ACCOUNTS_SECTION_KEYS = [
  "auth",
  "channels",
  "messages",
  "broadcast",
  "talk",
  "audio",
  "secrets",
] as const;
const MEMORY_AND_PRIVACY_SECTION_KEYS = ["memory", "session", "logging", "diagnostics"] as const;
const SKILLS_AND_TOOLS_SECTION_KEYS = [
  "skills",
  "tools",
  "commands",
  "hooks",
  "bindings",
  "approvals",
  "plugins",
] as const;
const ADVANCED_SECTION_KEYS = [
  "cron",
  "browser",
  "nodeHost",
  "canvasHost",
  "discovery",
  "media",
  "acp",
  "mcp",
] as const;
const MODELS_AND_AGENTS_SECTION_KEYS = ["agents", "models"] as const;
type ChannelsAndAccountsSectionKey = (typeof CHANNELS_AND_ACCOUNTS_SECTION_KEYS)[number];
type MemoryAndPrivacySectionKey = (typeof MEMORY_AND_PRIVACY_SECTION_KEYS)[number];
type SkillsAndToolsSectionKey = (typeof SKILLS_AND_TOOLS_SECTION_KEYS)[number];
type AdvancedSectionKey = (typeof ADVANCED_SECTION_KEYS)[number];
type ModelsAndAgentsSectionKey = (typeof MODELS_AND_AGENTS_SECTION_KEYS)[number];

function resolveAssistantAvatarUrl(state: AppViewState): string | undefined {
  const list = state.agentsList?.agents ?? [];
  const parsed = parseAgentSessionKey(state.sessionKey);
  const agentId = parsed?.agentId ?? state.agentsList?.defaultId ?? "main";
  const agent = list.find((entry) => entry.id === agentId);
  const identity = agent?.identity;
  const candidate = identity?.avatarUrl ?? identity?.avatar;
  if (!candidate) {
    return undefined;
  }
  if (AVATAR_DATA_RE.test(candidate) || AVATAR_HTTP_RE.test(candidate)) {
    return candidate;
  }
  return identity?.avatarUrl;
}

export function renderApp(state: AppViewState) {
  const updatableState = state as AppViewState & { requestUpdate?: () => void };
  const requestHostUpdate =
    typeof updatableState.requestUpdate === "function"
      ? () => updatableState.requestUpdate?.()
      : undefined;
  _pendingUpdate = requestHostUpdate;

  // Gate: require successful gateway connection before showing the dashboard.
  // The gateway URL confirmation overlay is always rendered so URL-param flows still work.
  if (!state.connected) {
    return html` ${renderLoginGate(state)} ${renderGatewayUrlConfirmation(state)} `;
  }

  const presenceCount = state.presenceEntries.length;
  const sessionsCount = state.sessionsResult?.count ?? null;
  const cronNext = state.cronStatus?.nextWakeAtMs ?? null;
  const chatDisabledReason = state.connected ? null : t("chat.disconnected");
  const isChat = state.tab === "chat";
  const chatFocus = isChat && (state.settings.chatFocusMode || state.onboarding);
  const navDrawerOpen = state.navDrawerOpen && !chatFocus && !state.onboarding;
  const navCollapsed = state.settings.navCollapsed && !navDrawerOpen;
  const showThinking = state.onboarding ? false : state.settings.chatShowThinking;
  const showToolCalls = state.onboarding ? true : state.settings.chatShowToolCalls;
  const uiMode = state.settings.uiMode === "advanced" ? "advanced" : "simple";
  const navGroups = tabGroupsForMode(uiMode);
  const currentNavGroup = navGroups.find((group) => group.tabs.includes(state.tab));
  const currentNavGroupLabel = currentNavGroup
    ? t(`nav.${currentNavGroup.label}`)
    : t("nav.platform");
  const assistantAvatarUrl = resolveAssistantAvatarUrl(state);
  const chatAvatarUrl = state.chatAvatarUrl ?? assistantAvatarUrl ?? null;
  const configValue =
    state.configForm ?? (state.configSnapshot?.config as Record<string, unknown> | null);
  const basePath = normalizeBasePath(state.basePath ?? "");
  const resolvedAgentId =
    state.agentsSelectedId ??
    state.agentsList?.defaultId ??
    state.agentsList?.agents?.[0]?.id ??
    null;
  const activeSessionAgentId = resolveAgentIdFromSessionKey(state.sessionKey);
  const toolsPanelUsesActiveSession = Boolean(
    resolvedAgentId && activeSessionAgentId && resolvedAgentId === activeSessionAgentId,
  );
  const getCurrentConfigValue = () =>
    state.configForm ?? (state.configSnapshot?.config as Record<string, unknown> | null);
  const findAgentIndex = (agentId: string) =>
    findAgentConfigEntryIndex(getCurrentConfigValue(), agentId);
  const ensureAgentIndex = (agentId: string) => ensureAgentConfigEntry(state, agentId);
  const cronAgentSuggestions = sortLocaleStrings(
    new Set(
      [
        ...(state.agentsList?.agents?.map((entry) => entry.id.trim()) ?? []),
        ...state.cronJobs
          .map((job) => (typeof job.agentId === "string" ? job.agentId.trim() : ""))
          .filter(Boolean),
      ].filter(Boolean),
    ),
  );
  const cronModelSuggestions = sortLocaleStrings(
    new Set(
      [
        ...state.cronModelSuggestions,
        ...resolveConfiguredCronModelSuggestions(configValue),
        ...state.cronJobs
          .map((job) => {
            if (job.payload.kind !== "agentTurn" || typeof job.payload.model !== "string") {
              return "";
            }
            return job.payload.model.trim();
          })
          .filter(Boolean),
      ].filter(Boolean),
    ),
  );
  const visibleCronJobs = getVisibleCronJobs(state);
  const selectedDeliveryChannel =
    state.cronForm.deliveryChannel && state.cronForm.deliveryChannel.trim()
      ? state.cronForm.deliveryChannel.trim()
      : "last";
  const jobToSuggestions = state.cronJobs
    .map((job) => normalizeSuggestionValue(job.delivery?.to))
    .filter(Boolean);
  const accountToSuggestions = (
    selectedDeliveryChannel === "last"
      ? Object.values(state.channelsSnapshot?.channelAccounts ?? {}).flat()
      : (state.channelsSnapshot?.channelAccounts?.[selectedDeliveryChannel] ?? [])
  )
    .flatMap((account) => [
      normalizeSuggestionValue(account.accountId),
      normalizeSuggestionValue(account.name),
    ])
    .filter(Boolean);
  const rawDeliveryToSuggestions = uniquePreserveOrder([
    ...jobToSuggestions,
    ...accountToSuggestions,
  ]);
  const accountSuggestions = uniquePreserveOrder(accountToSuggestions);
  const deliveryToSuggestions =
    state.cronForm.deliveryMode === "webhook"
      ? rawDeliveryToSuggestions.filter((value) => isHttpUrl(value))
      : rawDeliveryToSuggestions;

  return html`
    ${renderCommandPalette({
      open: state.paletteOpen,
      query: state.paletteQuery,
      activeIndex: state.paletteActiveIndex,
      onToggle: () => {
        state.paletteOpen = !state.paletteOpen;
      },
      onQueryChange: (q) => {
        state.paletteQuery = q;
      },
      onActiveIndexChange: (i) => {
        state.paletteActiveIndex = i;
      },
      onNavigate: (tab) => {
        state.setTab(tab as import("./navigation.ts").Tab);
      },
      onSlashCommand: (cmd) => {
        state.setTab("chat" as import("./navigation.ts").Tab);
        state.chatMessage = cmd.endsWith(" ") ? cmd : `${cmd} `;
      },
    })}
    <div
      class="shell ${isChat ? "shell--chat" : ""} ${chatFocus
        ? "shell--chat-focus"
        : ""} ${navCollapsed ? "shell--nav-collapsed" : ""} ${navDrawerOpen
        ? "shell--nav-drawer-open"
        : ""} ${state.onboarding ? "shell--onboarding" : ""} ${uiMode === "simple"
        ? "shell--simple"
        : "shell--advanced"}"
    >
      <button
        type="button"
        class="shell-nav-backdrop"
        aria-label="${t("nav.collapse")}"
        @click=${() => {
          state.navDrawerOpen = false;
        }}
      ></button>
      <header class="topbar">
        <div class="topnav-shell">
          <button
            type="button"
            class="topbar-nav-toggle"
            @click=${() => {
              state.navDrawerOpen = !navDrawerOpen;
            }}
            title="${navDrawerOpen ? t("nav.collapse") : t("nav.expand")}"
            aria-label="${navDrawerOpen ? t("nav.collapse") : t("nav.expand")}"
            aria-expanded=${navDrawerOpen}
          >
            <span class="nav-collapse-toggle__icon" aria-hidden="true">${icons.menu}</span>
          </button>
          <div class="topnav-shell__content">
            <div class="topnav-shell__context">
              <span class="topnav-shell__eyebrow">${t("nav.platform")}</span>
              <span class="topnav-shell__route mono">/${state.tab}</span>
            </div>
            <dashboard-header .tab=${state.tab}></dashboard-header>
          </div>
          <div class="topnav-shell__actions">
            <button
              class="topbar-search"
              @click=${() => {
                state.paletteOpen = !state.paletteOpen;
              }}
              title=${t("shell.searchOrJump")}
              aria-label=${t("shell.openCommandPalette")}
            >
              <span class="topbar-search__label">${t("common.search")}</span>
              <kbd class="topbar-search__kbd">⌘K</kbd>
            </button>
            <div class="topbar-status">
              <div class="topbar-status__rack" aria-label="Runtime status">
                <span
                  class="topbar-status-pill ${state.connected
                    ? "topbar-status-pill--online"
                    : "topbar-status-pill--offline"}"
                >
                  <span class="topbar-status-pill__dot" aria-hidden="true"></span>
                  <span class="topbar-status-pill__label"
                    >${state.connected ? t("common.online") : t("common.offline")}</span
                  >
                </span>
                <span class="topbar-status-pill topbar-status-pill--surface">
                  <span class="topbar-status-pill__eyebrow">Surface</span>
                  <span class="topbar-status-pill__value">${titleForTab(state.tab)}</span>
                </span>
                <span class="topbar-status-pill topbar-status-pill--version">
                  <span class="topbar-status-pill__eyebrow">${t("common.version")}</span>
                  <span class="topbar-status-pill__value mono"
                    >${state.hello?.server?.version
                      ? `v${state.hello.server.version}`
                      : "n/a"}</span
                  >
                </span>
              </div>
              ${isChat ? renderChatMobileToggle(state) : nothing}
              ${renderUiModeToggle(state, { compact: true })} ${renderTopbarThemeModeToggle(state)}
            </div>
          </div>
        </div>
      </header>
      <div class="shell-nav">
        <aside class="sidebar ${navCollapsed ? "sidebar--collapsed" : ""}">
          <div class="sidebar-shell">
            <div class="sidebar-shell__header">
              <div class="sidebar-shell__header-main">
                <div class="sidebar-brand">
                  <img class="sidebar-brand__logo" src="${agentLogoUrl(basePath)}" alt="CrawClaw" />
                  ${navCollapsed
                    ? nothing
                    : html`
                        <span class="sidebar-brand__copy">
                          <span class="sidebar-brand__eyebrow">${t("nav.platform")}</span>
                          <span class="sidebar-brand__title">CrawClaw</span>
                        </span>
                      `}
                </div>
                ${navCollapsed
                  ? nothing
                  : html`
                      <div class="sidebar-shell__meta">
                        <span class="sidebar-shell__meta-label">${currentNavGroupLabel}</span>
                        <span class="sidebar-shell__meta-value">${titleForTab(state.tab)}</span>
                      </div>
                    `}
              </div>
              <button
                type="button"
                class="nav-collapse-toggle"
                @click=${() =>
                  state.applySettings({
                    ...state.settings,
                    navCollapsed: !state.settings.navCollapsed,
                  })}
                title="${navCollapsed ? t("nav.expand") : t("nav.collapse")}"
                aria-label="${navCollapsed ? t("nav.expand") : t("nav.collapse")}"
              >
                <span class="nav-collapse-toggle__icon" aria-hidden="true"
                  >${navCollapsed ? icons.panelLeftOpen : icons.panelLeftClose}</span
                >
              </button>
            </div>
            <div class="sidebar-shell__body">
              <nav class="sidebar-nav">
                ${navGroups.map((group) => {
                  const isGroupCollapsed = state.settings.navGroupsCollapsed[group.label] ?? false;
                  const hasActiveTab = group.tabs.some((tab) => tab === state.tab);
                  const showItems = navCollapsed || hasActiveTab || !isGroupCollapsed;
                  const showGroupLabel = group.showLabel !== false;

                  return html`
                    <section class="nav-section ${!showItems ? "nav-section--collapsed" : ""}">
                      ${!navCollapsed && showGroupLabel
                        ? html`
                            <button
                              class="nav-section__label"
                              @click=${() => {
                                const next = { ...state.settings.navGroupsCollapsed };
                                next[group.label] = !isGroupCollapsed;
                                state.applySettings({
                                  ...state.settings,
                                  navGroupsCollapsed: next,
                                });
                              }}
                              aria-expanded=${showItems}
                            >
                              <span class="nav-section__label-text"
                                >${t(`nav.${group.label}`)}</span
                              >
                              <span class="nav-section__chevron"> ${icons.chevronDown} </span>
                            </button>
                          `
                        : nothing}
                      <div class="nav-section__items">
                        ${group.tabs.map((tab) =>
                          renderTab(state, tab, { collapsed: navCollapsed }),
                        )}
                      </div>
                    </section>
                  `;
                })}
              </nav>
            </div>
            <div class="sidebar-shell__footer">
              <div class="sidebar-utility-group">
                <a
                  class="nav-item nav-item--external sidebar-utility-link"
                  href="https://docs.crawclaw.ai"
                  target=${EXTERNAL_LINK_TARGET}
                  rel=${buildExternalLinkRel()}
                  title="${t("common.docs")} (opens in new tab)"
                >
                  <span class="nav-item__icon" aria-hidden="true">${icons.book}</span>
                  ${!navCollapsed
                    ? html`
                        <span class="nav-item__text">${t("common.docs")}</span>
                        <span class="nav-item__external-icon">${icons.externalLink}</span>
                      `
                    : nothing}
                </a>
                <div class="sidebar-mode-switch">${renderUiModeToggle(state)}</div>
                <div class="sidebar-mode-switch">${renderTopbarThemeModeToggle(state)}</div>
                ${(() => {
                  const version = state.hello?.server?.version ?? "";
                  return version
                    ? html`
                        <div class="sidebar-version" title=${`v${version}`}>
                          ${!navCollapsed
                            ? html`
                                <span class="sidebar-version__label">${t("common.version")}</span>
                                <span class="sidebar-version__text">v${version}</span>
                                ${renderSidebarConnectionStatus(state)}
                              `
                            : html` ${renderSidebarConnectionStatus(state)} `}
                        </div>
                      `
                    : nothing;
                })()}
              </div>
            </div>
          </div>
        </aside>
      </div>
      <main class="content ${isChat ? "content--chat" : ""}">
        <div class="content-shell">
          ${state.updateAvailable &&
          state.updateAvailable.latestVersion !== state.updateAvailable.currentVersion &&
          !isUpdateBannerDismissed(state.updateAvailable)
            ? html`<div class="update-banner callout danger" role="alert">
                <strong>${t("shell.updateAvailable")}:</strong> v${state.updateAvailable
                  .latestVersion}
                (${t("shell.runningVersion", { version: state.updateAvailable.currentVersion })}).
                <button
                  class="btn btn--sm update-banner__btn"
                  ?disabled=${state.updateRunning || !state.connected}
                  @click=${() => runUpdate(state)}
                >
                  ${state.updateRunning ? t("shell.updating") : t("shell.updateNow")}
                </button>
                <button
                  class="update-banner__close"
                  type="button"
                  title=${t("shell.dismiss")}
                  aria-label=${t("shell.dismissUpdateBanner")}
                  @click=${() => {
                    dismissUpdateBanner(state.updateAvailable);
                    state.updateAvailable = null;
                  }}
                >
                  ${icons.x}
                </button>
              </div>`
            : nothing}
          <section class="content-header">
            <div class="content-header__main">
              <div class="content-header__eyebrow-row">
                <span class="content-header__eyebrow">${currentNavGroupLabel}</span>
                <span class="content-header__route mono">/${state.tab}</span>
              </div>
              ${isChat
                ? renderChatSessionSelect(state)
                : html`<div class="page-title">${titleForTab(state.tab)}</div>`}
              ${isChat ? nothing : html`<div class="page-sub">${subtitleForTab(state.tab)}</div>`}
            </div>
            <div class="page-meta content-header__meta">
              ${state.lastError ? html`<div class="pill danger">${state.lastError}</div>` : nothing}
              ${isChat ? renderChatControls(state) : nothing}
            </div>
          </section>
          <div class="content-stage content-stage--${state.tab}">
            ${state.tab === "overview"
              ? renderOverview({
                  uiMode,
                  onboarding: state.onboarding,
                  assistantName: state.assistantName,
                  connected: state.connected,
                  hello: state.hello,
                  settings: state.settings,
                  password: state.password,
                  lastError: state.lastError,
                  lastErrorCode: state.lastErrorCode,
                  presenceCount,
                  sessionsCount,
                  cronEnabled: state.cronStatus?.enabled ?? null,
                  cronNext,
                  lastChannelsRefresh: state.channelsLastSuccess,
                  feishuCliStatus: state.feishuCliStatus,
                  feishuCliLastSuccessAt: state.feishuCliLastSuccess,
                  feishuCliSupported: state.feishuCliSupported,
                  feishuCliError: state.feishuCliError,
                  usageResult: state.usageResult,
                  sessionsResult: state.sessionsResult,
                  skillsReport: state.skillsReport,
                  cronJobs: state.cronJobs,
                  cronStatus: state.cronStatus,
                  attentionItems: state.attentionItems,
                  eventLog: state.eventLog,
                  overviewLogLines: state.overviewLogLines,
                  showGatewayToken: state.overviewShowGatewayToken,
                  showGatewayPassword: state.overviewShowGatewayPassword,
                  onSettingsChange: (next) => state.applySettings(next),
                  onPasswordChange: (next) => (state.password = next),
                  onSessionKeyChange: (next) => {
                    state.sessionKey = next;
                    state.chatMessage = "";
                    state.resetToolStream();
                    state.applySettings({
                      ...state.settings,
                      sessionKey: next,
                      lastActiveSessionKey: next,
                    });
                    void state.loadAssistantIdentity();
                  },
                  onToggleGatewayTokenVisibility: () => {
                    state.overviewShowGatewayToken = !state.overviewShowGatewayToken;
                  },
                  onToggleGatewayPasswordVisibility: () => {
                    state.overviewShowGatewayPassword = !state.overviewShowGatewayPassword;
                  },
                  onConnect: () => state.connect(),
                  onRefresh: () => state.loadOverview(),
                  onNavigate: (tab) => state.setTab(tab as import("./navigation.ts").Tab),
                  onRefreshLogs: () => state.loadOverview(),
                  onboardingProgress: state.onboardingProgress,
                  onPauseOnboarding: () => state.pauseOnboarding(),
                  onResumeOnboarding: () => state.resumeOnboarding(),
                  onRestartOnboarding: () => state.restartOnboarding(),
                  onCompleteOnboarding: () => state.completeOnboarding(),
                })
              : nothing}
            ${state.tab === "channels"
              ? lazyRender(lazyChannels, (m) =>
                  m.renderChannels({
                    uiMode,
                    onboarding: state.onboarding,
                    onboardingProgress: state.onboardingProgress,
                    connected: state.connected,
                    gatewayUrl: state.settings.gatewayUrl,
                    loading: state.channelsLoading,
                    snapshot: state.channelsSnapshot,
                    lastError: state.channelsError,
                    lastSuccessAt: state.channelsLastSuccess,
                    feishuCliStatus: state.feishuCliStatus,
                    feishuCliError: state.feishuCliError,
                    feishuCliLastSuccessAt: state.feishuCliLastSuccess,
                    feishuCliSupported: state.feishuCliSupported,
                    whatsappMessage: state.whatsappLoginMessage,
                    whatsappQrDataUrl: state.whatsappLoginQrDataUrl,
                    whatsappConnected: state.whatsappLoginConnected,
                    whatsappBusy: state.whatsappBusy,
                    configSchema: state.configSchema,
                    configSchemaLoading: state.configSchemaLoading,
                    configForm: state.configForm,
                    configUiHints: state.configUiHints,
                    configSaving: state.configSaving,
                    configFormDirty: state.configFormDirty,
                    nostrProfileFormState: state.nostrProfileFormState,
                    nostrProfileAccountId: state.nostrProfileAccountId,
                    onNavigate: (tab) => state.setTab(tab as import("./navigation.ts").Tab),
                    onResumeOnboarding: () => state.resumeOnboarding(),
                    onRestartOnboarding: () => state.restartOnboarding(),
                    onRefresh: (probe) => loadChannels(state, probe),
                    onWhatsAppStart: (force) => state.handleWhatsAppStart(force),
                    onWhatsAppWait: () => state.handleWhatsAppWait(),
                    onWhatsAppLogout: () => state.handleWhatsAppLogout(),
                    onConfigPatch: (path, value) => updateConfigFormValue(state, path, value),
                    onConfigSave: () => state.handleChannelConfigSave(),
                    onConfigReload: () => state.handleChannelConfigReload(),
                    onNostrProfileEdit: (accountId, profile) =>
                      state.handleNostrProfileEdit(accountId, profile),
                    onNostrProfileCancel: () => state.handleNostrProfileCancel(),
                    onNostrProfileFieldChange: (field, value) =>
                      state.handleNostrProfileFieldChange(field, value),
                    onNostrProfileSave: () => state.handleNostrProfileSave(),
                    onNostrProfileImport: () => state.handleNostrProfileImport(),
                    onNostrProfileToggleAdvanced: () => state.handleNostrProfileToggleAdvanced(),
                  }),
                )
              : nothing}
            ${state.tab === "instances"
              ? lazyRender(lazyInstances, (m) =>
                  m.renderInstances({
                    loading: state.presenceLoading,
                    entries: state.presenceEntries,
                    lastError: state.presenceError,
                    statusMessage: state.presenceStatus,
                    onRefresh: () => loadPresence(state),
                  }),
                )
              : nothing}
            ${state.tab === "sessions"
              ? lazyRender(lazySessions, (m) =>
                  m.renderSessions({
                    loading: state.sessionsLoading,
                    result: state.sessionsResult,
                    error: state.sessionsError,
                    activeMinutes: state.sessionsFilterActive,
                    limit: state.sessionsFilterLimit,
                    includeGlobal: state.sessionsIncludeGlobal,
                    includeUnknown: state.sessionsIncludeUnknown,
                    basePath: state.basePath,
                    searchQuery: state.sessionsSearchQuery,
                    sortColumn: state.sessionsSortColumn,
                    sortDir: state.sessionsSortDir,
                    page: state.sessionsPage,
                    pageSize: state.sessionsPageSize,
                    selectedKeys: state.sessionsSelectedKeys,
                    onFiltersChange: (next) => {
                      state.sessionsFilterActive = next.activeMinutes;
                      state.sessionsFilterLimit = next.limit;
                      state.sessionsIncludeGlobal = next.includeGlobal;
                      state.sessionsIncludeUnknown = next.includeUnknown;
                    },
                    onSearchChange: (q) => {
                      state.sessionsSearchQuery = q;
                      state.sessionsPage = 0;
                    },
                    onSortChange: (col, dir) => {
                      state.sessionsSortColumn = col;
                      state.sessionsSortDir = dir;
                      state.sessionsPage = 0;
                    },
                    onPageChange: (p) => {
                      state.sessionsPage = p;
                    },
                    onPageSizeChange: (s) => {
                      state.sessionsPageSize = s;
                      state.sessionsPage = 0;
                    },
                    onRefresh: () => loadSessions(state),
                    onPatch: (key, patch) => patchSession(state, key, patch),
                    onToggleSelect: (key) => {
                      const next = new Set(state.sessionsSelectedKeys);
                      if (next.has(key)) {
                        next.delete(key);
                      } else {
                        next.add(key);
                      }
                      state.sessionsSelectedKeys = next;
                    },
                    onSelectPage: (keys) => {
                      const next = new Set(state.sessionsSelectedKeys);
                      for (const k of keys) {
                        next.add(k);
                      }
                      state.sessionsSelectedKeys = next;
                    },
                    onDeselectPage: (keys) => {
                      const next = new Set(state.sessionsSelectedKeys);
                      for (const k of keys) {
                        next.delete(k);
                      }
                      state.sessionsSelectedKeys = next;
                    },
                    onDeselectAll: () => {
                      state.sessionsSelectedKeys = new Set();
                    },
                    onDeleteSelected: async () => {
                      const keys = [...state.sessionsSelectedKeys];
                      const deleted = await deleteSessionsAndRefresh(state, keys);
                      if (deleted.length > 0) {
                        const next = new Set(state.sessionsSelectedKeys);
                        for (const k of deleted) {
                          next.delete(k);
                        }
                        state.sessionsSelectedKeys = next;
                      }
                    },
                    onNavigateToChat: (sessionKey) => {
                      switchChatSession(state, sessionKey);
                      state.setTab("chat" as import("./navigation.ts").Tab);
                    },
                    currentSessionKey: state.sessionKey,
                    currentRunId: state.chatRunId,
                    onInspectCurrentRun: () => {
                      state.agentsSelectedId = resolveAgentIdFromSessionKey(state.sessionKey);
                      state.agentsPanel = "inspect";
                      state.setTab("agents" as import("./navigation.ts").Tab);
                      if (state.chatRunId) {
                        void loadAgentInspection(state, { runId: state.chatRunId });
                      } else {
                        resetAgentInspectionState(state);
                      }
                    },
                  }),
                )
              : nothing}
            ${renderUsageTab(state)}
            ${state.tab === "cron"
              ? lazyRender(lazyCron, (m) =>
                  m.renderCron({
                    basePath: state.basePath,
                    loading: state.cronLoading,
                    status: state.cronStatus,
                    jobs: visibleCronJobs,
                    jobsLoadingMore: state.cronJobsLoadingMore,
                    jobsTotal: state.cronJobsTotal,
                    jobsHasMore: state.cronJobsHasMore,
                    jobsQuery: state.cronJobsQuery,
                    jobsEnabledFilter: state.cronJobsEnabledFilter,
                    jobsScheduleKindFilter: state.cronJobsScheduleKindFilter,
                    jobsLastStatusFilter: state.cronJobsLastStatusFilter,
                    jobsSortBy: state.cronJobsSortBy,
                    jobsSortDir: state.cronJobsSortDir,
                    editingJobId: state.cronEditingJobId,
                    error: state.cronError,
                    busy: state.cronBusy,
                    form: state.cronForm,
                    channels: state.channelsSnapshot?.channelMeta?.length
                      ? state.channelsSnapshot.channelMeta.map((entry) => entry.id)
                      : (state.channelsSnapshot?.channelOrder ?? []),
                    channelLabels: state.channelsSnapshot?.channelLabels ?? {},
                    channelMeta: state.channelsSnapshot?.channelMeta ?? [],
                    runsJobId: state.cronRunsJobId,
                    runs: state.cronRuns,
                    runsTotal: state.cronRunsTotal,
                    runsHasMore: state.cronRunsHasMore,
                    runsLoadingMore: state.cronRunsLoadingMore,
                    runsScope: state.cronRunsScope,
                    runsStatuses: state.cronRunsStatuses,
                    runsDeliveryStatuses: state.cronRunsDeliveryStatuses,
                    runsStatusFilter: state.cronRunsStatusFilter,
                    runsQuery: state.cronRunsQuery,
                    runsSortDir: state.cronRunsSortDir,
                    fieldErrors: state.cronFieldErrors,
                    canSubmit: !hasCronFormErrors(state.cronFieldErrors),
                    agentSuggestions: cronAgentSuggestions,
                    modelSuggestions: cronModelSuggestions,
                    thinkingSuggestions: CRON_THINKING_SUGGESTIONS,
                    timezoneSuggestions: CRON_TIMEZONE_SUGGESTIONS,
                    deliveryToSuggestions,
                    accountSuggestions,
                    onFormChange: (patch) => {
                      state.cronForm = normalizeCronFormState({ ...state.cronForm, ...patch });
                      state.cronFieldErrors = validateCronForm(state.cronForm);
                    },
                    onRefresh: () => state.loadCron(),
                    onAdd: () => addCronJob(state),
                    onEdit: (job) => startCronEdit(state, job),
                    onClone: (job) => startCronClone(state, job),
                    onCancelEdit: () => cancelCronEdit(state),
                    onToggle: (job, enabled) => toggleCronJob(state, job, enabled),
                    onRun: (job, mode) => runCronJob(state, job, mode ?? "force"),
                    onRemove: (job) => removeCronJob(state, job),
                    onLoadRuns: async (jobId) => {
                      updateCronRunsFilter(state, { cronRunsScope: "job" });
                      await loadCronRuns(state, jobId);
                    },
                    onLoadMoreJobs: () => loadMoreCronJobs(state),
                    onJobsFiltersChange: async (patch) => {
                      updateCronJobsFilter(state, patch);
                      const shouldReload =
                        typeof patch.cronJobsQuery === "string" ||
                        Boolean(patch.cronJobsEnabledFilter) ||
                        Boolean(patch.cronJobsSortBy) ||
                        Boolean(patch.cronJobsSortDir);
                      if (shouldReload) {
                        await reloadCronJobs(state);
                      }
                    },
                    onJobsFiltersReset: async () => {
                      updateCronJobsFilter(state, {
                        cronJobsQuery: "",
                        cronJobsEnabledFilter: "all",
                        cronJobsScheduleKindFilter: "all",
                        cronJobsLastStatusFilter: "all",
                        cronJobsSortBy: "nextRunAtMs",
                        cronJobsSortDir: "asc",
                      });
                      await reloadCronJobs(state);
                    },
                    onLoadMoreRuns: () => loadMoreCronRuns(state),
                    onRunsFiltersChange: async (patch) => {
                      updateCronRunsFilter(state, patch);
                      if (state.cronRunsScope === "all") {
                        await loadCronRuns(state, null);
                        return;
                      }
                      await loadCronRuns(state, state.cronRunsJobId);
                    },
                    onNavigateToChat: (sessionKey) => {
                      switchChatSession(state, sessionKey);
                      state.setTab("chat" as import("./navigation.ts").Tab);
                    },
                  }),
                )
              : nothing}
            ${state.tab === "workflows"
              ? lazyRender(lazyWorkflows, (m) =>
                  m.renderWorkflows({
                    connected: state.connected,
                    loading: state.workflowLoading,
                    error: state.workflowError,
                    detailLoading: state.workflowDetailLoading,
                    detailError: state.workflowDetailError,
                    runsLoading: state.workflowRunsLoading,
                    runsError: state.workflowRunsError,
                    statusLoading: state.workflowStatusLoading,
                    statusError: state.workflowStatusError,
                    workflows: state.workflowsList,
                    filterQuery: state.workflowFilterQuery,
                    filterState: state.workflowFilterState,
                    selectedWorkflowId: state.workflowSelectedId,
                    detail: state.workflowDetail,
                    runs: state.workflowRuns,
                    versionsLoading: state.workflowVersionsLoading,
                    versionsError: state.workflowVersionsError,
                    versions: state.workflowVersions,
                    diffLoading: state.workflowDiffLoading,
                    diffError: state.workflowDiffError,
                    diffSnapshot: state.workflowDiff,
                    editorDraft: state.workflowEditorDraft,
                    selectedExecutionId: state.workflowSelectedExecutionId,
                    selectedExecution: state.workflowSelectedExecution,
                    resumeDraft: state.workflowResumeDraft,
                    actionBusyKey: state.workflowActionBusyKey,
                    onRefresh: () => loadWorkflows(state),
                    onFilterQueryChange: (value) => {
                      state.workflowFilterQuery = value;
                    },
                    onFilterStateChange: (value) => {
                      state.workflowFilterState = value;
                    },
                    onSelectWorkflow: (workflowId) => {
                      state.workflowSelectedId = workflowId;
                      state.workflowResumeDraft = "";
                      void loadWorkflowDetail(state, workflowId);
                    },
                    onDeploy: (workflowId) => deployWorkflow(state, workflowId),
                    onRepublish: (workflowId) => republishWorkflow(state, workflowId),
                    onRun: (workflowId) => runWorkflow(state, workflowId),
                    onToggleEnabled: (workflowId, enabled) =>
                      setWorkflowEnabled(state, workflowId, enabled),
                    onSetArchived: (workflowId, archived) =>
                      setWorkflowArchived(state, workflowId, archived),
                    onDeleteWorkflow: (workflowId) => deleteWorkflowDefinition(state, workflowId),
                    onCompareVersion: (workflowId, specVersion) =>
                      compareWorkflowVersion(state, workflowId, specVersion),
                    onEditorChange: (patch) => {
                      state.workflowEditorDraft = {
                        ...(state.workflowEditorDraft ?? {
                          name: "",
                          goal: "",
                          description: "",
                          tags: "",
                          topology: "linear_v1",
                          safeForAutoRun: false,
                          requiresApproval: false,
                          inputsJson: "[]",
                          outputsJson: "[]",
                          stepsJson: "[]",
                        }),
                        ...patch,
                      };
                    },
                    onResetEditor: () => {
                      resetWorkflowEditor(state);
                    },
                    onSaveEditor: (workflowId) => saveWorkflowDefinitionUpdate(state, workflowId),
                    onRollbackVersion: (workflowId, specVersion, republish) =>
                      rollbackWorkflowVersion(state, workflowId, specVersion, republish),
                    onSelectExecution: (executionId) => {
                      state.workflowSelectedExecutionId = executionId;
                      state.workflowSelectedExecution =
                        state.workflowRuns.find((entry) => entry.executionId === executionId) ??
                        state.workflowDetail?.recentExecutions.find(
                          (entry) => entry.executionId === executionId,
                        ) ??
                        null;
                      state.workflowResumeDraft = "";
                    },
                    onRefreshExecution: (executionId) =>
                      refreshWorkflowExecutionStatus(state, executionId),
                    onCancelExecution: (executionId) => cancelWorkflowExecution(state, executionId),
                    onResumeDraftChange: (value) => {
                      state.workflowResumeDraft = value;
                    },
                    onResumeExecution: (executionId, input) =>
                      resumeWorkflowExecution(state, executionId, input),
                  }),
                )
              : nothing}
            ${state.tab === "agents"
              ? lazyRender(lazyAgents, (m) =>
                  m.renderAgents({
                    uiMode,
                    basePath: state.basePath ?? "",
                    loading: state.agentsLoading,
                    error: state.agentsError,
                    agentsList: state.agentsList,
                    selectedAgentId: resolvedAgentId,
                    activePanel: state.agentsPanel,
                    config: {
                      form: configValue,
                      loading: state.configLoading,
                      saving: state.configSaving,
                      dirty: state.configFormDirty,
                    },
                    channels: {
                      snapshot: state.channelsSnapshot,
                      loading: state.channelsLoading,
                      error: state.channelsError,
                      lastSuccess: state.channelsLastSuccess,
                    },
                    cron: {
                      status: state.cronStatus,
                      jobs: state.cronJobs,
                      loading: state.cronLoading,
                      error: state.cronError,
                    },
                    agentFiles: {
                      list: state.agentFilesList,
                      loading: state.agentFilesLoading,
                      error: state.agentFilesError,
                      active: state.agentFileActive,
                      contents: state.agentFileContents,
                      drafts: state.agentFileDrafts,
                      saving: state.agentFileSaving,
                    },
                    agentIdentityLoading: state.agentIdentityLoading,
                    agentIdentityError: state.agentIdentityError,
                    agentIdentityById: state.agentIdentityById,
                    agentSkills: {
                      report: state.agentSkillsReport,
                      loading: state.agentSkillsLoading,
                      error: state.agentSkillsError,
                      agentId: state.agentSkillsAgentId,
                      filter: state.skillsFilter,
                    },
                    toolsCatalog: {
                      loading: state.toolsCatalogLoading,
                      error: state.toolsCatalogError,
                      result: state.toolsCatalogResult,
                    },
                    toolsEffective: {
                      loading: state.toolsEffectiveLoading,
                      error: state.toolsEffectiveError,
                      result: state.toolsEffectiveResult,
                    },
                    inspect: {
                      loading: state.agentInspectionLoading,
                      error: state.agentInspectionError,
                      runId: state.agentInspectionRunId,
                      taskId: state.agentInspectionTaskId,
                      timelineFilter: state.agentInspectionTimelineFilter,
                      snapshot: state.agentInspectionSnapshot,
                    },
                    runtimeSessionKey: state.sessionKey,
                    runtimeSessionMatchesSelectedAgent: toolsPanelUsesActiveSession,
                    runtimeRunId: state.chatRunId,
                    modelCatalog: state.chatModelCatalog ?? [],
                    onRefresh: async () => {
                      await loadAgents(state);
                      const agentIds = state.agentsList?.agents?.map((entry) => entry.id) ?? [];
                      if (agentIds.length > 0) {
                        void loadAgentIdentities(state, agentIds);
                      }
                      const refreshedAgentId =
                        state.agentsSelectedId ??
                        state.agentsList?.defaultId ??
                        state.agentsList?.agents?.[0]?.id ??
                        null;
                      if (state.agentsPanel === "files" && refreshedAgentId) {
                        void loadAgentFiles(state, refreshedAgentId);
                      }
                      if (state.agentsPanel === "skills" && refreshedAgentId) {
                        void loadAgentSkills(state, refreshedAgentId);
                      }
                      if (state.agentsPanel === "tools" && refreshedAgentId) {
                        void loadToolsCatalog(state, refreshedAgentId);
                        if (refreshedAgentId === resolveAgentIdFromSessionKey(state.sessionKey)) {
                          void loadToolsEffective(state, {
                            agentId: refreshedAgentId,
                            sessionKey: state.sessionKey,
                          });
                        }
                      }
                      if (state.agentsPanel === "inspect") {
                        const activeSessionAgentId = resolveAgentIdFromSessionKey(state.sessionKey);
                        if (
                          refreshedAgentId &&
                          state.chatRunId &&
                          refreshedAgentId === activeSessionAgentId
                        ) {
                          void loadAgentInspection(state, { runId: state.chatRunId });
                        } else {
                          resetAgentInspectionState(state);
                        }
                      }
                      if (state.agentsPanel === "channels") {
                        void loadChannels(state, false);
                      }
                      if (state.agentsPanel === "cron") {
                        void state.loadCron();
                      }
                    },
                    onSelectAgent: (agentId) => {
                      if (state.agentsSelectedId === agentId) {
                        return;
                      }
                      state.agentsSelectedId = agentId;
                      state.agentFilesList = null;
                      state.agentFilesError = null;
                      state.agentFilesLoading = false;
                      state.agentFileActive = null;
                      state.agentFileContents = {};
                      state.agentFileDrafts = {};
                      state.agentSkillsReport = null;
                      state.agentSkillsError = null;
                      state.agentSkillsAgentId = null;
                      state.toolsCatalogResult = null;
                      state.toolsCatalogError = null;
                      state.toolsCatalogLoading = false;
                      state.toolsEffectiveResult = null;
                      state.toolsEffectiveResultKey = null;
                      state.toolsEffectiveError = null;
                      state.toolsEffectiveLoading = false;
                      state.toolsEffectiveLoadingKey = null;
                      resetAgentInspectionState(state);
                      void loadAgentIdentity(state, agentId);
                      if (state.agentsPanel === "files") {
                        void loadAgentFiles(state, agentId);
                      }
                      if (state.agentsPanel === "inspect") {
                        if (
                          agentId === resolveAgentIdFromSessionKey(state.sessionKey) &&
                          state.chatRunId
                        ) {
                          void loadAgentInspection(state, { runId: state.chatRunId });
                        }
                      }
                      if (state.agentsPanel === "tools") {
                        void loadToolsCatalog(state, agentId);
                        if (agentId === resolveAgentIdFromSessionKey(state.sessionKey)) {
                          void loadToolsEffective(state, {
                            agentId,
                            sessionKey: state.sessionKey,
                          });
                        }
                      }
                      if (state.agentsPanel === "skills") {
                        void loadAgentSkills(state, agentId);
                      }
                    },
                    onSelectPanel: (panel) => {
                      state.agentsPanel = panel;
                      if (panel === "files" && resolvedAgentId) {
                        if (state.agentFilesList?.agentId !== resolvedAgentId) {
                          state.agentFilesList = null;
                          state.agentFilesError = null;
                          state.agentFileActive = null;
                          state.agentFileContents = {};
                          state.agentFileDrafts = {};
                          void loadAgentFiles(state, resolvedAgentId);
                        }
                      }
                      if (panel === "skills") {
                        if (resolvedAgentId) {
                          void loadAgentSkills(state, resolvedAgentId);
                        }
                      }
                      if (panel === "inspect") {
                        if (
                          resolvedAgentId === resolveAgentIdFromSessionKey(state.sessionKey) &&
                          state.chatRunId
                        ) {
                          void loadAgentInspection(state, { runId: state.chatRunId });
                        } else {
                          resetAgentInspectionState(state);
                        }
                      }
                      if (panel === "tools" && resolvedAgentId) {
                        if (
                          state.toolsCatalogResult?.agentId !== resolvedAgentId ||
                          state.toolsCatalogError
                        ) {
                          void loadToolsCatalog(state, resolvedAgentId);
                        }
                        if (resolvedAgentId === resolveAgentIdFromSessionKey(state.sessionKey)) {
                          const toolsRequestKey = buildToolsEffectiveRequestKey(state, {
                            agentId: resolvedAgentId,
                            sessionKey: state.sessionKey,
                          });
                          if (
                            state.toolsEffectiveResultKey !== toolsRequestKey ||
                            state.toolsEffectiveError
                          ) {
                            void loadToolsEffective(state, {
                              agentId: resolvedAgentId,
                              sessionKey: state.sessionKey,
                            });
                          }
                        } else {
                          state.toolsEffectiveResult = null;
                          state.toolsEffectiveResultKey = null;
                          state.toolsEffectiveError = null;
                          state.toolsEffectiveLoading = false;
                          state.toolsEffectiveLoadingKey = null;
                        }
                      }
                      if (panel === "channels") {
                        void loadChannels(state, false);
                      }
                      if (panel === "cron") {
                        void state.loadCron();
                      }
                    },
                    onLoadFiles: (agentId) => loadAgentFiles(state, agentId),
                    onSelectFile: (name) => {
                      state.agentFileActive = name;
                      if (!resolvedAgentId) {
                        return;
                      }
                      void loadAgentFileContent(state, resolvedAgentId, name);
                    },
                    onFileDraftChange: (name, content) => {
                      state.agentFileDrafts = { ...state.agentFileDrafts, [name]: content };
                    },
                    onFileReset: (name) => {
                      const base = state.agentFileContents[name] ?? "";
                      state.agentFileDrafts = { ...state.agentFileDrafts, [name]: base };
                    },
                    onFileSave: (name) => {
                      if (!resolvedAgentId) {
                        return;
                      }
                      const content =
                        state.agentFileDrafts[name] ?? state.agentFileContents[name] ?? "";
                      void saveAgentFile(state, resolvedAgentId, name, content);
                    },
                    onToolsProfileChange: (agentId, profile, clearAllow) => {
                      const index =
                        profile || clearAllow ? ensureAgentIndex(agentId) : findAgentIndex(agentId);
                      if (index < 0) {
                        return;
                      }
                      const basePath = ["agents", "list", index, "tools"];
                      if (profile) {
                        updateConfigFormValue(state, [...basePath, "profile"], profile);
                      } else {
                        removeConfigFormValue(state, [...basePath, "profile"]);
                      }
                      if (clearAllow) {
                        removeConfigFormValue(state, [...basePath, "allow"]);
                      }
                    },
                    onToolsOverridesChange: (agentId, alsoAllow, deny) => {
                      const index =
                        alsoAllow.length > 0 || deny.length > 0
                          ? ensureAgentIndex(agentId)
                          : findAgentIndex(agentId);
                      if (index < 0) {
                        return;
                      }
                      const basePath = ["agents", "list", index, "tools"];
                      if (alsoAllow.length > 0) {
                        updateConfigFormValue(state, [...basePath, "alsoAllow"], alsoAllow);
                      } else {
                        removeConfigFormValue(state, [...basePath, "alsoAllow"]);
                      }
                      if (deny.length > 0) {
                        updateConfigFormValue(state, [...basePath, "deny"], deny);
                      } else {
                        removeConfigFormValue(state, [...basePath, "deny"]);
                      }
                    },
                    onConfigReload: () => loadConfig(state),
                    onConfigSave: () => saveAgentsConfig(state),
                    onChannelsRefresh: () => loadChannels(state, false),
                    onCronRefresh: () => state.loadCron(),
                    onCronRunNow: (jobId) => {
                      const job = state.cronJobs.find((entry) => entry.id === jobId);
                      if (!job) {
                        return;
                      }
                      void runCronJob(state, job, "force");
                    },
                    onSkillsFilterChange: (next) => (state.skillsFilter = next),
                    onSkillsRefresh: () => {
                      if (resolvedAgentId) {
                        void loadAgentSkills(state, resolvedAgentId);
                      }
                    },
                    onAgentSkillToggle: (agentId, skillName, enabled) => {
                      const index = ensureAgentIndex(agentId);
                      if (index < 0) {
                        return;
                      }
                      const list = (
                        getCurrentConfigValue() as { agents?: { list?: unknown[] } } | null
                      )?.agents?.list;
                      const entry = Array.isArray(list)
                        ? (list[index] as { skills?: unknown })
                        : undefined;
                      const normalizedSkill = skillName.trim();
                      if (!normalizedSkill) {
                        return;
                      }
                      const allSkills =
                        state.agentSkillsReport?.skills
                          ?.map((skill) => skill.name)
                          .filter(Boolean) ?? [];
                      const existing = Array.isArray(entry?.skills)
                        ? entry.skills.map((name) => String(name).trim()).filter(Boolean)
                        : undefined;
                      const base = existing ?? allSkills;
                      const next = new Set(base);
                      if (enabled) {
                        next.add(normalizedSkill);
                      } else {
                        next.delete(normalizedSkill);
                      }
                      updateConfigFormValue(state, ["agents", "list", index, "skills"], [...next]);
                    },
                    onAgentSkillsClear: (agentId) => {
                      const index = findAgentIndex(agentId);
                      if (index < 0) {
                        return;
                      }
                      removeConfigFormValue(state, ["agents", "list", index, "skills"]);
                    },
                    onAgentSkillsDisableAll: (agentId) => {
                      const index = ensureAgentIndex(agentId);
                      if (index < 0) {
                        return;
                      }
                      updateConfigFormValue(state, ["agents", "list", index, "skills"], []);
                    },
                    onModelChange: (agentId, modelId) => {
                      const index = modelId ? ensureAgentIndex(agentId) : findAgentIndex(agentId);
                      if (index < 0) {
                        return;
                      }
                      const list = (
                        getCurrentConfigValue() as { agents?: { list?: unknown[] } } | null
                      )?.agents?.list;
                      const basePath = ["agents", "list", index, "model"];
                      if (!modelId) {
                        removeConfigFormValue(state, basePath);
                      } else {
                        const entry = Array.isArray(list)
                          ? (list[index] as { model?: unknown })
                          : undefined;
                        const existing = entry?.model;
                        if (existing && typeof existing === "object" && !Array.isArray(existing)) {
                          const fallbacks = (existing as { fallbacks?: unknown }).fallbacks;
                          const next = {
                            primary: modelId,
                            ...(Array.isArray(fallbacks) ? { fallbacks } : {}),
                          };
                          updateConfigFormValue(state, basePath, next);
                        } else {
                          updateConfigFormValue(state, basePath, modelId);
                        }
                      }
                      void refreshVisibleToolsEffectiveForCurrentSession(state);
                    },
                    onModelFallbacksChange: (agentId, fallbacks) => {
                      const normalized = fallbacks.map((name) => name.trim()).filter(Boolean);
                      const currentConfig = getCurrentConfigValue();
                      const resolvedConfig = resolveAgentConfig(currentConfig, agentId);
                      const effectivePrimary =
                        resolveModelPrimary(resolvedConfig.entry?.model) ??
                        resolveModelPrimary(resolvedConfig.defaults?.model);
                      const effectiveFallbacks = resolveEffectiveModelFallbacks(
                        resolvedConfig.entry?.model,
                        resolvedConfig.defaults?.model,
                      );
                      const index =
                        normalized.length > 0
                          ? effectivePrimary
                            ? ensureAgentIndex(agentId)
                            : -1
                          : (effectiveFallbacks?.length ?? 0) > 0 || findAgentIndex(agentId) >= 0
                            ? ensureAgentIndex(agentId)
                            : -1;
                      if (index < 0) {
                        return;
                      }
                      const list = (
                        getCurrentConfigValue() as { agents?: { list?: unknown[] } } | null
                      )?.agents?.list;
                      const basePath = ["agents", "list", index, "model"];
                      const entry = Array.isArray(list)
                        ? (list[index] as { model?: unknown })
                        : undefined;
                      const existing = entry?.model;
                      const resolvePrimary = () => {
                        if (typeof existing === "string") {
                          return existing.trim() || null;
                        }
                        if (existing && typeof existing === "object" && !Array.isArray(existing)) {
                          const primary = (existing as { primary?: unknown }).primary;
                          if (typeof primary === "string") {
                            const trimmed = primary.trim();
                            return trimmed || null;
                          }
                        }
                        return null;
                      };
                      const primary = resolvePrimary() ?? effectivePrimary;
                      if (normalized.length === 0) {
                        if (primary) {
                          updateConfigFormValue(state, basePath, primary);
                        } else {
                          removeConfigFormValue(state, basePath);
                        }
                        return;
                      }
                      if (!primary) {
                        return;
                      }
                      updateConfigFormValue(state, basePath, { primary, fallbacks: normalized });
                    },
                    onSetDefault: (agentId) => {
                      if (!configValue) {
                        return;
                      }
                      updateConfigFormValue(state, ["agents", "defaultId"], agentId);
                    },
                    onInspectRefresh: () => {
                      if (state.agentInspectionRunId || state.agentInspectionTaskId) {
                        void loadAgentInspection(state, {
                          runId: state.agentInspectionRunId,
                          taskId: state.agentInspectionTaskId,
                        });
                        return;
                      }
                      if (
                        resolvedAgentId === resolveAgentIdFromSessionKey(state.sessionKey) &&
                        state.chatRunId
                      ) {
                        void loadAgentInspection(state, { runId: state.chatRunId });
                      }
                    },
                    onInspectCurrentRun: () => {
                      if (
                        resolvedAgentId === resolveAgentIdFromSessionKey(state.sessionKey) &&
                        state.chatRunId
                      ) {
                        void loadAgentInspection(state, { runId: state.chatRunId });
                      } else {
                        resetAgentInspectionState(state);
                      }
                    },
                    onInspectTimelineFilterChange: (next) => {
                      state.agentInspectionTimelineFilter = next;
                    },
                  }),
                )
              : nothing}
            ${state.tab === "skills"
              ? lazyRender(lazySkills, (m) =>
                  m.renderSkills({
                    onboarding: state.onboarding,
                    onboardingProgress: state.onboardingProgress,
                    connected: state.connected,
                    loading: state.skillsLoading,
                    report: state.skillsReport,
                    error: state.skillsError,
                    filter: state.skillsFilter,
                    statusFilter: state.skillsStatusFilter,
                    edits: state.skillEdits,
                    messages: state.skillMessages,
                    busyKey: state.skillsBusyKey,
                    detailKey: state.skillsDetailKey,
                    onFilterChange: (next) => (state.skillsFilter = next),
                    onStatusFilterChange: (next) => (state.skillsStatusFilter = next),
                    onRefresh: () => loadSkills(state, { clearMessages: true }),
                    onToggle: (key, enabled) => updateSkillEnabled(state, key, enabled),
                    onEdit: (key, value) => updateSkillEdit(state, key, value),
                    onSaveKey: (key) => saveSkillApiKey(state, key),
                    onInstall: (skillKey, name, installId) =>
                      installSkill(state, skillKey, name, installId),
                    onDetailOpen: (key) => (state.skillsDetailKey = key),
                    onDetailClose: () => (state.skillsDetailKey = null),
                    onNavigate: (tab) => state.setTab(tab as import("./navigation.ts").Tab),
                    onResumeOnboarding: () => state.resumeOnboarding(),
                    onRestartOnboarding: () => state.restartOnboarding(),
                  }),
                )
              : nothing}
            ${state.tab === "nodes"
              ? lazyRender(lazyNodes, (m) =>
                  m.renderNodes({
                    loading: state.nodesLoading,
                    nodes: state.nodes,
                    devicesLoading: state.devicesLoading,
                    devicesError: state.devicesError,
                    devicesList: state.devicesList,
                    configForm:
                      state.configForm ??
                      (state.configSnapshot?.config as Record<string, unknown> | null),
                    configLoading: state.configLoading,
                    configSaving: state.configSaving,
                    configDirty: state.configFormDirty,
                    configFormMode: state.configFormMode,
                    execApprovalsLoading: state.execApprovalsLoading,
                    execApprovalsSaving: state.execApprovalsSaving,
                    execApprovalsDirty: state.execApprovalsDirty,
                    execApprovalsSnapshot: state.execApprovalsSnapshot,
                    execApprovalsForm: state.execApprovalsForm,
                    execApprovalsSelectedAgent: state.execApprovalsSelectedAgent,
                    execApprovalsTarget: state.execApprovalsTarget,
                    execApprovalsTargetNodeId: state.execApprovalsTargetNodeId,
                    onRefresh: () => loadNodes(state),
                    onDevicesRefresh: () => loadDevices(state),
                    onDeviceApprove: (requestId) => approveDevicePairing(state, requestId),
                    onDeviceReject: (requestId) => rejectDevicePairing(state, requestId),
                    onDeviceRotate: (deviceId, role, scopes) =>
                      rotateDeviceToken(state, { deviceId, role, scopes }),
                    onDeviceRevoke: (deviceId, role) =>
                      revokeDeviceToken(state, { deviceId, role }),
                    onLoadConfig: () => loadConfig(state),
                    onLoadExecApprovals: () => {
                      const target =
                        state.execApprovalsTarget === "node" && state.execApprovalsTargetNodeId
                          ? { kind: "node" as const, nodeId: state.execApprovalsTargetNodeId }
                          : { kind: "gateway" as const };
                      return loadExecApprovals(state, target);
                    },
                    onBindDefault: (nodeId) => {
                      if (nodeId) {
                        updateConfigFormValue(state, ["tools", "exec", "node"], nodeId);
                      } else {
                        removeConfigFormValue(state, ["tools", "exec", "node"]);
                      }
                    },
                    onBindAgent: (agentIndex, nodeId) => {
                      const basePath = ["agents", "list", agentIndex, "tools", "exec", "node"];
                      if (nodeId) {
                        updateConfigFormValue(state, basePath, nodeId);
                      } else {
                        removeConfigFormValue(state, basePath);
                      }
                    },
                    onSaveBindings: () => saveConfig(state),
                    onExecApprovalsTargetChange: (kind, nodeId) => {
                      state.execApprovalsTarget = kind;
                      state.execApprovalsTargetNodeId = nodeId;
                      state.execApprovalsSnapshot = null;
                      state.execApprovalsForm = null;
                      state.execApprovalsDirty = false;
                      state.execApprovalsSelectedAgent = null;
                    },
                    onExecApprovalsSelectAgent: (agentId) => {
                      state.execApprovalsSelectedAgent = agentId;
                    },
                    onExecApprovalsPatch: (path, value) =>
                      updateExecApprovalsFormValue(state, path, value),
                    onExecApprovalsRemove: (path) => removeExecApprovalsFormValue(state, path),
                    onSaveExecApprovals: () => {
                      const target =
                        state.execApprovalsTarget === "node" && state.execApprovalsTargetNodeId
                          ? { kind: "node" as const, nodeId: state.execApprovalsTargetNodeId }
                          : { kind: "gateway" as const };
                      return saveExecApprovals(state, target);
                    },
                  }),
                )
              : nothing}
            ${state.tab === "chat"
              ? renderChat({
                  sessionKey: state.sessionKey,
                  onSessionKeyChange: (next) => {
                    state.sessionKey = next;
                    state.chatMessage = "";
                    state.chatAttachments = [];
                    state.chatStream = null;
                    state.chatStreamStartedAt = null;
                    state.chatRunId = null;
                    state.chatQueue = [];
                    state.resetToolStream();
                    state.resetChatScroll();
                    state.applySettings({
                      ...state.settings,
                      sessionKey: next,
                      lastActiveSessionKey: next,
                    });
                    void state.loadAssistantIdentity();
                    void loadChatHistory(state);
                    void refreshChatAvatar(state);
                  },
                  thinkingLevel: state.chatThinkingLevel,
                  showThinking,
                  showToolCalls,
                  loading: state.chatLoading,
                  sending: state.chatSending,
                  compactionStatus: state.compactionStatus,
                  fallbackStatus: state.fallbackStatus,
                  assistantAvatarUrl: chatAvatarUrl,
                  messages: state.chatMessages,
                  toolMessages: state.chatToolMessages,
                  actionFeed: state.chatActionFeed,
                  streamSegments: state.chatStreamSegments,
                  stream: state.chatStream,
                  streamStartedAt: state.chatStreamStartedAt,
                  draft: state.chatMessage,
                  queue: state.chatQueue,
                  connected: state.connected,
                  canSend: state.connected,
                  disabledReason: chatDisabledReason,
                  error: state.lastError,
                  sessions: state.sessionsResult,
                  focusMode: chatFocus,
                  onRefresh: () => {
                    state.resetToolStream();
                    return Promise.all([loadChatHistory(state), refreshChatAvatar(state)]);
                  },
                  onToggleFocusMode: () => {
                    if (state.onboarding) {
                      return;
                    }
                    state.applySettings({
                      ...state.settings,
                      chatFocusMode: !state.settings.chatFocusMode,
                    });
                  },
                  onChatScroll: (event) => state.handleChatScroll(event),
                  getDraft: () => state.chatMessage,
                  onDraftChange: (next) => (state.chatMessage = next),
                  onRequestUpdate: requestHostUpdate,
                  attachments: state.chatAttachments,
                  onAttachmentsChange: (next) => (state.chatAttachments = next),
                  onSend: () => state.handleSendChat(),
                  canAbort: Boolean(state.chatRunId),
                  onAbort: () => void state.handleAbortChat(),
                  onQueueRemove: (id) => state.removeQueuedMessage(id),
                  onNewSession: () => state.handleSendChat("/new", { restoreDraft: true }),
                  onClearHistory: async () => {
                    if (!state.client || !state.connected) {
                      return;
                    }
                    try {
                      await state.client.request("sessions.reset", { key: state.sessionKey });
                      state.chatMessages = [];
                      state.chatStream = null;
                      state.chatRunId = null;
                      await loadChatHistory(state);
                    } catch (err) {
                      state.lastError = String(err);
                    }
                  },
                  agentsList: state.agentsList,
                  currentAgentId: resolvedAgentId ?? "main",
                  onAgentChange: (agentId: string) => {
                    state.sessionKey = buildAgentMainSessionKey({ agentId });
                    state.chatMessages = [];
                    state.chatStream = null;
                    state.chatRunId = null;
                    state.applySettings({
                      ...state.settings,
                      sessionKey: state.sessionKey,
                      lastActiveSessionKey: state.sessionKey,
                    });
                    void loadChatHistory(state);
                    void state.loadAssistantIdentity();
                  },
                  onNavigateToAgent: () => {
                    state.agentsSelectedId = resolvedAgentId;
                    state.setTab("agents" as import("./navigation.ts").Tab);
                  },
                  onInspectCurrentRun: () => {
                    state.agentsSelectedId = resolvedAgentId;
                    state.agentsPanel = "inspect";
                    state.setTab("agents" as import("./navigation.ts").Tab);
                    if (state.chatRunId) {
                      void loadAgentInspection(state, { runId: state.chatRunId });
                    } else {
                      resetAgentInspectionState(state);
                    }
                  },
                  onInspectRun: (runId: string) => {
                    state.agentsSelectedId = resolvedAgentId;
                    state.agentsPanel = "inspect";
                    state.setTab("agents" as import("./navigation.ts").Tab);
                    void loadAgentInspection(state, { runId });
                  },
                  currentRunId: state.chatRunId,
                  onSessionSelect: (key: string) => {
                    switchChatSession(state, key);
                  },
                  showNewMessages: state.chatNewMessagesBelow && !state.chatManualRefreshInFlight,
                  onScrollToBottom: () => state.scrollToBottom(),
                  // Sidebar props for tool output viewing
                  sidebarOpen: state.sidebarOpen,
                  sidebarContent: state.sidebarContent,
                  sidebarError: state.sidebarError,
                  splitRatio: state.splitRatio,
                  onOpenSidebar: (content: string) => state.handleOpenSidebar(content),
                  onCloseSidebar: () => state.handleCloseSidebar(),
                  onSplitRatioChange: (ratio: number) => state.handleSplitRatioChange(ratio),
                  assistantName: state.assistantName,
                  assistantAvatar: state.assistantAvatar,
                  basePath: state.basePath ?? "",
                })
              : nothing}
            ${state.tab === "config"
              ? renderConfig({
                  raw: state.configRaw,
                  originalRaw: state.configRawOriginal,
                  valid: state.configValid,
                  issues: state.configIssues,
                  loading: state.configLoading,
                  saving: state.configSaving,
                  applying: state.configApplying,
                  updating: state.updateRunning,
                  connected: state.connected,
                  schema: state.configSchema,
                  schemaLoading: state.configSchemaLoading,
                  uiHints: state.configUiHints,
                  formMode: state.configFormMode,
                  showModeToggle: true,
                  formValue: state.configForm,
                  originalValue: state.configFormOriginal,
                  searchQuery: state.configSearchQuery,
                  activeSection:
                    state.configActiveSection &&
                    (CHANNELS_AND_ACCOUNTS_SECTION_KEYS.includes(
                      state.configActiveSection as ChannelsAndAccountsSectionKey,
                    ) ||
                      MEMORY_AND_PRIVACY_SECTION_KEYS.includes(
                        state.configActiveSection as MemoryAndPrivacySectionKey,
                      ) ||
                      SKILLS_AND_TOOLS_SECTION_KEYS.includes(
                        state.configActiveSection as SkillsAndToolsSectionKey,
                      ) ||
                      ADVANCED_SECTION_KEYS.includes(
                        state.configActiveSection as AdvancedSectionKey,
                      ) ||
                      MODELS_AND_AGENTS_SECTION_KEYS.includes(
                        state.configActiveSection as ModelsAndAgentsSectionKey,
                      ))
                      ? null
                      : state.configActiveSection,
                  activeSubsection:
                    state.configActiveSection &&
                    (CHANNELS_AND_ACCOUNTS_SECTION_KEYS.includes(
                      state.configActiveSection as ChannelsAndAccountsSectionKey,
                    ) ||
                      MEMORY_AND_PRIVACY_SECTION_KEYS.includes(
                        state.configActiveSection as MemoryAndPrivacySectionKey,
                      ) ||
                      SKILLS_AND_TOOLS_SECTION_KEYS.includes(
                        state.configActiveSection as SkillsAndToolsSectionKey,
                      ) ||
                      ADVANCED_SECTION_KEYS.includes(
                        state.configActiveSection as AdvancedSectionKey,
                      ) ||
                      MODELS_AND_AGENTS_SECTION_KEYS.includes(
                        state.configActiveSection as ModelsAndAgentsSectionKey,
                      ))
                      ? null
                      : state.configActiveSubsection,
                  onRawChange: (next) => {
                    state.configRaw = next;
                  },
                  onRequestUpdate: requestHostUpdate,
                  onFormModeChange: (mode) => (state.configFormMode = mode),
                  onFormPatch: (path, value) => updateConfigFormValue(state, path, value),
                  onSearchChange: (query) => (state.configSearchQuery = query),
                  onSectionChange: (section) => {
                    state.configActiveSection = section;
                    state.configActiveSubsection = null;
                  },
                  onSubsectionChange: (section) => (state.configActiveSubsection = section),
                  onReload: () => loadConfig(state),
                  onSave: () => saveConfig(state),
                  onApply: () => applyConfig(state),
                  onUpdate: () => runUpdate(state),
                  onOpenFile: () => openConfigFile(state),
                  version: state.hello?.server?.version ?? "",
                  theme: state.theme,
                  themeMode: state.themeMode,
                  setTheme: (t, ctx) => state.setTheme(t, ctx),
                  setThemeMode: (m, ctx) => state.setThemeMode(m, ctx),
                  borderRadius: state.settings.borderRadius,
                  setBorderRadius: (v) => state.setBorderRadius(v),
                  gatewayUrl: state.settings.gatewayUrl,
                  assistantName: state.assistantName,
                  configPath: state.configSnapshot?.path ?? null,
                  configHash: state.configSnapshot?.hash ?? null,
                  schemaVersion: state.configSchemaVersion,
                  rawAvailable: typeof state.configSnapshot?.raw === "string",
                  navRootLabel: "Basic",
                  includeSections: [...BASIC_SECTION_KEYS],
                  includeVirtualSections: true,
                })
              : nothing}
            ${state.tab === "communications"
              ? renderConfig({
                  raw: state.configRaw,
                  originalRaw: state.configRawOriginal,
                  valid: state.configValid,
                  issues: state.configIssues,
                  loading: state.configLoading,
                  saving: state.configSaving,
                  applying: state.configApplying,
                  updating: state.updateRunning,
                  connected: state.connected,
                  schema: state.configSchema,
                  schemaLoading: state.configSchemaLoading,
                  uiHints: state.configUiHints,
                  formMode: state.communicationsFormMode,
                  formValue: state.configForm,
                  originalValue: state.configFormOriginal,
                  searchQuery: state.communicationsSearchQuery,
                  activeSection:
                    state.communicationsActiveSection &&
                    !CHANNELS_AND_ACCOUNTS_SECTION_KEYS.includes(
                      state.communicationsActiveSection as ChannelsAndAccountsSectionKey,
                    )
                      ? null
                      : state.communicationsActiveSection,
                  activeSubsection:
                    state.communicationsActiveSection &&
                    !CHANNELS_AND_ACCOUNTS_SECTION_KEYS.includes(
                      state.communicationsActiveSection as ChannelsAndAccountsSectionKey,
                    )
                      ? null
                      : state.communicationsActiveSubsection,
                  onRawChange: (next) => {
                    state.configRaw = next;
                  },
                  onRequestUpdate: requestHostUpdate,
                  onFormModeChange: (mode) => (state.communicationsFormMode = mode),
                  onFormPatch: (path, value) => updateConfigFormValue(state, path, value),
                  onSearchChange: (query) => (state.communicationsSearchQuery = query),
                  onSectionChange: (section) => {
                    state.communicationsActiveSection = section;
                    state.communicationsActiveSubsection = null;
                  },
                  onSubsectionChange: (section) => (state.communicationsActiveSubsection = section),
                  onReload: () => loadConfig(state),
                  onSave: () => saveConfig(state),
                  onApply: () => applyConfig(state),
                  onUpdate: () => runUpdate(state),
                  onOpenFile: () => openConfigFile(state),
                  version: state.hello?.server?.version ?? "",
                  theme: state.theme,
                  themeMode: state.themeMode,
                  setTheme: (t, ctx) => state.setTheme(t, ctx),
                  setThemeMode: (m, ctx) => state.setThemeMode(m, ctx),
                  borderRadius: state.settings.borderRadius,
                  setBorderRadius: (v) => state.setBorderRadius(v),
                  gatewayUrl: state.settings.gatewayUrl,
                  assistantName: state.assistantName,
                  configPath: state.configSnapshot?.path ?? null,
                  configHash: state.configSnapshot?.hash ?? null,
                  schemaVersion: state.configSchemaVersion,
                  rawAvailable: typeof state.configSnapshot?.raw === "string",
                  navRootLabel: "Channels & Accounts",
                  includeSections: [...CHANNELS_AND_ACCOUNTS_SECTION_KEYS],
                  includeVirtualSections: false,
                })
              : nothing}
            ${state.tab === "appearance"
              ? renderConfig({
                  raw: state.configRaw,
                  originalRaw: state.configRawOriginal,
                  valid: state.configValid,
                  issues: state.configIssues,
                  loading: state.configLoading,
                  saving: state.configSaving,
                  applying: state.configApplying,
                  updating: state.updateRunning,
                  connected: state.connected,
                  schema: state.configSchema,
                  schemaLoading: state.configSchemaLoading,
                  uiHints: state.configUiHints,
                  formMode: state.appearanceFormMode,
                  formValue: state.configForm,
                  originalValue: state.configFormOriginal,
                  searchQuery: state.appearanceSearchQuery,
                  activeSection:
                    state.appearanceActiveSection &&
                    !MEMORY_AND_PRIVACY_SECTION_KEYS.includes(
                      state.appearanceActiveSection as MemoryAndPrivacySectionKey,
                    )
                      ? null
                      : state.appearanceActiveSection,
                  activeSubsection:
                    state.appearanceActiveSection &&
                    !MEMORY_AND_PRIVACY_SECTION_KEYS.includes(
                      state.appearanceActiveSection as MemoryAndPrivacySectionKey,
                    )
                      ? null
                      : state.appearanceActiveSubsection,
                  onRawChange: (next) => {
                    state.configRaw = next;
                  },
                  onRequestUpdate: requestHostUpdate,
                  onFormModeChange: (mode) => (state.appearanceFormMode = mode),
                  onFormPatch: (path, value) => updateConfigFormValue(state, path, value),
                  onSearchChange: (query) => (state.appearanceSearchQuery = query),
                  onSectionChange: (section) => {
                    state.appearanceActiveSection = section;
                    state.appearanceActiveSubsection = null;
                  },
                  onSubsectionChange: (section) => (state.appearanceActiveSubsection = section),
                  onReload: () => loadConfig(state),
                  onSave: () => saveConfig(state),
                  onApply: () => applyConfig(state),
                  onUpdate: () => runUpdate(state),
                  onOpenFile: () => openConfigFile(state),
                  version: state.hello?.server?.version ?? "",
                  theme: state.theme,
                  themeMode: state.themeMode,
                  setTheme: (t, ctx) => state.setTheme(t, ctx),
                  setThemeMode: (m, ctx) => state.setThemeMode(m, ctx),
                  borderRadius: state.settings.borderRadius,
                  setBorderRadius: (v) => state.setBorderRadius(v),
                  gatewayUrl: state.settings.gatewayUrl,
                  assistantName: state.assistantName,
                  configPath: state.configSnapshot?.path ?? null,
                  configHash: state.configSnapshot?.hash ?? null,
                  schemaVersion: state.configSchemaVersion,
                  rawAvailable: typeof state.configSnapshot?.raw === "string",
                  navRootLabel: "Memory & Privacy",
                  includeSections: [...MEMORY_AND_PRIVACY_SECTION_KEYS],
                  includeVirtualSections: false,
                })
              : nothing}
            ${state.tab === "automation"
              ? renderConfig({
                  raw: state.configRaw,
                  originalRaw: state.configRawOriginal,
                  valid: state.configValid,
                  issues: state.configIssues,
                  loading: state.configLoading,
                  saving: state.configSaving,
                  applying: state.configApplying,
                  updating: state.updateRunning,
                  connected: state.connected,
                  schema: state.configSchema,
                  schemaLoading: state.configSchemaLoading,
                  uiHints: state.configUiHints,
                  formMode: state.automationFormMode,
                  formValue: state.configForm,
                  originalValue: state.configFormOriginal,
                  searchQuery: state.automationSearchQuery,
                  activeSection:
                    state.automationActiveSection &&
                    !SKILLS_AND_TOOLS_SECTION_KEYS.includes(
                      state.automationActiveSection as SkillsAndToolsSectionKey,
                    )
                      ? null
                      : state.automationActiveSection,
                  activeSubsection:
                    state.automationActiveSection &&
                    !SKILLS_AND_TOOLS_SECTION_KEYS.includes(
                      state.automationActiveSection as SkillsAndToolsSectionKey,
                    )
                      ? null
                      : state.automationActiveSubsection,
                  onRawChange: (next) => {
                    state.configRaw = next;
                  },
                  onRequestUpdate: requestHostUpdate,
                  onFormModeChange: (mode) => (state.automationFormMode = mode),
                  onFormPatch: (path, value) => updateConfigFormValue(state, path, value),
                  onSearchChange: (query) => (state.automationSearchQuery = query),
                  onSectionChange: (section) => {
                    state.automationActiveSection = section;
                    state.automationActiveSubsection = null;
                  },
                  onSubsectionChange: (section) => (state.automationActiveSubsection = section),
                  onReload: () => loadConfig(state),
                  onSave: () => saveConfig(state),
                  onApply: () => applyConfig(state),
                  onUpdate: () => runUpdate(state),
                  onOpenFile: () => openConfigFile(state),
                  version: state.hello?.server?.version ?? "",
                  theme: state.theme,
                  themeMode: state.themeMode,
                  setTheme: (t, ctx) => state.setTheme(t, ctx),
                  setThemeMode: (m, ctx) => state.setThemeMode(m, ctx),
                  borderRadius: state.settings.borderRadius,
                  setBorderRadius: (v) => state.setBorderRadius(v),
                  gatewayUrl: state.settings.gatewayUrl,
                  assistantName: state.assistantName,
                  configPath: state.configSnapshot?.path ?? null,
                  configHash: state.configSnapshot?.hash ?? null,
                  schemaVersion: state.configSchemaVersion,
                  rawAvailable: typeof state.configSnapshot?.raw === "string",
                  navRootLabel: "Skills & Tools",
                  includeSections: [...SKILLS_AND_TOOLS_SECTION_KEYS],
                  includeVirtualSections: false,
                })
              : nothing}
            ${state.tab === "infrastructure"
              ? renderConfig({
                  raw: state.configRaw,
                  originalRaw: state.configRawOriginal,
                  valid: state.configValid,
                  issues: state.configIssues,
                  loading: state.configLoading,
                  saving: state.configSaving,
                  applying: state.configApplying,
                  updating: state.updateRunning,
                  connected: state.connected,
                  schema: state.configSchema,
                  schemaLoading: state.configSchemaLoading,
                  uiHints: state.configUiHints,
                  formMode: state.infrastructureFormMode,
                  formValue: state.configForm,
                  originalValue: state.configFormOriginal,
                  searchQuery: state.infrastructureSearchQuery,
                  activeSection:
                    state.infrastructureActiveSection &&
                    !ADVANCED_SECTION_KEYS.includes(
                      state.infrastructureActiveSection as AdvancedSectionKey,
                    )
                      ? null
                      : state.infrastructureActiveSection,
                  activeSubsection:
                    state.infrastructureActiveSection &&
                    !ADVANCED_SECTION_KEYS.includes(
                      state.infrastructureActiveSection as AdvancedSectionKey,
                    )
                      ? null
                      : state.infrastructureActiveSubsection,
                  onRawChange: (next) => {
                    state.configRaw = next;
                  },
                  onRequestUpdate: requestHostUpdate,
                  onFormModeChange: (mode) => (state.infrastructureFormMode = mode),
                  onFormPatch: (path, value) => updateConfigFormValue(state, path, value),
                  onSearchChange: (query) => (state.infrastructureSearchQuery = query),
                  onSectionChange: (section) => {
                    state.infrastructureActiveSection = section;
                    state.infrastructureActiveSubsection = null;
                  },
                  onSubsectionChange: (section) => (state.infrastructureActiveSubsection = section),
                  onReload: () => loadConfig(state),
                  onSave: () => saveConfig(state),
                  onApply: () => applyConfig(state),
                  onUpdate: () => runUpdate(state),
                  onOpenFile: () => openConfigFile(state),
                  version: state.hello?.server?.version ?? "",
                  theme: state.theme,
                  themeMode: state.themeMode,
                  setTheme: (t, ctx) => state.setTheme(t, ctx),
                  setThemeMode: (m, ctx) => state.setThemeMode(m, ctx),
                  borderRadius: state.settings.borderRadius,
                  setBorderRadius: (v) => state.setBorderRadius(v),
                  gatewayUrl: state.settings.gatewayUrl,
                  assistantName: state.assistantName,
                  configPath: state.configSnapshot?.path ?? null,
                  configHash: state.configSnapshot?.hash ?? null,
                  schemaVersion: state.configSchemaVersion,
                  rawAvailable: typeof state.configSnapshot?.raw === "string",
                  navRootLabel: "Advanced",
                  includeSections: [...ADVANCED_SECTION_KEYS],
                  includeVirtualSections: false,
                })
              : nothing}
            ${state.tab === "aiAgents"
              ? renderConfig({
                  raw: state.configRaw,
                  originalRaw: state.configRawOriginal,
                  valid: state.configValid,
                  issues: state.configIssues,
                  loading: state.configLoading,
                  saving: state.configSaving,
                  applying: state.configApplying,
                  updating: state.updateRunning,
                  connected: state.connected,
                  schema: state.configSchema,
                  schemaLoading: state.configSchemaLoading,
                  uiHints: state.configUiHints,
                  formMode: state.aiAgentsFormMode,
                  formValue: state.configForm,
                  originalValue: state.configFormOriginal,
                  searchQuery: state.aiAgentsSearchQuery,
                  activeSection:
                    state.aiAgentsActiveSection &&
                    !MODELS_AND_AGENTS_SECTION_KEYS.includes(
                      state.aiAgentsActiveSection as ModelsAndAgentsSectionKey,
                    )
                      ? null
                      : state.aiAgentsActiveSection,
                  activeSubsection:
                    state.aiAgentsActiveSection &&
                    !MODELS_AND_AGENTS_SECTION_KEYS.includes(
                      state.aiAgentsActiveSection as ModelsAndAgentsSectionKey,
                    )
                      ? null
                      : state.aiAgentsActiveSubsection,
                  onRawChange: (next) => {
                    state.configRaw = next;
                  },
                  onRequestUpdate: requestHostUpdate,
                  onFormModeChange: (mode) => (state.aiAgentsFormMode = mode),
                  onFormPatch: (path, value) => updateConfigFormValue(state, path, value),
                  onSearchChange: (query) => (state.aiAgentsSearchQuery = query),
                  onSectionChange: (section) => {
                    state.aiAgentsActiveSection = section;
                    state.aiAgentsActiveSubsection = null;
                  },
                  onSubsectionChange: (section) => (state.aiAgentsActiveSubsection = section),
                  onReload: () => loadConfig(state),
                  onSave: () => saveConfig(state),
                  onApply: () => applyConfig(state),
                  onUpdate: () => runUpdate(state),
                  onOpenFile: () => openConfigFile(state),
                  version: state.hello?.server?.version ?? "",
                  theme: state.theme,
                  themeMode: state.themeMode,
                  setTheme: (t, ctx) => state.setTheme(t, ctx),
                  setThemeMode: (m, ctx) => state.setThemeMode(m, ctx),
                  borderRadius: state.settings.borderRadius,
                  setBorderRadius: (v) => state.setBorderRadius(v),
                  gatewayUrl: state.settings.gatewayUrl,
                  assistantName: state.assistantName,
                  configPath: state.configSnapshot?.path ?? null,
                  configHash: state.configSnapshot?.hash ?? null,
                  schemaVersion: state.configSchemaVersion,
                  rawAvailable: typeof state.configSnapshot?.raw === "string",
                  navRootLabel: "Models & Agents",
                  includeSections: [...MODELS_AND_AGENTS_SECTION_KEYS],
                  includeVirtualSections: false,
                })
              : nothing}
            ${state.tab === "debug"
              ? lazyRender(lazyDebug, (m) =>
                  m.renderDebug({
                    loading: state.debugLoading,
                    status: state.debugStatus,
                    health: state.debugHealth,
                    models: state.debugModels,
                    heartbeat: state.debugHeartbeat,
                    eventLog: state.eventLog,
                    methods: (state.hello?.features?.methods ?? []).toSorted(),
                    callMethod: state.debugCallMethod,
                    callParams: state.debugCallParams,
                    callResult: state.debugCallResult,
                    callError: state.debugCallError,
                    onCallMethodChange: (next) => (state.debugCallMethod = next),
                    onCallParamsChange: (next) => (state.debugCallParams = next),
                    onRefresh: () => loadDebug(state),
                    onCall: () => callDebugMethod(state),
                  }),
                )
              : nothing}
            ${state.tab === "logs"
              ? lazyRender(lazyLogs, (m) =>
                  m.renderLogs({
                    loading: state.logsLoading,
                    error: state.logsError,
                    file: state.logsFile,
                    entries: state.logsEntries,
                    filterText: state.logsFilterText,
                    levelFilters: state.logsLevelFilters,
                    autoFollow: state.logsAutoFollow,
                    truncated: state.logsTruncated,
                    onFilterTextChange: (next) => (state.logsFilterText = next),
                    onLevelToggle: (level, enabled) => {
                      state.logsLevelFilters = { ...state.logsLevelFilters, [level]: enabled };
                    },
                    onToggleAutoFollow: (next) => (state.logsAutoFollow = next),
                    onRefresh: () => loadLogs(state, { reset: true }),
                    onExport: (lines, label) => state.exportLogs(lines, label),
                    onScroll: (event) => state.handleLogsScroll(event),
                  }),
                )
              : nothing}
          </div>
        </div>
      </main>
      ${renderExecApprovalPrompt(state)} ${renderGatewayUrlConfirmation(state)} ${nothing}
    </div>
  `;
}
