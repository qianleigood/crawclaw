import type { CrawClawConfig } from "../config/config.js";
import type { OnboardOptions } from "../control/onboard-types.js";
import type { RuntimeEnv } from "../runtime.js";
import type { WizardPrompter } from "./prompts.js";

export async function promptNotebookLmEnablement(params: {
  config: CrawClawConfig;
  prompter: WizardPrompter;
  nonInteractive?: boolean;
}): Promise<CrawClawConfig> {
  if (params.nonInteractive === true) {
    return params.config;
  }

  const initialExperienceEnabled = params.config.memory?.experience?.enabled !== false;
  const experienceEnabled = await params.prompter.confirm({
    message: "Enable experience capture and local sync queue?",
    initialValue: initialExperienceEnabled,
  });

  if (!experienceEnabled) {
    return {
      ...params.config,
      memory: {
        ...params.config.memory,
        experience: {
          ...params.config.memory?.experience,
          enabled: false,
        },
        notebooklm: {
          ...params.config.memory?.notebooklm,
          enabled: false,
        },
      },
    };
  }

  return {
    ...params.config,
    memory: {
      ...params.config.memory,
      experience: {
        ...params.config.memory?.experience,
        enabled: true,
      },
      notebooklm: {
        ...params.config.memory?.notebooklm,
        enabled: false,
      },
    },
  };
}

export async function maybeHandleNotebookLmOnboarding(_params: {
  config: CrawClawConfig;
  opts: OnboardOptions;
  prompter: WizardPrompter;
  runtime: RuntimeEnv;
}): Promise<void> {
  return;
}
