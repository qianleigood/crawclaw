import { buildSpecialAgentUsageDetail } from "./observability.js";
import type { SpecialAgentCompletionResult } from "./types.js";

export function buildSpecialAgentRunRefDetail(
  result: Pick<SpecialAgentCompletionResult, "runId" | "childSessionKey">,
): Record<string, unknown> {
  const detail: Record<string, unknown> = {};
  if (typeof result.runId === "string" && result.runId.trim()) {
    detail.childRunId = result.runId;
  }
  if (typeof result.childSessionKey === "string" && result.childSessionKey.trim()) {
    detail.childSessionKey = result.childSessionKey;
  }
  return detail;
}

export function buildSpecialAgentWaitFailureDetail(
  result: Extract<SpecialAgentCompletionResult, { status: "wait_failed" }>,
): Record<string, unknown> {
  return {
    ...buildSpecialAgentRunRefDetail(result),
    ...(typeof result.waitStatus === "string" && result.waitStatus.trim()
      ? { waitStatus: result.waitStatus }
      : {}),
  };
}

export function buildSpecialAgentCompletionDetail(params: {
  result: Extract<SpecialAgentCompletionResult, { status: "completed" }>;
  detail?: Record<string, unknown>;
}): Record<string, unknown> {
  return {
    ...buildSpecialAgentRunRefDetail(params.result),
    ...params.detail,
    endedAt: params.result.endedAt ?? null,
    ...buildSpecialAgentUsageDetail({
      usage: params.result.usage,
      historyMessageCount: params.result.historyMessageCount,
    }),
  };
}
