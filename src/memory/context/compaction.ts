import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type { CompactPostArtifacts } from "../../agents/compaction/post-compact-artifacts.js";
import { estimateTokenCount } from "../recall/token-estimate.ts";
import type { GmMessageRow, MessageRuntimeShapeBlock } from "../types/runtime.ts";

export const MIN_COMPACTION_TAIL_MESSAGES = 6;
export const MIN_COMPACTION_TEXT_MESSAGES = 5;
const COMPACTED_TRANSCRIPT_MARKER = "[compacted";

export function estimateMessageRowTokens(rows: GmMessageRow[]): number {
  return rows.reduce(
    (sum, row) => sum + estimateTokenCount(row.contentText || row.content || ""),
    0,
  );
}

function normalizeNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function rowHasTextContent(row: GmMessageRow): boolean {
  if ((row.contentText || row.content || "").trim()) {
    return true;
  }
  return (row.contentBlocks ?? []).some(
    (block) => block.type === "text" && block.text.trim().length > 0,
  );
}

function addStringValues(target: Set<string>, values?: string[] | null) {
  for (const value of values ?? []) {
    if (typeof value === "string" && value.trim()) {
      target.add(value.trim());
    }
  }
}

function getRuntimeShapeContent(row: GmMessageRow): MessageRuntimeShapeBlock[] {
  return (row.runtimeShape?.content ?? []).filter((entry): entry is MessageRuntimeShapeBlock => {
    return (
      Boolean(entry) &&
      typeof entry === "object" &&
      typeof (entry as { type?: unknown }).type === "string"
    );
  });
}

function extractToolResultIdsFromRow(row: GmMessageRow): string[] {
  const ids = new Set<string>();
  for (const block of getRuntimeShapeContent(row)) {
    const type = typeof block.type === "string" ? block.type : "";
    if (type !== "tool_result" && type !== "toolResult") {
      continue;
    }
    addStringValues(
      ids,
      [
        typeof block.tool_use_id === "string" ? block.tool_use_id : undefined,
        typeof block.toolUseId === "string" ? block.toolUseId : undefined,
      ].filter((value): value is string => typeof value === "string"),
    );
  }
  if (ids.size) {
    return [...ids];
  }
  return row.runtimeMeta?.toolResultIds ?? [];
}

function extractToolUseIdsFromRow(row: GmMessageRow): string[] {
  const ids = new Set<string>();
  for (const block of getRuntimeShapeContent(row)) {
    const type = typeof block.type === "string" ? block.type : "";
    if (type !== "toolCall" && type !== "toolUse" && type !== "functionCall") {
      continue;
    }
    if (typeof block.id === "string" && block.id.trim()) {
      ids.add(block.id.trim());
    }
  }
  if (ids.size) {
    return [...ids];
  }
  return row.runtimeMeta?.toolUseIds ?? [];
}

function extractProviderMessageIdFromRow(row: GmMessageRow): string | null {
  const messageId = row.runtimeShape?.messageId;
  if (typeof messageId === "string" && messageId.trim()) {
    return messageId.trim();
  }
  const providerMessageId = row.runtimeMeta?.providerMessageId;
  if (typeof providerMessageId === "string" && providerMessageId.trim()) {
    return providerMessageId.trim();
  }
  return null;
}

function extractDiscoveredToolNamesFromRow(row: GmMessageRow): string[] {
  const names = new Set<string>();
  const runtimeToolName = normalizeNonEmptyString(row.runtimeShape?.toolName);
  if (runtimeToolName) {
    names.add(runtimeToolName);
  }
  for (const block of getRuntimeShapeContent(row)) {
    const type = normalizeNonEmptyString(block.type);
    if (type !== "toolCall" && type !== "toolUse" && type !== "functionCall") {
      continue;
    }
    const name =
      normalizeNonEmptyString((block as { name?: unknown }).name) ??
      normalizeNonEmptyString((block as { toolName?: unknown }).toolName);
    if (name) {
      names.add(name);
    }
  }
  return [...names];
}

