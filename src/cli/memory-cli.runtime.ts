import path from "node:path";
import { formatErrorMessage } from "../cli/cli-utils.js";
import { resolveCommandSecretRefsViaGateway } from "../cli/command-secret-gateway.js";
import { formatHelpExamples } from "../cli/help-format.js";
import { loadConfig, type CrawClawConfig } from "../config/config.js";
import {
  loadSessionStore,
  resolveSessionStoreEntry,
  resolveStorePath,
} from "../config/sessions.js";
import { setVerbose } from "../globals.js";
import {
  getSharedAutoDreamScheduler,
  getSharedSessionSummaryScheduler,
  getNotebookLmProviderState,
  normalizeNotebookLmConfig,
  readSessionSummaryFile,
  readSessionSummarySectionText,
  refreshNotebookLmProviderState,
  resolveDurableMemoryScope,
  resolveDreamClosedLoopStatus,
  readDreamConsolidationStatus,
  resolveMemoryConfig,
  runDreamAgentOnce,
  runSessionSummaryAgentOnce,
  SqliteRuntimeStore,
  summarizePromptJournal,
  clearNotebookLmProviderStateCache,
  flushPendingExperienceNotes,
  type NotebookLmProviderState,
  type NotebookLmConfigInput,
} from "../memory/cli-api.js";
import {
  inferNotebookLmLoginCommand,
  runNotebookLmLoginCommand,
} from "../memory/notebooklm/login.js";
import { buildManualSessionSummaryRefreshContext } from "../memory/session-summary/manual-refresh.ts";
import { inferSessionSummaryProfile } from "../memory/session-summary/template.ts";
import { defaultRuntime } from "../runtime.js";
import { formatDocsLink } from "../terminal/links.js";
import { colorize, isRich, theme } from "../terminal/theme.js";
import type { MemoryCommandOptions } from "./memory-cli.types.js";

type LoadedMemoryCommandConfig = {
  config: CrawClawConfig;
  diagnostics: string[];
};

function resolveNotebookLmConfig(cfg: CrawClawConfig) {
  return normalizeNotebookLmConfig(
    (cfg as { memory?: { notebooklm?: NotebookLmConfigInput } })?.memory?.notebooklm,
  );
}

function resolveMemoryRuntimeConfig(cfg: CrawClawConfig) {
  const memoryConfig = resolveMemoryConfig(cfg.memory ?? {});
  const runtimeDbPath = process.env.RUNTIME_DB_PATH?.trim();
  if (runtimeDbPath) {
    memoryConfig.runtimeStore.dbPath = runtimeDbPath;
  }
  return memoryConfig;
}

async function withMemoryRuntimeStore<T>(
  cfg: CrawClawConfig,
  fn: (
    store: SqliteRuntimeStore,
    memoryConfig: ReturnType<typeof resolveMemoryRuntimeConfig>,
  ) => Promise<T>,
): Promise<T> {
  const memoryConfig = resolveMemoryRuntimeConfig(cfg);
  const store = new SqliteRuntimeStore(memoryConfig.runtimeStore.dbPath);
  await store.init();
  try {
    return await fn(store, memoryConfig);
  } finally {
    await store.close();
  }
}

function formatNotebookLmStateSummary(state: NotebookLmProviderState) {
  return {
    provider: "notebooklm",
    lifecycle: state.lifecycle,
    ready: state.ready,
    reason: state.reason,
    profile: state.profile,
    notebookId: state.notebookId ?? null,
    authSource: state.authSource ?? null,
    lastValidatedAt: state.lastValidatedAt,
    lastRefreshAt: state.lastRefreshAt ?? null,
    nextProbeAt: state.nextProbeAt ?? null,
    nextAllowedRefreshAt: state.nextAllowedRefreshAt ?? null,
    recommendedAction: state.recommendedAction ?? "crawclaw memory status",
    details: state.details ?? null,
  };
}

