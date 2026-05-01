import { execFile as execFileCallback } from "node:child_process";
import { projectMemoryKind } from "../recall/memory-kind.ts";
import type { NotebookLmConfig } from "../types/config.ts";
import type { UnifiedRecallItem } from "../types/orchestration.ts";
import { isNotebookLmNlmCommand, resolveNotebookLmCliCommand } from "./command.js";
import { emitNotebookLmNotification } from "./notification.ts";
import { getNotebookLmProviderState } from "./provider-state.ts";

type RuntimeLogger = { warn(message: string): void };

type RawNotebookLmHit = {
  id?: string;
  title?: string;
  name?: string;
  notebook?: string;
  notebookId?: string;
  notebookName?: string;
  source?: string;
  sourceId?: string;
  sourceTitle?: string;
  path?: string;
  url?: string;
  summary?: string;
  preview?: string;
  snippet?: string;
  answer?: string;
  text?: string;
  content?: string;
  score?: number;
  relevance?: number;
  kind?: string;
  memoryKind?: string;
  tags?: string[];
};

type RawNotebookLmNote = {
  id?: string;
  title?: string;
  content?: string;
  preview?: string;
  summary?: string;
  text?: string;
  notebookId?: string;
  updatedAt?: string;
  createdAt?: string;
};

type AnswerCardSegment = {
  title: string;
  body: string;
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

function normalizeMemoryKind(
  value: string | undefined,
): "preference" | "decision" | "procedure" | "runtime_pattern" | "reference" | undefined {
  if (
    value === "preference" ||
    value === "decision" ||
    value === "procedure" ||
    value === "runtime_pattern" ||
    value === "reference"
  ) {
    return value;
  }
  return undefined;
}

function renderTemplate(
  value: string,
  params: { query: string; limit: number; notebookId?: string; profile: string },
): string {
  return value
    .replaceAll("{query}", params.query)
    .replaceAll("{limit}", String(params.limit))
    .replaceAll("{notebookId}", params.notebookId ?? "")
    .replaceAll("{profile}", params.profile);
}

function profileArgs(profile: string): string[] {
  return profile === "default" ? [] : ["--profile", profile];
}

function buildNotebookLmQuery(query: string, instruction: string | undefined): string {
  const cleanQuery = query.trim();
  const cleanInstruction = (instruction ?? "").trim();
  if (!cleanInstruction) {
    return cleanQuery;
  }
  return [cleanInstruction, "", `当前问题：${cleanQuery}`].join("\n");
}

function toEntries(payload: unknown): unknown[] {
  if (Array.isArray(payload)) {
    return payload;
  }
  if (!payload || typeof payload !== "object") {
    return [];
  }
  const record = payload as Record<string, unknown>;
  if (record.value && typeof record.value === "object" && !Array.isArray(record.value)) {
    return toEntries(record.value);
  }
  const candidate = record.results ?? record.items ?? record.hits ?? record.sources ?? record.data;
  if (Array.isArray(candidate)) {
    return candidate;
  }
  const answer = [record.answer, record.response, record.text, record.content].find(
    (value): value is string => typeof value === "string" && value.trim().length > 0,
  );
  if (!answer) {
    return [];
  }
  const sourcesUsed = Array.isArray(record.sources_used)
    ? record.sources_used.filter(
        (value): value is string => typeof value === "string" && value.trim().length > 0,
      )
    : [];
  return [
    {
      title: typeof record.title === "string" ? record.title : "NotebookLM answer",
      answer,
      source: typeof record.source === "string" ? record.source : undefined,
      sourceId: typeof record.sourceId === "string" ? record.sourceId : sourcesUsed[0],
      score: typeof record.score === "number" ? record.score : undefined,
    },
  ];
}

function toNoteEntries(payload: unknown): unknown[] {
  if (Array.isArray(payload)) {
    return payload;
  }
  if (!payload || typeof payload !== "object") {
    return [];
  }
  const record = payload as Record<string, unknown>;
  const candidate = record.notes ?? record.items ?? record.results ?? record.data;
  return Array.isArray(candidate) ? candidate : [];
}

function normalizeHit(raw: unknown): RawNotebookLmHit | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const record = raw as Record<string, unknown>;
  const tags = Array.isArray(record.tags)
    ? record.tags.filter(
        (value): value is string => typeof value === "string" && value.trim().length > 0,
      )
    : undefined;
  return {
    id: typeof record.id === "string" ? record.id : undefined,
    title: typeof record.title === "string" ? record.title : undefined,
    name: typeof record.name === "string" ? record.name : undefined,
    notebook: typeof record.notebook === "string" ? record.notebook : undefined,
    notebookId: typeof record.notebookId === "string" ? record.notebookId : undefined,
    notebookName: typeof record.notebookName === "string" ? record.notebookName : undefined,
    source: typeof record.source === "string" ? record.source : undefined,
    sourceId: typeof record.sourceId === "string" ? record.sourceId : undefined,
    sourceTitle: typeof record.sourceTitle === "string" ? record.sourceTitle : undefined,
    path: typeof record.path === "string" ? record.path : undefined,
    url: typeof record.url === "string" ? record.url : undefined,
    summary: typeof record.summary === "string" ? record.summary : undefined,
    preview: typeof record.preview === "string" ? record.preview : undefined,
    snippet: typeof record.snippet === "string" ? record.snippet : undefined,
    answer: typeof record.answer === "string" ? record.answer : undefined,
    text: typeof record.text === "string" ? record.text : undefined,
    content: typeof record.content === "string" ? record.content : undefined,
    score: typeof record.score === "number" ? record.score : undefined,
    relevance: typeof record.relevance === "number" ? record.relevance : undefined,
    kind: typeof record.kind === "string" ? record.kind : undefined,
    memoryKind: typeof record.memoryKind === "string" ? record.memoryKind : undefined,
    tags,
  };
}

