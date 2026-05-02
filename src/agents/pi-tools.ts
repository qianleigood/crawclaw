import { createCodingTools, createReadTool } from "@mariozechner/pi-coding-agent";
import type { CrawClawConfig } from "../config/config.js";
import {
  loadSessionStore,
  resolveSessionStoreEntry,
  resolveStorePath,
} from "../config/sessions.js";
import type { ModelCompatConfig } from "../config/types.models.js";
import type { ToolLoopDetectionConfig } from "../config/types.tools.js";
import { resolveMergedSafeBinProfileFixtures } from "../infra/exec-safe-bin-runtime-policy.js";
import { logWarn } from "../logger.js";
import { resolveDurableMemoryScope } from "../memory/durable/scope.js";
import { SESSION_SUMMARY_SPAWN_SOURCE } from "../memory/session-summary/agent-runner.js";
import { getPluginToolMeta } from "../plugins/tools.js";
import { isSubagentSessionKey } from "../routing/session-key.js";
import { resolveGatewayMessageChannel } from "../utils/message-channel.js";
import { resolveAgentConfig, resolveAgentIdFromSessionKey } from "./agent-scope.js";
import { createApplyPatchTool } from "./apply-patch.js";
import {
  createExecTool,
  createProcessTool,
  type ExecToolDefaults,
  type ProcessToolDefaults,
} from "./bash-tools.js";
import { listChannelAgentTools } from "./channel-tools.js";
import { shouldSuppressManagedWebSearchTool } from "./codex-native-web-search.js";
import { createCrawClawTools } from "./crawclaw-tools.js";
import { resolveImageSanitizationLimits } from "./image-sanitization.js";
import type { ModelAuthMode } from "./model-auth.js";
import { wrapToolWithAbortSignal } from "./pi-tools.abort.js";
import {
  type SpecialToolGuardContext,
  wrapToolWithBeforeToolCallHook,
} from "./pi-tools.before-tool-call.js";
import {
  isToolAllowedByPolicies,
  resolveEffectiveToolPolicy,
  resolveGroupToolPolicy,
  resolveSubagentToolPolicyForSession,
} from "./pi-tools.policy.js";
import {
  assertRequiredParams,
  createHostWorkspaceEditTool,
  createHostWorkspaceWriteTool,
  createCrawClawReadTool,
  createSandboxedEditTool,
  createSandboxedReadTool,
  createSandboxedWriteTool,
  normalizeToolParams,
  patchToolSchemaForClaudeCompatibility,
  wrapToolMemoryFlushAppendOnlyWrite,
  wrapToolWorkspaceRootGuard,
  wrapToolWorkspaceRootGuardWithOptions,
  wrapToolParamNormalization,
} from "./pi-tools.read.js";
import { normalizeToolParameters } from "./pi-tools.schema.js";
import type { AnyAgentTool } from "./pi-tools.types.js";
import type { SandboxContext } from "./sandbox.js";
import { cleanSchemaForGemini } from "./schema/clean-for-gemini.js";
import type { SkillSemanticRetriever } from "./skills/discovery.js";
import { createSkillSemanticRetrieverFromConfig } from "./skills/semantic-retrieval.js";
import { resolveSpecialAgentDefinitionBySpawnSource } from "./special/runtime/registry.js";
import { createToolFsPolicy, resolveToolFsConfig } from "./tool-fs-policy.js";
import {
  applyToolPolicyPipeline,
  buildDefaultToolPolicyPipelineSteps,
} from "./tool-policy-pipeline.js";
import {
  applyOwnerOnlyToolPolicy,
  collectExplicitAllowlist,
  mergeAlsoAllowPolicy,
  resolveToolProfilePolicy,
} from "./tool-policy.js";
import { createDiscoverSkillsTool } from "./tools/discover-skills-tool.js";
import { createSessionSummaryTools } from "./tools/session-summary-tools.js";
import { resolveWorkspaceRoot } from "./workspace-dir.js";

function isOpenAIProvider(provider?: string) {
  const normalized = provider?.trim().toLowerCase();
  return normalized === "openai" || normalized === "openai-codex";
}

const TOOL_DENY_BY_MESSAGE_PROVIDER: Readonly<Record<string, readonly string[]>> = {
  voice: ["tts"],
};
const TOOL_ALLOW_BY_MESSAGE_PROVIDER: Readonly<Record<string, readonly string[]>> = {
  node: ["canvas", "discover_skills", "image", "pdf", "tts", "web_fetch", "web_search"],
};
const MEMORY_FLUSH_ALLOWED_TOOL_NAMES = new Set(["read", "write"]);

function normalizeMessageProvider(messageProvider?: string): string | undefined {
  const normalized = messageProvider?.trim().toLowerCase();
  return normalized && normalized.length > 0 ? normalized : undefined;
}

