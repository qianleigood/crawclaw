import {
  searchSkillDescriptions,
  type SkillSearchCandidate,
  type SkillSearchResult,
} from "./search.js";

export type SkillDiscoverySignal = "turn_zero" | "next_action" | "manual";
export type SkillDiscoverySource = "native" | "llm" | "both";

export type SkillDiscoveryCandidate = SkillSearchCandidate;

export type SkillDiscoveryMatch = SkillDiscoveryCandidate & {
  score: number;
  reasons: string[];
  source: SkillDiscoverySource;
};

export type SkillDiscoveryRerankRequest = {
  taskDescription: string;
  candidates: SkillDiscoveryCandidate[];
  limit: number;
};

export type SkillSemanticRetrieveRequest = {
  taskDescription: string;
  availableSkills: readonly SkillDiscoveryCandidate[];
  excludeSkillNames?: readonly string[];
  limit: number;
  recallLimit: number;
};

export type SkillSemanticRetriever = (
  request: SkillSemanticRetrieveRequest,
) => Promise<SkillDiscoveryCandidate[]>;

export type SkillDiscoveryRerankResult = {
  skillNames: string[];
  reason?: string;
  confidence?: number;
};

export type SkillDiscoveryResult = {
  skills: SkillDiscoveryMatch[];
  signal: SkillDiscoverySignal;
  source: SkillDiscoverySource;
  reason?: string;
  confidence?: number;
};

export type SkillDiscoveryReranker = (
  request: SkillDiscoveryRerankRequest,
) => Promise<SkillDiscoveryRerankResult>;

function normalizeLimit(limit: number | undefined): number {
  return Math.max(1, Math.min(limit ?? 5, 8));
}

function normalizeSkillNames(skillNames: readonly string[] | undefined): string[] {
  return [...new Set((skillNames ?? []).map((name) => name.trim()).filter(Boolean))];
}

function toCandidateByName(
  candidates: readonly SkillDiscoveryCandidate[],
): Map<string, SkillDiscoveryCandidate> {
  return new Map(candidates.map((candidate) => [candidate.name, candidate]));
}

function toMatch(params: {
  candidate: SkillDiscoveryCandidate;
  localMatch?: SkillSearchResult;
  source: SkillDiscoverySource;
}): SkillDiscoveryMatch {
  return {
    ...params.candidate,
    score: params.localMatch?.score ?? 0,
    reasons: params.localMatch?.reasons ?? [],
    source: params.source,
  };
}

function selectRerankCandidates(params: {
  availableSkills: readonly SkillDiscoveryCandidate[];
  semanticMatches: readonly SkillDiscoveryCandidate[];
  localMatches: readonly SkillSearchResult[];
  excludeSkillNames?: readonly string[];
  recallLimit: number;
  allowAvailableFallback?: boolean;
}): SkillDiscoveryCandidate[] {
  const excluded = new Set(normalizeSkillNames(params.excludeSkillNames));
  const candidates = new Map<string, SkillDiscoveryCandidate>();
  for (const skill of params.semanticMatches) {
    if (!skill.name.trim() || excluded.has(skill.name)) {
      continue;
    }
    candidates.set(skill.name, skill);
  }
  if (params.localMatches.length > 0) {
    for (const match of params.localMatches) {
      if (!match.name.trim() || excluded.has(match.name) || candidates.has(match.name)) {
        continue;
      }
      candidates.set(match.name, match);
      if (candidates.size >= params.recallLimit) {
        break;
      }
    }
    return [...candidates.values()].slice(0, params.recallLimit);
  }
  if (candidates.size === 0 && params.allowAvailableFallback === true) {
    for (const skill of params.availableSkills) {
      if (!skill.name.trim() || excluded.has(skill.name)) {
        continue;
      }
      candidates.set(skill.name, skill);
      if (candidates.size >= params.recallLimit) {
        break;
      }
    }
  }
  return [...candidates.values()].slice(0, params.recallLimit);
}

