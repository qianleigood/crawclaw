import type { CrawClawConfig } from "../config/config.js";
import type { OnboardOutputPreset } from "../control/onboard-types.js";
import type { WizardPrompter, WizardSelectOption } from "./prompts.js";

const OUTPUT_PRESENTATION_OPTIONS: Array<WizardSelectOption<OnboardOutputPreset>> = [
  {
    value: "quiet",
    label: "Quiet",
    hint: "Final-focused replies with minimal visible process.",
  },
  {
    value: "balanced",
    label: "Balanced",
    hint: "Stream replies and show key execution steps.",
  },
  {
    value: "operator",
    label: "Operator",
    hint: "Keep more process detail and richer live updates.",
  },
];

const OUTPUT_PRESENTATION_PRESETS = new Set<OnboardOutputPreset>(["quiet", "balanced", "operator"]);

const VERBOSE_BY_PRESET: Record<OnboardOutputPreset, "off" | "on" | "full"> = {
  quiet: "off",
  balanced: "on",
  operator: "full",
};

const ACP_VISIBILITY_BY_PRESET: Record<OnboardOutputPreset, "off" | "summary" | "full"> = {
  quiet: "off",
  balanced: "summary",
  operator: "full",
};

const ACP_DELIVERY_BY_PRESET: Record<OnboardOutputPreset, "live" | "final_only"> = {
  quiet: "final_only",
  balanced: "live",
  operator: "live",
};

export function isOnboardOutputPreset(value: unknown): value is OnboardOutputPreset {
  return typeof value === "string" && OUTPUT_PRESENTATION_PRESETS.has(value as OnboardOutputPreset);
}

export async function promptOutputPresentationPreset(
  prompter: WizardPrompter,
): Promise<OnboardOutputPreset> {
  return prompter.select({
    message: "Output and presentation",
    options: OUTPUT_PRESENTATION_OPTIONS,
    initialValue: "balanced",
  });
}

export function applyOnboardOutputPresentationConfig(
  config: CrawClawConfig,
  preset: OnboardOutputPreset,
): CrawClawConfig {
  if (!isOnboardOutputPreset(preset)) {
    throw new Error(`Invalid output preset: ${String(preset)}`);
  }

  return {
    ...config,
    agents: {
      ...config.agents,
      defaults: {
        ...config.agents?.defaults,
        verboseDefault: VERBOSE_BY_PRESET[preset],
        blockStreamingDefault: preset === "operator" ? "on" : "off",
      },
    },
    acp: {
      ...config.acp,
      stream: {
        ...config.acp?.stream,
        visibilityMode: ACP_VISIBILITY_BY_PRESET[preset],
        deliveryMode: ACP_DELIVERY_BY_PRESET[preset],
      },
    },
  };
}
