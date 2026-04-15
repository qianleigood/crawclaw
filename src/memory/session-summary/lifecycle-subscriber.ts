import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type { RunLoopLifecycleEvent } from "../../agents/runtime/lifecycle/types.js";
import {
  createRunLoopLifecycleRegistration,
  createSharedLifecycleSubscriberAccessor,
} from "../../agents/special/runtime/lifecycle-subscriber.js";
import { resolveAgentIdFromSessionKey } from "../../routing/session-key.js";
import { isSubagentSessionKey } from "../../sessions/session-key-utils.ts";
import { estimateConversationMessageTokens } from "../context/assembly.ts";
import type { RuntimeStore } from "../runtime/runtime-store.ts";
import type { GmMessageRow } from "../types/runtime.ts";
import type { SessionSummaryScheduler } from "./scheduler.ts";

type RuntimeLogger = { info(msg: string): void; warn(msg: string): void; error(msg: string): void };

type SessionSummaryLifecycleSubscriberParams = {
  runtimeStore: RuntimeStore;
  scheduler: SessionSummaryScheduler;
  logger: RuntimeLogger;
};

function countToolCallsInRuntimeRow(row: {
  runtimeShape?: { content?: Array<{ type?: unknown }> | null } | null;
  runtimeMeta?: { toolUseIds?: string[] | null } | null;
}): number {
  const shapeContent = Array.isArray(row.runtimeShape?.content) ? row.runtimeShape?.content : [];
  const structuredCount = shapeContent.filter((block) => {
    const type = typeof block?.type === "string" ? block.type : "";
    return type === "toolCall" || type === "toolUse" || type === "functionCall";
  }).length;
  if (structuredCount > 0) {
    return structuredCount;
  }
  return Array.isArray(row.runtimeMeta?.toolUseIds) ? row.runtimeMeta.toolUseIds.length : 0;
}

function mapRowToAgentMessage(row: GmMessageRow): AgentMessage {
  return {
    role: row.role as "user" | "assistant",
    content: row.contentBlocks?.length ? row.contentBlocks : (row.contentText ?? row.content),
  } as AgentMessage;
}

function resolvePrePromptMessageCount(event: RunLoopLifecycleEvent): number {
  const candidate =
    typeof event.metadata?.prePromptMessageCount === "number" &&
    Number.isFinite(event.metadata.prePromptMessageCount)
      ? Math.max(0, Math.floor(event.metadata.prePromptMessageCount))
      : 0;
  return candidate;
}

function resolveWorkspaceDir(event: RunLoopLifecycleEvent): string {
  const candidate =
    typeof event.metadata?.workspaceDir === "string" ? event.metadata.workspaceDir.trim() : "";
  return candidate || process.cwd();
}

export class SessionSummaryLifecycleSubscriber {
  private runtimeStore: RuntimeStore;
  private scheduler: SessionSummaryScheduler;
  private logger: RuntimeLogger;
  private readonly handler = (event: RunLoopLifecycleEvent) => this.handleEvent(event);
  private readonly registration = createRunLoopLifecycleRegistration({
    phases: ["post_sampling", "settled_turn"],
    handler: this.handler,
  });

  constructor(params: SessionSummaryLifecycleSubscriberParams) {
    this.runtimeStore = params.runtimeStore;
    this.scheduler = params.scheduler;
    this.logger = params.logger;
  }

  reconfigure(params: SessionSummaryLifecycleSubscriberParams): void {
    this.runtimeStore = params.runtimeStore;
    this.scheduler = params.scheduler;
    this.logger = params.logger;
  }

  ensureRegistered(): void {
    this.registration.ensureRegistered();
  }

  dispose(): void {
    this.registration.dispose();
  }

  private async handleEvent(event: RunLoopLifecycleEvent): Promise<void> {
    if (event.phase !== "post_sampling" && event.phase !== "settled_turn") {
      return;
    }

    const sessionKey = typeof event.sessionKey === "string" ? event.sessionKey.trim() : "";
    const sessionFile = typeof event.sessionFile === "string" ? event.sessionFile.trim() : "";
    if (!sessionKey || isSubagentSessionKey(sessionKey)) {
      return;
    }
    if (!sessionFile) {
      return;
    }

    const currentTurnCount =
      typeof event.messageCount === "number" && Number.isFinite(event.messageCount)
        ? Math.max(0, Math.floor(event.messageCount))
        : 0;
    if (currentTurnCount < 1) {
      return;
    }

    const prePromptMessageCount = resolvePrePromptMessageCount(event);
    if (prePromptMessageCount >= currentTurnCount) {
      return;
    }

    try {
      const [summaryState, runtimeRows] = await Promise.all([
        this.runtimeStore.getSessionSummaryState(event.sessionId),
        this.runtimeStore.listMessagesByTurnRange(event.sessionId, 1, currentTurnCount),
      ]);

      const recentRows = runtimeRows.filter((row) => row.turnIndex > prePromptMessageCount);
      if (!recentRows.length) {
        return;
      }

      const summarizedBoundaryIndex = summaryState?.lastSummarizedMessageId
        ? runtimeRows.findIndex((row) => row.id === summaryState.lastSummarizedMessageId)
        : -1;
      const toolCallCount = runtimeRows
        .slice(summarizedBoundaryIndex >= 0 ? summarizedBoundaryIndex + 1 : 0)
        .reduce((countSoFar, row) => countSoFar + countToolCallsInRuntimeRow(row), 0);
      const lastModelVisibleMessageId =
        runtimeRows
          .slice()
          .toReversed()
          .find((row) => row.role === "user" || row.role === "assistant")?.id ?? null;
      const allMessages = runtimeRows.map(mapRowToAgentMessage);
      const recentMessages = recentRows.map(mapRowToAgentMessage);

      this.scheduler.submitTurn({
        sessionId: event.sessionId,
        sessionKey,
        sessionFile,
        workspaceDir: resolveWorkspaceDir(event),
        agentId:
          (typeof event.agentId === "string" && event.agentId.trim()) ||
          resolveAgentIdFromSessionKey(sessionKey) ||
          "main",
        ...(typeof event.runId === "string" && event.runId.trim()
          ? { parentRunId: event.runId.trim() }
          : {}),
        recentMessages,
        lastModelVisibleMessageId,
        recentMessageLimit: 24,
        currentTokenCount: estimateConversationMessageTokens(allMessages),
        toolCallCount,
        isSettledTurn: event.phase === "settled_turn",
      });
    } catch (error) {
      this.logger.warn(
        `[memory] session summary lifecycle subscriber failed sessionId=${event.sessionId} error=${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}

const sharedSessionSummaryLifecycleSubscriber = createSharedLifecycleSubscriberAccessor(
  (params: SessionSummaryLifecycleSubscriberParams) =>
    new SessionSummaryLifecycleSubscriber(params),
);

export function getSharedSessionSummaryLifecycleSubscriber(
  params: SessionSummaryLifecycleSubscriberParams,
): SessionSummaryLifecycleSubscriber {
  return sharedSessionSummaryLifecycleSubscriber.get(params);
}

export const __testing = {
  resetSharedSessionSummaryLifecycleSubscriber(): void {
    sharedSessionSummaryLifecycleSubscriber.reset();
  },
};
