import type {
  CliSessionBinding,
  SessionSkillExposureState,
  SessionSystemPromptReport,
} from "../config/sessions.js";
import type { UsageLike } from "./usage.js";

export type RustAgentPayload = {
  text?: string;
  mediaUrls?: string[];
  isReasoning?: boolean;
  isError?: boolean;
  metadata?: Record<string, unknown>;
};

export type RustAgentRunResult = {
  payloads?: RustAgentPayload[];
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

function normalizeRunError(value: unknown): RustAgentRunResult["meta"]["error"] | undefined {
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
    kind: isRustRunErrorKind(error.kind) ? error.kind : "retry_limit",
  };
}

function isRustRunErrorKind(
  value: unknown,
): value is NonNullable<RustAgentRunResult["meta"]["error"]>["kind"] {
  return (
    value === "context_overflow" ||
    value === "compaction_failure" ||
    value === "role_ordering" ||
    value === "image_size" ||
    value === "retry_limit"
  );
}

function normalizePayload(value: unknown): RustAgentPayload | undefined {
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

export function normalizeRustAgentRunResult(
  value: unknown,
  startedAt = Date.now(),
): RustAgentRunResult {
  const response = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const payloads = Array.isArray(response.payloads)
    ? response.payloads
        .map(normalizePayload)
        .filter((payload): payload is RustAgentPayload => !!payload)
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
      const chunk = textValue(record.text);
      if (record.type === "modelChunk" && chunk) {
        return [{ text: chunk }];
      }
      return [];
    })
    .filter((payload): payload is RustAgentPayload => !!payload);
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
      durationMs:
        typeof rawMeta.durationMs === "number" ? rawMeta.durationMs : Date.now() - startedAt,
      ...(normalizedError ? { error: normalizedError } : {}),
      implementation: "rust-native",
    },
    ...(textValue(response.runId) ? { runId: textValue(response.runId) } : {}),
    ...(textValue(response.sessionKey) ? { sessionKey: textValue(response.sessionKey) } : {}),
    ...(assistantText ? { assistantText } : {}),
  };
}
