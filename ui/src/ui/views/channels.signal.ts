import { html, nothing } from "lit";
import { formatRelativeTimestamp } from "../format.ts";
import type { SignalStatus } from "../types.ts";
import { uiLiteral } from "../ui-literal.ts";
import { renderChannelConfigSection } from "./channels.config.ts";
import {
  formatNullableBoolean,
  renderSingleAccountChannelCard,
  resolveChannelConfigured,
} from "./channels.shared.ts";
import type { ChannelsProps } from "./channels.types.ts";

export function renderSignalCard(params: {
  props: ChannelsProps;
  signal?: SignalStatus | null;
  accountCountLabel: unknown;
}) {
  const { props, signal, accountCountLabel } = params;
  const configured = resolveChannelConfigured("signal", props);

  return renderSingleAccountChannelCard({
    title: uiLiteral("Signal"),
    subtitle: uiLiteral("signal-cli status and channel configuration."),
    accountCountLabel,
    statusRows: [
      { label: uiLiteral("Configured"), value: formatNullableBoolean(configured) },
      { label: uiLiteral("Running"), value: signal?.running ? uiLiteral("Yes") : uiLiteral("No") },
      { label: uiLiteral("Base URL"), value: signal?.baseUrl ?? uiLiteral("n/a") },
      {
        label: uiLiteral("Last start"),
        value: signal?.lastStartAt ? formatRelativeTimestamp(signal.lastStartAt) : uiLiteral("n/a"),
      },
      {
        label: uiLiteral("Last probe"),
        value: signal?.lastProbeAt ? formatRelativeTimestamp(signal.lastProbeAt) : uiLiteral("n/a"),
      },
    ],
    lastError: signal?.lastError,
    secondaryCallout: signal?.probe
      ? html`<div class="callout" style="margin-top: 12px;">
          ${uiLiteral("Probe")} ${signal.probe.ok ? uiLiteral("ok") : uiLiteral("failed")} · ${signal.probe.status ?? ""}
          ${signal.probe.error ?? ""}
        </div>`
      : nothing,
    configSection: renderChannelConfigSection({ channelId: "signal", props }),
    footer: html`<div class="row" style="margin-top: 12px;">
      <button class="btn" @click=${() => props.onRefresh(true)}>${uiLiteral("Probe")}</button>
    </div>`,
  });
}
