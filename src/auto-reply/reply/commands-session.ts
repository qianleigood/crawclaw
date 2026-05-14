import { resolveFastModeState } from "../../agents/fast-mode.js";
import { isRestartEnabled } from "../../config/commands.js";
import { logVerbose } from "../../globals.js";
import { scheduleGatewaySigusr1Restart, triggerCrawClawRestart } from "../../infra/restart.js";
import { loadCostUsageSummary, loadSessionCostSummary } from "../../infra/session-cost-usage.js";
import { formatTokenCount, formatUsd } from "../../utils/usage-format.js";
import { parseActivationCommand } from "../group-activation.js";
import { parseSendPolicyCommand } from "../send-policy.js";
import { normalizeFastMode, normalizeUsageDisplay, resolveResponseUsageMode } from "../thinking.js";
import { rejectNonOwnerCommand, rejectUnauthorizedCommand } from "./command-gates.js";
import { handleAbortTrigger, handleStopCommand } from "./commands-session-abort.js";
import { applyCommandSessionPatch, persistSessionEntry } from "./commands-session-store.js";
import type { CommandHandler } from "./commands-types.js";

const SESSION_COMMAND_PREFIX = "/session";
const SESSION_ACTION_IDLE = "idle";
const SESSION_ACTION_MAX_AGE = "max-age";

function resolveSessionCommandUsage() {
  return "Usage: /session idle <duration|off> | /session max-age <duration|off> (example: /session idle 24h)";
}

function buildSessionControlPatchFailureReply(message: string) {
  return {
    shouldContinue: false,
    reply: { text: `⚠️ Failed to update session settings: ${message}` },
  } as const;
}

export const handleActivationCommand: CommandHandler = async (params, allowTextCommands) => {
  if (!allowTextCommands) {
    return null;
  }
  const activationCommand = parseActivationCommand(params.command.commandBodyNormalized);
  if (!activationCommand.hasCommand) {
    return null;
  }
  if (!params.isGroup) {
    return {
      shouldContinue: false,
      reply: { text: "⚙️ Group activation only applies to group chats." },
    };
  }
  if (!params.command.isAuthorizedSender) {
    logVerbose(
      `Ignoring /activation from unauthorized sender in group: ${params.command.senderId || "<unknown>"}`,
    );
    return { shouldContinue: false };
  }
  if (!activationCommand.mode) {
    return {
      shouldContinue: false,
      reply: { text: "⚙️ Usage: /activation mention|always" },
    };
  }
  if (params.sessionEntry && params.sessionStore && params.sessionKey) {
    params.sessionEntry.groupActivation = activationCommand.mode;
    params.sessionEntry.groupActivationNeedsSystemIntro = true;
    await persistSessionEntry(params);
  }
  return {
    shouldContinue: false,
    reply: {
      text: `⚙️ Group activation set to ${activationCommand.mode}.`,
    },
  };
};

export const handleSendPolicyCommand: CommandHandler = async (params, allowTextCommands) => {
  if (!allowTextCommands) {
    return null;
  }
  const sendPolicyCommand = parseSendPolicyCommand(params.command.commandBodyNormalized);
  if (!sendPolicyCommand.hasCommand) {
    return null;
  }
  const unauthorizedResult = rejectUnauthorizedCommand(params, "/send");
  if (unauthorizedResult) {
    return unauthorizedResult;
  }
  const nonOwnerResult = rejectNonOwnerCommand(params, "/send");
  if (nonOwnerResult) {
    return nonOwnerResult;
  }
  if (!sendPolicyCommand.mode) {
    return {
      shouldContinue: false,
      reply: { text: "⚙️ Usage: /send on|off|inherit" },
    };
  }
  const patched = await applyCommandSessionPatch({
    commandParams: params,
    patch: {
      sendPolicy: sendPolicyCommand.mode === "inherit" ? null : sendPolicyCommand.mode,
    },
  });
  if (!patched.ok) {
    return buildSessionControlPatchFailureReply(patched.error.message);
  }
  const label =
    sendPolicyCommand.mode === "inherit"
      ? "inherit"
      : sendPolicyCommand.mode === "allow"
        ? "on"
        : "off";
  return {
    shouldContinue: false,
    reply: { text: `⚙️ Send policy set to ${label}.` },
  };
};

