import { normalizeQueueDropPolicy, normalizeQueueMode } from "./normalize.js";
import { DEFAULT_QUEUE_CAP, DEFAULT_QUEUE_DEBOUNCE_MS, DEFAULT_QUEUE_DROP } from "./state.js";
import type { QueueMode, QueueSettings, ResolveQueueSettingsParams } from "./types.js";

function defaultQueueMode(): QueueMode {
  return "collect";
}

export function resolveQueueSettings(params: ResolveQueueSettingsParams): QueueSettings {
  const queueCfg = params.cfg.messages?.queue;
  const resolvedMode =
    params.inlineMode ??
    normalizeQueueMode(params.sessionEntry?.queueMode) ??
    normalizeQueueMode(queueCfg?.mode) ??
    defaultQueueMode();
  const debounceRaw =
    params.inlineOptions?.debounceMs ??
    params.sessionEntry?.queueDebounceMs ??
    queueCfg?.debounceMs ??
    DEFAULT_QUEUE_DEBOUNCE_MS;
  const capRaw =
    params.inlineOptions?.cap ??
    params.sessionEntry?.queueCap ??
    queueCfg?.cap ??
    DEFAULT_QUEUE_CAP;
  const dropRaw =
    params.inlineOptions?.dropPolicy ??
    params.sessionEntry?.queueDrop ??
    normalizeQueueDropPolicy(queueCfg?.drop) ??
    DEFAULT_QUEUE_DROP;
  return {
    mode: resolvedMode,
    debounceMs: typeof debounceRaw === "number" ? Math.max(0, debounceRaw) : undefined,
    cap: typeof capRaw === "number" ? Math.max(1, Math.floor(capRaw)) : undefined,
    dropPolicy: dropRaw,
  };
}
