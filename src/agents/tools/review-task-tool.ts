import { Type } from "@sinclair/typebox";
import type { GatewayMessageChannel } from "../../utils/message-channel.js";
import { emitAgentActionEvent } from "../action-feed/emit.js";
import {
  aggregateReviewReports,
  buildReviewStageSystemPrompt,
  buildReviewStageTaskPrompt,
  parseReviewStageReport,
  REVIEW_QUALITY_AGENT_DEFINITION,
  REVIEW_SPEC_AGENT_DEFINITION,
  type ReviewPipelineReport,
  type ReviewStage,
  type ReviewStageReport,
} from "../review-agent.js";
import type { SpawnedToolContext } from "../spawned-context.js";
import { emitSpecialAgentActionEvent } from "../special/runtime/action-feed.js";
import { buildSpecialAgentRunRefDetail } from "../special/runtime/result-detail.js";
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
  ToolInputError,
  type AnyAgentTool,
} from "./common.js";

type ReviewTaskToolDeps = SpecialAgentRuntimeDeps;

function createDefaultReviewTaskToolDeps(): ReviewTaskToolDeps {
  return defaultSpecialAgentRuntimeDeps;
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
      description: "Optional list of changed files that reviewers should inspect first.",
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
  agentId: Type.Optional(
    Type.String({
      description: "Optional target review agent id for runtime=subagent.",
    }),
  ),
  model: Type.Optional(Type.String()),
  thinking: Type.Optional(Type.String()),
  runTimeoutSeconds: Type.Optional(Type.Number({ minimum: 0 })),
});

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
    emitAgentActionEvent,
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

function buildReviewDetail(report: ReviewPipelineReport): Record<string, unknown> {
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

function definitionForStage(stage: ReviewStage) {
  return stage === "spec" ? REVIEW_SPEC_AGENT_DEFINITION : REVIEW_QUALITY_AGENT_DEFINITION;
}

function titleForStage(stage: ReviewStage): string {
  return stage === "spec" ? "Spec compliance review" : "Code quality review";
}

type ReviewChildRun = {
  stage: ReviewStage;
  childSessionKey?: string;
  runId?: string;
  endedAt?: number | null;
};

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
      const agentId = readStringParam(params, "agentId");
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
      ): Promise<
        | { ok: true; report: ReviewStageReport }
        | {
            ok: false;
            status: "error" | "timeout";
            error: string;
            childSessionKey?: string;
            runId?: string;
          }
      > => {
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
              ...(agentId ? { agentId } : {}),
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
          };
        }

        childRuns.push({
          stage,
          childSessionKey: result.childSessionKey,
          runId: result.runId,
          endedAt: result.endedAt ?? null,
        });
        emitReviewParentAction({
          toolCallId: _toolCallId,
          sessionKey: opts?.agentSessionKey,
          agentId: opts?.requesterAgentIdOverride,
          status: "running",
          title: `${titleForStage(stage)} waiting`,
          summary: task,
          detail: buildSpecialAgentRunRefDetail(result),
        });

        if (result.status === "wait_failed") {
          return {
            ok: false,
            status: result.waitStatus === "timeout" ? "timeout" : "error",
            error: result.error,
            childSessionKey: result.childSessionKey,
            runId: result.runId,
          };
        }

        const reply = result.reply;
        if (!reply?.trim()) {
          throw new ToolInputError(`${stage} review agent completed without a final report`);
        }
        const report = parseReviewStageReport(reply, { fallbackStage: stage });
        return { ok: true, report };
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
          detail: {
            ...(specResult.runId ? { childRunId: specResult.runId } : {}),
            ...(specResult.childSessionKey ? { childSessionKey: specResult.childSessionKey } : {}),
            waitStatus: specResult.status === "timeout" ? "timeout" : "error",
          },
        });
        return jsonResult({
          status: specResult.status,
          error: specResult.error,
          childRuns,
        });
      }

      const qualityResult =
        specResult.report.verdict === "FAIL"
          ? undefined
          : await runStage("quality", specResult.report);
      if (qualityResult && !qualityResult.ok) {
        emitReviewParentAction({
          toolCallId: _toolCallId,
          sessionKey: opts?.agentSessionKey,
          agentId: opts?.requesterAgentIdOverride,
          status: "failed",
          title: "Review did not complete",
          summary: qualityResult.error,
        });
        return jsonResult({
          status: qualityResult.status,
          error: qualityResult.error,
          childRuns,
        });
      }

      const pipelineReport = aggregateReviewReports({
        spec: specResult.report,
        ...(qualityResult?.ok ? { quality: qualityResult.report } : {}),
      });
      emitReviewParentAction({
        toolCallId: _toolCallId,
        sessionKey: opts?.agentSessionKey,
        agentId: opts?.requesterAgentIdOverride,
        status:
          pipelineReport.verdict === "REVIEW_PASS"
            ? "completed"
            : pipelineReport.verdict === "REVIEW_PARTIAL"
              ? "waiting"
              : "blocked",
        title:
          pipelineReport.verdict === "REVIEW_PASS"
            ? "Review PASS"
            : pipelineReport.verdict === "REVIEW_PARTIAL"
              ? "Review PARTIAL"
              : "Review FAIL",
        summary: pipelineReport.summary,
        detail: {
          ...((childRuns.at(-1)?.runId ?? childRuns[0]?.runId)
            ? { childRunId: childRuns.at(-1)?.runId ?? childRuns[0]?.runId }
            : {}),
          ...((childRuns.at(-1)?.childSessionKey ?? childRuns[0]?.childSessionKey)
            ? {
                childSessionKey: childRuns.at(-1)?.childSessionKey ?? childRuns[0]?.childSessionKey,
              }
            : {}),
          endedAt: childRuns.at(-1)?.endedAt ?? null,
          ...buildReviewDetail(pipelineReport),
        },
      });

      return jsonResult({
        status: "completed",
        verdict: pipelineReport.verdict,
        summary: pipelineReport.summary,
        spec: pipelineReport.spec,
        quality: pipelineReport.quality ?? null,
        skippedStages: pipelineReport.skippedStages,
        blockingIssues: pipelineReport.blockingIssues,
        warnings: pipelineReport.warnings,
        evidence: pipelineReport.evidence,
        recommendedFixes: pipelineReport.recommendedFixes,
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
