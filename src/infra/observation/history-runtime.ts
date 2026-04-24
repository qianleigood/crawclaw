import { loadConfig, type CrawClawConfig } from "../../config/config.js";
import { resolveMemoryConfig } from "../../memory/config/resolve.js";
import type { RuntimeStore } from "../../memory/runtime/runtime-store.js";
import { SqliteRuntimeStore } from "../../memory/runtime/sqlite-runtime-store.js";
import type { ObservationIndexSource } from "../../memory/types/runtime.js";
import { indexObservationEvent } from "./history-index.js";
import type { ObservationContext } from "./types.js";

type SharedObservationHistoryStore = {
  cacheKey: string;
  storePromise: Promise<RuntimeStore | undefined>;
};

let sharedStore: SharedObservationHistoryStore | null = null;

function resolveEffectiveConfig(config?: CrawClawConfig): CrawClawConfig | undefined {
  if (config) {
    return config;
  }
  try {
    return loadConfig();
  } catch {
    return undefined;
  }
}

export async function resolveSharedObservationHistoryStore(
  config?: CrawClawConfig,
): Promise<RuntimeStore | undefined> {
  const effectiveConfig = resolveEffectiveConfig(config);
  if (!effectiveConfig) {
    return undefined;
  }
  const memoryConfig = resolveMemoryConfig(effectiveConfig.memory ?? {});
  const cacheKey = memoryConfig.runtimeStore.dbPath;
  if (sharedStore?.cacheKey === cacheKey) {
    return await sharedStore.storePromise;
  }
  const storePromise = (async () => {
    const store = new SqliteRuntimeStore(memoryConfig.runtimeStore.dbPath);
    await store.init();
    return store;
  })();
  sharedStore = { cacheKey, storePromise };
  return await storePromise;
}

export async function indexObservationEventWithDefaultStore(input: {
  config?: CrawClawConfig;
  eventKey?: string;
  eventId?: string;
  observation: ObservationContext;
  source: ObservationIndexSource;
  type: string;
  phase?: string;
  status?: "running" | "ok" | "error" | "timeout" | "archived" | "unknown" | "failed" | "completed";
  decisionCode?: string;
  summary: string;
  metrics?: Record<string, number>;
  refs?: Record<string, unknown>;
  payloadRef?: Record<string, unknown>;
  createdAt: number;
}): Promise<void> {
  const store = await resolveSharedObservationHistoryStore(input.config);
  if (!store) {
    return;
  }
  await indexObservationEvent({ store, ...input });
}

export const __testing = {
  resetSharedObservationHistoryStore(): void {
    sharedStore = null;
  },
};
