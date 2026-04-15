export type RunLoopLifecyclePhase =
  | "turn_started"
  | "provider_request_start"
  | "provider_request_stop"
  | "provider_request_error"
  | "post_sampling"
  | "settled_turn"
  | "stop"
  | "stop_failure"
  | "pre_compact"
  | "post_compact"
  | "tool_call_start"
  | "tool_call_stop"
  | "tool_call_error"
  | "subagent_start"
  | "subagent_stop";

export type RunLoopLifecycleDecision = {
  code: string;
  summary?: string;
  details?: Record<string, unknown>;
};

export type RunLoopLifecycleMetrics = Record<string, number>;

export type RunLoopLifecycleRefs = Record<string, string | number | boolean | null>;

export type RunLoopLifecycleEventInput = {
  phase: RunLoopLifecyclePhase;
  traceId?: string;
  spanId?: string;
  parentSpanId?: string | null;
  runId?: string;
  sessionId: string;
  sessionKey?: string;
  agentId?: string;
  parentSessionKey?: string;
  isTopLevel: boolean;
  sessionFile?: string;
  turnIndex?: number;
  messageCount?: number;
  tokenCount?: number;
  stopReason?: string | null;
  error?: string | null;
  decision?: RunLoopLifecycleDecision | null;
  metrics?: RunLoopLifecycleMetrics;
  refs?: RunLoopLifecycleRefs;
  metadata?: Record<string, unknown>;
};

export type RunLoopLifecycleEvent = Omit<
  RunLoopLifecycleEventInput,
  "traceId" | "spanId" | "decision" | "metrics" | "refs"
> & {
  traceId: string;
  spanId: string;
  parentSpanId?: string | null;
  decision: RunLoopLifecycleDecision | null;
  metrics: RunLoopLifecycleMetrics;
  refs: RunLoopLifecycleRefs;
};

export type RunLoopLifecycleSubscriptionKey = RunLoopLifecyclePhase | "*";

export type RunLoopLifecycleHandler = (
  event: RunLoopLifecycleEvent,
) => Promise<void> | void;
