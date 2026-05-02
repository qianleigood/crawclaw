import type { Dirent } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { resolveDurableMemoryRootDir } from "./scope.ts";

export interface DurableMemoryIndexDocumentEntry {
  id: string;
  relativePath: string;
  title: string;
  scopeKey: string;
  agentId: string;
  channel: string;
  userId: string;
  updatedAt: string;
  sizeBytes: number;
  noteCount: number;
}

export interface DurableMemoryIndexDocument {
  item: DurableMemoryIndexDocumentEntry;
  content: string;
}

function toPosix(relativePath: string): string {
  return relativePath.replace(/\\/g, "/");
}

function decodeScopeSegment(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function parseScope(
  relativePath: string,
): Pick<DurableMemoryIndexDocumentEntry, "agentId" | "channel" | "userId" | "scopeKey"> | null {
  const segments = relativePath.split("/");
  if (
    segments.length !== 7 ||
    segments[0] !== "agents" ||
    segments[2] !== "channels" ||
    segments[4] !== "users" ||
    segments[6] !== "MEMORY.md"
  ) {
    return null;
  }
  const agentId = decodeScopeSegment(segments[1] ?? "");
  const channel = decodeScopeSegment(segments[3] ?? "");
  const userId = decodeScopeSegment(segments[5] ?? "");
  if (!agentId || !channel || !userId) {
    return null;
  }
  return {
    agentId,
    channel,
    userId,
    scopeKey: `${agentId}:${channel}:${userId}`,
  };
}

function extractTitle(content: string): string {
  const heading = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => /^#\s+\S/.test(line));
  return heading?.replace(/^#+\s+/, "").trim() || "MEMORY.md";
}

function countLinkedNotes(content: string): number {
  const notePaths = new Set<string>();
  for (const match of content.matchAll(/\]\(([^)]+\.md)\)/gi)) {
    const notePath = match[1]
      ?.trim()
      .replace(/\\/g, "/")
      .replace(/^\.?\//, "");
    if (notePath && notePath !== "MEMORY.md") {
      notePaths.add(notePath);
    }
  }
  return notePaths.size;
}

async function listOutboxFiles(rootDir: string): Promise<string[]> {
  const files: string[] = [];
  const visit = async (dir: string) => {
    let entries: Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch (error) {
      const code = (error as NodeJS.ErrnoException | undefined)?.code;
      if (code === "ENOENT") {
        return;
      }
      throw error;
    }
    for (const entry of entries) {
      const absolutePath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await visit(absolutePath);
      } else if (entry.isFile() && entry.name === "MEMORY.md") {
        files.push(absolutePath);
      }
    }
  };
  await visit(rootDir);
  return files;
}

function normalizeIndexDocumentId(id: string): string {
  const normalized = id.trim().replace(/\\/g, "/");
  const parts = normalized.split("/");
  if (
    !normalized ||
    path.posix.isAbsolute(normalized) ||
    parts.includes("..") ||
    path.posix.basename(normalized) !== "MEMORY.md"
  ) {
    throw new Error("id must point to a MEMORY.md file inside durable memory root");
  }
  return normalized;
}

function resolveIndexDocumentPath(rootDir: string, id: string): string {
  const normalizedId = normalizeIndexDocumentId(id);
  const root = path.resolve(rootDir);
  const absolutePath = path.resolve(root, normalizedId);
  if (absolutePath !== root && !absolutePath.startsWith(`${root}${path.sep}`)) {
    throw new Error("id must point to a MEMORY.md file inside durable memory root");
  }
  return absolutePath;
}

function buildEntry(params: {
  rootDir: string;
  absolutePath: string;
  stat: { mtimeMs: number; size: number };
  content: string;
}): DurableMemoryIndexDocumentEntry | null {
  const relativePath = toPosix(path.relative(params.rootDir, params.absolutePath));
  const scope = parseScope(relativePath);
  if (!scope) {
    return null;
  }
  return {
    id: relativePath,
    relativePath,
    title: extractTitle(params.content),
    ...scope,
    updatedAt: new Date(params.stat.mtimeMs).toISOString(),
    sizeBytes: params.stat.size,
    noteCount: countLinkedNotes(params.content),
  };
}

export async function listDurableMemoryIndexDocuments(params?: {
  rootDir?: string;
  limit?: number;
}): Promise<{ items: DurableMemoryIndexDocumentEntry[] }> {
  const rootDir = path.resolve(params?.rootDir ?? resolveDurableMemoryRootDir());
  const limit = Math.max(1, Math.min(params?.limit ?? 50, 500));
  const files = await listOutboxFiles(rootDir);
  const items: DurableMemoryIndexDocumentEntry[] = [];
  for (const absolutePath of files) {
    const stat = await fs.stat(absolutePath);
    const content = await fs.readFile(absolutePath, "utf8");
    const entry = buildEntry({ rootDir, absolutePath, stat, content });
    if (entry) {
      items.push(entry);
    }
  }
  return {
    items: items
      .toSorted(
        (left, right) =>
          right.updatedAt.localeCompare(left.updatedAt) || left.id.localeCompare(right.id),
      )
      .slice(0, limit),
  };
}

export async function readDurableMemoryIndexDocument(params: {
  rootDir?: string;
  id: string;
}): Promise<DurableMemoryIndexDocument> {
  const rootDir = path.resolve(params.rootDir ?? resolveDurableMemoryRootDir());
  const absolutePath = resolveIndexDocumentPath(rootDir, params.id);
  const stat = await fs.stat(absolutePath);
  if (!stat.isFile()) {
    throw new Error("id must point to a MEMORY.md file inside durable memory root");
  }
  const content = await fs.readFile(absolutePath, "utf8");
  const item = buildEntry({ rootDir, absolutePath, stat, content });
  if (!item) {
    throw new Error("id must point to a scoped durable memory index");
  }
  return { item, content };
}
