import type { Command } from "commander";
import type { MessageCliHelpers } from "./helpers.js";

export function registerMessageBroadcastCommand(message: Command, helpers: MessageCliHelpers) {
  const { t } = helpers;
  helpers
    .withMessageBase(
      message.command("broadcast").description(t("command.message.broadcast.description")),
    )
    .requiredOption("--targets <target...>", t("command.message.option.targets"))
    .option("--message <text>", t("command.message.broadcast.option.message"))
    .option("--media <url>", t("command.message.option.mediaUrl"))
    .action(async (options: Record<string, unknown>) => {
      await helpers.runMessageAction("broadcast", options);
    });
}
