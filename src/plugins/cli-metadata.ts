import { resolveAgentWorkspaceDir, resolveDefaultAgentId } from "../agents/agent-scope.js";
import type { CrawClawConfig } from "../config/config.js";
import { loadConfig } from "../config/config.js";
import { applyPluginAutoEnable } from "../config/plugin-auto-enable.js";
import { createSubsystemLogger } from "../logging/subsystem.js";
import { loadCrawClawPluginCliRegistry, type PluginLoadOptions } from "./loader.js";
import type { CrawClawPluginCliCommandDescriptor, PluginLogger } from "./types.js";

type PluginCliDescriptorOptions = {
  locale?: "en" | "zh-CN";
};

const log = createSubsystemLogger("plugins");

function localizePluginCliDescriptor(
  descriptor: CrawClawPluginCliCommandDescriptor,
  options?: PluginCliDescriptorOptions,
): CrawClawPluginCliCommandDescriptor {
  if (options?.locale === "zh-CN" && descriptor.descriptionZhCN) {
    return {
      ...descriptor,
      description: descriptor.descriptionZhCN,
    };
  }
  return descriptor;
}

function resolvePluginCliLoadContext(cfg?: CrawClawConfig, env?: NodeJS.ProcessEnv) {
  const config = cfg ?? loadConfig();
  const autoEnabled = applyPluginAutoEnable({ config, env: env ?? process.env });
  const resolvedConfig = autoEnabled.config;
  const workspaceDir = resolveAgentWorkspaceDir(
    resolvedConfig,
    resolveDefaultAgentId(resolvedConfig),
  );
  const logger: PluginLogger = {
    info: (msg: string) => log.info(msg),
    warn: (msg: string) => log.warn(msg),
    error: (msg: string) => log.error(msg),
    debug: (msg: string) => log.debug(msg),
  };
  return {
    rawConfig: config,
    config: resolvedConfig,
    autoEnabledReasons: autoEnabled.autoEnabledReasons,
    workspaceDir,
    logger,
  };
}

async function loadPluginCliMetadataRegistry(
  cfg?: CrawClawConfig,
  env?: NodeJS.ProcessEnv,
  loaderOptions?: Pick<PluginLoadOptions, "pluginSdkResolution">,
) {
  const context = resolvePluginCliLoadContext(cfg, env);
  return {
    ...context,
    registry: await loadCrawClawPluginCliRegistry({
      config: context.config,
      activationSourceConfig: context.rawConfig,
      autoEnabledReasons: context.autoEnabledReasons,
      workspaceDir: context.workspaceDir,
      env,
      logger: context.logger,
      ...loaderOptions,
    }),
  };
}

export async function getPluginCliCommandDescriptors(
  cfg?: CrawClawConfig,
  env?: NodeJS.ProcessEnv,
  options?: PluginCliDescriptorOptions,
): Promise<CrawClawPluginCliCommandDescriptor[]> {
  try {
    const { registry } = await loadPluginCliMetadataRegistry(cfg, env);
    const seen = new Set<string>();
    const descriptors: CrawClawPluginCliCommandDescriptor[] = [];
    for (const entry of registry.cliRegistrars) {
      for (const descriptor of entry.descriptors) {
        if (seen.has(descriptor.name)) {
          continue;
        }
        seen.add(descriptor.name);
        descriptors.push(localizePluginCliDescriptor(descriptor, options));
      }
    }
    return descriptors;
  } catch {
    return [];
  }
}
