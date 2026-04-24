import {
  buildObservationChildSpanId,
  buildObservationRootSpanId,
  buildObservationTraceId,
  parseTraceparent,
} from "./ids.js";
import type {
  ObservationChildInput,
  ObservationContext,
  ObservationContextInput,
  ObservationRef,
  ObservationRuntimeContext,
} from "./types.js";

function nonEmptyString(value: string | undefined | null): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function normalizeRuntime(
  runtime: ObservationRuntimeContext | undefined,
): ObservationRuntimeContext {
  return {
    ...(nonEmptyString(runtime?.runId) ? { runId: nonEmptyString(runtime?.runId) } : {}),
    ...(nonEmptyString(runtime?.sessionId)
      ? { sessionId: nonEmptyString(runtime?.sessionId) }
      : {}),
    ...(nonEmptyString(runtime?.sessionKey)
      ? { sessionKey: nonEmptyString(runtime?.sessionKey) }
      : {}),
    ...(nonEmptyString(runtime?.agentId) ? { agentId: nonEmptyString(runtime?.agentId) } : {}),
    ...(nonEmptyString(runtime?.parentAgentId)
      ? { parentAgentId: nonEmptyString(runtime?.parentAgentId) }
      : {}),
    ...(nonEmptyString(runtime?.taskId) ? { taskId: nonEmptyString(runtime?.taskId) } : {}),
    ...(nonEmptyString(runtime?.workflowRunId)
      ? { workflowRunId: nonEmptyString(runtime?.workflowRunId) }
      : {}),
    ...(nonEmptyString(runtime?.workflowStepId)
      ? { workflowStepId: nonEmptyString(runtime?.workflowStepId) }
      : {}),
  };
}

function mergeRuntime(
  base: ObservationRuntimeContext | undefined,
  next: ObservationRuntimeContext | undefined,
): ObservationRuntimeContext {
  return normalizeRuntime({ ...base, ...next });
}

export function normalizeObservationContext(input: ObservationContextInput): ObservationContext {
  const propagated = parseTraceparent(input.trace?.traceparent);
  const runtime = normalizeRuntime(input.runtime);
  const traceId = buildObservationTraceId({
    traceId: input.trace?.traceId ?? propagated?.traceId,
    runtime,
  });
  const spanId = nonEmptyString(input.trace?.spanId) ?? buildObservationRootSpanId(traceId);
  const parentSpanId =
    input.trace?.parentSpanId === null
      ? null
      : (nonEmptyString(input.trace?.parentSpanId) ??
        propagated?.spanId ??
        (spanId === buildObservationRootSpanId(traceId)
          ? null
          : buildObservationRootSpanId(traceId)));

  return {
    trace: {
      traceId,
      spanId,
      parentSpanId,
      ...((propagated?.traceparent ?? nonEmptyString(input.trace?.traceparent))
        ? { traceparent: propagated?.traceparent ?? nonEmptyString(input.trace?.traceparent) }
        : {}),
      ...(nonEmptyString(input.trace?.tracestate)
        ? { tracestate: nonEmptyString(input.trace?.tracestate) }
        : {}),
    },
    runtime,
    ...(nonEmptyString(input.phase) ? { phase: nonEmptyString(input.phase) } : {}),
    ...(nonEmptyString(input.decisionCode)
      ? { decisionCode: nonEmptyString(input.decisionCode) }
      : {}),
    source: nonEmptyString(input.source) ?? "unknown",
    ...(input.refs ? { refs: input.refs } : {}),
  };
}

export function createObservationRoot(input: ObservationContextInput): ObservationContext {
  const propagated = parseTraceparent(input.trace?.traceparent);
  const runtime = normalizeRuntime(input.runtime);
  const traceId = buildObservationTraceId({
    traceId: input.trace?.traceId ?? propagated?.traceId,
    runtime,
  });
  return normalizeObservationContext({
    ...input,
    runtime,
    trace: {
      ...input.trace,
      traceId,
      spanId: input.trace?.spanId ?? buildObservationRootSpanId(traceId),
      parentSpanId: input.trace?.parentSpanId ?? propagated?.spanId ?? null,
    },
  });
}

export function deriveObservationChild(
  parent: ObservationContext,
  input: ObservationChildInput,
): ObservationContext {
  const spanId = nonEmptyString(input.spanId) ?? buildObservationChildSpanId(input);
  return normalizeObservationContext({
    source: input.source,
    runtime: mergeRuntime(parent.runtime, input.runtime),
    phase: input.phase,
    decisionCode: input.decisionCode,
    refs: {
      ...parent.refs,
      ...input.refs,
    },
    trace: {
      traceId: parent.trace.traceId,
      spanId,
      parentSpanId: parent.trace.spanId,
      tracestate: parent.trace.tracestate,
    },
  });
}

export function observationRef(observation: ObservationContext): ObservationRef {
  return {
    traceId: observation.trace.traceId,
    spanId: observation.trace.spanId,
    parentSpanId: observation.trace.parentSpanId,
    ...(observation.runtime.runId ? { runId: observation.runtime.runId } : {}),
    ...(observation.runtime.sessionId ? { sessionId: observation.runtime.sessionId } : {}),
    ...(observation.runtime.sessionKey ? { sessionKey: observation.runtime.sessionKey } : {}),
    ...(observation.runtime.agentId ? { agentId: observation.runtime.agentId } : {}),
    ...(observation.runtime.taskId ? { taskId: observation.runtime.taskId } : {}),
  };
}
