import type { ChannelId } from "../channels/plugins/index.js";
import {
  buildGatewayReconfigurePlan,
  type GatewayReconfigureAction,
} from "./config-reconfigure-plan.js";

export type ChannelKind = ChannelId;

export type GatewayReloadPlan = {
  changedPaths: string[];
  restartGateway: boolean;
  restartReasons: string[];
  hotReasons: string[];
  reloadHooks: boolean;
  restartGmailWatcher: boolean;
  restartCron: boolean;
  restartHeartbeat: boolean;
  restartHealthMonitor: boolean;
  reloadServerSurface: boolean;
  reloadDiscovery: boolean;
  reloadTailscale: boolean;
  restartModelPricing: boolean;
  restartUpdateCheck: boolean;
  restartMediaCleanup: boolean;
  reloadPluginRuntime: boolean;
  reloadBrowserRuntime: boolean;
  restartChannels: Set<ChannelKind>;
  noopPaths: string[];
  unmatchedPaths: string[];
  ownerIds: string[];
  actions: Set<GatewayReconfigureAction>;
};

export function buildGatewayReloadPlan(changedPaths: string[]): GatewayReloadPlan {
  const reconfigurePlan = buildGatewayReconfigurePlan(changedPaths);
  return {
    changedPaths,
    restartGateway: reconfigurePlan.restartGateway,
    restartReasons: reconfigurePlan.restartReasons,
    hotReasons: reconfigurePlan.hotReasons,
    reloadHooks: reconfigurePlan.actions.has("reload-hooks"),
    restartGmailWatcher: reconfigurePlan.actions.has("restart-gmail-watcher"),
    restartCron: reconfigurePlan.actions.has("restart-cron"),
    restartHeartbeat: reconfigurePlan.actions.has("restart-heartbeat"),
    restartHealthMonitor: reconfigurePlan.actions.has("restart-health-monitor"),
    reloadServerSurface: reconfigurePlan.actions.has("reload-server-surface"),
    reloadDiscovery: reconfigurePlan.actions.has("reload-discovery"),
    reloadTailscale: reconfigurePlan.actions.has("reload-tailscale"),
    restartModelPricing: reconfigurePlan.actions.has("restart-model-pricing"),
    restartUpdateCheck: reconfigurePlan.actions.has("restart-update-check"),
    restartMediaCleanup: reconfigurePlan.actions.has("restart-media-cleanup"),
    reloadPluginRuntime: reconfigurePlan.actions.has("reload-plugin-runtime"),
    reloadBrowserRuntime: reconfigurePlan.actions.has("reload-browser-runtime"),
    restartChannels: reconfigurePlan.restartChannels,
    noopPaths: reconfigurePlan.noopPaths,
    unmatchedPaths: reconfigurePlan.unmatchedPaths,
    ownerIds: reconfigurePlan.ownerIds,
    actions: reconfigurePlan.actions,
  };
}
