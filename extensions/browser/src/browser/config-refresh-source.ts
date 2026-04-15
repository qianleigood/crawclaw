import {
  createConfigIO,
  getRuntimeConfigSnapshot,
  type CrawClawConfig,
} from "../config/config.js";

export function loadBrowserConfigForRuntimeRefresh(): CrawClawConfig {
  return getRuntimeConfigSnapshot() ?? createConfigIO().loadConfig();
}
