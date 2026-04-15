export type {
  AgentToAgentPolicy,
  SessionAccessAction,
  SessionAccessResult,
  SessionToolsVisibility,
} from "./sessions-access.js";
import type {
  AgentToAgentPolicy,
  SessionAccessAction,
  SessionToolsVisibility,
} from "./sessions-access.js";
export {
  createAgentToAgentPolicy,
  createSessionVisibilityGuard,
  resolveEffectiveSessionToolsVisibility,
  resolveSandboxSessionToolsVisibility,
  resolveSandboxedSessionToolContext,
  resolveSessionToolsVisibility,
} from "./sessions-access.js";
import {
  createAgentToAgentPolicy,
  createSessionVisibilityGuard,
  resolveEffectiveSessionToolsVisibility,
  resolveSandboxedSessionToolContext,
} from "./sessions-access.js";
export type { SessionReferenceResolution } from "./sessions-resolution.js";
export {
  isRequesterSpawnedSessionVisible,
  isResolvedSessionVisibleToRequester,
  listSpawnedSessionKeys,
  looksLikeSessionId,
  looksLikeSessionKey,
  resolveDisplaySessionKey,
  resolveInternalSessionKey,
  resolveMainSessionAlias,
  resolveSessionReference,
  resolveVisibleSessionReference,
  shouldResolveSessionIdInput,
  shouldVerifyRequesterSpawnedSessionVisibility,
} from "./sessions-resolution.js";
import { resolveSessionReference, resolveVisibleSessionReference } from "./sessions-resolution.js";
import { type CrawClawConfig, loadConfig } from "../../config/config.js";
import {
  DEFAULT_AGENT_ID,
  normalizeAgentId,
  parseAgentSessionKey,
} from "../../routing/session-key.js";
import { extractTextFromChatContent } from "../../shared/chat-content.js";
import { sanitizeUserFacingText } from "../pi-embedded-helpers.js";
import {
  stripDowngradedToolCallText,
  stripMinimaxToolCallXml,
  stripModelSpecialTokens,
  stripThinkingTagsFromText,
} from "../pi-embedded-utils.js";

export type SessionKind = "main" | "group" | "cron" | "hook" | "node" | "other";

export type SessionListDeliveryContext = {
  channel?: string;
  to?: string;
  accountId?: string;
  threadId?: string | number;
};

export type SessionRunStatus = "running" | "done" | "failed" | "killed" | "timeout";

export type SessionListRow = {
  key: string;
  kind: SessionKind;
  channel: string;
  origin?: {
    provider?: string;
    accountId?: string;
  };
  spawnedBy?: string;
  label?: string;
  displayName?: string;
  parentSessionKey?: string;
  deliveryContext?: SessionListDeliveryContext;
  updatedAt?: number | null;
  sessionId?: string;
  model?: string;
  contextTokens?: number | null;
  totalTokens?: number | null;
  estimatedCostUsd?: number;
  status?: SessionRunStatus;
  startedAt?: number;
  endedAt?: number;
  runtimeMs?: number;
  childSessions?: string[];
  thinkingLevel?: string;
  fastMode?: boolean;
  verboseLevel?: string;
  reasoningLevel?: string;
  elevatedLevel?: string;
  responseUsage?: string;
  systemSent?: boolean;
  abortedLastRun?: boolean;
  sendPolicy?: string;
  lastChannel?: string;
  lastTo?: string;
  lastAccountId?: string;
  transcriptPath?: string;
  messages?: unknown[];
};

export type AccessibleSessionReference =
  | {
      ok: true;
      key: string;
      displayKey: string;
    }
  | {
      ok: false;
      status: "error" | "forbidden";
      error: string;
      displayKey?: string;
    };

function normalizeKey(value?: string) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export function resolveSessionToolContext(opts?: {
  agentSessionKey?: string;
  sandboxed?: boolean;
  config?: CrawClawConfig;
}) {
  const cfg = opts?.config ?? loadConfig();
  return {
    cfg,
    ...resolveSandboxedSessionToolContext({
      cfg,
      agentSessionKey: opts?.agentSessionKey,
      sandboxed: opts?.sandboxed,
    }),
  };
}

export function resolveRequesterAgentContext(opts?: {
  agentSessionKey?: string;
  sandboxed?: boolean;
  config?: CrawClawConfig;
  requesterAgentIdOverride?: string;
}) {
  const context = resolveSessionToolContext(opts);
  const requesterAgentId = normalizeAgentId(
    opts?.requesterAgentIdOverride ??
      parseAgentSessionKey(context.requesterInternalKey ?? context.alias)?.agentId ??
      DEFAULT_AGENT_ID,
  );
  return {
    ...context,
    requesterAgentId,
  };
}

