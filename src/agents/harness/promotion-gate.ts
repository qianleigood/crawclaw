import type { HarnessReport, HarnessReportDiff } from "./report.js";
import { diffHarnessReports } from "./report.js";

export type HarnessPromotionVerdict = "promote" | "shadow" | "reject";

export type HarnessPromotionPolicy = {
  maxAcceptedRegression: number;
  maxIncompleteRegression: number;
  maxBlockedScenarioRegression: number;
  maxBlockedEventRegression: number;
  maxCompletionMismatchRegression: number;
  maxAvgToolCallsRegression: number;
};

export type HarnessPromotionDecision = {
  verdict: HarnessPromotionVerdict;
  reasons: string[];
  diff: HarnessReportDiff;
};

const DEFAULT_PROMOTION_POLICY: HarnessPromotionPolicy = {
  maxAcceptedRegression: 0,
  maxIncompleteRegression: 0,
  maxBlockedScenarioRegression: 0,
  maxBlockedEventRegression: 0,
  maxCompletionMismatchRegression: 0,
  maxAvgToolCallsRegression: 0.25,
};

function normalizePromotionPolicy(
  policy: Partial<HarnessPromotionPolicy> | undefined,
): HarnessPromotionPolicy {
  return {
    maxAcceptedRegression:
      policy?.maxAcceptedRegression ?? DEFAULT_PROMOTION_POLICY.maxAcceptedRegression,
    maxIncompleteRegression:
      policy?.maxIncompleteRegression ?? DEFAULT_PROMOTION_POLICY.maxIncompleteRegression,
    maxBlockedScenarioRegression:
      policy?.maxBlockedScenarioRegression ?? DEFAULT_PROMOTION_POLICY.maxBlockedScenarioRegression,
    maxBlockedEventRegression:
      policy?.maxBlockedEventRegression ?? DEFAULT_PROMOTION_POLICY.maxBlockedEventRegression,
    maxCompletionMismatchRegression:
      policy?.maxCompletionMismatchRegression ??
      DEFAULT_PROMOTION_POLICY.maxCompletionMismatchRegression,
    maxAvgToolCallsRegression:
      policy?.maxAvgToolCallsRegression ?? DEFAULT_PROMOTION_POLICY.maxAvgToolCallsRegression,
  };
}

function hasPositiveImprovement(diff: HarnessReportDiff): boolean {
  return (
    diff.delta.acceptedCount > 0 ||
    diff.delta.incompleteCount < 0 ||
    diff.delta.blockedScenarioCount < 0 ||
    diff.delta.blockedEventCount < 0 ||
    diff.delta.completionMismatchCount < 0 ||
    diff.delta.avgToolCallsPerScenario < 0
  );
}

export function evaluateHarnessPromotion(params: {
  baseline: HarnessReport;
  candidate: HarnessReport;
  policy?: Partial<HarnessPromotionPolicy>;
}): HarnessPromotionDecision {
  const policy = normalizePromotionPolicy(params.policy);
  const diff = diffHarnessReports({
    baseline: params.baseline,
    candidate: params.candidate,
  });
  const reasons: string[] = [];

  if (-diff.delta.acceptedCount > policy.maxAcceptedRegression) {
    reasons.push(
      `Accepted completions regressed by ${-diff.delta.acceptedCount} (max ${policy.maxAcceptedRegression}).`,
    );
  }
  if (diff.delta.incompleteCount > policy.maxIncompleteRegression) {
    reasons.push(
      `Incomplete completions increased by ${diff.delta.incompleteCount} (max ${policy.maxIncompleteRegression}).`,
    );
  }
  if (diff.delta.blockedScenarioCount > policy.maxBlockedScenarioRegression) {
    reasons.push(
      `Blocked scenarios increased by ${diff.delta.blockedScenarioCount} (max ${policy.maxBlockedScenarioRegression}).`,
    );
  }
  if (diff.delta.blockedEventCount > policy.maxBlockedEventRegression) {
    reasons.push(
      `Blocked loop events increased by ${diff.delta.blockedEventCount} (max ${policy.maxBlockedEventRegression}).`,
    );
  }
  if (diff.delta.completionMismatchCount > policy.maxCompletionMismatchRegression) {
    reasons.push(
      `Completion mismatches increased by ${diff.delta.completionMismatchCount} (max ${policy.maxCompletionMismatchRegression}).`,
    );
  }
  if (diff.delta.avgToolCallsPerScenario > policy.maxAvgToolCallsRegression) {
    reasons.push(
      `Average tool calls per scenario increased by ${diff.delta.avgToolCallsPerScenario.toFixed(2)} (max ${policy.maxAvgToolCallsRegression.toFixed(2)}).`,
    );
  }

  if (reasons.length > 0) {
    return {
      verdict: "reject",
      reasons,
      diff,
    };
  }

  if (hasPositiveImprovement(diff)) {
    return {
      verdict: "promote",
      reasons: [
        "Candidate improves at least one tracked harness metric without regressing guarded thresholds.",
      ],
      diff,
    };
  }

  return {
    verdict: "shadow",
    reasons: [
      "Candidate stays within guardrails but does not materially improve tracked harness metrics.",
    ],
    diff,
  };
}
