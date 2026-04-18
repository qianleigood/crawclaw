import { html, nothing } from "lit";
import { t, i18n, SUPPORTED_LOCALES, type Locale, isSupportedLocale } from "../../i18n/index.ts";
import { buildExternalLinkRel, EXTERNAL_LINK_TARGET } from "../external-link.ts";
import {
  formatCost,
  formatDurationHuman,
  formatRelativeTimestamp,
  formatTokens,
} from "../format.ts";
import type { GatewayHelloOk } from "../gateway.ts";
import { icons } from "../icons.ts";
import {
  countRememberedOnboardingSteps,
  highestRememberedOnboardingStep,
  isOnboardingFinished,
  type OnboardingProgress,
} from "../onboarding-progress.ts";
import type { UiSettings } from "../storage.ts";
import type {
  AttentionItem,
  CronJob,
  CronStatus,
  FeishuCliStatusSnapshot,
  SessionsListResult,
  SessionsUsageResult,
  SkillStatusReport,
} from "../types.ts";
import type { EventLogEntry } from "../types/event-log.ts";
import { renderConnectCommand } from "./connect-command.ts";
import { renderOverviewAttention } from "./overview-attention.ts";
import { renderOverviewCards } from "./overview-cards.ts";
import { renderOverviewEventLog } from "./overview-event-log.ts";
import {
  resolveAuthHintKind,
  shouldShowInsecureContextHint,
  shouldShowPairingHint,
} from "./overview-hints.ts";
import { renderOverviewLogTail } from "./overview-log-tail.ts";

export type OverviewProps = {
  uiMode?: "simple" | "advanced";
  onboarding?: boolean;
  onboardingProgress?: OnboardingProgress | null;
  assistantName: string;
  connected: boolean;
  hello: GatewayHelloOk | null;
  settings: UiSettings;
  password: string;
  lastError: string | null;
  lastErrorCode: string | null;
  presenceCount: number;
  sessionsCount: number | null;
  cronEnabled: boolean | null;
  cronNext: number | null;
  lastChannelsRefresh: number | null;
  feishuCliStatus: FeishuCliStatusSnapshot | null;
  feishuCliLastSuccessAt: number | null;
  feishuCliSupported: boolean | null;
  feishuCliError: string | null;
  // New dashboard data
  usageResult: SessionsUsageResult | null;
  sessionsResult: SessionsListResult | null;
  skillsReport: SkillStatusReport | null;
  cronJobs: CronJob[];
  cronStatus: CronStatus | null;
  attentionItems: AttentionItem[];
  eventLog: EventLogEntry[];
  overviewLogLines: string[];
  showGatewayToken: boolean;
  showGatewayPassword: boolean;
  onSettingsChange: (next: UiSettings) => void;
  onPasswordChange: (next: string) => void;
  onSessionKeyChange: (next: string) => void;
  onToggleGatewayTokenVisibility: () => void;
  onToggleGatewayPasswordVisibility: () => void;
  onConnect: () => void;
  onRefresh: () => void;
  onNavigate: (tab: string) => void;
  onRefreshLogs: () => void;
  onPauseOnboarding: () => void;
  onResumeOnboarding: () => void;
  onRestartOnboarding: () => void;
  onCompleteOnboarding: () => void;
};

function uiLiteral(value: string) {
  return value;
}

type OverviewStep = {
  title: string;
  description: string;
  actionLabel?: string;
  action?: () => void;
};

type SetupPathStep = {
  title: string;
  description: string;
  status: "done" | "current" | "up-next";
  actionLabel: string;
  action: () => void;
};

function formatFeishuCliOverviewState(
  props: Pick<OverviewProps, "feishuCliStatus" | "feishuCliSupported" | "connected">,
): string {
  if (!props.connected) {
    return t("common.offline");
  }
  if (props.feishuCliSupported === false) {
    return "Not loaded";
  }
  if (!props.feishuCliStatus) {
    return t("common.na");
  }
  return props.feishuCliStatus.status.replaceAll("_", " ");
}

function formatFeishuCliOverviewCallout(
  props: Pick<OverviewProps, "feishuCliStatus" | "feishuCliSupported">,
): string | null {
  if (props.feishuCliSupported === false) {
    return "Feishu user tools are not loaded on this gateway. Enable plugins.entries.feishu-cli.enabled, restart the gateway, then run crawclaw feishu-cli status.";
  }
  if (props.feishuCliStatus?.authOk === false) {
    return `Feishu user tools are installed, but user auth is not ready${props.feishuCliStatus.message ? `: ${props.feishuCliStatus.message}` : "."} Run crawclaw feishu-cli auth login, then check crawclaw feishu-cli status --verify.`;
  }
  if (props.feishuCliStatus?.authOk === true) {
    return `Feishu user tools are ready${props.feishuCliStatus.version ? ` · lark-cli ${props.feishuCliStatus.version}` : ""}. Config lives under plugins.entries.feishu-cli.config. Recheck with crawclaw feishu-cli status --verify.`;
  }
  return null;
}

