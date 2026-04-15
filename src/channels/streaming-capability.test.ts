import { describe, expect, it } from "vitest";
import {
  formatChannelStreamingDecision,
  formatChannelStreamingDecisionReason,
  type ChannelStreamingDecision,
} from "./streaming-capability.js";

describe("formatChannelStreamingDecisionReason", () => {
  it("formats render-mode fallback reasons", () => {
    const decision: ChannelStreamingDecision = {
      enabled: false,
      surface: "none",
      reason: "disabled_for_render_mode",
    };

    expect(
      formatChannelStreamingDecisionReason({
        reason: decision.reason,
        renderMode: "raw",
      }),
    ).toBe('disabled because renderMode="raw" does not support streaming');
  });

  it("formats config fallback reasons", () => {
    expect(
      formatChannelStreamingDecisionReason({
        reason: "disabled_by_config",
      }),
    ).toBe("disabled by channel streaming config");
  });

  it("formats enabled decisions with the selected surface", () => {
    expect(
      formatChannelStreamingDecision({
        enabled: true,
        surface: "card_stream",
        reason: "enabled",
      }),
    ).toBe("enabled via card_stream");
  });
});
