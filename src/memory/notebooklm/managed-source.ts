import { execFile as execFileCallback } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { resolveStateDir } from "../../config/paths.ts";
import {
  readExperienceIndexEntries,
  type ExperienceIndexEntry,
} from "../experience/index-store.ts";
import type { NotebookLmConfig } from "../types/config.ts";
import { resolveNotebookLmDefaultCommand } from "./command.ts";
import { emitNotebookLmNotification } from "./notification.ts";
import { getNotebookLmProviderState } from "./provider-state.ts";

type RuntimeLogger = { warn(message: string): void };

type NotebookLmManagedSourceStateEntry = {
  sourceId?: string;
  notebookId: string;
  profile: string;
  title: string;
  contentHash: string;
  updatedAt: string;
};

type NotebookLmManagedSourceStateFile = {
  version: 1;
  entries: Record<string, NotebookLmManagedSourceStateEntry>;
};

type NotebookLmSourceListEntry = {
  id: string;
  title: string;
};

function formatUnknownError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  if (typeof error === "number" || typeof error === "boolean" || typeof error === "bigint") {
    return `${error}`;
  }
  if (typeof error === "symbol") {
    return error.description ? `Symbol(${error.description})` : "Symbol()";
  }
  try {
    const serialized = JSON.stringify(error);
    return typeof serialized === "string" ? serialized : "Unknown error";
  } catch {
    return "Unknown error";
  }
}

export type NotebookLmExperienceIndexSourceSyncResult = {
  status: "ok" | "no_change" | "skipped";
  action?: "create" | "replace";
  notebookId?: string;
  sourceId?: string;
  previousSourceId?: string;
  title: string;
  contentHash?: string;
  entryCount: number;
  reason?: string;
};

function clampPositiveInt(value: number, fallback: number): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(1, Math.floor(value));
}

function contentHash(content: string): string {
  return crypto.createHash("sha256").update(content).digest("hex");
}

function managedSourceStatePath(): string {
  return path.join(resolveStateDir(), "notebooklm", "managed-source-state.json");
}

function managedSourceStateKey(params: {
  profile: string;
  notebookId: string;
  title: string;
}): string {
  return crypto
    .createHash("sha256")
    .update([params.profile, params.notebookId, params.title].join("\0"))
    .digest("hex")
    .slice(0, 24);
}

async function readManagedSourceState(): Promise<NotebookLmManagedSourceStateFile> {
  try {
    const raw = await fs.readFile(managedSourceStatePath(), "utf8");
    const parsed = JSON.parse(raw) as Partial<NotebookLmManagedSourceStateFile>;
    return {
      version: 1,
      entries: parsed.entries && typeof parsed.entries === "object" ? parsed.entries : {},
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { version: 1, entries: {} };
    }
    throw error;
  }
}

async function writeManagedSourceState(state: NotebookLmManagedSourceStateFile): Promise<void> {
  const filePath = managedSourceStatePath();
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

function isRecallableEntry(entry: ExperienceIndexEntry): boolean {
  return entry.status === "active" || entry.status === "stale";
}

function compactText(value: string, maxChars: number): string {
  const collapsed = value.replace(/\s+/g, " ").trim();
  if (collapsed.length <= maxChars) {
    return collapsed;
  }
  return `${collapsed.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`;
}

function renderEntry(entry: ExperienceIndexEntry, index: number): string {
  const lines = [
    `## ${index + 1}. ${entry.title}`,
    `- id: ${entry.id}`,
    `- type: ${entry.type}`,
    `- status: ${entry.status}`,
    `- memoryKind: ${entry.memoryKind}`,
    ...(entry.dedupeKey ? [`- dedupeKey: ${entry.dedupeKey}`] : []),
    ...(entry.noteId ? [`- notebookNoteId: ${entry.noteId}`] : []),
    ...(entry.aliases.length ? [`- aliases: ${entry.aliases.join(", ")}`] : []),
    ...(entry.tags.length ? [`- tags: ${entry.tags.join(", ")}`] : []),
    "",
    `Summary: ${entry.summary}`,
    "",
    compactText(entry.content, 3_000),
  ];
  return lines.join("\n");
}

export function renderNotebookLmExperienceIndexSource(params: {
  entries: ExperienceIndexEntry[];
  title: string;
  maxEntries: number;
  maxChars: number;
}): string {
  const maxEntries = clampPositiveInt(params.maxEntries, 120);
  const maxChars = clampPositiveInt(params.maxChars, 80_000);
  const entries = params.entries.filter(isRecallableEntry).slice(0, maxEntries);
  const header = [
    `# ${params.title}`,
    "",
    "This source is managed by CrawClaw.",
    "It contains reusable experience-memory summaries, not raw chat transcripts.",
    "",
    `Entry count: ${entries.length}`,
    "",
  ].join("\n");
  const body = entries.map(renderEntry).join("\n\n---\n\n");
  return compactText(`${header}${body}`, maxChars);
}

function profileArgs(profile: string): string[] {
  return profile === "default" ? [] : ["--profile", profile];
}

async function execNotebookLmSourceCommand(params: {
  command: string;
  args: string[];
  timeoutMs: number;
}): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    execFileCallback(
      params.command,
      params.args,
      {
        timeout: params.timeoutMs,
        maxBuffer: 2 * 1024 * 1024,
        env: process.env,
      },
      (error, stdout, stderr) => {
        if (error) {
          const detail = [formatUnknownError(error), stdout, stderr]
            .filter((part) => typeof part === "string" && part.trim().length > 0)
            .join("\n");
          reject(new Error(detail));
          return;
        }
        resolve(stdout);
      },
    );
  });
}

