import type { CompleteFn } from "../extraction/llm.ts";
import { callStructuredOutput, type StructuredAttemptTrace } from "../llm/structured-output.ts";
import type { GmNode } from "../types/graph.ts";
import { normalizeMessageContent } from "../util/message.ts";
import { CandidateExtractor } from "./candidate-extractor.ts";
import type {
  CandidateExtractorInput,
  PromotionCandidateDraft,
  PromotionCandidateKind,
  PromotionCandidatePayload,
  PromotionMergeCandidateHint,
  PromotionMessageLike,
  PromotionRecallTraceLike,
  PromotionSourceRef,
  PromotionWindowBundle,
} from "./types.ts";
import {
  inferPromotionDurableMemoryType,
  inferPromotionMemoryBucket,
  projectPromotionCandidateMemoryKind,
} from "./types.ts";

const MAX_FACTS = 6;
const MAX_TAGS = 8;
const MAX_SOURCE_REFS = 12;
const MAX_EXISTING_HINTS = 20;
const MAX_TRACE_HINTS = 4;

const DISTILL_SYS = `你是 CrawClaw memory 的“长期记忆提炼层”。
你的任务不是抽 graph 节点，而是把当前对话窗口提炼成可进入正式长期记忆流程的候选对象。

输出要求：
1. 只输出 JSON，不要解释。
2. 只保留跨会话仍有价值的稳定内容：明确结论、长期规则、可复用 SOP、重要事实簇。
3. 不要收录寒暄、一次性安排、纯情绪、没有稳定结论的猜测。
4. 如果证据不足，可以输出空数组 candidates。
5. mergeCandidates 用于提示可能复用/合并的既有记忆；targetHint 用于提示更可能的目标 note 路径。
6. riskFlags 只写真正需要提醒的风险，例如 low_evidence / privacy / volatile / merge_review_needed / hallucination_risk。
7. 如果内容是偏好或人物/项目/概念稳定背景，请在 tags 中尽量标注 preference / person / project / concept，并尽量提供 targetHint。`;

const DISTILL_FORMAT_HINT = `JSON schema:
{
  "candidates": [{
    "kind": "decision|procedure|fact_cluster",
    "title": "标题",
    "summary": "1-2 句摘要",
    "visualSummary": "可选，视觉证据摘要",
    "facts": ["事实/步骤/结论"],
    "tags": ["tag"],
    "confidence": 0.0,
    "evidenceMode": "可选，text|image|multimodal",
    "primaryMediaId": "可选，主媒体 ID",
    "mediaIds": ["可选，关联 mediaId 列表"],
    "whyWorthPromoting": "为什么值得进入长期记忆",
    "sourceHint": "来源说明",
    "riskFlags": ["low_evidence"],
    "mergeCandidates": [{
      "title": "可能合并目标标题",
      "nodeId": "可选",
      "notePath": "可选",
      "reason": "为什么",
      "score": 0.0
    }],
    "targetHint": "可选 note path"
  }],
  "skippedReasons": ["可选"]
}`;

interface RawDistillationResult {
  candidates?: unknown[];
  skippedReasons?: unknown[];
}

interface NormalizedDistilledCandidate {
  kind: PromotionCandidateKind;
  title: string;
  summary: string;
  visualSummary?: string;
  facts: string[];
  tags: string[];
  confidence: number;
  evidenceMode?: "text" | "image" | "multimodal";
  primaryMediaId?: string | null;
  mediaIds?: string[];
  whyWorthPromoting: string;
  sourceHint: string;
  riskFlags: string[];
  mergeCandidates: PromotionMergeCandidateHint[];
  targetHint?: string;
}

export interface DistillationDiagnostics {
  strategy: "llm" | "rules";
  fallbackUsed: boolean;
  fallbackReason?: string;
  llmTrace?: StructuredAttemptTrace[];
  ruleDiagnostics?: {
    scannedWindowCount: number;
    scannedMessageCount: number;
    skippedWindows: Array<{ refId: string; reason: string }>;
  };
}

