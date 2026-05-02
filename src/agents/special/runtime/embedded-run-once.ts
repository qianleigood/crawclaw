import { randomUUID } from "node:crypto";
import path from "node:path";
import { modelKey, resolveDefaultModelForAgent } from "../../model-selection.js";
import { runEmbeddedPiAgent } from "../../pi-embedded-runner/run.js";
import type { RunEmbeddedPiAgentParams } from "../../pi-embedded-runner/run/params.js";
import type { EmbeddedPiRunResult } from "../../pi-embedded-runner/types.js";
import { normalizeUsage, type NormalizedUsage } from "../../usage.js";
import { resolveSpecialAgentCacheHints } from "./cache-plan.js";
import { normalizeOptionalText, resolveMaxTurns, resolveRunTimeoutSeconds } from "./shared.js";
import type {
  SpecialAgentCompletionResult,
  SpecialAgentSpawnRequest,
  SpecialAgentToolPolicy,
} from "./types.js";

export type EmbeddedSpecialAgentRuntimeDeps = {
  runEmbeddedPiAgent: typeof runEmbeddedPiAgent;
};

export const defaultEmbeddedSpecialAgentRuntimeDeps: EmbeddedSpecialAgentRuntimeDeps = {
  runEmbeddedPiAgent,
};

function resolveEmbeddedSessionRef(params: { definitionId: string; runId: string }): string {
  return `embedded:${params.definitionId}:${params.runId}`;
}

function sanitizeSessionFileSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "-");
}

function resolveEmbeddedSessionId(params: { definitionId: string; runId: string }): string {
  return `embedded-${sanitizeSessionFileSegment(params.definitionId)}-${sanitizeSessionFileSegment(params.runId)}`;
}

function resolveEmbeddedSessionFile(params: {
  parentSessionFile: string;
  definitionId: string;
  runId: string;
}): string {
  const parentDir = path.dirname(params.parentSessionFile);
  const childBase = `${resolveEmbeddedSessionId({
    definitionId: params.definitionId,
    runId: params.runId,
  })}.jsonl`;
  return path.join(parentDir, childBase);
}

function splitModelRef(ref?: string): { model?: string; provider?: string } {
  const trimmed = normalizeOptionalText(ref);
  if (!trimmed) {
    return {};
  }
  const slash = trimmed.indexOf("/");
  if (slash <= 0 || slash === trimmed.length - 1) {
    return { model: trimmed };
  }
  return {
    provider: trimmed.slice(0, slash),
    model: trimmed.slice(slash + 1),
  };
}

function splitParentForkModelRef(
  parentForkContext: SpecialAgentSpawnRequest["parentForkContext"],
): { model?: string; provider?: string } {
  const provider = normalizeOptionalText(parentForkContext?.provider);
  if (!provider || provider === "manual") {
    return {};
  }
  return {
    provider,
    model: normalizeOptionalText(parentForkContext?.modelId),
  };
}

function shouldAttachParentPromptEnvelope(definitionId: string): boolean {
  return definitionId !== "durable_memory";
}

function resolveParentForkMessages(
  parentPromptEnvelope:
    | NonNullable<SpecialAgentSpawnRequest["parentForkContext"]>["promptEnvelope"]
    | undefined,
): unknown[] | undefined {
  return Array.isArray(parentPromptEnvelope?.forkContextMessages) &&
    parentPromptEnvelope.forkContextMessages.length > 0
    ? parentPromptEnvelope.forkContextMessages
    : undefined;
}

function resolveEmbeddedToolsAllow(
  toolPolicy: SpecialAgentToolPolicy | undefined,
): readonly string[] | undefined {
  if (!toolPolicy?.allowlist?.length) {
    return undefined;
  }
  const enforcement = toolPolicy.enforcement ?? "prompt_allowlist";
  return enforcement === "prompt_allowlist" || toolPolicy.modelVisibility === "allowlist"
    ? [...toolPolicy.allowlist]
    : undefined;
}

function resolveEmbeddedToolChoice(
  toolPolicy: SpecialAgentToolPolicy | undefined,
): { type: "tool"; name: string } | undefined {
  if (toolPolicy?.modelVisibility !== "allowlist") {
    return undefined;
  }
  if (toolPolicy.allowlist.length !== 1) {
    return undefined;
  }
  return {
    type: "tool",
    name: toolPolicy.allowlist[0],
  };
}

