import type { Command } from "commander";
import { defaultRuntime } from "../runtime.js";
import { formatDocsLink } from "../terminal/links.js";
import { theme } from "../terminal/theme.js";
import { replaceCliName, resolveCliName } from "./cli-name.js";
import { inheritOptionFromParent } from "./command-options.js";
import { formatHelpExamples } from "./help-format.js";
import { createCliTranslator } from "./i18n/index.js";
import { getProgramContext } from "./program/program-context.js";
import {
  type UpdateCommandOptions,
  type UpdateStatusOptions,
  type UpdateWizardOptions,
} from "./update-cli/shared.js";
import { updateStatusCommand } from "./update-cli/status.js";
import { updateCommand } from "./update-cli/update-command.js";
import { updateWizardCommand } from "./update-cli/wizard.js";

export { updateCommand, updateStatusCommand, updateWizardCommand };
export type { UpdateCommandOptions, UpdateStatusOptions, UpdateWizardOptions };

function inheritedUpdateJson(command?: Command): boolean {
  return Boolean(inheritOptionFromParent<boolean>(command, "json"));
}

function inheritedUpdateTimeout(
  opts: { timeout?: unknown },
  command?: Command,
): string | undefined {
  const timeout = opts.timeout as string | undefined;
  if (timeout) {
    return timeout;
  }
  return inheritOptionFromParent<string>(command, "timeout");
}

export function registerUpdateCli(program: Command) {
  const t = getProgramContext(program)?.t ?? createCliTranslator("en");
  const cliName = resolveCliName();
  program.enablePositionalOptions();
  const update = program
    .command("update")
    .description(t("command.update.description"))
    .option("--json", t("command.update.option.json"), false)
    .option("--no-restart", t("command.update.option.noRestart"))
    .option("--dry-run", t("command.update.option.dryRun"), false)
    .option("--channel <stable|beta|dev>", t("command.update.option.channel"))
    .option("--tag <dist-tag|version|spec>", t("command.update.option.tag"))
    .option("--timeout <seconds>", t("command.update.option.timeout"))
    .option("--yes", t("command.update.option.yes"), false)
    .addHelpText("after", () => {
      const examples = [
        ["crawclaw update", t("command.update.example.default")],
        ["crawclaw update --channel beta", t("command.update.example.beta")],
        ["crawclaw update --channel dev", t("command.update.example.dev")],
        ["crawclaw update --tag beta", t("command.update.example.tagBeta")],
        ["crawclaw update --tag main", t("command.update.example.tagMain")],
        ["crawclaw update --dry-run", t("command.update.example.dryRun")],
        ["crawclaw update --no-restart", t("command.update.example.noRestart")],
        ["crawclaw update --json", t("command.update.example.json")],
        ["crawclaw update --yes", t("command.update.example.yes")],
        ["crawclaw update wizard", t("command.update.example.wizard")],
        ["crawclaw --update", t("command.update.example.shortUpdate")],
      ] as const;
      const fmtExamples = examples
        .map(
          ([cmd, desc]) =>
            `  ${theme.command(replaceCliName(cmd, cliName))} ${theme.muted(`# ${desc}`)}`,
        )
        .join("\n");
      return `
${theme.heading(t("command.update.help.whatThisDoes"))}
  - ${t("command.update.help.gitCheckouts")}
  - ${t("command.update.help.npmInstalls")}

${theme.heading(t("command.update.help.switchChannels"))}
  - ${t("command.update.help.persistChannel")}
  - ${t("command.update.help.statusHint", { command: replaceCliName("crawclaw update status", cliName) })}
  - ${t("command.update.help.tagHint")}

${theme.heading(t("command.update.help.nonInteractive"))}
  - ${t("command.update.help.yesHint")}
  - ${t("command.update.help.combineHint")}
  - ${t("command.update.help.dryRunHint")}

${theme.heading(t("cli.help.examplesHeading"))}
${fmtExamples}

${theme.heading(t("command.update.help.notes"))}
  - ${t("command.update.note.switch")}
  - ${t("command.update.note.global")}
  - ${t("command.update.note.downgrade")}
  - ${t("command.update.note.dirty")}

${theme.muted(t("cli.help.docsLabel"))} ${formatDocsLink("/cli/update", "docs.crawclaw.ai/cli/update")}`;
    })
    .action(async (opts) => {
      try {
        await updateCommand({
          json: Boolean(opts.json),
          restart: Boolean(opts.restart),
          dryRun: Boolean(opts.dryRun),
          channel: opts.channel as string | undefined,
          tag: opts.tag as string | undefined,
          timeout: opts.timeout as string | undefined,
          yes: Boolean(opts.yes),
        });
      } catch (err) {
        defaultRuntime.error(String(err));
        defaultRuntime.exit(1);
      }
    });

  update
    .command("wizard")
    .description(t("command.update.wizard.description"))
    .option("--timeout <seconds>", t("command.update.option.timeout"))
    .addHelpText(
      "after",
      `\n${theme.muted(t("cli.help.docsLabel"))} ${formatDocsLink("/cli/update", "docs.crawclaw.ai/cli/update")}\n`,
    )
    .action(async (opts, command) => {
      try {
        await updateWizardCommand({
          timeout: inheritedUpdateTimeout(opts, command),
        });
      } catch (err) {
        defaultRuntime.error(String(err));
        defaultRuntime.exit(1);
      }
    });

  update
    .command("status")
    .description(t("command.update.status.description"))
    .option("--json", t("command.update.option.json"), false)
    .option("--timeout <seconds>", t("command.update.status.option.timeout"))
    .addHelpText(
      "after",
      () =>
        `\n${theme.heading(t("cli.help.examplesHeading"))}\n${formatHelpExamples([
          [
            replaceCliName("crawclaw update status", cliName),
            t("command.update.status.example.default"),
          ],
          [
            replaceCliName("crawclaw update status --json", cliName),
            t("command.update.status.example.json"),
          ],
          [
            replaceCliName("crawclaw update status --timeout 10", cliName),
            t("command.update.status.example.timeout"),
          ],
        ])}\n\n${theme.heading(t("command.update.help.notes"))}\n${theme.muted(
          `- ${t("command.update.status.note.channel")}`,
        )}\n${theme.muted(`- ${t("command.update.status.note.git")}`)}\n\n${theme.muted(
          t("cli.help.docsLabel"),
        )} ${formatDocsLink("/cli/update", "docs.crawclaw.ai/cli/update")}`,
    )
    .action(async (opts, command) => {
      try {
        await updateStatusCommand({
          json: Boolean(opts.json) || inheritedUpdateJson(command),
          timeout: inheritedUpdateTimeout(opts, command),
        });
      } catch (err) {
        defaultRuntime.error(String(err));
        defaultRuntime.exit(1);
      }
    });
}
