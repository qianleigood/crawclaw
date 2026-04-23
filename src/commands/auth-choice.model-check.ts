import { ensureAuthProfileStore, listProfilesForProvider } from "../agents/auth-profiles.js";
import { hasUsableCustomProviderApiKey, resolveEnvApiKey } from "../agents/model-auth.js";
import { loadModelCatalog } from "../agents/model-catalog.js";
import { resolveDefaultModelForAgent } from "../agents/model-selection.js";
import { createCliTranslator } from "../cli/i18n/index.js";
import { getActiveCliLocale } from "../cli/i18n/text.js";
import type { CrawClawConfig } from "../config/config.js";
import type { WizardPrompter } from "../wizard/prompts.js";
import { buildProviderAuthRecoveryHint } from "./provider-auth-guidance.js";

export async function warnIfModelConfigLooksOff(
  config: CrawClawConfig,
  prompter: WizardPrompter,
  options?: { agentId?: string; agentDir?: string },
) {
  const t = createCliTranslator(getActiveCliLocale());
  const ref = resolveDefaultModelForAgent({
    cfg: config,
    agentId: options?.agentId,
  });
  const warnings: string[] = [];
  const catalog = await loadModelCatalog({
    config,
    useCache: false,
  });
  if (catalog.length > 0) {
    const known = catalog.some(
      (entry) => entry.provider === ref.provider && entry.id === ref.model,
    );
    if (!known) {
      warnings.push(
        t("wizard.modelCheck.missingModel", {
          model: `${ref.provider}/${ref.model}`,
        }),
      );
    }
  }

  const store = ensureAuthProfileStore(options?.agentDir);
  const hasProfile = listProfilesForProvider(store, ref.provider).length > 0;
  const envKey = resolveEnvApiKey(ref.provider);
  const hasCustomKey = hasUsableCustomProviderApiKey(config, ref.provider);
  if (!hasProfile && !envKey && !hasCustomKey) {
    warnings.push(t("wizard.modelCheck.missingAuth", { provider: ref.provider }));
    warnings.push(
      buildProviderAuthRecoveryHint({
        provider: ref.provider,
        config,
        includeEnvVar: true,
      }),
    );
  }

  if (warnings.length > 0) {
    await prompter.note(warnings.join("\n"), t("wizard.modelCheck.title"));
  }
}
