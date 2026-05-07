import path from "node:path";
import { resolveDefaultAgentId } from "../../agents/agent-scope.js";
import { loadConfig, writeConfigFile, type CrawClawConfig } from "../../config/config.js";
import {
  loadSessionStore,
  resolveSessionStoreEntry,
  resolveStorePath,
} from "../../config/sessions.js";
import {
  clearNotebookLmProviderStateCache,
  ensureNotebookLmNotebook,
  flushPendingExperienceNotes,
  getNotebookLmProviderState,
  getSharedAutoDreamScheduler,
  getSharedSessionSummaryScheduler,
  listDurableMemoryIndexDocuments,
  normalizeNotebookLmConfig,
  readSessionSummaryFile,
  readSessionSummarySectionText,
  readDurableMemoryIndexDocument,
  refreshNotebookLmProviderState,
  resolveDurableMemoryScope,
  resolveDreamClosedLoopStatus,
  readDreamConsolidationStatus,
  resolveMemoryConfig,
  runDreamAgentOnce,
  runSessionSummaryAgentOnce,
  SqliteRuntimeStore,
  summarizePromptJournal,
  type DurableMemoryIndexDocumentEntry,
  type NotebookLmProviderState,
} from "../../memory/cli-api.js";
import {
  EXPERIENCE_OUTBOX_STATUSES,
  EXPERIENCE_SYNC_STATUSES,
  pruneExperienceOutboxEntries,
  readExperienceOutboxEntries,
  updateExperienceOutboxEntryStatus,
  type ExperienceOutboxEntry,
  type ExperienceOutboxStatus,
  type ExperienceSyncStatus,
} from "../../memory/experience/outbox-store.ts";
import {
  inferNotebookLmLoginCommand,
  runNotebookLmLoginCommand,
} from "../../memory/notebooklm/login.js";
import { buildManualSessionSummaryRefreshContext } from "../../memory/session-summary/manual-refresh.ts";
import { inferSessionSummaryProfile } from "../../memory/session-summary/template.ts";
import { prepareSecretsRuntimeSnapshot } from "../../secrets/runtime.js";
import { ErrorCodes, errorShape } from "../protocol/index.js";
import type { GatewayRequestHandlers } from "./types.js";

