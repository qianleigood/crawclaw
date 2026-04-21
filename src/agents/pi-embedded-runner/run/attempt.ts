import fs from "node:fs/promises";
import os from "node:os";
import type { AgentMessage, StreamFn } from "@mariozechner/pi-agent-core";
import { streamSimple } from "@mariozechner/pi-ai";
import {
  createAgentSession,
  DefaultResourceLoader,
  SessionManager,
} from "@mariozechner/pi-coding-agent";
import { resolveHeartbeatPrompt } from "../../../auto-reply/heartbeat.js";
import type { ReasoningLevel, ThinkLevel, VerboseLevel } from "../../../auto-reply/thinking.js";
import { resolveChannelCapabilities } from "../../../config/channel-capabilities.js";
import { getMachineDisplayName } from "../../../infra/machine-name.js";
import {
  ensureGlobalUndiciEnvProxyDispatcher,
  ensureGlobalUndiciStreamTimeouts,
} from "../../../infra/net/undici-global-dispatcher.js";
import { MAX_IMAGE_BYTES } from "../../../media/constants.js";
import {
  isOllamaCompatProvider,
  resolveOllamaCompatNumCtxEnabled,
  shouldInjectOllamaCompatNumCtx,
  wrapOllamaCompatNumCtx,
} from "../../../plugin-sdk/ollama.js";
import { getGlobalHookRunner } from "../../../plugins/hook-runner-global.js";
import { resolveToolCallArgumentsEncoding } from "../../../plugins/provider-model-compat.js";
import { isSubagentSessionKey } from "../../../routing/session-key.js";
import { resolvePromptCacheDecisionCodes } from "../../../shared/decision-codes.js";
import { buildTtsSystemPromptHint } from "../../../tts/tts.js";
import { resolveUserPath } from "../../../utils.js";
import { normalizeMessageChannel } from "../../../utils/message-channel.js";
import { isReasoningTagProvider } from "../../../utils/provider-utils.js";
import { resolveCrawClawAgentDir } from "../../agent-paths.js";
import { resolveSessionAgentIds } from "../../agent-scope.js";
import { createAnthropicPayloadLogger } from "../../anthropic-payload-log.js";
import { createAnthropicVertexStreamFnForModel } from "../../anthropic-vertex-stream.js";
import {
  analyzeBootstrapBudget,
  buildBootstrapPromptWarning,
  buildBootstrapTruncationReportMeta,
  buildBootstrapInjectionStats,
  appendBootstrapPromptWarning,
} from "../../bootstrap-budget.js";
import { makeBootstrapWarn, resolveBootstrapContextForRun } from "../../bootstrap-files.js";
import { createCacheTrace } from "../../cache-trace.js";
import {
  listChannelSupportedActions,
  resolveChannelMessageToolCapabilities,
  resolveChannelMessageToolHints,
  resolveChannelReactionGuidance,
} from "../../channel-tools.js";
import { captureModelVisibleContext } from "../../context-archive/turn-capture.js";
import { DEFAULT_CONTEXT_TOKENS } from "../../defaults.js";
import { resolveCrawClawDocsPath } from "../../docs-path.js";
import { isTimeoutError } from "../../failover-error.js";
import { resolveImageSanitizationLimits } from "../../image-sanitization.js";
import { buildModelAliasLines } from "../../model-alias-lines.js";
import { resolveModelAuthMode } from "../../model-auth.js";
import { resolveDefaultModelForAgent } from "../../model-selection.js";
import { supportsModelTools } from "../../model-tool-support.js";
import { createOpenAIWebSocketStreamFn, releaseWsSession } from "../../openai-ws-stream.js";
import { resolveOwnerDisplaySetting } from "../../owner-display.js";
import { createBundleLspToolRuntime } from "../../pi-bundle-lsp-runtime.js";
import {
  getOrCreateSessionMcpRuntime,
  materializeBundleMcpToolsForRun,
} from "../../pi-bundle-mcp-tools.js";
import {
  downgradeOpenAIFunctionCallReasoningPairs,
  isCloudCodeAssistFormatError,
  resolveBootstrapMaxChars,
  resolveBootstrapPromptTruncationWarningMode,
  resolveBootstrapTotalMaxChars,
} from "../../pi-embedded-helpers.js";
import { subscribeEmbeddedPiSession } from "../../pi-embedded-subscribe.js";
import { createPreparedEmbeddedPiSettingsManager } from "../../pi-project-settings.js";
import { applyPiAutoCompactionGuard } from "../../pi-settings.js";
import { toClientToolDefinitions } from "../../pi-tool-definition-adapter.js";
import { createCrawClawCodingTools, resolveToolLoopDetectionConfig } from "../../pi-tools.js";
import { registerProviderStreamForModel } from "../../provider-stream.js";
import {
  applyQueryContextPatch,
  buildQueryContextProviderRequest,
  createQueryContextToolContext,
  materializeQueryContextProviderRequest,
} from "../../query-context/render.js";
import type {
  QueryContext,
  QueryContextDiagnostics,
  QueryContextProviderRequest,
  QueryContextProviderRequestSnapshot,
} from "../../query-context/types.js";
import { resolveSandboxContext } from "../../sandbox.js";
import { resolveSandboxRuntimeStatus } from "../../sandbox/runtime-status.js";
import { repairSessionFileIfNeeded } from "../../session-file-repair.js";
import { guardSessionManager } from "../../session-tool-result-guard-wrapper.js";
import { sanitizeToolUseResultPairing } from "../../session-transcript-repair.js";
import {
  acquireSessionWriteLock,
  resolveSessionLockMaxHoldFromTimeout,
} from "../../session-write-lock.js";
import { detectRuntimeShell } from "../../shell-utils.js";
import {
  applySkillEnvOverrides,
  applySkillEnvOverridesFromSnapshot,
  resolveSkillsPromptForRun,
} from "../../skills.js";
import { getSkillExposureState } from "../../skills/exposure-state.js";
import { buildSpecialAgentParentForkContextFromModelInput } from "../../special/runtime/parent-fork-context.js";
import { buildSystemPromptParams } from "../../system-prompt-params.js";
import { buildSystemPromptReport } from "../../system-prompt-report.js";
import { sanitizeToolCallIdsForCloudCodeAssist } from "../../tool-call-id.js";
import { resolveTranscriptPolicy } from "../../transcript-policy.js";
import { DEFAULT_BOOTSTRAP_FILENAME } from "../../workspace.js";
import { isRunnerAbortError } from "../abort.js";
import { isCacheTtlEligibleProvider } from "../cache-ttl.js";
import { resolveCompactionTimeoutMs } from "../compaction-safety-timeout.js";
import { buildEmbeddedExtensionFactories } from "../extensions.js";
import { applyExtraParamsToAgent, resolveAgentTransportOverride } from "../extra-params.js";
import {
  logToolSchemasForGoogle,
  sanitizeSessionHistory,
  sanitizeToolsForGoogle,
  validateReplayTurns,
} from "../google.js";
import { getHistoryLimitFromSessionKey, limitHistoryTurns } from "../history.js";
import { log as embeddedAttemptLog } from "../logger.js";
import { runMemoryRuntimeMaintenance } from "../memory-runtime-maintenance.js";
import { buildEmbeddedMessageActionDiscoveryInput } from "../message-action-discovery-input.js";
import {
  clearActiveEmbeddedRun,
  type EmbeddedPiQueueHandle,
  setActiveEmbeddedRun,
  updateActiveEmbeddedRunSnapshot,
} from "../runs.js";
import { buildEmbeddedSandboxInfo } from "../sandbox-info.js";
import { prewarmSessionFile, trackSessionManagerAccess } from "../session-manager-cache.js";
import { prepareSessionManagerForRun } from "../session-manager-init.js";
import { resolveEmbeddedRunSkillEntries } from "../skills-runtime.js";
import {
  applySystemPromptOverrideToSession,
  buildEmbeddedSystemPromptSections,
} from "../system-prompt.js";
import {
  dropThinkingBlocks,
  sanitizeThinkingForRecovery,
  wrapAnthropicStreamWithRecovery,
} from "../thinking.js";
import { collectAllowedToolNames } from "../tool-name-allowlist.js";
import { installToolResultContextGuard } from "../tool-result-context-guard.js";
import { splitSdkTools } from "../tool-split.js";
import { describeUnknownError, mapThinkingLevel } from "../utils.js";
import { flushPendingToolResultsAfterIdle } from "../wait-for-idle-before-flush.js";
import {
  assembleAttemptMemoryRuntime,
  finalizeAttemptMemoryRuntimeTurn,
  runAttemptMemoryRuntimeBootstrap,
} from "./attempt.memory-runtime-helpers.js";
import { wrapStreamFnConvertMinimaxXmlToolCalls } from "./attempt.minimax-tool-call-xml.js";
import {
  buildAfterTurnRuntimeContext,
  buildAvailableSkillsForHook,
  resolveAttemptFsWorkspaceOnly,
  resolvePromptBuildHookResult,
  resolveSurfacedSkillsHookResult,
  resolvePromptModeForSession,
  shouldTriggerSkillDiscovery,
  shouldInjectHeartbeatPrompt,
} from "./attempt.prompt-helpers.js";
import { wrapStreamFnWithProviderLifecycle } from "./attempt.provider-lifecycle.js";
import { wrapStreamFnWithQueryContextBoundary } from "./attempt.query-context-boundary.js";
import {
  createYieldAbortedResponse,
  persistSessionsYieldContextMessage,
  queueSessionsYieldInterruptMessage,
  stripSessionsYieldArtifacts,
  waitForSessionsYieldAbortSettle,
} from "./attempt.sessions-yield.js";
import { wrapStreamFnHandleSensitiveStopReason } from "./attempt.stop-reason-recovery.js";
import {
  appendAttemptCacheTtlIfNeeded,
  resolveAttemptSpawnWorkspaceDir,
  shouldUseOpenAIWebSocketTransport,
} from "./attempt.thread-helpers.js";
import {
  shouldRepairMalformedAnthropicToolCallArguments,
  wrapStreamFnDecodeXaiToolCallArguments,
  wrapStreamFnRepairMalformedToolCallArguments,
} from "./attempt.tool-call-argument-repair.js";
import {
  wrapStreamFnSanitizeMalformedToolCalls,
  wrapStreamFnTrimToolCallNames,
} from "./attempt.tool-call-normalization.js";
import { waitForCompactionRetryWithAggregateTimeout } from "./compaction-retry-aggregate-timeout.js";
import {
  resolveRunTimeoutDuringCompaction,
  resolveRunTimeoutWithCompactionGraceMs,
  selectCompactionTimeoutSnapshot,
  shouldFlagCompactionTimeout,
} from "./compaction-timeout.js";
import { pruneProcessedHistoryImages } from "./history-image-prune.js";
import { detectAndLoadPromptImages } from "./images.js";
import { resolveLlmIdleTimeoutMs, streamWithIdleTimeout } from "./llm-idle-timeout.js";
import type { EmbeddedRunAttemptParams, EmbeddedRunAttemptResult } from "./types.js";

export {
  appendAttemptCacheTtlIfNeeded,
  resolveAttemptSpawnWorkspaceDir,
} from "./attempt.thread-helpers.js";
export {
  buildAfterTurnRuntimeContext,
  resolveAttemptFsWorkspaceOnly,
  resolvePromptBuildHookResult,
  resolveSurfacedSkillsHookResult,
  resolvePromptModeForSession,
  shouldTriggerSkillDiscovery,
  shouldInjectHeartbeatPrompt,
} from "./attempt.prompt-helpers.js";
export {
  buildSessionsYieldContextMessage,
  persistSessionsYieldContextMessage,
  queueSessionsYieldInterruptMessage,
  stripSessionsYieldArtifacts,
} from "./attempt.sessions-yield.js";
export {
  isOllamaCompatProvider,
  resolveOllamaCompatNumCtxEnabled,
  shouldInjectOllamaCompatNumCtx,
  wrapOllamaCompatNumCtx,
} from "../../../plugin-sdk/ollama.js";
export {
  decodeHtmlEntitiesInObject,
  wrapStreamFnRepairMalformedToolCallArguments,
} from "./attempt.tool-call-argument-repair.js";
export {
  wrapStreamFnSanitizeMalformedToolCalls,
  wrapStreamFnTrimToolCallNames,
} from "./attempt.tool-call-normalization.js";
export { convertMinimaxXmlToolCallsInMessage } from "./attempt.minimax-tool-call-xml.js";

