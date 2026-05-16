import type { OnboardOptions } from "../control/onboard-types.js";
import type { RuntimeEnv } from "../runtime.js";
import type { WizardPrompter } from "./prompts.js";

export async function runSetupWizard(
  _opts: OnboardOptions,
  _runtime: RuntimeEnv,
  _prompter: WizardPrompter,
): Promise<void> {}
