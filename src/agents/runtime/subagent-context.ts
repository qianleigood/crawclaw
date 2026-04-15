import { normalizeDeliveryContext } from "../../utils/delivery-context.js";
import type { SpawnAcpContext } from "../acp-spawn.js";
import type { SpawnSubagentContext } from "../subagent-spawn.js";

export type AgentSpawnToolContext = {
  agentSessionKey?: string;
  agentChannel?: string;
  agentAccountId?: string;
  agentTo?: string;
  agentThreadId?: string | number;
  agentGroupId?: string | null;
  agentGroupChannel?: string | null;
  agentGroupSpace?: string | null;
  requesterAgentIdOverride?: string;
  sandboxed?: boolean;
  workspaceDir?: string;
};

export type NormalizedAgentSpawnContext = {
  agentSessionKey?: string;
  agentChannel?: string;
  agentAccountId?: string;
  agentTo?: string;
  agentThreadId?: string | number;
  agentGroupId?: string;
  agentGroupChannel?: string;
  agentGroupSpace?: string;
  requesterAgentIdOverride?: string;
  sandboxed?: boolean;
  workspaceDir?: string;
  requesterOrigin?: ReturnType<typeof normalizeDeliveryContext>;
};

function normalizeOptionalText(value?: string | null): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed || undefined;
}

function normalizeThreadId(value?: string | number): string | number | undefined {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : undefined;
  }
  return normalizeOptionalText(value);
}

export function normalizeAgentSpawnContext(
  value?: AgentSpawnToolContext | null,
): NormalizedAgentSpawnContext {
  const agentSessionKey = normalizeOptionalText(value?.agentSessionKey);
  const agentChannel = normalizeOptionalText(value?.agentChannel);
  const agentAccountId = normalizeOptionalText(value?.agentAccountId);
  const agentTo = normalizeOptionalText(value?.agentTo);
  const agentThreadId = normalizeThreadId(value?.agentThreadId);
  return {
    ...(agentSessionKey ? { agentSessionKey } : {}),
    ...(agentChannel ? { agentChannel } : {}),
    ...(agentAccountId ? { agentAccountId } : {}),
    ...(agentTo ? { agentTo } : {}),
    ...(agentThreadId !== undefined ? { agentThreadId } : {}),
    ...(normalizeOptionalText(value?.agentGroupId)
      ? { agentGroupId: normalizeOptionalText(value?.agentGroupId) }
      : {}),
    ...(normalizeOptionalText(value?.agentGroupChannel)
      ? { agentGroupChannel: normalizeOptionalText(value?.agentGroupChannel) }
      : {}),
    ...(normalizeOptionalText(value?.agentGroupSpace)
      ? { agentGroupSpace: normalizeOptionalText(value?.agentGroupSpace) }
      : {}),
    ...(normalizeOptionalText(value?.requesterAgentIdOverride)
      ? { requesterAgentIdOverride: normalizeOptionalText(value?.requesterAgentIdOverride) }
      : {}),
    ...(value?.sandboxed === true ? { sandboxed: true } : {}),
    ...(normalizeOptionalText(value?.workspaceDir)
      ? { workspaceDir: normalizeOptionalText(value?.workspaceDir) }
      : {}),
    requesterOrigin: normalizeDeliveryContext({
      channel: agentChannel,
      accountId: agentAccountId,
      to: agentTo,
      threadId: agentThreadId,
    }),
  };
}

export function toSubagentSpawnContext(
  value?: NormalizedAgentSpawnContext | null,
): SpawnSubagentContext {
  return {
    ...(value?.agentSessionKey ? { agentSessionKey: value.agentSessionKey } : {}),
    ...(value?.agentChannel ? { agentChannel: value.agentChannel } : {}),
    ...(value?.agentAccountId ? { agentAccountId: value.agentAccountId } : {}),
    ...(value?.agentTo ? { agentTo: value.agentTo } : {}),
    ...(value?.agentThreadId !== undefined ? { agentThreadId: value.agentThreadId } : {}),
    ...(value?.agentGroupId ? { agentGroupId: value.agentGroupId } : {}),
    ...(value?.agentGroupChannel ? { agentGroupChannel: value.agentGroupChannel } : {}),
    ...(value?.agentGroupSpace ? { agentGroupSpace: value.agentGroupSpace } : {}),
    ...(value?.requesterAgentIdOverride
      ? { requesterAgentIdOverride: value.requesterAgentIdOverride }
      : {}),
    ...(value?.workspaceDir ? { workspaceDir: value.workspaceDir } : {}),
  };
}

export function toAcpSpawnContext(value?: NormalizedAgentSpawnContext | null): SpawnAcpContext {
  return {
    ...(value?.agentSessionKey ? { agentSessionKey: value.agentSessionKey } : {}),
    ...(value?.agentChannel ? { agentChannel: value.agentChannel } : {}),
    ...(value?.agentAccountId ? { agentAccountId: value.agentAccountId } : {}),
    ...(value?.agentTo ? { agentTo: value.agentTo } : {}),
    ...(value?.agentThreadId !== undefined ? { agentThreadId: value.agentThreadId } : {}),
    ...(value?.agentGroupId ? { agentGroupId: value.agentGroupId } : {}),
    ...(value?.sandboxed === true ? { sandboxed: true } : {}),
  };
}
