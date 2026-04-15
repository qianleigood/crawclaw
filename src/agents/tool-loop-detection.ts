import { createHash } from "node:crypto";
import type { ToolLoopDetectionConfig } from "../config/types.tools.js";
import type { SessionState } from "../logging/diagnostic-session-state.js";
import { createSubsystemLogger } from "../logging/subsystem.js";
import { isPlainObject } from "../utils.js";
import { resolveToolLoopBehavior } from "./loop/tool-loop-behavior.js";
import type { ProgressEnvelope, ProgressStateDelta } from "./loop/types.js";

const log = createSubsystemLogger("agents/loop-detection");

export type LoopDetectorKind =
  | "generic_repeat"
  | "known_poll_no_progress"
  | "global_circuit_breaker"
  | "ping_pong";

export type LoopDetectionResult =
  | { stuck: false }
  | {
      stuck: true;
      level: "warning" | "critical";
      detector: LoopDetectorKind;
      count: number;
      message: string;
      pairedToolName?: string;
      warningKey?: string;
    };

export const TOOL_CALL_HISTORY_SIZE = 30;
export const WARNING_THRESHOLD = 10;
export const CRITICAL_THRESHOLD = 20;
export const GLOBAL_CIRCUIT_BREAKER_THRESHOLD = 30;
const DEFAULT_LOOP_DETECTION_CONFIG = {
  enabled: false,
  historySize: TOOL_CALL_HISTORY_SIZE,
  warningThreshold: WARNING_THRESHOLD,
  criticalThreshold: CRITICAL_THRESHOLD,
  globalCircuitBreakerThreshold: GLOBAL_CIRCUIT_BREAKER_THRESHOLD,
  detectors: {
    genericRepeat: true,
    knownPollNoProgress: true,
    pingPong: true,
  },
};

type ResolvedLoopDetectionConfig = {
  enabled: boolean;
  historySize: number;
  warningThreshold: number;
  criticalThreshold: number;
  globalCircuitBreakerThreshold: number;
  detectors: {
    genericRepeat: boolean;
    knownPollNoProgress: boolean;
    pingPong: boolean;
  };
};

type DetectLoopByFingerprintParams = {
  toolName: string;
  inputFingerprint: string;
  isPollingTool: boolean;
};

function asPositiveInt(value: number | undefined, fallback: number): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    return fallback;
  }
  return value;
}

function resolveLoopDetectionConfig(config?: ToolLoopDetectionConfig): ResolvedLoopDetectionConfig {
  let warningThreshold = asPositiveInt(
    config?.warningThreshold,
    DEFAULT_LOOP_DETECTION_CONFIG.warningThreshold,
  );
  let criticalThreshold = asPositiveInt(
    config?.criticalThreshold,
    DEFAULT_LOOP_DETECTION_CONFIG.criticalThreshold,
  );
  let globalCircuitBreakerThreshold = asPositiveInt(
    config?.globalCircuitBreakerThreshold,
    DEFAULT_LOOP_DETECTION_CONFIG.globalCircuitBreakerThreshold,
  );

  if (criticalThreshold <= warningThreshold) {
    criticalThreshold = warningThreshold + 1;
  }
  if (globalCircuitBreakerThreshold <= criticalThreshold) {
    globalCircuitBreakerThreshold = criticalThreshold + 1;
  }

  return {
    enabled: config?.enabled ?? DEFAULT_LOOP_DETECTION_CONFIG.enabled,
    historySize: asPositiveInt(config?.historySize, DEFAULT_LOOP_DETECTION_CONFIG.historySize),
    warningThreshold,
    criticalThreshold,
    globalCircuitBreakerThreshold,
    detectors: {
      genericRepeat:
        config?.detectors?.genericRepeat ?? DEFAULT_LOOP_DETECTION_CONFIG.detectors.genericRepeat,
      knownPollNoProgress:
        config?.detectors?.knownPollNoProgress ??
        DEFAULT_LOOP_DETECTION_CONFIG.detectors.knownPollNoProgress,
      pingPong: config?.detectors?.pingPong ?? DEFAULT_LOOP_DETECTION_CONFIG.detectors.pingPong,
    },
  };
}

/**
 * Hash a tool call for pattern matching.
 * Uses tool name + deterministic JSON serialization digest of params.
 */