function normalizeNote(raw: unknown): RawNotebookLmNote | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const record = raw as Record<string, unknown>;
  const id =
    typeof record.id === "string"
      ? record.id
      : typeof record.noteId === "string"
        ? record.noteId
        : undefined;
  const title =
    typeof record.title === "string"
      ? record.title
      : typeof record.name === "string"
        ? record.name
        : undefined;
  if (!id || !title) {
    return null;
  }
  return {
    id,
    title,
    content: typeof record.content === "string" ? record.content : undefined,
    preview: typeof record.preview === "string" ? record.preview : undefined,
    summary: typeof record.summary === "string" ? record.summary : undefined,
    text: typeof record.text === "string" ? record.text : undefined,
    notebookId: typeof record.notebookId === "string" ? record.notebookId : undefined,
    updatedAt: typeof record.updatedAt === "string" ? record.updatedAt : undefined,
    createdAt: typeof record.createdAt === "string" ? record.createdAt : undefined,
  };
}

function splitNotebookLmAnswerCards(value: string | undefined): AnswerCardSegment[] {
  const cleaned = stripNotebookLmArtifacts(value);
  if (!cleaned) {
    return [];
  }
  const matches = [...cleaned.matchAll(/经验卡片([一二三四五六七八九十\d]+)：/gu)];
  if (matches.length === 0) {
    return [];
  }
  const segments: AnswerCardSegment[] = [];
  for (let index = 0; index < matches.length; index += 1) {
    const match = matches[index];
    const start = match.index ?? 0;
    const bodyStart = start + match[0].length;
    const nextStart = matches[index + 1]?.index ?? cleaned.length;
    const rawSegment = cleaned.slice(bodyStart, nextStart).trim();
    const titlePrefix = cleaned.slice(start, bodyStart).trim().replace(/：$/u, "");
    const titleCandidateMatch = rawSegment.match(/^([^\s。！？!?；;]{1,24})\s+(.+)$/u);
    const titleSuffix = titleCandidateMatch?.[1]?.trim();
    const body = (titleCandidateMatch?.[2] ?? rawSegment).trim();
    const title = titleSuffix ? `${titlePrefix}：${titleSuffix}` : titlePrefix;
    if (!body) {
      continue;
    }
    segments.push({ title, body });
  }
  return segments;
}

function compactText(value: string | undefined, maxChars: number): string {
  const normalized = (value ?? "").replace(/\s+/g, " ").trim();
  if (!normalized) {
    return "";
  }
  return normalized.length <= maxChars
    ? normalized
    : `${normalized.slice(0, maxChars - 1).trimEnd()}…`;
}

function stripNotebookLmArtifacts(value: string | undefined): string {
  return (value ?? "")
    .replace(/\[\d+(?:-\d+)?(?:,\s*\d+(?:-\d+)?)*\]/g, "")
    .replace(/\*\*/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function isTransientNotebookLmApiError(message: string): boolean {
  return /API error \(code 7\)|google\.rpc\.ErrorInfo/i.test(message);
}

async function waitForNotebookLmRetry(attempt: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, attempt * 500));
}

