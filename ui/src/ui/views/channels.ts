import { html, nothing } from "lit";
import { t } from "../../i18n/index.ts";
import { formatRelativeTimestamp } from "../format.ts";
import { countRememberedOnboardingSteps, isOnboardingFinished } from "../onboarding-progress.ts";
import type {
  ChannelAccountSnapshot,
  ChannelUiMetaEntry,
  ChannelsStatusSnapshot,
  DiscordStatus,
  FeishuCliStatusSnapshot,
  GoogleChatStatus,
  IMessageStatus,
  NostrProfile,
  NostrStatus,
  SignalStatus,
  SlackStatus,
  TelegramStatus,
  WhatsAppStatus,
} from "../types.ts";
import { uiLiteral } from "../ui-literal.ts";
import { renderChannelConfigSection } from "./channels.config.ts";
import { renderDiscordCard } from "./channels.discord.ts";
import { renderGoogleChatCard } from "./channels.googlechat.ts";
import { renderIMessageCard } from "./channels.imessage.ts";
import { renderNostrCard } from "./channels.nostr.ts";
import {
  channelEnabled,
  formatNullableBoolean,
  renderChannelAccountCount,
  resolveChannelDisplayState,
} from "./channels.shared.ts";
import { renderSignalCard } from "./channels.signal.ts";
import { renderSlackCard } from "./channels.slack.ts";
import { renderTelegramCard } from "./channels.telegram.ts";
import type { ChannelKey, ChannelsChannelData, ChannelsProps } from "./channels.types.ts";
import { renderWhatsAppCard } from "./channels.whatsapp.ts";

