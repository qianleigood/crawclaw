export type ObservationRefValue = string | number | boolean | null;

export type ObservationTraceContext = {
  traceId: string;
  spanId: string;
  parentSpanId: string | null;
  traceparent?: string;
  tracestate?: string;
};

export type ObservationRuntimeContext = {
  runId?: string;
  sessionId?: string;
  sessionKey?: string;
  agentId?: string;
  parentAgentId?: string;
  taskId?: string;
  workflowRunId?: string;
  workflowStepId?: string;
};

export type ObservationContext = {
  trace: ObservationTraceContext;
  runtime: ObservationRuntimeContext;
  phase?: string;
  decisionCode?: string;
  source: string;
  refs?: Record<string, ObservationRefValue>;
};

export type ObservationContextInput = {
  trace?: Partial<ObservationTraceContext>;
  runtime?: ObservationRuntimeContext;
  phase?: string;
  decisionCode?: string;
  source: string;
  refs?: Record<string, ObservationRefValue>;
};

export type ObservationChildInput = {
  spanId?: string;
  runtime?: ObservationRuntimeContext;
  phase?: string;
  decisionCode?: string;
  source: string;
  refs?: Record<string, ObservationRefValue>;
};

export type ObservationRef = {
  traceId: string;
  spanId: string;
  parentSpanId: string | null;
  runId?: string;
  sessionId?: string;
  sessionKey?: string;
  agentId?: string;
  taskId?: string;
};
