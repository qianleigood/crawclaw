import type { CrawClawConfig } from "../../config/config.js";
import type { ContextArchiveService } from "./service.js";
import type { ContextArchiveRunRecord } from "./types.js";
import { resolveSharedContextArchiveService } from "./runtime.js";

type ContextArchiveRunCaptureService = Pick<
  ContextArchiveService,
  "createRun" | "appendEvent" | "updateRun"
>;

export type ContextArchiveRunEventInput = {
  config?: CrawClawConfig;
  source: string;
  runId?: string;
  sessionId: string;
  sessionKey?: string;
  taskId?: string;
  agentId?: string;
  parentAgentId?: string;
  label?: string;
  kind?: ContextArchiveRunRecord["kind"];
  status?: ContextArchiveRunRecord["status"];
  type: string;
  turnIndex?: number;
  payload?: unknown;
  metadata?: Record<string, unknown>;
  createdAt?: number;
};

type ContextArchiveRunStateInput = {
  config?: CrawClawConfig;
  source: string;
  runId?: string;
  sessionId: string;
  sessionKey?: string;
  taskId?: string;
  agentId?: string;
  parentAgentId?: string;
  label?: string;
  kind?: ContextArchiveRunRecord["kind"];
  status: ContextArchiveRunRecord["status"];
  summary?: unknown;
  metadata?: Record<string, unknown>;
};

function buildRunKey(input: {
  source: string;
  runId?: string;
  taskId?: string;
  sessionId: string;
}): string {
  return [
    input.source,
    input.runId?.trim() || "",
    input.taskId?.trim() || "",
    input.sessionId,
  ].join("::");
}

export function createContextArchiveRunCapture(params: {
  archive?: ContextArchiveRunCaptureService;
}) {
  const runIdsByKey = new Map<string, string>();

  async function ensureRun(input: {
    source: string;
    runId?: string;
    sessionId: string;
    sessionKey?: string;
    taskId?: string;
    agentId?: string;
    parentAgentId?: string;
    label?: string;
    kind?: ContextArchiveRunRecord["kind"];
    status?: ContextArchiveRunRecord["status"];
  }): Promise<string | null> {
    if (!params.archive) {
      return null;
    }
    const key = buildRunKey(input);
    const existing = runIdsByKey.get(key);
    if (existing) {
      return existing;
    }
    const run = await params.archive.createRun({
      sessionId: input.sessionId,
      sessionKey: input.sessionKey,
      taskId: input.taskId,
      agentId: input.agentId,
      parentAgentId: input.parentAgentId,
      conversationUid:
        input.runId?.trim() || input.taskId?.trim() || input.sessionKey?.trim() || input.sessionId,
      kind:
        input.kind ??
        (input.taskId?.trim() || input.agentId?.trim() || input.runId?.trim() ? "task" : "session"),
      status: input.status ?? "recording",
      label: input.label?.trim() || input.source.trim(),
      metadata: {
        source: input.source.trim(),
        ...(input.runId?.trim() ? { runId: input.runId.trim() } : {}),
      },
    });
    runIdsByKey.set(key, run.id);
    return run.id;
  }

  async function appendEvent(input: {
    source: string;
    runId?: string;
    sessionId: string;
    sessionKey?: string;
    taskId?: string;
    agentId?: string;
    parentAgentId?: string;
    label?: string;
    kind?: ContextArchiveRunRecord["kind"];
    status?: ContextArchiveRunRecord["status"];
    type: string;
    turnIndex?: number;
    payload?: unknown;
    metadata?: Record<string, unknown>;
    createdAt?: number;
  }): Promise<string | null> {
    const runId = await ensureRun(input);
    if (!runId || !params.archive) {
      return null;
    }
    const event = await params.archive.appendEvent({
      runId,
      type: input.type.trim() || "event",
      ...(typeof input.turnIndex === "number" ? { turnIndex: input.turnIndex } : {}),
      ...(input.payload !== undefined ? { payload: input.payload } : {}),
      ...(input.metadata ? { metadata: input.metadata } : {}),
      createdAt: input.createdAt,
    });
    return event.id;
  }

  async function updateRunState(input: {
    source: string;
    runId?: string;
    sessionId: string;
    sessionKey?: string;
    taskId?: string;
    agentId?: string;
    parentAgentId?: string;
    label?: string;
    kind?: ContextArchiveRunRecord["kind"];
    status: ContextArchiveRunRecord["status"];
    summary?: unknown;
    metadata?: Record<string, unknown>;
  }): Promise<string | null> {
    const archiveRunId = await ensureRun(input);
    if (!archiveRunId || !params.archive) {
      return null;
    }
    await params.archive.updateRun({
      runId: archiveRunId,
      status: input.status,
      ...(input.summary !== undefined ? { summary: input.summary } : {}),
      ...(input.metadata ? { metadata: input.metadata } : {}),
    });
    return archiveRunId;
  }

  function reset(key?: {
    source: string;
    runId?: string;
    taskId?: string;
    sessionId: string;
  }): void {
    if (!key) {
      runIdsByKey.clear();
      return;
    }
    runIdsByKey.delete(buildRunKey(key));
  }

  return {
    appendEvent,
    updateRunState,
    reset,
  };
}

export async function captureContextArchiveRunEvent(
  input: ContextArchiveRunEventInput,
): Promise<string | undefined> {
  const archive = await resolveSharedContextArchiveService(input.config);
  if (!archive) {
    return undefined;
  }
  const capture = createContextArchiveRunCapture({ archive });
  return (await capture.appendEvent(input)) ?? undefined;
}

export async function updateContextArchiveRunState(
  input: ContextArchiveRunStateInput,
): Promise<string | undefined> {
  const archive = await resolveSharedContextArchiveService(input.config);
  if (!archive) {
    return undefined;
  }
  const capture = createContextArchiveRunCapture({ archive });
  return (await capture.updateRunState(input)) ?? undefined;
}
