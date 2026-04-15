import crypto from "node:crypto";
import type { OperatorScope } from "../../gateway/method-scopes.js";
import { callGatewayTool, type GatewayCallOptions } from "./gateway.js";
import { resolveNodeId } from "./nodes-utils.js";

type InvokeNodeParams = {
  gatewayOpts: GatewayCallOptions;
  command: string;
  commandParams?: unknown;
  node?: string;
  nodeId?: string;
  timeoutMs?: number;
  allowDefaultNode?: boolean;
};

export async function invokeNode<T = Record<string, unknown>>(
  params: InvokeNodeParams,
): Promise<T> {
  const nodeId =
    params.nodeId ??
    (await resolveNodeId(params.gatewayOpts, params.node, params.allowDefaultNode ?? false));
  return await callGatewayTool<T>("node.invoke", params.gatewayOpts, {
    nodeId,
    command: params.command,
    params: params.commandParams ?? {},
    ...(typeof params.timeoutMs === "number" ? { timeoutMs: params.timeoutMs } : {}),
    idempotencyKey: crypto.randomUUID(),
  });
}

export async function invokeNodePayload<T = unknown>(params: InvokeNodeParams): Promise<T> {
  const raw = await invokeNode<{ payload?: T }>(params);
  return (raw?.payload ?? {}) as T;
}

export async function listGatewayNodes<T = Record<string, unknown>>(
  gatewayOpts: GatewayCallOptions,
): Promise<T> {
  return await callGatewayTool<T>("node.list", gatewayOpts, {});
}

export async function describeGatewayNode<T = Record<string, unknown>>(
  gatewayOpts: GatewayCallOptions,
  nodeId: string,
): Promise<T> {
  return await callGatewayTool<T>("node.describe", gatewayOpts, { nodeId });
}

export async function listNodePairings<T = Record<string, unknown>>(
  gatewayOpts: GatewayCallOptions,
  scopes?: OperatorScope[],
): Promise<T> {
  if (scopes) {
    return await callGatewayTool<T>("node.pair.list", gatewayOpts, {}, { scopes });
  }
  return await callGatewayTool<T>("node.pair.list", gatewayOpts, {});
}

export async function approveNodePairing<T = Record<string, unknown>>(
  gatewayOpts: GatewayCallOptions,
  requestId: string,
  scopes?: OperatorScope[],
): Promise<T> {
  return await callGatewayTool<T>(
    "node.pair.approve",
    gatewayOpts,
    { requestId },
    scopes ? { scopes } : undefined,
  );
}

export async function rejectNodePairing<T = Record<string, unknown>>(
  gatewayOpts: GatewayCallOptions,
  requestId: string,
): Promise<T> {
  return await callGatewayTool<T>("node.pair.reject", gatewayOpts, { requestId });
}
