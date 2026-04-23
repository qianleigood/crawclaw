import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  createSkillSemanticRetriever,
  clearSkillSemanticRetrievalCache,
} from "./semantic-retrieval.js";

function makeEmbeddingProvider() {
  const embedBatch = vi.fn(async (texts: string[]) =>
    texts.map((text) => {
      if (/risk|release/i.test(text)) {
        return [1, 0];
      }
      if (/slack/i.test(text)) {
        return [0, 1];
      }
      return [0.2, 0.2];
    }),
  );
  const embedQuery = vi.fn(async (text: string) => {
    if (/上线|风险|risk/i.test(text)) {
      return [1, 0];
    }
    return [0, 1];
  });
  return {
    id: "fake",
    model: "fake-embed",
    embedBatch,
    embedQuery,
  };
}

const skills = [
  {
    name: "release-risk",
    description: "Use when validating deployment gates and launch risk before release.",
    location: path.join("skills", "release-risk", "SKILL.md"),
  },
  {
    name: "slack-update",
    description: "Use when drafting Slack status updates.",
    location: path.join("skills", "slack-update", "SKILL.md"),
  },
];

describe("createSkillSemanticRetriever", () => {
  it("returns vector-ranked skills and reuses the in-memory index for the same snapshot", async () => {
    clearSkillSemanticRetrievalCache();
    const provider = makeEmbeddingProvider();
    const retriever = createSkillSemanticRetriever({
      workspaceDir: "/repo",
      provider: "fake",
      model: "fake-embed",
      snapshotVersion: 1,
      createEmbeddingProvider: async () => provider,
    });

    const first = await retriever({
      taskDescription: "上线前把风险过一遍",
      availableSkills: skills,
      limit: 1,
      recallLimit: 2,
    });
    const second = await retriever({
      taskDescription: "risk review",
      availableSkills: skills,
      limit: 1,
      recallLimit: 2,
    });

    expect(first.map((skill) => skill.name)).toEqual(["release-risk"]);
    expect(first[0]).toMatchObject({ semanticScore: 1, semanticSource: "vector" });
    expect(second.map((skill) => skill.name)).toEqual(["release-risk"]);
    expect(provider.embedBatch).toHaveBeenCalledTimes(1);
    expect(provider.embedQuery).toHaveBeenCalledTimes(2);
  });

  it("rebuilds the in-memory index when the skill snapshot version changes", async () => {
    clearSkillSemanticRetrievalCache();
    const provider = makeEmbeddingProvider();
    const createEmbeddingProvider = vi.fn(async () => provider);

    const firstRetriever = createSkillSemanticRetriever({
      workspaceDir: "/repo",
      provider: "fake",
      model: "fake-embed",
      snapshotVersion: 1,
      createEmbeddingProvider,
    });
    const secondRetriever = createSkillSemanticRetriever({
      workspaceDir: "/repo",
      provider: "fake",
      model: "fake-embed",
      snapshotVersion: 2,
      createEmbeddingProvider,
    });

    await firstRetriever({
      taskDescription: "risk",
      availableSkills: skills,
      limit: 1,
      recallLimit: 2,
    });
    await secondRetriever({
      taskDescription: "risk",
      availableSkills: skills,
      limit: 1,
      recallLimit: 2,
    });

    expect(provider.embedBatch).toHaveBeenCalledTimes(2);
  });
});
