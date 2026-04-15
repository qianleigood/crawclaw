import { resolveBrowserConfig } from "./browser/config.js";
import { loadConfig } from "./config/config.js";
import { isDefaultBrowserPluginEnabled } from "./plugin-enabled.js";

export function resolveBrowserRuntimeBootstrap() {
  const cfg = loadConfig();
  if (!isDefaultBrowserPluginEnabled(cfg)) {
    return null;
  }
  const resolved = resolveBrowserConfig(cfg.browser, cfg);
  if (!resolved.enabled) {
    return null;
  }
  return { cfg, resolved };
}
