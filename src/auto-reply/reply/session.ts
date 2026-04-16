import path from "node:path";
import { resolveSessionAgentId } from "../../agents/agent-scope.js";
import { clearBootstrapSnapshotOnSessionRollover } from "../../agents/bootstrap-cache.js";
import { normalizeChatType } from "../../channels/chat-type.js";
import type { CrawClawConfig } from "../../config/config.js";
import { resolveGroupSessionKey } from "../../config/sessions/group.js";
import { canonicalizeMainSessionAlias } from "../../config/sessions/main-session.js";
import { resolveSessionTranscriptPath, resolveStorePath } from "../../config/sessions/paths.js";
import {
  resolveChannelResetConfig,
  resolveSessionResetPolicy,
  resolveSessionResetType,
  resolveThreadFlag,
} from "../../config/sessions/reset.js";
import { resolveAndPersistSessionFile } from "../../config/sessions/session-file.js";
import { resolveSessionKey } from "../../config/sessions/session-key.js";
import { loadSessionStore } from "../../config/sessions/store.js";
import {
  DEFAULT_RESET_TRIGGERS,
  type GroupKeyResolution,
  type SessionEntry,
  type SessionScope,
} from "../../config/sessions/types.js";
import { createSubsystemLogger } from "../../logging/subsystem.js";
import { getGlobalHookRunner } from "../../plugins/hook-runner-global.js";
import { normalizeMainKey } from "../../routing/session-key.js";
import { resolveSessionResetEntryState } from "../../sessions/runtime/reset-entry-state.js";
import { emitSessionRolloverHooks } from "../../sessions/runtime/reset-lifecycle.js";
import { planSessionReset } from "../../sessions/runtime/reset-plan.js";
import { isInternalMessageChannel } from "../../utils/message-channel.js";
import { resolveCommandAuthorization } from "../command-auth.js";
import type { MsgContext, TemplateContext } from "../templating.js";
import { normalizeInboundTextNewlines } from "./inbound-text.js";
import { stripMentions, stripStructuralPrefixes } from "./mentions.js";
import { maybeRetireLegacyMainDeliveryRoute } from "./session-delivery.js";
import { buildSessionEntryState } from "./session-entry-state.js";
import { finalizeSessionInitState } from "./session-finalize.js";
import { forkSessionFromParent, resolveParentForkMaxTokens } from "./session-fork.js";
import { resolveSessionTargetContext } from "./session-target-context.js";

const log = createSubsystemLogger("session-init");

export type SessionInitResult = {
  sessionCtx: TemplateContext;
  sessionEntry: SessionEntry;
  previousSessionEntry?: SessionEntry;
  sessionStore: Record<string, SessionEntry>;
  sessionKey: string;
  sessionId: string;
  isNewSession: boolean;
  resetTriggered: boolean;
  systemSent: boolean;
  abortedLastRun: boolean;
  storePath: string;
  sessionScope: SessionScope;
  groupResolution?: GroupKeyResolution;
  isGroup: boolean;
  bodyStripped?: string;
  triggerBodyNormalized: string;
};

function isResetAuthorizedForContext(params: {
  ctx: MsgContext;
  cfg: CrawClawConfig;
  commandAuthorized: boolean;
}): boolean {
  const auth = resolveCommandAuthorization(params);
  if (!params.commandAuthorized && !auth.isAuthorizedSender) {
    return false;
  }
  const provider = params.ctx.Provider;
  const internalGatewayCaller = provider
    ? isInternalMessageChannel(provider)
    : isInternalMessageChannel(params.ctx.Surface);
  if (!internalGatewayCaller) {
    return true;
  }
  const scopes = params.ctx.GatewayClientScopes;
  if (!Array.isArray(scopes) || scopes.length === 0) {
    return true;
  }
  return scopes.includes("operator.admin");
}