function resolveSessionSpawnContext(params: {
  cfg?: CrawClawConfig;
  sessionKey?: string;
  specialAgentSpawnSource?: string;
  specialDurableMemoryScope?: {
    agentId?: string | null;
    channel?: string | null;
    userId?: string | null;
  };
  specialSessionSummaryTarget?: {
    agentId: string;
    sessionId: string;
  };
}): {
  spawnSource?: string;
  durableMemoryScope?: {
    agentId?: string;
    channel?: string;
    userId?: string;
  };
  sessionSummaryTarget?: {
    agentId: string;
    sessionId: string;
  };
} {
  const sessionKey = params.sessionKey?.trim();
  const explicitSpawnSource = params.specialAgentSpawnSource?.trim() || undefined;
  const explicitDurableMemoryScope = (() => {
    const agentId = params.specialDurableMemoryScope?.agentId?.trim();
    const channel = params.specialDurableMemoryScope?.channel?.trim();
    const userId = params.specialDurableMemoryScope?.userId?.trim();
    if (!agentId || !channel || !userId) {
      return undefined;
    }
    return { agentId, channel, userId };
  })();
  const explicitSessionSummaryTarget =
    params.specialSessionSummaryTarget &&
    params.specialSessionSummaryTarget.agentId.trim() &&
    params.specialSessionSummaryTarget.sessionId.trim()
      ? {
          agentId: params.specialSessionSummaryTarget.agentId.trim(),
          sessionId: params.specialSessionSummaryTarget.sessionId.trim(),
        }
      : undefined;
  if (!params.cfg || !sessionKey) {
    return {
      ...(explicitSpawnSource ? { spawnSource: explicitSpawnSource } : {}),
      ...(explicitDurableMemoryScope ? { durableMemoryScope: explicitDurableMemoryScope } : {}),
      ...(explicitSessionSummaryTarget
        ? { sessionSummaryTarget: explicitSessionSummaryTarget }
        : {}),
    };
  }
  const agentId = resolveAgentIdFromSessionKey(sessionKey);
  const storePath = resolveStorePath(params.cfg.session?.store, { agentId });
  const store = loadSessionStore(storePath);
  const resolved = resolveSessionStoreEntry({
    store,
    sessionKey,
  });
  const spawnSource = resolved.existing?.spawnSource?.trim();
  const durableMemoryScope = (() => {
    const scope = resolved.existing?.durableMemoryScope;
    const scopeAgentId = scope?.agentId?.trim();
    const channel = scope?.channel?.trim();
    const userId = scope?.userId?.trim();
    if (!scopeAgentId || !channel || !userId) {
      return undefined;
    }
    return {
      agentId: scopeAgentId,
      channel,
      userId,
    };
  })();
  const sessionSummaryTarget = (() => {
    const targetSessionKey = resolved.existing?.parentSessionKey?.trim() || undefined;
    const targetEntry = targetSessionKey
      ? resolveSessionStoreEntry({ store, sessionKey: targetSessionKey }).existing
      : resolved.existing;
    const targetSessionId = targetEntry?.sessionId?.trim();
    const targetAgentId = resolveAgentIdFromSessionKey(targetSessionKey ?? sessionKey);
    if (!targetSessionId || !targetAgentId) {
      return undefined;
    }
    return { agentId: targetAgentId, sessionId: targetSessionId };
  })();
  return {
    ...((explicitSpawnSource ?? spawnSource)
      ? { spawnSource: explicitSpawnSource ?? spawnSource }
      : {}),
    ...((explicitDurableMemoryScope ?? durableMemoryScope)
      ? { durableMemoryScope: explicitDurableMemoryScope ?? durableMemoryScope }
      : {}),
    ...((explicitSessionSummaryTarget ?? sessionSummaryTarget)
      ? { sessionSummaryTarget: explicitSessionSummaryTarget ?? sessionSummaryTarget }
      : {}),
  };
}

function applyMessageProviderToolPolicy(
  tools: AnyAgentTool[],
  messageProvider?: string,
): AnyAgentTool[] {
  const normalizedProvider = normalizeMessageProvider(messageProvider);
  if (!normalizedProvider) {
    return tools;
  }
  const allowedTools = TOOL_ALLOW_BY_MESSAGE_PROVIDER[normalizedProvider];
  if (allowedTools && allowedTools.length > 0) {
    const allowedSet = new Set(allowedTools);
    return tools.filter((tool) => allowedSet.has(tool.name));
  }
  const deniedTools = TOOL_DENY_BY_MESSAGE_PROVIDER[normalizedProvider];
  if (!deniedTools || deniedTools.length === 0) {
    return tools;
  }
  const deniedSet = new Set(deniedTools);
  return tools.filter((tool) => !deniedSet.has(tool.name));
}

