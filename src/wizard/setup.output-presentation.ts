import type { OnboardOutputPreset } from "../commands/onboard-types.js";
import type { CrawClawConfig } from "../config/config.js";
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

const STREAMING_BY_PRESET: Record<OnboardOutputPreset, "off" | "partial" | "block"> = {
  quiet: "off",
  balanced: "partial",
  operator: "block",
};

const REPLY_TO_MODE_BY_PRESET: Record<OnboardOutputPreset, "off" | "first" | "all"> = {
  quiet: "off",
  balanced: "first",
  operator: "all",
};

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

const CHANNELS_WITH_STREAMING = ["telegram", "discord", "slack"] as const;
const CHANNELS_WITH_REPLY_TO_MODE = ["telegram", "discord", "slack", "googlechat"] as const;

type WritableChannelConfig = Record<string, unknown>;

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
  const channels = config.channels
    ? ({ ...config.channels } as Record<string, WritableChannelConfig>)
    : undefined;

  if (channels) {
    for (const channelId of CHANNELS_WITH_STREAMING) {
      const channelConfig = channels[channelId];
      if (channelConfig) {
        channels[channelId] = {
          ...channelConfig,
          streaming: STREAMING_BY_PRESET[preset],
        };
      }
    }

    for (const channelId of CHANNELS_WITH_REPLY_TO_MODE) {
      const channelConfig = channels[channelId];
      if (channelConfig) {
        channels[channelId] = {
          ...channelConfig,
          replyToMode: REPLY_TO_MODE_BY_PRESET[preset],
        };
      }
    }
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
    ...(channels ? { channels: channels as CrawClawConfig["channels"] } : {}),
  };
}