export async function discoverSkillsForTask(params: {
  taskDescription: string;
  availableSkills: readonly SkillDiscoveryCandidate[];
  excludeSkillNames?: readonly string[];
  limit?: number;
  recallLimit?: number;
  signal?: SkillDiscoverySignal;
  semanticRetrieve?: SkillSemanticRetriever;
  rerank?: SkillDiscoveryReranker;
}): Promise<SkillDiscoveryResult> {
  const taskDescription = params.taskDescription.trim();
  const signal = params.signal ?? "manual";
  if (!taskDescription) {
    return { skills: [], signal, source: "native" };
  }

  const limit = normalizeLimit(params.limit);
  const recallLimit = Math.max(limit, Math.min(params.recallLimit ?? 40, 40));
  const localMatches = searchSkillDescriptions({
    query: taskDescription,
    availableSkills: params.availableSkills,
    excludeSkillNames: params.excludeSkillNames,
    limit: recallLimit,
  });
  const localByName = new Map(localMatches.map((match) => [match.name, match]));
  const semanticMatches =
    (await params
      .semanticRetrieve?.({
        taskDescription,
        availableSkills: params.availableSkills,
        excludeSkillNames: params.excludeSkillNames,
        limit,
        recallLimit,
      })
      .catch(() => [])) ?? [];
  const mergedNativeCandidates = selectRerankCandidates({
    availableSkills: params.availableSkills,
    semanticMatches,
    localMatches,
    excludeSkillNames: params.excludeSkillNames,
    recallLimit,
  });

  if (!params.rerank) {
    return {
      skills: mergedNativeCandidates.slice(0, limit).map((match) =>
        toMatch({
          candidate: match,
          localMatch: localByName.get(match.name),
          source: "native",
        }),
      ),
      signal,
      source: "native",
    };
  }

  const rerankCandidates = selectRerankCandidates({
    availableSkills: params.availableSkills,
    semanticMatches,
    localMatches,
    excludeSkillNames: params.excludeSkillNames,
    recallLimit,
    allowAvailableFallback: true,
  });
  if (rerankCandidates.length === 0) {
    return { skills: [], signal, source: "native" };
  }

  const candidateByName = toCandidateByName(rerankCandidates);
  const reranked = await params
    .rerank({
      taskDescription,
      candidates: rerankCandidates,
      limit,
    })
    .catch(() => undefined);
  if (!reranked) {
    return {
      skills: mergedNativeCandidates.slice(0, limit).map((match) =>
        toMatch({
          candidate: match,
          localMatch: localByName.get(match.name),
          source: "native",
        }),
      ),
      signal,
      source: "native",
    };
  }
  const rerankedNames = normalizeSkillNames(reranked.skillNames)
    .filter((name) => candidateByName.has(name))
    .slice(0, limit);

  if (rerankedNames.length === 0) {
    return {
      skills: mergedNativeCandidates.slice(0, limit).map((match) =>
        toMatch({
          candidate: match,
          localMatch: localByName.get(match.name),
          source: "native",
        }),
      ),
      signal,
      source: "native",
      reason: reranked.reason,
      confidence: reranked.confidence,
    };
  }

  const skills = rerankedNames.map((name) =>
    toMatch({
      candidate: candidateByName.get(name)!,
      localMatch: localByName.get(name),
      source: localByName.has(name) ? "both" : "llm",
    }),
  );
  const hasNative = skills.some((skill) => skill.source === "both");
  const hasLlm = skills.some((skill) => skill.source === "llm" || skill.source === "both");
  return {
    skills,
    signal,
    source: hasNative && hasLlm ? "both" : "llm",
    reason: reranked.reason,
    confidence: reranked.confidence,
  };
}

export function renderSkillDiscoveryReminder(result: SkillDiscoveryResult): string {
  if (result.skills.length === 0) {
    return "";
  }
  const lines = [
    "Skills relevant to your task:",
    "",
    ...result.skills.map((skill) => `- ${skill.name}: ${skill.description ?? ""}`.trim()),
    "",
    "These skills encode project-specific conventions. If one applies to your next action, read its SKILL.md before using it.",
  ];
  return lines.join("\n");
}
