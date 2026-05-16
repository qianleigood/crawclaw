import { resolveAgentSessionLane } from "../../../agents/runtime-support/lanes.js";
import { clearCommandLane } from "../../../process/command-queue.js";
import { clearFollowupDrainCallback } from "./drain.js";
import { clearFollowupQueue } from "./state.js";

export type ClearSessionQueueResult = {
  followupCleared: number;
  laneCleared: number;
  keys: string[];
};

const defaultQueueCleanupDeps = {
  resolveAgentSessionLane,
  clearCommandLane,
};

const queueCleanupDeps = {
  ...defaultQueueCleanupDeps,
};

function resolveQueueCleanupLaneResolver() {
  return typeof queueCleanupDeps.resolveAgentSessionLane === "function"
    ? queueCleanupDeps.resolveAgentSessionLane
    : defaultQueueCleanupDeps.resolveAgentSessionLane;
}

function resolveQueueCleanupLaneClearer() {
  return typeof queueCleanupDeps.clearCommandLane === "function"
    ? queueCleanupDeps.clearCommandLane
    : defaultQueueCleanupDeps.clearCommandLane;
}

export const __testing = {
  setDepsForTests(deps: Partial<typeof defaultQueueCleanupDeps> | undefined): void {
    queueCleanupDeps.resolveAgentSessionLane =
      typeof deps?.resolveAgentSessionLane === "function"
        ? deps.resolveAgentSessionLane
        : defaultQueueCleanupDeps.resolveAgentSessionLane;
    queueCleanupDeps.clearCommandLane =
      typeof deps?.clearCommandLane === "function"
        ? deps.clearCommandLane
        : defaultQueueCleanupDeps.clearCommandLane;
  },
  resetDepsForTests(): void {
    queueCleanupDeps.resolveAgentSessionLane = defaultQueueCleanupDeps.resolveAgentSessionLane;
    queueCleanupDeps.clearCommandLane = defaultQueueCleanupDeps.clearCommandLane;
  },
};

export function clearSessionQueues(keys: Array<string | undefined>): ClearSessionQueueResult {
  const seen = new Set<string>();
  let followupCleared = 0;
  let laneCleared = 0;
  const clearedKeys: string[] = [];
  const resolveLane = resolveQueueCleanupLaneResolver();
  const clearLane = resolveQueueCleanupLaneClearer();

  for (const key of keys) {
    const cleaned = key?.trim();
    if (!cleaned || seen.has(cleaned)) {
      continue;
    }
    seen.add(cleaned);
    clearedKeys.push(cleaned);
    followupCleared += clearFollowupQueue(cleaned);
    clearFollowupDrainCallback(cleaned);
    laneCleared += clearLane(resolveLane(cleaned));
  }

  return { followupCleared, laneCleared, keys: clearedKeys };
}
