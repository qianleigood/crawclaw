import { describe, expect, it } from "vitest";
import type { UnifiedRankedItem } from "../types/orchestration.ts";
import {
  formatExperienceTitle,
  getExperienceItemLabel,
  getExperienceLayerHeading,
  getExperienceSourceLabel,
  getExperienceKindLabel,
  EXPERIENCE_DISPLAY_HEADING,
} from "./display.ts";

function makeItem(
  overrides: Partial<UnifiedRankedItem> &
    Pick<UnifiedRankedItem, "id" | "source" | "title" | "summary">,
): UnifiedRankedItem {
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

describe("experience display helpers", () => {
  it("renders Chinese headings and type labels", () => {
    expect(EXPERIENCE_DISPLAY_HEADING).toBe("## 经验回忆");
    expect(getExperienceLayerHeading("sop")).toBe("## 操作经验");
    expect(getExperienceLayerHeading("key_decisions")).toBe("## 决策经验");
    expect(getExperienceLayerHeading("preferences")).toBe("## 偏好说明");
    expect(getExperienceLayerHeading("runtime_signals")).toBe("## 运行经验");
    expect(getExperienceLayerHeading("sources")).toBe("## 参考资料");
  });

  it("formats experience item labels in Chinese", () => {
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
      summary: "How to query and write experience notes.",
      memoryKind: "reference",
    });

    expect(getExperienceKindLabel(procedure)).toBe("操作经验");
    expect(getExperienceItemLabel(procedure)).toBe("【操作经验】");
    expect(formatExperienceTitle(procedure)).toBe("【操作经验】deployment-security-checklist");
    expect(getExperienceSourceLabel(procedure)).toBe("【参考来源】");
    expect(getExperienceKindLabel(reference)).toBe("参考资料");
    expect(getExperienceSourceLabel(reference)).toBe("【参考资料】");
  });
});
