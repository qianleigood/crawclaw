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
  localMatches: readonly SkillSearchResult[];
  excludeSkillNames?: readonly string[];
  recallLimit: number;
}): SkillDiscoveryCandidate[] {
  const excluded = new Set(normalizeSkillNames(params.excludeSkillNames));
  if (params.localMatches.length > 0) {
    return params.localMatches.slice(0, params.recallLimit);
  }
  return params.availableSkills
    .filter((skill) => skill.name.trim() && !excluded.has(skill.name))
    .slice(0, params.recallLimit);
}

export async function discoverSkillsForTask(params: {
  taskDescription: string;
  availableSkills: readonly SkillDiscoveryCandidate[];
  excludeSkillNames?: readonly string[];
  limit?: number;
  recallLimit?: number;
  signal?: SkillDiscoverySignal;
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

  if (!params.rerank) {
    return {
      skills: localMatches.slice(0, limit).map((match) =>
        toMatch({
          candidate: match,
          localMatch: match,
          source: "native",
        }),
      ),
      signal,
      source: "native",
    };
  }

  const rerankCandidates = selectRerankCandidates({
    availableSkills: params.availableSkills,
    localMatches,
    excludeSkillNames: params.excludeSkillNames,
    recallLimit,
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
      skills: localMatches.slice(0, limit).map((match) =>
        toMatch({
          candidate: match,
          localMatch: match,
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
      skills: localMatches.slice(0, limit).map((match) =>
        toMatch({
          candidate: match,
          localMatch: match,
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