export function renderChannels(props: ChannelsProps) {
  const uiMode = props.uiMode === "advanced" ? "advanced" : "simple";
  const channels = props.snapshot?.channels as Record<string, unknown> | null;
  const whatsapp = (channels?.whatsapp ?? undefined) as WhatsAppStatus | undefined;
  const telegram = (channels?.telegram ?? undefined) as TelegramStatus | undefined;
  const discord = (channels?.discord ?? null) as DiscordStatus | null;
  const googlechat = (channels?.googlechat ?? null) as GoogleChatStatus | null;
  const slack = (channels?.slack ?? null) as SlackStatus | null;
  const signal = (channels?.signal ?? null) as SignalStatus | null;
  const imessage = (channels?.imessage ?? null) as IMessageStatus | null;
  const nostr = (channels?.nostr ?? null) as NostrStatus | null;
  const channelOrder = resolveChannelOrder(props.snapshot);
  const orderedChannels = channelOrder
    .map((key, index) => ({
      key,
      enabled: channelEnabled(key, props),
      order: index,
    }))
    .toSorted((a, b) => {
      if (a.enabled !== b.enabled) {
        return a.enabled ? -1 : 1;
      }
      return a.order - b.order;
    });
  const activeChannels = orderedChannels.filter((channel) => {
    const state = resolveChannelDisplayState(channel.key, props);
    return state.connected || state.running;
  }).length;
  const enabledChannels = orderedChannels.filter((channel) => channel.enabled).length;
  const accountCount = Object.values(props.snapshot?.channelAccounts ?? {}).reduce(
    (total, accounts) => total + (Array.isArray(accounts) ? accounts.length : 0),
    0,
  );
  const gatewayProbeState = props.loading
    ? uiLiteral("Refreshing")
    : props.lastError
      ? uiLiteral("Attention")
      : props.lastSuccessAt
        ? uiLiteral("Recent")
        : uiLiteral("Pending");
  const whatsappFlowState = props.whatsappBusy
    ? uiLiteral("Working")
    : props.whatsappConnected === true
      ? uiLiteral("Linked")
      : props.whatsappQrDataUrl
        ? uiLiteral("QR ready")
        : props.whatsappMessage
          ? uiLiteral("Waiting")
          : uiLiteral("Idle");
  const feishuFlowState =
    props.feishuCliSupported === false
      ? uiLiteral("Unavailable")
      : props.feishuCliStatus?.authOk
        ? uiLiteral("Ready")
        : props.feishuCliStatus
          ? uiLiteral("Needs auth")
          : props.feishuCliError
            ? uiLiteral("Attention")
            : uiLiteral("Pending");
  const configState = props.configSaving
    ? uiLiteral("Saving")
    : props.configFormDirty
      ? uiLiteral("Apply required")
      : uiLiteral("In sync");
  const loginSurface =
    props.feishuCliSupported === false
      ? uiLiteral("WhatsApp only")
      : props.feishuCliSupported
        ? uiLiteral("WhatsApp + Feishu CLI")
        : uiLiteral("Capability probe");
  const snapshotState = props.loading
    ? uiLiteral("Refreshing")
    : props.lastSuccessAt
      ? uiLiteral("Live snapshot")
      : uiLiteral("No snapshot yet");
  const channelData: ChannelsChannelData = {
    whatsapp,
    telegram,
    discord,
    googlechat,
    slack,
    signal,
    imessage,
    nostr,
    channelAccounts: props.snapshot?.channelAccounts ?? null,
  };
  const primaryChannel =
    orderedChannels.find((channel) => {
      const state = resolveChannelDisplayState(channel.key, props);
      return state.connected || state.running || state.configured;
    }) ??
    orderedChannels[0] ??
    null;

  return html`
    <section class="control-console-stage control-console-stage--channels">
      <section class="control-console-head">
        <div class="control-console-head__top">
          <div class="control-console-head__copy">
            <div class="control-console-head__eyebrow">
              ${uiLiteral("CrawClaw console / channels_infrastructure")}
            </div>
            <h1 class="control-console-head__title">
              ${uiLiteral("Channels infrastructure console")}
            </h1>
            <p class="control-console-head__summary">
              ${uiLiteral(
                "Monitor live delivery units, login capability, routing readiness, and config-backed channel state from a registry-style infrastructure console.",
              )}
            </p>
          </div>
          <div class="control-console-head__actions">
            <button class="btn" ?disabled=${props.loading} @click=${props.onRefresh}>
              ${props.loading ? uiLiteral("Refreshing…") : uiLiteral("Refresh snapshot")}
            </button>
          </div>
        </div>
        <div class="control-console-head__meta">
          <div class="control-console-head__meta-card">
            <span class="control-console-head__meta-label">${uiLiteral("Gateway")}</span>
            <strong class="control-console-head__meta-value"
              >${props.connected ? t("channelsPage.connected") : t("common.offline")}</strong
            >
            <span class="control-console-head__meta-note"
              >${props.gatewayUrl || t("common.na")}</span
            >
          </div>
          <div class="control-console-head__meta-card">
            <span class="control-console-head__meta-label">${uiLiteral("Snapshot")}</span>
            <strong class="control-console-head__meta-value">${snapshotState}</strong>
            <span class="control-console-head__meta-note"
              >${props.lastSuccessAt
                ? formatRelativeTimestamp(props.lastSuccessAt)
                : uiLiteral("Waiting for the first probe")}</span
            >
          </div>
          <div class="control-console-head__meta-card">
            <span class="control-console-head__meta-label">${uiLiteral("Login surface")}</span>
            <strong class="control-console-head__meta-value">${loginSurface}</strong>
            <span class="control-console-head__meta-note"
              >${uiLiteral("Capability-gated login flows stay inside this panel.")}</span
            >
          </div>
          <div class="control-console-head__meta-card">
            <span class="control-console-head__meta-label">${uiLiteral("Config write path")}</span>
            <strong class="control-console-head__meta-value">${configState}</strong>
            <span class="control-console-head__meta-note"
              >${uiLiteral("Patch for form edits, apply to sync runtime.")}</span
            >
          </div>
        </div>
      </section>

      <section class="channels-stitch-shell">
        <div class="channels-kpi-band">
          <div class="channels-kpi-card">
            <span class="channels-kpi-card__label">${uiLiteral("Active channels")}</span>
            <strong class="channels-kpi-card__value">${activeChannels}</strong>
            <span class="channels-kpi-card__meta">${uiLiteral("Live delivery units")}</span>
          </div>
          <div class="channels-kpi-card channels-kpi-card--warn">
            <span class="channels-kpi-card__label">${uiLiteral("Critical health")}</span>
            <strong class="channels-kpi-card__value">${enabledChannels - activeChannels}</strong>
            <span class="channels-kpi-card__meta"
              >${uiLiteral("Enabled surfaces needing attention")}</span
            >
          </div>
          <div class="channels-kpi-card channels-kpi-card--stable">
            <span class="channels-kpi-card__label">${uiLiteral("Delivery rate")}</span>
            <strong class="channels-kpi-card__value"
              >${enabledChannels > 0
                ? `${Math.round((activeChannels / Math.max(enabledChannels, 1)) * 100)}%`
                : "0%"}</strong
            >
            <span class="channels-kpi-card__meta">${gatewayProbeState}</span>
          </div>
          <div class="channels-kpi-card channels-kpi-card--info">
            <span class="channels-kpi-card__label">${uiLiteral("Configured accounts")}</span>
            <strong class="channels-kpi-card__value">${accountCount}</strong>
            <span class="channels-kpi-card__meta">${configState}</span>
          </div>
        </div>

        <div class="channels-ops-band">
          <div class="channels-ops-band__card">
            <span class="channels-ops-band__label">${uiLiteral("Gateway probe")}</span>
            <strong class="channels-ops-band__value">${gatewayProbeState}</strong>
            <span class="channels-ops-band__meta">
              ${props.lastSuccessAt
                ? formatRelativeTimestamp(props.lastSuccessAt)
                : uiLiteral("No snapshot yet")}
            </span>
          </div>
          <div class="channels-ops-band__card">
            <span class="channels-ops-band__label">${uiLiteral("WhatsApp login")}</span>
            <strong class="channels-ops-band__value">${whatsappFlowState}</strong>
            <span class="channels-ops-band__meta">
              ${props.whatsappMessage ?? uiLiteral("No active login flow")}
            </span>
          </div>
          <div class="channels-ops-band__card">
            <span class="channels-ops-band__label">${uiLiteral("Feishu CLI")}</span>
            <strong class="channels-ops-band__value">${feishuFlowState}</strong>
            <span class="channels-ops-band__meta">
              ${props.feishuCliError ??
              props.feishuCliStatus?.message ??
              uiLiteral("Capability summary only")}
            </span>
          </div>
          <div class="channels-ops-band__card">
            <span class="channels-ops-band__label">${uiLiteral("Config state")}</span>
            <strong class="channels-ops-band__value">${configState}</strong>
            <span class="channels-ops-band__meta">
              ${props.configSchemaLoading
                ? uiLiteral("Loading schema")
                : props.configFormDirty
                  ? uiLiteral("Unsaved channel edits pending")
                  : uiLiteral("Channel config is aligned with runtime")}
            </span>
          </div>
        </div>

        ${props.lastError ? html`<div class="callout danger">${props.lastError}</div>` : nothing}

        <div class="channels-stitch-grid">
          <div class="channels-stitch-grid__main">
            <section class="channels-registry-shell">
              <div class="channels-registry-shell__toolbar">
                <div class="channels-registry-shell__filters">
                  <button class="channels-registry-filter channels-registry-filter--active">
                    ${uiLiteral("All types")}
                  </button>
                  <span class="channels-registry-status">${uiLiteral("Status: Live")}</span>
                </div>
                <div class="channels-registry-shell__search">
                  <span class="material-symbols-outlined">search</span>
                  <span>${uiLiteral("Search channels")}</span>
                </div>
              </div>
              <div class="channels-registry-table">
                <div class="channels-registry-table__head">
                  <span>${uiLiteral("Channel / type")}</span>
                  <span>${uiLiteral("Account state")}</span>
                  <span>${uiLiteral("Delivery state")}</span>
                  <span>${uiLiteral("Health")}</span>
                  <span>${uiLiteral("Last heartbeat")}</span>
                  <span>${uiLiteral("Readiness")}</span>
                  <span>${uiLiteral("Actions")}</span>
                </div>
                <div class="channels-registry-table__body">
                  ${orderedChannels.map((channel) =>
                    renderChannelRegistryRow(channel.key, props, channelData),
                  )}
                </div>
              </div>
            </section>

            ${props.onboarding
              ? renderConnectCenterGuide(props)
              : renderConnectCenterGuideState(props)}
          </div>

          <aside class="channels-stitch-grid__rail">
            ${primaryChannel
              ? html`
                  <section class="channels-selected-shell card">
                    <div class="channels-selected-shell__header">
                      <div>
                        <div class="channels-selected-shell__eyebrow">
                          ${uiLiteral("Selected unit: details")}
                        </div>
                        <div class="card-title">
                          ${resolveChannelLabel(props.snapshot, primaryChannel.key)}
                        </div>
                        <div class="card-sub">
                          ${resolveChannelTypeLabel(primaryChannel.key)} ·
                          ${renderChannelStateLabel(primaryChannel.key, props)}
                        </div>
                      </div>
                      <span class="agent-pill">${uiLiteral("Primary")}</span>
                    </div>
                    <div class="channels-selected-shell__stats">
                      <div>
                        <span class="label">${uiLiteral("Instance id")}</span>
                        <strong>${primaryChannel.key.toUpperCase()}</strong>
                      </div>
                      <div>
                        <span class="label">${uiLiteral("Accounts")}</span>
                        <strong
                          >${renderChannelAccountCount(
                            primaryChannel.key,
                            channelData.channelAccounts,
                          )}</strong
                        >
                      </div>
                      <div>
                        <span class="label">${uiLiteral("Login surface")}</span>
                        <strong>${loginSurface}</strong>
                      </div>
                      <div>
                        <span class="label">${uiLiteral("Last snapshot")}</span>
                        <strong
                          >${props.lastSuccessAt
                            ? formatRelativeTimestamp(props.lastSuccessAt)
                            : uiLiteral("Pending")}</strong
                        >
                      </div>
                    </div>
                    <div class="channels-selected-shell__workbench">
                      ${renderChannel(primaryChannel.key, props, channelData)}
                    </div>
                  </section>
                `
              : nothing}
            <section class="card channels-rail-shell">
              <div class="card-title">${uiLiteral("Gateway connection")}</div>
              <div class="card-sub">
                ${uiLiteral("This is the live control-plane connection serving the dashboard.")}
              </div>
              <div class="status-list" style="margin-top: 16px;">
                <div>
                  <span class="label">${uiLiteral("Status")}</span>
                  <span>${props.connected ? uiLiteral("Connected") : uiLiteral("Offline")}</span>
                </div>
                <div>
                  <span class="label">${uiLiteral("Address")}</span>
                  <span class="mono">${props.gatewayUrl || "n/a"}</span>
                </div>
                <div>
                  <span class="label">${uiLiteral("Channel probe")}</span>
                  <span>${props.lastSuccessAt ? uiLiteral("Recent") : uiLiteral("Pending")}</span>
                </div>
                <div>
                  <span class="label">${uiLiteral("Config schema")}</span>
                  <span
                    >${props.configSchemaLoading ? uiLiteral("Loading") : uiLiteral("Ready")}</span
                  >
                </div>
              </div>
            </section>
            ${renderFeishuCliCard(props)}
            ${uiMode === "advanced"
              ? renderChannelHealthSnapshot(props)
              : html`
                  <details class="card connect-center__details">
                    <summary class="connect-center__details-summary">
                      ${t("channelsPage.advancedSnapshot")}
                    </summary>
                    <div class="connect-center__details-body">
                      ${renderChannelHealthSnapshot(props)}
                    </div>
                  </details>
                `}
          </aside>
        </div>
      </section>
    </section>
  `;
}