function collectRequiredToolUseIds(rows: GmMessageRow[], startIndex: number): Set<string> {
  const ids = new Set<string>();
  for (let index = startIndex; index < rows.length; index += 1) {
    addStringValues(ids, extractToolResultIdsFromRow(rows[index]));
  }
  return ids;
}

function collectRequiredProviderMessageIds(rows: GmMessageRow[], startIndex: number): Set<string> {
  const ids = new Set<string>();
  for (let index = startIndex; index < rows.length; index += 1) {
    const providerMessageId = extractProviderMessageIdFromRow(rows[index]);
    if (typeof providerMessageId === "string" && providerMessageId.trim()) {
      ids.add(providerMessageId.trim());
    }
  }
  return ids;
}

function findEarliestMatchingToolUseRow(
  rows: GmMessageRow[],
  beforeIndex: number,
  toolUseIds: Set<string>,
): number | null {
  if (!toolUseIds.size) {
    return null;
  }
  for (let index = 0; index < beforeIndex; index += 1) {
    const rowToolUseIds = extractToolUseIdsFromRow(rows[index]);
    if (!rowToolUseIds?.length) {
      continue;
    }
    if (rowToolUseIds.some((toolUseId) => toolUseIds.has(toolUseId))) {
      return index;
    }
  }
  return null;
}

function findEarliestMatchingProviderMessageRow(
  rows: GmMessageRow[],
  beforeIndex: number,
  providerMessageIds: Set<string>,
): number | null {
  if (!providerMessageIds.size) {
    return null;
  }
  for (let index = 0; index < beforeIndex; index += 1) {
    const providerMessageId = extractProviderMessageIdFromRow(rows[index]);
    if (
      typeof providerMessageId === "string" &&
      providerMessageId.trim() &&
      providerMessageIds.has(providerMessageId.trim())
    ) {
      return index;
    }
  }
  return null;
}

function isCompactionBoundaryRow(row: GmMessageRow): boolean {
  const text = `${row.contentText || ""}\n${row.content || ""}`.trim();
  return text.includes(COMPACTED_TRANSCRIPT_MARKER);
}

function resolveCompactionFloorIndex(params: {
  rows: GmMessageRow[];
  floorMessageId?: string | null;
  floorTurnIndex?: number | null;
}): number {
  const { rows, floorMessageId, floorTurnIndex } = params;
  let floorIndex = 0;

  const boundaryIndex = rows.findLastIndex((row) => isCompactionBoundaryRow(row));
  if (boundaryIndex >= 0) {
    floorIndex = boundaryIndex + 1;
  }

  if (typeof floorMessageId === "string" && floorMessageId.trim()) {
    const preservedIndex = rows.findIndex((row) => row.id === floorMessageId.trim());
    if (preservedIndex >= 0) {
      floorIndex = Math.max(floorIndex, preservedIndex);
    }
  } else if (typeof floorTurnIndex === "number" && floorTurnIndex > 1) {
    const preservedIndex = rows.findIndex((row) => row.turnIndex >= floorTurnIndex);
    if (preservedIndex >= 0) {
      floorIndex = Math.max(floorIndex, preservedIndex);
    }
  }

  return Math.max(0, Math.min(floorIndex, Math.max(0, rows.length - 1)));
}

