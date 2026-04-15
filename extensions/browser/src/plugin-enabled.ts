import type { CrawClawConfig } from "crawclaw/plugin-sdk/browser-support";
import {
  normalizePluginsConfig,
  resolveEffectiveEnableState,
} from "crawclaw/plugin-sdk/browser-support";

export function isDefaultBrowserPluginEnabled(cfg: CrawClawConfig): boolean {
  return resolveEffectiveEnableState({
    id: "browser",
    origin: "bundled",
    config: normalizePluginsConfig(cfg.plugins),
    rootConfig: cfg,
    enabledByDefault: true,
  }).enabled;
}
