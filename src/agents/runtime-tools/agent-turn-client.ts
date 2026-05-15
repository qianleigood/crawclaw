import type {
  CliSessionBinding,
  SessionSkillExposureState,
  SessionSystemPromptReport,
} from "../../config/sessions.js";
import type { UsageLike } from "../usage.js";
import { runCrawClawRuntimeTool } from "./native.js";

export type NativeAgentPayload = {
  text?: string;
  mediaUrls?: string[];
  isReasoning?: boolean;
  isError?: boolean;
  metadata?: Record<string, unknown>;
};

export type NativeAgentRunResult = {
  payloads?: NativeAgentPayload[];
  history?: unknown[];
  meta: {
    agentMeta?: {
      sessionId: string;
      provider: string;
      model: string;
      usage?: UsageLike;
      promptTokens?: number;
      compactionCount?: number;
      lastCallUsage?: UsageLike;
      cliSessionBinding?: CliSessionBinding;
    };
    aborted?: boolean;
    durationMs: number;
    error?: {
      kind:
        | "context_overflow"
        | "compaction_failure"
        | "role_ordering"
        | "image_size"
        | "retry_limit";
      message: string;
    };
    systemPromptReport?: SessionSystemPromptReport;
    skillExposureState?: SessionSkillExposureState;
    [key: string]: unknown;
  };
  didSendViaMessagingTool?: boolean;
  messagingToolSentTargets?: Array<{
    tool: string;
    provider: string;
    channel?: string;
    to?: string;
    accountId?: string;
    threadId?: string;
    [key: string]: unknown;
  }>;
  messagingToolSentTexts?: string[];
  messagingToolSentMediaUrls?: string[];
  successfulCronAdds?: number;
  runId?: string;
  sessionKey?: string;
  assistantText?: string;
};

export type NativeMemoryCompactionResult = {
  ok?: boolean;
  compacted?: boolean;
  reason?: string;
  result?: {
    summary?: string;
    firstKeptEntryId?: string;
    tokensBefore?: number;
    tokensAfter?: number;
    [key: string]: unknown;
  };
  [key: string]: unknown;
};

type NativeAgentInput = Record<string, unknown>;

function textValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function boolValue(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function stringArray(value: unknown): string[] | undefined {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : undefined;
}

function normalizeRunError(value: unknown): NativeAgentRunResult["meta"]["error"] | undefined {
  if (typeof value === "string" && value.trim()) {
    return { kind: "retry_limit", message: value.trim() };
  }
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const error = value as Record<string, unknown>;
  const message = textValue(error.message);
  if (!message) {
    return undefined;
  }
  return {
    message,
    kind: isNativeRunErrorKind(error.kind) ? error.kind : "retry_limit",
  };
}

function isNativeRunErrorKind(
  value: unknown,
): value is NonNullable<NativeAgentRunResult["meta"]["error"]>["kind"] {
  return (
    value === "context_overflow" ||
    value === "compaction_failure" ||
    value === "role_ordering" ||
    value === "image_size" ||
    value === "retry_limit"
  );
}

function normalizePayload(value: unknown): NativeAgentPayload | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const payload = value as Record<string, unknown>;
  const text = textValue(payload.text);
  const mediaUrls = stringArray(payload.mediaUrls);
  const metadata =
    payload.metadata && typeof payload.metadata === "object" && !Array.isArray(payload.metadata)
      ? (payload.metadata as Record<string, unknown>)
      : undefined;
  if (!text && (!mediaUrls || mediaUrls.length === 0) && !metadata) {
    return undefined;
  }
  return {
    ...(text ? { text } : {}),
    ...(mediaUrls?.length ? { mediaUrls } : {}),
    ...(boolValue(payload.isReasoning) !== undefined
      ? { isReasoning: boolValue(payload.isReasoning) }
      : {}),
    ...(boolValue(payload.isError) !== undefined ? { isError: boolValue(payload.isError) } : {}),
    ...(metadata ? { metadata } : {}),
  };
}