function adjustStartIndexToPreserveRuntimeInvariants(
  rows: GmMessageRow[],
  startIndex: number,
  floorIndex: number,
): number {
  if (!rows.length) {
    return 0;
  }
  let nextStartIndex = Math.max(floorIndex, Math.min(startIndex, rows.length - 1));
  let changed = true;
  while (changed) {
    changed = false;
    const anchorTurn = rows[nextStartIndex]?.turnIndex;
    while (nextStartIndex > floorIndex && rows[nextStartIndex - 1]?.turnIndex === anchorTurn) {
      nextStartIndex -= 1;
      changed = true;
    }
    while (
      nextStartIndex > floorIndex &&
      (rows[nextStartIndex]?.role === "toolResult" || rows[nextStartIndex]?.role === "assistant") &&
      (rows[nextStartIndex - 1]?.role === "assistant" ||
        rows[nextStartIndex - 1]?.role === "toolResult")
    ) {
      nextStartIndex -= 1;
      changed = true;
      while (
        nextStartIndex > floorIndex &&
        rows[nextStartIndex - 1]?.turnIndex === rows[nextStartIndex]?.turnIndex
      ) {
        nextStartIndex -= 1;
      }
    }

    const requiredToolUseIds = collectRequiredToolUseIds(rows, nextStartIndex);
    const toolUseStartIndex = findEarliestMatchingToolUseRow(
      rows.slice(floorIndex),
      nextStartIndex - floorIndex,
      requiredToolUseIds,
    );
    if (toolUseStartIndex !== null && floorIndex + toolUseStartIndex < nextStartIndex) {
      nextStartIndex = floorIndex + toolUseStartIndex;
      changed = true;
      continue;
    }

    const requiredProviderMessageIds = collectRequiredProviderMessageIds(rows, nextStartIndex);
    const providerStartIndex = findEarliestMatchingProviderMessageRow(
      rows.slice(floorIndex),
      nextStartIndex - floorIndex,
      requiredProviderMessageIds,
    );
    if (providerStartIndex !== null && floorIndex + providerStartIndex < nextStartIndex) {
      nextStartIndex = floorIndex + providerStartIndex;
      changed = true;
    }
  }
  return nextStartIndex;
}

export function calculateCompactionBoundaryStartRow(params: {
  rows: GmMessageRow[];
  summarizedThroughMessageId?: string | null;
  minTokens: number;
  minTextMessages: number;
  maxTokens: number;
  floorMessageId?: string | null;
  floorTurnIndex?: number | null;
}): GmMessageRow | null {
  const {
    rows,
    summarizedThroughMessageId,
    minTokens,
    minTextMessages,
    maxTokens,
    floorMessageId,
    floorTurnIndex,
  } = params;
  if (!rows.length) {
    return null;
  }

  let summarizedIndex = rows.length - 1;
  if (typeof summarizedThroughMessageId === "string" && summarizedThroughMessageId.trim()) {
    summarizedIndex = rows.findIndex((row) => row.id === summarizedThroughMessageId);
    if (summarizedIndex === -1) {
      return null;
    }
  }

  const floorIndex = resolveCompactionFloorIndex({
    rows,
    floorMessageId,
    floorTurnIndex,
  });

  let startIndex = Math.max(floorIndex, summarizedIndex + 1);
  let totalTokens = 0;
  let textMessageCount = 0;
  for (let index = startIndex; index < rows.length; index += 1) {
    totalTokens += estimateTokenCount(rows[index]?.contentText || rows[index]?.content || "");
    if (rowHasTextContent(rows[index])) {
      textMessageCount += 1;
    }
  }

  if (startIndex >= rows.length) {
    startIndex = rows.length - 1;
    totalTokens = estimateTokenCount(
      rows[startIndex]?.contentText || rows[startIndex]?.content || "",
    );
    textMessageCount = rowHasTextContent(rows[startIndex]) ? 1 : 0;
  }

  if (totalTokens >= maxTokens) {
    return rows[adjustStartIndexToPreserveRuntimeInvariants(rows, startIndex, floorIndex)] ?? null;
  }

  if (totalTokens >= minTokens && textMessageCount >= minTextMessages) {
    return rows[adjustStartIndexToPreserveRuntimeInvariants(rows, startIndex, floorIndex)] ?? null;
  }

  for (let index = startIndex - 1; index >= floorIndex; index -= 1) {
    totalTokens += estimateTokenCount(rows[index]?.contentText || rows[index]?.content || "");
    if (rowHasTextContent(rows[index])) {
      textMessageCount += 1;
    }
    startIndex = index;

    if (totalTokens >= maxTokens) {
      break;
    }
    if (totalTokens >= minTokens && textMessageCount >= minTextMessages) {
      break;
    }
  }

  return rows[adjustStartIndexToPreserveRuntimeInvariants(rows, startIndex, floorIndex)] ?? null;
}

