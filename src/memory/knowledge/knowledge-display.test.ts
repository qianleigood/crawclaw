import { describe, expect, it } from "vitest";
import type { UnifiedRankedItem } from "../types/orchestration.ts";
import {
  formatKnowledgeTitle,
  getKnowledgeItemLabel,
  getKnowledgeLayerHeading,
  getKnowledgeSourceLabel,
  getKnowledgeKindLabel,
  KNOWLEDGE_DISPLAY_HEADING,
} from "./knowledge-display.ts";

function makeItem(overrides: Partial<UnifiedRankedItem> & Pick<UnifiedRankedItem, "id" | "source" | "title" | "summary">): UnifiedRankedItem {
  return {
    layer: "runtime_signals",
    updatedAt: 0,
    supportingSources: [],
    supportingIds: [],
    scoreBreakdown: {
      retrieval: 0,
      sourcePrior: 0,
      layerPrior: 0,
      memoryKindPrior: 0,
      entityBoost: 0,
      keywordBoost: 0,
      exactTitleBoost: 0,
      recencyBoost: 0,
      importanceBoost: 0,
      supportBoost: 0,
      lifecycleBoost: 0,
      mediaBoost: 0,
      penalty: 0,
      finalScore: 0.5,
    },
    ...overrides,
  } as UnifiedRankedItem;
}

describe("knowledge display helpers", () => {
  it("renders Chinese headings and type labels", () => {
    expect(KNOWLEDGE_DISPLAY_HEADING).toBe("## 知识回忆");
    expect(getKnowledgeLayerHeading("sop")).toBe("## 操作流程");
    expect(getKnowledgeLayerHeading("key_decisions")).toBe("## 决策说明");
    expect(getKnowledgeLayerHeading("preferences")).toBe("## 偏好说明");
    expect(getKnowledgeLayerHeading("runtime_signals")).toBe("## 运行规律");
    expect(getKnowledgeLayerHeading("sources")).toBe("## 参考资料");
  });

  it("formats knowledge item labels in Chinese", () => {
    const procedure = makeItem({
      id: "procedure",
      source: "notebooklm",
      title: "deployment-security-checklist",
      summary: "Deployments must check secrets and rollback.",
      memoryKind: "procedure",
    });
    const reference = makeItem({
      id: "reference",
      source: "notebooklm",
      title: "NotebookLM usage guide",
      summary: "How to query and write knowledge notes.",
      memoryKind: "reference",
    });

    expect(getKnowledgeKindLabel(procedure)).toBe("操作流程");
    expect(getKnowledgeItemLabel(procedure)).toBe("【操作流程】");
    expect(formatKnowledgeTitle(procedure)).toBe("【操作流程】deployment-security-checklist");
    expect(getKnowledgeSourceLabel(procedure)).toBe("【参考来源】");
    expect(getKnowledgeKindLabel(reference)).toBe("参考资料");
    expect(getKnowledgeSourceLabel(reference)).toBe("【参考资料】");
  });
});
