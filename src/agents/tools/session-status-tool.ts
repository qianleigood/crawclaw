import { Type } from "@sinclair/typebox";
import type { CrawClawConfig } from "../../config/config.js";
import {
  loadSessionStore,
  resolveStorePath,
  type SessionEntry,
} from "../../config/sessions.js";
import {
  buildAgentMainSessionKey,
  parseAgentSessionKey,
  resolveAgentIdFromSessionKey,
} from "../../routing/session-key.js";
import { resolveDefaultModelForAgent } from "../model-selection.js";
import type { AnyAgentTool } from "./common.js";
import { readStringParam } from "./common.js";
import {
  applySessionStatusModelOverride,
  buildSessionStatusResult,
  buildSessionStatusText,
  resolveSessionEntry,
  resolveStoreScopedRequesterKey,
} from "./session-status-tool-ops.js";
import {
  createSessionVisibilityGuard,
  shouldResolveSessionIdInput,
  resolveSessionAccessPolicies,
  resolveInternalSessionKey,
  resolveSessionReference,
  resolveVisibleSessionReference,
  resolveSessionToolContext,
} from "./sessions-helpers.js";

const SessionStatusToolSchema = Type.Object({
  sessionKey: Type.Optional(Type.String()),
  model: Type.Optional(Type.String()),
});