export const handleUsageCommand: CommandHandler = async (params, allowTextCommands) => {
  if (!allowTextCommands) {
    return null;
  }
  const normalized = params.command.commandBodyNormalized;
  if (normalized !== "/usage" && !normalized.startsWith("/usage ")) {
    return null;
  }
  if (!params.command.isAuthorizedSender) {
    logVerbose(
      `Ignoring /usage from unauthorized sender: ${params.command.senderId || "<unknown>"}`,
    );
    return { shouldContinue: false };
  }

  const rawArgs = normalized === "/usage" ? "" : normalized.slice("/usage".length).trim();
  const requested = rawArgs ? normalizeUsageDisplay(rawArgs) : undefined;
  if (rawArgs.toLowerCase().startsWith("cost")) {
    const sessionSummary = await loadSessionCostSummary({
      sessionId: params.sessionEntry?.sessionId,
      sessionEntry: params.sessionEntry,
      sessionFile: params.sessionEntry?.sessionFile,
      config: params.cfg,
      agentId: params.agentId,
    });
    const summary = await loadCostUsageSummary({ days: 30, config: params.cfg });

    const sessionCost = formatUsd(sessionSummary?.totalCost);
    const sessionTokens = sessionSummary?.totalTokens
      ? formatTokenCount(sessionSummary.totalTokens)
      : undefined;
    const sessionMissing = sessionSummary?.missingCostEntries ?? 0;
    const sessionSuffix = sessionMissing > 0 ? " (partial)" : "";
    const sessionLine =
      sessionCost || sessionTokens
        ? `Session ${sessionCost ?? "n/a"}${sessionSuffix}${sessionTokens ? ` · ${sessionTokens} tokens` : ""}`
        : "Session n/a";

    const todayKey = new Date().toLocaleDateString("en-CA");
    const todayEntry = summary.daily.find((entry) => entry.date === todayKey);
    const todayCost = formatUsd(todayEntry?.totalCost);
    const todayMissing = todayEntry?.missingCostEntries ?? 0;
    const todaySuffix = todayMissing > 0 ? " (partial)" : "";
    const todayLine = `Today ${todayCost ?? "n/a"}${todaySuffix}`;

    const last30Cost = formatUsd(summary.totals.totalCost);
    const last30Missing = summary.totals.missingCostEntries;
    const last30Suffix = last30Missing > 0 ? " (partial)" : "";
    const last30Line = `Last 30d ${last30Cost ?? "n/a"}${last30Suffix}`;

    return {
      shouldContinue: false,
      reply: { text: `💸 Usage cost\n${sessionLine}\n${todayLine}\n${last30Line}` },
    };
  }

  if (rawArgs && !requested) {
    return {
      shouldContinue: false,
      reply: { text: "⚙️ Usage: /usage off|tokens|full|cost" },
    };
  }

  const currentRaw =
    params.sessionEntry?.responseUsage ??
    (params.sessionKey ? params.sessionStore?.[params.sessionKey]?.responseUsage : undefined);
  const current = resolveResponseUsageMode(currentRaw);
  const next = requested ?? (current === "off" ? "tokens" : current === "tokens" ? "full" : "off");

  const patched = await applyCommandSessionPatch({
    commandParams: params,
    patch: {
      responseUsage: next,
    },
  });
  if (!patched.ok) {
    return buildSessionControlPatchFailureReply(patched.error.message);
  }

  return {
    shouldContinue: false,
    reply: {
      text: `⚙️ Usage footer: ${next}.`,
    },
  };
};

