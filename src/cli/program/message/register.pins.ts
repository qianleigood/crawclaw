import type { Command } from "commander";
import type { MessageCliHelpers } from "./helpers.js";

export function registerMessagePinCommands(message: Command, helpers: MessageCliHelpers) {
  const { t } = helpers;
  const pins = [
    helpers
      .withMessageBase(
        helpers.withRequiredMessageTarget(
          message.command("pin").description(t("command.message.pin.description")),
        ),
      )
      .requiredOption("--message-id <id>", t("command.message.option.messageId"))
      .action(async (opts) => {
        await helpers.runMessageAction("pin", opts);
      }),
    helpers
      .withMessageBase(
        helpers.withRequiredMessageTarget(
          message.command("unpin").description(t("command.message.unpin.description")),
        ),
      )
      .requiredOption("--message-id <id>", t("command.message.option.messageId"))
      .action(async (opts) => {
        await helpers.runMessageAction("unpin", opts);
      }),
    helpers
      .withMessageBase(
        helpers.withRequiredMessageTarget(
          message.command("pins").description(t("command.message.pins.description")),
        ),
      )
      .option("--limit <n>", t("command.message.option.limit"))
      .action(async (opts) => {
        await helpers.runMessageAction("list-pins", opts);
      }),
  ] as const;

  void pins;
}
