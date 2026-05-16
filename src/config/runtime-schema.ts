import { loadPluginManifestRegistry } from "../plugins/manifest-registry.js";
import { loadConfig, readConfigFileSnapshot } from "./config.js";
import type { CrawClawConfig } from "./config.js";
import { buildConfigSchema, type ConfigSchemaResponse } from "./schema.js";

export function loadGatewayRuntimeConfigSchema(): ConfigSchemaResponse {
  const config = loadConfig();
  const registry = loadPluginManifestRegistry({ config, cache: false });
  return buildConfigSchema({ plugins: registry.plugins, cache: false });
}

export async function readBestEffortRuntimeConfigSchema(): Promise<ConfigSchemaResponse> {
  const snapshot = await readConfigFileSnapshot();
  const config = snapshot.valid ? snapshot.runtimeConfig : { plugins: { enabled: true } };
  void (config satisfies CrawClawConfig);
  const registry = loadPluginManifestRegistry({ config, cache: false });
  return buildConfigSchema({ plugins: registry.plugins, cache: false });
}
