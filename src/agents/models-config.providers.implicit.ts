import type { CrawClawConfig } from "../config/config.js";

type ImplicitProviderParams = {
  agentDir: string;
  config?: CrawClawConfig;
  env?: NodeJS.ProcessEnv;
  workspaceDir?: string;
  explicitProviders?: NonNullable<CrawClawConfig["models"]>["providers"] | null;
};

export async function resolveImplicitProviders(
  _params: ImplicitProviderParams,
): Promise<NonNullable<CrawClawConfig["models"]>["providers"]> {
  return {};
}
