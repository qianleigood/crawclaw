import type { Command } from "commander";
import { defaultRuntime } from "../runtime.js";
import { formatDocsLink } from "../terminal/links.js";
import { theme } from "../terminal/theme.js";
import { createCliTranslator } from "./i18n/index.js";
import { getProgramContext } from "./program/program-context.js";

type ImproveCliRuntime = typeof import("./improve-cli.runtime.js");

let improveCliRuntimePromise: Promise<ImproveCliRuntime> | null = null;

async function loadImproveCliRuntime(): Promise<ImproveCliRuntime> {
  improveCliRuntimePromise ??= import("./improve-cli.runtime.js");
  return await improveCliRuntimePromise;
}

async function runImproveAction<T extends { json?: boolean }>(
  opts: T,
  action: (runtime: ImproveCliRuntime) => Promise<void>,
): Promise<void> {
  const runtime = await loadImproveCliRuntime();
  try {
    await action(runtime);
  } catch (error) {
    runtime.handleImproveCliError(error, opts, defaultRuntime);
  }
}

export function registerImproveCli(program: Command) {
  const t = getProgramContext(program)?.t ?? createCliTranslator("en");
  const improve = program
    .command("improve")
    .description(t("command.improve.description"))
    .addHelpText(
      "after",
      () =>
        `\n${theme.muted(t("cli.help.docsLabel"))} ${formatDocsLink("/cli/improve", "docs.crawclaw.ai/cli/improve")}\n`,
    );

  improve
    .command("run")
    .description(t("command.improve.run.description"))
    .option("--json", t("command.improve.option.json"))
    .action(async (opts) => {
      await runImproveAction(opts, async (runtime) => {
        await runtime.runImproveRunCommand(opts, defaultRuntime);
      });
    });

  improve
    .command("inbox")
    .description(t("command.improve.inbox.description"))
    .option("--status <csv>", t("command.improve.inbox.option.status"))
    .option("--kind <csv>", t("command.improve.inbox.option.kind"))
    .option("--limit <n>", t("command.improve.inbox.option.limit"), "50")
    .option("--json", t("command.improve.option.json"))
    .action(async (opts) => {
      await runImproveAction(opts, async (runtime) => {
        await runtime.runImproveInboxCommand(opts, defaultRuntime);
      });
    });

  improve
    .command("show <id>")
    .description(t("command.improve.show.description"))
    .option("--json", t("command.improve.option.json"))
    .action(async (id, opts) => {
      await runImproveAction(opts, async (runtime) => {
        await runtime.runImproveShowCommand(id, opts, defaultRuntime);
      });
    });

  improve
    .command("review <id>")
    .description(t("command.improve.review.description"))
    .option("--approve", t("command.improve.review.option.approve"), false)
    .option("--reject", t("command.improve.review.option.reject"), false)
    .option("--reviewer <name>", t("command.improve.review.option.reviewer"))
    .option("--comments <text>", t("command.improve.review.option.comments"))
    .option("--json", t("command.improve.option.json"))
    .action(async (id, opts) => {
      await runImproveAction(opts, async (runtime) => {
        await runtime.runImproveReviewCommand(id, opts, defaultRuntime);
      });
    });

  improve
    .command("apply <id>")
    .description(t("command.improve.apply.description"))
    .option("--json", t("command.improve.option.json"))
    .action(async (id, opts) => {
      await runImproveAction(opts, async (runtime) => {
        await runtime.runImproveApplyCommand(id, opts, defaultRuntime);
      });
    });

  improve
    .command("verify <id>")
    .description(t("command.improve.verify.description"))
    .option("--json", t("command.improve.option.json"))
    .action(async (id, opts) => {
      await runImproveAction(opts, async (runtime) => {
        await runtime.runImproveVerifyCommand(id, opts, defaultRuntime);
      });
    });

  improve
    .command("rollback <id>")
    .description(t("command.improve.rollback.description"))
    .option("--json", t("command.improve.option.json"))
    .action(async (id, opts) => {
      await runImproveAction(opts, async (runtime) => {
        await runtime.runImproveRollbackCommand(id, opts, defaultRuntime);
      });
    });

  improve
    .command("metrics")
    .description(t("command.improve.metrics.description"))
    .option("--json", t("command.improve.option.json"))
    .action(async (opts) => {
      await runImproveAction(opts, async (runtime) => {
        await runtime.runImproveMetricsCommand(opts, defaultRuntime);
      });
    });
}
