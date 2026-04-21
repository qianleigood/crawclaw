import type { Command } from "commander";
import { callGateway } from "../gateway/call.js";
import { GATEWAY_CLIENT_MODES, GATEWAY_CLIENT_NAMES } from "../utils/message-channel.js";
import { createCliTranslator } from "./i18n/index.js";
import { getProgramContext } from "./program/program-context.js";
import { withProgress } from "./progress.js";

export type GatewayRpcOpts = {
  url?: string;
  token?: string;
  timeout?: string;
  expectFinal?: boolean;
  json?: boolean;
};

function findCommandTranslator(command: Command) {
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

export function addGatewayClientOptions(cmd: Command) {
  const t = findCommandTranslator(cmd);
  return cmd
    .option("--url <url>", t("command.gatewayRpc.option.url"))
    .option("--token <token>", t("command.gatewayRpc.option.token"))
    .option("--timeout <ms>", t("command.gatewayRpc.option.timeout"), "30000")
    .option("--expect-final", t("command.gatewayRpc.option.expectFinal"), false);
}

export async function callGatewayFromCli(
  method: string,
  opts: GatewayRpcOpts,
  params?: unknown,
  extra?: { expectFinal?: boolean; progress?: boolean },
) {
  const showProgress = extra?.progress ?? opts.json !== true;
  return await withProgress(
    {
      label: `Gateway ${method}`,
      indeterminate: true,
      enabled: showProgress,
    },
    async () =>
      await callGateway({
        url: opts.url,
        token: opts.token,
        method,
        params,
        expectFinal: extra?.expectFinal ?? Boolean(opts.expectFinal),
        timeoutMs: Number(opts.timeout ?? 10_000),
        clientName: GATEWAY_CLIENT_NAMES.CLI,
        mode: GATEWAY_CLIENT_MODES.CLI,
      }),
  );
}
