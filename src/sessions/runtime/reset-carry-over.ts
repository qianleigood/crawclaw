import type { SessionEntry } from "../../config/sessions/types.js";

export type ResetCarryOverProfile = "command-reset" | "gateway-reset";

const COMMAND_RESET_CARRY_OVER_FIELDS = [
  "thinkingLevel",
  "verboseLevel",
  "reasoningLevel",
  "ttsAuto",
  "providerOverride",
  "modelOverride",
  "authProfileOverride",
  "authProfileOverrideSource",
  "authProfileOverrideCompactionCount",
  "cliSessionIds",
  "cliSessionBindings",
  "claudeCliSessionId",
  "label",
  "spawnedBy",
  "spawnedWorkspaceDir",
  "parentSessionKey",
  "forkedFromParent",
  "spawnDepth",
  "subagentRole",
  "subagentControlScope",
  "displayName",
] as const satisfies readonly (keyof SessionEntry)[];

const GATEWAY_RESET_EXTRA_FIELDS = [
  "fastMode",
  "elevatedLevel",
  "execHost",
  "execSecurity",
  "execAsk",
  "execNode",
  "responseUsage",
  "groupActivation",
  "groupActivationNeedsSystemIntro",
  "chatType",
  "sendPolicy",
  "queueMode",
  "queueDebounceMs",
  "queueCap",
  "queueDrop",
  "channel",
  "groupId",
  "subject",
  "groupChannel",
  "space",
  "origin",
  "deliveryContext",
  "lastChannel",
  "lastTo",
  "lastAccountId",
  "lastThreadId",
  "skillsSnapshot",
  "acp",
] as const satisfies readonly (keyof SessionEntry)[];

function pickSessionFields(
  entry: SessionEntry,
  fields: readonly (keyof SessionEntry)[],
): Partial<SessionEntry> {
  return fields.reduce<Partial<SessionEntry>>((next, field) => {
    const value = entry[field];
    if (value !== undefined) {
      Object.assign(next, { [field]: value });
    }
    return next;
  }, {});
}

export function pickResetCarryOverFields(
  entry: SessionEntry | undefined,
  profile: ResetCarryOverProfile,
): Partial<SessionEntry> {
  if (!entry) {
    return {};
  }
  const fields =
    profile === "gateway-reset"
      ? [...COMMAND_RESET_CARRY_OVER_FIELDS, ...GATEWAY_RESET_EXTRA_FIELDS]
      : COMMAND_RESET_CARRY_OVER_FIELDS;
  return pickSessionFields(entry, fields);
}
