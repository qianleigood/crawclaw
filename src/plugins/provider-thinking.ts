import type {
  ProviderDefaultThinkingPolicyContext,
  ProviderThinkingPolicyContext,
} from "./types.js";

type ThinkingHookParams<TContext> = {
  provider: string;
  context: TContext;
};

export function resolveProviderBinaryThinking(
  _params: ThinkingHookParams<ProviderThinkingPolicyContext>,
): boolean | undefined {
  return undefined;
}

export function resolveProviderXHighThinking(
  _params: ThinkingHookParams<ProviderThinkingPolicyContext>,
): boolean | undefined {
  return undefined;
}

export function resolveProviderDefaultThinkingLevel(
  _params: ThinkingHookParams<ProviderDefaultThinkingPolicyContext>,
): "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "adaptive" | undefined {
  return undefined;
}