export async function resolveAccessibleSessionReference(params: {
  sessionKey: string;
  action: SessionAccessAction;
  alias: string;
  mainKey: string;
  requesterSessionKey: string;
  restrictToSpawned: boolean;
  visibility: SessionToolsVisibility;
  a2aPolicy: AgentToAgentPolicy;
}): Promise<AccessibleSessionReference> {
  const resolvedSession = await resolveSessionReference({
    sessionKey: params.sessionKey,
    alias: params.alias,
    mainKey: params.mainKey,
    requesterInternalKey: params.requesterSessionKey,
    restrictToSpawned: params.restrictToSpawned,
  });
  if (!resolvedSession.ok) {
    return resolvedSession;
  }

  const visibleSession = await resolveVisibleSessionReference({
    resolvedSession,
    requesterSessionKey: params.requesterSessionKey,
    restrictToSpawned: params.restrictToSpawned,
    visibilitySessionKey: params.sessionKey,
  });
  if (!visibleSession.ok) {
    return visibleSession;
  }

  const visibilityGuard = await createSessionVisibilityGuard({
    action: params.action,
    requesterSessionKey: params.requesterSessionKey,
    visibility: params.visibility,
    a2aPolicy: params.a2aPolicy,
  });
  const access = visibilityGuard.check(visibleSession.key);
  if (!access.allowed) {
    return {
      ok: false as const,
      status: access.status,
      error: access.error,
      displayKey: visibleSession.displayKey,
    };
  }

  return visibleSession;
}

export function resolveSessionAccessPolicies(params: {
  cfg: CrawClawConfig;
  sandboxed?: boolean;
}) {
  return {
    a2aPolicy: createAgentToAgentPolicy(params.cfg),
    visibility: resolveEffectiveSessionToolsVisibility({
      cfg: params.cfg,
      sandboxed: params.sandboxed === true,
    }),
  };
}

export function classifySessionKind(params: {
  key: string;
  gatewayKind?: string | null;
  alias: string;
  mainKey: string;
}): SessionKind {
  const key = params.key;
  if (key === params.alias || key === params.mainKey) {
    return "main";
  }
  if (key.startsWith("cron:")) {
    return "cron";
  }
  if (key.startsWith("hook:")) {
    return "hook";
  }
  if (key.startsWith("node-") || key.startsWith("node:")) {
    return "node";
  }
  if (params.gatewayKind === "group") {
    return "group";
  }
  if (key.includes(":group:") || key.includes(":channel:")) {
    return "group";
  }
  return "other";
}

export function deriveChannel(params: {
  key: string;
  kind: SessionKind;
  channel?: string | null;
  lastChannel?: string | null;
}): string {
  if (params.kind === "cron" || params.kind === "hook" || params.kind === "node") {
    return "internal";
  }
  const channel = normalizeKey(params.channel ?? undefined);
  if (channel) {
    return channel;
  }
  const lastChannel = normalizeKey(params.lastChannel ?? undefined);
  if (lastChannel) {
    return lastChannel;
  }
  const parts = params.key.split(":").filter(Boolean);
  if (parts.length >= 3 && (parts[1] === "group" || parts[1] === "channel")) {
    return parts[0];
  }
  return "unknown";
}

export function stripToolMessages(messages: unknown[]): unknown[] {
  return messages.filter((msg) => {
    if (!msg || typeof msg !== "object") {
      return true;
    }
    const role = (msg as { role?: unknown }).role;
    return role !== "toolResult" && role !== "tool";
  });
}

/**
 * Sanitize text content to strip tool call markers and thinking tags.
 * This ensures user-facing text doesn't leak internal tool representations.
 */
export function sanitizeTextContent(text: string): string {
  if (!text) {
    return text;
  }
  return stripThinkingTagsFromText(
    stripDowngradedToolCallText(stripModelSpecialTokens(stripMinimaxToolCallXml(text))),
  );
}

export function extractAssistantText(message: unknown): string | undefined {
  if (!message || typeof message !== "object") {
    return undefined;
  }
  if ((message as { role?: unknown }).role !== "assistant") {
    return undefined;
  }
  const content = (message as { content?: unknown }).content;
  if (!Array.isArray(content)) {
    return undefined;
  }
  const joined =
    extractTextFromChatContent(content, {
      sanitizeText: sanitizeTextContent,
      joinWith: "",
      normalizeText: (text) => text.trim(),
    }) ?? "";
  const stopReason = (message as { stopReason?: unknown }).stopReason;
  // Gate on stopReason only — a non-error response with a stale/background errorMessage
  // should not have its content rewritten with error templates (#13935).
  const errorContext = stopReason === "error";

  return joined ? sanitizeUserFacingText(joined, { errorContext }) : undefined;
}
