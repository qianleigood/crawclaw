import type { RecallTrace } from "../types/recall.ts";
import type {
  UnifiedRecallTraceEnrichment,
  UnifiedRecallTraceEnrichmentInput,
  UnifiedTraceEntitySummary,
  UnifiedTraceSectionSummary,
} from "../types/orchestration.ts";

function collectEntities(input: UnifiedRecallTraceEnrichmentInput): UnifiedTraceEntitySummary[] {
  return (input.entityResolution?.selectedCandidates ?? []).map((entity) => ({
    id: entity.id,
    source: entity.source,
    title: entity.title,
    canonicalId: entity.canonicalId,
  }));
}

function collectSections(input: UnifiedRecallTraceEnrichmentInput): UnifiedTraceSectionSummary[] {
  return (input.assembled?.sections ?? []).map((section) => ({
    layer: section.kind,
    heading: section.heading,
    itemIds: section.itemIds,
    itemCount: section.itemIds.length,
    omittedCount: section.omittedCount,
  }));
}

export function buildUnifiedRecallTraceEnrichment(input: UnifiedRecallTraceEnrichmentInput): UnifiedRecallTraceEnrichment {
  return {
    queryType: input.classification?.intent ?? "unknown",
    entities: collectEntities(input),
    graphHits: input.rerankTrace?.counts.graph ?? input.graphItems?.length ?? 0,
    notebooklmHits: input.rerankTrace?.counts.notebooklm ?? input.notebooklmItems?.length ?? 0,
    nativeMemoryHits: input.rerankTrace?.counts.native_memory ?? input.nativeItems?.length ?? input.nativeMemoryResult?.items.length ?? 0,
    assembledSections: collectSections(input),
    nativeMemory: input.nativeMemoryResult?.trace,
  };
}

export function enrichRecallTraceWithUnified(
  trace: RecallTrace,
  input: UnifiedRecallTraceEnrichmentInput,
): RecallTrace {
  const unifiedRecall = buildUnifiedRecallTraceEnrichment(input);
  return {
    ...trace,
    queryType: unifiedRecall.queryType,
    entities: unifiedRecall.entities,
    graphHits: unifiedRecall.graphHits,
    notebooklmHits: unifiedRecall.notebooklmHits,
    nativeMemoryHits: unifiedRecall.nativeMemoryHits,
    assembledSections: unifiedRecall.assembledSections,
    unifiedRecall,
  };
}
