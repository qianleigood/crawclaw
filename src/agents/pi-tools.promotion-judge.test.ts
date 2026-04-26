import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createTrackedTempDirs } from "../test-utils/tracked-temp-dirs.js";
import { createCrawClawCodingTools } from "./pi-tools.js";

const tempDirs = createTrackedTempDirs();

afterEach(async () => {
  await tempDirs.cleanup();
});

describe("pi-tools promotion judge gating", () => {
  it("exposes submit_promotion_verdict while runtime-denying unrelated tools", async () => {
    const workspaceDir = await tempDirs.make("pi-tools-promotion-judge-");
    const tools = createCrawClawCodingTools({
      workspaceDir,
      specialAgentSpawnSource: "promotion-judge",
    });
    const toolNames = tools.map((tool) => tool.name);

    expect(toolNames).toContain("submit_promotion_verdict");

    const verdictTool = tools.find((tool) => tool.name === "submit_promotion_verdict");
    expect(verdictTool).toBeDefined();
    const result = await verdictTool!.execute?.("call-promotion-verdict", {
      candidateId: "candidate-1",
      decision: "propose_skill",
      confidence: "high",
      riskLevel: "low",
      targetScope: "workspace",
      triggerPattern: "workflow 执行异常",
      reusableMethod: "先查 registry，再查 operations。",
      reasonsFor: ["重复出现"],
      reasonsAgainst: [],
      missingEvidence: [],
      verificationPlan: ["验证提案结构"],
    });
    expect(result).toMatchObject({
      details: {
        status: "ok",
        candidateId: "candidate-1",
        decision: "propose_skill",
      },
    });

    const blockedTool = tools.find((tool) => tool.name === "write");
    expect(blockedTool).toBeDefined();
    await expect(
      blockedTool!.execute?.("call-promotion-write-blocked", {
        file_path: path.join(workspaceDir, "blocked.txt"),
        content: "should-not-run",
      }),
    ).rejects.toThrow('Tool "write" is not allowed for this special-agent run');
  });

  it("keeps the verdict tool even when config allowlists other tools", async () => {
    const workspaceDir = await tempDirs.make("pi-tools-promotion-judge-policy-");
    const tools = createCrawClawCodingTools({
      workspaceDir,
      specialAgentSpawnSource: "promotion-judge",
      config: {
        tools: {
          allow: ["read"],
        },
      } as never,
    });

    expect(tools.map((tool) => tool.name)).toContain("submit_promotion_verdict");
  });
});
