import type { ReasoningLevel, ThinkLevel } from "../../auto-reply/thinking.js";
import type { CrawClawConfig } from "../../config/config.js";
import { resolveMemoryRuntime } from "../../memory/bootstrap/init-memory-runtime.js";
import { prepareProviderRuntimeAuth } from "../../plugins/provider-runtime.js";
import { type enqueueCommand, enqueueCommandInLane } from "../../process/command-queue.js";
import { isSubagentSessionKey } from "../../routing/session-key.js";
import { resolveCompactionLifecycleDecisionCode } from "../../shared/decision-codes.js";
import { resolveUserPath } from "../../utils.js";
import { resolveCrawClawAgentDir } from "../agent-paths.js";
import { resolveSessionAgentIds } from "../agent-scope.js";
import type { ExecElevatedDefaults } from "../bash-tools.js";
import { summarizeCompactPostArtifacts } from "../compaction/post-compact-artifacts.js";
import { resolveContextWindowInfo } from "../context-window-guard.js";
import { DEFAULT_CONTEXT_TOKENS, DEFAULT_MODEL, DEFAULT_PROVIDER } from "../defaults.js";
import { getApiKeyForModel } from "../model-auth.js";
import {
  resolveProviderRequestConfig,
  sanitizeRuntimeProviderRequestOverrides,
} from "../provider-request-config.js";
import { ensureRuntimePluginsLoaded } from "../runtime-plugins.js";
import { emitRunLoopLifecycleEvent } from "../runtime/lifecycle/bus.js";
import { ensureSharedRunLoopLifecycleSubscribers } from "../runtime/lifecycle/shared-subscribers.js";
import {
  buildEmbeddedCompactionRuntimeContext,
  resolveEmbeddedCompactionTarget,
} from "./compaction-runtime-context.js";
import { resolveGlobalLane, resolveSessionLane } from "./lanes.js";
import { createEmbeddedMemoryCompleteFn } from "./memory-complete.js";
import { runMemoryRuntimeMaintenance } from "./memory-runtime-maintenance.js";
import { resolveModelAsync } from "./model.js";
import type { EmbeddedPiCompactResult } from "./types.js";

export type CompactEmbeddedPiSessionParams = {
  sessionId: string;
  runId?: string;
  sessionKey?: string;
  messageChannel?: string;
  messageProvider?: string;
  agentAccountId?: string;
  currentChannelId?: string;
  currentThreadTs?: string;
  currentMessageId?: string | number;
  /** Trusted sender id from inbound context for scoped message-tool discovery. */
  senderId?: string;
  authProfileId?: string;
  /** Group id for channel-level tool policy resolution. */
  groupId?: string | null;
  /** Group channel label (e.g. #general) for channel-level tool policy resolution. */
  groupChannel?: string | null;
  /** Group space label (e.g. guild/team id) for channel-level tool policy resolution. */
  groupSpace?: string | null;
  /** Parent session key for subagent policy inheritance. */
  spawnedBy?: string | null;
  /** Whether the sender is an owner (required for owner-only tools). */
  senderIsOwner?: boolean;
  sessionFile: string;
  /** Optional caller-observed live prompt tokens used for compaction diagnostics. */
  currentTokenCount?: number;
  workspaceDir: string;
  agentDir?: string;
  config?: CrawClawConfig;
  /** Optional first-pass surfaced skills for this compaction run. */
  surfacedSkillNames?: string[];
  provider?: string;
  model?: string;
  thinkLevel?: ThinkLevel;
  reasoningLevel?: ReasoningLevel;
  bashElevated?: ExecElevatedDefaults;
  customInstructions?: string;
  tokenBudget?: number;
  force?: boolean;
  trigger?: "budget" | "overflow" | "manual";
  diagId?: string;
  attempt?: number;
  maxAttempts?: number;
  lane?: string;
  enqueue?: typeof enqueueCommand;
  extraSystemPrompt?: string;
  ownerNumbers?: string[];
  abortSignal?: AbortSignal;
  /** Allow runtime plugins for this compaction to late-bind the gateway subagent. */
  allowGatewaySubagentBinding?: boolean;
};

/**
 * Compacts a session with lane queueing (session lane + global lane).
 */
