import type { Command } from "commander";
import { collectOption } from "../helpers.js";
import type { MessageCliHelpers } from "./helpers.js";

export function registerMessagePermissionsCommand(message: Command, helpers: MessageCliHelpers) {
  const { t } = helpers;
  helpers
    .withMessageBase(
      helpers.withRequiredMessageTarget(
        message.command("permissions").description(t("command.message.permissions.description")),
      ),
    )
    .action(async (opts) => {
      await helpers.runMessageAction("permissions", opts);
    });
}

export function registerMessageSearchCommand(message: Command, helpers: MessageCliHelpers) {
  const { t } = helpers;
  helpers
    .withMessageBase(message.command("search").description(t("command.message.search.description")))
    .requiredOption("--guild-id <id>", t("command.message.option.guildId"))
    .requiredOption("--query <text>", t("command.message.search.option.query"))
    .option("--channel-id <id>", t("command.message.option.channelId"))
    .option(
      "--channel-ids <id>",
      t("command.message.option.channelIdRepeat"),
      collectOption,
      [] as string[],
    )
    .option("--author-id <id>", t("command.message.search.option.authorId"))
    .option(
      "--author-ids <id>",
      t("command.message.search.option.authorIdRepeat"),
      collectOption,
      [] as string[],
    )
    .option("--limit <n>", t("command.message.option.limit"))
    .action(async (opts) => {
      await helpers.runMessageAction("search", opts);
    });
}
