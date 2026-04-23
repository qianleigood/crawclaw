import { describe, expect, it, vi } from "vitest";
import {
  discoverSkillsForTask,
  renderSkillDiscoveryReminder,
  type SkillDiscoveryCandidate,
  type SkillDiscoveryRerankRequest,
} from "./discovery.js";

const availableSkills: SkillDiscoveryCandidate[] = [
  {
    name: "ci-fix",
    description: "Use when debugging failing CI checks and fixing build or test failures.",
    location: "/skills/ci-fix/SKILL.md",
  },
  {
    name: "slack-update",
    description: "Use when drafting an outbound Slack update after engineering work.",
    location: "/skills/slack-update/SKILL.md",
  },
  {
    name: "release-risk",
    description: "Use when validating deployment gates and release risk before launch.",
    location: "/skills/release-risk/SKILL.md",
  },
];

describe("discoverSkillsForTask", () => {
  it("uses lexical recall for the current next action and excludes already visible skills", async () => {
    const result = await discoverSkillsForTask({
      taskDescription: "draft a Slack update after fixing the failing checks",
      availableSkills,
      excludeSkillNames: ["ci-fix"],
      limit: 2,
      signal: "next_action",
    });

    expect(result.signal).toBe("next_action");
    expect(result.source).toBe("native");
    expect(result.skills.map((skill) => skill.name)).toEqual(["slack-update"]);
  });

  it("lets an LLM reranker recover a semantic match from the recalled candidate pool", async () => {
    const rerank = vi.fn(async () => ({
      skillNames: ["release-risk", "not-a-real-skill"],
      reason: "release risk is the closest workflow",
      confidence: 0.82,
    }));

    const result = await discoverSkillsForTask({
      taskDescription: "上线前把风险过一遍",
      availableSkills,
      limit: 2,
      signal: "turn_zero",
      rerank,
    });

    expect(rerank).toHaveBeenCalledWith(
      expect.objectContaining({
        taskDescription: "上线前把风险过一遍",
        candidates: expect.arrayContaining([expect.objectContaining({ name: "release-risk" })]),
      }),
    );
    expect(result.source).toBe("llm");
    expect(result.reason).toBe("release risk is the closest workflow");
    expect(result.confidence).toBe(0.82);
    expect(result.skills.map((skill) => skill.name)).toEqual(["release-risk"]);
  });

  it("passes semantic matches to rerankers even when lexical search has no overlap", async () => {
    const rerank = vi.fn(async ({ candidates }: SkillDiscoveryRerankRequest) => ({
      skillNames: candidates.map((candidate) => candidate.name),
    }));

    const result = await discoverSkillsForTask({
      taskDescription: "上线前把风险过一遍",
      availableSkills,
      limit: 1,
      signal: "turn_zero",
      semanticRetrieve: async () => [
        {
          ...availableSkills[2]!,
          semanticScore: 0.91,
          semanticSource: "vector",
        },
      ],
      rerank,
    });

    expect(rerank).toHaveBeenCalledWith(
      expect.objectContaining({
        candidates: [
          expect.objectContaining({
            name: "release-risk",
            semanticScore: 0.91,
            semanticSource: "vector",
          }),
        ],
      }),
    );
    expect(result.source).toBe("llm");
    expect(result.skills.map((skill) => skill.name)).toEqual(["release-risk"]);
    expect(result.skills[0]).toMatchObject({
      semanticScore: 0.91,
      semanticSource: "vector",
    });
  });

  it("falls back to lexical matches when semantic retrieval fails", async () => {
    const result = await discoverSkillsForTask({
      taskDescription: "fix failing CI",
      availableSkills,
      limit: 2,
      semanticRetrieve: async () => {
        throw new Error("embedding unavailable");
      },
    });

    expect(result.source).toBe("native");
    expect(result.skills.map((skill) => skill.name)).toEqual(["ci-fix"]);
  });

  it("prefers semantic candidates and uses lexical matches to fill rerank recall", async () => {
    const seenNames: string[][] = [];
    await discoverSkillsForTask({
      taskDescription: "deployment workflow slack",
      availableSkills,
      limit: 2,
      recallLimit: 3,
      semanticRetrieve: async () => [
        {
          ...availableSkills[2]!,
          semanticScore: 0.88,
          semanticSource: "vector",
        },
      ],
      rerank: async ({ candidates }) => {
        seenNames.push(candidates.map((candidate) => candidate.name));
        return { skillNames: candidates.map((candidate) => candidate.name) };
      },
    });

    expect(seenNames[0]).toEqual(["release-risk", "slack-update"]);
  });

  it("passes a wider recall set to rerankers than the final surfaced limit", async () => {
    const candidates = Array.from({ length: 12 }, (_, index) => ({
      name: `candidate-${index}`,
      description: `shared deployment workflow ${index}`,
      location: `/skills/candidate-${index}/SKILL.md`,
    }));

    let seenCandidateCount = 0;
    await discoverSkillsForTask({
      taskDescription: "deployment workflow",
      availableSkills: candidates,
      limit: 2,
      recallLimit: 12,
      rerank: async ({ candidates }) => {
        seenCandidateCount = candidates.length;
        return { skillNames: ["candidate-11"] };
      },
    });

    expect(seenCandidateCount).toBe(12);
  });

  it("falls back to native matches when reranking fails", async () => {
    const result = await discoverSkillsForTask({
      taskDescription: "fix failing CI",
      availableSkills,
      limit: 2,
      rerank: async () => {
        throw new Error("rerank unavailable");
      },
    });

    expect(result.source).toBe("native");
    expect(result.skills.map((skill) => skill.name)).toEqual(["ci-fix"]);
  });

  it("keeps semantic native candidates when reranking fails", async () => {
    const result = await discoverSkillsForTask({
      taskDescription: "上线前把风险过一遍",
      availableSkills,
      limit: 1,
      semanticRetrieve: async () => [
        {
          ...availableSkills[2]!,
          semanticScore: 0.9,
          semanticSource: "vector",
        },
      ],
      rerank: async () => {
        throw new Error("rerank unavailable");
      },
    });

    expect(result.source).toBe("native");
    expect(result.skills.map((skill) => skill.name)).toEqual(["release-risk"]);
  });
});

describe("renderSkillDiscoveryReminder", () => {
  it("renders Claude-style relevant skill reminders without exposing unrelated skills", () => {
    const reminder = renderSkillDiscoveryReminder({
      signal: "turn_zero",
      source: "native",
      skills: [
        {
          name: "ci-fix",
          description: "Use when debugging failing CI checks.",
          location: "/skills/ci-fix/SKILL.md",
          score: 1,
          reasons: ["description_terms"],
          source: "native",
        },
      ],
    });

    expect(reminder).toContain("Skills relevant to your task:");
    expect(reminder).toContain("- ci-fix: Use when debugging failing CI checks.");
    expect(reminder).toContain("read its SKILL.md");
    expect(reminder).not.toContain("slack-update");
  });
});
