import { Type } from "@sinclair/typebox";
import type { CrawClawConfig } from "../../config/config.js";
import { callGateway } from "../../gateway/call.js";
import type { AnyAgentTool } from "./common.js";
import { jsonResult, readStringParam } from "./common.js";
import { processSessionsHistoryMessages } from "./sessions-history-tool-ops.js";
import {
  resolveAccessibleSessionReference,
  resolveSessionAccessPolicies,
  resolveSessionToolContext,
  stripToolMessages,
} from "./sessions-helpers.js";

const SessionsHistoryToolSchema = Type.Object({
  sessionKey: Type.String(),
  limit: Type.Optional(Type.Number({ minimum: 1 })),
  includeTools: Type.Optional(Type.Boolean()),
});

const SESSIONS_HISTORY_MAX_BYTES = 80 * 1024;
type GatewayCaller = typeof callGateway;

export function createSessionsHistoryTool(opts?: {
  agentSessionKey?: string;
  sandboxed?: boolean;
  config?: CrawClawConfig;
  callGateway?: GatewayCaller;
}): AnyAgentTool {
  return {
    label: "Session History",
    name: "sessions_history",
    description: "Fetch message history for a session.",
    parameters: SessionsHistoryToolSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const gatewayCall = opts?.callGateway ?? callGateway;
      const sessionKeyParam = readStringParam(params, "sessionKey", {
        required: true,
      });
      const { cfg, mainKey, alias, effectiveRequesterKey, restrictToSpawned } =
        resolveSessionToolContext(opts);
      const { a2aPolicy, visibility } = resolveSessionAccessPolicies({
        cfg,
        sandboxed: opts?.sandboxed,
      });
      const visibleSession = await resolveAccessibleSessionReference({
        sessionKey: sessionKeyParam,
        action: "history",
        alias,
        mainKey,
        restrictToSpawned,
        requesterSessionKey: effectiveRequesterKey,
        visibility,
        a2aPolicy,
      });
      if (!visibleSession.ok) {
        return jsonResult({
          status: visibleSession.status,
          error: visibleSession.error,
        });
      }
      // From here on, use the canonical key (sessionId inputs already resolved).
      const resolvedKey = visibleSession.key;
      const displayKey = visibleSession.displayKey;

      const limit =
        typeof params.limit === "number" && Number.isFinite(params.limit)
          ? Math.max(1, Math.floor(params.limit))
          : undefined;
      const includeTools = Boolean(params.includeTools);
      const result = await gatewayCall<{ messages: Array<unknown> }>({
        method: "chat.history",
        params: { sessionKey: resolvedKey, limit },
      });
      const rawMessages = Array.isArray(result?.messages) ? result.messages : [];
      const selectedMessages = includeTools ? rawMessages : stripToolMessages(rawMessages);
      const processed = processSessionsHistoryMessages({
        messages: selectedMessages,
        maxBytes: SESSIONS_HISTORY_MAX_BYTES,
      });
      return jsonResult({
        sessionKey: displayKey,
        messages: processed.messages,
        truncated: processed.truncated,
        droppedMessages: processed.droppedMessages,
        contentTruncated: processed.contentTruncated,
        contentRedacted: processed.contentRedacted,
        bytes: processed.bytes,
      });
    },
  };
}
