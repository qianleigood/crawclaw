import type { ClientToolDefinition } from "../../agents/client-tool-definition.js";
import type { AgentInternalEvent } from "../../agents/internal-events.js";
import type { SpawnedRunMetadata } from "../../agents/spawned-context.js";
import type { ObservationContext } from "../../infra/observation/types.js";
import type { PromptImageOrderEntry } from "../../media/prompt-image-order.js";
import type { InputProvenance } from "../../sessions/input-provenance.js";

export type ImageContent = {
  type: "image";
  data: string;
  mimeType: string;
};

export type AgentStreamParams = {
  temperature?: number;
  maxTokens?: number;
  toolChoice?: unknown;
  cacheRetention?: "none" | "short" | "long";
  skipCacheWrite?: boolean;
  promptCacheKey?: string;
  promptCacheRetention?: string;
  fastMode?: boolean;
};

export type AgentRunContext = {
  messageChannel?: string;
  accountId?: string;
  groupId?: string | null;
  groupChannel?: string | null;
  groupSpace?: string | null;
  currentChannelId?: string;
  currentThreadTs?: string;
  replyToMode?: "off" | "first" | "all";
  hasRepliedRef?: { value: boolean };
};

export type AgentCommandOpts = {
  message: string;
  images?: ImageContent[];
  imageOrder?: PromptImageOrderEntry[];
  clientTools?: ClientToolDefinition[];
  agentId?: string;
  provider?: string;
  model?: string;
  to?: string;
  sessionId?: string;
  sessionKey?: string;
  thinking?: string;
  thinkingOnce?: string;
  verbose?: string;
  json?: boolean;
  timeout?: string;
  maxTurns?: string;
  deliver?: boolean;
  replyTo?: string;
  replyChannel?: string;
  replyAccountId?: string;
  threadId?: string | number;
  messageChannel?: string;
  channel?: string;
  accountId?: string;
  runContext?: AgentRunContext;
  senderIsOwner?: boolean;
  allowModelOverride?: boolean;
  groupId?: SpawnedRunMetadata["groupId"];
  groupChannel?: SpawnedRunMetadata["groupChannel"];
  groupSpace?: SpawnedRunMetadata["groupSpace"];
  spawnedBy?: SpawnedRunMetadata["spawnedBy"];
  deliveryTargetMode?: string;
  bestEffortDeliver?: boolean;
  abortSignal?: AbortSignal;
  toolsAllow?: string[];
  skillsAllow?: string[];
  lane?: string;
  runId?: string;
  extraSystemPrompt?: string;
  internalEvents?: AgentInternalEvent[];
  inputProvenance?: InputProvenance;
  observation?: ObservationContext;
  streamParams?: AgentStreamParams;
  workspaceDir?: SpawnedRunMetadata["workspaceDir"];
  cleanupBundleMcpOnRunEnd?: boolean;
};

export type AgentCommandIngressOpts = Omit<
  AgentCommandOpts,
  "senderIsOwner" | "allowModelOverride"
> & {
  senderIsOwner: boolean;
  allowModelOverride: boolean;
};
