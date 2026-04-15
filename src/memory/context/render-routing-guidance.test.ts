import { describe, expect, it } from "vitest";
import { renderAgentMemoryRoutingContract, renderContextRoutingSection } from "./render-routing-guidance.ts";

describe("renderRoutingGuidance", () => {
  it("renders a Chinese knowledge recall contract", () => {
    const contract = renderAgentMemoryRoutingContract();
    expect(contract.text).toContain("知识回忆提供的是回忆到的操作流程、决策说明、运行规律和参考资料");
    expect(contract.text).toContain("前台的知识回忆应来自当前配置的知识提供方");
    expect(contract.text).toContain("本地 SKILL.md 文件");
    expect(contract.text).toContain("优先在当前回合显式调用 durable memory 工具，不要只口头答应");
  });

  it("renders a Chinese context routing section", () => {
    const section = renderContextRoutingSection({
      query: "how do I deploy safely",
      normalizedQuery: "how do I deploy safely",
      intent: "sop",
      secondaryIntents: [],
      confidence: 0.9,
      keywords: ["deploy"],
      entityHints: [],
      temporalHints: [],
      routeWeights: { graph: 0.2, notebooklm: 0.4, nativeMemory: 0.2, execution: 0.2 },
      targetLayers: ["sop", "sources"],
      rationale: [],
    });

    expect(section?.text).toContain("## 上下文路由");
    expect(section?.text).toContain("- 意图: sop");
    expect(section?.text).toContain("- 优先层: sop, sources");
  });
});
