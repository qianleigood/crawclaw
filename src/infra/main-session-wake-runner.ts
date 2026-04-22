import fs from "node:fs/promises";
import path from "node:path";
import {
  hasOutboundReplyContent,
  resolveSendableOutboundReplyParts,
} from "crawclaw/plugin-sdk/reply-payload";
import { resolveAgentConfig, resolveDefaultAgentId } from "../agents/agent-scope.js";
import { appendCronStyleCurrentTimeLine } from "../agents/current-time.js";
import { resolveEffectiveMessagesConfig } from "../agents/identity.js";
import { resolveHeartbeatReplyPayload } from "../auto-reply/heartbeat-reply-payload.js";
import {
  DEFAULT_HEARTBEAT_ACK_MAX_CHARS,
  resolveHeartbeatPrompt as resolveMainSessionWakePromptText,
  stripHeartbeatToken,
} from "../auto-reply/heartbeat.js";
import { getReplyFromConfig } from "../auto-reply/reply.js";
import { HEARTBEAT_TOKEN } from "../auto-reply/tokens.js";
import type { ReplyPayload } from "../auto-reply/types.js";
import { getChannelPlugin } from "../channels/plugins/index.js";
import type { ChannelMainSessionWakeDeps } from "../channels/plugins/types.js";
import type { CrawClawConfig } from "../config/config.js";
import { loadConfig } from "../config/config.js";
import {
  canonicalizeMainSessionAlias,
  loadSessionStore,
  resolveAgentIdFromSessionKey,
  resolveAgentMainSessionKey,
  resolveSessionFilePath,
  resolveStorePath,
  saveSessionStore,
  updateSessionStore,
} from "../config/sessions.js";
import type { AgentDefaultsConfig } from "../config/types.agent-defaults.js";
import { resolveCronSession } from "../cron/isolated-agent/session.js";
import { createSubsystemLogger } from "../logging/subsystem.js";
import { getQueueSize } from "../process/command-queue.js";
import { CommandLane } from "../process/lanes.js";
import {
  normalizeAgentId,
  parseAgentSessionKey,
  toAgentStoreSessionKey,
} from "../routing/session-key.js";
import { defaultRuntime, type RuntimeEnv } from "../runtime.js";
import { escapeRegExp } from "../utils.js";
import { formatErrorMessage } from "./errors.js";
import {
  buildExecEventPrompt,
  buildCronEventPrompt,
  isActionableSystemEvent,
  isCronSystemEvent,
  isExecCompletionEvent,
} from "./main-session-wake-events-filter.js";
import { emitMainSessionWakeEvent, resolveIndicatorType } from "./main-session-wake-events.js";
import { resolveMainSessionWakeReasonKind } from "./main-session-wake-reason.js";
import {
  resolveMainSessionWakeSummaryForAgent,
  type MainSessionWakeSummary,
} from "./main-session-wake-summary.js";
import { resolveMainSessionWakeVisibility } from "./main-session-wake-visibility.js";
import {
  type MainSessionWakeRunResult,
  type MainSessionWakeHandler,
  setMainSessionWakeHandler,
} from "./main-session-wake.js";
import type { OutboundSendDeps } from "./outbound/deliver.js";
import { deliverOutboundPayloads } from "./outbound/deliver.js";
import { buildOutboundSessionContext } from "./outbound/session-context.js";
import {
  resolveHeartbeatDeliveryTarget,
  resolveHeartbeatSenderContext,
} from "./outbound/targets.js";
import {
  drainSystemEventEntries,
  peekSystemEventEntries,
  resolveSystemEventDeliveryContext,
} from "./system-events.js";

export type MainSessionWakeDeps = OutboundSendDeps &
  ChannelMainSessionWakeDeps & {
    runtime?: RuntimeEnv;
    getQueueSize?: (lane?: string) => number;
    nowMs?: () => number;
  };

const log = createSubsystemLogger("gateway/main-session-wake");

export { areMainSessionWakesAvailable } from "./main-session-wake.js";
export {
  resolveMainSessionWakeSummaryForAgent,
  type MainSessionWakeSummary,
} from "./main-session-wake-summary.js";

type MainSessionWakeConfig = AgentDefaultsConfig["heartbeat"];
type MainSessionWakeAgent = {
  agentId: string;
  heartbeat?: MainSessionWakeConfig;
};

export { isCronSystemEvent };

type MainSessionWakeAgentState = {
  agentId: string;
  heartbeat?: MainSessionWakeConfig;
};

export type MainSessionWakeRunner = {
  stop: () => void;
  updateConfig: (cfg: CrawClawConfig) => void;
};

function resolveMainSessionWakeConfig(
  cfg: CrawClawConfig,
  agentId?: string,
): MainSessionWakeConfig | undefined {
  const defaults = cfg.agents?.defaults?.heartbeat;
  if (!agentId) {
    return defaults;
  }
  const overrides = resolveAgentConfig(cfg, agentId)?.heartbeat;
  if (!defaults && !overrides) {
    return overrides;
  }
  return { ...defaults, ...overrides };
}