function renderNotebookLmStateLines(state: NotebookLmProviderState): string[] {
  const rich = isRich();
  const heading = (text: string) => colorize(rich, theme.heading, text);
  const muted = (text: string) => colorize(rich, theme.muted, text);
  const info = (text: string) => colorize(rich, theme.info, text);
  const success = (text: string) => colorize(rich, theme.success, text);
  const warn = (text: string) => colorize(rich, theme.warn, text);
  const label = (text: string) => muted(`${text}:`);
  return [
    `${heading("NotebookLM")} ${muted("(experience provider)")}`,
    `${label("Lifecycle")} ${state.ready ? success(state.lifecycle) : warn(state.lifecycle)}`,
    `${label("Ready")} ${state.ready ? success("yes") : warn("no")}`,
    `${label("Reason")} ${info(state.reason ?? "ok")}`,
    `${label("Profile")} ${info(state.profile)}`,
    `${label("Notebook")} ${info(state.notebookId ?? "<unset>")}`,
    `${label("Auth source")} ${info(state.authSource ?? "<unknown>")}`,
    `${label("Last validated")} ${info(state.lastValidatedAt)}`,
    state.lastRefreshAt ? `${label("Last refresh")} ${info(state.lastRefreshAt)}` : null,
    state.nextAllowedRefreshAt
      ? `${label("Next refresh")} ${info(state.nextAllowedRefreshAt)}`
      : null,
    `${label("Recommended action")} ${info(state.recommendedAction ?? "crawclaw memory status")}`,
    state.details ? `${label("Details")} ${warn(state.details)}` : null,
  ].filter(Boolean) as string[];
}

function getMemoryCommandSecretTargetIds(): Set<string> {
  return new Set();
}

async function loadMemoryCommandConfig(commandName: string): Promise<LoadedMemoryCommandConfig> {
  const { resolvedConfig, diagnostics } = await resolveCommandSecretRefsViaGateway({
    config: loadConfig(),
    commandName,
    targetIds: getMemoryCommandSecretTargetIds(),
  });
  return { config: resolvedConfig, diagnostics };
}

function emitMemorySecretResolveDiagnostics(
  diagnostics: string[],
  params?: { json?: boolean },
): void {
  if (diagnostics.length === 0) {
    return;
  }
  const toStderr = params?.json === true;
  for (const entry of diagnostics) {
    const message = theme.warn(`[secrets] ${entry}`);
    if (toStderr) {
      defaultRuntime.error(message);
    } else {
      defaultRuntime.log(message);
    }
  }
}

export async function runMemoryStatus(opts: MemoryCommandOptions) {
  setVerbose(Boolean(opts.verbose));
  const { config: cfg, diagnostics } = await loadMemoryCommandConfig("memory status");
  emitMemorySecretResolveDiagnostics(diagnostics, { json: Boolean(opts.json) });
  const notebooklm = resolveNotebookLmConfig(cfg);
  const notebookState = notebooklm.enabled
    ? await getNotebookLmProviderState({ config: notebooklm, mode: "query" })
    : null;

  if (opts.json) {
    defaultRuntime.writeJson(notebookState ? formatNotebookLmStateSummary(notebookState) : null);
    return;
  }

  if (!notebookState) {
    defaultRuntime.log("NotebookLM experience provider is disabled.");
    defaultRuntime.log(
      `Experience Agent: ${cfg.memory?.experience?.enabled === false ? "disabled" : "enabled"} (background extraction)`,
    );
    return;
  }

  defaultRuntime.log(renderNotebookLmStateLines(notebookState).join("\n"));
  defaultRuntime.log(
    `Experience Agent: ${cfg.memory?.experience?.enabled === false ? "disabled" : "enabled"} (background extraction)`,
  );
  defaultRuntime.log("");
}

function resolveDreamScopeFromOptions(opts: MemoryCommandOptions) {
  if (opts.scopeKey?.trim()) {
    const scopeKey = opts.scopeKey.trim();
    const [agentId, channel, userId, ...extra] = scopeKey.split(":");
    if (agentId && channel && userId && extra.length === 0) {
      return {
        scopeKey,
        scope: {
          agentId,
          channel,
          userId,
          scopeKey,
        },
      };
    }
    return { scopeKey };
  }
  const scope = resolveDurableMemoryScope({
    agentId: opts.agent,
    channel: opts.channel,
    userId: opts.user,
  });
  return scope?.scopeKey ? { scopeKey: scope.scopeKey, scope } : {};
}

function parsePositiveIntOption(value: string | undefined, fallback: number, minimum = 1): number {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(minimum, parsed);
}

