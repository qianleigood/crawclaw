import { formatCliCommand } from "../cli/command-format.js";
import { createCliTranslator, resolveCliLocaleFromRuntime } from "../cli/i18n/index.js";
import type { CrawClawConfig } from "../config/config.js";
import { readConfigFileSnapshot } from "../config/config.js";
import type { RuntimeEnv } from "../runtime.js";
import { defaultRuntime } from "../runtime.js";
import { runNonInteractiveLocalSetup } from "./onboard-non-interactive/local.js";
import { runNonInteractiveRemoteSetup } from "./onboard-non-interactive/remote.js";
import type { OnboardOptions } from "./onboard-types.js";

export async function runNonInteractiveSetup(
  opts: OnboardOptions,
  runtime: RuntimeEnv = defaultRuntime,
) {
  const t = createCliTranslator(resolveCliLocaleFromRuntime(process.argv));
  const snapshot = await readConfigFileSnapshot();
  if (snapshot.exists && !snapshot.valid) {
    runtime.error(
      t("wizard.setup.error.configInvalid", { doctor: formatCliCommand("crawclaw doctor") }),
    );
    runtime.exit(1);
    return;
  }

  const baseConfig: CrawClawConfig = snapshot.valid
    ? snapshot.exists
      ? (snapshot.sourceConfig ?? snapshot.runtimeConfig)
      : {}
    : {};
  const mode = opts.mode ?? "local";
  if (mode !== "local" && mode !== "remote") {
    runtime.error(t("wizard.setup.error.invalidMode", { mode: String(mode) }));
    runtime.exit(1);
    return;
  }

  if (mode === "remote") {
    await runNonInteractiveRemoteSetup({ opts, runtime, baseConfig, baseHash: snapshot.hash });
    return;
  }

  await runNonInteractiveLocalSetup({ opts, runtime, baseConfig, baseHash: snapshot.hash });
}
