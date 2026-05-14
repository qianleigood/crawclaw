import type { Command } from "commander";
import { danger } from "../globals.js";
import { defaultRuntime } from "../runtime.js";
import { formatDocsLink } from "../terminal/links.js";
import { theme } from "../terminal/theme.js";
import { runChannelLogin, runChannelLogout } from "./channel-auth.js";
import { formatCliChannelOptions } from "./channel-options.js";
import { runCommandWithRuntime } from "./cli-utils.js";
import { hasExplicitOptions } from "./command-options.js";
import { formatHelpExamples } from "./help-format.js";
import { createCliTranslator } from "./i18n/index.js";
import { getProgramContext } from "./program/program-context.js";

const optionNamesAdd = [
  "channel",
  "account",
  "name",
  "token",
  "privateKey",
  "tokenFile",
  "useEnv",
] as const;

const optionNamesRemove = ["channel", "account", "delete"] as const;

function runChannelsCommand(action: () => Promise<void>) {
  return runCommandWithRuntime(defaultRuntime, action);
}

function runChannelsCommandWithDanger(action: () => Promise<void>, label: string) {
  return runCommandWithRuntime(defaultRuntime, action, (err) => {
    defaultRuntime.error(danger(`${label}: ${String(err)}`));
    defaultRuntime.exit(1);
  });
}

