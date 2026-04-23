import fs from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withEnv } from "../test-utils/env.js";
import { createFixtureSuite } from "../test-utils/fixture-suite.js";
import { writeSkill } from "./skills.e2e-test-helpers.js";
import { buildWorkspaceSkillsPrompt } from "./skills.js";

const fixtureSuite = createFixtureSuite("crawclaw-skills-prompt-suite-");
let truncationWorkspaceTemplateDir = "";
let nestedRepoTemplateDir = "";

beforeAll(async () => {
  await fixtureSuite.setup();
  truncationWorkspaceTemplateDir = await fixtureSuite.createCaseDir(
    "template-truncation-workspace",
  );
  for (let i = 0; i < 8; i += 1) {
    const name = `skill-${String(i).padStart(2, "0")}`;
    await writeSkill({
      dir: path.join(truncationWorkspaceTemplateDir, "skills", name),
      name,
      description: "x".repeat(800),
    });
  }

  nestedRepoTemplateDir = await fixtureSuite.createCaseDir("template-skills-repo");
  for (let i = 0; i < 8; i += 1) {
    const name = `repo-skill-${String(i).padStart(2, "0")}`;
    await writeSkill({
      dir: path.join(nestedRepoTemplateDir, "skills", name),
      name,
      description: `Desc ${i}`,
    });
  }
});

afterAll(async () => {
  await fixtureSuite.cleanup();
});

function withWorkspaceHome<T>(workspaceDir: string, cb: () => T): T {
  return withEnv({ HOME: workspaceDir, PATH: "" }, cb);
}

function buildPrompt(
  workspaceDir: string,
  options?: Parameters<typeof buildWorkspaceSkillsPrompt>[1],
) {
  return withWorkspaceHome(workspaceDir, () =>
    buildWorkspaceSkillsPrompt(workspaceDir, {
      managedSkillsDir: path.join(workspaceDir, ".managed"),
      bundledSkillsDir: path.join(workspaceDir, ".bundled"),
      ...options,
    }),
  );
}

async function cloneTemplateDir(templateDir: string, prefix: string): Promise<string> {
  const cloned = await fixtureSuite.createCaseDir(prefix);
  await fs.cp(templateDir, cloned, { recursive: true });
  return cloned;
}

function expectPromptNames(prompt: string, params: { contains?: string[]; omits?: string[] }) {
  for (const name of params.contains ?? []) {
    expect(prompt).toContain(name);
  }
  for (const name of params.omits ?? []) {
    expect(prompt).not.toContain(name);
  }
}

describe("buildWorkspaceSkillsPrompt", () => {
  it("returns an empty prompt when skills dirs are missing", async () => {
    const workspaceDir = await fixtureSuite.createCaseDir("workspace");

    const prompt = buildPrompt(workspaceDir);

    expect(prompt).toBe("");
  });

  it("omits disable-model-invocation skills from the prompt", async () => {
    const workspaceDir = await fixtureSuite.createCaseDir("workspace");
    await writeSkill({
      dir: path.join(workspaceDir, "skills", "visible-skill"),
      name: "visible-skill",
      description: "Visible skill",
    });
    await writeSkill({
      dir: path.join(workspaceDir, "skills", "hidden-skill"),
      name: "hidden-skill",
      description: "Hidden skill",
      frontmatterExtra: "disable-model-invocation: true",
    });

    const prompt = buildPrompt(workspaceDir);

    expect(prompt).toContain("visible-skill");
    expect(prompt).not.toContain("hidden-skill");
  });

  it("truncates the skills prompt when it exceeds the configured char budget", async () => {
    const workspaceDir = await cloneTemplateDir(truncationWorkspaceTemplateDir, "workspace");

    const prompt = withWorkspaceHome(workspaceDir, () =>
      buildWorkspaceSkillsPrompt(workspaceDir, {
        config: {
          skills: {
            limits: {
              maxSkillsInPrompt: 100,
              maxSkillsPromptChars: 500,
            },
          },
        },
        managedSkillsDir: path.join(workspaceDir, ".managed"),
        bundledSkillsDir: path.join(workspaceDir, ".bundled"),
      }),
    );

    expect(prompt).toContain("⚠️ Skills truncated");
    expect(prompt.length).toBeLessThan(2000);
  });

  it("limits discovery for nested repo-style skills roots (dir/skills/*)", async () => {
    const workspaceDir = await fixtureSuite.createCaseDir("workspace");
    const repoDir = await cloneTemplateDir(nestedRepoTemplateDir, "skills-repo");

    const prompt = withWorkspaceHome(workspaceDir, () =>
      buildWorkspaceSkillsPrompt(workspaceDir, {
        config: {
          skills: {
            load: {
              extraDirs: [repoDir],
            },
            limits: {
              maxCandidatesPerRoot: 5,
              maxSkillsLoadedPerSource: 5,
            },
          },
        },
        managedSkillsDir: path.join(workspaceDir, ".managed"),
        bundledSkillsDir: path.join(workspaceDir, ".bundled"),
      }),
    );

    expect(prompt).toContain("repo-skill-00");
    expect(prompt).not.toContain("repo-skill-07");
  });

  it("skips skills whose SKILL.md exceeds maxSkillFileBytes", async () => {
    const workspaceDir = await fixtureSuite.createCaseDir("workspace");

    await writeSkill({
      dir: path.join(workspaceDir, "skills", "small-skill"),
      name: "small-skill",
      description: "Small",
    });

    await writeSkill({
      dir: path.join(workspaceDir, "skills", "big-skill"),
      name: "big-skill",
      description: "Big",
      body: "x".repeat(5_000),
    });

    const prompt = buildPrompt(workspaceDir, {
      config: {
        skills: {
          limits: {
            maxSkillFileBytes: 1000,
          },
        },
      },
    });

    expectPromptNames(prompt, {
      contains: ["small-skill"],
      omits: ["big-skill"],
    });
  });

  it("detects nested skills roots beyond the first 25 entries", async () => {
    const workspaceDir = await fixtureSuite.createCaseDir("workspace");
    const repoDir = await fixtureSuite.createCaseDir("skills-repo");

    // Create 30 nested dirs, but only the last one is an actual skill.
    for (let i = 0; i < 30; i += 1) {
      await fs.mkdir(path.join(repoDir, "skills", `entry-${String(i).padStart(2, "0")}`), {
        recursive: true,
      });
    }

    await writeSkill({
      dir: path.join(repoDir, "skills", "entry-29"),
      name: "late-skill",
      description: "Nested skill discovered late",
    });

    const prompt = buildPrompt(workspaceDir, {
      config: {
        skills: {
          load: {
            extraDirs: [repoDir],
          },
          limits: {
            maxCandidatesPerRoot: 30,
            maxSkillsLoadedPerSource: 30,
          },
        },
      },
    });

    expectPromptNames(prompt, {
      contains: ["late-skill"],
    });
  });

  it("enforces maxSkillFileBytes for root-level SKILL.md", async () => {
    const workspaceDir = await fixtureSuite.createCaseDir("workspace");
    const rootSkillDir = await fixtureSuite.createCaseDir("root-skill");

    await writeSkill({
      dir: rootSkillDir,
      name: "root-big-skill",
      description: "Big",
      body: "x".repeat(5_000),
    });

    const prompt = buildPrompt(workspaceDir, {
      config: {
        skills: {
          load: {
            extraDirs: [rootSkillDir],
          },
          limits: {
            maxSkillFileBytes: 1000,
          },
        },
      },
    });

    expectPromptNames(prompt, {
      omits: ["root-big-skill"],
    });
  });
});
