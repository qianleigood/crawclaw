import type { CrawClawConfig } from "../../../config/config.js";

export async function maybeRepairAllowlistPolicyAllowFrom(config: CrawClawConfig): Promise<{
  config: CrawClawConfig;
  changes: string[];
  warnings?: string[];
}> {
  return { config, changes: [] };
}