export function registerChannelsCli(program: Command) {
  const t = getProgramContext(program)?.t ?? createCliTranslator("en");
  const channelNames = formatCliChannelOptions();
  const channels = program
    .command("channels")
    .description(t("command.channels.description"))
    .addHelpText(
      "after",
      () =>
        `\n${theme.heading(t("cli.help.examplesHeading"))}\n${formatHelpExamples([
          ["crawclaw channels list", t("command.channels.examples.list")],
          ["crawclaw channels status --probe", t("command.channels.examples.status")],
          ["crawclaw channels add --channel feishu --token <token>", t("command.channels.examples.add")],
          ["crawclaw channels login --channel weixin", t("command.channels.examples.login")],
        ])}\n\n${theme.muted(t("cli.help.docsLabel"))} ${formatDocsLink(
          "/cli/channels",
          "docs.crawclaw.ai/cli/channels",
        )}\n`,
    );

  channels
    .command("list")
    .description(t("command.channels.list.description"))
    .option("--no-usage", t("command.channels.list.option.noUsage"))
    .option("--json", t("command.channels.option.json"), false)
    .action(async (opts) => {
      await runChannelsCommand(async () => {
        const { channelsListCommand } = await import("../commands/channels.js");
        await channelsListCommand(opts, defaultRuntime);
      });
    });

  channels
    .command("status")
    .description(t("command.channels.status.description"))
    .option("--probe", t("command.channels.status.option.probe"), false)
    .option("--timeout <ms>", t("command.channels.option.timeout"), "10000")
    .option("--json", t("command.channels.option.json"), false)
    .action(async (opts) => {
      await runChannelsCommand(async () => {
        const { channelsStatusCommand } = await import("../commands/channels.js");
        await channelsStatusCommand(opts, defaultRuntime);
      });
    });

  channels
    .command("capabilities")
    .description(t("command.channels.capabilities.description"))
    .option(
      "--channel <name>",
      t("command.channels.option.channel", { channels: formatCliChannelOptions(["all"]) }),
    )
    .option("--account <id>", t("command.channels.capabilities.option.account"))
    .option("--target <dest>", t("command.channels.capabilities.option.target"))
    .option("--timeout <ms>", t("command.channels.option.timeout"), "10000")
    .option("--json", t("command.channels.option.json"), false)
    .action(async (opts) => {
      await runChannelsCommand(async () => {
        const { channelsCapabilitiesCommand } = await import("../commands/channels.js");
        await channelsCapabilitiesCommand(opts, defaultRuntime);
      });
    });

  channels
    .command("resolve")
    .description(t("command.channels.resolve.description"))
    .argument("<entries...>", t("command.channels.resolve.argument.entries"))
    .option("--channel <name>", t("command.channels.option.channel", { channels: channelNames }))
    .option("--account <id>", t("command.channels.option.account"))
    .option("--kind <kind>", t("command.channels.resolve.option.kind"), "auto")
    .option("--json", t("command.channels.option.json"), false)
    .action(async (entries, opts) => {
      await runChannelsCommand(async () => {
        const { channelsResolveCommand } = await import("../commands/channels.js");
        await channelsResolveCommand(
          {
            channel: opts.channel as string | undefined,
            account: opts.account as string | undefined,
            kind: opts.kind as "auto" | "user" | "group",
            json: Boolean(opts.json),
            entries: Array.isArray(entries) ? entries : [String(entries)],
          },
          defaultRuntime,
        );
      });
    });

  channels
    .command("logs")
    .description(t("command.channels.logs.description"))
    .option(
      "--channel <name>",
      t("command.channels.option.channel", { channels: formatCliChannelOptions(["all"]) }),
      "all",
    )
    .option("--lines <n>", t("command.channels.logs.option.lines"), "200")
    .option("--json", t("command.channels.option.json"), false)
    .action(async (opts) => {
      await runChannelsCommand(async () => {
        const { channelsLogsCommand } = await import("../commands/channels.js");
        await channelsLogsCommand(opts, defaultRuntime);
      });
    });

  channels
    .command("add")
    .description(t("command.channels.add.description"))
    .option("--channel <name>", t("command.channels.option.channel", { channels: channelNames }))
    .option("--account <id>", t("command.channels.add.option.account"))
    .option("--name <name>", t("command.channels.add.option.name"))
    .option("--token <token>", t("command.channels.add.option.token"))
    .option("--private-key <key>", t("command.channels.add.option.privateKey"))
    .option("--token-file <path>", t("command.channels.add.option.tokenFile"))
    .option("--use-env", t("command.channels.add.option.useEnv"), false)
    .action(async (opts, command) => {
      await runChannelsCommand(async () => {
        const { channelsAddCommand } = await import("../commands/channels.js");
        const hasFlags = hasExplicitOptions(command, optionNamesAdd);
        await channelsAddCommand(opts, defaultRuntime, { hasFlags });
      });
    });

  channels
    .command("remove")
    .description(t("command.channels.remove.description"))
    .option("--channel <name>", t("command.channels.option.channel", { channels: channelNames }))
    .option("--account <id>", t("command.channels.add.option.account"))
    .option("--delete", t("command.channels.remove.option.delete"), false)
    .action(async (opts, command) => {
      await runChannelsCommand(async () => {
        const { channelsRemoveCommand } = await import("../commands/channels.js");
        const hasFlags = hasExplicitOptions(command, optionNamesRemove);
        await channelsRemoveCommand(opts, defaultRuntime, { hasFlags });
      });
    });

  channels
    .command("login")
    .description(t("command.channels.login.description"))
    .option("--channel <channel>", t("command.channels.login.option.channel"))
    .option("--account <id>", t("command.channels.option.account"))
    .option("--verbose", t("command.channels.login.option.verbose"), false)
    .action(async (opts) => {
      await runChannelsCommandWithDanger(async () => {
        await runChannelLogin(
          {
            channel: opts.channel as string | undefined,
            account: opts.account as string | undefined,
            verbose: Boolean(opts.verbose),
          },
          defaultRuntime,
        );
      }, t("command.channels.login.failed"));
    });

  channels
    .command("logout")
    .description(t("command.channels.logout.description"))
    .option("--channel <channel>", t("command.channels.login.option.channel"))
    .option("--account <id>", t("command.channels.option.account"))
    .action(async (opts) => {
      await runChannelsCommandWithDanger(async () => {
        await runChannelLogout(
          {
            channel: opts.channel as string | undefined,
            account: opts.account as string | undefined,
          },
          defaultRuntime,
        );
      }, t("command.channels.logout.failed"));
    });
}
