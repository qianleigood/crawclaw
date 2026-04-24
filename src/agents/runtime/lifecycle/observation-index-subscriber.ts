import type { CrawClawConfig } from "../../../config/config.js";
import { indexObservationEventWithDefaultStore } from "../../../infra/observation/history-runtime.js";
import { registerRunLoopLifecycleHandler, unregisterRunLoopLifecycleHandler } from "./bus.js";
import type { RunLoopLifecycleEvent } from "./types.js";

function resolveLifecycleConfig(event: RunLoopLifecycleEvent): CrawClawConfig | undefined {
  if (!event.metadata || typeof event.metadata !== "object") {
    return undefined;
  }
  const config = event.metadata.config;
  return typeof config === "object" && config ? (config as CrawClawConfig) : undefined;
}

function lifecycleStatus(
  event: RunLoopLifecycleEvent,
): "running" | "ok" | "error" | "timeout" | "failed" | undefined {
  if (event.phase === "stop") {
    return "ok";
  }
  if (event.phase === "stop_failure" || event.phase.endsWith("_error")) {
    return event.error?.toLowerCase().includes("timeout") ? "timeout" : "error";
  }
  return "running";
}

function lifecycleSummary(event: RunLoopLifecycleEvent): string {
  return event.decision?.summary ?? event.stopReason ?? event.phase.replaceAll("_", " ");
}

export class RunLoopObservationIndexLifecycleSubscriber {
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
    await indexObservationEventWithDefaultStore({
      config: resolveLifecycleConfig(event),
      eventKey: `lifecycle:${event.observation.trace.traceId}:${event.observation.trace.spanId}:${event.phase}`,
      observation: event.observation,
      source: "lifecycle",
      type: `run.lifecycle.${event.phase}`,
      phase: event.phase,
      status: lifecycleStatus(event),
      decisionCode: event.decision?.code,
      summary: lifecycleSummary(event),
      metrics: event.metrics,
      refs: event.refs,
      createdAt: Date.now(),
    });
  }
}

let sharedRunLoopObservationIndexLifecycleSubscriber: RunLoopObservationIndexLifecycleSubscriber | null =
  null;

export function getSharedRunLoopObservationIndexLifecycleSubscriber(): RunLoopObservationIndexLifecycleSubscriber {
  if (!sharedRunLoopObservationIndexLifecycleSubscriber) {
    sharedRunLoopObservationIndexLifecycleSubscriber =
      new RunLoopObservationIndexLifecycleSubscriber();
  }
  sharedRunLoopObservationIndexLifecycleSubscriber.ensureRegistered();
  return sharedRunLoopObservationIndexLifecycleSubscriber;
}

export const __testing = {
  resetSharedRunLoopObservationIndexLifecycleSubscriber(): void {
    sharedRunLoopObservationIndexLifecycleSubscriber?.dispose();
    sharedRunLoopObservationIndexLifecycleSubscriber = null;
  },
};