export interface DistillationResult {
  candidates: PromotionCandidateDraft[];
  diagnostics: DistillationDiagnostics;
}

export interface DistillationInput extends CandidateExtractorInput {
  existingNodes?: GmNode[];
}

function clip(text: string, limit = 180): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= limit) {
    return normalized;
  }
  return `${normalized.slice(0, limit - 1)}…`;
}

function normalizeTag(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9\u4e00-\u9fff_-]/g, "");
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(0.99, Number.isFinite(value) ? value : 0));
}

function normalizeKind(value: unknown): PromotionCandidateKind | null {
  if (value === "decision" || value === "procedure" || value === "fact_cluster") {
    return value;
  }
  return null;
}

function recordText(record: Record<string, unknown>, key: string, fallback = ""): string {
  const value = record[key];
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return String(value);
  }
  return fallback;
}

function recordOptionalText(record: Record<string, unknown>, key: string): string | undefined {
  const text = recordText(record, key).trim();
  return text ? text : undefined;
}

function normalizeStringArray(value: unknown, limit: number): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => String(item ?? "").trim())
    .filter(Boolean)
    .slice(0, limit);
}

function dedupeRefs(refs: PromotionSourceRef[]): PromotionSourceRef[] {
  const seen = new Set<string>();
  const result: PromotionSourceRef[] = [];
  for (const ref of refs) {
    const key = `${ref.kind}:${ref.refId}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(ref);
    if (result.length >= MAX_SOURCE_REFS) {
      break;
    }
  }
  return result;
}

function buildBundles(input: DistillationInput): PromotionWindowBundle[] {
  if (input.windows?.length) {
    return input.windows;
  }
  if (!input.messages?.length) {
    return [];
  }
  return [
    {
      window: {
        id: "window:adhoc",
        startTurn: input.messages[0]?.turnIndex ?? 0,
        endTurn: input.messages[input.messages.length - 1]?.turnIndex ?? 0,
      },
      messages: input.messages,
    },
  ];
}

function buildMessageRefs(
  messages: PromotionMessageLike[],
  sessionId: string,
): PromotionSourceRef[] {
  return messages
    .map((message) => ({
      kind: "message" as const,
      refId: message.id ?? `turn:${message.turnIndex ?? "unknown"}`,
      sessionId,
      turnIndex: message.turnIndex,
      role: message.role,
      createdAt: message.createdAt,
      excerpt: clip(normalizeMessageContent({ role: message.role, content: message.content }), 160),
    }))
    .filter((ref) => ref.excerpt && ref.excerpt.length >= 8)
    .slice(0, 8);
}

function buildWindowRefs(
  bundles: PromotionWindowBundle[],
  sessionId: string,
): PromotionSourceRef[] {
  return bundles.slice(0, 3).map((bundle) => ({
    kind: "window" as const,
    refId: bundle.window.id ?? `window:${bundle.window.startTurn}-${bundle.window.endTurn}`,
    sessionId,
    startTurn: bundle.window.startTurn,
    endTurn: bundle.window.endTurn,
    createdAt: bundle.window.createdAt,
    reason: bundle.window.reason,
    excerpt: `turns ${bundle.window.startTurn}-${bundle.window.endTurn}`,
  }));
}

function buildRecallRefs(
  recallTraces: PromotionRecallTraceLike[] | undefined,
): PromotionSourceRef[] {
  return (recallTraces ?? []).slice(0, MAX_TRACE_HINTS).map((trace) => ({
    kind: "recall_trace" as const,
    refId: trace.id ?? `trace:${clip(trace.query ?? "unknown", 48)}`,
    query: trace.query,
    createdAt: trace.createdAt,
    excerpt: clip(`${trace.query ?? ""} ${trace.topResultsJson ?? ""}`, 140),
  }));
}

function collectBaseSourceRefs(input: DistillationInput): PromotionSourceRef[] {
  const bundles = buildBundles(input);
  const allMessages = bundles.flatMap((bundle) => bundle.messages);
  return dedupeRefs([
    ...buildWindowRefs(bundles, input.sessionId),
    ...buildMessageRefs(allMessages, input.sessionId),
    ...buildRecallRefs(input.recallTraces),
  ]);
}

function keywordSet(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9\u4e00-\u9fff]+/)
      .map((item) => item.trim())
      .filter((item) => item.length >= 2),
  );
}

function overlapScore(left: string, right: string): number {
  const a = keywordSet(left);
  const b = keywordSet(right);
  if (!a.size || !b.size) {
    return 0;
  }
  let overlap = 0;
  for (const item of a) {
    if (b.has(item)) {
      overlap += 1;
    }
  }
  return overlap / Math.max(a.size, b.size);
}

function chooseSourceRefs(
  candidate: NormalizedDistilledCandidate,
  fallbackCandidates: PromotionCandidateDraft[],
  baseSourceRefs: PromotionSourceRef[],
): PromotionSourceRef[] {
  const titleAndFacts = `${candidate.title}\n${candidate.summary}\n${candidate.facts.join("\n")}`;
  const bestFallback = fallbackCandidates
    .map((item) => ({
      item,
      score: overlapScore(
        titleAndFacts,
        `${item.candidate.title}\n${item.candidate.summary}\n${item.candidate.facts.join("\n")}`,
      ),
    }))
    .toSorted((left, right) => right.score - left.score)[0];

  if (bestFallback && bestFallback.score >= 0.18) {
    return dedupeRefs(bestFallback.item.sourceRefs);
  }
  if (fallbackCandidates.length === 1 && fallbackCandidates[0]) {
    return dedupeRefs(fallbackCandidates[0].sourceRefs);
  }
  return dedupeRefs(baseSourceRefs);
}

function normalizeMergeCandidates(value: unknown): PromotionMergeCandidateHint[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => {
      const record = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
      const title = recordText(record, "title").trim();
      if (!title) {
        return null;
      }
      const scoreRaw = Number(record.score ?? 0);
      return {
        title,
        nodeId: recordOptionalText(record, "nodeId"),
        notePath: recordOptionalText(record, "notePath"),
        reason: recordOptionalText(record, "reason")
          ? clip(recordText(record, "reason"), 120)
          : undefined,
        score: Number.isFinite(scoreRaw) ? Number(clamp01(scoreRaw).toFixed(2)) : undefined,
      } as PromotionMergeCandidateHint;
    })
    .filter((item): item is PromotionMergeCandidateHint => Boolean(item))
    .slice(0, 3);
}

function normalizeCandidate(value: unknown): NormalizedDistilledCandidate | null {
  const record = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const kind = normalizeKind(record.kind);
  const title = recordText(record, "title").trim();
  const summary = clip(recordText(record, "summary").trim(), 220);
  const facts = normalizeStringArray(record.facts, MAX_FACTS).map((item) => clip(item, 180));
  if (!kind || !title || !summary || facts.length === 0) {
    return null;
  }

  const rawConfidence = Number(record.confidence ?? 0.72);
  const confidence = Number((rawConfidence > 0 ? clamp01(rawConfidence) : 0.72).toFixed(2));
  const tags = normalizeStringArray(record.tags, MAX_TAGS).map(normalizeTag).filter(Boolean);
  const riskFlags = normalizeStringArray(record.riskFlags, 6).map(normalizeTag).filter(Boolean);
  const mergeCandidates = normalizeMergeCandidates(record.mergeCandidates);
  const whyWorthPromoting = clip(
    recordText(record, "whyWorthPromoting", "这条内容具备跨会话复用价值，适合作为长期记忆候选。"),
    180,
  );
  const sourceHint = clip(
    recordText(record, "sourceHint", "llm distilled from runtime window"),
    160,
  );
  const targetHint = recordOptionalText(record, "targetHint");
  const visualSummary = recordOptionalText(record, "visualSummary")
    ? clip(recordText(record, "visualSummary").trim(), 180)
    : undefined;
  const mediaIds = normalizeStringArray(record.mediaIds, 6);
  const primaryMediaId = recordOptionalText(record, "primaryMediaId");
  const evidenceMode =
    record.evidenceMode === "text" ||
    record.evidenceMode === "image" ||
    record.evidenceMode === "multimodal"
      ? record.evidenceMode
      : undefined;
  const semanticText = `${title}\n${summary}\n${facts.join("\n")}\n${targetHint ?? ""}`;
  const semanticTags = [
    /偏好|preference|prefer|习惯|默认|always|never|先看|不接受/i.test(semanticText)
      ? "preference"
      : null,
    /负责人|人物背景|对接人|角色分工|长期负责/i.test(semanticText) ? "person" : null,
    /项目边界|项目范围|项目目标|roadmap|milestone/i.test(semanticText) ? "project" : null,
    /概念|模型|原理|memory layer|知识层|架构/i.test(semanticText) ? "concept" : null,
  ].filter((item): item is string => Boolean(item));

  return {
    kind,
    title: clip(title, 72),
    summary,
    visualSummary,
    facts,
    tags: [...new Set(["promotion", kind, ...tags, ...semanticTags])].slice(0, MAX_TAGS),
    confidence,
    evidenceMode,
    primaryMediaId: primaryMediaId || undefined,
    mediaIds: mediaIds.length ? mediaIds : undefined,
    whyWorthPromoting,
    sourceHint,
    riskFlags,
    mergeCandidates,
    targetHint: targetHint ? clip(targetHint, 160) : undefined,
  };
}

function validateRawDistillationResult(value: unknown): RawDistillationResult {
  const record = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  return {
    candidates: Array.isArray(record.candidates) ? record.candidates : [],
    skippedReasons: Array.isArray(record.skippedReasons) ? record.skippedReasons : [],
  };
}

function buildExistingNodeHints(existingNodes: GmNode[] | undefined): string {
  const hints = (existingNodes ?? [])
    .filter((node) => node.status === "active")
    .slice(0, MAX_EXISTING_HINTS)
    .map(
      (node) => `- ${node.id} | ${node.type} | ${node.name} | ${clip(node.description ?? "", 96)}`,
    );
  return hints.length ? hints.join("\n") : "（无现有长期记忆提示）";
}

function buildRecallTraceHints(recallTraces: PromotionRecallTraceLike[] | undefined): string {
  const hints = (recallTraces ?? [])
    .slice(0, MAX_TRACE_HINTS)
    .map(
      (trace) =>
        `- query=${trace.query ?? ""}\n  trace=${clip(trace.traceJson ?? "", 240)}\n  topResults=${clip(trace.topResultsJson ?? "", 240)}`,
    );
  return hints.length ? hints.join("\n") : "（无 recall trace）";
}

function buildConversationPrompt(bundles: PromotionWindowBundle[]): string {
  return bundles
    .map((bundle) => {
      const header = `## Window ${bundle.window.id ?? `${bundle.window.startTurn}-${bundle.window.endTurn}`} (${bundle.window.startTurn}-${bundle.window.endTurn})${bundle.window.reason ? ` | ${bundle.window.reason}` : ""}`;
      const body = bundle.messages
        .map(
          (message) =>
            `[${message.role} t=${message.turnIndex ?? "?"}] ${clip(normalizeMessageContent({ role: message.role, content: message.content }), 600)}`,
        )
        .join("\n");
      return `${header}\n${body}`;
    })
    .join("\n\n");
}