function renderConnectCenterGuideState(props: ChannelsProps) {
  const mode = props.onboardingProgress?.mode ?? "paused";
  if (mode === "guided") {
    return nothing;
  }
  const finished = isOnboardingFinished(props.onboardingProgress);
  return html`
    <section class="connect-center__guide">
      <div class="connect-center__guide-copy">
        <div class="connect-center__guide-eyebrow">
          ${mode === "completed"
            ? t("channelsPage.guideState.completeEyebrow")
            : t("channelsPage.guideState.pausedEyebrow")}
        </div>
        <div class="connect-center__guide-title">
          ${mode === "completed"
            ? t("channelsPage.guideState.completeTitle")
            : t("channelsPage.guideState.pausedTitle")}
        </div>
        <div class="connect-center__guide-summary">
          ${finished
            ? t("channelsPage.guideState.completeSummary")
            : t("channelsPage.guideState.pausedSummary")}
        </div>
      </div>
      <div class="connect-center__guide-actions">
        <button class="btn primary" @click=${props.onResumeOnboarding}>
          ${t("channelsPage.actions.resumeGuide")}
        </button>
        <button class="btn" @click=${props.onRestartOnboarding}>
          ${t("channelsPage.actions.restartGuide")}
        </button>
      </div>
    </section>
  `;
}