export async function compactEmbeddedPiSession(
  params: CompactEmbeddedPiSessionParams,
): Promise<EmbeddedPiCompactResult> {
  ensureSharedRunLoopLifecycleSubscribers();
  const sessionLane = resolveSessionLane(params.sessionKey?.trim() || params.sessionId);
  const globalLane = resolveGlobalLane(params.lane);
  const enqueueGlobal =
    params.enqueue ?? ((task, opts) => enqueueCommandInLane(globalLane, task, opts));
  return enqueueCommandInLane(sessionLane, () =>
    enqueueGlobal(async () => {
      ensureRuntimePluginsLoaded({
        config: params.config,
        workspaceDir: params.workspaceDir,
        allowGatewaySubagentBinding: params.allowGatewaySubagentBinding,
      });
      const agentDir = params.agentDir ?? resolveCrawClawAgentDir();
      const resolvedCompactionTarget = resolveEmbeddedCompactionTarget({
        config: params.config,
        provider: params.provider,
        modelId: params.model,
        authProfileId: params.authProfileId,
        defaultProvider: DEFAULT_PROVIDER,
        defaultModel: DEFAULT_MODEL,
      });
      const ceProvider = resolvedCompactionTarget.provider ?? DEFAULT_PROVIDER;
      const ceModelId = resolvedCompactionTarget.model ?? DEFAULT_MODEL;
      const resolveCompactionMemoryRoute = async () => {
        const {
          model: resolvedModel,
          error,
          authStorage,
        } = await resolveModelAsync(ceProvider, ceModelId, agentDir, params.config);
        if (!resolvedModel) {
          throw new Error(error ?? `Unknown model: ${ceProvider}/${ceModelId}`);
        }

        let runtimeModel = resolvedModel;
        const apiKeyInfo = await getApiKeyForModel({
          model: runtimeModel,
          cfg: params.config,
          profileId: params.authProfileId,
          agentDir,
        });

        if (apiKeyInfo.apiKey) {
          const preparedAuth = await prepareProviderRuntimeAuth({
            provider: runtimeModel.provider,
            config: params.config,
            workspaceDir: params.workspaceDir,
            env: process.env,
            context: {
              config: params.config,
              agentDir,
              workspaceDir: params.workspaceDir,
              env: process.env,
              provider: runtimeModel.provider,
              modelId: ceModelId,
              model: runtimeModel,
              apiKey: apiKeyInfo.apiKey,
              authMode: apiKeyInfo.mode,
              profileId: apiKeyInfo.profileId,
            },
          });
          if (preparedAuth?.baseUrl || preparedAuth?.request) {
            const runtimeRequestConfig = resolveProviderRequestConfig({
              provider: runtimeModel.provider,
              api: runtimeModel.api,
              baseUrl: preparedAuth.baseUrl ?? runtimeModel.baseUrl,
              providerHeaders:
                runtimeModel.headers && typeof runtimeModel.headers === "object"
                  ? runtimeModel.headers
                  : undefined,
              request: sanitizeRuntimeProviderRequestOverrides(preparedAuth.request),
              capability: "llm",
              transport: "stream",
            });
            runtimeModel = {
              ...runtimeModel,
              ...(preparedAuth.baseUrl ? { baseUrl: preparedAuth.baseUrl } : {}),
              ...(runtimeRequestConfig.headers ? { headers: runtimeRequestConfig.headers } : {}),
            };
          }
          const runtimeApiKey = preparedAuth?.apiKey ?? apiKeyInfo.apiKey;
          if (!runtimeApiKey) {
            throw new Error(`Provider "${runtimeModel.provider}" runtime auth returned no apiKey.`);
          }
          authStorage.setRuntimeApiKey(runtimeModel.provider, runtimeApiKey);
        }

        return { runtimeModel, authStorage };
      };
      let compactionMemoryRoutePromise: Promise<
        Awaited<ReturnType<typeof resolveCompactionMemoryRoute>>
      > | null = null;
      const ensureCompactionMemoryRoute = async () => {
        if (!compactionMemoryRoutePromise) {
          compactionMemoryRoutePromise = resolveCompactionMemoryRoute();
        }
        return await compactionMemoryRoutePromise;
      };
      const memoryRuntime = await resolveMemoryRuntime(params.config, {
        complete: createEmbeddedMemoryCompleteFn({
          defaultModel: ceModelId,
          config: params.config,
          getAuthStorage: async () => (await ensureCompactionMemoryRoute()).authStorage,
          getRuntimeModel: async () => (await ensureCompactionMemoryRoute()).runtimeModel,
        }),
      });
      try {
        // Resolve token budget from the effective compaction model so engine-
        // owned /compact implementations see the same target as the runtime.
        const { runtimeModel: ceModel } = await ensureCompactionMemoryRoute();
        const ceCtxInfo = resolveContextWindowInfo({
          cfg: params.config,
          provider: ceProvider,
          modelId: ceModelId,
          modelContextWindow: ceModel?.contextWindow,
          defaultTokens: DEFAULT_CONTEXT_TOKENS,
        });
        const engineOwnsCompaction = memoryRuntime.info.ownsCompaction === true;
        const { sessionAgentId } = resolveSessionAgentIds({
          sessionKey: params.sessionKey,
          config: params.config,
        });
        const resolvedMessageProvider = params.messageChannel ?? params.messageProvider;
        const effectiveWorkspace = resolveUserPath(params.workspaceDir);
        const runtimeContext = {
          ...params,
          ...buildEmbeddedCompactionRuntimeContext({
            sessionKey: params.sessionKey,
            messageChannel: params.messageChannel,
            messageProvider: params.messageProvider,
            agentAccountId: params.agentAccountId,
            currentChannelId: params.currentChannelId,
            currentThreadTs: params.currentThreadTs,
            currentMessageId: params.currentMessageId,
            authProfileId: params.authProfileId,
            workspaceDir: params.workspaceDir,
            agentDir,
            config: params.config,
            senderIsOwner: params.senderIsOwner,
            senderId: params.senderId,
            provider: params.provider,
            modelId: params.model,
            thinkLevel: params.thinkLevel,
            reasoningLevel: params.reasoningLevel,
            bashElevated: params.bashElevated,
            extraSystemPrompt: params.extraSystemPrompt,
            ownerNumbers: params.ownerNumbers,
          }),
        };
        if (engineOwnsCompaction) {
          await emitRunLoopLifecycleEvent({
            phase: "pre_compact",
            runId: params.runId?.trim() || params.sessionId,
            sessionId: params.sessionId,
            ...(params.sessionKey?.trim() ? { sessionKey: params.sessionKey.trim() } : {}),
            agentId: sessionAgentId,
            isTopLevel: !params.sessionKey || !isSubagentSessionKey(params.sessionKey),
            sessionFile: params.sessionFile,
            messageCount: -1,
            decision: {
              code: resolveCompactionLifecycleDecisionCode({
                phase: "pre_compact",
                trigger: params.trigger ?? "manual",
              }),
              summary: params.trigger ?? "manual",
            },
            metadata: {
              trigger: params.trigger ?? "manual",
              provider: ceProvider,
              modelId: ceModelId,
              workspaceDir: effectiveWorkspace,
              messageProvider: resolvedMessageProvider,
            },
          });
        }
        const result = await memoryRuntime.compact({
          sessionId: params.sessionId,
          sessionKey: params.sessionKey,
          sessionFile: params.sessionFile,
          tokenBudget: ceCtxInfo.tokens,
          currentTokenCount: params.currentTokenCount,
          compactionTarget: params.trigger === "manual" ? "threshold" : "budget",
          customInstructions: params.customInstructions,
          force: params.trigger === "manual",
          runtimeContext,
        });
        if (result.ok && result.compacted) {
          await runMemoryRuntimeMaintenance({
            memoryRuntime,
            sessionId: params.sessionId,
            sessionKey: params.sessionKey,
            sessionFile: params.sessionFile,
            reason: "compaction",
            runtimeContext,
          });
        }
        if (engineOwnsCompaction && result.ok && result.compacted) {
          await emitRunLoopLifecycleEvent({
            phase: "post_compact",
            runId: params.runId?.trim() || params.sessionId,
            sessionId: params.sessionId,
            ...(params.sessionKey?.trim() ? { sessionKey: params.sessionKey.trim() } : {}),
            agentId: sessionAgentId,
            isTopLevel: !params.sessionKey || !isSubagentSessionKey(params.sessionKey),
            sessionFile: params.sessionFile,
            messageCount: -1,
            ...(typeof result.result?.tokensAfter === "number"
              ? { tokenCount: result.result.tokensAfter }
              : {}),
            decision: {
              code: resolveCompactionLifecycleDecisionCode({
                phase: "post_compact",
                trigger: params.trigger ?? "manual",
                willRetry: false,
              }),
              summary: params.trigger ?? "manual",
            },
            metadata: {
              compactedCount: -1,
              tokensBefore: result.result?.tokensBefore,
              firstKeptEntryId: result.result?.firstKeptEntryId,
              summaryLength:
                typeof result.result?.summary === "string"
                  ? result.result.summary.length
                  : undefined,
              ...(() => {
                const artifactSummary = summarizeCompactPostArtifacts(
                  result.result?.postCompactArtifacts,
                );
                return {
                  postCompactSummaryMessages: artifactSummary.summaryMessageCount,
                  postCompactKeptMessages: artifactSummary.keptMessageCount,
                  postCompactAttachments: artifactSummary.attachmentCount,
                  postCompactDiscoveredTools: artifactSummary.discoveredToolsCount,
                  postCompactHasPreservedSegment: artifactSummary.hasPreservedSegment,
                };
              })(),
              trigger: params.trigger ?? "manual",
              provider: ceProvider,
              modelId: ceModelId,
              workspaceDir: effectiveWorkspace,
              messageProvider: resolvedMessageProvider,
              config: params.config,
            },
          });
        }
        return {
          ok: result.ok,
          compacted: result.compacted,
          reason: result.reason,
          result: result.result
            ? {
                summary: result.result.summary ?? "",
                firstKeptEntryId: result.result.firstKeptEntryId ?? "",
                tokensBefore: result.result.tokensBefore,
                tokensAfter: result.result.tokensAfter,
                postCompactArtifacts: result.result.postCompactArtifacts,
                details: result.result.details,
              }
            : undefined,
        };
      } finally {
        await memoryRuntime.dispose?.();
      }
    }),
  );
}

export { runPostCompactionSideEffects } from "../runtime/lifecycle/compat/post-compaction.js";
