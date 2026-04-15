import { randomUUID } from "node:crypto";
import { createSubsystemLogger } from "../../../logging/subsystem.js";
import { resolveGlobalSingleton } from "../../../shared/global-singleton.js";
import type {
  RunLoopLifecycleEvent,
  RunLoopLifecycleEventInput,
  RunLoopLifecycleHandler,
  RunLoopLifecyclePhase,
  RunLoopLifecycleSubscriptionKey,
} from "./types.js";

const RUN_LOOP_LIFECYCLE_HANDLERS_KEY = Symbol.for(
  "crawclaw.runLoopLifecycle.handlers",
);

const handlers = resolveGlobalSingleton<Map<RunLoopLifecycleSubscriptionKey, RunLoopLifecycleHandler[]>>(
  RUN_LOOP_LIFECYCLE_HANDLERS_KEY,
  () => new Map(),
);

const log = createSubsystemLogger("runtime-lifecycle");

function normalizeLifecycleString(value: string | undefined | null): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim();
  return normalized ? normalized : undefined;
}

function buildDefaultTraceId(event: RunLoopLifecycleEventInput): string {
  const existing = normalizeLifecycleString(event.traceId);
  if (existing) {
    return existing;
  }
  const seed =
    normalizeLifecycleString(event.runId) ??
    normalizeLifecycleString(event.sessionKey) ??
    normalizeLifecycleString(event.sessionId);
  return `run-loop:${seed}`;
}

function buildDefaultRootSpanId(traceId: string): string {
  return `root:${traceId}`;
}

function buildLifecycleMetrics(event: RunLoopLifecycleEventInput): Record<string, number> {
  return {
    ...(typeof event.turnIndex === "number" ? { turnIndex: event.turnIndex } : {}),
    ...(typeof event.messageCount === "number" ? { messageCount: event.messageCount } : {}),
    ...(typeof event.tokenCount === "number" ? { tokenCount: event.tokenCount } : {}),
    ...event.metrics,
  };
}

function buildLifecycleRefs(event: RunLoopLifecycleEventInput): Record<string, string | number | boolean | null> {
  return {
    ...event.refs,
    ...(event.runId ? { runId: event.runId } : {}),
    ...(event.sessionKey ? { sessionKey: event.sessionKey } : {}),
    ...(event.parentSessionKey ? { parentSessionKey: event.parentSessionKey } : {}),
    ...(event.sessionFile ? { sessionFile: event.sessionFile } : {}),
    isTopLevel: event.isTopLevel,
  };
}

function buildLifecycleDecision(
  event: RunLoopLifecycleEventInput,
): RunLoopLifecycleEvent["decision"] {
  if (event.decision === null) {
    return null;
  }
  if (event.decision) {
    return event.decision;
  }
  const stopReason = normalizeLifecycleString(event.stopReason);
  return stopReason ? { code: stopReason } : null;
}

function normalizeRunLoopLifecycleEvent(
  event: RunLoopLifecycleEventInput,
): RunLoopLifecycleEvent {
  const traceId = buildDefaultTraceId(event);
  return {
    ...event,
    traceId,
    spanId: normalizeLifecycleString(event.spanId) ?? `span:${event.phase}:${randomUUID()}`,
    parentSpanId:
      event.parentSpanId === null
        ? null
        : normalizeLifecycleString(event.parentSpanId) ?? buildDefaultRootSpanId(traceId),
    decision: buildLifecycleDecision(event),
    metrics: buildLifecycleMetrics(event),
    refs: buildLifecycleRefs(event),
  };
}

export function registerRunLoopLifecycleHandler(
  key: RunLoopLifecycleSubscriptionKey,
  handler: RunLoopLifecycleHandler,
): void {
  if (!handlers.has(key)) {
    handlers.set(key, []);
  }
  const keyHandlers = handlers.get(key)!;
  if (!keyHandlers.includes(handler)) {
    keyHandlers.push(handler);
  }
}

export function unregisterRunLoopLifecycleHandler(
  key: RunLoopLifecycleSubscriptionKey,
  handler: RunLoopLifecycleHandler,
): void {
  const keyHandlers = handlers.get(key);
  if (!keyHandlers) {
    return;
  }
  const index = keyHandlers.indexOf(handler);
  if (index >= 0) {
    keyHandlers.splice(index, 1);
  }
  if (keyHandlers.length === 0) {
    handlers.delete(key);
  }
}

export function hasRunLoopLifecycleSubscribers(
  phase: RunLoopLifecyclePhase,
): boolean {
  return (handlers.get("*")?.length ?? 0) > 0 || (handlers.get(phase)?.length ?? 0) > 0;
}

export async function emitRunLoopLifecycleEvent(
  event: RunLoopLifecycleEventInput,
): Promise<void> {
  if (!hasRunLoopLifecycleSubscribers(event.phase)) {
    return;
  }

  const normalizedEvent = normalizeRunLoopLifecycleEvent(event);

  const subscribers = [
    ...(handlers.get("*") ?? []),
    ...(handlers.get(normalizedEvent.phase) ?? []),
  ];

  for (const handler of subscribers) {
    try {
      await handler(normalizedEvent);
    } catch (err) {
      log.warn(
        `run-loop lifecycle handler failed [${normalizedEvent.phase}]: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }
}

export function resetRunLoopLifecycleHandlersForTests(): void {
  handlers.clear();
}
