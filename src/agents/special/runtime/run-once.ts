import { callGateway } from "../../../gateway/call.js";
import { onAgentEvent, type AgentEventPayload } from "../../../infra/agent-events.js";
import {
  spawnAgentSessionDirect,
  type SpawnAgentSessionResult,
} from "../../runtime/spawn-session.js";
import { captureSubagentCompletionReply } from "../../subagent-announce-output.js";
import { normalizeUsage, type NormalizedUsage } from "../../usage.js";
import { resolveSpecialAgentCacheHints } from "./cache-plan.js";
import { resolveMaxTurns, resolveRunTimeoutSeconds } from "./shared.js";
import type {
  SpecialAgentCompletionResult,
  SpecialAgentSpawnRequest,
  SpecialAgentSpawnOverrides,
} from "./types.js";
import { validateSpecialAgentDefinitionContract } from "./types.js";

export type SpecialAgentRuntimeDeps = {
  spawnAgentSessionDirect: typeof spawnAgentSessionDirect;
  captureSubagentCompletionReply: typeof captureSubagentCompletionReply;
  callGateway: typeof callGateway;
  onAgentEvent: typeof onAgentEvent;
} & Record<string, unknown>;

export const defaultSpecialAgentRuntimeDeps: SpecialAgentRuntimeDeps = {
  spawnAgentSessionDirect,
  captureSubagentCompletionReply,
  callGateway,
  onAgentEvent,
};

type AgentWaitResponse = {
  status?: string;
  error?: string;
  endedAt?: number;
};

type ChildHistoryResponse = {
  messages?: unknown[];
};

type RustSpecialAgentResponse = {
  status?: string;
  runId?: string;
  childSessionKey?: string;
  result?: {
    status?: string;
    assistantText?: string;
    payloads?: Array<{ text?: string }>;
    history?: unknown[];
    usage?: unknown;
  };
  summary?: string;
  error?: string;
};

function summarizeSpawnError(result: SpawnAgentSessionResult): string {
  return result.error ?? "failed to start special agent";
}

function summarizeWaitError(wait: AgentWaitResponse): string {
  if (typeof wait.error === "string" && wait.error.trim()) {
    return wait.error.trim();
  }
  if (typeof wait.status === "string" && wait.status.trim()) {
    return wait.status.trim();
  }
  return "special agent did not complete";
}

async function buildSpawnParams(params: SpecialAgentSpawnRequest) {
  const spawnOverrides: SpecialAgentSpawnOverrides = params.spawnOverrides ?? {};
  const runTimeoutSeconds = resolveRunTimeoutSeconds({
    requested: spawnOverrides.runTimeoutSeconds,
    fallback: params.definition.defaultRunTimeoutSeconds,
  });
  const maxTurns = resolveMaxTurns({
    requested: spawnOverrides.maxTurns,
    fallback: params.definition.defaultMaxTurns,
  });
  const transcriptPolicy = params.definition.transcriptPolicy ?? "isolated";
  const isolatedRun = transcriptPolicy === "isolated";
  const streamParams = await resolveSpecialAgentCacheHints(params);

  return {
    runtime: spawnOverrides.runtime ?? params.definition.runtime ?? "subagent",
    task: params.task,
    label: params.definition.label,
    mode: isolatedRun ? "run" : (spawnOverrides.mode ?? params.definition.mode ?? "run"),
    cleanup: spawnOverrides.cleanup ?? params.definition.cleanup ?? "keep",
    spawnSource: params.definition.spawnSource,
    expectsCompletionMessage:
      spawnOverrides.expectsCompletionMessage ??
      params.definition.expectsCompletionMessage ??
      false,
    ...(typeof runTimeoutSeconds === "number" ? { runTimeoutSeconds } : {}),
    ...(typeof maxTurns === "number" ? { maxTurns } : {}),
    ...(params.extraSystemPrompt ? { extraSystemPrompt: params.extraSystemPrompt } : {}),
    ...(spawnOverrides.agentId ? { agentId: spawnOverrides.agentId } : {}),
    ...(spawnOverrides.model ? { model: spawnOverrides.model } : {}),
    ...(spawnOverrides.thinking ? { thinking: spawnOverrides.thinking } : {}),
    ...(!isolatedRun && spawnOverrides.thread === true ? { thread: true } : {}),
    ...(!isolatedRun && spawnOverrides.streamTo ? { streamTo: spawnOverrides.streamTo } : {}),
    ...(!isolatedRun && spawnOverrides.resumeSessionId
      ? { resumeSessionId: spawnOverrides.resumeSessionId }
      : {}),
    ...(spawnOverrides.cwd ? { cwd: spawnOverrides.cwd } : {}),
    ...(spawnOverrides.durableMemoryScope
      ? { durableMemoryScope: spawnOverrides.durableMemoryScope }
      : {}),
    ...(spawnOverrides.attachments ? { attachments: spawnOverrides.attachments } : {}),
    ...(spawnOverrides.attachMountPath ? { attachMountPath: spawnOverrides.attachMountPath } : {}),
    ...(streamParams ? { streamParams } : {}),
  } as const;
}

