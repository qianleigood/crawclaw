import type { Command } from "commander";
import { defaultRuntime } from "../../runtime.js";
import { addGatewayClientOptions, callGatewayFromCli } from "../gateway-rpc.js";
import type { CliTranslator } from "../i18n/types.js";
import { handleCronCliError, printCronJson, warnIfCronSchedulerDisabled } from "./shared.js";

function registerCronToggleCommand(params: {
  cron: Command;
  name: "enable" | "disable";
  description: string;
  t: CliTranslator;
  enabled: boolean;
}) {
  addGatewayClientOptions(
    params.cron
      .command(params.name)
      .description(params.description)
      .argument("<id>", params.t("command.cron.argument.id"))
      .action(async (id, opts) => {
        try {
          const res = await callGatewayFromCli("cron.update", opts, {
            id,
            patch: { enabled: params.enabled },
          });
          printCronJson(res);
          await warnIfCronSchedulerDisabled(opts);
        } catch (err) {
          handleCronCliError(err);
        }
      }),
  );
}

export function registerCronSimpleCommands(cron: Command, t: CliTranslator) {
  addGatewayClientOptions(
    cron
      .command("rm")
      .alias("remove")
      .alias("delete")
      .description(t("command.cron.remove.description"))
      .argument("<id>", t("command.cron.argument.id"))
      .option("--json", t("command.cron.option.json"), false)
      .action(async (id, opts) => {
        try {
          const res = await callGatewayFromCli("cron.remove", opts, { id });
          printCronJson(res);
        } catch (err) {
          handleCronCliError(err);
        }
      }),
  );

  registerCronToggleCommand({
    cron,
    name: "enable",
    description: t("command.cron.enable.description"),
    t,
    enabled: true,
  });
  registerCronToggleCommand({
    cron,
    name: "disable",
    description: t("command.cron.disable.description"),
    t,
    enabled: false,
  });

  addGatewayClientOptions(
    cron
      .command("runs")
      .description(t("command.cron.runs.description"))
      .requiredOption("--id <id>", t("command.cron.argument.id"))
      .option("--limit <n>", t("command.cron.runs.option.limit"), "50")
      .action(async (opts) => {
        try {
          const limitRaw = Number.parseInt(String(opts.limit ?? "50"), 10);
          const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? limitRaw : 50;
          const id = String(opts.id);
          const res = await callGatewayFromCli("cron.runs", opts, {
            id,
            limit,
          });
          printCronJson(res);
        } catch (err) {
          handleCronCliError(err);
        }
      }),
  );

  addGatewayClientOptions(
    cron
      .command("run")
      .description(t("command.cron.run.description"))
      .argument("<id>", t("command.cron.argument.id"))
      .option("--due", t("command.cron.run.option.due"), false)
      .action(async (id, opts, command) => {
        try {
          if (command.getOptionValueSource("timeout") === "default") {
            opts.timeout = "600000";
          }
          const res = await callGatewayFromCli("cron.run", opts, {
            id,
            mode: opts.due ? "due" : "force",
          });
          printCronJson(res);
          const result = res as { ok?: boolean; ran?: boolean; enqueued?: boolean } | undefined;
          defaultRuntime.exit(result?.ok && (result?.ran || result?.enqueued) ? 0 : 1);
        } catch (err) {
          handleCronCliError(err);
        }
      }),
  );
}
