import { html, nothing } from "lit";
import { formatRelativeTimestamp } from "../format.ts";
import type { GoogleChatStatus } from "../types.ts";
import { uiLiteral } from "../ui-literal.ts";
import { renderChannelConfigSection } from "./channels.config.ts";
import {
  formatNullableBoolean,
  renderSingleAccountChannelCard,
  resolveChannelConfigured,
} from "./channels.shared.ts";
import type { ChannelsProps } from "./channels.types.ts";

export function renderGoogleChatCard(params: {
  props: ChannelsProps;
  googleChat?: GoogleChatStatus | null;
  accountCountLabel: unknown;
}) {
  const { props, googleChat, accountCountLabel } = params;
  const configured = resolveChannelConfigured("googlechat", props);

  return renderSingleAccountChannelCard({
    title: uiLiteral("Google Chat"),
    subtitle: uiLiteral("Chat API webhook status and channel configuration."),
    accountCountLabel,
    statusRows: [
      { label: uiLiteral("Configured"), value: formatNullableBoolean(configured) },
      {
        label: uiLiteral("Running"),
        value: googleChat ? (googleChat.running ? uiLiteral("Yes") : uiLiteral("No")) : uiLiteral("n/a"),
      },
      { label: uiLiteral("Credential"), value: googleChat?.credentialSource ? uiLiteral(googleChat.credentialSource) : uiLiteral("n/a") },
      {
        label: uiLiteral("Audience"),
        value: googleChat?.audienceType
          ? `${googleChat.audienceType}${googleChat.audience ? ` · ${googleChat.audience}` : ""}`
          : uiLiteral("n/a"),
      },
      {
        label: uiLiteral("Last start"),
        value: googleChat?.lastStartAt ? formatRelativeTimestamp(googleChat.lastStartAt) : uiLiteral("n/a"),
      },
      {
        label: uiLiteral("Last probe"),
        value: googleChat?.lastProbeAt ? formatRelativeTimestamp(googleChat.lastProbeAt) : uiLiteral("n/a"),
      },
    ],
    lastError: googleChat?.lastError,
    secondaryCallout: googleChat?.probe
      ? html`<div class="callout" style="margin-top: 12px;">
          ${uiLiteral("Probe")} ${googleChat.probe.ok ? uiLiteral("ok") : uiLiteral("failed")} · ${googleChat.probe.status ?? ""}
          ${googleChat.probe.error ?? ""}
        </div>`
      : nothing,
    configSection: renderChannelConfigSection({ channelId: "googlechat", props }),
    footer: html`<div class="row" style="margin-top: 12px;">
      <button class="btn" @click=${() => props.onRefresh(true)}>${uiLiteral("Probe")}</button>
    </div>`,
  });
}
