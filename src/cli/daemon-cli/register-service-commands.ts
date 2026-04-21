import type { Command } from "commander";
import { inheritOptionFromParent } from "../command-options.js";
import { createCliTranslator } from "../i18n/index.js";
import { getProgramContext } from "../program/program-context.js";
import {
  runDaemonInstall,
  runDaemonRestart,
  runDaemonStart,
  runDaemonStatus,
  runDaemonStop,
  runDaemonUninstall,
} from "./runners.js";
import type { DaemonInstallOptions, GatewayRpcOpts } from "./types.js";

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

function resolveInstallOptions(
  cmdOpts: DaemonInstallOptions,
  command?: Command,
): DaemonInstallOptions {
  const parentForce = inheritOptionFromParent<boolean>(command, "force");
  const parentPort = inheritOptionFromParent<string>(command, "port");
  const parentToken = inheritOptionFromParent<string>(command, "token");
  return {
    ...cmdOpts,
    force: Boolean(cmdOpts.force || parentForce),
    port: cmdOpts.port ?? parentPort,
    token: cmdOpts.token ?? parentToken,
  };
}

function resolveRpcOptions(cmdOpts: GatewayRpcOpts, command?: Command): GatewayRpcOpts {
  const parentToken = inheritOptionFromParent<string>(command, "token");
  const parentPassword = inheritOptionFromParent<string>(command, "password");
  return {
    ...cmdOpts,
    token: cmdOpts.token ?? parentToken,
    password: cmdOpts.password ?? parentPassword,
  };
}

export function addGatewayServiceCommands(parent: Command, opts?: { statusDescription?: string }) {
  const t = findCommandTranslator(parent);
  parent
    .command("status")
    .description(opts?.statusDescription ?? t("command.gateway.status.description"))
    .option("--url <url>", t("command.daemon.status.option.url"))
    .option("--token <token>", t("command.daemon.status.option.token"))
    .option("--password <password>", t("command.daemon.status.option.password"))
    .option("--timeout <ms>", t("command.daemon.status.option.timeout"), "10000")
    .option("--no-probe", t("command.daemon.status.option.noProbe"))
    .option("--require-rpc", t("command.daemon.status.option.requireRpc"), false)
    .option("--deep", t("command.daemon.status.option.deep"), false)
    .option("--json", t("command.daemon.option.json"), false)
    .action(async (cmdOpts, command) => {
      await runDaemonStatus({
        rpc: resolveRpcOptions(cmdOpts, command),
        probe: Boolean(cmdOpts.probe),
        requireRpc: Boolean(cmdOpts.requireRpc),
        deep: Boolean(cmdOpts.deep),
        json: Boolean(cmdOpts.json),
      });
    });

  parent
    .command("install")
    .description(t("command.daemon.install.description"))
    .option("--port <port>", t("command.daemon.install.option.port"))
    .option("--runtime <runtime>", t("command.daemon.install.option.runtime"))
    .option("--token <token>", t("command.daemon.install.option.token"))
    .option("--force", t("command.daemon.install.option.force"), false)
    .option("--json", t("command.daemon.option.json"), false)
    .action(async (cmdOpts, command) => {
      await runDaemonInstall(resolveInstallOptions(cmdOpts, command));
    });

  parent
    .command("uninstall")
    .description(t("command.daemon.uninstall.description"))
    .option("--json", t("command.daemon.option.json"), false)
    .action(async (cmdOpts) => {
      await runDaemonUninstall(cmdOpts);
    });

  parent
    .command("start")
    .description(t("command.daemon.start.description"))
    .option("--json", t("command.daemon.option.json"), false)
    .action(async (cmdOpts) => {
      await runDaemonStart(cmdOpts);
    });

  parent
    .command("stop")
    .description(t("command.daemon.stop.description"))
    .option("--json", t("command.daemon.option.json"), false)
    .action(async (cmdOpts) => {
      await runDaemonStop(cmdOpts);
    });

  parent
    .command("restart")
    .description(t("command.daemon.restart.description"))
    .option("--json", t("command.daemon.option.json"), false)
    .action(async (cmdOpts) => {
      await runDaemonRestart(cmdOpts);
    });
}
