import type { Command } from "commander";
import type { CronJob } from "../../cron/types.js";
import { sanitizeAgentId } from "../../routing/session-key.js";
import { defaultRuntime } from "../../runtime.js";
import type { GatewayRpcOpts } from "../gateway-rpc.js";
import { addGatewayClientOptions, callGatewayFromCli } from "../gateway-rpc.js";
import type { CliTranslator } from "../i18n/types.js";
import { parsePositiveIntOrUndefined } from "../program/helpers.js";
import { resolveCronCreateSchedule } from "./schedule-options.js";
import {
  getCronChannelOptions,
  handleCronCliError,
  printCronJson,
  printCronList,
  warnIfCronSchedulerDisabled,
} from "./shared.js";

export function registerCronStatusCommand(cron: Command, t: CliTranslator) {
  addGatewayClientOptions(
    cron
      .command("status")
      .description(t("command.cron.status.description"))
      .option("--json", t("command.cron.option.json"), false)
      .action(async (opts) => {
        try {
          const res = await callGatewayFromCli("cron.status", opts, {});
          printCronJson(res);
        } catch (err) {
          handleCronCliError(err);
        }
      }),
  );
}

export function registerCronListCommand(cron: Command, t: CliTranslator) {
  addGatewayClientOptions(
    cron
      .command("list")
      .description(t("command.cron.list.description"))
      .option("--all", t("command.cron.list.option.all"), false)
      .option("--json", t("command.cron.option.json"), false)
      .action(async (opts) => {
        try {
          const res = await callGatewayFromCli("cron.list", opts, {
            includeDisabled: Boolean(opts.all),
          });
          if (opts.json) {
            printCronJson(res);
            return;
          }
          const jobs = (res as { jobs?: CronJob[] } | null)?.jobs ?? [];
          printCronList(jobs, defaultRuntime);
        } catch (err) {
          handleCronCliError(err);
        }
      }),
  );
}

