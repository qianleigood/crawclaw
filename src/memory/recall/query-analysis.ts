import type { RecallQueryAnalysis, RecallQueryShape } from "../types/recall.ts";

interface RecallRoutingThreshold {
  maxRawChars: number;
  maxEffectiveTokens: number;
  maxExpandedTokens: number;
  maxEstimatedClauses: number;
}

export interface RecallRoutingConfig {
  fts: RecallRoutingThreshold & {
    maxQueryTokens: number;
  };
  hybrid: RecallRoutingThreshold & {
    vectorTopK: number;
    ftsTopK: number;
    rerankTopK: number;
  };
  vector: {
    topK: number;
  };
  avgExpansionPerToken: number;
  fieldCount: number;
  entityHintLimit: number;
}

const DEFAULT_STOPWORDS = new Set([
  "the", "and", "for", "with", "this", "that", "from", "into", "about",
  "error", "issue", "problem", "failed", "failure", "query", "node", "nodes",
  "plugin", "plugins", "gateway", "session", "chat", "history", "dispatch",
  "received", "message", "messages", "recalled", "knowledge", "execution", "nodes", "edges",
  "一个", "这个", "那个", "一下", "就是", "然后", "因为", "问题", "报错",
]);

function stripHighNoiseLogText(input: string): string {
  return input
    .replace(/\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?\b/g, " ")
    .replace(/\b\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\b/g, " ")
    .replace(/\b(?:pid|runId|conn|session|requestId|messageId|jobId|traceId|spanId)=\S+\b/gi, " ")
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, " ")
    .replace(/\b[0-9a-f]{16,}\b/gi, " ")
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/\b(?:DEBUG|INFO|WARN|WARNING|ERROR|TRACE|FATAL)\b/gi, " ");
}

export function normalizeRecallText(input: string): string {
  return stripHighNoiseLogText(input)
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function tokenizeRecallText(input: string): string[] {
  return input.match(/[A-Za-z0-9._:/-]+|[\u4e00-\u9fff]{2,}/g) ?? [];
}

function isNoiseToken(token: string): boolean {
  const t = token.toLowerCase();
  if (t.length <= 1) {return true;}
  if (/^\d+$/.test(t)) {return true;}
  if (/^[0-9a-f]{6,}$/i.test(t)) {return true;}
  if (/^(true|false|null|undefined)$/i.test(t)) {return true;}
  if (/^\d+(ms|s|m|h|kb|mb|gb)$/i.test(t)) {return true;}
  if (/^(chat|send|history|status|config|get|poll|reply|replies|queuedfinal)$/i.test(t)) {return true;}
  if (/^(received|dispatch|complete|running|active|loaded|ready|missing|scope)$/i.test(t)) {return true;}
  if (DEFAULT_STOPWORDS.has(t)) {return true;}
  return false;
}

function toEffectiveTokens(tokens: string[]): string[] {
  return tokens.filter((token) => !isNoiseToken(token));
}

function extractEntityHints(tokens: string[], maxHints: number): string[] {
  const hints = new Set<string>();
  for (const token of tokens) {
    if (isNoiseToken(token)) {continue;}
    if (
      token.includes("/")
      || token.includes("-")
      || token.includes(":")
      || /\.(md|ts|js|json|yaml|yml|sql|tsx)$/.test(token)
      || /[A-Z][a-zA-Z]+/.test(token)
      || /[A-Za-z]+\d+[A-Za-z\d]*/.test(token)
      || /(?:Exception|Error|Timeout|Traceback|Neo4j|Qdrant|Lucene|CrawClaw)/i.test(token)
    ) {
      hints.add(token);
    }
  }
  return [...hints].slice(0, maxHints);
}

function pickMatches(input: string, pattern: RegExp, limit: number): string[] {
  const matches = new Set<string>();
  for (const match of input.matchAll(pattern)) {
    const value = (match[1] ?? match[0] ?? "").trim();
    if (!value) {continue;}
    matches.add(value);
    if (matches.size >= limit) {break;}
  }
  return [...matches];
}

function extractStructuredLogSignals(normalizedText: string, effectiveTokens: string[]) {
  const extractedExceptions = pickMatches(normalizedText, /\b((?:TooManyNestedClauses)|[A-Z][A-Za-z0-9]*(?:Exception|Error|Timeout|Failure|Traceback))\b/g, 4);
  const extractedProcedures = pickMatches(normalizedText, /\b((?:db\.index\.fulltext\.queryNodes|[A-Za-z_][A-Za-z0-9_.]*\([^)]*\)|[A-Za-z_][A-Za-z0-9_.]*\.[A-Za-z_][A-Za-z0-9_.]*))\b/g, 4)
    .filter((value) => /queryNodes|fulltext|search|recall|extract|sync|backfill|neo4j|qdrant/i.test(value));
  const extractedComponents = effectiveTokens
    .filter((token) => /memory-runtime|memory|lucene|crawclaw|execution|recall|fulltext/i.test(token))
    .slice(0, 4);
  const extractedSymptoms = [
    ...pickMatches(normalizedText, /\b(maxClauseCount(?:\s*(?:is set to|=)\s*\d+)?)\b/gi, 2),
    ...pickMatches(normalizedText, /\b(recall failed|query failed|clause(?:s)? overflow|too many nested clauses)\b/gi, 3),
  ].slice(0, 4);
  return {
    extractedComponents: [...new Set(extractedComponents)],
    extractedExceptions,
    extractedProcedures,
    extractedSymptoms: [...new Set(extractedSymptoms.map((item) => item.toLowerCase()))],
  };
}