function normalizeNativeAgentResponse(value: unknown): NativeAgentRunResult {
  const response = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const payloads = Array.isArray(response.payloads)
    ? response.payloads
        .map(normalizePayload)
        .filter((payload): payload is NativeAgentPayload => !!payload)
    : [];
  const assistantText = textValue(response.assistantText);
  const rawEvents = Array.isArray(response.events) ? response.events : [];
  const eventPayloads = rawEvents
    .flatMap((event) => {
      if (!event || typeof event !== "object") {
        return [];
      }
      const record = event as Record<string, unknown>;
      if (record.type === "replyPayload") {
        return [normalizePayload(record.payload)];
      }
      if (record.type === "modelChunk" && textValue(record.text)) {
        return [{ text: textValue(record.text) }];
      }
      return [];
    })
    .filter((payload): payload is NativeAgentPayload => !!payload);
  const normalizedPayloads =
    payloads.length > 0
      ? payloads
      : eventPayloads.length > 0
        ? eventPayloads
        : assistantText
          ? [{ text: assistantText }]
          : undefined;
  const rawMeta =
    response.meta && typeof response.meta === "object" && !Array.isArray(response.meta)
      ? (response.meta as Record<string, unknown>)
      : {};
  const normalizedError = normalizeRunError(rawMeta.error);
  return {
    ...(normalizedPayloads ? { payloads: normalizedPayloads } : {}),
    ...(Array.isArray(response.history) ? { history: response.history } : {}),
    meta: {
      ...rawMeta,
      durationMs: typeof rawMeta.durationMs === "number" ? rawMeta.durationMs : 0,
      ...(normalizedError ? { error: normalizedError } : {}),
      implementation: "rust-native",
    },
    ...(textValue(response.runId) ? { runId: textValue(response.runId) } : {}),
    ...(textValue(response.sessionKey) ? { sessionKey: textValue(response.sessionKey) } : {}),
    ...(assistantText ? { assistantText } : {}),
  };
}

function buildAgentTurnInput(input: NativeAgentInput): Record<string, unknown> {
  const sessionKey = textValue(input.sessionKey) ?? textValue(input.sessionId) ?? "main";
  const message =
    textValue(input.prompt) ?? textValue(input.message) ?? textValue(input.text) ?? "";
  const channel =
    textValue(input.messageChannel) ??
    textValue(input.messageProvider) ??
    textValue(input.channel) ??
    "gateway";
  return {
    sessionKey,
    message,
    ...(textValue(input.runId) ? { runId: textValue(input.runId) } : {}),
    ...(textValue(input.agentId) ? { agentId: textValue(input.agentId) } : {}),
    ...(textValue(input.provider) ? { provider: textValue(input.provider) } : {}),
    ...(textValue(input.model) ? { model: textValue(input.model) } : {}),
    ...(textValue(input.thinkLevel) ? { reasoningLevel: textValue(input.thinkLevel) } : {}),
    ...(textValue(input.reasoningLevel) ? { reasoningLevel: textValue(input.reasoningLevel) } : {}),
    ...(textValue(input.trigger) ? { trigger: textValue(input.trigger) } : {}),
    channel,
    inbound: {
      channel,
      accountId: textValue(input.agentAccountId) ?? textValue(input.accountId),
      from: textValue(input.senderId) ?? textValue(input.from) ?? "user",
      to: textValue(input.messageTo) ?? textValue(input.to) ?? "agent:main",
      chatType: "direct",
      body: message,
      rawBody: message,
      messageId: textValue(input.messageId),
      threadId: textValue(input.messageThreadId) ?? sessionKey,
      mediaUrls: Array.isArray(input.images) ? input.images : [],
      metadata: {},
    },
  };
}

export async function runNativeAgentTurn(input: NativeAgentInput): Promise<NativeAgentRunResult> {
  const result = await runCrawClawRuntimeTool("agent_run_turn", buildAgentTurnInput(input), {
    timeoutMs: typeof input.timeoutMs === "number" ? input.timeoutMs : undefined,
  });
  return normalizeNativeAgentResponse(result);
}

export async function compactNativeMemorySession(
  input: NativeAgentInput,
): Promise<NativeMemoryCompactionResult> {
  const result = await runCrawClawRuntimeTool(
    "memory.compact",
    {
      sessionId: textValue(input.sessionId) ?? textValue(input.sessionKey) ?? "main",
      sessionKey: textValue(input.sessionKey),
      force: boolValue(input.force) ?? true,
    },
    { timeoutMs: typeof input.timeoutMs === "number" ? input.timeoutMs : undefined },
  );
  return result && typeof result === "object"
    ? (result as NativeMemoryCompactionResult)
    : { ok: false, compacted: false, reason: "invalid_runtime_response" };
}