function deriveEmbeddedReply(result: EmbeddedPiRunResult): string {
  const parts = (result.payloads ?? [])
    .filter(
      (payload): payload is NonNullable<EmbeddedPiRunResult["payloads"]>[number] =>
        Boolean(payload) &&
        typeof payload.text === "string" &&
        payload.text.trim().length > 0 &&
        payload.isReasoning !== true,
    )
    .map((payload) => payload.text?.trim() ?? "")
    .filter(Boolean);
  return parts.join("\n\n").trim();
}

function deriveEmbeddedHistory(result: EmbeddedPiRunResult): unknown[] {
  return (result.payloads ?? [])
    .filter(
      (payload): payload is NonNullable<EmbeddedPiRunResult["payloads"]>[number] =>
        Boolean(payload) && typeof payload.text === "string" && payload.text.trim().length > 0,
    )
    .map((payload) => ({
      role: "assistant",
      text: payload.text?.trim(),
      ...(payload.isReasoning === true ? { isReasoning: true } : {}),
      ...(payload.isError === true ? { isError: true } : {}),
    }));
}

function deriveEmbeddedUsage(result: EmbeddedPiRunResult): NormalizedUsage | undefined {
  return normalizeUsage(result.meta.agentMeta?.usage);
}

async function buildEmbeddedRunParams(request: SpecialAgentSpawnRequest): Promise<
  | {
      runId: string;
      childSessionKey: string;
      params: RunEmbeddedPiAgentParams;
    }
  | {
      error: string;
    }