export function renderOverview(props: OverviewProps) {
  const snapshot = props.hello?.snapshot as
    | {
        uptimeMs?: number;
        authMode?: "none" | "token" | "password" | "trusted-proxy";
      }
    | undefined;
  const uptime = snapshot?.uptimeMs ? formatDurationHuman(snapshot.uptimeMs) : t("common.na");
  const tickIntervalMs = props.hello?.policy?.tickIntervalMs;
  const tick = tickIntervalMs
    ? `${(tickIntervalMs / 1000).toFixed(tickIntervalMs % 1000 === 0 ? 0 : 1)}s`
    : t("common.na");
  const authMode = snapshot?.authMode;
  const isTrustedProxy = authMode === "trusted-proxy";

  const pairingHint = (() => {
    if (!shouldShowPairingHint(props.connected, props.lastError, props.lastErrorCode)) {
      return null;
    }
    return html`
      <div class="muted" style="margin-top: 8px">
        ${t("overview.pairing.hint")}
        <div style="margin-top: 6px">
          <span class="mono">crawclaw devices list</span><br />
          <span class="mono">crawclaw devices approve &lt;requestId&gt;</span>
        </div>
        <div style="margin-top: 6px; font-size: 12px;">${t("overview.pairing.mobileHint")}</div>
        <div style="margin-top: 6px">
          <a
            class="session-link"
            href="https://docs.crawclaw.ai/web/control-ui#device-pairing-first-connection"
            target=${EXTERNAL_LINK_TARGET}
            rel=${buildExternalLinkRel()}
            title="Device pairing docs (opens in new tab)"
            >Docs: Device pairing</a
          >
        </div>
      </div>
    `;
  })();

  const authHint = (() => {
    const authHintKind = resolveAuthHintKind({
      connected: props.connected,
      lastError: props.lastError,
      lastErrorCode: props.lastErrorCode,
      hasToken: Boolean(props.settings.token.trim()),
      hasPassword: Boolean(props.password.trim()),
    });
    if (authHintKind == null) {
      return null;
    }
    if (authHintKind === "required") {
      return html`
        <div class="muted" style="margin-top: 8px">
          ${t("overview.auth.required")}
          <div style="margin-top: 6px">
            <span class="mono">crawclaw dashboard --no-open</span> → tokenized URL<br />
            <span class="mono">crawclaw doctor --generate-gateway-token</span> → set token
          </div>
          <div style="margin-top: 6px">
            <a
              class="session-link"
              href="https://docs.crawclaw.ai/web/dashboard"
              target=${EXTERNAL_LINK_TARGET}
              rel=${buildExternalLinkRel()}
              title="Control UI auth docs (opens in new tab)"
              >Docs: Control UI auth</a
            >
          </div>
        </div>
      `;
    }
    return html`
      <div class="muted" style="margin-top: 8px">
        ${t("overview.auth.failed", { command: "crawclaw dashboard --no-open" })}
        <div style="margin-top: 6px">
          <a
            class="session-link"
            href="https://docs.crawclaw.ai/web/dashboard"
            target=${EXTERNAL_LINK_TARGET}
            rel=${buildExternalLinkRel()}
            title="Control UI auth docs (opens in new tab)"
            >Docs: Control UI auth</a
          >
        </div>
      </div>
    `;
  })();

  const insecureContextHint = (() => {
    if (props.connected || !props.lastError) {
      return null;
    }
    const isSecureContext = typeof window !== "undefined" ? window.isSecureContext : true;
    if (isSecureContext) {
      return null;
    }
    if (!shouldShowInsecureContextHint(props.connected, props.lastError, props.lastErrorCode)) {
      return null;
    }
    return html`
      <div class="muted" style="margin-top: 8px">
        ${t("overview.insecure.hint", { url: "http://127.0.0.1:18789" })}
        <div style="margin-top: 6px">
          ${t("overview.insecure.stayHttp", {
            config: "gateway.controlUi.allowInsecureAuth: true",
          })}
        </div>
        <div style="margin-top: 6px">
          <a
            class="session-link"
            href="https://docs.crawclaw.ai/gateway/tailscale"
            target=${EXTERNAL_LINK_TARGET}
            rel=${buildExternalLinkRel()}
            title="Tailscale Serve docs (opens in new tab)"
            >Docs: Tailscale Serve</a
          >
          <span class="muted"> · </span>
          <a
            class="session-link"
            href="https://docs.crawclaw.ai/web/control-ui#insecure-http"
            target=${EXTERNAL_LINK_TARGET}
            rel=${buildExternalLinkRel()}
            title="Insecure HTTP docs (opens in new tab)"
            >Docs: Insecure HTTP</a
          >
        </div>
      </div>
    `;
  })();

  const currentLocale = isSupportedLocale(props.settings.locale)
    ? props.settings.locale
    : i18n.getLocale();
  const uiMode = props.uiMode === "advanced" ? "advanced" : "simple";
  const nextSteps = buildOverviewNextSteps(props);
  const refreshSummary = props.lastChannelsRefresh
    ? formatRelativeTimestamp(props.lastChannelsRefresh)
    : t("common.na");

  return html`
    <section class="overview-stage overview-stage--rewrite">
      ${renderOverviewMetricsBand({
        connected: props.connected,
        usageResult: props.usageResult,
        sessionsResult: props.sessionsResult,
        skillsReport: props.skillsReport,
        cronStatus: props.cronStatus,
        attentionItems: props.attentionItems,
      })}

      <section class="overview-console-grid">
        <div class="overview-console-grid__main">
          ${renderOverviewHero(props, nextSteps)}
          ${props.onboarding
            ? renderOverviewOnboardingWizard(props)
            : html`${renderOverviewOnboardingState(props)} ${renderOverviewSetupPath(props)}`}
        </div>
        <aside class="overview-console-grid__rail">
          <div class="card">
            <div class="card-title">${t("overview.snapshot.title")}</div>
            <div class="card-sub">${t("overview.snapshot.subtitle")}</div>
            <div class="stat-grid" style="margin-top: 16px;">
              <div class="stat">
                <div class="stat-label">${t("overview.snapshot.status")}</div>
                <div class="stat-value ${props.connected ? "ok" : "warn"}">
                  ${props.connected ? t("common.ok") : t("common.offline")}
                </div>
              </div>
              <div class="stat">
                <div class="stat-label">${t("overview.snapshot.uptime")}</div>
                <div class="stat-value">${uptime}</div>
              </div>
              <div class="stat">
                <div class="stat-label">${t("overview.snapshot.tickInterval")}</div>
                <div class="stat-value">${tick}</div>
              </div>
              <div class="stat">
                <div class="stat-label">${t("overview.snapshot.lastChannelsRefresh")}</div>
                <div class="stat-value">${refreshSummary}</div>
              </div>
              <div class="stat">
                <div class="stat-label">Feishu user</div>
                <div class="stat-value">${formatFeishuCliOverviewState(props)}</div>
              </div>
              <div class="stat">
                <div class="stat-label">Feishu user refresh</div>
                <div class="stat-value">
                  ${props.feishuCliLastSuccessAt
                    ? formatRelativeTimestamp(props.feishuCliLastSuccessAt)
                    : t("common.na")}
                </div>
              </div>
            </div>
            ${props.lastError
              ? html`<div class="callout danger" style="margin-top: 14px;">
                  <div>${props.lastError}</div>
                  ${pairingHint ?? ""} ${authHint ?? ""} ${insecureContextHint ?? ""}
                </div>`
              : html`
                  <div class="callout" style="margin-top: 14px">
                    ${t("overview.snapshot.channelsHint")}
                  </div>
                `}
            ${props.feishuCliError
              ? html`<div class="callout danger" style="margin-top: 14px;">
                  ${props.feishuCliError}
                </div>`
              : props.connected && props.feishuCliSupported !== null
                ? html`
                    <div
                      class="callout ${props.feishuCliStatus?.authOk === false ||
                      !props.feishuCliSupported
                        ? "warn"
                        : "info"}"
                      style="margin-top: 14px"
                    >
                      ${formatFeishuCliOverviewCallout(props) ?? nothing}
                    </div>
                  `
                : nothing}
          </div>

          <div class="card">
            <div class="card-title">${t("overview.access.title")}</div>
            <div class="card-sub">${t("overview.access.subtitle")}</div>
            <div class="ov-access-grid" style="margin-top: 16px;">
              <label class="field ov-access-grid__full">
                <span>${t("overview.access.wsUrl")}</span>
                <input
                  .value=${props.settings.gatewayUrl}
                  @input=${(e: Event) => {
                    const v = (e.target as HTMLInputElement).value;
                    props.onSettingsChange({
                      ...props.settings,
                      gatewayUrl: v,
                      token:
                        v.trim() === props.settings.gatewayUrl.trim() ? props.settings.token : "",
                    });
                  }}
                  placeholder="ws://100.x.y.z:18789"
                />
              </label>
              ${isTrustedProxy
                ? ""
                : html`
                    <label class="field">
                      <span>${t("overview.access.token")}</span>
                      <div style="display: flex; align-items: center; gap: 8px;">
                        <input
                          type=${props.showGatewayToken ? "text" : "password"}
                          autocomplete="off"
                          style="flex: 1;"
                          .value=${props.settings.token}
                          @input=${(e: Event) => {
                            const v = (e.target as HTMLInputElement).value;
                            props.onSettingsChange({ ...props.settings, token: v });
                          }}
                          placeholder="CRAWCLAW_GATEWAY_TOKEN"
                        />
                        <button
                          type="button"
                          class="btn btn--icon ${props.showGatewayToken ? "active" : ""}"
                          style="width: 36px; height: 36px;"
                          title=${props.showGatewayToken ? "Hide token" : "Show token"}
                          aria-label="Toggle token visibility"
                          aria-pressed=${props.showGatewayToken}
                          @click=${props.onToggleGatewayTokenVisibility}
                        >
                          ${props.showGatewayToken ? icons.eye : icons.eyeOff}
                        </button>
                      </div>
                    </label>
                    <label class="field">
                      <span>${t("overview.access.password")}</span>
                      <div style="display: flex; align-items: center; gap: 8px;">
                        <input
                          type=${props.showGatewayPassword ? "text" : "password"}
                          autocomplete="off"
                          style="flex: 1;"
                          .value=${props.password}
                          @input=${(e: Event) => {
                            const v = (e.target as HTMLInputElement).value;
                            props.onPasswordChange(v);
                          }}
                          placeholder="system or shared password"
                        />
                        <button
                          type="button"
                          class="btn btn--icon ${props.showGatewayPassword ? "active" : ""}"
                          style="width: 36px; height: 36px;"
                          title=${props.showGatewayPassword ? "Hide password" : "Show password"}
                          aria-label="Toggle password visibility"
                          aria-pressed=${props.showGatewayPassword}
                          @click=${props.onToggleGatewayPasswordVisibility}
                        >
                          ${props.showGatewayPassword ? icons.eye : icons.eyeOff}
                        </button>
                      </div>
                    </label>
                  `}
              <label class="field">
                <span>${t("overview.access.sessionKey")}</span>
                <input
                  .value=${props.settings.sessionKey}
                  @input=${(e: Event) => {
                    const v = (e.target as HTMLInputElement).value;
                    props.onSessionKeyChange(v);
                  }}
                />
              </label>
              <label class="field">
                <span>${t("overview.access.language")}</span>
                <select
                  .value=${currentLocale}
                  @change=${(e: Event) => {
                    const v = (e.target as HTMLSelectElement).value as Locale;
                    void i18n.setLocale(v);
                    props.onSettingsChange({ ...props.settings, locale: v });
                  }}
                >
                  ${SUPPORTED_LOCALES.map((loc) => {
                    const key = loc.replace(/-([a-zA-Z])/g, (_, c) => c.toUpperCase());
                    return html`<option value=${loc} ?selected=${currentLocale === loc}>
                      ${t(`languages.${key}`)}
                    </option>`;
                  })}
                </select>
              </label>
            </div>
            <div class="row" style="margin-top: 14px;">
              <button class="btn" @click=${() => props.onConnect()}>${t("common.connect")}</button>
              <button class="btn" @click=${() => props.onRefresh()}>${t("common.refresh")}</button>
              <span class="muted"
                >${isTrustedProxy
                  ? t("overview.access.trustedProxy")
                  : t("overview.access.connectHint")}</span
              >
            </div>
            ${!props.connected
              ? html`
                  <div class="login-gate__help" style="margin-top: 16px;">
                    <div class="login-gate__help-title">${t("overview.connection.title")}</div>
                    <ol class="login-gate__steps">
                      <li>
                        ${t("overview.connection.step1")}
                        ${renderConnectCommand("crawclaw gateway run")}
                      </li>
                      <li>
                        ${t("overview.connection.step2")}
                        ${renderConnectCommand("crawclaw dashboard")}
                      </li>
                      <li>${t("overview.connection.step3")}</li>
                      <li>
                        ${t("overview.connection.step4")}<code
                          >crawclaw doctor --generate-gateway-token</code
                        >
                      </li>
                    </ol>
                    <div class="login-gate__docs">
                      ${t("overview.connection.docsHint")}
                      <a
                        class="session-link"
                        href="https://docs.crawclaw.ai/web/dashboard"
                        target="_blank"
                        rel="noreferrer"
                        >${t("overview.connection.docsLink")}</a
                      >
                    </div>
                  </div>
                `
              : nothing}
          </div>
        </aside>
      </section>

      <div class="ov-section-divider"></div>

      ${renderOverviewCards({
        usageResult: props.usageResult,
        sessionsResult: props.sessionsResult,
        skillsReport: props.skillsReport,
        cronJobs: props.cronJobs,
        cronStatus: props.cronStatus,
        presenceCount: props.presenceCount,
        onNavigate: props.onNavigate,
      })}
      ${renderOverviewAttention({ items: props.attentionItems })}
      ${uiMode === "advanced"
        ? html`
            <div class="ov-section-divider"></div>
            <div class="ov-bottom-grid">
              ${renderOverviewEventLog({
                events: props.eventLog,
              })}
              ${renderOverviewLogTail({
                lines: props.overviewLogLines,
                onRefreshLogs: props.onRefreshLogs,
              })}
            </div>
          `
        : html`
            <details class="card overview-advanced-details">
              <summary class="overview-advanced-details__summary">Advanced details</summary>
              <div class="overview-advanced-details__body">
                <section class="grid">
                  ${renderOverviewEventLog({
                    events: props.eventLog,
                  })}
                  ${renderOverviewLogTail({
                    lines: props.overviewLogLines,
                    onRefreshLogs: props.onRefreshLogs,
                  })}
                </section>
              </div>
            </details>
          `}
    </section>
  `;
}

