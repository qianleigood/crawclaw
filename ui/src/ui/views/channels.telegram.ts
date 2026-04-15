import { html, nothing } from "lit";
import { formatRelativeTimestamp } from "../format.ts";
import type { ChannelAccountSnapshot, TelegramStatus } from "../types.ts";
import { uiLiteral } from "../ui-literal.ts";
import { renderChannelConfigSection } from "./channels.config.ts";
import {
  formatNullableBoolean,
  renderSingleAccountChannelCard,
  resolveChannelConfigured,
} from "./channels.shared.ts";
import type { ChannelsProps } from "./channels.types.ts";

export function renderTelegramCard(params: {
  props: ChannelsProps;
  telegram?: TelegramStatus;
  telegramAccounts: ChannelAccountSnapshot[];
  accountCountLabel: unknown;
}) {
  const { props, telegram, telegramAccounts, accountCountLabel } = params;
  const hasMultipleAccounts = telegramAccounts.length > 1;
  const configured = resolveChannelConfigured("telegram", props);
  const formatStreamingValue = (value: ChannelAccountSnapshot["streaming"]): string => {
    if (!value || typeof value.enabled !== "boolean") {
      return uiLiteral("n/a");
    }
    return `${value.enabled ? uiLiteral("Streaming") : uiLiteral("Fallback")} · ${uiLiteral(value.surface ?? "unknown")} · ${uiLiteral((value.reason ?? "unknown").replaceAll("_", " "))}`;
  };

  const renderAccountCard = (account: ChannelAccountSnapshot) => {
    const probe = account.probe as { bot?: { username?: string } } | undefined;
    const botUsername = probe?.bot?.username;
    const label = account.name || account.accountId;
    return html`
      <div class="account-card">
        <div class="account-card-header">
          <div class="account-card-title">${botUsername ? `@${botUsername}` : label}</div>
          <div class="account-card-id">${account.accountId}</div>
        </div>
        <div class="status-list account-card-status">
          <div>
            <span class="label">${uiLiteral("Running")}</span>
            <span>${account.running ? uiLiteral("Yes") : uiLiteral("No")}</span>
          </div>
          <div>
            <span class="label">${uiLiteral("Configured")}</span>
            <span>${account.configured ? uiLiteral("Yes") : uiLiteral("No")}</span>
          </div>
          <div>
            <span class="label">${uiLiteral("Last inbound")}</span>
            <span
              >${account.lastInboundAt
                ? formatRelativeTimestamp(account.lastInboundAt)
                : uiLiteral("n/a")}</span
            >
          </div>
          <div>
            <span class="label">${uiLiteral("Streaming")}</span>
            <span>${formatStreamingValue(account.streaming)}</span>
          </div>
          ${account.lastError
            ? html` <div class="account-card-error">${account.lastError}</div> `
            : nothing}
        </div>
      </div>
    `;
  };

  if (hasMultipleAccounts) {
    return html`
      <div class="card">
        <div class="card-title">${uiLiteral("Telegram")}</div>
        <div class="card-sub">${uiLiteral("Bot status and channel configuration.")}</div>
        ${accountCountLabel}

        <div class="account-card-list">
          ${telegramAccounts.map((account) => renderAccountCard(account))}
        </div>

        ${telegram?.lastError
          ? html`<div class="callout danger" style="margin-top: 12px;">${telegram.lastError}</div>`
          : nothing}
        ${telegram?.probe
          ? html`<div class="callout" style="margin-top: 12px;">
              ${uiLiteral("Probe")} ${telegram.probe.ok ? uiLiteral("ok") : uiLiteral("failed")} · ${telegram.probe.status ?? ""}
              ${telegram.probe.error ?? ""}
            </div>`
          : nothing}
        ${renderChannelConfigSection({ channelId: "telegram", props })}

        <div class="row" style="margin-top: 12px;">
          <button class="btn" @click=${() => props.onRefresh(true)}>${uiLiteral("Probe")}</button>
        </div>
      </div>
    `;
  }

  return renderSingleAccountChannelCard({
    title: uiLiteral("Telegram"),
    subtitle: uiLiteral("Bot status and channel configuration."),
    accountCountLabel,
    statusRows: [
      { label: uiLiteral("Configured"), value: formatNullableBoolean(configured) },
      { label: uiLiteral("Running"), value: telegram?.running ? uiLiteral("Yes") : uiLiteral("No") },
      { label: uiLiteral("Mode"), value: telegram?.mode ? uiLiteral(telegram.mode) : uiLiteral("n/a") },
      {
        label: uiLiteral("Last start"),
        value: telegram?.lastStartAt ? formatRelativeTimestamp(telegram.lastStartAt) : uiLiteral("n/a"),
      },
      {
        label: uiLiteral("Last probe"),
        value: telegram?.lastProbeAt ? formatRelativeTimestamp(telegram.lastProbeAt) : uiLiteral("n/a"),
      },
      {
        label: uiLiteral("Streaming"),
        value: formatStreamingValue(telegramAccounts[0]?.streaming),
      },
    ],
    lastError: telegram?.lastError,
    secondaryCallout: telegram?.probe
      ? html`<div class="callout" style="margin-top: 12px;">
          ${uiLiteral("Probe")} ${telegram.probe.ok ? uiLiteral("ok") : uiLiteral("failed")} · ${telegram.probe.status ?? ""}
          ${telegram.probe.error ?? ""}
        </div>`
      : nothing,
    configSection: renderChannelConfigSection({ channelId: "telegram", props }),
    footer: html`<div class="row" style="margin-top: 12px;">
      <button class="btn" @click=${() => props.onRefresh(true)}>${uiLiteral("Probe")}</button>
    </div>`,
  });
}
