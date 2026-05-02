import path from "node:path";
import { getRuntimeConfigSnapshot } from "../config/config.js";
import type { ToolLoopDetectionConfig } from "../config/types.tools.js";
import { analyzeShellCommand } from "../infra/exec-approvals-analysis.js";
import type { SessionState } from "../logging/diagnostic-session-state.js";
import { createSubsystemLogger } from "../logging/subsystem.js";
import { getGlobalHookRunner } from "../plugins/hook-runner-global.js";
import { copyPluginToolMeta } from "../plugins/tools.js";
import { PluginApprovalResolutions, type PluginApprovalResolution } from "../plugins/types.js";
import { createLazyRuntimeSurface } from "../shared/lazy-runtime.js";
import { isPlainObject } from "../utils.js";
import { emitAgentActionEvent } from "./action-feed/emit.js";
import { copyChannelAgentToolMeta } from "./channel-tools.js";
import { resolveSharedContextArchiveService } from "./context-archive/runtime.js";
import type { ContextArchiveService } from "./context-archive/service.js";
import { decideLoopPolicyAction } from "./loop/policy-engine.js";
import { resolveAgentGuardContext } from "./runtime/agent-guard-context.js";
import type { AgentRuntimeState, AgentRuntimeStatus } from "./runtime/agent-runtime-state.js";
import { normalizeToolName } from "./tool-policy.js";
import type { AnyAgentTool } from "./tools/common.js";
import { callGatewayTool } from "./tools/gateway.js";

export type HookContext = {
  agentId?: string;
  sessionKey?: string;
  /** Ephemeral session UUID — regenerated on /new. */
  sessionId?: string;
  runId?: string;
  sandboxed?: boolean;
  loopDetection?: ToolLoopDetectionConfig;
  specialToolAllowlist?: string[];
  specialToolGuard?: SpecialToolGuardContext;
};

export type SpecialToolGuardContext = {
  kind: "memory_maintenance";
  memoryDir?: string;
};

export type ToolCallRuntimeContext = Pick<
  HookContext,
  "runId" | "sessionKey" | "sessionId" | "agentId"
>;

type HookOutcome = { blocked: true; reason: string } | { blocked: false; params: unknown };
type RuntimeAwareSessionState = {
  sessionState?: SessionState;
  runtimeState?: AgentRuntimeState;
};

const log = createSubsystemLogger("agents/tools");
const BEFORE_TOOL_CALL_WRAPPED = Symbol("beforeToolCallWrapped");
const adjustedParamsByToolCallId = new Map<string, unknown>();
const MAX_TRACKED_ADJUSTED_PARAMS = 1024;
const LOOP_WARNING_BUCKET_SIZE = 10;
const MAX_LOOP_WARNING_KEYS = 256;
const ARCHIVE_DECISION_LABEL = "tool-guard-loop-decisions";
const MAX_ARCHIVE_DECISION_RUN_IDS = 256;
const archiveDecisionRunIdsByScope = new Map<string, string>();
const activeToolCallContextById = new Map<string, ToolCallRuntimeContext>();
const MEMORY_MAINTENANCE_SCOPED_TOOL_NAMES = new Set([
  "memory_manifest_read",
  "memory_note_read",
  "memory_note_write",
  "memory_note_edit",
  "memory_note_delete",
]);
const MEMORY_MAINTENANCE_RAW_FS_TOOL_NAMES = new Set(["write", "edit"]);
const MEMORY_MAINTENANCE_READ_ONLY_EXECUTABLES = new Set([
  "cat",
  "find",
  "grep",
  "head",
  "ls",
  "pwd",
  "rg",
  "stat",
  "tail",
  "wc",
]);
const FIND_MUTATING_OPTIONS = new Set([
  "-delete",
  "-exec",
  "-execdir",
  "-fls",
  "-fprint",
  "-fprint0",
  "-fprintf",
  "-ok",
  "-okdir",
]);
const EXEC_GUARD_BLOCKED_PARAMS = new Set([
  "ask",
  "background",
  "elevated",
  "host",
  "node",
  "pty",
  "security",
  "yieldMs",
]);

function emitLoopActionEvent(params: {
  runId?: string;
  sessionKey?: string;
  toolName: string;
  toolCallId?: string;
  detector: string;
  level: "warning" | "critical";
  action: string;
  blocked: boolean;
  count: number;
  message: string;
  pairedToolName?: string;
}) {
  const runId = params.runId?.trim();
  if (!runId) {
    return;
  }
  emitAgentActionEvent({
    runId,
    sessionKey: params.sessionKey,
    data: {
      actionId: `loop:${runId}:${params.toolName}:${params.detector}`,
      kind: "loop",
      status: params.blocked ? "blocked" : "completed",
      title: `Loop policy: ${params.action}`,
      summary: params.message,
      ...(params.toolName ? { toolName: params.toolName } : {}),
      ...(params.toolCallId ? { toolCallId: params.toolCallId } : {}),
      detail: {
        detector: params.detector,
        level: params.level,
        count: params.count,
        action: params.action,
        blocked: params.blocked,
        ...(params.pairedToolName ? { pairedToolName: params.pairedToolName } : {}),
      },
    },
  });
}

function emitGuardBlockedActionEvent(params: {
  runId?: string;
  sessionKey?: string;
  toolName: string;
  toolCallId?: string;
  title?: string;
  reason: string;
}) {
  const runId = params.runId?.trim();
  if (!runId) {
    return;
  }
  emitAgentActionEvent({
    runId,
    sessionKey: params.sessionKey,
    data: {
      actionId: `guard:${runId}:${params.toolCallId ?? params.toolName}`,
      kind: "guard",
      status: "blocked",
      title: params.title ?? `Blocked ${params.toolName}`,
      summary: params.reason,
      ...(params.toolName ? { toolName: params.toolName } : {}),
      ...(params.toolCallId ? { toolCallId: params.toolCallId } : {}),
      detail: {
        reason: params.reason,
      },
    },
  });
}

function normalizeExecutableName(argv0: string | undefined): string | undefined {
  const raw = argv0?.trim();
  if (!raw) {
    return undefined;
  }
  const base = path.basename(raw).toLowerCase();
  return base.endsWith(".exe") ? base.slice(0, -4) : base;
}

function isShellEnvAssignmentToken(token: string | undefined): boolean {
  return Boolean(token && /^[A-Za-z_][A-Za-z0-9_]*=.*$/u.test(token));
}

function hasActiveExecGuardOverride(record: Record<string, unknown>): boolean {
  const env = record.env;
  if (env !== undefined) {
    if (!isPlainObject(env)) {
      return true;
    }
    if (Object.keys(env).length > 0) {
      return true;
    }
  }
  for (const key of EXEC_GUARD_BLOCKED_PARAMS) {
    const value = record[key];
    if (value === undefined || value === null) {
      continue;
    }
    if (typeof value === "boolean") {
      if (value) {
        return true;
      }
      continue;
    }
    if (typeof value === "string") {
      if (value.trim()) {
        return true;
      }
      continue;
    }
    return true;
  }
  return false;
}