function buildOverviewNextSteps(props: OverviewProps): OverviewStep[] {
  const steps: OverviewStep[] = [];
  if (!props.connected) {
    steps.push({
      title: t("overviewUi.next.connectGatewayTitle"),
      description: t("overviewUi.next.connectGatewayDescription"),
      actionLabel: t("overviewUi.actions.connectNow"),
      action: props.onConnect,
    });
  }
  if (props.feishuCliSupported === false) {
    steps.push({
      title: t("overviewUi.next.enableFeishuTitle"),
      description: t("overviewUi.next.enableFeishuDescription"),
      actionLabel: t("overviewUi.actions.openConnectCenter"),
      action: () => props.onNavigate("channels"),
    });
  } else if (props.feishuCliStatus?.authOk === false) {
    steps.push({
      title: t("overviewUi.next.finishFeishuLoginTitle"),
      description:
        props.feishuCliStatus.message ?? t("overviewUi.next.finishFeishuLoginDescription"),
      actionLabel: t("overviewUi.actions.openConnectCenter"),
      action: () => props.onNavigate("channels"),
    });
  }
  const setupNeeded =
    (props.skillsReport?.skills ?? []).filter((skill) => !skill.disabled && !skill.eligible)
      .length ?? 0;
  if (setupNeeded > 0) {
    steps.push({
      title: "Finish recommended skills",
      description: `${setupNeeded} enabled skill${setupNeeded === 1 ? "" : "s"} still need setup before they can run.`,
      actionLabel: "Open Skills",
      action: () => props.onNavigate("skills"),
    });
  }
  if ((props.sessionsResult?.count ?? 0) === 0) {
    steps.push({
      title: "Send a first test message",
      description: "Once connected, start a chat run to verify your default agent and tools.",
      actionLabel: "Open Chat",
      action: () => props.onNavigate("chat"),
    });
  }
  if (steps.length === 0) {
    steps.push({
      title: "Everything is ready",
      description:
        "Your gateway, channels, and skills look healthy. Start a chat or adjust your agent defaults.",
      actionLabel: "Open Chat",
      action: () => props.onNavigate("chat"),
    });
  }
  return steps.slice(0, 4);
}