export function createSessionStatusTool(opts?: {
  agentSessionKey?: string;
  config?: CrawClawConfig;
  sandboxed?: boolean;
}): AnyAgentTool {
  return {
    label: "Session Status",
    name: "session_status",
    description:
      "Show a /status-equivalent session status card (usage + time + cost when available), including linked background task context when present. Use for model-use questions (📊 session_status). Optional: set per-session model override (model=default resets overrides).",
    parameters: SessionStatusToolSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const { cfg, mainKey, alias, effectiveRequesterKey } = resolveSessionToolContext(opts);
      const { a2aPolicy, visibility } = resolveSessionAccessPolicies({
        cfg,
        sandboxed: opts?.sandboxed,
      });
      const requesterAgentId = resolveAgentIdFromSessionKey(
        opts?.agentSessionKey ?? effectiveRequesterKey,
      );
      const visibilityRequesterKey = (opts?.agentSessionKey ?? effectiveRequesterKey).trim();
      const usesLegacyMainAlias = alias === mainKey;
      const isLegacyMainVisibilityKey = (sessionKey: string) => {
        const trimmed = sessionKey.trim();
        return usesLegacyMainAlias && (trimmed === "main" || trimmed === mainKey);
      };
      const resolveVisibilityMainSessionKey = (sessionAgentId: string) => {
        const requesterParsed = parseAgentSessionKey(visibilityRequesterKey);
        if (
          resolveAgentIdFromSessionKey(visibilityRequesterKey) === sessionAgentId &&
          (requesterParsed?.rest === mainKey || isLegacyMainVisibilityKey(visibilityRequesterKey))
        ) {
          return visibilityRequesterKey;
        }
        return buildAgentMainSessionKey({
          agentId: sessionAgentId,
          mainKey,
        });
      };
      const normalizeVisibilityTargetSessionKey = (sessionKey: string, sessionAgentId: string) => {
        const trimmed = sessionKey.trim();
        if (!trimmed) {
          return trimmed;
        }
        if (trimmed.startsWith("agent:")) {
          const parsed = parseAgentSessionKey(trimmed);
          if (parsed?.rest === mainKey) {
            return resolveVisibilityMainSessionKey(sessionAgentId);
          }
          return trimmed;
        }
        // Preserve legacy bare main keys for requester tree checks.
        if (isLegacyMainVisibilityKey(trimmed)) {
          return resolveVisibilityMainSessionKey(sessionAgentId);
        }
        return trimmed;
      };
      const visibilityGuard = await createSessionVisibilityGuard({
        action: "status",
        requesterSessionKey: visibilityRequesterKey,
        visibility,
        a2aPolicy,
      });

      const requestedKeyParam = readStringParam(params, "sessionKey");
      let requestedKeyRaw = requestedKeyParam ?? opts?.agentSessionKey;
      const requestedKeyInput = requestedKeyRaw?.trim() ?? "";
      let resolvedViaSessionId = false;
      if (!requestedKeyRaw?.trim()) {
        throw new Error("sessionKey required");
      }
      const ensureAgentAccess = (targetAgentId: string) => {
        if (targetAgentId === requesterAgentId) {
          return;
        }
        // Gate cross-agent access behind tools.agentToAgent settings.
        if (!a2aPolicy.enabled) {
          throw new Error(
            "Agent-to-agent status is disabled. Set tools.agentToAgent.enabled=true to allow cross-agent access.",
          );
        }
        if (!a2aPolicy.isAllowed(requesterAgentId, targetAgentId)) {
          throw new Error("Agent-to-agent session status denied by tools.agentToAgent.allow.");
        }
      };

      if (requestedKeyRaw.startsWith("agent:")) {
        const requestedAgentId = resolveAgentIdFromSessionKey(requestedKeyRaw);
        ensureAgentAccess(requestedAgentId);
        const access = visibilityGuard.check(
          normalizeVisibilityTargetSessionKey(requestedKeyRaw, requestedAgentId),
        );
        if (!access.allowed) {
          throw new Error(access.error);
        }
      }

      const isExplicitAgentKey = requestedKeyRaw.startsWith("agent:");
      let agentId = isExplicitAgentKey
        ? resolveAgentIdFromSessionKey(requestedKeyRaw)
        : requesterAgentId;
      let storePath = resolveStorePath(cfg.session?.store, { agentId });
      let store = loadSessionStore(storePath);
      let storeScopedRequesterKey = resolveStoreScopedRequesterKey({
        requesterKey: effectiveRequesterKey,
        agentId,
        mainKey,
      });

      // Resolve against the requester-scoped store first to avoid leaking default agent data.
      let resolved = resolveSessionEntry({
        store,
        keyRaw: requestedKeyRaw,
        alias,
        mainKey,
        requesterInternalKey: storeScopedRequesterKey,
        includeAliasFallback: requestedKeyRaw !== "current",
      });

      if (
        !resolved &&
        (requestedKeyRaw === "current" || shouldResolveSessionIdInput(requestedKeyRaw))
      ) {
        const resolvedSession = await resolveSessionReference({
          sessionKey: requestedKeyRaw,
          alias,
          mainKey,
          requesterInternalKey: effectiveRequesterKey,
          restrictToSpawned: opts?.sandboxed === true,
        });
        if (resolvedSession.ok && resolvedSession.resolvedViaSessionId) {
          const visibleSession = await resolveVisibleSessionReference({
            resolvedSession,
            requesterSessionKey: effectiveRequesterKey,
            restrictToSpawned: opts?.sandboxed === true,
            visibilitySessionKey: requestedKeyRaw,
          });
          if (!visibleSession.ok) {
            throw new Error("Session status visibility is restricted to the current session tree.");
          }
          // If resolution points at another agent, enforce A2A policy before switching stores.
          ensureAgentAccess(resolveAgentIdFromSessionKey(visibleSession.key));
          resolvedViaSessionId = true;
          requestedKeyRaw = visibleSession.key;
          agentId = resolveAgentIdFromSessionKey(visibleSession.key);
          storePath = resolveStorePath(cfg.session?.store, { agentId });
          store = loadSessionStore(storePath);
          storeScopedRequesterKey = resolveStoreScopedRequesterKey({
            requesterKey: effectiveRequesterKey,
            agentId,
            mainKey,
          });
          resolved = resolveSessionEntry({
            store,
            keyRaw: requestedKeyRaw,
            alias,
            mainKey,
            requesterInternalKey: storeScopedRequesterKey,
          });
        } else if (!resolvedSession.ok && opts?.sandboxed === true) {
          throw new Error("Session status visibility is restricted to the current session tree.");
        }
      }

      if (!resolved && requestedKeyRaw === "current") {
        resolved = resolveSessionEntry({
          store,
          keyRaw: requestedKeyRaw,
          alias,
          mainKey,
          requesterInternalKey: storeScopedRequesterKey,
          includeAliasFallback: true,
        });
      }

      if (!resolved) {
        const kind = shouldResolveSessionIdInput(requestedKeyRaw) ? "sessionId" : "sessionKey";
        throw new Error(`Unknown ${kind}: ${requestedKeyRaw}`);
      }

      // Preserve caller-scoped raw-key/current lookups as "self" for visibility checks.
      const visibilityTargetKey =
        !resolvedViaSessionId &&
        (requestedKeyInput === "current" || resolved.key === requestedKeyInput)
          ? visibilityRequesterKey
          : normalizeVisibilityTargetSessionKey(resolved.key, agentId);
      const access = visibilityGuard.check(visibilityTargetKey);
      if (!access.allowed) {
        throw new Error(access.error);
      }

      const configured = resolveDefaultModelForAgent({ cfg, agentId });
      const modelRaw = readStringParam(params, "model");
      let changedModel = false;
      if (typeof modelRaw === "string") {
        changedModel = await applySessionStatusModelOverride({
          cfg,
          modelRaw,
          resolved,
          agentId,
          store,
          storePath,
          configured,
        });
      }
      const fullStatusText = await buildSessionStatusText({
        cfg,
        resolved,
        agentId,
        storePath,
        visibilityRequesterKey,
      });
      return buildSessionStatusResult({
        resolvedKey: resolved.key,
        changedModel,
        statusText: fullStatusText,
      });
    },
  };
}
