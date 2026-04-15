import { classifyClaudeMemoryItem } from "../recall/durable-memory-type.ts";
import type { UnifiedRankedItem } from "../types/orchestration.ts";

export interface KnowledgeRecallSelectionResult {
  items: UnifiedRankedItem[];
  selectedItemIds: string[];
  omittedItemIds: string[];
  mode: "heuristic" | "none";
}

function clampLimit(limit: number | undefined): number {
  return Math.max(1, Math.min(limit ?? 6, 10));
}

export function selectKnowledgeRecall(input: { items: readonly UnifiedRankedItem[]; limit?: number }): KnowledgeRecallSelectionResult {
  const limit = clampLimit(input.limit);
  const candidates = input.items
    .filter((item) => classifyClaudeMemoryItem(item).bucket === "knowledge")
    .filter((item) => item.source === "notebooklm")
    .filter((item) => item.summary.trim().length >= 24 || item.content?.trim().length)
    .toSorted((left, right) => right.score - left.score)
    .slice(0, Math.max(limit * 2, 6));
  if (!candidates.length) {
    return {
      items: [],
      selectedItemIds: [],
      omittedItemIds: input.items.map((item) => item.id),
      mode: "none",
    };
  }
  const topScore = candidates[0]?.score ?? 0;
  const scoreFloor = Math.max(0.45, topScore - 0.22);
  const items = candidates
    .filter((item, index) => index === 0 ? item.score >= 0.45 : item.score >= scoreFloor)
    .slice(0, Math.min(limit, 4));
  if (!items.length) {
    return {
      items: [],
      selectedItemIds: [],
      omittedItemIds: input.items.map((item) => item.id),
      mode: "none",
    };
  }
  const selectedItemIds = items.map((item) => item.id);
  const omittedItemIds = input.items.filter((item) => !selectedItemIds.includes(item.id)).map((item) => item.id);
  return { items, selectedItemIds, omittedItemIds, mode: "heuristic" };
}
