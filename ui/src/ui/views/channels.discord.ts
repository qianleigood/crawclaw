import { html, nothing } from "lit";
import { formatRelativeTimestamp } from "../format.ts";
import type { DiscordStatus } from "../types.ts";
import { uiLiteral } from "../ui-literal.ts";
import { renderChannelConfigSection } from "./channels.config.ts";
import {
  formatNullableBoolean,
  renderSingleAccountChannelCard,
  resolveChannelConfigured,
} from "./channels.shared.ts";
import type { ChannelsProps } from "./channels.types.ts";

export function renderDiscordCard(params: {
  props: ChannelsProps;
  discord?: DiscordStatus | null;
  accountCountLabel: unknown;
}) {
  const { props, discord, accountCountLabel } = params;
  const configured = resolveChannelConfigured("discord", props);

  return renderSingleAccountChannelCard({
    title: uiLiteral("Discord"),
    subtitle: uiLiteral("Bot status and channel configuration."),
    accountCountLabel,
    statusRows: [
      { label: uiLiteral("Configured"), value: formatNullableBoolean(configured) },
      { label: uiLiteral("Running"), value: discord?.running ? uiLiteral("Yes") : uiLiteral("No") },
      {
        label: uiLiteral("Last start"),
        value: discord?.lastStartAt ? formatRelativeTimestamp(discord.lastStartAt) : uiLiteral("n/a"),
      },
      {
        label: uiLiteral("Last probe"),
        value: discord?.lastProbeAt ? formatRelativeTimestamp(discord.lastProbeAt) : uiLiteral("n/a"),
      },
    ],
    lastError: discord?.lastError,
    secondaryCallout: discord?.probe
      ? html`<div class="callout" style="margin-top: 12px;">
          ${uiLiteral("Probe")} ${discord.probe.ok ? uiLiteral("ok") : uiLiteral("failed")} · ${discord.probe.status ?? ""}
          ${discord.probe.error ?? ""}
        </div>`
      : nothing,
    configSection: renderChannelConfigSection({ channelId: "discord", props }),
    footer: html`<div class="row" style="margin-top: 12px;">
      <button class="btn" @click=${() => props.onRefresh(true)}>${uiLiteral("Probe")}</button>
    </div>`,
  });
}