> {
  const embeddedContext = request.embeddedContext;
  const parentSessionFile = normalizeOptionalText(embeddedContext?.sessionFile);
  const workspaceDir =
    normalizeOptionalText(embeddedContext?.workspaceDir) ??
    normalizeOptionalText(request.spawnContext?.workspaceDir);
  if (!parentSessionFile || !workspaceDir) {
    return {
      error:
        "embedded_fork special agents require embeddedContext.sessionId, sessionFile, and workspaceDir",
    };
  }

  const modelOverride = splitModelRef(request.spawnOverrides?.model);
  const embeddedModel = splitModelRef(embeddedContext?.model);
  const configuredDefaultRef = embeddedContext?.config
    ? resolveDefaultModelForAgent({
        cfg: embeddedContext.config,
        agentId: normalizeOptionalText(embeddedContext.agentId),
      })
    : undefined;
  const configuredDefaultModel = configuredDefaultRef
    ? splitModelRef(modelKey(configuredDefaultRef.provider, configuredDefaultRef.model))
    : {};
  const parentForkModel = splitParentForkModelRef(request.parentForkContext);
  const provider =
    modelOverride.provider ??
    normalizeOptionalText(embeddedContext?.provider) ??
    parentForkModel.provider ??
    configuredDefaultModel.provider;
  const model =
    modelOverride.model ??
    embeddedModel.model ??
    parentForkModel.model ??
    configuredDefaultModel.model;
  if (!provider || !model) {
    return {
      error:
        "embedded_fork special agents require provider/model resolution from spawnOverrides.model, embeddedContext, parentForkContext, or configured defaults",
    };
  }

  const runId = `special:${request.definition.id}:${randomUUID()}`;
  const childSessionKey = resolveEmbeddedSessionRef({
    definitionId: request.definition.id,
    runId,
  });
  const childSessionId = resolveEmbeddedSessionId({
    definitionId: request.definition.id,
    runId,
  });
  const childSessionFile = resolveEmbeddedSessionFile({
    parentSessionFile,
    definitionId: request.definition.id,
    runId,
  });
  const runTimeoutSeconds = resolveRunTimeoutSeconds({
    requested: request.spawnOverrides?.runTimeoutSeconds,
    fallback: request.definition.defaultRunTimeoutSeconds,
  });
  const timeoutMs =
    typeof runTimeoutSeconds === "number" && Number.isFinite(runTimeoutSeconds)
      ? Math.max(1_000, Math.floor(runTimeoutSeconds * 1000))
      : 90_000;
  const maxTurns = resolveMaxTurns({
    requested: request.spawnOverrides?.maxTurns,
    fallback: request.definition.defaultMaxTurns,
  });
  const streamParams = await resolveSpecialAgentCacheHints(request);
  const toolChoice = resolveEmbeddedToolChoice(request.definition.toolPolicy);
  const effectiveStreamParams =
    toolChoice === undefined ? streamParams : { ...streamParams, toolChoice };
  const agentId =
    normalizeOptionalText(request.spawnOverrides?.agentId) ??
    normalizeOptionalText(embeddedContext?.agentId) ??
    normalizeOptionalText(request.spawnContext?.requesterAgentIdOverride);
  const thinkLevel =
    request.spawnOverrides?.thinking ??
    embeddedContext?.thinkLevel ??
    request.spawnOverrides?.thinking;
  let eventSeq = 0;

  const toolsAllow = resolveEmbeddedToolsAllow(request.definition.toolPolicy);
  const parentPromptEnvelope = request.parentForkContext?.promptEnvelope;
  const attachParentPromptEnvelope = shouldAttachParentPromptEnvelope(request.definition.id);
  const parentForkMessages = attachParentPromptEnvelope
    ? undefined
    : resolveParentForkMessages(parentPromptEnvelope);

  return {
    runId,
    childSessionKey,
    params: {
      sessionId: childSessionId,
      sessionKey: childSessionKey,
      ...(agentId ? { agentId } : {}),
      ...(normalizeOptionalText(embeddedContext?.messageChannel)
        ? { messageChannel: normalizeOptionalText(embeddedContext?.messageChannel) }
        : request.spawnContext?.agentChannel
          ? { messageChannel: request.spawnContext.agentChannel }
          : {}),
      ...(normalizeOptionalText(embeddedContext?.messageProvider)
        ? { messageProvider: normalizeOptionalText(embeddedContext?.messageProvider) }
        : {}),
      ...(normalizeOptionalText(embeddedContext?.messageTo)
        ? { messageTo: normalizeOptionalText(embeddedContext?.messageTo) }
        : request.spawnContext?.agentTo
          ? { messageTo: request.spawnContext.agentTo }
          : {}),
      ...(embeddedContext?.messageThreadId !== undefined
        ? { messageThreadId: embeddedContext.messageThreadId }
        : request.spawnContext?.agentThreadId !== undefined
          ? { messageThreadId: request.spawnContext.agentThreadId }
          : {}),
      ...(normalizeOptionalText(embeddedContext?.groupId) || embeddedContext?.groupId === ""
        ? { groupId: embeddedContext?.groupId ?? undefined }
        : request.spawnContext?.agentGroupId !== undefined
          ? { groupId: request.spawnContext.agentGroupId }
          : {}),
      ...(normalizeOptionalText(embeddedContext?.groupChannel) ||
      embeddedContext?.groupChannel === ""
        ? { groupChannel: embeddedContext?.groupChannel ?? undefined }
        : request.spawnContext?.agentGroupChannel !== undefined
          ? { groupChannel: request.spawnContext.agentGroupChannel }
          : {}),
      ...(normalizeOptionalText(embeddedContext?.groupSpace) || embeddedContext?.groupSpace === ""
        ? { groupSpace: embeddedContext?.groupSpace ?? undefined }
        : request.spawnContext?.agentGroupSpace !== undefined
          ? { groupSpace: request.spawnContext.agentGroupSpace }
          : {}),
      ...(normalizeOptionalText(embeddedContext?.spawnedBy)
        ? { spawnedBy: normalizeOptionalText(embeddedContext?.spawnedBy) }
        : {}),
      ...(embeddedContext?.senderIsOwner !== undefined
        ? { senderIsOwner: embeddedContext.senderIsOwner }
        : {}),
      ...(normalizeOptionalText(embeddedContext?.currentChannelId)
        ? { currentChannelId: normalizeOptionalText(embeddedContext?.currentChannelId) }
        : {}),
      ...(normalizeOptionalText(embeddedContext?.currentThreadTs)
        ? { currentThreadTs: normalizeOptionalText(embeddedContext?.currentThreadTs) }
        : {}),
      ...(embeddedContext?.currentMessageId !== undefined
        ? { currentMessageId: embeddedContext.currentMessageId }
        : {}),
      ...(embeddedContext?.allowGatewaySubagentBinding === true
        ? { allowGatewaySubagentBinding: true }
        : {}),
      sessionFile: childSessionFile,
      workspaceDir,
      ...(embeddedContext?.config ? { config: embeddedContext.config } : {}),
      prompt: request.task,
      provider,
      model,
      ...(thinkLevel ? { thinkLevel: thinkLevel as RunEmbeddedPiAgentParams["thinkLevel"] } : {}),
      timeoutMs,
      runId,
      ...((request.observation ?? embeddedContext?.observation)
        ? { observation: request.observation ?? embeddedContext?.observation }
        : {}),
      ...(typeof maxTurns === "number" ? { maxTurns } : {}),
      ...(request.extraSystemPrompt ? { extraSystemPrompt: request.extraSystemPrompt } : {}),
      ...(effectiveStreamParams ? { streamParams: effectiveStreamParams } : {}),
      ...(toolsAllow ? { toolsAllow: [...toolsAllow] } : {}),
      ...(attachParentPromptEnvelope && parentPromptEnvelope
        ? { specialParentPromptEnvelope: parentPromptEnvelope }
        : {}),
      ...(parentForkMessages ? { specialParentForkMessages: parentForkMessages } : {}),
      specialAgentSpawnSource: request.definition.spawnSource,
      ...(embeddedContext?.specialAgentContext?.durableMemoryScope
        ? {
            specialDurableMemoryScope: {
              agentId: embeddedContext.specialAgentContext.durableMemoryScope.agentId,
              channel: embeddedContext.specialAgentContext.durableMemoryScope.channel,
              userId: embeddedContext.specialAgentContext.durableMemoryScope.userId,
            },
          }
        : {}),
      ...(embeddedContext?.specialAgentContext?.sessionSummaryTarget
        ? {
            specialSessionSummaryTarget: {
              agentId: embeddedContext.specialAgentContext.sessionSummaryTarget.agentId,
              sessionId: embeddedContext.specialAgentContext.sessionSummaryTarget.sessionId,
            },
          }
        : {}),
      onAgentEvent: request.hooks?.onAgentEvent
        ? (event) => {
            void Promise.resolve(
              request.hooks?.onAgentEvent?.({
                runId,
                seq: ++eventSeq,
                stream: event.stream,
                ts: Date.now(),
                data: event.data,
                ...(childSessionKey ? { sessionKey: childSessionKey } : {}),
              }),
            ).catch(() => {});
          }
        : undefined,
    },
  };
}

