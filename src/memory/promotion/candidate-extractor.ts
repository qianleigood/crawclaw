import type { MessageBlock } from "../types/media.ts";
import { normalizeMessageContent } from "../util/message.ts";
import type {
  CandidateExtractorInput,
  CandidateExtractorResult,
  PromotionCandidateDraft,
  PromotionCandidateKind,
  PromotionCandidateMediaItem,
  PromotionCandidatePayload,
  PromotionMessageLike,
  PromotionRecallTraceLike,
  PromotionSourceRef,
} from "./types.ts";
import {
  inferPromotionDurableMemoryType,
  inferPromotionMemoryBucket,
  projectPromotionCandidateMemoryKind,
} from "./types.ts";

const DURABLE_CUE_RE =
  /(结论|决定|约定|统一|定位|原则|规则|方案|策略|要求|必须|不要|优先|默认|下一步|待办|原因|修复|验证|风险|兼容|迁移|建议|采用|改为|保留|明确|should|must|prefer|default|next step|todo|root cause|fix|resolved|verify|decision|plan|policy|architecture|summary)/i;
const PROCEDURE_CUE_RE =
  /(步骤|流程|检查|排查|执行|运行|验证|重启|恢复|修复|迁移|回滚|切换|配置|install|run|restart|verify|recover|apply|patch)/i;
const DECISION_CUE_RE =
  /(结论|决定|约定|统一|定位|原则|规则|默认|优先|明确|保留|改为|方案|policy|decision|architecture|direction)/i;
const CHATTER_RE = /^(收到|好的|ok|okay|thanks|谢谢|辛苦了|哈哈|嗯嗯|在吗|hello|hi)[!！。. ]*$/i;
const STRIP_PREFIX_RE = /^\s*(?:[-*•]|\d+[.)、])\s*/;
const MAX_EXCERPT = 180;

interface FactLine {
  text: string;
  score: number;
  role: string;
  refId: string;
  turnIndex?: number;
  createdAt?: number;
  reason: string;
}

interface MediaSupportSummary {
  primaryMediaId: string | null;
  mediaIds: string[];
  mediaItems: PromotionCandidateMediaItem[];
  visualSummary?: string;
  evidenceMode: "text" | "image" | "multimodal";
}

interface ParsedRecallSupport {
  query?: string;
  score: number;
  ref?: PromotionSourceRef;
}

function clip(text: string, limit = MAX_EXCERPT): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= limit) {
    return normalized;
  }
  return `${normalized.slice(0, limit - 1)}…`;
}

