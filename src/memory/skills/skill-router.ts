import type {
  SkillIndex,
  SkillMetadata,
  SkillRoutingResult,
  UnifiedQueryClassification,
  UnifiedRecallIntent,
  UnifiedSkillFamily,
} from "../types/orchestration.ts";

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function normalizeText(value: string | null | undefined): string {
  return (value ?? "").toLowerCase().replace(/\s+/g, " ").trim();
}

function tokenize(value: string | null | undefined): string[] {
  return normalizeText(value)
    .split(/[^a-z0-9\u4e00-\u9fff]+/i)
    .filter((token) => token.length >= 2);
}

function inferSkillFamily(intent: UnifiedRecallIntent): UnifiedSkillFamily | undefined {
  switch (intent) {
    case "decision":
      return "architecture";
    case "sop":
      return "operations";
    case "preference":
      return "workspace-defaults";
    case "runtime":
    case "history":
      return "incident";
    default:
      return undefined;
  }
}

function unique<T>(items: T[]): T[] {
  return [...new Set(items)];
}

function computeKeywordOverlap(classification: UnifiedQueryClassification, skill: SkillMetadata): number {
  const skillTerms = new Set([
    ...tokenize(skill.name),
    ...tokenize(skill.description),
    ...(skill.tags ?? []).flatMap((tag) => tokenize(tag)),
  ]);
  const queryTerms = unique([
    ...classification.keywords,
    ...classification.entityHints,
  ].flatMap((token) => tokenize(token)));
  if (!queryTerms.length || !skillTerms.size) return 0;
  const overlap = queryTerms.filter((token) => skillTerms.has(token)).length;
  return clamp01(overlap / Math.max(1, Math.min(4, queryTerms.length)));
}

function computeLayerMatch(classification: UnifiedQueryClassification, skill: SkillMetadata): number {
  const skillLayers = new Set(skill.layers ?? []);
  if (!skillLayers.size) return 0;
  const overlap = classification.targetLayers.filter((layer) => skillLayers.has(layer)).length;
  return clamp01(overlap / Math.max(1, classification.targetLayers.length));
}

function computeIntentMatch(classification: UnifiedQueryClassification, skill: SkillMetadata): number {
  const intents = skill.intents ?? [];
  if (intents.includes(classification.intent)) return 1;
  if (classification.secondaryIntents.some((intent) => intents.includes(intent))) return 0.65;
  return intents.includes("broad") ? 0.25 : 0;
}

function computeRuntimeRelevance(classification: UnifiedQueryClassification, skill: SkillMetadata): number {
  const runtimeLike = classification.intent === "runtime"
    || classification.intent === "history"
    || classification.secondaryIntents.includes("runtime")
    || classification.temporalHints.includes("recent");
  if (!runtimeLike) return 0;
  return skill.family === "incident" ? 1 : 0.15;
}

function computeEntityOverlap(classification: UnifiedQueryClassification, skill: SkillMetadata): number {
  if (!classification.entityHints.length) return 0;
  const haystack = normalizeText(`${skill.name} ${skill.description} ${(skill.tags ?? []).join(" ")}`);
  const hits = classification.entityHints.filter((hint) => haystack.includes(normalizeText(hint))).length;
  return clamp01(hits / Math.max(1, Math.min(3, classification.entityHints.length)));
}

function computeSkillScore(params: {
  classification: UnifiedQueryClassification;
  family?: UnifiedSkillFamily;
  skill: SkillMetadata;
}) {
  const intentMatch = computeIntentMatch(params.classification, params.skill);
  const familyMatch = params.family && params.skill.family === params.family ? 1 : 0;
  const keywordOverlap = computeKeywordOverlap(params.classification, params.skill);
  const layerMatch = computeLayerMatch(params.classification, params.skill);
  const entityOverlap = computeEntityOverlap(params.classification, params.skill);
  const runtimeRelevance = computeRuntimeRelevance(params.classification, params.skill);
  const priority = clamp01(params.skill.priority ?? 0.5);
  const score = (intentMatch * 0.35)
    + (familyMatch * 0.20)
    + (keywordOverlap * 0.15)
    + (layerMatch * 0.10)
    + (entityOverlap * 0.10)
    + (runtimeRelevance * 0.05)
    + (priority * 0.05);
  const reasons = [
    intentMatch > 0.5 ? "intent" : "",
    familyMatch > 0.5 ? "family" : "",
    keywordOverlap > 0.3 ? "keywords" : "",
    layerMatch > 0.3 ? "layers" : "",
    entityOverlap > 0.3 ? "entities" : "",
    runtimeRelevance > 0.3 ? "runtime" : "",
  ].filter(Boolean);
  return {
    score: Number(score.toFixed(4)),
    reasons,
  };
}

export function selectRelevantSkills(params: {
  classification: UnifiedQueryClassification;
  skillIndex: SkillIndex;
  limit?: number;
}): SkillRoutingResult {
  const family = params.classification.skillFamily ?? inferSkillFamily(params.classification.intent);
  const limit = Math.max(1, Math.min(params.limit ?? 5, 8));
  const ranked = params.skillIndex.skills
    .map((skill) => {
      const { score, reasons } = computeSkillScore({
        classification: params.classification,
        family,
        skill,
      });
      return {
        skill,
        score,
        reasons,
      };
    })
    .filter((entry) => entry.score >= 0.4)
    .sort((left, right) =>
      right.score - left.score || (right.skill.priority ?? 0) - (left.skill.priority ?? 0) || left.skill.name.localeCompare(right.skill.name),
    )
    .slice(0, limit);

  const top1 = ranked[0]?.score ?? 0;
  const surfacedSkills = ranked.map((entry) => entry.skill.name);
  const primarySkills = surfacedSkills.slice(0, 1);
  const supportingSkills = surfacedSkills.slice(1, Math.min(surfacedSkills.length, limit));

  return {
    intent: params.classification.intent,
    family,
    shortlisted: ranked.map((entry) => ({
      name: entry.skill.name,
      location: entry.skill.location,
      score: entry.score,
      reasons: entry.reasons,
    })),
    primarySkills,
    supportingSkills,
    surfacedSkills,
    confidence: Number(Math.max(params.classification.confidence, top1).toFixed(3)),
  };
}
