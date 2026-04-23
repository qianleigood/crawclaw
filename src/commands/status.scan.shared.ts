import type { CrawClawConfig } from "../config/types.js";
import { buildGatewayConnectionDetailsWithResolvers } from "../gateway/connection-details.js";
import { normalizeControlUiBasePath } from "../gateway/control-ui-shared.js";
import { probeGateway } from "../gateway/probe.js";
export { pickGatewaySelfPresence } from "./gateway-presence.js";

let gatewayProbeModulePromise: Promise<typeof import("./status.gateway-probe.js")> | undefined;

function loadGatewayProbeModule() {
  gatewayProbeModulePromise ??= import("./status.gateway-probe.js");
  return gatewayProbeModulePromise;
}

export type GatewayProbeSnapshot = {
  gatewayConnection: ReturnType<typeof buildGatewayConnectionDetailsWithResolvers>;
  remoteUrlMissing: boolean;
  gatewayMode: "local" | "remote";
  gatewayProbeAuth: {
    token?: string;
    password?: string;
  };
  gatewayProbeAuthWarning?: string;
  gatewayProbe: Awaited<ReturnType<typeof probeGateway>> | null;
};

export async function resolveGatewayProbeSnapshot(params: {
  cfg: CrawClawConfig;
  opts: { timeoutMs?: number; all?: boolean; skipProbe?: boolean };
}): Promise<GatewayProbeSnapshot> {
  const gatewayConnection = buildGatewayConnectionDetailsWithResolvers({ config: params.cfg });
  const isRemoteMode = params.cfg.gateway?.mode === "remote";
  const remoteUrlRaw =
    typeof params.cfg.gateway?.remote?.url === "string" ? params.cfg.gateway.remote.url : "";
  const remoteUrlMissing = isRemoteMode && !remoteUrlRaw.trim();
  const gatewayMode = isRemoteMode ? "remote" : "local";
  if (remoteUrlMissing || params.opts.skipProbe) {
    return {
      gatewayConnection,
      remoteUrlMissing,
      gatewayMode,
      gatewayProbeAuth: {},
      gatewayProbeAuthWarning: undefined,
      gatewayProbe: null,
    };
  }
  const { resolveGatewayProbeAuthResolution } = await loadGatewayProbeModule();
  const gatewayProbeAuthResolution = await resolveGatewayProbeAuthResolution(params.cfg);
  let gatewayProbeAuthWarning = gatewayProbeAuthResolution.warning;
  const gatewayProbe = await probeGateway({
    url: gatewayConnection.url,
    auth: gatewayProbeAuthResolution.auth,
    timeoutMs: Math.min(params.opts.all ? 5000 : 2500, params.opts.timeoutMs ?? 10_000),
    detailLevel: "presence",
  }).catch(() => null);
  if (gatewayProbeAuthWarning && gatewayProbe?.ok === false) {
    gatewayProbe.error = gatewayProbe.error
      ? `${gatewayProbe.error}; ${gatewayProbeAuthWarning}`
      : gatewayProbeAuthWarning;
    gatewayProbeAuthWarning = undefined;
  }
  return {
    gatewayConnection,
    remoteUrlMissing,
    gatewayMode,
    gatewayProbeAuth: gatewayProbeAuthResolution.auth,
    gatewayProbeAuthWarning,
    gatewayProbe,
  };
}

export function buildTailscaleHttpsUrl(params: {
  tailscaleMode: string;
  tailscaleDns: string | null;
  controlUiBasePath?: string;
}): string | null {
  return params.tailscaleMode !== "off" && params.tailscaleDns
    ? `https://${params.tailscaleDns}${normalizeControlUiBasePath(params.controlUiBasePath)}`
    : null;
}
