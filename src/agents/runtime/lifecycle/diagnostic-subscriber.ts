import { emitDiagnosticEvent } from "../../../infra/diagnostic-events.js";
import { registerRunLoopLifecycleHandler, unregisterRunLoopLifecycleHandler } from "./bus.js";
import type { RunLoopLifecycleEvent } from "./types.js";

export class RunLoopDiagnosticLifecycleSubscriber {
  private registered = false;
  private readonly handler = (event: RunLoopLifecycleEvent) => this.handleEvent(event);

  ensureRegistered(): void {
    if (this.registered) {
      return;
    }
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

  private handleEvent(event: RunLoopLifecycleEvent): void {
    emitDiagnosticEvent({
      type: "run.lifecycle",
      phase: event.phase,
      ...(event.runId ? { runId: event.runId } : {}),
      sessionId: event.sessionId,
      ...(event.sessionKey ? { sessionKey: event.sessionKey } : {}),
      ...(event.agentId ? { agentId: event.agentId } : {}),
      ...(event.parentSessionKey ? { parentSessionKey: event.parentSessionKey } : {}),
      isTopLevel: event.isTopLevel,
      ...(event.sessionFile ? { sessionFile: event.sessionFile } : {}),
      ...(typeof event.turnIndex === "number" ? { turnIndex: event.turnIndex } : {}),
      ...(typeof event.messageCount === "number" ? { messageCount: event.messageCount } : {}),
      ...(typeof event.tokenCount === "number" ? { tokenCount: event.tokenCount } : {}),
      ...(event.stopReason !== undefined ? { stopReason: event.stopReason } : {}),
      ...(event.error !== undefined ? { error: event.error } : {}),
      decision: event.decision,
      metrics: event.metrics,
      refs: event.refs,
      observation: event.observation,
    });
  }
}

let sharedRunLoopDiagnosticLifecycleSubscriber: RunLoopDiagnosticLifecycleSubscriber | null = null;

export function getSharedRunLoopDiagnosticLifecycleSubscriber(): RunLoopDiagnosticLifecycleSubscriber {
  if (!sharedRunLoopDiagnosticLifecycleSubscriber) {
    sharedRunLoopDiagnosticLifecycleSubscriber = new RunLoopDiagnosticLifecycleSubscriber();
  }
  sharedRunLoopDiagnosticLifecycleSubscriber.ensureRegistered();
  return sharedRunLoopDiagnosticLifecycleSubscriber;
}

export const __testing = {
  resetRunLoopDiagnosticLifecycleSubscriber(): void {
    sharedRunLoopDiagnosticLifecycleSubscriber?.dispose();
    sharedRunLoopDiagnosticLifecycleSubscriber = null;
  },
};
