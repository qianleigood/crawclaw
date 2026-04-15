import { loadConfig } from "../../config/config.js";
import { normalizeDeliveryContext } from "../../utils/delivery-context.js";
import { spawnAcpDirect, type SpawnAcpParams, type SpawnAcpResult } from "../acp-spawn.js";
import type { AgentStreamParams } from "../command/types.js";
import { registerSubagentRun } from "../subagent-registry.js";
import {
  spawnSubagentDirect,
  type SpawnSubagentParams,
  type SpawnSubagentResult,
} from "../subagent-spawn.js";
import {
  resolveDisplaySessionKey,
  resolveInternalSessionKey,
  resolveMainSessionAlias,
} from "../tools/sessions-helpers.js";
import {
  normalizeAgentSpawnContext,
  toAcpSpawnContext,
  toSubagentSpawnContext,
  type AgentSpawnToolContext,
} from "./subagent-context.js";

export type SpawnSessionRuntime = "subagent" | "acp";

export type SpawnAgentSessionParams = {
  runtime?: SpawnSessionRuntime;
  task: string;
  label?: string;
  agentId?: string;
  resumeSessionId?: string;
  model?: string;
  thinking?: string;
  cwd?: string;
  runTimeoutSeconds?: number;
  maxTurns?: number;
  thread?: boolean;
  mode?: "run" | "session";
  cleanup?: "delete" | "keep";
  sandbox?: "inherit" | "require";
  streamTo?: "parent";
  extraSystemPrompt?: string;
  spawnSource?: string;
  durableMemoryScope?: SpawnSubagentParams["durableMemoryScope"];
  expectsCompletionMessage?: boolean;
  attachments?: SpawnSubagentParams["attachments"];
  attachMountPath?: string;
  streamParams?: AgentStreamParams;
};

export type SpawnAgentSessionResult = SpawnSubagentResult | SpawnAcpResult;

function summarizeError(err: unknown): string {
  if (err instanceof Error) {
    return err.message;
  }
  if (typeof err === "string") {
    return err;
  }
  return "error";
}

function resolveTrackedSpawnMode(params: {
  requestedMode?: "run" | "session";
  threadRequested: boolean;
}): "run" | "session" {
  if (params.requestedMode === "run" || params.requestedMode === "session") {
    return params.requestedMode;
  }
  return params.threadRequested ? "session" : "run";
}

async function cleanupUntrackedAcpSession(sessionKey: string): Promise<void> {
  const key = sessionKey.trim();
  if (!key) {
    return;
  }
  try {
    const { callGateway } = await import("../../gateway/call.js");
    await callGateway({
      method: "sessions.delete",
      params: {
        key,
        deleteTranscript: true,
        emitLifecycleHooks: false,
      },
      timeoutMs: 10_000,
    });
  } catch {
    // Best-effort cleanup only.
  }
}

function resolveSubagentParams(params: SpawnAgentSessionParams): SpawnSubagentParams {
  return {
    task: params.task,
    ...(params.label ? { label: params.label } : {}),
    ...(params.agentId ? { agentId: params.agentId } : {}),
    ...(params.model ? { model: params.model } : {}),
    ...(params.thinking ? { thinking: params.thinking } : {}),
    ...(typeof params.runTimeoutSeconds === "number"
      ? { runTimeoutSeconds: params.runTimeoutSeconds }
      : {}),
    ...(typeof params.maxTurns === "number" ? { maxTurns: params.maxTurns } : {}),
    ...(params.thread === true ? { thread: true } : {}),
    ...(params.mode ? { mode: params.mode } : {}),
    ...(params.cleanup ? { cleanup: params.cleanup } : {}),
    ...(params.sandbox ? { sandbox: params.sandbox } : {}),
    ...(params.extraSystemPrompt ? { extraSystemPrompt: params.extraSystemPrompt } : {}),
    ...(params.spawnSource ? { spawnSource: params.spawnSource } : {}),
    ...(params.durableMemoryScope ? { durableMemoryScope: params.durableMemoryScope } : {}),
    ...(params.attachments ? { attachments: params.attachments } : {}),
    ...(params.attachMountPath ? { attachMountPath: params.attachMountPath } : {}),
    ...(params.streamParams ? { streamParams: params.streamParams } : {}),
    expectsCompletionMessage: params.expectsCompletionMessage !== false,
  };
}

