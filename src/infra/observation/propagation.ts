import { buildTraceparent, parseTraceparent } from "./ids.js";
import type { ObservationContext } from "./types.js";

type ReadableCarrier = {
  get(key: string): string | undefined;
};

type WritableCarrier = {
  set(key: string, value: string): void;
};

export type ObservationPropagation = {
  traceparent?: string;
  tracestate?: string;
};

export function extractObservationPropagation(carrier: ReadableCarrier): ObservationPropagation {
  const traceparent = carrier.get("traceparent");
  const parsed = parseTraceparent(traceparent);
  const tracestate = carrier.get("tracestate")?.trim();
  return {
    ...(parsed ? { traceparent: parsed.traceparent } : {}),
    ...(tracestate ? { tracestate } : {}),
  };
}

export function injectObservationPropagation(
  carrier: WritableCarrier,
  observation: ObservationContext,
): void {
  carrier.set(
    "traceparent",
    observation.trace.traceparent ??
      buildTraceparent({
        traceId: observation.trace.traceId,
        spanId: observation.trace.spanId,
      }),
  );
  if (observation.trace.tracestate) {
    carrier.set("tracestate", observation.trace.tracestate);
  }
}
