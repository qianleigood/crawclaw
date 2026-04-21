import type { Command } from "commander";
import {
  CONFIGURE_WIZARD_SECTIONS,
  configureCommandFromSectionsArg,
} from "../../commands/configure.js";
import { defaultRuntime } from "../../runtime.js";
import { formatDocsLink } from "../../terminal/links.js";
import { theme } from "../../terminal/theme.js";
import { runCommandWithRuntime } from "../cli-utils.js";
import { createCliTranslator } from "../i18n/index.js";
import { getProgramContext } from "./program-context.js";

export function registerConfigureCommand(program: Command) {
  const t = getProgramContext(program)?.t ?? createCliTranslator("en");
  program
    .command("configure")
    .description(t("command.configure.description"))
    .addHelpText(
      "after",
      () =>
        `\n${theme.muted(t("cli.help.docsLabel"))} ${formatDocsLink("/cli/configure", "docs.crawclaw.ai/cli/configure")}\n`,
    )
    .option(
      "--section <section>",
      t("command.configure.option.section", {
        sections: CONFIGURE_WIZARD_SECTIONS.join(", "),
      }),
      (value: string, previous: string[]) => [...previous, value],
      [] as string[],
    )
    .action(async (opts) => {
      await runCommandWithRuntime(defaultRuntime, async () => {
        await configureCommandFromSectionsArg(opts.section, defaultRuntime);
      });
    });
}