export function buildSessionSummaryPostCompactArtifacts(params: {
  summary: string;
  allRows: GmMessageRow[];
  keptRows: GmMessageRow[];
  planAttachmentText?: string | null;
  trigger?: string | null;
  tokensBefore: number;
  messagesSummarized: number;
  resumedWithoutBoundary?: boolean;
}): CompactPostArtifacts {
  const discoveredTools = new Set<string>();
  for (const row of params.allRows) {
    for (const toolName of extractDiscoveredToolNamesFromRow(row)) {
      discoveredTools.add(toolName);
    }
  }

  const boundaryMarker = {
    type: "system" as const,
    subtype: "compact_boundary" as const,
    content: "Conversation compacted",
    compactMetadata: {
      trigger: params.trigger === "manual" ? ("manual" as const) : ("auto" as const),
      preTokens: params.tokensBefore,
      messagesSummarized: params.messagesSummarized,
      resumedWithoutBoundary: params.resumedWithoutBoundary === true,
      ...(discoveredTools.size
        ? { preCompactDiscoveredTools: [...discoveredTools].toSorted() }
        : {}),
      ...(params.keptRows.length
        ? {
            preservedSegment: {
              headMessageId: params.keptRows[0].id,
              anchorKind: "summary_message" as const,
              anchorIndex: 0,
              tailMessageId: params.keptRows.at(-1)!.id,
            },
          }
        : {}),
    },
  };

  return {
    boundaryMarker,
    summaryMessages: [
      {
        role: "user" as const,
        subtype: "compact_summary" as const,
        content: params.summary,
        isCompactSummary: true as const,
        isVisibleInTranscriptOnly: true as const,
      },
    ],
    messagesToKeep: params.keptRows.map((row) => ({
      messageId: row.id,
      turnIndex: row.turnIndex,
      role: row.role,
    })),
    attachments: params.planAttachmentText
      ? [
          {
            type: "plan_attachment" as const,
            title: "Current Plan",
            source: "session_summary" as const,
            content: params.planAttachmentText,
          },
        ]
      : [],
  };
}

export function extractMessageAnchorId(message: unknown): string | null {
  if (!message || typeof message !== "object") {
    return null;
  }
  const record = message as Record<string, unknown>;
  if (typeof record.id === "string" && record.id) {
    return record.id;
  }
  if (typeof record.messageId === "string" && record.messageId) {
    return record.messageId;
  }
  if (record.metadata && typeof record.metadata === "object") {
    const metadata = record.metadata as Record<string, unknown>;
    if (typeof metadata.messageId === "string" && metadata.messageId) {
      return metadata.messageId;
    }
    if (typeof metadata.gmMessageId === "string" && metadata.gmMessageId) {
      return metadata.gmMessageId;
    }
  }
  if (record.message && typeof record.message === "object") {
    const nested = record.message as Record<string, unknown>;
    if (typeof nested.id === "string" && nested.id) {
      return nested.id;
    }
    if (typeof nested.messageId === "string" && nested.messageId) {
      return nested.messageId;
    }
  }
  return null;
}

