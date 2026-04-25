import { formatCliCommand } from "../../cli/command-format.js";
import { createCliTranslator, resolveCliLocaleFromRuntime } from "../../cli/i18n/index.js";
import type { CrawClawConfig } from "../../config/config.js";
import { replaceConfigFile } from "../../config/config.js";
import { logConfigUpdated } from "../../config/logging.js";
import { type RuntimeEnv, writeRuntimeJson } from "../../runtime.js";
import { applyOnboardOutputPresentationConfig } from "../../wizard/setup.output-presentation.js";
import { applyWizardMetadata } from "../onboard-helpers.js";
import type { OnboardOptions } from "../onboard-types.js";

export async function runNonInteractiveRemoteSetup(params: {
  opts: OnboardOptions;
  runtime: RuntimeEnv;
  baseConfig: CrawClawConfig;
  baseHash?: string;
}) {
  const { opts, runtime, baseConfig, baseHash } = params;
  const t = createCliTranslator(resolveCliLocaleFromRuntime(process.argv));
  const mode = "remote" as const;

  const remoteUrl = opts.remoteUrl?.trim();
  if (!remoteUrl) {
    runtime.error(t("wizard.setup.error.missingRemoteUrl"));
    runtime.exit(1);
    return;
  }

  let nextConfig: CrawClawConfig = {
    ...baseConfig,
    gateway: {
      ...baseConfig.gateway,
      mode: "remote",
      remote: {
        url: remoteUrl,
        token: opts.remoteToken?.trim() || undefined,
      },
    },
  };
  if (opts.outputPreset) {
    nextConfig = applyOnboardOutputPresentationConfig(nextConfig, opts.outputPreset);
  }
  nextConfig = applyWizardMetadata(nextConfig, { command: "onboard", mode });
  await replaceConfigFile({
    nextConfig,
    ...(baseHash !== undefined ? { baseHash } : {}),
  });
  logConfigUpdated(runtime);

  const payload = {
    mode,
    remoteUrl,
    auth: opts.remoteToken ? "token" : "none",
  };
  if (opts.json) {
    writeRuntimeJson(runtime, payload);
  } else {
    runtime.log(t("wizard.setup.remoteGateway", { url: remoteUrl }));
    runtime.log(t("wizard.setup.remoteAuth", { auth: payload.auth }));
    runtime.log(
      t("wizard.setup.webSearchTip", {
        command: formatCliCommand("crawclaw configure --section web"),
      }),
    );
  }
}
