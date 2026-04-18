import { truncateText } from "../format.ts";

const TOOL_STREAM_LIMIT = 50;
const TOOL_STREAM_THROTTLE_MS = 80;
const TOOL_OUTPUT_CHAR_LIMIT = 120_000;

export type AgentEventPayload = {
  runId: string;
  seq: number;
  stream: string;
  ts: number;
  sessionKey?: string;
  data: Record<string, unknown>;
};

export type ToolStreamEntry = {
  toolCallId: string;
  runId: string;
  sessionKey?: string;
  name: string;
  args?: unknown;
  output?: string;
  startedAt: number;
  updatedAt: number;
  message: Record<string, unknown>;
};

type ToolStreamHost = {
  sessionKey: string;
  chatRunId: string | null;
  chatStream: string | null;
  chatStreamStartedAt: number | null;
  chatStreamSegments: Array<{ text: string; ts: number }>;
  toolStreamById: Map<string, ToolStreamEntry>;
  toolStreamOrder: string[];
  chatToolMessages: Record<string, unknown>[];
  toolStreamSyncTimer: number | null;
};

function toTrimmedString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function resolveModelLabel(provider: unknown, model: unknown): string | null {
  const modelValue = toTrimmedString(model);
  if (!modelValue) {
    return null;
  }
  const providerValue = toTrimmedString(provider);
  if (providerValue) {
    const prefix = `${providerValue}/`;
    if (modelValue.toLowerCase().startsWith(prefix.toLowerCase())) {
      const trimmedModel = modelValue.slice(prefix.length).trim();
      if (trimmedModel) {
        return `${providerValue}/${trimmedModel}`;
      }
    }
    return `${providerValue}/${modelValue}`;
  }
  const slashIndex = modelValue.indexOf("/");
  if (slashIndex > 0) {
    const p = modelValue.slice(0, slashIndex).trim();
    const m = modelValue.slice(slashIndex + 1).trim();
    if (p && m) {
      return `${p}/${m}`;
    }
  }
  return modelValue;
}

function parseFallbackAttemptSummaries(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((entry) => toTrimmedString(entry))
    .filter((entry): entry is string => Boolean(entry));
}

function parseFallbackAttempts(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const out: string[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") {
      continue;
    }
    const item = entry as Record<string, unknown>;
    const provider = toTrimmedString(item.provider);
    const model = toTrimmedString(item.model);
    if (!provider || !model) {
      continue;
    }
    const reason =
      toTrimmedString(item.reason)?.replace(/_/g, " ") ??
      toTrimmedString(item.code) ??
      (typeof item.status === "number" ? `HTTP ${item.status}` : null) ??
      toTrimmedString(item.error) ??
      "error";
    out.push(`${provider}/${model}: ${reason}`);
  }
  return out;
}

function extractToolOutputText(value: unknown): string | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (typeof record.text === "string") {
    return record.text;
  }
  const content = record.content;
  if (!Array.isArray(content)) {
    return null;
  }
  const parts = content
    .map((item) => {
      if (!item || typeof item !== "object") {
        return null;
      }
      const entry = item as Record<string, unknown>;
      if (entry.type === "text" && typeof entry.text === "string") {
        return entry.text;
      }
      return null;
    })
    .filter((part): part is string => Boolean(part));
  if (parts.length === 0) {
    return null;
  }
  return parts.join("\n");
}

function formatToolOutput(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  const contentText = extractToolOutputText(value);
  let text: string;
  if (typeof value === "string") {
    text = value;
  } else if (contentText) {
    text = contentText;
  } else {
    try {
      text = JSON.stringify(value, null, 2);
    } catch {
      text = "[unserializable tool output]";
    }
  }
  const truncated = truncateText(text, TOOL_OUTPUT_CHAR_LIMIT);
  if (!truncated.truncated) {
    return truncated.text;
  }
  return `${truncated.text}\n\n… truncated (${truncated.total} chars, showing first ${truncated.text.length}).`;
}

function buildToolStreamMessage(entry: ToolStreamEntry): Record<string, unknown> {
  const content: Array<Record<string, unknown>> = [];
  content.push({
    type: "toolcall",
    name: entry.name,
    arguments: entry.args ?? {},
  });
  if (entry.output) {
    content.push({
      type: "toolresult",
      name: entry.name,
      text: entry.output,
    });
  }
  return {
    role: "assistant",
    toolCallId: entry.toolCallId,
    runId: entry.runId,
    content,
    timestamp: entry.startedAt,
  };
}

function trimToolStream(host: ToolStreamHost) {
  if (host.toolStreamOrder.length <= TOOL_STREAM_LIMIT) {
    return;
  }
  const overflow = host.toolStreamOrder.length - TOOL_STREAM_LIMIT;
  const removed = host.toolStreamOrder.splice(0, overflow);
  for (const id of removed) {
    host.toolStreamById.delete(id);
  }
}

function syncToolStreamMessages(host: ToolStreamHost) {
  host.chatToolMessages = host.toolStreamOrder
    .map((id) => host.toolStreamById.get(id)?.message)
    .filter((msg): msg is Record<string, unknown> => Boolean(msg));
}

export function flushToolStreamSync(host: ToolStreamHost) {
  if (host.toolStreamSyncTimer != null) {
    clearTimeout(host.toolStreamSyncTimer);
    host.toolStreamSyncTimer = null;
  }
  syncToolStreamMessages(host);
}

export function scheduleToolStreamSync(host: ToolStreamHost, force = false) {
  if (force) {
    flushToolStreamSync(host);
    return;
  }
  if (host.toolStreamSyncTimer != null) {
    return;
  }
  host.toolStreamSyncTimer = window.setTimeout(
    () => flushToolStreamSync(host),
    TOOL_STREAM_THROTTLE_MS,
  );
}