function isReadOnlyFindInvocation(argv: string[]): boolean {
  return !argv
    .slice(1)
    .some((token) => FIND_MUTATING_OPTIONS.has(token) || /^-(?:exec|ok)(?:dir)?\b/u.test(token));
}

function isReadOnlyTailInvocation(argv: string[]): boolean {
  return !argv.slice(1).some((token) => token === "-f" || token === "--follow");
}

function isReadOnlyExecCommand(
  command: string,
): { allowed: true } | { allowed: false; reason: string } {
  const analysis = analyzeShellCommand({ command });
  if (!analysis.ok) {
    return { allowed: false, reason: analysis.reason ?? "unsupported shell syntax" };
  }
  for (const segment of analysis.segments) {
    const firstCommandIndex = segment.argv.findIndex((token) => !isShellEnvAssignmentToken(token));
    if (firstCommandIndex > 0) {
      return {
        allowed: false,
        reason: "inline environment assignments are not allowed for memory maintenance exec",
      };
    }
    const executable = normalizeExecutableName(segment.argv[firstCommandIndex]);
    if (!executable || !MEMORY_MAINTENANCE_READ_ONLY_EXECUTABLES.has(executable)) {
      return {
        allowed: false,
        reason: executable
          ? `exec command "${executable}" is not read-only-allowlisted`
          : "exec command is empty",
      };
    }
    if (executable === "find" && !isReadOnlyFindInvocation(segment.argv)) {
      return { allowed: false, reason: "find mutating actions are not allowed" };
    }
    if (executable === "tail" && !isReadOnlyTailInvocation(segment.argv)) {
      return { allowed: false, reason: "tail follow mode is not allowed" };
    }
  }
  return { allowed: true };
}

function resolvePathAlias(record: Record<string, unknown>): string | undefined {
  for (const key of ["path", "file_path", "filePath", "file"]) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
}

function isPathWithinOrEqual(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function resolveMemoryMaintenanceFileParams(
  params: unknown,
  guard: SpecialToolGuardContext,
): { ok: true; params: unknown } | { ok: false; reason: string } {
  if (!isPlainObject(params)) {
    return { ok: false, reason: "memory maintenance write/edit requires object parameters" };
  }
  const memoryDir = guard.memoryDir?.trim();
  if (!memoryDir) {
    return { ok: false, reason: "memory maintenance guard has no durable memory directory" };
  }
  const rawPath = resolvePathAlias(params);
  if (!rawPath) {
    return { ok: false, reason: "memory maintenance write/edit requires a file path" };
  }
  const withoutAt = rawPath.startsWith("@") ? rawPath.slice(1) : rawPath;
  if (/^file:\/\//iu.test(withoutAt)) {
    return { ok: false, reason: "file:// paths are not allowed for memory maintenance write/edit" };
  }
  const root = path.resolve(memoryDir);
  const resolved = path.isAbsolute(withoutAt)
    ? path.resolve(withoutAt)
    : path.resolve(root, withoutAt || ".");
  if (!isPathWithinOrEqual(root, resolved)) {
    return {
      ok: false,
      reason: "memory maintenance write/edit is restricted to the durable memory directory",
    };
  }
  return {
    ok: true,
    params: {
      ...params,
      path: resolved,
    },
  };
}

function evaluateMemoryMaintenanceToolGuard(params: {
  toolName: string;
  toolParams: unknown;
  guard: SpecialToolGuardContext;
}): HookOutcome {
  const toolName = params.toolName;
  if (MEMORY_MAINTENANCE_SCOPED_TOOL_NAMES.has(toolName)) {
    return { blocked: false, params: params.toolParams };
  }
  if (toolName === "read") {
    return { blocked: false, params: params.toolParams };
  }
  if (toolName === "exec") {
    if (!isPlainObject(params.toolParams)) {
      return { blocked: true, reason: "memory maintenance exec requires object parameters" };
    }
    if (hasActiveExecGuardOverride(params.toolParams)) {
      return {
        blocked: true,
        reason:
          "memory maintenance exec cannot override host/security/env/background/pty/elevation settings",
      };
    }
    const command = params.toolParams.command;
    if (typeof command !== "string" || !command.trim()) {
      return { blocked: true, reason: "memory maintenance exec requires a command" };
    }
    const readOnlyDecision = isReadOnlyExecCommand(command.trim());
    if (!readOnlyDecision.allowed) {
      return {
        blocked: true,
        reason: `memory maintenance exec is restricted to read-only commands: ${readOnlyDecision.reason}`,
      };
    }
    return { blocked: false, params: params.toolParams };
  }
  if (MEMORY_MAINTENANCE_RAW_FS_TOOL_NAMES.has(toolName)) {
    const fileDecision = resolveMemoryMaintenanceFileParams(params.toolParams, params.guard);
    if (!fileDecision.ok) {
      return { blocked: true, reason: fileDecision.reason };
    }
    return { blocked: false, params: fileDecision.params };
  }
  return {
    blocked: true,
    reason: `Tool "${toolName}" is not allowed by memory maintenance guard`,
  };
}

const loadBeforeToolCallRuntime = createLazyRuntimeSurface(
  () => import("./pi-tools.before-tool-call.runtime.js"),
  ({ beforeToolCallRuntime }) => beforeToolCallRuntime,
);

function buildAdjustedParamsKey(params: { runId?: string; toolCallId: string }): string {
  if (params.runId && params.runId.trim()) {
    return `${params.runId}:${params.toolCallId}`;
  }
  return params.toolCallId;
}

function normalizeToolCallRuntimeContext(
  ctx: HookContext | undefined,
): ToolCallRuntimeContext | undefined {
  if (!ctx) {
    return undefined;
  }
  const runId = ctx.runId?.trim();
  const sessionKey = ctx.sessionKey?.trim();
  const sessionId = ctx.sessionId?.trim();
  const agentId = ctx.agentId?.trim();
  if (!runId && !sessionKey && !sessionId && !agentId) {
    return undefined;
  }
  return {
    ...(runId ? { runId } : {}),
    ...(sessionKey ? { sessionKey } : {}),
    ...(sessionId ? { sessionId } : {}),
    ...(agentId ? { agentId } : {}),
  };
}

function mergeParamsWithApprovalOverrides(
  originalParams: unknown,
  approvalParams?: unknown,
): unknown {
  if (approvalParams && isPlainObject(approvalParams)) {
    if (isPlainObject(originalParams)) {
      return { ...originalParams, ...approvalParams };
    }
    return approvalParams;
  }
  return originalParams;
}

function resolveArchiveDecisionScopeKey(params: {
  runId?: string;
  sessionKey?: string;
  sessionId?: string;
  agentId?: string;
}): string | undefined {
  const candidates = [params.runId, params.sessionKey, params.sessionId, params.agentId];
  for (const candidate of candidates) {
    const trimmed = candidate?.trim();
    if (trimmed) {
      return trimmed;
    }
  }
  return undefined;
}

function snapshotArchiveGuardContext(
  guard: ReturnType<typeof resolveAgentGuardContext>,
): Record<string, unknown> {
  const snapshot: Record<string, unknown> = {
    browserClientsVisible: guard.browserClientsVisible,
    heartbeat: guard.heartbeat,
    interactiveApprovalAvailable: guard.interactiveApprovalAvailable,
  };
  if (guard.runtime) {
    snapshot.runtime = guard.runtime;
  }
  if (guard.mode) {
    snapshot.mode = guard.mode;
  }
  if (guard.interactiveApprovalBlocker) {
    snapshot.interactiveApprovalBlocker = guard.interactiveApprovalBlocker;
  }
  if (guard.interactiveApprovalReason) {
    snapshot.interactiveApprovalReason = guard.interactiveApprovalReason;
  }
  if (guard.capability) {
    snapshot.capability = guard.capability;
  }
  return snapshot;
}

async function resolveArchiveService(): Promise<ContextArchiveService | undefined> {
  const config = getRuntimeConfigSnapshot();
  if (!config) {
    return undefined;
  }
  return await resolveSharedContextArchiveService(config);
}

async function ensureArchiveDecisionRun(
  archive: ContextArchiveService,
  scope: {
    runId?: string;
    sessionKey?: string;
    sessionId?: string;
    agentId?: string;
  },
): Promise<string | undefined> {
  const scopeKey = resolveArchiveDecisionScopeKey(scope);
  if (!scopeKey) {
    return undefined;
  }
  const existing = archiveDecisionRunIdsByScope.get(scopeKey);
  if (existing) {
    return existing;
  }
  const run = await archive.createRun({
    sessionId: scope.sessionId?.trim() || scope.runId?.trim() || scopeKey,
    conversationUid: scope.sessionKey?.trim() || scopeKey,
    ...(scope.sessionKey?.trim() ? { sessionKey: scope.sessionKey.trim() } : {}),
    ...(scope.agentId?.trim() ? { agentId: scope.agentId.trim() } : {}),
    kind: "session",
    status: "recording",
    label: ARCHIVE_DECISION_LABEL,
    metadata: {
      source: "pi-tools.before-tool-call",
      scopeKey,
    },
  });
  archiveDecisionRunIdsByScope.set(scopeKey, run.id);
  if (archiveDecisionRunIdsByScope.size > MAX_ARCHIVE_DECISION_RUN_IDS) {
    const oldest = archiveDecisionRunIdsByScope.keys().next().value;
    if (oldest) {
      archiveDecisionRunIdsByScope.delete(oldest);
    }
  }
  return run.id;
}

async function recordArchiveDecisionEvent(params: {
  type: "tool.guard_admission" | "tool.loop_policy" | "tool.result";
  scope: {
    runId?: string;
    sessionKey?: string;
    sessionId?: string;
    agentId?: string;
  };
  payload: unknown;
}): Promise<void> {
  try {
    const archive = await resolveArchiveService();
    if (!archive) {
      return;
    }
    const runId = await ensureArchiveDecisionRun(archive, params.scope);
    if (!runId) {
      return;
    }
    await archive.appendEvent({
      runId,
      type: params.type,
      payload: params.payload,
    });
  } catch (err) {
    log.warn(`context archive decision capture failed: type=${params.type} error=${String(err)}`);
  }
}

function describeArchiveError(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      ...(error.stack ? { stack: error.stack } : {}),
    };
  }
  return {
    message: String(error),
  };
}

