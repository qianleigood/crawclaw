import type { UnifiedQueryClassification, UnifiedRecallLayer } from "../types/orchestration.ts";

export interface ExperienceQueryPlan {
  enabled: boolean;
  query: string;
  limit: number;
  targetLayers: UnifiedRecallLayer[];
  reason: string;
  providerIds: string[];
}

function clampLimit(value: number): number {
  if (!Number.isFinite(value)) {
    return 5;
  }
  return Math.max(1, Math.min(Math.round(value), 10));
}

function isPreferenceOnlyQuery(classification: UnifiedQueryClassification): boolean {
  return (
    classification.intent === "preference" &&
    !classification.targetLayers.includes("sop") &&
    !classification.targetLayers.includes("key_decisions") &&
    classification.routeWeights.nativeMemory >= classification.routeWeights.notebooklm
  );
}

function resolveLimit(params: {
  classification: UnifiedQueryClassification;
  defaultLimit: number;
}): number {
  const baseLimit = clampLimit(params.defaultLimit);
  if (params.classification.intent === "sop") {
    return Math.min(baseLimit + 2, 10);
  }
  if (
    params.classification.intent === "decision" ||
    params.classification.intent === "entity_lookup" ||
    params.classification.targetLayers.includes("key_decisions")
  ) {
    return Math.min(baseLimit + 1, 10);
  }
  return baseLimit;
}

export function buildExperienceQueryPlan(params: {
  query: string;
  classification: UnifiedQueryClassification;
  defaultLimit: number;
  providerIds?: string[];
}): ExperienceQueryPlan {
  const providerIds = params.providerIds ?? ["notebooklm"];
  if (isPreferenceOnlyQuery(params.classification)) {
    return {
      enabled: false,
      query: params.query,
      limit: 0,
      targetLayers: params.classification.targetLayers,
      reason: "preference_prefers_durable_memory",
      providerIds: [],
    };
  }

  const limit = resolveLimit({
    classification: params.classification,
    defaultLimit: params.defaultLimit,
  });
  return {
    enabled: true,
    query: params.query,
    limit,
    targetLayers: params.classification.targetLayers,
    reason: `intent:${params.classification.intent}`,
    providerIds,
  };
}
