import type { CrawClawConfig } from "../config/config.js";
import { findNormalizedProviderValue } from "./provider-id.js";

export const CONTEXT_WINDOW_HARD_MIN_TOKENS = 16_000;
export const CONTEXT_WINDOW_WARN_BELOW_TOKENS = 32_000;

export type ContextWindowSource = "model" | "modelsConfig" | "agentContextTokens" | "default";

export type ContextWindowInfo = {
  tokens: number;
  source: ContextWindowSource;
};

export type ModelContextBudgetConfidence = "high" | "low";

export type ModelContextBudget = {
  windowTokens: number;
  usableInputTokens: number;
  memoryBudgetTokens: number;
  outputReserveTokens: number;
  providerOverheadTokens: number;
  toolSchemaTokens: number;
  source: ContextWindowSource;
  confidence: ModelContextBudgetConfidence;
};

export type ContextBudgetPolicy = {
  compactTriggerTokens: number;
  memoryFlushTriggerTokens: number;
  memoryFlushLeadTokens: number;
  timeoutRecoveryTriggerTokens: number;
  sessionSummary: {
    lightInitialTokenThreshold: number;
    initialTokenThreshold: number;
    updateTokenThreshold: number;
  };
  compaction: {
    tailMinTokens: number;
    tailMaxTokens: number;
    minTextMessages: number;
    compactSummaryBudgetTokens: number;
  };
};

function normalizePositiveInt(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }
  const int = Math.floor(value);
  return int > 0 ? int : null;
}

