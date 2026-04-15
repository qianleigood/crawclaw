export type ChannelStreamingSurface =
  | "none"
  | "draft_stream"
  | "editable_draft_stream"
  | "card_stream";

export type ChannelStreamingDecisionReason =
  | "enabled"
  | "disabled_by_config"
  | "disabled_for_render_mode"
  | "disabled_for_thread_reply";

export type ChannelStreamingDecision = {
  enabled: boolean;
  surface: ChannelStreamingSurface;
  reason: ChannelStreamingDecisionReason;
};

export function formatChannelStreamingDecisionReason(
  params: Pick<ChannelStreamingDecision, "reason"> & {
    renderMode?: string | undefined;
  },
): string {
  switch (params.reason) {
    case "disabled_by_config":
      return "disabled by channel streaming config";
    case "disabled_for_render_mode":
      return params.renderMode
        ? `disabled because renderMode="${params.renderMode}" does not support streaming`
        : "disabled for the current render mode";
    case "disabled_for_thread_reply":
      return "disabled for thread/topic replies so direct reply metadata stays reliable";
    case "enabled":
    default:
      return "enabled";
  }
}

export function formatChannelStreamingDecision(params: ChannelStreamingDecision & {
  renderMode?: string | undefined;
}): string {
  if (params.enabled) {
    return `enabled via ${params.surface}`;
  }
  return formatChannelStreamingDecisionReason({
    reason: params.reason,
    renderMode: params.renderMode,
  });
}
