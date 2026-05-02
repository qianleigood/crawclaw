import { describe, expect, it } from "vitest";
import {
  renderAgentMemoryRoutingContract,
  renderContextRoutingSection,
  resolveMemoryRoutingContractMode,
} from "./render-routing-guidance.ts";

describe("renderRoutingGuidance", () => {
  it("renders a Chinese experience recall contract", () => {
    const contract = renderAgentMemoryRoutingContract();
    expect(contract.text).toContain(
      "经验回忆提供的是回忆到的操作经验、决策经验、运行经验和参考资料",
    );
    expect(contract.text).toContain("前台的经验回忆应来自当前配置的经验提供方");
    expect(contract.text).toContain("本地 SKILL.md 文件");
    expect(contract.text).toContain("优先在当前回合显式调用这些工具");
  });

  it("renders a session-summary-only contract without durable or experience rules", () => {
    const contract = renderAgentMemoryRoutingContract({ mode: "session-summary" });

    expect(contract.text).toContain("Session memory");
    expect(contract.text).toContain("只维护当前 session summary");
    expect(contract.text).toContain("不要把 session memory 更新过程写入 summary");
    expect(contract.text).toContain("保持 summary 文件既有结构");
    expect(contract.text).not.toContain("Durable memory 用来保存");
    expect(contract.text).not.toContain("Experience memory 用来保存");
    expect(contract.text).not.toContain("write_experience_note");
    expect(contract.text).not.toContain("MEMORY.md");
  });

  it("renders a durable-memory-only contract for durable memory special agents", () => {
    expect(resolveMemoryRoutingContractMode({ specialAgentSpawnSource: "durable-memory" })).toBe(
      "durable-memory",
    );

    const contract = renderAgentMemoryRoutingContract({ mode: "durable-memory" });

    expect(contract.text).toContain("Durable memory agent 只维护当前 durable memory scope");
    expect(contract.text).toContain(
      "只根据 forked parent conversation 中最近的 model-visible messages",
    );
    expect(contract.text).toContain("不要写 Experience memory");
    expect(contract.text).not.toContain("Experience memory 用来保存");
    expect(contract.text).not.toContain("write_experience_note");
    expect(contract.text).not.toContain("本地 SKILL.md 文件");
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