function renderOverviewMetricsBand(
  props: Pick<
    OverviewProps,
    | "connected"
    | "usageResult"
    | "sessionsResult"
    | "skillsReport"
    | "cronStatus"
    | "attentionItems"
  >,
) {
  const totals = props.usageResult?.totals;
  const enabledSkills = (props.skillsReport?.skills ?? []).filter(
    (skill) => !skill.disabled,
  ).length;
  const issues = props.attentionItems.length;
  const criticalIssues = props.attentionItems.filter((item) => item.severity === "error").length;
  const metrics = [
    {
      label: uiLiteral("Gateway"),
      value: props.connected ? uiLiteral("Online") : uiLiteral("Offline"),
      suffix: uiLiteral("state"),
      accent: props.connected ? "ok" : "warn",
      fill: props.connected ? "86%" : "28%",
    },
    {
      label: uiLiteral("Usage"),
      value: formatCost(totals?.totalCost),
      suffix: formatTokens(totals?.totalTokens),
      accent: "info",
      fill: totals?.totalCost ? "68%" : "18%",
    },
    {
      label: uiLiteral("Sessions"),
      value: String(props.sessionsResult?.count ?? 0),
      suffix: `${enabledSkills} skills`,
      accent: "stable",
      fill: props.sessionsResult?.count ? "76%" : "22%",
    },
    {
      label: uiLiteral("Attention"),
      value: issues ? String(issues) : uiLiteral("Clear"),
      suffix: criticalIssues > 0 ? `${criticalIssues} critical` : uiLiteral("nominal"),
      accent: criticalIssues > 0 ? "warn" : props.cronStatus?.enabled === false ? "info" : "ok",
      fill: issues ? "41%" : "94%",
    },
  ];

  return html`
    <section class="overview-kpi-band" aria-label="Overview metrics">
      ${metrics.map(
        (metric) => html`
          <article class="overview-kpi-card overview-kpi-card--${metric.accent}">
            <div class="overview-kpi-card__label">${metric.label}</div>
            <div class="overview-kpi-card__value-row">
              <strong class="overview-kpi-card__value">${metric.value}</strong>
              <span class="overview-kpi-card__suffix mono">${metric.suffix}</span>
            </div>
            <div class="overview-kpi-card__meter" aria-hidden="true">
              <span class="overview-kpi-card__meter-fill" style=${`width:${metric.fill}`}></span>
            </div>
          </article>
        `,
      )}
    </section>
  `;
}

