import type { CrawClawConfig } from "../../config/config.js";
import { loadWorkspaceSkillEntries, type SkillEntry, type SkillSnapshot } from "../skills.js";
import {
  discoverDynamicSkillDirsFromPrompt,
  withDynamicSkillExtraDirs,
} from "../skills/dynamic-load.js";
import { resolveSkillRuntimeConfig } from "../skills/runtime-config.js";

export function resolveEmbeddedRunSkillEntries(params: {
  workspaceDir: string;
  config?: CrawClawConfig;
  skillsSnapshot?: SkillSnapshot;
  prompt?: string;
}): {
  shouldLoadSkillEntries: boolean;
  skillEntries: SkillEntry[];
} {
  const shouldLoadSkillEntries = !params.skillsSnapshot || !params.skillsSnapshot.resolvedSkills;
  const runtimeConfig = resolveSkillRuntimeConfig(params.config);
  const dynamicSkillDirs = discoverDynamicSkillDirsFromPrompt({
    workspaceDir: params.workspaceDir,
    prompt: params.prompt,
  });
  const config = withDynamicSkillExtraDirs(runtimeConfig, dynamicSkillDirs);
  return {
    shouldLoadSkillEntries,
    skillEntries: shouldLoadSkillEntries
      ? loadWorkspaceSkillEntries(params.workspaceDir, { config })
      : [],
  };
}
