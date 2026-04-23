import type { CrawClawConfig } from "../../config/config.js";
import { loadWorkspaceSkillEntries, type SkillEntry } from "../skills.js";
import { withDiscoveredSkillExtraDirs } from "../skills/discover-from-paths.js";
import { getDiscoveredSkillDirs } from "../skills/dynamic-discovery-state.js";
import { resolveSkillRuntimeConfig } from "../skills/runtime-config.js";

export function resolveEmbeddedRunSkillEntries(params: {
  workspaceDir: string;
  config?: CrawClawConfig;
  sessionId?: string;
  sessionKey?: string;
  prompt?: string;
}): {
  skillEntries: SkillEntry[];
} {
  const runtimeConfig = resolveSkillRuntimeConfig(params.config);
  const config = withDiscoveredSkillExtraDirs(
    runtimeConfig,
    getDiscoveredSkillDirs({
      sessionId: params.sessionId,
      sessionKey: params.sessionKey,
    }),
  );
  return {
    skillEntries: loadWorkspaceSkillEntries(params.workspaceDir, { config }),
  };
}