function isAbortSignalCancellation(err: unknown, signal?: AbortSignal): boolean {
  if (!signal?.aborted) {
    return false;
  }
  if (err === signal.reason) {
    return true;
  }
  if (err instanceof Error && err.name === "AbortError") {
    return true;
  }
  return false;
}

function shouldEmitLoopWarning(state: SessionState, warningKey: string, count: number): boolean {
  if (!state.toolLoopWarningBuckets) {
    state.toolLoopWarningBuckets = new Map();
  }
  const bucket = Math.floor(count / LOOP_WARNING_BUCKET_SIZE);
  const lastBucket = state.toolLoopWarningBuckets.get(warningKey) ?? 0;
  if (bucket <= lastBucket) {
    return false;
  }
  state.toolLoopWarningBuckets.set(warningKey, bucket);
  if (state.toolLoopWarningBuckets.size > MAX_LOOP_WARNING_KEYS) {
    const oldest = state.toolLoopWarningBuckets.keys().next().value;
    if (oldest) {
      state.toolLoopWarningBuckets.delete(oldest);
    }
  }
  return true;
}

function mapRuntimeStatusToDiagnosticState(
  status?: AgentRuntimeStatus,
): SessionState["state"] | undefined {
  if (!status) {
    return undefined;
  }
  if (status === "waiting") {
    return "waiting";
  }
  if (status === "created" || status === "running") {
    return "processing";
  }
  return "idle";
}

async function resolveRuntimeAwareSessionState(
  ctx?: HookContext,
): Promise<RuntimeAwareSessionState> {
  if (!ctx?.runId && !ctx?.sessionKey && !ctx?.sessionId) {
    return {};
  }
  const { getDiagnosticSessionState, getAgentRuntimeState, updateDiagnosticSessionState } =
    await loadBeforeToolCallRuntime();
  const runtimeState = ctx?.runId ? getAgentRuntimeState(ctx.runId) : undefined;
  const sessionKey = runtimeState?.sessionKey ?? ctx?.sessionKey;
  const sessionId = runtimeState?.sessionId ?? ctx?.sessionId;
  if (!sessionKey && !sessionId) {
    return { runtimeState };
  }
  const sessionState =
    runtimeState || sessionKey || sessionId
      ? updateDiagnosticSessionState(
          {
            sessionKey,
            sessionId,
          },
          {
            sessionKey,
            sessionId,
            ...(runtimeState
              ? {
                  lastActivity:
                    runtimeState.lastHeartbeat ??
                    runtimeState.updatedAt ??
                    runtimeState.startedAt ??
                    Date.now(),
                  state: mapRuntimeStatusToDiagnosticState(runtimeState.status),
                }
              : {}),
          },
        )
      : getDiagnosticSessionState({
          sessionKey,
          sessionId,
        });
  return {
    sessionState,
    runtimeState,
  };
}

