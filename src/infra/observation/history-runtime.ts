import type { CrawClawConfig } from "../../config/config.js";
import type { ObservationIndexSource } from "./history-index.js";
import type { ObservationContext } from "./types.js";

type SharedObservationHistoryStore = {
  cacheKey: string;
  storePromise: Promise<undefined>;
};

let sharedStore: SharedObservationHistoryStore | null = null;

export async function resolveSharedObservationHistoryStore(
  _config?: CrawClawConfig,
): Promise<undefined> {
  const cacheKey = "rust-owned";
  if (sharedStore?.cacheKey === cacheKey) {
    return await sharedStore.storePromise;
  }
  const storePromise = Promise.resolve(undefined);
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
  void input;
}