function countConfiguredChannelSurfaces(props: ChannelsProps): number {
  const order = resolveChannelOrder(props.snapshot);
  return order.filter((key) => resolveChannelDisplayState(key, props).configured).length;
}

function renderConnectCenterGuide(props: ChannelsProps) {
  const configuredChannels = countConfiguredChannelSurfaces(props);
  const rememberedCount = countRememberedOnboardingSteps(props.onboardingProgress);
  let title = t("channelsPage.guide.step1Title");
  let summary = t("channelsPage.guide.step1Summary");
  let primaryLabel = props.connected
    ? t("channelsPage.actions.refreshConnection")
    : t("channelsPage.actions.connectNow");
  let primaryAction = () => {
    if (props.connected) {
      props.onRefresh(true);
      return;
    }
    props.onNavigate("overview");
  };
  let secondaryLabel = t("channelsPage.actions.backToOverview");
  let secondaryAction = () => props.onNavigate("overview");

  if (props.connected && configuredChannels === 0) {
    title = t("channelsPage.guide.step3Title");
    summary = t("channelsPage.guide.step3Summary");
    primaryLabel = t("channelsPage.actions.refreshChannels");
    primaryAction = () => props.onRefresh(true);
    secondaryLabel = t("channelsPage.actions.openSkillsNext");
    secondaryAction = () => props.onNavigate("skills");
  } else if (props.connected && configuredChannels > 0) {
    title = t("channelsPage.guide.readyTitle");
    summary = t("channelsPage.guide.readySummary");
    primaryLabel = t("channelsPage.actions.openSkills");
    primaryAction = () => props.onNavigate("skills");
    secondaryLabel = t("channelsPage.actions.returnToOverview");
    secondaryAction = () => props.onNavigate("overview");
  }

  return html`
    <section class="connect-center__guide">
      <div class="connect-center__guide-copy">
        <div class="connect-center__guide-eyebrow">${t("channelsPage.guide.eyebrow")}</div>
        <div class="connect-center__guide-title">${title}</div>
        <div class="connect-center__guide-summary">${summary}</div>
      </div>
      <div class="connect-center__guide-metrics">
        <div>
          <span class="label">${t("channelsPage.guideStats.gateway")}</span>
          <strong>${props.connected ? t("channelsPage.connected") : t("common.offline")}</strong>
        </div>
        <div>
          <span class="label">${t("channelsPage.guideStats.channelsReady")}</span>
          <strong>${configuredChannels}</strong>
        </div>
        <div>
          <span class="label">${t("channelsPage.guideStats.feishuUser")}</span>
          <strong>${formatFeishuCliAuth(props.feishuCliStatus)}</strong>
        </div>
        <div>
          <span class="label">${t("channelsPage.guideStats.remembered")}</span>
          <strong>${rememberedCount}/5</strong>
        </div>
      </div>
      <div class="connect-center__guide-actions">
        <button class="btn primary" @click=${primaryAction}>${primaryLabel}</button>
        <button class="btn" @click=${secondaryAction}>${secondaryLabel}</button>
      </div>
    </section>
  `;
}

