import { html, nothing } from "lit";
import { formatRelativeTimestamp } from "../format.ts";
import type { IMessageStatus } from "../types.ts";
import { uiLiteral } from "../ui-literal.ts";
import { renderChannelConfigSection } from "./channels.config.ts";
import {
  formatNullableBoolean,
  renderSingleAccountChannelCard,
  resolveChannelConfigured,
} from "./channels.shared.ts";
import type { ChannelsProps } from "./channels.types.ts";

export function renderIMessageCard(params: {
  props: ChannelsProps;
  imessage?: IMessageStatus | null;
  accountCountLabel: unknown;
}) {
  const { props, imessage, accountCountLabel } = params;
  const configured = resolveChannelConfigured("imessage", props);

  return renderSingleAccountChannelCard({
    title: uiLiteral("iMessage"),
    subtitle: uiLiteral("macOS bridge status and channel configuration."),
    accountCountLabel,
    statusRows: [
      { label: uiLiteral("Configured"), value: formatNullableBoolean(configured) },
      { label: uiLiteral("Running"), value: imessage?.running ? uiLiteral("Yes") : uiLiteral("No") },
      {
        label: uiLiteral("Last start"),
        value: imessage?.lastStartAt ? formatRelativeTimestamp(imessage.lastStartAt) : uiLiteral("n/a"),
      },
      {
        label: uiLiteral("Last probe"),
        value: imessage?.lastProbeAt ? formatRelativeTimestamp(imessage.lastProbeAt) : uiLiteral("n/a"),
      },
    ],
    lastError: imessage?.lastError,
    secondaryCallout: imessage?.probe
      ? html`<div class="callout" style="margin-top: 12px;">
          ${uiLiteral("Probe")} ${imessage.probe.ok ? uiLiteral("ok") : uiLiteral("failed")} · ${imessage.probe.error ?? ""}
        </div>`
      : nothing,
    configSection: renderChannelConfigSection({ channelId: "imessage", props }),
    footer: html`<div class="row" style="margin-top: 12px;">
      <button class="btn" @click=${() => props.onRefresh(true)}>${uiLiteral("Probe")}</button>
    </div>`,
  });
}
