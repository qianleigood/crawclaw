import { formatCliCommand } from "../cli/command-format.js";
import { createCliTranslator, resolveCliLocaleFromRuntime } from "../cli/i18n/index.js";
import { readConfigFileSnapshot } from "../config/config.js";
import { assertSupportedRuntime } from "../infra/runtime-guard.js";
import { resolveManifestDeprecatedProviderAuthChoice } from "../plugins/provider-auth-choices.js";
import type { RuntimeEnv } from "../runtime.js";
import { defaultRuntime } from "../runtime.js";
import { resolveUserPath } from "../utils.js";
import { isOnboardOutputPreset } from "../wizard/setup.output-presentation.js";
import { DEFAULT_WORKSPACE, handleReset } from "./onboard-helpers.js";
import { runInteractiveSetup } from "./onboard-interactive.js";
import { runNonInteractiveSetup } from "./onboard-non-interactive.js";
import type { OnboardOptions, ResetScope } from "./onboard-types.js";

const VALID_RESET_SCOPES = new Set<ResetScope>(["config", "config+creds+sessions", "full"]);

export async function setupWizardCommand(
  opts: OnboardOptions,
  runtime: RuntimeEnv = defaultRuntime,
) {
  assertSupportedRuntime(runtime);
  const t = createCliTranslator(resolveCliLocaleFromRuntime(process.argv));
  if (opts.authChoice === "oauth") {
    runtime.error(
      t("wizard.setup.error.authChoiceRemoved", {
        choice: "oauth",
        replacement: "setup-token",
      }),
    );
    runtime.exit(1);
    return;
  }
  if (typeof opts.authChoice === "string") {
    const deprecatedChoice = resolveManifestDeprecatedProviderAuthChoice(opts.authChoice, {
      env: process.env,
    });
    if (deprecatedChoice) {
      runtime.error(
        t("wizard.setup.error.authChoiceRemoved", {
          choice: opts.authChoice,
          replacement: deprecatedChoice.choiceId,
        }),
      );
      runtime.exit(1);
      return;
    }
  }
  const flow = opts.flow === "manual" ? ("advanced" as const) : opts.flow;
  const normalizedOpts = flow === opts.flow ? opts : { ...opts, flow };
  if (
    normalizedOpts.secretInputMode &&
    normalizedOpts.secretInputMode !== "plaintext" && // pragma: allowlist secret
    normalizedOpts.secretInputMode !== "ref" // pragma: allowlist secret
  ) {
    runtime.error(t("wizard.setup.error.invalidSecretInputMode"));
    runtime.exit(1);
    return;
  }

  if (normalizedOpts.resetScope && !VALID_RESET_SCOPES.has(normalizedOpts.resetScope)) {
    runtime.error(t("wizard.setup.error.invalidResetScope"));
    runtime.exit(1);
    return;
  }

  if (normalizedOpts.outputPreset && !isOnboardOutputPreset(normalizedOpts.outputPreset)) {
    runtime.error(t("wizard.setup.error.invalidOutputPreset"));
    runtime.exit(1);
    return;
  }

  if (normalizedOpts.nonInteractive && normalizedOpts.acceptRisk !== true) {
    runtime.error(
      [
        t("wizard.setup.error.riskRequired"),
        t("wizard.setup.error.readSecurityDocs"),
        t("wizard.setup.error.rerunWithAcceptRisk", {
          command: formatCliCommand("crawclaw onboard --non-interactive --accept-risk ..."),
        }),
      ].join("\n"),
    );
    runtime.exit(1);
    return;
  }

  if (normalizedOpts.reset) {
    const snapshot = await readConfigFileSnapshot();
    const baseConfig = snapshot.valid ? (snapshot.sourceConfig ?? snapshot.runtimeConfig) : {};
    const workspaceDefault =
      normalizedOpts.workspace ?? baseConfig.agents?.defaults?.workspace ?? DEFAULT_WORKSPACE;
    const resetScope: ResetScope = normalizedOpts.resetScope ?? "config+creds+sessions";
    await handleReset(resetScope, resolveUserPath(workspaceDefault), runtime);
  }

  if (process.platform === "win32") {
    runtime.log(
      [
        t("wizard.setup.windows.detected"),
        t("wizard.setup.windows.nativeWarning"),
        t("wizard.setup.windows.quickSetup"),
        t("wizard.setup.windows.guide"),
      ].join("\n"),
    );
  }

  if (normalizedOpts.nonInteractive) {
    await runNonInteractiveSetup(normalizedOpts, runtime);
    return;
  }

  await runInteractiveSetup(normalizedOpts, runtime);
}

export type { OnboardOptions } from "./onboard-types.js";
export type { OnboardOptions as SetupWizardOptions } from "./onboard-types.js";
