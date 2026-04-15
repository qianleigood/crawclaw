import {
  buildWorkflowStepCompensationRequest,
  runWorkflowStepAgent,
} from "../agents/workflow-step-agent.js";
import type { PluginRuntime } from "../plugins/runtime/types.js";
import { sleep } from "../utils.js";
import type { WorkflowAgentNodeRequest } from "./agent-node-contract.js";
import {
  attachWorkflowExecutionRemoteRef,
  getWorkflowExecution,
  listWorkflowExecutions,
  updateWorkflowExecutionStepCompensation,
  updateWorkflowExecutionStep,
} from "./executions.js";
import { buildWorkflowExecutionView } from "./status-view.js";
import type { WorkflowStoreContext } from "./store.js";

const EXECUTION_RECORD_WAIT_TIMEOUT_MS = 5_000;
const EXECUTION_RECORD_POLL_MS = 20;

async function waitForWorkflowExecutionRecord(
  context: WorkflowStoreContext,
  request: WorkflowAgentNodeRequest,
  timeoutMs = EXECUTION_RECORD_WAIT_TIMEOUT_MS,
) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (request.localExecutionId?.trim()) {
      const byLocalId = await getWorkflowExecution(context, request.localExecutionId);
      if (byLocalId) {
        return (
          (await attachWorkflowExecutionRemoteRef(context, byLocalId.executionId, {
            n8nExecutionId: request.executionId,
            n8nWorkflowId: byLocalId.n8nWorkflowId,
          })) ?? byLocalId
        );
      }
    }
    const byRemoteId = await getWorkflowExecution(context, request.executionId);
    if (byRemoteId) {
      return byRemoteId;
    }
    const candidates = await listWorkflowExecutions(context, {
      workflowId: request.workflowId,
      limit: 10,
    });
    const unresolved = candidates.find(
      (entry) =>
        !entry.n8nExecutionId &&
        (entry.status === "queued" || entry.status === "running") &&
        !entry.endedAt,
    );
    if (unresolved) {
      return (
        (await attachWorkflowExecutionRemoteRef(context, unresolved.executionId, {
          n8nExecutionId: request.executionId,
          n8nWorkflowId: unresolved.n8nWorkflowId,
        })) ?? unresolved
      );
    }
    await sleep(EXECUTION_RECORD_POLL_MS);
  }
  if (request.localExecutionId?.trim()) {
    const byLocalId = await getWorkflowExecution(context, request.localExecutionId);
    if (byLocalId) {
      return (
        (await attachWorkflowExecutionRemoteRef(context, byLocalId.executionId, {
          n8nExecutionId: request.executionId,
          n8nWorkflowId: byLocalId.n8nWorkflowId,
        })) ?? byLocalId
      );
    }
  }
  return await getWorkflowExecution(context, request.executionId);
}

export async function handleWorkflowAgentNodeCallback(
  context: WorkflowStoreContext,
  params: {
    subagent: PluginRuntime["subagent"];
    request: WorkflowAgentNodeRequest;
  },
) {
  const existing = await waitForWorkflowExecutionRecord(context, params.request);
  if (!existing) {
    throw new Error(
      `workflow execution "${params.request.localExecutionId ?? params.request.executionId}" not found for callback step "${params.request.stepId}"`,
    );
  }

  const running = await updateWorkflowExecutionStep(context, existing.executionId, {
    stepId: params.request.stepId,
    status: "running",
    executor: "crawclaw_agent",
  });

  const ran = await runWorkflowStepAgent(params.subagent, params.request);
  const result =
    ran.result ??
    ({
      status: "failed",
      error:
        ran.waitStatus === "timeout"
          ? "workflow-step-agent timed out before returning a structured result."
          : "workflow-step-agent finished without a structured result.",
      summary:
        ran.waitStatus === "timeout"
          ? "workflow-step-agent timed out."
          : "workflow-step-agent returned no structured result.",
    } as const);

  const finalized = await updateWorkflowExecutionStep(context, existing.executionId, {
    stepId: params.request.stepId,
    status:
      result.status === "succeeded"
        ? "succeeded"
        : result.status === "failed"
          ? "failed"
          : result.status === "cancelled"
            ? "cancelled"
            : "waiting",
    executor: result.status === "waiting_external" ? "n8n_wait" : "crawclaw_agent",
    ...(result.summary ? { summary: result.summary } : {}),
    ...(result.error ? { error: result.error } : {}),
  });

  let compensation:
    | {
        runId: string;
        sessionKey: string;
        waitStatus: "ok" | "error" | "timeout";
        summary?: string;
        error?: string;
      }
    | undefined;

  if (result.status === "failed" && params.request.parallelFailurePolicy === "continue") {
    const compensationRequest = buildWorkflowStepCompensationRequest(params.request, {
      summary: result.summary,
      error: result.error,
    });
    if (compensationRequest) {
      await updateWorkflowExecutionStepCompensation(context, existing.executionId, {
        stepId: params.request.stepId,
        status: "running",
        summary: compensationRequest.goal,
      });
      const compensationRun = await runWorkflowStepAgent(params.subagent, compensationRequest);
      const compensationResult =
        compensationRun.result ??
        ({
          status: "failed",
          error:
            compensationRun.waitStatus === "timeout"
              ? "workflow-step-agent compensation timed out before returning a structured result."
              : "workflow-step-agent compensation finished without a structured result.",
          summary:
            compensationRun.waitStatus === "timeout"
              ? "workflow-step-agent compensation timed out."
              : "workflow-step-agent compensation returned no structured result.",
        } as const);
      await updateWorkflowExecutionStepCompensation(context, existing.executionId, {
        stepId: params.request.stepId,
        status:
          compensationResult.status === "succeeded"
            ? "succeeded"
            : compensationResult.status === "cancelled"
              ? "cancelled"
              : "failed",
        ...(compensationResult.summary ? { summary: compensationResult.summary } : {}),
        ...(compensationResult.error ? { error: compensationResult.error } : {}),
      });
      compensation = {
        runId: compensationRun.runId,
        sessionKey: compensationRun.sessionKey,
        waitStatus: compensationRun.waitStatus,
        ...(compensationResult.summary ? { summary: compensationResult.summary } : {}),
        ...(compensationResult.error ? { error: compensationResult.error } : {}),
      };
    }
  }

  const refreshed = compensation
    ? await getWorkflowExecution(context, existing.executionId)
    : (finalized ?? running ?? existing);

  return {
    runId: ran.runId,
    sessionKey: ran.sessionKey,
    waitStatus: ran.waitStatus,
    ...(ran.waitError ? { waitError: ran.waitError } : {}),
    messages: ran.messages,
    result,
    ...(compensation ? { compensation } : {}),
    execution: buildWorkflowExecutionView({ local: refreshed ?? finalized ?? running ?? existing }),
  };
}
