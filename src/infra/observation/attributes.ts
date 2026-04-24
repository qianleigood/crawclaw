import type { ObservationContext } from "./types.js";

export function observationToAttributes(
  observation: ObservationContext | undefined,
): Record<string, string | number | boolean> {
  if (!observation) {
    return {};
  }
  return {
    "crawclaw.traceId": observation.trace.traceId,
    "crawclaw.spanId": observation.trace.spanId,
    ...(observation.trace.parentSpanId
      ? { "crawclaw.parentSpanId": observation.trace.parentSpanId }
      : {}),
    ...(observation.runtime.runId ? { "crawclaw.runId": observation.runtime.runId } : {}),
    ...(observation.runtime.sessionId
      ? { "crawclaw.sessionId": observation.runtime.sessionId }
      : {}),
    ...(observation.runtime.sessionKey
      ? { "crawclaw.sessionKey": observation.runtime.sessionKey }
      : {}),
    ...(observation.runtime.agentId ? { "crawclaw.agentId": observation.runtime.agentId } : {}),
    ...(observation.runtime.parentAgentId
      ? { "crawclaw.parentAgentId": observation.runtime.parentAgentId }
      : {}),
    ...(observation.runtime.taskId ? { "crawclaw.taskId": observation.runtime.taskId } : {}),
    ...(observation.runtime.workflowRunId
      ? { "crawclaw.workflowRunId": observation.runtime.workflowRunId }
      : {}),
    ...(observation.runtime.workflowStepId
      ? { "crawclaw.workflowStepId": observation.runtime.workflowStepId }
      : {}),
    ...(observation.phase ? { "crawclaw.lifecycle.phase": observation.phase } : {}),
    ...(observation.decisionCode ? { "crawclaw.decisionCode": observation.decisionCode } : {}),
    "crawclaw.observation.source": observation.source,
  };
}

export function observationToMetricAttributes(
  observation: ObservationContext | undefined,
): Record<string, string | number | boolean> {
  if (!observation) {
    return {};
  }
  return {
    ...(observation.phase ? { "crawclaw.lifecycle.phase": observation.phase } : {}),
    ...(observation.decisionCode ? { "crawclaw.decisionCode": observation.decisionCode } : {}),
    "crawclaw.observation.source": observation.source,
  };
}
