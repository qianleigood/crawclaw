import type { CrawClawConfig } from "../config/config.js";
import {
  ensureBrowserClientsAllowedOriginsForNonLoopbackBind,
  type GatewayNonLoopbackBindMode,
} from "../config/gateway-browser-client-origins.js";

export async function maybeSeedBrowserClientsAllowedOriginsAtStartup(params: {
  config: CrawClawConfig;
  writeConfig: (config: CrawClawConfig) => Promise<void>;
  log: { info: (msg: string) => void; warn: (msg: string) => void };
}): Promise<{ config: CrawClawConfig; persistedAllowedOriginsSeed: boolean }> {
  const seeded = ensureBrowserClientsAllowedOriginsForNonLoopbackBind(params.config);
  if (!seeded.seededOrigins || !seeded.bind) {
    return { config: params.config, persistedAllowedOriginsSeed: false };
  }
  try {
    await params.writeConfig(seeded.config);
    params.log.info(buildSeededOriginsInfoLog(seeded.seededOrigins, seeded.bind));
    return { config: seeded.config, persistedAllowedOriginsSeed: true };
  } catch (err) {
    params.log.warn(
      `gateway: failed to persist gateway.browserClients.allowedOrigins seed: ${String(err)}. The gateway will start with the in-memory value but config was not saved.`,
    );
  }
  return { config: seeded.config, persistedAllowedOriginsSeed: false };
}

function buildSeededOriginsInfoLog(origins: string[], bind: GatewayNonLoopbackBindMode): string {
  return (
    `gateway: seeded gateway.browserClients.allowedOrigins ${JSON.stringify(origins)} ` +
    `for bind=${bind} (required since v2026.2.26; see issue #29385). ` +
    "Add other origins to gateway.browserClients.allowedOrigins if needed."
  );
}
