import { normalizeRecallText, tokenizeRecallText } from "../recall/query-analysis.ts";
import type {
  UnifiedEntityCandidate,
  UnifiedEntityMatch,
  UnifiedEntityMatchType,
  UnifiedEntityRegistry,
  UnifiedEntityResolutionResult,
  UnifiedQueryClassification,
} from "../types/orchestration.ts";

const STOPWORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "this",
  "that",
  "what",
  "which",
  "一个",
  "这个",
  "那个",
  "怎么",
  "如何",
  "一下",
  "还有",
  "现在",
  "上次",
  "之前",
  "为什么",
  "如果",
  "按什么",
]);

function unique<T>(items: T[]): T[] {
  return [...new Set(items)];
}

function normalizeTerm(input: string): string {
  return normalizeRecallText(input)
    .toLowerCase()
    .replace(/["'“”‘’`]/g, "")
    .replace(/[()[\]{}]/g, " ")
    .replace(/[，。；：、,.!?]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function variantsForCandidate(
  candidate: UnifiedEntityCandidate,
): Array<{ value: string; kind: "title" | "alias" }> {
  const values = [candidate.title, ...(candidate.aliases ?? []), candidate.path ?? ""]
    .map((value) => value.trim())
    .filter(Boolean);
  return unique(values).map((value) => ({
    value,
    kind: value === candidate.title ? "title" : "alias",
  }));
}

function tokenOverlapScore(left: string, right: string): number {
  const leftTokens = tokenizeRecallText(left.toLowerCase()).filter(
    (token) => token.length >= 2 && !STOPWORDS.has(token),
  );
  const rightTokens = tokenizeRecallText(right.toLowerCase()).filter(
    (token) => token.length >= 2 && !STOPWORDS.has(token),
  );
  if (!leftTokens.length || !rightTokens.length) {
    return 0;
  }
  const rightSet = new Set(rightTokens);
  const overlap = leftTokens.filter((token) => rightSet.has(token)).length;
  return overlap / Math.max(leftTokens.length, rightTokens.length);
}

function scoreVariant(
  mention: string,
  variant: { value: string; kind: "title" | "alias" },
): { score: number; matchType?: UnifiedEntityMatchType } {
  const normalizedMention = normalizeTerm(mention);
  const normalizedVariant = normalizeTerm(variant.value);
  if (!normalizedMention || !normalizedVariant) {
    return { score: 0 };
  }

  if (normalizedMention === normalizedVariant) {
    return {
      score: variant.kind === "title" ? 1 : 0.98,
      matchType: variant.kind === "title" ? "title_exact" : "alias_exact",
    };
  }

  if (
    normalizedVariant.includes(normalizedMention) ||
    normalizedMention.includes(normalizedVariant)
  ) {
    const base = variant.kind === "title" ? 0.88 : 0.84;
    return {
      score: base,
      matchType: variant.kind === "title" ? "title_contains" : "alias_contains",
    };
  }

  const overlap = tokenOverlapScore(normalizedMention, normalizedVariant);
  if (overlap >= 0.45) {
    return { score: 0.55 + overlap * 0.25, matchType: "token_overlap" };
  }

  return { score: 0 };
}

function buildMentions(query: string, classification?: UnifiedQueryClassification): string[] {
  const normalized = normalizeRecallText(query);
  const quoted = normalized.match(/["“”'‘’](.{2,40}?)["“”'‘’]/g) ?? [];
  const tokens = tokenizeRecallText(normalized)
    .filter((token) => token.length >= 2)
    .filter((token) => !STOPWORDS.has(token.toLowerCase()));

  return unique([
    ...quoted.map((item) => item.replace(/^["“”'‘’]|["“”'‘’]$/g, "").trim()),
    ...(classification?.entityHints ?? []),
    ...tokens,
  ]).slice(0, 10);
}

export interface EntityResolverInput {
  query: string;
  classification?: UnifiedQueryClassification;
  registries: UnifiedEntityRegistry[];
  minScore?: number;
  topKPerMention?: number;
}

function scoreCandidate(
  mention: string,
  candidate: UnifiedEntityCandidate,
  sourceBias = 0,
): UnifiedEntityMatch | null {
  let best: UnifiedEntityMatch | null = null;
  for (const variant of variantsForCandidate(candidate)) {
    const scored = scoreVariant(mention, variant);
    if (!scored.matchType || scored.score <= 0) {
      continue;
    }
    const finalScore = Math.min(1, scored.score + sourceBias);
    if (!best || finalScore > best.score) {
      best = {
        candidate,
        score: Number(finalScore.toFixed(4)),
        matchType: scored.matchType,
      };
    }
  }
  return best;
}

export function resolveUnifiedEntities(input: EntityResolverInput): UnifiedEntityResolutionResult {
  const minScore = input.minScore ?? 0.58;
  const topKPerMention = input.topKPerMention ?? 3;
  const mentions = buildMentions(input.query, input.classification);

  const sourceBias = {
    graph: (input.classification?.routeWeights.graph ?? 0.25) * 0.08,
    notebooklm: (input.classification?.routeWeights.notebooklm ?? 0.25) * 0.08,
    local_knowledge_index: (input.classification?.routeWeights.notebooklm ?? 0.25) * 0.08,
    native_memory: (input.classification?.routeWeights.nativeMemory ?? 0.25) * 0.08,
    execution: (input.classification?.routeWeights.execution ?? 0.25) * 0.08,
  } as const;

  const resolved = mentions.map((mention) => {
    const matches = input.registries
      .flatMap((registry) =>
        registry.items.map((candidate) =>
          scoreCandidate(mention, candidate, sourceBias[candidate.source]),
        ),
      )
      .filter((match): match is UnifiedEntityMatch => Boolean(match))
      .filter((match) => match.score >= minScore)
      .toSorted((a, b) => b.score - a.score)
      .slice(0, topKPerMention);

    return {
      mention,
      matches,
      selected: matches[0],
    };
  });

  const selectedCandidates = Array.from(
    new Map(
      resolved
        .map((item) => item.selected?.candidate)
        .filter((candidate): candidate is UnifiedEntityCandidate => Boolean(candidate))
        .map((candidate) => [candidate.id, candidate]),
    ).values(),
  );

  return {
    mentions,
    resolved,
    selectedCandidates,
    unresolvedMentions: resolved.filter((item) => !item.selected).map((item) => item.mention),
  };
}

export class UnifiedEntityResolver {
  resolve(input: EntityResolverInput): UnifiedEntityResolutionResult {
    return resolveUnifiedEntities(input);
  }
}
