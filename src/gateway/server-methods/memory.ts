import path from "node:path";
import { resolveDefaultAgentId } from "../../agents/agent-scope.js";
import { loadConfig, type CrawClawConfig } from "../../config/config.js";
import {
  loadSessionStore,
  resolveSessionStoreEntry,
  resolveStorePath,
} from "../../config/sessions.js";
import {
  clearNotebookLmProviderStateCache,
  getNotebookLmProviderState,
  getSharedAutoDreamScheduler,
  getSharedSessionSummaryScheduler,
  normalizeNotebookLmConfig,
  readSessionSummaryFile,
  readSessionSummarySectionText,
  refreshNotebookLmProviderState,
  resolveDurableMemoryScope,
  resolveMemoryConfig,
  runDreamAgentOnce,
  runSessionSummaryAgentOnce,
  SqliteRuntimeStore,
  summarizePromptJournal,
  type NotebookLmProviderState,
} from "../../memory/cli-api.js";
import {
  inferNotebookLmLoginCommand,
  runNotebookLmLoginCommand,
} from "../../memory/notebooklm/login.js";
import { inferSessionSummaryProfile } from "../../memory/session-summary/template.ts";
import { prepareSecretsRuntimeSnapshot } from "../../secrets/runtime.js";
import { ErrorCodes, errorShape } from "../protocol/index.js";
import type { GatewayRequestHandlers } from "./types.js";

function describeUnknownError(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  return String(error);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readOptionalString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length ? trimmed : undefined;
}

function readRequiredString(value: unknown): string | null {
  const trimmed = readOptionalString(value);
  return trimmed ?? null;
}

function readOptionalBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function readOptionalPositiveInt(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    return undefined;
  }
  return value;
}