function renderOverviewHero(props: OverviewProps, nextSteps: OverviewStep[]) {
  const statusLabel = props.connected ? "Connected" : "Needs connection";
  const statusTone = props.connected ? "ok" : "warn";
  const enabledSkills = (props.skillsReport?.skills ?? []).filter(
    (skill) => !skill.disabled,
  ).length;
  const helloSnapshot =
    (props.hello?.snapshot as { channels?: Record<string, unknown> } | undefined) ?? undefined;
  const channelsReady = Object.values(helloSnapshot?.channels ?? {}).length;
  const summary = props.connected
    ? `System ready. ${enabledSkills} skill${enabledSkills === 1 ? "" : "s"} enabled${channelsReady ? ` · ${channelsReady} channel surface${channelsReady === 1 ? "" : "s"}` : ""}.`
    : "Connect the gateway first, then finish one channel and a few recommended skills.";
  const matrixNodes = [
    {
      label: uiLiteral("GW"),
      title: uiLiteral("Gateway"),
      status: props.connected ? uiLiteral("online") : uiLiteral("offline"),
      tone: props.connected ? "ok" : "warn",
    },
    {
      label: uiLiteral("CH"),
      title: uiLiteral("Channels"),
      status: channelsReady > 0 ? `${channelsReady} ready` : uiLiteral("unchecked"),
      tone: channelsReady > 0 ? "ok" : "warn",
    },
    {
      label: uiLiteral("SK"),
      title: uiLiteral("Skills"),
      status: `${enabledSkills} enabled`,
      tone: enabledSkills > 0 ? "stable" : "warn",
    },
    {
      label: uiLiteral("SE"),
      title: uiLiteral("Sessions"),
      status: `${props.sessionsResult?.count ?? 0} live`,
      tone: (props.sessionsResult?.count ?? 0) > 0 ? "info" : "warn",
    },
    {
      label: uiLiteral("CR"),
      title: uiLiteral("Cron"),
      status: props.cronEnabled === false ? uiLiteral("disabled") : uiLiteral("armed"),
      tone: props.cronEnabled === false ? "warn" : "ok",
    },
    {
      label: uiLiteral("FS"),
      title: uiLiteral("Feishu"),
      status: formatFeishuCliOverviewState(props),
      tone: props.feishuCliStatus?.authOk === false ? "warn" : "ok",
    },
    {
      label: uiLiteral("OB"),
      title: uiLiteral("Onboarding"),
      status: props.onboarding ? uiLiteral("guided") : uiLiteral("manual"),
      tone: props.onboarding ? "info" : "stable",
    },
    {
      label: uiLiteral("RT"),
      title: uiLiteral("Runtime"),
      status: props.connected ? uiLiteral("stable") : uiLiteral("pending"),
      tone: props.connected ? "ok" : "warn",
    },
  ];

  return html`
    <section class="overview-matrix card">
      <div class="overview-matrix__header">
        <div>
          <div class="overview-matrix__eyebrow">${t("overviewUi.hero.eyebrow")}</div>
          <h1 class="overview-matrix__title">${t("overviewUi.hero.title")}</h1>
          <p class="overview-matrix__summary">${summary}</p>
        </div>
        <div class="overview-matrix__status">
          <span class="label">${t("overviewUi.hero.statusLabel")}</span>
          <span class="overview-hero__status-pill ${statusTone}">${statusLabel}</span>
        </div>
      </div>
      <div class="overview-matrix__grid">
        <div class="overview-matrix__tiles">
          ${matrixNodes.map(
            (node) => html`
              <article class="overview-matrix-node overview-matrix-node--${node.tone}">
                <span class="overview-matrix-node__key mono">${node.label}</span>
                <strong class="overview-matrix-node__title">${node.title}</strong>
                <span class="overview-matrix-node__status">${node.status}</span>
              </article>
            `,
          )}
        </div>
        <div class="overview-matrix__rail">
          <div class="overview-matrix__quick-stats">
            <div>
              <span class="label">${t("overviewUi.hero.defaultSession")}</span>
              <strong>${props.settings.sessionKey}</strong>
            </div>
            <div>
              <span class="label">${t("tabs.channels")}</span>
              <strong>
                ${props.lastChannelsRefresh
                  ? t("overviewUi.hero.configured")
                  : t("overviewUi.hero.notChecked")}
              </strong>
            </div>
            <div>
              <span class="label">${t("overviewUi.hero.feishuUser")}</span>
              <strong>${formatFeishuCliOverviewState(props)}</strong>
            </div>
          </div>
          <div class="overview-matrix__actions">
            <button
              class="btn primary"
              @click=${() => (props.connected ? props.onNavigate("chat") : props.onConnect())}
            >
              ${props.connected
                ? t("overviewUi.actions.openChat")
                : t("overviewUi.actions.connectGateway")}
            </button>
            <button class="btn" @click=${() => props.onNavigate("channels")}>
              ${t("overviewUi.actions.openConnectCenter")}
            </button>
            <button class="btn" @click=${() => props.onNavigate("skills")}>
              ${t("overviewUi.actions.reviewSkills")}
            </button>
          </div>
        </div>
      </div>
      <div class="overview-matrix__steps">
        <div class="overview-matrix__steps-title">${t("overviewUi.hero.nextSteps")}</div>
        <div class="overview-hero__steps-grid">
          ${nextSteps.map(
            (step) => html`
              <article class="overview-step">
                <div class="overview-step__title">${step.title}</div>
                <div class="overview-step__description">${step.description}</div>
                ${step.action && step.actionLabel
                  ? html`
                      <button class="btn btn--sm" @click=${() => step.action?.()}>
                        ${step.actionLabel}
                      </button>
                    `
                  : nothing}
              </article>
            `,
          )}
        </div>
      </div>
    </section>
  `;
}

