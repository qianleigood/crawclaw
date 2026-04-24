import { AsyncLocalStorage } from "node:async_hooks";
import { resolveGlobalSingleton } from "../../shared/global-singleton.js";
import type { ObservationContext } from "./types.js";

const OBSERVATION_SCOPE_KEY: unique symbol = Symbol.for("crawclaw.observation.scope");

const observationScope = resolveGlobalSingleton<AsyncLocalStorage<ObservationContext>>(
  OBSERVATION_SCOPE_KEY,
  () => new AsyncLocalStorage<ObservationContext>(),
);

export function withObservationContext<T>(observation: ObservationContext, run: () => T): T {
  return observationScope.run(observation, run);
}

export function getCurrentObservationContext(): ObservationContext | undefined {
  return observationScope.getStore();
}
