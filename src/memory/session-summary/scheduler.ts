import type { AgentMessage } from "@mariozechner/pi-agent-core";
import { isSubagentSessionKey } from "../../sessions/session-key-utils.ts";
import { estimateTokenCount } from "../recall/token-estimate.ts";
import type { RuntimeStore } from "../runtime/runtime-store.ts";
import type { SessionSummaryRunResult } from "./agent-runner.ts";
import { persistSessionSummaryPromotionCandidates } from "./promotion.ts";
import { isSessionSummaryEffectivelyEmpty } from "./sections.ts";
import { readSessionSummaryFile } from "./store.ts";
import {
  buildSessionSummaryTemplate,
  inferSessionSummaryProfile,
  renderSessionSummaryDocument,
  parseSessionSummaryDocument,
  type SessionSummaryProfile,
  type SessionSummaryDocument,
} from "./template.ts";

type RuntimeLogger = { info(msg: string): void; warn(msg: string): void; error(msg: string): void };

export type SessionSummarySchedulerConfig = {
  enabled: boolean;
  lightInitialTokenThreshold?: number;
  initialTokenThreshold?: number;
  updateTokenThreshold?: number;
  minToolCalls?: number;
  minIntervalMs?: number;
  runTimeoutSeconds?: number;
  maxTurns?: number;
};

export type SessionSummaryRunner = (
  params: SessionSummaryRunParams,
  logger?: RuntimeLogger,
) => Promise<SessionSummaryRunResult>;

export type SessionSummaryRunParams = {
  sessionId: string;
  sessionKey: string;
  sessionFile: string;
  workspaceDir: string;
  agentId: string;
  parentRunId?: string;
  recentMessages: AgentMessage[];
  recentMessageLimit: number;
  currentSummary?: SessionSummaryDocument | null;
  profile?: SessionSummaryProfile;
  runTimeoutSeconds?: number;
  maxTurns?: number;
  logger?: RuntimeLogger;
};

export type SessionSummaryGateReason =
  | "disabled"
  | "missing_session"
  | "subagent_session"
  | "turn_not_settled"
  | "below_initial_token_threshold"
  | "below_update_token_threshold"
  | "tool_call_threshold_unmet"
  | "cooldown"
  | "ready";

export type SessionSummaryGateDecision = {
  ready: boolean;
  reason: SessionSummaryGateReason;
  summaryTokenCount: number;
  summaryExists: boolean;
  currentTokenCount: number;
  tokenDelta: number;
};

export type SessionSummaryPreview = {
  sessionId: string;
  summaryPath: string;
  summaryExists: boolean;
  currentProfile: SessionSummaryProfile | null;
  targetProfile: SessionSummaryProfile;
  requiresFullUpgrade: boolean;
  summaryTokenCount: number;
  stateSummaryTokenCount: number;
  currentTokenCount: number;
  tokenDelta: number;
  recentMessageCount: number;
  recentMessageLimit: number;
  currentSummaryText: string;
  recentMessages: string[];
  gate: SessionSummaryGateDecision;
};

function clampInt(value: number | undefined, fallback: number, minimum = 1): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(minimum, Math.floor(value));
}

