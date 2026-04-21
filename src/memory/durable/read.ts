import fs from "node:fs/promises";
import path from "node:path";
import { callStructuredOutput } from "../llm/structured-output.ts";
import { parseMarkdownFrontmatter } from "../markdown/frontmatter.ts";
import type { DurableMemoryItem, DurableMemoryKind } from "../types/orchestration.ts";
import { loadDurableBodyIndex, type DurableBodyIndexEntry } from "./body-index.ts";
import { durableMemoryAge, durableMemoryAgeDays, durableMemoryFreshnessText } from "./freshness.ts";
import { scanDurableMemoryManifest, type DurableMemoryManifestEntry } from "./manifest.ts";
import { getDurableMemoryScopeDir, type DurableMemoryScope } from "./scope.ts";

type CompleteFn = ReturnType<typeof import("../extraction/llm.ts").createCompleteFn>;
const DEFAULT_DURABLE_RECALL_LIMIT = 5;
const MAX_SELECTOR_CANDIDATES = 48;
const MAX_EXCERPT_CANDIDATES = 12;
const MAX_EXCERPT_CHARS = 1_600;
const DREAM_BOOST_MAX = 0.35;
const DREAM_BOOST_HALF_LIFE_MS = 72 * 60 * 60 * 1000;
const DREAM_BOOST_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;
const DREAM_BOOST_MIN_RELEVANCE = 0.5;

export type DurableRecallProvenance =
  | "index"
  | "header"
  | "body_index"
  | "body_rerank"
  | "dream_boost";
export type DurableRecallOmittedReason =
  | "candidate_cutoff"
  | "ranked_below_limit"
  | "llm_filtered"
  | "llm_none";

export interface RecentDreamTouchedNote {
  notePath: string;
  touchedAt: number;
}

export interface DurableRecallSelectionDetail {
  itemId: string;
  notePath: string;
  title: string;
  provenance: DurableRecallProvenance[];
  omittedReason?: DurableRecallOmittedReason;
  scoreBreakdown: {
    header: number;
    index: number;
    bodyIndex: number;
    bodyRerank: number;
    dreamBoost: number;
    final: number;
  };
}

interface DurableRecallCandidate {
  entry: DurableMemoryManifestEntry;
  excerpt: string;
  score: number;
  scoreBreakdown: DurableRecallSelectionDetail["scoreBreakdown"];
  provenance: DurableRecallProvenance[];
}

function normalizeText(value: string | null | undefined): string {
  return (value ?? "").toLowerCase().replace(/\s+/g, " ").trim();
}

function tokenize(value: string | null | undefined): string[] {
  return normalizeText(value)
    .split(/[^a-z0-9\u4e00-\u9fff]+/i)
    .filter((token) => token.length >= 2);
}

function typeBoost(entry: DurableMemoryManifestEntry): number {
  return entry.durableType === "feedback"
    ? 0.15
    : entry.durableType === "project"
      ? 0.1
      : entry.durableType === "user"
        ? 0.08
        : 0.04;
}

function heuristicScoreBreakdown(
  entry: DurableMemoryManifestEntry,
  prompt: string,
  recentMessages?: string[],
  bodyIndex?: DurableBodyIndexEntry,
): DurableRecallSelectionDetail["scoreBreakdown"] {
  const promptTokens = new Set(tokenize([prompt, ...(recentMessages ?? [])].join(" ")));
  const headerTokens = new Set(
    tokenize(`${entry.title} ${entry.description} ${entry.durableType}`),
  );
  const indexTokens = new Set(tokenize(entry.indexHook));
  const header =
    [...promptTokens].filter((token) => headerTokens.has(token)).length + typeBoost(entry);
  const index = [...promptTokens].filter((token) => indexTokens.has(token)).length;
  const bodyIndexScore = scoreBodyIndex(promptTokens, bodyIndex);
  return {
    header,
    index,
    bodyIndex: bodyIndexScore,
    bodyRerank: 0,
    dreamBoost: 0,
    final: header + index + bodyIndexScore,
  };
}

function scoreBodyIndex(
  promptTokens: Set<string>,
  bodyIndex: DurableBodyIndexEntry | undefined,
): number {
  if (!bodyIndex) {
    return 0;
  }
  const keywordTokens = new Set(bodyIndex.keywords);
  const excerptTokens = new Set(tokenize(bodyIndex.excerpt));
  const keywordOverlap = [...promptTokens].filter((token) => keywordTokens.has(token)).length;
  const excerptOverlap = [...promptTokens].filter((token) => excerptTokens.has(token)).length;
  return Math.min(3, keywordOverlap * 0.65 + excerptOverlap * 0.25);
}

