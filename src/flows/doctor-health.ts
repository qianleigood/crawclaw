import { intro as clackIntro, outro as clackOutro } from "@clack/prompts";
import { CONFIG_PATH } from "../config/config.js";
import { loadAndMaybeMigrateDoctorConfig } from "../control/doctor-config-flow.js";
import { noteSourceInstallIssues } from "../control/doctor-install.js";
import { noteStartupOptimizationHints } from "../control/doctor-platform-notes.js";
import { createDoctorPrompter, type DoctorOptions } from "../control/doctor-prompter.js";
import { maybeOfferUpdateBeforeDoctor } from "../control/doctor-update.js";
import { printWizardHeader } from "../control/onboard-helpers.js";
import { resolveCrawClawPackageRoot } from "../infra/crawclaw-root.js";
import type { RuntimeEnv } from "../runtime.js";
import { defaultRuntime } from "../runtime.js";
import { stylePromptTitle } from "../terminal/prompt-style.js";
import { runDoctorHealthContributions } from "./doctor-health-contributions.js";

const intro = (message: string) => clackIntro(stylePromptTitle(message) ?? message);
const outro = (message: string) => clackOutro(stylePromptTitle(message) ?? message);

export async function doctorCommand(
  runtime: RuntimeEnv = defaultRuntime,
  options: DoctorOptions = {},
) {
  const prompter = createDoctorPrompter({ runtime, options });
  printWizardHeader(runtime);
  intro("CrawClaw doctor");

  const root = await resolveCrawClawPackageRoot({
    moduleUrl: import.meta.url,
    argv1: process.argv[1],
    cwd: process.cwd(),
  });

  const updateResult = await maybeOfferUpdateBeforeDoctor({
    runtime,
    options,
    root,
    confirm: (p) => prompter.confirm(p),
    outro,
  });
  if (updateResult.handled) {
    return;
  }

  noteSourceInstallIssues(root);
  noteStartupOptimizationHints();

  const configResult = await loadAndMaybeMigrateDoctorConfig({
    options,
    confirm: (p) => prompter.confirm(p),
  });
  const ctx = {
    runtime,
    options,
    prompter,
    configResult,
    cfg: configResult.cfg,
    cfgForPersistence: structuredClone(configResult.cfg),
    sourceConfigValid: configResult.sourceConfigValid ?? true,
    configPath: configResult.path ?? CONFIG_PATH,
  };
  await runDoctorHealthContributions(ctx);

  outro("Doctor complete.");
}