async function recordLoopOutcome(args: {
  ctx?: HookContext;
  toolName: string;
  toolParams: unknown;
  toolCallId?: string;
  result?: unknown;
  error?: unknown;
}): Promise<void> {
  const loopDetection = args.ctx?.loopDetection;
  const { sessionState } = await resolveRuntimeAwareSessionState(args.ctx);
  if (!sessionState) {
    return;
  }
  try {
    const { recordToolCallOutcome } = await loadBeforeToolCallRuntime();
    recordToolCallOutcome(sessionState, {
      toolName: args.toolName,
      toolParams: args.toolParams,
      toolCallId: args.toolCallId,
      result: args.result,
      error: args.error,
      config: loopDetection,
    });
  } catch (err) {
    log.warn(`tool loop outcome tracking failed: tool=${args.toolName} error=${String(err)}`);
  }
}

export async function runBeforeToolCallHook(args: {
  toolName: string;
  params: unknown;
  toolCallId?: string;
  ctx?: HookContext;
  signal?: AbortSignal;
}): Promise<HookOutcome> {
  const toolName = normalizeToolName(args.toolName || "tool");
  let params = args.params;
  const loopDetection = args.ctx?.loopDetection;
  const { sessionState, runtimeState } = await resolveRuntimeAwareSessionState(args.ctx);
  const effectiveAgentId = runtimeState?.agentId ?? args.ctx?.agentId;
  const effectiveSessionKey = runtimeState?.sessionKey ?? args.ctx?.sessionKey;
  const effectiveSessionId = runtimeState?.sessionId ?? args.ctx?.sessionId;
  const archiveScope = {
    ...(args.ctx?.runId ? { runId: args.ctx.runId } : {}),
    ...(effectiveSessionKey ? { sessionKey: effectiveSessionKey } : {}),
    ...(effectiveSessionId ? { sessionId: effectiveSessionId } : {}),
    ...(effectiveAgentId ? { agentId: effectiveAgentId } : {}),
  };
  const guard = resolveAgentGuardContext({
    runId: args.ctx?.runId,
    agentId: effectiveAgentId,
    sessionKey: effectiveSessionKey,
    sessionId: effectiveSessionId,
    sandboxed: args.ctx?.sandboxed,
  });
  const specialToolAllowlist = args.ctx?.specialToolAllowlist;
  const normalizedSpecialAllowlist = Array.isArray(specialToolAllowlist)
    ? new Set(
        specialToolAllowlist
          .map((entry) => normalizeToolName(entry))
          .filter((entry) => entry.length > 0),
      )
    : undefined;

  if (normalizedSpecialAllowlist && !normalizedSpecialAllowlist.has(toolName)) {
    const reason = `Tool "${toolName}" is not allowed for this special-agent run`;
    emitGuardBlockedActionEvent({
      runId: args.ctx?.runId,
      sessionKey: effectiveSessionKey,
      toolName,
      toolCallId: args.toolCallId,
      title: `Blocked ${toolName} for special agent`,
      reason,
    });
    await recordArchiveDecisionEvent({
      type: "tool.guard_admission",
      scope: archiveScope,
      payload: {
        version: 1,
        toolName,
        ...(args.toolCallId ? { toolCallId: args.toolCallId } : {}),
        ...(args.ctx?.runId ? { runId: args.ctx.runId } : {}),
        ...(effectiveSessionKey ? { sessionKey: effectiveSessionKey } : {}),
        ...(effectiveSessionId ? { sessionId: effectiveSessionId } : {}),
        ...(effectiveAgentId ? { agentId: effectiveAgentId } : {}),
        guard: snapshotArchiveGuardContext(guard),
        admission: {
          stage: "special_agent",
          blocked: true,
          reason,
          allowlist: [...normalizedSpecialAllowlist],
        },
        inputParams: isPlainObject(params) ? params : {},
      },
    });
    return {
      blocked: true,
      reason,
    };
  }

  if (args.ctx?.specialToolGuard) {
    const guardOutcome = evaluateMemoryMaintenanceToolGuard({
      toolName,
      toolParams: params,
      guard: args.ctx.specialToolGuard,
    });
    if (guardOutcome.blocked) {
      emitGuardBlockedActionEvent({
        runId: args.ctx?.runId,
        sessionKey: effectiveSessionKey,
        toolName,
        toolCallId: args.toolCallId,
        title: `Blocked ${toolName} by special-agent guard`,
        reason: guardOutcome.reason,
      });
      await recordArchiveDecisionEvent({
        type: "tool.guard_admission",
        scope: archiveScope,
        payload: {
          version: 1,
          toolName,
          ...(args.toolCallId ? { toolCallId: args.toolCallId } : {}),
          ...(args.ctx?.runId ? { runId: args.ctx.runId } : {}),
          ...(effectiveSessionKey ? { sessionKey: effectiveSessionKey } : {}),
          ...(effectiveSessionId ? { sessionId: effectiveSessionId } : {}),
          ...(effectiveAgentId ? { agentId: effectiveAgentId } : {}),
          guard: snapshotArchiveGuardContext(guard),
          admission: {
            stage: "special_agent_guard",
            blocked: true,
            reason: guardOutcome.reason,
            specialToolGuard: args.ctx.specialToolGuard.kind,
          },
          inputParams: isPlainObject(params) ? params : {},
        },
      });
      return guardOutcome;
    }
    params = guardOutcome.params;
  }

  if (sessionState) {
    const { logToolLoopAction, detectToolCallLoop, recordToolCall } =
      await loadBeforeToolCallRuntime();

    const loopResult = detectToolCallLoop(sessionState, toolName, params, loopDetection);

    if (loopResult.stuck) {
      const policyDecision = decideLoopPolicyAction(loopResult);
      if (loopResult.level === "critical" && policyDecision?.blocked) {
        log.error(`Blocking ${toolName} due to loop policy: ${policyDecision.reason}`);
        emitLoopActionEvent({
          runId: args.ctx?.runId,
          sessionKey: effectiveSessionKey,
          toolName,
          toolCallId: args.toolCallId,
          detector: loopResult.detector,
          level: loopResult.level,
          action: policyDecision.action,
          blocked: policyDecision.blocked,
          count: loopResult.count,
          message: loopResult.message,
          pairedToolName: loopResult.pairedToolName,
        });
        void recordArchiveDecisionEvent({
          type: "tool.loop_policy",
          scope: archiveScope,
          payload: {
            version: 1,
            toolName,
            ...(args.toolCallId ? { toolCallId: args.toolCallId } : {}),
            ...(args.ctx?.runId ? { runId: args.ctx.runId } : {}),
            ...(effectiveSessionKey ? { sessionKey: effectiveSessionKey } : {}),
            ...(effectiveSessionId ? { sessionId: effectiveSessionId } : {}),
            ...(effectiveAgentId ? { agentId: effectiveAgentId } : {}),
            guard: snapshotArchiveGuardContext(guard),
            loop: {
              detector: loopResult.detector,
              level: loopResult.level,
              count: loopResult.count,
              message: loopResult.message,
              ...(loopResult.pairedToolName ? { pairedToolName: loopResult.pairedToolName } : {}),
            },
            policy: {
              action: policyDecision.action,
              blocked: policyDecision.blocked,
              reason: policyDecision.reason,
            },
          },
        });
        logToolLoopAction({
          sessionKey: effectiveSessionKey,
          sessionId: effectiveSessionId,
          toolName,
          level: "critical",
          action: policyDecision.action,
          detector: loopResult.detector,
          count: loopResult.count,
          message: loopResult.message,
          pairedToolName: loopResult.pairedToolName,
        });
        return {
          blocked: true,
          reason: policyDecision.reason,
        };
      } else if (policyDecision) {
        const warningKey = loopResult.warningKey ?? `${loopResult.detector}:${toolName}`;
        if (shouldEmitLoopWarning(sessionState, warningKey, loopResult.count)) {
          log.warn(`Loop ${policyDecision.action} for ${toolName}: ${loopResult.message}`);
          emitLoopActionEvent({
            runId: args.ctx?.runId,
            sessionKey: effectiveSessionKey,
            toolName,
            toolCallId: args.toolCallId,
            detector: loopResult.detector,
            level: loopResult.level,
            action: policyDecision.action,
            blocked: policyDecision.blocked,
            count: loopResult.count,
            message: loopResult.message,
            pairedToolName: loopResult.pairedToolName,
          });
          void recordArchiveDecisionEvent({
            type: "tool.loop_policy",
            scope: archiveScope,
            payload: {
              version: 1,
              toolName,
              ...(args.toolCallId ? { toolCallId: args.toolCallId } : {}),
              ...(args.ctx?.runId ? { runId: args.ctx.runId } : {}),
              ...(effectiveSessionKey ? { sessionKey: effectiveSessionKey } : {}),
              ...(effectiveSessionId ? { sessionId: effectiveSessionId } : {}),
              ...(effectiveAgentId ? { agentId: effectiveAgentId } : {}),
              guard: snapshotArchiveGuardContext(guard),
              loop: {
                detector: loopResult.detector,
                level: loopResult.level,
                count: loopResult.count,
                message: loopResult.message,
                ...(loopResult.pairedToolName ? { pairedToolName: loopResult.pairedToolName } : {}),
              },
              policy: {
                action: policyDecision.action,
                blocked: policyDecision.blocked,
              },
            },
          });
          logToolLoopAction({
            sessionKey: effectiveSessionKey,
            sessionId: effectiveSessionId,
            toolName,
            level: "warning",
            action: policyDecision.action,
            detector: loopResult.detector,
            count: loopResult.count,
            message: loopResult.message,
            pairedToolName: loopResult.pairedToolName,
          });
        }
      }
    }

    recordToolCall(sessionState, toolName, params, args.toolCallId, loopDetection);
  }

  const hookRunner = getGlobalHookRunner();
  if (!hookRunner?.hasHooks("before_tool_call")) {
    await recordArchiveDecisionEvent({
      type: "tool.guard_admission",
      scope: archiveScope,
      payload: {
        version: 1,
        toolName,
        ...(args.toolCallId ? { toolCallId: args.toolCallId } : {}),
        ...(args.ctx?.runId ? { runId: args.ctx.runId } : {}),
        ...(effectiveSessionKey ? { sessionKey: effectiveSessionKey } : {}),
        ...(effectiveSessionId ? { sessionId: effectiveSessionId } : {}),
        ...(effectiveAgentId ? { agentId: effectiveAgentId } : {}),
        guard: snapshotArchiveGuardContext(guard),
        admission: {
          stage: "default",
          blocked: false,
        },
        inputParams: isPlainObject(params) ? params : {},
      },
    });
    return { blocked: false, params: args.params };
  }

  try {
    const normalizedParams = isPlainObject(params) ? params : {};
    const toolContext = {
      toolName,
      ...(effectiveAgentId && { agentId: effectiveAgentId }),
      ...(effectiveSessionKey && { sessionKey: effectiveSessionKey }),
      ...(effectiveSessionId && { sessionId: effectiveSessionId }),
      ...(args.ctx?.runId && { runId: args.ctx.runId }),
      ...(args.toolCallId && { toolCallId: args.toolCallId }),
      guard: {
        ...(guard.runtime ? { runtime: guard.runtime } : {}),
        ...(guard.mode ? { mode: guard.mode } : {}),
        browserClientsVisible: guard.browserClientsVisible,
        heartbeat: guard.heartbeat,
        interactiveApprovalAvailable: guard.interactiveApprovalAvailable,
        ...(guard.interactiveApprovalBlocker
          ? { interactiveApprovalBlocker: guard.interactiveApprovalBlocker }
          : {}),
        ...(guard.capability ? { capability: guard.capability } : {}),
      },
    };
    const hookResult = await hookRunner.runBeforeToolCall(
      {
        toolName,
        params: normalizedParams,
        ...(args.ctx?.runId && { runId: args.ctx.runId }),
        ...(args.toolCallId && { toolCallId: args.toolCallId }),
      },
      toolContext,
    );

    if (hookResult?.block) {
      emitGuardBlockedActionEvent({
        runId: args.ctx?.runId,
        sessionKey: effectiveSessionKey,
        toolName,
        toolCallId: args.toolCallId,
        reason: hookResult.blockReason || "Tool call blocked by plugin hook",
      });
      await recordArchiveDecisionEvent({
        type: "tool.guard_admission",
        scope: archiveScope,
        payload: {
          version: 1,
          toolName,
          ...(args.toolCallId ? { toolCallId: args.toolCallId } : {}),
          ...(args.ctx?.runId ? { runId: args.ctx.runId } : {}),
          ...(effectiveSessionKey ? { sessionKey: effectiveSessionKey } : {}),
          ...(effectiveSessionId ? { sessionId: effectiveSessionId } : {}),
          ...(effectiveAgentId ? { agentId: effectiveAgentId } : {}),
          guard: snapshotArchiveGuardContext(guard),
          admission: {
            stage: "hook",
            blocked: true,
            reason: hookResult.blockReason || "Tool call blocked by plugin hook",
          },
          inputParams: normalizedParams,
        },
      });
      return {
        blocked: true,
        reason: hookResult.blockReason || "Tool call blocked by plugin hook",
      };
    }

    if (hookResult?.requireApproval) {
      const approval = hookResult.requireApproval;
      const safeOnResolution = (resolution: PluginApprovalResolution): void => {
        const onResolution = approval.onResolution;
        if (typeof onResolution !== "function") {
          return;
        }
        try {
          void Promise.resolve(onResolution(resolution)).catch((err) => {
            log.warn(`plugin onResolution callback failed: ${String(err)}`);
          });
        } catch (err) {
          log.warn(`plugin onResolution callback failed: ${String(err)}`);
        }
      };
      if (!guard.interactiveApprovalAvailable) {
        safeOnResolution(PluginApprovalResolutions.CANCELLED);
        await recordArchiveDecisionEvent({
          type: "tool.guard_admission",
          scope: archiveScope,
          payload: {
            version: 1,
            toolName,
            ...(args.toolCallId ? { toolCallId: args.toolCallId } : {}),
            ...(args.ctx?.runId ? { runId: args.ctx.runId } : {}),
            ...(effectiveSessionKey ? { sessionKey: effectiveSessionKey } : {}),
            ...(effectiveSessionId ? { sessionId: effectiveSessionId } : {}),
            ...(effectiveAgentId ? { agentId: effectiveAgentId } : {}),
            guard: snapshotArchiveGuardContext(guard),
            admission: {
              stage: "approval",
              blocked: true,
              reason:
                guard.interactiveApprovalReason ??
                "Plugin approval required, but interactive approvals are unavailable for this run.",
              approval: {
                requested: true,
                resolution: PluginApprovalResolutions.CANCELLED,
              },
            },
            inputParams: normalizedParams,
          },
        });
        return {
          blocked: true,
          reason:
            guard.interactiveApprovalReason ??
            "Plugin approval required, but interactive approvals are unavailable for this run.",
        };
      }
      try {
        const requestResult = await callGatewayTool<{
          id?: string;
          status?: string;
          decision?: string | null;
        }>(
          "plugin.approval.request",
          // Buffer beyond the approval timeout so the gateway can clean up
          // and respond before the client-side RPC timeout fires.
          { timeoutMs: (approval.timeoutMs ?? 120_000) + 10_000 },
          {
            pluginId: approval.pluginId,
            title: approval.title,
            description: approval.description,
            severity: approval.severity,
            toolName,
            toolCallId: args.toolCallId,
            agentId: effectiveAgentId,
            sessionKey: effectiveSessionKey,
            timeoutMs: approval.timeoutMs ?? 120_000,
            twoPhase: true,
          },
          { expectFinal: false },
        );
        const id = requestResult?.id;
        if (!id) {
          safeOnResolution(PluginApprovalResolutions.CANCELLED);
          await recordArchiveDecisionEvent({
            type: "tool.guard_admission",
            scope: archiveScope,
            payload: {
              version: 1,
              toolName,
              ...(args.toolCallId ? { toolCallId: args.toolCallId } : {}),
              ...(args.ctx?.runId ? { runId: args.ctx.runId } : {}),
              ...(effectiveSessionKey ? { sessionKey: effectiveSessionKey } : {}),
              ...(effectiveSessionId ? { sessionId: effectiveSessionId } : {}),
              ...(effectiveAgentId ? { agentId: effectiveAgentId } : {}),
              guard: snapshotArchiveGuardContext(guard),
              admission: {
                stage: "approval",
                blocked: true,
                reason: approval.description || "Plugin approval request failed",
                approval: {
                  requested: true,
                  resolution: PluginApprovalResolutions.CANCELLED,
                },
              },
              inputParams: normalizedParams,
            },
          });
          return {
            blocked: true,
            reason: approval.description || "Plugin approval request failed",
          };
        }
        const hasImmediateDecision = Object.prototype.hasOwnProperty.call(
          requestResult ?? {},
          "decision",
        );
        let decision: string | null | undefined;
        if (hasImmediateDecision) {
          decision = requestResult?.decision;
          if (decision === null) {
            safeOnResolution(PluginApprovalResolutions.CANCELLED);
            await recordArchiveDecisionEvent({
              type: "tool.guard_admission",
              scope: archiveScope,
              payload: {
                version: 1,
                toolName,
                ...(args.toolCallId ? { toolCallId: args.toolCallId } : {}),
                ...(args.ctx?.runId ? { runId: args.ctx.runId } : {}),
                ...(effectiveSessionKey ? { sessionKey: effectiveSessionKey } : {}),
                ...(effectiveSessionId ? { sessionId: effectiveSessionId } : {}),
                ...(effectiveAgentId ? { agentId: effectiveAgentId } : {}),
                guard: snapshotArchiveGuardContext(guard),
                admission: {
                  stage: "approval",
                  blocked: true,
                  reason: "Plugin approval unavailable (no approval route)",
                  approval: {
                    requested: true,
                    decision,
                    resolution: PluginApprovalResolutions.CANCELLED,
                  },
                },
                inputParams: normalizedParams,
              },
            });
            return {
              blocked: true,
              reason: "Plugin approval unavailable (no approval route)",
            };
          }
        } else {
          // Wait for the decision, but abort early if the agent run is cancelled
          // so the user isn't blocked for the full approval timeout.
          const waitPromise = callGatewayTool<{
            id?: string;
            decision?: string | null;
          }>(
            "plugin.approval.waitDecision",
            // Buffer beyond the approval timeout so the gateway can clean up
            // and respond before the client-side RPC timeout fires.
            { timeoutMs: (approval.timeoutMs ?? 120_000) + 10_000 },
            { id },
          );
          let waitResult: { id?: string; decision?: string | null } | undefined;
          if (args.signal) {
            let onAbort: (() => void) | undefined;
            const abortPromise = new Promise<never>((_, reject) => {
              if (args.signal!.aborted) {
                reject(args.signal!.reason);
                return;
              }
              onAbort = () => reject(args.signal!.reason);
              args.signal!.addEventListener("abort", onAbort, { once: true });
            });
            try {
              waitResult = await Promise.race([waitPromise, abortPromise]);
            } finally {
              if (onAbort) {
                args.signal.removeEventListener("abort", onAbort);
              }
            }
          } else {
            waitResult = await waitPromise;
          }
          decision = waitResult?.decision;
        }
        const resolution: PluginApprovalResolution =
          decision === PluginApprovalResolutions.ALLOW_ONCE ||
          decision === PluginApprovalResolutions.ALLOW_ALWAYS ||
          decision === PluginApprovalResolutions.DENY
            ? decision
            : PluginApprovalResolutions.TIMEOUT;
        safeOnResolution(resolution);
        if (
          decision === PluginApprovalResolutions.ALLOW_ONCE ||
          decision === PluginApprovalResolutions.ALLOW_ALWAYS
        ) {
          await recordArchiveDecisionEvent({
            type: "tool.guard_admission",
            scope: archiveScope,
            payload: {
              version: 1,
              toolName,
              ...(args.toolCallId ? { toolCallId: args.toolCallId } : {}),
              ...(args.ctx?.runId ? { runId: args.ctx.runId } : {}),
              ...(effectiveSessionKey ? { sessionKey: effectiveSessionKey } : {}),
              ...(effectiveSessionId ? { sessionId: effectiveSessionId } : {}),
              ...(effectiveAgentId ? { agentId: effectiveAgentId } : {}),
              guard: snapshotArchiveGuardContext(guard),
              admission: {
                stage: "approval",
                blocked: false,
                approval: {
                  requested: true,
                  decision,
                  resolution,
                },
              },
              inputParams: normalizedParams,
              effectiveParams: mergeParamsWithApprovalOverrides(params, hookResult.params),
            },
          });
          return {
            blocked: false,
            params: mergeParamsWithApprovalOverrides(params, hookResult.params),
          };
        }
        if (decision === PluginApprovalResolutions.DENY) {
          await recordArchiveDecisionEvent({
            type: "tool.guard_admission",
            scope: archiveScope,
            payload: {
              version: 1,
              toolName,
              ...(args.toolCallId ? { toolCallId: args.toolCallId } : {}),
              ...(args.ctx?.runId ? { runId: args.ctx.runId } : {}),
              ...(effectiveSessionKey ? { sessionKey: effectiveSessionKey } : {}),
              ...(effectiveSessionId ? { sessionId: effectiveSessionId } : {}),
              ...(effectiveAgentId ? { agentId: effectiveAgentId } : {}),
              guard: snapshotArchiveGuardContext(guard),
              admission: {
                stage: "approval",
                blocked: true,
                reason: "Denied by user",
                approval: {
                  requested: true,
                  decision,
                  resolution,
                },
              },
              inputParams: normalizedParams,
            },
          });
          return { blocked: true, reason: "Denied by user" };
        }
        const timeoutBehavior = approval.timeoutBehavior ?? "deny";
        if (timeoutBehavior === "allow") {
          await recordArchiveDecisionEvent({
            type: "tool.guard_admission",
            scope: archiveScope,
            payload: {
              version: 1,
              toolName,
              ...(args.toolCallId ? { toolCallId: args.toolCallId } : {}),
              ...(args.ctx?.runId ? { runId: args.ctx.runId } : {}),
              ...(effectiveSessionKey ? { sessionKey: effectiveSessionKey } : {}),
              ...(effectiveSessionId ? { sessionId: effectiveSessionId } : {}),
              ...(effectiveAgentId ? { agentId: effectiveAgentId } : {}),
              guard: snapshotArchiveGuardContext(guard),
              admission: {
                stage: "approval",
                blocked: false,
                approval: {
                  requested: true,
                  decision,
                  resolution,
                  timeoutBehavior,
                },
              },
              inputParams: normalizedParams,
              effectiveParams: mergeParamsWithApprovalOverrides(params, hookResult.params),
            },
          });
          return {
            blocked: false,
            params: mergeParamsWithApprovalOverrides(params, hookResult.params),
          };
        }
        await recordArchiveDecisionEvent({
          type: "tool.guard_admission",
          scope: archiveScope,
          payload: {
            version: 1,
            toolName,
            ...(args.toolCallId ? { toolCallId: args.toolCallId } : {}),
            ...(args.ctx?.runId ? { runId: args.ctx.runId } : {}),
            ...(effectiveSessionKey ? { sessionKey: effectiveSessionKey } : {}),
            ...(effectiveSessionId ? { sessionId: effectiveSessionId } : {}),
            ...(effectiveAgentId ? { agentId: effectiveAgentId } : {}),
            guard: snapshotArchiveGuardContext(guard),
            admission: {
              stage: "approval",
              blocked: true,
              reason: "Approval timed out",
              approval: {
                requested: true,
                decision,
                resolution,
                timeoutBehavior,
              },
            },
            inputParams: normalizedParams,
          },
        });
        return { blocked: true, reason: "Approval timed out" };
      } catch (err) {
        safeOnResolution(PluginApprovalResolutions.CANCELLED);
        if (isAbortSignalCancellation(err, args.signal)) {
          log.warn(`plugin approval wait cancelled by run abort: ${String(err)}`);
          await recordArchiveDecisionEvent({
            type: "tool.guard_admission",
            scope: archiveScope,
            payload: {
              version: 1,
              toolName,
              ...(args.toolCallId ? { toolCallId: args.toolCallId } : {}),
              ...(args.ctx?.runId ? { runId: args.ctx.runId } : {}),
              ...(effectiveSessionKey ? { sessionKey: effectiveSessionKey } : {}),
              ...(effectiveSessionId ? { sessionId: effectiveSessionId } : {}),
              ...(effectiveAgentId ? { agentId: effectiveAgentId } : {}),
              guard: snapshotArchiveGuardContext(guard),
              admission: {
                stage: "approval",
                blocked: true,
                reason: "Approval cancelled (run aborted)",
                approval: {
                  requested: true,
                  resolution: PluginApprovalResolutions.CANCELLED,
                },
              },
              inputParams: normalizedParams,
            },
          });
          return {
            blocked: true,
            reason: "Approval cancelled (run aborted)",
          };
        }
        log.warn(`plugin approval gateway request failed, falling back to block: ${String(err)}`);
        await recordArchiveDecisionEvent({
          type: "tool.guard_admission",
          scope: archiveScope,
          payload: {
            version: 1,
            toolName,
            ...(args.toolCallId ? { toolCallId: args.toolCallId } : {}),
            ...(args.ctx?.runId ? { runId: args.ctx.runId } : {}),
            ...(effectiveSessionKey ? { sessionKey: effectiveSessionKey } : {}),
            ...(effectiveSessionId ? { sessionId: effectiveSessionId } : {}),
            ...(effectiveAgentId ? { agentId: effectiveAgentId } : {}),
            guard: snapshotArchiveGuardContext(guard),
            admission: {
              stage: "approval",
              blocked: true,
              reason: "Plugin approval required (gateway unavailable)",
              approval: {
                requested: true,
                resolution: PluginApprovalResolutions.CANCELLED,
                gatewayError: String(err),
              },
            },
            inputParams: normalizedParams,
          },
        });
        return {
          blocked: true,
          reason: "Plugin approval required (gateway unavailable)",
        };
      }
    }

    if (hookResult?.params) {
      await recordArchiveDecisionEvent({
        type: "tool.guard_admission",
        scope: archiveScope,
        payload: {
          version: 1,
          toolName,
          ...(args.toolCallId ? { toolCallId: args.toolCallId } : {}),
          ...(args.ctx?.runId ? { runId: args.ctx.runId } : {}),
          ...(effectiveSessionKey ? { sessionKey: effectiveSessionKey } : {}),
          ...(effectiveSessionId ? { sessionId: effectiveSessionId } : {}),
          ...(effectiveAgentId ? { agentId: effectiveAgentId } : {}),
          guard: snapshotArchiveGuardContext(guard),
          admission: {
            stage: "hook",
            blocked: false,
            paramsAdjusted: true,
          },
          inputParams: normalizedParams,
          effectiveParams: mergeParamsWithApprovalOverrides(params, hookResult.params),
        },
      });
      return {
        blocked: false,
        params: mergeParamsWithApprovalOverrides(params, hookResult.params),
      };
    }
  } catch (err) {
    const toolCallId = args.toolCallId ? ` toolCallId=${args.toolCallId}` : "";
    log.warn(`before_tool_call hook failed: tool=${toolName}${toolCallId} error=${String(err)}`);
  }

  await recordArchiveDecisionEvent({
    type: "tool.guard_admission",
    scope: archiveScope,
    payload: {
      version: 1,
      toolName,
      ...(args.toolCallId ? { toolCallId: args.toolCallId } : {}),
      ...(args.ctx?.runId ? { runId: args.ctx.runId } : {}),
      ...(effectiveSessionKey ? { sessionKey: effectiveSessionKey } : {}),
      ...(effectiveSessionId ? { sessionId: effectiveSessionId } : {}),
      ...(effectiveAgentId ? { agentId: effectiveAgentId } : {}),
      guard: snapshotArchiveGuardContext(guard),
      admission: {
        stage: "default",
        blocked: false,
      },
      inputParams: isPlainObject(params) ? params : {},
    },
  });
  return { blocked: false, params };
}

