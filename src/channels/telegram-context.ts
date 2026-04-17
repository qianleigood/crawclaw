import { parseExplicitTargetForChannel } from "./plugins/target-parsing.js";

type TelegramConversationParams = {
  ctx: {
    MessageThreadId?: string | number | null;
    OriginatingTo?: string;
    To?: string;
  };
  command: {
    to?: string;
  };
};

function resolveTelegramChatId(raw: string): string | undefined {
  const parsed = parseExplicitTargetForChannel("telegram", raw)?.to.trim();
  if (parsed) {
    return parsed;
  }
  const trimmed = raw.trim();
  if (!trimmed) {
    return undefined;
  }
  if (trimmed.toLowerCase().startsWith("telegram:")) {
    const stripped = trimmed.slice("telegram:".length).trim();
    return stripped || undefined;
  }
  return trimmed;
}

export function resolveTelegramConversationId(
  params: TelegramConversationParams,
): string | undefined {
  const rawThreadId =
    params.ctx.MessageThreadId != null ? String(params.ctx.MessageThreadId).trim() : "";
  const threadId = rawThreadId || undefined;
  const toCandidates = [
    typeof params.ctx.OriginatingTo === "string" ? params.ctx.OriginatingTo : "",
    typeof params.command.to === "string" ? params.command.to : "",
    typeof params.ctx.To === "string" ? params.ctx.To : "",
  ]
    .map((value) => value.trim())
    .filter(Boolean);
  const chatId = toCandidates
    .map((candidate) => resolveTelegramChatId(candidate) ?? "")
    .find((candidate) => candidate.length > 0);
  if (!chatId) {
    return undefined;
  }
  if (chatId.includes(":topic:")) {
    return chatId;
  }
  if (threadId) {
    return `${chatId}:topic:${threadId}`;
  }
  if (chatId.startsWith("-")) {
    return undefined;
  }
  return chatId;
}
