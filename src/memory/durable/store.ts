import fs from "node:fs/promises";
import path from "node:path";
import { ensureDir } from "../../utils.js";
import { parseMarkdownFrontmatter } from "../markdown/frontmatter.ts";
import type { DurableMemoryType } from "../types/orchestration.ts";
import {
  buildDurableMemoryBody,
  buildDurableMemoryFrontmatter,
  deriveDurableMemoryNotePath,
  normalizeDurableMemoryWriteInput,
  normalizeDurableMemoryType,
  type DurableMemoryWriteInput,
} from "./common.ts";
import {
  resolveDurableMemoryIndexPath,
  resolveDurableMemoryRootDir,
  resolveDurableMemoryScopeDir,
  type DurableMemoryScope,
} from "./scope.ts";

export const MEMORY_INDEX_MAX_LINES = 200;
export const MEMORY_INDEX_MAX_BYTES = 25 * 1024;
export const MEMORY_INDEX_MAX_ENTRY_CHARS = 150;
const MANAGED_TIME_FRONTMATTER_KEYS = new Set([
  "created",
  "created_at",
  "createdat",
  "updated",
  "updated_at",
  "updatedat",
]);

export interface DurableMemoryManifestEntry {
  notePath: string;
  absolutePath: string;
  title: string;
  description: string;
  durableType: DurableMemoryType;
  dedupeKey?: string;
  updatedAt: number;
}

type DurableMemoryWriteResult = {
  action: "create" | "update";
  notePath: string;
  absolutePath: string;
  indexPath: string;
  bytesWritten: number;
  beforeHash?: string;
  afterHash?: string;
};

type DurableMemoryDeleteResult = {
  action: "deleted";
  notePath: string;
  absolutePath: string;
  indexPath: string;
};

function computeHash(text: string): string {
  let hash = 0;
  for (let index = 0; index < text.length; index += 1) {
    hash = Math.imul(31, hash) + text.charCodeAt(index);
    hash |= 0;
  }
  return `h${Math.abs(hash)}`;
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

function extractDescription(body: string): string {
  return (
    body
      .split(/\n+/)
      .map((line) => line.trim())
      .find(Boolean) ?? ""
  );
}

function renderFrontmatterLine(key: string, value: unknown): string {
  if (Array.isArray(value)) {
    return `${key}: [${value.map((item) => JSON.stringify(item)).join(", ")}]`;
  }
  if (value === null) {
    return `${key}: null`;
  }
  if (typeof value === "object") {
    return `${key}: ${JSON.stringify(value)}`;
  }
  if (typeof value === "string") {
    return `${key}: ${JSON.stringify(value)}`;
  }
  return `${key}: ${JSON.stringify(value)}`;
}

function renderFrontmatter(frontmatter: Record<string, unknown>): string {
  const keys = Object.keys(frontmatter);
  return ["---", ...keys.map((key) => renderFrontmatterLine(key, frontmatter[key])), "---"].join(
    "\n",
  );
}

function renderNoteMarkdown(input: { frontmatter: Record<string, unknown>; body: string }): string {
  return `${renderFrontmatter(input.frontmatter)}\n\n${input.body.trim()}\n`;
}

function truncateMemoryIndexEntry(line: string, maxChars = MEMORY_INDEX_MAX_ENTRY_CHARS): string {
  if (line.length <= maxChars) {
    return line;
  }
  return `${line.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`;
}

function normalizeMemoryIndexText(text: string): string {
  return text.replace(/\r\n/g, "\n").trimEnd();
}

function validateMemoryIndexContent(content: string): string {
  const normalized = normalizeMemoryIndexText(content);
  if (normalized.startsWith("---\n")) {
    throw new Error("MEMORY.md cannot contain frontmatter.");
  }
  const lines = normalized.split("\n");
  if (lines.length > MEMORY_INDEX_MAX_LINES) {
    throw new Error(`MEMORY.md cannot exceed ${MEMORY_INDEX_MAX_LINES} lines.`);
  }
  const bytes = Buffer.byteLength(`${normalized}\n`, "utf8");
  if (bytes > MEMORY_INDEX_MAX_BYTES) {
    throw new Error(`MEMORY.md cannot exceed ${MEMORY_INDEX_MAX_BYTES} bytes.`);
  }
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    if (trimmed.length > MEMORY_INDEX_MAX_ENTRY_CHARS) {
      throw new Error(
        `MEMORY.md index entries must stay under ${MEMORY_INDEX_MAX_ENTRY_CHARS} characters.`,
      );
    }
  }
  return `${normalized}\n`;
}

