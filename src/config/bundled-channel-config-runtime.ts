import { buildChannelConfigSchema } from "../channels/plugins/config-schema.js";
import type {
  ChannelConfigRuntimeSchema,
  ChannelConfigSchema,
} from "../channels/plugins/types.plugin.js";
import { listBundledPluginMetadata } from "../plugins/bundled-plugin-metadata.js";
import { MSTeamsConfigSchema } from "./zod-schema.providers-core.js";
import { WhatsAppConfigSchema } from "./zod-schema.providers-whatsapp.js";

type BundledChannelRuntimeMap = ReadonlyMap<string, ChannelConfigRuntimeSchema>;
type BundledChannelConfigSchemaMap = ReadonlyMap<string, ChannelConfigSchema>;
type BundledChannelMaps = {
  runtimeMap: Map<string, ChannelConfigRuntimeSchema>;
  configSchemaMap: Map<string, ChannelConfigSchema>;
};

const staticBundledChannelSchemas = new Map<string, ChannelConfigSchema>([
  ["msteams", buildChannelConfigSchema(MSTeamsConfigSchema)],
  ["whatsapp", buildChannelConfigSchema(WhatsAppConfigSchema)],
]);
let cachedBundledChannelMaps: BundledChannelMaps | undefined;

function buildBundledChannelMaps(): BundledChannelMaps {
  const runtimeMap = new Map<string, ChannelConfigRuntimeSchema>();
  const configSchemaMap = new Map<string, ChannelConfigSchema>();

  for (const entry of listBundledPluginMetadata({ includeChannelConfigs: true })) {
    const channelConfigs = entry.manifest.channelConfigs;
    if (!channelConfigs) {
      continue;
    }
    for (const [channelId, channelConfig] of Object.entries(channelConfigs)) {
      const channelSchema = channelConfig?.schema as Record<string, unknown> | undefined;
      if (!channelSchema) {
        continue;
      }
      if (!configSchemaMap.has(channelId)) {
        configSchemaMap.set(channelId, { schema: channelSchema });
      }
    }
  }

  for (const [channelId, channelSchema] of staticBundledChannelSchemas) {
    if (!configSchemaMap.has(channelId)) {
      configSchemaMap.set(channelId, channelSchema);
    }
    if (channelSchema.runtime && !runtimeMap.has(channelId)) {
      runtimeMap.set(channelId, channelSchema.runtime);
    }
  }

  return { runtimeMap, configSchemaMap };
}

function getBundledChannelMaps(): BundledChannelMaps {
  if (cachedBundledChannelMaps) {
    return cachedBundledChannelMaps;
  }

  cachedBundledChannelMaps = buildBundledChannelMaps();
  return cachedBundledChannelMaps;
}

export function getBundledChannelRuntimeMap(): BundledChannelRuntimeMap {
  return getBundledChannelMaps().runtimeMap;
}

export function getBundledChannelConfigSchemaMap(): BundledChannelConfigSchemaMap {
  return getBundledChannelMaps().configSchemaMap;
}
