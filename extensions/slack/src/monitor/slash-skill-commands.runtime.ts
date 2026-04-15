import { listSkillCommandsForAgents as listSkillCommandsForAgentsImpl } from "crawclaw/plugin-sdk/command-auth";

type ListSkillCommandsForAgents =
  typeof import("crawclaw/plugin-sdk/command-auth").listSkillCommandsForAgents;

export function listSkillCommandsForAgents(
  ...args: Parameters<ListSkillCommandsForAgents>
): ReturnType<ListSkillCommandsForAgents> {
  return listSkillCommandsForAgentsImpl(...args);
}
