import { createHash, randomUUID } from "node:crypto";
import type { ObservationRuntimeContext } from "./types.js";

function nonEmptyString(value: string | undefined | null): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export function buildObservationTraceId(input: {
  traceId?: string;
  runtime?: ObservationRuntimeContext;
}): string {
  const explicit = nonEmptyString(input.traceId);
  if (explicit) {
    return explicit;
  }
  const runtime = input.runtime ?? {};
  const owner =
    nonEmptyString(runtime.runId) ??
    nonEmptyString(runtime.sessionKey) ??
    nonEmptyString(runtime.sessionId);
  return owner ? `run-loop:${owner}` : `run-loop:${randomUUID()}`;
}

export function buildObservationRootSpanId(traceId: string): string {
  return `root:${traceId}`;
}

export function buildObservationChildSpanId(input: { phase?: string; source: string }): string {
  const label = nonEmptyString(input.phase) ?? nonEmptyString(input.source) ?? "span";
  return `span:${label}:${randomUUID()}`;
}

export function toW3cTraceId(traceId: string): string {
  const normalized = traceId.trim().toLowerCase();
  if (/^[0-9a-f]{32}$/.test(normalized) && !/^0+$/.test(normalized)) {
    return normalized;
  }
  return createHash("sha256").update(traceId).digest("hex").slice(0, 32);
}

export function toW3cSpanId(spanId: string): string {
  const normalized = spanId.trim().toLowerCase();
  if (/^[0-9a-f]{16}$/.test(normalized) && !/^0+$/.test(normalized)) {
    return normalized;
  }
  return createHash("sha256").update(spanId).digest("hex").slice(0, 16);
}

export function buildTraceparent(input: { traceId: string; spanId: string }): string {
  return `00-${toW3cTraceId(input.traceId)}-${toW3cSpanId(input.spanId)}-01`;
}

export function parseTraceparent(
  traceparent: string | undefined,
): { traceId: string; spanId: string; traceparent: string } | undefined {
  const value = nonEmptyString(traceparent);
  if (!value) {
    return undefined;
  }
  const match = /^00-([0-9a-f]{32})-([0-9a-f]{16})-[0-9a-f]{2}$/i.exec(value);
  if (!match?.[1] || !match[2] || /^0+$/.test(match[1]) || /^0+$/.test(match[2])) {
    return undefined;
  }
  return {
    traceId: match[1].toLowerCase(),
    spanId: match[2].toLowerCase(),
    traceparent: value,
  };
}