export function hashToolCall(toolName: string, params: unknown): string {
  return `${toolName}:${digestStable(params)}`;
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).toSorted();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(",")}}`;
}

function digestStable(value: unknown): string {
  const serialized = stableStringifyFallback(value);
  return createHash("sha256").update(serialized).digest("hex");
}

function stableStringifyFallback(value: unknown): string {
  try {
    return stableStringify(value);
  } catch {
    if (value === null || value === undefined) {
      return `${value}`;
    }
    if (typeof value === "string") {
      return value;
    }
    if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
      return `${value}`;
    }
    if (value instanceof Error) {
      return `${value.name}:${value.message}`;
    }
    return Object.prototype.toString.call(value);
  }
}

function isKnownPollToolCall(toolName: string, params: unknown): boolean {
  return resolveToolLoopBehavior(toolName, params).isPollingTool;
}

function extractTextContent(result: unknown): string {
  if (!isPlainObject(result) || !Array.isArray(result.content)) {
    return "";
  }
  return result.content
    .filter(
      (entry): entry is { type: string; text: string } =>
        isPlainObject(entry) && typeof entry.type === "string" && typeof entry.text === "string",
    )
    .map((entry) => entry.text)
    .join("\n")
    .trim();
}

function formatErrorForHash(error: unknown): string {
  if (error instanceof Error) {
    return error.message || error.name;
  }
  if (typeof error === "string") {
    return error;
  }
  if (typeof error === "number" || typeof error === "boolean" || typeof error === "bigint") {
    return `${error}`;
  }
  return stableStringify(error);
}

function hashToolOutcome(
  toolName: string,
  params: unknown,
  result: unknown,
  error: unknown,
): string | undefined {
  if (error !== undefined) {
    return `error:${digestStable(formatErrorForHash(error))}`;
  }
  if (!isPlainObject(result)) {
    return result === undefined ? undefined : digestStable(result);
  }

  const details = isPlainObject(result.details) ? result.details : {};
  const text = extractTextContent(result);
  if (isKnownPollToolCall(toolName, params) && toolName === "process" && isPlainObject(params)) {
    const action = params.action;
    if (action === "poll") {
      return digestStable({
        action,
        status: details.status,
        exitCode: details.exitCode ?? null,
        exitSignal: details.exitSignal ?? null,
        aggregated: details.aggregated ?? null,
        text,
      });
    }
    if (action === "log") {
      return digestStable({
        action,
        status: details.status,
        totalLines: details.totalLines ?? null,
        totalChars: details.totalChars ?? null,
        truncated: details.truncated ?? null,
        exitCode: details.exitCode ?? null,
        exitSignal: details.exitSignal ?? null,
        text,
      });
    }
  }

  return digestStable({
    details,
    text,
  });
}

function getProgressHistory(state: SessionState): ProgressEnvelope[] {
  return state.loopProgressHistory ?? [];
}

function ensureLoopProgressHistory(state: SessionState): ProgressEnvelope[] {
  if (!state.loopProgressHistory) {
    state.loopProgressHistory = [];
  }
  return state.loopProgressHistory;
}

function getNoProgressStreak(
  history: ProgressEnvelope[],
  toolName: string,
  inputFingerprint: string,
): { count: number; latestResultHash?: string } {
  let streak = 0;
  let latestResultHash: string | undefined;

  for (let i = history.length - 1; i >= 0; i -= 1) {
    const record = history[i];
    if (!record || record.toolName !== toolName || record.inputFingerprint !== inputFingerprint) {
      continue;
    }
    if (typeof record.outputFingerprint !== "string" || !record.outputFingerprint) {
      continue;
    }
    if (!latestResultHash) {
      latestResultHash = record.outputFingerprint;
      streak = 1;
      continue;
    }
    if (record.outputFingerprint !== latestResultHash) {
      break;
    }
    streak += 1;
  }

  return { count: streak, latestResultHash };
}

function getPingPongStreak(
  history: ProgressEnvelope[],
  currentInputFingerprint: string,
): {
  count: number;
  pairedToolName?: string;
  pairedSignature?: string;
  noProgressEvidence: boolean;
} {
  const last = history.at(-1);
  if (!last) {
    return { count: 0, noProgressEvidence: false };
  }

  let otherSignature: string | undefined;
  let otherToolName: string | undefined;
  for (let i = history.length - 2; i >= 0; i -= 1) {
    const call = history[i];
    if (!call) {
      continue;
    }
    if (call.inputFingerprint !== last.inputFingerprint) {
      otherSignature = call.inputFingerprint;
      otherToolName = call.toolName;
      break;
    }
  }

  if (!otherSignature || !otherToolName) {
    return { count: 0, noProgressEvidence: false };
  }

  let alternatingTailCount = 0;
  for (let i = history.length - 1; i >= 0; i -= 1) {
    const call = history[i];
    if (!call) {
      continue;
    }
    const expected = alternatingTailCount % 2 === 0 ? last.inputFingerprint : otherSignature;
    if (call.inputFingerprint !== expected) {
      break;
    }
    alternatingTailCount += 1;
  }

  if (alternatingTailCount < 2) {
    return { count: 0, noProgressEvidence: false };
  }

  const expectedCurrentSignature = otherSignature;
  if (currentInputFingerprint !== expectedCurrentSignature) {
    return { count: 0, noProgressEvidence: false };
  }

  const tailStart = Math.max(0, history.length - alternatingTailCount);
  let firstHashA: string | undefined;
  let firstHashB: string | undefined;
  let noProgressEvidence = true;
  for (let i = tailStart; i < history.length; i += 1) {
    const call = history[i];
    if (!call) {
      continue;
    }
    if (!call.outputFingerprint) {
      noProgressEvidence = false;
      break;
    }
    if (call.inputFingerprint === last.inputFingerprint) {
      if (!firstHashA) {
        firstHashA = call.outputFingerprint;
      } else if (firstHashA !== call.outputFingerprint) {
        noProgressEvidence = false;
        break;
      }
      continue;
    }
    if (call.inputFingerprint === otherSignature) {
      if (!firstHashB) {
        firstHashB = call.outputFingerprint;
      } else if (firstHashB !== call.outputFingerprint) {
        noProgressEvidence = false;
        break;
      }
      continue;
    }
    noProgressEvidence = false;
    break;
  }

  // Need repeated stable outcomes on both sides before treating ping-pong as no-progress.
  if (!firstHashA || !firstHashB) {
    noProgressEvidence = false;
  }

  return {
    count: alternatingTailCount + 1,
    pairedToolName: last.toolName,
    pairedSignature: last.inputFingerprint,
    noProgressEvidence,
  };
}

function canonicalPairKey(signatureA: string, signatureB: string): string {
  return [signatureA, signatureB].toSorted().join("|");
}

/**
 * Detect if an agent is stuck in a repetitive tool call loop.
 * Checks if the same tool+params combination has been called excessively.
 */
export function detectToolCallLoop(
  state: SessionState,
  toolName: string,
  params: unknown,
  config?: ToolLoopDetectionConfig,
): LoopDetectionResult {
  const behavior = resolveToolLoopBehavior(toolName, params);
  return detectToolCallLoopByFingerprint(
    state,
    {
      toolName,
      inputFingerprint: hashToolCall(toolName, params),
      isPollingTool: behavior.isPollingTool,
    },
    config,
  );
}

export function detectToolCallLoopByFingerprint(
  state: SessionState,
  current: DetectLoopByFingerprintParams,
  config?: ToolLoopDetectionConfig,
): LoopDetectionResult {
  const resolvedConfig = resolveLoopDetectionConfig(config);
  if (!resolvedConfig.enabled) {
    return { stuck: false };
  }
  const history = getProgressHistory(state);
  const currentInputFingerprint = current.inputFingerprint;
  const noProgress = getNoProgressStreak(history, current.toolName, currentInputFingerprint);
  const noProgressStreak = noProgress.count;
  const knownPollTool = current.isPollingTool;
  const pingPong = getPingPongStreak(history, currentInputFingerprint);

  if (noProgressStreak >= resolvedConfig.globalCircuitBreakerThreshold) {
    log.error(
      `Global circuit breaker triggered: ${current.toolName} repeated ${noProgressStreak} times with no progress`,
    );
    return {
      stuck: true,
      level: "critical",
      detector: "global_circuit_breaker",
      count: noProgressStreak,
      message: `CRITICAL: ${current.toolName} has repeated identical no-progress outcomes ${noProgressStreak} times. Session execution blocked by global circuit breaker to prevent runaway loops.`,
      warningKey: `global:${current.toolName}:${currentInputFingerprint}:${noProgress.latestResultHash ?? "none"}`,
    };
  }

  if (
    knownPollTool &&
    resolvedConfig.detectors.knownPollNoProgress &&
    noProgressStreak >= resolvedConfig.criticalThreshold
  ) {
    log.error(
      `Critical polling loop detected: ${current.toolName} repeated ${noProgressStreak} times`,
    );
    return {
      stuck: true,
      level: "critical",
      detector: "known_poll_no_progress",
      count: noProgressStreak,
      message: `CRITICAL: Called ${current.toolName} with identical arguments and no progress ${noProgressStreak} times. This appears to be a stuck polling loop. Session execution blocked to prevent resource waste.`,
      warningKey: `poll:${current.toolName}:${currentInputFingerprint}:${noProgress.latestResultHash ?? "none"}`,
    };
  }

  if (
    knownPollTool &&
    resolvedConfig.detectors.knownPollNoProgress &&
    noProgressStreak >= resolvedConfig.warningThreshold
  ) {
    log.warn(`Polling loop warning: ${current.toolName} repeated ${noProgressStreak} times`);
    return {
      stuck: true,
      level: "warning",
      detector: "known_poll_no_progress",
      count: noProgressStreak,
      message: `WARNING: You have called ${current.toolName} ${noProgressStreak} times with identical arguments and no progress. Stop polling and either (1) increase wait time between checks, or (2) report the task as failed if the process is stuck.`,
      warningKey: `poll:${current.toolName}:${currentInputFingerprint}:${noProgress.latestResultHash ?? "none"}`,
    };
  }

  const pingPongWarningKey = pingPong.pairedSignature
    ? `pingpong:${canonicalPairKey(currentInputFingerprint, pingPong.pairedSignature)}`
    : `pingpong:${current.toolName}:${currentInputFingerprint}`;

  if (
    resolvedConfig.detectors.pingPong &&
    pingPong.count >= resolvedConfig.criticalThreshold &&
    pingPong.noProgressEvidence
  ) {
    log.error(
      `Critical ping-pong loop detected: alternating calls count=${pingPong.count} currentTool=${current.toolName}`,
    );
    return {
      stuck: true,
      level: "critical",
      detector: "ping_pong",
      count: pingPong.count,
      message: `CRITICAL: You are alternating between repeated tool-call patterns (${pingPong.count} consecutive calls) with no progress. This appears to be a stuck ping-pong loop. Session execution blocked to prevent resource waste.`,
      pairedToolName: pingPong.pairedToolName,
      warningKey: pingPongWarningKey,
    };
  }

  if (resolvedConfig.detectors.pingPong && pingPong.count >= resolvedConfig.warningThreshold) {
    log.warn(
      `Ping-pong loop warning: alternating calls count=${pingPong.count} currentTool=${current.toolName}`,
    );
    return {
      stuck: true,
      level: "warning",
      detector: "ping_pong",
      count: pingPong.count,
      message: `WARNING: You are alternating between repeated tool-call patterns (${pingPong.count} consecutive calls). This looks like a ping-pong loop; stop retrying and report the task as failed.`,
      pairedToolName: pingPong.pairedToolName,
      warningKey: pingPongWarningKey,
    };
  }

  // Generic detector: warn-only for repeated identical calls.
  const recentCount = history.filter(
    (h) => h.toolName === current.toolName && h.inputFingerprint === currentInputFingerprint,
  ).length;

  if (
    !knownPollTool &&
    resolvedConfig.detectors.genericRepeat &&
    recentCount >= resolvedConfig.warningThreshold
  ) {
    log.warn(
      `Loop warning: ${current.toolName} called ${recentCount} times with identical arguments`,
    );
    return {
      stuck: true,
      level: "warning",
      detector: "generic_repeat",
      count: recentCount,
      message: `WARNING: You have called ${current.toolName} ${recentCount} times with identical arguments. If this is not making progress, stop retrying and report the task as failed.`,
      warningKey: `generic:${current.toolName}:${currentInputFingerprint}`,
    };
  }

  return { stuck: false };
}

export function recordProgressEnvelope(
  state: SessionState,
  envelope: ProgressEnvelope,
  config?: ToolLoopDetectionConfig,
): void {
  const resolvedConfig = resolveLoopDetectionConfig(config);
  const progressHistory = ensureLoopProgressHistory(state);
  progressHistory.push(envelope);
  if (progressHistory.length > resolvedConfig.historySize) {
    progressHistory.splice(0, progressHistory.length - resolvedConfig.historySize);
  }
}

/**
 * Record a tool call in the session's history for loop detection.
 * Maintains sliding window of last N calls.
 */
export function recordToolCall(
  state: SessionState,
  toolName: string,
  params: unknown,
  toolCallId?: string,
  config?: ToolLoopDetectionConfig,
): void {
  const resolvedConfig = resolveLoopDetectionConfig(config);
  const inputFingerprint = hashToolCall(toolName, params);
  const progressHistory = ensureLoopProgressHistory(state);
  progressHistory.push({
    toolName,
    toolCategory: resolveToolLoopBehavior(toolName, params).category,
    inputFingerprint,
    ...(toolCallId ? { toolCallId } : {}),
    outcomeClass: "pending",
    stateDelta: "unknown",
    timestamp: Date.now(),
  });

  if (progressHistory.length > resolvedConfig.historySize) {
    progressHistory.splice(0, progressHistory.length - resolvedConfig.historySize);
  }
}

/**
 * Record a completed tool call outcome so loop detection can identify no-progress repeats.
 */
export function recordToolCallOutcome(
  state: SessionState,
  params: {
    toolName: string;
    toolParams: unknown;
    toolCallId?: string;
    result?: unknown;
    error?: unknown;
    config?: ToolLoopDetectionConfig;
  },
): void {
  const resolvedConfig = resolveLoopDetectionConfig(params.config);
  const outputFingerprint = hashToolOutcome(
    params.toolName,
    params.toolParams,
    params.result,
    params.error,
  );
  if (!outputFingerprint) {
    return;
  }

  const progressHistory = ensureLoopProgressHistory(state);

  const inputFingerprint = hashToolCall(params.toolName, params.toolParams);
  let previousMatchingOutcome: ProgressEnvelope | undefined;
  for (let i = progressHistory.length - 1; i >= 0; i -= 1) {
    const entry = progressHistory[i];
    if (
      entry?.toolName === params.toolName &&
      entry.inputFingerprint === inputFingerprint &&
      entry.outputFingerprint &&
      (!params.toolCallId || entry.toolCallId !== params.toolCallId)
    ) {
      previousMatchingOutcome = entry;
      break;
    }
  }
  const stateDelta: ProgressStateDelta =
    params.error !== undefined
      ? previousMatchingOutcome?.outputFingerprint === outputFingerprint
        ? "same_error"
        : "new_error"
      : previousMatchingOutcome?.outputFingerprint === outputFingerprint
        ? "same_result"
        : "new_result";
  let matched = false;
  for (let i = progressHistory.length - 1; i >= 0; i -= 1) {
    const call = progressHistory[i];
    if (!call) {
      continue;
    }
    if (params.toolCallId && call.toolCallId !== params.toolCallId) {
      continue;
    }
    if (call.toolName !== params.toolName || call.inputFingerprint !== inputFingerprint) {
      continue;
    }
    if (call.outputFingerprint !== undefined) {
      continue;
    }
    call.outputFingerprint = outputFingerprint;
    call.outcomeClass = params.error !== undefined ? "error" : "success";
    call.stateDelta = stateDelta;
    matched = true;
    break;
  }

  if (!matched) {
    progressHistory.push({
      toolName: params.toolName,
      toolCategory: resolveToolLoopBehavior(params.toolName, params.toolParams).category,
      inputFingerprint,
      toolCallId: params.toolCallId,
      outputFingerprint,
      outcomeClass: params.error !== undefined ? "error" : "success",
      stateDelta,
      timestamp: Date.now(),
    });
  }

  if (progressHistory.length > resolvedConfig.historySize) {
    progressHistory.splice(0, progressHistory.length - resolvedConfig.historySize);
  }
}

/**
 * Get current tool call statistics for a session (for debugging/monitoring).
 */
export function getToolCallStats(state: SessionState): {
  totalCalls: number;
  uniquePatterns: number;
  mostFrequent: { toolName: string; count: number } | null;
} {
  const history = getProgressHistory(state);
  const patterns = new Map<string, { toolName: string; count: number }>();

  for (const call of history) {
    const key = call.inputFingerprint;
    const existing = patterns.get(key);
    if (existing) {
      existing.count += 1;
    } else {
      patterns.set(key, { toolName: call.toolName, count: 1 });
    }
  }

  let mostFrequent: { toolName: string; count: number } | null = null;
  for (const pattern of patterns.values()) {
    if (!mostFrequent || pattern.count > mostFrequent.count) {
      mostFrequent = pattern;
    }
  }

  return {
    totalCalls: history.length,
    uniquePatterns: patterns.size,
    mostFrequent,
  };
}