export async function initSessionState(params: {
  ctx: MsgContext;
  cfg: CrawClawConfig;
  commandAuthorized: boolean;
}): Promise<SessionInitResult> {
  const { ctx, cfg, commandAuthorized } = params;
  const targetContext = resolveSessionTargetContext({ cfg, ctx });
  const sessionCtxForState = targetContext.sessionCtxForState;
  const sessionCfg = cfg.session;
  const mainKey = normalizeMainKey(sessionCfg?.mainKey);
  const agentId = resolveSessionAgentId({
    sessionKey: sessionCtxForState.SessionKey,
    config: cfg,
  });
  const groupResolution = resolveGroupSessionKey(sessionCtxForState) ?? undefined;
  const resetTriggers = (
    sessionCfg?.resetTriggers?.length ? sessionCfg.resetTriggers : DEFAULT_RESET_TRIGGERS
  ).filter((trigger) => trigger.trim().toLowerCase() !== "/reset");
  const parentForkMaxTokens = resolveParentForkMaxTokens(cfg);
  const sessionScope = sessionCfg?.scope ?? "per-sender";
  const storePath = resolveStorePath(sessionCfg?.store, { agentId });
  const ingressTimingEnabled = process.env.CRAWCLAW_DEBUG_INGRESS_TIMING === "1";

  // CRITICAL: Skip cache to ensure fresh data when resolving session identity.
  // Stale cache (especially with multiple gateway processes or on Windows where
  // mtime granularity may miss rapid writes) can cause incorrect sessionId
  // generation, leading to orphaned transcript files. See #17971.
  const sessionStoreLoadStartMs = ingressTimingEnabled ? Date.now() : 0;
  const sessionStore: Record<string, SessionEntry> = loadSessionStore(storePath, {
    skipCache: true,
  });
  if (ingressTimingEnabled) {
    log.info(
      `session-init store-load agent=${agentId} session=${sessionCtxForState.SessionKey ?? "(no-session)"} ` +
        `elapsedMs=${Date.now() - sessionStoreLoadStartMs} path=${storePath}`,
    );
  }
  let sessionKey: string | undefined;
  let sessionEntry: SessionEntry;

  let sessionId: string;
  let isNewSession = false;
  let bodyStripped: string | undefined;
  let systemSent = false;
  let abortedLastRun = false;
  let resetTriggered = false;

  const normalizedChatType = normalizeChatType(ctx.ChatType);
  const isGroup =
    normalizedChatType != null && normalizedChatType !== "direct" ? true : Boolean(groupResolution);
  // Prefer CommandBody/RawBody (clean message) for command detection; fall back
  // to Body which may contain structural context (history, sender labels).
  const commandSource = ctx.BodyForCommands ?? ctx.CommandBody ?? ctx.RawBody ?? ctx.Body ?? "";
  // IMPORTANT: do NOT lowercase the entire command body.
  // Users often pass case-sensitive arguments (e.g. filesystem paths on Linux).
  // Command parsing downstream lowercases only the command token for matching.
  const triggerBodyNormalized = stripStructuralPrefixes(commandSource).trim();

  // Use CommandBody/RawBody for reset trigger matching (clean message without structural context).
  const rawBody = commandSource;
  const trimmedBody = rawBody.trim();
  const resetAuthorized = isResetAuthorizedForContext({
    ctx,
    cfg,
    commandAuthorized,
  });
  // Timestamp/message prefixes (e.g. "[Dec 4 17:35] ") are added by the
  // web inbox before we get here. They prevented reset triggers like "/new"
  // from matching, so strip structural wrappers when checking for resets.
  const strippedForReset = isGroup
    ? stripMentions(triggerBodyNormalized, ctx, cfg, agentId)
    : triggerBodyNormalized;
  const shouldUseAcpInPlaceReset = targetContext.shouldUseAcpInPlaceReset;
  // Canonicalize so the written key matches what all read paths produce.
  // resolveSessionKey uses DEFAULT_AGENT_ID="main"; the configured default
  // agent may differ, causing key mismatch and orphaned sessions (#29683).
  sessionKey = canonicalizeMainSessionAlias({
    cfg,
    agentId,
    sessionKey: resolveSessionKey(sessionScope, sessionCtxForState, mainKey),
  });
  const retiredLegacyMainDelivery = maybeRetireLegacyMainDeliveryRoute({
    sessionCfg,
    sessionKey,
    sessionStore,
    agentId,
    mainKey,
    isGroup,
    ctx,
  });
  if (retiredLegacyMainDelivery) {
    sessionStore[retiredLegacyMainDelivery.key] = retiredLegacyMainDelivery.entry;
  }
  const entry = sessionStore[sessionKey];
  const now = Date.now();
  const isThread = resolveThreadFlag({
    sessionKey,
    messageThreadId: ctx.MessageThreadId,
    threadLabel: ctx.ThreadLabel,
    threadStarterBody: ctx.ThreadStarterBody,
    parentSessionKey: ctx.ParentSessionKey,
  });
  const resetType = resolveSessionResetType({ sessionKey, isGroup, isThread });
  const channelReset = resolveChannelResetConfig({
    sessionCfg,
    channel:
      groupResolution?.channel ??
      (ctx.OriginatingChannel as string | undefined) ??
      ctx.Surface ??
      ctx.Provider,
  });
  const resetPolicy = resolveSessionResetPolicy({
    sessionCfg,
    resetType,
    resetOverride: channelReset,
  });
  // Heartbeat, cron-event, and exec-event runs should NEVER trigger session resets.
  // These are automated system events, not user interactions that should affect
  // session continuity. Forcing freshEntry=true prevents accidental data loss.
  // See #58409 for details on silent session reset bug.
  const isSystemEvent =
    ctx.Provider === "heartbeat" || ctx.Provider === "cron-event" || ctx.Provider === "exec-event";
  const resetPlan = planSessionReset({
    resetTriggers,
    resetAuthorized,
    trimmedBody,
    strippedForReset,
    shouldUseAcpInPlaceReset,
    entry,
    now,
    resetPolicy,
    isSystemEvent,
  });
  resetTriggered = resetPlan.resetTriggered;
  bodyStripped = resetPlan.bodyStripped;
  // Capture the current session entry before any reset so its transcript can be
  // archived afterward. We need to do this for explicit /new resets
  // and for scheduled/daily resets where the session has become stale (!freshEntry).
  // Without this, daily-reset transcripts are left as orphaned files on disk (#35481).
  const previousSessionEntry = resetPlan.previousSessionEntry;
  clearBootstrapSnapshotOnSessionRollover({
    sessionKey,
    previousSessionId: previousSessionEntry?.sessionId,
  });

  const resetEntryState = resolveSessionResetEntryState({
    entry,
    resetPlan,
  });
  sessionId = resetEntryState.sessionId;
  isNewSession = resetEntryState.isNewSession;
  systemSent = resetEntryState.systemSent;
  abortedLastRun = resetEntryState.abortedLastRun;
  sessionEntry = buildSessionEntryState({
    ctx: sessionCtxForState,
    sessionKey,
    groupResolution,
    baseEntry: resetEntryState.baseEntry,
    resetCarryOver: resetEntryState.resetCarryOver,
    sessionId,
    systemSent,
    abortedLastRun,
    isThread,
  });
  const parentSessionKey = ctx.ParentSessionKey?.trim();
  const alreadyForked = sessionEntry.forkedFromParent === true;
  if (
    parentSessionKey &&
    parentSessionKey !== sessionKey &&
    sessionStore[parentSessionKey] &&
    !alreadyForked
  ) {
    const parentTokens = sessionStore[parentSessionKey].totalTokens ?? 0;
    if (parentForkMaxTokens > 0 && parentTokens > parentForkMaxTokens) {
      // Parent context is too large — forking would create a thread session
      // that immediately overflows the model's context window. Start fresh
      // instead and mark as forked to prevent re-attempts. See #26905.
      log.warn(
        `skipping parent fork (parent too large): parentKey=${parentSessionKey} → sessionKey=${sessionKey} ` +
          `parentTokens=${parentTokens} maxTokens=${parentForkMaxTokens}`,
      );
      sessionEntry.forkedFromParent = true;
    } else {
      log.warn(
        `forking from parent session: parentKey=${parentSessionKey} → sessionKey=${sessionKey} ` +
          `parentTokens=${parentTokens}`,
      );
      const forked = await forkSessionFromParent({
        parentEntry: sessionStore[parentSessionKey],
        agentId,
        sessionsDir: path.dirname(storePath),
      });
      if (forked) {
        sessionId = forked.sessionId;
        sessionEntry.sessionId = forked.sessionId;
        sessionEntry.sessionFile = forked.sessionFile;
        sessionEntry.forkedFromParent = true;
        log.warn(`forked session created: file=${forked.sessionFile}`);
      }
    }
  }
  const fallbackSessionFile = !sessionEntry.sessionFile
    ? resolveSessionTranscriptPath(sessionEntry.sessionId, agentId, ctx.MessageThreadId)
    : undefined;
  const resolvedSessionFile = await resolveAndPersistSessionFile({
    sessionId: sessionEntry.sessionId,
    sessionKey,
    sessionStore,
    storePath,
    sessionEntry,
    agentId,
    sessionsDir: path.dirname(storePath),
    fallbackSessionFile,
    activeSessionKey: sessionKey,
  });
  sessionEntry = resolvedSessionFile.sessionEntry;
  sessionEntry = await finalizeSessionInitState({
    cfg,
    sessionStore,
    sessionKey,
    sessionEntry,
    storePath,
    retiredLegacyMainDelivery: retiredLegacyMainDelivery ?? undefined,
    previousSessionEntry,
    agentId,
    isNewSession,
  });

  const sessionCtx: TemplateContext = {
    ...ctx,
    // Keep BodyStripped aligned with Body (best default for agent prompts).
    // RawBody is reserved for command/directive parsing and may omit context.
    BodyStripped: normalizeInboundTextNewlines(
      bodyStripped ??
        ctx.BodyForAgent ??
        ctx.Body ??
        ctx.CommandBody ??
        ctx.RawBody ??
        ctx.BodyForCommands ??
        "",
    ),
    SessionId: sessionId,
    IsNewSession: isNewSession ? "true" : "false",
  };

  // Run session plugin hooks (fire-and-forget)
  const hookRunner = getGlobalHookRunner();
  emitSessionRolloverHooks({
    hookRunner: hookRunner ?? undefined,
    isNewSession,
    sessionId: sessionId ?? "",
    previousSessionId: previousSessionEntry?.sessionId,
    sessionKey,
    cfg,
  });

  return {
    sessionCtx,
    sessionEntry,
    previousSessionEntry,
    sessionStore,
    sessionKey,
    sessionId,
    isNewSession,
    resetTriggered,
    systemSent,
    abortedLastRun,
    storePath,
    sessionScope,
    groupResolution,
    isGroup,
    bodyStripped,
    triggerBodyNormalized,
  };
}