function excerptScore(
  prompt: string,
  recentMessages: string[] | undefined,
  excerpt: string,
): number {
  if (!excerpt.trim()) {
    return 0;
  }
  const promptTokens = new Set(tokenize([prompt, ...(recentMessages ?? [])].join(" ")));
  const excerptTokens = new Set(tokenize(excerpt));
  const overlap = [...promptTokens].filter((token) => excerptTokens.has(token)).length;
  return overlap * 0.8;
}

function dreamTouchScore(
  entry: DurableMemoryManifestEntry,
  recentDreamTouchedNotes: RecentDreamTouchedNote[] | undefined,
  relevanceScore: number,
  now = Date.now(),
): number {
  if (!recentDreamTouchedNotes?.length || relevanceScore < DREAM_BOOST_MIN_RELEVANCE) {
    return 0;
  }
  const touched = recentDreamTouchedNotes.find((item) => item.notePath === entry.notePath);
  if (!touched || !Number.isFinite(touched.touchedAt)) {
    return 0;
  }
  const ageMs = Math.max(0, now - touched.touchedAt);
  if (ageMs > DREAM_BOOST_MAX_AGE_MS) {
    return 0;
  }
  return DREAM_BOOST_MAX * 2 ** (-ageMs / DREAM_BOOST_HALF_LIFE_MS);
}

function inferProvenance(
  scoreBreakdown: DurableRecallSelectionDetail["scoreBreakdown"],
): DurableRecallProvenance[] {
  const provenance: DurableRecallProvenance[] = [];
  if (scoreBreakdown.index > 0) {
    provenance.push("index");
  }
  if (scoreBreakdown.header > 0) {
    provenance.push("header");
  }
  if (scoreBreakdown.bodyIndex > 0) {
    provenance.push("body_index");
  }
  if (scoreBreakdown.bodyRerank > 0) {
    provenance.push("body_rerank");
  }
  if (scoreBreakdown.dreamBoost > 0) {
    provenance.push("dream_boost");
  }
  return provenance.length ? provenance : ["header"];
}

function toSelectionDetail(
  candidate: DurableRecallCandidate,
  omittedReason?: DurableRecallOmittedReason,
): DurableRecallSelectionDetail {
  return {
    itemId: `durable:${candidate.entry.notePath}`,
    notePath: candidate.entry.notePath,
    title: candidate.entry.title,
    provenance: candidate.provenance,
    ...(omittedReason ? { omittedReason } : {}),
    scoreBreakdown: candidate.scoreBreakdown,
  };
}

function formatSelectorTimestamp(updatedAt: number): string {
  return new Date(updatedAt).toISOString();
}

function formatSelectorAge(updatedAt: number): string {
  return durableMemoryAge(updatedAt);
}

function buildSelectorCandidates(params: {
  entries: DurableMemoryManifestEntry[];
  prompt: string;
  recentMessages?: string[];
  limit: number;
  bodyIndex: Map<string, DurableBodyIndexEntry>;
}): DurableMemoryManifestEntry[] {
  const ranked = [...params.entries]
    .map((entry) => ({
      entry,
      score: heuristicScoreBreakdown(
        entry,
        params.prompt,
        params.recentMessages,
        params.bodyIndex.get(entry.notePath),
      ).final,
    }))
    .toSorted(
      (left, right) => right.score - left.score || right.entry.updatedAt - left.entry.updatedAt,
    );
  const recentHead = params.entries.slice(
    0,
    Math.min(params.entries.length, Math.max(params.limit * 3, 12)),
  );
  const heuristicHead = ranked
    .slice(0, Math.min(ranked.length, Math.max(params.limit * 4, 16)))
    .map((item) => item.entry);
  const merged = new Map<string, DurableMemoryManifestEntry>();
  for (const entry of [...recentHead, ...heuristicHead]) {
    merged.set(entry.notePath, entry);
    if (merged.size >= MAX_SELECTOR_CANDIDATES) {
      break;
    }
  }
  return [...merged.values()];
}

