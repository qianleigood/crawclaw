import type { ThinkLevel } from "../../../auto-reply/thinking.js";
import type { CrawClawConfig } from "../../../config/config.js";
import type { AgentEventPayload } from "../../../infra/agent-events.js";
import type { AgentStreamParams } from "../../command/types.js";
import type { SpawnAgentSessionParams } from "../../runtime/spawn-session.js";
import type { AgentSpawnToolContext } from "../../runtime/subagent-context.js";
import type { NormalizedUsage } from "../../usage.js";
import type { SpecialAgentParentForkContext } from "./parent-fork-context.js";

export type SpecialAgentTranscriptPolicy = "isolated" | "thread_bound";
export type SpecialAgentExecutionMode = "embedded_fork" | "spawned_session";

export type SpecialAgentToolPolicy = {
  allowlist: readonly string[];
  enforcement?: "prompt_allowlist" | "runtime_deny";
};

export type SpecialAgentCachePolicy = {
  cacheRetention?: AgentStreamParams["cacheRetention"];
  skipWrite?: boolean;
};

export type SpecialAgentEmbeddedContext = {
  sessionId: string;
  sessionFile: string;
  workspaceDir: string;
  specialAgentContext?: {
    durableMemoryScope?: {
      agentId?: string | null;
      channel?: string | null;
      userId?: string | null;
    };
    sessionSummaryTarget?: {
      agentId: string;
      sessionId: string;
    };
  };
  config?: CrawClawConfig;
  sessionKey?: string;
  agentId?: string;
  provider?: string;
  model?: string;
  thinkLevel?: ThinkLevel;
  messageChannel?: string;
  messageProvider?: string;
  messageTo?: string;
  messageThreadId?: string | number;
  groupId?: string | null;
  groupChannel?: string | null;
  groupSpace?: string | null;
  spawnedBy?: string | null;
  senderIsOwner?: boolean;
  currentChannelId?: string;
  currentThreadTs?: string;
  currentMessageId?: string | number;
  allowGatewaySubagentBinding?: boolean;
};

export type SpecialAgentDefinition = {
  id: string;
  label: string;
  spawnSource: string;
  executionMode?: SpecialAgentExecutionMode;
  transcriptPolicy?: SpecialAgentTranscriptPolicy;
  toolPolicy?: SpecialAgentToolPolicy;
  cachePolicy?: SpecialAgentCachePolicy;
  runtime?: SpawnAgentSessionParams["runtime"];
  mode?: SpawnAgentSessionParams["mode"];
  cleanup?: SpawnAgentSessionParams["cleanup"];
  sandbox?: SpawnAgentSessionParams["sandbox"];
  expectsCompletionMessage?: boolean;
  defaultRunTimeoutSeconds?: number;
  defaultMaxTurns?: number;
};

export type SpecialAgentSpawnOverrides = Partial<
  Omit<SpawnAgentSessionParams, "task" | "label" | "spawnSource">
>;

export type SpecialAgentObservedHistory = {
  runId: string;
  childSessionKey: string;
  messages: unknown[];
};

export type SpecialAgentObservedUsage = {
  runId: string;
  childSessionKey: string;
  usage: NormalizedUsage;
};

export type SpecialAgentRuntimeHooks = {
  onAgentEvent?: (event: AgentEventPayload) => void | Promise<void>;
  onHistory?: (history: SpecialAgentObservedHistory) => void | Promise<void>;
  onUsage?: (usage: SpecialAgentObservedUsage) => void | Promise<void>;
};

export type SpecialAgentSpawnRequest = {
  definition: SpecialAgentDefinition;
  task: string;
  extraSystemPrompt?: string;
  parentRunId?: string;
  parentForkContext?: SpecialAgentParentForkContext;
  embeddedContext?: SpecialAgentEmbeddedContext;
  spawnContext?: AgentSpawnToolContext;
  spawnOverrides?: SpecialAgentSpawnOverrides;
  historyLimit?: number;
  hooks?: SpecialAgentRuntimeHooks;
};

export type SpecialAgentCompletionResult =
  | {
      status: "spawn_failed";
      error: string;
      runId?: string;
      childSessionKey?: string;
    }
  | {
      status: "wait_failed";
      error: string;
      runId: string;
      childSessionKey: string;
      waitStatus?: string;
      endedAt?: number;
    }
  | {
      status: "completed";
      runId: string;
      childSessionKey: string;
      reply: string;
      endedAt?: number;
      usage?: NormalizedUsage;
      historyMessageCount?: number;
    };

export function validateSpecialAgentDefinitionContract(
  definition: SpecialAgentDefinition,
): string[] {
  const issues: string[] = [];
  const executionMode = definition.executionMode ?? "spawned_session";
  const transcriptPolicy = definition.transcriptPolicy ?? "isolated";
  const toolPolicy = definition.toolPolicy;
  const allowlist = Array.isArray(toolPolicy?.allowlist)
    ? toolPolicy.allowlist.map((entry) => entry.trim()).filter(Boolean)
    : [];

  if (allowlist.length === 0) {
    issues.push("toolPolicy.allowlist must contain at least one tool");
  }
  if (executionMode === "embedded_fork" && transcriptPolicy !== "isolated") {
    issues.push('embedded_fork requires transcriptPolicy="isolated"');
  }
  if (executionMode === "embedded_fork" && !toolPolicy?.enforcement) {
    issues.push(
      'embedded_fork requires explicit toolPolicy.enforcement ("prompt_allowlist" or "runtime_deny")',
    );
  }
  if (executionMode === "embedded_fork" && definition.mode && definition.mode !== "run") {
    issues.push('embedded_fork requires mode="run"');
  }
  if (transcriptPolicy === "thread_bound" && executionMode !== "spawned_session") {
    issues.push('thread_bound transcriptPolicy requires executionMode="spawned_session"');
  }
  return issues;
}
