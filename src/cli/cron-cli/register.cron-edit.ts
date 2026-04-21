import type { Command } from "commander";
import type { CronJob } from "../../cron/types.js";
import { danger } from "../../globals.js";
import { sanitizeAgentId } from "../../routing/session-key.js";
import { defaultRuntime } from "../../runtime.js";
import { addGatewayClientOptions, callGatewayFromCli } from "../gateway-rpc.js";
import type { CliTranslator } from "../i18n/types.js";
import {
  applyExistingCronSchedulePatch,
  resolveCronEditScheduleRequest,
} from "./schedule-options.js";
import { getCronChannelOptions, parseDurationMs, warnIfCronSchedulerDisabled } from "./shared.js";

const assignIf = (
  target: Record<string, unknown>,
  key: string,
  value: unknown,
  shouldAssign: boolean,
) => {
  if (shouldAssign) {
    target[key] = value;
  }
};

export function registerCronEditCommand(cron: Command, t: CliTranslator) {
  addGatewayClientOptions(
    cron
      .command("edit")
      .description(t("command.cron.edit.description"))
      .argument("<id>", t("command.cron.argument.id"))
      .option("--name <name>", t("command.cron.edit.option.name"))
      .option("--description <text>", t("command.cron.edit.option.description"))
      .option("--enable", t("command.cron.edit.option.enable"), false)
      .option("--disable", t("command.cron.edit.option.disable"), false)
      .option("--delete-after-run", t("command.cron.option.deleteAfterRun"), false)
      .option("--keep-after-run", t("command.cron.option.keepAfterRun"), false)
      .option("--session <target>", t("command.cron.option.session"))
      .option("--agent <id>", t("command.cron.edit.option.agent"))
      .option("--clear-agent", t("command.cron.edit.option.clearAgent"), false)
      .option("--session-key <key>", t("command.cron.edit.option.sessionKey"))
      .option("--clear-session-key", t("command.cron.edit.option.clearSessionKey"), false)
      .option("--wake <mode>", t("command.cron.option.wake"))
      .option("--at <when>", t("command.cron.edit.option.at"))
      .option("--every <duration>", t("command.cron.edit.option.every"))
      .option("--cron <expr>", t("command.cron.edit.option.cron"))
      .option("--tz <iana>", t("command.cron.option.tz"))
      .option("--stagger <duration>", t("command.cron.option.stagger"))
      .option("--exact", t("command.cron.option.exact"))
      .option("--system-event <text>", t("command.cron.edit.option.systemEvent"))
      .option("--message <text>", t("command.cron.edit.option.message"))
      .option("--thinking <level>", t("command.cron.option.thinking"))
      .option("--model <model>", t("command.cron.edit.option.model"))
      .option("--timeout-seconds <n>", t("command.cron.option.timeoutSeconds"))
      .option("--light-context", t("command.cron.edit.option.lightContext"))
      .option("--no-light-context", t("command.cron.edit.option.noLightContext"))
      .option("--tools <csv>", t("command.cron.option.tools"))
      .option("--clear-tools", t("command.cron.edit.option.clearTools"), false)
      .option("--announce", t("command.cron.option.announce"))
      .option("--deliver", t("command.cron.option.deliver"))
      .option("--no-deliver", t("command.cron.edit.option.noDeliver"))
      .option(
        "--channel <channel>",
        t("command.cron.option.channel", { channels: getCronChannelOptions() }),
      )
      .option("--to <dest>", t("command.cron.option.to"))
      .option("--account <id>", t("command.cron.option.account"))
      .option("--best-effort-deliver", t("command.cron.edit.option.bestEffortDeliver"))
      .option("--no-best-effort-deliver", t("command.cron.edit.option.noBestEffortDeliver"))
      .option("--failure-alert", t("command.cron.edit.option.failureAlert"))
      .option("--no-failure-alert", t("command.cron.edit.option.noFailureAlert"))
      .option("--failure-alert-after <n>", t("command.cron.edit.option.failureAlertAfter"))
      .option(
        "--failure-alert-channel <channel>",
        t("command.cron.edit.option.failureAlertChannel", { channels: getCronChannelOptions() }),
      )
      .option("--failure-alert-to <dest>", t("command.cron.edit.option.failureAlertTo"))
      .option(
        "--failure-alert-cooldown <duration>",
        t("command.cron.edit.option.failureAlertCooldown"),
      )
      .option("--failure-alert-mode <mode>", t("command.cron.edit.option.failureAlertMode"))
      .option(
        "--failure-alert-account-id <id>",
        t("command.cron.edit.option.failureAlertAccountId"),
      )
      .action(async (id, opts) => {
        try {
          if (opts.session === "main" && opts.message) {
            throw new Error(
              "Main jobs cannot use --message; use --system-event or --session isolated.",
            );
          }
          if (opts.session === "isolated" && opts.systemEvent) {
            throw new Error(
              "Isolated jobs cannot use --system-event; use --message or --session main.",
            );
          }
          if (opts.announce && typeof opts.deliver === "boolean") {
            throw new Error("Choose --announce or --no-deliver (not multiple).");
          }
          const patch: Record<string, unknown> = {};
          if (typeof opts.name === "string") {
            patch.name = opts.name;
          }
          if (typeof opts.description === "string") {
            patch.description = opts.description;
          }
          if (opts.enable && opts.disable) {
            throw new Error("Choose --enable or --disable, not both");
          }
          if (opts.enable) {
            patch.enabled = true;
          }
          if (opts.disable) {
            patch.enabled = false;
          }
          if (opts.deleteAfterRun && opts.keepAfterRun) {
            throw new Error("Choose --delete-after-run or --keep-after-run, not both");
          }
          if (opts.deleteAfterRun) {
            patch.deleteAfterRun = true;
          }
          if (opts.keepAfterRun) {
            patch.deleteAfterRun = false;
          }
          if (typeof opts.session === "string") {
            patch.sessionTarget = opts.session;
          }
          if (typeof opts.wake === "string") {
            patch.wakeMode = opts.wake;
          }
          if (opts.agent && opts.clearAgent) {
            throw new Error("Use --agent or --clear-agent, not both");
          }
          if (typeof opts.agent === "string" && opts.agent.trim()) {
            patch.agentId = sanitizeAgentId(opts.agent.trim());
          }
          if (opts.clearAgent) {
            patch.agentId = null;
          }
          if (opts.sessionKey && opts.clearSessionKey) {
            throw new Error("Use --session-key or --clear-session-key, not both");
          }
          if (typeof opts.sessionKey === "string" && opts.sessionKey.trim()) {
            patch.sessionKey = opts.sessionKey.trim();
          }
          if (opts.clearSessionKey) {
            patch.sessionKey = null;
          }

          const scheduleRequest = resolveCronEditScheduleRequest({
            at: opts.at,
            cron: opts.cron,
            every: opts.every,
            exact: opts.exact,
            stagger: opts.stagger,
            tz: opts.tz,
          });
          if (scheduleRequest.kind === "direct") {
            patch.schedule = scheduleRequest.schedule;
          } else if (scheduleRequest.kind === "patch-existing-cron") {
            const listed = (await callGatewayFromCli("cron.list", opts, {
              includeDisabled: true,
            })) as { jobs?: CronJob[] } | null;
            const existing = (listed?.jobs ?? []).find((job) => job.id === id);
            if (!existing) {
              throw new Error(`unknown cron job id: ${id}`);
            }
            patch.schedule = applyExistingCronSchedulePatch(existing.schedule, scheduleRequest);
          }

          const hasSystemEventPatch = typeof opts.systemEvent === "string";
          const model =
            typeof opts.model === "string" && opts.model.trim() ? opts.model.trim() : undefined;
          const thinking =
            typeof opts.thinking === "string" && opts.thinking.trim()
              ? opts.thinking.trim()
              : undefined;
          const timeoutSeconds = opts.timeoutSeconds
            ? Number.parseInt(String(opts.timeoutSeconds), 10)
            : undefined;
          const hasTimeoutSeconds = Boolean(timeoutSeconds && Number.isFinite(timeoutSeconds));
          const hasDeliveryModeFlag = opts.announce || typeof opts.deliver === "boolean";
          const hasDeliveryTarget = typeof opts.channel === "string" || typeof opts.to === "string";
          const hasDeliveryAccount = typeof opts.account === "string";
          const hasBestEffort = typeof opts.bestEffortDeliver === "boolean";
          const hasAgentTurnPatch =
            typeof opts.message === "string" ||
            Boolean(model) ||
            Boolean(thinking) ||
            hasTimeoutSeconds ||
            typeof opts.lightContext === "boolean" ||
            typeof opts.tools === "string" ||
            opts.clearTools ||
            hasDeliveryModeFlag ||
            hasDeliveryTarget ||
            hasDeliveryAccount ||
            hasBestEffort;
          if (hasSystemEventPatch && hasAgentTurnPatch) {
            throw new Error("Choose at most one payload change");
          }
          if (hasSystemEventPatch) {
            patch.payload = {
              kind: "systemEvent",
              text: String(opts.systemEvent),
            };
          } else if (hasAgentTurnPatch) {
            const payload: Record<string, unknown> = { kind: "agentTurn" };
            assignIf(payload, "message", String(opts.message), typeof opts.message === "string");
            assignIf(payload, "model", model, Boolean(model));
            assignIf(payload, "thinking", thinking, Boolean(thinking));
            assignIf(payload, "timeoutSeconds", timeoutSeconds, hasTimeoutSeconds);
            assignIf(
              payload,
              "lightContext",
              opts.lightContext,
              typeof opts.lightContext === "boolean",
            );
            if (opts.clearTools) {
              payload.toolsAllow = null;
            } else if (typeof opts.tools === "string" && opts.tools.trim()) {
              payload.toolsAllow = opts.tools
                .split(",")
                .map((t: string) => t.trim())
                .filter(Boolean);
            }
            patch.payload = payload;
          }

          if (hasDeliveryModeFlag || hasDeliveryTarget || hasDeliveryAccount || hasBestEffort) {
            const delivery: Record<string, unknown> = {};
            if (hasDeliveryModeFlag) {
              delivery.mode = opts.announce || opts.deliver === true ? "announce" : "none";
            } else if (hasBestEffort) {
              // Back-compat: toggling best-effort alone has historically implied announce mode.
              delivery.mode = "announce";
            }
            if (typeof opts.channel === "string") {
              const channel = opts.channel.trim();
              delivery.channel = channel ? channel : undefined;
            }
            if (typeof opts.to === "string") {
              const to = opts.to.trim();
              delivery.to = to ? to : undefined;
            }
            if (typeof opts.account === "string") {
              const account = opts.account.trim();
              delivery.accountId = account ? account : undefined;
            }
            if (typeof opts.bestEffortDeliver === "boolean") {
              delivery.bestEffort = opts.bestEffortDeliver;
            }
            patch.delivery = delivery;
          }

          const hasFailureAlertAfter = typeof opts.failureAlertAfter === "string";
          const hasFailureAlertChannel = typeof opts.failureAlertChannel === "string";
          const hasFailureAlertTo = typeof opts.failureAlertTo === "string";
          const hasFailureAlertCooldown = typeof opts.failureAlertCooldown === "string";
          const hasFailureAlertMode = typeof opts.failureAlertMode === "string";
          const hasFailureAlertAccountId = typeof opts.failureAlertAccountId === "string";
          const hasFailureAlertFields =
            hasFailureAlertAfter ||
            hasFailureAlertChannel ||
            hasFailureAlertTo ||
            hasFailureAlertCooldown ||
            hasFailureAlertMode ||
            hasFailureAlertAccountId;
          const failureAlertFlag =
            typeof opts.failureAlert === "boolean" ? opts.failureAlert : undefined;
          if (failureAlertFlag === false && hasFailureAlertFields) {
            throw new Error("Use --no-failure-alert alone (without failure-alert-* options).");
          }
          if (failureAlertFlag === false) {
            patch.failureAlert = false;
          } else if (failureAlertFlag === true || hasFailureAlertFields) {
            const failureAlert: Record<string, unknown> = {};
            if (hasFailureAlertAfter) {
              const after = Number.parseInt(String(opts.failureAlertAfter), 10);
              if (!Number.isFinite(after) || after <= 0) {
                throw new Error("Invalid --failure-alert-after (must be a positive integer).");
              }
              failureAlert.after = after;
            }
            if (hasFailureAlertChannel) {
              const channel = String(opts.failureAlertChannel).trim().toLowerCase();
              failureAlert.channel = channel ? channel : undefined;
            }
            if (hasFailureAlertTo) {
              const to = String(opts.failureAlertTo).trim();
              failureAlert.to = to ? to : undefined;
            }
            if (hasFailureAlertCooldown) {
              const cooldownMs = parseDurationMs(String(opts.failureAlertCooldown));
              if (!cooldownMs && cooldownMs !== 0) {
                throw new Error("Invalid --failure-alert-cooldown.");
              }
              failureAlert.cooldownMs = cooldownMs;
            }
            if (hasFailureAlertMode) {
              const mode = String(opts.failureAlertMode).trim().toLowerCase();
              if (mode !== "announce" && mode !== "webhook") {
                throw new Error("Invalid --failure-alert-mode (must be 'announce' or 'webhook').");
              }
              failureAlert.mode = mode;
            }
            if (hasFailureAlertAccountId) {
              const accountId = String(opts.failureAlertAccountId).trim();
              failureAlert.accountId = accountId ? accountId : undefined;
            }
            patch.failureAlert = failureAlert;
          }

          const res = await callGatewayFromCli("cron.update", opts, {
            id,
            patch,
          });
          defaultRuntime.writeJson(res);
          await warnIfCronSchedulerDisabled(opts);
        } catch (err) {
          defaultRuntime.error(danger(String(err)));
          defaultRuntime.exit(1);
        }
      }),
  );
}
