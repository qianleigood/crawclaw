import type { Command } from "commander";
import { defaultRuntime } from "../runtime.js";
import { formatDocsLink } from "../terminal/links.js";
import { theme } from "../terminal/theme.js";
import { runTui } from "../tui/tui.js";
import { createCliTranslator } from "./i18n/index.js";
import { parseTimeoutMs } from "./parse-timeout.js";
import { getProgramContext } from "./program/program-context.js";

export function registerTuiCli(program: Command) {
  const t = getProgramContext(program)?.t ?? createCliTranslator("en");
  program
    .command("tui")
    .description(t("command.tui.description"))
    .option("--url <url>", t("command.tui.option.url"))
    .option("--token <token>", t("command.tui.option.token"))
    .option("--password <password>", t("command.tui.option.password"))
    .option("--session <key>", t("command.tui.option.session"))
    .option("--deliver", t("command.tui.option.deliver"), false)
    .option("--thinking <level>", t("command.tui.option.thinking"))
    .option("--message <text>", t("command.tui.option.message"))
    .option("--timeout-ms <ms>", t("command.tui.option.timeoutMs"))
    .option("--history-limit <n>", t("command.tui.option.historyLimit"), "200")
    .addHelpText(
      "after",
      () =>
        `\n${theme.muted(t("cli.help.docsLabel"))} ${formatDocsLink("/cli/tui", "docs.crawclaw.ai/cli/tui")}\n`,
    )
    .action(async (opts) => {
      try {
        const timeoutMs = parseTimeoutMs(opts.timeoutMs);
        if (opts.timeoutMs !== undefined && timeoutMs === undefined) {
          defaultRuntime.error(
            `warning: invalid --timeout-ms "${String(opts.timeoutMs)}"; ignoring`,
          );
        }
        const historyLimit = Number.parseInt(String(opts.historyLimit ?? "200"), 10);
        await runTui({
          url: opts.url as string | undefined,
          token: opts.token as string | undefined,
          password: opts.password as string | undefined,
          session: opts.session as string | undefined,
          deliver: Boolean(opts.deliver),
          thinking: opts.thinking as string | undefined,
          message: opts.message as string | undefined,
          timeoutMs,
          historyLimit: Number.isNaN(historyLimit) ? undefined : historyLimit,
        });
      } catch (err) {
        defaultRuntime.error(String(err));
        defaultRuntime.exit(1);
      }
    });
}
