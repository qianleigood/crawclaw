import type { Command } from "commander";
import type { MessageCliHelpers } from "./helpers.js";

export function registerMessageReadEditDeleteCommands(
  message: Command,
  helpers: MessageCliHelpers,
) {
  const { t } = helpers;
  helpers
    .withMessageBase(
      helpers.withRequiredMessageTarget(
        message.command("read").description(t("command.message.read.description")),
      ),
    )
    .option("--limit <n>", t("command.message.option.limit"))
    .option("--before <id>", t("command.message.option.before"))
    .option("--after <id>", t("command.message.option.after"))
    .option("--around <id>", t("command.message.read.option.around"))
    .option("--include-thread", t("command.message.read.option.includeThread"), false)
    .action(async (opts) => {
      await helpers.runMessageAction("read", opts);
    });

  helpers
    .withMessageBase(
      helpers.withRequiredMessageTarget(
        message
          .command("edit")
          .description(t("command.message.edit.description"))
          .requiredOption("--message-id <id>", t("command.message.option.messageId"))
          .requiredOption("-m, --message <text>", t("command.message.option.messageBody")),
      ),
    )
    .option("--thread-id <id>", t("command.message.option.telegramThreadId"))
    .action(async (opts) => {
      await helpers.runMessageAction("edit", opts);
    });

  helpers
    .withMessageBase(
      helpers.withRequiredMessageTarget(
        message
          .command("delete")
          .description(t("command.message.delete.description"))
          .requiredOption("--message-id <id>", t("command.message.option.messageId")),
      ),
    )
    .action(async (opts) => {
      await helpers.runMessageAction("delete", opts);
    });
}
