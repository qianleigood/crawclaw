import { projectMemoryKind, type MemoryKind } from "../recall/memory-kind.ts";
import { normalizeRecallText, tokenizeRecallText } from "../recall/query-analysis.ts";
import type {
  UnifiedEntityCandidate,
  UnifiedRerankInput,
  UnifiedRerankResult,
  UnifiedRankedItem,
  UnifiedRecallItem,
  UnifiedRecallLayer,
  UnifiedRecallSource,
} from "../types/orchestration.ts";

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function normalizeKey(input: string): string {
  return normalizeRecallText(input)
    .toLowerCase()
    .replace(/["'“”‘’`]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function recencyBoost(updatedAt?: number): number {
  if (!updatedAt) {
    return 0;
  }
  const ageHours = Math.max(0, (Date.now() - updatedAt) / 3_600_000);
  if (ageHours <= 6) {
    return 0.12;
  }
  if (ageHours <= 24) {
    return 0.08;
  }
  if (ageHours <= 72) {
    return 0.05;
  }
  if (ageHours <= 168) {
    return 0.02;
  }
  return 0;
}

function tokenizeQuery(query: string): string[] {
  return tokenizeRecallText(query.toLowerCase()).filter((token) => token.length >= 2);
}

function inferLayer(item: UnifiedRecallItem): UnifiedRecallLayer {
  if (item.layer) {
    return item.layer;
  }
  if (item.memoryKind === "preference") {
    return "preferences";
  }
  if (item.memoryKind === "decision") {
    return "key_decisions";
  }
  if (item.memoryKind === "procedure") {
    return "sop";
  }
  if (item.memoryKind === "reference") {
    return "sources";
  }
  if (item.memoryKind === "runtime_pattern") {
    return "runtime_signals";
  }
  const text = `${item.title} ${item.summary}`.toLowerCase();
  if (/(decision|trade ?off|架构|为什么这样|why)/i.test(text)) {
    return "key_decisions";
  }
  if (/(sop|runbook|playbook|步骤|流程|排查|procedure)/i.test(text)) {
    return "sop";
  }
  if (/(偏好|prefer|默认|习惯|always|never)/i.test(text) || item.source === "native_memory") {
    return "preferences";
  }
  if (
    /(runtime|状态|incident|signal|recent|latest|execution)/i.test(text) ||
    item.source === "execution"
  ) {
    return "runtime_signals";
  }
  if (item.source === "notebooklm" || item.source === "local_experience_index") {
    return "key_decisions";
  }
  return "runtime_signals";
}

function exactTitleBoost(query: string, title: string): number {
  const normalizedQuery = normalizeKey(query);
  const normalizedTitle = normalizeKey(title);
  if (!normalizedQuery || !normalizedTitle) {
    return 0;
  }
  if (normalizedQuery === normalizedTitle) {
    return 0.22;
  }
  if (normalizedQuery.includes(normalizedTitle) || normalizedTitle.includes(normalizedQuery)) {
    return 0.14;
  }
  return 0;
}

function keywordBoost(queryTokens: string[], item: UnifiedRecallItem): number {
  if (!queryTokens.length) {
    return 0;
  }
  const haystack = new Set(
    tokenizeRecallText(`${item.title} ${item.summary} ${item.content ?? ""}`.toLowerCase()),
  );
  const overlap = queryTokens.filter((token) => haystack.has(token)).length;
  return clamp(overlap * 0.03, 0, 0.15);
}

function entityBoost(item: UnifiedRecallItem, selectedEntities: UnifiedEntityCandidate[]): number {
  if (!selectedEntities.length) {
    return 0;
  }
  const entityIds = new Set(selectedEntities.map((entity) => entity.id));
  const canonicalIds = new Set(
    selectedEntities
      .map((entity) => entity.canonicalId)
      .filter((value): value is string => Boolean(value)),
  );
  const refs = new Set(item.entityRefs ?? []);
  let boost = 0;
  for (const id of entityIds) {
    if (refs.has(id)) {
      boost += 0.12;
    }
  }
  if (item.canonicalKey && canonicalIds.has(item.canonicalKey)) {
    boost += 0.08;
  }
  return clamp(boost, 0, 0.24);
}

function layerPrior(layer: UnifiedRecallLayer, targets: UnifiedRecallLayer[]): number {
  if (targets.includes(layer)) {
    return 0.16;
  }
  if (layer === "sources") {
    return 0;
  }
  return 0.04;
}

function memoryKindPrior(kind: MemoryKind, input: UnifiedRerankInput): number {
  const intent = input.classification?.intent;
  switch (intent) {
    case "decision":
      if (kind === "decision") {
        return 0.14;
      }
      if (kind === "reference") {
        return 0.08;
      }
      if (kind === "procedure") {
        return 0.04;
      }
      return 0;
    case "sop":
      if (kind === "procedure") {
        return 0.14;
      }
      if (kind === "preference") {
        return 0.07;
      }
      if (kind === "runtime_pattern") {
        return 0.05;
      }
      return 0;
    case "preference":
      if (kind === "preference") {
        return 0.14;
      }
      if (kind === "procedure") {
        return 0.05;
      }
      return 0;
    case "runtime":
    case "history":
      if (kind === "runtime_pattern") {
        return 0.12;
      }
      if (kind === "procedure") {
        return 0.06;
      }
      if (kind === "reference") {
        return 0.04;
      }
      return 0;
    default:
      if (kind === "decision" || kind === "procedure") {
        return 0.04;
      }
      return 0;
  }
}

function parseLifecycleWeight(item: UnifiedRecallItem): number {
  const signal = item.metadata?.formalLifecycleSignal as Record<string, unknown> | undefined;
  if (!signal) {
    return 0;
  }
  if (typeof signal.recallWeight === "number") {
    return clamp(signal.recallWeight, -0.2, 0.12);
  }
  const stage = typeof signal.stage === "string" ? signal.stage : "candidate";
  if (stage === "formalized") {
    return 0.08;
  }
  if (stage === "formalizing") {
    return 0.02;
  }
  if (stage === "stale") {
    return -0.1;
  }
  if (stage === "failed") {
    return -0.18;
  }
  return 0;
}

function sourcePrior(source: UnifiedRecallSource, input: UnifiedRerankInput): number {
  const weights = input.classification?.routeWeights;
  if (!weights) {
    return 0.1;
  }
  if (source === "graph") {
    return weights.graph * 0.3;
  }
  if (source === "notebooklm" || source === "local_experience_index") {
    return weights.notebooklm * 0.3;
  }
  if (source === "native_memory") {
    return weights.nativeMemory * 0.3;
  }
  return weights.execution * 0.3;
}

function mediaBoost(item: UnifiedRecallItem, input: UnifiedRerankInput): number {
  if (!input.queryHasImage) {
    return 0;
  }
  const hasImage = item.metadata?.hasImage === true;
  const hasVisualSummary =
    typeof item.metadata?.visualSummary === "string" && item.metadata.visualSummary.length > 0;
  const mediaIds = Array.isArray(item.metadata?.mediaIds) ? item.metadata.mediaIds : [];
  if (hasImage && hasVisualSummary) {
    return 0.14;
  }
  if (hasImage || mediaIds.length > 0) {
    return 0.1;
  }
  return 0;
}

function dedupeKey(item: UnifiedRecallItem): string {
  return item.canonicalKey
    ? normalizeKey(item.canonicalKey)
    : normalizeKey(`${item.source}:${item.title}`);
}

function mergeDuplicate(base: UnifiedRecallItem, next: UnifiedRecallItem): UnifiedRecallItem {
  return {
    ...base,
    summary: base.summary.length >= next.summary.length ? base.summary : next.summary,
    content: base.content ?? next.content,
    memoryKind: base.memoryKind ?? next.memoryKind,
    retrievalScore: Math.max(base.retrievalScore ?? 0, next.retrievalScore ?? 0),
    importance: Math.max(base.importance ?? 0, next.importance ?? 0),
    updatedAt: Math.max(base.updatedAt ?? 0, next.updatedAt ?? 0) || undefined,
    entityRefs: [...new Set([...(base.entityRefs ?? []), ...(next.entityRefs ?? [])])],
    sourceRef: base.sourceRef ?? next.sourceRef,
    metadata: {
      ...base.metadata,
      ...next.metadata,
    },
  };
}

function flattenItems(input: UnifiedRerankInput): {
  items: UnifiedRecallItem[];
  counts: Record<UnifiedRecallSource, number>;
} {
  const bySource: Array<[UnifiedRecallSource, UnifiedRecallItem[] | undefined]> = [
    ["graph", input.graphItems],
    ["notebooklm", input.notebooklmItems],
    ["native_memory", input.nativeItems],
    ["execution", input.executionItems],
  ];
  const notebookLmItems = input.notebooklmItems ?? [];
  const counts = {
    graph: input.graphItems?.length ?? 0,
    notebooklm: notebookLmItems.filter((item) => item.source !== "local_experience_index").length,
    local_experience_index: notebookLmItems.filter(
      (item) => item.source === "local_experience_index",
    ).length,
    native_memory: input.nativeItems?.length ?? 0,
    execution: input.executionItems?.length ?? 0,
  } satisfies Record<UnifiedRecallSource, number>;

  const merged: UnifiedRecallItem[] = [];
  for (const [source, items] of bySource) {
    for (const item of items ?? []) {
      merged.push({ ...item, source: item.source ?? source });
    }
  }
  return { items: merged, counts };
}

export function rerankUnifiedResults(input: UnifiedRerankInput): UnifiedRerankResult {
  const { items, counts } = flattenItems(input);
  const queryTokens = tokenizeQuery(input.query);
  const selectedEntities = input.entityResolution?.selectedCandidates ?? [];
  const targets = input.classification?.targetLayers ?? [
    "key_decisions",
    "runtime_signals",
    "sources",
  ];

  const deduped = new Map<string, { item: UnifiedRecallItem; support: UnifiedRecallItem[] }>();
  for (const item of items) {
    const key = dedupeKey(item);
    const existing = deduped.get(key);
    if (!existing) {
      const memoryKind = projectMemoryKind(item);
      deduped.set(key, {
        item: { ...item, memoryKind, layer: inferLayer({ ...item, memoryKind }) },
        support: [{ ...item, memoryKind }],
      });
      continue;
    }
    const next = { ...item, memoryKind: projectMemoryKind(item), layer: inferLayer(item) };
    existing.item = mergeDuplicate(existing.item, next);
    existing.support.push(next);
  }

  const ranked = [...deduped.values()]
    .map(({ item, support }): UnifiedRankedItem => {
      const memoryKind = projectMemoryKind(item);
      const layer = inferLayer({ ...item, memoryKind });
      const retrieval = clamp(item.retrievalScore ?? 0.55, 0, 1) * 0.38;
      const sourceScore = sourcePrior(item.source, input);
      const layerScore = layerPrior(layer, targets);
      const kindScore = memoryKindPrior(memoryKind, input);
      const entityScore = entityBoost(item, selectedEntities);
      const keywordScore = keywordBoost(queryTokens, item);
      const exactScore = exactTitleBoost(input.query, item.title);
      const recencyScore = recencyBoost(item.updatedAt);
      const importanceScore = clamp(item.importance ?? 0, 0, 1) * 0.12;
      const supportScore = clamp(
        (new Set(support.map((entry) => entry.source)).size - 1) * 0.04,
        0,
        0.12,
      );
      const lifecycleBoost = parseLifecycleWeight(item);
      const mediaScore = mediaBoost(item, input);
      const penalty = item.source === "execution" && layer !== "runtime_signals" ? 0.04 : 0;
      const finalScore =
        retrieval +
        sourceScore +
        layerScore +
        kindScore +
        entityScore +
        keywordScore +
        exactScore +
        recencyScore +
        importanceScore +
        supportScore +
        lifecycleBoost +
        mediaScore -
        penalty;

      return {
        ...item,
        layer,
        memoryKind,
        score: Number(finalScore.toFixed(6)),
        supportingSources: [...new Set(support.map((entry) => entry.source))],
        supportingIds: [...new Set(support.map((entry) => entry.id))],
        scoreBreakdown: {
          retrieval: Number(retrieval.toFixed(6)),
          sourcePrior: Number(sourceScore.toFixed(6)),
          layerPrior: Number(layerScore.toFixed(6)),
          memoryKindPrior: Number(kindScore.toFixed(6)),
          entityBoost: Number(entityScore.toFixed(6)),
          keywordBoost: Number(keywordScore.toFixed(6)),
          exactTitleBoost: Number(exactScore.toFixed(6)),
          recencyBoost: Number(recencyScore.toFixed(6)),
          importanceBoost: Number(importanceScore.toFixed(6)),
          supportBoost: Number(supportScore.toFixed(6)),
          lifecycleBoost: Number(lifecycleBoost.toFixed(6)),
          mediaBoost: Number(mediaScore.toFixed(6)),
          penalty: Number(penalty.toFixed(6)),
          finalScore: Number(finalScore.toFixed(6)),
        },
      };
    })
    .toSorted((a, b) => b.score - a.score);

  return {
    items: ranked.slice(0, input.limit ?? 12),
    trace: {
      counts,
      deduped: items.length - deduped.size,
    },
  };
}

export class UnifiedReranker {
  rerank(input: UnifiedRerankInput): UnifiedRerankResult {
    return rerankUnifiedResults(input);
  }
}