function formatFeishuCliState(
  status: FeishuCliStatusSnapshot | null,
  supported: boolean | null,
  loading: boolean,
): string {
  if (loading && !status) {
    return t("channelsPage.feishu.loading");
  }
  if (supported === false) {
    return t("channelsPage.feishu.notLoaded");
  }
  if (!status) {
    return t("channelsPage.feishu.noSnapshot");
  }
  return status.status.replaceAll("_", " ");
}

function formatFeishuCliAuth(status: FeishuCliStatusSnapshot | null): string {
  if (!status || !status.installed) {
    return t("common.na");
  }
  return status.authOk ? t("channelsPage.feishu.ready") : t("channelsPage.feishu.missing");
}

function renderFeishuCliCard(props: ChannelsProps) {
  const uiMode = props.uiMode === "advanced" ? "advanced" : "simple";
  const status = props.feishuCliStatus;
  const state = formatFeishuCliState(status, props.feishuCliSupported, props.loading);
  const installed = status
    ? status.installed
      ? t("cron.summary.yes")
      : t("cron.summary.no")
    : props.feishuCliSupported === false
      ? t("channelsPage.feishu.pluginMissing")
      : t("common.na");
  const command = status?.command ?? "lark-cli";
  const lastRefresh = props.feishuCliLastSuccessAt
    ? formatRelativeTimestamp(props.feishuCliLastSuccessAt)
    : t("common.na");
  const informationalMessage =
    status?.message ??
    (props.feishuCliSupported === false ? t("channelsPage.feishu.pluginNotLoaded") : null);
  const nextSteps =
    props.feishuCliSupported === false
      ? [
          "Enable plugins.entries.feishu-cli.enabled = true",
          "Restart the gateway",
          "Run crawclaw feishu-cli status",
        ]
      : !status
        ? ["Run crawclaw feishu-cli status --verify"]
        : !status.installed
          ? [`Install ${command}`, "Run crawclaw feishu-cli status"]
          : !status.authOk
            ? ["Run crawclaw feishu-cli auth login", "Run crawclaw feishu-cli status --verify"]
            : [
                "Config: plugins.entries.feishu-cli.config",
                "Run crawclaw feishu-cli status --verify",
              ];

  return html`
    <div class="card">
      <div class="card-title">${t("channelsPage.feishu.title")}</div>
      <div class="card-sub">${t("channelsPage.feishu.subtitle")}</div>
      <div class="status-list" style="margin-top: 16px;">
        <div>
          <span class="label">${t("channelsPage.feishu.state")}</span>
          <span>${state}</span>
        </div>
        <div>
          <span class="label">${t("channelsPage.feishu.identity")}</span>
          <span>${status?.identity ?? t("channelsPage.feishu.userIdentity")}</span>
        </div>
        <div>
          <span class="label">${t("channelsPage.feishu.installed")}</span>
          <span>${installed}</span>
        </div>
        <div>
          <span class="label">${t("channelsPage.feishu.auth")}</span>
          <span>${formatFeishuCliAuth(status)}</span>
        </div>
        <div>
          <span class="label">${t("channelsPage.feishu.command")}</span>
          <span>${command}</span>
        </div>
        <div>
          <span class="label">${t("channelsPage.feishu.profile")}</span>
          <span>${status?.profile ?? t("channelsPage.feishu.defaultProfile")}</span>
        </div>
        <div>
          <span class="label">${t("common.version")}</span>
          <span>${status?.version ?? t("common.na")}</span>
        </div>
        <div>
          <span class="label">${t("channelsPage.meta.lastRefresh")}</span>
          <span>${lastRefresh}</span>
        </div>
      </div>
      ${props.feishuCliError
        ? html`<div class="callout danger" style="margin-top: 12px;">${props.feishuCliError}</div>`
        : nothing}
      ${!props.feishuCliError && informationalMessage
        ? html`<div class="callout info" style="margin-top: 12px;">${informationalMessage}</div>`
        : nothing}
      ${status?.hint
        ? html`<div class="callout warn" style="margin-top: 12px;">${status.hint}</div>`
        : nothing}
      <div class="callout info" style="margin-top: 12px;">
        <div><strong>${t("channelsPage.feishu.nextSteps")}</strong></div>
        <div class="muted" style="margin-top: 6px;">
          ${nextSteps.map(
            (step, index) =>
              html`<div>
                <span class="mono">${index + 1}.</span> <span class="mono">${step}</span>
              </div>`,
          )}
        </div>
      </div>
      ${uiMode === "advanced"
        ? html`<pre class="code-block" style="margin-top: 12px;">
${status?.raw !== undefined
              ? JSON.stringify(status.raw, null, 2)
              : props.feishuCliSupported === false
                ? t("channelsPage.feishu.pluginNotLoadedShort")
                : t("channelsPage.feishu.noPayload")}
      </pre
          >`
        : nothing}
    </div>
  `;
}