function resolveMainSessionWakeAgents(cfg: CrawClawConfig): MainSessionWakeAgent[] {
  const seen = new Set<string>();
  const agents: MainSessionWakeAgent[] = [];
  const appendAgent = (agentId: string) => {
    const normalized = normalizeAgentId(agentId);
    if (!normalized || seen.has(normalized)) {
      return;
    }
    seen.add(normalized);
    agents.push({ agentId: normalized, heartbeat: resolveMainSessionWakeConfig(cfg, normalized) });
  };
  appendAgent(resolveDefaultAgentId(cfg));
  for (const entry of cfg.agents?.list ?? []) {
    if (entry?.id) {
      appendAgent(entry.id);
    }
  }
  return agents;
}

export function resolveMainSessionWakePrompt(
  cfg: CrawClawConfig,
  heartbeat?: MainSessionWakeConfig,
) {
  return resolveMainSessionWakePromptText(
    heartbeat?.prompt ?? cfg.agents?.defaults?.heartbeat?.prompt,
  );
}

function resolveMainSessionWakeAckMaxChars(cfg: CrawClawConfig, heartbeat?: MainSessionWakeConfig) {
  return Math.max(
    0,
    heartbeat?.ackMaxChars ??
      cfg.agents?.defaults?.heartbeat?.ackMaxChars ??
      DEFAULT_HEARTBEAT_ACK_MAX_CHARS,
  );
}

function resolveMainSessionWakeSession(
  cfg: CrawClawConfig,
  agentId?: string,
  heartbeat?: MainSessionWakeConfig,
  forcedSessionKey?: string,
) {
  const sessionCfg = cfg.session;
  const scope = sessionCfg?.scope ?? "per-sender";
  const resolvedAgentId = normalizeAgentId(agentId ?? resolveDefaultAgentId(cfg));
  const mainSessionKey =
    scope === "global" ? "global" : resolveAgentMainSessionKey({ cfg, agentId: resolvedAgentId });
  const storeAgentId = scope === "global" ? resolveDefaultAgentId(cfg) : resolvedAgentId;
  const storePath = resolveStorePath(sessionCfg?.store, {
    agentId: storeAgentId,
  });
  const store = loadSessionStore(storePath);
  const mainEntry = store[mainSessionKey];

  if (scope === "global") {
    return { sessionKey: mainSessionKey, storePath, store, entry: mainEntry };
  }

  const forced = forcedSessionKey?.trim();
  if (forced) {
    const forcedCandidate = toAgentStoreSessionKey({
      agentId: resolvedAgentId,
      requestKey: forced,
      mainKey: cfg.session?.mainKey,
    });
    const forcedCanonical = canonicalizeMainSessionAlias({
      cfg,
      agentId: resolvedAgentId,
      sessionKey: forcedCandidate,
    });
    if (forcedCanonical !== "global") {
      const sessionAgentId = resolveAgentIdFromSessionKey(forcedCanonical);
      if (sessionAgentId === normalizeAgentId(resolvedAgentId)) {
        return {
          sessionKey: forcedCanonical,
          storePath,
          store,
          entry: store[forcedCanonical],
        };
      }
    }
  }

  const trimmed = heartbeat?.session?.trim() ?? "";
  if (!trimmed) {
    return { sessionKey: mainSessionKey, storePath, store, entry: mainEntry };
  }

  const normalized = trimmed.toLowerCase();
  if (normalized === "main" || normalized === "global") {
    return { sessionKey: mainSessionKey, storePath, store, entry: mainEntry };
  }

  const candidate = toAgentStoreSessionKey({
    agentId: resolvedAgentId,
    requestKey: trimmed,
    mainKey: cfg.session?.mainKey,
  });
  const canonical = canonicalizeMainSessionAlias({
    cfg,
    agentId: resolvedAgentId,
    sessionKey: candidate,
  });
  if (canonical !== "global") {
    const sessionAgentId = resolveAgentIdFromSessionKey(canonical);
    if (sessionAgentId === normalizeAgentId(resolvedAgentId)) {
      return {
        sessionKey: canonical,
        storePath,
        store,
        entry: store[canonical],
      };
    }
  }

  return { sessionKey: mainSessionKey, storePath, store, entry: mainEntry };
}

function resolveHeartbeatReasoningPayloads(
  replyResult: ReplyPayload | ReplyPayload[] | undefined,
): ReplyPayload[] {
  const payloads = Array.isArray(replyResult) ? replyResult : replyResult ? [replyResult] : [];
  return payloads.filter((payload) => {
    const text = typeof payload.text === "string" ? payload.text : "";
    return text.trimStart().startsWith("Reasoning:");
  });
}

