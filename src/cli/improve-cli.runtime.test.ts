import { afterEach, describe, expect, it, vi } from "vitest";
import { saveImprovementProposal } from "../improvement/store.js";
import type { ImprovementProposal } from "../improvement/types.js";
import type { OutputRuntimeEnv } from "../runtime.js";
import { createTrackedTempDirs } from "../test-utils/tracked-temp-dirs.js";
import {
  runImproveInboxCommand,
  runImproveReviewCommand,
  type ImproveRuntimeDeps,
} from "./improve-cli.runtime.js";

const tempDirs = createTrackedTempDirs();

afterEach(async () => {
  await tempDirs.cleanup();
});

function createRuntime() {
  const logs: string[] = [];
  const json: unknown[] = [];
  const runtime: OutputRuntimeEnv = {
    log: (value) => logs.push(String(value)),
    error: (value) => logs.push(String(value)),
    exit: (code) => {
      throw new Error(`exit ${code}`);
    },
    writeStdout: (value) => logs.push(value),
    writeJson: (value) => json.push(value),
  };
  return { runtime, logs, json };
}

function deps(workspaceDir: string): ImproveRuntimeDeps {
  return {
    cwd: () => workspaceDir,
    loadConfig: vi.fn(() => ({}) as never),
  };
}

function proposal(id: string): ImprovementProposal {
  return {
    id,
    status: "pending_review",
    candidate: {
      id: `candidate-${id}`,
      sourceRefs: [{ kind: "experience", ref: `exp-${id}` }],
      signalSummary: "Repeated workflow diagnosis",
      observedFrequency: 2,
      currentReuseLevel: "experience",
      repeatedActions: ["Check registry"],
      validationEvidence: ["Validated"],
      firstSeenAt: 1,
      lastSeenAt: 2,
    },
    verdict: {
      candidateId: `candidate-${id}`,
      decision: "propose_skill",
      confidence: "high",
      riskLevel: "low",
      targetScope: "workspace",
      reasonsFor: ["Stable"],
      reasonsAgainst: [],
      missingEvidence: [],
      verificationPlan: ["Verify skill"],
    },
    patchPlan: {
      kind: "skill",
      targetDir: ".agents/skills",
      skillName: "workflow-diagnosis",
      markdown: "---\nname: workflow-diagnosis\ndescription: Use when diagnosing workflows.\n---\n",
    },
    policyResult: { allowed: true, blockers: [] },
    rollbackPlan: ["Delete the generated skill."],
    createdAt: 1,
    updatedAt: 2,
  };
}

describe("improve CLI runtime", () => {
  it("prints inbox JSON", async () => {
    const workspaceDir = await tempDirs.make("improve-cli-runtime-");
    await saveImprovementProposal({ workspaceDir }, proposal("p1"));
    const { runtime, json } = createRuntime();

    await runImproveInboxCommand({ json: true }, runtime, deps(workspaceDir));

    expect(json).toMatchObject([
      {
        proposals: [
          {
            id: "p1",
            kind: "skill",
            status: "pending_review",
          },
        ],
      },
    ]);
  });

  it("approves proposals through the product API", async () => {
    const workspaceDir = await tempDirs.make("improve-cli-review-");
    await saveImprovementProposal({ workspaceDir }, proposal("p2"));
    const { runtime, logs } = createRuntime();

    await runImproveReviewCommand(
      "p2",
      { approve: true, reviewer: "maintainer" },
      runtime,
      deps(workspaceDir),
    );

    expect(logs.join("\n")).toContain("approved");
  });
});