const MAX_BTW_SNAPSHOT_MESSAGES = 100;
const DURABLE_MEMORY_TOOL_ALLOWLIST = new Set([
  "memory_manifest_read",
  "memory_note_read",
  "memory_note_write",
  "memory_note_edit",
  "memory_note_delete",
]);

function shouldUseMinimalPromptForAllowedTools(toolsAllow?: string[]): boolean {
  if (!toolsAllow?.length) {
    return false;
  }
  return !toolsAllow.some((toolName) => DURABLE_MEMORY_TOOL_ALLOWLIST.has(toolName));
}

function shouldEnableAnthropicThinkingRecovery(api: string | null | undefined): boolean {
  return api === "anthropic-messages" || api === "bedrock-converse-stream";
}

function buildParentPromptEmbeddedSystemPrompt(params: {
  parentSystemPromptText: string;
  extraSystemPrompt?: string;
}): string {
  const parent = params.parentSystemPromptText.trim();
  const extra = params.extraSystemPrompt?.trim();
  if (!extra) {
    return parent;
  }
  if (!parent) {
    return extra;
  }
  return `${parent}\n\n${extra}`;
}

function extractParentPromptToolNames(
  envelope:
    | {
        toolInventoryDigest?: { toolNames?: string[] };
        toolPromptPayload?: unknown[];
      }
    | undefined,
): string[] | undefined {
  const digestNames = Array.isArray(envelope?.toolInventoryDigest?.toolNames)
    ? envelope.toolInventoryDigest.toolNames
    : undefined;
  if (digestNames?.length) {
    return [...new Set(digestNames.map((name) => name.trim()).filter(Boolean))];
  }
  const payloadNames = Array.isArray(envelope?.toolPromptPayload)
    ? envelope.toolPromptPayload
        .map((entry) =>
          entry &&
          typeof entry === "object" &&
          typeof (entry as { name?: unknown }).name === "string"
            ? ((entry as { name: string }).name.trim() ?? "")
            : "",
        )
        .filter(Boolean)
    : [];
  return payloadNames.length ? [...new Set(payloadNames)] : undefined;
}

function resolveParentPromptThinkingConfig(params: {
  parent?: Record<string, unknown>;
  thinkLevel?: ThinkLevel;
  reasoningLevel?: ReasoningLevel;
  verboseLevel?: VerboseLevel;
  fastMode?: boolean;
}): {
  thinkLevel?: ThinkLevel;
  reasoningLevel?: ReasoningLevel;
  verboseLevel?: VerboseLevel;
  fastMode?: boolean;
} {
  const parent = params.parent;
  const parentThinkLevel =
    typeof parent?.thinkLevel === "string" ? (parent.thinkLevel as ThinkLevel) : undefined;
  const parentReasoningLevel =
    typeof parent?.reasoningLevel === "string"
      ? (parent.reasoningLevel as ReasoningLevel)
      : undefined;
  const parentVerboseLevel =
    typeof parent?.verboseLevel === "string" ? (parent.verboseLevel as VerboseLevel) : undefined;
  const parentFastMode = typeof parent?.fastMode === "boolean" ? parent.fastMode : undefined;
  return {
    thinkLevel: params.thinkLevel ?? parentThinkLevel,
    reasoningLevel: params.reasoningLevel ?? parentReasoningLevel,
    verboseLevel: params.verboseLevel ?? parentVerboseLevel,
    fastMode: params.fastMode ?? parentFastMode,
  };
}

type SessionToolCarrier<TTool extends { name: string }> = {
  agent: {
    state?: {
      tools?: Array<{ name?: string }>;
    };
    setTools?: (tools: TTool[]) => void;
  };
  setActiveToolsByName?: (toolNames: string[]) => void;
};

export function ensureAllowedToolsActiveInSession<TTool extends { name: string }>(params: {
  session: SessionToolCarrier<TTool>;
  toolsAllow?: string[];
  effectiveTools: TTool[];
}): {
  expectedToolNames: string[];
  missingBefore: string[];
  missingAfter: string[];
  usedDirectRuntimeRegistration: boolean;
} {
  const allowSet = params.toolsAllow?.length ? new Set(params.toolsAllow) : null;
  const expectedTools = allowSet
    ? params.effectiveTools.filter((tool) => allowSet.has(tool.name))
    : params.effectiveTools;
  const expectedToolNames = expectedTools.map((tool) => tool.name);
  const readActiveToolNames = () =>
    (params.session.agent.state?.tools ?? [])
      .map((tool) => (typeof tool?.name === "string" ? tool.name.trim() : ""))
      .filter((name) => name.length > 0);
  const findMissing = (activeNames: string[]) => {
    const activeSet = new Set(activeNames);
    return expectedToolNames.filter((name) => !activeSet.has(name));
  };

  const missingBefore = findMissing(readActiveToolNames());
  if (missingBefore.length === 0) {
    return {
      expectedToolNames,
      missingBefore,
      missingAfter: [],
      usedDirectRuntimeRegistration: false,
    };
  }

  params.session.setActiveToolsByName?.(expectedToolNames);
  let missingAfter = findMissing(readActiveToolNames());
  let usedDirectRuntimeRegistration = false;

  // Keep the session registry in sync for prompt/tool metadata, then force the
  // runtime agent tool list to the exact CrawClaw tool objects for deterministic
  // allowlisted execution. createAgentSession({ tools }) only enables SDK built-ins,
  // so CrawClaw-owned tools must remain custom tools and be pushed into agent.state.tools here.
  if (params.session.agent.setTools) {
    params.session.agent.setTools(expectedTools);
    missingAfter = findMissing(readActiveToolNames());
    usedDirectRuntimeRegistration = true;
  }

  return {
    expectedToolNames,
    missingBefore,
    missingAfter,
    usedDirectRuntimeRegistration,
  };
}

function resolveEffectiveToolsAllow(params: {
  toolsAllow?: string[];
  parentPromptToolNames?: string[];
  specialAgentSpawnSource?: string;
}): string[] | undefined {
  if (params.toolsAllow && params.toolsAllow.length > 0) {
    return params.toolsAllow;
  }
  // Embedded special-agent runs must preserve their current tool inventory.
  // Falling back to the parent run's tool names can strip the
  // dedicated special-agent tools (for example memory_note_*), which makes the
  // child think those tools do not exist.
  if (params.specialAgentSpawnSource?.trim()) {
    return undefined;
  }
  if (params.parentPromptToolNames && params.parentPromptToolNames.length > 0) {
    return params.parentPromptToolNames;
  }
  return undefined;
}

(
  ensureAllowedToolsActiveInSession as typeof ensureAllowedToolsActiveInSession & {
    __test_resolveEffectiveToolsAllow?: typeof resolveEffectiveToolsAllow;
  }
).__test_resolveEffectiveToolsAllow = resolveEffectiveToolsAllow;

function buildToolInventorySignature(tools: Array<{ name?: string }>): string {
  return tools
    .map((tool) => (typeof tool?.name === "string" ? tool.name.trim() : ""))
    .filter(Boolean)
    .toSorted()
    .join("\u0000");
}

function replaceSetContents(target: Set<string>, nextValues: Set<string>): void {
  target.clear();
  for (const value of nextValues) {
    target.add(value);
  }
}

export function resolveEmbeddedAgentStreamFn(params: {
  currentStreamFn: StreamFn | undefined;
  providerStreamFn?: StreamFn;
  shouldUseWebSocketTransport: boolean;
  wsApiKey?: string;
  sessionId: string;
  signal?: AbortSignal;
  model: EmbeddedRunAttemptParams["model"];
  authStorage?: { getApiKey(provider: string): Promise<string | undefined> };
}): StreamFn {
  if (params.providerStreamFn) {
    const inner = params.providerStreamFn;
    // The default pi-coding-agent streamFn injects apiKey from authStorage
    // into options via modelRegistry.getApiKeyAndHeaders(). Provider-supplied
    // stream functions bypass that default, so we replicate the injection here
    // so the resolved credential reaches the provider's HTTP layer.
    if (params.authStorage) {
      const { authStorage, model } = params;
      return async (m, context, options) => {
        const apiKey = await authStorage.getApiKey(model.provider);
        return inner(m, context, { ...options, apiKey: apiKey ?? options?.apiKey });
      };
    }
    return inner;
  }

  const currentStreamFn = params.currentStreamFn ?? streamSimple;
  if (params.shouldUseWebSocketTransport) {
    return params.wsApiKey
      ? createOpenAIWebSocketStreamFn(params.wsApiKey, params.sessionId, {
          signal: params.signal,
        })
      : currentStreamFn;
  }

  if (params.model.provider === "anthropic-vertex") {
    return createAnthropicVertexStreamFnForModel(params.model);
  }

  return currentStreamFn;
}

function summarizeMessagePayload(msg: AgentMessage): { textChars: number; imageBlocks: number } {
  const content = (msg as { content?: unknown }).content;
  if (typeof content === "string") {
    return { textChars: content.length, imageBlocks: 0 };
  }
  if (!Array.isArray(content)) {
    return { textChars: 0, imageBlocks: 0 };
  }

  let textChars = 0;
  let imageBlocks = 0;
  for (const block of content) {
    if (!block || typeof block !== "object") {
      continue;
    }
    const typedBlock = block as { type?: unknown; text?: unknown };
    if (typedBlock.type === "image") {
      imageBlocks++;
      continue;
    }
    if (typeof typedBlock.text === "string") {
      textChars += typedBlock.text.length;
    }
  }

  return { textChars, imageBlocks };
}

function summarizeSessionContext(messages: AgentMessage[]): {
  roleCounts: string;
  totalTextChars: number;
  totalImageBlocks: number;
  maxMessageTextChars: number;
} {
  const roleCounts = new Map<string, number>();
  let totalTextChars = 0;
  let totalImageBlocks = 0;
  let maxMessageTextChars = 0;

  for (const msg of messages) {
    const role = typeof msg.role === "string" ? msg.role : "unknown";
    roleCounts.set(role, (roleCounts.get(role) ?? 0) + 1);

    const payload = summarizeMessagePayload(msg);
    totalTextChars += payload.textChars;
    totalImageBlocks += payload.imageBlocks;
    if (payload.textChars > maxMessageTextChars) {
      maxMessageTextChars = payload.textChars;
    }
  }

  return {
    roleCounts:
      [...roleCounts.entries()]
        .toSorted((a, b) => a[0].localeCompare(b[0]))
        .map(([role, count]) => `${role}:${count}`)
        .join(",") || "none",
    totalTextChars,
    totalImageBlocks,
    maxMessageTextChars,
  };
}

