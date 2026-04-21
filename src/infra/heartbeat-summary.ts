import { resolveAgentConfig, resolveDefaultAgentId } from "../agents/agent-scope.js";
import {
  DEFAULT_HEARTBEAT_ACK_MAX_CHARS,
  resolveHeartbeatPrompt as resolveHeartbeatPromptText,
} from "../auto-reply/heartbeat.js";
import { parseDurationMs } from "../cli/parse-duration.js";
import type { CrawClawConfig } from "../config/config.js";
import type { AgentDefaultsConfig } from "../config/types.agent-defaults.js";
import { normalizeAgentId } from "../routing/session-key.js";

type HeartbeatConfig = AgentDefaultsConfig["heartbeat"];

export type HeartbeatSummary = {
  enabled: boolean;
  every: string;
  everyMs: number | null;
  prompt: string;
  target: string;
  model?: string;
  ackMaxChars: number;
};

const DEFAULT_HEARTBEAT_TARGET = "none";

function hasExplicitHeartbeatAgents(cfg: CrawClawConfig) {
  const list = cfg.agents?.list ?? [];
  return list.some((entry) => Boolean(entry?.heartbeat));
}

export function isHeartbeatEnabledForAgent(cfg: CrawClawConfig, agentId?: string): boolean {
  const resolvedAgentId = normalizeAgentId(agentId ?? resolveDefaultAgentId(cfg));
  const list = cfg.agents?.list ?? [];
  const defaults = cfg.agents?.defaults?.heartbeat;
  const overrides = resolveAgentConfig(cfg, resolvedAgentId)?.heartbeat;
  const hasExplicit = hasExplicitHeartbeatAgents(cfg);
  if (hasExplicit) {
    if (
      !list.some(
        (entry) => Boolean(entry?.heartbeat) && normalizeAgentId(entry?.id) === resolvedAgentId,
      )
    ) {
      return false;
    }
    return Boolean(resolveHeartbeatIntervalMs(cfg, undefined, { ...defaults, ...overrides }));
  }
  if (resolvedAgentId !== resolveDefaultAgentId(cfg)) {
    return false;
  }
  return Boolean(resolveHeartbeatIntervalMs(cfg, undefined, defaults));
}

export function resolveHeartbeatIntervalMs(
  cfg: CrawClawConfig,
  overrideEvery?: string,
  heartbeat?: HeartbeatConfig,
) {
  const raw = overrideEvery ?? heartbeat?.every ?? cfg.agents?.defaults?.heartbeat?.every;
  if (!raw) {
    return null;
  }
  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }
  let ms: number;
  try {
    ms = parseDurationMs(trimmed, { defaultUnit: "m" });
  } catch {
    return null;
  }
  if (ms <= 0) {
    return null;
  }
  return ms;
}

export function resolveHeartbeatSummaryForAgent(
  cfg: CrawClawConfig,
  agentId?: string,
): HeartbeatSummary {
  const defaults = cfg.agents?.defaults?.heartbeat;
  const overrides = agentId ? resolveAgentConfig(cfg, agentId)?.heartbeat : undefined;
  const enabled = isHeartbeatEnabledForAgent(cfg, agentId);

  if (!enabled) {
    return {
      enabled: false,
      every: "disabled",
      everyMs: null,
      prompt: resolveHeartbeatPromptText(defaults?.prompt),
      target: defaults?.target ?? DEFAULT_HEARTBEAT_TARGET,
      model: defaults?.model,
      ackMaxChars: Math.max(0, defaults?.ackMaxChars ?? DEFAULT_HEARTBEAT_ACK_MAX_CHARS),
    };
  }

  const merged = defaults || overrides ? { ...defaults, ...overrides } : undefined;
  const every = merged?.every ?? defaults?.every ?? overrides?.every ?? "disabled";
  const everyMs = resolveHeartbeatIntervalMs(cfg, undefined, merged);
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
    enabled: true,
    every,
    everyMs,
    prompt,
    target,
    model,
    ackMaxChars,
  };
}
