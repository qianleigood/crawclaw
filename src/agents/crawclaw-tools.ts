import type { CrawClawConfig } from "../config/config.js";
import { callGateway } from "../gateway/call.js";
import { resolveDurableMemoryScope } from "../memory/durable/scope.js";
import { resolvePluginTools } from "../plugins/tools.js";
import {
  getActiveSecretsRuntimeSnapshot,
  getActiveRuntimeWebToolsMetadata,
} from "../secrets/runtime.js";
import { normalizeDeliveryContext } from "../utils/delivery-context.js";
import type { GatewayMessageChannel } from "../utils/message-channel.js";
import { resolveAgentWorkspaceDir, resolveSessionAgentId } from "./agent-scope.js";
import { applyPluginToolDeliveryDefaults } from "./plugin-tool-delivery-defaults.js";
import { isReviewSpawnSource } from "./review-agent.js";
import type { SpawnedToolContext } from "./spawned-context.js";
import type { ToolFsPolicy } from "./tool-fs-policy.js";
import type { AnyAgentTool } from "./tools/common.js";
import { createCronTool } from "./tools/cron-tool.js";
import { createImageTool } from "./tools/image-tool.js";
import {
  createMemoryManifestReadTool,
  createMemoryNoteDeleteTool,
  createMemoryNoteEditTool,
  createMemoryNoteReadTool,
  createMemoryNoteWriteTool,
} from "./tools/memory-file-tools.js";
import { createMessageTool } from "./tools/message-tool.js";
import { createPdfTool } from "./tools/pdf-tool.js";
import { createReviewTaskTool } from "./tools/review-task-tool.js";
import { createSessionStatusTool } from "./tools/session-status-tool.js";
import { createSessionsHistoryTool } from "./tools/sessions-history-tool.js";
import { createSessionsListTool } from "./tools/sessions-list-tool.js";
import { createSessionsSendTool } from "./tools/sessions-send-tool.js";
import { createSessionsSpawnTool } from "./tools/sessions-spawn-tool.js";
import { createSessionsYieldTool } from "./tools/sessions-yield-tool.js";
import { createSubagentsTool } from "./tools/subagents-tool.js";
import { createTtsTool } from "./tools/tts-tool.js";
import { createWebFetchTool, createWebSearchTool } from "./tools/web-tools.js";
import { createWorkflowTool } from "./tools/workflow-tool.js";
import { createWorkflowizeTool } from "./tools/workflowize-tool.js";
import { createExperienceWriteTool } from "./tools/write-experience-note-tool.js";
import { resolveWorkspaceRoot } from "./workspace-dir.js";

type CrawClawToolsDeps = {
  callGateway: typeof callGateway;
  config?: CrawClawConfig;
};

const defaultCrawClawToolsDeps: CrawClawToolsDeps = {
  callGateway,
};

let openClawToolsDeps: CrawClawToolsDeps = defaultCrawClawToolsDeps;

