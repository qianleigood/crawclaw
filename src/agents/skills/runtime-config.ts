import { getRuntimeConfigSnapshot, type CrawClawConfig } from "../../config/config.js";

export function resolveSkillRuntimeConfig(config?: CrawClawConfig): CrawClawConfig | undefined {
  return getRuntimeConfigSnapshot() ?? config;
}