function toSourceEntries(payload: unknown): unknown[] {
  if (Array.isArray(payload)) {
    return payload;
  }
  if (!payload || typeof payload !== "object") {
    return [];
  }
  const record = payload as Record<string, unknown>;
  const value = record.sources ?? record.items ?? record.results ?? record.data;
  return Array.isArray(value) ? value : [];
}

function normalizeSourceEntry(value: unknown): NotebookLmSourceListEntry | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const record = value as Record<string, unknown>;
  const id =
    typeof record.id === "string"
      ? record.id
      : typeof record.sourceId === "string"
        ? record.sourceId
        : "";
  const title =
    typeof record.title === "string"
      ? record.title
      : typeof record.name === "string"
        ? record.name
        : typeof record.sourceTitle === "string"
          ? record.sourceTitle
          : "";
  return id.trim() && title.trim() ? { id: id.trim(), title: title.trim() } : null;
}

async function listNotebookLmSources(params: {
  command: string;
  notebookId: string;
  profile: string;
  timeoutMs: number;
}): Promise<NotebookLmSourceListEntry[]> {
  const stdout = await execNotebookLmSourceCommand({
    command: params.command,
    args: ["source", "list", params.notebookId, "--json", ...profileArgs(params.profile)],
    timeoutMs: params.timeoutMs,
  });
  return toSourceEntries(JSON.parse(stdout))
    .map(normalizeSourceEntry)
    .filter((entry): entry is NotebookLmSourceListEntry => Boolean(entry));
}

function parseSourceIdFromAddOutput(stdout: string): string | undefined {
  try {
    const parsed = JSON.parse(stdout) as Record<string, unknown>;
    const id =
      typeof parsed.sourceId === "string"
        ? parsed.sourceId
        : typeof parsed.id === "string"
          ? parsed.id
          : undefined;
    return id?.trim() || undefined;
  } catch {
    return (
      stdout.match(/Source (?:added|created):\s*(\S+)/i)?.[1]?.trim() ??
      stdout.match(/(?:sourceId|ID):\s*(\S+)/i)?.[1]?.trim()
    );
  }
}

async function addNotebookLmSource(params: {
  command: string;
  notebookId: string;
  profile: string;
  title: string;
  content: string;
  timeoutMs: number;
}): Promise<string | undefined> {
  const waitTimeout = String(Math.max(1, Math.ceil(params.timeoutMs / 1000)));
  const stdout = await execNotebookLmSourceCommand({
    command: params.command,
    args: [
      "source",
      "add",
      params.notebookId,
      "--text",
      params.content,
      "--title",
      params.title,
      "--wait",
      "--wait-timeout",
      waitTimeout,
      ...profileArgs(params.profile),
    ],
    timeoutMs: params.timeoutMs,
  });
  return parseSourceIdFromAddOutput(stdout);
}

async function deleteNotebookLmSource(params: {
  command: string;
  sourceId: string;
  profile: string;
  timeoutMs: number;
}): Promise<void> {
  await execNotebookLmSourceCommand({
    command: params.command,
    args: ["source", "delete", params.sourceId, "--confirm", ...profileArgs(params.profile)],
    timeoutMs: params.timeoutMs,
  });
}

function findCreatedSource(params: {
  before: NotebookLmSourceListEntry[];
  after: NotebookLmSourceListEntry[];
  title: string;
  parsedSourceId?: string;
}): NotebookLmSourceListEntry | null {
  if (params.parsedSourceId) {
    const parsed = params.after.find((entry) => entry.id === params.parsedSourceId);
    if (parsed) {
      return parsed;
    }
  }
  const beforeIds = new Set(params.before.map((entry) => entry.id));
  const created = params.after.find(
    (entry) => entry.title === params.title && !beforeIds.has(entry.id),
  );
  if (created) {
    return created;
  }
  return params.after.find((entry) => entry.title === params.title) ?? null;
}