function renderChannelHealthSnapshot(props: ChannelsProps) {
  return html`
    <section class="card" style="margin-top: 18px;">
      <div class="row" style="justify-content: space-between;">
        <div>
          <div class="card-title">${t("channelsPage.health.title")}</div>
          <div class="card-sub">${t("channelsPage.health.subtitle")}</div>
        </div>
        <div class="muted">
          ${props.lastSuccessAt ? formatRelativeTimestamp(props.lastSuccessAt) : t("common.na")}
        </div>
      </div>
      ${props.lastError
        ? html`<div class="callout danger" style="margin-top: 12px;">${props.lastError}</div>`
        : nothing}
      <pre class="code-block" style="margin-top: 12px;">
${props.snapshot ? JSON.stringify(props.snapshot, null, 2) : t("channelsPage.health.noSnapshot")}
      </pre
      >
    </section>
  `;
}

function resolveChannelOrder(snapshot: ChannelsStatusSnapshot | null): ChannelKey[] {
  if (snapshot?.channelMeta?.length) {
    return snapshot.channelMeta.map((entry) => entry.id);
  }
  if (snapshot?.channelOrder?.length) {
    return snapshot.channelOrder;
  }
  return ["whatsapp", "telegram", "discord", "googlechat", "slack", "signal", "imessage", "nostr"];
}

function resolveChannelTypeLabel(key: ChannelKey): string {
  switch (key) {
    case "whatsapp":
      return uiLiteral("WhatsApp business");
    case "telegram":
      return uiLiteral("Telegram API");
    case "discord":
      return uiLiteral("Discord webhook");
    case "googlechat":
      return uiLiteral("Google Chat");
    case "slack":
      return uiLiteral("Slack enterprise");
    case "signal":
      return uiLiteral("Signal bridge");
    case "imessage":
      return uiLiteral("iMessage relay");
    case "nostr":
      return uiLiteral("Nostr relay");
    default:
      return uiLiteral("Channel surface");
  }
}

function renderChannelStateLabel(key: ChannelKey, props: ChannelsProps): string {
  const state = resolveChannelDisplayState(key, props);
  if (state.connected) {
    return uiLiteral("Connected");
  }
  if (state.running) {
    return uiLiteral("Authenticating");
  }
  if (state.configured) {
    return uiLiteral("Configured");
  }
  return uiLiteral("Unavailable");
}

function renderChannelHealthValue(key: ChannelKey, props: ChannelsProps): string {
  const state = resolveChannelDisplayState(key, props);
  if (state.connected) {
    return "100%";
  }
  if (state.running) {
    return "45%";
  }
  if (state.configured) {
    return "72%";
  }
  return "12%";
}

function renderChannelReadinessLabel(key: ChannelKey, props: ChannelsProps): string {
  const state = resolveChannelDisplayState(key, props);
  if (state.connected) {
    return uiLiteral("Check circle");
  }
  if (state.running) {
    return uiLiteral("Pending");
  }
  return uiLiteral("Unavailable");
}

function renderChannelActionLabel(key: ChannelKey, props: ChannelsProps): string {
  if (key === "whatsapp") {
    return uiLiteral("Login start");
  }
  if (key === "telegram" && props.feishuCliSupported !== false) {
    return uiLiteral("Waiting…");
  }
  if (key === "discord" || key === "googlechat" || key === "slack") {
    return uiLiteral("View config");
  }
  return uiLiteral("Inspect");
}

