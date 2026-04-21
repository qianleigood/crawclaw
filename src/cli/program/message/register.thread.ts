import type { Command } from "commander";
import type { MessageCliHelpers } from "./helpers.js";

function resolveThreadCreateRequest(opts: Record<string, unknown>) {
  const channel = typeof opts.channel === "string" ? opts.channel.trim().toLowerCase() : "";
  if (channel !== "telegram") {
    return {
      action: "thread-create" as const,
      params: opts,
    };
  }
  const { threadName, ...rest } = opts;
  return {
    action: "topic-create" as const,
    params: {
      ...rest,
      name: typeof threadName === "string" ? threadName : undefined,
    },
  };
}

export function registerMessageThreadCommands(message: Command, helpers: MessageCliHelpers) {
  const { t } = helpers;
  const thread = message.command("thread").description(t("command.message.thread.description"));

  helpers
    .withMessageBase(
      helpers.withRequiredMessageTarget(
        thread
          .command("create")
          .description(t("command.message.thread.create.description"))
          .requiredOption("--thread-name <name>", t("command.message.thread.option.name")),
      ),
    )
    .option("--message-id <id>", t("command.message.thread.option.messageIdOptional"))
    .option("-m, --message <text>", t("command.message.thread.option.initialMessage"))
    .option("--auto-archive-min <n>", t("command.message.thread.option.autoArchiveMin"))
    .action(async (opts) => {
      const request = resolveThreadCreateRequest(opts);
      await helpers.runMessageAction(request.action, request.params);
    });

  helpers
    .withMessageBase(
      thread
        .command("list")
        .description(t("command.message.thread.list.description"))
        .requiredOption("--guild-id <id>", t("command.message.option.guildId")),
    )
    .option("--channel-id <id>", t("command.message.option.channelId"))
    .option("--include-archived", t("command.message.thread.option.includeArchived"), false)
    .option("--before <id>", t("command.message.option.before"))
    .option("--limit <n>", t("command.message.option.limit"))
    .action(async (opts) => {
      await helpers.runMessageAction("thread-list", opts);
    });

  helpers
    .withMessageBase(
      helpers.withRequiredMessageTarget(
        thread
          .command("reply")
          .description(t("command.message.thread.reply.description"))
          .requiredOption("-m, --message <text>", t("command.message.option.messageBody")),
      ),
    )
    .option("--media <path-or-url>", t("command.message.option.mediaPathOrUrl"))
    .option("--reply-to <id>", t("command.message.option.replyTo"))
    .action(async (opts) => {
      await helpers.runMessageAction("thread-reply", opts);
    });
}

export const __test__ = { resolveThreadCreateRequest };
