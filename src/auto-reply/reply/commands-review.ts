import { createReviewTaskTool } from "../../agents/tools/review-task-tool.js";
import { logVerbose } from "../../globals.js";
import {
  INTERNAL_MESSAGE_CHANNEL,
  resolveGatewayMessageChannel,
} from "../../utils/message-channel.js";
import type { CommandHandler, CommandHandlerResult } from "./commands-types.js";

const REVIEW_COMMAND_REGEX = /^\/review(?:\s+([\s\S]+))?$/i;
const DEFAULT_REVIEW_TASK =
  "Review the current task outcome, recent workspace changes, and user-visible behavior for this session.";

type ReviewTaskToolDetails = {
  status?: string;
  verdict?: "REVIEW_PASS" | "REVIEW_FAIL" | "REVIEW_PARTIAL";
  summary?: string | null;
  error?: string | null;
  childRuns?: Array<{ childSessionKey?: string | null }>;
};

function formatReviewReply(details: ReviewTaskToolDetails): CommandHandlerResult {
  if (details.status !== "completed" || !details.verdict) {
    const suffix = details.error?.trim() ? ` ${details.error.trim()}` : "";
    return {
      shouldContinue: false,
      reply: { text: `Review did not complete.${suffix}`.trim() },
    };
  }

  const prefix =
    details.verdict === "REVIEW_PASS"
      ? "Review PASS"
      : details.verdict === "REVIEW_FAIL"
        ? "Review FAIL"
        : "Review PARTIAL";
  const lines = [prefix];
  if (details.summary?.trim()) {
    lines.push(details.summary.trim());
  }
  const childSessionKey = details.childRuns
    ?.map((entry) => entry.childSessionKey?.trim())
    .find((entry): entry is string => Boolean(entry));
  if (childSessionKey) {
    lines.push(`Session: ${childSessionKey}`);
  }
  return {
    shouldContinue: false,
    reply: { text: lines.join("\n") },
  };
}

export const handleReviewCommand: CommandHandler = async (params, allowTextCommands) => {
  if (!allowTextCommands) {
    return null;
  }
  const match = params.command.commandBodyNormalized.match(REVIEW_COMMAND_REGEX);
  if (!match) {
    return null;
  }
  if (!params.command.isAuthorizedSender) {
    logVerbose(
      `Ignoring /review from unauthorized sender: ${params.command.senderId || "<unknown>"}`,
    );
    return { shouldContinue: false };
  }
  if (
    params.sessionEntry?.spawnSource === "review-spec" ||
    params.sessionEntry?.spawnSource === "review-quality"
  ) {
    return {
      shouldContinue: false,
      reply: { text: "Review sessions cannot start nested review runs." },
    };
  }

  const focus = match[1]?.trim();
  const tool = createReviewTaskTool({
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
    const result = await tool.execute("command:/review", {
      task: DEFAULT_REVIEW_TASK,
      ...(focus ? { reviewFocus: [focus] } : {}),
    });
    return formatReviewReply((result.details ?? {}) as ReviewTaskToolDetails);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      shouldContinue: false,
      reply: { text: `Review failed to start. ${message}`.trim() },
    };
  }
};
