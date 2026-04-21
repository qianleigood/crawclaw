import { classifyMemoryRecallItem } from "../recall/durable-memory-type.ts";
import type { DurableMemoryKind, UnifiedRankedItem } from "../types/orchestration.ts";

export interface DurableMemorySelectionItem {
  item: UnifiedRankedItem;
  durableKind: DurableMemoryKind;
  priority: number;
  prioritySource: "explicit" | "importance" | "score";
  reasons: string[];
}

export interface DurableMemorySelectionInput {
  items: readonly UnifiedRankedItem[];
  limit?: number;
}

export interface DurableMemorySelectionResult {
  items: DurableMemorySelectionItem[];
  selectedItemIds: string[];
  omittedItemIds: string[];
}

function clampLimit(limit: number | undefined): number {
  return Math.max(1, Math.min(limit ?? 4, 8));
}

function pickPriority(item: UnifiedRankedItem): {
  source: DurableMemorySelectionItem["prioritySource"];
  value: number;
} {
  const explicitPriority = item.metadata?.priority;
  if (typeof explicitPriority === "number" && Number.isFinite(explicitPriority)) {
    return { source: "explicit", value: explicitPriority };
  }
  if (
    typeof item.importance === "number" &&
    Number.isFinite(item.importance) &&
    item.importance > 0
  ) {
    return { source: "importance", value: item.importance };
  }
  return { source: "score", value: item.score };
}

function compareSelection(
  left: DurableMemorySelectionItem,
  right: DurableMemorySelectionItem,
): number {
  const leftPriority = pickPriority(left.item);
  const rightPriority = pickPriority(right.item);
  const priorityRank: Record<DurableMemorySelectionItem["prioritySource"], number> = {
    explicit: 2,
    importance: 1,
    score: 0,
  };
  return (
    priorityRank[rightPriority.source] - priorityRank[leftPriority.source] ||
    rightPriority.value - leftPriority.value ||
    right.item.score - left.item.score ||
    (right.item.updatedAt ?? 0) - (left.item.updatedAt ?? 0) ||
    left.item.title.localeCompare(right.item.title)
  );
}

export function selectDurableMemories(
  input: DurableMemorySelectionInput,
): DurableMemorySelectionResult {
  const limit = clampLimit(input.limit);
  const items = input.items
    .map((item) => {
      const classification = classifyMemoryRecallItem(item);
      const priority = pickPriority(item);
      if (classification.bucket !== "durable" || !classification.durableType) {
        return null;
      }
      const reasons = [
        ...classification.reasons,
        `priority=${priority.source}:${priority.value.toFixed(3)}`,
      ];
      return {
        item,
        durableKind: classification.durableType,
        priority: priority.value,
        prioritySource: priority.source,
        reasons,
      } satisfies DurableMemorySelectionItem;
    })
    .filter((entry): entry is DurableMemorySelectionItem => Boolean(entry))
    .toSorted(compareSelection)
    .slice(0, limit);

  const selectedItemIds = items.map((entry) => entry.item.id);
  const omittedItemIds = input.items
    .filter((item) => !selectedItemIds.includes(item.id))
    .map((item) => item.id);

  return {
    items,
    selectedItemIds,
    omittedItemIds,
  };
}