export class DistillationService {
  private readonly fallbackExtractor = new CandidateExtractor();

  constructor(
    private readonly llm?: CompleteFn,
    private readonly llmModel?: string,
  ) {}

  async distill(input: DistillationInput): Promise<DistillationResult> {
    const fallback = await this.fallbackExtractor.extract(input);
    const baseSourceRefs = collectBaseSourceRefs(input);

    if (!this.llm) {
      return {
        candidates: fallback.candidates.map((item) => ({
          ...item,
          candidate: {
            ...item.candidate,
            distillationMeta: { strategy: "rules" },
          },
          candidateJson: JSON.stringify({
            ...item.candidate,
            distillationMeta: { strategy: "rules" },
          } satisfies PromotionCandidatePayload),
        })),
        diagnostics: {
          strategy: "rules",
          fallbackUsed: true,
          fallbackReason: "llm_not_configured",
          ruleDiagnostics: fallback.diagnostics,
        },
      };
    }

    try {
      const bundles = buildBundles(input);
      const structured = await callStructuredOutput(this.llm, {
        system: DISTILL_SYS,
        user: [
          `<ExistingMemoryHints>\n${buildExistingNodeHints(input.existingNodes)}\n</ExistingMemoryHints>`,
          `<RecallTraceHints>\n${buildRecallTraceHints(input.recallTraces)}\n</RecallTraceHints>`,
          `<ConversationWindows>\n${buildConversationPrompt(bundles)}\n</ConversationWindows>`,
          `<Constraints>\nmaxCandidates=${Math.max(1, input.maxCandidates ?? 3)}\n如果某条内容更像对现有记忆的补充或重复，请在 mergeCandidates 或 targetHint 中体现。\n</Constraints>`,
        ].join("\n\n"),
        formatHint: DISTILL_FORMAT_HINT,
        retries: 1,
        validator: validateRawDistillationResult,
      });

      const normalized = (structured.value.candidates ?? [])
        .map(normalizeCandidate)
        .filter((item): item is NormalizedDistilledCandidate => Boolean(item))
        .toSorted((left, right) => right.confidence - left.confidence)
        .slice(0, Math.max(1, input.maxCandidates ?? 3));

      if (!normalized.length) {
        throw new Error("llm_distillation_empty");
      }

      const candidates = normalized.map((candidate) => {
        const sourceRefs = chooseSourceRefs(candidate, fallback.candidates, baseSourceRefs);
        const payload: PromotionCandidatePayload = {
          schemaVersion: "promotion-candidate.v1",
          kind: candidate.kind,
          memoryKind: projectPromotionCandidateMemoryKind(candidate.kind),
          title: candidate.title,
          summary: candidate.summary,
          visualSummary: candidate.visualSummary,
          facts: candidate.facts,
          tags: candidate.tags,
          confidence: candidate.confidence,
          evidenceStrength: candidate.confidence >= 0.8 ? "strong" : "moderate",
          evidenceMode: candidate.evidenceMode,
          primaryMediaId: candidate.primaryMediaId,
          mediaIds: candidate.mediaIds,
          whyWorthPromoting: candidate.whyWorthPromoting,
          sourceHint: candidate.sourceHint,
          riskFlags: candidate.riskFlags,
          mergeCandidates: candidate.mergeCandidates,
          targetHint: candidate.targetHint,
          distillationMeta: {
            strategy: "llm",
            model: this.llmModel,
          },
        };
        payload.durableMemoryType = inferPromotionDurableMemoryType(payload) ?? undefined;
        payload.memoryBucket = inferPromotionMemoryBucket(payload);
        return {
          sessionId: input.sessionId,
          sourceType: "promotion_distillation_llm",
          sourceRefs,
          sourceRefsJson: JSON.stringify(sourceRefs),
          candidate: payload,
          candidateJson: JSON.stringify(payload),
          status: "pending" as const,
        } satisfies PromotionCandidateDraft;
      });

      return {
        candidates,
        diagnostics: {
          strategy: "llm",
          fallbackUsed: false,
          llmTrace: structured.trace,
          ruleDiagnostics: fallback.diagnostics,
        },
      };
    } catch (error) {
      const fallbackReason = error instanceof Error ? error.message : String(error);
      return {
        candidates: fallback.candidates.map((item) => ({
          ...item,
          candidate: {
            ...item.candidate,
            distillationMeta: { strategy: "rules", fallbackReason },
          },
          candidateJson: JSON.stringify({
            ...item.candidate,
            distillationMeta: { strategy: "rules", fallbackReason },
          } satisfies PromotionCandidatePayload),
        })),
        diagnostics: {
          strategy: "rules",
          fallbackUsed: true,
          fallbackReason,
          ruleDiagnostics: fallback.diagnostics,
        },
      };
    }
  }
}
