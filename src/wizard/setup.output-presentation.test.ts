import { describe, expect, it, vi } from "vitest";
import { createWizardPrompter as buildWizardPrompter } from "../../test/helpers/wizard-prompter.js";
import {
  applyOnboardOutputPresentationConfig,
  isOnboardOutputPreset,
  promptOutputPresentationPreset,
} from "./setup.output-presentation.js";

describe("setup.output-presentation", () => {
  it("prompts with the unified output preset choices", async () => {
    const select = vi.fn(async () => "balanced");
    const prompter = buildWizardPrompter({
      select: select as never,
    });

    const preset = await promptOutputPresentationPreset(prompter);

    expect(preset).toBe("balanced");
    expect(select).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "Output and presentation",
        initialValue: "balanced",
        options: expect.arrayContaining([
          expect.objectContaining({ value: "quiet", label: "Quiet" }),
          expect.objectContaining({ value: "balanced", label: "Balanced" }),
          expect.objectContaining({ value: "operator", label: "Operator" }),
        ]),
      }),
    );
  });

  it("applies the balanced preset to agent defaults, ACP, and supported channel surfaces", () => {
    const config = applyOnboardOutputPresentationConfig(
      {
        agents: {
          defaults: {
            verboseDefault: "off",
          },
        },
        acp: {
          stream: {
            visibilityMode: "off",
            deliveryMode: "final_only",
          },
        },
        channels: {
          telegram: {},
          discord: { replyToMode: "off" },
          slack: {},
          googlechat: {},
          matrix: { enabled: true },
        },
      },
      "balanced",
    );

    expect(config.agents?.defaults?.verboseDefault).toBe("on");
    expect(config.agents?.defaults?.blockStreamingDefault).toBe("off");
    expect(config.acp?.stream?.visibilityMode).toBe("summary");
    expect(config.acp?.stream?.deliveryMode).toBe("live");
    expect(config.channels?.telegram?.streaming).toBe("partial");
    expect(config.channels?.telegram?.replyToMode).toBe("first");
    expect(config.channels?.discord?.streaming).toBe("partial");
    expect(config.channels?.discord?.replyToMode).toBe("first");
    expect(config.channels?.slack?.streaming).toBe("partial");
    expect(config.channels?.slack?.replyToMode).toBe("first");
    expect(config.channels?.googlechat?.replyToMode).toBe("first");
    expect(config.channels?.matrix).toEqual({ enabled: true });
  });

  it("applies the operator preset for richer live output", () => {
    const config = applyOnboardOutputPresentationConfig(
      {
        channels: {
          telegram: {},
        },
      },
      "operator",
    );

    expect(config.agents?.defaults?.verboseDefault).toBe("full");
    expect(config.agents?.defaults?.blockStreamingDefault).toBe("on");
    expect(config.acp?.stream?.visibilityMode).toBe("full");
    expect(config.acp?.stream?.deliveryMode).toBe("live");
    expect(config.channels?.telegram?.streaming).toBe("block");
    expect(config.channels?.telegram?.replyToMode).toBe("all");
  });

  it("rejects invalid output presets", () => {
    expect(isOnboardOutputPreset("balanced")).toBe(true);
    expect(isOnboardOutputPreset("verbose")).toBe(false);
    expect(() => applyOnboardOutputPresentationConfig({}, "verbose" as never)).toThrow(
      "Invalid output preset: verbose",
    );
  });
});
