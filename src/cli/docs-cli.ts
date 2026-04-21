import type { Command } from "commander";
import { docsSearchCommand } from "../commands/docs.js";
import { defaultRuntime } from "../runtime.js";
import { formatDocsLink } from "../terminal/links.js";
import { theme } from "../terminal/theme.js";
import { runCommandWithRuntime } from "./cli-utils.js";
import { createCliTranslator } from "./i18n/index.js";
import { getProgramContext } from "./program/program-context.js";

export function registerDocsCli(program: Command) {
  const t = getProgramContext(program)?.t ?? createCliTranslator("en");
  program
    .command("docs")
    .description(t("command.docs.description"))
    .argument("[query...]", t("command.docs.argument.query"))
    .addHelpText(
      "after",
      () =>
        `\n${theme.muted(t("cli.help.docsLabel"))} ${formatDocsLink("/cli/docs", "docs.crawclaw.ai/cli/docs")}\n`,
    )
    .action(async (queryParts: string[]) => {
      await runCommandWithRuntime(defaultRuntime, async () => {
        await docsSearchCommand(queryParts, defaultRuntime);
      });
    });
}