async function restoreMainSessionWakeUpdatedAt(params: {
  storePath: string;
  sessionKey: string;
  updatedAt?: number;
}) {
  const { storePath, sessionKey, updatedAt } = params;
  if (typeof updatedAt !== "number") {
    return;
  }
  const store = loadSessionStore(storePath);
  const entry = store[sessionKey];
  if (!entry) {
    return;
  }
  const nextUpdatedAt = Math.max(entry.updatedAt ?? 0, updatedAt);
  if (entry.updatedAt === nextUpdatedAt) {
    return;
  }
  await updateSessionStore(storePath, (nextStore) => {
    const nextEntry = nextStore[sessionKey] ?? entry;
    if (!nextEntry) {
      return;
    }
    const resolvedUpdatedAt = Math.max(nextEntry.updatedAt ?? 0, updatedAt);
    if (nextEntry.updatedAt === resolvedUpdatedAt) {
      return;
    }
    nextStore[sessionKey] = { ...nextEntry, updatedAt: resolvedUpdatedAt };
  });
}

/**
 * Prune wake transcript entries by truncating the file back to a previous size.
 * This removes the user+assistant turns written during HEARTBEAT_OK acknowledgements,
 * preventing context pollution from zero-information exchanges.
 */
async function pruneMainSessionWakeTranscript(params: {
  transcriptPath?: string;
  preWakeSize?: number;
}) {
  const { transcriptPath, preWakeSize } = params;
  if (!transcriptPath || typeof preWakeSize !== "number" || preWakeSize < 0) {
    return;
  }
  try {
    const stat = await fs.stat(transcriptPath);
    // Only truncate if the file has grown during the wake run.
    if (stat.size > preWakeSize) {
      await fs.truncate(transcriptPath, preWakeSize);
    }
  } catch {
    // File may not exist or may have been removed - ignore errors
  }
}

/**
 * Get the transcript file path and its current size before a wake run.
 * Returns undefined values if the session or transcript doesn't exist yet.
 */
async function captureTranscriptState(params: {
  storePath: string;
  sessionKey: string;
  agentId?: string;
}): Promise<{ transcriptPath?: string; preWakeSize?: number }> {
  const { storePath, sessionKey, agentId } = params;
  try {
    const store = loadSessionStore(storePath);
    const entry = store[sessionKey];
    if (!entry?.sessionId) {
      return {};
    }
    const transcriptPath = resolveSessionFilePath(entry.sessionId, entry, {
      agentId,
      sessionsDir: path.dirname(storePath),
    });
    const stat = await fs.stat(transcriptPath);
    return { transcriptPath, preWakeSize: stat.size };
  } catch {
    // Session or transcript doesn't exist yet - nothing to prune
    return {};
  }
}

function stripLeadingHeartbeatResponsePrefix(
  text: string,
  responsePrefix: string | undefined,
): string {
  const normalizedPrefix = responsePrefix?.trim();
  if (!normalizedPrefix) {
    return text;
  }

  // Require a boundary after the configured prefix so short prefixes like "Hi"
  // do not strip the beginning of normal words like "History".
  const prefixPattern = new RegExp(
    `^${escapeRegExp(normalizedPrefix)}(?=$|\\s|[\\p{P}\\p{S}])\\s*`,
    "iu",
  );
  return text.replace(prefixPattern, "");
}

function normalizeHeartbeatReply(
  payload: ReplyPayload,
  responsePrefix: string | undefined,
  ackMaxChars: number,
) {
  const rawText = typeof payload.text === "string" ? payload.text : "";
  const textForStrip = stripLeadingHeartbeatResponsePrefix(rawText, responsePrefix);
  const stripped = stripHeartbeatToken(textForStrip, {
    mode: "heartbeat",
    maxAckChars: ackMaxChars,
  });
  const hasMedia = resolveSendableOutboundReplyParts(payload).hasMedia;
  if (stripped.shouldSkip && !hasMedia) {
    return {
      shouldSkip: true,
      text: "",
      hasMedia,
    };
  }
  let finalText = stripped.text;
  if (responsePrefix && finalText && !finalText.startsWith(responsePrefix)) {
    finalText = `${responsePrefix} ${finalText}`;
  }
  return { shouldSkip: false, text: finalText, hasMedia };
}

type MainSessionWakeReasonFlags = {
  isExecEventReason: boolean;
  isCronEventReason: boolean;
  isWakeReason: boolean;
  isEventDrivenReason: boolean;
};

type MainSessionWakePreflight = MainSessionWakeReasonFlags & {
  session: ReturnType<typeof resolveMainSessionWakeSession>;
  pendingEventEntries: ReturnType<typeof peekSystemEventEntries>;
  actionableEventEntries: ReturnType<typeof peekSystemEventEntries>;
  turnSourceDeliveryContext: ReturnType<typeof resolveSystemEventDeliveryContext>;
  hasTaggedCronEvents: boolean;
  shouldInspectPendingEvents: boolean;
};

function resolveMainSessionWakeReasonFlags(reason?: string): MainSessionWakeReasonFlags {
  const reasonKind = resolveMainSessionWakeReasonKind(reason);
  const isExecEventReason = reasonKind === "exec-event";
  const isCronEventReason = reasonKind === "cron";
  const isWakeReason = reasonKind === "wake" || reasonKind === "hook" || reasonKind === "manual";
  return {
    isExecEventReason,
    isCronEventReason,
    isWakeReason,
    isEventDrivenReason: isExecEventReason || isCronEventReason || isWakeReason,
  };
}

