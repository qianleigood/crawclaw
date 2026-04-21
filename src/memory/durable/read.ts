import fs from "node:fs/promises";
import path from "node:path";
import { callStructuredOutput } from "../llm/structured-output.ts";
import { parseMarkdownFrontmatter } from "../markdown/frontmatter.ts";
import type { DurableMemoryItem, DurableMemoryKind } from "../types/orchestration.ts";
import { durableMemoryAge, durableMemoryAgeDays, durableMemoryFreshnessText } from "./freshness.ts";
import { scanDurableMemoryManifest, type DurableMemoryManifestEntry } from "./manifest.ts";
import { getDurableMemoryScopeDir, type DurableMemoryScope } from "./scope.ts";

type CompleteFn = ReturnType<typeof import("../extraction/llm.ts").createCompleteFn>;
const DEFAULT_DURABLE_RECALL_LIMIT = 5;
const MAX_SELECTOR_CANDIDATES = 48;
const MAX_EXCERPT_CANDIDATES = 12;
const MAX_EXCERPT_CHARS = 1_600;

interface DurableRecallCandidate {
  entry: DurableMemoryManifestEntry;
  excerpt: string;
  score: number;
}

function normalizeText(value: string | null | undefined): string {
  return (value ?? "").toLowerCase().replace(/\s+/g, " ").trim();
}

function tokenize(value: string | null | undefined): string[] {
  return normalizeText(value)
    .split(/[^a-z0-9\u4e00-\u9fff]+/i)
    .filter((token) => token.length >= 2);
}

function heuristicScore(
  entry: DurableMemoryManifestEntry,
  prompt: string,
  recentMessages?: string[],
): number {
  const promptTokens = new Set(tokenize([prompt, ...(recentMessages ?? [])].join(" ")));
  const entryTokens = new Set(
    tokenize(`${entry.indexHook} ${entry.title} ${entry.description} ${entry.durableType}`),
  );
  const overlap = [...promptTokens].filter((token) => entryTokens.has(token)).length;
  const typeBoost =
    entry.durableType === "feedback"
      ? 0.15
      : entry.durableType === "project"
        ? 0.1
        : entry.durableType === "user"
          ? 0.08
          : 0.04;
  return overlap + typeBoost;
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
  return overlap * 0.6;
}

function dreamTouchScore(
  entry: DurableMemoryManifestEntry,
  recentDreamTouchedNotes?: string[],
): number {
  if (!recentDreamTouchedNotes?.length) {
    return 0;
  }
  return recentDreamTouchedNotes.includes(entry.notePath) ? 0.35 : 0;
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
}): DurableMemoryManifestEntry[] {
  const ranked = [...params.entries]
    .map((entry) => ({
      entry,
      score: heuristicScore(entry, params.prompt, params.recentMessages),
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
  recentDreamTouchedNotes?: string[];
  limit: number;
  scopeDir: string;
}): Promise<DurableRecallCandidate[]> {
  const selectorCandidates = buildSelectorCandidates({
    entries: params.entries,
    prompt: params.prompt,
    recentMessages: params.recentMessages,
    limit: params.limit,
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
      return {
        entry,
        excerpt,
        score:
          heuristicScore(entry, params.prompt, params.recentMessages) +
          excerptScore(params.prompt, params.recentMessages, excerpt) +
          dreamTouchScore(entry, params.recentDreamTouchedNotes),
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
  recentDreamTouchedNotes?: string[];
  entries: DurableMemoryManifestEntry[];
  limit: number;
  scopeDir: string;
}): Promise<{
  mode: "llm" | "llm_none" | "heuristic";
  selected: DurableMemoryManifestEntry[];
  omitted: string[];
}> {
  const recallCandidates = await buildRecallCandidates({
    entries: params.entries,
    prompt: params.prompt,
    recentMessages: params.recentMessages,
    recentDreamTouchedNotes: params.recentDreamTouchedNotes,
    limit: params.limit,
    scopeDir: params.scopeDir,
  });
  const ranked = recallCandidates;
  const selectorCandidates = recallCandidates.map((candidate) => candidate.entry);
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

  return {
    mode,
    selected,
    omitted: params.entries
      .map((entry) => entry.notePath)
      .filter((notePath) => !selected.some((entry) => entry.notePath === notePath)),
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
}): DurableMemoryItem {
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
    },
    durableKind: params.durableKind,
    durableReasons: [params.reason],
    updatedAt: params.updatedAt,
    score: 1,
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
      finalScore: 1,
    },
  };
}

export async function recallDurableMemory(params: {
  scope: DurableMemoryScope;
  prompt: string;
  recentMessages?: string[];
  recentDreamTouchedNotes?: string[];
  complete?: CompleteFn;
  limit?: number;
}): Promise<DurableRecallResult> {
  const manifest = await scanDurableMemoryManifest({ scope: params.scope });
  if (!manifest.length) {
    return {
      scope: params.scope,
      manifest: [],
      items: [],
      selection: { mode: "heuristic", selectedItemIds: [], omittedItemIds: [] },
    };
  }
  const limit = Math.max(1, Math.min(params.limit ?? DEFAULT_DURABLE_RECALL_LIMIT, 6));
  const scopeDir = getDurableMemoryScopeDir(params.scope);
  const selection = await selectManifestEntries({
    complete: params.complete,
    prompt: params.prompt,
    recentMessages: params.recentMessages,
    recentDreamTouchedNotes: params.recentDreamTouchedNotes,
    entries: manifest,
    limit,
    scopeDir,
  });
  const items: DurableMemoryItem[] = [];
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
  };
};