function renderChannelRegistryRow(
  key: ChannelKey,
  props: ChannelsProps,
  data: ChannelsChannelData,
) {
  const label = resolveChannelLabel(props.snapshot, key);
  const state = resolveChannelDisplayState(key, props);
  const lastHeartbeat = props.lastSuccessAt
    ? new Date(props.lastSuccessAt).toLocaleString()
    : uiLiteral("No snapshot yet");
  const accountCount = Array.isArray(data.channelAccounts?.[key])
    ? (data.channelAccounts?.[key].length ?? 0)
    : 0;
  const statusTone = state.connected
    ? "channels-registry-row__dot--ok"
    : state.running
      ? "channels-registry-row__dot--warn"
      : "channels-registry-row__dot--danger";
  return html`
    <div class="channels-registry-row">
      <div class="channels-registry-row__channel">
        <div class="channels-registry-row__icon">${label.slice(0, 2).toUpperCase()}</div>
        <div class="channels-registry-row__copy">
          <strong>${label}</strong>
          <span>${resolveChannelTypeLabel(key)}</span>
        </div>
      </div>
      <div class="channels-registry-row__metric">
        <span class="channels-registry-row__dot ${statusTone}"></span>
        <strong>${renderChannelStateLabel(key, props)}</strong>
        <span>${accountCount} ${uiLiteral("accounts")}</span>
      </div>
      <div class="channels-registry-row__metric">
        <strong>
          ${state.connected
            ? uiLiteral("Optimal")
            : state.running
              ? uiLiteral("Queueing…")
              : state.configured
                ? uiLiteral("Waiting…")
                : uiLiteral("Connection lost")}
        </strong>
        <span
          >${state.configured ? uiLiteral("Manifest ready") : uiLiteral("Manifest missing")}</span
        >
      </div>
      <div class="channels-registry-row__metric">
        <strong>${renderChannelHealthValue(key, props)}</strong>
        <span>${state.connected ? uiLiteral("Capacity") : uiLiteral("Recovery lane")}</span>
      </div>
      <div class="channels-registry-row__heartbeat">
        <span>${lastHeartbeat}</span>
        <span
          >${props.lastSuccessAt
            ? formatRelativeTimestamp(props.lastSuccessAt)
            : uiLiteral("Pending")}</span
        >
      </div>
      <div class="channels-registry-row__metric">
        <strong>${renderChannelReadinessLabel(key, props)}</strong>
        <span
          >${state.connected ? uiLiteral("Ready") : uiLiteral("Requires operator attention")}</span
        >
      </div>
      <div class="channels-registry-row__actions">
        <button class="btn btn--sm">${renderChannelActionLabel(key, props)}</button>
      </div>
    </div>
  `;
}

function renderChannel(key: ChannelKey, props: ChannelsProps, data: ChannelsChannelData) {
  const accountCountLabel = renderChannelAccountCount(key, data.channelAccounts);
  switch (key) {
    case "whatsapp":
      return renderWhatsAppCard({
        props,
        whatsapp: data.whatsapp,
        accountCountLabel,
      });
    case "telegram":
      return renderTelegramCard({
        props,
        telegram: data.telegram,
        telegramAccounts: data.channelAccounts?.telegram ?? [],
        accountCountLabel,
      });
    case "discord":
      return renderDiscordCard({
        props,
        discord: data.discord,
        accountCountLabel,
      });
    case "googlechat":
      return renderGoogleChatCard({
        props,
        googleChat: data.googlechat,
        accountCountLabel,
      });
    case "slack":
      return renderSlackCard({
        props,
        slack: data.slack,
        accountCountLabel,
      });
    case "signal":
      return renderSignalCard({
        props,
        signal: data.signal,
        accountCountLabel,
      });
    case "imessage":
      return renderIMessageCard({
        props,
        imessage: data.imessage,
        accountCountLabel,
      });
    case "nostr": {
      const nostrAccounts = data.channelAccounts?.nostr ?? [];
      const primaryAccount = nostrAccounts[0];
      const accountId = primaryAccount?.accountId ?? "default";
      const profile =
        (primaryAccount as { profile?: NostrProfile | null } | undefined)?.profile ?? null;
      const showForm =
        props.nostrProfileAccountId === accountId ? props.nostrProfileFormState : null;
      const profileFormCallbacks = showForm
        ? {
            onFieldChange: props.onNostrProfileFieldChange,
            onSave: props.onNostrProfileSave,
            onImport: props.onNostrProfileImport,
            onCancel: props.onNostrProfileCancel,
            onToggleAdvanced: props.onNostrProfileToggleAdvanced,
          }
        : null;
      return renderNostrCard({
        props,
        nostr: data.nostr,
        nostrAccounts,
        accountCountLabel,
        profileFormState: showForm,
        profileFormCallbacks,
        onEditProfile: () => props.onNostrProfileEdit(accountId, profile),
      });
    }
    default:
      return renderGenericChannelCard(key, props, data.channelAccounts ?? {});
  }
}