function describeUnknownError(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  if (typeof error === "number" || typeof error === "boolean" || typeof error === "bigint") {
    return `${error}`;
  }
  if (typeof error === "symbol") {
    return error.description ? `Symbol(${error.description})` : "Symbol()";
  }
  try {
    const serialized = JSON.stringify(error);
    return typeof serialized === "string" ? serialized : "Unknown error";
  } catch {
    return "Unknown error";
  }
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

function readExperienceOutboxStatus(value: unknown): ExperienceOutboxStatus | undefined {
  return typeof value === "string" &&
    (EXPERIENCE_OUTBOX_STATUSES as readonly string[]).includes(value)
    ? (value as ExperienceOutboxStatus)
    : undefined;
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

function readBoundedPositiveInt(value: unknown, fallback: number, max: number): number {
  return Math.min(readOptionalPositiveInt(value) ?? fallback, max);
}

function countByKnownKeys<K extends string>(keys: readonly K[]): Record<K, number> {
  return Object.fromEntries(keys.map((key) => [key, 0])) as Record<K, number>;
}

function summarizeDurableItems(items: DurableMemoryIndexDocumentEntry[]) {
  const recentUpdatedAt = items.reduce<string | null>((latest, item) => {
    if (!item.updatedAt) {
      return latest;
    }
    return latest === null || item.updatedAt > latest ? item.updatedAt : latest;
  }, null);
  return {
    items,
    visibleCount: items.length,
    recentUpdatedAt,
  };
}

function summarizeExperienceOutbox(items: ExperienceOutboxEntry[]) {
  const statusCounts = countByKnownKeys(EXPERIENCE_OUTBOX_STATUSES);
  const syncStatusCounts = countByKnownKeys(EXPERIENCE_SYNC_STATUSES);
  let pendingSyncCount = 0;

  for (const item of items) {
    statusCounts[item.status] += 1;
    const syncStatus: ExperienceSyncStatus = item.syncStatus ?? "pending_sync";
    syncStatusCounts[syncStatus] += 1;
    if (syncStatus === "pending_sync" || syncStatus === "failed") {
      pendingSyncCount += 1;
    }
  }

  return {
    items,
    visibleCount: items.length,
    statusCounts,
    syncStatusCounts,
    pendingSyncCount,
  };
}

function resolveMode(value: unknown): "query" | "write" {
  return value === "write" ? "write" : "query";
}

function buildNotebookLmSetupConfig(
  cfg: CrawClawConfig,
  setup: { notebookId: string; profile: string },
): CrawClawConfig {
  const current = asRecord(cfg.memory?.notebooklm);
  return {
    ...cfg,
    memory: {
      ...cfg.memory,
      notebooklm: {
        ...current,
        enabled: true,
        auth: {
          ...asRecord(current.auth),
          profile: setup.profile,
        },
        cli: {
          ...asRecord(current.cli),
          enabled: true,
          notebookId: setup.notebookId,
        },
        write: {
          ...asRecord(current.write),
          notebookId: setup.notebookId,
        },
      },
    },
  };
}

function resolveDreamScopeParams(params: Record<string, unknown>): {
  scopeKey?: string;
  scope?: NonNullable<ReturnType<typeof resolveDurableMemoryScope>>;
  error?: string;
} {
  if ("channel" in params || "user" in params) {
    return {
      error: "memory.dream.* accepts only agent or agent-only scopeKey",
    };
  }
  const scopeKey = readOptionalString(params.scopeKey);
  if (scopeKey) {
    const agentId = scopeKey.trim();
    if (agentId.includes(":")) {
      return {
        error: "memory.dream.* accepts only agent-only scopeKey values",
      };
    }
    const scope = resolveDurableMemoryScope({
      agentId,
      fallbackToLocal: true,
    });
    return scope?.scopeKey ? { scopeKey: scope.scopeKey, scope } : {};
  }
  const agentId = readOptionalString(params.agent);
  const scope = resolveDurableMemoryScope({
    agentId,
    fallbackToLocal: Boolean(agentId),
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

export const memoryHandlers: GatewayRequestHandlers = {
  "memory.admin.overview": async ({ params, respond }) => {
    try {
      const request = asRecord(params);
      const durableLimit = readBoundedPositiveInt(request.durableLimit, 20, 100);
      const experienceLimit = readBoundedPositiveInt(request.experienceLimit, 50, 500);
      const cfg = await loadResolvedMemoryConfig();
      const memoryConfig = resolveMemoryConfig(cfg.memory ?? {});
      const notebooklm = normalizeNotebookLmConfig(cfg.memory?.notebooklm);
      const state = notebooklm.enabled
        ? await getNotebookLmProviderState({
            config: notebooklm,
            mode: resolveMode(request.mode),
          })
        : null;
      const [durableResult, experienceItems] = await Promise.all([
        listDurableMemoryIndexDocuments({ limit: durableLimit }),
        readExperienceOutboxEntries(experienceLimit),
      ]);

      respond(
        true,
        {
          generatedAt: new Date().toISOString(),
          provider: resolveMemoryProviderPayload(cfg, state),
          runtime: {
            storePath: memoryConfig.runtimeStore.dbPath,
          },
          durable: summarizeDurableItems(durableResult.items),
          experience: summarizeExperienceOutbox(experienceItems),
          dreaming: memoryConfig.dreaming,
          sessionSummary: memoryConfig.sessionSummary,
        },
        undefined,
      );
    } catch (error) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.UNAVAILABLE,
          `memory.admin.overview failed: ${describeUnknownError(error)}`,
        ),
      );
    }
  },

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
      const sourceCfg = loadConfig();
      const prepared = await prepareSecretsRuntimeSnapshot({
        config: sourceCfg,
        includeAuthStoreRefs: false,
      });
      const cfg = prepared.config;
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
      const setup = await ensureNotebookLmNotebook({
        config: notebooklm,
        title: "CrawClaw",
        create: true,
      });
      const nextCfg = buildNotebookLmSetupConfig(sourceCfg, setup);
      const nextNotebookLm = normalizeNotebookLmConfig(nextCfg.memory?.notebooklm);
      await writeConfigFile(nextCfg);
      clearNotebookLmProviderStateCache();
      const state = await getNotebookLmProviderState({ config: nextNotebookLm, mode: "query" });
      respond(
        true,
        {
          started: true,
          status: "completed",
          command: [loginCommand.command, ...loginCommand.args].join(" "),
          message: null,
          providerState: resolveMemoryProviderPayload(nextCfg, state),
        },
        undefined,
      );
    } catch (error) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.UNAVAILABLE, `memory.login failed: ${describeUnknownError(error)}`),
      );
    }
  },

  "memory.durable.index.list": async ({ params, respond }) => {
    try {
      const limit = readOptionalPositiveInt(asRecord(params).limit) ?? 50;
      const result = await listDurableMemoryIndexDocuments({ limit });
      respond(true, result, undefined);
    } catch (error) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.UNAVAILABLE,
          `memory.durable.index.list failed: ${describeUnknownError(error)}`,
        ),
      );
    }
  },

  "memory.durable.index.get": async ({ params, respond }) => {
    try {
      const id = readRequiredString(asRecord(params).id);
      if (!id) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, "memory.durable.index.get requires id"),
        );
        return;
      }
      const result = await readDurableMemoryIndexDocument({ id });
      respond(true, result, undefined);
    } catch (error) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.UNAVAILABLE,
          `memory.durable.index.get failed: ${describeUnknownError(error)}`,
        ),
      );
    }
  },

  "memory.dream.status": async ({ params, respond }) => {
    try {
      const cfg = await loadResolvedMemoryConfig();
      const memoryConfig = resolveMemoryConfig(cfg.memory ?? {});
      const scope = resolveDreamScopeParams(asRecord(params));
      if (scope.error) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, scope.error));
        return;
      }
      const state = scope.scope
        ? await readDreamConsolidationStatus({
            scope: scope.scope,
            staleAfterMs: memoryConfig.dreaming.lockStaleAfterMs,
          })
        : null;
      const closedLoop = resolveDreamClosedLoopStatus({
        config: memoryConfig.dreaming,
        scopeKey: scope.scopeKey,
      });
      respond(
        true,
        {
          enabled: memoryConfig.dreaming.enabled,
          ...closedLoop,
          config: memoryConfig.dreaming,
          scopeKey: scope.scopeKey ?? null,
          state,
          historyPersisted: false,
        },
        undefined,
      );
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
      void cfg;
      const scope = resolveDreamScopeParams(asRecord(params));
      if (scope.error) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, scope.error));
        return;
      }
      respond(
        true,
        {
          scopeKey: scope.scopeKey ?? null,
          historyPersisted: false,
          reason: "Dream uses the scope .consolidate-lock file mtime as its watermark.",
        },
        undefined,
      );
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
      if (resolvedScope.error) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, resolvedScope.error));
        return;
      }
      if (!resolvedScope.scopeKey || !resolvedScope.scope) {
        respond(
          false,
          undefined,
          errorShape(
            ErrorCodes.INVALID_REQUEST,
            "memory.dream.run requires an agent-only scopeKey or agent filter",
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
          triggerSource: "browser_client",
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
        const manualRefreshContext = buildManualSessionSummaryRefreshContext({
          sessionId,
          rows,
        });
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
                ? Math.max(90, Math.floor(memoryConfig.sessionSummary.maxWaitMs / 1000))
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
          recentMessages: manualRefreshContext.recentMessages,
          recentMessageLimit: 24,
          currentTokenCount: manualRefreshContext.currentTokenCount,
          toolCallCount: 0,
          isSettledTurn: true,
          bypassGate: readOptionalBoolean(asRecord(params).force) ?? false,
          currentSummary: file.document,
          lastModelVisibleMessageId: manualRefreshContext.lastModelVisibleMessageId,
          parentForkContext: manualRefreshContext.parentForkContext,
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

  "memory.experience.outbox.list": async ({ params, respond }) => {
    try {
      const request = asRecord(params);
      const status = readExperienceOutboxStatus(request.status);
      const limit = readOptionalPositiveInt(request.limit) ?? 50;
      const items = await readExperienceOutboxEntries(limit, status ? { status } : {});
      respond(true, { items }, undefined);
    } catch (error) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.UNAVAILABLE,
          `memory.experience.outbox.list failed: ${describeUnknownError(error)}`,
        ),
      );
    }
  },

  "memory.experience.outbox.updateStatus": async ({ params, respond }) => {
    try {
      const request = asRecord(params);
      const id = readRequiredString(request.id);
      const status = readExperienceOutboxStatus(request.status);
      if (!id || !status) {
        respond(
          false,
          undefined,
          errorShape(
            ErrorCodes.INVALID_REQUEST,
            "memory.experience.outbox.updateStatus requires id and valid status",
          ),
        );
        return;
      }
      const supersededBy = readOptionalString(request.supersededBy);
      const item = await updateExperienceOutboxEntryStatus({
        id,
        status,
        ...(supersededBy ? { supersededBy } : {}),
      });
      if (!item) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, `experience outbox entry not found: ${id}`),
        );
        return;
      }
      respond(true, { item }, undefined);
    } catch (error) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.UNAVAILABLE,
          `memory.experience.outbox.updateStatus failed: ${describeUnknownError(error)}`,
        ),
      );
    }
  },

  "memory.experience.outbox.prune": async ({ params, respond }) => {
    try {
      const request = asRecord(params);
      const staleAfterMs = readOptionalPositiveInt(request.staleAfterMs);
      const archiveAfterMs = readOptionalPositiveInt(request.archiveAfterMs);
      const result = await pruneExperienceOutboxEntries({
        ...(staleAfterMs !== undefined ? { staleAfterMs } : {}),
        ...(archiveAfterMs !== undefined ? { archiveAfterMs } : {}),
      });
      respond(true, { result }, undefined);
    } catch (error) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.UNAVAILABLE,
          `memory.experience.outbox.prune failed: ${describeUnknownError(error)}`,
        ),
      );
    }
  },

  "memory.experience.sync.flush": async ({ respond }) => {
    try {
      const cfg = loadConfig();
      const notebooklm = normalizeNotebookLmConfig(cfg.memory?.notebooklm);
      const result = await flushPendingExperienceNotes({ config: notebooklm });
      respond(true, { result }, undefined);
    } catch (error) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.UNAVAILABLE,
          `memory.experience.sync.flush failed: ${describeUnknownError(error)}`,
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
