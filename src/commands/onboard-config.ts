import type { CrawClawConfig } from "../config/config.js";
import type { AgentConfig } from "../config/types.agents.js";
import type { DmScope } from "../config/types.base.js";
import type { ToolProfileId } from "../config/types.tools.js";

export const ONBOARDING_DEFAULT_DM_SCOPE: DmScope = "per-channel-peer";
export const ONBOARDING_DEFAULT_TOOLS_PROFILE: ToolProfileId = "coding";

const ONBOARDING_DEFAULT_MAIN_AGENT_ID = "main";
const ONBOARDING_DEFAULT_MAIN_AGENT_TOOLS = [
  "browser",
  "memory_manifest_read",
  "memory_note_read",
  "memory_note_write",
  "memory_note_edit",
  "memory_note_delete",
  "write_experience_note",
];

function appendUnique(list: string[] | undefined, values: readonly string[]): string[] {
  return Array.from(new Set([...(Array.isArray(list) ? list : []), ...values]));
}

function withDefaultMainAgentTools(agents: CrawClawConfig["agents"]): CrawClawConfig["agents"] {
  const list = agents?.list;
  if (!Array.isArray(list) || list.length === 0) {
    return {
      ...agents,
      list: [
        {
          id: ONBOARDING_DEFAULT_MAIN_AGENT_ID,
          tools: {
            alsoAllow: [...ONBOARDING_DEFAULT_MAIN_AGENT_TOOLS],
          },
        },
      ],
    };
  }

  let foundMain = false;
  const nextList = list.map((agent): AgentConfig => {
    if (agent.id.trim().toLowerCase() !== ONBOARDING_DEFAULT_MAIN_AGENT_ID) {
      return agent;
    }
    foundMain = true;
    if (Array.isArray(agent.tools?.allow)) {
      return agent;
    }
    return {
      ...agent,
      tools: {
        ...agent.tools,
        alsoAllow: appendUnique(agent.tools?.alsoAllow, ONBOARDING_DEFAULT_MAIN_AGENT_TOOLS),
      },
    };
  });

  return {
    ...agents,
    list: foundMain ? nextList : list,
  };
}

export function applyLocalSetupWorkspaceConfig(
  baseConfig: CrawClawConfig,
  workspaceDir: string,
): CrawClawConfig {
  return {
    ...baseConfig,
    agents: {
      ...withDefaultMainAgentTools(baseConfig.agents),
      defaults: {
        ...baseConfig.agents?.defaults,
        workspace: workspaceDir,
      },
    },
    gateway: {
      ...baseConfig.gateway,
      mode: "local",
    },
    session: {
      ...baseConfig.session,
      dmScope: baseConfig.session?.dmScope ?? ONBOARDING_DEFAULT_DM_SCOPE,
    },
    tools: {
      ...baseConfig.tools,
      profile: baseConfig.tools?.profile ?? ONBOARDING_DEFAULT_TOOLS_PROFILE,
    },
  };
}