export async function runMemoryDreamStatus(opts: MemoryCommandOptions) {
  setVerbose(Boolean(opts.verbose));
  const { config: cfg, diagnostics } = await loadMemoryCommandConfig("memory dream status");
  emitMemorySecretResolveDiagnostics(diagnostics, { json: Boolean(opts.json) });
  const memoryConfig = resolveMemoryRuntimeConfig(cfg);
  const scope = resolveDreamScopeFromOptions(opts);
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
  const payload = {
    enabled: memoryConfig.dreaming.enabled,
    ...closedLoop,
    config: memoryConfig.dreaming,
    scopeKey: scope.scopeKey ?? null,
    state,
    historyPersisted: false,
  };
  if (opts.json) {
    defaultRuntime.writeJson(payload);
    return;
  }
  defaultRuntime.log(theme.heading("Auto Dream"));
  defaultRuntime.log(`${theme.muted("Enabled:")} ${payload.enabled ? "yes" : "no"}`);
  defaultRuntime.log(
    `${theme.muted("Closed loop:")} ${payload.closedLoopActive ? "active" : "inactive"} (${payload.closedLoopReason})`,
  );
  defaultRuntime.log(`${theme.muted("minHours:")} ${memoryConfig.dreaming.minHours}`);
  defaultRuntime.log(`${theme.muted("minSessions:")} ${memoryConfig.dreaming.minSessions}`);
  defaultRuntime.log(`${theme.muted("scanThrottleMs:")} ${memoryConfig.dreaming.scanThrottleMs}`);
  if (scope.scopeKey) {
    defaultRuntime.log(`${theme.muted("Scope:")} ${scope.scopeKey}`);
  }
  if (state) {
    defaultRuntime.log(
      `${theme.muted("Last consolidated:")} ${state.lastConsolidatedAt ?? "(never)"}`,
    );
    defaultRuntime.log(`${theme.muted("Lock active:")} ${state.lockActive ? "yes" : "no"}`);
    defaultRuntime.log(`${theme.muted("Lock owner:")} ${state.lockOwner ?? "(none)"}`);
    defaultRuntime.log(`${theme.muted("Lock path:")} ${state.lockPath}`);
  }
}

export async function runMemoryDreamHistory(opts: MemoryCommandOptions) {
  setVerbose(Boolean(opts.verbose));
  const { config: cfg, diagnostics } = await loadMemoryCommandConfig("memory dream history");
  emitMemorySecretResolveDiagnostics(diagnostics, { json: Boolean(opts.json) });
  void cfg;
  const scope = resolveDreamScopeFromOptions(opts);
  const payload = {
    scopeKey: scope.scopeKey ?? null,
    historyPersisted: false,
    reason: "Dream uses the scope .consolidate-lock file mtime as its watermark.",
  };
  if (opts.json) {
    defaultRuntime.writeJson(payload);
    return;
  }
  defaultRuntime.log(theme.heading("Auto Dream History"));
  if (scope.scopeKey) {
    defaultRuntime.log(`${theme.muted("Scope:")} ${scope.scopeKey}`);
  }
  defaultRuntime.log(
    "Dream run history is not persisted; inspect dream status for the file watermark.",
  );
}

export async function runMemoryDreamRun(opts: MemoryCommandOptions) {
  setVerbose(Boolean(opts.verbose));
  const { config: cfg, diagnostics } = await loadMemoryCommandConfig("memory dream run");
  emitMemorySecretResolveDiagnostics(diagnostics, { json: Boolean(opts.json) });
  const resolvedScope = resolveDreamScopeFromOptions(opts);
  if (!resolvedScope.scopeKey || !resolvedScope.scope) {
    defaultRuntime.error("Memory dream run requires --scope-key or --agent/--channel/--user.");
    process.exitCode = 1;
    return;
  }
  await withMemoryRuntimeStore(cfg, async (store, memoryConfig) => {
    const scheduler = getSharedAutoDreamScheduler({
      config: memoryConfig.dreaming,
      runtimeStore: store,
      runner: runDreamAgentOnce,
      logger: {
        info: (msg) => defaultRuntime.log(msg),
        warn: (msg) => defaultRuntime.error(msg),
        error: (msg) => defaultRuntime.error(msg),
      },
    });
    const result = await scheduler.runNow({
      scope: resolvedScope.scope,
      triggerSource: "manual_cli",
      bypassGate: Boolean(opts.force),
      dryRun: Boolean(opts.dryRun),
      sessionLimit: parsePositiveIntOption(opts.sessionLimit, 12),
      signalLimit: parsePositiveIntOption(opts.signalLimit, 12),
    });
    if (opts.json) {
      defaultRuntime.writeJson(result);
      return;
    }
    defaultRuntime.log(
      `${theme.heading("Auto Dream Run")} ${result.status}${result.reason ? ` · ${result.reason}` : ""}${result.runId ? ` · ${result.runId}` : ""}`,
    );
    if (result.preview) {
      defaultRuntime.log(`${theme.muted("Scope:")} ${result.preview.scopeKey}`);
      defaultRuntime.log(`${theme.muted("Recent sessions:")} ${result.preview.recentSessionCount}`);
      defaultRuntime.log(`${theme.muted("Recent signals:")} ${result.preview.recentSignalCount}`);
      if (result.preview.recentSessionIds.length > 0) {
        defaultRuntime.log(theme.heading("Session IDs"));
        for (const sessionId of result.preview.recentSessionIds) {
          defaultRuntime.log(`- ${sessionId}`);
        }
      }
    }
  });
}

