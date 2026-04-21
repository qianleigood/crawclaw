import type { Command } from "commander";
import { formatDocsLink } from "../../terminal/links.js";
import { theme } from "../../terminal/theme.js";
import { createCliTranslator } from "../i18n/index.js";
import { getProgramContext } from "../program/program-context.js";
import { addGatewayServiceCommands } from "./register-service-commands.js";

export function registerDaemonCli(program: Command) {
  const t = getProgramContext(program)?.t ?? createCliTranslator("en");
  const daemon = program
    .command("daemon")
    .description(t("command.daemon.description"))
    .addHelpText(
      "after",
      () =>
        `\n${theme.muted(t("cli.help.docsLabel"))} ${formatDocsLink("/cli/gateway", "docs.crawclaw.ai/cli/gateway")}\n`,
    );

  addGatewayServiceCommands(daemon, {
    statusDescription: t("command.daemon.status.description"),
  });
}