export function resetToolStream(host: ToolStreamHost) {
  if (host.toolStreamSyncTimer != null) {
    clearTimeout(host.toolStreamSyncTimer);
    host.toolStreamSyncTimer = null;
  }
  host.toolStreamById.clear();
  host.toolStreamOrder = [];
  host.chatToolMessages = [];
  host.chatStreamSegments = [];
}

export type CompactionStatus = {
  phase: "active" | "retrying" | "complete";
  runId: string;
  startedAt: number;
  completedAt: number | null;
};

export type FallbackStatus = {
  phase?: "active" | "cleared";
  selected: string;
  active: string;
  previous?: string;
  reason?: string;
  attempts: string[];
  occurredAt: number;
};

function toToolCallEntry(
  host: ToolStreamHost,
  payload: AgentEventPayload,
  toolCallId: string,
  name: string,
  args: unknown,
): ToolStreamEntry {
  const existing = host.toolStreamById.get(toolCallId);
  return {
    toolCallId,
    runId: payload.runId,
    ...(payload.sessionKey ? { sessionKey: payload.sessionKey } : {}),
    name,
    args,
    output: existing?.output,
    startedAt: existing?.startedAt ?? payload.ts,
    updatedAt: payload.ts,
    message: existing?.message ?? {},
  };
}

function acceptToolPayload(host: ToolStreamHost, payload: AgentEventPayload): boolean {
  if (payload.sessionKey && payload.sessionKey !== host.sessionKey) {
    return false;
  }
  if (host.chatRunId && payload.runId !== host.chatRunId) {
    return false;
  }
  if (!host.chatRunId && !payload.sessionKey) {
    return false;
  }
  return true;
}

function updateToolStreamEntry(host: ToolStreamHost, entry: ToolStreamEntry) {
  entry.message = buildToolStreamMessage(entry);
  host.toolStreamById.set(entry.toolCallId, entry);
  if (!host.toolStreamOrder.includes(entry.toolCallId)) {
    host.toolStreamOrder.push(entry.toolCallId);
  }
  trimToolStream(host);
  scheduleToolStreamSync(host);
}

function appendFallbackSummary(host: ToolStreamHost, payload: AgentEventPayload) {
  const provider = resolveModelLabel(payload.data.provider, payload.data.model);
  const summaries = parseFallbackAttemptSummaries(payload.data.attempts);
  const attempts = parseFallbackAttempts(payload.data.attempts);
  const primarySummary =
    provider || summaries[0] || attempts[0] || truncateText(JSON.stringify(payload.data), 160).text;
  host.chatStreamSegments = [
    ...host.chatStreamSegments,
    { text: `[fallback] ${primarySummary}`, ts: payload.ts },
  ];
}

export function handleAgentEvent(
  host: ToolStreamHost,
  payload?: AgentEventPayload,
): {
  compactionStatus?: CompactionStatus | null;
  fallbackStatus?: FallbackStatus | null;
} {
  if (!payload || !acceptToolPayload(host, payload)) {
    return {};
  }
  if (payload.stream === "tool-call") {
    const toolCallId = toTrimmedString(payload.data.toolCallId);
    const name = toTrimmedString(payload.data.name);
    if (!toolCallId || !name) {
      return {};
    }
    updateToolStreamEntry(
      host,
      toToolCallEntry(host, payload, toolCallId, name, payload.data.arguments ?? {}),
    );
    return {};
  }
  if (payload.stream === "tool-result") {
    const toolCallId = toTrimmedString(payload.data.toolCallId);
    if (!toolCallId) {
      return {};
    }
    const existing = host.toolStreamById.get(toolCallId);
    if (!existing) {
      return {};
    }
    updateToolStreamEntry(host, {
      ...existing,
      updatedAt: payload.ts,
      output: formatToolOutput(payload.data.output ?? payload.data.result) ?? existing.output,
    });
    return {};
  }
  if (payload.stream === "fallback") {
    appendFallbackSummary(host, payload);
    return {
      fallbackStatus: {
        phase: "active",
        selected:
          resolveModelLabel(payload.data.selectedProvider, payload.data.selectedModel) ??
          resolveModelLabel(payload.data.provider, payload.data.model) ??
          "unknown",
        active:
          resolveModelLabel(payload.data.activeProvider, payload.data.activeModel) ??
          resolveModelLabel(payload.data.provider, payload.data.model) ??
          "unknown",
        previous:
          resolveModelLabel(payload.data.previousProvider, payload.data.previousModel) ??
          toTrimmedString(payload.data.previous) ??
          undefined,
        reason: toTrimmedString(payload.data.reason) ?? undefined,
        attempts: parseFallbackAttempts(payload.data.attempts),
        occurredAt: payload.ts,
      },
    };
  }
  if (payload.stream === "compaction") {
    const state = toTrimmedString(payload.data.state);
    if (state === "running") {
      return {
        compactionStatus: {
          phase: "active",
          runId: payload.runId,
          startedAt: payload.ts,
          completedAt: null,
        },
      };
    }
    if (state === "retrying") {
      return {
        compactionStatus: {
          phase: "retrying",
          runId: payload.runId,
          startedAt: payload.ts,
          completedAt: null,
        },
      };
    }
    if (state === "completed") {
      return {
        compactionStatus: {
          phase: "complete",
          runId: payload.runId,
          startedAt: payload.ts,
          completedAt: payload.ts,
        },
      };
    }
  }
  return {};
}