export function resolveContextWindowInfo(params: {
  cfg: CrawClawConfig | undefined;
  provider: string;
  modelId: string;
  modelContextWindow?: number;
  defaultTokens: number;
}): ContextWindowInfo {
  const fromModelsConfig = (() => {
    const providers = params.cfg?.models?.providers as
      | Record<string, { models?: Array<{ id?: string; contextWindow?: number }> }>
      | undefined;
    const providerEntry = findNormalizedProviderValue(providers, params.provider);
    const models = Array.isArray(providerEntry?.models) ? providerEntry.models : [];
    const match = models.find((m) => m?.id === params.modelId);
    return normalizePositiveInt(match?.contextWindow);
  })();
  const fromModel = normalizePositiveInt(params.modelContextWindow);
  const baseInfo = fromModelsConfig
    ? { tokens: fromModelsConfig, source: "modelsConfig" as const }
    : fromModel
      ? { tokens: fromModel, source: "model" as const }
      : { tokens: Math.floor(params.defaultTokens), source: "default" as const };

  const capTokens = normalizePositiveInt(params.cfg?.agents?.defaults?.contextTokens);
  if (capTokens && capTokens < baseInfo.tokens) {
    return { tokens: capTokens, source: "agentContextTokens" };
  }

  return baseInfo;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function clampInt(value: number, min: number, max: number): number {
  return Math.floor(clamp(Math.floor(value), min, max));
}

function resolveMemoryBudgetTokens(windowTokens: number): number {
  const raw = Math.floor(windowTokens * 0.04);
  if (windowTokens >= 1_000_000) {
    return clamp(raw, 4_000, 6_000);
  }
  if (windowTokens >= 256_000) {
    return clamp(raw, 2_400, 4_000);
  }
  if (windowTokens >= 128_000) {
    return clamp(raw, 1_200, 2_400);
  }
  if (windowTokens >= 32_000) {
    return clamp(raw, 700, 1_100);
  }
  return clamp(raw, 400, 700);
}

export function resolveModelContextBudget(params: {
  info: ContextWindowInfo;
  modelMaxTokens?: number;
  toolSchemaTokens?: number;
}): ModelContextBudget {
  const windowTokens = Math.max(1, Math.floor(params.info.tokens));
  const modelMaxTokens = normalizePositiveInt(params.modelMaxTokens);
  const outputReserveTokens = clamp(
    modelMaxTokens ?? Math.floor(windowTokens * 0.08),
    1_024,
    Math.min(32_768, Math.floor(windowTokens * 0.2)),
  );
  const providerOverheadTokens = clamp(Math.floor(windowTokens * 0.03), 512, 8_192);
  const toolSchemaTokens = Math.max(0, Math.floor(params.toolSchemaTokens ?? 0));
  const usableInputTokens = Math.max(
    0,
    Math.floor(windowTokens * 0.88) -
      outputReserveTokens -
      providerOverheadTokens -
      toolSchemaTokens,
  );
  return {
    windowTokens,
    usableInputTokens,
    memoryBudgetTokens: resolveMemoryBudgetTokens(windowTokens),
    outputReserveTokens,
    providerOverheadTokens,
    toolSchemaTokens,
    source: params.info.source,
    confidence: params.info.source === "default" ? "low" : "high",
  };
}

function resolveCompactionMinTextMessages(windowTokens: number): number {
  if (windowTokens < 32_000) {
    return 5;
  }
  if (windowTokens < 128_000) {
    return 8;
  }
  return 12;
}

export function resolveContextBudgetPolicy(
  budget: Pick<ModelContextBudget, "windowTokens" | "usableInputTokens">,
): ContextBudgetPolicy {
  const windowTokens = Math.max(1, Math.floor(budget.windowTokens));
  const usableInputTokens = Math.max(0, Math.floor(budget.usableInputTokens));
  const compactTriggerTokens = Math.floor(usableInputTokens * 0.92);
  const memoryFlushLeadTokens = clampInt(windowTokens * 0.02, 1_000, 8_000);
  const tailMinTokens = clampInt(windowTokens * 0.01, 240, 6_000);
  const tailMaxTokens = Math.max(tailMinTokens, clampInt(windowTokens * 0.03, 840, 24_000));

  return {
    compactTriggerTokens,
    memoryFlushTriggerTokens: Math.max(0, compactTriggerTokens - memoryFlushLeadTokens),
    memoryFlushLeadTokens,
    timeoutRecoveryTriggerTokens: Math.floor(usableInputTokens * 0.85),
    sessionSummary: {
      lightInitialTokenThreshold: clampInt(windowTokens * 0.025, 1_200, 24_000),
      initialTokenThreshold: clampInt(windowTokens * 0.08, 5_000, 80_000),
      updateTokenThreshold: clampInt(windowTokens * 0.04, 2_000, 40_000),
    },
    compaction: {
      tailMinTokens,
      tailMaxTokens,
      minTextMessages: resolveCompactionMinTextMessages(windowTokens),
      compactSummaryBudgetTokens: clampInt(windowTokens * 0.01, 600, 6_000),
    },
  };
}

export function resolveContextBudgetPolicyFromWindow(windowTokens: number): ContextBudgetPolicy {
  return resolveContextBudgetPolicy(
    resolveModelContextBudget({
      info: { tokens: windowTokens, source: "model" },
    }),
  );
}

export type ContextWindowGuardResult = ContextWindowInfo & {
  shouldWarn: boolean;
  shouldBlock: boolean;
};

export function evaluateContextWindowGuard(params: {
  info: ContextWindowInfo;
  warnBelowTokens?: number;
  hardMinTokens?: number;
}): ContextWindowGuardResult {
  const warnBelow = Math.max(
    1,
    Math.floor(params.warnBelowTokens ?? CONTEXT_WINDOW_WARN_BELOW_TOKENS),
  );
  const hardMin = Math.max(1, Math.floor(params.hardMinTokens ?? CONTEXT_WINDOW_HARD_MIN_TOKENS));
  const tokens = Math.max(0, Math.floor(params.info.tokens));
  return {
    ...params.info,
    tokens,
    shouldWarn: tokens > 0 && tokens < warnBelow,
    shouldBlock: tokens > 0 && tokens < hardMin,
  };
}
