import { buildCommandsMessage, buildHelpMessage, buildToolsMessage } from "../status.js";
import { buildStatusReply } from "./commands-status.js";
import type { CommandHandler } from "./commands-types.js";

export const handleHelpCommand: CommandHandler = async (params) => {
  if (params.command.commandBodyNormalized !== "/help") {
    return null;
  }
  return { shouldContinue: false, reply: { text: buildHelpMessage(params.cfg) } };
};

export const handleCommandsListCommand: CommandHandler = async (params) => {
  if (params.command.commandBodyNormalized !== "/commands") {
    return null;
  }
  return {
    shouldContinue: false,
    reply: { text: buildCommandsMessage(params.cfg, params.skillCommands) },
  };
};

export const handleToolsCommand: CommandHandler = async (params) => {
  if (params.command.commandBodyNormalized !== "/tools") {
    return null;
  }
  return { shouldContinue: false, reply: { text: buildToolsMessage() } };
};

export const handleStatusCommand: CommandHandler = async (params) => {
  if (params.command.commandBodyNormalized !== "/status") {
    return null;
  }
  const reply = await buildStatusReply({
    cfg: params.cfg,
    command: params.command,
    sessionEntry: params.sessionEntry,
    sessionKey: params.sessionKey,
    parentSessionKey: params.sessionEntry?.parentSessionKey,
    sessionScope: params.sessionScope,
    storePath: params.storePath,
    provider: params.provider,
    model: params.model,
    contextTokens: params.contextTokens,
    resolvedThinkLevel: params.resolvedThinkLevel,
    resolvedVerboseLevel: params.resolvedVerboseLevel,
    resolvedReasoningLevel: params.resolvedReasoningLevel,
    resolvedElevatedLevel: params.resolvedElevatedLevel,
    resolveDefaultThinkingLevel: params.resolveDefaultThinkingLevel,
    isGroup: params.isGroup,
    defaultGroupActivation: params.defaultGroupActivation,
  });
  return { shouldContinue: false, reply };
};

export const handleContextCommand: CommandHandler = async () => null;

export const handleExportSessionCommand: CommandHandler = async () => null;

export const handleWhoamiCommand: CommandHandler = async (params) => {
  if (params.command.commandBodyNormalized !== "/whoami") {
    return null;
  }
  return {
    shouldContinue: false,
    reply: { text: params.command.senderId ?? "unknown" },
  };
};
