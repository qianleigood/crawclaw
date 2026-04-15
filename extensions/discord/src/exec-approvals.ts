import { getExecApprovalReplyMetadata } from "crawclaw/plugin-sdk/approval-runtime";
import { isChannelExecApprovalClientEnabledFromConfig } from "crawclaw/plugin-sdk/approval-runtime";
import { resolveApprovalApprovers } from "crawclaw/plugin-sdk/approval-runtime";
import type { CrawClawConfig } from "crawclaw/plugin-sdk/config-runtime";
import type { DiscordExecApprovalConfig } from "crawclaw/plugin-sdk/config-runtime";
import type { ReplyPayload } from "crawclaw/plugin-sdk/reply-runtime";
import { resolveDiscordAccount } from "./accounts.js";
import { parseDiscordTarget } from "./targets.js";

function normalizeDiscordApproverId(value: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }
  if (/^\d+$/.test(trimmed)) {
    return trimmed;
  }
  try {
    const target = parseDiscordTarget(trimmed);
    return target?.kind === "user" ? target.id : undefined;
  } catch {
    return undefined;
  }
}

function resolveDiscordOwnerApprovers(cfg: CrawClawConfig): string[] {
  const ownerAllowFrom = cfg.commands?.ownerAllowFrom;
  if (!Array.isArray(ownerAllowFrom) || ownerAllowFrom.length === 0) {
    return [];
  }
  return resolveApprovalApprovers({
    explicit: ownerAllowFrom,
    normalizeApprover: (value) => normalizeDiscordApproverId(String(value)),
  });
}

export function getDiscordExecApprovalApprovers(params: {
  cfg: CrawClawConfig;
  accountId?: string | null;
  configOverride?: DiscordExecApprovalConfig | null;
}): string[] {
  return resolveApprovalApprovers({
    explicit:
      params.configOverride?.approvers ??
      resolveDiscordAccount(params).config.execApprovals?.approvers ??
      resolveDiscordOwnerApprovers(params.cfg),
    normalizeApprover: (value) => normalizeDiscordApproverId(String(value)),
  });
}

export function isDiscordExecApprovalClientEnabled(params: {
  cfg: CrawClawConfig;
  accountId?: string | null;
  configOverride?: DiscordExecApprovalConfig | null;
}): boolean {
  const config = params.configOverride ?? resolveDiscordAccount(params).config.execApprovals;
  return isChannelExecApprovalClientEnabledFromConfig({
    enabled: config?.enabled,
    approverCount: getDiscordExecApprovalApprovers({
      cfg: params.cfg,
      accountId: params.accountId,
      configOverride: params.configOverride,
    }).length,
  });
}

export function isDiscordExecApprovalApprover(params: {
  cfg: CrawClawConfig;
  accountId?: string | null;
  senderId?: string | null;
  configOverride?: DiscordExecApprovalConfig | null;
}): boolean {
  const senderId = params.senderId?.trim();
  if (!senderId) {
    return false;
  }
  return getDiscordExecApprovalApprovers({
    cfg: params.cfg,
    accountId: params.accountId,
    configOverride: params.configOverride,
  }).includes(senderId);
}

export function shouldSuppressLocalDiscordExecApprovalPrompt(params: {
  cfg: CrawClawConfig;
  accountId?: string | null;
  payload: ReplyPayload;
}): boolean {
  return (
    isDiscordExecApprovalClientEnabled(params) &&
    getExecApprovalReplyMetadata(params.payload) !== null
  );
}
