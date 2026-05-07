import type { CrawClawConfig } from "../config/config.js";
import { STATE_DIR } from "../config/paths.js";
import { createObservationRoot } from "../infra/observation/context.js";
import { createSubsystemLogger } from "../logging/subsystem.js";
import { getPluginRuntimeStatus } from "./plugin-runtimes.js";
import type { PluginRegistry } from "./registry.js";
import type { CrawClawPluginServiceContext, PluginLogger } from "./types.js";

const log = createSubsystemLogger("plugins");
function createPluginLogger(): PluginLogger {
  return {
    info: (msg) => log.info(msg),
    warn: (msg) => log.warn(msg),
    error: (msg) => log.error(msg),
    debug: (msg) => log.debug(msg),
  };
}

function createServiceContext(params: {
  config: CrawClawConfig;
  workspaceDir?: string;
}): CrawClawPluginServiceContext {
  return {
    config: params.config,
    workspaceDir: params.workspaceDir,
    stateDir: STATE_DIR,
    observation: createObservationRoot({
      source: "plugin-service",
      runtime: {},
    }),
    logger: createPluginLogger(),
  };
}

export type PluginServicesHandle = {
  reconfigure: (config: CrawClawConfig) => Promise<void>;
  stop: () => Promise<void>;
};

export async function startPluginServices(params: {
  registry: PluginRegistry;
  config: CrawClawConfig;
  workspaceDir?: string;
}): Promise<PluginServicesHandle> {
  const running: Array<{
    id: string;
    service: (typeof params.registry.services)[number]["service"];
    context: CrawClawPluginServiceContext;
    stop?: (ctx: CrawClawPluginServiceContext) => void | Promise<void>;
  }> = [];
  const serviceContext = createServiceContext({
    config: params.config,
    workspaceDir: params.workspaceDir,
  });

  for (const entry of params.registry.services) {
    const service = entry.service;
    const runtimeStatus = getPluginRuntimeStatus(entry.pluginId);
    if (runtimeStatus && runtimeStatus.state !== "healthy") {
      log.warn(
        `plugin runtime not healthy (${entry.pluginId}): ${runtimeStatus.state ?? "unknown"}; service startup will continue and may fall back to bootstrap logic`,
      );
    }
    try {
      await service.start(serviceContext);
      running.push({
        id: service.id,
        service,
        context: serviceContext,
        stop: service.stop,
      });
    } catch (err) {
      const error = err as Error;
      const stack = error?.stack?.trim();
      log.error(
        `plugin service failed (${service.id}, plugin=${entry.pluginId}, root=${entry.rootDir ?? "unknown"}): ${error?.message ?? String(err)}${stack ? `\n${stack}` : ""}`,
      );
    }
  }

  return {
    reconfigure: async (config: CrawClawConfig) => {
      for (const entry of running) {
        const nextContext = createServiceContext({
          config,
          workspaceDir: params.workspaceDir,
        });
        if (entry.service.reconfigure) {
          try {
            await entry.service.reconfigure(nextContext);
            entry.context = nextContext;
          } catch (err) {
            log.warn(`plugin service reconfigure failed (${entry.id}): ${String(err)}`);
            throw err;
          }
          continue;
        }
        if (entry.stop) {
          try {
            await entry.stop(entry.context);
          } catch (err) {
            log.warn(`plugin service stop failed (${entry.id}): ${String(err)}`);
          }
        }
        try {
          await entry.service.start(nextContext);
          entry.context = nextContext;
        } catch (err) {
          log.error(`plugin service restart failed (${entry.id}): ${String(err)}`);
          throw err;
        }
      }
    },
    stop: async () => {
      for (const entry of running.toReversed()) {
        if (!entry.stop) {
          continue;
        }
        try {
          await entry.stop(entry.context);
        } catch (err) {
          log.warn(`plugin service stop failed (${entry.id}): ${String(err)}`);
        }
      }
    },
  };
}