function cleanLine(line: string): string {
  return line
    .replace(STRIP_PREFIX_RE, "")
    .replace(/^#+\s*/, "")
    .replace(/[`*_~]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function splitIntoLines(text: string): string[] {
  return text
    .split(/\n+/)
    .flatMap((line) => line.split(/(?<=[。！？!?；;])\s+/))
    .map((line) => cleanLine(line))
    .filter(Boolean);
}

function scoreFactLine(line: string, role: string): { score: number; reason: string } {
  let score = 0;
  const reasons: string[] = [];

  if (CHATTER_RE.test(line)) {
    return { score: -10, reason: "chatter" };
  }
  if (line.length < 10) {
    return { score: -5, reason: "too-short" };
  }
  if (line.length > 220) {
    return { score: -2, reason: "too-long" };
  }
  if (/[?？]$/.test(line) && !DURABLE_CUE_RE.test(line)) {
    return { score: -2, reason: "question" };
  }

  if (DURABLE_CUE_RE.test(line)) {
    score += 3;
    reasons.push("durable-cue");
  }
  if (line.includes(":") || line.includes("：")) {
    score += 1;
    reasons.push("structured");
  }
  if (DECISION_CUE_RE.test(line)) {
    score += 1;
    reasons.push("decision");
  }
  if (PROCEDURE_CUE_RE.test(line)) {
    score += 1;
    reasons.push("procedure");
  }
  if (role === "assistant" || role === "system") {
    score += 1;
    reasons.push("summary-role");
  }
  if (line.length >= 18 && line.length <= 140) {
    score += 1;
    reasons.push("good-length");
  }
  if (/^(?:结论|原因|修复|验证|下一步|原则|默认|建议|风险|方案|定位)/.test(line)) {
    score += 1;
    reasons.push("starts-with-key");
  }

  return { score, reason: reasons.join(",") || "neutral" };
}

function dedupeLines(lines: FactLine[]): FactLine[] {
  const seen = new Set<string>();
  const result: FactLine[] = [];
  for (const line of lines) {
    const key = line.text.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(line);
  }
  return result;
}

function summarizeMediaFromMessages(messages: PromotionMessageLike[]): MediaSupportSummary {
  const roleByMediaId = new Map<string, "primary" | "supporting">();
  for (const message of messages) {
    for (const ref of message.mediaRefs ?? []) {
      if (!ref.mediaId || roleByMediaId.has(ref.mediaId)) {
        continue;
      }
      roleByMediaId.set(ref.mediaId, ref.role ?? (ref.ordinal === 0 ? "primary" : "supporting"));
    }
  }
  const mediaIds = [
    ...new Set(
      messages.flatMap(
        (message) =>
          message.mediaRefs?.map((ref) => ref.mediaId) ??
          (message.primaryMediaId ? [message.primaryMediaId] : []),
      ),
    ),
  ];
  const primaryMediaId =
    messages.find((message) => message.primaryMediaId)?.primaryMediaId ?? mediaIds[0] ?? null;
  const imageBlocks = messages.flatMap((message) =>
    (message.contentBlocks ?? []).filter(
      (block): block is Extract<MessageBlock, { type: "image" }> => block.type === "image",
    ),
  );
  const fileBlocks = messages.flatMap((message) =>
    (message.contentBlocks ?? []).filter(
      (block): block is Extract<MessageBlock, { type: "file" }> => block.type === "file",
    ),
  );
  const mediaItems: PromotionCandidateMediaItem[] = [];
  for (const message of messages) {
    for (const block of message.contentBlocks ?? []) {
      if (block.type !== "image" && block.type !== "file") {
        continue;
      }
      const mediaId = block.mediaId ?? (block.type === "image" ? block.url : block.path);
      if (!mediaId) {
        continue;
      }
      mediaItems.push({
        mediaId,
        kind: block.type,
        role: roleByMediaId.get(mediaId) ?? (mediaId === primaryMediaId ? "primary" : "supporting"),
        url: block.type === "image" ? block.url : undefined,
        path: block.type === "file" ? block.path : undefined,
        mimeType: block.mimeType,
        alt: block.type === "image" ? block.alt : undefined,
        caption: block.type === "image" ? block.caption : undefined,
        title: block.type === "file" ? block.title : undefined,
        name: block.type === "file" ? block.name : undefined,
        sourceMessageId: message.id,
        sourceTurnIndex: message.turnIndex,
      });
    }
  }
  const visualSummary = imageBlocks.length
    ? imageBlocks
        .map((block) => block.alt || block.caption || block.url)
        .filter(Boolean)
        .slice(0, 2)
        .join("；")
    : fileBlocks.length
      ? fileBlocks
          .map((block) => block.title || block.name || block.path)
          .filter(Boolean)
          .slice(0, 2)
          .join("；")
      : undefined;
  const evidenceMode = imageBlocks.length
    ? messages.some((message) =>
        normalizeMessageContent({ role: message.role, content: message.content }).trim(),
      )
      ? "multimodal"
      : "image"
    : "text";
  return {
    primaryMediaId,
    mediaIds,
    mediaItems,
    visualSummary,
    evidenceMode,
  };
}

function extractFactLines(messages: PromotionMessageLike[]): FactLine[] {
  const lines: FactLine[] = [];
  for (const message of messages) {
    const role = typeof message.role === "string" ? message.role : "unknown";
    const content = normalizeMessageContent({ role, content: message.content });
    for (const rawLine of splitIntoLines(content)) {
      const { score, reason } = scoreFactLine(rawLine, role);
      if (score < 4) {
        continue;
      }
      lines.push({
        text: rawLine,
        score,
        role,
        refId: message.id ?? `turn:${message.turnIndex ?? "unknown"}`,
        turnIndex: message.turnIndex,
        createdAt: message.createdAt,
        reason,
      });
    }
  }
  return dedupeLines(lines).toSorted(
    (a, b) => b.score - a.score || (a.turnIndex ?? 0) - (b.turnIndex ?? 0),
  );
}

function inferKind(lines: FactLine[]): PromotionCandidateKind {
  const joined = lines.map((line) => line.text).join("\n");
  if (PROCEDURE_CUE_RE.test(joined) && !DECISION_CUE_RE.test(joined)) {
    return "procedure";
  }
  if (DECISION_CUE_RE.test(joined)) {
    return "decision";
  }
  return "fact_cluster";
}

function normalizeTitle(text: string): string {
  let value = cleanLine(text)
    .replace(/^(?:结论|原因|修复|验证|下一步|原则|默认|建议|风险|方案|定位)[:：]?\s*/i, "")
    .replace(/[。！？!?；;]+$/g, "")
    .trim();
  if (value.length > 42) {
    value = `${value.slice(0, 41)}…`;
  }
  return value || "候选长期记忆";
}

function buildTags(kind: PromotionCandidateKind, lines: FactLine[]): string[] {
  const tags = new Set<string>(["promotion", kind]);
  const joined = lines
    .map((line) => line.text)
    .join("\n")
    .toLowerCase();
  if (/笔记|vault|notebooklm/.test(joined)) {
    tags.add("knowledge-note");
  }
  if (/neo4j/.test(joined)) {
    tags.add("neo4j");
  }
  if (/qdrant|vector/.test(joined)) {
    tags.add("vector");
  }
  if (/统一|架构|architecture/.test(joined)) {
    tags.add("architecture");
  }
  if (/修复|恢复|排查|restart|recover|fix/.test(joined)) {
    tags.add("ops");
  }
  if (/偏好|prefer|preference|习惯|默认|always|never|先看|不接受/.test(joined)) {
    tags.add("preference");
  }
  if (/负责人|人物背景|对接人|角色分工|长期负责/.test(joined)) {
    tags.add("person");
  }
  if (/项目边界|项目范围|项目目标|roadmap|milestone/.test(joined)) {
    tags.add("project");
  }
  if (/概念|模型|原理|memory layer|知识层/.test(joined)) {
    tags.add("concept");
  }
  return [...tags];
}

function stableTokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9\u4e00-\u9fff]+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2)
    .filter(
      (token) =>
        !new Set([
          "我们",
          "这个",
          "那个",
          "需要",
          "可以",
          "should",
          "must",
          "with",
          "from",
          "that",
          "then",
        ]).has(token),
    );
}

function parseRecallTraceSupport(
  trace: PromotionRecallTraceLike,
  title: string,
  facts: string[],
): ParsedRecallSupport | null {
  const body =
    `${trace.query ?? ""}\n${trace.traceJson ?? ""}\n${trace.topResultsJson ?? ""}`.trim();
  if (!body) {
    return null;
  }

  const candidateTokens = new Set(stableTokenize(`${title}\n${facts.join("\n")}`));
  const traceTokens = stableTokenize(body);
  let overlap = 0;
  for (const token of traceTokens) {
    if (candidateTokens.has(token)) {
      overlap += 1;
    }
  }

  let structuralBonus = 0;
  try {
    const parsed = trace.traceJson
      ? (JSON.parse(trace.traceJson) as Record<string, unknown>)
      : null;
    if (parsed && typeof parsed === "object") {
      const seedCount = Number(parsed.seedCount ?? 0);
      const evidenceChunkCount = Number(parsed.evidenceChunkCount ?? 0);
      const reasonCount = Array.isArray(parsed.reasons) ? parsed.reasons.length : 0;
      if (seedCount >= 2) {
        structuralBonus += 1;
      }
      if (evidenceChunkCount >= 1) {
        structuralBonus += 1;
      }
      if (reasonCount >= 2) {
        structuralBonus += 1;
      }
    }
  } catch {
    // Ignore malformed trace JSON; extractor is best-effort and dry-run oriented.
  }

  const score = overlap + structuralBonus;
  if (score < 3) {
    return null;
  }

  return {
    query: trace.query,
    score,
    ref: {
      kind: "recall_trace",
      refId: trace.id ?? `trace:${clip(trace.query ?? "unknown", 48)}`,
      query: trace.query,
      createdAt: trace.createdAt,
      excerpt: clip(body, 140),
    },
  };
}

function buildCandidateDraft(params: {
  sessionId: string;
  sourceType: string;
  windowRef?: PromotionSourceRef;
  facts: FactLine[];
  messages: PromotionMessageLike[];
  recallTraces?: PromotionRecallTraceLike[];
}): PromotionCandidateDraft | null {
  const strongLines = params.facts.filter((line) => line.score >= 6);
  if (strongLines.length < 2 && params.facts.length < 3) {
    return null;
  }

  const selected = params.facts.slice(0, 5);
  const kind = inferKind(selected);
  const title = normalizeTitle(selected[0]?.text ?? "候选长期记忆");
  const facts = selected.map((line) => line.text);

  const messageRefs: PromotionSourceRef[] = selected.map((line) => ({
    kind: "message",
    refId: line.refId,
    sessionId: params.sessionId,
    turnIndex: line.turnIndex,
    role: line.role,
    createdAt: line.createdAt,
    excerpt: clip(line.text),
    reason: line.reason,
  }));

  const recallSupport = (params.recallTraces ?? [])
    .map((trace) => parseRecallTraceSupport(trace, title, facts))
    .filter((item): item is ParsedRecallSupport => Boolean(item))
    .toSorted((a, b) => b.score - a.score)[0];

  const sourceRefs = [
    ...(params.windowRef ? [params.windowRef] : []),
    ...messageRefs,
    ...(recallSupport?.ref ? [recallSupport.ref] : []),
  ];

  const confidenceBase =
    0.56 +
    Math.min(0.18, strongLines.length * 0.06) +
    Math.min(0.12, Math.max(0, selected.length - 2) * 0.04);
  const confidence = Number(Math.min(0.93, confidenceBase + (recallSupport ? 0.05 : 0)).toFixed(2));
  if (confidence < 0.68) {
    return null;
  }
  const mediaSupport = summarizeMediaFromMessages(params.messages);

  const candidate: PromotionCandidatePayload = {
    schemaVersion: "promotion-candidate.v1",
    kind,
    memoryKind: projectPromotionCandidateMemoryKind(kind),
    title,
    summary: facts.slice(0, 2).join("；"),
    visualSummary: mediaSupport.visualSummary,
    facts,
    tags: buildTags(kind, selected),
    confidence,
    evidenceStrength: confidence >= 0.8 ? "strong" : "moderate",
    evidenceMode: mediaSupport.evidenceMode,
    primaryMediaId: mediaSupport.primaryMediaId,
    mediaIds: mediaSupport.mediaIds,
    mediaItems: mediaSupport.mediaItems,
    writebackMediaMode:
      mediaSupport.mediaIds.length > 1
        ? "preserve_primary"
        : mediaSupport.mediaIds.length === 1
          ? "include_all"
          : "omit",
    whyWorthPromoting:
      kind === "procedure"
        ? "这组内容包含可复用的操作/排查步骤，适合作为后续会重复用到的长期操作记忆。"
        : "这组内容包含明确结论或稳定规则，后续跨会话复用价值高，适合进入长期记忆候选池。",
    sourceHint: recallSupport?.query
      ? `window-backed candidate with recall support from query: ${clip(recallSupport.query, 80)}`
      : "window-backed candidate from runtime conversation evidence",
  };
  candidate.durableMemoryType = inferPromotionDurableMemoryType(candidate) ?? undefined;
  candidate.memoryBucket = inferPromotionMemoryBucket(candidate);

  return {
    sessionId: params.sessionId,
    sourceType: recallSupport ? "blended_runtime_context" : params.sourceType,
    sourceRefs,
    sourceRefsJson: JSON.stringify(sourceRefs),
    candidate,
    candidateJson: JSON.stringify(candidate),
    status: "pending",
  };
}
function dedupeCandidates(candidates: PromotionCandidateDraft[]): PromotionCandidateDraft[] {
  const seen = new Set<string>();
  const result: PromotionCandidateDraft[] = [];
  for (const candidate of candidates) {
    const key = candidate.candidate.title.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(candidate);
  }
  return result.toSorted((a, b) => b.candidate.confidence - a.candidate.confidence);
}

export class CandidateExtractor {
  async extract(input: CandidateExtractorInput): Promise<CandidateExtractorResult> {
    const bundles = input.windows?.length
      ? input.windows
      : input.messages?.length
        ? [
            {
              window: {
                id: "window:adhoc",
                startTurn: input.messages[0]?.turnIndex ?? 0,
                endTurn: input.messages[input.messages.length - 1]?.turnIndex ?? 0,
              },
              messages: input.messages,
            },
          ]
        : [];

    const diagnostics: CandidateExtractorResult["diagnostics"] = {
      scannedWindowCount: bundles.length,
      scannedMessageCount: bundles.reduce((sum, bundle) => sum + bundle.messages.length, 0),
      skippedWindows: [],
    };

    const candidates: PromotionCandidateDraft[] = [];
    for (const bundle of bundles) {
      if (!bundle.messages.length) {
        diagnostics.skippedWindows.push({
          refId: bundle.window.id ?? `window:${bundle.window.startTurn}-${bundle.window.endTurn}`,
          reason: "empty-window",
        });
        continue;
      }
      const factLines = extractFactLines(bundle.messages);
      if (factLines.length < 2) {
        diagnostics.skippedWindows.push({
          refId: bundle.window.id ?? `window:${bundle.window.startTurn}-${bundle.window.endTurn}`,
          reason: "insufficient-durable-evidence",
        });
        continue;
      }

      const candidate = buildCandidateDraft({
        sessionId: input.sessionId,
        sourceType: "runtime_window",
        facts: factLines,
        messages: bundle.messages,
        recallTraces: input.recallTraces,
      });
      if (!candidate) {
        diagnostics.skippedWindows.push({
          refId: bundle.window.id ?? `window:${bundle.window.startTurn}-${bundle.window.endTurn}`,
          reason: "confidence-below-threshold",
        });
        continue;
      }
      candidates.push(candidate);
    }

    return {
      candidates: dedupeCandidates(candidates).slice(0, Math.max(1, input.maxCandidates ?? 3)),
      diagnostics,
    };
  }
}
