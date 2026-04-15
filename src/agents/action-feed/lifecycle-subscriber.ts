import { emitAgentActionEvent } from "./emit.js";
import {
  registerRunLoopLifecycleHandler,
  unregisterRunLoopLifecycleHandler,
} from "../runtime/lifecycle/bus.js";
import type { RunLoopLifecycleEvent } from "../runtime/lifecycle/types.js";

type CompactionLifecycleMetadata = {
  trigger?: string;
  willRetry?: boolean;
  completed?: boolean;
};

function resolveCompactionMetadata(event: RunLoopLifecycleEvent): CompactionLifecycleMetadata {
  return (typeof event.metadata === "object" && event.metadata
    ? event.metadata
    : {}) as CompactionLifecycleMetadata;
}

function resolveLifecycleRunId(event: RunLoopLifecycleEvent): string {
  const runId = typeof event.runId === "string" ? event.runId.trim() : "";
  if (runId) {
    return runId;
  }
  return event.sessionId;
}

function resolveCompactionActionId(event: RunLoopLifecycleEvent): string {
  return `compaction:${resolveLifecycleRunId(event)}`;
}

function emitCompactionStarted(event: RunLoopLifecycleEvent): void {
  const metadata = resolveCompactionMetadata(event);
  emitAgentActionEvent({
    runId: resolveLifecycleRunId(event),
    sessionId: event.sessionId,
    sessionKey: event.sessionKey,
    agentId: event.agentId,
    data: {
      actionId: resolveCompactionActionId(event),
      kind: "compaction",
      status: "running",
      title: "Compacting context",
      summary: "Summarizing recent context to keep the run moving.",
      detail: {
        phase: "start",
        ...(metadata.trigger ? { trigger: metadata.trigger } : {}),
      },
    },
  });
}

function emitCompactionFinished(event: RunLoopLifecycleEvent): void {
  const metadata = resolveCompactionMetadata(event);
  const willRetry = metadata.willRetry === true;
  emitAgentActionEvent({
    runId: resolveLifecycleRunId(event),
    sessionId: event.sessionId,
    sessionKey: event.sessionKey,
    agentId: event.agentId,
    data: {
      actionId: resolveCompactionActionId(event),
      kind: "compaction",
      status: willRetry ? "running" : "completed",
      title: willRetry ? "Retrying after compaction" : "Context compacted",
      summary: willRetry
        ? "Context was compacted; the agent is retrying with the shorter context."
        : "Compaction finished successfully.",
      detail: {
        phase: "end",
        willRetry,
        completed: metadata.completed !== false,
      },
    },
  });
}

export class RunLoopActionFeedLifecycleSubscriber {
  private registered = false;
  private readonly handler = (event: RunLoopLifecycleEvent) => this.handleEvent(event);

  ensureRegistered(): void {
    registerRunLoopLifecycleHandler("pre_compact", this.handler);
    registerRunLoopLifecycleHandler("post_compact", this.handler);
    this.registered = true;
  }

  dispose(): void {
    if (!this.registered) {
      return;
    }
    unregisterRunLoopLifecycleHandler("pre_compact", this.handler);
    unregisterRunLoopLifecycleHandler("post_compact", this.handler);
    this.registered = false;
  }

  private handleEvent(event: RunLoopLifecycleEvent): void {
    if (event.phase === "pre_compact") {
      emitCompactionStarted(event);
      return;
    }
    if (event.phase === "post_compact") {
      emitCompactionFinished(event);
    }
  }
}

let sharedRunLoopActionFeedLifecycleSubscriber: RunLoopActionFeedLifecycleSubscriber | null = null;

export function getSharedRunLoopActionFeedLifecycleSubscriber(): RunLoopActionFeedLifecycleSubscriber {
  if (!sharedRunLoopActionFeedLifecycleSubscriber) {
    sharedRunLoopActionFeedLifecycleSubscriber = new RunLoopActionFeedLifecycleSubscriber();
  }
  sharedRunLoopActionFeedLifecycleSubscriber.ensureRegistered();
  return sharedRunLoopActionFeedLifecycleSubscriber;
}

export const __testing = {
  resetSharedRunLoopActionFeedLifecycleSubscriber(): void {
    sharedRunLoopActionFeedLifecycleSubscriber?.dispose();
    sharedRunLoopActionFeedLifecycleSubscriber = null;
  },
};