function applyModelProviderToolPolicy(
  tools: AnyAgentTool[],
  params?: {
    config?: CrawClawConfig;
    modelProvider?: string;
    modelApi?: string;
    modelId?: string;
    agentDir?: string;
    modelCompat?: ModelCompatConfig;
  },
): AnyAgentTool[] {
  if (
    shouldSuppressManagedWebSearchTool({
      config: params?.config,
      modelProvider: params?.modelProvider,
      modelApi: params?.modelApi,
      agentDir: params?.agentDir,
    })
  ) {
    return tools.filter((tool) => tool.name !== "web_search");
  }

  return tools;
}

function isApplyPatchAllowedForModel(params: {
  modelProvider?: string;
  modelId?: string;
  allowModels?: string[];
}) {
  const allowModels = Array.isArray(params.allowModels) ? params.allowModels : [];
  if (allowModels.length === 0) {
    return true;
  }
  const modelId = params.modelId?.trim();
  if (!modelId) {
    return false;
  }
  const normalizedModelId = modelId.toLowerCase();
  const provider = params.modelProvider?.trim().toLowerCase();
  const normalizedFull =
    provider && !normalizedModelId.includes("/")
      ? `${provider}/${normalizedModelId}`
      : normalizedModelId;
  return allowModels.some((entry) => {
    const normalized = entry.trim().toLowerCase();
    if (!normalized) {
      return false;
    }
    return normalized === normalizedModelId || normalized === normalizedFull;
  });
}

function resolveExecConfig(params: { cfg?: CrawClawConfig; agentId?: string }) {
  const cfg = params.cfg;
  const globalExec = cfg?.tools?.exec;
  const agentExec =
    cfg && params.agentId ? resolveAgentConfig(cfg, params.agentId)?.tools?.exec : undefined;
  return {
    host: agentExec?.host ?? globalExec?.host,
    security: agentExec?.security ?? globalExec?.security,
    ask: agentExec?.ask ?? globalExec?.ask,
    node: agentExec?.node ?? globalExec?.node,
    pathPrepend: agentExec?.pathPrepend ?? globalExec?.pathPrepend,
    safeBins: agentExec?.safeBins ?? globalExec?.safeBins,
    strictInlineEval: agentExec?.strictInlineEval ?? globalExec?.strictInlineEval,
    safeBinTrustedDirs: agentExec?.safeBinTrustedDirs ?? globalExec?.safeBinTrustedDirs,
    safeBinProfiles: resolveMergedSafeBinProfileFixtures({
      global: globalExec,
      local: agentExec,
    }),
    backgroundMs: agentExec?.backgroundMs ?? globalExec?.backgroundMs,
    timeoutSec: agentExec?.timeoutSec ?? globalExec?.timeoutSec,
    approvalRunningNoticeMs:
      agentExec?.approvalRunningNoticeMs ?? globalExec?.approvalRunningNoticeMs,
    cleanupMs: agentExec?.cleanupMs ?? globalExec?.cleanupMs,
    notifyOnExit: agentExec?.notifyOnExit ?? globalExec?.notifyOnExit,
    notifyOnExitEmptySuccess:
      agentExec?.notifyOnExitEmptySuccess ?? globalExec?.notifyOnExitEmptySuccess,
    applyPatch: agentExec?.applyPatch ?? globalExec?.applyPatch,
  };
}

export function resolveToolLoopDetectionConfig(params: {
  cfg?: CrawClawConfig;
  agentId?: string;
}): ToolLoopDetectionConfig | undefined {
  const global = params.cfg?.tools?.loopDetection;
  const agent =
    params.agentId && params.cfg
      ? resolveAgentConfig(params.cfg, params.agentId)?.tools?.loopDetection
      : undefined;

  if (!agent) {
    return global;
  }
  if (!global) {
    return agent;
  }

  return {
    ...global,
    ...agent,
    detectors: {
      ...global.detectors,
      ...agent.detectors,
    },
  };
}

export const __testing = {
  cleanSchemaForGemini,
  normalizeToolParams,
  patchToolSchemaForClaudeCompatibility,
  wrapToolParamNormalization,
  assertRequiredParams,
  applyModelProviderToolPolicy,
} as const;

