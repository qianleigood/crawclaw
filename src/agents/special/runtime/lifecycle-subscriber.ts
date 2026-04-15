import {
  registerRunLoopLifecycleHandler,
  unregisterRunLoopLifecycleHandler,
} from "../../runtime/lifecycle/bus.js";
import type {
  RunLoopLifecycleHandler,
  RunLoopLifecyclePhase,
} from "../../runtime/lifecycle/types.js";

export type ManagedRunLoopLifecycleSubscriber = {
  ensureRegistered(): void;
  dispose(): void;
};

export function createRunLoopLifecycleRegistration(params: {
  phases: RunLoopLifecyclePhase[];
  handler: RunLoopLifecycleHandler;
}): ManagedRunLoopLifecycleSubscriber {
  let registered = false;

  return {
    ensureRegistered(): void {
      if (registered) {
        return;
      }
      for (const phase of params.phases) {
        registerRunLoopLifecycleHandler(phase, params.handler);
      }
      registered = true;
    },
    dispose(): void {
      if (!registered) {
        return;
      }
      for (const phase of params.phases) {
        unregisterRunLoopLifecycleHandler(phase, params.handler);
      }
      registered = false;
    },
  };
}

export function createSharedLifecycleSubscriberAccessor<
  T extends ManagedRunLoopLifecycleSubscriber,
  P,
>(
  factory: (params: P) => T,
): {
  get(params: P): T;
  reset(): void;
} {
  let shared: T | null = null;

  return {
    get(params: P): T {
      if (!shared) {
        shared = factory(params);
        shared.ensureRegistered();
        return shared;
      }

      const maybeReconfigurable = shared as T & {
        reconfigure?: (next: P) => void;
      };
      maybeReconfigurable.reconfigure?.(params);
      shared.ensureRegistered();
      return shared;
    },
    reset(): void {
      shared?.dispose();
      shared = null;
    },
  };
}