async function readCandidateExcerpt(absolutePath: string): Promise<string> {
  const raw = await fs.readFile(absolutePath, "utf8");
  const parsed = parseMarkdownFrontmatter(raw);
  return parsed.body.replace(/\s+/g, " ").trim().slice(0, MAX_EXCERPT_CHARS);
}

async function buildRecallCandidates(params: {
  entries: DurableMemoryManifestEntry[];
  prompt: string;
  recentMessages?: string[];
  recentDreamTouchedNotes?: RecentDreamTouchedNote[];
  limit: number;
  scopeDir: string;
  bodyIndex: Map<string, DurableBodyIndexEntry>;
}): Promise<DurableRecallCandidate[]> {
  const selectorCandidates = buildSelectorCandidates({
    entries: params.entries,
    prompt: params.prompt,
    recentMessages: params.recentMessages,
    limit: params.limit,
    bodyIndex: params.bodyIndex,
  });
  const excerptEntries = selectorCandidates.slice(
    0,
    Math.min(selectorCandidates.length, MAX_EXCERPT_CANDIDATES),
  );
  const excerptByPath = new Map<string, string>();
  await Promise.all(
    excerptEntries.map(async (entry) => {
      const absolutePath = path.join(params.scopeDir, entry.notePath);
      const excerpt = await readCandidateExcerpt(absolutePath).catch(() => "");
      excerptByPath.set(entry.notePath, excerpt);
    }),
  );
  return selectorCandidates
    .map((entry) => {
      const excerpt = excerptByPath.get(entry.notePath) ?? "";
      const heuristic = heuristicScoreBreakdown(
        entry,
        params.prompt,
        params.recentMessages,
        params.bodyIndex.get(entry.notePath),
      );
      const bodyRerank = excerptScore(params.prompt, params.recentMessages, excerpt);
      const relevanceScore = heuristic.header + heuristic.index + heuristic.bodyIndex + bodyRerank;
      const dreamBoost = dreamTouchScore(entry, params.recentDreamTouchedNotes, relevanceScore);
      const scoreBreakdown = {
        ...heuristic,
        bodyRerank,
        dreamBoost,
        final: heuristic.header + heuristic.index + heuristic.bodyIndex + bodyRerank + dreamBoost,
      };
      return {
        entry,
        excerpt,
        score: scoreBreakdown.final,
        scoreBreakdown,
        provenance: inferProvenance(scoreBreakdown),
      };
    })
    .toSorted(
      (left, right) => right.score - left.score || right.entry.updatedAt - left.entry.updatedAt,
    );
}

