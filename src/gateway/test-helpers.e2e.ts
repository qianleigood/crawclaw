import { writeFile } from "node:fs/promises";
import { clearConfigCache, clearRuntimeConfigSnapshot } from "../config/config.js";
import { clearSessionStoreCacheForTest } from "../config/sessions/store.js";
import { getDeterministicFreePortBlock } from "../test-utils/ports.js";
import {
  GATEWAY_CLIENT_MODES,
  GATEWAY_CLIENT_NAMES,
  type GatewayClientMode,
  type GatewayClientName,
} from "../utils/gateway-client-surface.js";
import { GatewayClient } from "./client.js";
import { startGatewayServer } from "./server.js";

export async function getFreeGatewayPort(): Promise<number> {
  return await getDeterministicFreePortBlock({ offsets: [0, 1, 2, 3, 4] });
}

export async function connectGatewayClient(params: {
  url: string;
  token?: string;
  clientName?: GatewayClientName;
  clientDisplayName?: string;
  clientVersion?: string;
  mode?: GatewayClientMode;
  platform?: string;
  deviceFamily?: string;
  role?: "operator";
  scopes?: string[];
  caps?: string[];
  commands?: string[];
  instanceId?: string;
  onEvent?: (evt: { event?: string; payload?: unknown }) => void;
  timeoutMs?: number;
  timeoutMessage?: string;
}) {
  const role = params.role ?? "operator";
  const scopes = params.scopes;
  const platform = params.platform ?? process.platform;
  return await new Promise<InstanceType<typeof GatewayClient>>((resolve, reject) => {
    let settled = false;
    const stop = (err?: Error, client?: InstanceType<typeof GatewayClient>) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      if (err) {
        reject(err);
      } else {
        resolve(client as InstanceType<typeof GatewayClient>);
      }
    };
    const client = new GatewayClient({
      url: params.url,
      token: params.token,
      clientName: params.clientName ?? GATEWAY_CLIENT_NAMES.TEST,
      clientDisplayName: params.clientDisplayName ?? "vitest",
      clientVersion: params.clientVersion ?? "dev",
      platform,
      deviceFamily: params.deviceFamily,
      mode: params.mode ?? GATEWAY_CLIENT_MODES.TEST,
      role,
      scopes,
      caps: params.caps,
      commands: params.commands,
      instanceId: params.instanceId,
      onEvent: params.onEvent,
      onHelloOk: () => stop(undefined, client),
      onConnectError: (err) => stop(err),
      onClose: (code, reason) =>
        stop(new Error(`gateway closed during connect (${code}): ${reason}`)),
    });
    const timer = setTimeout(
      () => stop(new Error(params.timeoutMessage ?? "gateway connect timeout")),
      params.timeoutMs ?? 10_000,
    );
    timer.unref();
    client.start();
  });
}

export async function disconnectGatewayClient(client: GatewayClient): Promise<void> {
  await client.stopAndWait();
}

export async function startGatewayWithClient(params: {
  cfg: unknown;
  configPath: string;
  token: string;
  clientDisplayName?: string;
}) {
  await writeFile(params.configPath, `${JSON.stringify(params.cfg, null, 2)}\n`);
  process.env.CRAWCLAW_CONFIG_PATH = params.configPath;
  clearRuntimeConfigSnapshot();
  clearConfigCache();
  clearSessionStoreCacheForTest();

  const port = await getFreeGatewayPort();
  const server = await startGatewayServer(port, {
    bind: "loopback",
    auth: { mode: "token", token: params.token },
  });
  const client = await connectGatewayClient({
    url: `ws://127.0.0.1:${port}`,
    token: params.token,
    clientDisplayName: params.clientDisplayName,
  });

  return { port, server, client };
}
