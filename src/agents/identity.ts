import type { CrawClawConfig, HumanDelayConfig, IdentityConfig } from "../config/config.js";
import { resolveAgentConfig } from "./agent-scope.js";

const DEFAULT_ACK_REACTION = "👀";

export function resolveAgentIdentity(
  cfg: CrawClawConfig,
  agentId: string,
): IdentityConfig | undefined {
  return resolveAgentConfig(cfg, agentId)?.identity;
}

export function resolveAckReaction(
  cfg: CrawClawConfig,
  agentId: string,
  opts?: { channel?: string; accountId?: string },
): string {
  void opts;

  const configured = cfg.messages?.ackReaction;
  if (configured !== undefined) {
    return configured.trim();
  }

  // L4: Agent identity emoji fallback
  const emoji = resolveAgentIdentity(cfg, agentId)?.emoji?.trim();
  return emoji || DEFAULT_ACK_REACTION;
}

export function resolveIdentityNamePrefix(
  cfg: CrawClawConfig,
  agentId: string,
): string | undefined {
  const name = resolveAgentIdentity(cfg, agentId)?.name?.trim();
  if (!name) {
    return undefined;
  }
  return `[${name}]`;
}

/** Returns just the identity name (without brackets) for template context. */
export function resolveIdentityName(cfg: CrawClawConfig, agentId: string): string | undefined {
  return resolveAgentIdentity(cfg, agentId)?.name?.trim() || undefined;
}

export function resolveMessagePrefix(
  cfg: CrawClawConfig,
  agentId: string,
  opts?: { configured?: string; hasAllowFrom?: boolean; fallback?: string },
): string {
  const configured = opts?.configured;
  if (configured !== undefined) {
    return configured;
  }

  const hasAllowFrom = opts?.hasAllowFrom === true;
  if (hasAllowFrom) {
    return "";
  }

  return resolveIdentityNamePrefix(cfg, agentId) ?? opts?.fallback ?? "[crawclaw]";
}

export function resolveResponsePrefix(
  cfg: CrawClawConfig,
  agentId: string,
  opts?: { channel?: string; accountId?: string },
): string | undefined {
  void opts;

  const configured = cfg.messages?.responsePrefix;
  if (configured !== undefined) {
    if (configured === "auto") {
      return resolveIdentityNamePrefix(cfg, agentId);
    }
    return configured;
  }
  return undefined;
}

export function resolveEffectiveMessagesConfig(
  cfg: CrawClawConfig,
  agentId: string,
  opts?: {
    hasAllowFrom?: boolean;
    fallbackMessagePrefix?: string;
    channel?: string;
    accountId?: string;
  },
): { messagePrefix: string; responsePrefix?: string } {
  return {
    messagePrefix: resolveMessagePrefix(cfg, agentId, {
      hasAllowFrom: opts?.hasAllowFrom,
      fallback: opts?.fallbackMessagePrefix,
    }),
    responsePrefix: resolveResponsePrefix(cfg, agentId, {
      channel: opts?.channel,
      accountId: opts?.accountId,
    }),
  };
}

export function resolveHumanDelayConfig(
  cfg: CrawClawConfig,
  agentId: string,
): HumanDelayConfig | undefined {
  const defaults = cfg.agents?.defaults?.humanDelay;
  const overrides = resolveAgentConfig(cfg, agentId)?.humanDelay;
  if (!defaults && !overrides) {
    return undefined;
  }
  return {
    mode: overrides?.mode ?? defaults?.mode,
    minMs: overrides?.minMs ?? defaults?.minMs,
    maxMs: overrides?.maxMs ?? defaults?.maxMs,
  };
}
