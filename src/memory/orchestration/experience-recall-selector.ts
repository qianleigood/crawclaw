import { classifyMemoryRecallItem } from "../recall/durable-memory-type.ts";
import type { UnifiedRankedItem } from "../types/orchestration.ts";

export interface ExperienceRecallSelectionResult {
  items: UnifiedRankedItem[];
  selectedItemIds: string[];
  omittedItemIds: string[];
  omittedItems: UnifiedRankedItem[];
  mode: "heuristic" | "none";
}

function clampLimit(limit: number | undefined): number {
  return Math.max(1, Math.min(limit ?? 6, 10));
}

function isPromptFacingExperienceSource(item: UnifiedRankedItem): boolean {
  return item.source === "notebooklm";
}

export function selectExperienceRecall(input: {
  items: readonly UnifiedRankedItem[];
  limit?: number;
}): ExperienceRecallSelectionResult {
  const limit = clampLimit(input.limit);
  const candidates = input.items
    .filter((item) => classifyMemoryRecallItem(item).bucket === "experience")
    .filter(isPromptFacingExperienceSource)
    .filter((item) => item.summary.trim().length >= 24 || item.content?.trim().length)
    .toSorted((left, right) => right.score - left.score)
    .slice(0, Math.max(limit * 2, 6));
  if (!candidates.length) {
    return {
      items: [],
      selectedItemIds: [],
      omittedItemIds: input.items.map((item) => item.id),
      omittedItems: [...input.items],
      mode: "none",
    };
  }
  const topScore = candidates[0]?.score ?? 0;
  const scoreFloor = Math.max(0.45, topScore - 0.22);
  const items = candidates
    .filter((item, index) => (index === 0 ? item.score >= 0.45 : item.score >= scoreFloor))
    .slice(0, limit);
  if (!items.length) {
    return {
      items: [],
      selectedItemIds: [],
      omittedItemIds: input.items.map((item) => item.id),
      omittedItems: [...input.items],
      mode: "none",
    };
  }
  const selectedItemIds = items.map((item) => item.id);
  const omittedItemIds = input.items
    .filter((item) => !selectedItemIds.includes(item.id))
    .map((item) => item.id);
  const omittedItems = input.items.filter((item) => !selectedItemIds.includes(item.id));
  return { items, selectedItemIds, omittedItemIds, omittedItems, mode: "heuristic" };
}
