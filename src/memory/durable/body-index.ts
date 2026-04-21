import fs from "node:fs/promises";
import path from "node:path";
import { parseMarkdownFrontmatter } from "../markdown/frontmatter.ts";
import type { DurableMemoryManifestEntry } from "./manifest.ts";

const BODY_INDEX_CACHE_VERSION = 1;
const BODY_INDEX_CACHE_FILE = ".crawclaw-durable-body-index.json";
const MAX_INDEX_EXCERPT_CHARS = 900;
const MAX_KEYWORDS = 64;

export interface DurableBodyIndexEntry {
  notePath: string;
  updatedAt: number;
  excerpt: string;
  keywords: string[];
}

type DurableBodyIndexCache = {
  version: number;
  entries?: Record<string, DurableBodyIndexEntry>;
};

function normalizeText(value: string | null | undefined): string {
  return (value ?? "").toLowerCase().replace(/\s+/g, " ").trim();
}

function tokenize(value: string | null | undefined): string[] {
  return normalizeText(value)
    .split(/[^a-z0-9\u4e00-\u9fff]+/i)
    .filter((token) => token.length >= 2);
}

function extractKeywords(body: string): string[] {
  const counts = new Map<string, number>();
  for (const token of tokenize(body)) {
    counts.set(token, (counts.get(token) ?? 0) + 1);
  }
  return [...counts.entries()]
    .toSorted(([leftToken, leftCount], [rightToken, rightCount]) => {
      return rightCount - leftCount || leftToken.localeCompare(rightToken);
    })
    .slice(0, MAX_KEYWORDS)
    .map(([token]) => token);
}

function cachePath(scopeDir: string): string {
  return path.join(scopeDir, BODY_INDEX_CACHE_FILE);
}

async function readCache(scopeDir: string): Promise<Map<string, DurableBodyIndexEntry>> {
  const raw = await fs.readFile(cachePath(scopeDir), "utf8").catch(() => null);
  if (!raw) {
    return new Map();
  }
  try {
    const parsed = JSON.parse(raw) as DurableBodyIndexCache;
    if (parsed.version !== BODY_INDEX_CACHE_VERSION || !parsed.entries) {
      return new Map();
    }
    return new Map(
      Object.entries(parsed.entries).filter(
        (entry): entry is [string, DurableBodyIndexEntry] =>
          typeof entry[1]?.notePath === "string" &&
          typeof entry[1]?.updatedAt === "number" &&
          typeof entry[1]?.excerpt === "string" &&
          Array.isArray(entry[1]?.keywords),
      ),
    );
  } catch {
    return new Map();
  }
}

async function writeCache(
  scopeDir: string,
  entries: Map<string, DurableBodyIndexEntry>,
): Promise<void> {
  const filePath = cachePath(scopeDir);
  const tmpPath = `${filePath}.${process.pid}.tmp`;
  const payload: DurableBodyIndexCache = {
    version: BODY_INDEX_CACHE_VERSION,
    entries: Object.fromEntries(entries),
  };
  await fs
    .writeFile(tmpPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8")
    .then(() => fs.rename(tmpPath, filePath))
    .catch(async () => {
      await fs.rm(tmpPath, { force: true }).catch(() => undefined);
    });
}

async function buildEntry(params: {
  scopeDir: string;
  manifestEntry: DurableMemoryManifestEntry;
}): Promise<DurableBodyIndexEntry | null> {
  const raw = await fs
    .readFile(path.join(params.scopeDir, params.manifestEntry.notePath), "utf8")
    .catch(() => null);
  if (!raw) {
    return null;
  }
  const parsed = parseMarkdownFrontmatter(raw);
  const body = parsed.body.replace(/\s+/g, " ").trim();
  return {
    notePath: params.manifestEntry.notePath,
    updatedAt: params.manifestEntry.updatedAt,
    excerpt: body.slice(0, MAX_INDEX_EXCERPT_CHARS),
    keywords: extractKeywords(body),
  };
}

export async function loadDurableBodyIndex(params: {
  scopeDir: string;
  manifest: DurableMemoryManifestEntry[];
}): Promise<Map<string, DurableBodyIndexEntry>> {
  const existing = await readCache(params.scopeDir);
  const current = new Map<string, DurableBodyIndexEntry>();
  let changed = false;

  for (const entry of params.manifest) {
    const cached = existing.get(entry.notePath);
    if (cached && cached.updatedAt === entry.updatedAt) {
      current.set(entry.notePath, cached);
      continue;
    }
    const indexed = await buildEntry({
      scopeDir: params.scopeDir,
      manifestEntry: entry,
    });
    if (indexed) {
      current.set(entry.notePath, indexed);
    }
    changed = true;
  }

  if (existing.size !== current.size) {
    changed = true;
  }
  if (changed) {
    await writeCache(params.scopeDir, current);
  }
  return current;
}
