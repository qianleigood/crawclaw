import { logVerbose } from "../../globals.js";
import { getGlobalHookRunner } from "../../plugins/hook-runner-global.js";
import { resolveAgentIdFromSessionKey } from "../../routing/session-key.js";
import {
  emitBeforeResetPluginHook,
  loadBeforeResetTranscript,
} from "../../sessions/runtime/before-reset-hook.js";
import { emitResetInternalHook } from "../../sessions/runtime/reset-internal-hook.js";
import { resolveSendPolicy } from "../../sessions/send-policy.js";
import { shouldHandleTextCommands } from "../commands-registry.js";
import { handleAcpResetInPlace } from "./acp-reset-adapter.js";
import type {
  CommandHandler,
  CommandHandlerResult,
  HandleCommandsParams,
} from "./commands-types.js";

let routeReplyRuntimePromise: Promise<typeof import("./route-reply.runtime.js")> | null = null;
let commandHandlersRuntimePromise: Promise<typeof import("./commands-handlers.runtime.js")> | null =
  null;

function loadRouteReplyRuntime() {
  routeReplyRuntimePromise ??= import("./route-reply.runtime.js");
  return routeReplyRuntimePromise;
}

function loadCommandHandlersRuntime() {
  commandHandlersRuntimePromise ??= import("./commands-handlers.runtime.js");
  return commandHandlersRuntimePromise;
}

let HANDLERS: CommandHandler[] | null = null;

export type ResetCommandAction = "new";

export async function emitResetCommandHooks(params: {
  action: ResetCommandAction;
  ctx: HandleCommandsParams["ctx"];
  cfg: HandleCommandsParams["cfg"];
  command: Pick<
    HandleCommandsParams["command"],
    "surface" | "senderId" | "channel" | "from" | "to" | "resetHookTriggered"
  >;
  sessionKey?: string;
  sessionEntry?: HandleCommandsParams["sessionEntry"];
  previousSessionEntry?: HandleCommandsParams["previousSessionEntry"];
  workspaceDir: string;
}): Promise<void> {
  const hookEvent = await emitResetInternalHook({
    action: params.action,
    sessionKey: params.sessionKey,
    sessionEntry: params.sessionEntry,
    previousSessionEntry: params.previousSessionEntry,
    commandSource: params.command.surface,
    senderId: params.command.senderId,
    workspaceDir: params.workspaceDir,
    cfg: params.cfg,
  });
  params.command.resetHookTriggered = true;

  // Send hook messages immediately if present
  if (hookEvent.messages.length > 0) {
    // Use OriginatingChannel/To if available, otherwise fall back to command channel/from
    // oxlint-disable-next-line typescript/no-explicit-any
    const channel = params.ctx.OriginatingChannel || (params.command.channel as any);
    // For replies, use 'from' (the sender) not 'to' (which might be the bot itself)
    const to = params.ctx.OriginatingTo || params.command.from || params.command.to;

    if (channel && to) {
      const { routeReply } = await loadRouteReplyRuntime();
      const hookReply = { text: hookEvent.messages.join("\n\n") };
      await routeReply({
        payload: hookReply,
        channel: channel,
        to: to,
        sessionKey: params.sessionKey,
        accountId: params.ctx.AccountId,
        threadId: params.ctx.MessageThreadId,
        cfg: params.cfg,
      });
    }
  }

  // Fire before_reset plugin hook — extract memories before session history is lost
  const hookRunner = getGlobalHookRunner();
  const prevEntry = params.previousSessionEntry;
  emitBeforeResetPluginHook({
    hookRunner: hookRunner ?? undefined,
    loadMessages: async () =>
      await loadBeforeResetTranscript({
        sessionFile: prevEntry?.sessionFile,
      }),
    reason: params.action,
    agentId: resolveAgentIdFromSessionKey(params.sessionKey),
    sessionKey: params.sessionKey,
    sessionId: prevEntry?.sessionId,
    workspaceDir: params.workspaceDir,
  });
}

export async function handleCommands(params: HandleCommandsParams): Promise<CommandHandlerResult> {
  if (HANDLERS === null) {
    HANDLERS = (await loadCommandHandlersRuntime()).loadCommandHandlers();
  }
  const resetMatch = params.command.commandBodyNormalized.match(/^\/new(?:\s|$)/);
  const resetRequested = Boolean(resetMatch);
  if (resetRequested && !params.command.isAuthorizedSender) {
    logVerbose(`Ignoring /new from unauthorized sender: ${params.command.senderId || "<unknown>"}`);
    return { shouldContinue: false };
  }

  // Trigger internal hook for reset/new commands
  if (resetRequested && params.command.isAuthorizedSender) {
    const commandAction: ResetCommandAction = "new";
    const resetTail =
      resetMatch != null
        ? params.command.commandBodyNormalized.slice(resetMatch[0].length).trimStart()
        : "";
    const acpResetResult = await handleAcpResetInPlace({
      commandAction,
      commandParams: params,
      resetTail,
      emitResetCommandHooks,
    });
    if (acpResetResult) {
      return acpResetResult;
    }
    await emitResetCommandHooks({
      action: commandAction,
      ctx: params.ctx,
      cfg: params.cfg,
      command: params.command,
      sessionKey: params.sessionKey,
      sessionEntry: params.sessionEntry,
      previousSessionEntry: params.previousSessionEntry,
      workspaceDir: params.workspaceDir,
    });
  }

  const allowTextCommands = shouldHandleTextCommands({
    cfg: params.cfg,
    surface: params.command.surface,
    commandSource: params.ctx.CommandSource,
  });

  for (const handler of HANDLERS) {
    const result = await handler(params, allowTextCommands);
    if (result) {
      return result;
    }
  }

  const sendPolicy = resolveSendPolicy({
    cfg: params.cfg,
    entry: params.sessionEntry,
    sessionKey: params.sessionKey,
    channel: params.sessionEntry?.channel ?? params.command.channel,
    chatType: params.sessionEntry?.chatType,
  });
  if (sendPolicy === "deny") {
    logVerbose(`Send blocked by policy for session ${params.sessionKey ?? "unknown"}`);
    return { shouldContinue: false };
  }

  return { shouldContinue: true };
}