export function createCrawClawCodingTools(options?: {
  agentId?: string;
  exec?: ExecToolDefaults & ProcessToolDefaults;
  messageProvider?: string;
  agentAccountId?: string;
  messageTo?: string;
  messageThreadId?: string | number;
  sandbox?: SandboxContext | null;
  sessionKey?: string;
  /** Ephemeral session UUID — regenerated on /new. */
  sessionId?: string;
  /** Stable run identifier for this agent invocation. */
  runId?: string;
  /** What initiated this run (for trigger-specific tool restrictions). */
  trigger?: string;
  /** Relative workspace path that memory-triggered writes may append to. */
  memoryFlushWritePath?: string;
  agentDir?: string;
  workspaceDir?: string;
  /**
   * Workspace directory that spawned subagents should inherit.
   * When sandboxing uses a copied workspace (`ro` or `none`), workspaceDir is the
   * sandbox copy but subagents should inherit the real agent workspace instead.
   * Defaults to workspaceDir when not set.
   */
  spawnWorkspaceDir?: string;
  config?: CrawClawConfig;
  abortSignal?: AbortSignal;
  /**
   * Provider of the currently selected model (used for provider-specific tool quirks).
   * Example: "anthropic", "openai", "google", "openai-codex".
   */
  modelProvider?: string;
  /** Model id for the current provider (used for model-specific tool gating). */
  modelId?: string;
  /** Model API for the current provider (used for provider-native tool arbitration). */
  modelApi?: string;
  /** Model context window in tokens (used to scale read-tool output budget). */
  modelContextWindowTokens?: number;
  /** Resolved runtime model compatibility hints. */
  modelCompat?: ModelCompatConfig;
  /**
   * Auth mode for the current provider. We only need this for Anthropic OAuth
   * tool-name blocking quirks.
   */
  modelAuthMode?: ModelAuthMode;
  /** Current channel ID for auto-threading (Slack). */
  currentChannelId?: string;
  /** Current thread timestamp for auto-threading (Slack). */
  currentThreadTs?: string;
  /** Current inbound message id for action fallbacks (e.g. Telegram react). */
  currentMessageId?: string | number;
  /** Group id for channel-level tool policy resolution. */
  groupId?: string | null;
  /** Group channel label (e.g. #general) for channel-level tool policy resolution. */
  groupChannel?: string | null;
  /** Group space label (e.g. guild/team id) for channel-level tool policy resolution. */
  groupSpace?: string | null;
  /** Parent session key for subagent group policy inheritance. */
  spawnedBy?: string | null;
  senderId?: string | null;
  senderName?: string | null;
  senderUsername?: string | null;
  senderE164?: string | null;
  /** Reply-to mode for Slack auto-threading. */
  replyToMode?: "off" | "first" | "all";
  /** Mutable ref to track if a reply was sent (for "first" mode). */
  hasRepliedRef?: { value: boolean };
  /** Allow plugin tools for this run to late-bind the gateway subagent. */
  allowGatewaySubagentBinding?: boolean;
  /** If true, the model has native vision capability */
  modelHasVision?: boolean;
  /** Require explicit message targets (no implicit last-route sends). */
  requireExplicitMessageTarget?: boolean;
  /** If true, omit the message tool from the tool list. */
  disableMessageTool?: boolean;
  /** Whether the sender is an owner (required for owner-only tools). */
  senderIsOwner?: boolean;
  /** Callback invoked when sessions_yield tool is called. */
  onYield?: (message: string) => Promise<void> | void;
  /** Optional semantic skill retriever shared with the current run. */
  skillSemanticRetrieve?: SkillSemanticRetriever;
  /** Optional sink for policy diagnostics that should be surfaced to callers. */
  toolPolicyDiagnostics?: string[];
  /** Explicit special-agent spawn source for embedded fork runs. */
  specialAgentSpawnSource?: string;
  /** Explicit durable-memory scope for embedded fork runs. */
  specialDurableMemoryScope?: {
    agentId?: string | null;
    channel?: string | null;
    userId?: string | null;
  };
  /** Explicit session-summary target for embedded fork runs. */
  specialSessionSummaryTarget?: {
    agentId: string;
    sessionId: string;
  };
}): AnyAgentTool[] {
  const execToolName = "exec";
  const sandbox = options?.sandbox?.enabled ? options.sandbox : undefined;
  const isMemoryFlushRun = options?.trigger === "memory";
  if (isMemoryFlushRun && !options?.memoryFlushWritePath) {
    throw new Error("memoryFlushWritePath required for memory-triggered tool runs");
  }
  const memoryFlushWritePath = isMemoryFlushRun ? options.memoryFlushWritePath : undefined;
  const {
    agentId,
    globalPolicy,
    globalProviderPolicy,
    agentPolicy,
    agentProviderPolicy,
    profile,
    providerProfile,
    profileAlsoAllow,
    providerProfileAlsoAllow,
  } = resolveEffectiveToolPolicy({
    config: options?.config,
    sessionKey: options?.sessionKey,
    agentId: options?.agentId,
    modelProvider: options?.modelProvider,
    modelId: options?.modelId,
  });
  // Prefer the already-resolved sandbox context policy. Recomputing from
  // sessionKey/config can lose the real sandbox agent when callers pass a
  // legacy alias like `main` instead of an agent session key.
  const sandboxToolPolicy = sandbox?.tools;
  const groupPolicy = resolveGroupToolPolicy({
    config: options?.config,
    sessionKey: options?.sessionKey,
    spawnedBy: options?.spawnedBy,
    messageProvider: options?.messageProvider,
    groupId: options?.groupId,
    groupChannel: options?.groupChannel,
    groupSpace: options?.groupSpace,
    accountId: options?.agentAccountId,
    senderId: options?.senderId,
    senderName: options?.senderName,
    senderUsername: options?.senderUsername,
    senderE164: options?.senderE164,
  });
  const profilePolicy = resolveToolProfilePolicy(profile);
  const providerProfilePolicy = resolveToolProfilePolicy(providerProfile);

  // Prefer sessionKey for process isolation scope to prevent cross-session process visibility/killing.
  // Fallback to agentId if no sessionKey is available (e.g. legacy or global contexts).
  const scopeKey =
    options?.exec?.scopeKey ?? options?.sessionKey ?? (agentId ? `agent:${agentId}` : undefined);
  const subagentPolicy =
    isSubagentSessionKey(options?.sessionKey) && options?.sessionKey
      ? resolveSubagentToolPolicyForSession(options.config, options.sessionKey)
      : undefined;
  const sessionSpawnContext = resolveSessionSpawnContext({
    cfg: options?.config,
    sessionKey: options?.sessionKey,
    specialAgentSpawnSource: options?.specialAgentSpawnSource,
    specialDurableMemoryScope: options?.specialDurableMemoryScope,
    specialSessionSummaryTarget: options?.specialSessionSummaryTarget,
  });
  const specialAgentDefinition = resolveSpecialAgentDefinitionBySpawnSource(
    sessionSpawnContext.spawnSource,
  );
  const specialAgentToolPolicy = specialAgentDefinition?.toolPolicy;
  const specialAgentPromptAllowPolicy =
    specialAgentToolPolicy?.allowlist?.length &&
    (specialAgentToolPolicy.enforcement ?? "prompt_allowlist") === "prompt_allowlist"
      ? {
          allow: [...specialAgentToolPolicy.allowlist],
        }
      : undefined;
  const specialAgentRuntimeAllowlist =
    specialAgentToolPolicy?.allowlist?.length &&
    (specialAgentToolPolicy.enforcement ?? "prompt_allowlist") === "runtime_deny"
      ? [...specialAgentToolPolicy.allowlist]
      : undefined;
  const specialAgentAlsoAllow = specialAgentRuntimeAllowlist ?? [];
  const specialAgentMemoryScope =
    specialAgentToolPolicy?.guard === "memory_maintenance" && sessionSpawnContext.durableMemoryScope
      ? resolveDurableMemoryScope({
          agentId: sessionSpawnContext.durableMemoryScope.agentId,
          channel: sessionSpawnContext.durableMemoryScope.channel,
          userId: sessionSpawnContext.durableMemoryScope.userId,
        })
      : null;
  const specialToolGuard =
    specialAgentToolPolicy?.guard === "memory_maintenance"
      ? ({
          kind: "memory_maintenance",
          ...(specialAgentMemoryScope?.rootDir
            ? { memoryDir: specialAgentMemoryScope.rootDir }
            : {}),
        } satisfies SpecialToolGuardContext)
      : undefined;
  const profilePolicyWithAlsoAllow = mergeAlsoAllowPolicy(profilePolicy, [
    ...(profileAlsoAllow ?? []),
    ...specialAgentAlsoAllow,
  ]);
  const providerProfilePolicyWithAlsoAllow = mergeAlsoAllowPolicy(providerProfilePolicy, [
    ...(providerProfileAlsoAllow ?? []),
    ...specialAgentAlsoAllow,
  ]);
  const globalPolicyWithSpecialAllow = mergeAlsoAllowPolicy(globalPolicy, specialAgentAlsoAllow);
  const globalProviderPolicyWithSpecialAllow = mergeAlsoAllowPolicy(globalProviderPolicy, [
    ...specialAgentAlsoAllow,
  ]);
  const agentPolicyWithSpecialAllow = mergeAlsoAllowPolicy(agentPolicy, specialAgentAlsoAllow);
  const agentProviderPolicyWithSpecialAllow = mergeAlsoAllowPolicy(agentProviderPolicy, [
    ...specialAgentAlsoAllow,
  ]);
  const groupPolicyWithSpecialAllow = mergeAlsoAllowPolicy(groupPolicy, specialAgentAlsoAllow);
  const allowBackground = isToolAllowedByPolicies("process", [
    profilePolicyWithAlsoAllow,
    providerProfilePolicyWithAlsoAllow,
    globalPolicyWithSpecialAllow,
    globalProviderPolicyWithSpecialAllow,
    agentPolicyWithSpecialAllow,
    agentProviderPolicyWithSpecialAllow,
    groupPolicyWithSpecialAllow,
    sandboxToolPolicy,
    subagentPolicy,
    specialAgentPromptAllowPolicy,
  ]);
  const execConfig = resolveExecConfig({ cfg: options?.config, agentId });
  const fsConfig = resolveToolFsConfig({ cfg: options?.config, agentId });
  const fsPolicy = createToolFsPolicy({
    workspaceOnly: isMemoryFlushRun || fsConfig.workspaceOnly,
  });
  const sandboxRoot = sandbox?.workspaceDir;
  const sandboxFsBridge = sandbox?.fsBridge;
  const allowWorkspaceWrites = sandbox?.workspaceAccess !== "ro";
  const workspaceRoot = resolveWorkspaceRoot(options?.workspaceDir);
  const workspaceOnly = fsPolicy.workspaceOnly;
  const applyPatchConfig = execConfig.applyPatch;
  // Secure by default: apply_patch is workspace-contained unless explicitly disabled.
  // (tools.fs.workspaceOnly is a separate umbrella flag for read/write/edit/apply_patch.)
  const applyPatchWorkspaceOnly = workspaceOnly || applyPatchConfig?.workspaceOnly !== false;
  const applyPatchEnabled =
    applyPatchConfig?.enabled !== false &&
    isOpenAIProvider(options?.modelProvider) &&
    isApplyPatchAllowedForModel({
      modelProvider: options?.modelProvider,
      modelId: options?.modelId,
      allowModels: applyPatchConfig?.allowModels,
    });

  if (sandboxRoot && !sandboxFsBridge) {
    throw new Error("Sandbox filesystem bridge is unavailable.");
  }
  const imageSanitization = resolveImageSanitizationLimits(options?.config);

  const base = (createCodingTools(workspaceRoot) as unknown as AnyAgentTool[]).flatMap((tool) => {
    if (tool.name === "read") {
      if (sandboxRoot) {
        const sandboxed = createSandboxedReadTool({
          root: sandboxRoot,
          bridge: sandboxFsBridge!,
          modelContextWindowTokens: options?.modelContextWindowTokens,
          imageSanitization,
        });
        return [
          workspaceOnly
            ? wrapToolWorkspaceRootGuardWithOptions(sandboxed, sandboxRoot, {
                containerWorkdir: sandbox.containerWorkdir,
              })
            : sandboxed,
        ];
      }
      const freshReadTool = createReadTool(workspaceRoot);
      const wrapped = createCrawClawReadTool(freshReadTool, {
        modelContextWindowTokens: options?.modelContextWindowTokens,
        imageSanitization,
      });
      return [workspaceOnly ? wrapToolWorkspaceRootGuard(wrapped, workspaceRoot) : wrapped];
    }
    if (tool.name === "bash" || tool.name === execToolName) {
      return [];
    }
    if (tool.name === "write") {
      if (sandboxRoot) {
        return [];
      }
      const wrapped = createHostWorkspaceWriteTool(workspaceRoot, { workspaceOnly });
      return [workspaceOnly ? wrapToolWorkspaceRootGuard(wrapped, workspaceRoot) : wrapped];
    }
    if (tool.name === "edit") {
      if (sandboxRoot) {
        return [];
      }
      const wrapped = createHostWorkspaceEditTool(workspaceRoot, { workspaceOnly });
      return [workspaceOnly ? wrapToolWorkspaceRootGuard(wrapped, workspaceRoot) : wrapped];
    }
    return [tool];
  });
  const { cleanupMs: cleanupMsOverride, ...execDefaults } = options?.exec ?? {};
  const execTool = createExecTool({
    ...execDefaults,
    host: options?.exec?.host ?? execConfig.host,
    security: options?.exec?.security ?? execConfig.security,
    ask: options?.exec?.ask ?? execConfig.ask,
    trigger: options?.trigger,
    node: options?.exec?.node ?? execConfig.node,
    pathPrepend: options?.exec?.pathPrepend ?? execConfig.pathPrepend,
    safeBins: options?.exec?.safeBins ?? execConfig.safeBins,
    strictInlineEval: options?.exec?.strictInlineEval ?? execConfig.strictInlineEval,
    safeBinTrustedDirs: options?.exec?.safeBinTrustedDirs ?? execConfig.safeBinTrustedDirs,
    safeBinProfiles: options?.exec?.safeBinProfiles ?? execConfig.safeBinProfiles,
    agentId,
    runId: options?.runId,
    cwd: workspaceRoot,
    allowBackground,
    scopeKey,
    sessionKey: options?.sessionKey,
    messageProvider: options?.messageProvider,
    currentChannelId: options?.currentChannelId,
    currentThreadTs: options?.currentThreadTs,
    accountId: options?.agentAccountId,
    backgroundMs: options?.exec?.backgroundMs ?? execConfig.backgroundMs,
    timeoutSec: options?.exec?.timeoutSec ?? execConfig.timeoutSec,
    approvalRunningNoticeMs:
      options?.exec?.approvalRunningNoticeMs ?? execConfig.approvalRunningNoticeMs,
    notifyOnExit: options?.exec?.notifyOnExit ?? execConfig.notifyOnExit,
    notifyOnExitEmptySuccess:
      options?.exec?.notifyOnExitEmptySuccess ?? execConfig.notifyOnExitEmptySuccess,
    sandbox: sandbox
      ? {
          containerName: sandbox.containerName,
          workspaceDir: sandbox.workspaceDir,
          containerWorkdir: sandbox.containerWorkdir,
          env: sandbox.backend?.env ?? sandbox.docker.env,
          buildExecSpec: sandbox.backend?.buildExecSpec.bind(sandbox.backend),
          finalizeExec: sandbox.backend?.finalizeExec?.bind(sandbox.backend),
        }
      : undefined,
  });
  const processTool = createProcessTool({
    cleanupMs: cleanupMsOverride ?? execConfig.cleanupMs,
    scopeKey,
  });
  const applyPatchTool =
    !applyPatchEnabled || (sandboxRoot && !allowWorkspaceWrites)
      ? null
      : createApplyPatchTool({
          cwd: sandboxRoot ?? workspaceRoot,
          sandbox:
            sandboxRoot && allowWorkspaceWrites
              ? { root: sandboxRoot, bridge: sandboxFsBridge! }
              : undefined,
          workspaceOnly: applyPatchWorkspaceOnly,
        });
  const skillSemanticRetrieve =
    options?.skillSemanticRetrieve ??
    createSkillSemanticRetrieverFromConfig({
      config: options?.config,
      workspaceDir: workspaceRoot,
    });
  const tools: AnyAgentTool[] = [
    ...base,
    ...(sandboxRoot
      ? allowWorkspaceWrites
        ? [
            workspaceOnly
              ? wrapToolWorkspaceRootGuardWithOptions(
                  createSandboxedEditTool({ root: sandboxRoot, bridge: sandboxFsBridge! }),
                  sandboxRoot,
                  {
                    containerWorkdir: sandbox.containerWorkdir,
                  },
                )
              : createSandboxedEditTool({ root: sandboxRoot, bridge: sandboxFsBridge! }),
            workspaceOnly
              ? wrapToolWorkspaceRootGuardWithOptions(
                  createSandboxedWriteTool({ root: sandboxRoot, bridge: sandboxFsBridge! }),
                  sandboxRoot,
                  {
                    containerWorkdir: sandbox.containerWorkdir,
                  },
                )
              : createSandboxedWriteTool({ root: sandboxRoot, bridge: sandboxFsBridge! }),
          ]
        : []
      : []),
    ...(applyPatchTool ? [applyPatchTool as unknown as AnyAgentTool] : []),
    execTool as unknown as AnyAgentTool,
    processTool as unknown as AnyAgentTool,
    createDiscoverSkillsTool({
      workspaceDir: workspaceRoot,
      config: options?.config,
      sessionId: options?.sessionId,
      sessionKey: options?.sessionKey,
      semanticRetrieve: skillSemanticRetrieve,
    }),
    // Channel docking: include channel-defined agent tools (login, etc.).
    ...listChannelAgentTools({ cfg: options?.config }),
    ...createCrawClawTools({
      sandboxBrowserBridgeUrl: sandbox?.browser?.bridgeUrl,
      sandboxBrowserCdpUrl: sandbox?.browser?.cdpUrl,
      sandboxBrowserPinchTabUrl: sandbox?.browser?.pinchTabUrl,
      allowHostBrowserControl: sandbox ? sandbox.browserAllowHostControl : true,
      agentSessionKey: options?.sessionKey,
      agentChannel: resolveGatewayMessageChannel(options?.messageProvider),
      durableMemoryChannel: normalizeMessageProvider(options?.messageProvider),
      durableMemoryScope: sessionSpawnContext.durableMemoryScope,
      specialAgentSpawnSource: sessionSpawnContext.spawnSource,
      agentAccountId: options?.agentAccountId,
      agentTo: options?.messageTo,
      agentThreadId: options?.messageThreadId,
      agentGroupId: options?.groupId ?? null,
      agentGroupChannel: options?.groupChannel ?? null,
      agentGroupSpace: options?.groupSpace ?? null,
      agentDir: options?.agentDir,
      sandboxRoot,
      sandboxFsBridge,
      fsPolicy,
      workspaceDir: workspaceRoot,
      spawnWorkspaceDir: options?.spawnWorkspaceDir
        ? resolveWorkspaceRoot(options.spawnWorkspaceDir)
        : undefined,
      sandboxed: !!sandbox,
      config: options?.config,
      pluginToolAllowlist: collectExplicitAllowlist([
        profilePolicy,
        providerProfilePolicy,
        globalPolicy,
        globalProviderPolicy,
        agentPolicy,
        agentProviderPolicy,
        groupPolicy,
        sandboxToolPolicy,
        subagentPolicy,
      ]),
      currentChannelId: options?.currentChannelId,
      currentThreadTs: options?.currentThreadTs,
      currentMessageId: options?.currentMessageId,
      replyToMode: options?.replyToMode,
      hasRepliedRef: options?.hasRepliedRef,
      modelHasVision: options?.modelHasVision,
      requireExplicitMessageTarget: options?.requireExplicitMessageTarget,
      disableMessageTool: options?.disableMessageTool,
      requesterAgentIdOverride: agentId,
      requesterSenderId: options?.senderId,
      senderIsOwner: options?.senderIsOwner,
      sessionId: options?.sessionId,
      onYield: options?.onYield,
      allowGatewaySubagentBinding: options?.allowGatewaySubagentBinding,
    }),
    ...(sessionSpawnContext.spawnSource === SESSION_SUMMARY_SPAWN_SOURCE &&
    sessionSpawnContext.sessionSummaryTarget
      ? createSessionSummaryTools({
          agentId: sessionSpawnContext.sessionSummaryTarget.agentId,
          summarySessionId: sessionSpawnContext.sessionSummaryTarget.sessionId,
        })
      : []),
  ];
  const toolsForMemoryFlush =
    isMemoryFlushRun && memoryFlushWritePath
      ? tools.flatMap((tool) => {
          if (!MEMORY_FLUSH_ALLOWED_TOOL_NAMES.has(tool.name)) {
            return [];
          }
          if (tool.name === "write") {
            return [
              wrapToolMemoryFlushAppendOnlyWrite(tool, {
                root: sandboxRoot ?? workspaceRoot,
                relativePath: memoryFlushWritePath,
                containerWorkdir: sandbox?.containerWorkdir,
                sandbox:
                  sandboxRoot && sandboxFsBridge
                    ? { root: sandboxRoot, bridge: sandboxFsBridge }
                    : undefined,
              }),
            ];
          }
          return [tool];
        })
      : tools;
  const toolsForMessageProvider = applyMessageProviderToolPolicy(
    toolsForMemoryFlush,
    options?.messageProvider,
  );
  const toolsForModelProvider = applyModelProviderToolPolicy(toolsForMessageProvider, {
    config: options?.config,
    modelProvider: options?.modelProvider,
    modelApi: options?.modelApi,
    modelId: options?.modelId,
    agentDir: options?.agentDir,
    modelCompat: options?.modelCompat,
  });
  // Security: treat unknown/undefined as unauthorized (opt-in, not opt-out)
  const senderIsOwner = options?.senderIsOwner === true;
  const toolsByAuthorization = applyOwnerOnlyToolPolicy(toolsForModelProvider, senderIsOwner);
  const subagentFiltered = applyToolPolicyPipeline({
    tools: toolsByAuthorization,
    toolMeta: (tool) => getPluginToolMeta(tool),
    warn: logWarn,
    diagnose: (message) => {
      options?.toolPolicyDiagnostics?.push(message);
    },
    steps: [
      ...buildDefaultToolPolicyPipelineSteps({
        profilePolicy: profilePolicyWithAlsoAllow,
        profile,
        profileAlsoAllow,
        providerProfilePolicy: providerProfilePolicyWithAlsoAllow,
        providerProfile,
        providerProfileAlsoAllow,
        globalPolicy: globalPolicyWithSpecialAllow,
        globalProviderPolicy: globalProviderPolicyWithSpecialAllow,
        agentPolicy: agentPolicyWithSpecialAllow,
        agentProviderPolicy: agentProviderPolicyWithSpecialAllow,
        groupPolicy: groupPolicyWithSpecialAllow,
        agentId,
      }),
      { policy: sandboxToolPolicy, label: "sandbox tools.allow" },
      { policy: subagentPolicy, label: "subagent tools.allow" },
      { policy: specialAgentPromptAllowPolicy, label: "special-agent tools.allow" },
    ],
  });
  // Always normalize tool JSON Schemas before handing them to pi-agent/pi-ai.
  // Without this, some providers (notably OpenAI) will reject root-level union schemas.
  // Provider-specific cleaning: Gemini needs constraint keywords stripped, but Anthropic expects them.
  const normalized = subagentFiltered.map((tool) =>
    normalizeToolParameters(tool, {
      modelProvider: options?.modelProvider,
      modelId: options?.modelId,
      modelCompat: options?.modelCompat,
    }),
  );
  const withHooks = normalized.map((tool) =>
    wrapToolWithBeforeToolCallHook(tool, {
      agentId,
      sessionKey: options?.sessionKey,
      sessionId: options?.sessionId,
      runId: options?.runId,
      loopDetection: resolveToolLoopDetectionConfig({ cfg: options?.config, agentId }),
      ...(specialAgentRuntimeAllowlist?.length
        ? { specialToolAllowlist: specialAgentRuntimeAllowlist }
        : {}),
      ...(specialToolGuard ? { specialToolGuard } : {}),
    }),
  );
  const withAbort = options?.abortSignal
    ? withHooks.map((tool) => wrapToolWithAbortSignal(tool, options.abortSignal))
    : withHooks;

  // NOTE: Keep canonical (lowercase) tool names here.
  // pi-ai's Anthropic OAuth transport remaps tool names to Claude Code-style names
  // on the wire and maps them back for tool dispatch.
  return withAbort;
}
