import { describe, expect, it } from "vitest";
import { resolveMatrixStreamingDecision } from "./stream-mode.js";

describe("resolveMatrixStreamingDecision", () => {
  it("disables streaming when both preview and block streaming are off", () => {
    expect(
      resolveMatrixStreamingDecision({
        streaming: "off",
        blockStreamingEnabled: false,
      }),
    ).toEqual({
      enabled: false,
      surface: "none",
      reason: "disabled_by_config",
    });
  });

  it("maps partial mode to editable draft streaming", () => {
    expect(
      resolveMatrixStreamingDecision({
        streaming: "partial",
        blockStreamingEnabled: false,
      }),
    ).toEqual({
      enabled: true,
      surface: "editable_draft_stream",
      reason: "enabled",
    });
  });

  it("maps block-only mode to draft stream surface", () => {
    expect(
      resolveMatrixStreamingDecision({
        streaming: "off",
        blockStreamingEnabled: true,
      }),
    ).toEqual({
      enabled: true,
      surface: "draft_stream",
      reason: "enabled",
    });
  });
});
