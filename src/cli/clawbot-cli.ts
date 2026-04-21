import type { Command } from "commander";
import { formatDocsLink } from "../terminal/links.js";
import { theme } from "../terminal/theme.js";
import { createCliTranslator } from "./i18n/index.js";
import { getProgramContext } from "./program/program-context.js";
import { registerQrCli } from "./qr-cli.js";

export function registerClawbotCli(program: Command) {
  const t = getProgramContext(program)?.t ?? createCliTranslator("en");
  const clawbot = program
    .command("clawbot")
    .description(t("command.clawbot.description"))
    .addHelpText(
      "after",
      () =>
        `\n${theme.muted(t("cli.help.docsLabel"))} ${formatDocsLink("/cli/clawbot", "docs.crawclaw.ai/cli/clawbot")}\n`,
    );
  registerQrCli(clawbot);
}
