import type { CrawClawConfig } from "../config/config.js";
import { normalizeAccountId } from "../utils/account-id.js";
import type { MsgContext } from "./templating.js";

export type CommandAuthorization = {
  providerId?: string;
  ownerList: string[];
  senderId?: string;
  senderIsOwner: boolean;
  isAuthorizedSender: boolean;
  from?: string;
  to?: string;
};

function normalizeSender(value?: string): string | undefined {
  const normalized = normalizeAccountId(value);
  return normalized || undefined;
}

export function resolveCommandAuthorization(params: {
  ctx: MsgContext;
  cfg: CrawClawConfig;
  commandAuthorized: boolean;
}): CommandAuthorization {
  const from = params.ctx.From?.trim() || undefined;
  const to = params.ctx.To?.trim() || undefined;
  const senderId = normalizeSender(from);
  const configuredAllowFrom = params.cfg.commands?.allowFrom;
  const ownerList = (Array.isArray(configuredAllowFrom) ? configuredAllowFrom : [])
    .map((entry) => normalizeSender(String(entry)))
    .filter((entry): entry is string => Boolean(entry));
  const senderIsOwner = senderId ? ownerList.includes(senderId) || ownerList.includes("*") : false;
  return {
    providerId: params.ctx.Provider?.trim().toLowerCase() || undefined,
    ownerList,
    senderId,
    senderIsOwner,
    isAuthorizedSender: params.commandAuthorized || senderIsOwner,
    from,
    to,
  };
}
