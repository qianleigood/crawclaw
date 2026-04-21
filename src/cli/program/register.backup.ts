import type { Command } from "commander";
import { backupVerifyCommand } from "../../commands/backup-verify.js";
import { backupCreateCommand } from "../../commands/backup.js";
import { defaultRuntime } from "../../runtime.js";
import { formatDocsLink } from "../../terminal/links.js";
import { theme } from "../../terminal/theme.js";
import { runCommandWithRuntime } from "../cli-utils.js";
import { formatHelpExamples } from "../help-format.js";
import { createCliTranslator } from "../i18n/index.js";
import { getProgramContext } from "./program-context.js";

export function registerBackupCommand(program: Command) {
  const t = getProgramContext(program)?.t ?? createCliTranslator("en");
  const backup = program
    .command("backup")
    .description(t("command.backup.description"))
    .addHelpText(
      "after",
      () =>
        `\n${theme.muted("Docs:")} ${formatDocsLink("/cli/backup", "docs.crawclaw.ai/cli/backup")}\n`,
    );

  backup
    .command("create")
    .description(t("command.backup.create.description"))
    .option("--output <path>", t("command.backup.create.option.output"))
    .option("--json", t("command.backup.create.option.json"), false)
    .option("--dry-run", t("command.backup.create.option.dryRun"), false)
    .option("--verify", t("command.backup.create.option.verify"), false)
    .option("--only-config", t("command.backup.create.option.onlyConfig"), false)
    .option("--no-include-workspace", t("command.backup.create.option.noIncludeWorkspace"))
    .addHelpText(
      "after",
      () =>
        `\n${theme.heading(t("cli.help.examplesHeading"))}\n${formatHelpExamples([
          ["crawclaw backup create", t("command.backup.create.example.default")],
          ["crawclaw backup create --output ~/Backups", t("command.backup.create.example.output")],
          ["crawclaw backup create --dry-run --json", t("command.backup.create.example.dryRun")],
          ["crawclaw backup create --verify", t("command.backup.create.example.verify")],
          [
            "crawclaw backup create --no-include-workspace",
            t("command.backup.create.example.noWorkspace"),
          ],
          ["crawclaw backup create --only-config", t("command.backup.create.example.onlyConfig")],
        ])}`,
    )
    .action(async (opts) => {
      await runCommandWithRuntime(defaultRuntime, async () => {
        await backupCreateCommand(defaultRuntime, {
          output: opts.output as string | undefined,
          json: Boolean(opts.json),
          dryRun: Boolean(opts.dryRun),
          verify: Boolean(opts.verify),
          onlyConfig: Boolean(opts.onlyConfig),
          includeWorkspace: opts.includeWorkspace as boolean,
        });
      });
    });

  backup
    .command("verify <archive>")
    .description(t("command.backup.verify.description"))
    .option("--json", t("command.backup.verify.option.json"), false)
    .addHelpText(
      "after",
      () =>
        `\n${theme.heading(t("cli.help.examplesHeading"))}\n${formatHelpExamples([
          [
            "crawclaw backup verify ./2026-03-09T00-00-00.000Z-crawclaw-backup.tar.gz",
            t("command.backup.verify.example.default"),
          ],
          [
            "crawclaw backup verify ~/Backups/latest.tar.gz --json",
            t("command.backup.verify.example.json"),
          ],
        ])}`,
    )
    .action(async (archive, opts) => {
      await runCommandWithRuntime(defaultRuntime, async () => {
        await backupVerifyCommand(defaultRuntime, {
          archive: archive as string,
          json: Boolean(opts.json),
        });
      });
    });
}
