import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { RuntimeStore } from "../../memory/runtime/runtime-store.js";
import type {
  ObservationEventIndexRow,
  ObservationIndexSource,
  ObservationIndexRunStatus,
} from "../../memory/types/runtime.js";
import type { ObservationContext, ObservationRefValue } from "./types.js";

type ObservationIndexStatus = ObservationIndexRunStatus | "failed" | "completed";
type ObservationIndexRefMap = Record<string, ObservationRefValue>;

const SENSITIVE_INDEX_KEYS = new Set([
  "args",
  "body",
  "content",
  "input",
  "message",
  "messages",
  "output",
  "prompt",
  "result",
  "toolresult",
  "tool result",
  "transcript",
]);

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isObservationContext(value: unknown): value is ObservationContext {
  if (!isObjectRecord(value) || !isObjectRecord(value.trace) || !isObjectRecord(value.runtime)) {
    return false;
  }
  return (
    typeof value.trace.traceId === "string" &&
    typeof value.trace.spanId === "string" &&
    (typeof value.trace.parentSpanId === "string" || value.trace.parentSpanId === null) &&
    typeof value.source === "string"
  );
}

function normalizeOptionalString(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function isSafeRefValue(value: unknown): value is ObservationRefValue {
  return (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean" ||
    value === null
  );
}

function isSensitiveKey(key: string): boolean {
  const normalized = key.trim().toLowerCase();
  return SENSITIVE_INDEX_KEYS.has(normalized) || normalized.includes("transcript");
}

function sanitizeRefMap(input: Record<string, unknown> | undefined): ObservationIndexRefMap {
  const out: ObservationIndexRefMap = {};
  for (const [key, value] of Object.entries(input ?? {}).toSorted(([left], [right]) =>
    left.localeCompare(right),
  )) {
    if (isSensitiveKey(key) || !isSafeRefValue(value)) {
      continue;
    }
    out[key] = value;
  }
  return out;
}

function stringifyRecord(input: Record<string, unknown> | undefined): string | null {
  const sanitized = sanitizeRefMap(input);
  return Object.keys(sanitized).length ? JSON.stringify(sanitized) : null;
}

function stringifyMetrics(input: Record<string, number> | undefined): string | null {
  if (!input) {
    return null;
  }
  const sanitized = Object.fromEntries(
    Object.entries(input)
      .filter(([, value]) => typeof value === "number" && Number.isFinite(value))
      .toSorted(([left], [right]) => left.localeCompare(right)),
  );
  return Object.keys(sanitized).length ? JSON.stringify(sanitized) : null;
}

function hashEventKey(eventKey: string): string {
  return `obsevt_${createHash("sha256").update(eventKey).digest("hex").slice(0, 24)}`;
}

function truncateSummary(value: string, maxChars = 240): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return "observation event";
  }
  return normalized.length <= maxChars ? normalized : `${normalized.slice(0, maxChars - 1)}…`;
}

function normalizeRunStatus(status: string | null | undefined): ObservationIndexRunStatus {
  switch (status) {
    case "running":
    case "ok":
    case "error":
    case "timeout":
    case "archived":
    case "unknown":
      return status;
    case "completed":
      return "ok";
    case "failed":
      return "error";
    default:
      return "unknown";
  }
}

function eventIsError(event: ObservationEventIndexRow): boolean {
  const status = event.status?.toLowerCase();
  return (
    status === "error" ||
    status === "failed" ||
    status === "timeout" ||
    event.phase === "stop_failure" ||
    event.type.endsWith("_error")
  );
}

function aggregateRunStatus(events: ObservationEventIndexRow[]): ObservationIndexRunStatus {
  if (events.some((event) => event.status === "timeout")) {
    return "timeout";
  }
  if (events.some(eventIsError)) {
    return "error";
  }
  const latest = events.at(-1);
  if (!latest) {
    return "unknown";
  }
  if (latest.status === "archived") {
    return "archived";
  }
  if (latest.status === "ok" || latest.status === "completed" || latest.phase === "stop") {
    return "ok";
  }
  if (latest.status === "running") {
    return "running";
  }
  return "running";
}

async function refreshObservationRun(store: RuntimeStore, traceId: string): Promise<void> {
  const events = await store.listObservationEvents(traceId, 10_000);
  if (events.length === 0) {
    return;
  }
  const first = events[0];
  const latest = events.at(-1)!;
  const latestObservation = JSON.parse(latest.observationJson) as ObservationContext;
  const rootEvent =
    events.find((event) => event.parentSpanId === null) ??
    events.find((event) => event.spanId === latestObservation.trace.parentSpanId) ??
    first;
  const sources = [...new Set(events.map((event) => event.source))].toSorted((left, right) =>
    left.localeCompare(right),
  );
  const status = aggregateRunStatus(events);
  await store.upsertObservationRun({
    traceId,
    rootSpanId: rootEvent.spanId,
    runId: latest.runId ?? latestObservation.runtime.runId,
    taskId: latest.taskId ?? latestObservation.runtime.taskId,
    sessionId: latest.sessionId ?? latestObservation.runtime.sessionId,
    sessionKey: latest.sessionKey ?? latestObservation.runtime.sessionKey,
    agentId: latest.agentId ?? latestObservation.runtime.agentId,
    parentAgentId: latest.parentAgentId ?? latestObservation.runtime.parentAgentId,
    workflowRunId: latestObservation.runtime.workflowRunId,
    status,
    startedAt: first.createdAt,
    endedAt: status === "running" ? null : latest.createdAt,
    lastEventAt: latest.createdAt,
    eventCount: events.length,
    errorCount: events.filter(eventIsError).length,
    sourcesJson: JSON.stringify(sources),
    refsJson: stringifyRecord(latestObservation.refs),
    summary: `${status} ${latest.agentId ?? latestObservation.runtime.agentId ?? "agent"} observation`,
    createdAt: first.createdAt,
    updatedAt: Date.now(),
  });
}