function renderGenericChannelCard(
  key: ChannelKey,
  props: ChannelsProps,
  channelAccounts: Record<string, ChannelAccountSnapshot[]>,
) {
  const label = resolveChannelLabel(props.snapshot, key);
  const displayState = resolveChannelDisplayState(key, props);
  const lastError =
    typeof displayState.status?.lastError === "string" ? displayState.status.lastError : undefined;
  const accounts = channelAccounts[key] ?? [];
  const accountCountLabel = renderChannelAccountCount(key, channelAccounts);

  return html`
    <div class="card">
      <div class="card-title">${label}</div>
      <div class="card-sub">${t("channelsPage.generic.subtitle")}</div>
      ${accountCountLabel}
      ${accounts.length > 0
        ? html`
            <div class="account-card-list">
              ${accounts.map((account) => renderGenericAccount(account))}
            </div>
          `
        : html`
            <div class="status-list" style="margin-top: 16px;">
              <div>
                <span class="label">${t("channelsPage.generic.configured")}</span>
                <span>${formatNullableBoolean(displayState.configured)}</span>
              </div>
              <div>
                <span class="label">${t("channelsPage.generic.running")}</span>
                <span>${formatNullableBoolean(displayState.running)}</span>
              </div>
              <div>
                <span class="label">${t("channelsPage.connected")}</span>
                <span>${formatNullableBoolean(displayState.connected)}</span>
              </div>
            </div>
          `}
      ${lastError
        ? html`<div class="callout danger" style="margin-top: 12px;">${lastError}</div>`
        : nothing}
      ${renderChannelConfigSection({ channelId: key, props })}
    </div>
  `;
}

function resolveChannelMetaMap(
  snapshot: ChannelsStatusSnapshot | null,
): Record<string, ChannelUiMetaEntry> {
  if (!snapshot?.channelMeta?.length) {
    return {};
  }
  return Object.fromEntries(snapshot.channelMeta.map((entry) => [entry.id, entry]));
}

function resolveChannelLabel(snapshot: ChannelsStatusSnapshot | null, key: string): string {
  const meta = resolveChannelMetaMap(snapshot)[key];
  return meta?.label ?? snapshot?.channelLabels?.[key] ?? key;
}

const RECENT_ACTIVITY_THRESHOLD_MS = 10 * 60 * 1000; // 10 minutes

function hasRecentActivity(account: ChannelAccountSnapshot): boolean {
  if (!account.lastInboundAt) {
    return false;
  }
  return Date.now() - account.lastInboundAt < RECENT_ACTIVITY_THRESHOLD_MS;
}

function deriveRunningStatus(account: ChannelAccountSnapshot): "Yes" | "No" | "Active" {
  if (account.running) {
    return "Yes";
  }
  // If we have recent inbound activity, the channel is effectively running
  if (hasRecentActivity(account)) {
    return "Active";
  }
  return "No";
}

function deriveConnectedStatus(account: ChannelAccountSnapshot): "Yes" | "No" | "Active" | "n/a" {
  if (account.connected === true) {
    return "Yes";
  }
  if (account.connected === false) {
    return "No";
  }
  // If connected is null/undefined but we have recent activity, show as active
  if (hasRecentActivity(account)) {
    return "Active";
  }
  return "n/a";
}

export function formatStreamingState(account: ChannelAccountSnapshot): string {
  if (!account.streaming || typeof account.streaming.enabled !== "boolean") {
    return "n/a";
  }
  const mode = account.streaming.enabled ? "Streaming" : "Fallback";
  const surface = account.streaming.surface ?? "unknown";
  const reason = (account.streaming.reason ?? "unknown").replaceAll("_", " ");
  return `${mode} · ${surface} · ${reason}`;
}

function renderGenericAccount(account: ChannelAccountSnapshot) {
  const runningStatus = deriveRunningStatus(account);
  const connectedStatus = deriveConnectedStatus(account);

  return html`
    <div class="account-card">
      <div class="account-card-header">
        <div class="account-card-title">${account.name || account.accountId}</div>
        <div class="account-card-id">${account.accountId}</div>
      </div>
      <div class="status-list account-card-status">
        <div>
          <span class="label">${t("channelsPage.generic.running")}</span>
          <span>${runningStatus}</span>
        </div>
        <div>
          <span class="label">${t("channelsPage.generic.configured")}</span>
          <span>${account.configured ? t("cron.summary.yes") : t("cron.summary.no")}</span>
        </div>
        <div>
          <span class="label">${t("channelsPage.connected")}</span>
          <span>${connectedStatus}</span>
        </div>
        <div>
          <span class="label">${t("channelsPage.generic.lastInbound")}</span>
          <span
            >${account.lastInboundAt
              ? formatRelativeTimestamp(account.lastInboundAt)
              : t("common.na")}</span
          >
        </div>
        <div>
          <span class="label">${t("channelsPage.generic.streaming")}</span>
          <span>${formatStreamingState(account)}</span>
        </div>
        ${account.lastError
          ? html` <div class="account-card-error">${account.lastError}</div> `
          : nothing}
      </div>
    </div>
  `;
}
