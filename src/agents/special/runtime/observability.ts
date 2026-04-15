import type { CrawClawConfig } from "../../../config/config.js";
import {
  createContextArchiveRunCapture,
  type ContextArchiveRunEventInput,
} from "../../context-archive/run-capture.js";
import { resolveSharedContextArchiveService } from "../../context-archive/runtime.js";
import { hasNonzeroUsage, type NormalizedUsage } from "../../usage.js";
import type {
  SpecialAgentCompletionResult,
  SpecialAgentDefinition,
  SpecialAgentRuntimeHooks,
} from "./types.js";

function normalizeOptionalString(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function buildUsageMetadata(usage: NormalizedUsage | undefined): Record<string, unknown> {
  if (!usage) {
    return {};
  }
  return {
    ...(typeof usage.input === "number" ? { input: usage.input } : {}),
    ...(typeof usage.output === "number" ? { output: usage.output } : {}),
    ...(typeof usage.cacheRead === "number" ? { cacheRead: usage.cacheRead } : {}),
    ...(typeof usage.cacheWrite === "number" ? { cacheWrite: usage.cacheWrite } : {}),
    ...(typeof usage.total === "number" ? { total: usage.total } : {}),
  };
}

export function buildSpecialAgentUsageDetail(params: {
  usage?: NormalizedUsage;
  historyMessageCount?: number;
}): Record<string, unknown> | undefined {
  const detail: Record<string, unknown> = {};
  if (hasNonzeroUsage(params.usage)) {
    detail.usage = {
      ...(typeof params.usage.input === "number" ? { input: params.usage.input } : {}),
      ...(typeof params.usage.output === "number" ? { output: params.usage.output } : {}),
      ...(typeof params.usage.cacheRead === "number" ? { cacheRead: params.usage.cacheRead } : {}),
      ...(typeof params.usage.cacheWrite === "number"
        ? { cacheWrite: params.usage.cacheWrite }
        : {}),
      ...(typeof params.usage.total === "number" ? { total: params.usage.total } : {}),
    };
  }
  if (
    typeof params.historyMessageCount === "number" &&
    Number.isFinite(params.historyMessageCount) &&
    params.historyMessageCount > 0
  ) {
    detail.historyMessageCount = Math.floor(params.historyMessageCount);
  }
  return Object.keys(detail).length > 0 ? detail : undefined;
}

type ContextArchiveRunCaptureLike = ReturnType<typeof createContextArchiveRunCapture>;

type ContextArchiveRunStateInputLike = {
  sessionKey?: string;
  taskId?: string;
  agentId?: string;
  parentAgentId?: string;
  label?: string;
  kind?: "task" | "session" | "turn";
  status: "pending" | "recording" | "complete" | "failed" | "cancelled";
  summary?: unknown;
  metadata?: Record<string, unknown>;
};

type SpecialAgentObservabilityDeps = {
  resolveSharedContextArchiveService: typeof resolveSharedContextArchiveService;
  createContextArchiveRunCapture: typeof createContextArchiveRunCapture;
};

const defaultSpecialAgentObservabilityDeps: SpecialAgentObservabilityDeps = {
  resolveSharedContextArchiveService,
  createContextArchiveRunCapture,
};

export type SpecialAgentObservabilityParams = {
  definition: SpecialAgentDefinition;
  config?: CrawClawConfig;
  sessionId: string;
  sessionKey?: string;
  taskId?: string;
  agentId?: string;
  parentAgentId?: string;
  parentRunId?: string;
  label?: string;
};

export type SpecialAgentObservabilityRecordParams = {
  result: SpecialAgentCompletionResult;
  status?: "complete" | "failed";
  summary?: unknown;
  detail?: Record<string, unknown>;
};

function buildBaseMetadata(params: SpecialAgentObservabilityParams): Record<string, unknown> {
  return {
    definitionId: params.definition.id,
    spawnSource: params.definition.spawnSource,
    executionMode: params.definition.executionMode ?? "spawned_session",
    transcriptPolicy: params.definition.transcriptPolicy ?? "isolated",
    ...(normalizeOptionalString(params.parentRunId)
      ? { parentRunId: normalizeOptionalString(params.parentRunId) }
      : {}),
  };
}

export function createSpecialAgentObservability(
  params: SpecialAgentObservabilityParams,
  deps: SpecialAgentObservabilityDeps = defaultSpecialAgentObservabilityDeps,
): {
  hooks: SpecialAgentRuntimeHooks;
  recordResult: (params: SpecialAgentObservabilityRecordParams) => Promise<void>;
} {
  let capturePromise: Promise<ContextArchiveRunCaptureLike | null> | null = null;

  async function resolveCapture(): Promise<ContextArchiveRunCaptureLike | null> {
    if (!capturePromise) {
      capturePromise = (async () => {
        const archive = await deps.resolveSharedContextArchiveService(params.config);
        if (!archive) {
          return null;
        }
        return deps.createContextArchiveRunCapture({ archive });
      })();
    }
    return await capturePromise;
  }

  async function appendEvent(
    runId: string | undefined,
    input: Omit<ContextArchiveRunEventInput, "config" | "source" | "runId" | "sessionId">,
  ): Promise<void> {
    if (!normalizeOptionalString(runId)) {
      return;
    }
    const capture = await resolveCapture();
    if (!capture) {
      return;
    }
    await capture.appendEvent({
      source: "special-agent-runtime",
      runId,
      sessionId: params.sessionId,
      ...(normalizeOptionalString(params.sessionKey)
        ? { sessionKey: normalizeOptionalString(params.sessionKey) }
        : {}),
      ...(normalizeOptionalString(params.taskId)
        ? { taskId: normalizeOptionalString(params.taskId) }
        : {}),
      ...(normalizeOptionalString(params.agentId)
        ? { agentId: normalizeOptionalString(params.agentId) }
        : {}),
      ...(normalizeOptionalString(params.parentAgentId)
        ? { parentAgentId: normalizeOptionalString(params.parentAgentId) }
        : {}),
      label: params.label ?? params.definition.label,
      kind: "task",
      status: "recording",
      ...input,
      metadata: {
        ...buildBaseMetadata(params),
        ...input.metadata,
      },
    });
  }

  async function updateRunState(
    runId: string | undefined,
    input: ContextArchiveRunStateInputLike,
  ): Promise<void> {
    if (!normalizeOptionalString(runId)) {
      return;
    }
    const capture = await resolveCapture();
    if (!capture) {
      return;
    }
    await capture.updateRunState({
      source: "special-agent-runtime",
      runId,
      sessionId: params.sessionId,
      ...(normalizeOptionalString(params.sessionKey)
        ? { sessionKey: normalizeOptionalString(params.sessionKey) }
        : {}),
      ...(normalizeOptionalString(params.taskId)
        ? { taskId: normalizeOptionalString(params.taskId) }
        : {}),
      ...(normalizeOptionalString(params.agentId)
        ? { agentId: normalizeOptionalString(params.agentId) }
        : {}),
      ...(normalizeOptionalString(params.parentAgentId)
        ? { parentAgentId: normalizeOptionalString(params.parentAgentId) }
        : {}),
      label: params.label ?? params.definition.label,
      kind: "task",
      ...input,
      metadata: {
        ...buildBaseMetadata(params),
        ...input.metadata,
      },
    });
  }

  return {
    hooks: {
      onAgentEvent: async (event) => {
        await appendEvent(event.runId, {
          type: `special_agent.event.${event.stream}`,
          payload: {
            seq: event.seq,
            ts: event.ts,
            stream: event.stream,
            data: event.data,
          },
          metadata: {
            stream: event.stream,
          },
          createdAt: event.ts,
        });
      },
      onHistory: async (history) => {
        await appendEvent(history.runId, {
          type: "special_agent.history",
          payload: {
            childSessionKey: history.childSessionKey,
            historyMessageCount: history.messages.length,
            messages: history.messages,
          },
          metadata: {
            childSessionKey: history.childSessionKey,
            historyMessageCount: history.messages.length,
          },
        });
      },
      onUsage: async (usage) => {
        await appendEvent(usage.runId, {
          type: "special_agent.usage",
          payload: {
            childSessionKey: usage.childSessionKey,
            usage: usage.usage,
          },
          metadata: {
            childSessionKey: usage.childSessionKey,
            ...buildUsageMetadata(usage.usage),
          },
        });
      },
    },
    recordResult: async (record) => {
      const usage = record.result.status === "completed" ? record.result.usage : undefined;
      await appendEvent(record.result.runId, {
        type: "special_agent.result",
        payload: {
          specialAgentStatus: record.result.status,
          childSessionKey: record.result.childSessionKey,
          ...(record.result.status === "completed"
            ? {
                reply: record.result.reply,
                endedAt: record.result.endedAt,
                usage,
                historyMessageCount: record.result.historyMessageCount,
              }
            : {
                error: record.result.error,
                ...(record.result.status === "wait_failed" && record.result.waitStatus
                  ? { waitStatus: record.result.waitStatus }
                  : {}),
                ...(record.result.status === "wait_failed" && record.result.endedAt
                  ? { endedAt: record.result.endedAt }
                  : {}),
              }),
          ...(record.summary !== undefined ? { summary: record.summary } : {}),
          ...(record.detail ? { detail: record.detail } : {}),
        },
        metadata: {
          specialAgentStatus: record.result.status,
          childSessionKey: record.result.childSessionKey,
          ...buildUsageMetadata(usage),
        },
      });

      await updateRunState(record.result.runId, {
        status: record.status ?? (record.result.status === "completed" ? "complete" : "failed"),
        summary: {
          specialAgentStatus: record.result.status,
          childSessionKey: record.result.childSessionKey,
          ...(record.summary !== undefined ? { summary: record.summary } : {}),
          ...(record.detail ? { detail: record.detail } : {}),
          ...(usage ? { usage } : {}),
          ...(record.result.status === "completed" &&
          typeof record.result.historyMessageCount === "number"
            ? { historyMessageCount: record.result.historyMessageCount }
            : {}),
          ...(record.result.status !== "completed" ? { error: record.result.error } : {}),
        },
        metadata: {
          specialAgentStatus: record.result.status,
          childSessionKey: record.result.childSessionKey,
          ...buildUsageMetadata(usage),
        },
      });
    },
  };
}
