import type { PluginManifestRegistry } from "../plugins/manifest-registry.js";
import type { PluginUiMetadata } from "./schema.js";

export function collectPluginSchemaMetadata(registry: PluginManifestRegistry): PluginUiMetadata[] {
  return registry.plugins
    .filter((plugin) => plugin.configSchema)
    .map((plugin) => ({
      id: plugin.id,
      ...(plugin.name ? { name: plugin.name } : {}),
      ...(plugin.description ? { description: plugin.description } : {}),
      configSchema: plugin.configSchema,
      ...(plugin.configUiHints ? { configUiHints: plugin.configUiHints } : {}),
    }));
}
