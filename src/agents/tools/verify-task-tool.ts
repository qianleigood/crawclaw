import { Type } from "@sinclair/typebox";
import type { GatewayMessageChannel } from "../../utils/message-channel.js";
import { emitAgentActionEvent } from "../action-feed/emit.js";
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
  buildVerificationSystemPrompt,
  buildVerificationTaskPrompt,
  parseVerificationReport,
  VERIFICATION_AGENT_DEFINITION,
  VERIFICATION_SPAWN_SOURCE,
} from "../verification-agent.js";
import {
  jsonResult,
  readNumberParam,
  readStringArrayParam,
  readStringParam,
  ToolInputError,
  type AnyAgentTool,
} from "./common.js";

type VerifyTaskToolDeps = SpecialAgentRuntimeDeps;

function createDefaultVerifyTaskToolDeps(): VerifyTaskToolDeps {
  return defaultSpecialAgentRuntimeDeps;
}

let verifyTaskToolDeps: VerifyTaskToolDeps | undefined;

function resolveVerifyTaskToolDeps(): VerifyTaskToolDeps {
  if (!verifyTaskToolDeps) {
    verifyTaskToolDeps = createDefaultVerifyTaskToolDeps();
  }
  return verifyTaskToolDeps;
}

const VerifyTaskToolSchema = Type.Object({
  task: Type.String({
    description: "Original task or claimed fix to verify.",
  }),
  approach: Type.Optional(
    Type.String({
      description: "Optional summary of the implementation approach that should be checked.",
    }),
  ),
  changedFiles: Type.Optional(
    Type.Array(Type.String(), {
      description: "Optional list of changed files that the verifier should inspect first.",
    }),
  ),
  validationFocus: Type.Optional(
    Type.Array(Type.String(), {
      description: "Optional high-priority checks the verifier should focus on.",
    }),
  ),
  planPath: Type.Optional(
    Type.String({
      description: "Optional repo-relative plan or spec path to inspect during verification.",
    }),
  ),
  agentId: Type.Optional(
    Type.String({
      description: "Optional target verifier agent id for runtime=subagent.",
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

function emitVerificationParentAction(params: {
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
    runId: `verification:${params.toolCallId}`,
    actionId: `verification:${params.toolCallId}`,
    kind: "verification",
    sessionKey: normalizeOptionalString(params.sessionKey),
    agentId: normalizeOptionalString(params.agentId),
    status: params.status,
    title: params.title,
    summary: normalizeOptionalString(params.summary),
    detail: params.detail,
  });
}

function buildVerificationDetail(
  report: ReturnType<typeof parseVerificationReport>,
): Record<string, unknown> {
  const passCount = report.checks.filter((entry) => entry.status === "PASS").length;
  const failCount = report.checks.filter((entry) => entry.status === "FAIL").length;
  const warnCount = report.checks.filter((entry) => entry.status === "WARN").length;
  return {
    ...(report.verdict ? { verdict: report.verdict } : {}),
    ...(report.summary ? { verificationSummary: report.summary } : {}),
    checks: report.checks,
    checkCounts: {
      pass: passCount,
      fail: failCount,
      warn: warnCount,
    },
    failingCommands: report.failingCommands,
    warnings: report.warnings,
    artifacts: report.artifacts,
  };
}

export function createVerifyTaskTool(
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
    label: "Verify Task",
    name: "verify_task",
    description:
      "Spawn a dedicated verification subagent that tries to break or disprove the current implementation, then return a strict PASS/FAIL/PARTIAL report.",
    parameters: VerifyTaskToolSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const task = readStringParam(params, "task", { required: true });
      const approach = readStringParam(params, "approach");
      const changedFiles = readStringArrayParam(params, "changedFiles");
      const validationFocus = readStringArrayParam(params, "validationFocus");
      const planPath = readStringParam(params, "planPath");
      const agentId = readStringParam(params, "agentId");
      const model = readStringParam(params, "model");
      const thinking = readStringParam(params, "thinking");
      const runTimeoutSeconds = readNumberParam(params, "runTimeoutSeconds", { integer: true });

      const verificationTask = buildVerificationTaskPrompt({
        task,
        approach,
        changedFiles,
        validationFocus,
        planPath,
      });
      emitVerificationParentAction({
        toolCallId: _toolCallId,
        sessionKey: opts?.agentSessionKey,
        agentId: opts?.requesterAgentIdOverride,
        status: "started",
        title: "Verification started",
        summary: task,
        detail: {
          ...(changedFiles?.length ? { changedFiles } : {}),
          ...(validationFocus?.length ? { validationFocus } : {}),
          ...(planPath ? { planPath } : {}),
        },
      });
      const result = await runSpecialAgentToCompletion(
        {
          definition: VERIFICATION_AGENT_DEFINITION,
          task: verificationTask,
          extraSystemPrompt: buildVerificationSystemPrompt(),
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
        resolveVerifyTaskToolDeps(),
      );

      if (result.status === "spawn_failed") {
        emitVerificationParentAction({
          toolCallId: _toolCallId,
          sessionKey: opts?.agentSessionKey,
          agentId: opts?.requesterAgentIdOverride,
          status: "failed",
          title: "Verification failed to start",
          summary: result.error,
          detail: buildSpecialAgentRunRefDetail(result),
        });
        return jsonResult({
          status: "error",
          error: result.error,
          childSessionKey: result.childSessionKey ?? null,
          runId: result.runId ?? null,
        });
      }

      emitVerificationParentAction({
        toolCallId: _toolCallId,
        sessionKey: opts?.agentSessionKey,
        agentId: opts?.requesterAgentIdOverride,
        status: "running",
        title: "Verification running",
        summary: task,
        detail: buildSpecialAgentRunRefDetail(result),
      });

      if (result.status === "wait_failed") {
        emitVerificationParentAction({
          toolCallId: _toolCallId,
          sessionKey: opts?.agentSessionKey,
          agentId: opts?.requesterAgentIdOverride,
          status: "failed",
          title: "Verification did not complete",
          summary: result.error,
          detail: buildSpecialAgentWaitFailureDetail(result),
        });
        return jsonResult({
          status: result.waitStatus === "timeout" ? "timeout" : "error",
          error: result.error,
          childSessionKey: result.childSessionKey,
          runId: result.runId,
        });
      }

      const reply = result.reply;
      if (!reply?.trim()) {
        throw new ToolInputError("verification agent completed without a final report");
      }
      const parsed = parseVerificationReport(reply);
      if (!parsed.verdict) {
        emitVerificationParentAction({
          toolCallId: _toolCallId,
          sessionKey: opts?.agentSessionKey,
          agentId: opts?.requesterAgentIdOverride,
          status: "failed",
          title: "Verification report invalid",
          summary: "verification agent completed without a VERDICT line",
          detail: buildSpecialAgentRunRefDetail(result),
        });
        throw new ToolInputError(
          "verification agent completed without a VERDICT: PASS|FAIL|PARTIAL line",
        );
      }

      emitVerificationParentAction({
        toolCallId: _toolCallId,
        sessionKey: opts?.agentSessionKey,
        agentId: opts?.requesterAgentIdOverride,
        status:
          parsed.verdict === "PASS"
            ? "completed"
            : parsed.verdict === "PARTIAL"
              ? "waiting"
              : "blocked",
        title: `Verification ${parsed.verdict}`,
        summary: parsed.summary ?? null,
        detail: buildSpecialAgentCompletionDetail({
          result,
          detail: buildVerificationDetail(parsed),
        }),
      });

      return jsonResult({
        status: "completed",
        verdict: parsed.verdict,
        summary: parsed.summary ?? null,
        checks: parsed.checks,
        failingCommands: parsed.failingCommands,
        warnings: parsed.warnings,
        artifacts: parsed.artifacts,
        report: reply,
        childSessionKey: result.childSessionKey,
        runId: result.runId,
        spawnSource: VERIFICATION_SPAWN_SOURCE,
        endedAt: result.endedAt ?? null,
      });
    },
  };
}

export const __testing = {
  setDepsForTest(overrides?: Partial<VerifyTaskToolDeps>) {
    verifyTaskToolDeps = overrides
      ? {
          ...createDefaultVerifyTaskToolDeps(),
          ...overrides,
        }
      : createDefaultVerifyTaskToolDeps();
  },
};