function validateRawNoteContent(notePath: string, content: string): string {
  const rendered = content.endsWith("\n") ? content : `${content}\n`;
  if (notePath === "MEMORY.md") {
    return validateMemoryIndexContent(rendered);
  }
  const parsed = parseMarkdownFrontmatter(rendered);
  const managedKeys = Object.keys(parsed.frontmatter).filter((key) =>
    MANAGED_TIME_FRONTMATTER_KEYS.has(key.toLowerCase()),
  );
  if (managedKeys.length > 0) {
    throw new Error(
      `Durable memory note time metadata is managed by CrawClaw; omit ${managedKeys.join(", ")}.`,
    );
  }
  return rendered;
}

function renderIndex(scope: DurableMemoryScope, entries: DurableMemoryManifestEntry[]): string {
  const byType: Record<DurableMemoryType, DurableMemoryManifestEntry[]> = {
    user: [],
    feedback: [],
    project: [],
    reference: [],
  };
  for (const entry of entries) {
    byType[entry.durableType].push(entry);
  }
  for (const list of Object.values(byType)) {
    list.sort(
      (left, right) =>
        right.updatedAt - left.updatedAt || left.notePath.localeCompare(right.notePath),
    );
  }
  const lines = ["# MEMORY.md", ""];
  for (const type of ["user", "feedback", "project", "reference"] as const) {
    const items = byType[type];
    lines.push(`## ${type}`);
    if (!items.length) {
      lines.push("", "- _none_", "");
      continue;
    }
    for (const item of items) {
      const summary = item.description ? ` — ${item.description}` : "";
      lines.push(truncateMemoryIndexEntry(`- [${item.title}](./${item.notePath})${summary}`));
    }
    lines.push("");
  }
  return validateMemoryIndexContent(
    lines
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim(),
  );
}

async function scanScopeEntries(
  scope: DurableMemoryScope,
  rootDir = resolveDurableMemoryRootDir(),
): Promise<DurableMemoryManifestEntry[]> {
  const scopeDir = resolveDurableMemoryScopeDir(scope, rootDir);
  let markdownFiles: string[] = [];
  try {
    markdownFiles = await listMarkdownFiles(scopeDir);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException | undefined)?.code;
    if (code === "ENOENT") {
      return [];
    }
    throw error;
  }
  const entries: DurableMemoryManifestEntry[] = [];
  for (const absolutePath of markdownFiles) {
    const relativePath = path.relative(scopeDir, absolutePath).replace(/\\/g, "/");
    if (relativePath === "MEMORY.md") {
      continue;
    }
    const stat = await fs.stat(absolutePath);
    const headerText = await readHeaderText(absolutePath);
    const parsed = parseMarkdownFrontmatter(headerText);
    const frontmatterType = normalizeDurableMemoryType(
      typeof parsed.frontmatter.durable_memory_type === "string"
        ? parsed.frontmatter.durable_memory_type
        : typeof parsed.frontmatter.type === "string"
          ? parsed.frontmatter.type
          : undefined,
    );
    const fileType = normalizeDurableMemoryType(path.basename(relativePath, ".md").split("-")[0]);
    const durableType = frontmatterType ?? fileType ?? "reference";
    const title =
      (typeof parsed.frontmatter.title === "string" && parsed.frontmatter.title.trim()) ||
      path.basename(relativePath, ".md");
    const description =
      (typeof parsed.frontmatter.description === "string" &&
        parsed.frontmatter.description.trim()) ||
      extractDescription(parsed.body);
    const dedupeKey =
      typeof parsed.frontmatter.dedupe_key === "string"
        ? parsed.frontmatter.dedupe_key.trim()
        : undefined;
    entries.push({
      notePath: relativePath,
      absolutePath,
      title,
      description,
      durableType,
      dedupeKey,
      updatedAt: stat.mtimeMs,
    });
  }
  return entries.toSorted(
    (left, right) =>
      right.updatedAt - left.updatedAt || left.notePath.localeCompare(right.notePath),
  );
}

async function regenerateIndex(
  scope: DurableMemoryScope,
  rootDir = resolveDurableMemoryRootDir(),
): Promise<string> {
  const entries = await scanScopeEntries(scope, rootDir);
  const indexPath = resolveDurableMemoryIndexPath(scope, rootDir);
  await ensureDir(path.dirname(indexPath));
  await fs.writeFile(indexPath, renderIndex(scope, entries), "utf8");
  return indexPath;
}

function assertDurableMemoryScopedNotePath(notePath: string): string {
  const normalized = notePath.trim().replace(/\\/g, "/");
  if (!normalized) {
    throw new Error("notePath required");
  }
  if (normalized.startsWith("/") || normalized.includes("../") || normalized === "..") {
    throw new Error("notePath must stay inside the durable memory scope");
  }
  if (normalized !== "MEMORY.md" && !/\.md$/i.test(normalized)) {
    throw new Error("notePath must point to a Markdown file");
  }
  return normalized;
}

