import { resolveAgentWorkspaceDir, resolveDefaultAgentId } from "../agents/agent-scope.js";
import { loadConfig } from "../config/config.js";
import { applyPluginAutoEnable } from "../config/plugin-auto-enable.js";
import { createSubsystemLogger } from "../logging.js";
import { loadCrawClawPlugins } from "../plugins/loader.js";
import type { PluginLogger } from "../plugins/types.js";

const log = createSubsystemLogger("plugins");
let pluginRegistryLoaded = false;

export function ensurePluginRegistryLoaded(): void {
  if (pluginRegistryLoaded) {
    return;
  }
  const config = loadConfig();
  const autoEnabled = applyPluginAutoEnable({ config, env: process.env });
  const resolvedConfig = autoEnabled.config;
  const workspaceDir = resolveAgentWorkspaceDir(
    resolvedConfig,
    resolveDefaultAgentId(resolvedConfig),
  );
  const logger: PluginLogger = {
    info: (msg) => log.info(msg),
    warn: (msg) => log.warn(msg),
    error: (msg) => log.error(msg),
    debug: (msg) => log.debug(msg),
  };
  loadCrawClawPlugins({
    config: resolvedConfig,
    activationSourceConfig: config,
    autoEnabledReasons: autoEnabled.autoEnabledReasons,
    workspaceDir,
    logger,
    throwOnLoadError: true,
  });
  pluginRegistryLoaded = true;
}

export const __testing = {
  resetPluginRegistryLoadedForTests(): void {
    pluginRegistryLoaded = false;
  },
};
