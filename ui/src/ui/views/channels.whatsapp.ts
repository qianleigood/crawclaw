import { html, nothing } from "lit";
import { formatRelativeTimestamp, formatDurationHuman } from "../format.ts";
import type { WhatsAppStatus } from "../types.ts";
import { uiLiteral } from "../ui-literal.ts";
import { renderChannelConfigSection } from "./channels.config.ts";
import {
  formatNullableBoolean,
  renderSingleAccountChannelCard,
  resolveChannelConfigured,
} from "./channels.shared.ts";
import type { ChannelsProps } from "./channels.types.ts";

export function renderWhatsAppCard(params: {
  props: ChannelsProps;
  whatsapp?: WhatsAppStatus;
  accountCountLabel: unknown;
}) {
  const { props, whatsapp, accountCountLabel } = params;
  const configured = resolveChannelConfigured("whatsapp", props);

  return renderSingleAccountChannelCard({
    title: uiLiteral("WhatsApp"),
    subtitle: uiLiteral("Link WhatsApp Web and monitor connection health."),
    accountCountLabel,
    statusRows: [
      { label: uiLiteral("Configured"), value: formatNullableBoolean(configured) },
      { label: uiLiteral("Linked"), value: whatsapp?.linked ? uiLiteral("Yes") : uiLiteral("No") },
      { label: uiLiteral("Running"), value: whatsapp?.running ? uiLiteral("Yes") : uiLiteral("No") },
      { label: uiLiteral("Connected"), value: whatsapp?.connected ? uiLiteral("Yes") : uiLiteral("No") },
      {
        label: uiLiteral("Last connect"),
        value: whatsapp?.lastConnectedAt
          ? formatRelativeTimestamp(whatsapp.lastConnectedAt)
          : uiLiteral("n/a"),
      },
      {
        label: uiLiteral("Last message"),
        value: whatsapp?.lastMessageAt ? formatRelativeTimestamp(whatsapp.lastMessageAt) : uiLiteral("n/a"),
      },
      {
        label: uiLiteral("Auth age"),
        value: whatsapp?.authAgeMs != null ? formatDurationHuman(whatsapp.authAgeMs) : uiLiteral("n/a"),
      },
    ],
    lastError: whatsapp?.lastError,
    extraContent: html`
      ${props.whatsappMessage
        ? html`<div class="callout" style="margin-top: 12px;">${props.whatsappMessage}</div>`
        : nothing}
      ${props.whatsappQrDataUrl
        ? html`<div class="qr-wrap">
            <img src=${props.whatsappQrDataUrl} alt=${uiLiteral("WhatsApp QR")} />
          </div>`
        : nothing}
    `,
    configSection: renderChannelConfigSection({ channelId: "whatsapp", props }),
    footer: html`<div class="row" style="margin-top: 14px; flex-wrap: wrap;">
      <button
        class="btn primary"
        ?disabled=${props.whatsappBusy}
        @click=${() => props.onWhatsAppStart(false)}
      >
        ${props.whatsappBusy ? uiLiteral("Working…") : uiLiteral("Show QR")}
      </button>
      <button
        class="btn"
        ?disabled=${props.whatsappBusy}
        @click=${() => props.onWhatsAppStart(true)}
      >
        ${uiLiteral("Relink")}
      </button>
      <button class="btn" ?disabled=${props.whatsappBusy} @click=${() => props.onWhatsAppWait()}>
        ${uiLiteral("Wait for scan")}
      </button>
      <button
        class="btn danger"
        ?disabled=${props.whatsappBusy}
        @click=${() => props.onWhatsAppLogout()}
      >
        ${uiLiteral("Logout")}
      </button>
      <button class="btn" @click=${() => props.onRefresh(true)}>${uiLiteral("Refresh")}</button>
    </div>`,
  });
}
