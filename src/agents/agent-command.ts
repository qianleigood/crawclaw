import { type VerboseLevel } from "../agents/thinking.js";
import { type SessionEntry } from "../config/sessions.js";
import { callGatewayCli } from "../gateway/call.js";
import {
  clearAgentRunContext,
  emitAgentEvent,
  registerAgentRunContext,
} from "../infra/agent-events.js";
import { defaultRuntime, type RuntimeEnv } from "../runtime.js";
import { applyVerboseOverride } from "../sessions/level-overrides.js";
import { type CliDeps, createDefaultDeps } from "../terminal/deps.js";
import { resolveMessageChannel } from "../utils/gateway-client-surface.js";
import { persistSessionEntry, prepareAgentCommandExecution } from "./command/prepare.js";
import { resolveAgentRunContext } from "./command/run-context.js";
import type { AgentCommandIngressOpts, AgentCommandOpts } from "./command/types.js";
import { registerAgentRuntimeRun } from "./runtime/agent-progress.js";
import { normalizeRustAgentRunResult, type RustAgentRunResult } from "./rust-agent-result.js";

function optionalString(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value.trim() || undefined;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return undefined;
}

function compactRecord(values: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined || value === null || value === "") {
      continue;
    }
    result[key] = value;
  }
  return result;
}

function buildRustAgentCommandRequest(params: {
  runId: string;
  sessionKey: string;
  sessionAgentId: string;
  body: string;
  messageChannel: string;
  accountId?: string;
  messageTo?: string;
  threadId?: string | number;
  provider?: string;
  model?: string;
  reasoningLevel?: string;
  toolsAllow?: string[];
  options: Record<string, unknown>;
  metadata: Record<string, unknown>;
}) {
  return {
    runId: params.runId,
    agentId: params.sessionAgentId,
    sessionKey: params.sessionKey,
    inbound: {
      channel: params.messageChannel,
      accountId: params.accountId,
      from: "user",
      to: params.messageTo ?? "agent:main",
      chatType: "direct",
      body: params.body,
      rawBody: params.body,
      threadId: optionalString(params.threadId) ?? params.sessionKey,
      mediaUrls: [],
      metadata: compactRecord(params.metadata),
    },
    model: {
      provider: params.provider ?? "configured",
      model: params.model ?? "configured",
      ...(params.reasoningLevel ? { reasoningLevel: params.reasoningLevel } : {}),
    },
    enabledTools: params.toolsAllow ?? [],
    options: compactRecord(params.options),
  };
}