export async function runEmbeddedAttempt(
  params: EmbeddedRunAttemptParams,
): Promise<EmbeddedRunAttemptResult> {
  const runTraceId = `run-loop:${params.runId}`;
  let log = embeddedAttemptLog.withContext({
    runId: params.runId,
    sessionId: params.sessionId,
    ...(params.agentId ? { agentId: params.agentId } : {}),
    traceId: runTraceId,
    spanId: `root:${runTraceId}`,
  });
  const resolvedWorkspace = resolveUserPath(params.workspaceDir);
  const runAbortController = new AbortController();
  // Proxy bootstrap must happen before timeout tuning so the timeouts wrap the
  // active EnvHttpProxyAgent instead of being replaced by a bare proxy dispatcher.
  ensureGlobalUndiciEnvProxyDispatcher();
  ensureGlobalUndiciStreamTimeouts();

  log.debug(
    `embedded run start: runId=${params.runId} sessionId=${params.sessionId} provider=${params.provider} model=${params.modelId} thinking=${params.thinkLevel} messageChannel=${params.messageChannel ?? params.messageProvider ?? "unknown"}`,
  );

  await fs.mkdir(resolvedWorkspace, { recursive: true });

  const sandboxSessionKey = params.sessionKey?.trim() || params.sessionId;
  const sandbox = await resolveSandboxContext({
    config: params.config,
    sessionKey: sandboxSessionKey,
    workspaceDir: resolvedWorkspace,
  });
  const effectiveWorkspace = sandbox?.enabled
    ? sandbox.workspaceAccess === "rw"
      ? resolvedWorkspace
      : sandbox.workspaceDir
    : resolvedWorkspace;
  await fs.mkdir(effectiveWorkspace, { recursive: true });

  let restoreSkillEnv: (() => void) | undefined;
  try {
    const agentDir = params.agentDir ?? resolveCrawClawAgentDir();
    const { defaultAgentId, sessionAgentId } = resolveSessionAgentIds({
      sessionKey: params.sessionKey,
      config: params.config,
      agentId: params.agentId,
    });
    log = log.withContext({ agentId: sessionAgentId });
    const { shouldLoadSkillEntries, skillEntries } = resolveEmbeddedRunSkillEntries({
      workspaceDir: effectiveWorkspace,
      config: params.config,
      skillsSnapshot: params.skillsSnapshot,
      prompt: params.prompt,
    });
    restoreSkillEnv = params.skillsSnapshot
      ? applySkillEnvOverridesFromSnapshot({
          snapshot: params.skillsSnapshot,
          config: params.config,
        })
      : applySkillEnvOverrides({
          skills: skillEntries ?? [],
          config: params.config,
        });

    const hookRunner = getGlobalHookRunner();
    const surfacedSkillNames = await resolveSurfacedSkillsHookResult({
      initialSkillExposureState: params.skillExposureState,
      explicitSurfacedSkillNames: params.surfacedSkillNames,
      explicitRelevantSkillNames: params.relevantSkillNames,
      purpose: "run",
      prompt: params.prompt,
      workspaceDir: effectiveWorkspace,
      availableSkills: buildAvailableSkillsForHook({
        skillEntries,
        skillsSnapshot: params.skillsSnapshot,
      }),
      hookCtx: {
        runId: params.runId,
        agentId: sessionAgentId,
        sessionKey: params.sessionKey,
        sessionId: params.sessionId,
        workspaceDir: params.workspaceDir,
        messageProvider: params.messageProvider ?? undefined,
        trigger: params.trigger,
        channelId: params.messageChannel ?? params.messageProvider ?? undefined,
      },
      hookRunner,
    });

    const skillsPrompt = resolveSkillsPromptForRun({
      skillsSnapshot: params.skillsSnapshot,
      entries: shouldLoadSkillEntries ? skillEntries : undefined,
      config: params.config,
      workspaceDir: effectiveWorkspace,
      skillFilter: surfacedSkillNames,
    });

    const sessionLabel = params.sessionKey ?? params.sessionId;
    const { bootstrapFiles: hookAdjustedBootstrapFiles, contextFiles } =
      await resolveBootstrapContextForRun({
        workspaceDir: effectiveWorkspace,
        config: params.config,
        sessionKey: params.sessionKey,
        sessionId: params.sessionId,
        warn: makeBootstrapWarn({ sessionLabel, warn: (message) => log.warn(message) }),
        contextMode: params.bootstrapContextMode,
        runKind: params.bootstrapContextRunKind,
      });
    const bootstrapMaxChars = resolveBootstrapMaxChars(params.config);
    const bootstrapTotalMaxChars = resolveBootstrapTotalMaxChars(params.config);
    const bootstrapAnalysis = analyzeBootstrapBudget({
      files: buildBootstrapInjectionStats({
        bootstrapFiles: hookAdjustedBootstrapFiles,
        injectedFiles: contextFiles,
      }),
      bootstrapMaxChars,
      bootstrapTotalMaxChars,
    });
    const bootstrapPromptWarningMode = resolveBootstrapPromptTruncationWarningMode(params.config);
    const bootstrapPromptWarning = buildBootstrapPromptWarning({
      analysis: bootstrapAnalysis,
      mode: bootstrapPromptWarningMode,
      seenSignatures: params.bootstrapPromptWarningSignaturesSeen,
      previousSignature: params.bootstrapPromptWarningSignature,
    });
    const workspaceNotes = hookAdjustedBootstrapFiles.some(
      (file) => file.name === DEFAULT_BOOTSTRAP_FILENAME && !file.missing,
    )
      ? ["Reminder: commit your changes in this workspace after edits."]
      : undefined;

    const effectiveFsWorkspaceOnly = resolveAttemptFsWorkspaceOnly({
      config: params.config,
      sessionAgentId,
    });
    // Track sessions_yield tool invocation (callback pattern, like clientToolCallDetected)
    let yieldDetected = false;
    let yieldMessage: string | null = null;
    // Late-binding reference so onYield can abort the session (declared after tool creation)
    let abortSessionForYield: (() => void) | null = null;
    let queueYieldInterruptForSession: (() => void) | null = null;
    let yieldAbortSettled: Promise<void> | null = null;
    // Check if the model supports native image input
    const modelHasVision = params.model.input?.includes("image") ?? false;
    const parentPromptThinking = resolveParentPromptThinkingConfig({
      parent: params.specialParentPromptEnvelope?.thinkingConfig,
      thinkLevel: params.thinkLevel,
      reasoningLevel: params.reasoningLevel,
      verboseLevel: params.verboseLevel,
      fastMode: params.fastMode,
    });
    const parentPromptToolNames = extractParentPromptToolNames(params.specialParentPromptEnvelope);
    const toolsRaw = params.disableTools
      ? []
      : (() => {
          const allTools = createCrawClawCodingTools({
            agentId: sessionAgentId,
            trigger: params.trigger,
            memoryFlushWritePath: params.memoryFlushWritePath,
            exec: {
              ...params.execOverrides,
              elevated: params.bashElevated,
            },
            sandbox,
            messageProvider: params.messageChannel ?? params.messageProvider,
            agentAccountId: params.agentAccountId,
            messageTo: params.messageTo,
            messageThreadId: params.messageThreadId,
            groupId: params.groupId,
            groupChannel: params.groupChannel,
            groupSpace: params.groupSpace,
            spawnedBy: params.spawnedBy,
            senderId: params.senderId,
            senderName: params.senderName,
            senderUsername: params.senderUsername,
            senderE164: params.senderE164,
            senderIsOwner: params.senderIsOwner,
            allowGatewaySubagentBinding: params.allowGatewaySubagentBinding,
            sessionKey: sandboxSessionKey,
            sessionId: params.sessionId,
            runId: params.runId,
            agentDir,
            workspaceDir: effectiveWorkspace,
            // When sandboxing uses a copied workspace (`ro` or `none`), effectiveWorkspace points
            // at the sandbox copy. Spawned subagents should inherit the real workspace instead.
            spawnWorkspaceDir: resolveAttemptSpawnWorkspaceDir({
              sandbox,
              resolvedWorkspace,
            }),
            config: params.config,
            abortSignal: runAbortController.signal,
            modelProvider: params.model.provider,
            modelId: params.modelId,
            modelCompat: params.model.compat,
            modelApi: params.model.api,
            modelContextWindowTokens: params.model.contextWindow,
            modelAuthMode: resolveModelAuthMode(params.model.provider, params.config),
            currentChannelId: params.currentChannelId,
            currentThreadTs: params.currentThreadTs,
            currentMessageId: params.currentMessageId,
            replyToMode: params.replyToMode,
            hasRepliedRef: params.hasRepliedRef,
            modelHasVision,
            requireExplicitMessageTarget:
              params.requireExplicitMessageTarget ?? isSubagentSessionKey(params.sessionKey),
            disableMessageTool: params.disableMessageTool,
            onYield: (message) => {
              yieldDetected = true;
              yieldMessage = message;
              queueYieldInterruptForSession?.();
              runAbortController.abort("sessions_yield");
              abortSessionForYield?.();
            },
            ...(params.specialAgentSpawnSource
              ? { specialAgentSpawnSource: params.specialAgentSpawnSource }
              : {}),
            ...(params.specialDurableMemoryScope
              ? { specialDurableMemoryScope: params.specialDurableMemoryScope }
              : {}),
            ...(params.specialSessionSummaryTarget
              ? { specialSessionSummaryTarget: params.specialSessionSummaryTarget }
              : {}),
          });
          const effectiveToolsAllow = resolveEffectiveToolsAllow({
            toolsAllow: params.toolsAllow,
            parentPromptToolNames,
            specialAgentSpawnSource: params.specialAgentSpawnSource,
          });
          if (effectiveToolsAllow && effectiveToolsAllow.length > 0) {
            const allowSet = new Set(effectiveToolsAllow);
            return allTools.filter((tool) => allowSet.has(tool.name));
          }
          return allTools;
        })();
    const toolsEnabled = supportsModelTools(params.model);
    const tools = sanitizeToolsForGoogle({
      tools: toolsEnabled ? toolsRaw : [],
      provider: params.provider,
      config: params.config,
      workspaceDir: effectiveWorkspace,
      env: process.env,
      modelId: params.modelId,
      modelApi: params.model.api,
      model: params.model,
    });
    const clientTools = toolsEnabled ? params.clientTools : undefined;
    const bundleMcpSessionRuntime = toolsEnabled
      ? await getOrCreateSessionMcpRuntime({
          sessionId: params.sessionId,
          sessionKey: params.sessionKey,
          workspaceDir: effectiveWorkspace,
          cfg: params.config,
        })
      : undefined;
    let bundleMcpRuntime = bundleMcpSessionRuntime
      ? await materializeBundleMcpToolsForRun({
          runtime: bundleMcpSessionRuntime,
          reservedToolNames: [
            ...tools.map((tool) => tool.name),
            ...(clientTools?.map((tool) => tool.function.name) ?? []),
          ],
        })
      : undefined;
    const bundleLspRuntime = toolsEnabled
      ? await createBundleLspToolRuntime({
          workspaceDir: effectiveWorkspace,
          cfg: params.config,
          reservedToolNames: [
            ...tools.map((tool) => tool.name),
            ...(clientTools?.map((tool) => tool.function.name) ?? []),
            ...(bundleMcpRuntime?.tools.map((tool) => tool.name) ?? []),
          ],
        })
      : undefined;
    const staticLspTools = bundleLspRuntime?.tools ?? [];
    let effectiveTools = [...tools, ...(bundleMcpRuntime?.tools ?? []), ...staticLspTools];
    const toolContext = createQueryContextToolContext(effectiveTools);
    const allowedToolNames = collectAllowedToolNames({
      tools: effectiveTools,
      clientTools,
    });
    logToolSchemasForGoogle({
      tools: effectiveTools,
      provider: params.provider,
      config: params.config,
      workspaceDir: effectiveWorkspace,
      env: process.env,
      modelId: params.modelId,
      modelApi: params.model.api,
      model: params.model,
    });

    const machineName = await getMachineDisplayName();
    const runtimeChannel = normalizeMessageChannel(params.messageChannel ?? params.messageProvider);
    let runtimeCapabilities = runtimeChannel
      ? (resolveChannelCapabilities({
          cfg: params.config,
          channel: runtimeChannel,
          accountId: params.agentAccountId,
        }) ?? [])
      : undefined;
    const promptCapabilities =
      runtimeChannel && params.config
        ? resolveChannelMessageToolCapabilities({
            cfg: params.config,
            channel: runtimeChannel,
            accountId: params.agentAccountId,
          })
        : [];
    if (promptCapabilities.length > 0) {
      runtimeCapabilities ??= [];
      const seenCapabilities = new Set(runtimeCapabilities.map((cap) => cap.trim().toLowerCase()));
      for (const capability of promptCapabilities) {
        const normalizedCapability = capability.trim().toLowerCase();
        if (!normalizedCapability || seenCapabilities.has(normalizedCapability)) {
          continue;
        }
        seenCapabilities.add(normalizedCapability);
        runtimeCapabilities.push(capability);
      }
    }
    const reactionGuidance =
      runtimeChannel && params.config
        ? resolveChannelReactionGuidance({
            cfg: params.config,
            channel: runtimeChannel,
            accountId: params.agentAccountId,
          })
        : undefined;
    const sandboxInfo = buildEmbeddedSandboxInfo(sandbox, params.bashElevated);
    const reasoningTagHint = isReasoningTagProvider(params.provider, {
      config: params.config,
      workspaceDir: effectiveWorkspace,
      env: process.env,
      modelId: params.modelId,
      modelApi: params.model.api,
      model: params.model,
    });
    // Resolve channel-specific message actions for system prompt
    const channelActions = runtimeChannel
      ? listChannelSupportedActions(
          buildEmbeddedMessageActionDiscoveryInput({
            cfg: params.config,
            channel: runtimeChannel,
            currentChannelId: params.currentChannelId,
            currentThreadTs: params.currentThreadTs,
            currentMessageId: params.currentMessageId,
            accountId: params.agentAccountId,
            sessionKey: params.sessionKey,
            sessionId: params.sessionId,
            agentId: sessionAgentId,
            senderId: params.senderId,
          }),
        )
      : undefined;
    const messageToolHints = runtimeChannel
      ? resolveChannelMessageToolHints({
          cfg: params.config,
          channel: runtimeChannel,
          accountId: params.agentAccountId,
        })
      : undefined;

    const defaultModelRef = resolveDefaultModelForAgent({
      cfg: params.config ?? {},
      agentId: sessionAgentId,
    });
    const defaultModelLabel = `${defaultModelRef.provider}/${defaultModelRef.model}`;
    const { runtimeInfo, userTimezone, userTime, userTimeFormat } = buildSystemPromptParams({
      config: params.config,
      agentId: sessionAgentId,
      workspaceDir: effectiveWorkspace,
      cwd: effectiveWorkspace,
      runtime: {
        host: machineName,
        os: `${os.type()} ${os.release()}`,
        arch: os.arch(),
        node: process.version,
        model: `${params.provider}/${params.modelId}`,
        defaultModel: defaultModelLabel,
        shell: detectRuntimeShell(),
        channel: runtimeChannel,
        capabilities: runtimeCapabilities,
        channelActions,
      },
    });
    const isDefaultAgent = sessionAgentId === defaultAgentId;
    const promptMode = resolvePromptModeForSession(params.sessionKey);

    // Keep the richer prompt when a narrow allowlist is testing durable-memory behavior.
    const useMinimalPromptForAllowedTools = shouldUseMinimalPromptForAllowedTools(
      params.toolsAllow,
    );
    const effectivePromptMode = useMinimalPromptForAllowedTools ? ("minimal" as const) : promptMode;
    const effectiveSkillsPrompt = useMinimalPromptForAllowedTools ? undefined : skillsPrompt;
    const docsPath = await resolveCrawClawDocsPath({
      workspaceDir: effectiveWorkspace,
      argv1: process.argv[1],
      cwd: effectiveWorkspace,
      moduleUrl: import.meta.url,
    });
    const ttsHint = params.config ? buildTtsSystemPromptHint(params.config) : undefined;
    const ownerDisplay = resolveOwnerDisplaySetting(params.config);
    const heartbeatPrompt = shouldInjectHeartbeatPrompt({
      isDefaultAgent,
      trigger: params.trigger,
    })
      ? resolveHeartbeatPrompt(params.config?.agents?.defaults?.heartbeat?.prompt)
      : undefined;
    const parentForkContextMessages = Array.isArray(
      params.specialParentPromptEnvelope?.forkContextMessages,
    )
      ? params.specialParentPromptEnvelope.forkContextMessages
      : [];
    const thinkingConfig = {
      ...(parentPromptThinking.thinkLevel !== undefined
        ? { thinkLevel: parentPromptThinking.thinkLevel }
        : {}),
      ...(parentPromptThinking.reasoningLevel !== undefined
        ? { reasoningLevel: parentPromptThinking.reasoningLevel }
        : {}),
      ...(parentPromptThinking.verboseLevel !== undefined
        ? { verboseLevel: parentPromptThinking.verboseLevel }
        : {}),
      ...(parentPromptThinking.fastMode !== undefined
        ? { fastMode: parentPromptThinking.fastMode }
        : {}),
    };

    const baseSystemPromptSections = params.specialParentPromptEnvelope?.systemPromptText
      ? [
          {
            id: "special:parent_system_prompt",
            role: "system_prompt" as const,
            content: buildParentPromptEmbeddedSystemPrompt({
              parentSystemPromptText: params.specialParentPromptEnvelope.systemPromptText,
              extraSystemPrompt: params.extraSystemPrompt,
            }),
            source: "special-agent",
            cacheable: true,
          },
        ]
      : buildEmbeddedSystemPromptSections({
          workspaceDir: effectiveWorkspace,
          defaultThinkLevel: parentPromptThinking.thinkLevel,
          reasoningLevel: parentPromptThinking.reasoningLevel ?? "off",
          extraSystemPrompt: params.extraSystemPrompt,
          ownerNumbers: params.ownerNumbers,
          ownerDisplay: ownerDisplay.ownerDisplay,
          ownerDisplaySecret: ownerDisplay.ownerDisplaySecret,
          reasoningTagHint,
          heartbeatPrompt,
          skillsPrompt: effectiveSkillsPrompt,
          docsPath: docsPath ?? undefined,
          ttsHint,
          workspaceNotes,
          reactionGuidance,
          promptMode: effectivePromptMode,
          acpEnabled: params.config?.acp?.enabled !== false,
          runtimeInfo,
          messageToolHints,
          sandboxInfo,
          tools: effectiveTools,
          modelAliasLines: buildModelAliasLines(params.config),
          userTimezone,
          userTime,
          userTimeFormat,
          contextFiles,
        });
    const skillExposureStateForPrompt = getSkillExposureState({
      sessionId: params.sessionId,
      sessionKey: params.sessionKey,
    });
    let queryContext: QueryContext = {
      messages: [],
      userPrompt: params.prompt,
      userContextSections: [],
      systemPromptSections: baseSystemPromptSections,
      systemContextSections: [],
      toolContext,
      thinkingConfig,
      diagnostics: {
        bootstrapFiles: hookAdjustedBootstrapFiles
          .map((file) => file.name?.trim())
          .filter((name): name is string => Boolean(name)),
        skillNames: surfacedSkillNames ?? [],
        memorySources: [],
      },
    };
    let providerRequest: QueryContextProviderRequest =
      buildQueryContextProviderRequest(queryContext);
    let modelInput = materializeQueryContextProviderRequest(providerRequest);
    let providerRequestSnapshot: QueryContextProviderRequestSnapshot = providerRequest.snapshot;
    const refreshQueryContextProviderRequest = () => {
      providerRequest = buildQueryContextProviderRequest(queryContext);
      modelInput = materializeQueryContextProviderRequest(providerRequest);
      providerRequestSnapshot = providerRequest.snapshot;
      return providerRequest;
    };
    let systemPromptText = modelInput.systemPrompt;
    const specialAgentStreamParams = params.streamParams;
    const systemPromptReport = buildSystemPromptReport({
      source: "run",
      generatedAt: Date.now(),
      sessionId: params.sessionId,
      sessionKey: params.sessionKey,
      provider: params.provider,
      model: params.modelId,
      workspaceDir: effectiveWorkspace,
      bootstrapMaxChars,
      bootstrapTotalMaxChars,
      bootstrapTruncation: buildBootstrapTruncationReportMeta({
        analysis: bootstrapAnalysis,
        warningMode: bootstrapPromptWarningMode,
        warning: bootstrapPromptWarning,
      }),
      sandbox: (() => {
        const runtime = resolveSandboxRuntimeStatus({
          cfg: params.config,
          sessionKey: sandboxSessionKey,
        });
        return { mode: runtime.mode, sandboxed: runtime.sandboxed };
      })(),
      systemPrompt: systemPromptText,
      bootstrapFiles: hookAdjustedBootstrapFiles,
      injectedFiles: contextFiles,
      skillsPrompt,
      surfacedSkills: surfacedSkillNames,
      discoveredSkills: skillExposureStateForPrompt?.discoveredSkillNames
        ? [...skillExposureStateForPrompt.discoveredSkillNames]
        : undefined,
      tools: effectiveTools,
    });

    const sessionLock = await acquireSessionWriteLock({
      sessionFile: params.sessionFile,
      maxHoldMs: resolveSessionLockMaxHoldFromTimeout({
        timeoutMs: resolveRunTimeoutWithCompactionGraceMs({
          runTimeoutMs: params.timeoutMs,
          compactionTimeoutMs: resolveCompactionTimeoutMs(params.config),
        }),
      }),
    });

    let sessionManager: ReturnType<typeof guardSessionManager> | undefined;
    let session: Awaited<ReturnType<typeof createAgentSession>>["session"] | undefined;
    let removeToolResultContextGuard: (() => void) | undefined;
    try {
      await repairSessionFileIfNeeded({
        sessionFile: params.sessionFile,
        warn: (message) => log.warn(message),
      });
      const hadSessionFile = await fs
        .stat(params.sessionFile)
        .then(() => true)
        .catch(() => false);

      const transcriptPolicy = resolveTranscriptPolicy({
        modelApi: params.model?.api,
        provider: params.provider,
        modelId: params.modelId,
        config: params.config,
        workspaceDir: effectiveWorkspace,
        env: process.env,
        model: params.model,
      });

      await prewarmSessionFile(params.sessionFile);
      sessionManager = guardSessionManager(SessionManager.open(params.sessionFile), {
        agentId: sessionAgentId,
        sessionKey: params.sessionKey,
        inputProvenance: params.inputProvenance,
        allowSyntheticToolResults: transcriptPolicy.allowSyntheticToolResults,
        allowedToolNames,
      });
      trackSessionManagerAccess(params.sessionFile);

      await runAttemptMemoryRuntimeBootstrap({
        hadSessionFile,
        memoryRuntime: params.memoryRuntime,
        sessionId: params.sessionId,
        sessionKey: params.sessionKey,
        sessionFile: params.sessionFile,
        sessionManager,
        runtimeContext: buildAfterTurnRuntimeContext({
          attempt: { ...params, surfacedSkillNames },
          workspaceDir: effectiveWorkspace,
          agentDir,
        }),
        runMaintenance: async (contextParams) =>
          await runMemoryRuntimeMaintenance({
            memoryRuntime: contextParams.memoryRuntime as never,
            sessionId: contextParams.sessionId,
            sessionKey: contextParams.sessionKey,
            sessionFile: contextParams.sessionFile,
            reason: contextParams.reason,
            sessionManager: contextParams.sessionManager as never,
            runtimeContext: contextParams.runtimeContext,
          }),
        warn: (message) => log.warn(message),
      });

      await prepareSessionManagerForRun({
        sessionManager,
        sessionFile: params.sessionFile,
        hadSessionFile,
        sessionId: params.sessionId,
        cwd: effectiveWorkspace,
      });

      const settingsManager = createPreparedEmbeddedPiSettingsManager({
        cwd: effectiveWorkspace,
        agentDir,
        cfg: params.config,
      });
      applyPiAutoCompactionGuard({
        settingsManager,
        memoryRuntimeInfo: params.memoryRuntime?.info,
      });

      // Sets compaction/pruning runtime state and returns extension factories
      // that must be passed to the resource loader for the safeguard to be active.
      const extensionFactories = buildEmbeddedExtensionFactories({
        cfg: params.config,
        sessionManager,
        provider: params.provider,
        modelId: params.modelId,
        model: params.model,
      });
      // Only create an explicit resource loader when there are extension factories
      // to register; otherwise let createAgentSession use its built-in default.
      let resourceLoader: DefaultResourceLoader | undefined;
      if (extensionFactories.length > 0) {
        resourceLoader = new DefaultResourceLoader({
          cwd: resolvedWorkspace,
          agentDir,
          settingsManager,
          extensionFactories,
        });
        await resourceLoader.reload();
      }

      // Get hook runner early so it's available when creating tools
      const hookRunner = getGlobalHookRunner();
      const { builtInTools, customTools } = splitSdkTools({
        tools: effectiveTools,
        sandboxEnabled: !!sandbox?.enabled,
      });

      // Add client tools (OpenResponses hosted tools) to customTools
      let clientToolCallDetected: { name: string; params: Record<string, unknown> } | null = null;
      const clientToolLoopDetection = resolveToolLoopDetectionConfig({
        cfg: params.config,
        agentId: sessionAgentId,
      });
      const clientToolDefs = clientTools
        ? toClientToolDefinitions(
            clientTools,
            (toolName, toolParams) => {
              clientToolCallDetected = { name: toolName, params: toolParams };
            },
            {
              agentId: sessionAgentId,
              sessionKey: sandboxSessionKey,
              sessionId: params.sessionId,
              runId: params.runId,
              loopDetection: clientToolLoopDetection,
            },
          )
        : [];

      const allCustomTools = [...customTools, ...clientToolDefs];

      ({ session } = await createAgentSession({
        cwd: resolvedWorkspace,
        agentDir,
        authStorage: params.authStorage,
        modelRegistry: params.modelRegistry,
        model: params.model,
        thinkingLevel: mapThinkingLevel(params.thinkLevel),
        tools: builtInTools,
        customTools: allCustomTools,
        sessionManager,
        settingsManager,
        resourceLoader,
      }));
      applySystemPromptOverrideToSession(session, systemPromptText);
      if (!session) {
        throw new Error("Embedded agent session missing");
      }
      const activeSession = session;
      if (params.toolsAllow?.length) {
        const activation = ensureAllowedToolsActiveInSession({
          session: activeSession as SessionToolCarrier<(typeof effectiveTools)[number]>,
          toolsAllow: params.toolsAllow,
          effectiveTools,
        });
        if (activation.missingBefore.length > 0) {
          log.warn("session tool activation recovered missing allowed tools", {
            sessionId: params.sessionId,
            missingBefore: activation.missingBefore,
            missingAfter: activation.missingAfter,
            usedDirectRuntimeRegistration: activation.usedDirectRuntimeRegistration,
          });
        }
      }
      let toolRefreshInFlight: Promise<void> | null = null;
      let lastToolRefreshAt = 0;
      const minToolRefreshIntervalMs = 250;
      const refreshToolsForStreaming = async (): Promise<void> => {
        if (!bundleMcpSessionRuntime) {
          return;
        }
        const now = Date.now();
        if (now - lastToolRefreshAt < minToolRefreshIntervalMs) {
          return;
        }
        if (toolRefreshInFlight) {
          await toolRefreshInFlight;
          return;
        }
        toolRefreshInFlight = (async () => {
          try {
            const refreshedBundleMcpRuntime = await materializeBundleMcpToolsForRun({
              runtime: bundleMcpSessionRuntime,
              reservedToolNames: [
                ...tools.map((tool) => tool.name),
                ...(clientTools?.map((tool) => tool.function.name) ?? []),
                ...staticLspTools.map((tool) => tool.name),
              ],
            });
            const nextEffectiveTools = [
              ...tools,
              ...(refreshedBundleMcpRuntime?.tools ?? []),
              ...staticLspTools,
            ];
            const prevSignature = buildToolInventorySignature(effectiveTools);
            const nextSignature = buildToolInventorySignature(nextEffectiveTools);
            if (prevSignature === nextSignature) {
              lastToolRefreshAt = Date.now();
              return;
            }
            bundleMcpRuntime = refreshedBundleMcpRuntime;
            effectiveTools = nextEffectiveTools;
            ensureAllowedToolsActiveInSession({
              session: activeSession as SessionToolCarrier<(typeof effectiveTools)[number]>,
              toolsAllow: params.toolsAllow,
              effectiveTools,
            });
            queryContext = {
              ...queryContext,
              toolContext: createQueryContextToolContext(effectiveTools),
            };
            refreshQueryContextProviderRequest();
            systemPromptText = modelInput.systemPrompt;
            replaceSetContents(
              allowedToolNames,
              collectAllowedToolNames({
                tools: effectiveTools,
                clientTools,
              }),
            );
            lastToolRefreshAt = Date.now();
            log.debug(
              `embedded run tools refreshed: runId=${params.runId} sessionId=${params.sessionId} toolCount=${effectiveTools.length}`,
            );
          } catch (err) {
            log.warn(`embedded run tool refresh skipped: ${describeUnknownError(err)}`);
          }
        })().finally(() => {
          toolRefreshInFlight = null;
        });
        await toolRefreshInFlight;
      };
      abortSessionForYield = () => {
        yieldAbortSettled = Promise.resolve(activeSession.abort());
      };
      queueYieldInterruptForSession = () => {
        queueSessionsYieldInterruptMessage(activeSession);
      };
      removeToolResultContextGuard = installToolResultContextGuard({
        agent: activeSession.agent,
        contextWindowTokens: Math.max(
          1,
          Math.floor(
            params.model.contextWindow ?? params.model.maxTokens ?? DEFAULT_CONTEXT_TOKENS,
          ),
        ),
      });
      const cacheTrace = createCacheTrace({
        cfg: params.config,
        env: process.env,
        runId: params.runId,
        sessionId: activeSession.sessionId,
        sessionKey: params.sessionKey,
        provider: params.provider,
        modelId: params.modelId,
        modelApi: params.model.api,
        workspaceDir: params.workspaceDir,
      });
      const anthropicPayloadLogger = createAnthropicPayloadLogger({
        env: process.env,
        runId: params.runId,
        sessionId: activeSession.sessionId,
        sessionKey: params.sessionKey,
        provider: params.provider,
        modelId: params.modelId,
        modelApi: params.model.api,
        workspaceDir: params.workspaceDir,
      });

      const defaultSessionStreamFn = activeSession.agent.streamFn;
      const providerStreamFn = registerProviderStreamForModel({
        model: params.model,
        cfg: params.config,
        agentDir,
        workspaceDir: effectiveWorkspace,
      });
      const shouldUseWebSocketTransport = shouldUseOpenAIWebSocketTransport({
        provider: params.provider,
        modelApi: params.model.api,
      });
      const wsApiKey = shouldUseWebSocketTransport
        ? await params.authStorage.getApiKey(params.provider)
        : undefined;
      if (shouldUseWebSocketTransport && !wsApiKey) {
        log.warn(
          `[ws-stream] no API key for provider=${params.provider}; keeping session-managed HTTP transport`,
        );
      }
      activeSession.agent.streamFn = resolveEmbeddedAgentStreamFn({
        currentStreamFn: defaultSessionStreamFn,
        providerStreamFn,
        shouldUseWebSocketTransport,
        wsApiKey,
        sessionId: params.sessionId,
        signal: runAbortController.signal,
        model: params.model,
        authStorage: params.authStorage,
      });

      const { effectiveExtraParams } = applyExtraParamsToAgent(
        activeSession.agent,
        params.config,
        params.provider,
        params.modelId,
        {
          ...specialAgentStreamParams,
          fastMode: parentPromptThinking.fastMode,
        },
        parentPromptThinking.thinkLevel,
        sessionAgentId,
        effectiveWorkspace,
        params.model,
        agentDir,
      );
      const agentTransportOverride = resolveAgentTransportOverride({
        settingsManager,
        effectiveExtraParams,
      });
      if (agentTransportOverride && activeSession.agent.transport !== agentTransportOverride) {
        log.debug(
          `embedded agent transport override: ${activeSession.agent.transport} -> ${agentTransportOverride} ` +
            `(${params.provider}/${params.modelId})`,
        );
        activeSession.agent.setTransport(agentTransportOverride);
      }

      if (cacheTrace) {
        cacheTrace.recordStage("session:loaded", {
          messages: activeSession.messages,
          system: systemPromptText,
          note: "after session create",
        });
        activeSession.agent.streamFn = cacheTrace.wrapStreamFn(activeSession.agent.streamFn);
      }

      // Anthropic Claude endpoints can reject replayed `thinking` blocks
      // (e.g. thinkingSignature:"reasoning_text") on any follow-up provider
      // call, including tool continuations. Wrap the stream function so every
      // outbound request sees sanitized messages.
      if (transcriptPolicy.dropThinkingBlocks) {
        const inner = activeSession.agent.streamFn;
        activeSession.agent.streamFn = (model, context, options) => {
          const ctx = context as unknown as { messages?: unknown };
          const messages = ctx?.messages;
          if (!Array.isArray(messages)) {
            return inner(model, context, options);
          }
          const sanitized = dropThinkingBlocks(messages as unknown as AgentMessage[]) as unknown;
          if (sanitized === messages) {
            return inner(model, context, options);
          }
          const nextContext = {
            ...(context as unknown as Record<string, unknown>),
            messages: sanitized,
          } as unknown;
          return inner(model, nextContext as typeof context, options);
        };
      }

      // Mistral (and other strict providers) reject tool call IDs that don't match their
      // format requirements (e.g. [a-zA-Z0-9]{9}). sanitizeSessionHistory only processes
      // historical messages at attempt start, but the agent loop's internal tool call →
      // tool result cycles bypass that path. Wrap streamFn so every outbound request
      // sees sanitized tool call IDs.
      if (transcriptPolicy.sanitizeToolCallIds && transcriptPolicy.toolCallIdMode) {
        const inner = activeSession.agent.streamFn;
        const mode = transcriptPolicy.toolCallIdMode;
        activeSession.agent.streamFn = (model, context, options) => {
          const ctx = context as unknown as { messages?: unknown };
          const messages = ctx?.messages;
          if (!Array.isArray(messages)) {
            return inner(model, context, options);
          }
          const sanitized = sanitizeToolCallIdsForCloudCodeAssist(messages as AgentMessage[], mode);
          if (sanitized === messages) {
            return inner(model, context, options);
          }
          const nextContext = {
            ...(context as unknown as Record<string, unknown>),
            messages: sanitized,
          } as unknown;
          return inner(model, nextContext as typeof context, options);
        };
      }

      if (
        params.model.api === "openai-responses" ||
        params.model.api === "azure-openai-responses" ||
        params.model.api === "openai-codex-responses"
      ) {
        const inner = activeSession.agent.streamFn;
        activeSession.agent.streamFn = (model, context, options) => {
          const ctx = context as unknown as { messages?: unknown };
          const messages = ctx?.messages;
          if (!Array.isArray(messages)) {
            return inner(model, context, options);
          }
          const sanitized = downgradeOpenAIFunctionCallReasoningPairs(messages as AgentMessage[]);
          if (sanitized === messages) {
            return inner(model, context, options);
          }
          const nextContext = {
            ...(context as unknown as Record<string, unknown>),
            messages: sanitized,
          } as unknown;
          return inner(model, nextContext as typeof context, options);
        };
      }

      const preRefreshStreamFn = activeSession.agent.streamFn;
      activeSession.agent.streamFn = async (model, context, options) => {
        await refreshToolsForStreaming();
        return preRefreshStreamFn(model, context, options);
      };

      const innerStreamFn = activeSession.agent.streamFn;
      activeSession.agent.streamFn = (model, context, options) => {
        const signal = runAbortController.signal as AbortSignal & { reason?: unknown };
        if (yieldDetected && signal.aborted && signal.reason === "sessions_yield") {
          return createYieldAbortedResponse(model) as unknown as Awaited<
            ReturnType<typeof innerStreamFn>
          >;
        }
        return innerStreamFn(model, context, options);
      };

      // Some models emit tool names with surrounding whitespace (e.g. " read ").
      // pi-agent-core dispatches tool calls with exact string matching, so normalize
      // names on the live response stream before tool execution.
      activeSession.agent.streamFn = wrapStreamFnSanitizeMalformedToolCalls(
        activeSession.agent.streamFn,
        allowedToolNames,
        transcriptPolicy,
      );
      activeSession.agent.streamFn = wrapStreamFnConvertMinimaxXmlToolCalls(
        activeSession.agent.streamFn,
        allowedToolNames,
      );
      activeSession.agent.streamFn = wrapStreamFnTrimToolCallNames(
        activeSession.agent.streamFn,
        allowedToolNames,
      );

      if (
        params.model.api === "anthropic-messages" &&
        shouldRepairMalformedAnthropicToolCallArguments(params.provider)
      ) {
        activeSession.agent.streamFn = wrapStreamFnRepairMalformedToolCallArguments(
          activeSession.agent.streamFn,
        );
      }

      if (resolveToolCallArgumentsEncoding(params.model) === "html-entities") {
        activeSession.agent.streamFn = wrapStreamFnDecodeXaiToolCallArguments(
          activeSession.agent.streamFn,
        );
      }

      if (shouldEnableAnthropicThinkingRecovery(params.model.api)) {
        activeSession.agent.streamFn = wrapAnthropicStreamWithRecovery(
          activeSession.agent.streamFn,
          { id: activeSession.sessionId },
        );
      }

      if (anthropicPayloadLogger) {
        activeSession.agent.streamFn = anthropicPayloadLogger.wrapStreamFn(
          activeSession.agent.streamFn,
        );
      }
      // Anthropic-compatible providers can add new stop reasons before pi-ai maps them.
      // Recover the known "sensitive" stop reason here so a model refusal does not
      // bubble out as an uncaught runner error and stall channel polling.
      activeSession.agent.streamFn = wrapStreamFnHandleSensitiveStopReason(
        activeSession.agent.streamFn,
      );
      activeSession.agent.streamFn = wrapStreamFnWithProviderLifecycle({
        streamFn: activeSession.agent.streamFn,
        runId: params.runId,
        sessionId: params.sessionId,
        sessionKey: params.sessionKey,
        agentId: sessionAgentId,
        parentSessionKey: params.spawnedBy ?? undefined,
        sessionFile: params.sessionFile,
        isTopLevel: !params.sessionKey || !isSubagentSessionKey(params.sessionKey),
        provider: params.provider,
        modelId: params.modelId,
        modelApi: params.model.api,
        logger: log,
        getProviderRequestSnapshot: () => providerRequestSnapshot,
        getMessageCount: () => queryContext.messages.length,
      });
      activeSession.agent.streamFn = wrapStreamFnWithQueryContextBoundary({
        streamFn: activeSession.agent.streamFn,
        getQueryContext: () => queryContext,
        setQueryContext: (nextQueryContext) => {
          queryContext = nextQueryContext;
        },
        onProviderRequestBuilt: (nextProviderRequest, nextModelInput, snapshot) => {
          providerRequest = nextProviderRequest;
          modelInput = nextModelInput;
          providerRequestSnapshot = snapshot;
          systemPromptText = nextModelInput.systemPrompt;
        },
      });

      let idleTimeoutTrigger: ((error: Error) => void) | undefined;

      // Wrap stream with idle timeout detection
      const idleTimeoutMs = resolveLlmIdleTimeoutMs(params.config);
      if (idleTimeoutMs > 0) {
        activeSession.agent.streamFn = streamWithIdleTimeout(
          activeSession.agent.streamFn,
          idleTimeoutMs,
          (error) => idleTimeoutTrigger?.(error),
        );
      }

      try {
        if (parentForkContextMessages.length > 0) {
          activeSession.agent.replaceMessages(parentForkContextMessages as AgentMessage[]);
        }

        if (shouldEnableAnthropicThinkingRecovery(params.model.api)) {
          const originalMessageCount = activeSession.messages.length;
          const { messages, prefill } = sanitizeThinkingForRecovery(activeSession.messages);
          if (messages !== activeSession.messages) {
            activeSession.agent.replaceMessages(messages);
          }
          if (messages.length !== originalMessageCount) {
            log.warn(
              `[session-recovery] dropped latest assistant message with incomplete thinking: sessionId=${params.sessionId}`,
            );
          }
          if (prefill) {
            // Keeping the signed-thinking turn intact is a forward-compatibility
            // signal for future prefill-style recovery; the current fallback
            // still comes from the one-shot stream wrapper if Anthropic rejects
            // the replayed payload.
            log.warn(
              `[session-recovery] keeping latest assistant message with signed thinking and incomplete text: sessionId=${params.sessionId}`,
            );
          }
        }

        const prior = await sanitizeSessionHistory({
          messages: activeSession.messages,
          modelApi: params.model.api,
          modelId: params.modelId,
          provider: params.provider,
          allowedToolNames,
          config: params.config,
          workspaceDir: effectiveWorkspace,
          env: process.env,
          model: params.model,
          sessionManager,
          sessionId: params.sessionId,
          policy: transcriptPolicy,
        });
        cacheTrace?.recordStage("session:sanitized", { messages: prior });
        const assembleRuntimeContext = buildAfterTurnRuntimeContext({
          attempt: { ...params, surfacedSkillNames },
          workspaceDir: effectiveWorkspace,
          agentDir,
        });
        const validated = await validateReplayTurns({
          messages: prior,
          modelApi: params.model.api,
          modelId: params.modelId,
          provider: params.provider,
          config: params.config,
          workspaceDir: effectiveWorkspace,
          env: process.env,
          model: params.model,
          sessionId: params.sessionId,
          policy: transcriptPolicy,
        });
        const truncated = limitHistoryTurns(
          validated,
          getHistoryLimitFromSessionKey(params.sessionKey, params.config),
        );
        // Re-run tool_use/tool_result pairing repair after truncation, since
        // limitHistoryTurns can orphan tool_result blocks by removing the
        // assistant message that contained the matching tool_use.
        const limited = transcriptPolicy.repairToolUseResultPairing
          ? sanitizeToolUseResultPairing(truncated, {
              erroredAssistantResultPolicy: "drop",
            })
          : truncated;
        cacheTrace?.recordStage("session:limited", { messages: limited });
        if (limited.length > 0) {
          activeSession.agent.replaceMessages(limited);
        }

        if (params.memoryRuntime) {
          try {
            const assembled = await assembleAttemptMemoryRuntime({
              memoryRuntime: params.memoryRuntime,
              sessionId: params.sessionId,
              sessionKey: params.sessionKey,
              messages: activeSession.messages,
              tokenBudget: params.contextTokenBudget,
              modelId: params.modelId,
              ...(params.prompt !== undefined ? { prompt: params.prompt } : {}),
              runtimeContext: assembleRuntimeContext,
            });
            if (!assembled) {
              throw new Error("memory runtime assemble returned no result");
            }
            if (assembled.messages !== activeSession.messages) {
              activeSession.agent.replaceMessages(assembled.messages);
            }
            const assembledMemoryRecall = assembled.diagnostics?.memoryRecall;
            queryContext = {
              ...queryContext,
              messages: activeSession.messages,
              diagnostics: {
                ...queryContext.diagnostics,
                ...(assembledMemoryRecall ? { memoryRecall: assembledMemoryRecall } : {}),
              },
            };
            const assembledSystemContextSections = assembled.systemContextSections ?? [];
            if (assembledSystemContextSections.length > 0) {
              queryContext = {
                ...queryContext,
                systemContextSections: [
                  ...queryContext.systemContextSections,
                  ...assembledSystemContextSections,
                ],
                diagnostics: {
                  ...queryContext.diagnostics,
                  memorySources: assembledSystemContextSections.map((section) => section.id),
                  ...(assembledMemoryRecall ? { memoryRecall: assembledMemoryRecall } : {}),
                },
              };
              refreshQueryContextProviderRequest();
              systemPromptText = modelInput.systemPrompt;
              applySystemPromptOverrideToSession(activeSession, systemPromptText);
              log.debug(
                `memory runtime: attached structured system context (${assembledSystemContextSections.length} sections)`,
              );
            }
          } catch (assembleErr) {
            log.warn(
              `memory runtime assemble failed, using pipeline messages: ${String(assembleErr)}`,
            );
          }
        }
      } catch (err) {
        await flushPendingToolResultsAfterIdle({
          agent: activeSession?.agent,
          sessionManager,
          clearPendingOnTimeout: true,
        });
        activeSession.dispose();
        throw err;
      }

      let aborted = Boolean(params.abortSignal?.aborted);
      let yieldAborted = false;
      let timedOut = false;
      let timedOutDuringCompaction = false;
      let maxTurnsExceeded = false;
      const getAbortReason = (signal: AbortSignal): unknown =>
        "reason" in signal ? (signal as { reason?: unknown }).reason : undefined;
      const makeTimeoutAbortReason = (): Error => {
        const err = new Error("request timed out");
        err.name = "TimeoutError";
        return err;
      };
      const makeAbortError = (signal: AbortSignal): Error => {
        const reason = getAbortReason(signal);
        // If the reason is already an Error, preserve it to keep the original message
        // (e.g., "LLM idle timeout (60s): no response from model" instead of "aborted")
        if (reason instanceof Error) {
          const err = new Error(reason.message, { cause: reason });
          err.name = "AbortError";
          return err;
        }
        const err = reason ? new Error("aborted", { cause: reason }) : new Error("aborted");
        err.name = "AbortError";
        return err;
      };
      const abortCompaction = () => {
        if (!activeSession.isCompacting) {
          return;
        }
        try {
          activeSession.abortCompaction();
        } catch (err) {
          if (!isProbeSession) {
            log.warn(
              `embedded run abortCompaction failed: runId=${params.runId} sessionId=${params.sessionId} err=${String(err)}`,
            );
          }
        }
      };
      const abortRun = (isTimeout = false, reason?: unknown) => {
        aborted = true;
        if (isTimeout) {
          timedOut = true;
        }
        if (isTimeout) {
          runAbortController.abort(reason ?? makeTimeoutAbortReason());
        } else {
          runAbortController.abort(reason);
        }
        abortCompaction();
        void activeSession.abort();
      };
      const maxTurns =
        typeof params.maxTurns === "number" &&
        Number.isFinite(params.maxTurns) &&
        params.maxTurns > 0
          ? Math.max(1, Math.floor(params.maxTurns))
          : undefined;
      let unsubscribeTurnCap: (() => void) | undefined;
      if (typeof maxTurns === "number") {
        let startedTurns = 0;
        unsubscribeTurnCap = activeSession.subscribe((event) => {
          if (event.type !== "turn_start" || maxTurnsExceeded) {
            return;
          }
          startedTurns += 1;
          if (startedTurns <= maxTurns) {
            return;
          }
          maxTurnsExceeded = true;
          const reason = new Error(
            `max turns exceeded (${String(maxTurns)}) for session ${params.sessionId}`,
          );
          reason.name = "MaxTurnsExceededError";
          log.warn(
            `embedded run max-turns abort: runId=${params.runId} sessionId=${params.sessionId} maxTurns=${String(maxTurns)}`,
          );
          abortRun(false, reason);
        });
      }
      idleTimeoutTrigger = (error) => {
        abortRun(true, error);
      };
      const abortable = <T>(promise: Promise<T>): Promise<T> => {
        const signal = runAbortController.signal;
        if (signal.aborted) {
          return Promise.reject(makeAbortError(signal));
        }
        return new Promise<T>((resolve, reject) => {
          const onAbort = () => {
            signal.removeEventListener("abort", onAbort);
            reject(makeAbortError(signal));
          };
          signal.addEventListener("abort", onAbort, { once: true });
          promise.then(
            (value) => {
              signal.removeEventListener("abort", onAbort);
              resolve(value);
            },
            (err) => {
              signal.removeEventListener("abort", onAbort);
              reject(err);
            },
          );
        });
      };

      const subscription = subscribeEmbeddedPiSession({
        session: activeSession,
        runId: params.runId,
        hookRunner: getGlobalHookRunner() ?? undefined,
        verboseLevel: params.verboseLevel,
        reasoningMode: params.reasoningLevel ?? "off",
        toolResultFormat: params.toolResultFormat,
        shouldEmitToolResult: params.shouldEmitToolResult,
        shouldEmitToolOutput: params.shouldEmitToolOutput,
        onToolResult: params.onToolResult,
        onReasoningStream: params.onReasoningStream,
        onReasoningEnd: params.onReasoningEnd,
        onBlockReply: params.onBlockReply,
        onBlockReplyFlush: params.onBlockReplyFlush,
        blockReplyBreak: params.blockReplyBreak,
        blockReplyChunking: params.blockReplyChunking,
        onPartialReply: params.onPartialReply,
        onAssistantMessageStart: params.onAssistantMessageStart,
        onAgentEvent: params.onAgentEvent,
        enforceFinalTag: params.enforceFinalTag,
        silentExpected: params.silentExpected,
        config: params.config,
        sessionKey: sandboxSessionKey,
        sessionId: params.sessionId,
        agentId: sessionAgentId,
      });

      const {
        assistantTexts,
        toolMetas,
        unsubscribe,
        waitForCompactionRetry,
        isCompactionInFlight,
        getMessagingToolSentTexts,
        getMessagingToolSentMediaUrls,
        getMessagingToolSentTargets,
        getSuccessfulCronAdds,
        didSendViaMessagingTool,
        getLastToolError,
        getUsageTotals,
        getCompactionCount,
      } = subscription;

      const queueHandle: EmbeddedPiQueueHandle = {
        queueMessage: async (text: string) => {
          await activeSession.steer(text);
        },
        isStreaming: () => activeSession.isStreaming,
        isCompacting: () => subscription.isCompacting(),
        abort: abortRun,
      };
      setActiveEmbeddedRun(params.sessionId, queueHandle, params.sessionKey);

      let abortWarnTimer: NodeJS.Timeout | undefined;
      const isProbeSession = params.sessionId?.startsWith("probe-") ?? false;
      const compactionTimeoutMs = resolveCompactionTimeoutMs(params.config);
      let abortTimer: NodeJS.Timeout | undefined;
      let compactionGraceUsed = false;
      const scheduleAbortTimer = (delayMs: number, reason: "initial" | "compaction-grace") => {
        abortTimer = setTimeout(
          () => {
            const timeoutAction = resolveRunTimeoutDuringCompaction({
              isCompactionPendingOrRetrying: subscription.isCompacting(),
              isCompactionInFlight: activeSession.isCompacting,
              graceAlreadyUsed: compactionGraceUsed,
            });
            if (timeoutAction === "extend") {
              compactionGraceUsed = true;
              if (!isProbeSession) {
                log.warn(
                  `embedded run timeout reached during compaction; extending deadline: ` +
                    `runId=${params.runId} sessionId=${params.sessionId} extraMs=${compactionTimeoutMs}`,
                );
              }
              scheduleAbortTimer(compactionTimeoutMs, "compaction-grace");
              return;
            }

            if (!isProbeSession) {
              log.warn(
                reason === "compaction-grace"
                  ? `embedded run timeout after compaction grace: runId=${params.runId} sessionId=${params.sessionId} timeoutMs=${params.timeoutMs} compactionGraceMs=${compactionTimeoutMs}`
                  : `embedded run timeout: runId=${params.runId} sessionId=${params.sessionId} timeoutMs=${params.timeoutMs}`,
              );
            }
            if (
              shouldFlagCompactionTimeout({
                isTimeout: true,
                isCompactionPendingOrRetrying: subscription.isCompacting(),
                isCompactionInFlight: activeSession.isCompacting,
              })
            ) {
              timedOutDuringCompaction = true;
            }
            abortRun(true);
            if (!abortWarnTimer) {
              abortWarnTimer = setTimeout(() => {
                if (!activeSession.isStreaming) {
                  return;
                }
                if (!isProbeSession) {
                  log.warn(
                    `embedded run abort still streaming: runId=${params.runId} sessionId=${params.sessionId}`,
                  );
                }
              }, 10_000);
            }
          },
          Math.max(1, delayMs),
        );
      };
      scheduleAbortTimer(params.timeoutMs, "initial");

      let messagesSnapshot: AgentMessage[] = [];
      let sessionIdUsed = activeSession.sessionId;
      const onAbort = () => {
        const reason = params.abortSignal ? getAbortReason(params.abortSignal) : undefined;
        const timeout = reason ? isTimeoutError(reason) : false;
        if (
          shouldFlagCompactionTimeout({
            isTimeout: timeout,
            isCompactionPendingOrRetrying: subscription.isCompacting(),
            isCompactionInFlight: activeSession.isCompacting,
          })
        ) {
          timedOutDuringCompaction = true;
        }
        abortRun(timeout, reason);
      };
      if (params.abortSignal) {
        if (params.abortSignal.aborted) {
          onAbort();
        } else {
          params.abortSignal.addEventListener("abort", onAbort, {
            once: true,
          });
        }
      }

      // Hook runner was already obtained earlier before tool creation
      const hookAgentId = sessionAgentId;

      let promptError: unknown = null;
      let promptErrorSource: "prompt" | "compaction" | null = null;
      const prePromptMessageCount = activeSession.messages.length;
      try {
        const promptStartedAt = Date.now();

        // Run before_prompt_build hooks to allow plugins to inject prompt context.
        queryContext = {
          ...queryContext,
          messages: activeSession.messages,
          userPrompt: appendBootstrapPromptWarning(params.prompt, bootstrapPromptWarning.lines, {
            preserveExactPrompt: heartbeatPrompt,
          }),
        };
        const hookCtx = {
          runId: params.runId,
          agentId: hookAgentId,
          sessionKey: params.sessionKey,
          sessionId: params.sessionId,
          workspaceDir: params.workspaceDir,
          messageProvider: params.messageProvider ?? undefined,
          trigger: params.trigger,
          channelId: params.messageChannel ?? params.messageProvider ?? undefined,
        };
        const hookResult = await resolvePromptBuildHookResult({
          prompt: params.prompt,
          messages: activeSession.messages,
          hookCtx,
          hookRunner,
        });
        if (hookResult?.queryContextPatch) {
          const hookMutation = {
            hook: "before_prompt_build",
            prependUserContextSections:
              hookResult.queryContextPatch.prependUserContextSections?.length ?? 0,
            appendUserContextSections:
              hookResult.queryContextPatch.appendUserContextSections?.length ?? 0,
            prependSystemContextSections:
              hookResult.queryContextPatch.prependSystemContextSections?.length ?? 0,
            appendSystemContextSections:
              hookResult.queryContextPatch.appendSystemContextSections?.length ?? 0,
            replaceSystemPromptSections:
              hookResult.queryContextPatch.replaceSystemPromptSections?.length ?? 0,
            clearSystemContextSections:
              hookResult.queryContextPatch.clearSystemContextSections === true,
            replaceUserPrompt: typeof hookResult.queryContextPatch.replaceUserPrompt === "string",
          };
          queryContext = applyQueryContextPatch(queryContext, hookResult.queryContextPatch);
          queryContext = {
            ...queryContext,
            diagnostics: {
              ...queryContext.diagnostics,
              hookMutations: [...(queryContext.diagnostics?.hookMutations ?? []), hookMutation],
            },
          };
          refreshQueryContextProviderRequest();
          systemPromptText = modelInput.systemPrompt;
          applySystemPromptOverrideToSession(activeSession, systemPromptText);
          const prependUserCount =
            hookResult.queryContextPatch.prependUserContextSections?.length ?? 0;
          const prependSystemCount =
            hookResult.queryContextPatch.prependSystemContextSections?.length ?? 0;
          const appendSystemCount =
            hookResult.queryContextPatch.appendSystemContextSections?.length ?? 0;
          if (prependUserCount > 0) {
            log.debug(
              `hooks: attached structured user context (${String(prependUserCount)} sections)`,
            );
          }
          if (prependSystemCount > 0 || appendSystemCount > 0) {
            log.debug(
              `hooks: attached structured system context (${String(prependSystemCount)}+${String(appendSystemCount)} sections)`,
            );
          }
          if (
            Array.isArray(hookResult.queryContextPatch.replaceSystemPromptSections) &&
            hookResult.queryContextPatch.replaceSystemPromptSections.length > 0
          ) {
            log.debug(
              `hooks: applied systemPrompt override (${hookResult.queryContextPatch.replaceSystemPromptSections.length} sections)`,
            );
          }
        }
        const effectivePrompt = modelInput.prompt;
        const cacheDecisionCodes = resolvePromptCacheDecisionCodes({
          hasInheritedPromptEnvelope: false,
          canReuseParentPrefix: false,
          mismatchCount: 0,
          skipCacheWrite: specialAgentStreamParams?.skipCacheWrite === true,
          cacheRetention: specialAgentStreamParams?.cacheRetention,
          hasCacheIdentity: Boolean(providerRequestSnapshot.cacheIdentity),
        });

        log.debug(`embedded run prompt start: runId=${params.runId} sessionId=${params.sessionId}`);
        cacheTrace?.recordStage("prompt:before", {
          prompt: effectivePrompt,
          messages: activeSession.messages,
        });

        // Repair orphaned trailing user messages so new prompts don't violate role ordering.
        const leafEntry = sessionManager.getLeafEntry();
        if (leafEntry?.type === "message" && leafEntry.message.role === "user") {
          if (leafEntry.parentId) {
            sessionManager.branch(leafEntry.parentId);
          } else {
            sessionManager.resetLeaf();
          }
          const sessionContext = sessionManager.buildSessionContext();
          activeSession.agent.replaceMessages(sessionContext.messages);
          log.warn(
            `Removed orphaned user message to prevent consecutive user turns. ` +
              `runId=${params.runId} sessionId=${params.sessionId}`,
          );
        }
        const transcriptLeafId =
          (sessionManager.getLeafEntry() as { id?: string } | null | undefined)?.id ?? null;

        try {
          // Idempotent cleanup for legacy sessions with persisted image payloads.
          // Called each run; only mutates already-answered user turns that still carry image blocks.
          const didPruneImages = pruneProcessedHistoryImages(activeSession.messages);
          if (didPruneImages) {
            activeSession.agent.replaceMessages(activeSession.messages);
          }

          // Detect and load images referenced in the prompt for vision-capable models.
          // Images are prompt-local only (pi-like behavior).
          const imageResult = await detectAndLoadPromptImages({
            prompt: effectivePrompt,
            workspaceDir: effectiveWorkspace,
            model: params.model,
            existingImages: params.images,
            imageOrder: params.imageOrder,
            maxBytes: MAX_IMAGE_BYTES,
            maxDimensionPx: resolveImageSanitizationLimits(params.config).maxDimensionPx,
            workspaceOnly: effectiveFsWorkspaceOnly,
            // Enforce sandbox path restrictions when sandbox is enabled
            sandbox:
              sandbox?.enabled && sandbox?.fsBridge
                ? { root: sandbox.workspaceDir, bridge: sandbox.fsBridge }
                : undefined,
          });

          cacheTrace?.recordStage("prompt:images", {
            prompt: effectivePrompt,
            messages: activeSession.messages,
            note: `images: prompt=${imageResult.images.length}`,
          });
          queryContext = {
            ...queryContext,
            messages: activeSession.messages,
          };
          refreshQueryContextProviderRequest();
          const queryContextDiagnostics: QueryContextDiagnostics = {
            ...modelInput.diagnostics,
            queryContextHash: modelInput.queryContextHash,
            sectionTokenUsage: providerRequestSnapshot.sectionTokenUsage,
            providerRequestSnapshot,
            decisionCodes: {
              providerSelection: "provider_model_selected",
              ...cacheDecisionCodes,
              ...modelInput.diagnostics?.memoryRecall?.decisionCodes,
            },
          };

          // Diagnostic: log context sizes before prompt to help debug early overflow errors.
          if (log.isEnabled("debug")) {
            const msgCount = activeSession.messages.length;
            const systemLen = systemPromptText?.length ?? 0;
            const promptLen = effectivePrompt.length;
            const sessionSummary = summarizeSessionContext(activeSession.messages);
            log.debug(
              `[context-diag] pre-prompt: sessionKey=${params.sessionKey ?? params.sessionId} ` +
                `messages=${msgCount} roleCounts=${sessionSummary.roleCounts} ` +
                `historyTextChars=${sessionSummary.totalTextChars} ` +
                `maxMessageTextChars=${sessionSummary.maxMessageTextChars} ` +
                `historyImageBlocks=${sessionSummary.totalImageBlocks} ` +
                `systemPromptChars=${systemLen} promptChars=${promptLen} ` +
                `promptImages=${imageResult.images.length} ` +
                `provider=${params.provider}/${params.modelId} sessionFile=${params.sessionFile}`,
            );
          }

          captureModelVisibleContext({
            config: params.config,
            runId: params.runId,
            sessionId: params.sessionId,
            sessionKey: params.sessionKey,
            agentId: hookAgentId,
            prompt: effectivePrompt,
            systemPrompt: modelInput.systemPrompt,
            systemContextSections: queryContext.systemContextSections,
            messages: activeSession.messages,
            tools: effectiveTools,
            provider: params.provider,
            model: params.modelId,
            systemPromptReport,
            queryContextDiagnostics,
            providerRequestSnapshot,
            images: {
              count: imageResult.images.length,
              detectedRefs: imageResult.detectedRefs,
            },
            metadata: {
              workspaceDir: effectiveWorkspace,
              trigger: params.trigger ?? null,
            },
          }).catch((err) => {
            log.warn(`context archive model-visible capture failed: ${String(err)}`);
          });

          if (hookRunner?.hasHooks("llm_input")) {
            hookRunner
              .runLlmInput(
                {
                  runId: params.runId,
                  sessionId: params.sessionId,
                  provider: params.provider,
                  model: params.modelId,
                  systemPrompt: modelInput.systemPrompt,
                  prompt: effectivePrompt,
                  historyMessages: activeSession.messages,
                  imagesCount: imageResult.images.length,
                },
                {
                  runId: params.runId,
                  agentId: hookAgentId,
                  sessionKey: params.sessionKey,
                  sessionId: params.sessionId,
                  workspaceDir: params.workspaceDir,
                  messageProvider: params.messageProvider ?? undefined,
                  trigger: params.trigger,
                  channelId: params.messageChannel ?? params.messageProvider ?? undefined,
                },
              )
              .catch((err) => {
                log.warn(`llm_input hook failed: ${String(err)}`);
              });
          }

          const btwSnapshotMessages = activeSession.messages.slice(-MAX_BTW_SNAPSHOT_MESSAGES);
          updateActiveEmbeddedRunSnapshot(params.sessionId, {
            transcriptLeafId,
            messages: btwSnapshotMessages,
            inFlightPrompt: effectivePrompt,
          });

          // Only pass images option if there are actually images to pass
          // This avoids potential issues with models that don't expect the images parameter
          if (imageResult.images.length > 0) {
            await abortable(activeSession.prompt(effectivePrompt, { images: imageResult.images }));
          } else {
            await abortable(activeSession.prompt(effectivePrompt));
          }
        } catch (err) {
          // Yield-triggered abort is intentional — treat as clean stop, not error.
          // Check the abort reason to distinguish from external aborts (timeout, user cancel)
          // that may race after yieldDetected is set.
          yieldAborted =
            yieldDetected &&
            isRunnerAbortError(err) &&
            err instanceof Error &&
            err.cause === "sessions_yield";
          if (yieldAborted) {
            aborted = false;
            // Ensure the session abort has mostly settled before proceeding, but
            // don't deadlock the whole run if the underlying session abort hangs.
            await waitForSessionsYieldAbortSettle({
              settlePromise: yieldAbortSettled,
              runId: params.runId,
              sessionId: params.sessionId,
            });
            stripSessionsYieldArtifacts(activeSession);
            if (yieldMessage) {
              await persistSessionsYieldContextMessage(activeSession, yieldMessage);
            }
          } else {
            promptError = err;
            promptErrorSource = "prompt";
          }
        } finally {
          unsubscribeTurnCap?.();
          log.debug(
            `embedded run prompt end: runId=${params.runId} sessionId=${params.sessionId} durationMs=${Date.now() - promptStartedAt}`,
          );
        }

        // Capture snapshot before compaction wait so we have complete messages if timeout occurs
        // Check compaction state before and after to avoid race condition where compaction starts during capture
        // Use session state (not subscription) for snapshot decisions - need instantaneous compaction status
        const wasCompactingBefore = activeSession.isCompacting;
        const snapshot = activeSession.messages.slice();
        const wasCompactingAfter = activeSession.isCompacting;
        // Only trust snapshot if compaction wasn't running before or after capture
        const preCompactionSnapshot = wasCompactingBefore || wasCompactingAfter ? null : snapshot;
        const preCompactionSessionId = activeSession.sessionId;
        const COMPACTION_RETRY_AGGREGATE_TIMEOUT_MS = 60_000;

        try {
          // Flush buffered block replies before waiting for compaction so the
          // user receives the assistant response immediately.  Without this,
          // coalesced/buffered blocks stay in the pipeline until compaction
          // finishes — which can take minutes on large contexts (#35074).
          if (params.onBlockReplyFlush) {
            await params.onBlockReplyFlush();
          }

          // Skip compaction wait when yield aborted the run — the signal is
          // already tripped and abortable() would immediately reject.
          const compactionRetryWait = yieldAborted
            ? { timedOut: false }
            : await waitForCompactionRetryWithAggregateTimeout({
                waitForCompactionRetry,
                abortable,
                aggregateTimeoutMs: COMPACTION_RETRY_AGGREGATE_TIMEOUT_MS,
                isCompactionStillInFlight: isCompactionInFlight,
              });
          if (compactionRetryWait.timedOut) {
            timedOutDuringCompaction = true;
            if (!isProbeSession) {
              log.warn(
                `compaction retry aggregate timeout (${COMPACTION_RETRY_AGGREGATE_TIMEOUT_MS}ms): ` +
                  `proceeding with pre-compaction state runId=${params.runId} sessionId=${params.sessionId}`,
              );
            }
          }
        } catch (err) {
          if (isRunnerAbortError(err)) {
            if (!promptError) {
              promptError = err;
              promptErrorSource = "compaction";
            }
            if (!isProbeSession) {
              log.debug(
                `compaction wait aborted: runId=${params.runId} sessionId=${params.sessionId}`,
              );
            }
          } else {
            throw err;
          }
        }

        // Check if ANY compaction occurred during the entire attempt (prompt + retry).
        // Using a cumulative count (> 0) instead of a delta check avoids missing
        // compactions that complete during activeSession.prompt() before the delta
        // baseline is sampled.
        const compactionOccurredThisAttempt = getCompactionCount() > 0;
        // Append cache-TTL timestamp AFTER prompt + compaction retry completes.
        // Previously this was before the prompt, which caused a custom entry to be
        // inserted between compaction and the next prompt — breaking the
        // prepareCompaction() guard that checks the last entry type, leading to
        // double-compaction. See: https://github.com/qianleigood/crawclaw/issues/9282
        // Skip when timed out during compaction — session state may be inconsistent.
        // Also skip when compaction ran this attempt — appending a custom entry
        // after compaction would break the guard again. See: #28491
        appendAttemptCacheTtlIfNeeded({
          sessionManager,
          timedOutDuringCompaction,
          compactionOccurredThisAttempt,
          config: params.config,
          provider: params.provider,
          modelId: params.modelId,
          isCacheTtlEligibleProvider,
        });

        // If timeout occurred during compaction, use pre-compaction snapshot when available
        // (compaction restructures messages but does not add user/assistant turns).
        const snapshotSelection = selectCompactionTimeoutSnapshot({
          timedOutDuringCompaction,
          preCompactionSnapshot,
          preCompactionSessionId,
          currentSnapshot: activeSession.messages.slice(),
          currentSessionId: activeSession.sessionId,
        });
        if (timedOutDuringCompaction) {
          if (!isProbeSession) {
            log.warn(
              `using ${snapshotSelection.source} snapshot: timed out during compaction runId=${params.runId} sessionId=${params.sessionId}`,
            );
          }
        }
        messagesSnapshot = snapshotSelection.messagesSnapshot;
        sessionIdUsed = snapshotSelection.sessionIdUsed;

        if (promptError && promptErrorSource === "prompt" && !compactionOccurredThisAttempt) {
          try {
            sessionManager.appendCustomEntry("crawclaw:prompt-error", {
              timestamp: Date.now(),
              runId: params.runId,
              sessionId: params.sessionId,
              provider: params.provider,
              model: params.modelId,
              api: params.model.api,
              error: describeUnknownError(promptError),
            });
          } catch (entryErr) {
            log.warn(`failed to persist prompt error entry: ${String(entryErr)}`);
          }
        }

        // Let the active memory runtime run its post-turn lifecycle.
        if (params.memoryRuntime) {
          const afterTurnRuntimeContext = buildAfterTurnRuntimeContext({
            attempt: { ...params, surfacedSkillNames },
            workspaceDir: effectiveWorkspace,
            agentDir,
          });
          await finalizeAttemptMemoryRuntimeTurn({
            memoryRuntime: params.memoryRuntime,
            runId: params.runId,
            promptError: Boolean(promptError),
            aborted,
            yieldAborted,
            sessionIdUsed,
            sessionKey: params.sessionKey,
            sessionFile: params.sessionFile,
            messagesSnapshot,
            parentForkContext: buildSpecialAgentParentForkContextFromModelInput({
              parentRunId: params.runId,
              provider: params.provider,
              modelId: params.modelId,
              modelApi: params.model.api,
              modelInput,
              forkContextMessages: messagesSnapshot,
            }),
            prePromptMessageCount,
            tokenBudget: params.contextTokenBudget,
            runtimeContext: afterTurnRuntimeContext,
            runMaintenance: async (contextParams) =>
              await runMemoryRuntimeMaintenance({
                memoryRuntime: contextParams.memoryRuntime as never,
                sessionId: contextParams.sessionId,
                sessionKey: contextParams.sessionKey,
                sessionFile: contextParams.sessionFile,
                reason: contextParams.reason,
                sessionManager: contextParams.sessionManager as never,
                runtimeContext: contextParams.runtimeContext,
              }),
            sessionManager,
            warn: (message) => log.warn(message),
          });
        }

        cacheTrace?.recordStage("session:after", {
          messages: messagesSnapshot,
          decisionCodes: {
            runOutcome: timedOutDuringCompaction
              ? "run_outcome_compaction_timeout"
              : promptError
                ? "run_outcome_prompt_error"
                : "run_outcome_success",
            ...cacheDecisionCodes,
          },
          note: timedOutDuringCompaction
            ? "compaction timeout"
            : promptError
              ? "prompt error"
              : undefined,
        });
        anthropicPayloadLogger?.recordUsage(messagesSnapshot, promptError);

        // Run agent_end hooks to allow plugins to analyze the conversation
        // This is fire-and-forget, so we don't await
        // Run even on compaction timeout so plugins can log/cleanup
        if (hookRunner?.hasHooks("agent_end")) {
          hookRunner
            .runAgentEnd(
              {
                messages: messagesSnapshot,
                success: !aborted && !promptError,
                error: promptError ? describeUnknownError(promptError) : undefined,
                durationMs: Date.now() - promptStartedAt,
              },
              {
                runId: params.runId,
                agentId: hookAgentId,
                sessionKey: params.sessionKey,
                sessionId: params.sessionId,
                workspaceDir: params.workspaceDir,
                messageProvider: params.messageProvider ?? undefined,
                trigger: params.trigger,
                channelId: params.messageChannel ?? params.messageProvider ?? undefined,
              },
            )
            .catch((err) => {
              log.warn(`agent_end hook failed: ${err}`);
            });
        }
      } finally {
        clearTimeout(abortTimer);
        if (abortWarnTimer) {
          clearTimeout(abortWarnTimer);
        }
        if (!isProbeSession && (aborted || timedOut) && !timedOutDuringCompaction) {
          log.debug(
            `run cleanup: runId=${params.runId} sessionId=${params.sessionId} aborted=${aborted} timedOut=${timedOut}`,
          );
        }
        try {
          unsubscribe();
        } catch (err) {
          // unsubscribe() should never throw; if it does, it indicates a serious bug.
          // Log at error level to ensure visibility, but don't rethrow in finally block
          // as it would mask any exception from the try block above.
          log.error(
            `CRITICAL: unsubscribe failed, possible resource leak: runId=${params.runId} ${String(err)}`,
          );
        }
        clearActiveEmbeddedRun(params.sessionId, queueHandle, params.sessionKey);
        params.abortSignal?.removeEventListener?.("abort", onAbort);
      }

      const lastAssistant = messagesSnapshot
        .slice()
        .toReversed()
        .find((m) => m.role === "assistant");

      const toolMetasNormalized = toolMetas
        .filter(
          (entry): entry is { toolName: string; meta?: string } =>
            typeof entry.toolName === "string" && entry.toolName.trim().length > 0,
        )
        .map((entry) => ({ toolName: entry.toolName, meta: entry.meta }));

      if (hookRunner?.hasHooks("llm_output")) {
        hookRunner
          .runLlmOutput(
            {
              runId: params.runId,
              sessionId: params.sessionId,
              provider: params.provider,
              model: params.modelId,
              assistantTexts,
              lastAssistant,
              usage: getUsageTotals(),
            },
            {
              runId: params.runId,
              agentId: hookAgentId,
              sessionKey: params.sessionKey,
              sessionId: params.sessionId,
              workspaceDir: params.workspaceDir,
              messageProvider: params.messageProvider ?? undefined,
              trigger: params.trigger,
              channelId: params.messageChannel ?? params.messageProvider ?? undefined,
            },
          )
          .catch((err) => {
            log.warn(`llm_output hook failed: ${String(err)}`);
          });
      }

      const finalSkillExposureState = getSkillExposureState({
        sessionId: params.sessionId,
        sessionKey: params.sessionKey,
      });
      return {
        aborted,
        timedOut,
        timedOutDuringCompaction,
        promptError,
        sessionIdUsed,
        bootstrapPromptWarningSignaturesSeen: bootstrapPromptWarning.warningSignaturesSeen,
        bootstrapPromptWarningSignature: bootstrapPromptWarning.signature,
        systemPromptReport,
        skillExposureState: finalSkillExposureState
          ? {
              surfacedSkillNames: finalSkillExposureState.surfacedSkillNames
                ? [...finalSkillExposureState.surfacedSkillNames]
                : undefined,
              loadedSkillNames: finalSkillExposureState.loadedSkillNames
                ? [...finalSkillExposureState.loadedSkillNames]
                : undefined,
              discoveredSkillNames: finalSkillExposureState.discoveredSkillNames
                ? [...finalSkillExposureState.discoveredSkillNames]
                : undefined,
              discoverCount: finalSkillExposureState.discoverCount,
              discoverBudgetRemaining: finalSkillExposureState.discoverBudgetRemaining,
            }
          : undefined,
        messagesSnapshot,
        assistantTexts,
        toolMetas: toolMetasNormalized,
        lastAssistant,
        lastToolError: getLastToolError?.(),
        didSendViaMessagingTool: didSendViaMessagingTool(),
        messagingToolSentTexts: getMessagingToolSentTexts(),
        messagingToolSentMediaUrls: getMessagingToolSentMediaUrls(),
        messagingToolSentTargets: getMessagingToolSentTargets(),
        successfulCronAdds: getSuccessfulCronAdds(),
        cloudCodeAssistFormatError: Boolean(
          lastAssistant?.errorMessage && isCloudCodeAssistFormatError(lastAssistant.errorMessage),
        ),
        attemptUsage: getUsageTotals(),
        compactionCount: getCompactionCount(),
        // Client tool call detected (OpenResponses hosted tools)
        clientToolCall: clientToolCallDetected ?? undefined,
        yieldDetected: yieldDetected || undefined,
      };
    } finally {
      // Always tear down the session (and release the lock) before we leave this attempt.
      //
      // BUGFIX: Wait for the agent to be truly idle before flushing pending tool results.
      // pi-agent-core's auto-retry resolves waitForRetry() on assistant message receipt,
      // *before* tool execution completes in the retried agent loop. Without this wait,
      // flushPendingToolResults() fires while tools are still executing, inserting
      // synthetic "missing tool result" errors and causing silent agent failures.
      // See: https://github.com/qianleigood/crawclaw/issues/8643
      removeToolResultContextGuard?.();
      await flushPendingToolResultsAfterIdle({
        agent: session?.agent,
        sessionManager,
        clearPendingOnTimeout: true,
      });
      session?.dispose();
      releaseWsSession(params.sessionId);
      await bundleLspRuntime?.dispose();
      await sessionLock.release();
    }
  } finally {
    restoreSkillEnv?.();
  }
}
