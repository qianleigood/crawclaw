import type { UnifiedRankedItem, UnifiedRecallLayer } from "../types/orchestration.ts";

export type ExperienceDisplayKindLabel =
  | "操作经验"
  | "决策经验"
  | "偏好说明"
  | "运行经验"
  | "参考资料";

export const EXPERIENCE_DISPLAY_HEADING = "## 经验回忆";

const EXPERIENCE_LAYER_HEADINGS: Record<UnifiedRecallLayer, string> = {
  key_decisions: "## 决策经验",
  sop: "## 操作经验",
  preferences: "## 偏好说明",
  runtime_signals: "## 运行经验",
  sources: "## 参考资料",
};

export function getExperienceLayerHeading(layer: UnifiedRecallLayer): string {
  return EXPERIENCE_LAYER_HEADINGS[layer];
}

export function getExperienceKindLabel(
  item: Pick<UnifiedRankedItem, "memoryKind">,
): ExperienceDisplayKindLabel {
  if (item.memoryKind === "procedure") {
    return "操作经验";
  }
  if (item.memoryKind === "decision") {
    return "决策经验";
  }
  if (item.memoryKind === "preference") {
    return "偏好说明";
  }
  if (item.memoryKind === "runtime_pattern") {
    return "运行经验";
  }
  return "参考资料";
}

export function getExperienceItemLabel(item: Pick<UnifiedRankedItem, "memoryKind">): string {
  return `【${getExperienceKindLabel(item)}】`;
}

export function getExperienceSourceLabel(item: Pick<UnifiedRankedItem, "memoryKind">): string {
  return item.memoryKind === "reference" ? "【参考资料】" : "【参考来源】";
}

export function formatExperienceTitle(
  item: Pick<UnifiedRankedItem, "memoryKind" | "title">,
): string {
  return `${getExperienceItemLabel(item)}${item.title}`;
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

export function buildExperienceSummaryPrefix(item: Pick<UnifiedRankedItem, "memoryKind">): string {
  if (item.memoryKind === "procedure") {
    return "适用场景";
  }
  if (item.memoryKind === "decision") {
    return "经验结论";
  }
  if (item.memoryKind === "runtime_pattern") {
    return "触发信号";
  }
  if (item.memoryKind === "reference") {
    return "资料说明";
  }
  return "摘要";
}

export function buildExperienceCardSummary(
  item: Pick<UnifiedRankedItem, "memoryKind" | "summary" | "content" | "title">,
  maxChars = 160,
): string {
  const sourceText = compactText(item.summary || item.content || item.title, maxChars);
  if (!sourceText) {
    return `${buildExperienceSummaryPrefix(item)}：暂无摘要`;
  }
  return `${buildExperienceSummaryPrefix(item)}：${sourceText}`;
}
