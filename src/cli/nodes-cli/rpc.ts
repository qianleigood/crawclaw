import type { Command } from "commander";
import { callGateway, randomIdempotencyKey } from "../../gateway/call.js";
import { resolveNodeFromNodeList } from "../../shared/node-resolve.js";
import { GATEWAY_CLIENT_MODES, GATEWAY_CLIENT_NAMES } from "../../utils/message-channel.js";
import { createCliTranslator } from "../i18n/index.js";
import type { CliTranslator } from "../i18n/types.js";
import { getProgramContext } from "../program/program-context.js";
import { withProgress } from "../progress.js";
import { parseNodeList, parsePairingList } from "./format.js";
import type { NodeListNode, NodesRpcOpts } from "./types.js";

export function getCommandTranslator(command: Command): CliTranslator {
  let current: Command | undefined = command;
  while (current) {
    const ctx = getProgramContext(current);
    if (ctx) {
      return ctx.t;
    }
    current = current.parent ?? undefined;
  }
  return createCliTranslator("en");
}

export const nodesCallOpts = (cmd: Command, defaults?: { timeoutMs?: number }) => {
  const t = getCommandTranslator(cmd);
  return cmd
    .option("--url <url>", t("command.nodes.rpc.option.url"))
    .option("--token <token>", t("command.nodes.rpc.option.token"))
    .option(
      "--timeout <ms>",
      t("command.nodes.rpc.option.timeout"),
      String(defaults?.timeoutMs ?? 10_000),
    )
    .option("--json", t("command.nodes.rpc.option.json"), false);
};

export const callGatewayCli = async (
  method: string,
  opts: NodesRpcOpts,
  params?: unknown,
  callOpts?: { transportTimeoutMs?: number },
) =>
  withProgress(
    {
      label: `Nodes ${method}`,
      indeterminate: true,
      enabled: opts.json !== true,
    },
    async () =>
      await callGateway({
        url: opts.url,
        token: opts.token,
        method,
        params,
        timeoutMs: callOpts?.transportTimeoutMs ?? Number(opts.timeout ?? 10_000),
        clientName: GATEWAY_CLIENT_NAMES.CLI,
        mode: GATEWAY_CLIENT_MODES.CLI,
      }),
  );

export function buildNodeInvokeParams(params: {
  nodeId: string;
  command: string;
  params?: Record<string, unknown>;
  timeoutMs?: number;
  idempotencyKey?: string;
}): Record<string, unknown> {
  const invokeParams: Record<string, unknown> = {
    nodeId: params.nodeId,
    command: params.command,
    params: params.params,
    idempotencyKey: params.idempotencyKey ?? randomIdempotencyKey(),
  };
  if (typeof params.timeoutMs === "number" && Number.isFinite(params.timeoutMs)) {
    invokeParams.timeoutMs = params.timeoutMs;
  }
  return invokeParams;
}

export function unauthorizedHintForMessage(message: string): string | null {
  const haystack = message.toLowerCase();
  if (
    haystack.includes("unauthorizedclient") ||
    haystack.includes("bridge client is not authorized") ||
    haystack.includes("unsigned bridge clients are not allowed")
  ) {
    return [
      "peekaboo bridge rejected the client.",
      "sign the peekaboo CLI (TeamID Y5PE65HELJ) or launch the host with",
      "PEEKABOO_ALLOW_UNSIGNED_SOCKET_CLIENTS=1 for local dev.",
    ].join(" ");
  }
  return null;
}

export async function resolveNodeId(opts: NodesRpcOpts, query: string) {
  return (await resolveNode(opts, query)).nodeId;
}

export async function resolveNode(opts: NodesRpcOpts, query: string): Promise<NodeListNode> {
  let nodes: NodeListNode[] = [];
  try {
    const res = await callGatewayCli("node.list", opts, {});
    nodes = parseNodeList(res);
  } catch {
    const res = await callGatewayCli("node.pair.list", opts, {});
    const { paired } = parsePairingList(res);
    nodes = paired.map((n) => ({
      nodeId: n.nodeId,
      displayName: n.displayName,
      platform: n.platform,
      version: n.version,
      remoteIp: n.remoteIp,
    }));
  }
  return resolveNodeFromNodeList(nodes, query);
}