export function wrapToolWithBeforeToolCallHook(
  tool: AnyAgentTool,
  ctx?: HookContext,
): AnyAgentTool {
  const execute = tool.execute;
  if (!execute) {
    return tool;
  }
  const toolName = tool.name || "tool";
  const wrappedTool: AnyAgentTool = {
    ...tool,
    execute: async (toolCallId, params, signal, onUpdate) => {
      const runtimeContext = normalizeToolCallRuntimeContext(ctx);
      if (runtimeContext && toolCallId) {
        activeToolCallContextById.set(toolCallId, runtimeContext);
      }
      let outcome: HookOutcome | undefined;
      const normalizedToolName = normalizeToolName(toolName || "tool");
      try {
        outcome = await runBeforeToolCallHook({
          toolName,
          params,
          toolCallId,
          ctx,
          signal,
        });
        if (outcome.blocked) {
          throw new Error(outcome.reason);
        }
        if (toolCallId) {
          const adjustedParamsKey = buildAdjustedParamsKey({ runId: ctx?.runId, toolCallId });
          adjustedParamsByToolCallId.set(adjustedParamsKey, outcome.params);
          if (adjustedParamsByToolCallId.size > MAX_TRACKED_ADJUSTED_PARAMS) {
            const oldest = adjustedParamsByToolCallId.keys().next().value;
            if (oldest) {
              adjustedParamsByToolCallId.delete(oldest);
            }
          }
        }
        const result = await execute(toolCallId, outcome.params, signal, onUpdate);
        await recordLoopOutcome({
          ctx,
          toolName: normalizedToolName,
          toolParams: outcome.params,
          toolCallId,
          result,
        });
        await recordArchiveDecisionEvent({
          type: "tool.result",
          scope: {
            ...(ctx?.runId ? { runId: ctx.runId } : {}),
            ...(ctx?.sessionKey ? { sessionKey: ctx.sessionKey } : {}),
            ...(ctx?.sessionId ? { sessionId: ctx.sessionId } : {}),
            ...(ctx?.agentId ? { agentId: ctx.agentId } : {}),
          },
          payload: {
            version: 1,
            toolName: normalizedToolName,
            ...(toolCallId ? { toolCallId } : {}),
            ...(ctx?.runId ? { runId: ctx.runId } : {}),
            admission: {
              blocked: false,
            },
            params: outcome.params,
            result,
            isError: false,
          },
        });
        return result;
      } catch (err) {
        await recordLoopOutcome({
          ctx,
          toolName: normalizedToolName,
          toolParams: outcome?.blocked ? params : (outcome?.params ?? params),
          toolCallId,
          error: err,
        });
        await recordArchiveDecisionEvent({
          type: "tool.result",
          scope: {
            ...(ctx?.runId ? { runId: ctx.runId } : {}),
            ...(ctx?.sessionKey ? { sessionKey: ctx.sessionKey } : {}),
            ...(ctx?.sessionId ? { sessionId: ctx.sessionId } : {}),
            ...(ctx?.agentId ? { agentId: ctx.agentId } : {}),
          },
          payload: {
            version: 1,
            toolName: normalizedToolName,
            ...(toolCallId ? { toolCallId } : {}),
            ...(ctx?.runId ? { runId: ctx.runId } : {}),
            admission: {
              blocked: false,
            },
            params: outcome?.blocked ? params : (outcome?.params ?? params),
            error: describeArchiveError(err),
            isError: true,
          },
        });
        throw err;
      } finally {
        if (toolCallId) {
          activeToolCallContextById.delete(toolCallId);
        }
      }
    },
  };
  copyPluginToolMeta(tool, wrappedTool);
  copyChannelAgentToolMeta(tool as never, wrappedTool as never);
  Object.defineProperty(wrappedTool, BEFORE_TOOL_CALL_WRAPPED, {
    value: true,
    enumerable: true,
  });
  return wrappedTool;
}