export async function indexObservationEvent(input: {
  store: RuntimeStore;
  eventKey?: string;
  eventId?: string;
  observation: ObservationContext;
  source: ObservationIndexSource;
  type: string;
  phase?: string;
  status?: ObservationIndexStatus;
  decisionCode?: string;
  summary: string;
  metrics?: Record<string, number>;
  refs?: Record<string, unknown>;
  payloadRef?: Record<string, unknown>;
  createdAt: number;
}): Promise<void> {
  if (!isObservationContext(input.observation)) {
    return;
  }
  const traceId = input.observation.trace.traceId;
  const spanId = input.observation.trace.spanId;
  const eventKey =
    input.eventKey ??
    [
      input.source,
      input.type,
      traceId,
      spanId,
      String(input.createdAt),
      normalizeOptionalString(input.summary) ?? "event",
    ].join(":");
  await input.store.upsertObservationRun({
    traceId,
    rootSpanId:
      input.observation.trace.parentSpanId === null ? spanId : input.observation.trace.parentSpanId,
    runId: input.observation.runtime.runId,
    taskId: input.observation.runtime.taskId,
    sessionId: input.observation.runtime.sessionId,
    sessionKey: input.observation.runtime.sessionKey,
    agentId: input.observation.runtime.agentId,
    parentAgentId: input.observation.runtime.parentAgentId,
    workflowRunId: input.observation.runtime.workflowRunId,
    status: normalizeRunStatus(input.status),
    startedAt: input.createdAt,
    lastEventAt: input.createdAt,
    eventCount: 0,
    errorCount: 0,
    sourcesJson: JSON.stringify([input.source]),
    refsJson: stringifyRecord(input.observation.refs),
    summary: truncateSummary(input.summary),
    createdAt: input.createdAt,
    updatedAt: Date.now(),
  });
  await input.store.upsertObservationEvent({
    eventId: input.eventId ?? hashEventKey(eventKey),
    eventKey,
    traceId,
    spanId,
    parentSpanId: input.observation.trace.parentSpanId,
    runId: input.observation.runtime.runId,
    taskId: input.observation.runtime.taskId,
    sessionId: input.observation.runtime.sessionId,
    sessionKey: input.observation.runtime.sessionKey,
    agentId: input.observation.runtime.agentId,
    parentAgentId: input.observation.runtime.parentAgentId,
    source: input.source,
    type: input.type,
    phase: input.phase ?? input.observation.phase,
    status: input.status ?? null,
    decisionCode: input.decisionCode ?? input.observation.decisionCode,
    summary: truncateSummary(input.summary),
    observationJson: JSON.stringify(input.observation),
    metricsJson: stringifyMetrics(input.metrics),
    refsJson: stringifyRecord(input.refs),
    payloadRefJson: stringifyRecord(input.payloadRef),
    createdAt: input.createdAt,
    updatedAt: Date.now(),
  });
  await refreshObservationRun(input.store, traceId);
}

function parseJsonRecord(value: string | null | undefined): Record<string, unknown> | undefined {
  if (!value) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(value) as unknown;
    return isObjectRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function readPayloadObservation(
  payload: Record<string, unknown> | undefined,
): ObservationContext | undefined {
  if (isObservationContext(payload?.observation)) {
    return payload.observation;
  }
  const metadata = isObjectRecord(payload?.metadata) ? payload.metadata : undefined;
  return isObservationContext(metadata?.observation) ? metadata.observation : undefined;
}

async function backfillContextArchiveEvents(store: RuntimeStore): Promise<void> {
  const checkpoint = await store.getObservationBackfillCheckpoint("context-archive");
  if (checkpoint?.cursor === "complete") {
    return;
  }
  const runs = await store.listAllContextArchiveRuns();
  for (const run of runs) {
    const events = await store.listContextArchiveEvents(run.id, 10_000);
    for (const event of events) {
      const payload = parseJsonRecord(event.payloadJson);
      const observation = readPayloadObservation(payload);
      if (!observation) {
        continue;
      }
      const metrics = isObjectRecord(payload?.metrics)
        ? (payload.metrics as Record<string, number>)
        : undefined;
      const refs = isObjectRecord(payload?.refs) ? payload.refs : undefined;
      const phase = typeof payload?.phase === "string" ? payload.phase : undefined;
      await indexObservationEvent({
        store,
        eventKey: `archive:${run.id}:${event.id}`,
        eventId: `archive:${event.id}`,
        observation,
        source: "archive",
        type: event.eventKind,
        phase,
        status:
          run.status === "complete" ? "archived" : run.status === "failed" ? "error" : undefined,
        summary: phase ?? event.eventKind,
        metrics,
        refs,
        payloadRef: {
          archiveRunId: run.id,
          archiveEventId: event.id,
        },
        createdAt: event.createdAt,
      });
    }
  }
  await store.upsertObservationBackfillCheckpoint({
    source: "context-archive",
    cursor: "complete",
    updatedAt: Date.now(),
  });
}

async function collectTrajectoryFiles(rootDir: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(dir: string): Promise<void> {
    let entries: Array<{ name: string; isDirectory(): boolean; isFile(): boolean }>;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (entry.isFile() && entry.name.endsWith(".trajectory.json")) {
        out.push(fullPath);
      }
    }
  }
  await walk(path.join(rootDir, "agents"));
  return out;
}

