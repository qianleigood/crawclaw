export type DiagnosticTraceEnvelope = {
  traceId: string;
  spanId: string;
  parentSpanId?: string | null;
  runId?: string;
  sessionId?: string;
  sessionKey?: string;
  agentId?: string;
  phase?: string;
  decisionCode?: string;
};

export type DiagnosticTraceIdentityInput = {
  traceId?: string;
  runId?: string;
  sessionId?: string;
  sessionKey?: string;
};

export type DiagnosticTraceEnvelopeInput = DiagnosticTraceIdentityInput & {
  spanId?: string;
  parentSpanId?: string | null;
  agentId?: string;
  phase?: string;
  decisionCode?: string;
};

function nonEmptyString(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

export function buildDiagnosticTraceId(input: DiagnosticTraceIdentityInput): string | undefined {
  const explicitTraceId = nonEmptyString(input.traceId);
  if (explicitTraceId) {
    return explicitTraceId;
  }

  const ownerId =
    nonEmptyString(input.runId) ??
    nonEmptyString(input.sessionKey) ??
    nonEmptyString(input.sessionId);
  return ownerId ? `run-loop:${ownerId}` : undefined;
}

export function buildDiagnosticTraceRootSpanId(traceId: string): string {
  return `root:${traceId}`;
}

export function normalizeDiagnosticTraceEnvelope(
  input: DiagnosticTraceEnvelopeInput,
): DiagnosticTraceEnvelope | undefined {
  const traceId = buildDiagnosticTraceId(input);
  if (!traceId) {
    return undefined;
  }

  const spanId = nonEmptyString(input.spanId) ?? buildDiagnosticTraceRootSpanId(traceId);
  const explicitParent =
    input.parentSpanId === null ? null : nonEmptyString(input.parentSpanId ?? undefined);
  const parentSpanId =
    explicitParent !== undefined
      ? explicitParent
      : spanId === buildDiagnosticTraceRootSpanId(traceId)
        ? null
        : buildDiagnosticTraceRootSpanId(traceId);

  return {
    traceId,
    spanId,
    ...(parentSpanId !== undefined ? { parentSpanId } : {}),
    ...(nonEmptyString(input.runId) ? { runId: nonEmptyString(input.runId) } : {}),
    ...(nonEmptyString(input.sessionId) ? { sessionId: nonEmptyString(input.sessionId) } : {}),
    ...(nonEmptyString(input.sessionKey) ? { sessionKey: nonEmptyString(input.sessionKey) } : {}),
    ...(nonEmptyString(input.agentId) ? { agentId: nonEmptyString(input.agentId) } : {}),
    ...(nonEmptyString(input.phase) ? { phase: nonEmptyString(input.phase) } : {}),
    ...(nonEmptyString(input.decisionCode)
      ? { decisionCode: nonEmptyString(input.decisionCode) }
      : {}),
  };
}

export function diagnosticTraceEnvelopeToAttributes(
  trace: DiagnosticTraceEnvelope | undefined,
): Record<string, string> {
  if (!trace) {
    return {};
  }

  return {
    "crawclaw.traceId": trace.traceId,
    "crawclaw.spanId": trace.spanId,
    ...(trace.parentSpanId ? { "crawclaw.parentSpanId": trace.parentSpanId } : {}),
    ...(trace.runId ? { "crawclaw.runId": trace.runId } : {}),
    ...(trace.sessionId ? { "crawclaw.sessionId": trace.sessionId } : {}),
    ...(trace.sessionKey ? { "crawclaw.sessionKey": trace.sessionKey } : {}),
    ...(trace.agentId ? { "crawclaw.agentId": trace.agentId } : {}),
    ...(trace.phase ? { "crawclaw.lifecycle.phase": trace.phase } : {}),
    ...(trace.decisionCode ? { "crawclaw.decisionCode": trace.decisionCode } : {}),
  };
}