export const handleFastCommand: CommandHandler = async (params, allowTextCommands) => {
  if (!allowTextCommands) {
    return null;
  }
  const normalized = params.command.commandBodyNormalized;
  if (normalized !== "/fast" && !normalized.startsWith("/fast ")) {
    return null;
  }
  if (!params.command.isAuthorizedSender) {
    logVerbose(
      `Ignoring /fast from unauthorized sender: ${params.command.senderId || "<unknown>"}`,
    );
    return { shouldContinue: false };
  }

  const rawArgs = normalized === "/fast" ? "" : normalized.slice("/fast".length).trim();
  const rawMode = rawArgs.toLowerCase();
  if (!rawMode || rawMode === "status") {
    const state = resolveFastModeState({
      cfg: params.cfg,
      provider: params.provider,
      model: params.model,
      agentId: params.agentId,
      sessionEntry: params.sessionEntry,
    });
    const suffix =
      state.source === "agent"
        ? " (agent)"
        : state.source === "config"
          ? " (config)"
          : state.source === "default"
            ? " (default)"
            : "";
    return {
      shouldContinue: false,
      reply: { text: `⚙️ Current fast mode: ${state.enabled ? "on" : "off"}${suffix}.` },
    };
  }

  const nextMode = normalizeFastMode(rawMode);
  if (nextMode === undefined) {
    return {
      shouldContinue: false,
      reply: { text: "⚙️ Usage: /fast status|on|off" },
    };
  }

  const patched = await applyCommandSessionPatch({
    commandParams: params,
    patch: {
      fastMode: nextMode,
    },
  });
  if (!patched.ok) {
    return buildSessionControlPatchFailureReply(patched.error.message);
  }

  return {
    shouldContinue: false,
    reply: { text: `⚙️ Fast mode ${nextMode ? "enabled" : "disabled"}.` },
  };
};

export const handleSessionCommand: CommandHandler = async (params, allowTextCommands) => {
  if (!allowTextCommands) {
    return null;
  }
  const normalized = params.command.commandBodyNormalized;
  if (!/^\/session(?:\s|$)/.test(normalized)) {
    return null;
  }
  if (!params.command.isAuthorizedSender) {
    logVerbose(
      `Ignoring /session from unauthorized sender: ${params.command.senderId || "<unknown>"}`,
    );
    return { shouldContinue: false };
  }

  const rest = normalized.slice(SESSION_COMMAND_PREFIX.length).trim();
  const tokens = rest.split(/\s+/).filter(Boolean);
  const action = tokens[0]?.toLowerCase();
  if (action !== SESSION_ACTION_IDLE && action !== SESSION_ACTION_MAX_AGE) {
    return {
      shouldContinue: false,
      reply: { text: resolveSessionCommandUsage() },
    };
  }

  return {
    shouldContinue: false,
    reply: {
      text: "⚠️ /session idle and /session max-age are unavailable on the supported channel set.",
    },
  };
};
export const handleRestartCommand: CommandHandler = async (params, allowTextCommands) => {
  if (!allowTextCommands) {
    return null;
  }
  if (params.command.commandBodyNormalized !== "/restart") {
    return null;
  }
  if (!params.command.isAuthorizedSender) {
    logVerbose(
      `Ignoring /restart from unauthorized sender: ${params.command.senderId || "<unknown>"}`,
    );
    return { shouldContinue: false };
  }
  if (!isRestartEnabled(params.cfg)) {
    return {
      shouldContinue: false,
      reply: {
        text: "⚠️ /restart is disabled (commands.restart=false).",
      },
    };
  }
  const hasSigusr1Listener = process.listenerCount("SIGUSR1") > 0;
  if (hasSigusr1Listener) {
    scheduleGatewaySigusr1Restart({ reason: "/restart" });
    return {
      shouldContinue: false,
      reply: {
        text: "⚙️ Restarting CrawClaw in-process (SIGUSR1); back in a few seconds.",
      },
    };
  }
  const restartMethod = triggerCrawClawRestart();
  if (!restartMethod.ok) {
    const detail = restartMethod.detail ? ` Details: ${restartMethod.detail}` : "";
    return {
      shouldContinue: false,
      reply: {
        text: `⚠️ Restart failed (${restartMethod.method}).${detail}`,
      },
    };
  }
  return {
    shouldContinue: false,
    reply: {
      text: `⚙️ Restarting CrawClaw via ${restartMethod.method}; give me a few seconds to come back online.`,
    },
  };
};

export { handleAbortTrigger, handleStopCommand };
