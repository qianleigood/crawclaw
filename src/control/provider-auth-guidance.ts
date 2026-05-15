import { normalizeProviderId } from "../agents/model-selection.js";
import type { CrawClawConfig } from "../config/config.js";
import { resolveManifestProviderAuthChoices } from "../plugins/provider-auth-choices.js";
import { formatCliCommand } from "../terminal/command-format.js";
import { createCliTranslator } from "../terminal/i18n/index.js";
import { getActiveCliLocale } from "../terminal/i18n/text.js";

export function resolveProviderAuthLoginCommand(params: {
  provider: string;
  config?: CrawClawConfig;
  workspaceDir?: string;
  env?: NodeJS.ProcessEnv;
}): string | undefined {
  const normalized = normalizeProviderId(params.provider);
  const provider = resolveManifestProviderAuthChoices(params).find(
    (choice) => normalizeProviderId(choice.providerId) === normalized,
  )?.providerId;
  if (!provider) {
    return undefined;
  }
  return formatCliCommand(`crawclaw models auth login --provider ${provider}`);
}

export function buildProviderAuthRecoveryHint(params: {
  provider: string;
  config?: CrawClawConfig;
  workspaceDir?: string;
  env?: NodeJS.ProcessEnv;
  includeConfigure?: boolean;
  includeEnvVar?: boolean;
}): string {
  const t = createCliTranslator(getActiveCliLocale());
  const loginCommand = resolveProviderAuthLoginCommand(params);
  const parts: string[] = [];
  if (loginCommand) {
    parts.push(t("wizard.modelCheck.recovery.run", { command: loginCommand }));
  }
  if (params.includeConfigure !== false) {
    parts.push(`\`${formatCliCommand("crawclaw configure")}\``);
  }
  if (params.includeEnvVar) {
    parts.push(t("wizard.modelCheck.recovery.setEnvVar"));
  }
  if (parts.length === 0) {
    return t("wizard.modelCheck.recovery.onlyConfigure", {
      command: formatCliCommand("crawclaw configure"),
    });
  }
  if (parts.length === 1) {
    return `${parts[0]}.`;
  }
  if (parts.length === 2) {
    return t("wizard.modelCheck.recovery.or", {
      first: parts[0],
      second: parts[1],
    });
  }
  return t("wizard.modelCheck.recovery.list", {
    first: parts[0],
    second: parts[1],
    third: parts[2],
  });
}