function resolveDurableMemoryScopedPath(params: {
  scope: DurableMemoryScope;
  notePath: string;
  rootDir?: string;
}): { scopeDir: string; notePath: string; absolutePath: string } {
  const rootDir = params.rootDir ?? resolveDurableMemoryRootDir();
  const scopeDir = resolveDurableMemoryScopeDir(params.scope, rootDir);
  const notePath = assertDurableMemoryScopedNotePath(params.notePath);
  const absolutePath = path.resolve(scopeDir, notePath);
  const normalizedScopeDir = path.resolve(scopeDir) + path.sep;
  if (
    absolutePath !== path.resolve(scopeDir, "MEMORY.md") &&
    !absolutePath.startsWith(normalizedScopeDir)
  ) {
    throw new Error("notePath escaped the durable memory scope");
  }
  return { scopeDir, notePath, absolutePath };
}

function resolveNotePath(
  scope: DurableMemoryScope,
  input: DurableMemoryWriteInput,
  rootDir = resolveDurableMemoryRootDir(),
): { absolutePath: string; relativePath: string } {
  const scopeDir = resolveDurableMemoryScopeDir(scope, rootDir);
  const relativePath = deriveDurableMemoryNotePath(normalizeDurableMemoryWriteInput(input)).replace(
    /\\/g,
    "/",
  );
  return {
    absolutePath: path.join(scopeDir, relativePath),
    relativePath,
  };
}

function inferMatches(entry: DurableMemoryManifestEntry, input: DurableMemoryWriteInput): boolean {
  const normalized = normalizeDurableMemoryWriteInput(input);
  const desiredTitle = normalized.title.trim().toLowerCase();
  const desiredDedupeKey = normalized.dedupeKey?.trim().toLowerCase();
  if (desiredDedupeKey && entry.dedupeKey?.trim().toLowerCase() === desiredDedupeKey) {
    return true;
  }
  return entry.title.trim().toLowerCase() === desiredTitle;
}

async function findExistingNote(
  scope: DurableMemoryScope,
  input: DurableMemoryWriteInput,
  rootDir = resolveDurableMemoryRootDir(),
): Promise<DurableMemoryManifestEntry | null> {
  const entries = await scanScopeEntries(scope, rootDir);
  const match = entries.find(
    (entry) => entry.durableType === input.type && inferMatches(entry, input),
  );
  return match ?? null;
}

export async function upsertDurableMemoryNote(params: {
  scope: DurableMemoryScope;
  input: DurableMemoryWriteInput;
  rootDir?: string;
}): Promise<DurableMemoryWriteResult & { notePath: string }> {
  const rootDir = params.rootDir ?? resolveDurableMemoryRootDir();
  const scopeDir = resolveDurableMemoryScopeDir(params.scope, rootDir);
  await ensureDir(scopeDir);
  const input = normalizeDurableMemoryWriteInput(params.input);

  const existing = await findExistingNote(params.scope, input, rootDir);
  const target = existing
    ? { absolutePath: existing.absolutePath, relativePath: existing.notePath }
    : resolveNotePath(params.scope, input, rootDir);
  await ensureDir(path.dirname(target.absolutePath));

  let beforeHash: string | undefined;
  try {
    beforeHash = computeHash(await fs.readFile(target.absolutePath, "utf8"));
  } catch {
    beforeHash = undefined;
  }

  const frontmatter = buildDurableMemoryFrontmatter(input, params.scope);
  const body = buildDurableMemoryBody(input);
  const rendered = renderNoteMarkdown({ frontmatter, body });
  await fs.writeFile(target.absolutePath, rendered, "utf8");
  const indexPath = await regenerateIndex(params.scope, rootDir);
  const afterHash = computeHash(rendered);
  const bytesWritten = Buffer.byteLength(rendered, "utf8");
  return {
    action: existing ? "update" : "create",
    notePath: target.relativePath,
    absolutePath: target.absolutePath,
    indexPath,
    bytesWritten,
    beforeHash,
    afterHash,
  };
}

export async function readDurableMemoryScopedFile(params: {
  scope: DurableMemoryScope;
  notePath: string;
  rootDir?: string;
}): Promise<{ notePath: string; absolutePath: string; content: string }> {
  const resolved = resolveDurableMemoryScopedPath(params);
  const content = await fs.readFile(resolved.absolutePath, "utf8");
  return {
    notePath: resolved.notePath,
    absolutePath: resolved.absolutePath,
    content,
  };
}

