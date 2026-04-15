import type { UnifiedRankedItem, UnifiedRecallLayer } from "../types/orchestration.ts";

export type KnowledgeDisplayKindLabel =
  | "操作流程"
  | "决策说明"
  | "偏好说明"
  | "运行规律"
  | "参考资料";

export const KNOWLEDGE_DISPLAY_HEADING = "## 知识回忆";

const KNOWLEDGE_LAYER_HEADINGS: Record<UnifiedRecallLayer, string> = {
  key_decisions: "## 决策说明",
  sop: "## 操作流程",
  preferences: "## 偏好说明",
  runtime_signals: "## 运行规律",
  sources: "## 参考资料",
};

export function getKnowledgeLayerHeading(layer: UnifiedRecallLayer): string {
  return KNOWLEDGE_LAYER_HEADINGS[layer];
}

export function getKnowledgeKindLabel(item: Pick<UnifiedRankedItem, "memoryKind">): KnowledgeDisplayKindLabel {
  if (item.memoryKind === "procedure") {return "操作流程";}
  if (item.memoryKind === "decision") {return "决策说明";}
  if (item.memoryKind === "preference") {return "偏好说明";}
  if (item.memoryKind === "runtime_pattern") {return "运行规律";}
  return "参考资料";
}

export function getKnowledgeItemLabel(item: Pick<UnifiedRankedItem, "memoryKind">): string {
  return `【${getKnowledgeKindLabel(item)}】`;
}

export function getKnowledgeSourceLabel(item: Pick<UnifiedRankedItem, "memoryKind">): string {
  return item.memoryKind === "reference" ? "【参考资料】" : "【参考来源】";
}

export function formatKnowledgeTitle(item: Pick<UnifiedRankedItem, "memoryKind" | "title">): string {
  return `${getKnowledgeItemLabel(item)}${item.title}`;
}

function compactText(value: string | undefined, maxChars: number): string {
  const normalized = (value ?? "").replace(/\s+/g, " ").trim();
  if (!normalized) {return "";}
  return normalized.length <= maxChars ? normalized : `${normalized.slice(0, maxChars - 1).trimEnd()}…`;
}

export function buildKnowledgeSummaryPrefix(item: Pick<UnifiedRankedItem, "memoryKind">): string {
  if (item.memoryKind === "procedure") {return "适用场景";}
  if (item.memoryKind === "decision") {return "结论";}
  if (item.memoryKind === "runtime_pattern") {return "现象";}
  if (item.memoryKind === "reference") {return "资料说明";}
  return "摘要";
}

export function buildKnowledgeCardSummary(
  item: Pick<UnifiedRankedItem, "memoryKind" | "summary" | "content" | "title">,
  maxChars = 160,
): string {
  const sourceText = compactText(item.summary || item.content || item.title, maxChars);
  if (!sourceText) {return `${buildKnowledgeSummaryPrefix(item)}：暂无摘要`;}
  return `${buildKnowledgeSummaryPrefix(item)}：${sourceText}`;
}
