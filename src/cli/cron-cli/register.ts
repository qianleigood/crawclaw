import type { Command } from "commander";
import { formatDocsLink } from "../../terminal/links.js";
import { theme } from "../../terminal/theme.js";
import { createCliTranslator } from "../i18n/index.js";
import { getProgramContext } from "../program/program-context.js";
import {
  registerCronAddCommand,
  registerCronListCommand,
  registerCronStatusCommand,
} from "./register.cron-add.js";
import { registerCronEditCommand } from "./register.cron-edit.js";
import { registerCronSimpleCommands } from "./register.cron-simple.js";

export function registerCronCli(program: Command) {
  const t = getProgramContext(program)?.t ?? createCliTranslator("en");
  const cron = program
    .command("cron")
    .description(t("command.cron.description"))
    .addHelpText(
      "after",
      () =>
        `\n${theme.muted("Docs:")} ${formatDocsLink("/cli/cron", "docs.crawclaw.ai/cli/cron")}\n${theme.muted("Upgrade tip:")} run \`crawclaw doctor --fix\` to normalize legacy cron job storage.\n`,
    );

  registerCronStatusCommand(cron, t);
  registerCronListCommand(cron, t);
  registerCronAddCommand(cron, t);
  registerCronSimpleCommands(cron, t);
  registerCronEditCommand(cron, t);
}
