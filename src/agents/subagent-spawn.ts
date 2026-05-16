import crypto from "node:crypto";
import { promises as fs } from "node:fs";
import { formatThinkingLevels, normalizeThinkLevel } from "../auto-reply/thinking.js";
import { DEFAULT_SUBAGENT_MAX_SPAWN_DEPTH } from "../config/agent-limits.js";
import type { CrawClawConfig } from "../config/config.js";
import {
  isValidAgentId,
  isCronSessionKey,
  normalizeAgentId,
  parseAgentSessionKey,
} from "../routing/session-key.js";
import { emitSessionLifecycleEvent } from "../sessions/session-lifecycle-events.js";
import { normalizeDeliveryContext } from "../utils/delivery-context.js";
import { resolveAgentConfig } from "./agent-scope.js";
import { AGENT_LANE_SUBAGENT } from "./lanes.js";
import { resolveSubagentSpawnModelSelection } from "./model-selection.js";
import {
  mapToolContextToSpawnedRunMetadata,
  normalizeSpawnedRunMetadata,
  resolveSpawnedWorkspaceInheritance,
} from "./spawned-context.js";
import { buildSubagentSystemPrompt } from "./subagent-announce.js";
import {
  decodeStrictBase64,
  materializeSubagentAttachments,
  type SubagentAttachmentReceiptFile,
} from "./subagent-attachments.js";
import { resolveSubagentCapabilities } from "./subagent-capabilities.js";
import { getSubagentDepthFromSessionStore } from "./subagent-depth.js";
import { countActiveRunsForSession, registerSubagentRun } from "./subagent-registry.js";
import {
  __testing as spawnRuntimeTesting,
  callSubagentGateway,
  cleanupFailedSpawnBeforeAgentStart,
  cleanupProvisionalSession,
  ensureThreadBindingForSubagentSpawn,
  loadSubagentConfig,
  persistInitialChildSessionDurableMemoryScope,
  persistInitialChildSessionRuntimeModel,
  readGatewayRunId,
  resolveSpawnMode,
  sanitizeMountPathHint,
  setSubagentSpawnDepsForTest,
  summarizeSpawnError,
} from "./subagents/spawn-runtime.js";
import {
  splitModelRef,
  SUBAGENT_SPAWN_ACCEPTED_NOTE,
  SUBAGENT_SPAWN_MODES,
  SUBAGENT_SPAWN_SESSION_ACCEPTED_NOTE,
  type AllowedSubagentTarget,
  type SpawnSubagentContext,
  type SpawnSubagentMode,
  type SpawnSubagentParams,
  type SpawnSubagentResult,
} from "./subagents/spawn-types.js";
import { readStringParam } from "./tools/common.js";
import {
  resolveDisplaySessionKey,
  resolveInternalSessionKey,
  resolveMainSessionAlias,
} from "./tools/sessions-helpers.js";

export { decodeStrictBase64 };
export {
  splitModelRef,
  SUBAGENT_SPAWN_ACCEPTED_NOTE,
  SUBAGENT_SPAWN_MODES,
  SUBAGENT_SPAWN_SESSION_ACCEPTED_NOTE,
};
export type { SpawnSubagentContext, SpawnSubagentMode, SpawnSubagentParams, SpawnSubagentResult };

type AllowedSubagentTargets = {
  allowAny: boolean;
  allowedAgents: AllowedSubagentTarget[];
};

