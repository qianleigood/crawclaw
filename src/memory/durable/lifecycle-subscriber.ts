import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type { RunLoopLifecycleEvent } from "../../agents/runtime/lifecycle/types.js";
import {
  createRunLoopLifecycleRegistration,
  createSharedLifecycleSubscriberAccessor,
} from "../../agents/special/runtime/lifecycle-subscriber.js";
import { resolveAgentIdFromSessionKey } from "../../routing/session-key.js";
import { isSubagentSessionKey } from "../../sessions/session-key-utils.ts";
import type { RuntimeStore } from "../runtime/runtime-store.ts";
import type { GmMessageRow } from "../types/runtime.ts";
import type { DurableExtractionWorkerManager } from "./worker-manager.ts";

type RuntimeLogger = { info(msg: string): void; warn(msg: string): void; error(msg: string): void };

type DurableExtractionLifecycleSubscriberParams = {
  runtimeStore: RuntimeStore;
  manager: DurableExtractionWorkerManager;
  logger: RuntimeLogger;
};

function mapRowToAgentMessage(row: GmMessageRow): AgentMessage {
  const baseMessage = {
    role: row.role,
    content: row.contentBlocks?.length ? row.contentBlocks : (row.contentText ?? row.content),
  } as Record<string, unknown>;
  if (row.role === "toolResult") {
    baseMessage.toolCallId =
      typeof row.runtimeShape?.toolCallId === "string" ? row.runtimeShape.toolCallId : undefined;
    baseMessage.toolName =
      typeof row.runtimeShape?.toolName === "string" ? row.runtimeShape.toolName : undefined;
    if (typeof row.runtimeShape?.isError === "boolean") {
      baseMessage.isError = row.runtimeShape.isError;
    }
  }
  return baseMessage as unknown as AgentMessage;
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

export class DurableExtractionLifecycleSubscriber {
  private runtimeStore: RuntimeStore;
  private manager: DurableExtractionWorkerManager;
  private logger: RuntimeLogger;
  private readonly handler = (event: RunLoopLifecycleEvent) => this.handleEvent(event);
  private readonly registration = createRunLoopLifecycleRegistration({
    phases: ["stop"],
    handler: this.handler,
  });

  constructor(params: DurableExtractionLifecycleSubscriberParams) {
    this.runtimeStore = params.runtimeStore;
    this.manager = params.manager;
    this.logger = params.logger;
  }

  reconfigure(params: DurableExtractionLifecycleSubscriberParams): void {
    this.runtimeStore = params.runtimeStore;
    this.manager = params.manager;
    this.logger = params.logger;
  }

  ensureRegistered(): void {
    this.registration.ensureRegistered();
  }

  dispose(): void {
    this.registration.dispose();
  }

  private async handleEvent(event: RunLoopLifecycleEvent): Promise<void> {
    if (event.phase !== "stop") {
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
      const runtimeRows = await this.runtimeStore.listMessagesByTurnRange(
        event.sessionId,
        1,
        currentTurnCount,
      );
      const newRows = runtimeRows.filter((row) => row.turnIndex > prePromptMessageCount);
      if (!newRows.length) {
        return;
      }

      await this.manager.submitTurn({
        sessionId: event.sessionId,
        sessionKey,
        newMessages: newRows.map(mapRowToAgentMessage),
        messageCursor: currentTurnCount,
        runtimeContext: {
          agentId:
            (typeof event.agentId === "string" && event.agentId.trim()) ||
            resolveAgentIdFromSessionKey(sessionKey) ||
            "main",
          ...(typeof event.runId === "string" && event.runId.trim()
            ? { parentRunId: event.runId.trim() }
            : {}),
          sessionFile,
          workspaceDir: resolveWorkspaceDir(event),
          ...(typeof event.metadata?.messageChannel === "string" &&
          event.metadata.messageChannel.trim()
            ? { messageChannel: event.metadata.messageChannel.trim() }
            : {}),
          ...(typeof event.metadata?.senderId === "string" && event.metadata.senderId.trim()
            ? { senderId: event.metadata.senderId.trim() }
            : {}),
        },
      });
    } catch (error) {
      this.logger.warn(
        `[memory] durable extraction lifecycle subscriber failed sessionId=${event.sessionId} error=${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}

const sharedDurableExtractionLifecycleSubscriber = createSharedLifecycleSubscriberAccessor(
  (params: DurableExtractionLifecycleSubscriberParams) =>
    new DurableExtractionLifecycleSubscriber(params),
);

export function getSharedDurableExtractionLifecycleSubscriber(
  params: DurableExtractionLifecycleSubscriberParams,
): DurableExtractionLifecycleSubscriber {
  return sharedDurableExtractionLifecycleSubscriber.get(params);
}

export const __testing = {
  resetSharedDurableExtractionLifecycleSubscriber(): void {
    sharedDurableExtractionLifecycleSubscriber.reset();
  },
};