async function resolveMainSessionWakePreflight(params: {
  cfg: CrawClawConfig;
  agentId: string;
  heartbeat?: MainSessionWakeConfig;
  forcedSessionKey?: string;
  reason?: string;
}): Promise<MainSessionWakePreflight> {
  const reasonFlags = resolveMainSessionWakeReasonFlags(params.reason);
  const session = resolveMainSessionWakeSession(
    params.cfg,
    params.agentId,
    params.heartbeat,
    params.forcedSessionKey,
  );
  const pendingEventEntries = peekSystemEventEntries(session.sessionKey);
  const actionableEventEntries = pendingEventEntries.filter((event) =>
    isActionableSystemEvent(event.text),
  );
  const turnSourceDeliveryContext = resolveSystemEventDeliveryContext(actionableEventEntries);
  const hasTaggedCronEvents = actionableEventEntries.some((event) =>
    event.contextKey?.startsWith("cron:"),
  );
  const hasActionableEvents = actionableEventEntries.length > 0;
  const shouldInspectPendingEvents = reasonFlags.isEventDrivenReason || hasActionableEvents;
  return {
    ...reasonFlags,
    session,
    pendingEventEntries,
    actionableEventEntries,
    turnSourceDeliveryContext,
    hasTaggedCronEvents,
    shouldInspectPendingEvents,
  } satisfies MainSessionWakePreflight;
}

type MainSessionWakePromptResolution = {
  prompt: string;
  hasExecCompletion: boolean;
  hasCronEvents: boolean;
  hasSystemEvents: boolean;
};

function buildSystemEventPrompt(params: { deliverToUser: boolean }): string {
  return [
    "Review the queued system events for this session.",
    params.deliverToUser
      ? "If a user-facing follow-up is needed, reply with a concise update."
      : "Handle any relevant internal follow-up in the session.",
    "Do not use legacy heartbeat acknowledgement tokens.",
  ].join(" ");
}

function resolveMainSessionWakeRunPrompt(params: {
  cfg: CrawClawConfig;
  heartbeat?: MainSessionWakeConfig;
  preflight: MainSessionWakePreflight;
  canRelayToUser: boolean;
}): MainSessionWakePromptResolution {
  const pendingEventEntries = params.preflight.actionableEventEntries;
  const pendingEvents = params.preflight.shouldInspectPendingEvents
    ? pendingEventEntries.map((event) => event.text)
    : [];
  const cronEvents = pendingEventEntries
    .filter(
      (event) =>
        (params.preflight.isCronEventReason || event.contextKey?.startsWith("cron:")) &&
        isCronSystemEvent(event.text),
    )
    .map((event) => event.text);
  const hasExecCompletion = pendingEvents.some(isExecCompletionEvent);
  const hasCronEvents = cronEvents.length > 0;
  const hasSystemEvents = pendingEventEntries.length > 0;
  const basePrompt = hasExecCompletion
    ? buildExecEventPrompt({ deliverToUser: params.canRelayToUser })
    : hasCronEvents
      ? buildCronEventPrompt(cronEvents, { deliverToUser: params.canRelayToUser })
      : params.preflight.isEventDrivenReason && hasSystemEvents
        ? buildSystemEventPrompt({ deliverToUser: params.canRelayToUser })
        : resolveMainSessionWakePrompt(params.cfg, params.heartbeat);
  return { prompt: basePrompt, hasExecCompletion, hasCronEvents, hasSystemEvents };
}

