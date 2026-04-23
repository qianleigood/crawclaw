import { describe, expect, it } from "vitest";
import { searchSkillDescriptions } from "./search.js";

describe("searchSkillDescriptions", () => {
  it("matches skills by description instead of fixed intent families", () => {
    const results = searchSkillDescriptions({
      query: "Need to clean up review comments and prepare PR risk validation",
      availableSkills: [
        {
          name: "release-checklist",
          description: "Use when preparing release runbooks and deployment gates.",
          location: "/skills/release-checklist/SKILL.md",
        },
        {
          name: "pr-review",
          description:
            "Use when addressing pull request review comments, summarizing reviewer asks, and validating PR risk.",
          location: "/skills/pr-review/SKILL.md",
        },
      ],
      limit: 3,
    });

    expect(results.map((result) => result.name)).toEqual(["pr-review"]);
  });

  it("excludes already visible or loaded skills", () => {
    const results = searchSkillDescriptions({
      query: "deploy and write release notes",
      availableSkills: [
        {
          name: "deploy-runbook",
          description: "Use when deploying services.",
          location: "/skills/deploy-runbook/SKILL.md",
        },
        {
          name: "release-notes",
          description: "Use when writing release notes after deployment.",
          location: "/skills/release-notes/SKILL.md",
        },
      ],
      excludeSkillNames: ["deploy-runbook"],
      limit: 3,
    });

    expect(results.map((result) => result.name)).toEqual(["release-notes"]);
  });
});
