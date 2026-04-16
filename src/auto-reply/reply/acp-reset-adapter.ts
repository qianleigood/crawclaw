import { resetConfiguredBindingTargetInPlace } from "../../channels/plugins/binding-targets.js";
import { logVerbose } from "../../globals.js";
import { isAcpSessionKey } from "../../routing/session-key.js";
import { resolveBoundAcpThreadSessionKey } from "./commands-acp/targets.js";
import type { CommandHandlerResult, HandleCommandsParams } from "./commands-types.js";

type ResetHookEmitter = (params: {
  action: "new";
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
}) => Promise<void>;

function applyAcpResetTailContext(ctx: HandleCommandsParams["ctx"], resetTail: string): void {
  const mutableCtx = ctx as Record<string, unknown>;
  mutableCtx.Body = resetTail;
  mutableCtx.RawBody = resetTail;
  mutableCtx.CommandBody = resetTail;
  mutableCtx.BodyForCommands = resetTail;
  mutableCtx.BodyForAgent = resetTail;
  mutableCtx.BodyStripped = resetTail;
  mutableCtx.AcpDispatchTailAfterReset = true;
}

function resolveSessionEntryForHookSessionKey(
  sessionStore: HandleCommandsParams["sessionStore"] | undefined,
  sessionKey: string,
): HandleCommandsParams["sessionEntry"] | undefined {
  if (!sessionStore) {
    return undefined;
  }
  const directEntry = sessionStore[sessionKey];
  if (directEntry) {
    return directEntry;
  }
  const normalizedTarget = sessionKey.trim().toLowerCase();
  if (!normalizedTarget) {
    return undefined;
  }
  for (const [candidateKey, candidateEntry] of Object.entries(sessionStore)) {
    if (candidateKey.trim().toLowerCase() === normalizedTarget) {
      return candidateEntry;
    }
  }
  return undefined;
}

export async function handleAcpResetInPlace(params: {
  commandAction: "new";
  commandParams: HandleCommandsParams;
  resetTail: string;
  emitResetCommandHooks: ResetHookEmitter;
}): Promise<CommandHandlerResult | null> {
  const boundAcpSessionKey = resolveBoundAcpThreadSessionKey(params.commandParams);
  const boundAcpKey =
    boundAcpSessionKey && isAcpSessionKey(boundAcpSessionKey)
      ? boundAcpSessionKey.trim()
      : undefined;
  if (!boundAcpKey) {
    return null;
  }

  const resetResult = await resetConfiguredBindingTargetInPlace({
    cfg: params.commandParams.cfg,
    sessionKey: boundAcpKey,
    reason: params.commandAction,
  });
  if (!resetResult.ok && !resetResult.skipped) {
    logVerbose(
      `acp reset-in-place failed for ${boundAcpKey}: ${resetResult.error ?? "unknown error"}`,
    );
  }
  if (resetResult.ok) {
    const hookSessionEntry =
      boundAcpKey === params.commandParams.sessionKey
        ? params.commandParams.sessionEntry
        : resolveSessionEntryForHookSessionKey(params.commandParams.sessionStore, boundAcpKey);
    const hookPreviousSessionEntry =
      boundAcpKey === params.commandParams.sessionKey
        ? params.commandParams.previousSessionEntry
        : resolveSessionEntryForHookSessionKey(params.commandParams.sessionStore, boundAcpKey);
    await params.emitResetCommandHooks({
      action: params.commandAction,
      ctx: params.commandParams.ctx,
      cfg: params.commandParams.cfg,
      command: params.commandParams.command,
      sessionKey: boundAcpKey,
      sessionEntry: hookSessionEntry,
      previousSessionEntry: hookPreviousSessionEntry,
      workspaceDir: params.commandParams.workspaceDir,
    });
    if (params.resetTail) {
      applyAcpResetTailContext(params.commandParams.ctx, params.resetTail);
      if (
        params.commandParams.rootCtx &&
        params.commandParams.rootCtx !== params.commandParams.ctx
      ) {
        applyAcpResetTailContext(params.commandParams.rootCtx, params.resetTail);
      }
      return {
        shouldContinue: false,
      };
    }
    return {
      shouldContinue: false,
      reply: { text: "✅ ACP session reset in place." },
    };
  }
  if (resetResult.skipped) {
    return {
      shouldContinue: false,
      reply: {
        text: "⚠️ ACP session reset unavailable for this bound conversation. Rebind with /acp bind or /acp spawn.",
      },
    };
  }
  return {
    shouldContinue: false,
    reply: {
      text: "⚠️ ACP session reset failed. Check /acp status and try again.",
    },
  };
}
