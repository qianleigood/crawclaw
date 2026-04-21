import type { Command } from "commander";
import { setupWizardCommand } from "../../commands/onboard.js";
import { setupCommand } from "../../commands/setup.js";
import { defaultRuntime } from "../../runtime.js";
import { formatDocsLink } from "../../terminal/links.js";
import { theme } from "../../terminal/theme.js";
import { runCommandWithRuntime } from "../cli-utils.js";
import { hasExplicitOptions } from "../command-options.js";
import { createCliTranslator } from "../i18n/index.js";
import { getProgramContext } from "./program-context.js";

export function registerSetupCommand(program: Command) {
  const t = getProgramContext(program)?.t ?? createCliTranslator("en");
  program
    .command("setup")
    .description(t("command.setup.description"))
    .addHelpText(
      "after",
      () =>
        `\n${theme.muted("Docs:")} ${formatDocsLink("/cli/setup", "docs.crawclaw.ai/cli/setup")}\n`,
    )
    .option("--workspace <dir>", t("command.setup.option.workspace"))
    .option("--wizard", t("command.setup.option.wizard"), false)
    .option("--non-interactive", t("command.setup.option.nonInteractive"), false)
    .option("--mode <mode>", t("command.setup.option.mode"))
    .option("--remote-url <url>", t("command.setup.option.remoteUrl"))
    .option("--remote-token <token>", t("command.setup.option.remoteToken"))
    .action(async (opts, command) => {
      await runCommandWithRuntime(defaultRuntime, async () => {
        const hasWizardFlags = hasExplicitOptions(command, [
          "wizard",
          "nonInteractive",
          "mode",
          "remoteUrl",
          "remoteToken",
        ]);
        if (opts.wizard || hasWizardFlags) {
          await setupWizardCommand(
            {
              workspace: opts.workspace as string | undefined,
              nonInteractive: Boolean(opts.nonInteractive),
              mode: opts.mode as "local" | "remote" | undefined,
              remoteUrl: opts.remoteUrl as string | undefined,
              remoteToken: opts.remoteToken as string | undefined,
            },
            defaultRuntime,
          );
          return;
        }
        await setupCommand({ workspace: opts.workspace as string | undefined }, defaultRuntime);
      });
    });
}
