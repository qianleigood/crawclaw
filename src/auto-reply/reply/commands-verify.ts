import { createVerifyTaskTool } from "../../agents/tools/verify-task-tool.js";
import { logVerbose } from "../../globals.js";
import {
  INTERNAL_MESSAGE_CHANNEL,
  resolveGatewayMessageChannel,
} from "../../utils/message-channel.js";
import type { CommandHandler, CommandHandlerResult } from "./commands-types.js";

const VERIFY_COMMAND_REGEX = /^\/verify(?:\s+([\s\S]+))?$/i;
const DEFAULT_VERIFY_TASK =
  "Verify the current task outcome, recent workspace changes, and user-visible behavior for this session.";

type VerifyTaskToolDetails = {
  status?: string;
  verdict?: "PASS" | "FAIL" | "PARTIAL";
  summary?: string | null;
  error?: string | null;
  childSessionKey?: string | null;
  runId?: string | null;
};

function formatVerificationReply(details: VerifyTaskToolDetails): CommandHandlerResult {
  if (details.status !== "completed" || !details.verdict) {
    const suffix = details.error?.trim() ? ` ${details.error.trim()}` : "";
    return {
      shouldContinue: false,
      reply: { text: `❌ Verification did not complete.${suffix}`.trim() },
    };
  }

  const prefix =
    details.verdict === "PASS"
      ? "✅ Verification PASS"
      : details.verdict === "FAIL"
        ? "❌ Verification FAIL"
        : "⚠️ Verification PARTIAL";
  const lines = [prefix];
  if (details.summary?.trim()) {
    lines.push(details.summary.trim());
  }
  if (details.childSessionKey?.trim()) {
    lines.push(`Session: ${details.childSessionKey.trim()}`);
  }
  return {
    shouldContinue: false,
    reply: { text: lines.join("\n") },
  };
}

export const handleVerifyCommand: CommandHandler = async (params, allowTextCommands) => {
  if (!allowTextCommands) {
    return null;
  }
  const match = params.command.commandBodyNormalized.match(VERIFY_COMMAND_REGEX);
  if (!match) {
    return null;
  }
  if (!params.command.isAuthorizedSender) {
    logVerbose(
      `Ignoring /verify from unauthorized sender: ${params.command.senderId || "<unknown>"}`,
    );
    return { shouldContinue: false };
  }
  if (params.sessionEntry?.spawnSource === "verification") {
    return {
      shouldContinue: false,
      reply: { text: "⚠️ Verification sessions cannot start nested verification runs." },
    };
  }

  const task = match[1]?.trim() || DEFAULT_VERIFY_TASK;
  const tool = createVerifyTaskTool({
    agentSessionKey: params.sessionKey,
    agentChannel: resolveGatewayMessageChannel(params.command.channel) ?? INTERNAL_MESSAGE_CHANNEL,
    agentAccountId: params.ctx.AccountId,
    agentTo: params.command.to ?? params.ctx.To,
    agentThreadId: params.ctx.MessageThreadId,
    agentGroupId: params.sessionEntry?.groupId ?? null,
    agentGroupChannel:
      params.sessionEntry?.groupChannel ?? params.ctx.GroupChannel ?? params.ctx.GroupSubject,
    agentGroupSpace: params.sessionEntry?.space ?? params.ctx.GroupSpace,
    requesterAgentIdOverride: params.agentId,
    workspaceDir: params.workspaceDir,
  });

  try {
    const result = await tool.execute("command:/verify", { task });
    return formatVerificationReply((result.details ?? {}) as VerifyTaskToolDetails);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      shouldContinue: false,
      reply: { text: `❌ Verification failed to start. ${message}`.trim() },
    };
  }
};
