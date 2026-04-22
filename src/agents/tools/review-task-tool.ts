import { Type } from "@sinclair/typebox";
import type { GatewayMessageChannel } from "../../utils/message-channel.js";
import { emitAgentActionEvent } from "../action-feed/emit.js";
import {
  aggregateReviewVerdict,
  buildReviewStageSystemPrompt,
  buildReviewStageTaskPrompt,
  parseReviewStageReport,
  REVIEW_QUALITY_AGENT_DEFINITION,
  REVIEW_SPEC_AGENT_DEFINITION,
  type ReviewAggregateResult,
  type ReviewStage,
  type ReviewStageReport,
} from "../review-agent.js";
import type { SpawnedToolContext } from "../spawned-context.js";
import { emitSpecialAgentActionEvent } from "../special/runtime/action-feed.js";
import {
  buildSpecialAgentCompletionDetail,
  buildSpecialAgentRunRefDetail,
  buildSpecialAgentWaitFailureDetail,
} from "../special/runtime/result-detail.js";
import {
  defaultSpecialAgentRuntimeDeps,
  runSpecialAgentToCompletion,
  type SpecialAgentRuntimeDeps,
} from "../special/runtime/run-once.js";
import {
  jsonResult,
  readNumberParam,
  readStringArrayParam,
  readStringParam,
  type AnyAgentTool,
} from "./common.js";

type ReviewTaskToolDeps = SpecialAgentRuntimeDeps & {
  emitAgentActionEvent: typeof emitAgentActionEvent;
};

function createDefaultReviewTaskToolDeps(): ReviewTaskToolDeps {
  return {
    ...defaultSpecialAgentRuntimeDeps,
    emitAgentActionEvent,
  };
}

let reviewTaskToolDeps: ReviewTaskToolDeps | undefined;

function resolveReviewTaskToolDeps(): ReviewTaskToolDeps {
  if (!reviewTaskToolDeps) {
    reviewTaskToolDeps = createDefaultReviewTaskToolDeps();
  }
  return reviewTaskToolDeps;
}

const ReviewTaskToolSchema = Type.Object({
  task: Type.String({
    description: "Original task or claimed implementation to review.",
  }),
  approach: Type.Optional(
    Type.String({
      description: "Optional summary of the implementation approach that should be reviewed.",
    }),
  ),
  changedFiles: Type.Optional(
    Type.Array(Type.String(), {
      description: "Optional list of changed files reviewers should inspect first.",
    }),
  ),
  reviewFocus: Type.Optional(
    Type.Array(Type.String(), {
      description: "Optional high-priority review focus areas.",
    }),
  ),
  planPath: Type.Optional(
    Type.String({
      description: "Optional repo-relative plan or spec path to inspect during review.",
    }),
  ),
  model: Type.Optional(Type.String()),
  thinking: Type.Optional(Type.String()),
  runTimeoutSeconds: Type.Optional(Type.Number({ minimum: 0 })),
});

type ReviewChildRun = {
  stage: ReviewStage;
  childSessionKey?: string;
  runId?: string;
  spawnSource: string;
  endedAt?: number | null;
};

type StageRunResult =
  | { ok: true; report: ReviewStageReport; completionDetail: Record<string, unknown> }
  | {
      ok: false;
      status: "error" | "timeout";
      error: string;
      childSessionKey?: string;
      runId?: string;
      detail?: Record<string, unknown>;
    };