export function applyCompactionStateToMessages<T>(params: {
  messages: T[];
  preservedTailStartTurn?: number | null;
  preservedTailMessageId?: string | null;
}): T[] {
  const { messages, preservedTailStartTurn, preservedTailMessageId } = params;
  if (preservedTailMessageId) {
    const anchorIndex = messages.findIndex(
      (message) => extractMessageAnchorId(message) === preservedTailMessageId,
    );
    if (anchorIndex >= 0) {
      return messages.slice(anchorIndex);
    }
  }
  if (!preservedTailStartTurn || preservedTailStartTurn <= 1) {
    return messages;
  }
  const startIndex = Math.max(0, preservedTailStartTurn - 1);
  if (startIndex >= messages.length) {
    return messages.slice(-Math.min(messages.length, MIN_COMPACTION_TAIL_MESSAGES));
  }
  return messages.slice(startIndex);
}

export function buildSessionSummaryCompactMessage(params: {
  sessionId: string;
  summaryText?: string | null;
  summarizedThroughMessageId?: string | null;
  preservedTailMessageId?: string | null;
  preservedTailStartTurn?: number | null;
  updatedAt?: number | null;
}): AgentMessage | null {
  const summary = params.summaryText?.trim();
  if (!summary) {
    return null;
  }
  const anchor =
    params.summarizedThroughMessageId?.trim() ||
    params.preservedTailMessageId?.trim() ||
    String(params.preservedTailStartTurn ?? "tail");
  return {
    id: `compact-summary:${params.sessionId}:${anchor}`,
    role: "user",
    subtype: "compact_summary",
    content: summary,
    isCompactSummary: true,
    isVisibleInTranscriptOnly: true,
    timestamp:
      typeof params.updatedAt === "number" && Number.isFinite(params.updatedAt)
        ? params.updatedAt
        : 0,
  } as AgentMessage;
}

export function prependSessionSummaryCompactMessage<T extends AgentMessage>(params: {
  sessionId: string;
  messages: T[];
  summaryText?: string | null;
  summarizedThroughMessageId?: string | null;
  preservedTailMessageId?: string | null;
  preservedTailStartTurn?: number | null;
  updatedAt?: number | null;
}): AgentMessage[] {
  const compactSummary = buildSessionSummaryCompactMessage(params);
  return compactSummary ? [compactSummary, ...params.messages] : params.messages;
}

export function isCompactedTranscriptMessage(message: AgentMessage): boolean {
  const content = (message as { content?: unknown }).content;
  if (typeof content === "string") {
    return content.includes(COMPACTED_TRANSCRIPT_MARKER);
  }
  if (Array.isArray(content)) {
    return content.some(
      (part) =>
        part &&
        typeof part === "object" &&
        "type" in part &&
        part.type === "text" &&
        typeof part.text === "string" &&
        part.text.includes(COMPACTED_TRANSCRIPT_MARKER),
    );
  }
  return false;
}

function extractTranscriptMessageText(message: AgentMessage): string {
  const content = (message as { content?: unknown }).content;
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .map((part) =>
        part &&
        typeof part === "object" &&
        "type" in part &&
        part.type === "text" &&
        typeof part.text === "string"
          ? part.text
          : "",
      )
      .filter(Boolean)
      .join("\n");
  }
  return "";
}

export function shouldRewriteTranscriptMessage(message: AgentMessage): boolean {
  const text = extractTranscriptMessageText(message).trim();
  if (!text) {
    return false;
  }
  return estimateTokenCount(text) > 12 || text.length > 48;
}

export function buildCompactedTranscriptMessage(
  message: AgentMessage,
  turnIndex: number,
): AgentMessage {
  const role = (message as { role?: string }).role ?? "message";
  const roleLabel =
    role === "user"
      ? "user message"
      : role === "assistant"
        ? "assistant message"
        : role === "toolResult"
          ? "tool result"
          : "message";
  const compactedText = `[compacted ${roleLabel} into session memory] turn=${turnIndex}`;
  const content = (message as { content?: unknown }).content;
  if (typeof content === "string") {
    return {
      ...message,
      content: compactedText,
    } as AgentMessage;
  }
  if (Array.isArray(content)) {
    return {
      ...message,
      content: [{ type: "text", text: compactedText }],
    } as AgentMessage;
  }
  return message;
}
