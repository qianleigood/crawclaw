import type { DurableMemoryType, UnifiedRankedItem } from "../types/orchestration.ts";

const USER_RE = /(user profile|user persona|persona|profile|role|knowledge level|背景|角色|熟悉|不熟悉|经验)/i;
const FEEDBACK_RE = /(feedback|prefer|preference|default|always|never|不要|请先|偏好|习惯|默认|风格|回答方式)/i;
const PROJECT_RE = /(project|roadmap|milestone|merge freeze|release|deadline|stakeholder|项目|里程碑|冻结|发布日期|目标|范围)/i;
const REFERENCE_RE = /(reference|dashboard|linear|slack|notion|grafana|docs|wiki|链接|入口|文档|看板)/i;

export type ClaudeMemoryBucket = "durable" | "knowledge";

export interface ClaudeMemoryClassification {
  bucket: ClaudeMemoryBucket;
  durableType?: DurableMemoryType;
  reasons: string[];
}

function joinText(item: UnifiedRankedItem): string {
  return [item.title, item.summary, item.content ?? ""].filter(Boolean).join(" ");
}

function readTags(item: UnifiedRankedItem): string[] {
  const tags = item.metadata?.tags;
  if (!Array.isArray(tags)) {return [];}
  return tags.filter((tag): tag is string => typeof tag === "string");
}

function sourceLooksLikeFeedback(item: UnifiedRankedItem): boolean {
  return item.source === "native_memory" && item.layer === "preferences";
}

function buildDurableReasons(item: UnifiedRankedItem, durableType: DurableMemoryType): string[] {
  const tags = readTags(item).map((tag) => tag.toLowerCase());
  const text = `${joinText(item)} ${tags.join(" ")}`;
  const reasons = ["bucket=durable", `type=${durableType}`];

  if (item.durableMemoryType) {reasons.push("explicit=durableMemoryType");}
  if (item.memoryKind) {reasons.push(`memoryKind=${item.memoryKind}`);}
  if (item.layer) {reasons.push(`layer=${item.layer}`);}
  if (item.source) {reasons.push(`source=${item.source}`);}

  if (durableType === "user" && (tags.includes("user") || tags.includes("person") || USER_RE.test(text))) {reasons.push("matched=user");}
  if (durableType === "feedback" && (tags.includes("feedback") || tags.includes("preference") || sourceLooksLikeFeedback(item) || FEEDBACK_RE.test(text))) {
    reasons.push("matched=feedback");
  }
  if (durableType === "project" && (tags.includes("project") || PROJECT_RE.test(text))) {reasons.push("matched=project");}
  if (durableType === "reference" && (tags.includes("reference") || item.memoryKind === "reference" || item.layer === "sources" || REFERENCE_RE.test(text))) {
    reasons.push("matched=reference");
  }

  return reasons;
}

function buildKnowledgeReasons(item: UnifiedRankedItem): string[] {
  const reasons = ["bucket=knowledge"];
  if (item.memoryKind) {reasons.push(`memoryKind=${item.memoryKind}`);}
  if (item.layer) {reasons.push(`layer=${item.layer}`);}
  if (item.source) {reasons.push(`source=${item.source}`);}
  return reasons;
}

export function classifyClaudeMemoryItem(item: UnifiedRankedItem): ClaudeMemoryClassification {
  const durableType = inferDurableMemoryType(item);
  if (durableType) {
    return {
      bucket: "durable",
      durableType,
      reasons: buildDurableReasons(item, durableType),
    };
  }
  return {
    bucket: "knowledge",
    reasons: buildKnowledgeReasons(item),
  };
}

export function splitClaudeMemoryItems(items: readonly UnifiedRankedItem[]): {
  durableItems: UnifiedRankedItem[];
  knowledgeItems: UnifiedRankedItem[];
} {
  const durableItems: UnifiedRankedItem[] = [];
  const knowledgeItems: UnifiedRankedItem[] = [];

  for (const item of items) {
    const classification = classifyClaudeMemoryItem(item);
    if (classification.bucket === "durable") {
      durableItems.push(item);
    } else {
      knowledgeItems.push(item);
    }
  }

  return { durableItems, knowledgeItems };
}

export function inferDurableMemoryType(item: UnifiedRankedItem): DurableMemoryType | null {
  if (item.durableMemoryType) {return item.durableMemoryType;}

  const tags = readTags(item).map((tag) => tag.toLowerCase());
  const text = `${joinText(item)} ${tags.join(" ")}`;
  const source = item.source;

  if (tags.includes("user") || tags.includes("person") || USER_RE.test(text)) {return "user";}
  if (tags.includes("feedback") || tags.includes("preference") || source === "native_memory" && item.layer === "preferences" || FEEDBACK_RE.test(text)) {return "feedback";}
  if (tags.includes("project") || PROJECT_RE.test(text)) {return "project";}
  if (tags.includes("reference") || item.memoryKind === "reference" || REFERENCE_RE.test(text)) {return "reference";}

  return null;
}
