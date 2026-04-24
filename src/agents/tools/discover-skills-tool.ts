import { Type } from "@sinclair/typebox";
import type { CrawClawConfig } from "../../config/config.js";
import { loadWorkspaceSkillEntries } from "../skills.js";
import { withDiscoveredSkillExtraDirs } from "../skills/discover-from-paths.js";
import {
  discoverSkillsForTask,
  renderSkillDiscoveryReminder,
  type SkillSemanticRetriever,
} from "../skills/discovery.js";
import { getDiscoveredSkillDirs } from "../skills/dynamic-discovery-state.js";
import { getSkillExposureState, recordDiscoveredSkills } from "../skills/exposure-state.js";
import { resolveSkillRuntimeConfig } from "../skills/runtime-config.js";
import {
  jsonResult,
  readNumberParam,
  readRecordParam,
  readStringParam,
  type AnyAgentTool,
} from "./common.js";

export function createDiscoverSkillsTool(options: {
  workspaceDir: string;
  config?: CrawClawConfig;
  sessionId?: string;
  sessionKey?: string;
  semanticRetrieve?: SkillSemanticRetriever;
}): AnyAgentTool {
  return {
    label: "Discover Skills",
    name: "discover_skills",
    description:
      "Search available CrawClaw skills for the current task. Use when surfaced skills do not cover a pivot, unusual workflow, or multi-step plan.",
    parameters: Type.Object({
      taskDescription: Type.String({
        description: "Specific description of what you are about to do next.",
      }),
      limit: Type.Optional(
        Type.Number({
          description: "Maximum number of skills to return. Defaults to 5.",
        }),
      ),
    }),
    execute: async (_toolCallId, params) => {
      const record = readRecordParam(params);
      const taskDescription = readStringParam(record, "taskDescription", {
        required: true,
        label: "taskDescription",
      });
      const rawLimit = readNumberParam(record, "limit", {
        integer: true,
      });
      const scope = {
        sessionId: options.sessionId,
        sessionKey: options.sessionKey,
      };
      const runtimeConfig = resolveSkillRuntimeConfig(options.config);
      const config = withDiscoveredSkillExtraDirs(runtimeConfig, getDiscoveredSkillDirs(scope));
      const entries = loadWorkspaceSkillEntries(options.workspaceDir, { config });
      const exposureState = getSkillExposureState(scope);
      const excludeSkillNames = [
        ...(exposureState?.surfacedSkillNames ?? []),
        ...(exposureState?.loadedSkillNames ?? []),
      ];
      const discovery = await discoverSkillsForTask({
        taskDescription,
        availableSkills: entries
          .filter((entry) => entry.invocation?.disableModelInvocation !== true)
          .map((entry) => ({
            name: entry.skill.name,
            description: entry.skill.description,
            location: entry.skill.filePath,
          })),
        excludeSkillNames,
        limit: rawLimit,
        signal: "next_action",
        semanticRetrieve: options.semanticRetrieve,
      });
      const skillNames = discovery.skills.map((skill) => skill.name);
      if (skillNames.length > 0) {
        recordDiscoveredSkills({
          scope,
          surfacedSkillNames: exposureState?.surfacedSkillNames,
          discoveredSkillNames: skillNames,
        });
      }
      return jsonResult({
        status: "ok",
        skills: discovery.skills,
        reason: discovery.reason,
        source: discovery.source,
        reminder: renderSkillDiscoveryReminder(discovery),
      });
    },
  };
}