export async function writeDurableMemoryScopedFile(params: {
  scope: DurableMemoryScope;
  notePath: string;
  content: string;
  rootDir?: string;
}): Promise<{
  notePath: string;
  absolutePath: string;
  bytesWritten: number;
  beforeHash?: string;
  afterHash: string;
}> {
  const resolved = resolveDurableMemoryScopedPath(params);
  await ensureDir(path.dirname(resolved.absolutePath));
  let beforeHash: string | undefined;
  try {
    beforeHash = computeHash(await fs.readFile(resolved.absolutePath, "utf8"));
  } catch {
    beforeHash = undefined;
  }
  const rendered = validateRawNoteContent(resolved.notePath, params.content);
  await fs.writeFile(resolved.absolutePath, rendered, "utf8");
  return {
    notePath: resolved.notePath,
    absolutePath: resolved.absolutePath,
    bytesWritten: Buffer.byteLength(rendered, "utf8"),
    beforeHash,
    afterHash: computeHash(rendered),
  };
}

export async function editDurableMemoryScopedFile(params: {
  scope: DurableMemoryScope;
  notePath: string;
  findText: string;
  replaceText: string;
  replaceAll?: boolean;
  rootDir?: string;
}): Promise<{
  notePath: string;
  absolutePath: string;
  replacements: number;
  beforeHash: string;
  afterHash: string;
  bytesWritten: number;
}> {
  const resolved = resolveDurableMemoryScopedPath(params);
  const original = await fs.readFile(resolved.absolutePath, "utf8");
  const beforeHash = computeHash(original);
  if (!params.findText) {
    throw new Error("findText required");
  }
  let replacements = 0;
  const next = params.replaceAll
    ? original.replaceAll(params.findText, () => {
        replacements += 1;
        return params.replaceText;
      })
    : original.replace(params.findText, () => {
        replacements += 1;
        return params.replaceText;
      });
  const validatedNext = validateRawNoteContent(resolved.notePath, next);
  await fs.writeFile(resolved.absolutePath, validatedNext, "utf8");
  return {
    notePath: resolved.notePath,
    absolutePath: resolved.absolutePath,
    replacements,
    beforeHash,
    afterHash: computeHash(validatedNext),
    bytesWritten: Buffer.byteLength(validatedNext, "utf8"),
  };
}

export async function deleteDurableMemoryNote(params: {
  scope: DurableMemoryScope;
  type: DurableMemoryType;
  title?: string;
  dedupeKey?: string;
  notePath?: string;
  rootDir?: string;
}): Promise<
  DurableMemoryDeleteResult | { action: "missing"; notePath: string; indexPath: string }
> {
  const rootDir = params.rootDir ?? resolveDurableMemoryRootDir();
  const requestedNotePath = params.notePath?.trim()
    ? params.notePath.trim().replace(/\\/g, "/")
    : await resolveDurableMemoryDeletionPath({
        scope: params.scope,
        type: params.type,
        title: params.title,
        dedupeKey: params.dedupeKey,
        rootDir,
      });
  const resolved = resolveDurableMemoryScopedPath({
    scope: params.scope,
    notePath: requestedNotePath,
    rootDir,
  });
  const notePath = resolved.notePath;
  const absolutePath = resolved.absolutePath;
  try {
    await fs.unlink(absolutePath);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException | undefined)?.code;
    if (code === "ENOENT") {
      const indexPath = await regenerateIndex(params.scope, rootDir);
      return { action: "missing", notePath, indexPath };
    }
    throw error;
  }
  const indexPath = await regenerateIndex(params.scope, rootDir);
  return {
    action: "deleted",
    notePath,
    absolutePath,
    indexPath,
  };
}

export async function resolveDurableMemoryDeletionPath(params: {
  scope: DurableMemoryScope;
  type: DurableMemoryType;
  title?: string;
  dedupeKey?: string;
  rootDir?: string;
}): Promise<string> {
  const rootDir = params.rootDir ?? resolveDurableMemoryRootDir();
  const entries = await scanScopeEntries(params.scope, rootDir);
  const desiredTitle = params.title?.trim().toLowerCase();
  const desiredDedupeKey = params.dedupeKey?.trim().toLowerCase();
  for (const entry of entries) {
    if (entry.durableType !== params.type) {
      continue;
    }
    if (desiredDedupeKey && entry.dedupeKey?.trim().toLowerCase() === desiredDedupeKey) {
      return entry.notePath;
    }
    if (desiredTitle && entry.title.trim().toLowerCase() === desiredTitle) {
      return entry.notePath;
    }
  }
  return deriveDurableMemoryNotePath({
    type: params.type,
    title: params.title ?? params.dedupeKey ?? params.type,
    dedupeKey: params.dedupeKey,
  });
}

export {
  regenerateIndex as regenerateDurableMemoryIndex,
  scanScopeEntries as scanDurableMemoryScopeEntries,
};