function statusFromTrajectory(value: unknown): ObservationIndexStatus | undefined {
  return typeof value === "string" ? normalizeRunStatus(value) : undefined;
}

async function backfillTaskTrajectories(store: RuntimeStore, stateDir: string): Promise<void> {
  const checkpoint = await store.getObservationBackfillCheckpoint("task-trajectory");
  if (checkpoint?.cursor === "complete") {
    return;
  }
  for (const filePath of await collectTrajectoryFiles(stateDir)) {
    const parsed = parseJsonRecord(await fs.readFile(filePath, "utf8").catch(() => ""));
    if (!parsed || !isObservationContext(parsed.observation)) {
      continue;
    }
    const observation = parsed.observation;
    const taskId = normalizeOptionalString(
      typeof parsed.taskId === "string" ? parsed.taskId : undefined,
    );
    const runId = normalizeOptionalString(
      typeof parsed.runId === "string" ? parsed.runId : undefined,
    );
    const startedAt = typeof parsed.startedAt === "number" ? parsed.startedAt : Date.now();
    await indexObservationEvent({
      store,
      eventKey: `trajectory:${taskId ?? runId ?? observation.trace.traceId}:run`,
      observation,
      source: "trajectory",
      type: "trajectory.run",
      status: statusFromTrajectory(parsed.status),
      summary: `task trajectory ${taskId ?? runId ?? observation.trace.traceId}`,
      payloadRef: { trajectoryRef: path.relative(stateDir, filePath) },
      createdAt: startedAt,
    });
    if (!Array.isArray(parsed.steps)) {
      continue;
    }
    for (const step of parsed.steps) {
      if (!isObjectRecord(step)) {
        continue;
      }
      const stepId = normalizeOptionalString(
        typeof step.stepId === "string" ? step.stepId : undefined,
      );
      const started = typeof step.startedAt === "number" ? step.startedAt : startedAt;
      const stepObservation = isObjectRecord(step.observationRef)
        ? {
            ...observation,
            trace: {
              traceId:
                typeof step.observationRef.traceId === "string"
                  ? step.observationRef.traceId
                  : observation.trace.traceId,
              spanId:
                typeof step.observationRef.spanId === "string"
                  ? step.observationRef.spanId
                  : observation.trace.spanId,
              parentSpanId:
                typeof step.observationRef.parentSpanId === "string" ||
                step.observationRef.parentSpanId === null
                  ? step.observationRef.parentSpanId
                  : observation.trace.parentSpanId,
            },
          }
        : observation;
      await indexObservationEvent({
        store,
        eventKey: `trajectory:${taskId ?? runId ?? observation.trace.traceId}:${stepId ?? started}`,
        observation: stepObservation,
        source: "trajectory",
        type: `trajectory.${typeof step.kind === "string" ? step.kind : "step"}`,
        status: statusFromTrajectory(step.status),
        summary:
          normalizeOptionalString(typeof step.summary === "string" ? step.summary : undefined) ??
          normalizeOptionalString(typeof step.title === "string" ? step.title : undefined) ??
          "trajectory step",
        refs: {
          ...(stepId ? { stepId } : {}),
          ...(typeof step.toolName === "string" ? { toolName: step.toolName } : {}),
          ...(typeof step.toolCallId === "string" ? { toolCallId: step.toolCallId } : {}),
        },
        payloadRef: {
          trajectoryRef: path.relative(stateDir, filePath),
          ...(stepId ? { trajectoryStepId: stepId } : {}),
        },
        createdAt: started,
      });
    }
  }
  await store.upsertObservationBackfillCheckpoint({
    source: "task-trajectory",
    cursor: "complete",
    updatedAt: Date.now(),
  });
}

export async function backfillObservationIndex(input: {
  store: RuntimeStore;
  stateDir: string;
}): Promise<void> {
  await backfillContextArchiveEvents(input.store);
  await backfillTaskTrajectories(input.store, input.stateDir);
}