export function resolveSpecialAgentWaitTimeoutMs(params: {
  request: SpecialAgentSpawnRequest;
}): number {
  const runTimeoutSeconds = resolveRunTimeoutSeconds({
    requested: params.request.spawnOverrides?.runTimeoutSeconds,
    fallback: params.request.definition.defaultRunTimeoutSeconds,
  });
  if (typeof runTimeoutSeconds === "number" && Number.isFinite(runTimeoutSeconds)) {
    return Math.max(15_000, Math.floor(runTimeoutSeconds * 1000) + 10_000);
  }
  return 100_000;
}

function accumulateUsage(
  base: NormalizedUsage | undefined,
  next: NormalizedUsage | undefined,
): NormalizedUsage | undefined {
  if (!base) {
    return next ? { ...next } : undefined;
  }
  if (!next) {
    return base;
  }
  const sum = (left: number | undefined, right: number | undefined): number | undefined => {
    if (left === undefined && right === undefined) {
      return undefined;
    }
    return (left ?? 0) + (right ?? 0);
  };
  return {
    input: sum(base.input, next.input),
    output: sum(base.output, next.output),
    cacheRead: sum(base.cacheRead, next.cacheRead),
    cacheWrite: sum(base.cacheWrite, next.cacheWrite),
    total: sum(base.total, next.total),
  };
}

function deriveUsageFromHistory(messages: unknown[]): NormalizedUsage | undefined {
  let usage: NormalizedUsage | undefined;
  for (const message of messages) {
    if (!message || typeof message !== "object") {
      continue;
    }
    const record = message as { role?: unknown; usage?: unknown };
    if (record.role !== "assistant") {
      continue;
    }
    usage = accumulateUsage(usage, normalizeUsage(record.usage ?? undefined));
  }
  return usage;
}

function deriveRustSpecialReply(response: RustSpecialAgentResponse): string {
  const result = response.result;
  const payloadText = result?.payloads
    ?.map((payload) => payload.text?.trim())
    .filter((text): text is string => Boolean(text))
    .join("\n")
    .trim();
  return payloadText || result?.assistantText?.trim() || response.summary?.trim() || "";
}

async function runRustEmbeddedSpecialAgentToCompletion(params: {
  request: SpecialAgentSpawnRequest;
  deps: SpecialAgentRuntimeDeps;
}): Promise<SpecialAgentCompletionResult> {
  const response = (await params.deps.callGateway({
    method: "special_agents.run",
    params: {
      kind: params.request.definition.id,
      spawnSource: params.request.definition.spawnSource,
      task: params.request.task,
      parentSessionKey: params.request.spawnContext?.parentSessionKey,
      parentRunId: params.request.spawnContext?.parentRunId,
      spawnContext: params.request.spawnContext,
      spawnOverrides: params.request.spawnOverrides,
    },
    timeoutMs: resolveSpecialAgentWaitTimeoutMs({ request: params.request }),
  })) as RustSpecialAgentResponse;

  if (response.status && response.status !== "completed") {
    return {
      status: "wait_failed",
      error: response.error ?? response.status,
      ...(response.runId ? { runId: response.runId } : {}),
      ...(response.childSessionKey ? { childSessionKey: response.childSessionKey } : {}),
    };
  }

  const history = Array.isArray(response.result?.history) ? response.result.history : undefined;
  if (history && params.request.hooks?.onHistory && response.runId && response.childSessionKey) {
    await params.request.hooks.onHistory({
      runId: response.runId,
      childSessionKey: response.childSessionKey,
      messages: history,
    });
  }
  const usage = normalizeUsage(response.result?.usage);
  if (usage && params.request.hooks?.onUsage && response.runId && response.childSessionKey) {
    await params.request.hooks.onUsage({
      runId: response.runId,
      childSessionKey: response.childSessionKey,
      usage,
    });
  }

  return {
    status: "completed",
    runId: response.runId ?? "",
    childSessionKey: response.childSessionKey ?? "",
    reply: deriveRustSpecialReply(response),
    ...(usage ? { usage } : {}),
    ...(history ? { historyMessageCount: history.length } : {}),
  };
}

