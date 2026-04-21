import type { Command } from "commander";
import { doctorMemoryCommand } from "../../commands/doctor-memory-health.js";
import { doctorCommand } from "../../commands/doctor.js";
import { migrateCrawClawCommand } from "../../commands/migrate-legacy-state.js";
import { uninstallCommand } from "../../commands/uninstall.js";
import { defaultRuntime } from "../../runtime.js";
import { formatDocsLink } from "../../terminal/links.js";
import { theme } from "../../terminal/theme.js";
import { runCommandWithRuntime } from "../cli-utils.js";
import { createCliTranslator } from "../i18n/index.js";
import { getProgramContext } from "./program-context.js";

export function registerMaintenanceCommands(program: Command) {
  const t = getProgramContext(program)?.t ?? createCliTranslator("en");
  program
    .command("migrate-crawclaw")
    .description(t("command.migrate-crawclaw.description"))
    .option("--dry-run", t("command.migrate-crawclaw.option.dryRun"), false)
    .action(async (opts) => {
      await runCommandWithRuntime(defaultRuntime, async () => {
        await migrateCrawClawCommand(
          {
            dryRun: Boolean(opts.dryRun),
          },
          defaultRuntime,
        );
      });
    });

  const doctor = program
    .command("doctor")
    .description(t("command.doctor.description"))
    .addHelpText(
      "after",
      () =>
        `\n${theme.muted(t("cli.help.docsLabel"))} ${formatDocsLink("/cli/doctor", "docs.crawclaw.ai/cli/doctor")}\n`,
    )
    .option("--no-workspace-suggestions", t("command.doctor.option.noWorkspaceSuggestions"), false)
    .option("--yes", t("command.doctor.option.yes"), false)
    .option("--repair", t("command.doctor.option.repair"), false)
    .option("--fix", t("command.doctor.option.fix"), false)
    .option("--force", t("command.doctor.option.force"), false)
    .option("--non-interactive", t("command.doctor.option.nonInteractive"), false)
    .option("--generate-gateway-token", t("command.doctor.option.generateGatewayToken"), false)
    .option("--deep", t("command.doctor.option.deep"), false)
    .action(async (opts) => {
      await runCommandWithRuntime(defaultRuntime, async () => {
        await doctorCommand(defaultRuntime, {
          workspaceSuggestions: opts.workspaceSuggestions,
          yes: Boolean(opts.yes),
          repair: Boolean(opts.repair) || Boolean(opts.fix),
          force: Boolean(opts.force),
          nonInteractive: Boolean(opts.nonInteractive),
          generateGatewayToken: Boolean(opts.generateGatewayToken),
          deep: Boolean(opts.deep),
        });
        defaultRuntime.exit(0);
      });
    });

  doctor
    .command("memory")
    .description(t("command.doctor.memory.description"))
    .option("--json", t("command.doctor.memory.option.json"), false)
    .action(async (opts) => {
      await runCommandWithRuntime(defaultRuntime, async () => {
        const { loadConfig } = await import("../../config/config.js");
        await doctorMemoryCommand(defaultRuntime, {
          cfg: loadConfig(),
          json: Boolean(opts.json),
        });
        defaultRuntime.exit(0);
      });
    });

  program
    .command("uninstall")
    .description(t("command.uninstall.description"))
    .addHelpText(
      "after",
      () =>
        `\n${theme.muted(t("cli.help.docsLabel"))} ${formatDocsLink("/cli/uninstall", "docs.crawclaw.ai/cli/uninstall")}\n`,
    )
    .option("--service", t("command.uninstall.option.service"), false)
    .option("--state", t("command.uninstall.option.state"), false)
    .option("--workspace", t("command.uninstall.option.workspace"), false)
    .option("--app", t("command.uninstall.option.app"), false)
    .option("--all", t("command.uninstall.option.all"), false)
    .option("--yes", t("command.uninstall.option.yes"), false)
    .option("--non-interactive", t("command.uninstall.option.nonInteractive"), false)
    .option("--dry-run", t("command.uninstall.option.dryRun"), false)
    .action(async (opts) => {
      await runCommandWithRuntime(defaultRuntime, async () => {
        await uninstallCommand(defaultRuntime, {
          service: Boolean(opts.service),
          state: Boolean(opts.state),
          workspace: Boolean(opts.workspace),
          app: Boolean(opts.app),
          all: Boolean(opts.all),
          yes: Boolean(opts.yes),
          nonInteractive: Boolean(opts.nonInteractive),
          dryRun: Boolean(opts.dryRun),
        });
      });
    });
}
