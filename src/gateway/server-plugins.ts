import type { loadConfig } from "../config/config.js";
import { applyPluginAutoEnable } from "../config/plugin-auto-enable.js";
import { resolveGatewayStartupPluginIds } from "../plugins/gateway-startup-plugin-ids.js";
import { loadCrawClawPlugins } from "../plugins/loader.js";
import { createEmptyPluginRegistry } from "../plugins/registry-empty.js";
import { setActivePluginRegistry } from "../plugins/runtime.js";
import type { GatewayRequestHandler } from "./request-types.js";

// ── Plugin loading ──────────────────────────────────────────────────

export function loadGatewayPlugins(params: {
  cfg: ReturnType<typeof loadConfig>;
  activationSourceConfig?: ReturnType<typeof loadConfig>;
  autoEnabledReasons?: Readonly<Record<string, string[]>>;
  workspaceDir: string;
  log: {
    info: (msg: string) => void;
    warn: (msg: string) => void;
    error: (msg: string) => void;
    debug: (msg: string) => void;
  };
  coreGatewayHandlers: Record<string, GatewayRequestHandler>;
  baseMethods: string[];
  pluginIds?: string[];
}) {
  const autoEnabled =
    params.activationSourceConfig !== undefined
      ? {
          config: params.cfg,
          changes: [],
          autoEnabledReasons:
            params.autoEnabledReasons ??
            applyPluginAutoEnable({
              config: params.activationSourceConfig,
              env: process.env,
            }).autoEnabledReasons,
        }
      : params.autoEnabledReasons !== undefined
        ? {
            config: params.cfg,
            changes: [],
            autoEnabledReasons: params.autoEnabledReasons,
          }
        : applyPluginAutoEnable({
            config: params.cfg,
            env: process.env,
          });
  const resolvedConfig = autoEnabled.config;
  const pluginIds =
    params.pluginIds ??
    resolveGatewayStartupPluginIds({
      config: resolvedConfig,
      workspaceDir: params.workspaceDir,
      env: process.env,
    });
  if (pluginIds.length === 0) {
    const pluginRegistry = createEmptyPluginRegistry();
    setActivePluginRegistry(pluginRegistry);
    return {
      pluginRegistry,
      gatewayMethods: [...params.baseMethods],
    };
  }
  const pluginRegistry = loadCrawClawPlugins({
    config: resolvedConfig,
    activationSourceConfig: params.activationSourceConfig ?? params.cfg,
    autoEnabledReasons: autoEnabled.autoEnabledReasons,
    workspaceDir: params.workspaceDir,
    onlyPluginIds: pluginIds,
    logger: {
      info: (msg) => params.log.info(msg),
      warn: (msg) => params.log.warn(msg),
      error: (msg) => params.log.error(msg),
      debug: (msg) => params.log.debug(msg),
    },
    coreGatewayHandlers: params.coreGatewayHandlers,
  });
  const pluginMethods = Object.keys(pluginRegistry.gatewayHandlers);
  const gatewayMethods = Array.from(new Set([...params.baseMethods, ...pluginMethods]));
  return { pluginRegistry, gatewayMethods };
}
