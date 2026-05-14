import { findLegacyWebSearchConfigIssues } from "./legacy-web-search.js";
import { getRecord } from "./legacy.shared.js";
import type { LegacyConfigIssue } from "./types.js";

type LegacyConfigRule = {
  path: string[];
  message: string;
  match?: (value: unknown, root: Record<string, unknown>) => boolean;
  requireSourceLiteral?: boolean;
};

function getPathValue(root: Record<string, unknown>, path: string[]): unknown {
  let cursor: unknown = root;
  for (const key of path) {
    if (!cursor || typeof cursor !== "object") {
      return undefined;
    }
    cursor = (cursor as Record<string, unknown>)[key];
  }
  return cursor;
}

function hasOwnKey(target: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(target, key);
}

function hasLegacyThreadBindingTtl(value: unknown): boolean {
  const threadBindings = getRecord(value);
  return Boolean(threadBindings && hasOwnKey(threadBindings, "ttlHours"));
}

const LEGACY_TTS_PROVIDER_KEYS = ["openai", "elevenlabs", "microsoft", "edge"] as const;
const LEGACY_TTS_PLUGIN_IDS = new Set(["voice-call"]);

function hasLegacyTtsProviderKeys(value: unknown): boolean {
  const tts = getRecord(value);
  if (!tts) {
    return false;
  }
  return LEGACY_TTS_PROVIDER_KEYS.some((key) => hasOwnKey(tts, key));
}

function hasLegacyPluginEntryTtsProviderKeys(value: unknown): boolean {
  const entries = getRecord(value);
  if (!entries) {
    return false;
  }
  return Object.entries(entries).some(([pluginId, entryValue]) => {
    if (!LEGACY_TTS_PLUGIN_IDS.has(pluginId)) {
      return false;
    }
    const entry = getRecord(entryValue);
    const config = getRecord(entry?.config);
    return hasLegacyTtsProviderKeys(config?.tts);
  });
}

function isLegacyGatewayBindHostAlias(value: unknown): boolean {
  if (typeof value !== "string") {
    return false;
  }
  const normalized = value.trim().toLowerCase();
  if (
    normalized === "" ||
    normalized === "auto" ||
    normalized === "loopback" ||
    normalized === "lan" ||
    normalized === "tailnet" ||
    normalized === "custom"
  ) {
    return false;
  }
  return (
    normalized === "0.0.0.0" ||
    normalized === "::" ||
    normalized === "[::]" ||
    normalized === "*" ||
    normalized === "127.0.0.1" ||
    normalized === "localhost" ||
    normalized === "::1" ||
    normalized === "[::1]"
  );
}

const LEGACY_CONFIG_RULES: LegacyConfigRule[] = [
  {
    path: ["session", "threadBindings"],
    message:
      "session.threadBindings.ttlHours was removed; use session.threadBindings.idleHours instead.",
    match: (value) => hasLegacyThreadBindingTtl(value),
  },
  {
    path: ["gateway", "bind"],
    message:
      "gateway.bind host aliases are no longer supported; use bind modes (auto/loopback/lan/tailnet/custom) instead.",
    match: (value) => isLegacyGatewayBindHostAlias(value),
    requireSourceLiteral: true,
  },
  {
    path: ["heartbeat"],
    message:
      "top-level heartbeat is not a valid config path; use cron for cadence, agents.defaults.heartbeat for event-driven wake settings, or channels.defaults.heartbeat for showOk/showAlerts/useIndicator.",
  },
  {
    path: ["messages", "tts"],
    message:
      "messages.tts.<provider> keys (openai/elevenlabs/microsoft/edge) were removed; use messages.tts.providers.<provider> instead.",
    match: (value) => hasLegacyTtsProviderKeys(value),
  },
  {
    path: ["plugins", "entries"],
    message:
      "plugins.entries.voice-call.config.tts.<provider> keys (openai/elevenlabs/microsoft/edge) were removed; use plugins.entries.voice-call.config.tts.providers.<provider> instead.",
    match: (value) => hasLegacyPluginEntryTtsProviderKeys(value),
  },
];

export function findLegacyConfigIssues(raw: unknown, sourceRaw?: unknown): LegacyConfigIssue[] {
  if (!raw || typeof raw !== "object") {
    return [];
  }
  const root = raw as Record<string, unknown>;
  const sourceRoot =
    sourceRaw && typeof sourceRaw === "object" ? (sourceRaw as Record<string, unknown>) : root;
  const issues: LegacyConfigIssue[] = [];

  for (const rule of LEGACY_CONFIG_RULES) {
    const cursor = getPathValue(root, rule.path);
    if (cursor === undefined || (rule.match && !rule.match(cursor, root))) {
      continue;
    }
    if (rule.requireSourceLiteral) {
      const sourceCursor = getPathValue(sourceRoot, rule.path);
      if (sourceCursor === undefined || (rule.match && !rule.match(sourceCursor, sourceRoot))) {
        continue;
      }
    }
    issues.push({ path: rule.path.join("."), message: rule.message });
  }

  issues.push(...findLegacyWebSearchConfigIssues(root));
  return issues;
}

export function applyLegacyMigrations(_raw: unknown): {
  next: Record<string, unknown> | null;
  changes: string[];
} {
  return { next: null, changes: [] };
}