export function isToolWrappedWithBeforeToolCallHook(tool: AnyAgentTool): boolean {
  const taggedTool = tool as unknown as Record<symbol, unknown>;
  return taggedTool[BEFORE_TOOL_CALL_WRAPPED] === true;
}

export function consumeAdjustedParamsForToolCall(toolCallId: string, runId?: string): unknown {
  const adjustedParamsKey = buildAdjustedParamsKey({ runId, toolCallId });
  const params = adjustedParamsByToolCallId.get(adjustedParamsKey);
  adjustedParamsByToolCallId.delete(adjustedParamsKey);
  return params;
}

export function peekToolCallRuntimeContext(toolCallId: string): ToolCallRuntimeContext | undefined {
  const context = activeToolCallContextById.get(toolCallId);
  return context ? { ...context } : undefined;
}

export const __testing = {
  BEFORE_TOOL_CALL_WRAPPED,
  archiveDecisionRunIdsByScope,
  ensureArchiveDecisionRun,
  buildAdjustedParamsKey,
  adjustedParamsByToolCallId,
  activeToolCallContextById,
  runBeforeToolCallHook,
  mergeParamsWithApprovalOverrides,
  recordArchiveDecisionEvent,
  isPlainObject,
  resolveArchiveDecisionScopeKey,
  snapshotArchiveGuardContext,
};
