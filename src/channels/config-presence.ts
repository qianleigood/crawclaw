import type { CrawClawConfig } from "../config/config.js";
import {
  hasBundledChannelConfiguredState,
  listBundledChannelIdsWithConfiguredState,
} from "./plugins/configured-state.js";
import {
  hasBundledChannelPersistedAuthState,
  listBundledChannelIdsWithPersistedAuthState,
} from "./plugins/persisted-auth-state.js";

const IGNORED_CHANNEL_CONFIG_KEYS = new Set(["defaults", "modelByChannel"]);

const CHANNEL_ENV_PREFIXES: readonly (readonly [string, string])[] = [];

function hasNonEmptyString(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function hasMeaningfulChannelConfig(value: unknown): boolean {
  if (!isRecord(value)) {
    return false;
  }
  return Object.keys(value).some((key) => key !== "enabled");
}

export function listPotentialConfiguredChannelIds(
  cfg: CrawClawConfig,
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  const configuredChannelIds = new Set<string>();
  const channels = isRecord(cfg.channels) ? cfg.channels : null;
  if (channels) {
    for (const [key, value] of Object.entries(channels)) {
      if (IGNORED_CHANNEL_CONFIG_KEYS.has(key)) {
        continue;
      }
      if (hasMeaningfulChannelConfig(value)) {
        configuredChannelIds.add(key);
      }
    }
  }

  for (const [key, value] of Object.entries(env)) {
    if (!hasNonEmptyString(value)) {
      continue;
    }
    for (const [prefix, channelId] of CHANNEL_ENV_PREFIXES) {
      if (key.startsWith(prefix)) {
        configuredChannelIds.add(channelId);
      }
    }
  }

  for (const channelId of listBundledChannelIdsWithConfiguredState()) {
    if (hasBundledChannelConfiguredState({ channelId, cfg, env })) {
      configuredChannelIds.add(channelId);
    }
  }
  for (const channelId of listBundledChannelIdsWithPersistedAuthState()) {
    if (hasBundledChannelPersistedAuthState({ channelId, cfg, env })) {
      configuredChannelIds.add(channelId);
    }
  }
  return [...configuredChannelIds];
}

function hasEnvConfiguredChannel(cfg: CrawClawConfig, env: NodeJS.ProcessEnv): boolean {
  for (const [key, value] of Object.entries(env)) {
    if (!hasNonEmptyString(value)) {
      continue;
    }
    if (CHANNEL_ENV_PREFIXES.some(([prefix]) => key.startsWith(prefix))) {
      return true;
    }
  }
  return (
    listBundledChannelIdsWithConfiguredState().some((channelId) =>
      hasBundledChannelConfiguredState({ channelId, cfg, env }),
    ) ||
    listBundledChannelIdsWithPersistedAuthState().some((channelId) =>
      hasBundledChannelPersistedAuthState({ channelId, cfg, env }),
    )
  );
}

export function hasPotentialConfiguredChannels(
  cfg: CrawClawConfig | null | undefined,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const channels = isRecord(cfg?.channels) ? cfg.channels : null;
  if (channels) {
    for (const [key, value] of Object.entries(channels)) {
      if (IGNORED_CHANNEL_CONFIG_KEYS.has(key)) {
        continue;
      }
      if (hasMeaningfulChannelConfig(value)) {
        return true;
      }
    }
  }
  return hasEnvConfiguredChannel(cfg ?? {}, env);
}