function detectShape(input: {
  rawLength: number;
  lineCount: number;
  effectiveTokenCount: number;
  hasStackTraceLikeText: boolean;
  hasQuotedLogBlock: boolean;
}): RecallQueryShape {
  const { rawLength, lineCount, effectiveTokenCount, hasStackTraceLikeText, hasQuotedLogBlock } = input;
  if (rawLength <= 80 && lineCount <= 2 && effectiveTokenCount <= 8 && !hasStackTraceLikeText && !hasQuotedLogBlock) {
    return "keyword";
  }
  if (rawLength > 220 || lineCount > 6 || hasStackTraceLikeText || hasQuotedLogBlock) {
    return "narrative";
  }
  return "mixed";
}

function estimateClauseCount(input: {
  effectiveTokenCount: number;
  entityHintCount: number;
  fieldCount: number;
  avgExpansionPerToken: number;
  hasNarrativeShape: boolean;
  hasErrorLikeText: boolean;
  hasStackTraceLikeText: boolean;
}): number {
  const { effectiveTokenCount, entityHintCount, fieldCount, avgExpansionPerToken, hasNarrativeShape, hasErrorLikeText, hasStackTraceLikeText } = input;
  let base = effectiveTokenCount * fieldCount * avgExpansionPerToken;
  base -= Math.min(entityHintCount * 2, base * 0.15);
  if (hasNarrativeShape) {base *= 1.25;}
  if (hasErrorLikeText) {base *= 1.15;}
  if (hasStackTraceLikeText) {base *= 1.25;}
  return Math.ceil(base);
}

export function analyzeRecallQuery(raw: string, routing: RecallRoutingConfig): RecallQueryAnalysis {
  const normalizedText = normalizeRecallText(raw);
  const tokens = tokenizeRecallText(normalizedText);
  const effectiveTokens = toEffectiveTokens(tokens);
  const entityHints = extractEntityHints(effectiveTokens, routing.entityHintLimit);
  const { extractedComponents, extractedExceptions, extractedProcedures, extractedSymptoms } = extractStructuredLogSignals(normalizedText, effectiveTokens);
  const lineCount = normalizedText ? normalizedText.split("\n").length : 0;

  const hasCodeLikeText = /[{}();=<>]/.test(normalizedText) || /\b(function|const|let|class|return|if|else)\b/.test(normalizedText);
  const hasStackTraceLikeText = /\bat\s+\S+\s+\(/.test(normalizedText) || /Traceback|Exception|Caused by:/i.test(normalizedText);
  const hasPathLikeText = /\/[A-Za-z0-9._/-]+/.test(normalizedText) || /[A-Za-z0-9._-]+\.(ts|js|md|json|yaml|yml)/.test(normalizedText);
  const hasErrorLikeText = /error|failed|exception|timeout|panic|trace/i.test(normalizedText);
  const hasQuotedLogBlock = normalizedText.includes("```") || lineCount > 8;
  const shape = detectShape({
    rawLength: raw.length,
    lineCount,
    effectiveTokenCount: effectiveTokens.length,
    hasStackTraceLikeText,
    hasQuotedLogBlock,
  });

  const expandedTokens = effectiveTokens.slice(0, routing.hybrid.maxExpandedTokens);
  const estimatedClauseCount = estimateClauseCount({
    effectiveTokenCount: effectiveTokens.length,
    entityHintCount: entityHints.length,
    fieldCount: routing.fieldCount,
    avgExpansionPerToken: routing.avgExpansionPerToken,
    hasNarrativeShape: shape === "narrative",
    hasErrorLikeText,
    hasStackTraceLikeText,
  });

  return {
    rawText: raw,
    normalizedText,
    rawLength: raw.length,
    lineCount,
    tokens,
    effectiveTokens,
    expandedTokens,
    tokenCount: tokens.length,
    effectiveTokenCount: effectiveTokens.length,
    expandedTokenCount: expandedTokens.length,
    uniqueTokenCount: new Set(effectiveTokens.map((token) => token.toLowerCase())).size,
    avgTokenLength: effectiveTokens.length
      ? effectiveTokens.reduce((sum, token) => sum + token.length, 0) / effectiveTokens.length
      : 0,
    hasCodeLikeText,
    hasStackTraceLikeText,
    hasPathLikeText,
    hasErrorLikeText,
    hasQuotedLogBlock,
    entityHints,
    extractedComponents,
    extractedExceptions,
    extractedProcedures,
    extractedSymptoms,
    shape,
    estimatedClauseCount,
  };
}
