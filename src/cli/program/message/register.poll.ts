import type { Command } from "commander";
import { collectOption } from "../helpers.js";
import type { MessageCliHelpers } from "./helpers.js";

export function registerMessagePollCommand(message: Command, helpers: MessageCliHelpers) {
  const { t } = helpers;
  helpers
    .withMessageBase(
      helpers.withRequiredMessageTarget(
        message.command("poll").description(t("command.message.poll.description")),
      ),
    )
    .requiredOption("--poll-question <text>", t("command.message.poll.option.question"))
    .option(
      "--poll-option <choice>",
      t("command.message.poll.option.choice"),
      collectOption,
      [] as string[],
    )
    .option("--poll-multi", t("command.message.poll.option.multi"), false)
    .option("--poll-duration-hours <n>", t("command.message.poll.option.durationHours"))
    .option("--poll-duration-seconds <n>", t("command.message.poll.option.durationSeconds"))
    .option("--poll-anonymous", t("command.message.poll.option.anonymous"), false)
    .option("--poll-public", t("command.message.poll.option.public"), false)
    .option("-m, --message <text>", t("command.message.option.optionalMessageBody"))
    .option("--silent", t("command.message.poll.option.silent"), false)
    .option("--thread-id <id>", t("command.message.poll.option.threadId"))
    .action(async (opts) => {
      await helpers.runMessageAction("poll", opts);
    });
}
