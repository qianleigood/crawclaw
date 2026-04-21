import type {
  SpecialAgentCachePolicy,
  SpecialAgentDefinition,
  SpecialAgentToolPolicy,
} from "./types.js";

export function createRuntimeDenyToolPolicy(allowlist: readonly string[]): SpecialAgentToolPolicy {
  return {
    allowlist: [...allowlist],
    enforcement: "runtime_deny",
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
  defaultRunTimeoutSeconds: number;
  defaultMaxTurns: number;
}): SpecialAgentDefinition {
  return {
    id: params.id,
    label: params.label,
    spawnSource: params.spawnSource,
    executionMode: "embedded_fork",
    transcriptPolicy: "isolated",
    toolPolicy: createRuntimeDenyToolPolicy(params.allowlist),
    cachePolicy: createShortMemoryCachePolicy(),
    mode: "run",
    cleanup: "keep",
    sandbox: "inherit",
    expectsCompletionMessage: false,
    defaultRunTimeoutSeconds: params.defaultRunTimeoutSeconds,
    defaultMaxTurns: params.defaultMaxTurns,
  };
}
