export type SkillSearchCandidate = {
  name: string;
  description?: string;
  location: string;
  semanticScore?: number;
  semanticSource?: "vector";
};

export type SkillSearchResult = SkillSearchCandidate & {
  score: number;
  reasons: string[];
};

const STOPWORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "from",
  "into",
  "this",
  "that",
  "when",
  "need",
  "needs",
  "use",
  "using",
  "当前",
  "这个",
  "那个",
  "一下",
  "需要",
  "怎么",
  "如何",
]);

const MAX_SEARCH_RESULTS = 40;

function normalizeText(value: string | null | undefined): string {
  return (value ?? "").toLowerCase().replace(/\s+/g, " ").trim();
}

function normalizeToken(token: string): string {
  return token
    .toLowerCase()
    .replace(/(?:ing|ed|es|s)$/i, "")
    .trim();
}

function tokenize(value: string | null | undefined): string[] {
  return normalizeText(value)
    .split(/[^a-z0-9\u4e00-\u9fff]+/i)
    .map(normalizeToken)
    .filter((token) => token.length >= 2 && !STOPWORDS.has(token));
}

function normalizeSkillName(value: string): string {
  return normalizeText(value).replace(/[_-]+/g, " ").trim();
}

function unique<T>(items: T[]): T[] {
  return [...new Set(items)];
}

function scoreCandidate(query: string, skill: SkillSearchCandidate): SkillSearchResult {
  const normalizedQuery = normalizeText(query);
  const normalizedName = normalizeSkillName(skill.name);
  const queryTokens = unique(tokenize(query));
  const nameTokens = new Set(tokenize(skill.name));
  const descriptionTokens = new Set(tokenize(skill.description));
  const skillTokens = new Set([...nameTokens, ...descriptionTokens]);
  const nameOverlap = queryTokens.filter((token) => nameTokens.has(token)).length;
  const descriptionOverlap = queryTokens.filter((token) => descriptionTokens.has(token)).length;
  const totalOverlap = queryTokens.filter((token) => skillTokens.has(token)).length;
  const exactNameMatch =
    normalizedName.length > 0 &&
    (normalizedQuery.includes(normalizedName) || normalizedQuery.includes(`/${normalizedName}`));
  const score =
    (exactNameMatch ? 3 : 0) +
    nameOverlap * 1.4 +
    descriptionOverlap +
    Math.min(totalOverlap, 6) * 0.25;
  const reasons = [
    exactNameMatch ? "name" : "",
    nameOverlap > 0 ? "name_terms" : "",
    descriptionOverlap > 0 ? "description_terms" : "",
  ].filter(Boolean);
  return {
    ...skill,
    score: Number(score.toFixed(4)),
    reasons,
  };
}

export function searchSkillDescriptions(params: {
  query: string;
  availableSkills: readonly SkillSearchCandidate[];
  excludeSkillNames?: readonly string[];
  limit?: number;
}): SkillSearchResult[] {
  const query = params.query.trim();
  if (!query) {
    return [];
  }
  const excluded = new Set(
    (params.excludeSkillNames ?? []).map((name) => name.trim()).filter(Boolean),
  );
  const limit = Math.max(1, Math.min(params.limit ?? 5, MAX_SEARCH_RESULTS));
  return params.availableSkills
    .filter((skill) => skill.name.trim() && !excluded.has(skill.name))
    .map((skill) => scoreCandidate(query, skill))
    .filter((result) => result.score > 0)
    .toSorted((left, right) => right.score - left.score || left.name.localeCompare(right.name))
    .slice(0, limit);
}
