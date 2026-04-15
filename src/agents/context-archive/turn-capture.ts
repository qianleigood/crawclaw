import type { AgentMessage, AgentTool } from "@mariozechner/pi-agent-core";
import type { CrawClawConfig } from "../../config/config.js";
import type { SessionSystemPromptReport } from "../../config/sessions/types.js";
import type {
  QueryContextDiagnostics,
  QueryContextProviderRequestSnapshot,
  QueryContextSection,
} from "../query-context/types.js";
import { resolveSharedContextArchiveService } from "./runtime.js";
import type { ContextArchiveService } from "./service.js";
import type { ContextArchiveRunRecord } from "./types.js";

type ContextArchiveCaptureService = Pick<ContextArchiveService, "createRun" | "appendEvent">;

type PromptImageRefSnapshot = {
  type?: string;
  raw?: string;
  resolved?: string;
};

export type ModelVisibleContextCaptureInput = {
  config?: CrawClawConfig;
  runId: string;
  sessionId: string;
  sessionKey?: string;
  agentId?: string;
  prompt: string;
  systemPrompt: string;
  systemContextSections?: QueryContextSection[];
  messages: AgentMessage[];
  tools: AgentTool[];
  provider: string;
  model: string;
  systemPromptReport?: SessionSystemPromptReport;
  queryContextDiagnostics?: QueryContextDiagnostics;
  providerRequestSnapshot?: QueryContextProviderRequestSnapshot;
  images?: {
    count: number;
    detectedRefs?: PromptImageRefSnapshot[];
  };
  metadata?: Record<string, unknown>;
};

export function createContextArchiveTurnCapture(params: {
  archive?: ContextArchiveCaptureService;
}) {
  const runIdsBySession = new Map<string, string>();

  async function ensureRun(input: {
    sessionId: string;
    sessionKey?: string;
    agentId?: string;
    turnIndex?: number;
  }): Promise<string | null> {
    if (!params.archive) {
      return null;
    }
    const existing = runIdsBySession.get(input.sessionId);
    if (existing) {
      return existing;
    }
    const run: ContextArchiveRunRecord = await params.archive.createRun({
      sessionId: input.sessionId,
      sessionKey: input.sessionKey,
      agentId: input.agentId,
      kind: "session",
      status: "recording",
      ...(typeof input.turnIndex === "number" ? { turnIndex: input.turnIndex } : {}),
      label: "memory-context-assembly",
      metadata: {
        source: "context-memory-runtime",
      },
    });
    runIdsBySession.set(input.sessionId, run.id);
    return run.id;
  }

  async function captureModelVisibleContext(input: {
    type?: string;
    sessionId: string;
    sessionKey?: string;
    agentId?: string;
    turnIndex?: number;
    payload: unknown;
  }): Promise<string | null> {
    return await appendEvent({
      sessionId: input.sessionId,
      sessionKey: input.sessionKey,
      agentId: input.agentId,
      turnIndex: input.turnIndex,
      type: input.type?.trim() || "turn.model_visible_context",
      payload: input.payload,
    });
  }

  async function appendEvent(input: {
    sessionId: string;
    sessionKey?: string;
    agentId?: string;
    turnIndex?: number;
    type: string;
    payload?: unknown;
    metadata?: Record<string, unknown>;
  }): Promise<string | null> {
    const runId = await ensureRun(input);
    if (!runId || !params.archive) {
      return null;
    }
    const event = await params.archive.appendEvent({
      runId,
      type: input.type?.trim() || "event",
      ...(typeof input.turnIndex === "number" ? { turnIndex: input.turnIndex } : {}),
      ...(input.payload !== undefined ? { payload: input.payload } : {}),
      ...(input.metadata ? { metadata: input.metadata } : {}),
    });
    return event.id;
  }

  function reset(sessionId?: string): void {
    if (sessionId) {
      runIdsBySession.delete(sessionId);
      return;
    }
    runIdsBySession.clear();
  }

  return {
    appendEvent,
    captureModelVisibleContext,
    reset,
  };
}

function snapshotTool(tool: AgentTool): Record<string, unknown> {
  return {
    name: tool.name,
    ...(tool.label?.trim() ? { label: tool.label.trim() } : {}),
    ...(tool.description?.trim() ? { description: tool.description.trim() } : {}),
    ...(tool.parameters ? { parameters: tool.parameters } : {}),
  };
}

function summarizeCapture(input: ModelVisibleContextCaptureInput): Record<string, unknown> {
  return {
    eventKind: "turn.model_visible_context",
    provider: input.provider,
    model: input.model,
    promptChars: input.prompt.length,
    systemPromptChars: input.systemPrompt.length,
    messageCount: input.messages.length,
    toolCount: input.tools.length,
    imageCount: input.images?.count ?? 0,
    queryContextHash:
      input.providerRequestSnapshot?.queryContextHash ??
      input.queryContextDiagnostics?.queryContextHash,
  };
}

export async function captureModelVisibleContextToService(
  archive: ContextArchiveService,
  input: ModelVisibleContextCaptureInput,
): Promise<string> {
  const run = await archive.createRun({
    sessionId: input.sessionId,
    conversationUid: input.sessionKey ?? input.sessionId,
    sessionKey: input.sessionKey,
    agentId: input.agentId,
    kind: "turn",
    metadata: {
      captureKind: "model-visible-context",
      runId: input.runId,
      provider: input.provider,
      model: input.model,
      ...input.metadata,
    },
  });
  const toolSnapshot = input.tools.map(snapshotTool);
  const toolBlob = await archive.putBlob({
    runId: run.id,
    blobKey: "tools.schema",
    blobKind: "tool-schema-snapshot",
    content: toolSnapshot,
    metadata: { toolCount: toolSnapshot.length },
  });
  await archive.appendEvent({
    runId: run.id,
    type: "turn.model_visible_context",
    blobKeys: [toolBlob.blobKey],
    payload: {
      version: 1,
      runId: input.runId,
      sessionId: input.sessionId,
      sessionKey: input.sessionKey,
      agentId: input.agentId,
      provider: input.provider,
      model: input.model,
      prompt: input.prompt,
      systemPrompt: input.systemPrompt,
      ...(input.systemContextSections?.length
        ? { systemContextSections: input.systemContextSections }
        : {}),
      messages: input.messages,
      toolNames: input.tools.map((tool) => tool.name),
      toolSchemaBlobKey: toolBlob.blobKey,
      ...(input.systemPromptReport ? { systemPromptReport: input.systemPromptReport } : {}),
      ...(input.queryContextDiagnostics
        ? { queryContextDiagnostics: input.queryContextDiagnostics }
        : {}),
      ...(input.providerRequestSnapshot
        ? { providerRequestSnapshot: input.providerRequestSnapshot }
        : {}),
      ...(input.images
        ? {
            images: {
              count: input.images.count,
              detectedRefs: input.images.detectedRefs ?? [],
            },
          }
        : {}),
    },
  });
  await archive.updateRun({
    runId: run.id,
    status: "complete",
    summary: summarizeCapture(input),
  });
  return run.id;
}

export async function captureModelVisibleContext(
  input: ModelVisibleContextCaptureInput,
): Promise<string | undefined> {
  const archive = await resolveSharedContextArchiveService(input.config);
  if (!archive) {
    return undefined;
  }
  return await captureModelVisibleContextToService(archive, input);
}
