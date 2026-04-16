import fs from "node:fs/promises";
import path from "node:path";
import type { CacheGovernanceDescriptor } from "../../cache/governance-types.js";
import { resolveStateDir } from "../../config/paths.ts";
import { writeTextAtomic } from "../../infra/json-files.ts";
import { normalizeAgentId } from "../../routing/session-key.ts";
import {
  buildSessionSummaryTemplate,
  extractSessionSummarySectionText,
  parseSessionSummaryDocument,
  renderSessionSummaryDocument,
  type SessionSummaryDocument,
  type SessionSummarySectionKey,
} from "./template.ts";

export type SessionSummaryFileSnapshot = {
  sessionId: string;
  agentId: string;
  summaryPath: string;
  exists: boolean;
  content: string | null;
  bytes: number;
  updatedAt: number | null;
  document: SessionSummaryDocument | null;
};

type SessionSummaryReadCacheEntry = {
  mtimeMs: number;
  bytes: number;
  snapshot: SessionSummaryFileSnapshot;
};

const sessionSummaryReadCache = new Map<string, SessionSummaryReadCacheEntry>();

export const SESSION_SUMMARY_READ_CACHE_DESCRIPTOR: CacheGovernanceDescriptor = {
  id: "memory.session-summary.read-cache",
  module: "src/memory/session-summary/store.ts",
  category: "file_ui",
  owner: "memory/session-summary",
  key: "summaryPath + file mtimeMs + bytes",
  lifecycle:
    "Process-local read-through cache for session summary markdown snapshots retained until file mutation, file disappearance, explicit clear, or process restart.",
  invalidation: [
    "writeSessionSummaryFile(...) refreshes the cached snapshot",
    "Missing files remove the cached entry",
    "clearSessionSummaryReadCache(summaryPath?) clears one or all entries",
  ],
  observability: ["getSessionSummaryReadCacheMeta()", "SessionSummaryFileSnapshot.updatedAt"],
};

