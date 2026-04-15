import { html, nothing } from "lit";
import { formatRelativeTimestamp } from "../format.ts";
import type { SlackStatus } from "../types.ts";
import { uiLiteral } from "../ui-literal.ts";
import { renderChannelConfigSection } from "./channels.config.ts";
import {
  formatNullableBoolean,
  renderSingleAccountChannelCard,
  resolveChannelConfigured,
  resolveChannelDisplayState,
} from "./channels.shared.ts";
import type { ChannelsProps } from "./channels.types.ts";

function formatStreamingValue(value: {
  enabled?: boolean | null;
  surface?: string | null;
  reason?: string | null;
} | null | undefined): string {
  if (!value || typeof value.enabled !== "boolean") {
    return uiLiteral("n/a");
  }
  return `${value.enabled ? uiLiteral("Streaming") : uiLiteral("Fallback")} · ${uiLiteral(value.surface ?? "unknown")} · ${uiLiteral((value.reason ?? "unknown").replaceAll("_", " "))}`;
}

export function renderSlackCard(params: {
  props: ChannelsProps;
  slack?: SlackStatus | null;
  accountCountLabel: unknown;
}) {
  const { props, slack, accountCountLabel } = params;
  const configured = resolveChannelConfigured("slack", props);
  const defaultAccount = resolveChannelDisplayState("slack", props).defaultAccount;

  return renderSingleAccountChannelCard({
    title: uiLiteral("Slack"),
    subtitle: uiLiteral("Socket mode status and channel configuration."),
    accountCountLabel,
    statusRows: [
      { label: uiLiteral("Configured"), value: formatNullableBoolean(configured) },
      { label: uiLiteral("Running"), value: slack?.running ? uiLiteral("Yes") : uiLiteral("No") },
      {
        label: uiLiteral("Last start"),
        value: slack?.lastStartAt ? formatRelativeTimestamp(slack.lastStartAt) : uiLiteral("n/a"),
      },
      {
        label: uiLiteral("Last probe"),
        value: slack?.lastProbeAt ? formatRelativeTimestamp(slack.lastProbeAt) : uiLiteral("n/a"),
      },
      {
        label: uiLiteral("Streaming"),
        value: formatStreamingValue(defaultAccount?.streaming),
      },
    ],
    lastError: slack?.lastError,
    secondaryCallout: slack?.probe
      ? html`<div class="callout" style="margin-top: 12px;">
          ${uiLiteral("Probe")} ${slack.probe.ok ? uiLiteral("ok") : uiLiteral("failed")} · ${slack.probe.status ?? ""}
          ${slack.probe.error ?? ""}
        </div>`
      : nothing,
    configSection: renderChannelConfigSection({ channelId: "slack", props }),
    footer: html`<div class="row" style="margin-top: 12px;">
      <button class="btn" @click=${() => props.onRefresh(true)}>${uiLiteral("Probe")}</button>
    </div>`,
  });
}
