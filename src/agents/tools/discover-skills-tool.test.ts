import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { getSkillExposureState } from "../skills/exposure-state.js";
import { createDiscoverSkillsTool } from "./discover-skills-tool.js";

const tempDirs: string[] = [];

async function writeSkill(params: {
  root: string;
  name: string;
  description: string;
}): Promise<void> {
  const skillDir = path.join(params.root, "skills", params.name);
  await fs.mkdir(skillDir, { recursive: true });
  await fs.writeFile(
    path.join(skillDir, "SKILL.md"),
    `---\nname: ${params.name}\ndescription: ${params.description}\n---\n\nInstructions.\n`,
  );
}

describe("createDiscoverSkillsTool", () => {
  afterEach(async () => {
    await Promise.all(
      tempDirs.splice(0).map(async (dir) => await fs.rm(dir, { recursive: true, force: true })),
    );
  });

  it("returns matching skills and records them as discovered for the session", async () => {
    const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "crawclaw-discover-skills-"));
    tempDirs.push(workspaceDir);
    await writeSkill({
      root: workspaceDir,
      name: "pr-review",
      description: "Use when addressing pull request review comments and validating PR risk.",
    });
    await writeSkill({
      root: workspaceDir,
      name: "deploy-runbook",
      description: "Use when deploying production services.",
    });

    const tool = createDiscoverSkillsTool({
      workspaceDir,
      sessionId: "discover-tool-session",
    });

    const result = await tool.execute("call-1", {
      taskDescription: "clean up PR review comments and check risk",
      limit: 1,
    });

    expect(result.details).toMatchObject({
      status: "ok",
      skills: [
        expect.objectContaining({
          name: "pr-review",
          location: path.join(workspaceDir, "skills", "pr-review", "SKILL.md"),
        }),
      ],
    });
    expect(
      getSkillExposureState({ sessionId: "discover-tool-session" })?.discoveredSkillNames,
    ).toEqual(["pr-review"]);
  });
});
