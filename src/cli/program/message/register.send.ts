import type { Command } from "commander";
import type { MessageCliHelpers } from "./helpers.js";

export function registerMessageSendCommand(message: Command, helpers: MessageCliHelpers) {
  const { t } = helpers;
  helpers
    .withMessageBase(
      helpers
        .withRequiredMessageTarget(
          message
            .command("send")
            .description(t("command.message.send.description"))
            .option("-m, --message <text>", t("command.message.send.option.message")),
        )
        .option("--media <path-or-url>", t("command.message.option.mediaPathOrUrl"))
        .option("--interactive <json>", t("command.message.send.option.interactive"))
        .option("--buttons <json>", t("command.message.send.option.buttons"))
        .option("--components <json>", t("command.message.send.option.components"))
        .option("--card <json>", t("command.message.send.option.card"))
        .option("--reply-to <id>", t("command.message.option.replyTo"))
        .option("--thread-id <id>", t("command.message.option.telegramThreadId"))
        .option("--gif-playback", t("command.message.send.option.gifPlayback"), false)
        .option("--force-document", t("command.message.send.option.forceDocument"), false)
        .option("--silent", t("command.message.send.option.silent"), false),
    )
    .action(async (opts) => {
      await helpers.runMessageAction("send", opts);
    });
}
