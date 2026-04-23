import { normalizeProviderId } from "../agents/model-selection.js";
import { formatCliCommand } from "../cli/command-format.js";
import { createCliTranslator } from "../cli/i18n/index.js";
import { getActiveCliLocale } from "../cli/i18n/text.js";
import type { CrawClawConfig } from "../config/config.js";
import { resolvePluginProviders } from "../plugins/providers.runtime.js";

function matchesProviderId(
  candidate: { id: string; aliases?: string[] | readonly string[] },
  providerId: string,
): boolean {
  const normalized = normalizeProviderId(providerId);
  if (!normalized) {
    return false;
  }
  if (normalizeProviderId(candidate.id) === normalized) {
    return true;
  }
  return (candidate.aliases ?? []).some((alias) => normalizeProviderId(alias) === normalized);
}

export function resolveProviderAuthLoginCommand(params: {
  provider: string;
  config?: CrawClawConfig;
  workspaceDir?: string;
  env?: NodeJS.ProcessEnv;
}): string | undefined {
  const provider = resolvePluginProviders({
    config: params.config,
    workspaceDir: params.workspaceDir,
    env: params.env,
    bundledProviderAllowlistCompat: true,
    bundledProviderVitestCompat: true,
  }).find((candidate) => matchesProviderId(candidate, params.provider));
  if (!provider || provider.auth.length === 0) {
    return undefined;
  }
  return formatCliCommand(`crawclaw models auth login --provider ${provider.id}`);
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
