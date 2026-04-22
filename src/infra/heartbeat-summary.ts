import { resolveAgentConfig } from "../agents/agent-scope.js";
import {
  DEFAULT_HEARTBEAT_ACK_MAX_CHARS,
  resolveHeartbeatPrompt as resolveHeartbeatPromptText,
} from "../auto-reply/heartbeat.js";
import type { CrawClawConfig } from "../config/config.js";

export type HeartbeatSummary = {
  enabled: boolean;
  prompt: string;
  target: string;
  model?: string;
  ackMaxChars: number;
};

const DEFAULT_HEARTBEAT_TARGET = "none";

export function resolveHeartbeatSummaryForAgent(
  cfg: CrawClawConfig,
  agentId?: string,
): HeartbeatSummary {
  const defaults = cfg.agents?.defaults?.heartbeat;
  const overrides = agentId ? resolveAgentConfig(cfg, agentId)?.heartbeat : undefined;
  const merged = defaults || overrides ? { ...defaults, ...overrides } : undefined;
  const prompt = resolveHeartbeatPromptText(
    merged?.prompt ?? defaults?.prompt ?? overrides?.prompt,
  );
  const target =
    merged?.target ?? defaults?.target ?? overrides?.target ?? DEFAULT_HEARTBEAT_TARGET;
  const model = merged?.model ?? defaults?.model ?? overrides?.model;
  const ackMaxChars = Math.max(
    0,
    merged?.ackMaxChars ??
      defaults?.ackMaxChars ??
      overrides?.ackMaxChars ??
      DEFAULT_HEARTBEAT_ACK_MAX_CHARS,
  );

  return {
    enabled: false,
    prompt,
    target,
    model,
    ackMaxChars,
  };
}