export function resolveAllowedSubagentTargets(
  cfg: CrawClawConfig,
  requesterAgentId: string,
): AllowedSubagentTargets {
  const allowAgents = resolveAgentConfig(cfg, requesterAgentId)?.subagents?.allowAgents ?? [];
  const allowAny = allowAgents.some((value) => value.trim() === "*");
  const allowSet = new Set(
    allowAgents
      .filter((value) => value.trim() && value.trim() !== "*")
      .map((value) => normalizeAgentId(value)),
  );

  const configuredAgents = Array.isArray(cfg.agents?.list) ? cfg.agents.list : [];
  const configuredIds = configuredAgents.map((entry) => normalizeAgentId(entry.id));
  const configuredIdSet = new Set(configuredIds);
  const configuredNameMap = new Map<string, string>();
  for (const entry of configuredAgents) {
    const name = entry?.name?.trim() ?? "";
    if (!name) {
      continue;
    }
    configuredNameMap.set(normalizeAgentId(entry.id), name);
  }

  const allowed = new Set<string>();
  allowed.add(requesterAgentId);
  if (allowAny) {
    for (const id of configuredIds) {
      allowed.add(id);
    }
  } else {
    for (const id of allowSet) {
      allowed.add(id);
    }
  }

  const rest = Array.from(allowed)
    .filter((id) => id !== requesterAgentId)
    .toSorted((a, b) => a.localeCompare(b));
  const ordered = [requesterAgentId, ...rest];
  return {
    allowAny,
    allowedAgents: ordered.map((id) => ({
      id,
      name: configuredNameMap.get(id),
      configured: configuredIdSet.has(id),
    })),
  };
}