function normalizeOptionalString(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function collectRecentSessionSummaryMessages(params: {
  messages: AgentMessage[];
  limit: number;
}): string[] {
  const extractBlockText = (block: unknown): string => {
    if (!block || typeof block !== "object" || !("text" in block)) {
      return "";
    }
    const text = (block as { text?: unknown }).text;
    return typeof text === "string" ? text : "";
  };

  return params.messages
    .slice(-Math.max(1, params.limit))
    .map((message) => {
      const rawMessage = message as {
        role?: unknown;
        content?: unknown;
        contentText?: unknown;
      };
      const role = typeof rawMessage.role === "string" ? rawMessage.role : "unknown";
      const content =
        typeof rawMessage.content === "string"
          ? rawMessage.content
          : Array.isArray(rawMessage.content)
            ? rawMessage.content.map(extractBlockText).join(" ")
            : typeof rawMessage.contentText === "string"
              ? rawMessage.contentText
              : "";
      return `${role}: ${content}`.trim();
    })
    .filter(Boolean);
}

function resolveTokenDelta(params: {
  currentTokenCount?: number;
  summaryTokenCount?: number;
}): number {
  const current =
    typeof params.currentTokenCount === "number" && Number.isFinite(params.currentTokenCount)
      ? params.currentTokenCount
      : 0;
  const summary =
    typeof params.summaryTokenCount === "number" && Number.isFinite(params.summaryTokenCount)
      ? params.summaryTokenCount
      : 0;
  return Math.max(0, current - summary);
}

export function evaluateSessionSummaryGate(params: {
  enabled: boolean;
  sessionKey?: string;
  isSettledTurn?: boolean;
  summaryText?: string | null;
  stateSummaryTokenCount?: number;
  currentTokenCount?: number;
  toolCallCount?: number;
  lastSummaryUpdatedAt?: number | null;
  lightInitialTokenThreshold?: number;
  initialTokenThreshold?: number;
  updateTokenThreshold?: number;
  minToolCalls?: number;
  minIntervalMs?: number;
  requiresFullUpgrade?: boolean;
}): SessionSummaryGateDecision {
  const summaryText = params.summaryText?.trim() ?? "";
  const summaryExists = Boolean(summaryText);
  const summaryTokenCount = summaryText ? estimateTokenCount(summaryText) : 0;
  const currentTokenCount =
    typeof params.currentTokenCount === "number" && Number.isFinite(params.currentTokenCount)
      ? Math.max(0, Math.floor(params.currentTokenCount))
      : 0;
  const tokenDelta = resolveTokenDelta({
    currentTokenCount,
    summaryTokenCount: params.stateSummaryTokenCount ?? summaryTokenCount,
  });

  if (!params.enabled) {
    return {
      ready: false,
      reason: "disabled",
      summaryTokenCount,
      summaryExists,
      currentTokenCount,
      tokenDelta,
    };
  }
  if (!normalizeOptionalString(params.sessionKey)) {
    return {
      ready: false,
      reason: "missing_session",
      summaryTokenCount,
      summaryExists,
      currentTokenCount,
      tokenDelta,
    };
  }
  if (params.sessionKey && isSubagentSessionKey(params.sessionKey)) {
    return {
      ready: false,
      reason: "subagent_session",
      summaryTokenCount,
      summaryExists,
      currentTokenCount,
      tokenDelta,
    };
  }
  const initialThreshold = Math.max(1, params.initialTokenThreshold ?? 10_000);
  const lightInitialThreshold = Math.max(
    1,
    Math.min(
      initialThreshold,
      Math.floor(params.lightInitialTokenThreshold ?? Math.min(initialThreshold, 3_000)),
    ),
  );
  const updateThreshold = Math.max(1, params.updateTokenThreshold ?? 5_000);
  const minToolCalls = Math.max(0, params.minToolCalls ?? 3);
  const minIntervalMs = Math.max(0, params.minIntervalMs ?? 0);
  const now = Date.now();
  const lastUpdatedAt =
    typeof params.lastSummaryUpdatedAt === "number" && Number.isFinite(params.lastSummaryUpdatedAt)
      ? params.lastSummaryUpdatedAt
      : null;

  if (!summaryExists) {
    if (currentTokenCount < lightInitialThreshold) {
      return {
        ready: false,
        reason: "below_initial_token_threshold",
        summaryTokenCount,
        summaryExists,
        currentTokenCount,
        tokenDelta,
      };
    }
  } else if (!params.requiresFullUpgrade && tokenDelta < updateThreshold) {
    return {
      ready: false,
      reason: "below_update_token_threshold",
      summaryTokenCount,
      summaryExists,
      currentTokenCount,
      tokenDelta,
    };
  }

  if (
    params.isSettledTurn !== true &&
    (typeof params.toolCallCount !== "number" || params.toolCallCount < minToolCalls)
  ) {
    return {
      ready: false,
      reason: "tool_call_threshold_unmet",
      summaryTokenCount,
      summaryExists,
      currentTokenCount,
      tokenDelta,
    };
  }

  if (minIntervalMs > 0 && lastUpdatedAt != null && now - lastUpdatedAt < minIntervalMs) {
    return {
      ready: false,
      reason: "cooldown",
      summaryTokenCount,
      summaryExists,
      currentTokenCount,
      tokenDelta,
    };
  }

  return {
    ready: true,
    reason: "ready",
    summaryTokenCount,
    summaryExists,
    currentTokenCount,
    tokenDelta,
  };
}

type SessionSummarySchedulerParams = {
  config: SessionSummarySchedulerConfig;
  runtimeStore: RuntimeStore;
  runner?: SessionSummaryRunner;
  logger: RuntimeLogger;
};

type SubmitTurnParams = {
  sessionId: string;
  sessionKey: string;
  sessionFile: string;
  workspaceDir: string;
  agentId: string;
  parentRunId?: string;
  recentMessages: AgentMessage[];
  lastModelVisibleMessageId?: string | null;
  recentMessageLimit?: number;
  currentTokenCount?: number;
  toolCallCount?: number;
  isSettledTurn?: boolean;
  dryRun?: boolean;
  bypassGate?: boolean;
  maxTurns?: number;
  runTimeoutSeconds?: number;
  currentSummary?: SessionSummaryDocument | null;
};

export class SessionSummaryScheduler {
  private config: SessionSummarySchedulerConfig;
  private runtimeStore: RuntimeStore;
  private runner?: SessionSummaryRunner;
  private logger: RuntimeLogger;
  private readonly inFlightSessions = new Set<string>();
  private readonly pendingTurns = new Map<string, SubmitTurnParams>();

  constructor(params: SessionSummarySchedulerParams) {
    this.config = params.config;
    this.runtimeStore = params.runtimeStore;
    this.runner = params.runner;
    this.logger = params.logger;
  }

  reconfigure(params: SessionSummarySchedulerParams): void {
    this.config = params.config;
    this.runtimeStore = params.runtimeStore;
    this.runner = params.runner;
    this.logger = params.logger;
  }

  async preview(params: SubmitTurnParams): Promise<SessionSummaryPreview> {
    const fileSnapshot = await readSessionSummaryFile({
      agentId: params.agentId,
      sessionId: params.sessionId,
    });
    const state = await this.runtimeStore.getSessionSummaryState(params.sessionId);
    const snapshot =
      params.currentSummary ??
      fileSnapshot.document ??
      parseSessionSummaryDocument(buildSessionSummaryTemplate({ sessionId: params.sessionId }));
    const currentSummaryText = renderSessionSummaryDocument(snapshot);
    const currentProfile = inferSessionSummaryProfile(
      params.currentSummary ?? fileSnapshot.document,
    );
    const targetProfile: SessionSummaryProfile =
      (params.currentTokenCount ?? 0) >= (this.config.initialTokenThreshold ?? 10_000)
        ? "full"
        : "light";
    const requiresFullUpgrade = targetProfile === "full" && currentProfile !== "full";
    const gateSummaryText = params.currentSummary
      ? currentSummaryText
      : (fileSnapshot.content ?? "");
    const summaryExists = !isSessionSummaryEffectivelyEmpty(gateSummaryText);
    const gate = evaluateSessionSummaryGate({
      enabled: this.config.enabled,
      sessionKey: params.sessionKey,
      isSettledTurn: params.isSettledTurn,
      summaryText: gateSummaryText,
      stateSummaryTokenCount: state?.tokensAtLastSummary ?? 0,
      currentTokenCount: params.currentTokenCount,
      toolCallCount: params.toolCallCount,
      lastSummaryUpdatedAt: state?.lastSummaryUpdatedAt ?? fileSnapshot.updatedAt,
      lightInitialTokenThreshold: this.config.lightInitialTokenThreshold,
      initialTokenThreshold: this.config.initialTokenThreshold,
      updateTokenThreshold: this.config.updateTokenThreshold,
      minToolCalls: this.config.minToolCalls,
      minIntervalMs: this.config.minIntervalMs,
      requiresFullUpgrade,
    });
    const stateSummaryTokenCount = state?.tokensAtLastSummary ?? 0;
    const tokenDelta = resolveTokenDelta({
      currentTokenCount: params.currentTokenCount,
      summaryTokenCount: stateSummaryTokenCount,
    });
    const recentMessages = collectRecentSessionSummaryMessages({
      messages: params.recentMessages,
      limit: clampInt(params.recentMessageLimit, 12),
    });
    return {
      sessionId: params.sessionId,
      summaryPath: fileSnapshot.summaryPath,
      summaryExists,
      currentProfile,
      targetProfile,
      requiresFullUpgrade,
      summaryTokenCount: summaryExists ? estimateTokenCount(gateSummaryText) : 0,
      stateSummaryTokenCount,
      currentTokenCount: params.currentTokenCount ?? 0,
      tokenDelta,
      recentMessageCount: recentMessages.length,
      recentMessageLimit: clampInt(params.recentMessageLimit, 12),
      currentSummaryText,
      recentMessages,
      gate,
    };
  }

  submitTurn(params: SubmitTurnParams): void {
    if (!this.config.enabled || !this.runner || !params.sessionKey?.trim()) {
      return;
    }
    if (isSubagentSessionKey(params.sessionKey)) {
      return;
    }
    const normalizedParams = {
      ...params,
      recentMessageLimit: clampInt(params.recentMessageLimit, 12),
    };
    if (this.inFlightSessions.has(params.sessionId)) {
      // Keep only the latest turn while a summary run is active so we do not
      // silently drop the newest session state.
      this.pendingTurns.set(params.sessionId, normalizedParams);
      return;
    }
    this.inFlightSessions.add(params.sessionId);
    void this.runNow({
      ...normalizedParams,
    }).finally(() => {
      this.inFlightSessions.delete(params.sessionId);
      const pending = this.pendingTurns.get(params.sessionId);
      if (pending) {
        this.pendingTurns.delete(params.sessionId);
        this.submitTurn(pending);
      }
    });
  }

  async runNow(params: SubmitTurnParams): Promise<{
    status: "started" | "skipped" | "failed" | "preview";
    reason?: string;
    runId?: string;
    promotion?: {
      created: number;
      updated: number;
      candidateIds: string[];
    };
    preview?: SessionSummaryPreview;
  }> {
    if (!this.runner || !params.sessionId || !params.sessionKey?.trim()) {
      return { status: "skipped", reason: "session summary disabled" };
    }

    const preview = await this.preview(params);
    if (params.dryRun) {
      return {
        status: "preview",
        reason: preview.gate.reason,
        preview,
      };
    }
    if (!params.bypassGate && !preview.gate.ready) {
      return { status: "skipped", reason: preview.gate.reason, preview };
    }

    try {
      const existingState = await this.runtimeStore.getSessionSummaryState(params.sessionId);
      await this.runtimeStore.upsertSessionSummaryState({
        sessionId: params.sessionId,
        lastSummarizedMessageId: existingState?.lastSummarizedMessageId ?? null,
        lastSummaryUpdatedAt: existingState?.lastSummaryUpdatedAt ?? null,
        tokensAtLastSummary: existingState?.tokensAtLastSummary ?? 0,
        summaryInProgress: true,
      });
      const currentSummaryDocument =
        params.currentSummary ??
        (preview.currentSummaryText.trim()
          ? parseSessionSummaryDocument(preview.currentSummaryText)
          : null);
      const result = await this.runner(
        {
          sessionId: params.sessionId,
          sessionKey: params.sessionKey,
          sessionFile: params.sessionFile,
          workspaceDir: params.workspaceDir,
          agentId: params.agentId,
          parentRunId: params.parentRunId,
          recentMessages: params.recentMessages,
          recentMessageLimit: clampInt(params.recentMessageLimit, 12),
          currentSummary: currentSummaryDocument,
          profile: preview.targetProfile,
          runTimeoutSeconds: params.runTimeoutSeconds ?? this.config.runTimeoutSeconds,
          maxTurns: params.maxTurns ?? this.config.maxTurns,
          logger: this.logger,
        },
        this.logger,
      );
      const success =
        result.status === "written" || result.status === "no_change" || result.status === "skipped";
      const completedAt = success ? Date.now() : (existingState?.lastSummaryUpdatedAt ?? null);
      await this.runtimeStore.upsertSessionSummaryState({
        sessionId: params.sessionId,
        lastSummarizedMessageId: success
          ? (normalizeOptionalString(params.lastModelVisibleMessageId) ??
            existingState?.lastSummarizedMessageId ??
            null)
          : (existingState?.lastSummarizedMessageId ?? null),
        lastSummaryUpdatedAt: completedAt,
        tokensAtLastSummary: success
          ? Math.max(0, Math.floor(params.currentTokenCount ?? preview.currentTokenCount))
          : (existingState?.tokensAtLastSummary ?? 0),
        summaryInProgress: false,
      });
      const promotionStore = this.runtimeStore as Partial<RuntimeStore>;
      let promotion:
        | {
            created: number;
            updated: number;
            candidateIds: string[];
          }
        | undefined;
      if (
        success &&
        typeof promotionStore.listRecentPromotionCandidates === "function" &&
        typeof promotionStore.createPromotionCandidate === "function" &&
        typeof promotionStore.updatePromotionCandidate === "function"
      ) {
        const latestSummary = await readSessionSummaryFile({
          agentId: params.agentId,
          sessionId: params.sessionId,
        });
        promotion = await persistSessionSummaryPromotionCandidates({
          runtimeStore: this.runtimeStore,
          sessionId: params.sessionId,
          document: latestSummary.document,
          summaryUpdatedAt: completedAt,
        });
      }
      return {
        status: result.status === "failed" ? "failed" : "started",
        reason: result.reason ?? result.summary,
        runId: result.runId,
        promotion,
      };
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      const existingState = await this.runtimeStore.getSessionSummaryState(params.sessionId);
      await this.runtimeStore.upsertSessionSummaryState({
        sessionId: params.sessionId,
        lastSummarizedMessageId: existingState?.lastSummarizedMessageId ?? null,
        lastSummaryUpdatedAt: existingState?.lastSummaryUpdatedAt ?? null,
        tokensAtLastSummary: existingState?.tokensAtLastSummary ?? 0,
        summaryInProgress: false,
      });
      this.logger.warn(
        `[memory] session summary failed sessionId=${params.sessionId} error=${reason}`,
      );
      return { status: "failed", reason };
    }
  }
}

let sharedSessionSummaryScheduler: SessionSummaryScheduler | null = null;

export function getSharedSessionSummaryScheduler(
  params: SessionSummarySchedulerParams,
): SessionSummaryScheduler {
  if (!sharedSessionSummaryScheduler) {
    sharedSessionSummaryScheduler = new SessionSummaryScheduler(params);
    return sharedSessionSummaryScheduler;
  }
  sharedSessionSummaryScheduler.reconfigure(params);
  return sharedSessionSummaryScheduler;
}

export const __testing = {
  resetSharedSessionSummaryScheduler() {
    sharedSessionSummaryScheduler = null;
  },
  collectRecentSessionSummaryMessages,
  resolveTokenDelta,
};