function normalizeOptionalString(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function cloneSnapshot(snapshot: SessionSummaryFileSnapshot): SessionSummaryFileSnapshot {
  return {
    ...snapshot,
    document: snapshot.content ? parseSessionSummaryDocument(snapshot.content) : null,
  };
}

function updateReadCache(snapshot: SessionSummaryFileSnapshot): void {
  if (!snapshot.exists || snapshot.updatedAt == null) {
    sessionSummaryReadCache.delete(snapshot.summaryPath);
    return;
  }
  sessionSummaryReadCache.set(snapshot.summaryPath, {
    mtimeMs: snapshot.updatedAt,
    bytes: snapshot.bytes,
    snapshot: cloneSnapshot(snapshot),
  });
}

export function resolveSessionSummaryRootDir(rootDir: string = resolveStateDir()): string {
  return path.join(rootDir.trim() || resolveStateDir(), "session-summary");
}

function normalizeSessionIdSegment(value: string | null | undefined): string {
  const trimmed = normalizeOptionalString(value) ?? "session";
  return encodeURIComponent(trimmed) || "session";
}

function resolveSummaryTarget(params: {
  agentId?: string | null;
  sessionId?: string | null;
  rootDir?: string | null;
}): { agentId: string; sessionId: string; summaryPath: string } {
  const agentId = normalizeAgentId(params.agentId ?? undefined);
  const sessionId = normalizeOptionalString(params.sessionId) ?? "session";
  const baseDir = params.rootDir?.trim() ? path.resolve(params.rootDir.trim()) : resolveStateDir();
  const rootDir = resolveSessionSummaryRootDir(baseDir);
  const summaryPath = path.join(
    rootDir,
    "agents",
    agentId,
    "sessions",
    normalizeSessionIdSegment(sessionId),
    "summary.md",
  );
  return {
    agentId,
    sessionId,
    summaryPath,
  };
}

export function resolveSessionSummaryFilePath(params: {
  agentId?: string | null;
  sessionId?: string | null;
  rootDir?: string | null;
}): string {
  return resolveSummaryTarget(params).summaryPath;
}

export function resolveSessionSummaryPath(params: {
  agentId?: string | null;
  sessionId?: string | null;
  rootDir?: string | null;
}): string {
  return resolveSessionSummaryFilePath(params);
}

export async function readSessionSummaryFile(params: {
  agentId?: string | null;
  sessionId?: string | null;
  rootDir?: string | null;
}): Promise<SessionSummaryFileSnapshot> {
  const target = resolveSummaryTarget(params);
  try {
    const stat = await fs.stat(target.summaryPath);
    const cached = sessionSummaryReadCache.get(target.summaryPath);
    if (cached && cached.mtimeMs === stat.mtimeMs && cached.bytes === stat.size) {
      return cloneSnapshot(cached.snapshot);
    }
    const content = await fs.readFile(target.summaryPath, "utf8");
    const snapshot: SessionSummaryFileSnapshot = {
      sessionId: target.sessionId,
      agentId: target.agentId,
      summaryPath: target.summaryPath,
      exists: true,
      content,
      bytes: Buffer.byteLength(content, "utf8"),
      updatedAt: stat.mtimeMs,
      document: parseSessionSummaryDocument(content),
    };
    updateReadCache(snapshot);
    return snapshot;
  } catch {
    sessionSummaryReadCache.delete(target.summaryPath);
    return {
      sessionId: target.sessionId,
      agentId: target.agentId,
      summaryPath: target.summaryPath,
      exists: false,
      content: null,
      bytes: 0,
      updatedAt: null,
      document: null,
    };
  }
}

export async function writeSessionSummaryFile(params: {
  agentId?: string | null;
  sessionId?: string | null;
  content: string;
  rootDir?: string | null;
}): Promise<SessionSummaryFileSnapshot> {
  const target = resolveSummaryTarget(params);
  const normalizedContent = params.content.replace(/\r\n/g, "\n");
  await writeTextAtomic(target.summaryPath, normalizedContent, { mode: 0o600 });
  const stat = await fs.stat(target.summaryPath);
  const snapshot: SessionSummaryFileSnapshot = {
    sessionId: target.sessionId,
    agentId: target.agentId,
    summaryPath: target.summaryPath,
    exists: true,
    content: normalizedContent,
    bytes: Buffer.byteLength(normalizedContent, "utf8"),
    updatedAt: stat.mtimeMs,
    document: parseSessionSummaryDocument(normalizedContent),
  };
  updateReadCache(snapshot);
  return snapshot;
}

export async function ensureSessionSummaryFile(params: {
  agentId?: string | null;
  sessionId?: string | null;
  rootDir?: string | null;
}): Promise<SessionSummaryFileSnapshot> {
  const snapshot = await readSessionSummaryFile(params);
  if (snapshot.exists) {
    return snapshot;
  }
  return await writeSessionSummaryFile({
    agentId: params.agentId,
    sessionId: params.sessionId,
    rootDir: params.rootDir,
    content: ensureSessionSummaryTemplateContent({
      sessionId: params.sessionId,
    }),
  });
}

export async function editSessionSummaryFile(params: {
  agentId?: string | null;
  sessionId?: string | null;
  findText: string;
  replaceText: string;
  replaceAll?: boolean;
  rootDir?: string | null;
}): Promise<SessionSummaryFileSnapshot & { replacements: number }> {
  const snapshot = await readSessionSummaryFile({
    agentId: params.agentId,
    sessionId: params.sessionId,
    rootDir: params.rootDir,
  });
  if (!snapshot.exists || !snapshot.content) {
    throw new Error("Session summary file not found.");
  }
  const findText = params.findText;
  const replaceText = params.replaceText;
  if (!findText.trim()) {
    throw new Error("findText required");
  }
  const replaceAll = params.replaceAll === true;
  const current = snapshot.content;
  const replacements = current.includes(findText) ? current.split(findText).length - 1 : 0;
  if (replacements === 0) {
    return { ...snapshot, replacements: 0 };
  }
  const nextContent = replaceAll
    ? current.split(findText).join(replaceText)
    : current.replace(findText, replaceText);
  const written = await writeSessionSummaryFile({
    agentId: params.agentId,
    sessionId: params.sessionId,
    content: nextContent,
    rootDir: params.rootDir,
  });
  return { ...written, replacements: replaceAll ? replacements : 1 };
}

export function ensureSessionSummaryTemplateContent(params: { sessionId?: string | null }): string {
  return buildSessionSummaryTemplate({
    sessionId: normalizeOptionalString(params.sessionId),
  });
}

export function readSessionSummarySectionText(params: {
  content?: string | null;
  section: SessionSummarySectionKey;
}): string {
  return extractSessionSummarySectionText(params.content, params.section);
}

export function renderSessionSummaryMarkdown(
  document: SessionSummaryDocument | null | undefined,
): string {
  return renderSessionSummaryDocument(document);
}

export function clearSessionSummaryReadCache(summaryPath?: string): void {
  if (typeof summaryPath === "string" && summaryPath.trim()) {
    sessionSummaryReadCache.delete(summaryPath);
    return;
  }
  sessionSummaryReadCache.clear();
}

export function getSessionSummaryReadCacheMeta(): {
  size: number;
} {
  return {
    size: sessionSummaryReadCache.size,
  };
}