async function selectManifestEntries(params: {
  complete?: CompleteFn;
  prompt: string;
  recentMessages?: string[];
  recentDreamTouchedNotes?: RecentDreamTouchedNote[];
  entries: DurableMemoryManifestEntry[];
  limit: number;
  scopeDir: string;
  bodyIndex: Map<string, DurableBodyIndexEntry>;
}): Promise<{
  mode: "llm" | "llm_none" | "heuristic";
  selected: DurableMemoryManifestEntry[];
  omitted: string[];
  selectedDetails: DurableRecallSelectionDetail[];
  omittedDetails: DurableRecallSelectionDetail[];
}> {
  const recallCandidates = await buildRecallCandidates({
    entries: params.entries,
    prompt: params.prompt,
    recentMessages: params.recentMessages,
    recentDreamTouchedNotes: params.recentDreamTouchedNotes,
    limit: params.limit,
    scopeDir: params.scopeDir,
    bodyIndex: params.bodyIndex,
  });
  const ranked = recallCandidates;
  const selectorCandidates = recallCandidates.map((candidate) => candidate.entry);
  const candidateByPath = new Map(
    recallCandidates.map((candidate) => [candidate.entry.notePath, candidate]),
  );
  const selectorCandidatePaths = new Set(selectorCandidates.map((entry) => entry.notePath));
  const excerptByPath = new Map(
    recallCandidates.map((candidate) => [candidate.entry.notePath, candidate.excerpt]),
  );
  const candidateMap = new Map<string, DurableMemoryManifestEntry>();
  const candidateLines = selectorCandidates.map((entry, index) => {
    const id = `cand_${index + 1}`;
    candidateMap.set(id, entry);
    const excerpt = excerptByPath.get(entry.notePath) ?? "";
    return [
      `${id} | [${entry.durableType}] ${entry.notePath} (${formatSelectorTimestamp(entry.updatedAt)}; ${formatSelectorAge(entry.updatedAt)})`,
      `title: ${entry.title}`,
      `description: ${entry.description || entry.title}`,
      ...(entry.indexHook ? [`index-hook: ${entry.indexHook}`] : []),
      ...(excerpt ? [`excerpt: ${excerpt}`] : []),
    ].join(" | ");
  });

  let selected = ranked.slice(0, params.limit).map((item) => item.entry);
  let mode: "llm" | "llm_none" | "heuristic" = "heuristic";
  if (params.complete && selectorCandidates.length > 0) {
    try {
      const structured = await callStructuredOutput(params.complete, {
        system: [
          "You are selecting durable memory notes that will clearly help with the current task.",
          "You will be given the current task, recent messages, and a manifest of available durable memory notes.",
          "Each candidate line contains note metadata: durable type, path, updated timestamp, title, description, optional MEMORY.md index hook, and sometimes a short note excerpt.",
          "Durable memories are point-in-time observations and may be stale.",
          "Prefer memories that are clearly helpful and still likely to be trustworthy.",
          "If a memory only sounds useful because it mentions old repo state, files, flags, or code behavior, be conservative.",
          "Select only notes that are clearly useful. Be selective and discerning.",
          "If you are unsure a memory will help, do not include it.",
          `Return at most ${params.limit} candidate ids.`,
          "Only choose from the provided candidate ids.",
        ].join("\n"),
        user: [
          `Current task:\n${params.prompt}`,
          ...(params.recentMessages?.length
            ? [`Recent messages:\n${params.recentMessages.join("\n")}`]
            : []),
          "Available durable memory notes:",
          ...candidateLines,
        ].join("\n\n"),
        formatHint: 'Output JSON only with shape {"selectedIds":["cand_1"],"reason":"..."}.',
        retries: 1,
        validator: (value) => {
          if (!value || typeof value !== "object") {
            throw new Error("selection result must be an object");
          }
          const record = value as Record<string, unknown>;
          const selectedIds = Array.isArray(record.selectedIds)
            ? record.selectedIds
                .filter(
                  (item): item is string => typeof item === "string" && candidateMap.has(item),
                )
                .slice(0, params.limit)
            : [];
          return { selectedIds };
        },
        fallback: () => ({ selectedIds: [] as string[] }),
      });
      mode = structured.value.selectedIds.length ? "llm" : "llm_none";
      selected = structured.value.selectedIds
        .map((id) => candidateMap.get(id))
        .filter((entry): entry is DurableMemoryManifestEntry => Boolean(entry));
    } catch {
      // keep heuristic fallback
    }
  }

  const selectedPathSet = new Set(selected.map((entry) => entry.notePath));
  const selectedDetails = selected
    .map((entry) => candidateByPath.get(entry.notePath))
    .filter((candidate): candidate is DurableRecallCandidate => Boolean(candidate))
    .map((candidate) => toSelectionDetail(candidate));
  const omittedDetails = params.entries
    .filter((entry) => !selectedPathSet.has(entry.notePath))
    .map((entry) => {
      const existing = candidateByPath.get(entry.notePath);
      const fallbackBreakdown = heuristicScoreBreakdown(
        entry,
        params.prompt,
        params.recentMessages,
        params.bodyIndex.get(entry.notePath),
      );
      const candidate =
        existing ??
        ({
          entry,
          excerpt: "",
          score: fallbackBreakdown.final,
          scoreBreakdown: fallbackBreakdown,
          provenance: inferProvenance(fallbackBreakdown),
        } satisfies DurableRecallCandidate);
      const omittedReason: DurableRecallOmittedReason = selectorCandidatePaths.has(entry.notePath)
        ? mode === "llm"
          ? "llm_filtered"
          : mode === "llm_none"
            ? "llm_none"
            : "ranked_below_limit"
        : "candidate_cutoff";
      return toSelectionDetail(candidate, omittedReason);
    });

  return {
    mode,
    selected,
    omitted: params.entries
      .map((entry) => entry.notePath)
      .filter((notePath) => !selected.some((entry) => entry.notePath === notePath)),
    selectedDetails,
    omittedDetails,
  };
}

function toLayer(kind: DurableMemoryKind): "preferences" | "sources" {
  return kind === "feedback" ? "preferences" : "sources";
}

