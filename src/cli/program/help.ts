import type { Command } from "commander";
import { resolveCommitHash } from "../../infra/git-commit.js";
import { formatDocsLink } from "../../terminal/links.js";
import { isRich, theme } from "../../terminal/theme.js";
import { escapeRegExp } from "../../utils.js";
import { hasFlag, hasRootVersionAlias } from "../argv.js";
import { formatCliBannerLine, hasEmittedCliBanner } from "../banner.js";
import { replaceCliName, resolveCliName } from "../cli-name.js";
import { CLI_LOG_LEVEL_VALUES, parseCliLogLevelOption } from "../log-level-option.js";
import type { ProgramContext } from "./context.js";
import { getCoreCliCommandsWithSubcommands } from "./core-command-descriptors.js";
import { getSubCliCommandsWithSubcommands } from "./subcli-descriptors.js";

const CLI_NAME = resolveCliName();
const CLI_NAME_PATTERN = escapeRegExp(CLI_NAME);
const ROOT_COMMANDS_WITH_SUBCOMMANDS = new Set([
  ...getCoreCliCommandsWithSubcommands(),
  ...getSubCliCommandsWithSubcommands(),
]);

const EXAMPLES = [
  ["crawclaw models --help", "cli.help.example.modelsHelp"],
  ["crawclaw channels login --verbose", "cli.help.example.channelsLoginVerbose"],
  [
    'crawclaw message send --target +15555550123 --message "Hi" --json',
    "cli.help.example.messageSendJson",
  ],
  ["crawclaw gateway --port 18789", "cli.help.example.gatewayPort"],
  ["crawclaw --dev gateway", "cli.help.example.devGateway"],
  ["crawclaw gateway --force", "cli.help.example.gatewayForce"],
  ["crawclaw gateway ...", "cli.help.example.gatewayEllipsis"],
  [
    'crawclaw agent --to +15555550123 --message "Run summary" --deliver',
    "cli.help.example.agentDeliver",
  ],
  [
    'crawclaw message send --channel telegram --target @mychat --message "Hi"',
    "cli.help.example.telegramSend",
  ],
] as const;

export function configureProgramHelp(program: Command, ctx: ProgramContext) {
  program
    .name(CLI_NAME)
    .description("")
    .version(ctx.programVersion, "-V, --version", ctx.t("cli.option.version"))
    .option("--lang <locale>", ctx.t("cli.option.lang"))
    .option("--container <name>", ctx.t("cli.option.container"))
    .option("--dev", ctx.t("cli.option.dev"))
    .option("--profile <name>", ctx.t("cli.option.profile"))
    .option(
      "--log-level <level>",
      ctx.t("cli.option.logLevel", { values: CLI_LOG_LEVEL_VALUES }),
      parseCliLogLevelOption,
    );

  program.option("--no-color", ctx.t("cli.option.noColor"), false);
  program.helpOption("-h, --help", ctx.t("cli.help.helpOption"));
  program.helpCommand("help [command]", ctx.t("cli.help.helpCommand"));

  program.configureHelp({
    // sort options and subcommands alphabetically
    sortSubcommands: true,
    sortOptions: true,
    optionTerm: (option) => theme.option(option.flags),
    subcommandTerm: (cmd) => {
      const isRootCommand = cmd.parent === program;
      const hasSubcommands = isRootCommand && ROOT_COMMANDS_WITH_SUBCOMMANDS.has(cmd.name());
      return theme.command(hasSubcommands ? `${cmd.name()} *` : cmd.name());
    },
  });

  const formatHelpOutput = (str: string) => {
    let output = str;
    const isRootHelp = new RegExp(
      `^Usage:\\s+${CLI_NAME_PATTERN}\\s+\\[options\\]\\s+\\[command\\]\\s*$`,
      "m",
    ).test(output);
    if (isRootHelp && /^Commands:/m.test(output)) {
      output = output.replace(
        /^Commands:/m,
        `Commands:\n  ${theme.muted(ctx.t("cli.help.rootCommandsHint"))}`,
      );
    }

    return output
      .replace(/^Usage:/gm, theme.heading(ctx.t("cli.help.usageHeading")))
      .replace(/^Options:/gm, theme.heading(ctx.t("cli.help.optionsHeading")))
      .replace(/^Commands:/gm, theme.heading(ctx.t("cli.help.commandsHeading")));
  };

  program.configureOutput({
    writeOut: (str) => {
      process.stdout.write(formatHelpOutput(str));
    },
    writeErr: (str) => {
      process.stderr.write(formatHelpOutput(str));
    },
    outputError: (str, write) => write(theme.error(str)),
  });

  if (
    hasFlag(process.argv, "-V") ||
    hasFlag(process.argv, "--version") ||
    hasRootVersionAlias(process.argv)
  ) {
    const commit = resolveCommitHash({ moduleUrl: import.meta.url });
    console.log(
      commit ? `CrawClaw ${ctx.programVersion} (${commit})` : `CrawClaw ${ctx.programVersion}`,
    );
    process.exit(0);
  }

  program.addHelpText("beforeAll", () => {
    if (hasEmittedCliBanner()) {
      return "";
    }
    const rich = isRich();
    const line = formatCliBannerLine(ctx.programVersion, {
      richTty: rich,
      mode: ctx.locale === "zh-CN" ? "off" : undefined,
    });
    return `\n${line}\n`;
  });

  const fmtExamples = EXAMPLES.map(
    ([cmd, descKey]) =>
      `  ${theme.command(replaceCliName(cmd, CLI_NAME))}\n    ${theme.muted(ctx.t(descKey))}`,
  ).join("\n");

  program.addHelpText("afterAll", ({ command }) => {
    if (command !== program) {
      return "";
    }
    const docs = formatDocsLink("/cli", "docs.crawclaw.ai/cli");
    return `\n${theme.heading(ctx.t("cli.help.examplesHeading"))}\n${fmtExamples}\n\n${theme.muted(ctx.t("cli.help.docsLabel"))} ${docs}\n`;
  });
}