export async function runEmbeddedSpecialAgentToCompletion(
  request: SpecialAgentSpawnRequest,
  deps: EmbeddedSpecialAgentRuntimeDeps = defaultEmbeddedSpecialAgentRuntimeDeps,
): Promise<SpecialAgentCompletionResult> {
  const resolved = await buildEmbeddedRunParams(request);
  if ("error" in resolved) {
    return {
      status: "spawn_failed",
      error: resolved.error,
    };
  }

  try {
    const result = await deps.runEmbeddedPiAgent(resolved.params);
    const history = deriveEmbeddedHistory(result);
    const usage = deriveEmbeddedUsage(result);
    if (request.hooks?.onHistory) {
      await request.hooks.onHistory({
        runId: resolved.runId,
        childSessionKey: resolved.childSessionKey,
        messages: history,
      });
    }
    if (usage && request.hooks?.onUsage) {
      await request.hooks.onUsage({
        runId: resolved.runId,
        childSessionKey: resolved.childSessionKey,
        usage,
      });
    }
    return {
      status: "completed",
      runId: resolved.runId,
      childSessionKey: resolved.childSessionKey,
      reply: deriveEmbeddedReply(result),
      endedAt: Date.now(),
      ...(usage ? { usage } : {}),
      historyMessageCount: history.length,
    };
  } catch (error) {
    return {
      status: "wait_failed",
      error: error instanceof Error ? error.message : String(error),
      runId: resolved.runId,
      childSessionKey: resolved.childSessionKey,
    };
  }
}
