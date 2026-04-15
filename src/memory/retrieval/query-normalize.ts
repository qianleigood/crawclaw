export interface NormalizedQuery {
  raw: string;
  normalized: string;
  intent?: "fix" | "design" | "search" | "explain" | "config" | "unknown";
  preferredTypes: string[];
  keywords: string[];
}

export function normalizeQuery(raw: string): NormalizedQuery {
  const normalized = raw.trim().toLowerCase();
  const keywords = normalized.split(/\s+/).map((s) => s.trim()).filter(Boolean);

  let intent: NormalizedQuery["intent"] = "unknown";
  if (/(修复|报错|失败|fix|error|restore)/i.test(raw)) {intent = "fix";}
  else if (/(设计|方案|架构|优化|optimi)/i.test(raw)) {intent = "design";}
  else if (/(配置|config)/i.test(raw)) {intent = "config";}
  else if (/(是什么|解释|说明)/i.test(raw)) {intent = "explain";}
  else if (keywords.length) {intent = "search";}

  let preferredTypes: string[] = [];
  if (intent === "fix") {preferredTypes = ["ISSUE", "WORKFLOW", "TASK", "EVENT"];}
  else if (intent === "design") {preferredTypes = ["DECISION", "DOC", "WORKFLOW"];}
  else if (intent === "explain") {preferredTypes = ["SKILL", "DOC", "WORKFLOW"];}

  return {
    raw,
    normalized,
    intent,
    preferredTypes,
    keywords,
  };
}
