import type { CrawClawConfig } from "../config/config.js";

export function setPluginEnabledInConfig(
  config: CrawClawConfig,
  pluginId: string,
  enabled: boolean,
): CrawClawConfig {
  const resolvedId = pluginId;

  return {
    ...config,
    plugins: {
      ...config.plugins,
      entries: {
        ...config.plugins?.entries,
        [resolvedId]: {
          ...(config.plugins?.entries?.[resolvedId] as object | undefined),
          enabled,
        },
      },
    },
  };
}
