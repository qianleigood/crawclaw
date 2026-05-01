import type { UnifiedRankedItem, UnifiedRecallItem } from "../types/orchestration.ts";

export interface ExperienceRecallSelectionResult {
  items: UnifiedRankedItem[];
  selectedItemIds: string[];
  omittedItemIds: string[];
  omittedItems: UnifiedRankedItem[];
  mode: "provider_order" | "none";
}

function clampLimit(limit: number | undefined): number {
  return Math.max(1, Math.min(limit ?? 6, 10));
}

function isPromptFacingExperienceSource(item: UnifiedRecallItem): boolean {
  return item.source === "notebooklm";
}

function hasPromptFacingContent(item: UnifiedRecallItem): boolean {
  return item.summary.trim().length >= 24 || Boolean(item.content?.trim());
}

function itemDedupeKey(item: UnifiedRecallItem): string {
  return (item.canonicalKey ?? item.sourceRef ?? item.id).trim();
}

function providerOrderScoreBreakdown(finalScore: number): UnifiedRankedItem["scoreBreakdown"] {
  return {
    retrieval: 0,
    sourcePrior: 0,
    layerPrior: 0,
    memoryKindPrior: 0,
    entityBoost: 0,
    keywordBoost: 0,
    exactTitleBoost: 0,
    recencyBoost: 0,
    importanceBoost: 0,
    supportBoost: 0,
    lifecycleBoost: 0,
    mediaBoost: 0,
    penalty: 0,
    finalScore,
  };
}

function providerOrderScore(index: number): number {
  return Number(Math.max(0, 1 - index * 0.001).toFixed(6));
}

function toRankedProviderItem(item: UnifiedRecallItem, index: number): UnifiedRankedItem {
  const score = providerOrderScore(index);
  return {
    ...item,
    layer: item.layer ?? "runtime_signals",
    score,
    supportingSources: [item.source],
    supportingIds: [item.id],
    scoreBreakdown: providerOrderScoreBreakdown(score),
    metadata: {
      ...item.metadata,
      experienceRecallSelection: "notebooklm_provider_order",
      providerOrder: index,
    },
  };
}

export function selectExperienceRecall(input: {
  items: readonly UnifiedRecallItem[];
  limit?: number;
}): ExperienceRecallSelectionResult {
  const limit = clampLimit(input.limit);
  const candidates: UnifiedRankedItem[] = [];
  const omittedItems: UnifiedRankedItem[] = [];
  const seen = new Set<string>();

  for (const [index, item] of input.items.entries()) {
    const ranked = toRankedProviderItem(item, index);
    const key = itemDedupeKey(item);
    if (!isPromptFacingExperienceSource(item) || !hasPromptFacingContent(item) || seen.has(key)) {
      omittedItems.push(ranked);
      continue;
    }
    seen.add(key);
    candidates.push(ranked);
  }

  if (!candidates.length) {
    return {
      items: [],
      selectedItemIds: [],
      omittedItemIds: omittedItems.map((item) => item.id),
      omittedItems,
      mode: "none",
    };
  }
  const items = candidates.slice(0, limit);
  omittedItems.push(...candidates.slice(limit));
  if (!items.length) {
    return {
      items: [],
      selectedItemIds: [],
      omittedItemIds: omittedItems.map((item) => item.id),
      omittedItems,
      mode: "none",
    };
  }
  const selectedItemIds = items.map((item) => item.id);
  const omittedItemIds = omittedItems.map((item) => item.id);
  return { items, selectedItemIds, omittedItemIds, omittedItems, mode: "provider_order" };
}
