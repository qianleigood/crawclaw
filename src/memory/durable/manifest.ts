import fs from "node:fs/promises";
import path from "node:path";
import { parseMarkdownFrontmatter } from "../markdown/frontmatter.ts";
import type { DurableMemoryType } from "../types/orchestration.ts";
import { normalizeDurableMemoryType } from "./common.ts";
import {
  resolveDurableMemoryIndexPath,
  resolveDurableMemoryRootDir,
  type DurableMemoryScope,
} from "./scope.ts";

export interface DurableMemoryManifestEntry {
  notePath: string;
  title: string;
  durableType: DurableMemoryType;
  description: string;
  indexHook: string;
  updatedAt: number;
}

async function listMarkdownFiles(root: string): Promise<string[]> {
  const entries = await fs.readdir(root, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const absolute = path.join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listMarkdownFiles(absolute)));
      continue;
    }
    if (entry.isFile() && /\.md$/i.test(entry.name)) {
      files.push(absolute);
    }
  }
  return files;
}

async function readHeaderText(filePath: string, maxBytes = 16_384): Promise<string> {
  const handle = await fs.open(filePath, "r");
  try {
    const buffer = Buffer.alloc(maxBytes);
    const { bytesRead } = await handle.read(buffer, 0, maxBytes, 0);
    return buffer.toString("utf8", 0, bytesRead);
  } finally {
    await handle.close();
  }
}

function extractDescription(parsedBody: string): string {
  return (
    parsedBody
      .split(/\n+/)
      .map((line) => line.trim())
      .find(Boolean) ?? ""
  );
}

function normalizeIndexHook(line: string): string {
  return line
    .replace(/^\s*(?:[-*+]|\d+\.)\s+/, "")
    .replace(/\[([^\]]+)\]\(([^)]+\.md)\)/gi, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function parseIndexEntries(indexText: string): Map<string, string> {
  const entries = new Map<string, string>();
  const add = (value: string) => {
    const cleaned = value
      .trim()
      .replace(/\\/g, "/")
      .replace(/^\.?\/?/, "");
    if (!cleaned || !/\.md$/i.test(cleaned) || cleaned === "MEMORY.md") {
      return;
    }
    const hook = normalizeIndexHook(currentLine);
    if (!entries.has(cleaned) || hook) {
      entries.set(cleaned, hook);
    }
  };

  let currentLine = "";
  for (const line of indexText.split(/\r?\n/)) {
    currentLine = line;
    for (const match of line.matchAll(/\[[^\]]+\]\(([^)]+\.md)\)/gi)) {
      if (match[1]) {
        add(match[1]);
      }
    }
    for (const match of line.matchAll(/(?:^|\s)([^\s()]+\.md)(?:\s|$)/gi)) {
      if (match[1]) {
        add(match[1]);
      }
    }
  }
  return entries;
}

async function listCandidateNotePaths(scope: DurableMemoryScope): Promise<{
  notePaths: string[];
  indexHooks: Map<string, string>;
}> {
  const scopeDir =
    scope.rootDir ??
    path.join(
      resolveDurableMemoryRootDir(),
      "agents",
      scope.agentId,
      "channels",
      scope.channel,
      "users",
      scope.userId,
    );
  const indexPath = resolveDurableMemoryIndexPath(scope);
  const indexExists = await fs
    .stat(indexPath)
    .then(() => true)
    .catch(() => false);
  const candidatePaths = new Set<string>();
  let indexHooks = new Map<string, string>();
  if (indexExists) {
    const indexText = await fs.readFile(indexPath, "utf8").catch(() => "");
    indexHooks = parseIndexEntries(indexText);
    for (const notePath of indexHooks.keys()) {
      candidatePaths.add(notePath);
    }
  }
  const markdownFiles = await listMarkdownFiles(scopeDir).catch((error) => {
    const code = (error as NodeJS.ErrnoException | undefined)?.code;
    if (code === "ENOENT") {
      return [] as string[];
    }
    throw error;
  });
  for (const absolutePath of markdownFiles) {
    const notePath = path.relative(scopeDir, absolutePath).replace(/\\/g, "/");
    if (notePath === "MEMORY.md") {
      continue;
    }
    candidatePaths.add(notePath);
  }
  return {
    notePaths: [...candidatePaths],
    indexHooks,
  };
}

export async function scanDurableMemoryManifest(params: {
  scope: DurableMemoryScope;
  maxFiles?: number;
}): Promise<DurableMemoryManifestEntry[]> {
  const maxFiles = Math.max(1, Math.min(params.maxFiles ?? 200, 1000));
  const scopeDir =
    params.scope.rootDir ??
    path.join(
      resolveDurableMemoryRootDir(),
      "agents",
      params.scope.agentId,
      "channels",
      params.scope.channel,
      "users",
      params.scope.userId,
    );
  const { notePaths: candidatePaths, indexHooks } = await listCandidateNotePaths(params.scope);
  const entries: DurableMemoryManifestEntry[] = [];

  for (const notePath of candidatePaths) {
    const absolutePath = path.join(scopeDir, notePath);
    const stat = await fs.stat(absolutePath).catch(() => null);
    if (!stat?.isFile()) {
      continue;
    }
    const headerText = await readHeaderText(absolutePath);
    const parsed = parseMarkdownFrontmatter(headerText);
    const durableType = normalizeDurableMemoryType(
      typeof parsed.frontmatter.durable_memory_type === "string"
        ? parsed.frontmatter.durable_memory_type
        : typeof parsed.frontmatter.type === "string"
          ? parsed.frontmatter.type
          : null,
    );
    if (!durableType) {
      continue;
    }
    const title =
      (typeof parsed.frontmatter.title === "string" && parsed.frontmatter.title.trim()) ||
      path.basename(notePath, ".md");
    const description =
      (typeof parsed.frontmatter.description === "string" &&
        parsed.frontmatter.description.trim()) ||
      extractDescription(parsed.body);
    entries.push({
      notePath,
      title,
      durableType,
      description,
      indexHook: indexHooks.get(notePath)?.trim() ?? "",
      updatedAt: stat.mtimeMs,
    });
  }

  return entries
    .toSorted(
      (left, right) =>
        right.updatedAt - left.updatedAt || left.notePath.localeCompare(right.notePath),
    )
    .slice(0, maxFiles);
}