function currentSetupStepIndex(steps: SetupPathStep[]): number {
  const currentIndex = steps.findIndex((step) => step.status === "current");
  if (currentIndex >= 0) {
    return currentIndex;
  }
  const nextIndex = steps.findIndex((step) => step.status === "up-next");
  return nextIndex >= 0 ? nextIndex : Math.max(steps.length - 1, 0);
}

function buildOverviewSetupPath(props: OverviewProps): SetupPathStep[] {
  const helloSnapshot =
    (props.hello?.snapshot as { channels?: Record<string, unknown> } | undefined) ?? undefined;
  const configuredChannels = Object.keys(helloSnapshot?.channels ?? {}).length;
  const enabledSkills = (props.skillsReport?.skills ?? []).filter((skill) => !skill.disabled);
  const recommendedSkillsReady =
    enabledSkills.length > 0 && enabledSkills.every((skill) => skill.eligible);
  const hasSessions = (props.sessionsResult?.count ?? 0) > 0;
  const activeIndex = [
    !props.connected,
    !props.assistantName,
    configuredChannels === 0,
    !recommendedSkillsReady,
    !hasSessions,
  ].findIndex(Boolean);
  const currentIndex = activeIndex === -1 ? Number.POSITIVE_INFINITY : activeIndex;

  const resolveStatus = (index: number, done: boolean): SetupPathStep["status"] => {
    if (done) {
      return "done";
    }
    return index === currentIndex ? "current" : "up-next";
  };

  return [
    {
      title: t("overviewUi.setup.connectGatewayTitle"),
      description: t("overviewUi.setup.connectGatewayDescription"),
      status: resolveStatus(0, props.connected),
      actionLabel: props.connected
        ? t("overviewUi.status.connected")
        : t("overviewUi.actions.connectNow"),
      action: props.connected ? () => props.onNavigate("overview") : props.onConnect,
    },
    {
      title: t("overviewUi.setup.defaultAgentTitle"),
      description: props.assistantName
        ? t("overviewUi.setup.defaultAgentChosen", { name: props.assistantName })
        : t("overviewUi.setup.defaultAgentDescription"),
      status: resolveStatus(1, Boolean(props.assistantName)),
      actionLabel: t("overviewUi.actions.openAgents"),
      action: () => props.onNavigate("agents"),
    },
    {
      title: t("overviewUi.setup.oneChannelTitle"),
      description:
        configuredChannels > 0
          ? t("overviewUi.setup.oneChannelDone", { count: String(configuredChannels) })
          : t("overviewUi.setup.oneChannelDescription"),
      status: resolveStatus(2, configuredChannels > 0),
      actionLabel: t("overviewUi.actions.openConnectCenter"),
      action: () => props.onNavigate("channels"),
    },
    {
      title: "Turn on recommended skills",
      description: recommendedSkillsReady
        ? t("overviewUi.setup.skillsDone")
        : t("overviewUi.setup.skillsDescription"),
      status: resolveStatus(3, recommendedSkillsReady),
      actionLabel: t("overviewUi.actions.openSkills"),
      action: () => props.onNavigate("skills"),
    },
    {
      title: t("overviewUi.setup.testMessageTitle"),
      description: hasSessions
        ? t("overviewUi.setup.testMessageDone")
        : t("overviewUi.setup.testMessageDescription"),
      status: resolveStatus(4, hasSessions),
      actionLabel: t("overviewUi.actions.openChat"),
      action: () => props.onNavigate("chat"),
    },
  ];
}