export function registerCronAddCommand(cron: Command, t: CliTranslator) {
  addGatewayClientOptions(
    cron
      .command("add")
      .alias("create")
      .description(t("command.cron.add.description"))
      .requiredOption("--name <name>", t("command.cron.option.name"))
      .option("--description <text>", t("command.cron.add.option.description"))
      .option("--disabled", t("command.cron.add.option.disabled"), false)
      .option("--delete-after-run", t("command.cron.option.deleteAfterRun"), false)
      .option("--keep-after-run", t("command.cron.option.keepAfterRun"), false)
      .option("--agent <id>", t("command.cron.add.option.agent"))
      .option("--session <target>", t("command.cron.option.session"))
      .option("--session-key <key>", t("command.cron.add.option.sessionKey"))
      .option("--wake <mode>", t("command.cron.option.wake"), "now")
      .option("--at <when>", t("command.cron.add.option.at"))
      .option("--every <duration>", t("command.cron.add.option.every"))
      .option("--cron <expr>", t("command.cron.add.option.cron"))
      .option("--tz <iana>", t("command.cron.option.tz"), "")
      .option("--stagger <duration>", t("command.cron.option.stagger"))
      .option("--exact", t("command.cron.option.exact"), false)
      .option("--system-event <text>", t("command.cron.add.option.systemEvent"))
      .option("--message <text>", t("command.cron.add.option.message"))
      .option("--thinking <level>", t("command.cron.option.thinking"))
      .option("--model <model>", t("command.cron.add.option.model"))
      .option("--timeout-seconds <n>", t("command.cron.option.timeoutSeconds"))
      .option("--light-context", t("command.cron.add.option.lightContext"), false)
      .option("--tools <csv>", t("command.cron.option.tools"))
      .option("--announce", t("command.cron.option.announce"), false)
      .option("--deliver", t("command.cron.option.deliver"))
      .option("--no-deliver", t("command.cron.add.option.noDeliver"))
      .option(
        "--channel <channel>",
        t("command.cron.option.channel", { channels: getCronChannelOptions() }),
        "last",
      )
      .option("--to <dest>", t("command.cron.option.to"))
      .option("--account <id>", t("command.cron.option.account"))
      .option("--best-effort-deliver", t("command.cron.add.option.bestEffortDeliver"), false)
      .option("--json", t("command.cron.option.json"), false)
      .action(async (opts: GatewayRpcOpts & Record<string, unknown>, cmd?: Command) => {
        try {
          const schedule = resolveCronCreateSchedule({
            at: opts.at,
            cron: opts.cron,
            every: opts.every,
            exact: opts.exact,
            stagger: opts.stagger,
            tz: opts.tz,
          });

          const wakeModeRaw = typeof opts.wake === "string" ? opts.wake : "now";
          const wakeMode = wakeModeRaw.trim() || "now";
          if (wakeMode !== "now") {
            throw new Error("--wake must be now");
          }
          const normalizedWakeMode = "now";

          const agentId =
            typeof opts.agent === "string" && opts.agent.trim()
              ? sanitizeAgentId(opts.agent.trim())
              : undefined;

          const hasAnnounce = Boolean(opts.announce) || opts.deliver === true;
          const hasNoDeliver = opts.deliver === false;
          const deliveryFlagCount = [hasAnnounce, hasNoDeliver].filter(Boolean).length;
          if (deliveryFlagCount > 1) {
            throw new Error("Choose at most one of --announce or --no-deliver");
          }

          const payload = (() => {
            const systemEvent = typeof opts.systemEvent === "string" ? opts.systemEvent.trim() : "";
            const message = typeof opts.message === "string" ? opts.message.trim() : "";
            const chosen = [Boolean(systemEvent), Boolean(message)].filter(Boolean).length;
            if (chosen !== 1) {
              throw new Error("Choose exactly one payload: --system-event or --message");
            }
            if (systemEvent) {
              return { kind: "systemEvent" as const, text: systemEvent };
            }
            const timeoutSeconds = parsePositiveIntOrUndefined(opts.timeoutSeconds);
            return {
              kind: "agentTurn" as const,
              message,
              model:
                typeof opts.model === "string" && opts.model.trim() ? opts.model.trim() : undefined,
              thinking:
                typeof opts.thinking === "string" && opts.thinking.trim()
                  ? opts.thinking.trim()
                  : undefined,
              timeoutSeconds:
                timeoutSeconds && Number.isFinite(timeoutSeconds) ? timeoutSeconds : undefined,
              lightContext: opts.lightContext === true ? true : undefined,
              toolsAllow:
                typeof opts.tools === "string" && opts.tools.trim()
                  ? opts.tools
                      .split(",")
                      .map((t: string) => t.trim())
                      .filter(Boolean)
                  : undefined,
            };
          })();

          const optionSource =
            typeof cmd?.getOptionValueSource === "function"
              ? (name: string) => cmd.getOptionValueSource(name)
              : () => undefined;
          const sessionSource = optionSource("session");
          const sessionTargetRaw = typeof opts.session === "string" ? opts.session.trim() : "";
          const inferredSessionTarget = payload.kind === "agentTurn" ? "isolated" : "main";
          const sessionTarget =
            sessionSource === "cli" ? sessionTargetRaw || "" : inferredSessionTarget;
          const isCustomSessionTarget =
            sessionTarget.toLowerCase().startsWith("session:") &&
            sessionTarget.slice(8).trim().length > 0;
          const isIsolatedLikeSessionTarget =
            sessionTarget === "isolated" || sessionTarget === "current" || isCustomSessionTarget;
          if (sessionTarget !== "main" && !isIsolatedLikeSessionTarget) {
            throw new Error("--session must be main, isolated, current, or session:<id>");
          }

          if (opts.deleteAfterRun && opts.keepAfterRun) {
            throw new Error("Choose --delete-after-run or --keep-after-run, not both");
          }

          if (sessionTarget === "main" && payload.kind !== "systemEvent") {
            throw new Error("Main jobs require --system-event (systemEvent).");
          }
          if (isIsolatedLikeSessionTarget && payload.kind !== "agentTurn") {
            throw new Error("Isolated/current/custom-session jobs require --message (agentTurn).");
          }
          if (
            (opts.announce || typeof opts.deliver === "boolean") &&
            (!isIsolatedLikeSessionTarget || payload.kind !== "agentTurn")
          ) {
            throw new Error("--announce/--no-deliver require a non-main agentTurn session target.");
          }

          const accountId =
            typeof opts.account === "string" && opts.account.trim()
              ? opts.account.trim()
              : undefined;

          if (accountId && (!isIsolatedLikeSessionTarget || payload.kind !== "agentTurn")) {
            throw new Error("--account requires a non-main agentTurn job with delivery.");
          }

          const deliveryMode =
            isIsolatedLikeSessionTarget && payload.kind === "agentTurn"
              ? hasAnnounce
                ? "announce"
                : hasNoDeliver
                  ? "none"
                  : "announce"
              : undefined;

          const nameRaw = typeof opts.name === "string" ? opts.name : "";
          const name = nameRaw.trim();
          if (!name) {
            throw new Error("--name is required");
          }

          const description =
            typeof opts.description === "string" && opts.description.trim()
              ? opts.description.trim()
              : undefined;

          const sessionKey =
            typeof opts.sessionKey === "string" && opts.sessionKey.trim()
              ? opts.sessionKey.trim()
              : undefined;

          const params = {
            name,
            description,
            enabled: !opts.disabled,
            deleteAfterRun: opts.deleteAfterRun ? true : opts.keepAfterRun ? false : undefined,
            agentId,
            sessionKey,
            schedule,
            sessionTarget,
            wakeMode: normalizedWakeMode,
            payload,
            delivery: deliveryMode
              ? {
                  mode: deliveryMode,
                  channel:
                    typeof opts.channel === "string" && opts.channel.trim()
                      ? opts.channel.trim()
                      : undefined,
                  to: typeof opts.to === "string" && opts.to.trim() ? opts.to.trim() : undefined,
                  accountId,
                  bestEffort: opts.bestEffortDeliver ? true : undefined,
                }
              : undefined,
          };

          const res = await callGatewayFromCli("cron.add", opts, params);
          printCronJson(res);
          await warnIfCronSchedulerDisabled(opts);
        } catch (err) {
          handleCronCliError(err);
        }
      }),
  );
}
