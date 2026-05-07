import { beforeEach, describe, expect, it, vi } from "vitest";
import { createEmptyPluginRegistry } from "./registry.js";
import type { CrawClawPluginService, CrawClawPluginServiceContext } from "./types.js";

const mockedLogger = vi.hoisted(() => ({
  info: vi.fn<(msg: string) => void>(),
  warn: vi.fn<(msg: string) => void>(),
  error: vi.fn<(msg: string) => void>(),
  debug: vi.fn<(msg: string) => void>(),
  child: vi.fn(() => mockedLogger),
}));

vi.mock("../logging/subsystem.js", () => ({
  createSubsystemLogger: () => mockedLogger,
}));

import { STATE_DIR } from "../config/paths.js";
import { startPluginServices } from "./services.js";

function createRegistry(services: CrawClawPluginService[]) {
  const registry = createEmptyPluginRegistry();
  registry.services = services.map((service) => ({
    pluginId: "plugin:test",
    service,
    source: "test",
    rootDir: "/plugins/test-plugin",
  })) as typeof registry.services;
  return registry;
}

function createServiceConfig() {
  return {} as Parameters<typeof startPluginServices>[0]["config"];
}

function expectServiceContext(
  ctx: CrawClawPluginServiceContext,
  config: Parameters<typeof startPluginServices>[0]["config"],
) {
  expect(ctx.config).toBe(config);
  expect(ctx.workspaceDir).toBe("/tmp/workspace");
  expect(ctx.stateDir).toBe(STATE_DIR);
  expectServiceLogger(ctx);
}

function expectServiceLogger(ctx: CrawClawPluginServiceContext) {
  expect(ctx.logger).toBeDefined();
  expect(typeof ctx.logger.info).toBe("function");
  expect(typeof ctx.logger.warn).toBe("function");
  expect(typeof ctx.logger.error).toBe("function");
}

function expectServiceContexts(
  contexts: CrawClawPluginServiceContext[],
  config: Parameters<typeof startPluginServices>[0]["config"],
) {
  expect(contexts).not.toHaveLength(0);
  contexts.forEach((ctx) => {
    expectServiceContext(ctx, config);
  });
}

function expectServiceLifecycleState(params: {
  starts: string[];
  stops: string[];
  contexts: CrawClawPluginServiceContext[];
  config: Parameters<typeof startPluginServices>[0]["config"];
}) {
  expect(params.starts).toEqual(["a", "b", "c"]);
  expect(params.stops).toEqual(["c", "a"]);
  expect(params.contexts).toHaveLength(3);
  expectServiceContexts(params.contexts, params.config);
}

async function startTrackingServices(params: {
  services: CrawClawPluginService[];
  config?: Parameters<typeof startPluginServices>[0]["config"];
  workspaceDir?: string;
}) {
  return startPluginServices({
    registry: createRegistry(params.services),
    config: params.config ?? createServiceConfig(),
    ...(params.workspaceDir ? { workspaceDir: params.workspaceDir } : {}),
  });
}

function createTrackingService(
  id: string,
  params: {
    starts?: string[];
    stops?: string[];
    contexts?: CrawClawPluginServiceContext[];
    failOnStart?: boolean;
    failOnStop?: boolean;
    stopSpy?: () => void;
  } = {},
): CrawClawPluginService {
  return {
    id,
    start: (ctx) => {
      if (params.failOnStart) {
        throw new Error("start failed");
      }
      params.starts?.push(id.at(-1) ?? id);
      params.contexts?.push(ctx);
    },
    stop: params.stopSpy
      ? () => {
          params.stopSpy?.();
        }
      : params.stops || params.failOnStop
        ? () => {
            if (params.failOnStop) {
              throw new Error("stop failed");
            }
            params.stops?.push(id.at(-1) ?? id);
          }
        : undefined,
  };
}

describe("startPluginServices", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("starts services and stops them in reverse order", async () => {
    const starts: string[] = [];
    const stops: string[] = [];
    const contexts: CrawClawPluginServiceContext[] = [];

    const config = createServiceConfig();
    const handle = await startTrackingServices({
      services: [
        createTrackingService("service-a", { starts, stops, contexts }),
        createTrackingService("service-b", { starts, contexts }),
        createTrackingService("service-c", { starts, stops, contexts }),
      ],
      config,
      workspaceDir: "/tmp/workspace",
    });
    await handle.stop();

    expectServiceLifecycleState({ starts, stops, contexts, config });
  });

  it("logs start/stop failures and continues", async () => {
    const stopOk = vi.fn();
    const stopThrows = vi.fn(() => {
      throw new Error("stop failed");
    });

    const handle = await startTrackingServices({
      services: [
        createTrackingService("service-start-fail", {
          failOnStart: true,
          stopSpy: vi.fn(),
        }),
        createTrackingService("service-ok", { stopSpy: stopOk }),
        createTrackingService("service-stop-fail", { stopSpy: stopThrows }),
      ],
    });

    await handle.stop();

    expect(mockedLogger.error).toHaveBeenCalledWith(
      expect.stringContaining(
        "plugin service failed (service-start-fail, plugin=plugin:test, root=/plugins/test-plugin):",
      ),
    );
    expect(mockedLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining("plugin service stop failed (service-stop-fail):"),
    );
    expect(stopOk).toHaveBeenCalledOnce();
    expect(stopThrows).toHaveBeenCalledOnce();
  });

  it("reconfigures services that implement the optional runtime hook", async () => {
    const contexts: CrawClawPluginServiceContext[] = [];
    const reconfigureContexts: CrawClawPluginServiceContext[] = [];
    const initialConfig = createServiceConfig();
    const nextConfig = { plugins: { enabled: true } };
    const service: CrawClawPluginService = {
      id: "service-reconfigure",
      start: (ctx) => {
        contexts.push(ctx);
      },
      reconfigure: (ctx) => {
        reconfigureContexts.push(ctx);
      },
    };

    const handle = await startTrackingServices({
      services: [service],
      config: initialConfig,
      workspaceDir: "/tmp/workspace",
    });
    await handle.reconfigure(nextConfig);
    await handle.stop();

    expect(contexts).toHaveLength(1);
    expect(reconfigureContexts).toHaveLength(1);
    expectServiceContext(reconfigureContexts[0], nextConfig);
  });

  it("falls back to stop/start when a service has no reconfigure hook", async () => {
    const starts: string[] = [];
    const stops: string[] = [];
    const contexts: CrawClawPluginServiceContext[] = [];
    const initialConfig = createServiceConfig();
    const nextConfig = { plugins: { enabled: false } };

    const handle = await startTrackingServices({
      services: [createTrackingService("service-a", { starts, stops, contexts })],
      config: initialConfig,
      workspaceDir: "/tmp/workspace",
    });
    await handle.reconfigure(nextConfig);
    await handle.stop();

    expect(starts).toEqual(["a", "a"]);
    expect(stops).toEqual(["a", "a"]);
    expect(contexts).toHaveLength(2);
    expectServiceContext(contexts[0], initialConfig);
    expectServiceContext(contexts[1], nextConfig);
  });
});
