import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { CrawClawConfig } from "../../config/config.js";
import { clearPluginManifestRegistryCache } from "../../plugins/manifest-registry.js";
import { writeSkill } from "../skills.e2e-test-helpers.js";
import { resolveSkillsPromptForRun } from "../skills.js";
import { clearAllSkillExposureStateForTest } from "../skills/exposure-state.js";
import { writePluginWithSkill } from "../test-helpers/skill-plugin-fixtures.js";
import {
  buildAvailableSkillsForHook,
  resolveSurfacedSkillsHookResult,
} from "./run/attempt.prompt-helpers.js";
import { resolveEmbeddedRunSkillEntries } from "./skills-runtime.js";

const tempDirs: string[] = [];
const originalBundledDir = process.env.CRAWCLAW_BUNDLED_PLUGINS_DIR;

async function createTempDir(prefix: string) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

async function setupBundledDiffsPlugin() {
  const bundledPluginsDir = await createTempDir("crawclaw-bundled-");
  const workspaceDir = await createTempDir("crawclaw-workspace-");
  const pluginRoot = path.join(bundledPluginsDir, "diffs");

  await writePluginWithSkill({
    pluginRoot,
    pluginId: "diffs",
    skillId: "diffs",
    skillDescription: "runtime integration test",
  });

  return { bundledPluginsDir, workspaceDir };
}

async function resolveBundledDiffsSkillEntries(config?: CrawClawConfig) {
  const { bundledPluginsDir, workspaceDir } = await setupBundledDiffsPlugin();
  process.env.CRAWCLAW_BUNDLED_PLUGINS_DIR = bundledPluginsDir;
  clearPluginManifestRegistryCache();

  return resolveEmbeddedRunSkillEntries({ workspaceDir, ...(config ? { config } : {}) });
}

afterEach(async () => {
  process.env.CRAWCLAW_BUNDLED_PLUGINS_DIR = originalBundledDir;
  clearPluginManifestRegistryCache();
  clearAllSkillExposureStateForTest();
  await Promise.all(
    tempDirs.splice(0, tempDirs.length).map((dir) => fs.rm(dir, { recursive: true, force: true })),
  );
});

describe("resolveEmbeddedRunSkillEntries (integration)", () => {
  it("loads bundled diffs skill when explicitly enabled in config", async () => {
    const config: CrawClawConfig = {
      plugins: {
        entries: {
          diffs: { enabled: true },
        },
      },
    };

    const result = await resolveBundledDiffsSkillEntries(config);

    expect(result.skillEntries.map((entry) => entry.skill.name)).toContain("diffs");
  });

  it("skips bundled diffs skill when config is missing", async () => {
    const result = await resolveBundledDiffsSkillEntries();

    expect(result.skillEntries.map((entry) => entry.skill.name)).not.toContain("diffs");
  });

  it("loads workspace skills, discovers the task-relevant skill, and filters the prompt", async () => {
    const workspaceDir = await createTempDir("crawclaw-skills-e2e-");
    await writeSkill({
      dir: path.join(workspaceDir, "skills", "release-risk"),
      name: "release-risk",
      description: "Use when validating deployment gates and release risk before launch.",
    });
    await writeSkill({
      dir: path.join(workspaceDir, "skills", "slack-update"),
      name: "slack-update",
      description: "Use when drafting an outbound Slack update after engineering work.",
    });

    const { skillEntries } = resolveEmbeddedRunSkillEntries({
      workspaceDir,
      prompt: "上线前把风险过一遍",
    });
    const surfacedSkillNames = await resolveSurfacedSkillsHookResult({
      purpose: "run",
      prompt: "上线前把风险过一遍",
      workspaceDir,
      availableSkills: buildAvailableSkillsForHook({ skillEntries }),
      hookCtx: { sessionId: "skills-e2e-session" },
      skillDiscoveryRerank: async ({ candidates }) => ({
        skillNames: candidates.some((candidate) => candidate.name === "release-risk")
          ? ["release-risk"]
          : [],
      }),
    });
    const skillsPrompt = resolveSkillsPromptForRun({
      entries: skillEntries,
      workspaceDir,
      skillFilter: surfacedSkillNames,
    });

    expect(surfacedSkillNames).toEqual(["release-risk"]);
    expect(skillsPrompt).toContain("<name>release-risk</name>");
    expect(skillsPrompt).toContain("<location>");
    expect(skillsPrompt).not.toContain("slack-update");
  });
});
