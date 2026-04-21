import type { Command } from "commander";
import type { MessageCliHelpers } from "./helpers.js";

export function registerMessageReactionsCommands(message: Command, helpers: MessageCliHelpers) {
  const { t } = helpers;
  helpers
    .withMessageBase(
      helpers.withRequiredMessageTarget(
        message.command("react").description(t("command.message.react.description")),
      ),
    )
    .requiredOption("--message-id <id>", t("command.message.option.messageId"))
    .option("--emoji <emoji>", t("command.message.react.option.emoji"))
    .option("--remove", t("command.message.react.option.remove"), false)
    .option("--participant <id>", t("command.message.react.option.participant"))
    .option("--from-me", t("command.message.react.option.fromMe"), false)
    .option("--target-author <id>", t("command.message.react.option.targetAuthor"))
    .option("--target-author-uuid <uuid>", t("command.message.react.option.targetAuthorUuid"))
    .action(async (opts) => {
      await helpers.runMessageAction("react", opts);
    });

  helpers
    .withMessageBase(
      helpers.withRequiredMessageTarget(
        message.command("reactions").description(t("command.message.reactions.description")),
      ),
    )
    .requiredOption("--message-id <id>", t("command.message.option.messageId"))
    .option("--limit <n>", t("command.message.option.limit"))
    .action(async (opts) => {
      await helpers.runMessageAction("reactions", opts);
    });
}
