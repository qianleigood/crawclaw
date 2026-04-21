import type { Command } from "commander";
import { collectOption } from "../helpers.js";
import type { MessageCliHelpers } from "./helpers.js";

export function registerMessageEmojiCommands(message: Command, helpers: MessageCliHelpers) {
  const { t } = helpers;
  const emoji = message.command("emoji").description(t("command.message.emoji.description"));

  helpers
    .withMessageBase(emoji.command("list").description(t("command.message.emoji.list.description")))
    .option("--guild-id <id>", t("command.message.option.guildIdDiscord"))
    .action(async (opts) => {
      await helpers.runMessageAction("emoji-list", opts);
    });

  helpers
    .withMessageBase(
      emoji
        .command("upload")
        .description(t("command.message.emoji.upload.description"))
        .requiredOption("--guild-id <id>", t("command.message.option.guildId")),
    )
    .requiredOption("--emoji-name <name>", t("command.message.emoji.option.name"))
    .requiredOption("--media <path-or-url>", t("command.message.emoji.option.media"))
    .option(
      "--role-ids <id>",
      t("command.message.option.roleIdRepeat"),
      collectOption,
      [] as string[],
    )
    .action(async (opts) => {
      await helpers.runMessageAction("emoji-upload", opts);
    });
}

export function registerMessageStickerCommands(message: Command, helpers: MessageCliHelpers) {
  const { t } = helpers;
  const sticker = message.command("sticker").description(t("command.message.sticker.description"));

  helpers
    .withMessageBase(
      helpers.withRequiredMessageTarget(
        sticker.command("send").description(t("command.message.sticker.send.description")),
      ),
    )
    .requiredOption(
      "--sticker-id <id>",
      t("command.message.sticker.option.idRepeat"),
      collectOption,
    )
    .option("-m, --message <text>", t("command.message.option.optionalMessageBody"))
    .action(async (opts) => {
      await helpers.runMessageAction("sticker", opts);
    });

  helpers
    .withMessageBase(
      sticker
        .command("upload")
        .description(t("command.message.sticker.upload.description"))
        .requiredOption("--guild-id <id>", t("command.message.option.guildId")),
    )
    .requiredOption("--sticker-name <name>", t("command.message.sticker.option.name"))
    .requiredOption("--sticker-desc <text>", t("command.message.sticker.option.desc"))
    .requiredOption("--sticker-tags <tags>", t("command.message.sticker.option.tags"))
    .requiredOption("--media <path-or-url>", t("command.message.sticker.option.media"))
    .action(async (opts) => {
      await helpers.runMessageAction("sticker-upload", opts);
    });
}
