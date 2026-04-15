import type { ChannelStreamingDecision } from "crawclaw/plugin-sdk/channel-lifecycle";

export function resolveMatrixStreamingDecision(params: {
  streaming: "partial" | "off";
  blockStreamingEnabled: boolean;
}): ChannelStreamingDecision {
  if (params.streaming === "off" && !params.blockStreamingEnabled) {
    return {
      enabled: false,
      surface: "none",
      reason: "disabled_by_config",
    };
  }
  if (params.streaming === "partial") {
    return {
      enabled: true,
      surface: "editable_draft_stream",
      reason: "enabled",
    };
  }
  return {
    enabled: true,
    surface: "draft_stream",
    reason: "enabled",
  };
}
