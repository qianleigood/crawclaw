import type { CrawClawConfig } from "./config.js";
import { DEFAULT_GATEWAY_PORT } from "./paths.js";

export type GatewayNonLoopbackBindMode = "lan" | "tailnet" | "custom";

export function isGatewayNonLoopbackBindMode(bind: unknown): bind is GatewayNonLoopbackBindMode {
  return bind === "lan" || bind === "tailnet" || bind === "custom";
}

export function hasConfiguredBrowserClientsAllowedOrigins(params: {
  allowedOrigins: unknown;
  dangerouslyAllowHostHeaderOriginFallback: unknown;
}): boolean {
  if (params.dangerouslyAllowHostHeaderOriginFallback === true) {
    return true;
  }
  return (
    Array.isArray(params.allowedOrigins) &&
    params.allowedOrigins.some((origin) => typeof origin === "string" && origin.trim().length > 0)
  );
}

export function resolveGatewayPortWithDefault(
  port: unknown,
  fallback = DEFAULT_GATEWAY_PORT,
): number {
  return typeof port === "number" && port > 0 ? port : fallback;
}

export function buildDefaultBrowserClientsAllowedOrigins(params: {
  port: number;
  bind: unknown;
  customBindHost?: string;
}): string[] {
  const origins = new Set<string>([
    `http://localhost:${params.port}`,
    `http://127.0.0.1:${params.port}`,
  ]);
  const customBindHost = params.customBindHost?.trim();
  if (params.bind === "custom" && customBindHost) {
    origins.add(`http://${customBindHost}:${params.port}`);
  }
  return [...origins];
}

export function ensureBrowserClientsAllowedOriginsForNonLoopbackBind(
  config: CrawClawConfig,
  opts?: { defaultPort?: number },
): {
  config: CrawClawConfig;
  seededOrigins: string[] | null;
  bind: GatewayNonLoopbackBindMode | null;
} {
  const bind = config.gateway?.bind;
  if (!isGatewayNonLoopbackBindMode(bind)) {
    return { config, seededOrigins: null, bind: null };
  }
  if (
    hasConfiguredBrowserClientsAllowedOrigins({
      allowedOrigins: config.gateway?.browserClients?.allowedOrigins,
      dangerouslyAllowHostHeaderOriginFallback:
        config.gateway?.browserClients?.dangerouslyAllowHostHeaderOriginFallback,
    })
  ) {
    return { config, seededOrigins: null, bind };
  }

  const port = resolveGatewayPortWithDefault(config.gateway?.port, opts?.defaultPort);
  const seededOrigins = buildDefaultBrowserClientsAllowedOrigins({
    port,
    bind,
    customBindHost: config.gateway?.customBindHost,
  });
  return {
    config: {
      ...config,
      gateway: {
        ...config.gateway,
        browserClients: {
          ...config.gateway?.browserClients,
          allowedOrigins: seededOrigins,
        },
      },
    },
    seededOrigins,
    bind,
  };
}
