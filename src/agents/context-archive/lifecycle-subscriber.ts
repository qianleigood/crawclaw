import type { CrawClawConfig } from "../../config/config.js";
import {
  registerRunLoopLifecycleHandler,
  unregisterRunLoopLifecycleHandler,
} from "../runtime/lifecycle/bus.js";
import type { RunLoopLifecycleEvent } from "../runtime/lifecycle/types.js";
import { captureContextArchiveRunEvent, updateContextArchiveRunState } from "./run-capture.js";

function resolveLifecycleConfig(event: RunLoopLifecycleEvent): CrawClawConfig | undefined {
  if (!event.metadata || typeof event.metadata !== "object") {
    return undefined;
  }
  const config = event.metadata.config;
  return typeof config === "object" && config ? (config as CrawClawConfig) : undefined;
}

function resolveLifecycleRunId(event: RunLoopLifecycleEvent): string {
  const runId = typeof event.runId === "string" ? event.runId.trim() : "";
  if (runId) {
    return runId;
  }
  return event.sessionId;
}

export class RunLoopContextArchiveLifecycleSubscriber {
  private registered = false;
  private readonly handler = (event: RunLoopLifecycleEvent) => this.handleEvent(event);

  ensureRegistered(): void {
    registerRunLoopLifecycleHandler("*", this.handler);
    this.registered = true;
  }

  dispose(): void {
    if (!this.registered) {
      return;
    }
    unregisterRunLoopLifecycleHandler("*", this.handler);
    this.registered = false;
  }

  private async handleEvent(event: RunLoopLifecycleEvent): Promise<void> {
    const runId = resolveLifecycleRunId(event);
    await captureContextArchiveRunEvent({
      config: resolveLifecycleConfig(event),
      source: "run-loop-lifecycle",
      runId,
      sessionId: event.sessionId,
      ...(event.sessionKey ? { sessionKey: event.sessionKey } : {}),
      ...(event.agentId ? { agentId: event.agentId } : {}),
      label: "run-loop-lifecycle",
      type: `run.lifecycle.${event.phase}`,
      ...(typeof event.turnIndex === "number" ? { turnIndex: event.turnIndex } : {}),
      payload: {
        phase: event.phase,
        observation: event.observation,
        isTopLevel: event.isTopLevel,
        ...(typeof event.messageCount === "number" ? { messageCount: event.messageCount } : {}),
        ...(typeof event.tokenCount === "number" ? { tokenCount: event.tokenCount } : {}),
        ...(event.stopReason ? { stopReason: event.stopReason } : {}),
        ...(event.error ? { error: event.error } : {}),
        ...(event.decision ? { decision: event.decision } : {}),
        ...(Object.keys(event.metrics).length > 0 ? { metrics: event.metrics } : {}),
        ...(Object.keys(event.refs).length > 0 ? { refs: event.refs } : {}),
      },
      metadata: {
        phase: event.phase,
        observation: event.observation,
        ...(event.decision ? { decisionCode: event.decision.code } : {}),
        ...(event.stopReason ? { stopReason: event.stopReason } : {}),
        ...(event.error ? { error: event.error } : {}),
      },
    });

    if (event.phase === "stop" || event.phase === "stop_failure") {
      await updateContextArchiveRunState({
        config: resolveLifecycleConfig(event),
        source: "run-loop-lifecycle",
        runId,
        sessionId: event.sessionId,
        ...(event.sessionKey ? { sessionKey: event.sessionKey } : {}),
        ...(event.agentId ? { agentId: event.agentId } : {}),
        label: "run-loop-lifecycle",
        status: event.phase === "stop" ? "complete" : "failed",
        summary: {
          phase: event.phase,
          ...(event.stopReason ? { stopReason: event.stopReason } : {}),
          ...(event.error ? { error: event.error } : {}),
        },
        metadata: {
          lifecyclePhase: event.phase,
        },
      });
    }
  }
}

let sharedRunLoopContextArchiveLifecycleSubscriber: RunLoopContextArchiveLifecycleSubscriber | null =
  null;

export function getSharedRunLoopContextArchiveLifecycleSubscriber(): RunLoopContextArchiveLifecycleSubscriber {
  if (!sharedRunLoopContextArchiveLifecycleSubscriber) {
    sharedRunLoopContextArchiveLifecycleSubscriber = new RunLoopContextArchiveLifecycleSubscriber();
  }
  sharedRunLoopContextArchiveLifecycleSubscriber.ensureRegistered();
  return sharedRunLoopContextArchiveLifecycleSubscriber;
}

export const __testing = {
  resetSharedRunLoopContextArchiveLifecycleSubscriber(): void {
    sharedRunLoopContextArchiveLifecycleSubscriber?.dispose();
    sharedRunLoopContextArchiveLifecycleSubscriber = null;
  },
};