function parseTouchedNotes(value: string | null | undefined): string[] {
  try {
    const parsed = JSON.parse(value ?? "{}") as Record<string, unknown>;
    return Array.isArray(parsed.touchedNotes)
      ? parsed.touchedNotes.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

async function loadResolvedMemoryConfig(): Promise<CrawClawConfig> {
  const prepared = await prepareSecretsRuntimeSnapshot({
    config: loadConfig(),
    includeAuthStoreRefs: false,
  });
  return prepared.config;
}

function resolveMemoryProviderPayload(cfg: CrawClawConfig, state: NotebookLmProviderState | null) {
  const notebooklm = normalizeNotebookLmConfig(cfg.memory?.notebooklm);
  if (!notebooklm.enabled || !state) {
    return {
      provider: "notebooklm" as const,
      enabled: false,
      ready: false,
      lifecycle: "degraded" as const,
      reason: "disabled",
      recommendedAction: "crawclaw memory status",
      profile: notebooklm.auth.profile || "default",
      notebookId: notebooklm.cli.notebookId ?? null,
      refreshAttempted: false,
      refreshSucceeded: false,
      authSource: null,
      lastValidatedAt: new Date(0).toISOString(),
      lastRefreshAt: null,
      nextProbeAt: null,
      nextAllowedRefreshAt: null,
      details: "NotebookLM memory is disabled in config.",
    };
  }
  return {
    provider: "notebooklm" as const,
    enabled: state.enabled,
    ready: state.ready,
    lifecycle: state.lifecycle,
    reason: state.reason ?? null,
    recommendedAction: state.recommendedAction ?? "crawclaw memory status",
    profile: state.profile,
    notebookId: state.notebookId ?? null,
    refreshAttempted: state.refreshAttempted,
    refreshSucceeded: state.refreshSucceeded,
    authSource: state.authSource ?? null,
    lastValidatedAt: state.lastValidatedAt,
    lastRefreshAt: state.lastRefreshAt ?? null,
    nextProbeAt: state.nextProbeAt ?? null,
    nextAllowedRefreshAt: state.nextAllowedRefreshAt ?? null,
    details: state.details ?? null,
  };
}

function resolveMode(value: unknown): "query" | "write" {
  return value === "write" ? "write" : "query";
}

function resolveDreamScopeParams(params: Record<string, unknown>) {
  const scopeKey = readOptionalString(params.scopeKey);
  if (scopeKey) {
    return { scopeKey };
  }
  const scope = resolveDurableMemoryScope({
    agentId: readOptionalString(params.agent),
    channel: readOptionalString(params.channel),
    userId: readOptionalString(params.user),
  });
  return scope?.scopeKey ? { scopeKey: scope.scopeKey, scope } : {};
}

async function withMemoryRuntimeStore<T>(
  cfg: CrawClawConfig,
  fn: (
    store: SqliteRuntimeStore,
    memoryConfig: ReturnType<typeof resolveMemoryConfig>,
  ) => Promise<T>,
): Promise<T> {
  const memoryConfig = resolveMemoryConfig(cfg.memory ?? {});
  const store = new SqliteRuntimeStore(memoryConfig.runtimeStore.dbPath);
  await store.init();
  try {
    return await fn(store, memoryConfig);
  } finally {
    await store.close();
  }
}

function estimateContentTokens(text: string): number {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return 0;
  }
  return Math.max(1, Math.ceil(normalized.length / 4));
}

export const memoryHandlers: GatewayRequestHandlers = {
  "memory.status": async ({ params, respond }) => {
    try {
      const cfg = await loadResolvedMemoryConfig();
      const notebooklm = normalizeNotebookLmConfig(cfg.memory?.notebooklm);
      const state = notebooklm.enabled
        ? await getNotebookLmProviderState({
            config: notebooklm,
            mode: resolveMode(asRecord(params).mode),
          })
        : null;
      respond(true, resolveMemoryProviderPayload(cfg, state), undefined);
    } catch (error) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.UNAVAILABLE, `memory.status failed: ${describeUnknownError(error)}`),
      );
    }
  },

  "memory.refresh": async ({ params, respond }) => {
    try {
      const cfg = await loadResolvedMemoryConfig();
      const notebooklm = normalizeNotebookLmConfig(cfg.memory?.notebooklm);
      const state = notebooklm.enabled
        ? await refreshNotebookLmProviderState({
            config: notebooklm,
            mode: resolveMode(asRecord(params).mode),
          })
        : null;
      respond(true, resolveMemoryProviderPayload(cfg, state), undefined);
    } catch (error) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.UNAVAILABLE, `memory.refresh failed: ${describeUnknownError(error)}`),
      );
    }
  },

  "memory.login": async ({ params, respond }) => {
    const interactive = readOptionalBoolean(asRecord(params).interactive) ?? true;
    try {
      const cfg = await loadResolvedMemoryConfig();
      const notebooklm = normalizeNotebookLmConfig(cfg.memory?.notebooklm);
      if (!notebooklm.enabled) {
        respond(true, {
          started: false,
          status: "failed",
          message: "NotebookLM memory is disabled in config.",
          command: null,
          providerState: resolveMemoryProviderPayload(cfg, null),
        });
        return;
      }
      const loginCommand = inferNotebookLmLoginCommand(notebooklm);
      if (!loginCommand) {
        respond(true, {
          started: false,
          status: "failed",
          message: "NotebookLM login command is not configured.",
          command: null,
          providerState: resolveMemoryProviderPayload(cfg, null),
        });
        return;
      }
      if (!interactive) {
        respond(true, {
          started: false,
          status: "failed",
          message: "Interactive NotebookLM login was skipped by request.",
          command: [loginCommand.command, ...loginCommand.args].join(" "),
          providerState: resolveMemoryProviderPayload(cfg, null),
        });
        return;
      }
      await runNotebookLmLoginCommand(loginCommand.command, loginCommand.args);
      clearNotebookLmProviderStateCache();
      const state = await getNotebookLmProviderState({ config: notebooklm, mode: "query" });
      respond(true, {
        started: true,
        status: "completed",
        command: [loginCommand.command, ...loginCommand.args].join(" "),
        message: null,
        providerState: resolveMemoryProviderPayload(cfg, state),
      });
    } catch (error) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.UNAVAILABLE, `memory.login failed: ${describeUnknownError(error)}`),
      );
    }
  },

  "memory.dream.status": async ({ params, respond }) => {
    try {
      const cfg = await loadResolvedMemoryConfig();
      await withMemoryRuntimeStore(cfg, async (store, memoryConfig) => {
        const limit = readOptionalPositiveInt(asRecord(params).limit) ?? 10;
        const scope = resolveDreamScopeParams(asRecord(params));
        const state = scope.scopeKey ? await store.getDreamState(scope.scopeKey) : null;
        const runs = (await store.listRecentMaintenanceRuns(Math.max(limit * 3, 20)))
          .filter((entry) => entry.kind === "dream")
          .filter((entry) => !scope.scopeKey || entry.scope === scope.scopeKey)
          .slice(0, limit)
          .map((entry) => ({
            ...entry,
            touchedNotes: parseTouchedNotes(entry.metricsJson),
          }));
        respond(
          true,
          {
            enabled: memoryConfig.dreaming.enabled,
            config: memoryConfig.dreaming,
            scopeKey: scope.scopeKey ?? null,
            state,
            runs,
          },
          undefined,
        );
      });
    } catch (error) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.UNAVAILABLE,
          `memory.dream.status failed: ${describeUnknownError(error)}`,
        ),
      );
    }
  },

  "memory.dream.history": async ({ params, respond }) => {
    try {
      const cfg = await loadResolvedMemoryConfig();
      await withMemoryRuntimeStore(cfg, async (store) => {
        const limit = readOptionalPositiveInt(asRecord(params).limit) ?? 20;
        const scope = resolveDreamScopeParams(asRecord(params));
        const runs = (await store.listRecentMaintenanceRuns(Math.max(limit * 3, 40)))
          .filter((entry) => entry.kind === "dream")
          .filter((entry) => !scope.scopeKey || entry.scope === scope.scopeKey)
          .slice(0, limit)
          .map((entry) => ({
            ...entry,
            touchedNotes: parseTouchedNotes(entry.metricsJson),
          }));
        respond(true, { scopeKey: scope.scopeKey ?? null, runs }, undefined);
      });
    } catch (error) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.UNAVAILABLE,
          `memory.dream.history failed: ${describeUnknownError(error)}`,
        ),
      );
    }
  },

  "memory.dream.run": async ({ params, respond }) => {
    try {
      const cfg = await loadResolvedMemoryConfig();
      const resolvedScope = resolveDreamScopeParams(asRecord(params));
      if (!resolvedScope.scopeKey || !resolvedScope.scope) {
        respond(
          false,
          undefined,
          errorShape(
            ErrorCodes.INVALID_REQUEST,
            "memory.dream.run requires scopeKey or agent/channel/user scope filters",
          ),
        );
        return;
      }
      await withMemoryRuntimeStore(cfg, async (store, memoryConfig) => {
        const scheduler = getSharedAutoDreamScheduler({
          config: memoryConfig.dreaming,
          runtimeStore: store,
          runner: runDreamAgentOnce,
          logger: {
            info: () => {},
            warn: () => {},
            error: () => {},
          },
        });
        const result = await scheduler.runNow({
          scope: resolvedScope.scope,
          triggerSource: "control_ui",
          bypassGate: readOptionalBoolean(asRecord(params).force) ?? false,
          dryRun: readOptionalBoolean(asRecord(params).dryRun) ?? false,
          sessionLimit: readOptionalPositiveInt(asRecord(params).sessionLimit) ?? 12,
          signalLimit: readOptionalPositiveInt(asRecord(params).signalLimit) ?? 12,
        });
        respond(true, result, undefined);
      });
    } catch (error) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.UNAVAILABLE,
          `memory.dream.run failed: ${describeUnknownError(error)}`,
        ),
      );
    }
  },

  "memory.sessionSummary.status": async ({ params, respond }) => {
    const sessionId = readRequiredString(asRecord(params).sessionId);
    if (!sessionId) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "memory.sessionSummary.status requires sessionId"),
      );
      return;
    }
    try {
      const cfg = await loadResolvedMemoryConfig();
      const agentId = readOptionalString(asRecord(params).agent) || resolveDefaultAgentId(cfg);
      await withMemoryRuntimeStore(cfg, async (store) => {
        const [state, file] = await Promise.all([
          store.getSessionSummaryState(sessionId),
          readSessionSummaryFile({ agentId, sessionId }),
        ]);
        respond(
          true,
          {
            agentId,
            sessionId,
            summaryPath: file.summaryPath,
            exists: file.exists,
            updatedAt: file.updatedAt,
            profile: inferSessionSummaryProfile(file.document),
            state,
            sections: {
              currentState: readSessionSummarySectionText({
                content: file.content,
                section: "currentState",
              }),
              openLoops: readSessionSummarySectionText({
                content: file.content,
                section: "openLoops",
              }),
              taskSpecification: readSessionSummarySectionText({
                content: file.content,
                section: "taskSpecification",
              }),
              keyResults: readSessionSummarySectionText({
                content: file.content,
                section: "keyResults",
              }),
              errorsAndCorrections: readSessionSummarySectionText({
                content: file.content,
                section: "errorsAndCorrections",
              }),
            },
          },
          undefined,
        );
      });
    } catch (error) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.UNAVAILABLE,
          `memory.sessionSummary.status failed: ${describeUnknownError(error)}`,
        ),
      );
    }
  },

  "memory.sessionSummary.refresh": async ({ params, respond }) => {
    const sessionId = readRequiredString(asRecord(params).sessionId);
    const sessionKey = readRequiredString(asRecord(params).sessionKey);
    if (!sessionId || !sessionKey) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          "memory.sessionSummary.refresh requires sessionId and sessionKey",
        ),
      );
      return;
    }
    try {
      const cfg = await loadResolvedMemoryConfig();
      const agentId = readOptionalString(asRecord(params).agent) || resolveDefaultAgentId(cfg);
      const resolvedSessionEntry = (() => {
        const storePath = resolveStorePath(cfg.session?.store, { agentId });
        const store = loadSessionStore(storePath);
        return resolveSessionStoreEntry({ store, sessionKey }).existing;
      })();
      const sessionFile =
        resolvedSessionEntry?.sessionFile?.trim() || path.join(process.cwd(), `${sessionId}.jsonl`);
      const workspaceDir = resolvedSessionEntry?.spawnedWorkspaceDir?.trim() || process.cwd();
      await withMemoryRuntimeStore(cfg, async (store, memoryConfig) => {
        const [file, rows] = await Promise.all([
          readSessionSummaryFile({ agentId, sessionId }),
          store.listMessagesByTurnRange(sessionId, 1, Number.MAX_SAFE_INTEGER),
        ]);
        const recentMessages = rows
          .filter((row) => row.role === "user" || row.role === "assistant")
          .map((row) => ({
            role: row.role,
            content: row.contentText || row.content,
          }));
        const scheduler = getSharedSessionSummaryScheduler({
          config: {
            enabled: memoryConfig.sessionSummary.enabled,
            lightInitialTokenThreshold:
              memoryConfig.sessionSummary.lightInitTokenThreshold ?? 3_000,
            initialTokenThreshold: memoryConfig.sessionSummary.minTokensToInit,
            updateTokenThreshold: memoryConfig.sessionSummary.minTokensBetweenUpdates,
            minToolCalls: memoryConfig.sessionSummary.toolCallsBetweenUpdates,
            runTimeoutSeconds:
              memoryConfig.sessionSummary.maxWaitMs > 0
                ? Math.max(1, Math.floor(memoryConfig.sessionSummary.maxWaitMs / 1000))
                : undefined,
            maxTurns: memoryConfig.sessionSummary.maxTurns,
          },
          runtimeStore: store,
          runner: runSessionSummaryAgentOnce,
          logger: {
            info: () => {},
            warn: () => {},
            error: () => {},
          },
        });
        const result = await scheduler.runNow({
          sessionId,
          sessionKey,
          sessionFile,
          workspaceDir,
          agentId,
          recentMessages: recentMessages as never,
          recentMessageLimit: 24,
          currentTokenCount: recentMessages.reduce(
            (sum, message) =>
              sum +
              estimateContentTokens(typeof message.content === "string" ? message.content : ""),
            0,
          ),
          toolCallCount: 0,
          isSettledTurn: true,
          bypassGate: readOptionalBoolean(asRecord(params).force) ?? false,
          currentSummary: file.document,
          lastModelVisibleMessageId:
            rows.toReversed().find((row) => row.role === "user" || row.role === "assistant")?.id ??
            null,
        });
        respond(true, { agentId, sessionId, sessionKey, result }, undefined);
      });
    } catch (error) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.UNAVAILABLE,
          `memory.sessionSummary.refresh failed: ${describeUnknownError(error)}`,
        ),
      );
    }
  },

  "memory.promptJournal.summary": async ({ params, respond }) => {
    try {
      const summary = await summarizePromptJournal({
        file: readOptionalString(asRecord(params).file),
        dir: readOptionalString(asRecord(params).dir),
        date: readOptionalString(asRecord(params).date),
        days: readOptionalPositiveInt(asRecord(params).days),
      });
      respond(true, summary, undefined);
    } catch (error) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.UNAVAILABLE,
          `memory.promptJournal.summary failed: ${describeUnknownError(error)}`,
        ),
      );
    }
  },
};