export async function spawnSubagentDirect(
  params: SpawnSubagentParams,
  ctx: SpawnSubagentContext,
): Promise<SpawnSubagentResult> {
  const task = params.task;
  const label = params.label?.trim() || "";
  const explicitSpawnSource = params.spawnSource?.trim();
  const requestedAgentId = params.agentId?.trim();
  const cfg = loadSubagentConfig();
  const { mainKey, alias } = resolveMainSessionAlias(cfg);
  const requesterSessionKey = ctx.agentSessionKey;
  const requesterInternalKey = requesterSessionKey
    ? resolveInternalSessionKey({
        key: requesterSessionKey,
        alias,
        mainKey,
      })
    : alias;
  const requesterDisplayKey = resolveDisplaySessionKey({
    key: requesterInternalKey,
    alias,
    mainKey,
  });
  const requesterAgentId = normalizeAgentId(
    ctx.requesterAgentIdOverride ?? parseAgentSessionKey(requesterInternalKey)?.agentId,
  );
  const allowedTargets = resolveAllowedSubagentTargets(cfg, requesterAgentId);

  // Reject malformed agentId before normalizeAgentId can mangle it.
  // Without this gate, error-message strings like "Agent not found: xyz" pass
  // through normalizeAgentId and become "agent-not-found--xyz", which later
  // creates ghost workspace directories and triggers cascading cron loops (#31311).
  if (requestedAgentId && !isValidAgentId(requestedAgentId)) {
    return {
      status: "error",
      error: `Invalid agentId "${requestedAgentId}". Agent IDs must match [a-z0-9][a-z0-9_-]{0,63}.`,
      allowAny: allowedTargets.allowAny,
      allowedAgents: allowedTargets.allowedAgents,
    };
  }
  const modelOverride = params.model;
  const thinkingOverrideRaw = params.thinking;
  const requestThreadBinding = params.thread === true;
  const spawnMode = resolveSpawnMode({
    requestedMode: params.mode,
    threadRequested: requestThreadBinding,
  });
  if (spawnMode === "session" && !requestThreadBinding) {
    return {
      status: "error",
      error: 'mode="session" requires thread=true so the subagent can stay bound to a thread.',
    };
  }
  const cleanup =
    spawnMode === "session"
      ? "keep"
      : params.cleanup === "keep" || params.cleanup === "delete"
        ? params.cleanup
        : "keep";
  const expectsCompletionMessage = params.expectsCompletionMessage !== false;
  const requesterOrigin = normalizeDeliveryContext({
    channel: ctx.agentChannel,
    accountId: ctx.agentAccountId,
    to: ctx.agentTo,
    threadId: ctx.agentThreadId,
  });
  // When agent omits runTimeoutSeconds, use the config default.
  // Falls back to 0 (no timeout) if config key is also unset,
  // preserving current behavior for existing deployments.
  const cfgSubagentTimeout =
    typeof cfg?.agents?.defaults?.subagents?.runTimeoutSeconds === "number" &&
    Number.isFinite(cfg.agents.defaults.subagents.runTimeoutSeconds)
      ? Math.max(0, Math.floor(cfg.agents.defaults.subagents.runTimeoutSeconds))
      : 0;
  const runTimeoutSeconds =
    typeof params.runTimeoutSeconds === "number" && Number.isFinite(params.runTimeoutSeconds)
      ? Math.max(0, Math.floor(params.runTimeoutSeconds))
      : cfgSubagentTimeout;
  const maxTurns =
    typeof params.maxTurns === "number" && Number.isFinite(params.maxTurns) && params.maxTurns > 0
      ? Math.max(1, Math.floor(params.maxTurns))
      : undefined;
  let modelApplied = false;
  let threadBindingReady = false;
  const callerDepth = getSubagentDepthFromSessionStore(requesterInternalKey, { cfg });
  const maxSpawnDepth =
    cfg.agents?.defaults?.subagents?.maxSpawnDepth ?? DEFAULT_SUBAGENT_MAX_SPAWN_DEPTH;
  if (callerDepth >= maxSpawnDepth) {
    return {
      status: "forbidden",
      error: `sessions_spawn is not allowed at this depth (current depth: ${callerDepth}, max: ${maxSpawnDepth})`,
    };
  }

  const maxChildren = cfg.agents?.defaults?.subagents?.maxChildrenPerAgent ?? 5;
  const activeChildren = countActiveRunsForSession(requesterInternalKey);
  if (activeChildren >= maxChildren) {
    return {
      status: "forbidden",
      error: `sessions_spawn has reached max active children for this session (${activeChildren}/${maxChildren})`,
    };
  }

  const requireAgentId =
    resolveAgentConfig(cfg, requesterAgentId)?.subagents?.requireAgentId ??
    cfg.agents?.defaults?.subagents?.requireAgentId ??
    false;
  if (requireAgentId && !requestedAgentId?.trim()) {
    return {
      status: "forbidden",
      error: "sessions_spawn requires explicit agentId when requireAgentId is configured.",
      allowAny: allowedTargets.allowAny,
      allowedAgents: allowedTargets.allowedAgents,
    };
  }
  const targetAgentId = requestedAgentId ? normalizeAgentId(requestedAgentId) : requesterAgentId;
  if (targetAgentId !== requesterAgentId) {
    const normalizedTargetId = targetAgentId.toLowerCase();
    const allowedSet = new Set(allowedTargets.allowedAgents.map((agent) => agent.id.toLowerCase()));
    if (!allowedTargets.allowAny && !allowedSet.has(normalizedTargetId)) {
      const allowedText = allowedTargets.allowedAgents.map((agent) => agent.id).join(", ");
      return {
        status: "forbidden",
        error: `agentId is not allowed for sessions_spawn (allowed: ${allowedText})`,
        allowAny: allowedTargets.allowAny,
        allowedAgents: allowedTargets.allowedAgents,
      };
    }
  }
  const childSessionKey = `agent:${targetAgentId}:subagent:${crypto.randomUUID()}`;
  const childDepth = callerDepth + 1;
  const spawnedByKey = requesterInternalKey;
  const childCapabilities = resolveSubagentCapabilities({
    depth: childDepth,
    maxSpawnDepth,
  });
  const targetAgentConfig = resolveAgentConfig(cfg, targetAgentId);
  const resolvedModel = resolveSubagentSpawnModelSelection({
    cfg,
    agentId: targetAgentId,
    modelOverride,
  });

  const resolvedThinkingDefaultRaw =
    readStringParam(targetAgentConfig?.subagents ?? {}, "thinking") ??
    readStringParam(cfg.agents?.defaults?.subagents ?? {}, "thinking");

  let thinkingOverride: string | undefined;
  const thinkingCandidateRaw = thinkingOverrideRaw || resolvedThinkingDefaultRaw;
  if (thinkingCandidateRaw) {
    const normalized = normalizeThinkLevel(thinkingCandidateRaw);
    if (!normalized) {
      const { provider, model } = splitModelRef(resolvedModel);
      const hint = formatThinkingLevels(provider, model);
      return {
        status: "error",
        error: `Invalid thinking level "${thinkingCandidateRaw}". Use one of: ${hint}.`,
      };
    }
    thinkingOverride = normalized;
  }
  const patchChildSession = async (patch: Record<string, unknown>): Promise<string | undefined> => {
    try {
      await callSubagentGateway({
        method: "sessions.patch",
        params: { key: childSessionKey, ...patch },
        timeoutMs: 10_000,
      });
      return undefined;
    } catch (err) {
      return err instanceof Error ? err.message : typeof err === "string" ? err : "error";
    }
  };

  const initialChildSessionPatch: Record<string, unknown> = {
    spawnDepth: childDepth,
    subagentRole: childCapabilities.role === "main" ? null : childCapabilities.role,
    subagentControlScope: childCapabilities.controlScope,
    ...(explicitSpawnSource ? { spawnSource: explicitSpawnSource } : {}),
  };
  if (resolvedModel) {
    initialChildSessionPatch.model = resolvedModel;
  }
  if (thinkingOverride !== undefined) {
    initialChildSessionPatch.thinkingLevel = thinkingOverride === "off" ? null : thinkingOverride;
  }

  const initialPatchError = await patchChildSession(initialChildSessionPatch);
  if (initialPatchError) {
    return {
      status: "error",
      error: initialPatchError,
      childSessionKey,
    };
  }
  const durableMemoryScopePersistError = await persistInitialChildSessionDurableMemoryScope({
    cfg,
    childSessionKey,
    durableMemoryScope: params.durableMemoryScope,
  });
  if (durableMemoryScopePersistError) {
    try {
      await callSubagentGateway({
        method: "sessions.delete",
        params: { key: childSessionKey, emitLifecycleHooks: false },
        timeoutMs: 10_000,
      });
    } catch {
      // Best-effort cleanup only.
    }
    return {
      status: "error",
      error: durableMemoryScopePersistError,
      childSessionKey,
    };
  }
  if (resolvedModel) {
    const runtimeModelPersistError = await persistInitialChildSessionRuntimeModel({
      cfg,
      childSessionKey,
      resolvedModel,
    });
    if (runtimeModelPersistError) {
      try {
        await callSubagentGateway({
          method: "sessions.delete",
          params: { key: childSessionKey, emitLifecycleHooks: false },
          timeoutMs: 10_000,
        });
      } catch {
        // Best-effort cleanup only.
      }
      return {
        status: "error",
        error: runtimeModelPersistError,
        childSessionKey,
      };
    }
    modelApplied = true;
  }
  if (requestThreadBinding) {
    const bindResult = await ensureThreadBindingForSubagentSpawn({
      childSessionKey,
      agentId: targetAgentId,
      label: label || undefined,
      mode: spawnMode,
      requesterSessionKey: requesterInternalKey,
      requester: {
        channel: requesterOrigin?.channel,
        accountId: requesterOrigin?.accountId,
        to: requesterOrigin?.to,
        threadId: requesterOrigin?.threadId,
      },
    });
    if (bindResult.status === "error") {
      try {
        await callSubagentGateway({
          method: "sessions.delete",
          params: { key: childSessionKey, emitLifecycleHooks: false },
          timeoutMs: 10_000,
        });
      } catch {
        // Best-effort cleanup only.
      }
      return {
        status: "error",
        error: bindResult.error,
        childSessionKey,
      };
    }
    threadBindingReady = true;
  }
  const mountPathHint = sanitizeMountPathHint(params.attachMountPath);

  let childSystemPrompt = buildSubagentSystemPrompt({
    requesterSessionKey,
    requesterOrigin,
    childSessionKey,
    label: label || undefined,
    task,
    acpEnabled: cfg.acp?.enabled !== false,
    childDepth,
    maxSpawnDepth,
  });
  const extraSystemPrompt = params.extraSystemPrompt?.trim();
  if (extraSystemPrompt) {
    childSystemPrompt = `${childSystemPrompt}\n\n${extraSystemPrompt}`;
  }

  let retainOnSessionKeep = false;
  let attachmentsReceipt:
    | {
        count: number;
        totalBytes: number;
        files: SubagentAttachmentReceiptFile[];
        relDir: string;
      }
    | undefined;
  let attachmentAbsDir: string | undefined;
  let attachmentRootDir: string | undefined;
  const materializedAttachments = await materializeSubagentAttachments({
    config: cfg,
    targetAgentId,
    attachments: params.attachments,
    mountPathHint,
  });
  if (materializedAttachments && materializedAttachments.status !== "ok") {
    await cleanupProvisionalSession(childSessionKey, {
      emitLifecycleHooks: threadBindingReady,
      deleteTranscript: true,
    });
    return {
      status: materializedAttachments.status,
      error: materializedAttachments.error,
    };
  }
  if (materializedAttachments?.status === "ok") {
    retainOnSessionKeep = materializedAttachments.retainOnSessionKeep;
    attachmentsReceipt = materializedAttachments.receipt;
    attachmentAbsDir = materializedAttachments.absDir;
    attachmentRootDir = materializedAttachments.rootDir;
    childSystemPrompt = `${childSystemPrompt}\n\n${materializedAttachments.systemPromptSuffix}`;
  }

  const childTaskMessage = [
    `[Subagent Context] You are running as a subagent (depth ${childDepth}/${maxSpawnDepth}). Results auto-announce to your requester; do not busy-poll for status.`,
    spawnMode === "session"
      ? "[Subagent Context] This subagent session is persistent and remains available for thread follow-up messages."
      : undefined,
    `[Subagent Task]: ${task}`,
  ]
    .filter((line): line is string => Boolean(line))
    .join("\n\n");

  const toolSpawnMetadata = mapToolContextToSpawnedRunMetadata({
    agentGroupId: ctx.agentGroupId,
    agentGroupChannel: ctx.agentGroupChannel,
    agentGroupSpace: ctx.agentGroupSpace,
    workspaceDir: ctx.workspaceDir,
  });
  const spawnedMetadata = normalizeSpawnedRunMetadata({
    spawnedBy: spawnedByKey,
    ...toolSpawnMetadata,
    workspaceDir: resolveSpawnedWorkspaceInheritance({
      config: cfg,
      targetAgentId,
      // For cross-agent spawns, ignore the caller's inherited workspace;
      // let targetAgentId resolve the correct workspace instead.
      explicitWorkspaceDir:
        targetAgentId !== requesterAgentId ? undefined : toolSpawnMetadata.workspaceDir,
    }),
  });
  const spawnLineagePatchError = await patchChildSession({
    spawnedBy: spawnedByKey,
    ...(spawnedMetadata.workspaceDir ? { spawnedWorkspaceDir: spawnedMetadata.workspaceDir } : {}),
  });
  if (spawnLineagePatchError) {
    await cleanupFailedSpawnBeforeAgentStart({
      childSessionKey,
      attachmentAbsDir,
      emitLifecycleHooks: threadBindingReady,
      deleteTranscript: true,
    });
    return {
      status: "error",
      error: spawnLineagePatchError,
      childSessionKey,
    };
  }

  const childIdem = crypto.randomUUID();
  let childRunId: string = childIdem;
  try {
    const {
      spawnedBy: _spawnedBy,
      workspaceDir: _workspaceDir,
      ...publicSpawnedMetadata
    } = spawnedMetadata;
    const response = await callSubagentGateway({
      method: "agent.command.run",
      params: {
        message: childTaskMessage,
        sessionKey: childSessionKey,
        channel: requesterOrigin?.channel,
        to: requesterOrigin?.to ?? undefined,
        accountId: requesterOrigin?.accountId ?? undefined,
        threadId: requesterOrigin?.threadId != null ? String(requesterOrigin.threadId) : undefined,
        idempotencyKey: childIdem,
        deliver: false,
        lane: AGENT_LANE_SUBAGENT,
        extraSystemPrompt: childSystemPrompt,
        thinking: thinkingOverride,
        timeout: runTimeoutSeconds,
        ...(typeof maxTurns === "number" ? { maxTurns } : {}),
        ...(params.streamParams ? { streamParams: params.streamParams } : {}),
        label: explicitSpawnSource ? undefined : label || undefined,
        ...publicSpawnedMetadata,
      },
      timeoutMs: 10_000,
    });
    const runId = readGatewayRunId(response);
    if (runId) {
      childRunId = runId;
    }
  } catch (err) {
    if (attachmentAbsDir) {
      try {
        await fs.rm(attachmentAbsDir, { recursive: true, force: true });
      } catch {
        // Best-effort cleanup only.
      }
    }
    const emitLifecycleHooks = threadBindingReady;
    // Always delete the provisional child session after a failed spawn attempt.
    try {
      await callSubagentGateway({
        method: "sessions.delete",
        params: {
          key: childSessionKey,
          deleteTranscript: true,
          emitLifecycleHooks,
        },
        timeoutMs: 10_000,
      });
    } catch {
      // Best-effort only.
    }
    const messageText = summarizeSpawnError(err);
    return {
      status: "error",
      error: messageText,
      childSessionKey,
      runId: childRunId,
    };
  }

  try {
    registerSubagentRun({
      runId: childRunId,
      childSessionKey,
      controllerSessionKey: requesterInternalKey,
      requesterSessionKey: requesterInternalKey,
      requesterOrigin,
      requesterDisplayKey,
      task,
      cleanup,
      label: label || undefined,
      model: resolvedModel,
      workspaceDir: spawnedMetadata.workspaceDir,
      runTimeoutSeconds,
      spawnSource: explicitSpawnSource || "sessions_spawn",
      expectsCompletionMessage,
      spawnMode,
      attachmentsDir: attachmentAbsDir,
      attachmentsRootDir: attachmentRootDir,
      retainAttachmentsOnKeep: retainOnSessionKeep,
    });
  } catch (err) {
    if (attachmentAbsDir) {
      try {
        await fs.rm(attachmentAbsDir, { recursive: true, force: true });
      } catch {
        // Best-effort cleanup only.
      }
    }
    try {
      await callSubagentGateway({
        method: "sessions.delete",
        params: {
          key: childSessionKey,
          deleteTranscript: true,
          emitLifecycleHooks: threadBindingReady,
        },
        timeoutMs: 10_000,
      });
    } catch {
      // Best-effort cleanup only.
    }
    return {
      status: "error",
      error: `Failed to register subagent run: ${summarizeSpawnError(err)}`,
      childSessionKey,
      runId: childRunId,
    };
  }

  // Emit lifecycle event so the gateway can broadcast sessions.changed to SSE subscribers.
  emitSessionLifecycleEvent({
    sessionKey: childSessionKey,
    reason: "create",
    parentSessionKey: requesterInternalKey,
    label: label || undefined,
  });

  // Check if we're in a cron isolated session - don't add "do not poll" note
  // because cron sessions end immediately after the agent produces a response,
  // so the agent needs to wait for subagent results to keep the turn alive.
  const isCronSession = isCronSessionKey(ctx.agentSessionKey);
  const note =
    spawnMode === "session"
      ? SUBAGENT_SPAWN_SESSION_ACCEPTED_NOTE
      : isCronSession
        ? undefined
        : SUBAGENT_SPAWN_ACCEPTED_NOTE;

  return {
    status: "accepted",
    childSessionKey,
    runId: childRunId,
    mode: spawnMode,
    note,
    modelApplied: resolvedModel ? modelApplied : undefined,
    attachments: attachmentsReceipt,
  };
}

export const __testing = {
  setDepsForTest(overrides?: Parameters<typeof setSubagentSpawnDepsForTest>[0]) {
    setSubagentSpawnDepsForTest(overrides);
  },
  ...spawnRuntimeTesting,
};
