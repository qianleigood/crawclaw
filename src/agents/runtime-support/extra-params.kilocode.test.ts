import type { Context, Model, SimpleStreamOptions } from "@mariozechner/pi-ai";
import { afterEach, describe, expect, it } from "vitest";
import { captureEnv } from "../../test-utils/env.js";
import type { StreamFn } from "../agent-types.js";
import { applyExtraParamsToAgent } from "./extra-params.js";

type ExtraParamsCapture<TPayload extends Record<string, unknown>> = {
  headers?: Record<string, string>;
  payload: TPayload;
};

function applyAndCapture(params: {
  provider: string;
  modelId: string;
  callerHeaders?: Record<string, string>;
}) {
  const captured: ExtraParamsCapture<Record<string, unknown>> = { payload: {} };
  const baseStreamFn: StreamFn = (model, _context, options) => {
    captured.headers = options?.headers;
    options?.onPayload?.(captured.payload, model);
    return {} as ReturnType<StreamFn>;
  };
  const agent = { streamFn: baseStreamFn };

  applyExtraParamsToAgent(agent, undefined, params.provider, params.modelId, undefined, "high");

  const context: Context = { messages: [] };
  void agent.streamFn?.(
    {
      api: "openai-completions",
      provider: params.provider,
      id: params.modelId,
    } as Model<"openai-completions">,
    context,
    {
      headers: params.callerHeaders,
    } as SimpleStreamOptions,
  );

  return captured;
}

function applyAndCaptureReasoning(params: {
  modelId: string;
  initialPayload?: Record<string, unknown>;
  thinkingLevel?: "minimal" | "low" | "medium" | "high";
}) {
  const captured: ExtraParamsCapture<Record<string, unknown>> = {
    payload: { ...params.initialPayload },
  };
  const baseStreamFn: StreamFn = (model, _context, options) => {
    options?.onPayload?.(captured.payload, model);
    return {} as ReturnType<StreamFn>;
  };
  const agent = { streamFn: baseStreamFn };

  applyExtraParamsToAgent(
    agent,
    undefined,
    "kilocode",
    params.modelId,
    undefined,
    params.thinkingLevel ?? "high",
  );

  const context: Context = { messages: [] };
  void agent.streamFn?.(
    {
      api: "openai-completions",
      provider: "kilocode",
      id: params.modelId,
    } as Model<"openai-completions">,
    context,
    {} as SimpleStreamOptions,
  );

  return captured.payload;
}

describe("extra-params: Kilocode wrapper", () => {
  const envSnapshot = captureEnv(["KILOCODE_FEATURE"]);

  afterEach(() => {
    envSnapshot.restore();
  });

  it("injects X-KILOCODE-FEATURE header with default value", () => {
    delete process.env.KILOCODE_FEATURE;

    const { headers } = applyAndCapture({
      provider: "kilocode",
      modelId: "anthropic/claude-sonnet-4",
    });

    expect(headers?.["X-KILOCODE-FEATURE"]).toBe("crawclaw");
  });

  it("reads X-KILOCODE-FEATURE from KILOCODE_FEATURE env var", () => {
    process.env.KILOCODE_FEATURE = "custom-feature";

    const { headers } = applyAndCapture({
      provider: "kilocode",
      modelId: "anthropic/claude-sonnet-4",
    });

    expect(headers?.["X-KILOCODE-FEATURE"]).toBe("custom-feature");
  });

  it("cannot be overridden by caller headers", () => {
    delete process.env.KILOCODE_FEATURE;

    const { headers } = applyAndCapture({
      provider: "kilocode",
      modelId: "anthropic/claude-sonnet-4",
      callerHeaders: { "X-KILOCODE-FEATURE": "should-be-overwritten" },
    });

    expect(headers?.["X-KILOCODE-FEATURE"]).toBe("crawclaw");
  });

  it("keeps Kilocode runtime wrapping under restrictive plugins.allow", () => {
    delete process.env.KILOCODE_FEATURE;

    const { headers } = applyAndCapture({
      provider: "kilocode",
      modelId: "anthropic/claude-sonnet-4",
    });

    expect(headers?.["X-KILOCODE-FEATURE"]).toBe("crawclaw");
  });

  it("does not inject header for non-kilocode providers", () => {
    const { headers } = applyAndCapture({
      provider: "openrouter",
      modelId: "anthropic/claude-sonnet-4",
    });

    expect(headers?.["X-KILOCODE-FEATURE"]).toBeUndefined();
  });
});

describe("extra-params: Kilocode kilo/auto reasoning", () => {
  it("does not inject reasoning.effort for kilo/auto", () => {
    const capturedPayload = applyAndCaptureReasoning({
      modelId: "kilo/auto",
      initialPayload: { reasoning_effort: "high" },
    });

    // kilo/auto should not have reasoning injected
    expect(capturedPayload?.reasoning).toBeUndefined();
    expect(capturedPayload).not.toHaveProperty("reasoning_effort");
  });

  it("injects reasoning.effort for non-auto kilocode models", () => {
    const capturedPayload = applyAndCaptureReasoning({
      modelId: "anthropic/claude-sonnet-4",
    });

    // Non-auto models should have reasoning injected
    expect(capturedPayload?.reasoning).toEqual({ effort: "high" });
  });

  it("still normalizes reasoning for Kilocode under restrictive plugins.allow", () => {
    const capturedPayload = applyAndCaptureReasoning({
      modelId: "anthropic/claude-sonnet-4",
    });

    expect(capturedPayload?.reasoning).toEqual({ effort: "high" });
  });

  it("does not inject reasoning.effort for x-ai models", () => {
    const capturedPayload = applyAndCaptureReasoning({
      modelId: "x-ai/grok-3",
      initialPayload: { reasoning_effort: "high" },
      thinkingLevel: "high",
    });

    // x-ai models reject reasoning.effort — should be skipped
    expect(capturedPayload?.reasoning).toBeUndefined();
    expect(capturedPayload).not.toHaveProperty("reasoning_effort");
  });
});
