import { execFile as execFileCallback } from "node:child_process";
import { projectMemoryKind } from "../recall/memory-kind.ts";
import type { NotebookLmConfig } from "../types/config.ts";
import type { UnifiedRecallItem } from "../types/orchestration.ts";
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

type AnswerCardSegment = {
  title: string;
  body: string;
};

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
  return [
    {
      title: typeof record.title === "string" ? record.title : "NotebookLM answer",
      answer,
      source: typeof record.source === "string" ? record.source : undefined,
      score: typeof record.score === "number" ? record.score : undefined,
    },
  ];
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
  if (!params.config.enabled || !cli.enabled || !cli.command.trim() || !params.query.trim()) {
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

  try {
    const stdout = await new Promise<string>((resolve, reject) => {
      execFileCallback(
        cli.command,
        args,
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
        (error, nextStdout) => {
          if (error) {
            reject(error);
            return;
          }
          resolve(nextStdout);
        },
      );
    });
    const parsed = JSON.parse(stdout);
    return toEntries(parsed)
      .map((entry) => normalizeHit(entry))
      .flatMap((entry, index) => (entry ? mapHitVariants(entry, index) : []))
      .slice(0, limit);
  } catch (error) {
    params.logger?.warn(
      `[memory] notebooklm cli retrieval skipped | ${error instanceof Error ? error.message : String(error)}`,
    );
    return [];
  }
}