function renderOverviewOnboardingWizard(props: OverviewProps) {
  const steps = buildOverviewSetupPath(props);
  const currentIndex = currentSetupStepIndex(steps);
  const current = steps[currentIndex];
  const rememberedCount = countRememberedOnboardingSteps(props.onboardingProgress);
  const rememberedStep = highestRememberedOnboardingStep(props.onboardingProgress);
  const finished = isOnboardingFinished(props.onboardingProgress);

  return html`
    <section class="overview-wizard card">
      <div class="overview-wizard__header">
        <div>
          <div class="overview-wizard__eyebrow">${t("overviewUi.wizard.eyebrow")}</div>
          <div class="card-title">${t("overviewUi.wizard.title")}</div>
          <div class="card-sub">${t("overviewUi.wizard.subtitle")}</div>
        </div>
        <div class="overview-wizard__progress">
          <span class="overview-wizard__progress-label"
            >${t("overviewUi.wizard.stepCount", {
              current: String(Math.min(currentIndex + 1, steps.length)),
              total: String(steps.length),
            })}</span
          >
          <strong>${current.title}</strong>
          <span class="muted"
            >${t("overviewUi.wizard.remembered", {
              count: String(rememberedCount),
              total: String(steps.length),
            })}${rememberedStep
              ? ` · ${t("overviewUi.wizard.lastCompleted", { step: rememberedStep })}`
              : ""}</span
          >
        </div>
      </div>
      <div class="row" style="justify-content: flex-end; gap: 8px; margin-top: 12px;">
        <button class="btn btn--sm" @click=${props.onPauseOnboarding}>
          ${t("overviewUi.actions.pauseGuide")}
        </button>
        ${finished
          ? html`
              <button class="btn btn--sm" @click=${props.onCompleteOnboarding}>
                ${t("overviewUi.actions.finishOnboarding")}
              </button>
            `
          : nothing}
      </div>
      <div class="overview-wizard__body">
        <div class="overview-wizard__rail">
          ${steps.map(
            (step, index) => html`
              <article class="overview-wizard-step overview-wizard-step--${step.status}">
                <div class="overview-wizard-step__index">${index + 1}</div>
                <div class="overview-wizard-step__copy">
                  <div class="overview-wizard-step__title">${step.title}</div>
                  <div class="overview-wizard-step__description">${step.description}</div>
                </div>
              </article>
            `,
          )}
        </div>
        <div class="overview-wizard__panel">
          <div class="overview-wizard__panel-eyebrow">${t("overviewUi.wizard.currentStep")}</div>
          <h2 class="overview-wizard__panel-title">${current.title}</h2>
          <p class="overview-wizard__panel-copy">${current.description}</p>
          <div class="overview-wizard__panel-actions">
            <button class="btn primary" @click=${() => current.action()}>
              ${current.actionLabel}
            </button>
            ${currentIndex + 1 < steps.length
              ? html`
                  <button class="btn" @click=${() => steps[currentIndex + 1]?.action()}>
                    ${t("overviewUi.actions.previewNext")}
                  </button>
                `
              : nothing}
          </div>
        </div>
      </div>
    </section>
  `;
}