export async function runMemorySessionSummaryStatus(opts: MemoryCommandOptions) {
  setVerbose(Boolean(opts.verbose));
  const { config: cfg, diagnostics } = await loadMemoryCommandConfig(
    "memory session-summary status",
  );
  emitMemorySecretResolveDiagnostics(diagnostics, { json: Boolean(opts.json) });
  const sessionId = opts.sessionId?.trim();
  if (!sessionId) {
    defaultRuntime.error("Memory session-summary status requires --session-id.");
    process.exitCode = 1;
    return;
  }
  const agentId = opts.agent?.trim() || "main";
  await withMemoryRuntimeStore(cfg, async (store) => {
    const [state, file] = await Promise.all([
      store.getSessionSummaryState(sessionId),
      readSessionSummaryFile({ agentId, sessionId }),
    ]);
    const payload = {
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
        keyResults: readSessionSummarySectionText({ content: file.content, section: "keyResults" }),
        errorsAndCorrections: readSessionSummarySectionText({
          content: file.content,
          section: "errorsAndCorrections",
        }),
      },
    };
    if (opts.json) {
      defaultRuntime.writeJson(payload);
      return;
    }
    defaultRuntime.log(theme.heading("Session Summary"));
    defaultRuntime.log(`${theme.muted("Agent:")} ${agentId}`);
    defaultRuntime.log(`${theme.muted("Session:")} ${sessionId}`);
    defaultRuntime.log(`${theme.muted("Path:")} ${file.summaryPath}`);
    defaultRuntime.log(`${theme.muted("Exists:")} ${file.exists ? "yes" : "no"}`);
    defaultRuntime.log(`${theme.muted("Updated:")} ${file.updatedAt ?? "(never)"}`);
    defaultRuntime.log(`${theme.muted("Profile:")} ${payload.profile ?? "(none)"}`);
    defaultRuntime.log(
      `${theme.muted("Last summarized message:")} ${state?.lastSummarizedMessageId ?? "(none)"}`,
    );
    defaultRuntime.log(
      `${theme.muted("Last summary update:")} ${state?.lastSummaryUpdatedAt ?? "(never)"}`,
    );
    defaultRuntime.log(
      `${theme.muted("Tokens at last summary:")} ${state?.tokensAtLastSummary ?? 0}`,
    );
    defaultRuntime.log(`${theme.muted("In progress:")} ${state?.summaryInProgress ? "yes" : "no"}`);
    const currentState = payload.sections.currentState.trim();
    if (currentState) {
      defaultRuntime.log(`${theme.muted("Current State:")} ${currentState}`);
    }
    const openLoops = payload.sections.openLoops.trim();
    if (openLoops) {
      defaultRuntime.log(`${theme.muted("Open Loops:")} ${openLoops}`);
    }
    const keyResults = payload.sections.keyResults.trim();
    if (keyResults) {
      defaultRuntime.log(`${theme.muted("Key Results:")} ${keyResults}`);
    }
  });
}

