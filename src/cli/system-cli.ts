import type { Command } from "commander";
import { danger } from "../globals.js";
import { defaultRuntime } from "../runtime.js";
import { formatDocsLink } from "../terminal/links.js";
import { theme } from "../terminal/theme.js";
import type { GatewayRpcOpts } from "./gateway-rpc.js";
import { addGatewayClientOptions, callGatewayFromCli } from "./gateway-rpc.js";
import { createCliTranslator } from "./i18n/index.js";
import { getProgramContext } from "./program/program-context.js";

type SystemEventOpts = GatewayRpcOpts & { text?: string; mode?: string; json?: boolean };
type SystemGatewayOpts = GatewayRpcOpts & { json?: boolean };

const normalizeWakeMode = (raw: unknown) => {
  const mode = typeof raw === "string" ? raw.trim() : "";
  if (!mode) {
    return "now" as const;
  }
  if (mode === "now") {
    return "now" as const;
  }
  throw new Error("--mode must be now");
};

async function runSystemGatewayCommand(
  opts: SystemGatewayOpts,
  action: () => Promise<unknown>,
  successText?: string,
): Promise<void> {
  try {
    const result = await action();
    if (opts.json || successText === undefined) {
      defaultRuntime.writeJson(result);
    } else {
      defaultRuntime.log(successText);
    }
  } catch (err) {
    defaultRuntime.error(danger(String(err)));
    defaultRuntime.exit(1);
  }
}

export function registerSystemCli(program: Command) {
  const t = getProgramContext(program)?.t ?? createCliTranslator("en");
  const system = program
    .command("system")
    .description(t("command.system.description"))
    .addHelpText(
      "after",
      () =>
        `\n${theme.muted("Docs:")} ${formatDocsLink("/cli/system", "docs.crawclaw.ai/cli/system")}\n`,
    );

  addGatewayClientOptions(
    system
      .command("event")
      .description(t("command.system.event.description"))
      .requiredOption("--text <text>", t("command.system.event.option.text"))
      .option("--mode <mode>", t("command.system.event.option.mode"), "now")
      .option("--json", t("command.system.option.json"), false),
  ).action(async (opts: SystemEventOpts) => {
    await runSystemGatewayCommand(
      opts,
      async () => {
        const text = typeof opts.text === "string" ? opts.text.trim() : "";
        if (!text) {
          throw new Error("--text is required");
        }
        const mode = normalizeWakeMode(opts.mode);
        return await callGatewayFromCli("wake", opts, { mode, text }, { expectFinal: false });
      },
      "ok",
    );
  });

  const heartbeat = system
    .command("heartbeat")
    .description(t("command.system.heartbeat.description"));

  addGatewayClientOptions(
    heartbeat
      .command("last")
      .description(t("command.system.heartbeat.last.description"))
      .option("--json", t("command.system.option.json"), false),
  ).action(async (opts: SystemGatewayOpts) => {
    await runSystemGatewayCommand(opts, async () => {
      return await callGatewayFromCli("last-heartbeat", opts, undefined, {
        expectFinal: false,
      });
    });
  });

  addGatewayClientOptions(
    system
      .command("presence")
      .description(t("command.system.presence.description"))
      .option("--json", t("command.system.option.json"), false),
  ).action(async (opts: SystemGatewayOpts) => {
    await runSystemGatewayCommand(opts, async () => {
      return await callGatewayFromCli("system-presence", opts, undefined, {
        expectFinal: false,
      });
    });
  });
}
