import type { AgentMessage } from "@mariozechner/pi-agent-core";
import {
  buildSpecialAgentCacheEnvelope,
  type SpecialAgentParentForkContext,
} from "../../agents/special/runtime/parent-fork-context.js";
import type { GmMessageRow } from "../types/runtime.ts";

export type ManualSessionSummaryRefreshContext = {
  recentMessages: AgentMessage[];
  currentTokenCount: number;
  lastModelVisibleMessageId: string | null;
  parentForkContext?: SpecialAgentParentForkContext;
};

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function estimateContentTokens(text: string): number {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return 0;
  }
  return Math.max(1, Math.ceil(normalized.length / 4));
}

function rowToModelVisibleMessage(row: GmMessageRow): AgentMessage | null {
  if (row.role !== "user" && row.role !== "assistant") {
    return null;
  }
  const content = normalizeText(row.contentText) || normalizeText(row.content);
  if (!content) {
    return null;
  }
  return {
    id: row.id,
    role: row.role,
    content,
    timestamp: row.createdAt,
  } as AgentMessage;
}

export function buildManualSessionSummaryRefreshContext(params: {
  sessionId: string;
  rows: GmMessageRow[];
}): ManualSessionSummaryRefreshContext {
  const recentMessages = params.rows
    .map(rowToModelVisibleMessage)
    .filter((message): message is AgentMessage => Boolean(message));
  const currentTokenCount = recentMessages.reduce((sum, message) => {
    const content = (message as { content?: unknown }).content;
    return sum + estimateContentTokens(typeof content === "string" ? content : "");
  }, 0);
  const lastModelVisibleMessageId =
    (recentMessages.at(-1) as { id?: string } | undefined)?.id ?? null;

  if (!recentMessages.length) {
    return {
      recentMessages,
      currentTokenCount,
      lastModelVisibleMessageId,
    };
  }

  return {
    recentMessages,
    currentTokenCount,
    lastModelVisibleMessageId,
    parentForkContext: {
      parentRunId: `manual-session-summary:${params.sessionId}`,
      provider: "manual",
      modelId: "session-summary-refresh",
      promptEnvelope: buildSpecialAgentCacheEnvelope({
        systemPromptText:
          "Manual session summary refresh reconstructed from persisted model-visible conversation.",
        toolNames: [],
        toolPromptPayload: [],
        thinkingConfig: {},
        forkContextMessages: recentMessages,
      }),
    },
  };
}