function renderOverviewOnboardingState(props: OverviewProps) {
  const mode = props.onboardingProgress?.mode ?? "paused";
  if (mode === "guided") {
    return nothing;
  }
  const finished = isOnboardingFinished(props.onboardingProgress);
  if (mode === "completed") {
    return html`
      <section class="callout info" style="margin-bottom: 16px;">
        <div>
          <strong>${t("overviewUi.state.completeStrong")}</strong> ${t(
            "overviewUi.state.completeBody",
          )}
        </div>
        <div class="row" style="margin-top: 10px; gap: 8px;">
          <button class="btn btn--sm" @click=${props.onResumeOnboarding}>
            ${t("overviewUi.actions.resumeGuide")}
          </button>
          <button class="btn btn--sm" @click=${props.onRestartOnboarding}>
            ${t("overviewUi.actions.restartGuide")}
          </button>
        </div>
      </section>
    `;
  }
  return html`
    <section class="callout" style="margin-bottom: 16px;">
      <div>
        <strong>${t("overviewUi.state.pausedStrong")}</strong>
        ${finished ? t("overviewUi.state.pausedFinished") : t("overviewUi.state.pausedBody")}
      </div>
      <div class="row" style="margin-top: 10px; gap: 8px;">
        <button class="btn btn--sm" @click=${props.onResumeOnboarding}>
          ${t("overviewUi.actions.resumeGuide")}
        </button>
        <button class="btn btn--sm" @click=${props.onRestartOnboarding}>
          ${t("overviewUi.actions.restartGuide")}
        </button>
      </div>
    </section>
  `;
}

function renderOverviewSetupPath(props: OverviewProps) {
  const steps = buildOverviewSetupPath(props);
  return html`
    <section class="overview-setup card">
      <div class="overview-setup__header">
        <div>
          <div class="card-title">${t("overviewUi.setupPath.title")}</div>
          <div class="card-sub">${t("overviewUi.setupPath.subtitle")}</div>
        </div>
        <button class="btn btn--sm" @click=${() => props.onNavigate("channels")}>
          ${t("overviewUi.actions.openSetup")}
        </button>
      </div>
      <div class="overview-setup__grid">
        ${steps.map(
          (step, index) => html`
            <article class="overview-setup-step overview-setup-step--${step.status}">
              <div class="overview-setup-step__index">${index + 1}</div>
              <div class="overview-setup-step__body">
                <div class="overview-setup-step__meta">
                  <div class="overview-setup-step__title">${step.title}</div>
                  <span class="overview-setup-step__status">${step.status.replace("-", " ")}</span>
                </div>
                <div class="overview-setup-step__description">${step.description}</div>
                <button class="btn btn--sm" @click=${() => step.action()}>
                  ${step.actionLabel}
                </button>
              </div>
            </article>
          `,
        )}
      </div>
    </section>
  `;
}
