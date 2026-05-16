import type { CrawClawConfig } from "../config/config.js";

export function normalizeCompatibilityConfigValues(config: CrawClawConfig): {
  config: CrawClawConfig;
  changes: string[];
  warnings?: string[];
} {
  return { config, changes: [] };
}
