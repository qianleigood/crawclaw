import type { Command } from "commander";
import type { CrawClawConfig } from "../../config/config.js";
import { callGateway } from "../../gateway/call.js";
import { GATEWAY_CLIENT_MODES, GATEWAY_CLIENT_NAMES } from "../../utils/message-channel.js";
import { createCliTranslator } from "../i18n/index.js";
import { getProgramContext } from "../program/program-context.js";
import { withProgress } from "../progress.js";

export type GatewayRpcOpts = {
  config?: CrawClawConfig;
  url?: string;
  token?: string;
  password?: string;
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

export const gatewayCallOpts = (cmd: Command) => {
  const t = findCommandTranslator(cmd);
  return cmd
    .option("--url <url>", t("command.gateway.call.option.url"))
    .option("--token <token>", t("command.gateway.call.option.token"))
    .option("--password <password>", t("command.gateway.call.option.password"))
    .option("--timeout <ms>", t("command.gateway.call.option.timeout"), "10000")
    .option("--expect-final", t("command.gateway.call.option.expectFinal"), false)
    .option("--json", t("command.gateway.option.json"), false);
};

export const callGatewayCli = async (method: string, opts: GatewayRpcOpts, params?: unknown) =>
  withProgress(
    {
      label: `Gateway ${method}`,
      indeterminate: true,
      enabled: opts.json !== true,
    },
    async () =>
      await callGateway({
        config: opts.config,
        url: opts.url,
        token: opts.token,
        password: opts.password,
        method,
        params,
        expectFinal: Boolean(opts.expectFinal),
        timeoutMs: Number(opts.timeout ?? 10_000),
        clientName: GATEWAY_CLIENT_NAMES.CLI,
        mode: GATEWAY_CLIENT_MODES.CLI,
      }),
  );
