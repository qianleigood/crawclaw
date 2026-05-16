import { resolveSessionAgentId } from "../../agents/agent-scope.js";
import type { CrawClawConfig } from "../../config/config.js";

export type SessionToolCallPreflightContext = {
  sessionId: string;
  sessionKey: string;
  agentId: string;
};

function buildSessionToolCallPreflightContext(params: {
  sessionId: string;
  sessionKey: string;
  cfg: CrawClawConfig;
}): SessionToolCallPreflightContext {
  return {
    sessionId: params.sessionId,
    sessionKey: params.sessionKey,
    agentId: resolveSessionAgentId({ sessionKey: params.sessionKey, config: params.cfg }),
  };
}

export function buildSessionStartHookPayload(params: {
  sessionId: string;
  sessionKey: string;
  cfg: CrawClawConfig;
  resumedFrom?: string;
}): {
  event: { sessionId: string; sessionKey: string; resumedFrom?: string };
  context: SessionToolCallPreflightContext;
} {
  return {
    event: {
      sessionId: params.sessionId,
      sessionKey: params.sessionKey,
      resumedFrom: params.resumedFrom,
    },
    context: buildSessionToolCallPreflightContext({
      sessionId: params.sessionId,
      sessionKey: params.sessionKey,
      cfg: params.cfg,
    }),
  };
}

export function buildSessionEndHookPayload(params: {
  sessionId: string;
  sessionKey: string;
  cfg: CrawClawConfig;
  messageCount?: number;
}): {
  event: { sessionId: string; sessionKey: string; messageCount: number };
  context: SessionToolCallPreflightContext;
} {
  return {
    event: {
      sessionId: params.sessionId,
      sessionKey: params.sessionKey,
      messageCount: params.messageCount ?? 0,
    },
    context: buildSessionToolCallPreflightContext({
      sessionId: params.sessionId,
      sessionKey: params.sessionKey,
      cfg: params.cfg,
    }),
  };
}
