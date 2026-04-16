import { getRuntimeConfigSnapshot } from "../../../config/config.js";
import {
  createSpecialAgentObservability,
  type SpecialAgentObservabilityParams,
} from "./observability.js";

type ConfiguredSpecialAgentObservabilityDeps = {
  getRuntimeConfigSnapshot: typeof getRuntimeConfigSnapshot;
  createSpecialAgentObservability: typeof createSpecialAgentObservability;
};

const defaultConfiguredSpecialAgentObservabilityDeps: ConfiguredSpecialAgentObservabilityDeps = {
  getRuntimeConfigSnapshot,
  createSpecialAgentObservability,
};

export function createConfiguredSpecialAgentObservability(
  params: Omit<SpecialAgentObservabilityParams, "config">,
  deps: ConfiguredSpecialAgentObservabilityDeps = defaultConfiguredSpecialAgentObservabilityDeps,
): {
  runtimeConfig: ReturnType<typeof getRuntimeConfigSnapshot> | undefined;
  observability: ReturnType<typeof createSpecialAgentObservability>;
} {
  const runtimeConfig = deps.getRuntimeConfigSnapshot() ?? undefined;
  return {
    runtimeConfig,
    observability: deps.createSpecialAgentObservability({
      ...params,
      config: runtimeConfig,
    }),
  };
}
