import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { CrawClawConfig } from "../../config/config.js";
import { discoverDynamicSkillDirsFromPrompt, withDynamicSkillExtraDirs } from "./dynamic-load.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map(async (dir) => fs.rm(dir, { recursive: true, force: true })),
  );
});

describe("discoverDynamicSkillDirsFromPrompt", () => {
  it("discovers nested skills directories from prompt path tokens", async () => {
    const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "crawclaw-dynamic-skills-"));
    tempDirs.push(workspaceDir);
    const sourceDir = path.join(workspaceDir, "apps", "alpha", "src");
    const skillsRoot = path.join(workspaceDir, "apps", "alpha", "skills", "demo");
    await fs.mkdir(sourceDir, { recursive: true });
    await fs.mkdir(skillsRoot, { recursive: true });
    await fs.writeFile(path.join(sourceDir, "index.ts"), "export {};\n", "utf8");
    await fs.writeFile(path.join(skillsRoot, "SKILL.md"), "# Demo\n", "utf8");

    const discovered = discoverDynamicSkillDirsFromPrompt({
      workspaceDir,
      prompt: '请处理 "apps/alpha/src/index.ts" 里的逻辑',
    });

    expect(discovered).toEqual([path.join(workspaceDir, "apps", "alpha", "skills")]);
  });

  it("does not discover paths outside workspace", async () => {
    const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "crawclaw-dynamic-skills-"));
    tempDirs.push(workspaceDir);

    const discovered = discoverDynamicSkillDirsFromPrompt({
      workspaceDir,
      prompt: "请读取 /tmp/external/project/src/index.ts",
    });

    expect(discovered).toEqual([]);
  });
});

describe("withDynamicSkillExtraDirs", () => {
  it("merges discovered extra dirs with existing runtime config", () => {
    const config: CrawClawConfig = {
      skills: {
        load: {
          extraDirs: [" /base/skills ", "/shared/skills"],
        },
      },
    };

    const merged = withDynamicSkillExtraDirs(config, ["/shared/skills", " /new/skills ", ""]);

    expect(merged).toEqual({
      skills: {
        load: {
          extraDirs: ["/base/skills", "/shared/skills", "/new/skills"],
        },
      },
    });
  });
});