function resolveAcpParams(params: SpawnAgentSessionParams): SpawnAcpParams {
  return {
    task: params.task,
    ...(params.label ? { label: params.label } : {}),
    ...(params.agentId ? { agentId: params.agentId } : {}),
    ...(params.resumeSessionId ? { resumeSessionId: params.resumeSessionId } : {}),
    ...(params.cwd ? { cwd: params.cwd } : {}),
    ...(params.mode ? { mode: params.mode } : {}),
    ...(params.thread === true ? { thread: true } : {}),
    ...(params.sandbox ? { sandbox: params.sandbox } : {}),
    ...(params.streamTo ? { streamTo: params.streamTo } : {}),
  };
}

async function maybeRegisterTrackedAcpRun(params: {
  result: SpawnAcpResult;
  cleanup?: "delete" | "keep";
  threadRequested: boolean;
  streamTo?: "parent";
  task: string;
  label?: string;
  runTimeoutSeconds?: number;
  ctx: ReturnType<typeof normalizeAgentSpawnContext>;
}): Promise<SpawnAcpResult> {
  const childSessionKey = params.result.childSessionKey?.trim();
  const childRunId = params.result.runId?.trim();
  const shouldTrackViaRegistry =
    params.result.status === "accepted" &&
    Boolean(childSessionKey) &&
    Boolean(childRunId) &&
    params.streamTo !== "parent";
  if (!shouldTrackViaRegistry || !childSessionKey || !childRunId) {
    return params.result;
  }

  const cfg = loadConfig();
  const trackedSpawnMode = resolveTrackedSpawnMode({
    requestedMode: params.result.mode,
    threadRequested: params.threadRequested,
  });
  const trackedCleanup = trackedSpawnMode === "session" ? "keep" : (params.cleanup ?? "keep");
  const { mainKey, alias } = resolveMainSessionAlias(cfg);
  const requesterInternalKey = params.ctx.agentSessionKey
    ? resolveInternalSessionKey({
        key: params.ctx.agentSessionKey,
        alias,
        mainKey,
      })
    : alias;
  const requesterDisplayKey = resolveDisplaySessionKey({
    key: requesterInternalKey,
    alias,
    mainKey,
  });
  const requesterOrigin = normalizeDeliveryContext({
    channel: params.ctx.agentChannel,
    accountId: params.ctx.agentAccountId,
    to: params.ctx.agentTo,
    threadId: params.ctx.agentThreadId,
  });
  try {
    registerSubagentRun({
      runId: childRunId,
      childSessionKey,
      requesterSessionKey: requesterInternalKey,
      requesterOrigin,
      requesterDisplayKey,
      task: params.task,
      taskRuntime: "acp",
      cleanup: trackedCleanup,
      ...(params.label ? { label: params.label } : {}),
      ...(typeof params.runTimeoutSeconds === "number"
        ? { runTimeoutSeconds: params.runTimeoutSeconds }
        : {}),
      expectsCompletionMessage: true,
      spawnMode: trackedSpawnMode,
    });
    return params.result;
  } catch (err) {
    await cleanupUntrackedAcpSession(childSessionKey);
    return {
      status: "error",
      error: `Failed to register ACP run: ${summarizeError(err)}. Cleanup was attempted, but the already-started ACP run may still finish in the background.`,
      childSessionKey,
      runId: childRunId,
    };
  }
}

export async function spawnAgentSessionDirect(
  params: SpawnAgentSessionParams,
  rawCtx?: AgentSpawnToolContext,
): Promise<SpawnAgentSessionResult> {
  const runtime = params.runtime === "acp" ? "acp" : "subagent";
  const ctx = normalizeAgentSpawnContext(rawCtx);
  if (runtime === "acp") {
    const result = await spawnAcpDirect(resolveAcpParams(params), toAcpSpawnContext(ctx));
    return await maybeRegisterTrackedAcpRun({
      result,
      cleanup: params.cleanup,
      threadRequested: params.thread === true,
      streamTo: params.streamTo,
      task: params.task,
      label: params.label,
      runTimeoutSeconds: params.runTimeoutSeconds,
      ctx,
    });
  }
  return await spawnSubagentDirect(resolveSubagentParams(params), toSubagentSpawnContext(ctx));
}