async function runAgentCommandInternal(
  opts: AgentCommandOpts & { senderIsOwner: boolean },
  runtime: RuntimeEnv = defaultRuntime,
  deps: CliDeps = createDefaultDeps(),
) {
  const prepared = await prepareAgentCommandExecution(opts, runtime);
  const {
    body,
    cfg,
    normalizedSpawned,
    agentCfg,
    thinkOverride,
    thinkOnce,
    verboseOverride,
    timeoutMs,
    maxTurns,
    sessionId,
    sessionKey,
    sessionStore,
    storePath,
    persistedThinking,
    persistedVerbose,
    sessionAgentId,
    workspaceDir,
    runId,
  } = prepared;
  let sessionEntry = prepared.sessionEntry;

  try {
    const resolvedThinkLevel = thinkOnce ?? thinkOverride ?? persistedThinking;
    const resolvedVerboseLevel =
      verboseOverride ?? persistedVerbose ?? (agentCfg?.verboseDefault as VerboseLevel | undefined);

    if (sessionKey) {
      registerAgentRunContext(runId, {
        sessionKey,
        sessionId,
        agentId: sessionAgentId,
        taskMode: "foreground",
        taskRuntime: "cli",
        verboseLevel: resolvedVerboseLevel,
      });
    }
    registerAgentRuntimeRun({
      runId,
      sessionKey: sessionKey ?? undefined,
      sessionId,
      agentId: sessionAgentId,
      mode: "foreground",
      runtime: "cli",
      status: "created",
      updatedAt: Date.now(),
    });

    // Persist explicit /command overrides to the session store when we have a key.
    if (sessionStore && sessionKey) {
      const entry = sessionStore[sessionKey] ??
        sessionEntry ?? { sessionId, updatedAt: Date.now() };
      const next: SessionEntry = { ...entry, sessionId, updatedAt: Date.now() };
      if (thinkOverride) {
        next.thinkingLevel = thinkOverride;
      }
      applyVerboseOverride(next, verboseOverride);
      await persistSessionEntry({
        sessionStore,
        sessionKey,
        storePath,
        entry: next,
      });
      sessionEntry = next;
    }

    const provider = opts.provider?.trim() || sessionEntry?.providerOverride?.trim();
    const model = opts.model?.trim() || sessionEntry?.modelOverride?.trim();
    if ((provider || model) && opts.allowModelOverride !== true) {
      throw new Error("Model override is not authorized for this caller.");
    }

    const startedAt = Date.now();
    const runContext = resolveAgentRunContext(opts);
    const messageChannel =
      resolveMessageChannel(runContext.messageChannel, opts.replyChannel ?? opts.channel) ??
      "gateway";
    const effectiveSessionKey = sessionKey ?? sessionId;
    if (!effectiveSessionKey) {
      throw new Error("No active session context.");
    }

    let result: RustAgentRunResult;
    try {
      const request = buildRustAgentCommandRequest({
        runId,
        sessionKey: effectiveSessionKey,
        sessionAgentId,
        body,
        messageChannel,
        accountId: runContext.accountId,
        messageTo: opts.replyTo ?? opts.to,
        threadId: opts.threadId,
        provider,
        model,
        reasoningLevel: resolvedThinkLevel,
        toolsAllow: opts.toolsAllow,
        metadata: {
          sessionId,
          groupId: runContext.groupId,
          groupChannel: runContext.groupChannel,
          groupSpace: runContext.groupSpace,
          spawnedBy: normalizedSpawned.spawnedBy ?? sessionEntry?.spawnedBy,
          currentChannelId: runContext.currentChannelId,
          currentThreadTs: runContext.currentThreadTs,
          replyToMode: runContext.replyToMode,
          senderIsOwner: opts.senderIsOwner,
          workspaceDir,
          lane: opts.lane,
          inputProvenance: opts.inputProvenance,
        },
        options: {
          source: "agent-command",
          deliver: false,
          verboseLevel: resolvedVerboseLevel,
          ...(typeof maxTurns === "number" ? { maxTurns } : {}),
          ...(opts.extraSystemPrompt ? { extraSystemPrompt: opts.extraSystemPrompt } : {}),
          ...(opts.cleanupBundleMcpOnRunEnd === true ? { cleanupBundleMcpOnRunEnd: true } : {}),
        },
      });
      const rawResult = await callGatewayCli({
        method: "agent.command.run",
        params: request,
        timeoutMs,
      });
      result = normalizeRustAgentRunResult(rawResult, startedAt);
      emitAgentEvent({
        runId,
        stream: "lifecycle",
        data: {
          phase: "end",
          startedAt,
          endedAt: Date.now(),
          aborted: result.meta.aborted ?? false,
        },
      });
    } catch (err) {
      emitAgentEvent({
        runId,
        stream: "lifecycle",
        data: {
          phase: "error",
          startedAt,
          endedAt: Date.now(),
          error: String(err),
        },
      });
      throw err;
    }

    const payloads = result.payloads ?? [];
    void cfg;
    void deps;
    void runtime;
    void opts;
    void sessionEntry;
    return { ...result, payloads };
  } finally {
    clearAgentRunContext(runId);
  }
}

export async function agentCommand(
  opts: AgentCommandOpts,
  runtime: RuntimeEnv = defaultRuntime,
  deps: CliDeps = createDefaultDeps(),
) {
  return await runAgentCommandInternal(
    {
      ...opts,
      // agent.command.run is the trusted-operator entrypoint used by CLI/local flows.
      // Ingress callers must opt into owner semantics explicitly via
      // agent.command.runFromIngress so network-facing paths cannot inherit this default by accident.
      senderIsOwner: opts.senderIsOwner ?? true,
      // Local/CLI callers are trusted by default for per-run model overrides.
      allowModelOverride: opts.allowModelOverride ?? true,
    },
    runtime,
    deps,
  );
}

export async function agentCommandFromIngress(
  opts: AgentCommandIngressOpts,
  runtime: RuntimeEnv = defaultRuntime,
  deps: CliDeps = createDefaultDeps(),
) {
  if (typeof opts.senderIsOwner !== "boolean") {
    // HTTP/WS ingress must declare the trust level explicitly at the boundary.
    // This keeps network-facing callers from silently picking up the local trusted default.
    throw new Error("senderIsOwner must be explicitly set for ingress agent runs.");
  }
  if (typeof opts.allowModelOverride !== "boolean") {
    throw new Error("allowModelOverride must be explicitly set for ingress agent runs.");
  }
  return await runAgentCommandInternal(
    {
      ...opts,
      senderIsOwner: opts.senderIsOwner,
      allowModelOverride: opts.allowModelOverride,
    },
    runtime,
    deps,
  );
}