export async function runMainSessionWakeOnce(opts: {
  cfg?: CrawClawConfig;
  agentId?: string;
  sessionKey?: string;
  heartbeat?: MainSessionWakeConfig;
  reason?: string;
  deps?: MainSessionWakeDeps;
}): Promise<MainSessionWakeRunResult> {
  const cfg = opts.cfg ?? loadConfig();
  const explicitAgentId = typeof opts.agentId === "string" ? opts.agentId.trim() : "";
  const forcedSessionAgentId =
    explicitAgentId.length > 0 ? undefined : parseAgentSessionKey(opts.sessionKey)?.agentId;
  const agentId = normalizeAgentId(
    explicitAgentId || forcedSessionAgentId || resolveDefaultAgentId(cfg),
  );
  const heartbeat = opts.heartbeat ?? resolveMainSessionWakeConfig(cfg, agentId);
  const startedAt = opts.deps?.nowMs?.() ?? Date.now();

  const queueSize = (opts.deps?.getQueueSize ?? getQueueSize)(CommandLane.Main);
  if (queueSize > 0) {
    return { status: "skipped", reason: "requests-in-flight" };
  }

  // Preflight centralizes trigger classification, event inspection, and HEARTBEAT.md gating.
  const preflight = await resolveMainSessionWakePreflight({
    cfg,
    agentId,
    heartbeat,
    forcedSessionKey: opts.sessionKey,
    reason: opts.reason,
  });
  const isMainSessionWake =
    preflight.isEventDrivenReason || preflight.actionableEventEntries.length > 0;
  if (!isMainSessionWake) {
    return { status: "skipped", reason: "disabled" };
  } else if (preflight.actionableEventEntries.length === 0) {
    if (preflight.pendingEventEntries.length > 0) {
      drainSystemEventEntries(preflight.session.sessionKey);
    }
    return { status: "skipped", reason: "no-system-events" };
  }
  const { entry, sessionKey, storePath } = preflight.session;
  const previousUpdatedAt = entry?.updatedAt;

  // When isolatedSession is enabled, create a fresh session via the same
  // pattern as cron sessionTarget: "isolated". This gives the wake
  // a new session ID (empty transcript) each run, avoiding the cost of
  // sending the full conversation history (~100K tokens) to the LLM.
  // Delivery routing still uses the main session entry (lastChannel, lastTo).
  const useIsolatedSession = heartbeat?.isolatedSession === true;
  let runSessionKey = sessionKey;
  let runStorePath = storePath;
  if (useIsolatedSession) {
    const isolatedKey = `${sessionKey}:heartbeat`;
    const cronSession = resolveCronSession({
      cfg,
      sessionKey: isolatedKey,
      agentId,
      nowMs: startedAt,
      forceNew: true,
    });
    cronSession.store[isolatedKey] = cronSession.sessionEntry;
    await saveSessionStore(cronSession.storePath, cronSession.store);
    runSessionKey = isolatedKey;
    runStorePath = cronSession.storePath;
  }

  const delivery = resolveHeartbeatDeliveryTarget({
    cfg,
    entry,
    heartbeat,
    // Isolated wake runs drain system events from their dedicated
    // `:heartbeat` session, not from the base session we peek during preflight.
    // Reusing base-session turnSource routing here can pin later isolated runs
    // to stale channels/threads because that base-session event context remains queued.
    turnSource: useIsolatedSession ? undefined : preflight.turnSourceDeliveryContext,
  });
  const heartbeatAccountId = heartbeat?.accountId?.trim();
  if (delivery.reason === "unknown-account") {
    log.warn("main-session wake: unknown accountId", {
      accountId: delivery.accountId ?? heartbeatAccountId ?? null,
      target: heartbeat?.target ?? "none",
    });
  } else if (heartbeatAccountId) {
    log.info("main-session wake: using explicit accountId", {
      accountId: delivery.accountId ?? heartbeatAccountId,
      target: heartbeat?.target ?? "none",
      channel: delivery.channel,
    });
  }
  const visibility =
    delivery.channel !== "none"
      ? resolveMainSessionWakeVisibility({
          cfg,
          channel: delivery.channel,
          accountId: delivery.accountId,
        })
      : { showOk: false, showAlerts: true, useIndicator: true };
  const { sender } = resolveHeartbeatSenderContext({ cfg, entry, delivery });
  const responsePrefix = resolveEffectiveMessagesConfig(cfg, agentId, {
    channel: delivery.channel !== "none" ? delivery.channel : undefined,
    accountId: delivery.accountId,
  }).responsePrefix;

  const canRelayToUser = Boolean(
    delivery.channel !== "none" && delivery.to && visibility.showAlerts,
  );
  const { prompt, hasExecCompletion, hasCronEvents, hasSystemEvents } =
    resolveMainSessionWakeRunPrompt({
      cfg,
      heartbeat,
      preflight,
      canRelayToUser,
    });
  const ctx = {
    Body: appendCronStyleCurrentTimeLine(prompt, cfg, startedAt),
    From: sender,
    To: sender,
    OriginatingChannel: delivery.channel !== "none" ? delivery.channel : undefined,
    OriginatingTo: delivery.to,
    AccountId: delivery.accountId,
    MessageThreadId: delivery.threadId,
    Provider: hasExecCompletion
      ? "exec-event"
      : hasCronEvents
        ? "cron-event"
        : hasSystemEvents && preflight.isEventDrivenReason
          ? "system-event"
          : "heartbeat",
    SessionKey: runSessionKey,
    ForceSenderIsOwnerFalse: hasExecCompletion,
  };
  if (!visibility.showAlerts && !visibility.showOk && !visibility.useIndicator) {
    emitMainSessionWakeEvent({
      status: "skipped",
      reason: "alerts-disabled",
      durationMs: Date.now() - startedAt,
      channel: delivery.channel !== "none" ? delivery.channel : undefined,
      accountId: delivery.accountId,
    });
    return { status: "skipped", reason: "alerts-disabled" };
  }

  const heartbeatOkText = responsePrefix ? `${responsePrefix} ${HEARTBEAT_TOKEN}` : HEARTBEAT_TOKEN;
  const outboundSession = buildOutboundSessionContext({
    cfg,
    agentId,
    sessionKey,
  });
  const canAttemptHeartbeatOk = Boolean(
    visibility.showOk && delivery.channel !== "none" && delivery.to,
  );
  const maybeSendHeartbeatOk = async () => {
    if (!canAttemptHeartbeatOk || delivery.channel === "none" || !delivery.to) {
      return false;
    }
    const heartbeatPlugin = getChannelPlugin(delivery.channel);
    if (heartbeatPlugin?.heartbeat?.checkReady) {
      const readiness = await heartbeatPlugin.heartbeat.checkReady({
        cfg,
        accountId: delivery.accountId,
        deps: opts.deps,
      });
      if (!readiness.ok) {
        return false;
      }
    }
    await deliverOutboundPayloads({
      cfg,
      channel: delivery.channel,
      to: delivery.to,
      accountId: delivery.accountId,
      threadId: delivery.threadId,
      payloads: [{ text: heartbeatOkText }],
      session: outboundSession,
      deps: opts.deps,
    });
    return true;
  };

  try {
    // Capture transcript state before the wake run so we can prune if HEARTBEAT_OK.
    // For isolated sessions, capture the isolated transcript (not the main session's).
    const transcriptState = await captureTranscriptState({
      storePath: runStorePath,
      sessionKey: runSessionKey,
      agentId,
    });

    const heartbeatModelOverride = heartbeat?.model?.trim() || undefined;
    const suppressToolErrorWarnings = heartbeat?.suppressToolErrorWarnings === true;
    const bootstrapContextMode: "lightweight" | undefined =
      heartbeat?.lightContext === true ? "lightweight" : undefined;
    const replyOpts = heartbeatModelOverride
      ? {
          isHeartbeat: true,
          heartbeatModelOverride,
          suppressToolErrorWarnings,
          bootstrapContextMode,
        }
      : { isHeartbeat: true, suppressToolErrorWarnings, bootstrapContextMode };
    const replyResult = await getReplyFromConfig(ctx, replyOpts, cfg);
    const replyPayload = resolveHeartbeatReplyPayload(replyResult);
    const includeReasoning = heartbeat?.includeReasoning === true;
    const reasoningPayloads = includeReasoning
      ? resolveHeartbeatReasoningPayloads(replyResult).filter((payload) => payload !== replyPayload)
      : [];

    if (!replyPayload || !hasOutboundReplyContent(replyPayload)) {
      await restoreMainSessionWakeUpdatedAt({
        storePath,
        sessionKey,
        updatedAt: previousUpdatedAt,
      });
      // Prune the transcript to remove HEARTBEAT_OK turns
      await pruneMainSessionWakeTranscript(transcriptState);
      const okSent = await maybeSendHeartbeatOk();
      emitMainSessionWakeEvent({
        status: "ok-empty",
        reason: opts.reason,
        durationMs: Date.now() - startedAt,
        channel: delivery.channel !== "none" ? delivery.channel : undefined,
        accountId: delivery.accountId,
        silent: !okSent,
        indicatorType: visibility.useIndicator ? resolveIndicatorType("ok-empty") : undefined,
      });
      return { status: "ran", durationMs: Date.now() - startedAt };
    }

    const ackMaxChars = resolveMainSessionWakeAckMaxChars(cfg, heartbeat);
    const normalized = normalizeHeartbeatReply(replyPayload, responsePrefix, ackMaxChars);
    // For exec completion events, don't skip even if the response looks like HEARTBEAT_OK.
    // The model should be responding with exec results, not ack tokens.
    // Also, if normalized.text is empty due to token stripping but we have exec completion,
    // fall back to the original reply text.
    const execFallbackText =
      hasExecCompletion && !normalized.text.trim() && replyPayload.text?.trim()
        ? replyPayload.text.trim()
        : null;
    if (execFallbackText) {
      normalized.text = execFallbackText;
      normalized.shouldSkip = false;
    }
    const shouldSkipMain = normalized.shouldSkip && !normalized.hasMedia && !hasExecCompletion;
    if (shouldSkipMain && reasoningPayloads.length === 0) {
      await restoreMainSessionWakeUpdatedAt({
        storePath,
        sessionKey,
        updatedAt: previousUpdatedAt,
      });
      // Prune the transcript to remove HEARTBEAT_OK turns
      await pruneMainSessionWakeTranscript(transcriptState);
      const okSent = await maybeSendHeartbeatOk();
      emitMainSessionWakeEvent({
        status: "ok-token",
        reason: opts.reason,
        durationMs: Date.now() - startedAt,
        channel: delivery.channel !== "none" ? delivery.channel : undefined,
        accountId: delivery.accountId,
        silent: !okSent,
        indicatorType: visibility.useIndicator ? resolveIndicatorType("ok-token") : undefined,
      });
      return { status: "ran", durationMs: Date.now() - startedAt };
    }

    const mediaUrls = resolveSendableOutboundReplyParts(replyPayload).mediaUrls;

    // Suppress duplicate wake payloads within a short window.
    // This prevents "nagging" when nothing changed but the model repeats the same items.
    const prevHeartbeatText =
      typeof entry?.lastHeartbeatText === "string" ? entry.lastHeartbeatText : "";
    const prevHeartbeatAt =
      typeof entry?.lastHeartbeatSentAt === "number" ? entry.lastHeartbeatSentAt : undefined;
    const isDuplicateMain =
      !shouldSkipMain &&
      !mediaUrls.length &&
      Boolean(prevHeartbeatText.trim()) &&
      normalized.text.trim() === prevHeartbeatText.trim() &&
      typeof prevHeartbeatAt === "number" &&
      startedAt - prevHeartbeatAt < 24 * 60 * 60 * 1000;

    if (isDuplicateMain) {
      await restoreMainSessionWakeUpdatedAt({
        storePath,
        sessionKey,
        updatedAt: previousUpdatedAt,
      });
      // Prune the transcript to remove duplicate wake turns.
      await pruneMainSessionWakeTranscript(transcriptState);
      emitMainSessionWakeEvent({
        status: "skipped",
        reason: "duplicate",
        preview: normalized.text.slice(0, 200),
        durationMs: Date.now() - startedAt,
        hasMedia: false,
        channel: delivery.channel !== "none" ? delivery.channel : undefined,
        accountId: delivery.accountId,
      });
      return { status: "ran", durationMs: Date.now() - startedAt };
    }

    // Reasoning payloads are text-only; any attachments stay on the main reply.
    const previewText = shouldSkipMain
      ? reasoningPayloads
          .map((payload) => payload.text)
          .filter((text): text is string => Boolean(text?.trim()))
          .join("\n")
      : normalized.text;

    if (delivery.channel === "none" || !delivery.to) {
      emitMainSessionWakeEvent({
        status: "skipped",
        reason: delivery.reason ?? "no-target",
        preview: previewText?.slice(0, 200),
        durationMs: Date.now() - startedAt,
        hasMedia: mediaUrls.length > 0,
        accountId: delivery.accountId,
      });
      return { status: "ran", durationMs: Date.now() - startedAt };
    }

    if (!visibility.showAlerts) {
      await restoreMainSessionWakeUpdatedAt({
        storePath,
        sessionKey,
        updatedAt: previousUpdatedAt,
      });
      emitMainSessionWakeEvent({
        status: "skipped",
        reason: "alerts-disabled",
        preview: previewText?.slice(0, 200),
        durationMs: Date.now() - startedAt,
        channel: delivery.channel,
        hasMedia: mediaUrls.length > 0,
        accountId: delivery.accountId,
        indicatorType: visibility.useIndicator ? resolveIndicatorType("sent") : undefined,
      });
      return { status: "ran", durationMs: Date.now() - startedAt };
    }

    const deliveryAccountId = delivery.accountId;
    const heartbeatPlugin = getChannelPlugin(delivery.channel);
    if (heartbeatPlugin?.heartbeat?.checkReady) {
      const readiness = await heartbeatPlugin.heartbeat.checkReady({
        cfg,
        accountId: deliveryAccountId,
        deps: opts.deps,
      });
      if (!readiness.ok) {
        emitMainSessionWakeEvent({
          status: "skipped",
          reason: readiness.reason,
          preview: previewText?.slice(0, 200),
          durationMs: Date.now() - startedAt,
          hasMedia: mediaUrls.length > 0,
          channel: delivery.channel,
          accountId: delivery.accountId,
        });
        log.info("main-session wake: channel not ready", {
          channel: delivery.channel,
          reason: readiness.reason,
        });
        return { status: "skipped", reason: readiness.reason };
      }
    }

    await deliverOutboundPayloads({
      cfg,
      channel: delivery.channel,
      to: delivery.to,
      accountId: deliveryAccountId,
      session: outboundSession,
      threadId: delivery.threadId,
      payloads: [
        ...reasoningPayloads,
        ...(shouldSkipMain
          ? []
          : [
              {
                text: normalized.text,
                mediaUrls,
              },
            ]),
      ],
      deps: opts.deps,
    });

    // Record last delivered wake payload for dedupe.
    if (!shouldSkipMain && normalized.text.trim()) {
      const store = loadSessionStore(storePath);
      const current = store[sessionKey];
      if (current) {
        store[sessionKey] = {
          ...current,
          lastHeartbeatText: normalized.text,
          lastHeartbeatSentAt: startedAt,
        };
        await saveSessionStore(storePath, store);
      }
    }

    emitMainSessionWakeEvent({
      status: "sent",
      to: delivery.to,
      preview: previewText?.slice(0, 200),
      durationMs: Date.now() - startedAt,
      hasMedia: mediaUrls.length > 0,
      channel: delivery.channel,
      accountId: delivery.accountId,
      indicatorType: visibility.useIndicator ? resolveIndicatorType("sent") : undefined,
    });
    return { status: "ran", durationMs: Date.now() - startedAt };
  } catch (err) {
    const reason = formatErrorMessage(err);
    emitMainSessionWakeEvent({
      status: "failed",
      reason,
      durationMs: Date.now() - startedAt,
      channel: delivery.channel !== "none" ? delivery.channel : undefined,
      accountId: delivery.accountId,
      indicatorType: visibility.useIndicator ? resolveIndicatorType("failed") : undefined,
    });
    log.error(`main-session wake failed: ${reason}`, { error: reason });
    return { status: "failed", reason };
  }
}