export async function runMemorySessionSummaryRefresh(opts: MemoryCommandOptions) {
  setVerbose(Boolean(opts.verbose));
  const { config: cfg, diagnostics } = await loadMemoryCommandConfig(
    "memory session-summary refresh",
  );
  emitMemorySecretResolveDiagnostics(diagnostics, { json: Boolean(opts.json) });
  const sessionId = opts.sessionId?.trim();
  const sessionKey = opts.sessionKey?.trim();
  if (!sessionId || !sessionKey) {
    defaultRuntime.error("Memory session-summary refresh requires --session-id and --session-key.");
    process.exitCode = 1;
    return;
  }
  const agentId = opts.agent?.trim() || "main";
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
        lightInitialTokenThreshold: memoryConfig.sessionSummary.lightInitTokenThreshold ?? 3_000,
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
        info: (msg) => defaultRuntime.log(msg),
        warn: (msg) => defaultRuntime.error(msg),
        error: (msg) => defaultRuntime.error(msg),
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
      bypassGate: Boolean(opts.force),
      currentSummary: file.document,
      lastModelVisibleMessageId: manualRefreshContext.lastModelVisibleMessageId,
      parentForkContext: manualRefreshContext.parentForkContext,
    });
    if (opts.json) {
      defaultRuntime.writeJson({
        agentId,
        sessionId,
        sessionKey,
        result,
      });
      return;
    }
    defaultRuntime.log(
      `${theme.heading("Session Summary Refresh")} ${result.status}${result.reason ? ` · ${result.reason}` : ""}${result.runId ? ` · ${result.runId}` : ""}`,
    );
  });
}

export async function runMemoryRefresh(opts: MemoryCommandOptions) {
  setVerbose(Boolean(opts.verbose));
  const { config: cfg, diagnostics } = await loadMemoryCommandConfig("memory refresh");
  emitMemorySecretResolveDiagnostics(diagnostics, { json: Boolean(opts.json) });
  const notebooklm = resolveNotebookLmConfig(cfg);
  if (!notebooklm.enabled) {
    defaultRuntime.error("NotebookLM experience provider is disabled.");
    process.exitCode = 1;
    return;
  }
  const state = await refreshNotebookLmProviderState({ config: notebooklm, mode: "query" });
  const syncResult = state.ready ? await flushPendingExperienceNotes({ config: notebooklm }) : null;
  if (opts.json) {
    defaultRuntime.writeJson({
      ...formatNotebookLmStateSummary(state),
      pendingSync: syncResult,
    });
    return;
  }
  defaultRuntime.log(renderNotebookLmStateLines(state).join("\n"));
  if (syncResult) {
    defaultRuntime.log(
      `Experience sync: scanned=${syncResult.scanned} synced=${syncResult.synced} failed=${syncResult.failed}`,
    );
  }
}

export async function runMemoryLogin(opts: MemoryCommandOptions) {
  setVerbose(Boolean(opts.verbose));
  const { config: cfg, diagnostics } = await loadMemoryCommandConfig("memory login");
  emitMemorySecretResolveDiagnostics(diagnostics, { json: Boolean(opts.json) });
  const notebooklm = resolveNotebookLmConfig(cfg);
  if (!notebooklm.enabled) {
    defaultRuntime.error("NotebookLM experience provider is disabled.");
    process.exitCode = 1;
    return;
  }
  const loginCommand = inferNotebookLmLoginCommand(notebooklm);
  if (!loginCommand) {
    defaultRuntime.error("NotebookLM login command is not configured.");
    process.exitCode = 1;
    return;
  }
  try {
    await runNotebookLmLoginCommand(loginCommand.command, loginCommand.args);
  } catch (error) {
    defaultRuntime.error(`NotebookLM login failed: ${formatErrorMessage(error)}`);
    process.exitCode = 1;
    return;
  }
  clearNotebookLmProviderStateCache();
  const state = await getNotebookLmProviderState({ config: notebooklm, mode: "query" });
  const syncResult = state.ready ? await flushPendingExperienceNotes({ config: notebooklm }) : null;
  if (opts.json) {
    defaultRuntime.writeJson({
      ...formatNotebookLmStateSummary(state),
      pendingSync: syncResult,
    });
    return;
  }
  defaultRuntime.log(renderNotebookLmStateLines(state).join("\n"));
  if (syncResult) {
    defaultRuntime.log(
      `Experience sync: scanned=${syncResult.scanned} synced=${syncResult.synced} failed=${syncResult.failed}`,
    );
  }
}