export function createCrawClawTools(
  options?: {
    allowHostBrowserControl?: boolean;
    agentSessionKey?: string;
    agentChannel?: GatewayMessageChannel;
    agentAccountId?: string;
    /** Delivery target for topic/thread routing. */
    agentTo?: string;
    /** Thread/topic identifier for routing replies to the originating thread. */
    agentThreadId?: string | number;
    agentDir?: string;
    fsPolicy?: ToolFsPolicy;
    config?: CrawClawConfig;
    pluginToolAllowlist?: string[];
    /** Current channel ID for auto-threading. */
    currentChannelId?: string;
    /** Current thread timestamp for auto-threading. */
    currentThreadTs?: string;
    /** Current inbound message id for action fallbacks. */
    currentMessageId?: string | number;
    /** Reply-to mode for auto-threading. */
    replyToMode?: "off" | "first" | "all";
    /** Mutable ref to track if a reply was sent (for "first" mode). */
    hasRepliedRef?: { value: boolean };
    /** If true, the model has native vision capability */
    modelHasVision?: boolean;
    /** Explicit agent ID override for cron/hook sessions. */
    requesterAgentIdOverride?: string;
    /** Require explicit message targets (no implicit last-route sends). */
    requireExplicitMessageTarget?: boolean;
    /** If true, omit the message tool from the tool list. */
    disableMessageTool?: boolean;
    /** Trusted sender id from inbound context (not tool args). */
    requesterSenderId?: string | null;
    /** Normalized channel id to use for durable-memory scope when no gateway channel exists. */
    durableMemoryChannel?: string | null;
    /** Explicit durable-memory scope for special background sessions. */
    durableMemoryScope?: {
      agentId?: string | null;
      channel?: string | null;
      userId?: string | null;
    };
    /** Explicit special-agent spawn source for embedded background sessions. */
    specialAgentSpawnSource?: string;
    /** Whether the requesting sender is an owner. */
    senderIsOwner?: boolean;
    /** Ephemeral session UUID — regenerated on /new. */
    sessionId?: string;
    /** Workspace directory to pass to spawned subagents for inheritance. */
    spawnWorkspaceDir?: string;
    /** Callback invoked when sessions_yield tool is called. */
    onYield?: (message: string) => Promise<void> | void;
    /** Allow plugin tools for this tool set to late-bind the gateway subagent. */
    allowGatewaySubagentBinding?: boolean;
  } & SpawnedToolContext,
): AnyAgentTool[] {
  const resolvedConfig = options?.config ?? openClawToolsDeps.config;
  const sessionAgentId = resolveSessionAgentId({
    sessionKey: options?.agentSessionKey,
    config: resolvedConfig,
  });
  // Fall back to the session agent workspace so plugin loading stays workspace-stable
  // even when a caller forgets to thread workspaceDir explicitly.
  const inferredWorkspaceDir =
    options?.workspaceDir || !resolvedConfig
      ? undefined
      : resolveAgentWorkspaceDir(resolvedConfig, sessionAgentId);
  const workspaceDir = resolveWorkspaceRoot(options?.workspaceDir ?? inferredWorkspaceDir);
  const spawnWorkspaceDir = resolveWorkspaceRoot(
    options?.spawnWorkspaceDir ?? options?.workspaceDir ?? inferredWorkspaceDir,
  );
  const deliveryContext = normalizeDeliveryContext({
    channel: options?.agentChannel,
    to: options?.agentTo,
    accountId: options?.agentAccountId,
    threadId: options?.agentThreadId,
  });
  const runtimeWebTools = getActiveRuntimeWebToolsMetadata();
  const runtimeSnapshot = getActiveSecretsRuntimeSnapshot();
  const imageTool = options?.agentDir?.trim()
    ? createImageTool({
        config: options?.config,
        agentDir: options.agentDir,
        workspaceDir,
        fsPolicy: options?.fsPolicy,
        modelHasVision: options?.modelHasVision,
      })
    : null;
  const pdfTool = options?.agentDir?.trim()
    ? createPdfTool({
        config: options?.config,
        agentDir: options.agentDir,
        workspaceDir,
        fsPolicy: options?.fsPolicy,
      })
    : null;
  const webSearchTool = createWebSearchTool({
    config: options?.config,
    runtimeWebSearch: runtimeWebTools?.search,
  });
  const webFetchTool = createWebFetchTool({
    config: options?.config,
    runtimeWebFetch: runtimeWebTools?.fetch,
  });
  const experienceWriteTool = createExperienceWriteTool({
    config: resolvedConfig,
    scope: resolveDurableMemoryScope({
      sessionKey: options?.agentSessionKey,
      agentId: sessionAgentId,
      channel: options?.durableMemoryChannel ?? options?.agentChannel,
      userId: options?.requesterSenderId ?? undefined,
      fallbackToLocal: true,
    }),
  });
  const memoryManifestReadTool = createMemoryManifestReadTool({
    scope: options?.durableMemoryScope,
    agentId: sessionAgentId,
    channel: options?.durableMemoryChannel ?? options?.agentChannel,
    requesterSenderId: options?.requesterSenderId ?? undefined,
  });
  const memoryNoteReadTool = createMemoryNoteReadTool({
    scope: options?.durableMemoryScope,
    agentId: sessionAgentId,
    channel: options?.durableMemoryChannel ?? options?.agentChannel,
    requesterSenderId: options?.requesterSenderId ?? undefined,
  });
  const memoryNoteWriteTool = createMemoryNoteWriteTool({
    scope: options?.durableMemoryScope,
    agentId: sessionAgentId,
    channel: options?.durableMemoryChannel ?? options?.agentChannel,
    requesterSenderId: options?.requesterSenderId ?? undefined,
  });
  const memoryNoteEditTool = createMemoryNoteEditTool({
    scope: options?.durableMemoryScope,
    agentId: sessionAgentId,
    channel: options?.durableMemoryChannel ?? options?.agentChannel,
    requesterSenderId: options?.requesterSenderId ?? undefined,
  });
  const memoryNoteDeleteTool = createMemoryNoteDeleteTool({
    scope: options?.durableMemoryScope,
    agentId: sessionAgentId,
    channel: options?.durableMemoryChannel ?? options?.agentChannel,
    requesterSenderId: options?.requesterSenderId ?? undefined,
  });
  const reviewTaskTool = isReviewSpawnSource(options?.specialAgentSpawnSource)
    ? null
    : createReviewTaskTool({
        agentSessionKey: options?.agentSessionKey,
        agentChannel: options?.agentChannel,
        agentAccountId: options?.agentAccountId,
        agentTo: options?.agentTo,
        agentThreadId: options?.agentThreadId,
        agentGroupId: options?.agentGroupId,
        agentGroupChannel: options?.agentGroupChannel,
        agentGroupSpace: options?.agentGroupSpace,
        requesterAgentIdOverride: options?.requesterAgentIdOverride,
        workspaceDir: spawnWorkspaceDir,
      });
  const messageTool = options?.disableMessageTool
    ? null
    : createMessageTool({
        agentAccountId: options?.agentAccountId,
        agentSessionKey: options?.agentSessionKey,
        sessionId: options?.sessionId,
        config: options?.config,
        currentChannelId: options?.currentChannelId,
        currentChannelProvider: options?.agentChannel,
        currentThreadTs: options?.currentThreadTs,
        currentMessageId: options?.currentMessageId,
        replyToMode: options?.replyToMode,
        hasRepliedRef: options?.hasRepliedRef,
        requireExplicitTarget: options?.requireExplicitMessageTarget,
        requesterSenderId: options?.requesterSenderId ?? undefined,
      });
  const tools: AnyAgentTool[] = [
    createCronTool({
      agentSessionKey: options?.agentSessionKey,
    }),
    ...(messageTool ? [messageTool] : []),
    createTtsTool({
      agentChannel: options?.agentChannel,
      config: options?.config,
    }),
    ...(memoryManifestReadTool ? [memoryManifestReadTool] : []),
    ...(memoryNoteReadTool ? [memoryNoteReadTool] : []),
    ...(memoryNoteWriteTool ? [memoryNoteWriteTool] : []),
    ...(memoryNoteEditTool ? [memoryNoteEditTool] : []),
    ...(memoryNoteDeleteTool ? [memoryNoteDeleteTool] : []),
    ...(experienceWriteTool ? [experienceWriteTool] : []),
    ...(reviewTaskTool ? [reviewTaskTool] : []),
    createSessionsListTool({
      agentSessionKey: options?.agentSessionKey,
      config: resolvedConfig,
      callGateway: openClawToolsDeps.callGateway,
    }),
    createSessionsHistoryTool({
      agentSessionKey: options?.agentSessionKey,
      config: resolvedConfig,
      callGateway: openClawToolsDeps.callGateway,
    }),
    createSessionsSendTool({
      agentSessionKey: options?.agentSessionKey,
      agentChannel: options?.agentChannel,
      config: resolvedConfig,
      callGateway: openClawToolsDeps.callGateway,
    }),
    createSessionsYieldTool({
      sessionId: options?.sessionId,
      onYield: options?.onYield,
    }),
    createSessionsSpawnTool({
      agentSessionKey: options?.agentSessionKey,
      agentChannel: options?.agentChannel,
      agentAccountId: options?.agentAccountId,
      agentTo: options?.agentTo,
      agentThreadId: options?.agentThreadId,
      agentGroupId: options?.agentGroupId,
      agentGroupChannel: options?.agentGroupChannel,
      agentGroupSpace: options?.agentGroupSpace,
      requesterAgentIdOverride: options?.requesterAgentIdOverride,
      workspaceDir: spawnWorkspaceDir,
    }),
    createSubagentsTool({
      agentSessionKey: options?.agentSessionKey,
    }),
    createSessionStatusTool({
      agentSessionKey: options?.agentSessionKey,
      config: resolvedConfig,
    }),
    createWorkflowizeTool({
      workspaceDir,
      agentDir: options?.agentDir,
      sessionKey: options?.agentSessionKey,
      sessionId: options?.sessionId,
    }),
    createWorkflowTool({
      workspaceDir,
      agentDir: options?.agentDir,
      sessionKey: options?.agentSessionKey,
      sessionId: options?.sessionId,
      config: resolvedConfig,
    }),
    ...(webSearchTool ? [webSearchTool] : []),
    ...(webFetchTool ? [webFetchTool] : []),
    ...(imageTool ? [imageTool] : []),
    ...(pdfTool ? [pdfTool] : []),
  ];

  const pluginTools = resolvePluginTools({
    context: {
      config: options?.config,
      runtimeConfig: runtimeSnapshot?.config,
      workspaceDir,
      agentDir: options?.agentDir,
      agentId: sessionAgentId,
      sessionKey: options?.agentSessionKey,
      sessionId: options?.sessionId,
      browser: {
        allowHostControl: options?.allowHostBrowserControl,
      },
      messageChannel: options?.agentChannel,
      agentAccountId: options?.agentAccountId,
      deliveryContext,
      requesterSenderId: options?.requesterSenderId ?? undefined,
      senderIsOwner: options?.senderIsOwner ?? undefined,
    },
    existingToolNames: new Set(tools.map((tool) => tool.name)),
    toolAllowlist: options?.pluginToolAllowlist,
    allowGatewaySubagentBinding: options?.allowGatewaySubagentBinding,
  });

  const wrappedPluginTools = applyPluginToolDeliveryDefaults({
    tools: pluginTools,
    deliveryContext,
  });

  return [...tools, ...wrappedPluginTools];
}

export const __testing = {
  setDepsForTest(overrides?: Partial<CrawClawToolsDeps>) {
    openClawToolsDeps = overrides
      ? {
          ...defaultCrawClawToolsDeps,
          ...overrides,
        }
      : defaultCrawClawToolsDeps;
  },
};
