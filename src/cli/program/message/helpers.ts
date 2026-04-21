import type { Command } from "commander";
import { messageCommand } from "../../../commands/message.js";
import { danger, setVerbose } from "../../../globals.js";
import { runGlobalGatewayStopSafely } from "../../../plugins/hook-runner-global.js";
import { defaultRuntime } from "../../../runtime.js";
import { runCommandWithRuntime } from "../../cli-utils.js";
import { createDefaultDeps } from "../../deps.js";
import { createCliTranslator } from "../../i18n/index.js";
import type { CliTranslator } from "../../i18n/types.js";
import { ensurePluginRegistryLoaded } from "../../plugin-registry.js";
import { getProgramContext } from "../program-context.js";

export type MessageCliHelpers = {
  t: CliTranslator;
  withMessageBase: (command: Command) => Command;
  withMessageTarget: (command: Command) => Command;
  withRequiredMessageTarget: (command: Command) => Command;
  runMessageAction: (action: string, opts: Record<string, unknown>) => Promise<void>;
};

function normalizeMessageOptions(opts: Record<string, unknown>): Record<string, unknown> {
  const { account, ...rest } = opts;
  return {
    ...rest,
    accountId: typeof account === "string" ? account : undefined,
  };
}

async function runPluginStopHooks(): Promise<void> {
  await runGlobalGatewayStopSafely({
    event: { reason: "cli message action complete" },
    ctx: {},
    onError: (err) => defaultRuntime.error(danger(`gateway_stop hook failed: ${String(err)}`)),
  });
}

function resolveMessageTranslator(command: Command): CliTranslator {
  let current: Command | null = command;
  while (current) {
    const ctx = getProgramContext(current);
    if (ctx) {
      return ctx.t;
    }
    current = current.parent ?? null;
  }
  return createCliTranslator("en");
}

export function createMessageCliHelpers(
  message: Command,
  messageChannelOptions: string,
): MessageCliHelpers {
  const t = resolveMessageTranslator(message);
  const withMessageBase = (command: Command) =>
    command
      .option(
        "--channel <channel>",
        t("command.message.option.channel", { channels: messageChannelOptions }),
      )
      .option("--account <id>", t("command.message.option.account"))
      .option("--json", t("command.message.option.json"), false)
      .option("--dry-run", t("command.message.option.dryRun"), false)
      .option("--verbose", t("command.message.option.verbose"), false);

  const withMessageTarget = (command: Command) =>
    command.option("-t, --target <dest>", t("command.message.option.target"));
  const withRequiredMessageTarget = (command: Command) =>
    command.requiredOption("-t, --target <dest>", t("command.message.option.target"));

  const runMessageAction = async (action: string, opts: Record<string, unknown>) => {
    setVerbose(Boolean(opts.verbose));
    ensurePluginRegistryLoaded();
    const deps = createDefaultDeps();
    let failed = false;
    await runCommandWithRuntime(
      defaultRuntime,
      async () => {
        await messageCommand(
          {
            ...normalizeMessageOptions(opts),
            action,
          },
          deps,
          defaultRuntime,
        );
      },
      (err) => {
        failed = true;
        defaultRuntime.error(danger(String(err)));
      },
    );
    await runPluginStopHooks();
    defaultRuntime.exit(failed ? 1 : 0);
  };

  // `message` is only used for `message.help({ error: true })`, keep the
  // command-specific helpers grouped here.
  void message;

  return {
    t,
    withMessageBase,
    withMessageTarget,
    withRequiredMessageTarget,
    runMessageAction,
  };
}
