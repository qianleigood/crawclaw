import { describe, expect, it } from "vitest";
import {
  applyAppendOnlyStreamUpdate,
  buildStatusFinalPreviewText,
  resolveSlackStreamingDecision,
  resolveSlackStreamingConfig,
  resolveSlackStreamMode,
} from "./stream-mode.js";

describe("resolveSlackStreamMode", () => {
  it("defaults to replace", () => {
    expect(resolveSlackStreamMode(undefined)).toBe("replace");
    expect(resolveSlackStreamMode("")).toBe("replace");
    expect(resolveSlackStreamMode("unknown")).toBe("replace");
  });

  it("accepts valid modes", () => {
    expect(resolveSlackStreamMode("replace")).toBe("replace");
    expect(resolveSlackStreamMode("status_final")).toBe("status_final");
    expect(resolveSlackStreamMode("append")).toBe("append");
  });
});

describe("resolveSlackStreamingConfig", () => {
  it("defaults to partial mode with native streaming enabled", () => {
    expect(resolveSlackStreamingConfig({})).toEqual({
      mode: "partial",
      nativeStreaming: true,
      draftMode: "replace",
    });
  });

  it("maps legacy streaming booleans to unified mode and native streaming toggle", () => {
    expect(resolveSlackStreamingConfig({ streaming: false })).toEqual({
      mode: "off",
      nativeStreaming: false,
      draftMode: "replace",
    });
    expect(resolveSlackStreamingConfig({ streaming: true })).toEqual({
      mode: "partial",
      nativeStreaming: true,
      draftMode: "replace",
    });
  });

  it("accepts unified enum values directly", () => {
    expect(resolveSlackStreamingConfig({ streaming: "off" })).toEqual({
      mode: "off",
      nativeStreaming: true,
      draftMode: "replace",
    });
    expect(resolveSlackStreamingConfig({ streaming: "progress" })).toEqual({
      mode: "progress",
      nativeStreaming: true,
      draftMode: "status_final",
    });
  });
});

describe("resolveSlackStreamingDecision", () => {
  it("maps native partial mode to editable draft streaming", () => {
    expect(
      resolveSlackStreamingDecision({
        mode: "partial",
        nativeStreaming: true,
        isDirectMessage: false,
      }),
    ).toEqual({
      enabled: true,
      surface: "editable_draft_stream",
      reason: "enabled",
    });
  });

  it("disables DM native streaming without a thread target", () => {
    expect(
      resolveSlackStreamingDecision({
        mode: "partial",
        nativeStreaming: true,
        isDirectMessage: true,
      }),
    ).toEqual({
      enabled: false,
      surface: "none",
      reason: "disabled_for_thread_reply",
    });
  });

  it("maps block/progress preview paths to draft stream surface", () => {
    expect(
      resolveSlackStreamingDecision({
        mode: "block",
        nativeStreaming: true,
        isDirectMessage: false,
      }),
    ).toEqual({
      enabled: true,
      surface: "draft_stream",
      reason: "enabled",
    });
  });

  it("maps off mode to disabled_by_config", () => {
    expect(
      resolveSlackStreamingDecision({
        mode: "off",
        nativeStreaming: true,
        isDirectMessage: false,
      }),
    ).toEqual({
      enabled: false,
      surface: "none",
      reason: "disabled_by_config",
    });
  });
});

describe("applyAppendOnlyStreamUpdate", () => {
  it("starts with first incoming text", () => {
    const next = applyAppendOnlyStreamUpdate({
      incoming: "hello",
      rendered: "",
      source: "",
    });
    expect(next).toEqual({ rendered: "hello", source: "hello", changed: true });
  });

  it("uses cumulative incoming text when it extends prior source", () => {
    const next = applyAppendOnlyStreamUpdate({
      incoming: "hello world",
      rendered: "hello",
      source: "hello",
    });
    expect(next).toEqual({
      rendered: "hello world",
      source: "hello world",
      changed: true,
    });
  });

  it("ignores regressive shorter incoming text", () => {
    const next = applyAppendOnlyStreamUpdate({
      incoming: "hello",
      rendered: "hello world",
      source: "hello world",
    });
    expect(next).toEqual({
      rendered: "hello world",
      source: "hello world",
      changed: false,
    });
  });

  it("appends non-prefix incoming chunks", () => {
    const next = applyAppendOnlyStreamUpdate({
      incoming: "next chunk",
      rendered: "hello world",
      source: "hello world",
    });
    expect(next).toEqual({
      rendered: "hello world\nnext chunk",
      source: "next chunk",
      changed: true,
    });
  });
});

describe("buildStatusFinalPreviewText", () => {
  it("cycles status dots", () => {
    expect(buildStatusFinalPreviewText(1)).toBe("Status: thinking..");
    expect(buildStatusFinalPreviewText(2)).toBe("Status: thinking...");
    expect(buildStatusFinalPreviewText(3)).toBe("Status: thinking.");
  });
});
