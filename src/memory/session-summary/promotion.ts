import { DistillationService } from "../promotion/distillation-service.ts";
import type { PromotionMessageLike, PromotionCandidateDraft } from "../promotion/types.ts";
import type { RuntimeStore } from "../runtime/runtime-store.ts";
import type { PromotionCandidate } from "../types/runtime.ts";
import {
  getSessionSummarySectionText,
  type SessionSummaryDocument,
  type SessionSummarySectionKey,
} from "./template.ts";

function buildPromotionMessages(params: {
  document: SessionSummaryDocument | null | undefined;
  summaryUpdatedAt?: number | null;
}): PromotionMessageLike[] {
  const sectionOrder: Array<{ key: SessionSummarySectionKey; heading: string }> = [
    { key: "currentState", heading: "Current State" },
    { key: "openLoops", heading: "Open Loops" },
    { key: "taskSpecification", heading: "Task specification" },
    { key: "workflow", heading: "Workflow" },
    { key: "errorsAndCorrections", heading: "Errors & Corrections" },
    { key: "keyResults", heading: "Key results" },
  ];
  const messages: PromotionMessageLike[] = [];
  for (const [index, { key, heading }] of sectionOrder.entries()) {
    const text = getSessionSummarySectionText(params.document, key).trim();
    if (!text) {
      continue;
    }
    messages.push({
      id: `session-summary:${key}`,
      role: "assistant",
      content: `${heading}: ${text}`,
      turnIndex: index + 1,
      createdAt: params.summaryUpdatedAt ?? undefined,
    });
  }
  return messages;
}

function parseCandidateTitle(row: PromotionCandidate): string | null {
  try {
    const parsed = JSON.parse(row.candidateJson) as { title?: unknown };
    return typeof parsed.title === "string" && parsed.title.trim() ? parsed.title.trim() : null;
  } catch {
    return null;
  }
}

function normalizeSessionSummaryDrafts(
  sessionId: string,
  drafts: PromotionCandidateDraft[],
): PromotionCandidateDraft[] {
  return drafts
    .filter((draft) => draft.candidate.memoryBucket === "durable")
    .slice(0, 1)
    .map((draft) => {
      const candidate = {
        ...draft.candidate,
        sourceHint: `session summary distillation: ${draft.candidate.sourceHint}`,
      };
      return {
        ...draft,
        sessionId,
        sourceType: "session_summary_distillation",
        candidate,
        candidateJson: JSON.stringify(candidate),
      };
    });
}

export async function extractSessionSummaryPromotionCandidates(params: {
  sessionId: string;
  document: SessionSummaryDocument | null | undefined;
  summaryUpdatedAt?: number | null;
}): Promise<PromotionCandidateDraft[]> {
  const messages = buildPromotionMessages({
    document: params.document,
    summaryUpdatedAt: params.summaryUpdatedAt ?? undefined,
  });
  if (!messages.length) {
    return [];
  }
  const distillation = await new DistillationService().distill({
    sessionId: params.sessionId,
    messages,
    maxCandidates: 1,
  });
  return normalizeSessionSummaryDrafts(params.sessionId, distillation.candidates);
}

export async function persistSessionSummaryPromotionCandidates(params: {
  runtimeStore: RuntimeStore;
  sessionId: string;
  document: SessionSummaryDocument | null | undefined;
  summaryUpdatedAt?: number | null;
}): Promise<{ created: number; updated: number; candidateIds: string[] }> {
  const drafts = await extractSessionSummaryPromotionCandidates({
    sessionId: params.sessionId,
    document: params.document,
    summaryUpdatedAt: params.summaryUpdatedAt ?? undefined,
  });
  if (!drafts.length) {
    return { created: 0, updated: 0, candidateIds: [] };
  }

  const existingRows = await params.runtimeStore.listRecentPromotionCandidates(200);
  let created = 0;
  let updated = 0;
  const candidateIds: string[] = [];

  for (const draft of drafts) {
    const existing = existingRows.find(
      (row) =>
        row.sessionId === params.sessionId &&
        row.sourceType === "session_summary_distillation" &&
        parseCandidateTitle(row)?.toLowerCase() === draft.candidate.title.trim().toLowerCase(),
    );
    if (existing) {
      await params.runtimeStore.updatePromotionCandidate({
        id: existing.id,
        status: "pending",
        sourceRefsJson: draft.sourceRefsJson,
        candidateJson: draft.candidateJson,
      });
      updated += 1;
      candidateIds.push(existing.id);
      continue;
    }
    const id = await params.runtimeStore.createPromotionCandidate({
      sessionId: params.sessionId,
      sourceType: "session_summary_distillation",
      sourceRefsJson: draft.sourceRefsJson,
      candidateJson: draft.candidateJson,
      status: "pending",
    });
    created += 1;
    candidateIds.push(id);
  }

  return { created, updated, candidateIds };
}