async function maybeCaptureHistory(params: {
  deps: SpecialAgentRuntimeDeps;
  request: SpecialAgentSpawnRequest;
  runId: string;
  childSessionKey: string;
}): Promise<{ messages: unknown[]; usage?: NormalizedUsage } | null> {
  const historyLimit = Math.max(1, Math.floor(params.request.historyLimit ?? 100));
  const needsHistory =
    Boolean(params.request.hooks?.onHistory) || Boolean(params.request.hooks?.onUsage);
  if (!needsHistory) {
    return null;
  }
  const history = (await params.deps.callGateway({
    method: "chat.history",
    params: {
      sessionKey: params.childSessionKey,
      limit: historyLimit,
    },
    timeoutMs: 15_000,
  })) as ChildHistoryResponse;
  const messages = Array.isArray(history?.messages) ? history.messages : [];
  const usage = deriveUsageFromHistory(messages);
  if (params.request.hooks?.onHistory) {
    await params.request.hooks.onHistory({
      runId: params.runId,
      childSessionKey: params.childSessionKey,
      messages,
    });
  }
  if (usage && params.request.hooks?.onUsage) {
    await params.request.hooks.onUsage({
      runId: params.runId,
      childSessionKey: params.childSessionKey,
      usage,
    });
  }
  return { messages, usage };
}

export async function runSpecialAgentToCompletion(
  request: SpecialAgentSpawnRequest,
  deps: SpecialAgentRuntimeDeps = defaultSpecialAgentRuntimeDeps,
): Promise<SpecialAgentCompletionResult> {
  const contractIssues = validateSpecialAgentDefinitionContract(request.definition);
  if (contractIssues.length > 0) {
    return {
      status: "spawn_failed",
      error: `invalid special agent contract: ${contractIssues.join("; ")}`,
    };
  }

  if ((request.definition.executionMode ?? "spawned_session") === "embedded_fork") {
    return await runRustEmbeddedSpecialAgentToCompletion({ request, deps });
  }
  const spawnParams = await buildSpawnParams(request);
  const spawn = await deps.spawnAgentSessionDirect(spawnParams, request.spawnContext);

  if (spawn.status !== "accepted" || !spawn.runId || !spawn.childSessionKey) {
    return {
      status: "spawn_failed",
      error: summarizeSpawnError(spawn),
      ...(spawn.runId ? { runId: spawn.runId } : {}),
      ...(spawn.childSessionKey ? { childSessionKey: spawn.childSessionKey } : {}),
    };
  }

  const unsubscribeAgentEvents = request.hooks?.onAgentEvent
    ? deps.onAgentEvent((event: AgentEventPayload) => {
        if (event.runId !== spawn.runId) {
          return;
        }
        void Promise.resolve(request.hooks?.onAgentEvent?.(event)).catch(() => {});
      })
    : () => {};

  const timeoutMs = resolveSpecialAgentWaitTimeoutMs({ request });
  let wait: AgentWaitResponse;
  try {
    wait = (await deps.callGateway({
      method: "agent.wait",
      params: {
        runId: spawn.runId,
        timeoutMs,
      },
      timeoutMs: timeoutMs + 10_000,
    })) as AgentWaitResponse;
  } finally {
    unsubscribeAgentEvents();
  }

  if (wait?.status !== "ok") {
    return {
      status: "wait_failed",
      error: summarizeWaitError(wait ?? {}),
      runId: spawn.runId,
      childSessionKey: spawn.childSessionKey,
      ...(wait?.status ? { waitStatus: wait.status } : {}),
      ...(typeof wait?.endedAt === "number" ? { endedAt: wait.endedAt } : {}),
    };
  }

  const history = await maybeCaptureHistory({
    deps,
    request,
    runId: spawn.runId,
    childSessionKey: spawn.childSessionKey,
  });
  const reply = (await deps.captureSubagentCompletionReply(spawn.childSessionKey)) ?? "";
  return {
    status: "completed",
    runId: spawn.runId,
    childSessionKey: spawn.childSessionKey,
    reply,
    ...(typeof wait?.endedAt === "number" ? { endedAt: wait.endedAt } : {}),
    ...(history?.usage ? { usage: history.usage } : {}),
    ...(typeof history?.messages.length === "number"
      ? { historyMessageCount: history.messages.length }
      : {}),
  };
}
