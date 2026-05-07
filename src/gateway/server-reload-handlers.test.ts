import { describe, expect, it, vi } from "vitest";
import type { CliDeps } from "../cli/deps.js";
import type { CrawClawConfig } from "../config/config.js";
import type { GatewayReloadPlan } from "./config-reload.js";
import type { GatewayCronState } from "./server-cron.js";
import { createGatewayReloadHandlers } from "./server-reload-handlers.js";

function makePlan(overrides: Partial<GatewayReloadPlan> = {}): GatewayReloadPlan {
  return {
    changedPaths: [],
    restartGateway: false,
    restartReasons: [],
    hotReasons: [],
    reloadHooks: false,
    restartGmailWatcher: false,
    restartCron: false,
    restartHeartbeat: false,
    restartHealthMonitor: false,
    reloadServerSurface: false,
    reloadDiscovery: false,
    reloadTailscale: false,
    restartModelPricing: false,
    restartUpdateCheck: false,
    restartMediaCleanup: false,
    reloadPluginRuntime: false,
    reloadBrowserRuntime: false,
    restartChannels: new Set(),
    noopPaths: [],
    unmatchedPaths: [],
    ownerIds: [],
    actions: new Set(),
    ...overrides,
  };
}

function createHarness() {
  const state = {
    hooksConfig: null,
    hookClientIpConfig: { trustedProxies: [], allowRealIpFallback: false },
    mainSessionWakeRunner: {
      stop: vi.fn(),
      updateConfig: vi.fn(),
    },
    cronState: {
      cron: { start: vi.fn(async () => {}), stop: vi.fn() } as unknown as GatewayCronState["cron"],
      storePath: "/tmp/cron.json",
      cronEnabled: true,
    },
    channelHealthMonitor: null,
  };
  const setState = vi.fn();
  const callbacks = {
    reloadServerSurface: vi.fn(async (_cfg: CrawClawConfig) => {}),
    reloadInternalHooks: vi.fn(async (_cfg: CrawClawConfig) => {}),
    reloadDiscovery: vi.fn(async (_cfg: CrawClawConfig) => {}),
    reloadTailscale: vi.fn(async (_cfg: CrawClawConfig) => {}),
    restartModelPricing: vi.fn((_cfg: CrawClawConfig) => {}),
    restartUpdateCheck: vi.fn((_cfg: CrawClawConfig) => {}),
    restartMediaCleanup: vi.fn((_cfg: CrawClawConfig) => {}),
    reloadPluginRuntime: vi.fn(async (_cfg: CrawClawConfig) => {}),
    reloadBrowserRuntime: vi.fn(async (_cfg: CrawClawConfig) => {}),
    reconfigureChannel: vi.fn(
      async (_name: string, _cfg: CrawClawConfig, _changedPaths: string[]) => {},
    ),
  };
  const handlers = createGatewayReloadHandlers({
    deps: {} as CliDeps,
    broadcast: vi.fn(),
    getState: () => state,
    setState,
    startChannel: vi.fn(async () => {}),
    stopChannel: vi.fn(async () => {}),
    logHooks: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    logChannels: { info: vi.fn(), error: vi.fn() },
    logCron: { error: vi.fn() },
    logReload: { info: vi.fn(), warn: vi.fn() },
    createHealthMonitor: vi.fn(),
    ...callbacks,
  });
  return { callbacks, handlers, setState };
}

describe("createGatewayReloadHandlers", () => {
  it("dispatches reconfigure owner actions without requesting a process restart", async () => {
    const { callbacks, handlers } = createHarness();
    const nextConfig: CrawClawConfig = {
      gateway: { auth: { mode: "token", token: "next" } },
      update: { auto: { enabled: true } },
      media: { ttlHours: 24 },
    };

    await handlers.applyHotReload(
      makePlan({
        reloadServerSurface: true,
        reloadDiscovery: true,
        reloadTailscale: true,
        reloadHooks: true,
        restartModelPricing: true,
        restartUpdateCheck: true,
        restartMediaCleanup: true,
        reloadPluginRuntime: true,
        reloadBrowserRuntime: true,
      }),
      nextConfig,
    );

    expect(callbacks.reloadServerSurface).toHaveBeenCalledWith(nextConfig);
    expect(callbacks.reloadDiscovery).toHaveBeenCalledWith(nextConfig);
    expect(callbacks.reloadTailscale).toHaveBeenCalledWith(nextConfig);
    expect(callbacks.reloadInternalHooks).toHaveBeenCalledWith(nextConfig);
    expect(callbacks.restartModelPricing).toHaveBeenCalledWith(nextConfig);
    expect(callbacks.restartUpdateCheck).toHaveBeenCalledWith(nextConfig);
    expect(callbacks.restartMediaCleanup).toHaveBeenCalledWith(nextConfig);
    expect(callbacks.reloadPluginRuntime).toHaveBeenCalledWith(nextConfig);
    expect(callbacks.reloadBrowserRuntime).toHaveBeenCalledWith(nextConfig);
  });

  it("routes channel reloads through the optional channel reconfigure hook", async () => {
    const { callbacks, handlers } = createHarness();
    const nextConfig: CrawClawConfig = { channels: { telegram: { enabled: true } } };

    await handlers.applyHotReload(
      makePlan({
        changedPaths: ["channels.telegram.enabled"],
        restartChannels: new Set(["telegram"]),
      }),
      nextConfig,
    );

    expect(callbacks.reconfigureChannel).toHaveBeenCalledWith("telegram", nextConfig, [
      "channels.telegram.enabled",
    ]);
  });

  it("stops later owner actions when an earlier reconfigure owner fails", async () => {
    const { callbacks, handlers, setState } = createHarness();
    callbacks.reloadServerSurface.mockRejectedValueOnce(new Error("surface failed"));

    await expect(
      handlers.applyHotReload(
        makePlan({
          reloadServerSurface: true,
          reloadDiscovery: true,
        }),
        { gateway: { port: 19000 } },
      ),
    ).rejects.toThrow("surface failed");

    expect(callbacks.reloadDiscovery).not.toHaveBeenCalled();
    expect(setState).not.toHaveBeenCalled();
  });
});