function buildDurableItem(params: {
  notePath: string;
  title: string;
  summary: string;
  content: string;
  durableKind: DurableMemoryKind;
  updatedAt: number;
  reason: string;
  selectionDetail?: DurableRecallSelectionDetail;
}): DurableMemoryItem {
  const finalScore = params.selectionDetail?.scoreBreakdown.final ?? 1;
  return {
    id: `durable:${params.notePath}`,
    source: "native_memory",
    title: params.title,
    summary: params.summary,
    content: params.content,
    layer: toLayer(params.durableKind),
    metadata: {
      notePath: params.notePath,
      freshnessText: durableMemoryFreshnessText(params.updatedAt),
      ageText: durableMemoryAge(params.updatedAt),
      ageDays: durableMemoryAgeDays(params.updatedAt),
      ...(params.selectionDetail
        ? {
            provenance: params.selectionDetail.provenance,
            scoreBreakdown: params.selectionDetail.scoreBreakdown,
          }
        : {}),
    },
    durableKind: params.durableKind,
    durableReasons: [params.reason],
    updatedAt: params.updatedAt,
    score: finalScore,
    supportingSources: [],
    supportingIds: [],
    scoreBreakdown: {
      retrieval: 1,
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
    },
  };
}

export async function recallDurableMemory(params: {
  scope: DurableMemoryScope;
  prompt: string;
  recentMessages?: string[];
  recentDreamTouchedNotes?: RecentDreamTouchedNote[];
  complete?: CompleteFn;
  limit?: number;
}): Promise<DurableRecallResult> {
  const manifest = await scanDurableMemoryManifest({ scope: params.scope });
  if (!manifest.length) {
    return {
      scope: params.scope,
      manifest: [],
      items: [],
      selection: {
        mode: "heuristic",
        selectedItemIds: [],
        omittedItemIds: [],
        selectedDetails: [],
        omittedDetails: [],
        recentDreamTouchedNotes: (params.recentDreamTouchedNotes ?? []).map(
          (entry) => entry.notePath,
        ),
      },
    };
  }
  const limit = Math.max(1, Math.min(params.limit ?? DEFAULT_DURABLE_RECALL_LIMIT, 6));
  const scopeDir = getDurableMemoryScopeDir(params.scope);
  const bodyIndex = await loadDurableBodyIndex({ scopeDir, manifest });
  const selection = await selectManifestEntries({
    complete: params.complete,
    prompt: params.prompt,
    recentMessages: params.recentMessages,
    recentDreamTouchedNotes: params.recentDreamTouchedNotes,
    entries: manifest,
    limit,
    scopeDir,
    bodyIndex,
  });
  const items: DurableMemoryItem[] = [];
  const selectedDetailByPath = new Map(
    selection.selectedDetails.map((detail) => [detail.notePath, detail]),
  );
  for (const entry of selection.selected) {
    const absolutePath = path.join(scopeDir, entry.notePath);
    const raw = await fs.readFile(absolutePath, "utf8");
    const summary = entry.description || entry.title;
    items.push(
      buildDurableItem({
        notePath: entry.notePath,
        title: entry.title,
        summary,
        content: raw,
        durableKind: entry.durableType,
        updatedAt: entry.updatedAt,
        reason: `selected durable memory (${entry.durableType})`,
        selectionDetail: selectedDetailByPath.get(entry.notePath),
      }),
    );
  }
  return {
    scope: params.scope,
    manifest,
    items,
    selection: {
      mode: selection.mode,
      selectedItemIds: selection.selected.map((entry) => `durable:${entry.notePath}`),
      omittedItemIds: selection.omitted.map((notePath) => `durable:${notePath}`),
      selectedDetails: selection.selectedDetails,
      omittedDetails: selection.omittedDetails,
      recentDreamTouchedNotes: (params.recentDreamTouchedNotes ?? []).map(
        (entry) => entry.notePath,
      ),
    },
  };
}

export type DurableRecallResult = {
  scope: DurableMemoryScope;
  manifest: DurableMemoryManifestEntry[];
  items: DurableMemoryItem[];
  selection: {
    mode: "llm" | "llm_none" | "heuristic";
    selectedItemIds: string[];
    omittedItemIds: string[];
    selectedDetails: DurableRecallSelectionDetail[];
    omittedDetails: DurableRecallSelectionDetail[];
    recentDreamTouchedNotes: string[];
  };
};