export function startMainSessionWakeRunner(opts: {
  cfg?: CrawClawConfig;
  runtime?: RuntimeEnv;
  abortSignal?: AbortSignal;
  runOnce?: typeof runMainSessionWakeOnce;
}): MainSessionWakeRunner {
  const runtime = opts.runtime ?? defaultRuntime;
  const runOnce = opts.runOnce ?? runMainSessionWakeOnce;
  const state = {
    cfg: opts.cfg ?? loadConfig(),
    runtime,
    agents: new Map<string, MainSessionWakeAgentState>(),
    timer: null as NodeJS.Timeout | null,
    stopped: false,
  };
  let initialized = false;

  const scheduleNext = () => {
    if (state.timer) {
      clearTimeout(state.timer);
      state.timer = null;
    }
  };

  const updateConfig = (cfg: CrawClawConfig) => {
    if (state.stopped) {
      return;
    }
    const nextAgents = new Map<string, MainSessionWakeAgentState>();
    for (const agent of resolveMainSessionWakeAgents(cfg)) {
      nextAgents.set(agent.agentId, {
        agentId: agent.agentId,
        heartbeat: agent.heartbeat,
      });
    }

    state.cfg = cfg;
    state.agents = nextAgents;
    if (!initialized) {
      log.info("main-session wake runner: started", { agents: nextAgents.size });
      initialized = true;
    }

    scheduleNext();
  };

  const run: MainSessionWakeHandler = async (params) => {
    if (state.stopped) {
      return {
        status: "skipped",
        reason: "disabled",
      } satisfies MainSessionWakeRunResult;
    }
    if (state.agents.size === 0) {
      return {
        status: "skipped",
        reason: "disabled",
      } satisfies MainSessionWakeRunResult;
    }

    const reason = params?.reason;
    const requestedAgentId = params?.agentId ? normalizeAgentId(params.agentId) : undefined;
    const requestedSessionKey = params?.sessionKey?.trim() || undefined;
    const isInterval = reason === "interval";
    const startedAt = Date.now();
    // Track requests-in-flight so we can skip re-arm in finally — the wake
    // layer handles retry for this case (DEFAULT_RETRY_MS = 1 s).
    let requestsInFlight = false;

    try {
      if (isInterval) {
        return { status: "skipped", reason: "disabled" };
      }
      if (requestedSessionKey || requestedAgentId) {
        const targetAgentId =
          requestedAgentId ??
          resolveAgentIdFromSessionKey(requestedSessionKey) ??
          resolveDefaultAgentId(state.cfg);
        const targetAgent = state.agents.get(targetAgentId) ?? {
          agentId: targetAgentId,
          heartbeat: resolveMainSessionWakeConfig(state.cfg, targetAgentId),
        };
        if (!targetAgent) {
          return { status: "skipped", reason: "disabled" };
        }
        try {
          const res = await runOnce({
            cfg: state.cfg,
            agentId: targetAgent.agentId,
            heartbeat: targetAgent.heartbeat,
            reason,
            sessionKey: requestedSessionKey,
            deps: { runtime: state.runtime },
          });
          return res.status === "ran" ? { status: "ran", durationMs: Date.now() - startedAt } : res;
        } catch (err) {
          const errMsg = formatErrorMessage(err);
          log.error(`main-session wake runner: targeted runOnce threw unexpectedly: ${errMsg}`, {
            error: errMsg,
          });
          return { status: "failed", reason: errMsg };
        }
      }

      const defaultAgentId = resolveDefaultAgentId(state.cfg);
      const defaultAgent = state.agents.get(defaultAgentId) ?? {
        agentId: defaultAgentId,
        heartbeat: resolveMainSessionWakeConfig(state.cfg, defaultAgentId),
      };
      try {
        const res = await runOnce({
          cfg: state.cfg,
          agentId: defaultAgent.agentId,
          heartbeat: defaultAgent.heartbeat,
          reason,
          deps: { runtime: state.runtime },
        });
        if (res.status === "skipped" && res.reason === "requests-in-flight") {
          requestsInFlight = true;
        }
        return res.status === "ran" ? { status: "ran", durationMs: Date.now() - startedAt } : res;
      } catch (err) {
        const errMsg = formatErrorMessage(err);
        log.error(`main-session wake runner: runOnce threw unexpectedly: ${errMsg}`, {
          error: errMsg,
        });
        return { status: "failed", reason: errMsg };
      }
    } finally {
      // No periodic timer is re-armed. The wake layer handles explicit retries
      // for requests-in-flight via schedule(DEFAULT_RETRY_MS).
      if (!requestsInFlight) {
        scheduleNext();
      }
    }
  };

  const wakeHandler: MainSessionWakeHandler = async (params) =>
    run({
      reason: params.reason,
      agentId: params.agentId,
      sessionKey: params.sessionKey,
    });
  const disposeWakeHandler = setMainSessionWakeHandler(wakeHandler);
  updateConfig(state.cfg);

  const cleanup = () => {
    if (state.stopped) {
      return;
    }
    state.stopped = true;
    disposeWakeHandler();
    if (state.timer) {
      clearTimeout(state.timer);
    }
    state.timer = null;
  };

  opts.abortSignal?.addEventListener("abort", cleanup, { once: true });

  return { stop: cleanup, updateConfig };
}