export async function syncNotebookLmExperienceIndexSourceViaCli(params: {
  config?: NotebookLmConfig;
  entries?: ExperienceIndexEntry[];
  logger?: RuntimeLogger;
  notificationScope?: {
    agentId?: string | null;
    channel?: string | null;
    userId?: string | null;
  };
}): Promise<NotebookLmExperienceIndexSourceSyncResult | null> {
  const sourceConfig = params.config?.source;
  if (!params.config?.enabled || !sourceConfig?.enabled) {
    return null;
  }
  const title = sourceConfig.title.trim() || "CrawClaw Memory Index";
  const entries =
    params.entries ??
    (await readExperienceIndexEntries(sourceConfig.maxEntries, { recallableOnly: true }));
  const recallableEntries = entries.filter(isRecallableEntry).slice(0, sourceConfig.maxEntries);
  if (!recallableEntries.length) {
    return { status: "skipped", title, entryCount: 0, reason: "empty_index" };
  }

  const profile = (params.config.auth.profile || "default").trim() || "default";
  const content = renderNotebookLmExperienceIndexSource({
    entries: recallableEntries,
    title,
    maxEntries: sourceConfig.maxEntries,
    maxChars: sourceConfig.maxChars,
  });
  const hash = contentHash(content);
  const stateFile = await readManagedSourceState();
  const configuredNotebookId = (
    params.config.write.notebookId ||
    params.config.cli.notebookId ||
    ""
  ).trim();
  if (configuredNotebookId) {
    const configuredKey = managedSourceStateKey({
      profile,
      notebookId: configuredNotebookId,
      title,
    });
    const configuredPrevious = stateFile.entries[configuredKey];
    if (configuredPrevious?.contentHash === hash && configuredPrevious.sourceId) {
      return {
        status: "no_change",
        title,
        notebookId: configuredNotebookId,
        sourceId: configuredPrevious.sourceId,
        contentHash: hash,
        entryCount: recallableEntries.length,
      };
    }
  }

  const state = await getNotebookLmProviderState({
    config: params.config,
    mode: "write",
    logger: params.logger,
  });
  if (!state.ready) {
    if (params.logger) {
      emitNotebookLmNotification({
        state,
        logger: params.logger,
        scope: {
          source: "write",
          agentId: params.notificationScope?.agentId,
          channel: params.notificationScope?.channel,
          userId: params.notificationScope?.userId,
        },
      });
    }
    return {
      status: "skipped",
      title,
      entryCount: recallableEntries.length,
      reason: state.reason ?? "provider_not_ready",
    };
  }

  const notebookId =
    state.notebookId ??
    (params.config.write.notebookId || params.config.cli.notebookId || "").trim();
  const key = managedSourceStateKey({ profile, notebookId, title });
  const previous = stateFile.entries[key];
  if (previous?.contentHash === hash && previous.sourceId) {
    return {
      status: "no_change",
      title,
      notebookId,
      sourceId: previous.sourceId,
      contentHash: hash,
      entryCount: recallableEntries.length,
    };
  }

  const command = resolveNotebookLmDefaultCommand();
  const before = await listNotebookLmSources({
    command,
    notebookId,
    profile,
    timeoutMs: sourceConfig.timeoutMs,
  });
  const parsedSourceId = await addNotebookLmSource({
    command,
    notebookId,
    profile,
    title,
    content,
    timeoutMs: sourceConfig.timeoutMs,
  });
  const after = await listNotebookLmSources({
    command,
    notebookId,
    profile,
    timeoutMs: sourceConfig.timeoutMs,
  });
  const created = findCreatedSource({ before, after, title, parsedSourceId });
  const previousSourceId = previous?.sourceId;
  if (
    sourceConfig.deletePrevious &&
    previousSourceId &&
    created?.id &&
    previousSourceId !== created.id
  ) {
    await deleteNotebookLmSource({
      command,
      sourceId: previousSourceId,
      profile,
      timeoutMs: sourceConfig.timeoutMs,
    });
  }

  stateFile.entries[key] = {
    ...(created?.id ? { sourceId: created.id } : {}),
    notebookId,
    profile,
    title,
    contentHash: hash,
    updatedAt: new Date().toISOString(),
  };
  await writeManagedSourceState(stateFile);
  return {
    status: "ok",
    action: previousSourceId && previousSourceId !== created?.id ? "replace" : "create",
    title,
    notebookId,
    sourceId: created?.id,
    previousSourceId,
    contentHash: hash,
    entryCount: recallableEntries.length,
  };
}