function extractShortChineseCardText(value: string | undefined, maxChars: number): string {
  const cleaned = stripNotebookLmArtifacts(value);
  if (!cleaned) {
    return "";
  }
  const sentences = cleaned
    .split(/(?<=[。！？!?；;])/u)
    .map((part) => part.trim())
    .filter(Boolean);
  if (sentences.length === 0) {
    return compactText(cleaned, maxChars);
  }
  const selected: string[] = [];
  let total = 0;
  for (const sentence of sentences) {
    if (selected.length >= 4) {
      break;
    }
    const next = sentence.length;
    if (selected.length > 0 && total + next > maxChars) {
      break;
    }
    selected.push(sentence);
    total += next;
  }
  const joined = selected.join(" ");
  return compactText(joined || cleaned, maxChars);
}

function mapHit(raw: RawNotebookLmHit, rank: number): UnifiedRecallItem {
  const title =
    raw.title ??
    raw.name ??
    raw.sourceTitle ??
    raw.notebookName ??
    raw.notebook ??
    `NotebookLM result ${rank + 1}`;
  const summary = extractShortChineseCardText(
    raw.summary ?? raw.preview ?? raw.snippet ?? raw.answer ?? raw.text ?? raw.content,
    220,
  );
  const content =
    extractShortChineseCardText(
      raw.answer ?? raw.text ?? raw.content ?? raw.snippet ?? raw.preview ?? raw.summary,
      520,
    ) || undefined;
  const retrievalScore = raw.score ?? raw.relevance ?? Math.max(0.1, 1 - rank * 0.04);
  const sourceRef = raw.url ?? raw.path ?? raw.sourceId ?? raw.id;
  const memoryKind = projectMemoryKind({
    source: "notebooklm",
    title,
    summary,
    content,
    memoryKind: normalizeMemoryKind(raw.memoryKind),
    metadata: {
      tags: raw.tags ?? [],
      notebook: raw.notebookName ?? raw.notebook,
      kind: raw.kind,
    },
  });
  return {
    id: `notebooklm:${raw.id ?? raw.sourceId ?? rank + 1}`,
    source: "notebooklm",
    title,
    summary,
    content,
    memoryKind,
    retrievalScore,
    importance: 0.72,
    canonicalKey: sourceRef ?? title,
    sourceRef,
    metadata: {
      notebook: raw.notebookName ?? raw.notebook,
      notebookId: raw.notebookId,
      source: raw.source,
      sourceId: raw.sourceId,
      sourceTitle: raw.sourceTitle,
      path: raw.path,
      url: raw.url,
      kind: raw.kind,
      tags: raw.tags ?? [],
    },
  };
}

function noteMatchesQuery(note: RawNotebookLmNote, query: string): boolean {
  const normalizedQuery = query.toLocaleLowerCase().trim();
  if (!normalizedQuery) {
    return false;
  }
  const haystack = [note.id, note.title, note.content, note.preview, note.summary, note.text]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .join(" ")
    .toLocaleLowerCase();
  if (haystack.includes(normalizedQuery)) {
    return true;
  }
  const tokens = normalizedQuery.split(/\s+/).filter((token) => token.length >= 2);
  return tokens.some((token) => haystack.includes(token));
}

function mapNote(note: RawNotebookLmNote, rank: number, notebookId: string): UnifiedRecallItem {
  const title = note.title ?? `NotebookLM note ${rank + 1}`;
  const content =
    extractShortChineseCardText(note.content ?? note.text ?? note.preview ?? note.summary, 520) ||
    undefined;
  const summary =
    extractShortChineseCardText(note.summary ?? note.preview ?? note.content ?? note.text, 220) ||
    title;
  const memoryKind = projectMemoryKind({
    source: "notebooklm",
    title,
    summary,
    content,
    metadata: {
      kind: "note",
    },
  });
  return {
    id: `notebooklm:note:${note.id ?? rank + 1}`,
    source: "notebooklm",
    title,
    summary,
    content,
    memoryKind,
    retrievalScore: Math.max(0.1, 0.7 - rank * 0.04),
    importance: 0.68,
    canonicalKey: note.id ?? note.title ?? `note-${rank + 1}`,
    sourceRef: note.id,
    metadata: {
      notebookId: note.notebookId ?? notebookId,
      source: "notebooklm_note",
      sourceId: note.id,
      kind: "note",
      tags: [],
    },
  };
}

function mapHitVariants(raw: RawNotebookLmHit, rank: number): UnifiedRecallItem[] {
  const cardSegments = splitNotebookLmAnswerCards(
    raw.answer ?? raw.text ?? raw.content ?? raw.summary,
  );
  if (cardSegments.length <= 1) {
    return [mapHit(raw, rank)];
  }
  return cardSegments.map((segment, index) =>
    mapHit(
      {
        ...raw,
        id: `${raw.id ?? raw.sourceId ?? rank + 1}:card:${index + 1}`,
        title: segment.title,
        summary: segment.body,
        answer: segment.body,
        text: segment.body,
        content: segment.body,
      },
      rank + index,
    ),
  );
}

