import { describe, expect, it } from "vitest";
import { resolveSkillsPromptForRun } from "./skills.js";
import { createCanonicalFixtureSkill } from "./skills.test-helpers.js";
import type { SkillEntry } from "./skills/types.js";

describe("resolveSkillsPromptForRun", () => {
  it("builds prompt from current entries", () => {
    const entry: SkillEntry = {
      skill: createFixtureSkill({
        name: "demo-skill",
        description: "Demo",
        filePath: "/app/skills/demo-skill/SKILL.md",
        baseDir: "/app/skills/demo-skill",
        source: "crawclaw-bundled",
      }),
      frontmatter: {},
    };
    const prompt = resolveSkillsPromptForRun({
      entries: [entry],
      workspaceDir: "/tmp/crawclaw",
    });
    expect(prompt).toContain("<available_skills>");
    expect(prompt).toContain("/app/skills/demo-skill/SKILL.md");
  });

  it("filters prompt entries when skillFilter is provided", () => {
    const keep: SkillEntry = {
      skill: createFixtureSkill({
        name: "keep-skill",
        description: "Keep",
        filePath: "/app/skills/keep-skill/SKILL.md",
        baseDir: "/app/skills/keep-skill",
        source: "crawclaw-bundled",
      }),
      frontmatter: {},
    };
    const drop: SkillEntry = {
      skill: createFixtureSkill({
        name: "drop-skill",
        description: "Drop",
        filePath: "/app/skills/drop-skill/SKILL.md",
        baseDir: "/app/skills/drop-skill",
        source: "crawclaw-bundled",
      }),
      frontmatter: {},
    };
    const prompt = resolveSkillsPromptForRun({
      entries: [keep, drop],
      workspaceDir: "/tmp/crawclaw",
      skillFilter: ["keep-skill"],
    });
    expect(prompt).toContain("keep-skill");
    expect(prompt).not.toContain("drop-skill");
  });
});

function createFixtureSkill(params: {
  name: string;
  description: string;
  filePath: string;
  baseDir: string;
  source: string;
}): SkillEntry["skill"] {
  return createCanonicalFixtureSkill(params);
}