function normalizeOptionalString(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function emitReviewParentAction(params: {
  toolCallId: string;
  sessionKey?: string;
  agentId?: string;
  status: "started" | "running" | "completed" | "waiting" | "blocked" | "failed";
  title: string;
  summary?: string | null;
  detail?: Record<string, unknown>;
}) {
  emitSpecialAgentActionEvent({
    emitAgentActionEvent: resolveReviewTaskToolDeps().emitAgentActionEvent,
    runId: `review:${params.toolCallId}`,
    actionId: `review:${params.toolCallId}`,
    kind: "review",
    sessionKey: normalizeOptionalString(params.sessionKey),
    agentId: normalizeOptionalString(params.agentId),
    status: params.status,
    title: params.title,
    summary: normalizeOptionalString(params.summary),
    detail: params.detail,
  });
}

function definitionForStage(stage: ReviewStage) {
  return stage === "spec" ? REVIEW_SPEC_AGENT_DEFINITION : REVIEW_QUALITY_AGENT_DEFINITION;
}

function titleForStage(stage: ReviewStage): string {
  return stage === "spec" ? "Spec compliance review" : "Code quality review";
}

function statusForStage(report: ReviewStageReport) {
  if (report.verdict === "PASS" && report.valid) {
    return "completed" as const;
  }
  if (report.verdict === "FAIL") {
    return "blocked" as const;
  }
  return "waiting" as const;
}

function buildReviewDetail(report: ReviewAggregateResult): Record<string, unknown> {
  return {
    verdict: report.verdict,
    summary: report.summary,
    spec: report.spec,
    ...(report.quality ? { quality: report.quality } : {}),
    skippedStages: report.skippedStages,
    blockingIssues: report.blockingIssues,
    warnings: report.warnings,
    evidence: report.evidence,
    recommendedFixes: report.recommendedFixes,
  };
}

export function createReviewTaskTool(
  opts?: {
    agentSessionKey?: string;
    agentChannel?: GatewayMessageChannel;
    agentAccountId?: string;
    agentTo?: string;
    agentThreadId?: string | number;
    sandboxed?: boolean;
    requesterAgentIdOverride?: string;
  } & SpawnedToolContext,
): AnyAgentTool {
  return {
    label: "Review Task",
    name: "review_task",
    description:
      "Run a two-stage independent review pipeline: spec compliance first, then code quality, returning REVIEW_PASS/REVIEW_FAIL/REVIEW_PARTIAL.",
    parameters: ReviewTaskToolSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const task = readStringParam(params, "task", { required: true });
      const approach = readStringParam(params, "approach");
      const changedFiles = readStringArrayParam(params, "changedFiles");
      const reviewFocus = readStringArrayParam(params, "reviewFocus");
      const planPath = readStringParam(params, "planPath");
      const model = readStringParam(params, "model");
      const thinking = readStringParam(params, "thinking");
      const runTimeoutSeconds = readNumberParam(params, "runTimeoutSeconds", { integer: true });
      const childRuns: ReviewChildRun[] = [];

      emitReviewParentAction({
        toolCallId: _toolCallId,
        sessionKey: opts?.agentSessionKey,
        agentId: opts?.requesterAgentIdOverride,
        status: "started",
        title: "Review started",
        summary: task,
        detail: {
          ...(changedFiles?.length ? { changedFiles } : {}),
          ...(reviewFocus?.length ? { reviewFocus } : {}),
          ...(planPath ? { planPath } : {}),
        },
      });

      const runStage = async (
        stage: ReviewStage,
        specReport?: ReviewStageReport,
      ): Promise<StageRunResult> => {
        const stageTask = buildReviewStageTaskPrompt({
          stage,
          task,
          approach,
          changedFiles,
          reviewFocus,
          planPath,
          specReport,
        });
        emitReviewParentAction({
          toolCallId: _toolCallId,
          sessionKey: opts?.agentSessionKey,
          agentId: opts?.requesterAgentIdOverride,
          status: "running",
          title: `${titleForStage(stage)} running`,
          summary: task,
        });
        const result = await runSpecialAgentToCompletion(
          {
            definition: definitionForStage(stage),
            task: stageTask,
            extraSystemPrompt: buildReviewStageSystemPrompt(stage),
            spawnContext: {
              agentSessionKey: opts?.agentSessionKey,
              agentChannel: opts?.agentChannel,
              agentAccountId: opts?.agentAccountId,
              agentTo: opts?.agentTo,
              agentThreadId: opts?.agentThreadId,
              agentGroupId: opts?.agentGroupId,
              agentGroupChannel: opts?.agentGroupChannel,
              agentGroupSpace: opts?.agentGroupSpace,
              requesterAgentIdOverride: opts?.requesterAgentIdOverride,
              sandboxed: opts?.sandboxed,
              workspaceDir: opts?.workspaceDir,
            },
            spawnOverrides: {
              ...(model ? { model } : {}),
              ...(thinking ? { thinking } : {}),
              ...(typeof runTimeoutSeconds === "number" ? { runTimeoutSeconds } : {}),
            },
          },
          resolveReviewTaskToolDeps(),
        );

        if (result.status === "spawn_failed") {
          return {
            ok: false,
            status: "error",
            error: result.error,
            childSessionKey: result.childSessionKey ?? undefined,
            runId: result.runId ?? undefined,
            detail: buildSpecialAgentRunRefDetail(result),
          };
        }

        childRuns.push({
          stage,
          childSessionKey: result.childSessionKey,
          runId: result.runId,
          spawnSource: definitionForStage(stage).spawnSource,
          endedAt: result.endedAt ?? null,
        });

        if (result.status === "wait_failed") {
          return {
            ok: false,
            status: result.waitStatus === "timeout" ? "timeout" : "error",
            error: result.error,
            childSessionKey: result.childSessionKey,
            runId: result.runId,
            detail: buildSpecialAgentWaitFailureDetail(result),
          };
        }

        const report = parseReviewStageReport(result.reply ?? "", stage);
        emitReviewParentAction({
          toolCallId: _toolCallId,
          sessionKey: opts?.agentSessionKey,
          agentId: opts?.requesterAgentIdOverride,
          status: statusForStage(report),
          title: report.valid
            ? `${titleForStage(stage)} ${report.verdict}`
            : `${titleForStage(stage)} invalid/partial`,
          summary: report.summary,
          detail: buildSpecialAgentCompletionDetail({
            result,
            detail: {
              stage,
              report,
            },
          }),
        });
        return {
          ok: true,
          report,
          completionDetail: buildSpecialAgentCompletionDetail({
            result,
            detail: { stage, report },
          }),
        };
      };

      const specResult = await runStage("spec");
      if (!specResult.ok) {
        emitReviewParentAction({
          toolCallId: _toolCallId,
          sessionKey: opts?.agentSessionKey,
          agentId: opts?.requesterAgentIdOverride,
          status: "failed",
          title: "Review did not complete",
          summary: specResult.error,
          detail: specResult.detail,
        });
        return jsonResult({
          status: specResult.status,
          error: specResult.error,
          childRuns,
        });
      }

      let qualityResult: StageRunResult | undefined;
      if (specResult.report.verdict === "FAIL") {
        emitReviewParentAction({
          toolCallId: _toolCallId,
          sessionKey: opts?.agentSessionKey,
          agentId: opts?.requesterAgentIdOverride,
          status: "blocked",
          title: "Code quality review skipped",
          summary: "Spec compliance review failed.",
          detail: { skippedStage: "quality" },
        });
      } else {
        qualityResult = await runStage("quality", specResult.report);
        if (!qualityResult.ok) {
          emitReviewParentAction({
            toolCallId: _toolCallId,
            sessionKey: opts?.agentSessionKey,
            agentId: opts?.requesterAgentIdOverride,
            status: "failed",
            title: "Review did not complete",
            summary: qualityResult.error,
            detail: qualityResult.detail,
          });
          return jsonResult({
            status: qualityResult.status,
            error: qualityResult.error,
            childRuns,
          });
        }
      }

      const review = aggregateReviewVerdict({
        spec: specResult.report,
        ...(qualityResult?.ok ? { quality: qualityResult.report } : {}),
      });
      const finalStatus =
        review.verdict === "REVIEW_PASS"
          ? "completed"
          : review.verdict === "REVIEW_PARTIAL"
            ? "waiting"
            : "blocked";
      emitReviewParentAction({
        toolCallId: _toolCallId,
        sessionKey: opts?.agentSessionKey,
        agentId: opts?.requesterAgentIdOverride,
        status: finalStatus,
        title:
          review.verdict === "REVIEW_PASS"
            ? "Review PASS"
            : review.verdict === "REVIEW_PARTIAL"
              ? "Review PARTIAL"
              : "Review FAIL",
        summary: review.summary,
        detail: {
          ...buildReviewDetail(review),
          childRuns,
        },
      });

      return jsonResult({
        status: "completed",
        verdict: review.verdict,
        summary: review.summary,
        spec: review.spec,
        ...(review.quality ? { quality: review.quality } : {}),
        skippedStages: review.skippedStages,
        blockingIssues: review.blockingIssues,
        warnings: review.warnings,
        evidence: review.evidence,
        recommendedFixes: review.recommendedFixes,
        childRuns,
        spawnSource: "review",
      });
    },
  };
}

export const __testing = {
  setDepsForTest(overrides?: Partial<ReviewTaskToolDeps>) {
    reviewTaskToolDeps = overrides
      ? {
          ...createDefaultReviewTaskToolDeps(),
          ...overrides,
        }
      : createDefaultReviewTaskToolDeps();
  },
};