export async function searchNotebookLmViaCli(params: {
  config: NotebookLmConfig;
  query: string;
  limit?: number;
  logger?: RuntimeLogger;
  notificationScope?: {
    agentId?: string | null;
    channel?: string | null;
    userId?: string | null;
  };
}): Promise<UnifiedRecallItem[]> {
  const cli = params.config.cli;
  const command = resolveNotebookLmCliCommand(cli.command);
  if (!params.config.enabled || !cli.enabled || !command.trim() || !params.query.trim()) {
    return [];
  }
  const limit = Math.max(1, Math.min(params.limit ?? cli.limit, 10));
  const renderedQuery = buildNotebookLmQuery(params.query, cli.queryInstruction);
  const state = await getNotebookLmProviderState({
    config: params.config,
    mode: "query",
    logger: params.logger,
  });
  if (!state.ready) {
    if (params.logger) {
      emitNotebookLmNotification({
        state,
        logger: params.logger,
        scope: {
          source: "query",
          agentId: params.notificationScope?.agentId,
          channel: params.notificationScope?.channel,
          userId: params.notificationScope?.userId,
        },
      });
    }
    params.logger?.warn(
      `[memory] notebooklm cli retrieval skipped | reason=${state.reason ?? "unknown"}${state.details ? ` | ${state.details}` : ""}${
        state.recommendedAction ? ` | next=${state.recommendedAction}` : ""
      }`,
    );
    return [];
  }
  const notebookId = state.notebookId ?? cli.notebookId ?? "";
  const args = cli.args.map((value) =>
    renderTemplate(value, {
      query: renderedQuery,
      limit,
      notebookId,
      profile: (params.config.auth.profile || "default").trim() || "default",
    }),
  );

  const execNotebookLmCommand = async (commandArgs: string[]) => {
    const maxAttempts = 3;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        return await new Promise<string>((resolve, reject) => {
          execFileCallback(
            command,
            commandArgs,
            {
              timeout: cli.timeoutMs,
              maxBuffer: 1024 * 1024,
              env: {
                ...process.env,
                NOTEBOOKLM_QUERY: renderedQuery,
                NOTEBOOKLM_LIMIT: String(limit),
                NOTEBOOKLM_NOTEBOOK_ID: notebookId,
              },
            },
            (error, nextStdout, nextStderr) => {
              if (error) {
                const detail = [formatUnknownError(error), nextStdout, nextStderr]
                  .filter((value) => typeof value === "string" && value.trim().length > 0)
                  .join("\n");
                reject(new Error(detail));
                return;
              }
              resolve(nextStdout);
            },
          );
        });
      } catch (error) {
        const message = formatUnknownError(error);
        if (attempt < maxAttempts && isTransientNotebookLmApiError(message)) {
          await waitForNotebookLmRetry(attempt);
          continue;
        }
        throw error;
      }
    }
    throw new Error("NotebookLM command failed");
  };

  const profile = (params.config.auth.profile || "default").trim() || "default";
  const searchNotes = async (): Promise<UnifiedRecallItem[]> => {
    if (!isNotebookLmNlmCommand(command)) {
      return [];
    }
    const stdout = await execNotebookLmCommand([
      "note",
      "list",
      notebookId,
      "--json",
      ...profileArgs(profile),
    ]);
    return toNoteEntries(JSON.parse(stdout))
      .map(normalizeNote)
      .filter((entry): entry is RawNotebookLmNote => Boolean(entry))
      .filter((entry) => noteMatchesQuery(entry, params.query))
      .map((entry, index) => mapNote(entry, index, notebookId))
      .slice(0, limit);
  };

  try {
    const stdout = await execNotebookLmCommand(args);
    const parsed = JSON.parse(stdout);
    const queryItems = toEntries(parsed)
      .map((entry) => normalizeHit(entry))
      .flatMap((entry, index) => (entry ? mapHitVariants(entry, index) : []))
      .slice(0, limit);
    if (queryItems.length > 0) {
      return queryItems;
    }
  } catch (error) {
    params.logger?.warn(`[memory] notebooklm cli retrieval skipped | ${formatUnknownError(error)}`);
  }
  try {
    return await searchNotes();
  } catch (error) {
    params.logger?.warn(
      `[memory] notebooklm note retrieval skipped | ${formatUnknownError(error)}`,
    );
    return [];
  }
}
