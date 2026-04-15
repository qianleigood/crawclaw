import { readStringParam } from "./common.js";
import { callGatewayTool, type GatewayCallOptions } from "./gateway.js";

const DEFAULT_UPDATE_TIMEOUT_MS = 20 * 60_000;

export type GatewayToolCaller = typeof callGatewayTool;

export function resolveGatewayWriteMeta(params: {
  input: Record<string, unknown>;
  agentSessionKey?: string;
}): {
  sessionKey: string | undefined;
  note: string | undefined;
  restartDelayMs: number | undefined;
} {
  const sessionKey =
    typeof params.input.sessionKey === "string" && params.input.sessionKey.trim()
      ? params.input.sessionKey.trim()
      : params.agentSessionKey?.trim() || undefined;
  const note =
    typeof params.input.note === "string" && params.input.note.trim()
      ? params.input.note.trim()
      : undefined;
  const restartDelayMs =
    typeof params.input.restartDelayMs === "number" && Number.isFinite(params.input.restartDelayMs)
      ? Math.floor(params.input.restartDelayMs)
      : undefined;
  return { sessionKey, note, restartDelayMs };
}

export async function getGatewayConfigSnapshot(
  callGateway: GatewayToolCaller,
  gatewayOpts: GatewayCallOptions,
): Promise<unknown> {
  return await callGateway("config.get", gatewayOpts, {});
}

export async function lookupGatewayConfigSchema(
  callGateway: GatewayToolCaller,
  gatewayOpts: GatewayCallOptions,
  path: string,
): Promise<unknown> {
  return await callGateway("config.schema.lookup", gatewayOpts, { path });
}

export async function applyGatewayConfig(
  callGateway: GatewayToolCaller,
  gatewayOpts: GatewayCallOptions,
  params: {
    raw: string;
    baseHash: string;
    sessionKey?: string;
    note?: string;
    restartDelayMs?: number;
  },
): Promise<unknown> {
  return await callGateway("config.apply", gatewayOpts, {
    raw: params.raw,
    baseHash: params.baseHash,
    sessionKey: params.sessionKey,
    note: params.note,
    restartDelayMs: params.restartDelayMs,
  });
}

export async function patchGatewayConfig(
  callGateway: GatewayToolCaller,
  gatewayOpts: GatewayCallOptions,
  params: {
    raw: string;
    baseHash: string;
    sessionKey?: string;
    note?: string;
    restartDelayMs?: number;
  },
): Promise<unknown> {
  return await callGateway("config.patch", gatewayOpts, {
    raw: params.raw,
    baseHash: params.baseHash,
    sessionKey: params.sessionKey,
    note: params.note,
    restartDelayMs: params.restartDelayMs,
  });
}

export function buildGatewayUpdateRunRequest(params: {
  input: Record<string, unknown>;
  gatewayOpts: GatewayCallOptions;
  agentSessionKey?: string;
}): {
  gatewayOpts: GatewayCallOptions;
  request: {
    sessionKey: string | undefined;
    note: string | undefined;
    restartDelayMs: number | undefined;
    timeoutMs: number;
  };
} {
  const meta = resolveGatewayWriteMeta({
    input: params.input,
    agentSessionKey: params.agentSessionKey,
  });
  const timeoutMs = params.gatewayOpts.timeoutMs ?? DEFAULT_UPDATE_TIMEOUT_MS;
  return {
    gatewayOpts: {
      ...params.gatewayOpts,
      timeoutMs,
    },
    request: {
      ...meta,
      timeoutMs,
    },
  };
}

export async function runGatewayUpdate(
  callGateway: GatewayToolCaller,
  params: {
    input: Record<string, unknown>;
    gatewayOpts: GatewayCallOptions;
    agentSessionKey?: string;
  },
): Promise<unknown> {
  const prepared = buildGatewayUpdateRunRequest(params);
  return await callGateway("update.run", prepared.gatewayOpts, prepared.request);
}

export async function resolveGatewayConfigWriteParams(params: {
  input: Record<string, unknown>;
  gatewayOpts: GatewayCallOptions;
  agentSessionKey?: string;
  callGateway: GatewayToolCaller;
  resolveBaseHashFromSnapshot: (snapshot: unknown) => string | undefined;
  getSnapshotConfig: (snapshot: unknown) => Record<string, unknown>;
}): Promise<{
  raw: string;
  baseHash: string;
  snapshotConfig: Record<string, unknown>;
  sessionKey: string | undefined;
  note: string | undefined;
  restartDelayMs: number | undefined;
}> {
  const raw = readStringParam(params.input, "raw", { required: true });
  const snapshot = await getGatewayConfigSnapshot(params.callGateway, params.gatewayOpts);
  const snapshotConfig = params.getSnapshotConfig(snapshot);
  let baseHash = readStringParam(params.input, "baseHash");
  if (!baseHash) {
    baseHash = params.resolveBaseHashFromSnapshot(snapshot);
  }
  if (!baseHash) {
    throw new Error("Missing baseHash from config snapshot.");
  }
  return {
    raw,
    baseHash,
    snapshotConfig,
    ...resolveGatewayWriteMeta({
      input: params.input,
      agentSessionKey: params.agentSessionKey,
    }),
  };
}
