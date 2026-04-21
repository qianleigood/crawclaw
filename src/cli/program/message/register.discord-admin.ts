import type { Command } from "commander";
import type { MessageCliHelpers } from "./helpers.js";

export function registerMessageDiscordAdminCommands(message: Command, helpers: MessageCliHelpers) {
  const { t } = helpers;
  const role = message.command("role").description(t("command.message.role.description"));
  helpers
    .withMessageBase(
      role
        .command("info")
        .description(t("command.message.role.info.description"))
        .requiredOption("--guild-id <id>", t("command.message.option.guildId")),
    )
    .action(async (opts) => {
      await helpers.runMessageAction("role-info", opts);
    });

  helpers
    .withMessageBase(
      role
        .command("add")
        .description(t("command.message.role.add.description"))
        .requiredOption("--guild-id <id>", t("command.message.option.guildId"))
        .requiredOption("--user-id <id>", t("command.message.option.userId"))
        .requiredOption("--role-id <id>", t("command.message.option.roleId")),
    )
    .action(async (opts) => {
      await helpers.runMessageAction("role-add", opts);
    });

  helpers
    .withMessageBase(
      role
        .command("remove")
        .description(t("command.message.role.remove.description"))
        .requiredOption("--guild-id <id>", t("command.message.option.guildId"))
        .requiredOption("--user-id <id>", t("command.message.option.userId"))
        .requiredOption("--role-id <id>", t("command.message.option.roleId")),
    )
    .action(async (opts) => {
      await helpers.runMessageAction("role-remove", opts);
    });

  const channel = message.command("channel").description(t("command.message.channel.description"));
  helpers
    .withMessageBase(
      helpers.withRequiredMessageTarget(
        channel.command("info").description(t("command.message.channel.info.description")),
      ),
    )
    .action(async (opts) => {
      await helpers.runMessageAction("channel-info", opts);
    });

  helpers
    .withMessageBase(
      channel
        .command("list")
        .description(t("command.message.channel.list.description"))
        .requiredOption("--guild-id <id>", t("command.message.option.guildId")),
    )
    .action(async (opts) => {
      await helpers.runMessageAction("channel-list", opts);
    });

  const member = message.command("member").description(t("command.message.member.description"));
  helpers
    .withMessageBase(
      member
        .command("info")
        .description(t("command.message.member.info.description"))
        .requiredOption("--user-id <id>", t("command.message.option.userId")),
    )
    .option("--guild-id <id>", t("command.message.option.guildIdDiscord"))
    .action(async (opts) => {
      await helpers.runMessageAction("member-info", opts);
    });

  const voice = message.command("voice").description(t("command.message.voice.description"));
  helpers
    .withMessageBase(
      voice
        .command("status")
        .description(t("command.message.voice.status.description"))
        .requiredOption("--guild-id <id>", t("command.message.option.guildId"))
        .requiredOption("--user-id <id>", t("command.message.option.userId")),
    )
    .action(async (opts) => {
      await helpers.runMessageAction("voice-status", opts);
    });

  const event = message.command("event").description(t("command.message.event.description"));
  helpers
    .withMessageBase(
      event
        .command("list")
        .description(t("command.message.event.list.description"))
        .requiredOption("--guild-id <id>", t("command.message.option.guildId")),
    )
    .action(async (opts) => {
      await helpers.runMessageAction("event-list", opts);
    });

  helpers
    .withMessageBase(
      event
        .command("create")
        .description(t("command.message.event.create.description"))
        .requiredOption("--guild-id <id>", t("command.message.option.guildId"))
        .requiredOption("--event-name <name>", t("command.message.event.option.name"))
        .requiredOption("--start-time <iso>", t("command.message.event.option.startTime")),
    )
    .option("--end-time <iso>", t("command.message.event.option.endTime"))
    .option("--desc <text>", t("command.message.event.option.desc"))
    .option("--channel-id <id>", t("command.message.option.channelId"))
    .option("--location <text>", t("command.message.event.option.location"))
    .option("--event-type <stage|external|voice>", t("command.message.event.option.type"))
    .action(async (opts) => {
      await helpers.runMessageAction("event-create", opts);
    });

  helpers
    .withMessageBase(
      message
        .command("timeout")
        .description(t("command.message.timeout.description"))
        .requiredOption("--guild-id <id>", t("command.message.option.guildId"))
        .requiredOption("--user-id <id>", t("command.message.option.userId")),
    )
    .option("--duration-min <n>", t("command.message.timeout.option.durationMin"))
    .option("--until <iso>", t("command.message.timeout.option.until"))
    .option("--reason <text>", t("command.message.option.moderationReason"))
    .action(async (opts) => {
      await helpers.runMessageAction("timeout", opts);
    });

  helpers
    .withMessageBase(
      message
        .command("kick")
        .description(t("command.message.kick.description"))
        .requiredOption("--guild-id <id>", t("command.message.option.guildId"))
        .requiredOption("--user-id <id>", t("command.message.option.userId")),
    )
    .option("--reason <text>", t("command.message.option.moderationReason"))
    .action(async (opts) => {
      await helpers.runMessageAction("kick", opts);
    });

  helpers
    .withMessageBase(
      message
        .command("ban")
        .description(t("command.message.ban.description"))
        .requiredOption("--guild-id <id>", t("command.message.option.guildId"))
        .requiredOption("--user-id <id>", t("command.message.option.userId")),
    )
    .option("--reason <text>", t("command.message.option.moderationReason"))
    .option("--delete-days <n>", t("command.message.ban.option.deleteDays"))
    .action(async (opts) => {
      await helpers.runMessageAction("ban", opts);
    });
}