export async function runMemorySync(opts: MemoryCommandOptions) {
  setVerbose(Boolean(opts.verbose));
  const { config: cfg, diagnostics } = await loadMemoryCommandConfig("memory sync");
  emitMemorySecretResolveDiagnostics(diagnostics, { json: Boolean(opts.json) });
  const notebooklm = resolveNotebookLmConfig(cfg);
  if (!notebooklm.enabled) {
    defaultRuntime.error("NotebookLM experience provider is disabled.");
    process.exitCode = 1;
    return;
  }
  const result = await flushPendingExperienceNotes({ config: notebooklm });
  if (opts.json) {
    defaultRuntime.writeJson(result);
    return;
  }
  defaultRuntime.log(
    `Experience sync: status=${result.status} scanned=${result.scanned} synced=${result.synced} failed=${result.failed}`,
  );
  for (const error of result.errors) {
    defaultRuntime.error(`Experience sync failed: ${error.id}: ${error.error}`);
  }
}

function renderPromptJournalSummaryLines(
  summary: Awaited<ReturnType<typeof summarizePromptJournal>>,
): string[] {
  const rich = isRich();
  const heading = (text: string) => colorize(rich, theme.heading, text);
  const muted = (text: string) => colorize(rich, theme.muted, text);
  const info = (text: string) => colorize(rich, theme.info, text);

  const lines: string[] = [
    heading("Memory Prompt Journal Summary"),
    `${muted("Files")} ${info(String(summary.files.length))}`,
    `${muted("Dates")} ${info(summary.dateBuckets.join(", ") || "(none)")}`,
    `${muted("Events")} ${info(String(summary.totalEvents))}`,
    `${muted("Sessions")} ${info(String(summary.uniqueSessions))}`,
    "",
    heading("Stages"),
    ...Object.entries(summary.stageCounts)
      .toSorted((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
      .map(([name, count]) => `${muted(name)} ${info(String(count))}`),
    "",
    heading("After Turn"),
    ...Object.entries(summary.afterTurn.decisionCounts)
      .toSorted((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
      .map(([name, count]) => `${muted(name)} ${info(String(count))}`),
    "",
    heading("Durable Extraction"),
    `${muted("runs")} ${info(String(summary.durableExtraction.count))}`,
    `${muted("notesSavedTotal")} ${info(String(summary.durableExtraction.notesSavedTotal))}`,
    `${muted("nonZeroSaveCount")} ${info(String(summary.durableExtraction.nonZeroSaveCount))}`,
    `${muted("zeroSaveCount")} ${info(String(summary.durableExtraction.zeroSaveCount))}`,
    `${muted("saveRate")} ${info(summary.durableExtraction.saveRate == null ? "(n/a)" : String(summary.durableExtraction.saveRate))}`,
    "",
    heading("Experience Extraction"),
    ...Object.entries(summary.experienceExtraction.statusCounts)
      .toSorted((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
      .map(([name, count]) => `${muted(`status:${name}`)} ${info(String(count))}`),
    ...Object.entries(summary.experienceExtraction.decisionCounts)
      .toSorted((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
      .map(([name, count]) => `${muted(`decision:${name}`)} ${info(String(count))}`),
    `${muted("writtenCount")} ${info(String(summary.experienceExtraction.writtenCount))}`,
    `${muted("updatedCount")} ${info(String(summary.experienceExtraction.updatedCount))}`,
    `${muted("deletedCount")} ${info(String(summary.experienceExtraction.deletedCount))}`,
    "",
    heading("Experience Write"),
    ...Object.entries(summary.experienceWrite.statusCounts)
      .toSorted((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
      .map(([name, count]) => `${muted(`status:${name}`)} ${info(String(count))}`),
  ];

  if (summary.experienceWrite.titles.length > 0) {
    lines.push("", heading("Top Experience Titles"));
    for (const entry of summary.experienceWrite.titles) {
      lines.push(`${muted(entry.title)} ${info(String(entry.count))}`);
    }
  }

  return lines;
}

export async function runMemoryPromptJournalSummary(opts: MemoryCommandOptions) {
  setVerbose(Boolean(opts.verbose));
  const summary = await summarizePromptJournal({
    file: opts.file,
    dir: opts.dir,
    date: opts.date,
    days: opts.days ? Number.parseInt(opts.days, 10) : undefined,
  });

  if (opts.json) {
    defaultRuntime.writeJson(summary);
    return;
  }

  defaultRuntime.log(renderPromptJournalSummaryLines(summary).join("\n"));
}

export { formatDocsLink, formatHelpExamples, theme };
