import type { CrawClawConfig } from "./config.js";

export function ensurePluginAllowlisted(cfg: CrawClawConfig, pluginId: string): CrawClawConfig {
  const allow = cfg.plugins?.allow;
  if (!Array.isArray(allow) || allow.includes(pluginId)) {
    return cfg;
  }
  return {
    ...cfg,
    plugins: {
      ...cfg.plugins,
      allow: [...allow, pluginId],
    },
  };
}
