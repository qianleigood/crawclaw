import type {
  SpecialAgentCachePolicy,
  SpecialAgentDefinition,
  SpecialAgentToolPolicy,
} from "./types.js";

export function createRuntimeDenyToolPolicy(
  allowlist: readonly string[],
  options?: {
    modelVisibility?: SpecialAgentToolPolicy["modelVisibility"];
  },
): SpecialAgentToolPolicy {
  return {
    allowlist: [...allowlist],
    enforcement: "runtime_deny",
    ...(options?.modelVisibility ? { modelVisibility: options.modelVisibility } : {}),
  };
}

export function createShortMemoryCachePolicy(): SpecialAgentCachePolicy {
  return {
    cacheRetention: "short",
    skipWrite: true,
  };
}

export function createEmbeddedMemorySpecialAgentDefinition(params: {
  id: string;
  label: string;
  spawnSource: string;
  allowlist: readonly string[];
  modelVisibility?: SpecialAgentToolPolicy["modelVisibility"];
  defaultRunTimeoutSeconds: number;
  defaultMaxTurns: number;
}): SpecialAgentDefinition {
  return {
    id: params.id,
    label: params.label,
    spawnSource: params.spawnSource,
    executionMode: "embedded_fork",
    transcriptPolicy: "isolated",
    toolPolicy: createRuntimeDenyToolPolicy(params.allowlist, {
      modelVisibility: params.modelVisibility,
    }),
    cachePolicy: createShortMemoryCachePolicy(),
    mode: "run",
    cleanup: "keep",
    sandbox: "inherit",
    expectsCompletionMessage: false,
    defaultRunTimeoutSeconds: params.defaultRunTimeoutSeconds,
    defaultMaxTurns: params.defaultMaxTurns,
  };
}
