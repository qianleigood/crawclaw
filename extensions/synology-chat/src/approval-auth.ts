import type { CrawClawConfig } from "crawclaw/plugin-sdk/account-resolution";
import {
  createResolvedApproverActionAuthAdapter,
  resolveApprovalApprovers,
} from "crawclaw/plugin-sdk/approval-runtime";
import { resolveAccount } from "./accounts.js";

function normalizeSynologyChatApproverId(value: string | number): string | undefined {
  const trimmed = String(value).trim();
  return /^\d+$/.test(trimmed) ? trimmed : undefined;
}

export const synologyChatApprovalAuth = createResolvedApproverActionAuthAdapter({
  channelLabel: "Synology Chat",
  resolveApprovers: ({ cfg, accountId }) => {
    const account = resolveAccount((cfg ?? {}) as CrawClawConfig, accountId);
    return resolveApprovalApprovers({
      allowFrom: account.allowedUserIds,
      normalizeApprover: normalizeSynologyChatApproverId,
    });
  },
  normalizeSenderId: (value) => normalizeSynologyChatApproverId(value),
});
