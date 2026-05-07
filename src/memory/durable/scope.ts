import path from "node:path";
import { resolveStateDir } from "../../config/paths.js";
import { normalizeAgentId, parseAgentSessionKey } from "../../routing/session-key.ts";

export interface DurableMemoryScope {
  agentId: string;
  channel: string;
  userId: string;
  scopeKey?: string;
  rootDir?: string;
}

export const LOCAL_DURABLE_MEMORY_CHANNEL_ID = "local";
export const LOCAL_DURABLE_MEMORY_USER_ID = "local";

function normalizeScopeSegment(value: string | null | undefined): string {
  const trimmed = (value ?? "").trim();
  if (!trimmed) {
    return "unknown";
  }
  const encoded = encodeURIComponent(trimmed);
  return encoded || "unknown";
}

function parseScopeFromSessionKey(sessionKey: string): { channel: string; userId: string } | null {
  const stripped = sessionKey.split(":thread:")[0]?.trim() || sessionKey.trim();
  const parsed = parseAgentSessionKey(stripped);
  if (!parsed) {
    return null;
  }
  const tokens = parsed.rest.split(":").filter(Boolean);
  if (!tokens.length) {
    return null;
  }
  if (tokens.length === 1) {
    const single = tokens[0]?.trim();
    if (!single) {
      return null;
    }
    return { channel: LOCAL_DURABLE_MEMORY_CHANNEL_ID, userId: single };
  }
  if (tokens[1] && ["direct", "group", "channel"].includes(tokens[1])) {
    const channel = tokens[0]?.trim();
    const userId = tokens.slice(2).join(":").trim();
    if (!channel || !userId) {
      return null;
    }
    return { channel, userId };
  }
  const channel = tokens[0]?.trim();
  const userId = tokens.slice(1).join(":").trim();
  if (!channel || !userId) {
    return null;
  }
  return { channel, userId };
}

export function resolveDurableMemoryRootDir(): string {
  const override = process.env.CRAWCLAW_DURABLE_MEMORY_DIR?.trim();
  if (override) {
    return path.resolve(override);
  }
  return path.join(resolveStateDir(), "durable-memory");
}

export function resolveDurableMemoryScope(params: {
  sessionKey?: string | null;
  agentId?: string | null;
  channel?: string | null;
  userId?: string | null;
  rootDir?: string | null;
  fallbackToLocal?: boolean | null;
}): DurableMemoryScope | null {
  const sessionKey =
    params.sessionKey?.split(":thread:")[0]?.trim() || params.sessionKey?.trim() || undefined;
  const parsedSessionKey = sessionKey ? parseAgentSessionKey(sessionKey) : null;
  const agentId = normalizeAgentId(params.agentId ?? parsedSessionKey?.agentId ?? undefined);
  const parsedFromSession = sessionKey ? parseScopeFromSessionKey(sessionKey) : null;
  const fallbackChannel = params.fallbackToLocal ? LOCAL_DURABLE_MEMORY_CHANNEL_ID : null;
  const fallbackUserId = params.fallbackToLocal ? LOCAL_DURABLE_MEMORY_USER_ID : null;
  const channel = params.channel?.trim() || parsedFromSession?.channel?.trim() || fallbackChannel;
  const userId = params.userId?.trim() || parsedFromSession?.userId?.trim() || fallbackUserId;
  if (!agentId || !channel || !userId) {
    return null;
  }
  const normalizedChannel = normalizeScopeSegment(channel);
  const normalizedUserId = normalizeScopeSegment(userId);
  const rootDir = path.join(
    params.rootDir?.trim() || resolveDurableMemoryRootDir(),
    "agents",
    agentId,
  );
  return {
    agentId,
    channel: normalizedChannel,
    userId: normalizedUserId,
    scopeKey: agentId,
    rootDir,
  };
}

export function resolveDurableMemoryScopeDir(
  scope: Pick<DurableMemoryScope, "agentId" | "channel" | "userId" | "scopeKey" | "rootDir">,
  rootDir = resolveDurableMemoryRootDir(),
): string {
  return scope.rootDir ?? path.join(rootDir, "agents", scope.agentId);
}

export function getDurableMemoryScopeDir(scope: DurableMemoryScope): string {
  return resolveDurableMemoryScopeDir(scope);
}

export function resolveDurableMemoryIndexPath(
  scope: Pick<DurableMemoryScope, "agentId" | "channel" | "userId" | "scopeKey" | "rootDir">,
  rootDir = resolveDurableMemoryRootDir(),
): string {
  return path.join(resolveDurableMemoryScopeDir(scope, rootDir), "MEMORY.md");
}
